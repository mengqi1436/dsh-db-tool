/**
 * MySQL 适配器（mysql2/promise）。
 * query=读用 pool.query()；execute=写用 pool.execute()（真 prepare，占位符 ?）。
 * DECIMAL 官方默认 string 保持；dateStrings:true 使 DATE/DATETIME 直接输出字符串。
 * ro 模式：multipleStatements 固定 false（防堆叠注入）；建连后会话级只读（SET SESSION
 * TRANSACTION READ ONLY）+ query 首词只读白名单双保险；服务层拦截 execute。
 */
import mysql, {
  type FieldPacket,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import type {
  AccessMode,
  AdapterFactory,
  ColumnInfo,
  DatabaseAdapter,
  ExecResult,
  QueryResult,
  ResolvedConnection,
  TableInfo,
} from '../types.js';
import { assertIdent, clampLimit, clampOffset, humanize, normalizeCell, quoteIdent } from '../sql-shared/common.js';
import type { TxHandle } from '../sql-shared/pg-like.js';

/** ro 模式下 query 允许的读语句首词白名单 */
const RO_READ_PREFIX = /^(select|show|desc|describe|explain|use|help|table)\b/i;

// 【历史教训，勿回退】'connection' 钩子里 SET 的失败处理只能走回调参数吞掉，
// 不得给返回的 Query 命令挂 error 监听防 uncaughtException——
// 该监听会打断池接管前的命令处理序列并使连接永久卡死（1.7.4 真机复现，见 ro 钩子处注释）。

function connOptions(conn: ResolvedConnection): mysql.PoolOptions {
  const base: mysql.PoolOptions = {
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    multipleStatements: false,
    dateStrings: true,
    connectTimeout: 10000,
    charset: 'utf8mb4_general_ci',
  };
  if (conn.url) {
    const u = new URL(conn.url);
    base.host = u.hostname;
    base.port = Number(u.port) || 3306;
    try {
      if (u.username) base.user = decodeURIComponent(u.username);
      if (u.password) base.password = decodeURIComponent(u.password);
    } catch {
      throw new Error('mysql 连接 URL 的用户名或密码 percent 编码非法（如含未编码的 %），请 URL 编码后重试');
    }
    const db = u.pathname.replace(/^\//, '');
    if (db) base.database = db;
    const ssl = u.searchParams.get('ssl');
    if (conn.ssl || ssl === 'true' || ssl === 'require') base.ssl = { rejectUnauthorized: false };
  } else if (conn.fields) {
    const f = conn.fields;
    base.host = String(f.host ?? '127.0.0.1');
    base.port = Number(f.port ?? 3306);
    base.user = String(f.user ?? f.username ?? 'root');
    if (f.password != null) base.password = String(f.password);
    if (f.database != null) base.database = String(f.database);
    if (conn.ssl) base.ssl = { rejectUnauthorized: false };
  } else {
    throw new Error('mysql 连接缺少 url 或 fields 配置');
  }
  return base;
}

export async function createMysqlAdapter(
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  const pool = mysql.createPool(connOptions(conn));
  const readOnly = opts?.mode === 'ro';
  if (readOnly) {
    // 服务器级 ro 强制：每个新底层连接自动设为只读会话（应用层另有 query 白名单双保险）。
    // mysql2 promise 池 'connection' 回调拿到的是 callback 版连接；SET 必须回调式执行，
    // 且绝不能对返回的 Query 命令对象挂 error 监听——swallowSetError 的 .on('error') 会
    // 打断池接管前的命令处理序列，连接状态机卡死，该连接后续一切查询永挂
    // （真机复现：ro 模式列库/列表/预览全部永久 pending，即「表显示不出来」直接根因；
    // 非回调式与「回调式+error 监听」两种形态均挂，唯「回调式+空回调」正常）。
    pool.on('connection', (c) => {
      (c.query as unknown as (sql: string, cb: (err: unknown) => void) => void)(
        'SET SESSION TRANSACTION READ ONLY',
        () => {},
      );
    });
  }

  /** 事务激活期间路由到同一连接，保证 BEGIN/COMMIT 生效 */
  let txConn: PoolConnection | null = null;
  // PoolConnection 与 Pool 的联合会让 mysql2 的 query/execute 重载解析失败，收窄为 Pool 视图
  const runner = (): Pool => (txConn ?? pool) as unknown as Pool;

  function toQueryResult(rows: RowDataPacket[], fields: FieldPacket[]): QueryResult {
    const columns = fields.map((f) => String(f.name));
    return {
      columns,
      rows: rows.map((r) => columns.map((c) => normalizeCell(r[c]))),
      rowCount: rows.length,
    };
  }

  const tx: TxHandle = {
    begin: () =>
      humanize('mysql 事务开启', async () => {
        if (txConn) throw new Error('事务已开启，请勿重复 begin');
        txConn = await pool.getConnection();
        try {
          await txConn.beginTransaction();
        } catch (e) {
          txConn.release();
          txConn = null;
          throw e;
        }
      }),
    commit: () =>
      humanize('mysql 事务提交', async () => {
        const c = txConn;
        if (!c) throw new Error('没有进行中的事务');
        txConn = null;
        try {
          await c.commit();
        } finally {
          c.release();
        }
      }),
    rollback: () =>
      humanize('mysql 事务回滚', async () => {
        const c = txConn;
        if (!c) throw new Error('没有进行中的事务');
        txConn = null;
        try {
          await c.rollback();
        } finally {
          c.release();
        }
      }),
  };

  const defaultDb = (): string => {
    let db = conn.fields?.database != null ? String(conn.fields.database) : '';
    if (!db && conn.url) {
      // URL 配置：默认库取 pathname 首段（与 connOptions 的解析一致）
      const p = new URL(conn.url).pathname.slice(1);
      if (p) db = p;
    }
    if (!db) throw new Error('未指定数据库：请传入 database 参数或配置默认库');
    // fields/URL 提供的库名统一过标识符校验（防注入）
    return assertIdent(db, '库名');
  };

  return {
    kind: 'mysql',
    connId: conn.meta.id,
    tx,

    testConnect: () =>
      humanize('mysql 连接测试', async () => {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT VERSION() AS v');
        return { ok: true, serverInfo: `MySQL ${String(rows[0]?.v ?? '')}` };
      }),

    query: (sql, params) =>
      humanize('mysql 查询失败', async () => {
        if (readOnly && !RO_READ_PREFIX.test(sql.trimStart())) {
          throw new Error(
            'DRIVER_ERROR: 只读(ro)模式下 query 仅允许读语句（select/show/desc/describe/explain/use/help/table），写操作请使用可写连接',
          );
        }
        const [rows, fields] = await runner().query(sql, params ?? []);
        if (!Array.isArray(rows)) return { columns: [], rows: [], rowCount: 0 };
        return toQueryResult(rows as RowDataPacket[], fields);
      }),

    execute: (statement, params) =>
      humanize('mysql 执行失败', async (): Promise<ExecResult> => {
        // mysql2 的 ExecuteValues 不接受 unknown[]，此处值均为绑定参数（string|number|null）
        const [result] = await runner().execute(statement, (params ?? []) as never[]);
        const header = (Array.isArray(result) ? result[0] : result) as
          | ResultSetHeader
          | undefined;
        const n = header?.affectedRows;
        return {
          affectedRows: typeof n === 'number' ? n : undefined,
          message:
            typeof n === 'number'
              ? `执行成功，受影响 ${n} 行`
              : '执行成功',
        };
      }),

    listDatabases: () =>
      humanize('mysql 列出数据库', async () => {
        const [rows] = await pool.query<RowDataPacket[]>(
          'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME',
        );
        return rows.map((r) => String(r.SCHEMA_NAME));
      }),

    listTables: (database) =>
      humanize('mysql 列出表', async () => {
        const db = database ? assertIdent(database, '库名') : defaultDb();
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
          [db],
        );
        return rows.map((r): TableInfo => {
          const rawType = String(r.TABLE_TYPE);
          const comment = r.TABLE_COMMENT;
          return {
            name: String(r.TABLE_NAME),
            type: rawType === 'BASE TABLE' ? 'TABLE' : rawType,
            comment: comment != null && comment !== '' ? String(comment) : undefined,
            database: db,
          };
        });
      }),

    describeTable: (table, database) =>
      humanize('mysql 查看表结构', async () => {
        const db = database ? assertIdent(database, '库名') : defaultDb();
        const tbl = assertIdent(table, '表名');
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
          [db, tbl],
        );
        if (rows.length === 0) throw new Error(`表不存在: ${db}.${tbl}`);
        return rows.map((r): ColumnInfo => {
          const dflt = r.COLUMN_DEFAULT;
          const comment = r.COLUMN_COMMENT;
          return {
            name: String(r.COLUMN_NAME),
            dataType: String(r.COLUMN_TYPE),
            nullable: r.IS_NULLABLE === 'YES',
            key: r.COLUMN_KEY ? String(r.COLUMN_KEY) : undefined,
            default: dflt == null ? null : String(dflt),
            comment: comment != null && comment !== '' ? String(comment) : undefined,
          };
        });
      }),

    previewRows: (table, limit, database, offset) =>
      humanize('mysql 预览行', async () => {
        const db = quoteIdent(database ? assertIdent(database, '库名') : defaultDb(), '`');
        const tbl = quoteIdent(assertIdent(table, '表名'), '`');
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const [rows, fields] = await pool.query(
          `SELECT * FROM ${db}.${tbl} LIMIT ? OFFSET ?`,
          [lim, off],
        );
        if (!Array.isArray(rows)) return { columns: [], rows: [], rowCount: 0 };
        return toQueryResult(rows as RowDataPacket[], fields);
      }),

    close: () => humanize('mysql 关闭连接', () => pool.end()),
  };
}

export const factory: AdapterFactory = (conn) => createMysqlAdapter(conn);

/**
 * 数据传输读端用的独立原始池（绕过 normalizeCell 保真搬运）。
 * dateStrings:true 保日期墙钟字符串；会话时区固定 UTC——TIMESTAMP 列（UTC 存储、
 * 按会话 time_zone 渲染）读出即 UTC 墙钟，作为 timestamptz 语义不随源服务器
 * time_zone 漂移（跨库传输会话时区抖动是静默偏移源，官方建议显式固定）。
 */
export interface MysqlRaw {
  pool: mysql.Pool;
  /** 连接解析出的默认库（mysql2 promise 池没有 .config，不能从池上反查） */
  database: string;
}

export async function openMysqlRaw(conn: ResolvedConnection): Promise<MysqlRaw> {
  const opts = connOptions(conn);
  const pool = mysql.createPool({ ...opts, dateStrings: true });
  // 回调式 query（带 err 回调吞错）。两点缺一不可（1.7.4 真机复现）：
  // 1) 必须回调式——非回调式命令无 onResult，与 promise 池连接建立序列冲突；
  // 2) 绝不能对返回的 Query 命令挂 error 监听——会打断池接管前的命令处理，
  //    连接状态机卡死 → 该连接所有后续 query 永挂（mysql2 3.24.4）
  pool.on('connection', (c) => {
    // 运行时 c 是 callback 版连接（promise 池类型标注不反映），按回调式调用
    (c.query as unknown as (sql: string, cb: (err: unknown) => void) => void)(
      "SET time_zone = '+00:00'",
      () => {},
    );
  });
  return { pool, database: typeof opts.database === 'string' ? opts.database : '' };
}
