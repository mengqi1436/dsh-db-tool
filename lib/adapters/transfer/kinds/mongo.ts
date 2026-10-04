/**
 * MongoDB 传输读写端。
 *
 * 无强 schema：结构经抽样推断（describe），目标端以 $jsonSchema validator 承载
 * 结构与字段属性（required = 非 nullable 列）。评审修正均已落实：
 *  - #2 NULL → 省略字段（bsonType 精确匹配不含 null，写 {col:null} 必被 strict 拒绝）；
 *  - #3 object/array → 读端 JSON 字符串化、写端 parse 复原（TransferCell 不扩 object）；
 *  - #4 分片键 _id 类型唯一性检查：混 BSON 类型（ObjectId 与 string 并存）返回 null
 *    降级单 worker，防按 ObjectId 区间切分时区间外类型静默漏行。
 *
 * ponytail: mongo 无跨 bulkWrite 事务（事务需副本集），批次部分成功无回滚——失败
 * 恢复交给编排层的分片级重试（keyset 幂等语义）；单文件库（standalone）亦不支持
 * 事务，该设计对两种部署形态行为一致。
 */
import type { ResolvedConnection } from '../../types.js';
import { openMongoRaw, type MongoRaw } from '../../mongodb/index.js';
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

const SAMPLE_LIMIT = 50;

/** BSON 值 → 中间类型（抽样推断用；null 不参与类型判定） */
function bsonToMid(v: unknown, M: MongoRaw['M']): MidType | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'bigint') return 'bigint';
  if (v instanceof Date) return 'datetime';
  if (v instanceof M.ObjectId) return 'string';
  if (v instanceof M.Long) return 'bigint';
  if (v instanceof M.Decimal128) return 'decimal';
  if (v instanceof M.Binary) return 'bytes';
  if (Array.isArray(v) || typeof v === 'object') return 'json';
  return 'string';
}

/** 行值保真转换（读端）：按列 midType 目标形态输出 */
function bsonToCell(v: unknown, midType: MidType, M: MongoRaw['M']): TransferCell {
  if (v === null || v === undefined) return null;
  if (v instanceof M.ObjectId) return v.toHexString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof M.Long) return v.toBigInt();
  if (v instanceof M.Decimal128) return v.toString();
  if (v instanceof M.Binary) return new Uint8Array(v.buffer.buffer, v.buffer.byteOffset, v.buffer.byteLength);
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return JSON.stringify(v);
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    // 混类型列推断为 int 但实际 double：值原样（number 涵盖 int）
    return midType === 'bigint' ? BigInt(Math.trunc(v)) : v;
  }
  return String(v);
}

/** 中间类型 → $jsonSchema bsonType（json 列接受 object/array 两形态，写端 parse 复原） */
function midToBsonType(t: MidType): string | string[] {
  switch (t) {
    case 'int': return 'int';
    case 'bigint': return 'long';
    case 'decimal': return 'decimal';
    case 'float':
    case 'double': return 'double';
    case 'boolean': return 'bool';
    case 'bytes': return 'binData';
    case 'json': return ['object', 'array'];
    case 'date':
    case 'datetime':
    case 'timestamptz': return 'date';
    default: return 'string'; // string/text/time
  }
}

/** 写端值转换：SQL 形态 → BSON 形态。null 返回 SKIP（省略字段，评审 #2） */
const SKIP = Symbol('skip');

/** 无时区日期串补 UTC 语义：空格墙钟（'2024-01-01 10:00:00'）与 ISO 无时区
 *  （'2024-01-01T10:00:00'）在 V8 均按插件进程本地时区解析——跨库传输的墙钟统一
 *  UTC 语义（mysql 读端 time_zone=+00:00、sqlite TEXT 约定），已带时区的原样解析 */
export function toUtcParse(s: string): string {
  const t = s.trim();
  if (/[Zz]$/.test(t) || /[+-]\d{2}:?\d{2}$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T00:00:00Z`;
  return `${t.replace(' ', 'T')}Z`;
}

export function cellToBson(c: TransferCell, midType: MidType, M: MongoRaw['M']): unknown {
  if (c === null) return SKIP;
  if (c instanceof Uint8Array) return new M.Binary(c);
  if (typeof c === 'bigint') return M.Long.fromString(c.toString());
  if (typeof c === 'boolean' || typeof c === 'number') return c;
  if (midType === 'json') {
    if (typeof c !== 'string') return c;
    try {
      return JSON.parse(c);
    } catch {
      return c; // 非法 JSON 原样字符串（bsonType 校验会拒绝并进失败清单，不静默）
    }
  }
  if (midType === 'date' || midType === 'datetime' || midType === 'timestamptz') {
    const d = new Date(typeof c === 'string' ? toUtcParse(c) : c);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`非法日期值「${c}」（${midType} 列）：无法解析为时间`);
    }
    return d;
  }
  if (midType === 'decimal' && typeof c === 'string') return M.Decimal128.fromString(c);
  return c;
}

/** 读 own 属性值：BSON 反序列化允许 __proto__ 等保留名为 own property，
 *  普通 doc[k] 访问会命中原型 getter 读出错误值 */
function ownValue(doc: Record<string, unknown>, k: string): unknown {
  return Object.hasOwn(doc, k) ? Object.getOwnPropertyDescriptor(doc, k)?.value : undefined;
}

export function createMongoTransferReader(raw: MongoRaw): TransferReader {
  const { db, M } = raw;

  const describe = async (name: string): Promise<TransferTable> => {
    const coll = db.collection(name);
    const sample = (await coll.find({}).limit(SAMPLE_LIMIT).toArray()) as Record<string, unknown>[];
    // 字段并集（首次出现顺序）+ 类型推断（首个非 null 类型）
    const cols = new Map<string, MidType>();
    const present = new Map<string, number>();
    for (const doc of sample) {
      for (const [k, v] of Object.entries(doc)) {
        if (!cols.has(k)) {
          cols.set(k, bsonToMid(v, M) ?? 'string');
          present.set(k, 0);
        }
        if (v !== null && v !== undefined) present.set(k, (present.get(k) ?? 0) + 1);
      }
    }
    if (!cols.has('_id')) {
      cols.set('_id', 'string');
      present.set('_id', 0);
    }
    const columns: TransferColumn[] = [...cols.entries()].map(([fieldName, midType]) => ({
      name: fieldName,
      midType,
      sourceType: midType === 'json' ? 'object|array (inferred)' : `${midType} (inferred)`,
      // 抽样缺失 = 可空；样本为空时按可空（required 从无样本推断不安全）；_id 恒非空
      nullable: fieldName === '_id' ? false : sample.length === 0 || (present.get(fieldName) ?? 0) < sample.length,
      primaryKey: fieldName === '_id',
    }));
    return { name, columns };
  };

  // _id 的原始 BSON 形态（keyset 游标 after 还原用）；混类型 = null（不分片）
  const idKindCache = new Map<string, 'ObjectId' | 'string' | 'number' | 'Long' | null>();

  return {
    kind: 'mongodb',

    listTables: async () => {
      const infos = (await db.listCollections().toArray()) as Array<{ name: string; type?: string }>;
      return infos.filter((c) => c.type !== 'view').map((c) => c.name);
    },

    describe,

    count: async (name) => {
      return db.collection(name).countDocuments({});
    },

    shardKey: async (name) => {
      // _id 是 mongo 唯一可靠的分片键；类型唯一才可用（评审 #4）
      const coll = db.collection(name);
      const sample = (await coll.find({}).limit(SAMPLE_LIMIT).toArray()) as Record<string, unknown>[];
      const kinds = new Set<string>();
      for (const doc of sample) {
        const v = doc._id;
        if (v instanceof M.ObjectId) kinds.add('ObjectId');
        else if (typeof v === 'string') kinds.add('string');
        else if (typeof v === 'number') kinds.add('number');
        else if (v instanceof M.Long) kinds.add('Long');
        else if (v !== null && v !== undefined) kinds.add('other');
      }
      const kindsArr = [...kinds];
      const kind = kindsArr.length === 1 ? (kindsArr[0] as 'ObjectId' | 'string' | 'number' | 'Long') : null;
      idKindCache.set(name, kind);
      switch (kind) {
        case 'ObjectId':
        case 'string':
          return 'string';
        case 'number':
          return 'int';
        case 'Long':
          return 'bigint';
        default:
          return null; // 混类型/空集合：单 worker offset 全序
      }
    },

    readBatch: async (name, cursor: TransferCursor, limit: number) => {
      const t = await describe(name);
      const coll = db.collection(name);
      if (cursor.mode === 'keyset' || cursor.mode === 'range') {
        const idKind = idKindCache.get(name) ?? 'ObjectId';
        const restore = (cell: TransferCell): unknown => {
          let v: unknown = cell;
          if (idKind === 'ObjectId' && typeof v === 'string') v = new M.ObjectId(v);
          if (idKind === 'Long' && typeof v === 'bigint') v = M.Long.fromString(v.toString());
          return v;
        };
        if (cursor.mode === 'keyset') {
          const filter = cursor.after === null ? {} : ({ _id: { $gt: restore(cursor.after) } } as never);
          const docs = (await coll.find(filter).sort({ _id: 1 }).limit(limit).toArray()) as Record<string, unknown>[];
          return docs.map((doc) => t.columns.map((c) => bsonToCell(ownValue(doc, c.name), c.midType, M)));
        }
        // range：hi 端恒开区间；lo 按 loInclusive 取 $gte/$gt（分片首批含下界）
        const cond: Record<string, unknown> = {};
        if (cursor.lo !== null) cond[cursor.loInclusive ? '$gte' : '$gt'] = restore(cursor.lo);
        if (cursor.hi !== null) cond.$lt = restore(cursor.hi);
        const docs = (await coll
          .find(Object.keys(cond).length > 0 ? ({ _id: cond } as never) : {})
          .sort({ _id: 1 })
          .limit(limit)
          .toArray()) as Record<string, unknown>[];
        return docs.map((doc) => t.columns.map((c) => bsonToCell(ownValue(doc, c.name), c.midType, M)));
      }
      const docs = (await coll
        .find({})
        .sort({ _id: 1 })
        .skip(cursor.offset)
        .limit(limit)
        .toArray()) as Record<string, unknown>[];
      return docs.map((doc) => t.columns.map((c) => bsonToCell(ownValue(doc, c.name), c.midType, M)));
    },

    keyAt: async (name, column, offset) => {
      const coll = db.collection(name);
      const docs = (await coll.find({}).sort({ _id: 1 }).skip(offset).limit(1).toArray()) as Record<string, unknown>[];
      if (docs.length === 0) return null;
      return bsonToCell(ownValue(docs[0]!, column), 'string', M);
    },

    close: async () => {
      await raw.client.close();
    },
  };
}

export function createMongoTransferWriter(raw: MongoRaw, writeMode: WriteMode = 'insert'): TransferWriter {
  const { db, M } = raw;

  /** 单列主键列（写为 _id）；复合/无主键返回 undefined（mongo 自动 _id，原主键列按普通字段存） */
  function idColumn(t: TransferTable): TransferColumn | undefined {
    const pks = t.columns.filter((c) => c.primaryKey);
    const pk = pks.length === 1 ? pks[0] : undefined;
    return pk && !pk.name.includes('.') ? pk : undefined;
  }

  /** 行 → 文档：先全量转换（非法值在写入前抛出，避免 unordered 部分成功） */
  function rowToDoc(t: TransferTable, r: TransferRow): Record<string, unknown> {
    const idCol = idColumn(t);
    const doc: Record<string, unknown> = {};
    t.columns.forEach((c, i) => {
      const v = cellToBson(r[i] ?? null, c.midType, M);
      if (v === SKIP) return;
      if (idCol && c.name === idCol.name) {
        doc._id = v;
      } else {
        // defineProperty 而非赋值：源字段名可能为 __proto__ 等保留名，按名赋值走
        // setter 改原型——该列数据静默丢失且无告警
        Object.defineProperty(doc, c.name, { value: v, enumerable: true, writable: true, configurable: true });
      }
    });
    return doc;
  }

  return {
    kind: 'mongodb',

    tableExists: async (name) => {
      const infos = (await db.listCollections({ name }).toArray()) as Array<{ name: string }>;
      return infos.length > 0;
    },
    dropTable: async (name) => {
      await db.dropCollection(name).catch(() => false);
    },
    // truncate 模式前置清空：deleteMany({}) 全集合删除（mongo 无 TRUNCATE 等价物）
    beforeLoad: async (t) => {
      await db.collection(t.name).deleteMany({});
    },

    createTable: async (t) => {
      // $jsonSchema 承载结构与字段属性：required = 非 nullable 列；NULL 语义 = 字段缺失
      //（bsonType 精确匹配不含 null，写 {col:null} 会被 strict 拒绝——评审 #2）
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const c of t.columns) {
        if (c.primaryKey) continue; // _id 不进 properties（主键值类型不约束）
        // defineProperty 防 __proto__ 保留名改原型致 validator properties 失真
        Object.defineProperty(properties, c.name, {
          value: { bsonType: midToBsonType(c.midType) },
          enumerable: true,
          writable: true,
          configurable: true,
        });
        if (!c.nullable) required.push(c.name);
      }
      await db.createCollection(t.name, {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            ...(Object.keys(properties).length > 0 ? { properties } : {}),
            ...(required.length > 0 ? { required } : {}),
          },
        },
        validationLevel: 'strict',
      });
    },

    writeBatch: async (t, rows: TransferRow[]) => {
      if (rows.length === 0) return 0;
      const width = t.columns.length;
      for (const r of rows) {
        if (r.length !== width) {
          throw new Error(`行宽不匹配：期望 ${width} 列，实际 ${r.length} 列（表 ${t.name}）`);
        }
      }
      const idCol = idColumn(t);
      if (writeMode === 'replace' && !idCol) {
        throw new Error(`replace 模式需要单列主键（映射 _id）：表 ${t.name} 无主键`);
      }
      // 先全量转换再写（转换抛错 → 一条都没写，规避 unordered 部分成功不可回滚）
      const docs = rows.map((r) => rowToDoc(t, r));
      const coll = db.collection(t.name);
      if (writeMode === 'replace') {
        const ops = docs.map((doc) => {
          const { _id, ...rest } = doc;
          return { replaceOne: { filter: { _id }, replacement: { _id, ...rest }, upsert: true } };
        });
        const res = await coll.bulkWrite(ops as never[], { ordered: false });
        return res.insertedCount + res.upsertedCount + res.modifiedCount;
      }
      const ops = docs.map((doc) => ({ insertOne: { document: doc } }));
      try {
        const res = await coll.bulkWrite(ops as never[], { ordered: false });
        return res.insertedCount;
      } catch (e) {
        // ignore 模式：唯一键冲突（E11000，实际即 _id 重复）跳过；其余错误上抛
        if (writeMode === 'ignore' && e != null && typeof e === 'object' && 'writeErrors' in e) {
          const errors = (e as { writeErrors: Array<{ code?: number }> }).writeErrors ?? [];
          if (errors.every((w) => w.code === 11000)) {
            return docs.length - errors.length;
          }
        }
        throw e;
      }
    },

    close: async () => {
      await raw.client.close();
    },
  };
}

/** 定位：database 覆盖 meta.database（openMongoRaw 按 meta.database → URL path →
 *  fields 顺序取库，覆盖入口即全链生效）；schema 忽略 */
function mongoLocate(rc: ResolvedConnection, loc?: TransferLocator): ResolvedConnection {
  if (!loc?.database) return rc;
  return { ...rc, meta: { ...rc.meta, database: loc.database } };
}

export async function createMongoTransferReaderFromConn(rc: ResolvedConnection, loc?: TransferLocator): Promise<TransferReader> {
  return createMongoTransferReader(await openMongoRaw(mongoLocate(rc, loc)));
}

export async function createMongoTransferWriterFromConn(
  rc: ResolvedConnection,
  writeMode: WriteMode,
  loc?: TransferLocator,
): Promise<TransferWriter> {
  return createMongoTransferWriter(await openMongoRaw(mongoLocate(rc, loc)), writeMode);
}
