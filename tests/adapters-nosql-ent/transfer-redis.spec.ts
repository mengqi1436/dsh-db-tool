/**
 * Redis 传输读写端离线单测（有状态 fake client 注入，不真连）。
 *
 * 契约：Redis 经既有中间模型以固定 envelope 表 `__redis_keys` 参与互迁，
 * 列 key/type/ttl_ms/encoding/payload/dump；DUMP/RESTORE 保真路径与
 * payload 类型化重建路径并存；SCAN 游标由 reader 内部迭代器续批。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConnection } from '../../lib/adapters/types.js';
import type { TransferRow, TransferTable } from '../../lib/adapters/transfer/model.js';
import {
  createRedisTransferReader,
  createRedisTransferWriter,
  REDIS_ENVELOPE_TABLE,
} from '../../lib/adapters/transfer/kinds/redis.js';

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('redis', () => ({ createClient: createClientMock }));

const rc: ResolvedConnection = { meta: { id: 'r1', kind: 'redis' }, url: 'redis://localhost:6379' };

type Arg = string | Buffer;
type Args = Arg[];
type Key = string | Buffer;

interface Entry {
  key: Key;
  type?: string;
  pttl?: number;
  encoding?: string | null;
  dump?: Buffer | null;
  value?: unknown;
}

/** Buffer/字符串键统一按 UTF-8/base64url 归一，供 fake 的 map 索引用 */
const b64 = (v: Key): string => (Buffer.isBuffer(v) ? v.toString('base64url') : Buffer.from(v, 'utf8').toString('base64url'));

const isInternal = (k: Key): boolean => typeof k === 'string' && k.startsWith('__dbt_xfer:');
const isIdx = (k: Key): boolean => typeof k === 'string' && k.startsWith('__dbt_xfer:idx:');

interface FakeClient {
  scanKeys: Key[];
  calls: Args[];
  sendCommand: ReturnType<typeof vi.fn>;
  scanIterator: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

/** 最小有状态 Redis：stored=普通键值、sets=索引集合、meta/values=读端元信息 */
function makeClient(entries: Entry[] = []): FakeClient {
  const scanKeys: Key[] = entries.map((e) => e.key);
  const stored = new Map<string, Arg>();
  const sets = new Map<string, Map<string, Key>>();
  const meta = new Map<string, { type: string; pttl: number; encoding: string | null; dump: Buffer | null }>();
  const values = new Map<string, unknown>();
  const calls: Args[] = [];
  for (const e of entries) {
    const k = b64(e.key);
    stored.set(k, 'exists'); // 模拟键已存在（EXISTS 用）
    meta.set(k, {
      type: e.type ?? 'string',
      pttl: e.pttl ?? -1,
      encoding: e.encoding === undefined ? 'raw' : e.encoding,
      dump: e.dump ?? null,
    });
    values.set(k, e.value ?? 'v1');
  }

  const client: FakeClient = {
    scanKeys,
    calls,
    connect: vi.fn(async () => undefined),
    quit: vi.fn(async () => 'OK'),
    type: vi.fn(async (key: Key) => meta.get(b64(key))?.type ?? 'none'),
    pTTL: vi.fn(async (key: Key) => meta.get(b64(key))?.pttl ?? -2),
    dbSize: vi.fn(async () => entries.length),
    // openRaw 会挂 error 监听避免 EventEmitter 异常崩宿主进程
    on: vi.fn(),
    get: vi.fn(async (key: Key) => values.get(b64(key)) ?? null),
    hGetAll: vi.fn(async (key: Key) => values.get(b64(key)) ?? {}),
    lRange: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    sMembers: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    zRangeWithScores: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    xRange: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    scanIterator: vi.fn(async function* () {
      // 真实驱动逐页 yield 键数组（AsyncGenerator<Key[]>），不是逐键
      for (let i = 0; i < scanKeys.length; i += 3) yield scanKeys.slice(i, i + 3);
    }),
    sendCommand: vi.fn(async (args: Args) => {
      calls.push(args);
      const cmd = String(args[0] ?? '').toUpperCase();
      const raw = args[1] as Key;
      const k = b64(raw);
      switch (cmd) {
        case 'SET': stored.set(k, args[2] as Arg); return 'OK';
        case 'RESTORE': stored.set(k, args[3] as Arg); return 'OK';
        case 'DEL': {
          let n = 0;
          for (const a of args.slice(1)) {
            const kk = b64(a as Key);
            if (stored.delete(kk) || sets.delete(kk)) n++;
          }
          return n;
        }
        case 'EXISTS': return stored.has(k) || sets.has(k) ? 1 : 0;
        case 'SADD': {
          if (isIdx(raw)) {
            if (!sets.has(k)) sets.set(k, new Map());
            for (const m of args.slice(2)) sets.get(k)!.set(b64(m as Key), m as Key);
            return args.length - 2;
          }
          stored.set(k, 'set');
          return args.length - 2;
        }
        case 'SMEMBERS': return [...(sets.get(k)?.values() ?? [])];
        case 'OBJECT': return meta.get(k)?.encoding ?? null;
        case 'DUMP': return meta.get(k)?.dump ?? null;
        default: return 'OK'; // HSET/RPUSH/ZADD/XADD/PEXPIRE/PERSIST/DUMP 等写命令
      }
    }),
  };
  return client;
}

const table = (): TransferTable => ({
  name: REDIS_ENVELOPE_TABLE,
  columns: [
    { name: 'key', midType: 'string', nullable: false, primaryKey: true },
    { name: 'type', midType: 'string', nullable: false, primaryKey: false },
    { name: 'ttl_ms', midType: 'bigint', nullable: false, primaryKey: false },
    { name: 'encoding', midType: 'string', nullable: true, primaryKey: false },
    { name: 'payload', midType: 'json', nullable: false, primaryKey: false },
    { name: 'dump', midType: 'bytes', nullable: true, primaryKey: false },
  ],
});

const row = (key: string, type: string, ttl: bigint, payload: string, dump: Buffer | null = null, encoding: string | null = 'raw'): TransferRow =>
  [key, type, ttl, encoding, payload, dump];

const reader = (c: FakeClient) => createRedisTransferReader(c as never);
const writer = (c: FakeClient, mode: 'insert' | 'ignore' | 'replace' | 'truncate' = 'insert') =>
  createRedisTransferWriter(c as never, mode);

/* ---------------- 读端：列契约与元信息 ---------------- */

describe('Redis 读端 describe/shardKey/count', () => {
  it('describe 产出固定 envelope 六列（key 为主键，ttl_ms=bigint，dump 可空 bytes）', async () => {
    const r = reader(makeClient());
    expect(await r.describe(REDIS_ENVELOPE_TABLE)).toEqual(table());
    await r.close();
  });

  it('listTables 只返回 __redis_keys', async () => {
    const r = reader(makeClient());
    expect(await r.listTables()).toEqual([REDIS_ENVELOPE_TABLE]);
    await r.close();
  });

  it('count 走 DBSIZE 且扣除内部登记键（marker + idx）', async () => {
    // dbSize=4 含 2 个 __dbt_xfer:* 登记键；导出分母只算业务键，否则进度永远到不了 100%
    const c = makeClient([{ key: 'a' }, { key: 'b' }, { key: '__dbt_xfer:tbl:x' }, { key: '__dbt_xfer:idx:x' }]);
    const r = reader(c);
    expect(await r.count(REDIS_ENVELOPE_TABLE)).toBe(2);
    expect(c.dbSize).toHaveBeenCalledTimes(1);
    await r.close();
  });

  it('shardKey 为 null 且省略 keyAt（编排层走 runOffset）', async () => {
    const r = reader(makeClient());
    expect(await r.shardKey(REDIS_ENVELOPE_TABLE)).toBeNull();
    expect(r.keyAt).toBeUndefined();
    await r.close();
  });
});

/* ---------------- 读端：6 种键类型全量读值 ---------------- */

describe('Redis 读端按 6 种键类型全量读值', () => {
  it('string → payload {"v":...}，长值不经 cell() 截断', async () => {
    const long = 'x'.repeat(1500);
    const r = reader(makeClient([{ key: 's', type: 'string', value: long }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(JSON.parse(String(rows[0]![4]))).toEqual({ v: long });
    await r.close();
  });

  it('hash → payload {"f":[[field,value],...]}', async () => {
    const r = reader(makeClient([{ key: 'h', type: 'hash', value: { f1: 'v1', f2: 'v2' } }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(JSON.parse(String(rows[0]![4]))).toEqual({ f: [['f1', 'v1'], ['f2', 'v2']] });
    await r.close();
  });

  it('list → payload {"v":[...]} 全量（lRange 0 -1）', async () => {
    const c = makeClient([{ key: 'l', type: 'list', value: ['a', 'b', 'c'] }]);
    const r = reader(c);
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(JSON.parse(String(rows[0]![4]))).toEqual({ v: ['a', 'b', 'c'] });
    expect(c.lRange).toHaveBeenCalledWith('l', 0, -1);
    await r.close();
  });

  it('set → payload {"v":[...]}', async () => {
    const r = reader(makeClient([{ key: 's', type: 'set', value: ['m1', 'm2'] }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(JSON.parse(String(rows[0]![4]))).toEqual({ v: ['m1', 'm2'] });
    await r.close();
  });

  it('zset → payload {"v":[[member,score],...]}', async () => {
    const c = makeClient([{ key: 'z', type: 'zset', value: [{ value: 'a', score: 1 }, { value: 'b', score: 2.5 }] }]);
    const r = reader(c);
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(JSON.parse(String(rows[0]![4]))).toEqual({ v: [['a', 1], ['b', 2.5]] });
    expect(c.zRangeWithScores).toHaveBeenCalledWith('z', '0', '-1');
    await r.close();
  });

  it('stream → payload {"v":[[id,[[field,value],...]],...]}', async () => {
    const c = makeClient([{ key: 'st', type: 'stream', value: [{ id: '1-1', message: { f: 'v' } }] }]);
    const r = reader(c);
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(JSON.parse(String(rows[0]![4]))).toEqual({ v: [['1-1', [['f', 'v']]]] });
    expect(c.xRange).toHaveBeenCalledWith('st', '-', '+');
    await r.close();
  });
});

/* ---------------- 读端：SCAN / TTL / 二进制安全 ---------------- */

describe('Redis 读端 SCAN 游标与 TTL', () => {
  it('offset 0 → 非 0 → 迭代器耗尽返回 []（同一迭代器续批，runOffset 能收尾）', async () => {
    const c = makeClient([{ key: 'a' }, { key: 'b' }, { key: 'c' }]);
    const r = reader(c);
    expect(await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 2)).toHaveLength(2);
    expect(await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 2 }, 2)).toHaveLength(1);
    expect(await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 4 }, 2)).toEqual([]);
    expect(c.scanIterator).toHaveBeenCalledTimes(1);
    await r.close();
  });

  it('页边界跨批不丢键：SCAN 每页 3 键、批大小 2 时全量不重不漏', async () => {
    // 回归 C-1：驱动逐页 yield 数组，页内剩余键必须跨 readBatch 持久，否则批边界丢数据
    const keys = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}` }));
    const c = makeClient(keys);
    const r = reader(c);
    const got: string[] = [];
    for (;;) {
      const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: got.length }, 2);
      if (rows.length === 0) break;
      for (const row of rows) got.push(String(row[0]));
    }
    expect(got).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
    await r.close();
  });

  it('SCAN 透传 MATCH/COUNT，且从不使用 KEYS', async () => {
    const c = makeClient([{ key: 'a' }]);
    const r = reader(c);
    await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(c.scanIterator).toHaveBeenCalledWith({ MATCH: '*', COUNT: 100 });
    expect(c.calls.some((a) => String(a[0]).toUpperCase() === 'KEYS')).toBe(false);
    await r.close();
  });

  it('空库 → readBatch 返回 []', async () => {
    const r = reader(makeClient());
    expect(await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10)).toEqual([]);
    await r.close();
  });

  it('limit clamp：0/负数按 1 行，超大值不超过剩余键数', async () => {
    const c1 = makeClient([{ key: 'a' }, { key: 'b' }]);
    const r1 = reader(c1);
    expect(await r1.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 0)).toHaveLength(1);
    await r1.close();
    const c2 = makeClient([{ key: 'a' }]);
    const r2 = reader(c2);
    expect(await r2.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 99999)).toHaveLength(1);
    await r2.close();
  });

  it('PTTL -1 → ttl_ms=0n（永不过期）', async () => {
    const r = reader(makeClient([{ key: 'k', pttl: -1 }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(rows[0]![2]).toBe(0n);
    await r.close();
  });

  it('PTTL 正值 → ttl_ms 原样 bigint', async () => {
    const r = reader(makeClient([{ key: 'k', pttl: 1500 }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(rows[0]![2]).toBe(1500n);
    await r.close();
  });

  it('PTTL -2（键在读瞬间消失）→ 跳过该键且不提前收尾', async () => {
    const c = makeClient([{ key: 'gone', pttl: -2 }, { key: 'live', pttl: -1 }]);
    const r = reader(c);
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('live');
    await r.close();
  });

  it('键名二进制安全：Buffer 键原样进 TransferCell，DUMP 走 Buffer 参数', async () => {
    const bin = Buffer.from([0xff, 0x00, 0xfe]);
    const dump = Buffer.from([0x01, 0x02]);
    const r = reader(makeClient([{ key: bin, dump }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(rows[0]![0]).toEqual(bin);
    expect(rows[0]![5]).toEqual(dump);
    await r.close();
  });

  it('内部登记键（__dbt_xfer: 前缀）不当作数据迁走', async () => {
    const r = reader(makeClient([{ key: '__dbt_xfer:tbl:abc' }, { key: 'user:1' }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('user:1');
    await r.close();
  });

  it('值二进制安全：非 UTF-8 值进 payload 后能原样重建（回归 C-2）', async () => {
    // 曾因 asArg 直接 String(Buffer) + JSON.stringify 变成 {type:'Buffer',…}，写入只能是 "[object Object]"
    const bin = Buffer.from([0xff, 0x00, 0xab]);
    const r = reader(makeClient([{ key: 'k', type: 'string', value: bin, dump: undefined }]));
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    const payload = String(rows[0]![4]);
    // payload 里二进制必须带 __b64 标记，而不是 Buffer 的 toJSON 形态
    expect(payload).not.toContain('"type":"Buffer"');
    expect(payload).toContain('__b64');
    const v = makeClient();
    const w = writer(v);
    await w.writeBatch(await r.describe(REDIS_ENVELOPE_TABLE), [rows[0]!]);
    const setCmd = v.sendCommand.mock.calls.map((c) => c[0] as string[]).find((a) => String(a[0]).toUpperCase() === 'SET');
    expect(setCmd).toBeDefined();
    expect(Buffer.isBuffer(setCmd![2])).toBe(true);
    expect((setCmd![2] as unknown as Buffer).equals(bin)).toBe(true);
    await r.close();
    await w.close();
  });

  it('hash 的 __proto__/constructor 字段不丢失（回归 C-3）', async () => {
    // typeMapping 37=Map：默认转 plain object 会让这些字段静默消失
    const hash = new Map<string, string>([['__proto__', 'p'], ['constructor', 'c'], ['normal', 'n']]);
    const c = makeClient([{ key: 'h', type: 'hash', value: hash }]);
    const r = reader(c);
    const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    const fields = (JSON.parse(String(rows[0]![4])) as { f: Array<[string, unknown]> }).f.map(([f]) => f);
    expect(fields).toEqual(['__proto__', 'constructor', 'normal']);
    await r.close();
  });
});

/* ---------------- 工厂注册 ---------------- */

describe('工厂不再拒绝 redis', () => {
  beforeEach(() => createClientMock.mockReset());

  it('createTransferReader(redis) 不再抛错', async () => {
    const { createTransferReader } = await import('../../lib/adapters/transfer/model.js');
    const c = makeClient();
    createClientMock.mockReturnValue(c);
    const r = await createTransferReader(rc);
    expect(r.kind).toBe('redis');
    expect(c.connect).toHaveBeenCalledTimes(1);
    await r.close();
  });

  it('createTransferWriter(redis) 不再抛错', async () => {
    const { createTransferWriter } = await import('../../lib/adapters/transfer/model.js');
    const c = makeClient();
    createClientMock.mockReturnValue(c);
    const w = await createTransferWriter(rc, 'insert');
    expect(w.kind).toBe('redis');
    await w.close();
  });
});

/* ---------------- 写端 ---------------- */

describe('Redis 写端 DUMP/RESTORE 与 payload 重建', () => {
  it('dump 非空 → RESTORE key ttl dump REPLACE（ttl 为 0 表示永不过期）', async () => {
    const c = makeClient();
    const w = writer(c);
    const dump = Buffer.from([0x0a, 0x0b]);
    await w.writeBatch(table(), [row('k', 'string', 0n, '{"v":"x"}', dump)]);
    expect(c.calls).toContainEqual(['RESTORE', 'k', '0', dump, 'REPLACE']);
    expect(c.calls.some((a) => String(a[0]).toUpperCase() === 'SET')).toBe(false);
    await w.close();
  });

  it('dump 为空 → payload 类型化重建（SET + 值原样）', async () => {
    const c = makeClient();
    const w = writer(c);
    await w.writeBatch(table(), [row('k', 'string', -1n, '{"v":"hello"}')]);
    expect(c.calls).toContainEqual(['SET', 'k', 'hello']);
    await w.close();
  });

  it('hash/list/set/zset/stream 分别走 HSET/RPUSH/SADD/ZADD/XADD', async () => {
    const c = makeClient();
    const w = writer(c);
    await w.writeBatch(table(), [
      row('h', 'hash', 0n, '{"f":[["f1","v1"],["f2","v2"]]}'),
      row('l', 'list', 0n, '{"v":["a","b"]}'),
      row('s', 'set', 0n, '{"v":["m1","m2"]}'),
      row('z', 'zset', 0n, '{"v":[["a",1],["b",2.5]]}'),
      row('st', 'stream', 0n, '{"v":[["1-1",[["f","v"]]]]}'),
    ]);
    const heads = c.calls.map((a) => String(a[0]).toUpperCase());
    expect(heads).toContain('HSET');
    expect(heads).toContain('RPUSH');
    expect(heads).toContain('SADD');
    expect(heads).toContain('ZADD');
    expect(heads).toContain('XADD');
    await w.close();
  });

  it('TTL 正值 → PEXPIRE；0 → PERSIST（payload 路径）', async () => {
    const c = makeClient();
    const w = writer(c);
    await w.writeBatch(table(), [
      row('a', 'string', 1500n, '{"v":"x"}'),
      row('b', 'string', 0n, '{"v":"y"}'),
    ]);
    expect(c.calls).toContainEqual(['PEXPIRE', 'a', '1500']);
    expect(c.calls).toContainEqual(['PERSIST', 'b']);
    await w.close();
  });

  it('writeMode insert：目标键已存在 → 抛错，不覆盖', async () => {
    const c = makeClient([{ key: 'k' }]);
    const w = writer(c, 'insert');
    await expect(w.writeBatch(table(), [row('k', 'string', 0n, '{"v":"x"}')])).rejects.toThrow(/已存在/);
    await w.close();
  });

  it('writeMode ignore：目标键已存在 → 跳过，返回 0', async () => {
    const c = makeClient([{ key: 'k' }]);
    const w = writer(c, 'ignore');
    expect(await w.writeBatch(table(), [row('k', 'string', 0n, '{"v":"x"}')])).toBe(0);
    expect(c.calls.some((a) => String(a[0]).toUpperCase() === 'SET')).toBe(false);
    await w.close();
  });

  it('writeMode replace：目标键已存在 → 先 DEL 再重建', async () => {
    const c = makeClient([{ key: 'k' }]);
    const w = writer(c, 'replace');
    expect(await w.writeBatch(table(), [row('k', 'string', 0n, '{"v":"x"}')])).toBe(1);
    expect(c.calls).toContainEqual(['DEL', 'k']);
    await w.close();
  });

  it('writeMode truncate：beforeLoad 清掉登记键后正常写入', async () => {
    const c = makeClient();
    const w = writer(c, 'truncate');
    await w.beforeLoad!(table());
    expect(await w.writeBatch(table(), [row('k', 'string', 0n, '{"v":"x"}')])).toBe(1);
    await w.close();
  });

  it('行宽不匹配 → 抛中文错误，一条不写', async () => {
    const c = makeClient();
    const w = writer(c);
    await expect(w.writeBatch(table(), [['k', 'string', 0n, 'raw', '{}']])).rejects.toThrow(/行宽不匹配/);
    expect(c.calls).toHaveLength(0);
    await w.close();
  });

  it('未知键类型 → 写端抛明确错误，不静默写空值', async () => {
    const c = makeClient();
    const w = writer(c);
    await expect(w.writeBatch(table(), [row('k', 'module', 0n, '{}')])).rejects.toThrow(/暂不支持/);
    await w.close();
  });

  it('createTable 登记 marker；tableExists 由存在性判定；dropTable 清数据键', async () => {
    const c = makeClient();
    const w = writer(c);
    const name = REDIS_ENVELOPE_TABLE;
    expect(await w.tableExists(name)).toBe(false);
    await w.createTable(table());
    expect(await w.tableExists(name)).toBe(true);
    await w.writeBatch(table(), [row('k', 'string', 0n, '{"v":"x"}')]);
    await w.dropTable(name);
    expect(await w.tableExists(name)).toBe(false);
    expect(c.calls).toContainEqual(['DEL', 'k']);
    await w.close();
  });

  it('close 调 quit', async () => {
    const c = makeClient();
    const w = writer(c);
    await w.close();
    expect(c.quit).toHaveBeenCalledTimes(1);
  });
});
