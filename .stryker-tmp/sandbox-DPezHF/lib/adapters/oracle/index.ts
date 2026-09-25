/**
 * Oracle 适配器（oracledb v7 thin 模式，DB 12.1+）。
 *
 * 设计要点（依据官方文档调研）：
 *  - oracledb.createPool({ user, password, connectString, poolMin: 1, poolMax: 10, poolTimeout: 60 })。
 *    禁止 SYSDBA 等特权连接（不透传 privilege）。
 *  - CLOB 经全局 fetchAsString 转字符串；BLOB 经 execute 的 fetchInfo 转 string。
 *    NUMBER 保持 number（超精度损失由用户承担，见文档标注）。
 *  - query() 仅允许 SELECT/WITH；execute() DML/DDL，autoCommit: true 单语句语义。
 *  - Oracle 无 BEGIN，事务用 SET TRANSACTION READ WRITE + commit/rollback（tx 成员）。
 *  - DDL 隐式提交：execute 对 DDL 的 message 附注「DDL 已隐式提交，不可回滚」。
 *  - 标识符默认大写存储：listTables/describeTable 内部统一 toUpperCase 匹配。
 *  - 锁号/密码验证器等常见连接错误转人类可读提示（见 ORA_HINTS）。
 */
// @ts-nocheck

import oracledb from 'oracledb';
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

// CLOB 统一按字符串返回（BLOB 不能走 fetchAsString，须用 execute 的 fetchInfo）
if (!oracledb.fetchAsString.includes(oracledb.CLOB)) {
  oracledb.fetchAsString = [...oracledb.fetchAsString, oracledb.CLOB];
}

/** BLOB → string（execute 级选项） */
const BLOB_FETCH: oracledb.ExecuteOptions = {
  fetchInfo: { BLOB: { type: oracledb.STRING } },
};

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

const IDENT_RE = /^[A-Za-z][A-Za-z0-9_$#]*$/;

/** 标识符校验 + 大写化（Oracle 默认大写存储；未加引号的标识符即按大写匹配） */
export function sanitizeIdentifier(name: string, label: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`非法 Oracle ${label}「${name}」：仅允许字母开头，随后为字母/数字/_/$/#`);
  }
  return name.toUpperCase();
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
  if (typeof v === 'object' && (v as { constructor?: { name?: string } }).constructor?.name === 'Lob') {
    const s = await (v as unknown as { toString(): Promise<string> }).toString();
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
    return {
      user: decodeURIComponent(u.username),
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
  return {
    user: typeof f.user === 'string' ? f.user : '',
    password: typeof f.password === 'string' ? f.password : '',
    connectString: `${host}:${port}/${service}`,
  };
}

export interface OracleAdapterOptions {
  mode?: AccessMode;
  /** 测试注入：跳过真实连接池创建 */
  pool?: unknown;
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
    const { user, password, connectString } = resolveOracleConn(conn);
    try {
      pool = await oracledb.createPool({
        user,
        password,
        connectString,
        poolMin: 1,
        poolMax: 10,
        poolTimeout: 60,
      });
    } catch (e) {
      throw humanizeOraError(e);
    }
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

  // autoCommit 默认 true：query/元数据 SELECT 结束隐式事务避免 ro 事务悬挂；tx 专用连接显式 autoCommit:false 覆盖
  const execOpts: oracledb.ExecuteOptions = { outFormat: oracledb.OBJECT, maxRows: ROWS_MAX + 1, autoCommit: true, ...BLOB_FETCH };

  /** owner 解析：database 参数或默认当前用户（大写） */
  function ownerOf(database?: string): string {
    const owner = database ?? currentUser;
    return sanitizeIdentifier(owner, 'schema/owner 名');
  }

  /**
   * tx 为可选扩展成员：契约 DatabaseAdapter 尚未声明 tx（types.ts 为共享文件，本阶段不改），
   * 用交叉类型承载，运行时存在于返回对象上；注册/服务层可按需取用。
   */
  type AdapterWithTx = DatabaseAdapter & {
    tx?: <T>(fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult>) => Promise<T>) => Promise<T>;
  };
  const adapter: AdapterWithTx = {
    kind: 'oracle',
    connId: conn.meta.id,

    async testConnect(): Promise<TestConnectResult> {
      try {
        const r = await pool.execute('SELECT banner FROM v$version WHERE ROWNUM = 1', [], execOpts);
        const row = (r.rows as Record<string, unknown>[] | undefined)?.[0];
        const banner = row ? String(Object.values(row)[0] ?? '') : '';
        return { ok: true, serverInfo: banner };
      } catch (e) {
        return { ok: false, error: humanizeOraError(e).message };
      }
    },

    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const head = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (head !== 'SELECT' && head !== 'WITH') {
        throw new Error('Oracle query 仅允许 SELECT/WITH 语句；写操作或 DDL 请走 execute');
      }
      try {
        const r = await pool.execute(sql, params ?? [], execOpts);
        const allRows = (r.rows as Record<string, unknown>[] | undefined) ?? [];
        const truncated = allRows.length > ROWS_MAX;
        const rows = allRows.slice(0, ROWS_MAX);
        const columns = (r.metaData ?? []).map((m) => m.name);
        const normRows: NormalizedCell[][] = [];
        for (const row of rows) {
          normRows.push(await Promise.all(Object.values(row).map(normalizeCell)));
        }
        return { columns, rows: normRows, rowCount: normRows.length, truncated: truncated || undefined };
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    async execute(statement: string, params?: unknown[]): Promise<ExecResult> {
      requireRw('execute');
      try {
        const r = await pool.execute(statement, params ?? [], execOpts);
        return await toExecResult(statement, r);
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    /**
     * 事务：从池取专用连接执行多条语句，成功 commit、异常 rollback。
     * Oracle 无 BEGIN，用 SET TRANSACTION READ WRITE 开始显式事务。
     */
    async tx<T>(fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult>) => Promise<T>): Promise<T> {
      requireRw('事务(tx)');
      const c = await pool.getConnection();
      try {
        await c.execute('SET TRANSACTION READ WRITE');
        const exec = async (sql: string, binds?: unknown[]): Promise<ExecResult> => {
          const r = await c.execute(sql, binds ?? [], { ...execOpts, autoCommit: false });
          return toExecResult(sql, r);
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
      // 单连接池固定服务名，仅当前服务可寻址
      const { connectString } = resolveOracleConn(conn);
      const service = connectString.split('/')[1] ?? 'ORCL';
      return [service];
    },

    async listTables(database?: string): Promise<TableInfo[]> {
      const owner = ownerOf(database);
      try {
        const r = await pool.execute(
          'SELECT table_name FROM all_tables WHERE owner = :owner ORDER BY table_name FETCH FIRST 500 ROWS ONLY',
          [owner],
          execOpts,
        );
        const rows = (r.rows as Record<string, unknown>[] | undefined) ?? [];
        return rows.map((row) => ({ name: String(row.TABLE_NAME ?? ''), type: 'TABLE' }));
      } catch (e) {
        throw humanizeOraError(e);
      }
    },

    async describeTable(table: string, database?: string): Promise<ColumnInfo[]> {
      const owner = ownerOf(database);
      const tab = sanitizeIdentifier(table, '表名');
      try {
        const colsR = await pool.execute(
          `SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default
           FROM all_tab_columns WHERE owner = :owner AND table_name = :tab ORDER BY column_id`,
          [owner, tab],
          execOpts,
        );
        const pkR = await pool.execute(
          `SELECT cols.column_name
           FROM all_constraints cons
           JOIN all_cons_columns cols
             ON cons.owner = cols.owner AND cons.constraint_name = cols.constraint_name
           WHERE cons.constraint_type = 'P' AND cons.owner = :owner AND cons.table_name = :tab`,
          [owner, tab],
          execOpts,
        );
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
      const tab = sanitizeIdentifier(table, '表名');
      const n = Math.max(1, Math.min(Math.floor(limit) || 20, ROWS_MAX));
      const off = Math.max(0, Math.floor(offset ?? 0) || 0);
      try {
        const r = await pool.execute(
          `SELECT * FROM "${owner}"."${tab}" OFFSET :o ROWS FETCH NEXT :n ROWS ONLY`,
          [off, n],
          execOpts,
        );
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

  const currentUser = resolveOracleConn(conn).user.toUpperCase();

  return adapter;
}

export const factory: AdapterFactory = async (conn) => createOracleAdapter(conn);
