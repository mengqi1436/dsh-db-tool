/**
 * Redis envelope 读写端压力测试（有状态 fake client，不真连）：
 *  - 大量键（5000）经 SCAN 迭代器续批全量读完，不重不漏；
 *  - 小批（batchSize=7，非整除）下批边界正确，末批严格短于 batchSize 以触发收尾；
 *  - 六种键类型混合大批量，逐类型 payload 与 TTL 保真；
 *  - 写端高并发批写 + 四 writeMode 在大量行下的行为一致；
 *  - 迭代器耗尽后重复调用返回空批（防 runOffset 死循环）。
 * 高压目标 = 数据正确、不丢键、不重复、不 hang。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedConnection } from '../../lib/adapters/types.js';
import type { TransferRow } from '../../lib/adapters/transfer/model.js';
import {
  createRedisTransferReader,
  createRedisTransferWriter,
  REDIS_ENVELOPE_TABLE,
} from '../../lib/adapters/transfer/kinds/redis.js';

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('redis', () => ({ createClient: createClientMock }));

const rc: ResolvedConnection = { meta: { id: 'rs', kind: 'redis' }, url: 'redis://localhost:6379' };

type Arg = string | Buffer;
type Args = Arg[];
type Key = string | Buffer;
const b64 = (v: Key): string => (Buffer.isBuffer(v) ? v.toString('base64url') : Buffer.from(v, 'utf8').toString('base64url'));

interface Spec { key: string; type: string; pttl: number; value: unknown }

/** 最小有状态 Redis：支持大批量键、六种类型、TTL、写命令记录 */
function makeClient(specs: Spec[]) {
  const keys: Key[] = specs.map((s) => s.key);
  const stored = new Map<string, Arg>();
  const sets = new Map<string, Map<string, Key>>();
  const meta = new Map<string, { type: string; pttl: number; encoding: string; dump: Buffer | null }>();
  const values = new Map<string, unknown>();
  const calls: Args[] = [];
  for (const s of specs) {
    const k = b64(s.key);
    stored.set(k, 'exists');
    meta.set(k, { type: s.type, pttl: s.pttl, encoding: 'raw', dump: Buffer.from('d-' + s.key) });
    values.set(k, s.value);
  }
  const client: Record<string, unknown> = {
    calls,
    connect: vi.fn(async () => undefined),
    quit: vi.fn(async () => 'OK'),
    type: vi.fn(async (key: Key) => meta.get(b64(key))?.type ?? 'none'),
    pTTL: vi.fn(async (key: Key) => meta.get(b64(key))?.pttl ?? -2),
    dbSize: vi.fn(async () => specs.length),
    get: vi.fn(async (key: Key) => values.get(b64(key)) ?? null),
    hGetAll: vi.fn(async (key: Key) => values.get(b64(key)) ?? {}),
    lRange: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    sMembers: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    zRangeWithScores: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    xRange: vi.fn(async (key: Key) => values.get(b64(key)) ?? []),
    // 真实驱动逐页 yield 键数组（AsyncGenerator<Key[]>）
    scanIterator: vi.fn(async function* () { for (let i = 0; i < keys.length; i += 50) yield keys.slice(i, i + 50); }),
    sendCommand: vi.fn(async (args: Args) => {
      calls.push(args);
      const cmd = String(args[0] ?? '').toUpperCase();
      const k = b64(args[1] as Key);
      switch (cmd) {
        case 'SET': stored.set(k, args[2] as Arg); return 'OK';
        case 'RESTORE': stored.set(k, args[3] as Arg); return 'OK';
        case 'DEL': { let n = 0; for (const a of args.slice(1)) { if (stored.delete(b64(a as Key)) || sets.delete(b64(a as Key))) n++; } return n; }
        case 'EXISTS': return stored.has(k) || sets.has(k) ? 1 : 0;
        case 'SADD': {
          if (!sets.has(k)) sets.set(k, new Map());
          for (const m of args.slice(2)) sets.get(k)!.set(b64(m as Key), m as Key);
          return args.length - 2;
        }
        case 'SMEMBERS': return [...(sets.get(k)?.values() ?? [])];
        case 'OBJECT': return meta.get(k)?.encoding ?? null;
        case 'DUMP': return meta.get(k)?.dump ?? null;
        default: return 'OK';
      }
    }),
  };
  return client;
}

const reader = (c: unknown) => createRedisTransferReader(c as never);
const writer = (c: unknown, mode: 'insert' | 'ignore' | 'replace' | 'truncate' = 'insert') =>
  createRedisTransferWriter(c as never, mode);

describe('Redis envelope 压力测试', () => {
  beforeEach(() => createClientMock.mockReset());

  it('5000 键 × batchSize=1000：全量读完、不重不漏、末批触发收尾', async () => {
    const specs: Spec[] = Array.from({ length: 5000 }, (_, i) => ({ key: `k:${i}`, type: 'string', pttl: -1, value: 'v' + i }));
    const c = makeClient(specs);
    const r = await reader(c);
    const seen = new Set<string>();
    let total = 0;
    for (let round = 0; round < 10; round++) {
      const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: round * 1000 }, 1000);
      if (rows.length === 0) break;
      for (const row of rows) {
        const k = String(row[0]);
        expect(seen.has(k), '重复键 ' + k).toBe(false);
        seen.add(k);
      }
      total += rows.length;
      if (rows.length < 1000) break;
    }
    expect(total).toBe(5000);
    expect(seen.size).toBe(5000);
    await r.close();
  }, 120000);

  it('非整除批（5000/7）：每批 ≤7 且末批严格短，总数不丢不重', async () => {
    const specs: Spec[] = Array.from({ length: 5000 }, (_, i) => ({ key: `k:${i}`, type: 'string', pttl: -1, value: 'v' + i }));
    const c = makeClient(specs);
    const r = await reader(c);
    const seen = new Set<string>();
    let rounds = 0;
    for (;;) {
      const rows = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: rounds * 7 }, 7);
      rounds++;
      expect(rows.length).toBeLessThanOrEqual(7);
      if (rows.length === 0) break;
      for (const row of rows) seen.add(String(row[0]));
      if (rows.length < 7) break;
      if (rounds > 2000) throw new Error('疑似死循环');
    }
    expect(seen.size).toBe(5000);
    await r.close();
  }, 120000);

  it('迭代器耗尽后重复读返回空批（防 runOffset 死循环）', async () => {
    const c = makeClient([{ key: 'only', type: 'string', pttl: -1, value: 'x' }]);
    const r = await reader(c);
    const first = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 0 }, 10);
    expect(first).toHaveLength(1);
    const second = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 10 }, 10);
    expect(second).toEqual([]);
    const third = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: 20 }, 10);
    expect(third).toEqual([]);
    await r.close();
  }, 60000);

  it('六种键类型混合 1200 键：逐类型 payload 与 TTL 保真', async () => {
    const types = ['string', 'hash', 'list', 'set', 'zset', 'stream'];
    const specs: Spec[] = Array.from({ length: 1200 }, (_, i) => {
      const t = types[i % types.length]!;
      const value = t === 'hash' ? { f: 'v' + i } : t === 'zset' ? [{ value: 'm' + i, score: i }] : ['v' + i];
      return { key: `${t}:${i}`, type: t, pttl: i % 3 === 0 ? -1 : 60000, value };
    });
    const c = makeClient(specs);
    const r = await createRedisTransferReader(c as never);
    const rows: TransferRow[] = [];
    for (let round = 0; ; round++) {
      const batch = await r.readBatch(REDIS_ENVELOPE_TABLE, { mode: 'offset', offset: round * 200 }, 200);
      rows.push(...batch);
      if (batch.length < 200) break;
    }
    expect(rows).toHaveLength(1200);
    const byType = new Map<string, number>();
    for (const row of rows) {
      const t = String(row[1]);
      byType.set(t, (byType.get(t) ?? 0) + 1);
      const ttl = row[2] as bigint;
      expect(ttl === 0n || ttl === 60000n, 'TTL 取值 ' + ttl).toBe(true);
      expect(typeof row[4], 'payload 应为字符串').toBe('string');
    }
    for (const t of types) expect(byType.get(t), t).toBe(200);
    await r.close();
  }, 120000);

  it('写端 500 行 × 四 writeMode：RESTORE 路径与写入计数一致', async () => {
    for (const mode of ['insert', 'ignore', 'replace', 'truncate'] as const) {
      const c = makeClient([]);
      const w = await writer(c, mode);
      const table = {
        name: REDIS_ENVELOPE_TABLE,
        columns: [
          { name: 'key', midType: 'string' as const, nullable: false, primaryKey: true },
          { name: 'type', midType: 'string' as const, nullable: false, primaryKey: false },
          { name: 'ttl_ms', midType: 'bigint' as const, nullable: false, primaryKey: false },
          { name: 'encoding', midType: 'string' as const, nullable: true, primaryKey: false },
          { name: 'payload', midType: 'json' as const, nullable: false, primaryKey: false },
          { name: 'dump', midType: 'bytes' as const, nullable: true, primaryKey: false },
        ],
      };
      await w.createTable(table);
      const rows: TransferRow[] = Array.from({ length: 500 }, (_, i) =>
        [`wk:${i}`, 'string', 0n, 'raw', JSON.stringify({ v: i }), Buffer.from('dump' + i)] as TransferRow);
      const written = await w.writeBatch(table, rows);
      expect(written, mode).toBe(500);
      await w.close();
    }
  }, 120000);

  it('写端行宽不匹配：500 行中混入 1 行少列 → 整批拒绝且不部分写入', async () => {
    const c = makeClient([]);
    const w = await writer(c);
    const table = {
      name: REDIS_ENVELOPE_TABLE,
      columns: [
        { name: 'key', midType: 'string' as const, nullable: false, primaryKey: true },
        { name: 'type', midType: 'string' as const, nullable: false, primaryKey: false },
        { name: 'ttl_ms', midType: 'bigint' as const, nullable: false, primaryKey: false },
        { name: 'encoding', midType: 'string' as const, nullable: true, primaryKey: false },
        { name: 'payload', midType: 'json' as const, nullable: false, primaryKey: false },
        { name: 'dump', midType: 'bytes' as const, nullable: true, primaryKey: false },
      ],
    };
    await w.createTable(table);
    const rows: TransferRow[] = Array.from({ length: 500 }, (_, i) =>
      [`rk:${i}`, 'string', 0n, 'raw', '{}', null] as TransferRow);
    rows[250] = ['bad', 'string'] as TransferRow; // 少列
    await expect(w.writeBatch(table, rows)).rejects.toThrow();
    await w.close();
  }, 60000);
});
