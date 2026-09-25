/**
 * MongoDB 适配器（mongodb v7，Server 4.4+）。
 *
 * 设计要点（依据官方文档调研）：
 *  - new MongoClient(uri, { maxPoolSize: 10, readPreference: 'primary', w: 'majority', family: 4 })
 *    + 显式 await connect()。family:4 规避 Node localhost IPv6 DNS 解析坑（官方 README）。
 *  - query() 入参为命令 JSON 文档字符串，读白名单：find/aggregate/count/countDocuments/
 *    estimatedDocumentCount/distinct/listCollections/dbStats/collStats/indexes。
 *  - find 自动 clamp limit ≤ 50，默认按 _id 排序；$where 拒绝（代码注入面）。
 *  - execute() 写白名单；updateMany/deleteMany 空 filter 直接拒绝（适配器级防线）。
 *  - 错误判定用 instanceof MongoServerError（官方建议不解析 message）。
 *  - 只读账号由用户配置官方内置角色 read / readWrite（见文档）。
 */
import {
  Binary,
  Decimal128,
  MongoClient,
  MongoServerError,
  Long,
  ObjectId,
  Timestamp,
} from 'mongodb';
import type { IndexDescription } from 'mongodb';
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

/** 危险操作：服务层拦截器用于确认流程。deleteMany/updateMany 仅空 filter 时危险（适配器已拦截）；createIndex 在大集合上可能阻塞。createIndexes/dropIndexes 为单数形式别名，renameCollection 影响集合可见性。 */
export const DANGEROUS_OPS: ReadonlySet<string> = new Set([
  'dropDatabase', 'dropCollection', 'renameCollection', 'deleteMany', 'updateMany',
  'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'shutdown', 'replSetStepDown',
]);

/** 只读操作白名单（guard 层确认分级用，导出） */
export const READ_OPS: ReadonlySet<string> = new Set([
  'find', 'aggregate', 'count', 'countDocuments', 'estimatedDocumentCount',
  'distinct', 'listCollections', 'dbStats', 'collStats', 'indexes',
]);

const WRITE_OPS: ReadonlySet<string> = new Set([
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'createCollection', 'dropCollection',
  'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'renameCollection',
]);

const FIND_MAX_LIMIT = 50;
const ROWS_MAX = 500;
const CELL_TRUNC = 1000;

function trunc(s: string, max = CELL_TRUNC): string {
  return s.length > max ? `${s.slice(0, max)}…[截断,共${s.length}字符]` : s;
}

/** NormalizedCell 规范化：ObjectId/Decimal128/Long/Timestamp → toString()；Binary → hex 截断；Date → ISO；嵌套对象/数组 → JSON 截断 1000 */
export function normalizeMongoCell(v: unknown): NormalizedCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return trunc(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (v instanceof ObjectId || v instanceof Decimal128 || v instanceof Long || v instanceof Timestamp) {
    return trunc(v.toString());
  }
  if (v instanceof Binary) return trunc(Buffer.from(v.buffer ?? []).toString('hex') || String(v));
  if (typeof v === 'object') {
    try {
      return trunc(JSON.stringify(v) ?? String(v));
    } catch {
      return trunc(String(v));
    }
  }
  return trunc(String(v));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 可执行服务端 JS 的键（代码注入面） */
const JS_INJECTION_KEYS: ReadonlySet<string> = new Set(['$where', '$function', '$accumulator']);
/** 有写副作用的聚合阶段（只读 query 通道禁止） */
const WRITE_STAGE_KEYS: ReadonlySet<string> = new Set(['$out', '$merge', '$unionWith']);

/** 递归检测命令文档：拒绝服务端 JS 键（$where/$function/$accumulator）与写副作用聚合阶段（$out/$merge/$unionWith） */
function assertNoWhere(node: unknown, path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertNoWhere(child, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (JS_INJECTION_KEYS.has(k)) {
        throw new Error(`MongoDB 查询拒绝使用 ${k}（${path}.${k}）：可执行服务端 JS 代码，存在注入风险；请改用查询运算符`);
      }
      if (WRITE_STAGE_KEYS.has(k)) {
        throw new Error(`MongoDB 查询拒绝聚合阶段 ${k}（${path}.${k}）：该阶段有写副作用（写入/创建目标集合），只读通道不允许；如需落盘请走 execute 通道并评估权限`);
      }
      assertNoWhere(v, `${path}.${k}`);
    }
  }
}

/** 解析命令文档字符串为对象（首个键为操作名） */
function parseCommandDoc(input: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(input);
  } catch (e) {
    throw new Error(`MongoDB 命令不是合法 JSON：${e instanceof Error ? e.message : String(e)}。示例：{"find":"users","filter":{},"limit":10}`);
  }
  if (!isPlainObject(doc) || Object.keys(doc).length === 0) {
    throw new Error('MongoDB 命令必须为非空 JSON 文档对象，操作名为第一个键，如 {"find":"users"}');
  }
  return doc;
}

/** 空 filter 校验：updateMany/deleteMany 必须显式 filter（危险操作确认前的适配器级防线） */
export function assertExplicitFilter(op: string, filter: unknown): void {
  const empty = filter === null || filter === undefined ||
    (isPlainObject(filter) && Object.keys(filter).length === 0);
  if (empty) {
    throw new Error(
      `MongoDB ${op} 缺少显式 filter：空条件会作用于全集合。如确需全集合操作，请使用显式条件（如 {"_id":{"$exists":true}}）并经危险操作确认`,
    );
  }
}

function requireObject(v: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(v)) throw new Error(`MongoDB ${label} 必须为 JSON 对象`);
  return v;
}

export interface MongoAdapterOptions {
  mode?: AccessMode;
  /** 测试注入：跳过真实连接 */
  client?: unknown;
}

export async function createMongoAdapter(
  conn: ResolvedConnection,
  opts?: MongoAdapterOptions,
): Promise<DatabaseAdapter> {
  const mode: AccessMode = opts?.mode ?? 'rw';
  let client: MongoClient;
  if (opts?.client) {
    client = opts.client as MongoClient;
  } else {
    const uri = conn.url ?? buildUri(conn.fields, conn.ssl);
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      readPreference: 'primary',
      w: 'majority',
      family: 4,
    });
    try {
      await client.connect();
    } catch (e) {
      throw new Error(
        `MongoDB 连接失败（${sanitizeUri(uri)}）：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const dbName = typeof conn.meta.database === 'string' && conn.meta.database !== ''
    ? conn.meta.database
    : defaultDbName(conn.fields);
  const db = client.db(dbName);

  function wrap(e: unknown): Error {
    if (e instanceof MongoServerError) {
      return new Error(`MongoDB 服务端错误：${e.message}${e.codeName ? `（${e.codeName}）` : ''}`);
    }
    return new Error(`MongoDB 错误：${e instanceof Error ? e.message : String(e)}`);
  }

  function requireRw(action: string): void {
    if (mode === 'ro') {
      throw new Error(`连接为只读(ro)模式，拒绝执行${action}；请使用 rw 连接或只发查询(query)`);
    }
  }

  function collOf(cmd: Record<string, unknown>, op: string): string {
    const name = cmd[op];
    if (typeof name !== 'string' || name === '') {
      throw new Error(`MongoDB ${op} 需要集合名字符串，如 {"${op}":"users"}`);
    }
    return name;
  }

  const adapter: DatabaseAdapter = {
    kind: 'mongodb',
    connId: conn.meta.id,

    async testConnect(): Promise<TestConnectResult> {
      try {
        const hello = await client.db('admin').command({ hello: 1 });
        return { ok: true, serverInfo: `MongoDB ${String(hello.version ?? '')}` };
      } catch (e) {
        return { ok: false, error: wrap(e).message };
      }
    },

    async query(sql: string): Promise<QueryResult> {
      try {
        const cmd = parseCommandDoc(sql);
        assertNoWhere(cmd);
        const op = Object.keys(cmd)[0]!;
        if (!READ_OPS.has(op)) {
          throw new Error(`MongoDB query 不支持操作 ${op}。读操作: ${[...READ_OPS].sort().join('/')}；写操作请走 execute`);
        }

        switch (op) {
          case 'find': {
            const name = collOf(cmd, 'find');
            const filter = isPlainObject(cmd.filter) ? cmd.filter : {};
            const sort = isPlainObject(cmd.sort) ? cmd.sort : { _id: 1 };
            const limitRaw = typeof cmd.limit === 'number' && cmd.limit > 0 ? Math.floor(cmd.limit) : 20;
            const limit = Math.min(limitRaw, FIND_MAX_LIMIT);
            const skip = typeof cmd.skip === 'number' && cmd.skip > 0 ? Math.floor(cmd.skip) : undefined;
            const projection = isPlainObject(cmd.projection) ? cmd.projection : undefined;
            const cursor = db.collection(name).find(filter, {
              sort: sort as Record<string, 1 | -1>,
              limit,
              ...(skip !== undefined ? { skip } : {}),
              ...(projection ? { projection: projection as Record<string, 0 | 1> } : {}),
            });
            const docs = await cursor.toArray();
            return docsToResult(docs, false);
          }
          case 'aggregate': {
            let stages: unknown[];
            if (Array.isArray(cmd.aggregate)) {
              stages = cmd.aggregate;
            } else if (Array.isArray(cmd.pipeline)) {
              stages = cmd.pipeline;
            } else {
              throw new Error('MongoDB aggregate 需要阶段数组：{"aggregate":"coll","pipeline":[{"$match":{}}]}');
            }
            const name = typeof cmd.aggregate === 'string' ? cmd.aggregate : undefined;
            if (name === undefined) throw new Error('MongoDB aggregate 需要集合名：{"aggregate":"coll","pipeline":[...]}');
            const docs = await db.collection(name).aggregate(stages as object[]).limit(ROWS_MAX).toArray();
            return docsToResult(docs, docs.length >= ROWS_MAX);
          }
          case 'count': {
            const name = collOf(cmd, 'count');
            const n = await db.collection(name).countDocuments(isPlainObject(cmd.query) ? cmd.query : {});
            return { columns: ['count'], rows: [[n]], rowCount: 1 };
          }
          case 'countDocuments': {
            const name = collOf(cmd, 'countDocuments');
            const n = await db.collection(name).countDocuments(isPlainObject(cmd.filter) ? cmd.filter : {});
            return { columns: ['count'], rows: [[n]], rowCount: 1 };
          }
          case 'estimatedDocumentCount': {
            const name = collOf(cmd, 'estimatedDocumentCount');
            const n = await db.collection(name).estimatedDocumentCount();
            return { columns: ['count'], rows: [[n]], rowCount: 1 };
          }
          case 'distinct': {
            const name = collOf(cmd, 'distinct');
            if (typeof cmd.key !== 'string' || cmd.key === '') {
              throw new Error('MongoDB distinct 需要 key 字段名：{"distinct":"coll","key":"field","query":{}}');
            }
            const vals = await db.collection(name).distinct(cmd.key, isPlainObject(cmd.query) ? cmd.query : {});
            const rows = (vals as unknown[]).map((v) => [normalizeMongoCell(v)] as NormalizedCell[]);
            return { columns: [cmd.key], rows, rowCount: rows.length, truncated: rows.length >= ROWS_MAX || undefined };
          }
          case 'listCollections': {
            const infos = await db.listCollections().toArray();
            const rows = infos.map((c) => [c.name, c.type ?? 'collection'] as NormalizedCell[]);
            return { columns: ['name', 'type'], rows, rowCount: rows.length };
          }
          case 'dbStats': {
            const stats = await db.command({ dbStats: 1 });
            return objectToResult(stats as Record<string, unknown>);
          }
          case 'collStats': {
            const name = collOf(cmd, 'collStats');
            const stats = await db.command({ collStats: name });
            return objectToResult(stats as Record<string, unknown>);
          }
          case 'indexes': {
            const name = collOf(cmd, 'indexes');
            const idxs = await db.collection(name).indexes();
            const rows = idxs.map((ix) => [
              String(ix.name ?? ''),
              normalizeMongoCell(ix.key),
              ix.unique === true ? 'true' : 'false',
            ]);
            return { columns: ['name', 'key', 'unique'], rows, rowCount: rows.length };
          }
          default:
            throw new Error(`MongoDB query 暂未实现操作 ${op}`);
        }
      } catch (e) {
        throw wrap(e);
      }
    },

    async execute(statement: string): Promise<ExecResult> {
      requireRw('写操作(execute)');
      try {
        const cmd = parseCommandDoc(statement);
        assertNoWhere(cmd);
        const op = Object.keys(cmd)[0]!;
        if (!WRITE_OPS.has(op)) {
          throw new Error(`MongoDB execute 不支持操作 ${op}。写操作: ${[...WRITE_OPS].sort().join('/')}`);
        }
        if (op === 'createCollection') {
          const name = collOf(cmd, 'createCollection');
          await db.createCollection(name);
          return { message: `已创建集合 ${name}` };
        }
        if (op === 'dropCollection') {
          const name = collOf(cmd, 'dropCollection');
          const dropped = await db.dropCollection(name);
          return dropped
            ? { message: `已删除集合 ${name}` }
            : { message: `集合 ${name} 不存在，未删除` };
        }
        if (op === 'renameCollection') {
          const from = collOf(cmd, 'renameCollection');
          if (typeof cmd.to !== 'string' || cmd.to === '') {
            throw new Error('MongoDB renameCollection 需要 to 目标名：{"renameCollection":"a","to":"b"}');
          }
          await db.collection(from).rename(cmd.to);
          return { message: `已将集合 ${from} 重命名为 ${cmd.to}` };
        }
        if (op === 'createIndex' || op === 'createIndexes') {
          const name = collOf(cmd, op);
          const specs = isPlainObject(cmd.index)
            ? [cmd.index]
            : Array.isArray(cmd.index)
              ? cmd.index
              : isPlainObject(cmd.indexes) ? [cmd.indexes] : Array.isArray(cmd.indexes) ? cmd.indexes : null;
          if (!specs) throw new Error('MongoDB createIndex 需要 index 规格对象或数组：{"createIndex":"coll","index":{"key":{"a":1},"name":"a_1"}}');
          const created = (await db.collection(name).createIndexes(specs as IndexDescription[])) as { createdNewIndexes?: number };
          return { affectedRows: created.createdNewIndexes ?? undefined, message: `已在集合 ${name} 创建索引（${created.createdNewIndexes ?? '?'} 个新增）` };
        }
        if (op === 'dropIndex' || op === 'dropIndexes') {
          const name = collOf(cmd, op);
          const index = typeof cmd.index === 'string' ? cmd.index : undefined;
          if (index === undefined) throw new Error('MongoDB dropIndex 需要 index 名：{"dropIndex":"coll","index":"a_1"}');
          await db.collection(name).dropIndex(index);
          return { message: `已删除集合 ${name} 的索引 ${index}` };
        }

        // ---- 文档级 DML ----
        const name = collOf(cmd, op);
        const c = db.collection(name);
        switch (op) {
          case 'insertOne': {
            // 不设 cmd.insert 别名：该键语义是集合名（insertMany 命令形态），混用会误导报错方向
            const doc = requireObject(cmd.document, 'insertOne.document');
            const r = await c.insertOne(doc as object);
            return { affectedRows: 1, message: `已插入 1 条文档到 ${name}（_id=${String(r.insertedId)}）` };
          }
          case 'insertMany': {
            if (!Array.isArray(cmd.documents ?? cmd.docs) || ((cmd.documents ?? cmd.docs) as unknown[]).length === 0) {
              throw new Error('MongoDB insertMany 需要非空 documents 数组：{"insertMany":"coll","documents":[{...}]}');
            }
            const docs = ((cmd.documents ?? cmd.docs) as unknown[]).map((d) => requireObject(d, 'insertMany.documents[]') as object);
            const r = await c.insertMany(docs);
            return { affectedRows: r.insertedCount, message: `已插入 ${r.insertedCount} 条文档到 ${name}` };
          }
          case 'updateOne':
          case 'updateMany': {
            if (op === 'updateMany') assertExplicitFilter(op, cmd.filter);
            const filter = requireObject(cmd.filter, `${op}.filter`);
            const update = requireObject(cmd.update, `${op}.update`);
            const r = op === 'updateOne'
              ? await c.updateOne(filter as object, update as object)
              : await c.updateMany(filter as object, update as object);
            return {
              affectedRows: r.modifiedCount,
              message: `${op} 完成：匹配 ${r.matchedCount} 条，修改 ${r.modifiedCount} 条（${name}）`,
            };
          }
          case 'replaceOne': {
            const filter = requireObject(cmd.filter, 'replaceOne.filter');
            const replacement = requireObject(cmd.replacement ?? cmd.update, 'replaceOne.replacement');
            const r = await c.replaceOne(filter as object, replacement as object);
            return {
              affectedRows: r.modifiedCount,
              message: `replaceOne 完成：匹配 ${r.matchedCount} 条，替换 ${r.modifiedCount} 条（${name}）`,
            };
          }
          case 'deleteOne':
          case 'deleteMany': {
            if (op === 'deleteMany') assertExplicitFilter(op, cmd.filter);
            const filter = requireObject(cmd.filter, `${op}.filter`);
            const r = op === 'deleteOne'
              ? await c.deleteOne(filter as object)
              : await c.deleteMany(filter as object);
            return { affectedRows: r.deletedCount, message: `${op} 完成：删除 ${r.deletedCount} 条（${name}）` };
          }
          default:
            throw new Error(`MongoDB execute 暂未实现操作 ${op}`);
        }
      } catch (e) {
        throw wrap(e);
      }
    },

    async listDatabases(): Promise<string[]> {
      try {
        const infos = await client.db('admin').admin().listDatabases();
        return infos.databases.map((d) => d.name);
      } catch (e) {
        throw wrap(e);
      }
    },

    async listTables(): Promise<TableInfo[]> {
      try {
        const infos = await db.listCollections().toArray();
        return infos.map((c) => ({ name: c.name, type: c.type === 'view' ? 'view' : 'collection' }));
      } catch (e) {
        throw wrap(e);
      }
    },

    async describeTable(name: string): Promise<ColumnInfo[]> {
      try {
        const c = db.collection(name);
        const sample = await c.find({}).limit(10).toArray();
        const idxs = await c.indexes();
        const cols = new Map<string, { types: Set<string>; present: number }>();
        for (const doc of sample) {
          for (const [k, v] of Object.entries(doc)) {
            const entry = cols.get(k) ?? { types: new Set<string>(), present: 0 };
            entry.types.add(inferBsonType(v));
            entry.present += 1;
            cols.set(k, entry);
          }
        }
        const indexByField = new Map<string, string[]>();
        for (const ix of idxs) {
          for (const field of Object.keys((ix.key ?? {}) as Record<string, unknown>)) {
            indexByField.set(field, [...(indexByField.get(field) ?? []), String(ix.name ?? '')]);
          }
        }
        const out: ColumnInfo[] = [];
        for (const [field, entry] of cols) {
          const types = [...entry.types].sort().join('|');
          const indexNames = indexByField.get(field);
          out.push({
            name: field,
            dataType: `${types} (inferred)`,
            nullable: sample.length > 0 && entry.present < sample.length,
            ...(field === '_id' ? { key: 'PRI' as const } : {}),
            comment: indexNames && indexNames.length > 0 ? `index: ${indexNames.join(', ')}` : undefined,
          });
        }
        // _id 未出现在样本中（空集合）也要给出主键提示
        if (!out.some((c) => c.name === '_id')) {
          out.unshift({ name: '_id', dataType: 'ObjectId (inferred)', nullable: false, key: 'PRI', comment: '空集合样本推断' });
        }
        return out;
      } catch (e) {
        throw wrap(e);
      }
    },

    async previewRows(name: string, limit: number, _database?: string, offset?: number): Promise<QueryResult> {
      try {
        const n = Math.max(1, Math.min(Math.floor(limit) || 20, FIND_MAX_LIMIT));
        const skip = Math.max(0, Math.floor(offset ?? 0) || 0);
        const docs = await db.collection(name).find({}).sort({ _id: 1 }).skip(skip).limit(n).toArray();
        return docsToResult(docs, false);
      } catch (e) {
        throw wrap(e);
      }
    },

    async close(): Promise<void> {
      await client.close();
    },
  };

  /** 文档数组 → QueryResult（列 = 字段并集，保持首次出现顺序） */
  function docsToResult(docs: Record<string, unknown>[], truncated: boolean): QueryResult {
    const columns: string[] = [];
    for (const d of docs) {
      for (const k of Object.keys(d)) {
        if (!columns.includes(k)) columns.push(k);
      }
    }
    const rows = docs.map((d) => columns.map((c) => normalizeMongoCell(d[c])));
    return { columns, rows, rowCount: rows.length, truncated: truncated || undefined };
  }

  return adapter;
}

/** 单层统计对象 → ['name','value'] 两列 */
function objectToResult(obj: Record<string, unknown>): QueryResult {
  const rows = Object.entries(obj).map(([k, v]) => [k, normalizeMongoCell(v)] as NormalizedCell[]);
  return { columns: ['name', 'value'], rows, rowCount: rows.length };
}

function inferBsonType(v: unknown): string {
  if (v === null) return 'null';
  if (v instanceof ObjectId) return 'ObjectId';
  if (v instanceof Decimal128) return 'Decimal128';
  if (v instanceof Long) return 'Long';
  if (v instanceof Timestamp) return 'Timestamp';
  if (v instanceof Binary) return 'Binary';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return typeof v;
}

function buildUri(fields: Record<string, unknown> | undefined, ssl?: boolean): string {
  const host = typeof fields?.host === 'string' && fields.host !== '' ? fields.host : '127.0.0.1';
  const port = typeof fields?.port === 'number' ? fields.port : 27017;
  const user = typeof fields?.user === 'string' ? encodeURIComponent(fields.user) : '';
  const pass = typeof fields?.password === 'string' ? `:${encodeURIComponent(fields.password)}` : '';
  const auth = user !== '' ? `${user}${pass}@` : '';
  const scheme = ssl || fields?.ssl === true || fields?.tls === true ? 'mongodb+srv' : 'mongodb';
  const authDb = typeof fields?.authDatabase === 'string' ? `?authSource=${fields.authDatabase}` : '';
  return `${scheme}://${auth}${host}:${port}${authDb}`;
}

function defaultDbName(fields: Record<string, unknown> | undefined): string {
  return typeof fields?.database === 'string' && fields.database !== '' ? fields.database : 'test';
}

function sanitizeUri(uri: string): string {
  return uri.replace(/:\/\/[^@/]*@/, '://***:***@');
}

export const factory: AdapterFactory = async (conn) => createMongoAdapter(conn);
