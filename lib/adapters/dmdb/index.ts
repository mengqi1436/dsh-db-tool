/**
 * 达梦 DM 适配器（dmdb 驱动，API 对齐 oracledb）。
 *
 * ⚠️ 推断标注（未真机验证项，由 env 门控真机集成测试覆盖）：
 *  - 数据字典复用 Oracle 兼容视图 ALL_TABLES / ALL_TAB_COLUMNS / ALL_CONSTRAINTS /
 *    ALL_CONS_COLUMNS（官方移植文档佐证的兼容行为）。
 *  - 分页统一 `OFFSET n ROWS FETCH FIRST m ROWS ONLY`（ANSI 风格，不依赖 compatibleMode=oracle）。
 *  - DDL 隐式提交语义按 Oracle 同等处理。
 *  - DM 事务隐式开始，无需 SET TRANSACTION。
 *
 * 驱动要点：
 *  - db.createPool({ connectString: 'dm://user:pass@host:5236', poolMin: 1, poolMax: 10,
 *    poolTimeout: 60, queueTimeout: 60000 })；不启用压缩（默认 compress=0，规避
 *    @napi-rs/snappy 跨平台坑）。
 *  - execute 必须显式 maxRows（默认 0=无限制）与 autoCommit: true（驱动默认非自动提交）。
 *  - 返回 { metaData, rows, rowsAffected } 与 oracledb 兼容。
 */
import db from 'dmdb';
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

const ROWS_MAX = 500;
const CELL_TRUNC = 1000;
const DDL_KEYWORDS = new Set([
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE',
  'COMMENT', 'ANALYZE', 'AUDIT', 'NOAUDIT', 'FLASHBACK', 'PURGE',
]);

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$#]*$/;

/** 标识符校验（DM 默认大写存储，同 Oracle；保留原大小写不强制大写，数据字典匹配时由驱动决定） */
export function sanitizeIdentifier(name: string, label: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`非法 DM ${label}「${name}」：仅允许字母/下划线开头，随后为字母/数字/_/$/#`);
  }
  return name;
}

function trunc(s: string, max = CELL_TRUNC): string {
  return s.length > max ? `${s.slice(0, max)}…[截断,共${s.length}字符]` : s;
}

/** 行值规范化为 NormalizedCell */
async function normalizeCell(v: unknown): Promise<NormalizedCell> {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return trunc(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return trunc(`0x${v.toString('hex')}`);
  return trunc(JSON.stringify(v));
}

export function humanizeDmError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(`达梦 DM 错误：${msg}（提示：请检查连接串/凭据；错误码含义见达梦官方《DM8 错误码手册》）`);
}

/** 连接参数解析：url（dm://user:pass@host:5236 直接可用）或 fields 拼 connectString */
export function resolveDmConn(conn: ResolvedConnection): { connectString: string; user: string; password: string } {
  if (conn.url) {
    if (!conn.url.startsWith('dm://')) {
      throw new Error('DM URL 应以 dm:// 开头，如 dm://user:pass@host:5236');
    }
    const u = new URL(conn.url);
    return {
      connectString: conn.url,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  }
  const f = conn.fields ?? {};
  const host = typeof f.host === 'string' ? f.host : '';
  const port = typeof f.port === 'number' ? f.port : 5236;
  if (host === '') {
    throw new Error('DM 连接需要 url（dm://user:pass@host:5236）或 fields（host/port）');
  }
  const user = typeof f.user === 'string' ? f.user : '';
  const password = typeof f.password === 'string' ? f.password : '';
  return { connectString: `dm://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`, user, password };
}

export interface DmAdapterOptions {
  mode?: AccessMode;
  /** 测试注入：跳过真实连接池创建 */
  pool?: unknown;
}

/** dmdb 池/连接的最小结构（与 oracledb 兼容的返回形状） */
interface DmPoolLike {
  getConnection(): Promise<DmConnLike>;
  execute(sql: string, binds?: unknown[], opts?: Record<string, unknown>): Promise<DmResultLike>;
  close(): Promise<void>;
}
interface DmConnLike {
  execute(sql: string, binds?: unknown[], opts?: Record<string, unknown>): Promise<DmResultLike>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}
interface DmResultLike {
  metaData?: Array<{ name: string }>;
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
}

export async function createDmAdapter(
  conn: ResolvedConnection,
  opts?: DmAdapterOptions,
): Promise<DatabaseAdapter> {
  const mode: AccessMode = opts?.mode ?? 'rw';
  let pool: DmPoolLike;
  if (opts?.pool) {
    pool = opts.pool as DmPoolLike;
  } else {
    const { connectString } = resolveDmConn(conn);
    try {
      pool = (await db.createPool({
        connectString,
        poolMin: 1,
        poolMax: 10,
        poolTimeout: 60,
        queueTimeout: 60000,
      })) as unknown as DmPoolLike;
    } catch (e) {
      throw humanizeDmError(e);
    }
  }

  /** 默认 execute 选项：显式 maxRows + 显式 autoCommit:true（dmdb 默认分别为 0/false，必须覆盖；SELECT 立即结束隐式事务，避免 ro 事务悬挂） */
  const execOpts = { outFormat: db.OUT_FORMAT_OBJECT, maxRows: ROWS_MAX + 1, autoCommit: true };
  /** 事务内 execute：显式关闭自动提交，由 tx 的 commit/rollback 收口 */
  const execOptsTx = { ...execOpts, autoCommit: false };

  /**
   * 从池借一条连接执行后归还。⚠️ dmdb 的 Pool 没有 execute（与 oracledb 一致），
   * 一切语句必须在 Connection 上执行；close() 即归还连接。
   */
  async function withConn<T>(fn: (c: DmConnLike) => Promise<T>): Promise<T> {
    const c = await pool.getConnection();
    try {
      return await fn(c);
    } finally {
      await c.close().catch(() => { /* 归还失败忽略 */ });
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

  async function toExecResult(sql: string, r: DmResultLike): Promise<ExecResult> {
    // ⚠️ 推断：DDL 隐式提交语义按 Oracle 同等处理（未真机验证）
    const ddlNote = isDdl(sql) ? '（DDL 已隐式提交，不可回滚）' : '';
    return {
      affectedRows: typeof r.rowsAffected === 'number' && r.rowsAffected > 0 ? r.rowsAffected : undefined,
      message: `${sql.trim().split(/\s+/)[0]?.toUpperCase() ?? 'SQL'} 完成${r.rowsAffected ? `，影响 ${r.rowsAffected} 行` : ''}${ddlNote}`,
    };
  }

  async function rowsToQueryResult(r: DmResultLike): Promise<QueryResult> {
    const allRows = r.rows ?? [];
    const truncated = allRows.length > ROWS_MAX;
    const columns = (r.metaData ?? []).map((m) => m.name);
    const rows: NormalizedCell[][] = [];
    for (const row of allRows.slice(0, ROWS_MAX)) {
      rows.push(await Promise.all(Object.values(row).map(normalizeCell)));
    }
    return { columns, rows, rowCount: rows.length, truncated: truncated || undefined };
  }

  /** owner 解析：database 参数或默认当前用户（DM 默认大写存储，同 Oracle） */
  function ownerOf(database?: string): string {
    const owner = (database ?? connUser).toUpperCase();
    return sanitizeIdentifier(owner, 'schema/owner 名');
  }

  const connUser = resolveDmConn(conn).user.toUpperCase();

  /**
   * tx 为可选扩展成员：契约 DatabaseAdapter 尚未声明 tx（types.ts 为共享文件，本阶段不改），
   * 用交叉类型承载，运行时存在于返回对象上；注册/服务层可按需取用。
   */
  type AdapterWithTx = DatabaseAdapter & {
    tx?: <T>(fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult>) => Promise<T>) => Promise<T>;
  };
  const adapter: AdapterWithTx = {
    kind: 'dmdb',
    connId: conn.meta.id,

    async testConnect(): Promise<TestConnectResult> {
      try {
        const r = await withConn((c) => c.execute('SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1', [], execOpts));
        const row = r.rows?.[0];
        const banner = row ? String(Object.values(row)[0] ?? '') : '';
        return { ok: true, serverInfo: banner };
      } catch (e) {
        return { ok: false, error: humanizeDmError(e).message };
      }
    },

    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const head = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (head !== 'SELECT' && head !== 'WITH') {
        throw new Error('DM query 仅允许 SELECT/WITH 语句；写操作或 DDL 请走 execute');
      }
      try {
        const r = await withConn((c) => c.execute(sql, params ?? [], execOpts));
        return await rowsToQueryResult(r);
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    async execute(statement: string, params?: unknown[]): Promise<ExecResult> {
      requireRw('execute');
      try {
        // 单语句语义：autoCommit: true（execOpts 默认已开启）
        const r = await withConn((c) => c.execute(statement, params ?? [], execOpts));
        return await toExecResult(statement, r);
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    /** 事务：专用连接多条语句，成功 commit、异常 rollback。DM 事务隐式开始，无需 SET TRANSACTION。 */
    async tx<T>(fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult>) => Promise<T>): Promise<T> {
      requireRw('事务(tx)');
      const c = await pool.getConnection();
      try {
        const exec = async (sql: string, binds?: unknown[]): Promise<ExecResult> => {
          const r = await c.execute(sql, binds ?? [], execOptsTx);
          return toExecResult(sql, r);
        };
        const out = await fn(exec);
        await c.commit();
        return out;
      } catch (e) {
        try {
          await c.rollback();
        } catch { /* 已断开等场景忽略 */ }
        throw humanizeDmError(e);
      } finally {
        try {
          await c.close();
        } catch { /* 归还失败忽略 */ }
      }
    },

    async listDatabases(): Promise<string[]> {
      // 单连接池固定服务地址，仅当前实例可寻址（⚠️ 推断：不做跨库枚举）
      const { connectString } = resolveDmConn(conn);
      const host = connectString.replace(/^dm:\/\/[^@]*@/, '').split(/[/:]/)[0] ?? 'dm';
      return [host];
    },

    async listTables(database?: string): Promise<TableInfo[]> {
      const owner = ownerOf(database);
      try {
        // ⚠️ 推断：DM 兼容 Oracle 数据字典 ALL_TABLES（未真机验证）
        const r = await withConn((c) => c.execute(
          'SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :owner ORDER BY TABLE_NAME OFFSET 0 ROWS FETCH FIRST 500 ROWS ONLY',
          [owner],
          execOpts,
        ));
        const rows = r.rows ?? [];
        return rows.map((row) => ({ name: String(row.TABLE_NAME ?? ''), type: 'TABLE' }));
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    async describeTable(table: string, database?: string): Promise<ColumnInfo[]> {
      const owner = ownerOf(database);
      const tab = sanitizeIdentifier(table, '表名').toUpperCase();
      try {
        // ⚠️ 推断：ALL_TAB_COLUMNS / ALL_CONSTRAINTS / ALL_CONS_COLUMNS 兼容（未真机验证）；同连接内两查保证一致性
        const { colsR, pkR } = await withConn(async (c) => ({
          colsR: await c.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
            FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tab ORDER BY COLUMN_ID`,
            [owner, tab],
            execOpts,
          ),
          pkR: await c.execute(
            `SELECT COLS.COLUMN_NAME
            FROM ALL_CONSTRAINTS CONS
            JOIN ALL_CONS_COLUMNS COLS
              ON CONS.OWNER = COLS.OWNER AND CONS.CONSTRAINT_NAME = COLS.CONSTRAINT_NAME
            WHERE CONS.CONSTRAINT_TYPE = 'P' AND CONS.OWNER = :owner AND CONS.TABLE_NAME = :tab`,
            [owner, tab],
            execOpts,
          ),
        }));
        const pkSet = new Set((pkR.rows ?? []).map((r2) => String(r2.COLUMN_NAME ?? '')));
        return (colsR.rows ?? []).map((row) => {
          const dataType = String(row.DATA_TYPE ?? '');
          const precision = row.DATA_PRECISION;
          const scale = row.DATA_SCALE;
          const length = row.DATA_LENGTH;
          let typeStr = dataType;
          if (precision !== null && precision !== undefined) {
            typeStr = scale !== null && scale !== undefined && Number(scale) > 0
              ? `${dataType}(${Number(precision)},${Number(scale)})`
              : `${dataType}(${Number(precision)})`;
          } else if (/^(VARCHAR|NVARCHAR|CHAR|NCHAR|RAW|BIT)/.test(dataType) && length !== null && length !== undefined) {
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
        throw humanizeDmError(e);
      }
    },

    async previewRows(table: string, limit: number, database?: string, offset?: number): Promise<QueryResult> {
      const owner = ownerOf(database);
      const tab = sanitizeIdentifier(table, '表名').toUpperCase();
      const n = Math.max(1, Math.min(Math.floor(limit) || 20, ROWS_MAX));
      const off = Math.max(0, Math.floor(offset ?? 0) || 0);
      try {
        // 统一 ANSI 分页（不依赖 compatibleMode=oracle），OFFSET/FETCH 均走 bind ⚠️ 推断（未真机验证）
        const r = await withConn((c) => c.execute(
          `SELECT * FROM "${owner}"."${tab}" OFFSET :o ROWS FETCH FIRST :n ROWS ONLY`,
          [off, n],
          execOpts,
        ));
        return await rowsToQueryResult(r);
      } catch (e) {
        throw humanizeDmError(e);
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

export const factory: AdapterFactory = async (conn) => createDmAdapter(conn);
