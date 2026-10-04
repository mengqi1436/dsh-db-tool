/**
 * 数据传输统一中间模型。
 *
 * 7 库互传（除 Redis 外任意源 → 任意目标）的核心：每库实现一对 TransferReader /
 * TransferWriter（读端 = 元数据 + 数据导出；写端 = 建表 + 批量写入），全部经
 * 中间模型转换，用 7 组读写端支撑 7×7 任意方向，而不是点对点管道。
 *
 * 与浏览路径的区别：浏览单元格走 normalizeCell 规范化（BLOB 截断 / bigint 降位），
 * 传输必须保真，所以读写端持原始驱动句柄，TransferCell 覆盖 bigint / Uint8Array。
 */
import type { DbKind, ResolvedConnection } from '../types.js';

/** 中间类型：类型映射矩阵的枢纽（源 midType → 目标列类型） */
export type MidType =
  | 'int'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'double'
  | 'boolean'
  | 'string'
  | 'text'
  | 'bytes'
  | 'json'
  | 'date'
  | 'time'
  | 'datetime'
  | 'timestamptz';

/** 可作为 keyset 分片键的中间类型：整数 / 精确小数 / 字符串 / 时间。
 *  float/double 不在内——浮点边界无法保证分片不重不漏。 */
export type ShardKeyType = 'int' | 'bigint' | 'decimal' | 'string' | 'datetime' | 'timestamptz';

/** 传输单元格：保真标量。json 列的值以 JSON 字符串形态流转（mongo 读写端负责
 *  parse/strinify 与文档互转），object/array 不进中间模型。 */
export type TransferCell = string | number | bigint | boolean | null | Uint8Array;
export type TransferRow = TransferCell[];

export interface TransferColumn {
  name: string;
  midType: MidType;
  /** 源库原始类型名（仅展示与诊断，不参与映射） */
  sourceType?: string;
  nullable: boolean;
  primaryKey: boolean;
  /** 自增列（目标端 afterLoad 重置序列起点用） */
  autoIncrement?: boolean;
  /** string 的长度上限 / decimal 的精度 */
  length?: number;
  precision?: number;
  scale?: number;
  /** 源库 DEFAULT 表达式；仅可安全透传的字面量被写端采用，其余忽略 */
  default?: string | null;
  comment?: string;
}

export interface TransferTable {
  name: string;
  columns: TransferColumn[];
  comment?: string;
}

/** 游标形态：keyset 链式批读（顺序模式）/ offset 全序（无分片键降级）/
 *  range 区间（分片并行：hi 端恒开区间；loInclusive=true 为 k>=lo（分片首批），
 *  false 为 k>lo（批间链式），lo 为 null 表示区间左端开放） */
export type TransferCursor =
  | { mode: 'keyset'; column: string; after: TransferCell | null }
  | { mode: 'offset'; offset: number }
  | { mode: 'range'; column: string; lo: TransferCell | null; loInclusive: boolean; hi: TransferCell | null };

/** 写入冲突策略（Navicat 插入模式）：报错 / 跳过重复 / 覆盖 / 清空后写入（truncate，危险） */
export type WriteMode = 'insert' | 'ignore' | 'replace' | 'truncate';

export interface TransferReader {
  readonly kind: DbKind;
  /** 参与传输的表清单（不含视图） */
  listTables(): Promise<string[]>;
  /** 结构 → 中间模型 */
  describe(table: string): Promise<TransferTable>;
  count(table: string): Promise<number>;
  /** 可用的 keyset 分片键：单列主键且类型可范围比较；无 / 复合 / 浮点返回 null
   *  （无分片键的表单 worker 顺序读；sqlite 无主键表不用 rowid——rowid 不在目标列、
   *  WITHOUT ROWID 表无此伪列，分片重试的 deleteRange 会错删，评审已证伪该路径） */
  shardKey(table: string): Promise<ShardKeyType | null>;
  /** 游标批读。列序与 describe 一致；返回行数 < limit 即读完 */
  readBatch(table: string, cursor: TransferCursor, limit: number): Promise<TransferRow[]>;
  /** ORDER BY column 起第 offset 行的键值（越界返回 null）——分片切块探测用；
   *  未实现则该源不支持分片并行（编排层回退 keyset 链）。 */
  keyAt?(table: string, column: string, offset: number): Promise<TransferCell | null>;
  close(): Promise<void>;
}

export interface TransferWriter {
  readonly kind: DbKind;
  /** 目标表是否已存在（编排层据此分派：建表 / 按写入模式处理） */
  tableExists(name: string): Promise<boolean>;
  /** 删除目标表（覆盖表结构选项用） */
  dropTable(name: string): Promise<void>;
  /** 按中间模型建表（已存在时抛错，由编排层决定覆盖策略） */
  createTable(table: TransferTable): Promise<void>;
  /** 批量写入（写入端事务粒度由实现决定：单批单事务，失败整批回滚）。返回实际写入行数 */
  writeBatch(table: TransferTable, rows: TransferRow[]): Promise<number>;
  /** 清空后写入（truncate 模式）：传输开始前清空目标表已有数据。各库用官方推荐形态
   *  （SQL 系 TRUNCATE，SQLite 无此语句用 DELETE，mongo deleteMany({})）；无需处理时省略 */
  beforeLoad?(table: TransferTable): Promise<void>;
  /** 传输完成钩子（自增列重置起点等）；无需处理时省略 */
  afterLoad?(table: TransferTable): Promise<void>;
  close(): Promise<void>;
}

/** 源库 DEFAULT 表达式白名单：纯数字/单引号字符串/NULL/CURRENT_TIMESTAMP 才内联进
 *  目标 DDL（default 文本来自源库系统表，白名单防意外表达式注入），其余丢弃。 */
export function safeDefaultExpr(raw: string): string | null {
  const s = raw.trim();
  if (/^NULL$/i.test(s) || /^CURRENT_TIMESTAMP$/i.test(s)) return s.toUpperCase();
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (/^'([^']|'')*'$/.test(s)) return s;
  return null;
}

/** 传输读写端库/模式定位（命名与语义沿用 BrowsePane：database = 对象树第一层节点名
 *  ——mysql/pg 系=库名、oracle/dmdb=owner、mongo=库名；schema = 第二层仅 pg 系有值。
 *  全缺省 = 连接默认上下文，行为与不传完全一致） */
export interface TransferLocator {
  database?: string;
  schema?: string;
}

/** 分发：按 kind 创建读写端。mongo 在 kinds/mongo.ts；未注册的 kind 给出明确错误 */
export async function createTransferReader(rc: ResolvedConnection, loc?: TransferLocator): Promise<TransferReader> {
  const kind = rc.meta.kind;
  if (kind === 'sqlite') {
    const { createSqliteTransferReaderFromConn } = await import('./kinds/sqlite.js');
    return createSqliteTransferReaderFromConn(rc); // sqlite 无层级，loc 忽略
  }
  if (kind === 'mysql') {
    const { createMysqlTransferReaderFromConn } = await import('./kinds/mysql.js');
    return createMysqlTransferReaderFromConn(rc, loc);
  }
  if (kind === 'postgresql' || kind === 'gaussdb') {
    const { createPgTransferReaderFromConn } = await import('./kinds/pg.js');
    const driver = kind === 'postgresql'
      ? (await import('../postgresql/index.js')).getPgDriver()
      : (await import('../gaussdb/index.js')).loadGaussDriver();
    return createPgTransferReaderFromConn(kind, driver, rc, loc);
  }
  if (kind === 'oracle' || kind === 'dmdb') {
    const oralike = await import('./kinds/oralike.js');
    // oracledb.Pool / DmPoolLike 与 OraLikePool 结构兼容（驱动最小面），按契约收窄——
    // 与 dmdb 适配器内部 as unknown as DmPoolLike 同款桥接
    const pool = kind === 'oracle'
      ? ((await (await import('../oracle/index.js')).openOraclePool(rc)) as unknown as import('./kinds/oralike.js').OraLikePool)
      : ((await (await import('../dmdb/index.js')).openDmPool(rc)) as unknown as import('./kinds/oralike.js').OraLikePool);
    // owner = 定位第一层（oracle/dm 单库多 schema 模型），缺省连接用户
    return oralike.createOraLikeTransferReader(kind, pool, loc?.database ?? oralike.ownerOfFromConn(rc));
  }
  if (kind === 'mongodb') {
    const { createMongoTransferReaderFromConn } = await import('./kinds/mongo.js');
    return createMongoTransferReaderFromConn(rc, loc);
  }
  throw new Error(`数据传输暂不支持读取 ${kind}（待后续版本支持）`);
}

export async function createTransferWriter(
  rc: ResolvedConnection,
  writeMode: WriteMode = 'insert',
  loc?: TransferLocator,
): Promise<TransferWriter> {
  const kind = rc.meta.kind;
  if (kind === 'sqlite') {
    const { createSqliteTransferWriterFromConn } = await import('./kinds/sqlite.js');
    return createSqliteTransferWriterFromConn(rc, writeMode); // sqlite 无层级，loc 忽略
  }
  if (kind === 'mysql') {
    const { createMysqlTransferWriterFromConn } = await import('./kinds/mysql.js');
    return createMysqlTransferWriterFromConn(rc, writeMode, loc);
  }
  if (kind === 'postgresql' || kind === 'gaussdb') {
    const { createPgTransferWriterFromConn } = await import('./kinds/pg.js');
    const driver = kind === 'postgresql'
      ? (await import('../postgresql/index.js')).getPgDriver()
      : (await import('../gaussdb/index.js')).loadGaussDriver();
    return createPgTransferWriterFromConn(kind, driver, rc, writeMode, loc);
  }
  if (kind === 'oracle' || kind === 'dmdb') {
    const oralike = await import('./kinds/oralike.js');
    const pool = kind === 'oracle'
      ? ((await (await import('../oracle/index.js')).openOraclePool(rc)) as unknown as import('./kinds/oralike.js').OraLikePool)
      : ((await (await import('../dmdb/index.js')).openDmPool(rc)) as unknown as import('./kinds/oralike.js').OraLikePool);
    // 写入 owner = 定位第一层，缺省连接用户默认 schema（写端以 owner 前缀显式限定）
    return oralike.createOraLikeTransferWriter(kind, pool, writeMode, loc?.database ?? oralike.ownerOfFromConn(rc));
  }
  if (kind === 'mongodb') {
    const { createMongoTransferWriterFromConn } = await import('./kinds/mongo.js');
    return createMongoTransferWriterFromConn(rc, writeMode, loc);
  }
  throw new Error(`数据传输暂不支持写入 ${kind}（待后续版本支持）`);
}
