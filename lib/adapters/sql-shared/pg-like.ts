/**
 * PostgreSQL / GaussDB 共享适配器实现。
 *
 * 两者驱动 API 完全兼容（openGauss-connector-nodejs fork 自 pg），
 * 差异仅在驱动加载方式：postgresql 直接 import 'pg'；gaussdb 用 createRequire 加载 vendor 产物。
 */
import type {
  AccessMode,
  ColumnInfo,
  DatabaseAdapter,
  DbKind,
  ExecResult,
  QueryResult,
  ResolvedConnection,
  TableInfo,
} from '../types.js';
import { assertIdent, clampLimit, clampOffset, humanize, normalizeCell, quoteIdent } from './common.js';

/** 与 pg / gaussdb vendor 驱动结构兼容的最小接口 */
export interface PgLikeResult {
  rows: Record<string, unknown>[];
  fields?: { name: string }[];
  rowCount: number | null;
}
export interface PgLikeClient {
  query(text: string, values?: unknown[]): Promise<PgLikeResult>;
  /** pg 约定：release(err) 会销毁该连接并让等待的 acquire 收到错误 */
  release(err?: unknown): void;
}
export interface PgLikePool {
  /** pg-pool 官方事件签名：'error' 回调 (err, client)（pool.emit('error', err, client)）、
   *  'connect' 回调 (client)。其余事件按 EventEmitter 兜底 */
  on(event: 'error', cb: (err: Error, client?: PgLikeClient) => void): unknown;
  on(event: 'connect', cb: (client: PgLikeClient) => void): unknown;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  query(text: string, values?: unknown[]): Promise<PgLikeResult>;
  connect(): Promise<PgLikeClient>;
  end(): Promise<void>;
}
/** 一次性探测客户端（gaussdb-node 与 pg 均原生导出 Client，结构同此） */
export interface PgLikeProbeClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<PgLikeResult>;
  end(): Promise<unknown>;
}
export interface PgLikeDriver {
  Pool: new (config: Record<string, unknown>) => PgLikePool;
  Client?: new (config: Record<string, unknown>) => PgLikeProbeClient;
}

/** 多主机 URL 中的单台主机 */
export interface PgUrlHost {
  host: string;
  port?: number;
}
/** normalizeUrl 解析结果：prefix + hosts 各台重组（或单台 prefix 直含 authority）+ suffix 可互相还原 */
export interface NormalizedPgUrl {
  /** scheme:// + userinfo（有则含 @，原样保留）；单台/无 authority 时含完整 authority */
  prefix: string;
  /** 仅 authority 含多台（逗号分隔）时设置；单台/无 authority 不设 */
  hosts?: PgUrlHost[];
  /** authority 结束（首个 /、? 或 #）起原样保留；无 authority 时为 '' */
  suffix: string;
}

/** 供服务层管理事务的扩展成员（DatabaseAdapter 契约之外的可选能力） */
export interface TxHandle {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** 多主机 authority 逐台重组段（host[:port]） */
function joinHostSeg(h: PgUrlHost): string {
  return `${h.host}${h.port != null ? ':' + h.port : ''}`;
}

function poolConfig(conn: ResolvedConnection, overrideUrl?: string, max = 10): Record<string, unknown> {
  const base: Record<string, unknown> = {
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  if (conn.url) {
    // overrideUrl：多主机探测选定台 / 剥 jdbc: 后的最终 connectionString
    base.connectionString = overrideUrl ?? conn.url;
  } else if (conn.fields) {
    const f = conn.fields;
    // 兜底默认值按 kind 区分（仅表单字段被清空时触发）：GaussDB 官方默认端口 8000
    // （华为云 HCS 26.861.0：集中式 DN 与分布式 CN 均为 8000，devg-cent/gaussdb-42-0020、
    // devg-dist/gaussdb-12-0319）、默认管理用户 gaussdb；postgresql 维持社区默认 5432/postgres 不变。
    const gb = conn.meta.kind === 'gaussdb';
    base.host = String(f.host ?? '127.0.0.1');
    base.port = Number(f.port ?? (gb ? 8000 : 5432));
    base.user = String(f.user ?? f.username ?? (gb ? 'gaussdb' : 'postgres'));
    if (f.password != null) base.password = String(f.password);
    if (f.database != null) base.database = String(f.database);
  } else {
    throw new Error(`${conn.meta.kind} 连接缺少 url 或 fields 配置`);
  }
  if (conn.ssl) base.ssl = { rejectUnauthorized: false };
  return base;
}

/**
 * 规范化 JDBC / 多主机风格连接 URL。
 *
 * 背景：`jdbc:gaussdb://...` 的 `jdbc:` 是 WHATWG 非特殊 scheme，驱动内 new URL()
 * 把 `gaussdb://...` 当不透明路径 → hostname/port 为空 → 兜底连本机；多主机
 * authority（host:port,host:port）端口段含逗号非数字 → new URL 直接抛 Invalid URL。
 * 故自行按文本解析 authority，不经 WHATWG 解析。
 */
export function normalizeUrl(url: string): NormalizedPgUrl {
  const stripped = url.replace(/^jdbc:/i, '');
  const schemeEnd = stripped.indexOf('://');
  // 无 authority（非 URL 形态）：整串原样保留，交由驱动按既有逻辑处理
  if (schemeEnd < 0) return { prefix: stripped, suffix: '' };
  const rest = stripped.slice(schemeEnd + 3);
  const authEnd = /[/?#]/.exec(rest)?.index ?? rest.length;
  const authority = rest.slice(0, authEnd);
  const suffix = rest.slice(authEnd);
  const at = authority.lastIndexOf('@');
  const userinfo = at >= 0 ? authority.slice(0, at + 1) : '';
  const hostPart = authority.slice(at + 1);
  const hosts = hostPart.split(',').map((seg) => {
    // ponytail: 按最后一个冒号拆 host/port，仅支持 IPv4/主机名（IPv6 需方括号感知，遇到再加）
    const ci = seg.lastIndexOf(':');
    if (ci < 0) return { host: seg };
    const port = Number.parseInt(seg.slice(ci + 1), 10);
    return Number.isFinite(port) ? { host: seg.slice(0, ci), port } : { host: seg };
  });
  const prefix = `${stripped.slice(0, schemeEnd)}://${userinfo}`;
  // 单台不设 hosts（调用方只在多台时探测）
  if (hosts.length <= 1) return { prefix: prefix + hostPart, suffix };
  return { prefix, hosts, suffix };
}

/**
 * 逐台探测可用节点（移植自用户项目 GaussDB-MCP 的 probeHosts）：返回第一台可连
 * （masterOnly 时须为主节点，pg_is_in_recovery() 为 true 的备节点跳过）的主机；
 * 全部失败返回 undefined（调用方回退首台，让 testConnect 报真实连接错误）。
 */
// ponytail: 仅适配器创建时探测一次；运行中主备切换不自动 failover，需要时在 pool error 事件里重建池再探测
export async function pickHost(
  driver: PgLikeDriver,
  base: Record<string, unknown>,
  hosts: PgUrlHost[],
  masterOnly: boolean,
): Promise<PgUrlHost | undefined> {
  if (!driver.Client) return undefined;
  for (const h of hosts) {
    // urlUser/urlPassword 是调用方传入的内部凭据约定键，转成驱动的 user/password 后剔除
    const { urlUser, urlPassword, ...rest } = base;
    const cfg: Record<string, unknown> = { ...rest, connectionString: undefined, host: h.host };
    if (h.port != null) cfg.port = h.port;
    // 凭据自 base.urlUser/base.urlPassword 解出；无则不设
    if (typeof urlUser === 'string' && urlUser !== '') cfg.user = urlUser;
    if (typeof urlPassword === 'string') cfg.password = urlPassword;
    const client = new driver.Client(cfg);
    try {
      await client.connect();
      if (masterOnly) {
        const res = await client.query('SELECT pg_is_in_recovery() AS in_recovery');
        if (res.rows[0]?.in_recovery === true) {
          await client.end().catch(() => {});
          continue; // 备节点跳过
        }
      }
      await client.end().catch(() => {});
      return h.port != null ? { host: h.host, port: h.port } : { host: h.host };
    } catch {
      await client.end().catch(() => {});
    }
  }
  return undefined;
}

/**
 * 建池前置解析（浏览适配器与传输读写端共用，保证两条路径连接语义一致）：
 * URL 规范化（剥 jdbc:、多主机 authority 重组）后，多主机一律逐台探测选可用节点——
 * 纯 JS 驱动（pg 8.x 与 gaussdb-node）均无 libpq 式多主机 failover：带端口多台
 * connectionString 在 pg-connection-string / gaussdb-connection-string parse 时直接抛
 * Invalid URL（实测），不带端口则整串 host 'h1,h2' 直传 net.connect → DNS ENOTFOUND，
 * 故不能透传，须拆台探测（targetservertype=master 两 kind 同义：只接受主节点）。
 * 返回最终驱动池配置与最终连接 URL。
 */
export async function pgLikePoolCfg(
  kind: DbKind,
  driver: PgLikeDriver,
  conn: ResolvedConnection,
  max: number,
): Promise<{ cfg: Record<string, unknown>; url?: string }> {
  const norm = conn.url ? normalizeUrl(conn.url) : null;
  const cleanUrl = norm ? norm.prefix + (norm.hosts ?? []).map(joinHostSeg).join(',') + norm.suffix : undefined;
  let finalUrl: string | undefined = cleanUrl;
  if (norm?.hosts && norm.hosts.length > 1) {
    const { prefix, suffix } = norm;
    const joinHost = (h: PgUrlHost): string => prefix + joinHostSeg(h) + suffix;
    const firstUrl = joinHost(norm.hosts[0]!);
    // targetServerType=master（键值大小写不敏感）→ 只接受主节点
    const qi = suffix.indexOf('?');
    let masterOnly = false;
    for (const [k, v] of new URLSearchParams(qi >= 0 ? suffix.slice(qi + 1) : '')) {
      if (k.toLowerCase() === 'targetservertype' && v.toLowerCase() === 'master') masterOnly = true;
    }
    const base = poolConfig(conn, firstUrl, max);
    // 探测凭据自 prefix userinfo 解出（按最后一个 @ / 最后一个 : 分界，decode 与
    // percent-encode 注入互逆）；仅密码无用户名时 user 不设
    if (prefix.endsWith('@')) {
      const body = prefix.slice(prefix.indexOf('://') + 3, -1);
      const ci = body.lastIndexOf(':');
      if (ci >= 0) {
        const user = decodeURIComponent(body.slice(0, ci));
        if (user !== '') base.urlUser = user;
        base.urlPassword = decodeURIComponent(body.slice(ci + 1));
      } else if (body !== '') {
        base.urlUser = decodeURIComponent(body);
      }
    }
    const picked = await pickHost(driver, base, norm.hosts, masterOnly);
    // 全败回退首台重组值：让 testConnect 报真实连接错误
    finalUrl = picked ? joinHost(picked) : firstUrl;
  }
  return { cfg: poolConfig(conn, finalUrl, max), url: finalUrl };
}

/**
 * 生成「同一份池配置仅覆盖库名」的 cfg：pg / gaussdb ConnectionParameters 按
 * Object.assign({}, config, parse(config.connectionString)) 合并——connectionString
 * 解析值覆盖全部显式字段（实测：{connectionString:'postgres://u:p@h1:5432/appdb',
 * database:'otherdb',host:'x',user:'y'} → database 'appdb'/host 'h1'/user 'u'；
 * node-postgres packages/pg/lib/connection-parameters.js:53-57，gaussdb-node
 * lib/connection-parameters.js:55-57 同款）。故 URL 形态叠加 database 字段会被 URL
 * 里的原库名覆盖（跨库池静默连回原库），必须改写 URL path 段；字段形态直接叠加。
 * 写回库名 encodeURIComponent 与驱动 parse 的 decodeURI 对空格/非 ASCII 往返无损
 * （两驱动实测 parse('.../a%20b') → database 'a b'；两驱动源码 pg-connection-string
 * index.js:67 / gaussdb-connection-string index.js:62 均为 decodeURI(pathname)）——
 * 含 # / 等保留字符的库名 decodeURI 不还原（驱动能力边界，libpq 才有完整
 * percent-decoding），此类库名无法经 URL 形态无损表达。
 */
export function pgCfgWithDatabase(cfg: Record<string, unknown>, db: string): Record<string, unknown> {
  const cs = cfg.connectionString;
  // 无 authority 的非 URL 形态不产生垃圾改写，退回字段叠加
  if (typeof cs !== 'string' || !cs.includes('://')) return { ...cfg, database: db };
  const norm = normalizeUrl(cs);
  const qi = /[?#]/.exec(norm.suffix)?.index ?? -1;
  const tail = qi >= 0 ? norm.suffix.slice(qi) : '';
  const hosts = (norm.hosts ?? []).map(joinHostSeg).join(',');
  return { ...cfg, connectionString: `${norm.prefix}${hosts}/${encodeURIComponent(db)}${tail}` };
}

export async function createPgLikeAdapter(
  kind: DbKind,
  Driver: PgLikeDriver,
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  const { cfg, url: finalUrl } = await pgLikePoolCfg(kind, Driver, conn, 10);
  const pool = new Driver.Pool(cfg);
  const readOnly = opts?.mode === 'ro';
  // 所有池（主池 + 跨库池）统一走此初始化。
  // pg 约定：release(err) 若无等待者会 emit pool 'error'，无监听器会崩进程——
  // 官方 Pool 文档要求必须注册 error 监听（空闲连接因后端故障销毁时经此冒泡），无条件兜底。
  // 服务器级 ro 强制（官方手段）：每个新连接会话设为只读事务，仅 ro 模式注册。
  // fail-closed：SET 失败时 release(err) 让驱动销毁该连接、等待的 acquire 收到错误——
  // 会话级只读是 ro 的最后防线，不允许静默降级成可写连接。
  const setupPool = (p: PgLikePool): void => {
    p.on('error', () => {});
    if (readOnly) {
      p.on('connect', (c) => {
        void c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY').catch((err: unknown) => {
          c.release(err instanceof Error ? err : new Error(String(err)));
        });
      });
    }
  };
  setupPool(pool);

  // 事务激活期间所有 query/execute 路由到同一 client
  let txClient: PgLikeClient | null = null;
  const run = (sql: string, params?: unknown[]): Promise<PgLikeResult> =>
    txClient ? txClient.query(sql, params) : pool.query(sql, params);

  // 跨库浏览（Navicat 行为）：树列出服务器上所有库，展开非连接库时用同一凭据开指向该库的池。
  // 池按库缓存复用；ro 模式下新池同样套会话只读。连接自身的库（fields.database 或 url 库名）直接复用主池。
  const dbPools = new Map<string, PgLikePool>();
  const mainDb = (): string | null => {
    if (conn.fields) return conn.fields.database ? String(conn.fields.database) : null;
    if (!finalUrl) return null;
    try {
      // 规范化后的最终 URL（单台 authority）才可被 new URL 正确解析
      return decodeURIComponent(new URL(finalUrl).pathname.replace(/^\//, '')) || null;
    } catch {
      return null;
    }
  };
  const poolFor = (db: string | null): PgLikePool => {
    if (!db || db === mainDb()) return pool;
    const cached = dbPools.get(db);
    if (cached) return cached;
    // 与主池同一份最终 cfg（多主机探测选定台后的 connectionString），仅覆盖库名——
    // URL 形态经 pgCfgWithDatabase 改写 path（叠加 database 字段会被驱动里 URL
    // 库名覆盖，静默连回原库）
    const created = new Driver.Pool(pgCfgWithDatabase(cfg, db));
    setupPool(created); // 与主池一致：error 兜底 + ro 会话只读
    dbPools.set(db, created);
    return created;
  };

  const defaultSchema = (): string => {
    const f = conn.fields;
    return f && typeof f.schema === 'string' && f.schema ? f.schema : 'public';
  };

  /** 浏览目标解析："db.schema"（跨库）| "schema"（当前库）| 空（当前库默认 schema）。
   *  PG 标识符不允许裸点，按第一个点切分安全；多余点由 assertIdent 拒绝。 */
  const parseBrowseTarget = (ref: string | undefined, what: string): { db: string | null; schema: string } => {
    if (!ref) return { db: null, schema: defaultSchema() };
    const i = ref.indexOf('.');
    if (i < 0) return { db: null, schema: assertIdent(ref, what) };
    return { db: assertIdent(ref.slice(0, i), '数据库'), schema: assertIdent(ref.slice(i + 1), what) };
  };

  function toQueryResult(res: PgLikeResult): QueryResult {
    let columns: string[] = (res.fields ?? []).map((f) => f.name);
    if (columns.length === 0 && res.rows.length > 0) {
      columns = Object.keys(res.rows[0]!);
    }
    const rows = res.rows.map((r) => columns.map((c) => normalizeCell(r[c])));
    return { columns, rows, rowCount: rows.length };
  }

  const tx: TxHandle = {
    begin: () =>
      humanize(`${kind} 事务开启`, async () => {
        if (txClient) throw new Error('事务已开启，请勿重复 begin');
        txClient = await pool.connect();
        try {
          await txClient.query('BEGIN');
        } catch (e) {
          txClient.release();
          txClient = null;
          throw e;
        }
      }),
    commit: () =>
      humanize(`${kind} 事务提交`, async () => {
        const c = txClient;
        if (!c) throw new Error('没有进行中的事务');
        txClient = null;
        try {
          await c.query('COMMIT');
        } finally {
          c.release();
        }
      }),
    rollback: () =>
      humanize(`${kind} 事务回滚`, async () => {
        const c = txClient;
        if (!c) throw new Error('没有进行中的事务');
        txClient = null;
        try {
          await c.query('ROLLBACK');
        } finally {
          c.release();
        }
      }),
  };

  return {
    kind,
    connId: conn.meta.id,
    tx,

    testConnect: () =>
      humanize(`${kind} 连接测试`, async () => {
        const res = await pool.query('SELECT version() AS v');
        const v = res.rows[0]?.v;
        return { ok: true, serverInfo: v == null ? kind : String(v) };
      }),

    query: (sql, params, database) =>
      humanize(`${kind} 查询失败`, async () => {
        // 跨库操控（Navicat 式）：指定目标库 → 路由到该库的池（主池事务不跨库，忽略事务路由）
        const res = database
          ? await poolFor(assertIdent(database, '数据库')).query(sql, params ?? [])
          : await run(sql, params ?? []);
        return toQueryResult(res);
      }),

    execute: (statement, params, database) =>
      humanize(`${kind} 执行失败`, async (): Promise<ExecResult> => {
        const res = database
          ? await poolFor(assertIdent(database, '数据库')).query(statement, params ?? [])
          : await run(statement, params ?? []);
        const n = res.rowCount;
        return {
          affectedRows: typeof n === 'number' ? n : undefined,
          message: typeof n === 'number' ? `执行成功，受影响 ${n} 行` : '执行成功',
        };
      }),

    listDatabases: () =>
      humanize(`${kind} 列出数据库`, async () => {
        const res = await pool.query(
          'SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname',
        );
        return res.rows.map((r) => String(r.datname));
      }),

    // 库内 schema 清单（Navicat 官方层级：数据库 → 模式 → 表）。
    // database 参数 = 库名（UI 树第一层）；pg_* 前缀覆盖 pg_catalog/pg_toast/pg_temp 系。
    listSchemas: (database) =>
      humanize(`${kind} 列出模式`, async () => {
        const p = poolFor(database ? assertIdent(database, '数据库') : null);
        const res = await p.query(
          `SELECT nspname FROM pg_catalog.pg_namespace
           WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
           ORDER BY nspname`,
        );
        return res.rows.map((r) => String(r.nspname));
      }),

    // database 参数 = "库名.schema"（跨库浏览）或 "schema"（当前库）
    listTables: (database) =>
      humanize(`${kind} 列出表`, async () => {
        const { db, schema } = parseBrowseTarget(database, 'schema');
        const res = await poolFor(db).query(
          `SELECT table_name, table_type FROM information_schema.tables
           WHERE table_schema = $1 ORDER BY table_name`,
          [schema],
        );
        return res.rows.map((r) => {
          const rawType = String(r.table_type);
          return {
            name: String(r.table_name),
            type: rawType === 'BASE TABLE' ? 'TABLE' : rawType,
            database: db ? `${db}.${schema}` : schema,
          } satisfies TableInfo;
        });
      }),

    describeTable: (table, database) =>
      humanize(`${kind} 查看表结构`, async () => {
        const { db, schema } = parseBrowseTarget(database, 'schema');
        const tbl = assertIdent(table, '表名');
        const p = poolFor(db);
        const res = await p.query(
          `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.character_maximum_length,
                  col_description((quote_ident($1) || '.' || quote_ident($2))::regclass, c.ordinal_position) AS col_comment
           FROM information_schema.columns c
           WHERE c.table_schema = $1 AND c.table_name = $2
           ORDER BY c.ordinal_position`,
          [schema, tbl],
        );
        if (res.rows.length === 0) throw new Error(`表不存在: ${db ? db + '.' : ''}${schema}.${tbl}`);
        const pks = await p.query(
          `SELECT kcu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
          [schema, tbl],
        );
        const pkSet = new Set(pks.rows.map((r) => String(r.column_name)));
        return res.rows.map((r): ColumnInfo => {
          const len = r.character_maximum_length;
          const base = String(r.data_type);
          return {
            name: String(r.column_name),
            dataType: len != null ? `${base}(${String(len)})` : base,
            nullable: r.is_nullable === 'YES',
            key: pkSet.has(String(r.column_name)) ? 'PRI' : undefined,
            default: r.column_default == null ? null : String(r.column_default),
            comment: r.col_comment == null ? undefined : String(r.col_comment),
          };
        });
      }),

    previewRows: (table, limit, database, offset) =>
      humanize(`${kind} 预览行`, async () => {
        const { db, schema } = parseBrowseTarget(database, 'schema');
        const tbl = assertIdent(table, '表名');
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const sql = `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(tbl)} LIMIT $1 OFFSET $2`;
        // 当前库保持事务路由（run）；跨库必须用该库自己的池
        const res = db ? await poolFor(db).query(sql, [lim, off]) : await run(sql, [lim, off]);
        return toQueryResult(res);
      }),

    close: () =>
      humanize(`${kind} 关闭连接`, async () => {
        await Promise.all([pool.end(), ...[...dbPools.values()].map((p) => p.end())]);
      }),
  };
}
