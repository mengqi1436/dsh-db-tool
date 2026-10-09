/**
 * Oracle 适配器（oracledb v7 thin 模式，DB 12.1+）。
 *
 * 设计要点（依据官方文档调研）：
 *  - oracledb.createPool({ user, password, connectString, poolAlias: <逐池唯一>,
 *    poolMin: 1, poolMax: 10, poolTimeout: 60 })。
 *    禁止 SYSDBA 等特权连接（不透传 privilege）。
 *  - poolAlias 显式传唯一值：不传则落到匿名池（不可经 getPool() 检索），见 createOraPool 注释。
 *  - CLOB 经全局 fetchAsString 转字符串；BLOB 经全局 fetchAsBuffer 转 Buffer。
 *    （fetchInfo 的键是【列名】而非类型名，按类型统一转换只能用全局 fetchXXX 属性——
 *    官方 connection.rst「fetchInfo」节：「Each column is specified by name」）
 *    NUMBER 保持 number（超精度损失由用户承担，见文档标注）。
 *  - query() 仅允许 SELECT/WITH；execute() DML/DDL，autoCommit: true 单语句语义。
 *  - Oracle 无 BEGIN，事务用 SET TRANSACTION READ WRITE + commit/rollback（tx 成员）。
 *  - DDL 隐式提交：execute 对 DDL 的 message 附注「DDL 已隐式提交，不可回滚」。
 *  - 标识符默认大写存储：listTables/describeTable 内部统一 toUpperCase 匹配。
 *  - 锁号/密码验证器等常见连接错误转人类可读提示（见 ORA_HINTS）。
 */
import oracledb from 'oracledb';
import { sqlHead, SQL_READ_HEADS } from '../../guard/index.js';
import type {
  AccessMode,
  AdapterFactory,
  ColumnInfo,
  DatabaseAdapter,
  ExecResult,
  NormalizedCell,
  QueryResult,
  ResolvedConnection,
  TableInfo,
  TestConnectResult,
} from '../types.js';

// CLOB 统一按字符串返回；BLOB 统一按 Buffer 返回。均为官方全局按类型转换
// （fetchInfo 的键是列名而非类型名，`{ BLOB: … }` 只会匹配恰好名为 "BLOB" 的列，
// 按类型统一转换须用全局 fetchAsString/fetchAsBuffer——官方 connection.rst
// 「fetchInfo」节原文「Each column is specified by name, using Oracle's standard
// naming convention.」；fetchInfo 自 6.0 标记 deprecated，官方建议全局属性/fetchTypeHandler）
if (!oracledb.fetchAsString.includes(oracledb.CLOB)) {
  oracledb.fetchAsString = [...oracledb.fetchAsString, oracledb.CLOB];
}
if (!oracledb.fetchAsBuffer.includes(oracledb.BLOB)) {
  oracledb.fetchAsBuffer = [...oracledb.fetchAsBuffer, oracledb.BLOB];
}

const ROWS_MAX = 500;
const CELL_TRUNC = 1000;
const DDL_KEYWORDS = new Set([
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE',
  'COMMENT', 'ANALYZE', 'AUDIT', 'NOAUDIT', 'FLASHBACK', 'PURGE',
]);

/** 常见 ORA 错误 → 人类可读提示 */
export const ORA_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/ORA-01017/, '用户名或密码错误'],
  [/ORA-12154/, '无法解析连接串中的服务名，请检查 connectString / service_name'],
  [/ORA-12505/, '监听器不认识该 SID：请使用服务名(service_name)而非 SID'],
  [/ORA-12514/, '监听器当前未注册该服务名，请检查服务名拼写与数据库注册状态'],
  [/ORA-12541/, '无法连接监听器，请检查主机与端口'],
  [/ORA-12543/, '网络无法到达目标主机，请检查主机/端口/防火墙'],
  [/ORA-12560/, 'TNS 协议适配器错误，请检查连接串格式（应为 host:port/service_name）'],
  [/ORA-28040/, '客户端与服务器密码验证器版本不兼容（服务器 SQLNET.ALLOWED_LOGON_VERSION_SERVER 需放宽）'],
  [/ORA-28000/, '账号已被锁定，请联系 DBA 解锁'],
  [/ORA-28001/, '密码已过期，请联系 DBA 重置'],
  [/ORA-00942/, '表或视图不存在（Oracle 标识符默认大写存储，注意大小写与 owner）'],
  [/ORA-00904/, '列名无效（Oracle 标识符默认大写存储，注意大小写）'],
];

export function humanizeOraError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const hint = ORA_HINTS.find(([re]) => re.test(msg))?.[1];
  return new Error(hint ? `Oracle 错误：${msg}（提示：${hint}）` : `Oracle 错误：${msg}`);
}

/** 标识符基本校验（引用创建的 Oracle 名字可含任意字符，白名单会误杀）：
 *  非空、≤128、无 NUL/换行。防注入靠数据字典参数绑定 + preview 处 escIdent 转义。
 *  保留原名不强制大写：describeTable 的 SQL 用 UPPER(:tab) 兜底匹配未引用建表。 */
export function sanitizeIdentifier(name: string, label: string): string {
  if (
    typeof name !== 'string' || name.length === 0 || name.length > 128 ||
    /[\0\r\n]/.test(name)
  ) {
    throw new Error(`非法 Oracle ${label}「${name}」：不允许为空、超 128 字符或含 NUL/换行`);
  }
  return name;
}

/** 双引号标识符转义（" → ""），拼接进 SQL 前必须过此函数 */
function escIdent(name: string): string {
  return name.replaceAll('"', '""');
}

function trunc(s: string, max = CELL_TRUNC): string {
  return s.length > max ? `${s.slice(0, max)}…[截断,共${s.length}字符]` : s;
}

/** 行值规范化为 NormalizedCell（Lob 兜底转字符串并截断） */
async function normalizeCell(v: unknown): Promise<NormalizedCell> {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return trunc(v);
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return trunc(`0x${v.toString('hex')}`); // fetchAsBuffer 产出的 BLOB
  if (v instanceof oracledb.Lob) {
    // 官方 Lob 类成员仅 getData()/read()/close()/destroy() 等，无 toString()（官方 lob.rst；
    // 实测 Lob.prototype.toString 即 Object.prototype.toString）——曾误用 toString()
    // 致 LOB 列恒显示 '[object Object]'。getData() 按 CLOB/BFILE 返回 string、按
    // 未转换 BLOB 返回 Buffer。判别用官方导出类 instanceof（constructor.name 非
    // 官方承诺，esbuild 压缩改名场景会失效）。
    const data = await v.getData();
    const s = typeof data === 'string' ? data : `0x${Buffer.from(data).toString('hex')}`;
    return trunc(s);
  }
  return trunc(String(v));
}

/** 连接参数解析：url（oracle://user:pass@host:1521/service）或 fields */
export function resolveOracleConn(conn: ResolvedConnection): { user: string; password: string; connectString: string } {
  if (conn.url) {
    const u = new URL(conn.url);
    const service = u.pathname.replace(/^\//, '');
    if (!u.hostname || service === '') {
      throw new Error('Oracle URL 格式应为 oracle://user:pass@host:1521/SERVICE_NAME');
    }
    const user = decodeURIComponent(u.username);
    if (user === '') {
      throw new Error('Oracle URL 缺少用户名：应为 oracle://user:pass@host:1521/SERVICE_NAME');
    }
    return {
      user,
      password: decodeURIComponent(u.password),
      connectString: `${u.hostname}:${u.port || 1521}/${service}`,
    };
  }
  const f = conn.fields ?? {};
  const host = typeof f.host === 'string' ? f.host : '';
  const port = typeof f.port === 'number' ? f.port : 1521;
  const service = typeof f.service === 'string' ? f.service : typeof f.database === 'string' ? f.database : '';
  if (host === '' || service === '') {
    throw new Error('Oracle 连接需要 url（oracle://user:pass@host:1521/SERVICE）或 fields（host/port/service）');
  }
  const user = typeof f.user === 'string' ? f.user : '';
  if (user === '') {
    throw new Error('Oracle 连接缺少用户名（fields.user）');
  }
  return {
    user,
    password: typeof f.password === 'string' ? f.password : '',
    connectString: `${host}:${port}/${service}`,
  };
}

export interface OracleAdapterOptions {
  mode?: AccessMode;
  /** 测试注入：跳过真实连接池创建 */
  pool?: unknown;
}

/**
 * 连接池别名：oracledb 的规则与 dmdb 不同——只有「显式传入的别名」或
 * 「'default' 尚空闲时取到的缺省值」会登记进模块级 poolCache；两者都被占用时
 * 驱动创建的是 poolAlias === undefined 的匿名池（不报错，也无法经 getPool() 检索），
 * 只有显式重复别名才抛 NJS-046（lib/oracledb.js:640-649、lib/errors.js:352）。
 * 本插件同进程内可并存多个池（连接的 ro/rw 各一份缓存、testConnection/testDraft 的
 * 一次性池、控制台事务会话、数据传输独立池），故显式传唯一别名：每池身份可检索，
 * 且不抢占 getPool() 的缺省键 'default'。回收靠 '_afterPoolClose' 事件（close 抛错则不触发）。
 */
let poolSeq = 0;
function nextPoolAlias(conn: ResolvedConnection): string {
  return `dsh-ora-${conn.meta.id}-${++poolSeq}`;
}

/** 建池（连接串解析、池参数与别名单点维护，供适配器与数据传输入口共用） */
async function createOraPool(conn: ResolvedConnection): Promise<oracledb.Pool> {
  const { user, password, connectString } = resolveOracleConn(conn);
  try {
    return await oracledb.createPool({
      user,
      password,
      connectString,
      poolAlias: nextPoolAlias(conn),
      poolMin: 1,
      poolMax: 10,
      poolTimeout: 60,
    });
  } catch (e) {
    throw humanizeOraError(e);
  }
}

export async function createOracleAdapter(
  conn: ResolvedConnection,
  opts?: OracleAdapterOptions,
): Promise<DatabaseAdapter> {
  const mode: AccessMode = opts?.mode ?? 'rw';
  let pool: oracledb.Pool;
  if (opts?.pool) {
    pool = opts.pool as oracledb.Pool;
  } else {
    pool = await createOraPool(conn);
  }

  function requireRw(action: string): void {
    if (mode === 'ro') {
      throw new Error(`连接为只读(ro)模式，拒绝执行${action}；请使用 rw 连接或只发查询(query)`);
    }
  }

  function isDdl(sql: string): boolean {
    const first = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    return DDL_KEYWORDS.has(first);
  }

  async function toExecResult(sql: string, r: oracledb.ExecuteResult): Promise<ExecResult> {
    const ddlNote = isDdl(sql) ? '（DDL 已隐式提交，不可回滚）' : '';
    return {
      affectedRows: typeof r.rowsAffected === 'number' && r.rowsAffected > 0 ? r.rowsAffected : undefined,
      message: `${sql.trim().split(/\s+/)[0]?.toUpperCase() ?? 'SQL'} 完成${r.rowsAffected ? `，影响 ${r.rowsAffected} 行` : ''}${ddlNote}`,
    };
  }

  /** 执行结果 → QueryResult（行值规范化 + 超限截断）；query 与事务内读语句共用 */
  async function rowsToQueryResult(r: oracledb.ExecuteResult): Promise<QueryResult> {
    const allRows = (r.rows as Record<string, unknown>[] | undefined) ?? [];
    const truncated = allRows.length > ROWS_MAX;
    const columns = (r.metaData ?? []).map((m) => m.name);
    const rows: NormalizedCell[][] = [];
    for (const row of allRows.slice(0, ROWS_MAX)) {
      rows.push(await Promise.all(Object.values(row).map(normalizeCell)));
    }
    return { columns, rows, rowCount: rows.length, truncated: truncated || undefined };
  }

  // autoCommit 默认 true：query/元数据 SELECT 结束隐式事务避免 ro 事务悬挂；tx 专用连接显式 autoCommit:false 覆盖
  const execOpts: oracledb.ExecuteOptions = { outFormat: oracledb.OBJECT, maxRows: ROWS_MAX + 1, autoCommit: true };

  /**
   * 从池借一条连接执行后归还。⚠️ oracledb 的 Pool 没有 execute，
   * 一切语句必须在 Connection 上执行；close() 即归还连接。
   */
  async function withConn<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
    const c = await pool.getConnection();
    try {
      return await fn(c);
    } finally {
      await c.close().catch(() => { /* 归还失败忽略 */ });
    }
  }

  // 注意：currentUser / 系统 schema 名单在 adapter 对象之前声明，
  // 不再依赖「方法仅运行期调用」的隐式 TDZ 保证（审查项：脆弱模式消除）
  const currentUser = resolveOracleConn(conn).user.toUpperCase();

  /** Oracle 内建系统 schema（核心名单 + APEX/flows 组件前缀）：业务不可查询，列表中过滤 */
  const ORA_SYSTEM_SCHEMAS = new Set([
    'SYS', 'SYSTEM', 'OUTLN', 'XDB', 'CTXSYS', 'MDSYS', 'OLAPSYS', 'ORDDATA', 'ORDSYS',
    'WMSYS', 'DBSNMP', 'APPQOSSYS', 'AUDSYS', 'LBACSYS', 'DVSYS', 'OJVMSYS', 'DBSFWUSER',
    'GSMADMIN_INTERNAL', 'GSMCATUSER', 'GGSYS', 'REMOTE_SCHEDULER_AGENT', 'ANONYMOUS',
  ]);
  const isOraSystemSchema = (o: string) =>
    ORA_SYSTEM_SCHEMAS.has(o) || /^(APEX|FLOWS)_/.test(o);

  /** owner 解析：database 参数或默认当前用户（保留原样——引用创建的 schema 大小写敏感） */
  function ownerOf(database?: string): string {
    return sanitizeIdentifier(database ?? currentUser, 'schema/owner 名');
  }

  /**
   * tx 为可选扩展成员：契约 DatabaseAdapter 尚未声明 tx（types.ts 为共享文件，本阶段不改），
   * 用交叉类型承载，运行时存在于返回对象上；注册/服务层可按需取用。
   * exec 回调按语句头分流：读语句返回 QueryResult，其余返回 ExecResult。
   */
  type AdapterWithTx = DatabaseAdapter & {
    tx?: <T>(
      fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult | QueryResult>) => Promise<T>,
    ) => Promise<T>;
  };
  const adapter: AdapterWithTx = {
    kind: 'oracle',
    connId: conn.meta.id,

    async testConnect(): Promise<TestConnectResult> {
      try {
        const r = await withConn((c) => c.execute('SELECT banner FROM v$version WHERE ROWNUM = 1', [], execOpts));
        const row = (r.rows as Record<string, unknown>[] | undefined)?.[0];
        const banner = row ? String(Object.values(row)[0] ?? '') : '';
        return { ok: true, serverInfo: banner };
      } catch {
        // v$version 在部分受限环境对普通用户不可读（ORA-00942/ORA-01031）：
        // 版本信息尽力而为，连通性本身用 dual 兜底判定，避免误报连接失败
        try {
          await withConn((c) => c.execute('SELECT 1 FROM dual', [], execOpts));
          return { ok: true, serverInfo: 'Oracle（版本信息不可读：v$version 无权限）' };
        } catch (e) {
          return { ok: false, error: humanizeOraError(e).message };
        }
      }
    },

    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const head = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (head !== 'SELECT' && head !== 'WITH') {
        throw new Error('Oracle query 仅允许 SELECT/WITH 语句；写操作或 DDL 请走 execute');
      }
      try {
        const r = await withConn((c) => c.execute(sql, params ?? [], execOpts));
        return await rowsToQueryResult(r);
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    async execute(statement: string, params?: unknown[]): Promise<ExecResult> {
      requireRw('execute');
      try {
        const r = await withConn((c) => c.execute(statement, params ?? [], execOpts));
        return await toExecResult(statement, r);
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    /**
     * 事务：从池取专用连接执行多条语句，成功 commit、异常 rollback。
     * Oracle 无 BEGIN，用 SET TRANSACTION READ WRITE 开始显式事务。
     * exec 回调按语句头分流：读语句（SQL_READ_HEADS 命中首词，如 SELECT/WITH）在
     * 本事务连接上执行并返回结果集（事务内读未提交数据是官方标准用法）；
     * 其余语句返回执行回执。所有语句同处一个事务，随 commit/rollback 收口。
     */
    async tx<T>(
      fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult | QueryResult>) => Promise<T>,
    ): Promise<T> {
      requireRw('事务(tx)');
      const c = await pool.getConnection();
      try {
        await c.execute('SET TRANSACTION READ WRITE');
        const exec = async (sql: string, binds?: unknown[]): Promise<ExecResult | QueryResult> => {
          const r = await c.execute(sql, binds ?? [], { ...execOpts, autoCommit: false });
          return SQL_READ_HEADS.has(sqlHead(sql)) ? rowsToQueryResult(r) : toExecResult(sql, r);
        };
        const out = await fn(exec);
        await c.commit();
        return out;
      } catch (e) {
        try {
          await c.rollback();
        } catch { /* 已断开等场景忽略 */ }
        throw humanizeOraError(e);
      } finally {
        try {
          await c.close();
        } catch { /* 归还失败忽略 */ }
      }
    },

    async listDatabases(): Promise<string[]> {
      // Oracle 为单库多 schema 模型：「数据库」下拉列出可浏览的 schema（有表者），
      // 失败回退当前用户 schema，绝不用 service 名等占位值（会污染 owner 参数）。
      // 内建系统 schema（数据字典/组件账户）业务不可查询，列出只会让展开时报
      // ORA-00942/ORA-01031 类错误，故过滤（保留当前用户自身）。
      try {
        const r = await withConn((c) => c.execute(
          'SELECT DISTINCT owner FROM all_tables ORDER BY owner',
          [],
          execOpts,
        ));
        const owners = ((r.rows as Record<string, unknown>[] | undefined) ?? [])
          .map((row) => String(row.OWNER ?? '').trim())
          .filter(Boolean)
          .filter((o) => o === currentUser || !isOraSystemSchema(o.toUpperCase()));
        return owners.length > 0 ? owners : [currentUser];
      } catch {
        return [currentUser];
      }
    },

    async listTables(database?: string): Promise<TableInfo[]> {
      const owner = ownerOf(database);
      try {
        const r = await withConn((c) => c.execute(
          'SELECT table_name FROM all_tables WHERE owner = :owner ORDER BY table_name FETCH FIRST 500 ROWS ONLY',
          [owner],
          execOpts,
        ));
        const rows = (r.rows as Record<string, unknown>[] | undefined) ?? [];
        return rows.map((row) => ({ name: String(row.TABLE_NAME ?? ''), type: 'TABLE' }));
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    async describeTable(table: string, database?: string): Promise<ColumnInfo[]> {
      const owner = ownerOf(database);
      // 原名精确匹配优先；未引用创建的表名在字典中为大写存储，UPPER 兜底
      const tab = sanitizeIdentifier(table, '表名');
      try {
        // 同连接内两查保证一致性
        const { colsR, pkR } = await withConn(async (c) => ({
          colsR: await c.execute(
            `SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default
            FROM all_tab_columns WHERE owner = :owner AND (table_name = :tab OR table_name = UPPER(:tab)) ORDER BY column_id`,
            [owner, tab],
            execOpts,
          ),
          pkR: await c.execute(
            `SELECT cols.column_name
            FROM all_constraints cons
            JOIN all_cons_columns cols
              ON cons.owner = cols.owner AND cons.constraint_name = cols.constraint_name
            WHERE cons.constraint_type = 'P' AND cons.owner = :owner AND (cons.table_name = :tab OR cons.table_name = UPPER(:tab))`,
            [owner, tab],
            execOpts,
          ),
        }));
        const pkSet = new Set(
          ((pkR.rows as Record<string, unknown>[] | undefined) ?? []).map((r2) => String(r2.COLUMN_NAME ?? '')),
        );
        return ((colsR.rows as Record<string, unknown>[] | undefined) ?? []).map((row) => {
          const dataType = String(row.DATA_TYPE ?? '');
          const precision = row.DATA_PRECISION;
          const scale = row.DATA_SCALE;
          const length = row.DATA_LENGTH;
          let typeStr = dataType;
          if (precision !== null && precision !== undefined) {
            typeStr = scale !== null && scale !== undefined && Number(scale) > 0
              ? `${dataType}(${Number(precision)},${Number(scale)})`
              : `${dataType}(${Number(precision)})`;
          } else if (/^(VARCHAR|NVARCHAR|CHAR|NCHAR|RAW)/.test(dataType) && length !== null && length !== undefined) {
            typeStr = `${dataType}(${Number(length)})`;
          }
          const def = row.DATA_DEFAULT;
          return {
            name: String(row.COLUMN_NAME ?? ''),
            dataType: typeStr,
            nullable: String(row.NULLABLE ?? 'Y') === 'Y',
            ...(pkSet.has(String(row.COLUMN_NAME ?? '')) ? { key: 'PRI' as const } : {}),
            default: def === null || def === undefined ? null : trunc(String(def).trim()),
          };
        });
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    async previewRows(table: string, limit: number, database?: string, offset?: number): Promise<QueryResult> {
      const owner = ownerOf(database);
      const tab = sanitizeIdentifier(table, '表名'); // 拼接前经 escIdent 转义
      const n = Math.max(1, Math.min(Math.floor(limit) || 20, ROWS_MAX));
      const off = Math.max(0, Math.floor(offset ?? 0) || 0);
      try {
        const r = await withConn((c) => c.execute(
          `SELECT * FROM "${escIdent(owner)}"."${escIdent(tab)}" OFFSET :o ROWS FETCH NEXT :n ROWS ONLY`,
          [off, n],
          execOpts,
        ));
        const rows = (r.rows as Record<string, unknown>[] | undefined) ?? [];
        const columns = (r.metaData ?? []).map((m) => m.name);
        const normRows: NormalizedCell[][] = [];
        for (const row of rows) {
          normRows.push(await Promise.all(Object.values(row).map(normalizeCell)));
        }
        return { columns, rows: normRows, rowCount: normRows.length };
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    async close(): Promise<void> {
      try {
        await pool.close();
      } catch { /* 已关闭忽略 */ }
    },
  };

  return adapter;
}

export const factory: AdapterFactory = async (conn) => createOracleAdapter(conn);

/** 数据传输读写端用的独立连接池（别名逐池唯一，可与主连接池并存） */
export async function openOraclePool(conn: ResolvedConnection): Promise<oracledb.Pool> {
  return await createOraPool(conn);
}
