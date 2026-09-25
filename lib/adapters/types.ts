/**
 * dsh-db-tool 适配层统一契约
 *
 * 8 种数据库适配器都必须实现 DatabaseAdapter。
 * 语义约定：
 *  - query()   : 只读操作（SELECT / SCAN / find 等）。ro 连接只允许 query。
 *  - execute() : 写操作或管理命令（DML/DDL / 写命令 / drop 等）。ro 连接在服务层直接拒绝。
 *  - 所有返回值中的单元格统一规范化为 NormalizedCell（string | number | null），
 *    DECIMAL/NUMERIC 保持 string（防精度丢失，官方默认行为），日期输出 ISO 字符串，
 *    Lob/CLOB/BLOB 转字符串（截断标注），Mongo ObjectId/Decimal128/Long 统一 toString()。
 */
export type DbKind =
  | 'mysql'
  | 'postgresql'
  | 'gaussdb'
  | 'sqlite'
  | 'redis'
  | 'mongodb'
  | 'oracle'
  | 'dmdb';

export const DB_KINDS: readonly DbKind[] = [
  'mysql', 'postgresql', 'gaussdb', 'sqlite', 'redis', 'mongodb', 'oracle', 'dmdb',
];

/** 连接级权限模式 */
export type AccessMode = 'ro' | 'rw';

/** cells 规范化类型 */
export type NormalizedCell = string | number | null;

export interface QueryResult {
  /** 结果列名（Redis 为 ['key','value'] 之类的合成列；Mongo 为投影字段） */
  columns: string[];
  rows: NormalizedCell[][];
  /** 服务端返回的行数（Redis SCAN 为本批键数） */
  rowCount: number;
  /** 结果因上限被截断时为 true */
  truncated?: boolean;
}

export interface ExecResult {
  /** 受影响行数（无法得知时省略） */
  affectedRows?: number;
  /** 人类可读结果说明（zh，由适配器生成） */
  message: string;
}

export interface TableInfo {
  name: string;
  /** TABLE / VIEW / COLLECTION / hash|list|set|zset|string|stream（Redis 为键类型） */
  type?: string;
  comment?: string;
  /** 所属 database/schema（未指定连接默认库时省略） */
  database?: string;
}

export interface ColumnInfo {
  name: string;
  /** 官方类型名（如 varchar(255)、NUMBER、ObjectId） */
  dataType: string;
  nullable: boolean;
  /** 'PRI' | 'UNI' | ... （主键必须标 'PRI'） */
  key?: string;
  default?: string | null;
  comment?: string;
}

/** 用户可见的连接配置（secrets 之外的部分，可安全展示/返回给模型） */
export interface ConnectionMeta {
  id: string;
  kind: DbKind;
  /** 显示别名 */
  name?: string;
  /** 脱敏后的 URL（密码替换为 ***） */
  safeUrl?: string;
  host?: string;
  port?: number;
  database?: string;
}

/** 密码等 secrets 注入后交给适配器工厂的完整配置（绝不返回给模型/HTTP） */
export interface ResolvedConnection {
  meta: ConnectionMeta;
  /** 完整连接 URL（含密码），与 fields 二选一 */
  url?: string;
  /** 分字段配置（host/port/user/password/database/...） */
  fields?: Record<string, unknown>;
  ssl?: boolean;
}

export interface TestConnectResult {
  ok: boolean;
  /** 服务器版本等标识信息（可展示） */
  serverInfo?: string;
  error?: string;
}

export interface DatabaseAdapter {
  readonly kind: DbKind;
  readonly connId: string;

  testConnect(): Promise<TestConnectResult>;

  /** 只读查询。MySQL `?` / PG `$1` / Oracle·DM `:name` 占位符；
   *  Redis 传命令数组（JSON 字符串，如 '["GET","key"]' 或 "GET key"）；
   *  Mongo 传 BSON 文档（JSON 字符串，如 '{"find":"users","filter":{}}'）。 */
  query(sql: string, params?: unknown[]): Promise<QueryResult>;

  /** 写操作 / 管理命令，入参约定同 query() */
  execute(statement: string, params?: unknown[]): Promise<ExecResult>;

  /** 库/schema 清单（SQLite 返回 ['main']；Redis 返回 ['db0']） */
  listDatabases(): Promise<string[]>;

  /** 表/集合/键清单。database 省略时用连接默认库 */
  listTables(database?: string): Promise<TableInfo[]>;

  /** 表结构 / 集合字段推断（Mongo 用抽样推断并标注） / Redis 键类型+编码+长度 */
  describeTable(table: string, database?: string): Promise<ColumnInfo[]>;

  /** 预览行（SQL: LIMIT/OFFSET 或 FETCH FIRST；上限 50 由服务层强制） */
  previewRows(table: string, limit: number, database?: string): Promise<QueryResult>;

  close(): Promise<void>;

  /**
   * 可选事务句柄（SQL 系适配器提供）。运行时两种形态：
   *  - pg-like/mysql：{ begin, commit, rollback } 对象；
   *  - oracle/dmdb：函数式 tx(fn)，fn(exec) 内语句走事务连接（exec 返回 ExecResult）。
   */
  tx?:
    | {
        begin(): Promise<void>;
        commit(): Promise<void>;
        rollback(): Promise<void>;
      }
    | (<T>(fn: (exec: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<T>) => Promise<T>);
}

/** 每种 DbKind 的适配器工厂。实现方在各自模块注册。 */
export type AdapterFactory = (conn: ResolvedConnection) => Promise<DatabaseAdapter>;

/** 适配器注册表：adapterRegistry[kind] = factory */
export type AdapterRegistry = Partial<Record<DbKind, AdapterFactory>>;
