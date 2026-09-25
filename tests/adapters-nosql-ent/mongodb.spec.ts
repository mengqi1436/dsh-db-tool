/**
 * MongoDB 适配器离线单测（mock client 注入，不真连）。
 * 覆盖：find clamp/默认排序、$where 拒绝、空 filter 拒绝、白名单、DANGEROUS_OPS、单元格规范化、ro 模式。
 */
import { describe, expect, it, vi } from 'vitest';
import { Binary, Decimal128, Long, ObjectId, Timestamp } from 'mongodb';
import {
  assertExplicitFilter,
  createMongoAdapter,
  DANGEROUS_OPS,
  normalizeMongoCell,
} from '../../lib/adapters/mongodb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const conn: ResolvedConnection = {
  meta: { id: 'm1', kind: 'mongodb', database: 'testdb' },
  url: 'mongodb://localhost:27017',
};

function makeClient(docs: Record<string, unknown>[] = []) {
  const coll = {
    find: vi.fn((_f?: unknown, _o?: unknown) => ({ toArray: vi.fn(async () => docs) })),
    aggregate: vi.fn(() => ({
      limit: vi.fn(() => ({ toArray: vi.fn(async () => docs) })),
    })),
    countDocuments: vi.fn(async () => 7),
    estimatedDocumentCount: vi.fn(async () => 99),
    distinct: vi.fn(async () => ['a', 'b']),
    indexes: vi.fn(async () => [{ name: '_id_', key: { _id: 1 } }]),
    insertOne: vi.fn(async () => ({ insertedId: 'x' })),
    insertMany: vi.fn(async () => ({ insertedCount: 2 })),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    updateMany: vi.fn(async () => ({ matchedCount: 2, modifiedCount: 2 })),
    replaceOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 0 })),
    deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
    deleteMany: vi.fn(async () => ({ deletedCount: 5 })),
    createIndexes: vi.fn(async () => ({ createdNewIndexes: 1 })),
    dropIndex: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
  };
  const dbObj = {
    collection: vi.fn(() => coll),
    listCollections: vi.fn(() => ({
      toArray: vi.fn(async () => [{ name: 'users', type: 'collection' }]),
    })),
    command: vi.fn(async () => ({ db: 'testdb', objects: 10 })),
  };
  const client = {
    connect: vi.fn(async () => undefined),
    db: vi.fn(() => dbObj),
  };
  return { client, dbObj, coll };
}

describe('DANGEROUS_OPS 常量完备性', () => {
  it('含全部 8 项', () => {
    expect([...DANGEROUS_OPS].sort()).toEqual(
      ['createIndex', 'deleteMany', 'dropCollection', 'dropDatabase', 'dropIndex', 'replSetStepDown', 'shutdown', 'updateMany'].sort(),
    );
  });
});

describe('assertExplicitFilter（空 filter 防线）', () => {
  it('updateMany/deleteMany 空 filter 拒绝', () => {
    expect(() => assertExplicitFilter('updateMany', {})).toThrow('缺少显式 filter');
    expect(() => assertExplicitFilter('deleteMany', undefined)).toThrow('缺少显式 filter');
    expect(() => assertExplicitFilter('deleteMany', null)).toThrow('缺少显式 filter');
  });
  it('显式 filter 通过', () => {
    expect(() => assertExplicitFilter('updateMany', { status: 'old' })).not.toThrow();
    expect(() => assertExplicitFilter('deleteMany', { _id: { $exists: true } })).not.toThrow();
  });
});

describe('normalizeMongoCell', () => {
  it('ObjectId → toString', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    expect(normalizeMongoCell(id)).toBe('507f1f77bcf86cd799439011');
  });
  it('Decimal128/Long/Timestamp → toString', () => {
    expect(normalizeMongoCell(Decimal128.fromString('1.25'))).toBe('1.25');
    expect(normalizeMongoCell(Long.fromNumber(42))).toBe('42');
    expect(normalizeMongoCell(Timestamp.fromNumber(1))).toBe('1');
  });
  it('Date → ISO 字符串', () => {
    const d = new Date('2024-01-02T03:04:05.000Z');
    expect(normalizeMongoCell(d)).toBe('2024-01-02T03:04:05.000Z');
  });
  it('Binary → hex', () => {
    expect(normalizeMongoCell(new Binary(Buffer.from('ab')))).toBe(Buffer.from('ab').toString('hex'));
  });
  it('嵌套对象 → JSON 且截断 1000', () => {
    expect(normalizeMongoCell({ a: 1 })).toBe('{"a":1}');
    const big = { s: 'y'.repeat(2000) };
    const out = normalizeMongoCell(big) as string;
    expect(out.length).toBeLessThanOrEqual(1000 + 20);
    expect(out).toContain('截断');
  });
  it('boolean → true/false 字符串，null → null', () => {
    expect(normalizeMongoCell(true)).toBe('true');
    expect(normalizeMongoCell(null)).toBeNull();
  });
});

describe('query', () => {
  it('find clamp limit ≤50 且默认 sort {_id:1}', async () => {
    const { client, coll } = makeClient([{ _id: 'i1', name: 'a' }]);
    const a = await createMongoAdapter(conn, { client });
    const r = await a.query('{"find":"users","limit":1000}');
    const opts = coll.find.mock.calls[0]![1] as { sort: unknown; limit: number };
    expect(opts.limit).toBe(50);
    expect(opts.sort).toEqual({ _id: 1 });
    expect(r.rowCount).toBe(1);
    expect(r.columns).toContain('name');
  });
  it('显式 sort 被尊重', async () => {
    const { coll } = makeClient([]);
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    void a;
    const c2 = makeClient([]);
    const adapter = await createMongoAdapter(conn, { client: c2.client });
    await adapter.query('{"find":"users","sort":{"age":-1}}');
    expect((c2.coll.find.mock.calls[0]![1] as { sort: unknown }).sort).toEqual({ age: -1 });
    void coll;
  });
  it('$where 拒绝', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    await expect(a.query('{"find":"u","filter":{"$where":"this.a>1"}}')).rejects.toThrow('$where');
  });
  it('aggregate pipeline 内 $where 拒绝', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    await expect(a.query('{"aggregate":"u","pipeline":[{"$match":{"$where":"1"}}]}')).rejects.toThrow('$where');
  });
  it('非法 JSON 拒绝', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    await expect(a.query('{find:')).rejects.toThrow('不是合法 JSON');
  });
  it('写操作走 query 拒绝', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    await expect(a.query('{"insertOne":"u"}')).rejects.toThrow('不支持操作 insertOne');
  });
  it('count 返回 count 列', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    const r = await a.query('{"count":"u"}');
    expect(r).toEqual({ columns: ['count'], rows: [[7]], rowCount: 1 });
  });
});

describe('execute 白名单与防线', () => {
  it('updateMany 空 filter 直接拒绝（适配器级防线）', async () => {
    const { client } = makeClient();
    const a = await createMongoAdapter(conn, { client });
    await expect(a.execute('{"updateMany":"u","update":{"$set":{"x":1}}}')).rejects.toThrow('缺少显式 filter');
  });
  it('deleteMany 空 filter 直接拒绝', async () => {
    const { client } = makeClient();
    const a = await createMongoAdapter(conn, { client });
    await expect(a.execute('{"deleteMany":"u","filter":{}}')).rejects.toThrow('缺少显式 filter');
  });
  it('带 filter 的 deleteMany 通过', async () => {
    const { client, coll } = makeClient();
    const a = await createMongoAdapter(conn, { client });
    const r = await a.execute('{"deleteMany":"u","filter":{"status":"old"}}');
    expect(coll.deleteMany).toHaveBeenCalledWith({ status: 'old' });
    expect(r.affectedRows).toBe(5);
  });
  it('非白名单写操作拒绝', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    await expect(a.execute('{"dropDatabase":1}')).rejects.toThrow(/不支持操作|暂未实现/);
  });
  it('insertOne 缺 document 报错', async () => {
    const a = await createMongoAdapter(conn, { client: makeClient().client });
    await expect(a.execute('{"insertOne":"u"}')).rejects.toThrow('insertOne.document');
  });
  it('ro 模式拒绝 execute（错误信息含「连接为只读(ro)模式」）', async () => {
    const a = await createMongoAdapter(conn, { mode: 'ro', client: makeClient().client });
    await expect(a.execute('{"insertOne":"u","document":{"a":1}}')).rejects.toThrow('连接为只读(ro)模式');
  });
  it('ro 模式仍允许 query', async () => {
    const a = await createMongoAdapter(conn, { mode: 'ro', client: makeClient([{ _id: 'i', v: 1 }]).client });
    const r = await a.query('{"find":"u","limit":5}');
    expect(r.rowCount).toBe(1);
  });
});
