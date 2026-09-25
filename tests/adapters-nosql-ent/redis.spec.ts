/**
 * Redis 适配器离线单测（mock client 注入，不真连）。
 * 覆盖：命令解析、白名单拒绝、危险命令拦截、QueryResult 规范化、ro 模式、元数据映射。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createRedisAdapter,
  DANGEROUS_COMMANDS,
  parseRedisCommand,
  READ_COMMANDS,
  WRITE_COMMANDS,
} from '../../lib/adapters/redis/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const conn: ResolvedConnection = { meta: { id: 'r1', kind: 'redis' }, url: 'redis://localhost:6379' };

type MockClient = Record<string, unknown>;

function makeClient(): MockClient {
  return {
    ping: vi.fn(async () => 'PONG'),
    info: vi.fn(async () => '# Keyspace\r\ndb0:keys=1\r\ndb1:keys=2\r\n'),
    dbSize: vi.fn(async () => 3),
    select: vi.fn(async () => 'OK'),
    sendCommand: vi.fn(async () => 'OK'),
    get: vi.fn(async () => 'v1'),
    mGet: vi.fn(async () => ['a', null]),
    exists: vi.fn(async () => 1),
    type: vi.fn(async () => 'hash'),
    hGetAll: vi.fn(async () => ({ f1: 'v1', f2: 'v2' })),
    ttl: vi.fn(async () => 60),
    pTTL: vi.fn(async () => 60000),
    strLen: vi.fn(async () => 5),
    hLen: vi.fn(async () => 2),
    lLen: vi.fn(async () => 0),
    sCard: vi.fn(async () => 0),
    zCard: vi.fn(async () => 2),
    xLen: vi.fn(async () => 0),
    zRange: vi.fn(async () => ['a', 'b']),
    zRangeWithScores: vi.fn(async () => [{ value: 'a', score: 1 }, { value: 'b', score: 2.5 }]),
    xRange: vi.fn(async () => [{ id: '1-1', message: { f: 'v' } }]),
    lRange: vi.fn(async () => ['x', 'y']),
    sMembers: vi.fn(async () => ['m1']),
    scanIterator: vi.fn(async function* () {
      yield 'k1';
      yield 'k2';
    }),
    multi: vi.fn(() => {
      const m = { type: vi.fn(() => m), exec: vi.fn(async () => ['hash', 'string']) };
      return m;
    }),
    quit: vi.fn(async () => 'OK'),
  };
}

describe('parseRedisCommand', () => {
  it('空格分隔解析', () => {
    expect(parseRedisCommand('GET mykey')).toEqual(['GET', 'mykey']);
  });
  it('JSON 数组解析并保留带空格的值', () => {
    expect(parseRedisCommand('["SET","k","hello world"]')).toEqual(['SET', 'k', 'hello world']);
  });
  it('非法 JSON 报错', () => {
    expect(() => parseRedisCommand('["GET",')).toThrow('JSON 解析失败');
  });
  it('非字符串数组报错', () => {
    expect(() => parseRedisCommand('[1,2]')).toThrow('非空字符串数组');
  });
  it('空输入报错', () => {
    expect(() => parseRedisCommand('   ')).toThrow('不能为空');
  });
});

describe('危险命令与白名单常量', () => {
  it('DANGEROUS_COMMANDS 含全部 19 项（对齐官方 ACL dangerous 类）', () => {
    expect([...DANGEROUS_COMMANDS].sort()).toEqual(
      ['ACL', 'CONFIG', 'DEBUG', 'FLUSHALL', 'FLUSHDB', 'FUNCTION', 'KEYS', 'MIGRATE', 'MODULE',
        'REPLICAOF', 'RESET', 'RESTORE', 'SAVE', 'SCRIPT', 'SHUTDOWN', 'SLAVEOF', 'SORT', 'SORT_RO', 'SWAPDB'].sort(),
    );
  });
  it('危险清单含 SLAVEOF/MODULE/FUNCTION/SCRIPT/SORT_RO/RESET（review 补项）', () => {
    for (const c of ['SLAVEOF', 'MODULE', 'FUNCTION', 'SCRIPT', 'SORT_RO', 'RESET']) {
      expect(DANGEROUS_COMMANDS.has(c)).toBe(true);
    }
  });
  it('KEYS 不在读白名单（禁用全键扫描）', () => {
    expect(READ_COMMANDS.has('KEYS')).toBe(false);
  });
  it('读写白名单互斥', () => {
    for (const c of READ_COMMANDS) expect(WRITE_COMMANDS.has(c)).toBe(false);
    for (const c of WRITE_COMMANDS) expect(READ_COMMANDS.has(c)).toBe(false);
  });
});

describe('query 白名单与规范化', () => {
  it('写命令走 query 被拒绝', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    await expect(a.query('DEL k')).rejects.toThrow('不支持命令 DEL');
  });
  it('危险命令被拒绝', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    await expect(a.query('KEYS *')).rejects.toThrow('危险命令');
  });
  it('OBJECT 仅允许 ENCODING 子命令', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    await expect(a.query('OBJECT REFCOUNT k')).rejects.toThrow('仅支持 OBJECT ENCODING');
  });
  it('缺参数拒绝', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    await expect(a.query('GET')).rejects.toThrow('缺少参数');
  });
  it('GET → key/value 合成列', async () => {
    const c = makeClient();
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.query('GET k1');
    expect(r).toEqual({ columns: ['key', 'value'], rows: [['k1', 'v1']], rowCount: 1 });
  });
  it('超长值截断并标注', async () => {
    const c = makeClient();
    c.get = vi.fn(async () => 'x'.repeat(1500));
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.query('GET big');
    expect(r.rows[0]![1]).toBe(`${'x'.repeat(1000)}…[截断,共1500字符]`);
  });
  it('HGETALL → field/value 两行', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    const r = await a.query('HGETALL h');
    expect(r.columns).toEqual(['field', 'value']);
    expect(r.rows).toEqual([['f1', 'v1'], ['f2', 'v2']]);
  });
  it('ZRANGE WITHSCORES → member/score 数值列', async () => {
    const c = makeClient();
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.query('ZRANGE z 0 -1 WITHSCORES');
    expect(c.zRangeWithScores).toHaveBeenCalledWith('z', '0', '-1');
    expect(r.columns).toEqual(['member', 'score']);
    expect(r.rows).toEqual([['a', 1], ['b', 2.5]]);
  });
  it('SCAN 用 scanIterator → key/type 列', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    const r = await a.query('SCAN');
    expect(r.columns).toEqual(['key', 'type']);
    expect(r.rows).toEqual([['k1', 'hash'], ['k2', 'string']]);
  });
  it('SCAN 透传用户 MATCH/COUNT 给 scanIterator（默认 MATCH * / COUNT 100）', async () => {
    const c = makeClient();
    const a = await createRedisAdapter(conn, { client: c });
    await a.query('SCAN MATCH user:* COUNT 50');
    expect(c.scanIterator).toHaveBeenCalledWith({ MATCH: 'user:*', COUNT: 50 });
    const c2 = makeClient();
    const a2 = await createRedisAdapter(conn, { client: c2 });
    await a2.query('SCAN');
    expect(c2.scanIterator).toHaveBeenCalledWith({ MATCH: '*', COUNT: 100 });
  });
  it('HGETALL 超过 500 行截断并标 truncated（HKEYS/HVALS/SMEMBERS 同规则）', async () => {
    const c = makeClient();
    const big: Record<string, string> = {};
    for (let i = 0; i < 600; i++) big[`f${i}`] = `v${i}`;
    c.hGetAll = vi.fn(async () => big);
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.query('HGETALL h');
    expect(r.rowCount).toBe(500);
    expect(r.truncated).toBe(true);
    expect(r.rows[0]).toEqual(['f0', 'v0']);
    expect(r.rows[499]).toEqual(['f499', 'v499']);
    const c2 = makeClient();
    c2.hKeys = vi.fn(async () => Array.from({ length: 501 }, (_, i) => `k${i}`));
    const a2 = await createRedisAdapter(conn, { client: c2 });
    const r2 = await a2.query('HKEYS h');
    expect(r2.rowCount).toBe(500);
    expect(r2.truncated).toBe(true);
  });
});

describe('execute 白名单与 ro 拦截', () => {
  it('读命令走 execute 被拒绝', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    await expect(a.execute('GET k')).rejects.toThrow('不支持命令 GET');
  });
  it('FLUSHALL 危险命令拒绝', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    await expect(a.execute('FLUSHALL')).rejects.toThrow('危险命令');
  });
  it('SET 经 sendCommand 透传', async () => {
    const c = makeClient();
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.execute('SET k v');
    expect(c.sendCommand).toHaveBeenCalledWith(['SET', 'k', 'v']);
    expect(r.message).toContain('SET 成功');
  });
  it('数字回复 → affectedRows', async () => {
    const c = makeClient();
    c.sendCommand = vi.fn(async () => 3);
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.execute('INCR n');
    expect(r.affectedRows).toBe(3);
  });
  it('ro 模式拒绝 execute（错误信息含「连接为只读(ro)模式」）', async () => {
    const a = await createRedisAdapter(conn, { mode: 'ro', client: makeClient() });
    await expect(a.execute('SET k v')).rejects.toThrow('连接为只读(ro)模式');
  });
  it('ro 模式仍允许 query', async () => {
    const a = await createRedisAdapter(conn, { mode: 'ro', client: makeClient() });
    const r = await a.query('GET k');
    expect(r.rows).toEqual([['k', 'v1']]);
  });
});

describe('元数据映射', () => {
  it('testConnect 返回版本', async () => {
    const c = makeClient();
    c.info = vi.fn(async () => '# Server\r\nredis_version:7.2.0\r\n');
    const a = await createRedisAdapter(conn, { client: c });
    const r = await a.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toBe('Redis 7.2.0');
  });
  it('listDatabases 解析 INFO keyspace', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    expect(await a.listDatabases()).toEqual(['db0', 'db1']);
  });
  it('listDatabases 无 keyspace 回退 db0', async () => {
    const c = makeClient();
    c.info = vi.fn(async () => '');
    const a = await createRedisAdapter(conn, { client: c });
    expect(await a.listDatabases()).toEqual(['db0']);
  });
  it('listTables 抽样键并批量取类型', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    const ts = await a.listTables();
    expect(ts).toEqual([
      { name: 'k1', type: 'hash' },
      { name: 'k2', type: 'string' },
    ]);
  });
  it('describeTable 返回 type/encoding/ttl/length', async () => {
    const c = makeClient();
    c.sendCommand = vi.fn(async (args: string[]) => (args[1] === 'ENCODING' ? 'hashtable' : 'OK'));
    const a = await createRedisAdapter(conn, { client: c });
    const cols = await a.describeTable('h');
    expect(cols.map((x) => x.name)).toEqual(['type', 'encoding', 'ttl', 'length']);
    expect(cols[0]!.dataType).toBe('hash');
    expect(cols[1]!.default).toBe('hashtable');
    expect(cols[3]!.dataType).toBe('HLEN');
  });
  it('previewRows hash 取样本', async () => {
    const a = await createRedisAdapter(conn, { client: makeClient() });
    const r = await a.previewRows('h', 10);
    expect(r.columns).toEqual(['field', 'value']);
    expect(r.rowCount).toBe(2);
  });
});
