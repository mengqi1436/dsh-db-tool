/**
 * SQLite 传输读写端。
 *
 * 持 openRaw 的原始句柄（绕过浏览路径的 normalizeCell——BLOB 截断 / bigint 降位），
 * bigint 经驱动的 readBigInts/safeIntegers 开关保真读取。sqlite 无主键表不做
 * rowid 分片（评审结论：rowid 不在目标列、WITHOUT ROWID 表无此伪列），降级
 * offset 单 worker 顺序读。
 */
import { assertIdent, quoteIdent } from '../../sql-shared/common.js';
import { openRaw, type SqliteDatabase } from '../../sqlite/index.js';
import type { ResolvedConnection } from '../../types.js';
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
  TransferReader,
  TransferRow,
  TransferTable,
  TransferWriter,
  WriteMode,
} from '../model.js';

/** 声明类型 → 中间类型。先按 SQLite 官方亲和性规则（INT/CHAR·TEXT/BLOB·空/REAL），
 *  再按生态惯例特判日期关键词（sqlite 无日期类型，TEXT 存 ISO 字符串）。
 *  TEXT/CLOB 亲和归 'text'（值无长度上限，映射 'string' 会在目标端建成
 *  VARCHAR(255)——超长值 strict 报错、非 strict 静默截断）；带声明长度的
 *  CHAR/VARCHAR 归 'string'，长度由调用方从声明的 (N) 解析。 */
function declaredToMid(declared: string): MidType {
  const t = declared.toUpperCase();
  if (t.includes('INT')) return 'bigint'; // sqlite INTEGER 即 int64，一律按 bigint 防窄列截断
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) {
    if (t.includes('DATE')) return 'date';
    if (t.includes('DATETIME') || t.includes('TIMESTAMP')) return 'datetime';
    if (!t.includes('CHAR')) return 'text'; // CLOB/TEXT/LONGTEXT 等无界文本
    return 'string';
  }
  if (t.includes('BLOB') || t.trim() === '') return 'bytes';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'double';
  if (t.includes('TIME')) return 'datetime';
  if (t.includes('DATE')) return 'date';
  return 'decimal'; // NUMERIC 亲和（含 DECIMAL/NUMBER/未知声明）
}

const SQLITE_TYPE_BY_MID: Record<MidType, string> = {
  int: 'INTEGER',
  bigint: 'INTEGER',
  decimal: 'NUMERIC',
  float: 'REAL',
  double: 'REAL',
  boolean: 'INTEGER',
  string: 'TEXT',
  text: 'TEXT',
  json: 'TEXT',
  bytes: 'BLOB',
  date: 'TEXT',
  time: 'TEXT',
  datetime: 'TEXT',
  timestamptz: 'TEXT',
};

/** 常见函数名/纯数字/单引号字符串才能内联进 DEFAULT——白名单在 model.ts（safeDefaultExpr） */

interface RawRow {
  get(k: string): unknown;
}

function statementFor(db: SqliteDatabase, sql: string) {
  const stmt = db.prepare(sql);
  // bigint 保真按驱动开关（失败不影响：SQLite 返回 number，>2^53 场景才有差）
  try {
    stmt.setReadBigInts?.(true);
    stmt.safeIntegers?.(true);
  } catch {
    // 驱动无该开关时保持默认
  }
  return stmt;
}

export function createSqliteTransferReader(db: SqliteDatabase): TransferReader {
  const describe = async (table: string): Promise<TransferTable> => {
    const tbl = assertIdent(table, '表名');
    const raw = db.prepare(`PRAGMA table_info(${quoteIdent(tbl)})`).all() as Record<string, unknown>[];
    if (raw.length === 0) throw new Error(`表不存在: ${tbl}`);
    const pkCount = raw.filter((r) => Number(r.pk) > 0).length;
    const columns: TransferColumn[] = raw.map((r): TransferColumn => {
      const declared = String(r.type ?? '');
      const isPk = Number(r.pk) > 0;
      const midType = declaredToMid(declared);
      // string 的声明长度（VARCHAR(N)/CHAR(N)）→ 目标端按 N 建列，避免默认 255 截断
      const declaredLen = /\((\d+)\)/.exec(declared);
      return {
        name: String(r.name),
        midType,
        sourceType: declared,
        nullable: Number(r.notnull) === 0 && !isPk,
        primaryKey: isPk,
        // 单列整型主键 = rowid 别名，天然自增（WITHOUT ROWID 表误标无害：sqlite 写端不用该标记）
        autoIncrement: isPk && pkCount === 1 && midType === 'bigint',
        ...(midType === 'string' && declaredLen ? { length: Number(declaredLen[1]) } : {}),
        default: r.dflt_value == null ? null : String(r.dflt_value),
      };
    });
    return { name: tbl, columns };
  };

  return {
    kind: 'sqlite',

    listTables: async () => {
      const raw = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all() as Record<string, unknown>[];
      return raw.map((r) => String(r.name));
    },

    describe,

    // 结构随迁：二级索引（仅 origin='c' 的 CREATE INDEX；主键/唯一约束的自动索引
    // origin='u'/'pk' 不进清单；partial 索引不随迁）
    describeIndexes: async (table) => {
      const tbl = assertIdent(table, '表名');
      const list = db
        .prepare(`PRAGMA index_list(${quoteIdent(tbl)})`)
        .all() as Record<string, unknown>[];
      const out: TransferIndex[] = [];
      for (const r of list) {
        if (String(r.origin ?? '') !== 'c') continue;
        if (Number(r.partial ?? 0) !== 0) continue;
        const name = String(r.name ?? '');
        if (name === '') continue;
        const cols = db
          .prepare(`PRAGMA index_info(${quoteIdent(name)})`)
          .all() as Record<string, unknown>[];
        const columns: string[] = [];
        let hasExpr = false;
        for (const c of cols.slice().sort((a, b) => Number(a.seqno ?? 0) - Number(b.seqno ?? 0))) {
          const col = c.name == null ? null : String(c.name);
          if (col === null) {
            hasExpr = true; // 表达式索引成分
            break;
          }
          columns.push(col);
        }
        if (hasExpr || columns.length === 0) continue;
        out.push({ name, columns, unique: Number(r.unique ?? 0) === 1, sourceType: 'btree' });
      }
      return out;
    },

    // 结构随迁：出向外键（PRAGMA foreign_key_list；复合外键按 id 分组，from/to 对齐）
    describeForeignKeys: async (table) => {
      const tbl = assertIdent(table, '表名');
      const rows = db
        .prepare(`PRAGMA foreign_key_list(${quoteIdent(tbl)})`)
        .all() as Record<string, unknown>[];
      const byId = new Map<string, TransferForeignKey>();
      for (const r of rows) {
        const id = String(r.id ?? '');
        let fk = byId.get(id);
        if (fk === undefined) {
          fk = {
            // SQLite 外键约束无名：以「表名_fkn」形态命名（目标端 ALTER 不可用，
            // 该名仅供建表内联时占位与去重展示）
            name: `${tbl}_fk${id}`,
            columns: [],
            referencedTable: String(r.table ?? ''),
            referencedColumns: [],
            onDelete: r.on_delete == null || String(r.on_delete) === 'NO ACTION' ? undefined : String(r.on_delete),
            onUpdate: r.on_update == null || String(r.on_update) === 'NO ACTION' ? undefined : String(r.on_update),
          };
          byId.set(id, fk);
        }
        fk.columns.push(String(r.from ?? ''));
        // 'to' 为 NULL 表示引用被引用表的隐式主键：置空串，内联 DDL 省略列清单
        fk.referencedColumns.push(r.to == null ? '' : String(r.to));
      }
      return [...byId.values()].filter((fk) => fk.referencedTable !== '' && fk.columns.every((c) => c !== ''));
    },

    count: async (table) => {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(assertIdent(table, '表名'))}`).get() as
        | Record<string, unknown>
        | undefined;
      return Number(r?.n ?? 0);
    },

    shardKey: async (table) => {
      const t = await describe(table);
      const pks = t.columns.filter((c) => c.primaryKey);
      const pk = pks.length === 1 ? pks[0] : undefined;
      const sharable: ShardKeyType[] = ['int', 'bigint', 'decimal', 'string', 'datetime', 'timestamptz'];
      if (pk && sharable.includes(pk.midType as ShardKeyType)) {
        return pk.midType as ShardKeyType;
      }
      return null;
    },

    readBatch: async (table, cursor: TransferCursor, limit: number) => {
      const t = await describe(table);
      const tbl = quoteIdent(t.name);
      const cols = t.columns.map((c) => quoteIdent(c.name)).join(', ');
      let stmt;
      if (cursor.mode === 'keyset') {
        const key = quoteIdent(cursor.column);
        stmt =
          cursor.after === null
            ? statementFor(db, `SELECT ${cols} FROM ${tbl} ORDER BY ${key} LIMIT ?`)
            : statementFor(db, `SELECT ${cols} FROM ${tbl} WHERE ${key} > ? ORDER BY ${key} LIMIT ?`);
        const raw =
          cursor.after === null
            ? (stmt.all(limit) as Record<string, unknown>[])
            : (stmt.all(cursor.after, limit) as Record<string, unknown>[]);
        return raw.map((r) => t.columns.map((c) => r[c.name] ?? null) as TransferRow);
      }
      if (cursor.mode === 'range') {
        const key = quoteIdent(cursor.column);
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
        stmt = statementFor(db, `SELECT ${cols} FROM ${tbl}${where} ORDER BY ${key} LIMIT ?`);
        const raw = stmt.all(...binds, limit) as Record<string, unknown>[];
        return raw.map((r) => t.columns.map((c) => r[c.name] ?? null) as TransferRow);
      }
      stmt = statementFor(db, `SELECT ${cols} FROM ${tbl} LIMIT ? OFFSET ?`);
      const raw = stmt.all(limit, cursor.offset) as Record<string, unknown>[];
      return raw.map((r) => t.columns.map((c) => r[c.name] ?? null) as TransferRow);
    },

    keyAt: async (table, column, offset) => {
      const tbl = quoteIdent(assertIdent(table, '表名'));
      const key = quoteIdent(assertIdent(column, '分片键'));
      const rows = db
        .prepare(`SELECT ${key} AS k FROM ${tbl} ORDER BY ${key} LIMIT 1 OFFSET ?`)
        .all(offset) as Record<string, unknown>[];
      return (rows[0]?.k ?? null) as TransferCell | null;
    },

    close: async () => {
      db.close();
    },
  };
}

export function createSqliteTransferWriter(
  db: SqliteDatabase,
  writeMode: WriteMode = 'insert',
): TransferWriter {
  const prefix =
    writeMode === 'ignore' ? 'INSERT OR IGNORE INTO ' : writeMode === 'replace' ? 'INSERT OR REPLACE INTO ' : 'INSERT INTO ';

  return {
    kind: 'sqlite',

    tableExists: async (name) => {
      const r = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as Record<string, unknown> | undefined;
      return Number(r?.n ?? 0) > 0;
    },
    dropTable: async (name) => {
      db.exec(`DROP TABLE ${quoteIdent(assertIdent(name, '表名'))}`);
    },
    // 循环外键表组整组删除：SQLite 官方批量重建流程——PRAGMA foreign_keys=OFF 期间
    // 删除/装载不被外键拦截（https://sqlite.org/lang_altertable.html 步骤一：
    // "If foreign key constraints are enabled, disable them using PRAGMA foreign_keys=OFF"；
    // 该 PRAGMA 必须在事务外设置，事务内为 no-op，本写端语句均自动提交无悬挂事务）。
    // 结束前按打开时的原值复位：node:sqlite 的 enableForeignKeyConstraints 默认 true
    //（实测新连接 PRAGMA foreign_keys=1）、better-sqlite3 默认不启用——回读原值，
    // 不把 OFF 会话误置成 ON、也不把 ON 会话误置成 OFF
    dropTables: async (names) => {
      const before = Number(
        (db.prepare('PRAGMA foreign_keys').get() as Record<string, unknown> | undefined)?.foreign_keys ?? 0,
      );
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        for (const n of names) {
          db.exec(`DROP TABLE ${quoteIdent(assertIdent(n, '表名'))}`);
        }
      } finally {
        db.exec(`PRAGMA foreign_keys = ${before === 0 ? 'OFF' : 'ON'}`);
      }
    },
    // truncate 模式前置清空：SQLite 官方无 TRUNCATE 语句，DELETE FROM 即全表清空
    beforeLoad: async (name) => {
      db.exec(`DELETE FROM ${quoteIdent(assertIdent(name, '表名'))}`);
    },

    // 建表：结构随迁时内联源端外键定义（SQLite 无 ALTER TABLE ADD CONSTRAINT，
    // 外键只能在 CREATE TABLE 声明；被引用列清单为空 = 引用隐式主键，省略列清单）
    createTable: async (table, foreignKeys) => {
      const defs = table.columns.map((c) => {
        let d = `${quoteIdent(c.name)} ${SQLITE_TYPE_BY_MID[c.midType]}`;
        if (!c.nullable) d += ' NOT NULL';
        if (c.default != null) {
          const expr = safeDefaultExpr(c.default);
          if (expr != null) d += ` DEFAULT ${expr}`;
        }
        return d;
      });
      // 主键用表级约束（支持复合主键；内联每列 PK 会在复合主键时报 Multiple primary key）
      const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name));
      const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
      const fks = (foreignKeys ?? [])
        .filter((fk) => fk.referencedTable !== '')
        .map((fk) => {
          const cols = fk.columns.map((c) => quoteIdent(c)).join(', ');
          const refs = fk.referencedColumns.every((c) => c === '')
            ? ''
            : ` (${fk.referencedColumns.map((c) => quoteIdent(c)).join(', ')})`;
          let sql = `, FOREIGN KEY (${cols}) REFERENCES ${quoteIdent(fk.referencedTable)}${refs}`;
          if (fk.onDelete != null && fk.onDelete !== 'NO ACTION') sql += ` ON DELETE ${fk.onDelete}`;
          if (fk.onUpdate != null && fk.onUpdate !== 'NO ACTION') sql += ` ON UPDATE ${fk.onUpdate}`;
          return sql;
        })
        .join('');
      db.exec(`CREATE TABLE ${quoteIdent(table.name)} (${defs.join(', ')}${pk}${fks})`);
    },

    // 结构随迁：数据装载完成后建索引（先装数据后建索引为官方批量装载实践）
    createIndex: async (table, index) => {
      const unique = index.unique ? 'UNIQUE ' : '';
      const cols = index.columns.map((c) => quoteIdent(assertIdent(c, '索引列')));
      await db.exec(
        `CREATE ${unique}INDEX ${quoteIdent(assertIdent(index.name, '索引名'))} ON ${quoteIdent(assertIdent(table, '表名'))} (${cols.join(', ')})`,
      );
    },

    // 结构随迁：目标端已有索引名清单（统一「表名.索引名」形态，与 mysql/sqlserver 一致，
    // 编排层同名去重用；sqlite 索引名全局唯一但保持同一键格式）
    listIndexes: async () => {
      const rows = db
        .prepare(`SELECT tbl_name, name FROM sqlite_master WHERE type = 'index' AND name IS NOT NULL`)
        .all() as Record<string, unknown>[];
      return rows
        .map((r) => (r.tbl_name == null || r.name == null ? '' : `${String(r.tbl_name)}.${String(r.name)}`))
        .filter((n) => n !== '');
    },

    // 目标端外键依赖边：PRAGMA foreign_key_list 官方接口（table 列为被引用表名）；
    // 编排层据此做删除/清空/装载依赖排序（连接默认不开外键时排序同样成立——
    // 外键约束一旦存在，排序就是唯一不依赖会话开关的官方做法）；列清单供结构随迁去重
    // （SQLite 外键无名，按列对匹配）
    listForeignKeys: async () => {
      const edges: ForeignKeyEdge[] = [];
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
        .all() as Record<string, unknown>[];
      for (const t of tables) {
        const name = String(t.name ?? '');
        if (name === '') continue;
        const fks = db
          .prepare(`PRAGMA foreign_key_list(${quoteIdent(assertIdent(name, '表名'))})`)
          .all() as Record<string, unknown>[];
        const byId = new Map<string, ForeignKeyEdge & { columns: string[]; referencedColumns: string[] }>();
        for (const fk of fks) {
          const id = String(fk.id ?? '');
          const ref = fk.table == null ? '' : String(fk.table);
          if (ref === '') continue;
          let edge = byId.get(id);
          if (edge === undefined) {
            edge = { table: name, referencedTable: ref, columns: [], referencedColumns: [] };
            byId.set(id, edge);
          }
          edge.columns.push(String(fk.from ?? ''));
          edge.referencedColumns.push(fk.to == null ? '' : String(fk.to));
        }
        edges.push(...byId.values());
      }
      return edges;
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
      // INSERT OR REPLACE 无唯一键时等同纯 INSERT（官方语义）——静默重复必须拦截
      if (writeMode === 'replace' && !table.columns.some((c) => c.primaryKey)) {
        throw new Error(`replace 模式需要主键：表 ${table.name} 无主键`);
      }
      const sql = `${prefix}${quoteIdent(table.name)} (${cols.map((c) => quoteIdent(c.name)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const stmt = db.prepare(sql);
      let written = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const r of rows) {
          const info = stmt.run(...r);
          written += Number(info.changes ?? 0);
        }
        db.exec('COMMIT');
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // 回滚失败时保留原始错误
        }
        throw e;
      }
      return written;
    },

    // sqlite 单列整型主键即 rowid 别名，目标端自增无需处理
    close: async () => {
      db.close();
    },
  };
}

/** 从连接配置创建（transfer/index.ts 分发入口用） */
export async function createSqliteTransferReaderFromConn(rc: ResolvedConnection): Promise<TransferReader> {
  const { db } = await openRaw(rc, true);
  return createSqliteTransferReader(db);
}

export async function createSqliteTransferWriterFromConn(
  rc: ResolvedConnection,
  writeMode: WriteMode,
): Promise<TransferWriter> {
  const { db } = await openRaw(rc, false);
  return createSqliteTransferWriter(db, writeMode);
}
