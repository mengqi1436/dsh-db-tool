/**
 * MySQL 传输读写端。
 *
 * 读端走 pool.query()（客户端转义）——keyset 批读的 LIMIT ? 绑定参数依赖服务器在
 * prepare 响应中报告整数类型（MySQL 8.0+ 才支持，5.7/MariaDB 不报告），与浏览
 * previewRows 同一先例。TIMESTAMP 会话时区固定 UTC（openMysqlRaw 内落实）。
 *
 * ponytail: 目标建表不生成自增属性（AUTO_INCREMENT），源端自增列显式插入原值，
 * 规避各家自增语义差异（DM IDENTITY_INSERT、序列重置等）；需要目标端继续自增时，
 * 在 afterLoad 钩子里补序列起点重置。
 */
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { MysqlRaw } from '../../mysql/index.js';
import type { ResolvedConnection } from '../../types.js';
import { assertIdent, quoteIdent } from '../../sql-shared/common.js';
import { openMysqlRaw } from '../../mysql/index.js';
import { safeDefaultExpr } from '../model.js';
import type { ForeignKeyEdge } from '../deps.js';
import type {
  MidType,
  ShardKeyType,
  TransferCell,
  TransferColumn,
  TransferCursor,
  TransferForeignKey,
  TransferIndex,
  TransferLocator,
  TransferReader,
  TransferRow,
  TransferTable,
  TransferWriter,
  WriteMode,
} from '../model.js';

/** 写端目录查询辅助（信息结构schema 只读，客户端转义） */
async function q(raw: MysqlRaw, sql: string, params?: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await raw.pool.query(sql, params ?? []);
  return (Array.isArray(rows) ? rows : []) as RowDataPacket[];
}

/** 写端默认库名（未指定时抛错——写路径必须显式落库） */
function defaultDbOf(raw: MysqlRaw): string {
  if (raw.database === '') throw new Error('mysql 传输写端缺少默认库（连接未指定 database）');
  return assertIdent(raw.database, '库名');
}

/** COLUMN_TYPE → 中间类型（base 取首词去显示宽度；unsigned 不影响宽度决策） */
export function mysqlTypeToMid(columnType: string): MidType {
  const base = columnType.trim().split(/[\s(]/)[0]?.toLowerCase() ?? '';
  if (base === 'bigint') return 'bigint';
  if (base === 'int' || base === 'integer' || base === 'smallint' || base === 'mediumint' || base === 'tinyint' || base === 'year') return 'int';
  if (base === 'decimal' || base === 'numeric' || base === 'dec' || base === 'fixed') return 'decimal';
  if (base === 'float') return 'float';
  if (base === 'double' || base === 'real') return 'double';
  if (base === 'boolean' || base === 'bool') return 'boolean';
  if (base === 'json') return 'json';
  if (base === 'date') return 'date';
  if (base === 'time') return 'time';
  if (base === 'datetime') return 'datetime';
  if (base === 'timestamp') return 'timestamptz';
  if (base === 'bit') return 'bytes';
  if (base === 'char' || base === 'varchar' || base === 'binary' || base === 'varbinary' || base === 'enum' || base === 'set') return 'string';
  if (base.endsWith('text')) return 'text';
  if (base.endsWith('blob')) return 'bytes';
  // tinyint(1) 布尔惯例仅在 EXTRA 标注时翻转
  return 'string';
}

/** 中间类型 → 目标列类型（AUTO_INCREMENT 不在此生成，见文件头） */
export function midToMysqlType(c: TransferColumn): string {
  switch (c.midType) {
    case 'int': return 'INT';
    case 'bigint': return 'BIGINT';
    case 'decimal': return `DECIMAL(${c.precision ?? 38},${c.scale ?? 10})`;
    case 'float': return 'FLOAT';
    case 'double': return 'DOUBLE';
    case 'boolean': return 'TINYINT(1)';
    case 'string': return `VARCHAR(${Math.min(Math.max(c.length ?? 255, 1), 16383)})`;
    case 'text': return 'TEXT';
    case 'bytes': return 'BLOB';
    case 'json': return 'JSON';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'datetime': return 'DATETIME';
    case 'timestamptz': return 'TIMESTAMP';
  }
}

/** 中间格式日期值 → MySQL 可解析形态：读端（pg/oralike/mongo）materialize 产出
 *  ISO 带 'Z' 后缀与毫秒，而 MySQL 日期字面量不接受 'Z'（strict 整批 1292 报错、
 *  非 strict 静默存零值）——剥离为 UTC 墙钟（写端会话时区已固定 +00:00，语义不变） */
export function toMysqlDateTime(s: string): string {
  return s.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/i, '$1 $2');
}

/** 绑定值形态：bigint→字符串（mysql2 不接受 bigint 绑定）、boolean→0/1（TINYINT(1)）、
 *  日期列的 ISO 'Z' 串 → UTC 墙钟（col 缺省时不做日期归一） */
export function toMysqlBind(c: TransferCell, col?: TransferColumn): string | number | null | Buffer {
  if (c === null) return null;
  if (typeof c === 'bigint') return c.toString();
  if (typeof c === 'boolean') return c ? 1 : 0;
  if (c instanceof Uint8Array) return Buffer.from(c);
  if (
    typeof c === 'string' && col != null &&
    (col.midType === 'date' || col.midType === 'time' || col.midType === 'datetime' || col.midType === 'timestamptz')
  ) {
    return toMysqlDateTime(c);
  }
  return c;
}

export function createMysqlTransferReader(raw: MysqlRaw): TransferReader {
  const pool = raw.pool;
  const defaultDb = (): string => {
    if (raw.database === '') throw new Error('mysql 传输读端缺少默认库（连接未指定 database）');
    return assertIdent(raw.database, '库名');
  };

  const q = async (sql: string, params?: unknown[]): Promise<RowDataPacket[]> => {
    // 一律 pool.query（客户端转义）：读语句兼容 LIMIT ? 绑定不可用的 5.7/MariaDB
    const [rows] = await pool.query(sql, params ?? []);
    return (Array.isArray(rows) ? rows : []) as RowDataPacket[];
  };

  const describe = async (table: string): Promise<TransferTable> => {
    const db = defaultDb();
    const tbl = assertIdent(table, '表名');
    const rows = await q(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT, COLUMN_TYPE AS CT,
              NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [db, tbl],
    );
    if (rows.length === 0) throw new Error(`表不存在: ${db}.${tbl}`);
    const columns: TransferColumn[] = rows.map((r) => {
      const columnType = String(r.COLUMN_TYPE ?? '');
      const precision = r.NUMERIC_PRECISION == null ? undefined : Number(r.NUMERIC_PRECISION);
      const scale = r.NUMERIC_SCALE == null ? undefined : Number(r.NUMERIC_SCALE);
      const length = r.CHARACTER_MAXIMUM_LENGTH == null ? undefined : Number(r.CHARACTER_MAXIMUM_LENGTH);
      const base = columnType.split('(')[0]?.toLowerCase() ?? '';
      return {
        name: String(r.COLUMN_NAME),
        midType: mysqlTypeToMid(columnType),
        sourceType: columnType,
        nullable: r.IS_NULLABLE === 'YES',
        primaryKey: r.COLUMN_KEY === 'PRI',
        autoIncrement: typeof r.EXTRA === 'string' && r.EXTRA.includes('auto_increment'),
        length,
        precision: base === 'decimal' || base === 'numeric' || base === 'dec' || base === 'fixed' ? precision : undefined,
        scale: base === 'decimal' || base === 'numeric' || base === 'dec' || base === 'fixed' ? scale : undefined,
        default: r.COLUMN_DEFAULT == null ? null : String(r.COLUMN_DEFAULT),
        comment: r.COLUMN_COMMENT != null && r.COLUMN_COMMENT !== '' ? String(r.COLUMN_COMMENT) : undefined,
      };
    });
    return { name: tbl, columns };
  };

  return {
    kind: 'mysql',

    listTables: async () => {
      const db = defaultDb();
      const rows = await q(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
        [db],
      );
      return rows.map((r) => String(r.TABLE_NAME));
    },

    describe,

    // 结构随迁：二级索引（排除 PRIMARY；FULLTEXT/SPATIAL 特型不进清单——无法无损映射）
    describeIndexes: async (table) => {
      const db = defaultDb();
      const tbl = assertIdent(table, '表名');
      const rows = await q(
        `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [db, tbl],
      );
      const byName = new Map<string, TransferIndex>();
      for (const r of rows) {
        const name = String(r.INDEX_NAME);
        const type = String(r.INDEX_TYPE ?? 'BTREE').toUpperCase();
        if (type !== 'BTREE') continue;
        const idx = byName.get(name);
        if (idx === undefined) {
          byName.set(name, {
            name,
            columns: [String(r.COLUMN_NAME)],
            unique: Number(r.NON_UNIQUE) === 0,
            sourceType: type,
          });
          continue;
        }
        idx.columns.push(String(r.COLUMN_NAME));
      }
      return [...byName.values()];
    },

    // 结构随迁：出向外键（含参照动作与被引用列；限定同库内）
    describeForeignKeys: async (table) => {
      const db = defaultDb();
      const tbl = assertIdent(table, '表名');
      const rows = await q(
        `SELECT rc.CONSTRAINT_NAME, kcu.COLUMN_NAME, rc.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
                rc.DELETE_RULE, rc.UPDATE_RULE, kcu.ORDINAL_POSITION
         FROM information_schema.REFERENTIAL_CONSTRAINTS rc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
          AND kcu.TABLE_NAME = rc.TABLE_NAME
         WHERE rc.CONSTRAINT_SCHEMA = ? AND rc.TABLE_NAME = ?
         ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        [db, tbl],
      );
      const byName = new Map<string, TransferForeignKey>();
      for (const r of rows) {
        const name = String(r.CONSTRAINT_NAME);
        let fk = byName.get(name);
        if (fk === undefined) {
          fk = {
            name,
            columns: [],
            referencedTable: String(r.REFERENCED_TABLE_NAME),
            referencedColumns: [],
            onDelete: r.DELETE_RULE == null ? undefined : String(r.DELETE_RULE),
            onUpdate: r.UPDATE_RULE == null ? undefined : String(r.UPDATE_RULE),
          };
          byName.set(name, fk);
        }
        fk.columns.push(String(r.COLUMN_NAME));
        fk.referencedColumns.push(String(r.REFERENCED_COLUMN_NAME));
      }
      return [...byName.values()];
    },

    count: async (table) => {
      const db = defaultDb();
      const rows = await q(`SELECT COUNT(*) AS n FROM ${quoteIdent(db, '`')}.${quoteIdent(assertIdent(table, '表名'), '`')}`);
      return Number(rows[0]?.n ?? 0);
    },

    shardKey: async (table) => {
      const t = await describe(table);
      const pks = t.columns.filter((c) => c.primaryKey);
      const pk = pks.length === 1 ? pks[0] : undefined;
      const sharable: ShardKeyType[] = ['int', 'bigint', 'decimal', 'string', 'datetime', 'timestamptz'];
      return pk && sharable.includes(pk.midType as ShardKeyType) ? (pk.midType as ShardKeyType) : null;
    },

    readBatch: async (table, cursor: TransferCursor, limit: number) => {
      const t = await describe(table);
      const db = defaultDb();
      const tbl = `${quoteIdent(db, '`')}.${quoteIdent(t.name, '`')}`;
      const cols = t.columns.map((c) => quoteIdent(c.name, '`')).join(', ');
      let sql: string;
      let params: unknown[];
      if (cursor.mode === 'keyset') {
        const key = quoteIdent(cursor.column, '`');
        sql = cursor.after === null
          ? `SELECT ${cols} FROM ${tbl} ORDER BY ${key} LIMIT ?`
          : `SELECT ${cols} FROM ${tbl} WHERE ${key} > ? ORDER BY ${key} LIMIT ?`;
        params = cursor.after === null ? [limit] : [cursor.after, limit];
      } else if (cursor.mode === 'range') {
        const key = quoteIdent(cursor.column, '`');
        const conds: string[] = [];
        const binds: unknown[] = [];
        if (cursor.lo !== null) {
          conds.push(`${key} ${cursor.loInclusive ? '>=' : '>'} ?`);
          binds.push(cursor.lo);
        }
        if (cursor.hi !== null) {
          conds.push(`${key} < ?`);
          binds.push(cursor.hi);
        }
        const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
        sql = `SELECT ${cols} FROM ${tbl}${where} ORDER BY ${key} LIMIT ?`;
        params = [...binds, limit];
      } else {
        sql = `SELECT ${cols} FROM ${tbl} LIMIT ? OFFSET ?`;
        params = [limit, cursor.offset];
      }
      const rows = await q(sql, params);
      return rows.map((r) => t.columns.map((c) => (r[c.name] ?? null) as TransferCell));
    },

    keyAt: async (table, column, offset) => {
      const db = defaultDb();
      const tbl = `${quoteIdent(db, '`')}.${quoteIdent(assertIdent(table, '表名'), '`')}`;
      const key = quoteIdent(assertIdent(column, '分片键'), '`');
      const rows = await q(`SELECT ${key} AS k FROM ${tbl} ORDER BY ${key} LIMIT 1 OFFSET ?`, [offset]);
      return (rows[0]?.k ?? null) as TransferCell | null;
    },

    close: async () => {
      await pool.end();
    },
  };
}

export function createMysqlTransferWriter(raw: MysqlRaw, writeMode: WriteMode = 'insert'): TransferWriter {
  const pool = raw.pool;
  const prefix =
    writeMode === 'ignore' ? 'INSERT IGNORE INTO ' : writeMode === 'replace' ? 'REPLACE INTO ' : 'INSERT INTO ';

  async function withTx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      try {
        const out = await fn(conn);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      }
    } finally {
      conn.release();
    }
  }

  return {
    kind: 'mysql',

    tableExists: async (name) => {
      const db = raw.database;
      if (db === '') throw new Error('mysql 传输写端缺少默认库（连接未指定 database）');
      const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [db, assertIdent(name, '表名')]);
      const list = (Array.isArray(rows) ? rows : []) as RowDataPacket[];
      return Number(list[0]?.n ?? 0) > 0;
    },
    dropTable: async (name) => {
      const db = raw.database !== '' ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.` : '';
      await pool.query(`DROP TABLE ${db}${quoteIdent(assertIdent(name, '表名'), '`')}`);
    },
    // 循环外键表组整组删除：MySQL 官方 FOREIGN_KEY_CHECKS=0 窗口（官方手册
    // foreign_key_checks 节：DROP TABLE drops tables that have foreign keys that are
    // referred to by other tables；mysqldump 自动输出禁用 foreign_key_checks 的语句），
    // 窗口结束回读原值复位；单表删除被引用表会被 ER_FK_CANNOT_DROP_PARENT(3730) 拦截。
    // 整个窗口固定在一条池连接上执行
    dropTables: async (names) => {
      const db = raw.database !== '' ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.` : '';
      const conn = await pool.getConnection();
      try {
        const [prev] = await conn.query('SELECT @@SESSION.foreign_key_checks AS v');
        const rows = (Array.isArray(prev) ? prev : []) as RowDataPacket[];
        const prevValue = String(rows[0]?.v ?? '1');
        await conn.query('SET SESSION FOREIGN_KEY_CHECKS = 0');
        try {
          for (const n of names) {
            await conn.query(`DROP TABLE ${db}${quoteIdent(assertIdent(n, '表名'), '`')}`);
          }
        } finally {
          await conn.query(`SET SESSION FOREIGN_KEY_CHECKS = ${prevValue === '0' ? '0' : '1'}`).catch(() => {});
        }
      } finally {
        conn.release();
      }
    },
    // truncate 模式前置清空（MySQL 8.4 官方手册「Optimizing InnoDB DDL Operations」：清空首选
    // TRUNCATE，有外键时可能需回退 DELETE）。TRUNCATE 要表级独占 MDL，被活跃调度器/长事务
    // 持有时默认等 31536000s（真机实证：进度无限卡死）——先设 lock_wait_timeout=15s 拿不到即
    // 降级 DELETE FROM（行锁由 innodb_lock_wait_timeout 默认 50s 有限等待，可安全完成）；
    // 被外键引用时 TRUNCATE 报 ER_TRUNCATE_ILLEGAL_FK(1701)，同口径降级 DELETE
    // （依赖排序由编排层先行：选择集内子表已先清空，DELETE 不再被引用拦截）
    beforeLoad: async (name) => {
      const db = raw.database !== ''
        ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.`
        : '';
      const conn = await pool.getConnection();
      try {
        await conn.query('SET SESSION lock_wait_timeout = 15');
        try {
          await conn.query(`TRUNCATE TABLE ${db}${quoteIdent(name, '`')}`);
        } catch {
          // MDL 拿不到（表被活跃连接占用）/ 被外键引用：降级 DELETE（行级锁，有限等待）
          await conn.query(`DELETE FROM ${db}${quoteIdent(name, '`')}`);
        }
      } finally {
        conn.release();
      }
    },

    createTable: async (table) => {
      const db = raw.database !== ''
        ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.`
        : '';
      const defs = table.columns.map((c) => {
        // 自增列：AUTO_INCREMENT 需要整数类型且为键（本模型仅对主键整数列生成，
        // 计数器在显式插入原值后由 InnoDB 自动推进到 max+1，无需 afterLoad）
        const isAutoInt = c.autoIncrement === true && c.primaryKey && (c.midType === 'int' || c.midType === 'bigint');
        let d = `${quoteIdent(c.name, '`')} ${midToMysqlType(c)}`;
        if (!c.nullable) d += ' NOT NULL';
        if (c.default != null) {
          const expr = safeDefaultExpr(c.default);
          if (expr != null) d += ` DEFAULT ${expr}`;
        }
        if (isAutoInt) d += ' AUTO_INCREMENT';
        if (c.comment != null && c.comment !== '') d += ` COMMENT '${c.comment.replaceAll("'", "''")}'`;
        return d;
      });
      const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name, '`'));
      const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
      const tail = table.comment != null && table.comment !== ''
        ? ` COMMENT='${table.comment.replaceAll("'", "''")}'`
        : '';
      const head = `CREATE TABLE ${db}${quoteIdent(table.name, '`')}`;
      await pool.query(`${head} (${defs.join(', ')}${pk})${tail}`);
    },

    // 结构随迁：数据装载完成后建索引（先装数据后建索引为官方批量装载实践）
    createIndex: async (table, index) => {
      const db = raw.database !== ''
        ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.`
        : '';
      const idxName = assertIdent(index.name, '索引名');
      const cols = index.columns.map((c) => quoteIdent(assertIdent(c, '索引列'), '`'));
      const unique = index.unique ? 'UNIQUE ' : '';
      await raw.pool.query(
        `CREATE ${unique}INDEX ${quoteIdent(idxName, '`')} ON ${db}${quoteIdent(assertIdent(table, '表名'), '`')} (${cols.join(', ')})`,
      );
    },

    // 结构随迁：全部表数据装载完成后加外键约束（数据齐备后校验才能通过）
    createForeignKey: async (table, fk) => {
      const db = raw.database !== ''
        ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.`
        : '';
      let actions = '';
      if (fk.onDelete != null && fk.onDelete !== 'NO ACTION') actions += ` ON DELETE ${fk.onDelete}`;
      if (fk.onUpdate != null && fk.onUpdate !== 'NO ACTION') actions += ` ON UPDATE ${fk.onUpdate}`;
      await raw.pool.query(
        `ALTER TABLE ${db}${quoteIdent(assertIdent(table, '表名'), '`')} ADD CONSTRAINT ${quoteIdent(assertIdent(fk.name, '约束名'), '`')} `
        + `FOREIGN KEY (${fk.columns.map((c) => quoteIdent(assertIdent(c, '外键列'), '`')).join(', ')}) `
        + `REFERENCES ${db}${quoteIdent(assertIdent(fk.referencedTable, '被引用表'), '`')} `
        + `(${fk.referencedColumns.map((c) => quoteIdent(assertIdent(c, '被引用列'), '`')).join(', ')})${actions}`,
      );
    },

    // 结构随迁：目标端已有索引名清单（统一「表名.索引名」形态，编排层同名去重用；
    // MySQL 索引名仅表内唯一）
    listIndexes: async () => {
      const db = raw.database;
      if (db === '') throw new Error('mysql 传输写端缺少默认库（连接未指定 database）');
      const rows = await q(
        raw,
        `SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND INDEX_NAME <> 'PRIMARY'`,
        [db],
      );
      return rows
        .filter((r) => r.TABLE_NAME != null && r.INDEX_NAME != null)
        .map((r) => `${String(r.TABLE_NAME)}.${String(r.INDEX_NAME)}`);
    },

    // 目标端外键依赖边：information_schema.REFERENTIAL_CONSTRAINTS 官方目录，
    // 限定同库内（CONSTRAINT_SCHEMA = UNIQUE_CONSTRAINT_SCHEMA）；name/列清单供
    // 结构随迁同名去重
    listForeignKeys: async () => {
      const db = raw.database;
      if (db === '') throw new Error('mysql 传输写端缺少默认库（连接未指定 database）');
      const rows = await q(
        raw,
        `SELECT rc.CONSTRAINT_NAME, rc.TABLE_NAME, rc.REFERENCED_TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_COLUMN_NAME, kcu.ORDINAL_POSITION
         FROM information_schema.REFERENTIAL_CONSTRAINTS rc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
          AND kcu.TABLE_NAME = rc.TABLE_NAME
         WHERE rc.CONSTRAINT_SCHEMA = ? AND rc.UNIQUE_CONSTRAINT_SCHEMA = ? AND rc.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        [db, db],
      );
      const byName = new Map<string, ForeignKeyEdge & { columns: string[]; referencedColumns: string[] }>();
      for (const r of rows) {
        const name = String(r.CONSTRAINT_NAME);
        let edge = byName.get(name);
        if (edge === undefined) {
          edge = {
            name,
            table: String(r.TABLE_NAME),
            referencedTable: String(r.REFERENCED_TABLE_NAME),
            columns: [],
            referencedColumns: [],
          };
          byName.set(name, edge);
        }
        edge.columns.push(String(r.COLUMN_NAME));
        edge.referencedColumns.push(String(r.REFERENCED_COLUMN_NAME));
      }
      return [...byName.values()];
    },

    writeBatch: async (table, rows: TransferRow[]) => {
      if (rows.length === 0) return 0;
      const cols = table.columns;
      const width = cols.length;
      for (const r of rows) {
        if (r.length !== width) {
          throw new Error(`行宽不匹配：期望 ${width} 列，实际 ${r.length} 列（表 ${table.name}）`);
        }
      }
      // REPLACE INTO 无唯一键时等同纯 INSERT（官方语义）——静默重复必须拦截
      if (writeMode === 'replace' && !table.columns.some((c) => c.primaryKey)) {
        throw new Error(`replace 模式需要主键：表 ${table.name} 无主键`);
      }
      const db = raw.database !== ''
        ? `${quoteIdent(assertIdent(raw.database, '库名'), '`')}.`
        : '';
      // 多行 VALUES 单语句（官方示例形态）：一次往返写整批，较逐行快一个数量级；
      // 每语句 ≤1000 行防 max_allowed_packet 溢出
      const colList = cols.map((c) => quoteIdent(c.name, '`')).join(', ');
      const rowHolders = `(${cols.map(() => '?').join(', ')})`;
      return withTx(async (conn) => {
        let written = 0;
        for (let i = 0; i < rows.length; i += 1000) {
          const chunk = rows.slice(i, i + 1000);
          const sql = `${prefix}${db}${quoteIdent(table.name, '`')} (${colList}) VALUES ${chunk.map(() => rowHolders).join(', ')}`;
          const binds = chunk.flatMap((r) => r.map((v, ci) => toMysqlBind(v, cols[ci])));
          const [result] = await conn.query(sql, binds);
          const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
          written += header?.affectedRows ?? 0;
        }
        return written;
      });
    },

    close: async () => {
      await pool.end();
    },
  };
}

/** 定位：database 覆盖连接库（读写端均已按连接默认库（MysqlRaw.database）限定，覆盖入口即
 *  全链生效）；schema 忽略（mysql 无 schema 层级）。
 *  URL 形态连接必须改写 URL 的 pathname——connOptions 的 url 分支会忽略 fields.database
 *  （与 pg 的 connectionString 覆盖显式字段同类坑，审计已证） */
function mysqlLocate(rc: ResolvedConnection, loc?: TransferLocator): ResolvedConnection {
  if (!loc?.database) return rc;
  if (rc.url) {
    const u = new URL(rc.url);
    u.pathname = '/' + encodeURIComponent(loc.database);
    return { ...rc, url: u.toString() };
  }
  return { ...rc, fields: { ...rc.fields, database: loc.database } };
}

export async function createMysqlTransferReaderFromConn(rc: ResolvedConnection, loc?: TransferLocator): Promise<TransferReader> {
  return createMysqlTransferReader(await openMysqlRaw(mysqlLocate(rc, loc)));
}

export async function createMysqlTransferWriterFromConn(
  rc: ResolvedConnection,
  writeMode: WriteMode,
  loc?: TransferLocator,
): Promise<TransferWriter> {
  return createMysqlTransferWriter(await openMysqlRaw(mysqlLocate(rc, loc)), writeMode);
}
