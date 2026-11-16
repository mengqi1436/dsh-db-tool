/**
 * PostgreSQL / GaussDB 传输读写端（驱动 API 同构，仅 kind 与 DDL 兼容面差异）。
 *
 * pg 驱动把 date/timestamp 解析为 JS Date（本地时区解释墙钟）→ 统一 toISOString；
 * ponytail: timestamp without time zone 的墙钟被驱动按插件进程时区解析，源服务器
 * 时区 ≠ 插件时区时有偏差（pg 类型解析器是全局的，不能为传输单独改）——升级路径：
 * 传输池改用独立 parser 的专用驱动实例。
 */
import type { ResolvedConnection } from '../../types.js';
import type { PgLikeDriver, PgLikePool } from '../../sql-shared/pg-like.js';
import { pgCfgWithDatabase, pgLikePoolCfg } from '../../sql-shared/pg-like.js';
import { assertIdent, quoteIdent } from '../../sql-shared/common.js';
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

/** information_schema data_type → 中间类型 */
export function pgTypeToMid(dataType: string): MidType {
  const t = dataType.toLowerCase();
  if (t === 'smallint' || t === 'integer') return 'int';
  if (t === 'bigint') return 'bigint';
  if (t === 'numeric' || t === 'decimal') return 'decimal';
  if (t === 'real') return 'float';
  if (t === 'double precision') return 'double';
  if (t === 'boolean') return 'boolean';
  if (t === 'text') return 'text';
  if (t === 'bytea') return 'bytes';
  if (t === 'json' || t === 'jsonb') return 'json';
  if (t === 'date') return 'date';
  if (t.startsWith('time(') || t === 'time' || t === 'time without time zone' || t === 'time with time zone') return 'time';
  if (t === 'timestamp with time zone') return 'timestamptz';
  if (t.startsWith('timestamp')) return 'datetime';
  return 'string'; // varchar/char/uuid/xml/inet/cidr/money/自定义
}

/** 中间类型 → 目标列类型（GaussDB 兼容 PG 类型面；目标端不生成自增，见 mysql.ts 同注） */
export function midToPgType(c: TransferColumn): string {
  switch (c.midType) {
    case 'int': return 'INTEGER';
    case 'bigint': return 'BIGINT';
    case 'decimal': return `NUMERIC(${c.precision ?? 38},${c.scale ?? 10})`;
    case 'float': return 'REAL';
    case 'double': return 'DOUBLE PRECISION';
    case 'boolean': return 'BOOLEAN';
    case 'string': return `VARCHAR(${Math.min(Math.max(c.length ?? 255, 1), 10485760)})`;
    case 'text': return 'TEXT';
    case 'bytes': return 'BYTEA';
    case 'json': return 'JSON';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'datetime': return 'TIMESTAMP';
    case 'timestamptz': return 'TIMESTAMPTZ';
  }
}

/** 绑定值形态：bigint→字符串（pg 不接受 bigint 绑定，BIGINT 列隐式转换保精度） */
export function toPgBind(c: TransferCell): string | number | boolean | null | Uint8Array {
  if (typeof c === 'bigint') return c.toString();
  return c;
}

/** 单元格保真：pg 的 Date → ISO 字符串（datetime/timestamptz 统一 ISO 流转） */
function materialize(v: unknown): TransferCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v as TransferCell;
}

/** 字符串字面量转义（COMMENT ON 等 DDL 内联用） */
export function pgQuoteLit(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

/** 外键参照动作 → SQL 后缀（NO ACTION 省略，与省缺一致） */
function fkConstraintActions(fk: TransferForeignKey): string {
  let sql = '';
  if (fk.onDelete != null && fk.onDelete !== 'NO ACTION') sql += ` ON DELETE ${fk.onDelete}`;
  if (fk.onUpdate != null && fk.onUpdate !== 'NO ACTION') sql += ` ON UPDATE ${fk.onUpdate}`;
  return sql;
}

/** 参照动作码（pg_constraint confdeltype/confupdtype）→ SQL 形态 */
function fkActionOf(code: string): string {
  switch (code) {
    case 'r': return 'RESTRICT';
    case 'c': return 'CASCADE';
    case 'n': return 'SET NULL';
    case 'd': return 'SET DEFAULT';
    default: return 'NO ACTION';
  }
}

export function createPgTransferReader(kind: 'postgresql' | 'gaussdb', pool: PgLikePool, schema: string): TransferReader {
  const q = async (sql: string, params?: unknown[]) => (await pool.query(sql, params ?? [])).rows;

  /** 表 oid（comments/identity 查询共用）；表不存在返回 null */
  const tableOid = async (table: string): Promise<string | null> => {
    const rows = await q(
      `SELECT c.oid AS oid FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = $2 AND c.relkind = 'r'`,
      [table, schema],
    );
    return rows[0]?.oid != null ? String(rows[0].oid) : null;
  };

  const describe = async (table: string): Promise<TransferTable> => {
    const tbl = table;
    const rows = await q(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length,
              numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, tbl],
    );
    if (rows.length === 0) throw new Error(`表不存在: ${schema}.${tbl}`);
    const pks = await q(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
      [schema, tbl],
    );
    const pkSet = new Set(pks.map((r) => String(r.column_name)));
    // 自增列检测：serial 家族的 nextval 默认值 + PG10+ IDENTITY 列（attidentity）
    const [autoRows, oid] = await Promise.all([
      q(
        `SELECT a.attname FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2 AND a.attidentity IS NOT NULL`,
        [schema, tbl],
      ),
      tableOid(tbl),
    ]);
    const autoSet = new Set<string>(autoRows.map((r) => String(r.attname)));
    const tableCommentRows = oid === null ? [] : await q(
      `SELECT d.description FROM pg_catalog.pg_description d WHERE d.objoid = $1::oid AND d.objsubid = 0`,
      [oid],
    );
    const columnCommentRows = oid === null ? [] : await q(
      `SELECT a.attname, d.description FROM pg_catalog.pg_description d
       JOIN pg_catalog.pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
       WHERE d.objoid = $1::oid AND d.objsubid > 0`,
      [oid],
    );
    const colComments = new Map<string, string>(
      columnCommentRows.map((r) => [String(r.attname), String(r.description)] as const),
    );
    const tableComment = tableCommentRows[0]?.description;
    const columns: TransferColumn[] = rows.map((r) => {
      const name = String(r.column_name);
      const autoByDefault = typeof r.column_default === 'string' && /nextval\(/i.test(r.column_default);
      return {
        name,
        midType: pgTypeToMid(String(r.data_type)),
        sourceType: String(r.data_type),
        nullable: r.is_nullable === 'YES',
        primaryKey: pkSet.has(name),
        autoIncrement: autoByDefault || autoSet.has(name),
        length: r.character_maximum_length == null ? undefined : Number(r.character_maximum_length),
        precision: r.numeric_precision == null ? undefined : Number(r.numeric_precision),
        scale: r.numeric_scale == null ? undefined : Number(r.numeric_scale),
        default: r.column_default == null ? null : String(r.column_default),
        comment: colComments.get(name),
      };
    });
    return {
      name: tbl,
      columns,
      comment: tableComment == null || tableComment === '' ? undefined : String(tableComment),
    };
  };

  return {
    kind,

    listTables: async () => {
      const rows = await q(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [schema],
      );
      return rows.map((r) => String(r.table_name));
    },

    describe,

    count: async (table) => {
      const rows = await q(`SELECT COUNT(*) AS n FROM ${quoteIdent(schema)}.${quoteIdent(table)}`);
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
      const tbl = `${quoteIdent(schema)}.${quoteIdent(t.name)}`;
      const cols = t.columns.map((c) => quoteIdent(c.name)).join(', ');
      let sql: string;
      let params: unknown[];
      if (cursor.mode === 'keyset') {
        const key = quoteIdent(cursor.column);
        sql = cursor.after === null
          ? `SELECT ${cols} FROM ${tbl} ORDER BY ${key} LIMIT $1`
          : `SELECT ${cols} FROM ${tbl} WHERE ${key} > $1 ORDER BY ${key} LIMIT $2`;
        params = cursor.after === null ? [limit] : [toPgBind(cursor.after), limit];
      } else if (cursor.mode === 'range') {
        const key = quoteIdent(cursor.column);
        const conds: string[] = [];
        const binds: unknown[] = [];
        if (cursor.lo !== null) {
          conds.push(`${key} ${cursor.loInclusive ? '>=' : '>'} $${binds.length + 1}`);
          binds.push(toPgBind(cursor.lo));
        }
        if (cursor.hi !== null) {
          conds.push(`${key} < $${binds.length + 1}`);
          binds.push(toPgBind(cursor.hi));
        }
        const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
        sql = `SELECT ${cols} FROM ${tbl}${where} ORDER BY ${key} LIMIT $${binds.length + 1}`;
        params = [...binds, limit];
      } else {
        sql = `SELECT ${cols} FROM ${tbl} LIMIT $1 OFFSET $2`;
        params = [limit, cursor.offset];
      }
      const rows = await q(sql, params);
      return rows.map((r) => t.columns.map((c) => materialize(r[c.name])));
    },

    keyAt: async (table, column, offset) => {
      const rows = await q(
        `SELECT ${quoteIdent(assertIdent(column, '分片键'))} AS k FROM ${quoteIdent(schema)}.${quoteIdent(assertIdent(table, '表名'))}
         ORDER BY ${quoteIdent(assertIdent(column, '分片键'))} LIMIT 1 OFFSET $1`,
        [offset],
      );
      return materialize(rows[0]?.k ?? null);
    },

    // 结构随迁：二级索引（排除主键约束索引；表达式/部分索引与非 btree 特型不进清单——
    // 无法无损映射到目标方言，宁缺毋滥）
    describeIndexes: async (table) => {
      const tbl = assertIdent(table, '表名');
      const rows = await q(
        `SELECT i.relname AS index_name, ix.indisunique, am.amname, a.attname, k.ord
         FROM pg_catalog.pg_index ix
         JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
         JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_catalog.pg_am am ON am.oid = i.relam
         CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS kk(attnum, ord)
         LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = kk.attnum
         WHERE n.nspname = $1 AND t.relname = $2 AND NOT ix.indisprimary
         ORDER BY i.relname, kk.ord`,
        [schema, tbl],
      );
      const byName = new Map<string, TransferIndex>();
      for (const r of rows) {
        const name = String(r.index_name);
        const col = r.attname == null ? null : String(r.attname);
        const idx = byName.get(name);
        if (idx === undefined) {
          // 首列即为空说明含表达式成分：整只索引不进清单
          if (col === null) continue;
          byName.set(name, {
            name,
            columns: [col],
            unique: r.indisunique === true,
            sourceType: String(r.amname ?? ''),
          });
          continue;
        }
        if (col === null) {
          byName.delete(name); // 组成列混有表达式：放弃该索引
          continue;
        }
        idx.columns.push(col);
      }
      return [...byName.values()].filter((idx) => idx.sourceType === 'btree');
    },

    // 结构随迁：出向外键（含参照动作与被引用列；限定同模式内）
    describeForeignKeys: async (table) => {
      const tbl = assertIdent(table, '表名');
      const rows = await q(
        `SELECT x.conname, ka.attname AS col, ra.attname AS refcol,
                rt.relname AS ref_table, x.confdeltype, x.confupdtype, ko.ord
         FROM pg_catalog.pg_constraint x
         JOIN pg_catalog.pg_class ct ON ct.oid = x.conrelid
         JOIN pg_catalog.pg_namespace cn ON cn.oid = ct.relnamespace
         CROSS JOIN LATERAL unnest(x.conkey) WITH ORDINALITY AS ko(attnum, ord)
         JOIN LATERAL unnest(x.confkey) WITH ORDINALITY AS ro(attnum, rord) ON ro.rord = ko.ord
         JOIN pg_catalog.pg_attribute ka ON ka.attrelid = x.conrelid AND ka.attnum = ko.attnum
         JOIN pg_catalog.pg_class rt ON rt.oid = x.confrelid
         JOIN pg_catalog.pg_namespace rn ON rn.oid = rt.relnamespace
         JOIN pg_catalog.pg_attribute ra ON ra.attrelid = x.confrelid AND ra.attnum = ro.attnum
         WHERE x.contype = 'f' AND cn.nspname = $1 AND ct.relname = $2 AND rn.nspname = $1
         ORDER BY x.conname, ko.ord`,
        [schema, tbl],
      );
      const byName = new Map<string, TransferForeignKey>();
      for (const r of rows) {
        const name = String(r.conname);
        let fk = byName.get(name);
        if (fk === undefined) {
          fk = {
            name,
            columns: [],
            referencedTable: String(r.ref_table),
            referencedColumns: [],
            onDelete: fkActionOf(String(r.confdeltype ?? 'a')),
            onUpdate: fkActionOf(String(r.confupdtype ?? 'a')),
          };
          byName.set(name, fk);
        }
        fk.columns.push(String(r.col));
        fk.referencedColumns.push(String(r.refcol));
      }
      return [...byName.values()];
    },

    close: async () => {
      await pool.end();
    },
  };
}

export function createPgTransferWriter(
  kind: 'postgresql' | 'gaussdb',
  pool: PgLikePool,
  schema: string,
  writeMode: WriteMode = 'insert',
): TransferWriter {
  return {
    kind,

    tableExists: async (name) => {
      const res = await pool.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [schema, name]);
      return Number(res.rows[0]?.n ?? 0) > 0;
    },
    dropTable: async (name) => {
      await pool.query(`DROP TABLE ${quoteIdent(schema)}.${quoteIdent(name)}`);
    },
    // 循环外键表组整组删除：PG 官方单语句多表 DROP 可删除相互外键引用的表组
    // （https://www.postgresql.org/docs/current/sql-droptable.html，单表删除会被
    // SQLSTATE 2BP01「other objects depend on it」拦截）
    dropTables: async (names) => {
      const list = names.map((n) => `${quoteIdent(schema)}.${quoteIdent(assertIdent(n, '表名'))}`).join(', ');
      await pool.query(`DROP TABLE ${list}`);
    },
    // truncate 模式前置清空：TRUNCATE 重置表而无行级日志开销（PG 官方文档 TRUNCATE 节）
    // 同连接先设 lock_timeout（管 MDL 与行锁）：TRUNCATE 被长事务持有时 MDL 等待默认无限；
    // TRUNCATE 拿不到锁（15s）或被外键引用（官方限制：引用它的表必须同语句一并清空）
    // 降级 DELETE（行级锁，同一 lock_timeout 有限等待）
    beforeLoad: async (name) => {
      const client = await pool.connect();
      try {
        await client.query("SET lock_timeout = '15s'");
        try {
          await client.query(`TRUNCATE TABLE ${quoteIdent(schema)}.${quoteIdent(name)}`);
        } catch {
          await client.query(`DELETE FROM ${quoteIdent(schema)}.${quoteIdent(name)}`);
        }
      } finally {
        client.release();
      }
    },

    createTable: async (table) => {
      const defs = table.columns.map((c) => {
        // 自增列用 serial 家族（目标端自增继续工作；数据装载后由 afterLoad 校准序列起点）
        const isAutoInt = c.autoIncrement === true && (c.midType === 'int' || c.midType === 'bigint');
        const type = isAutoInt ? (c.midType === 'bigint' ? 'BIGSERIAL' : 'SERIAL') : midToPgType(c);
        let d = `${quoteIdent(c.name)} ${type}`;
        if (!c.nullable) d += ' NOT NULL';
        if (c.default != null && !isAutoInt) {
          const expr = safeDefaultExpr(c.default);
          if (expr != null) d += ` DEFAULT ${expr}`;
        }
        return d;
      });
      const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name));
      const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
      const qualified = `${quoteIdent(schema)}.${quoteIdent(table.name)}`;
      await pool.query(`CREATE TABLE ${qualified} (${defs.join(', ')}${pk})`);
      // 注释随迁：pg 官方 COMMENT ON 形态（失败仅影响注释本身，由调用方隔离）
      if (table.comment != null && table.comment !== '') {
        await pool.query(`COMMENT ON TABLE ${qualified} IS ${pgQuoteLit(table.comment)}`);
      }
      for (const c of table.columns) {
        if (c.comment == null || c.comment === '') continue;
        await pool.query(
          `COMMENT ON COLUMN ${qualified}.${quoteIdent(c.name)} IS ${pgQuoteLit(c.comment)}`,
        );
      }
    },

    // 自增序列起点校准：显式插入原值不会推进 serial 序列，不校准则目标端后续插入冲突。
    // pg_get_serial_sequence 官方接口按列取所属序列，setval 设为 max+1
    afterLoad: async (table) => {
      const autos = table.columns.filter(
        (c) => c.autoIncrement === true && (c.midType === 'int' || c.midType === 'bigint'),
      );
      for (const c of autos) {
        const seqName = assertIdent(c.name, '自增列');
        const qualified = `${quoteIdent(schema)}.${quoteIdent(table.name)}`;
        await pool.query(
          `SELECT setval(pg_get_serial_sequence($1, $2),
                         GREATEST((SELECT COALESCE(MAX(${quoteIdent(seqName)}), 0) FROM ${qualified}), 0) + 1, false)`,
          [`${schema}.${table.name}`, c.name],
        );
      }
    },

    // 结构随迁：数据装载完成后建索引（先装数据后建索引为官方批量装载实践）
    createIndex: async (table, index) => {
      const idxName = assertIdent(index.name, '索引名');
      const cols = index.columns.map((c) => quoteIdent(assertIdent(c, '索引列')));
      const unique = index.unique ? 'UNIQUE ' : '';
      await pool.query(
        `CREATE ${unique}INDEX ${quoteIdent(idxName)} ON ${quoteIdent(schema)}.${quoteIdent(assertIdent(table, '表名'))} (${cols.join(', ')})`,
      );
    },

    // 结构随迁：全部表数据装载完成后加外键约束（数据齐备后校验才能通过）
    createForeignKey: async (table, fk) => {
      const actions = fkConstraintActions(fk);
      await pool.query(
        `ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(assertIdent(table, '表名'))} ADD CONSTRAINT ${quoteIdent(assertIdent(fk.name, '约束名'))} `
        + `FOREIGN KEY (${fk.columns.map((c) => quoteIdent(assertIdent(c, '外键列'))).join(', ')}) `
        + `REFERENCES ${quoteIdent(schema)}.${quoteIdent(assertIdent(fk.referencedTable, '被引用表'))} `
        + `(${fk.referencedColumns.map((c) => quoteIdent(assertIdent(c, '被引用列'))).join(', ')})${actions}`,
      );
    },

    // 结构随迁：目标端已有索引名清单（统一「表名.索引名」形态，编排层同名去重用；
    // PG 索引名模式内唯一）
    listIndexes: async () => {
      const res = await pool.query(
        `SELECT t.relname AS table_name, i.relname AS index_name
         FROM pg_catalog.pg_index ix
         JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
         JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = $1`,
        [schema],
      );
      return res.rows
        .map((r: Record<string, unknown>) =>
          r.table_name == null || r.index_name == null ? '' : `${String(r.table_name)}.${String(r.index_name)}`)
        .filter((n) => n !== '');
    },

    // 目标端外键依赖边：pg_constraint 官方目录（conrelid 引用方 / confrelid 被引用方），
    // 限定本模式内（跨模式引用与选择集排序无关）；name/列清单供结构随迁同名去重
    listForeignKeys: async () => {
      const res = await pool.query(
        `SELECT x.conname, c.relname AS table_name, r.relname AS referenced_table,
                ka.attname AS col, ra.attname AS refcol, ko.ord
         FROM pg_catalog.pg_constraint x
         JOIN pg_catalog.pg_class c ON c.oid = x.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_class r ON r.oid = x.confrelid
         JOIN pg_catalog.pg_namespace rn ON rn.oid = r.relnamespace
         CROSS JOIN LATERAL unnest(x.conkey) WITH ORDINALITY AS ko(attnum, ord)
         JOIN LATERAL unnest(x.confkey) WITH ORDINALITY AS ro(attnum, rord) ON ro.rord = ko.ord
         JOIN pg_catalog.pg_attribute ka ON ka.attrelid = x.conrelid AND ka.attnum = ko.attnum
         JOIN pg_catalog.pg_attribute ra ON ra.attrelid = x.confrelid AND ra.attnum = ro.attnum
         WHERE x.contype = 'f' AND n.nspname = $1 AND rn.nspname = $1
         ORDER BY x.conname, ko.ord`,
        [schema],
      );
      const byKey = new Map<string, ForeignKeyEdge & { columns: string[]; referencedColumns: string[] }>();
      for (const r of res.rows as Record<string, unknown>[]) {
        const key = String(r.conname);
        let edge = byKey.get(key);
        if (edge === undefined) {
          edge = {
            name: key,
            table: String(r.table_name),
            referencedTable: String(r.referenced_table),
            columns: [],
            referencedColumns: [],
          };
          byKey.set(key, edge);
        }
        edge.columns.push(String(r.col));
        edge.referencedColumns.push(String(r.refcol));
      }
      return [...byKey.values()];
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
      // ON CONFLICT 是 PG 系官方冲突语法（9.5+，GaussDB 兼容）；replace 依赖主键做冲突判定
      const pkCols = cols.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name));
      let action = '';
      if (writeMode === 'ignore') {
        action = ' ON CONFLICT DO NOTHING';
      } else if (writeMode === 'replace') {
        if (pkCols.length === 0) throw new Error(`replace 模式需要主键：表 ${table.name} 无主键`);
        const updaters = cols
          .filter((c) => !c.primaryKey)
          .map((c) => `${quoteIdent(c.name)} = EXCLUDED.${quoteIdent(c.name)}`)
          .join(', ');
        action = ` ON CONFLICT (${pkCols.join(', ')}) DO UPDATE SET ${updaters}`;
      }
      const tbl = `${quoteIdent(schema)}.${quoteIdent(table.name)}`;
      const colList = cols.map((c) => quoteIdent(c.name)).join(', ');
      // 多行 VALUES 单语句（10-50x 于逐行）：pg 扩展协议硬上限 65535 绑定参数，
      // 每语句行数 = min(批大小, floor(65535/列数))；事务包裹不变
      const perStmt = Math.max(1, Math.floor(65535 / cols.length));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        try {
          let written = 0;
          for (let i = 0; i < rows.length; i += perStmt) {
            const chunk = rows.slice(i, i + perStmt);
            const holders = chunk
              .map((_, ri) => `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(', ')})`)
              .join(', ');
            const sql = `INSERT INTO ${tbl} (${colList}) VALUES ${holders}${action}`;
            const res = await client.query(sql, chunk.flatMap((r) => r.map(toPgBind)));
            written += res.rowCount ?? 0;
          }
          await client.query('COMMIT');
          return written;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        }
      } finally {
        client.release();
      }
    },

    close: async () => {
      await pool.end();
    },
  };
}

/** 传输专用独立池：建池前置与浏览适配器同源（pgLikePoolCfg：URL 规范化剥 jdbc:、
 *  多主机逐台探测选台——驱动不能透传 jdbc: 与多台 connectionString，见 pg-like.ts）；
 *  max 4 面向分片并行，避免占满服务器连接 */
async function openPgLikePool(
  kind: 'postgresql' | 'gaussdb',
  driver: PgLikeDriver,
  rc: ResolvedConnection,
): Promise<PgLikePool> {
  const { cfg } = await pgLikePoolCfg(kind, driver, rc, 4);
  // pgLocate 跨库时覆盖的 fields.database 必须经 pgCfgWithDatabase 生效：驱动
  // ConnectionParameters 按 Object.assign({}, config, parse(connectionString)) 合并，
  // 直接叠加 database 字段会被 URL 里的原库名覆盖（静默连回原连接的库）
  const db = rc.fields?.database != null ? String(rc.fields.database) : undefined;
  const pool = new driver.Pool(db != null ? pgCfgWithDatabase(cfg, db) : cfg);
  // 会话时区固定 UTC：timestamptz 列接收中间格式的无时区 UTC 墙钟串（mysql 源读出
  // 形态）时按会话 TimeZone 解释，不钉死则目标库时区 ≠ UTC 静默偏移（同 oralike/
  // mysql 读写端的会话前置约定）。同连接内部查询串行，SET 先于后续语句生效
  pool.on('connect', (client) => {
    void client.query("SET TIME ZONE '+00:00'").catch(() => { /* 服务器拒绝时保持默认 */ });
  });
  // pg 约定：无监听器的 pool error 会崩进程（pg-like.ts setupPool 同款兜底）
  pool.on('error', () => {});
  return pool;
}

function pgSchemaOf(rc: ResolvedConnection): string {
  return rc.fields && typeof rc.fields.schema === 'string' && rc.fields.schema ? rc.fields.schema : 'public';
}

/** 定位解析：schema = loc.schema（非法标识符在 assertIdent 拒绝）?? 连接 schema；
 *  database ≠ 连接库时浅拷贝 rc 仅覆盖 fields.database（等价 pg-like poolFor
 *  「同一份 cfg 仅覆盖库名」）。注意驱动 ConnectionParameters 按
 *  Object.assign({}, config, parse(connectionString)) 合并——connectionString 解析值
 *  覆盖显式字段，故 URL 形态的跨库覆盖在 openPgLikePool 经 pgCfgWithDatabase
 *  改写 URL path 段生效，此处只负责把目标库写进 fields.database */
export function pgLocate(rc: ResolvedConnection, loc?: TransferLocator): { rc: ResolvedConnection; schema: string } {
  const schema = loc?.schema != null ? assertIdent(loc.schema, '模式名') : pgSchemaOf(rc);
  const cur = rc.fields?.database != null ? String(rc.fields.database) : undefined;
  if (!loc?.database || loc.database === cur) return { rc, schema };
  return { rc: { ...rc, fields: { ...rc.fields, database: loc.database } }, schema };
}

export async function createPgTransferReaderFromConn(
  kind: 'postgresql' | 'gaussdb',
  driver: PgLikeDriver,
  rc: ResolvedConnection,
  loc?: TransferLocator,
): Promise<TransferReader> {
  const located = pgLocate(rc, loc);
  return createPgTransferReader(kind, await openPgLikePool(kind, driver, located.rc), located.schema);
}

export async function createPgTransferWriterFromConn(
  kind: 'postgresql' | 'gaussdb',
  driver: PgLikeDriver,
  rc: ResolvedConnection,
  writeMode: WriteMode,
  loc?: TransferLocator,
): Promise<TransferWriter> {
  const located = pgLocate(rc, loc);
  return createPgTransferWriter(kind, await openPgLikePool(kind, driver, located.rc), located.schema, writeMode);
}
