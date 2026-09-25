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
  on(event: string, cb: (client: PgLikeClient) => void): unknown;
  query(text: string, values?: unknown[]): Promise<PgLikeResult>;
  connect(): Promise<PgLikeClient>;
  end(): Promise<void>;
}
export interface PgLikeDriver {
  Pool: new (config: Record<string, unknown>) => PgLikePool;
}

/** 供服务层管理事务的扩展成员（DatabaseAdapter 契约之外的可选能力） */
export interface TxHandle {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

function poolConfig(conn: ResolvedConnection): Record<string, unknown> {
  const base: Record<string, unknown> = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  if (conn.url) {
    base.connectionString = conn.url;
  } else if (conn.fields) {
    const f = conn.fields;
    base.host = String(f.host ?? '127.0.0.1');
    base.port = Number(f.port ?? 5432);
    base.user = String(f.user ?? f.username ?? 'postgres');
    if (f.password != null) base.password = String(f.password);
    if (f.database != null) base.database = String(f.database);
  } else {
    throw new Error(`${conn.meta.kind} 连接缺少 url 或 fields 配置`);
  }
  if (conn.ssl) base.ssl = { rejectUnauthorized: false };
  return base;
}

export async function createPgLikeAdapter(
  kind: DbKind,
  Driver: PgLikeDriver,
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  const pool = new Driver.Pool(poolConfig(conn));
  const readOnly = opts?.mode === 'ro';
  // 服务器级 ro 强制（官方手段）：每个新连接会话设为只读事务。
  // fail-closed：SET 失败时 release(err) 让驱动销毁该连接、等待的 acquire 收到错误——
  // 会话级只读是 ro 的最后防线，不允许静默降级成可写连接。
  const setupReadOnly = (p: PgLikePool): void => {
    p.on('connect', (c) => {
      void c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY').catch((err: unknown) => {
        c.release(err instanceof Error ? err : new Error(String(err)));
      });
    });
    // pg 约定：release(err) 若无等待者会 emit pool 'error'，不监听会崩进程
    p.on('error', () => {});
  };
  if (readOnly) setupReadOnly(pool);

  // 事务激活期间所有 query/execute 路由到同一 client
  let txClient: PgLikeClient | null = null;
  const run = (sql: string, params?: unknown[]): Promise<PgLikeResult> =>
    txClient ? txClient.query(sql, params) : pool.query(sql, params);

  // 跨库浏览（Navicat 行为）：树列出服务器上所有库，展开非连接库时用同一凭据开指向该库的池。
  // 池按库缓存复用；ro 模式下新池同样套会话只读。连接自身的库（fields.database 或 url 库名）直接复用主池。
  const dbPools = new Map<string, PgLikePool>();
  const mainDb = (): string | null => {
    if (conn.fields) return conn.fields.database ? String(conn.fields.database) : null;
    if (!conn.url) return null;
    try {
      return decodeURIComponent(new URL(conn.url).pathname.replace(/^\//, '')) || null;
    } catch {
      return null;
    }
  };
  const poolFor = (db: string | null): PgLikePool => {
    if (!db || db === mainDb()) return pool;
    const cached = dbPools.get(db);
    if (cached) return cached;
    const created = new Driver.Pool({ ...poolConfig(conn), database: db });
    if (readOnly) setupReadOnly(created);
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

    query: (sql, params) =>
      humanize(`${kind} 查询失败`, async () => toQueryResult(await run(sql, params ?? []))),

    execute: (statement, params) =>
      humanize(`${kind} 执行失败`, async (): Promise<ExecResult> => {
        const res = await run(statement, params ?? []);
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
