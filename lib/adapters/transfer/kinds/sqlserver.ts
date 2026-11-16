/**
 * SQL Server 传输读写端（mssql@12，底层 tedious 纯 JS TDS 实现）。
 *
 * 与 pg/mysql 端的三处 SQL Server 特有约束：
 *  1) 参数上限：TDS 单语句最多 2100 个参数，且 `VALUES` 表值构造器单语句最多 1000 行
 *     → 多行 VALUES 每语句行数 = min(floor(2100/列数), 1000)（见 sqlserverPerStmt）。
 *  2) 分页：T-SQL 无 LIMIT。2012+（主版本 >= 11）用 `ORDER BY ... OFFSET n ROWS FETCH NEXT
 *     m ROWS ONLY`；2008/2008R2（版本下限，需求要求可连各版本）无 OFFSET/FETCH，按目标库
 *     大版本探测后降级：有序游标（keyset/range/keyAt）用 `TOP (n)`，无分片键的 offset 全序
 *     用 `ROW_NUMBER() OVER (ORDER BY ...)` 子查询（见 detectSqlserverMajor / sortOrderExprs）。
 *  3) decimal：tedious 把 decimal/numeric 解析为 JS number（>15 有效位丢精度），故读端对
 *     decimal 列显式 `CONVERT(nvarchar(64), col)` 以字符串保真流转（写端字符串绑定回
 *     decimal 列由服务器隐式转换，精度不经过 JS 浮点）。
 *
 * ponytail: 目标建表不生成 IDENTITY（同 pg/mysql —— 源自增列显式插入原值，规避各家自增
 * 语义差异）；需要目标端继续自增时在 afterLoad 钩子补种子重置。
 */
import type { ResolvedConnection } from '../../types.js';
import { assertIdent } from '../../sql-shared/common.js';
import { openSqlserverRaw } from '../../sqlserver/index.js';
import type { SqlPool, SqlTransaction } from '../../sqlserver/index.js';
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

/** TDS 单语句参数上限（SQL Server Maximum Capacity Specifications：2100 个参数/请求） */
export const SQLSERVER_MAX_PARAMS = 2100;
/** `VALUES` 表值构造器单语句行数上限（官方限制：1000 行） */
export const SQLSERVER_MAX_VALUES_ROWS = 1000;

/** 多行 VALUES 每语句行数：两条上限取小。**不能只按 floor(2100/列数)**——列数 ≤2 时
 *  floor 值（2100 / 1050）会超过表值构造器 1000 行硬上限，语句被服务器直接拒绝；
 *  列数非法时兜底 1，不得产出 0 行语句。 */
export function sqlserverPerStmt(columnCount: number): number {
  const cols = Math.floor(columnCount);
  if (!Number.isFinite(cols) || cols < 1) return 1;
  return Math.max(1, Math.min(Math.floor(SQLSERVER_MAX_PARAMS / cols), SQLSERVER_MAX_VALUES_ROWS));
}

/** T-SQL 标识符：一律 [x]，内部 ] 双写为 ]]（引用标识符内唯一需要转义的字符）。
 *  sql-shared 的 quoteIdent 只支持 " 与 ` 两种库，此处按 SQL Server 方言单独实现。 */
export function sqlserverIdent(name: string): string {
  return '[' + assertIdent(name, '标识符').replaceAll(']', ']]') + ']';
}

/** information_schema.columns.data_type → 中间类型（maxLength = CHARACTER_MAXIMUM_LENGTH，
 *  -1 表示 (max)：变长字符类型归 text，避免目标端建成 NVARCHAR(255) 截断超长值） */
export function sqlserverTypeToMid(dataType: string, maxLength?: number | null): MidType {
  const t = dataType.toLowerCase();
  if (t === 'bigint') return 'bigint';
  if (t === 'int' || t === 'smallint' || t === 'tinyint') return 'int';
  if (t === 'bit') return 'boolean';
  if (t === 'decimal' || t === 'numeric' || t === 'money' || t === 'smallmoney') return 'decimal';
  if (t === 'float') return 'double';
  if (t === 'real') return 'float';
  if (t === 'date') return 'date';
  if (t === 'time') return 'time';
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') return 'datetime';
  if (t === 'datetimeoffset') return 'timestamptz';
  if (t === 'binary' || t === 'varbinary' || t === 'image' || t === 'timestamp' || t === 'rowversion') return 'bytes';
  // CLR/空间 UDT：tedious 返回 Buffer → 按 bytes 二进制保真搬运（目标端 VARBINARY(MAX)）。
  // 不归 string——binary 值按 NVARCHAR 绑定会隐式转换乱码或直接报错（静默错值比明确失败更糟）。
  // 取舍：UDT 类型语义不保留（值仍是原字节流，但目标端没有 ST_*/hierarchyid 方法）。
  // 升级路径：读端按类型显式转文本（geography::STAsText()、hierarchyid::ToString()）后归 text。
  if (t === 'hierarchyid' || t === 'geometry' || t === 'geography') return 'bytes';
  if (t === 'text' || t === 'ntext' || t === 'xml') return 'text';
  // sql_variant 存任意基础类型的值，tedious 按其实际类型返回标量（number/string/Date/Buffer），
  // 无法作为单一标量安全搬运 → 归 text，读端显式 CONVERT(nvarchar(max), col)（官方支持的转换），
  // 值以文本形态保留、不报错、不静默乱码。取舍：原类型信息丢失（写回为 NVARCHAR(MAX)）。
  if (t === 'sql_variant') return 'text';
  // 字符类型长度矩阵（源 → midType），按各类的容量上限决定是否走 (MAX)：
  //   nvarchar/nchar：n <= 4000（其 n 上限就是 4000）→ string；-1（(max)）→ text
  //   varchar/char  ：n <= 4000 → string（目标 NVARCHAR(n) 装得下）；
  //                   4000 < n <= 8000（varchar/char 的 n 上限 8000）→ text——
  //                   收敛到 NVARCHAR(4000) 会让超 4000 字符的源值在目标 INSERT 报 8152 整批失败；
  //                   -1（(max)）→ text
  if ((t === 'nvarchar' || t === 'varchar' || t === 'nchar' || t === 'char')
    && (maxLength === -1 || (maxLength != null && maxLength > 4000))) return 'text';
  return 'string'; // nvarchar/nchar/varchar/char/sysname/uniqueidentifier
}

/** 中间类型 → T-SQL 列类型（长度/精度 clamp 到 SQL Server 上限：NVARCHAR 4000、DECIMAL 精度 38） */
export function midToSqlserverType(c: TransferColumn): string {
  switch (c.midType) {
    case 'int': return 'INT';
    case 'bigint': return 'BIGINT';
    case 'decimal': {
      const p = Math.min(Math.max(Math.floor(c.precision ?? 38), 1), 38);
      const s = Math.min(Math.max(Math.floor(c.scale ?? 10), 0), p);
      return `DECIMAL(${p},${s})`;
    }
    case 'float': return 'REAL';
    case 'double': return 'FLOAT';
    case 'boolean': return 'BIT';
    case 'string': return `NVARCHAR(${Math.min(Math.max(Math.floor(c.length ?? 255), 1), 4000)})`;
    case 'text': return 'NVARCHAR(MAX)';
    case 'bytes': return 'VARBINARY(MAX)';
    case 'json': return 'NVARCHAR(MAX)';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'datetime': return 'DATETIME2';
    case 'timestamptz': return 'DATETIMEOFFSET';
  }
}

/** 中间格式日期值 → T-SQL 可解析形态：ISO 带 'Z' 后缀（pg/oralike/mongo 的 materialize
 *  产出）在 T-SQL 里不是合法 datetime 字面量（隐式转换报错）——剥离为 UTC 墙钟，
 *  保留 'T' 分隔（T-SQL 官方接受的 ISO 8601 形态），非日期形态/无 Z 原样。 */
export function toSqlserverDateTime(s: string): string {
  return s.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z$/i, '$1T$2');
}

/** 绑定值形态：bigint→十进制字符串（不经 JS number 通道，防 >2^53 丢精度）、
 *  bytes→Buffer、日期列 ISO 'Z' → T-SQL 墙钟；decimal 值本就以字符串流转（读端 CONVERT），
 *  直接绑定由服务器隐式转换回 decimal 列，精度不经过 JS 浮点。 */
export function toSqlserverBind(c: TransferCell, col?: TransferColumn): string | number | boolean | null | Buffer {
  if (c === null) return null;
  if (typeof c === 'bigint') return c.toString();
  if (typeof c === 'boolean') return c;
  if (c instanceof Uint8Array) return Buffer.from(c);
  if (
    typeof c === 'string' && col != null &&
    (col.midType === 'date' || col.midType === 'time' || col.midType === 'datetime' || col.midType === 'timestamptz')
  ) {
    return toSqlserverDateTime(c);
  }
  return c;
}

/** 单元格保真：tedious 的 Date → ISO 字符串（与 pg/oralike 读端同一中间格式约定）；
 *  Buffer 是 Uint8Array 子类，直接进中间模型。 */
function materialize(v: unknown): TransferCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v as TransferCell;
}

/** OFFSET/FETCH 的 n 必须是字面整数（不可绑定）：非有限数/越界一律钳到 min，
 *  防 NaN/负数拼进 SQL 破坏语法 */
function inlineInt(v: number, min: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > min ? n : min;
}

/** 锁等待类错误号：1222 = Lock request time out period exceeded（官方），
 *  1221 = Lock request time out（兼容旧形态），1205 = 死锁牺牲品。只有这些能安全降级
 *  DELETE（表被长时间占用）；权限(229)/对象不存在(208)/语法等失败必须上抛。 */
const SQLSERVER_LOCK_WAIT_NUMBERS: ReadonlySet<number> = new Set([1222, 1221, 1205]);

/** 驱动错误号：mssql 的 RequestError.number 在顶层；部分路径（连接级/包装错误）只在
 *  originalError 上带 number，故沿 originalError 链找一层（两种形态都要能识别，
 *  否则权限类错误会被当成"无错误号"落到文案兜底 → 误降级）。 */
function errorNumber(e: unknown): number | undefined {
  const candidates: unknown[] = [e, (e as { originalError?: unknown } | null | undefined)?.originalError];
  for (const cand of candidates) {
    const n = (cand as { number?: unknown } | null | undefined)?.number;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
    if (typeof n === 'string' && /^\d+$/.test(n)) return Number(n);
  }
  return undefined;
}

/** 是否锁等待失败（可降级 DELETE）：优先按错误号；驱动偶尔丢 number 时按文案兜底
 *  （文案只认锁超时/死锁，避免把权限等失败误判为可降级） */
function isLockWaitError(e: unknown): boolean {
  const num = errorNumber(e);
  if (num != null) return SQLSERVER_LOCK_WAIT_NUMBERS.has(num);
  const inner = (e as { originalError?: unknown } | null | undefined)?.originalError;
  const msgs = [
    e instanceof Error ? e.message : String(e),
    inner instanceof Error ? inner.message : '',
  ];
  return msgs.some((m) => /lock request time out|deadlock|死锁/i.test(m));
}

/** 是否外键引用导致的 TRUNCATE 失败（Msg 4712，可降级 DELETE）：TRUNCATE 官方限制
 *  「being referenced by a FOREIGN KEY constraint」；与锁等待同口径——只在确定可安全
 *  换 DELETE 的失败形态下降级，权限/对象不存在等仍上抛。 */
function isForeignKeyTruncateError(e: unknown): boolean {
  const num = errorNumber(e);
  if (num != null) return num === 4712;
  const inner = (e as { originalError?: unknown } | null | undefined)?.originalError;
  const msgs = [
    e instanceof Error ? e.message : String(e),
    inner instanceof Error ? inner.message : '',
  ];
  return msgs.some((m) => /referenced by a foreign key/i.test(m));
}

/** sql_variant 列：驱动按值的实际类型返回标量（number/string/Date/Buffer），必须显式转文本
 *  才能统一搬运（映射归 text，见 sqlserverTypeToMid） */
function isVariant(c: TransferColumn): boolean {
  return (c.sourceType ?? '').toLowerCase() === 'sql_variant';
}

/** 时间类列的保真读表达式（与 decimal 同款「读端显式转换」口径）：CONVERT(…, 126) 输出
 *  ISO 8601 墙钟文本——datetime2/time 的小数位最多 7 位（100ns），而 tedious 把它们解析成
 *  JS Date（只有毫秒），亚毫秒会被静默截断；转文本后原样流转，写端按 NVarChar 绑定回
 *  datetime2 由服务器隐式转换，精度不经过 JS Date 通道。顺带避免 Date→toISOString 把墙钟
 *  按插件进程时区解释（文件头提到的时间语义隐患）。
 *  nvarchar(33)：datetime2 的 126 形态 'YYYY-MM-DDThh:mm:ss.fffffff'（27）+ datetimeoffset
 *  的时区后缀 '+hh:mm'（6）都装得下；time 的 126 形态 'hh:mm:ss.fffffff'（16）。 */
function timeConvertExpr(c: TransferColumn, id: string): string | null {
  if (c.midType === 'datetime' || c.midType === 'timestamptz') return `CONVERT(nvarchar(33), ${id}, 126)`;
  if (c.midType === 'time') return `CONVERT(nvarchar(16), ${id}, 126)`;
  return null;
}

/** decimal 列读表达式：显式转 nvarchar 保真（tedious 默认把 decimal 解析为 JS number）。
 *  nvarchar(64) 足以容纳 decimal(38,38) 的完整十进制表示。 */
function readExpr(c: TransferColumn): string {
  const id = sqlserverIdent(c.name);
  if (c.midType === 'decimal') return `CONVERT(nvarchar(64), ${id})`;
  if (isVariant(c)) return `CONVERT(nvarchar(max), ${id})`;
  return timeConvertExpr(c, id) ?? id;
}

/** 子查询场景的读表达式：表达式必须带列别名（否则内层结果列无名字，外层无法引用） */
function aliasedExpr(c: TransferColumn): string {
  const id = sqlserverIdent(c.name);
  if (c.midType === 'decimal') return `CONVERT(nvarchar(64), ${id}) AS ${id}`;
  if (isVariant(c)) return `CONVERT(nvarchar(max), ${id}) AS ${id}`;
  const t = timeConvertExpr(c, id);
  return t ? `${t} AS ${id}` : id;
}

/** OFFSET/FETCH 从 SQL Server 2012（主版本 11）引入；主版本 < 11 或无版本探测结果走降级 */
const SQLSERVER_MIN_MAJOR_FOR_OFFSET_FETCH = 11;

/** 2008 降级 offset 分页的排序表达式：按可排序的普通列排序，使分页顺序确定、不重不漏。
 *  text/ntext/image/xml/geography/geometry 不能用于 ORDER BY，排除；极端表（全部列都不可
 *  排序）才退回 `(SELECT NULL)`——ROW_NUMBER 的 OVER 子句必须有排序表达式，这是不指定顺序
 *  时的最小占位（2005+ 可用，但与 2012+ 路径同样不保证跨批稳定，故仅作最后兜底）。 */
function sortOrderExprs(columns: TransferColumn[]): string {
  const notSortable = new Set(['text', 'ntext', 'image', 'xml', 'geography', 'geometry']);
  const sortable = columns.filter((c) => !notSortable.has((c.sourceType ?? '').toLowerCase()));
  return sortable.length > 0 ? sortable.map((c) => sqlserverIdent(c.name)).join(', ') : '(SELECT NULL)';
}

/** 版本属性 → 主版本号。ProductMajorVersion 是 2012+ 才有的属性（2008 返回 NULL），
 *  回退解析 ProductVersion 前缀（'10.50.1600.1' → 10）；两者都判不出返回 0（调用方按
 *  0 走保守降级，保证老版本/权限受限时仍可传输）。 */
export function sqlserverMajorFromProps(majorProp: unknown, productVersion: unknown): number {
  const m = Number(majorProp);
  if (Number.isFinite(m) && m > 0) return Math.floor(m);
  const s = typeof productVersion === 'string' ? productVersion : String(productVersion ?? '');
  const hit = /^\s*(\d+)/.exec(s);
  const v = hit ? Number(hit[1]) : Number.NaN;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 目标库主版本探测：两次属性查询均失败 → 0（保守降级）。只查一次，结果由 reader 闭包缓存
 *  （readBatch/keyAt 高频调用，不能每批重复探测）。 */
async function detectSqlserverMajor(pool: SqlPool): Promise<number> {
  const propOf = async (name: string): Promise<unknown> => {
    try {
      const res = await pool.request().query(`SELECT SERVERPROPERTY('${name}') AS v`);
      const rows = (res.recordset ?? []) as Record<string, unknown>[];
      return rows[0]?.v;
    } catch {
      return null; // 属性不存在 / 权限不足 → 交由回退链
    }
  };
  const majorProp = await propOf('ProductMajorVersion');
  const fromMajorProp = sqlserverMajorFromProps(majorProp, null);
  if (fromMajorProp > 0) return fromMajorProp;
  return sqlserverMajorFromProps(majorProp, await propOf('ProductVersion'));
}

export function createSqlserverTransferReader(pool: SqlPool, schema: string): TransferReader {
  const sch = assertIdent(schema, '模式名');
  const tblOf = (table: string): string => `${sqlserverIdent(sch)}.${sqlserverIdent(table)}`;
  // 版本探测结果缓存（Promise 缓存：并发首批只探测一次）
  let majorPromise: Promise<number> | undefined;
  const major = (): Promise<number> => (majorPromise ??= detectSqlserverMajor(pool));

  const q = async (sql: string, binds?: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
    const req = pool.request();
    for (const [k, v] of Object.entries(binds ?? {})) req.input(k, v);
    const res = await req.query(sql);
    return (res.recordset ?? []) as Record<string, unknown>[];
  };

  const describe = async (table: string): Promise<TransferTable> => {
    const tbl = assertIdent(table, '表名');
    const rows = await q(
      `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
              c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE,
              COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)),
                             c.COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY
       FROM INFORMATION_SCHEMA.COLUMNS c
       WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
       ORDER BY c.ORDINAL_POSITION`,
      { schema: sch, table: tbl },
    );
    if (rows.length === 0) throw new Error(`表不存在: ${sch}.${tbl}`);
    const pkRows = await q(
      `SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
       JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND kcu.TABLE_NAME = tc.TABLE_NAME
       WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = @schema AND tc.TABLE_NAME = @table
       ORDER BY kcu.ORDINAL_POSITION`,
      { schema: sch, table: tbl },
    );
    const pkSet = new Set(pkRows.map((r) => String(r.COLUMN_NAME)));
    const columns: TransferColumn[] = rows.map((r) => {
      const dataType = String(r.DATA_TYPE ?? '');
      const lower = dataType.toLowerCase();
      const charLen = r.CHARACTER_MAXIMUM_LENGTH == null ? undefined : Number(r.CHARACTER_MAXIMUM_LENGTH);
      const numeric = lower === 'decimal' || lower === 'numeric' || lower === 'money' || lower === 'smallmoney';
      return {
        name: String(r.COLUMN_NAME),
        midType: sqlserverTypeToMid(dataType, charLen),
        sourceType: dataType,
        nullable: r.IS_NULLABLE === true || r.IS_NULLABLE === 'YES' || r.IS_NULLABLE === 1,
        primaryKey: pkSet.has(String(r.COLUMN_NAME)),
        autoIncrement: r.IS_IDENTITY === true || r.IS_IDENTITY === 1,
        length: charLen == null || charLen < 0 ? undefined : charLen,
        precision: numeric && r.NUMERIC_PRECISION != null ? Number(r.NUMERIC_PRECISION) : undefined,
        scale: numeric && r.NUMERIC_SCALE != null ? Number(r.NUMERIC_SCALE) : undefined,
        default: r.COLUMN_DEFAULT == null ? null : String(r.COLUMN_DEFAULT),
      };
    });
    return { name: tbl, columns };
  };

  return {
    kind: 'sqlserver',

    listTables: async () => {
      const rows = await q(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
        { schema: sch },
      );
      return rows.map((r) => String(r.TABLE_NAME));
    },

    describe,

    count: async (table) => {
      // COUNT_BIG：COUNT 的 int 返回值在 >21 亿行时溢出
      const rows = await q(`SELECT COUNT_BIG(*) AS n FROM ${tblOf(assertIdent(table, '表名'))}`);
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
      const tbl = tblOf(t.name);
      const cols = t.columns.map(readExpr).join(', ');
      const n = inlineInt(limit, 1);
      const legacy = (await major()) < SQLSERVER_MIN_MAJOR_FOR_OFFSET_FETCH;
      let sql: string;
      let binds: Record<string, unknown>;
      if (cursor.mode === 'keyset') {
        const key = sqlserverIdent(cursor.column);
        binds = cursor.after === null ? {} : { after: toSqlserverBind(cursor.after) };
        const where = cursor.after === null ? '' : ` WHERE ${key} > @after`;
        // 2008 无 OFFSET/FETCH：有序取前 n 行就是 TOP (n)，无需 ROW_NUMBER
        sql = legacy
          ? `SELECT TOP (${n}) ${cols} FROM ${tbl}${where} ORDER BY ${key}`
          : `SELECT ${cols} FROM ${tbl}${where} ORDER BY ${key} OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY`;
      } else if (cursor.mode === 'range') {
        const key = sqlserverIdent(cursor.column);
        const conds: string[] = [];
        const b: Record<string, unknown> = {};
        if (cursor.lo !== null) {
          const nm = `p${Object.keys(b).length}`;
          conds.push(`${key} ${cursor.loInclusive ? '>=' : '>'} @${nm}`);
          b[nm] = toSqlserverBind(cursor.lo);
        }
        if (cursor.hi !== null) {
          const nm = `p${Object.keys(b).length}`;
          conds.push(`${key} < @${nm}`);
          b[nm] = toSqlserverBind(cursor.hi);
        }
        const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
        sql = legacy
          ? `SELECT TOP (${n}) ${cols} FROM ${tbl}${where} ORDER BY ${key}`
          : `SELECT ${cols} FROM ${tbl}${where} ORDER BY ${key} OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY`;
        binds = b;
      } else {
        const off = inlineInt(cursor.offset, 0);
        binds = {};
        if (legacy) {
          // 2008 降级：ROW_NUMBER 子查询取 (off, off+n] 行（无 OFFSET/FETCH 可用）；
          // 外层按 rn 取列，排序表达式见 sortOrderExprs（不依赖 OFFSET 子句的 (SELECT NULL)）
          sql = `SELECT ${t.columns.map((c) => sqlserverIdent(c.name)).join(', ')} FROM (`
            + `SELECT ${t.columns.map(aliasedExpr).join(', ')}, ROW_NUMBER() OVER (ORDER BY ${sortOrderExprs(t.columns)}) AS [__dbt_rn]`
            + ` FROM ${tbl}) AS [__dbt_paged] WHERE [__dbt_rn] > ${off} AND [__dbt_rn] <= ${off + n} ORDER BY [__dbt_rn]`;
        } else {
          // 无分片键的 offset 全序：OFFSET/FETCH 强制要求 ORDER BY，(SELECT NULL) 为不排序占位
          sql = `SELECT ${cols} FROM ${tbl} ORDER BY (SELECT NULL)
                 OFFSET ${off} ROWS FETCH NEXT ${n} ROWS ONLY`;
        }
      }
      const rows = await q(sql, binds);
      return rows.map((r) => t.columns.map((c) => materialize(r[c.name])));
    },

    keyAt: async (table, column, offset) => {
      const t = await describe(table);
      const keyCol = t.columns.find((c) => c.name === column);
      const key = sqlserverIdent(assertIdent(column, '分片键'));
      const keyExpr = keyCol ? readExpr(keyCol) : key;
      const target = tblOf(assertIdent(table, '表名'));
      const off = inlineInt(offset, 0);
      // 2008 降级：ROW_NUMBER 按分片键排序定位第 off+1 行（keyAt 语义本就是按该键排序取第 offset 行）
      const rows = (await major()) < SQLSERVER_MIN_MAJOR_FOR_OFFSET_FETCH
        ? await q(`SELECT TOP (1) [k] FROM (SELECT ${keyExpr} AS [k], ROW_NUMBER() OVER (ORDER BY ${key}) AS [__dbt_rn]`
            + ` FROM ${target}) AS [__dbt_paged] WHERE [__dbt_rn] = ${off + 1}`)
        : await q(`SELECT ${keyExpr} AS k FROM ${target}
             ORDER BY ${key} OFFSET ${off} ROWS FETCH NEXT 1 ROWS ONLY`);
      return materialize(rows[0]?.k ?? null);
    },

    close: async () => {
      await pool.close();
    },
  };
}

export function createSqlserverTransferWriter(
  pool: SqlPool,
  openTx: () => SqlTransaction,
  schema: string,
  writeMode: WriteMode = 'insert',
): TransferWriter {
  const sch = assertIdent(schema, '模式名');
  const tblOf = (name: string): string => `${sqlserverIdent(sch)}.${sqlserverIdent(assertIdent(name, '表名'))}`;

  const q = async (sql: string, binds?: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
    const req = pool.request();
    for (const [k, v] of Object.entries(binds ?? {})) req.input(k, v);
    const res = await req.query(sql);
    return (res.recordset ?? []) as Record<string, unknown>[];
  };

  return {
    kind: 'sqlserver',

    tableExists: async (name) => {
      const rows = await q(
        `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table`,
        { schema: sch, table: assertIdent(name, '表名') },
      );
      return Number(rows[0]?.n ?? 0) > 0;
    },

    dropTable: async (name) => {
      await q(`DROP TABLE ${tblOf(name)}`);
    },

    // 循环外键表组整组删除：SQL Server 官方单语句多表 DROP TABLE T1, T2 可删除
    // 相互外键引用的表组（MS Learn DROP TABLE）；单表删除被引用表会被 Msg 3726 拦截
    dropTables: async (names) => {
      await q(`DROP TABLE ${names.map((n) => tblOf(assertIdent(n, '表名'))).join(', ')}`);
    },

    // truncate 模式前置清空：TRUNCATE 表级锁被长事务持有时默认无限等待——同一事务（同一连接）
    // 内先 SET LOCK_TIMEOUT 15000（毫秒），**只有锁等待类失败**才降级 DELETE FROM（行级锁，
    // 同一 15s 上限内有限等待）。权限(229)/对象不存在(208) 等失败上抛：静默换 DELETE 会改变
    // 语义（DELETE 不重置 IDENTITY 种子 → truncate 模式名不副实）并掩盖真实错误。
    // SET LOCK_TIMEOUT 是会话级设置，连接回池后不自动复位 → 成功路径结束前显式恢复默认
    // （-1 = 无限等待），避免把 15s 上限带给后续无关请求。
    beforeLoad: async (name) => {
      const tbl = tblOf(assertIdent(name, '表名'));
      const tx = openTx();
      await tx.begin();
      try {
        await tx.request().query('SET LOCK_TIMEOUT 15000');
        try {
          await tx.request().query(`TRUNCATE TABLE ${tbl}`);
        } catch (e) {
          if (!isLockWaitError(e) && !isForeignKeyTruncateError(e)) {
            const num = errorNumber(e);
            throw new Error(
              `TRUNCATE TABLE ${sch}.${name} 失败${num != null ? `（错误号 ${num}）` : ''}，`
              + `未降级 DELETE（仅锁等待超时与外键引用才降级）：${e instanceof Error ? e.message : String(e)}`,
            );
          }
          // 外键引用（Msg 4712）与锁等待同口径降级 DELETE：依赖排序由编排层先行，
          // 选择集内子表已先清空，DELETE 不再被引用拦截；注意 DELETE 不重置 IDENTITY
          // 种子（truncate 模式在该表上的语义损失，与 mysql/pg/oralike 降级路径一致）
          await tx.request().query(`DELETE FROM ${tbl}`);
        }
        await tx.request().query('SET LOCK_TIMEOUT -1');
        await tx.commit();
      } catch (e) {
        // ponytail: 失败路径下事务对象 rollback 后不可复用，无法在同一连接上复位 LOCK_TIMEOUT
        //（残留 15s 有限上限，不构成无限等待；且这是清空失败本身的异常路径）。
        // 升级路径：若必须严格复位，改用专用连接并在 finally 里无条件 SET -1。
        await tx.rollback().catch(() => {});
        throw e;
      }
    },

    createTable: async (table) => {
      if (table.columns.length === 0) {
        throw new Error(`表 ${table.name} 无列定义，无法建表（源表结构为空？）`);
      }
      const defs = table.columns.map((c) => {
        let d = `${sqlserverIdent(c.name)} ${midToSqlserverType(c)}`;
        if (!c.nullable) d += ' NOT NULL';
        if (c.default != null) {
          const expr = safeDefaultExpr(c.default);
          if (expr != null) d += ` DEFAULT ${expr}`;
        }
        return d;
      });
      const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => sqlserverIdent(c.name));
      const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
      await q(`CREATE TABLE ${tblOf(table.name)} (${defs.join(', ')}${pk})`);
    },

    // 目标端外键依赖边：sys.foreign_keys 官方目录视图（parent=引用方 / referenced=被引用方），
    // 限定同 schema 内（跨 schema 引用与选择集排序无关）
    listForeignKeys: async () => {
      const rows = await q(
        `SELECT pt.name AS table_name, rt.name AS referenced_table
         FROM sys.foreign_keys fk
         JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
         JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
         JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
         JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
         WHERE ps.name = @schema AND rs.name = @schema`,
        { schema: sch },
      );
      return rows.map((r) => ({
        table: String(r.table_name ?? ''),
        referencedTable: String(r.referenced_table ?? ''),
      }));
    },

    writeBatch: async (table, rows: TransferRow[]) => {
      if (rows.length === 0) return 0;
      const cols = table.columns;
      if (cols.length === 0) {
        throw new Error(`表 ${table.name} 无列定义，无法写入（源表结构为空？）`);
      }
      const width = cols.length;
      for (const r of rows) {
        if (r.length !== width) {
          throw new Error(`行宽不匹配：期望 ${width} 列，实际 ${r.length} 列（表 ${table.name}）`);
        }
      }
      const colIds = cols.map((c) => sqlserverIdent(c.name));
      const pkIds = cols.filter((c) => c.primaryKey).map((c) => sqlserverIdent(c.name));
      if (writeMode === 'replace' && pkIds.length === 0) {
        throw new Error(`replace 模式需要主键：表 ${table.name} 无主键`);
      }
      // T-SQL 无 INSERT IGNORE / ON CONFLICT：ignore/replace 用 MERGE（官方 upsert 形态）。
      // MERGE 需要冲突判定键；ignore 无主键时无重复可判，退化为纯 INSERT（同 pg 无冲突目标语义）。
      const useMerge = writeMode !== 'insert' && pkIds.length > 0;
      const perStmt = sqlserverPerStmt(width);
      const tbl = tblOf(table.name);
      const colList = colIds.join(', ');
      const tx = openTx();
      await tx.begin();
      try {
        let written = 0;
        for (let i = 0; i < rows.length; i += perStmt) {
          const chunk = rows.slice(i, i + perStmt);
          const holders = chunk
            .map((_, ri) => `(${cols.map((_, ci) => `@p${ri * width + ci}`).join(', ')})`)
            .join(', ');
          let sql: string;
          if (!useMerge) {
            sql = `INSERT INTO ${tbl} (${colList}) VALUES ${holders}`;
          } else {
            const srcList = colIds.map((id) => `src.${id}`).join(', ');
            const on = pkIds.map((k) => `tgt.${k} = src.${k}`).join(' AND ');
            const updaters = cols.filter((c) => !c.primaryKey);
            // 全主键列时 WHEN MATCHED 无列可更新（MERGE 语法要求 UPDATE SET 至少一列）→ 只保留未匹配插入
            const matched = writeMode === 'replace' && updaters.length > 0
              ? ` WHEN MATCHED THEN UPDATE SET ${updaters.map((c) => `tgt.${sqlserverIdent(c.name)} = src.${sqlserverIdent(c.name)}`).join(', ')}`
              : '';
            // WITH (HOLDLOCK)：MERGE 在并发下的已知竞态缓解（官方推荐的序列化提示）。
            // ponytail: MERGE 要求同一目标行在本语句内不被匹配多次——源表主键唯一时成立；
            // 源数据批内自重复会报错并整批回滚（不静默丢数据，符合失败可见原则）。
            // 升级路径：改 INSERT + 显式 UPDATE 两步，换更宽松的批内语义。
            sql = `MERGE INTO ${tbl} WITH (HOLDLOCK) AS tgt USING (VALUES ${holders}) AS src (${colList})`
              + ` ON ${on}${matched} WHEN NOT MATCHED THEN INSERT (${colList}) VALUES (${srcList});`;
          }
          const req = tx.request();
          chunk.forEach((r, ri) => {
            r.forEach((v, ci) => {
              req.input(`p${ri * width + ci}`, toSqlserverBind(v, cols[ci]));
            });
          });
          const res = await req.query(sql);
          written += (res.rowsAffected ?? []).reduce((a: number, b: number) => a + b, 0);
        }
        await tx.commit();
        return written;
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      }
    },

    close: async () => {
      await pool.close();
    },
  };
}

/** 定位解析：schema = loc.schema（assertIdent 拒绝空串/换行）?? 连接 schema ?? dbo；
 *  database ≠ 连接库时浅拷贝 rc 仅覆盖 fields.database（与 pgLocate 同款，由 openSqlserverRaw
 *  按该字段决定连接的默认库）。 */
export function sqlserverLocate(rc: ResolvedConnection, loc?: TransferLocator): { rc: ResolvedConnection; schema: string } {
  const s = rc.fields?.schema;
  const schema = loc?.schema != null ? assertIdent(loc.schema, '模式名') : (typeof s === 'string' && s ? s : 'dbo');
  const cur = rc.fields?.database != null ? String(rc.fields.database) : undefined;
  if (!loc?.database || loc.database === cur) return { rc, schema };
  return { rc: { ...rc, fields: { ...rc.fields, database: loc.database } }, schema };
}

export async function createSqlserverTransferReaderFromConn(
  rc: ResolvedConnection,
  loc?: TransferLocator,
): Promise<TransferReader> {
  const located = sqlserverLocate(rc, loc);
  const raw = await openSqlserverRaw(located.rc);
  await raw.ready(); // 首次 request 前必须建连（否则池以 ENOTOPEN 拒绝）
  return createSqlserverTransferReader(raw.pool, located.schema);
}

export async function createSqlserverTransferWriterFromConn(
  rc: ResolvedConnection,
  writeMode: WriteMode,
  loc?: TransferLocator,
): Promise<TransferWriter> {
  const located = sqlserverLocate(rc, loc);
  const raw = await openSqlserverRaw(located.rc);
  await raw.ready();
  // 每次写入批新建事务对象：mssql 的事务 commit/rollback 后不可复用
  return createSqlserverTransferWriter(raw.pool, () => new raw.driver.Transaction(raw.pool), located.schema, writeMode);
}
