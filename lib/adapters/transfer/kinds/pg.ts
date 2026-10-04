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
import type {
  MidType,
  ShardKeyType,
  TransferCell,
  TransferColumn,
  TransferCursor,
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

export function createPgTransferReader(kind: 'postgresql' | 'gaussdb', pool: PgLikePool, schema: string): TransferReader {
  const q = async (sql: string, params?: unknown[]) => (await pool.query(sql, params ?? [])).rows;

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
    const columns: TransferColumn[] = rows.map((r) => ({
      name: String(r.column_name),
      midType: pgTypeToMid(String(r.data_type)),
      sourceType: String(r.data_type),
      nullable: r.is_nullable === 'YES',
      primaryKey: pkSet.has(String(r.column_name)),
      length: r.character_maximum_length == null ? undefined : Number(r.character_maximum_length),
      precision: r.numeric_precision == null ? undefined : Number(r.numeric_precision),
      scale: r.numeric_scale == null ? undefined : Number(r.numeric_scale),
      default: r.column_default == null ? null : String(r.column_default),
    }));
    return { name: tbl, columns };
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
    // truncate 模式前置清空：TRUNCATE 重置表而无行级日志开销（PG 官方文档 TRUNCATE 节）
    // 同连接先设 lock_timeout（管 MDL 与行锁）：TRUNCATE 被长事务持有时 MDL 等待默认无限；
    // TRUNCATE 拿不到锁（15s）降级 DELETE（行级锁，同一 lock_timeout 有限等待）
    beforeLoad: async (table) => {
      const client = await pool.connect();
      try {
        await client.query("SET lock_timeout = '15s'");
        try {
          await client.query(`TRUNCATE TABLE ${quoteIdent(schema)}.${quoteIdent(table.name)}`);
        } catch {
          await client.query(`DELETE FROM ${quoteIdent(schema)}.${quoteIdent(table.name)}`);
        }
      } finally {
        client.release();
      }
    },

    createTable: async (table) => {
      const defs = table.columns.map((c) => {
        let d = `${quoteIdent(c.name)} ${midToPgType(c)}`;
        if (!c.nullable) d += ' NOT NULL';
        if (c.default != null) {
          const expr = safeDefaultExpr(c.default);
          if (expr != null) d += ` DEFAULT ${expr}`;
        }
        return d;
      });
      const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => quoteIdent(c.name));
      const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
      await pool.query(`CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table.name)} (${defs.join(', ')}${pk})`);
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
