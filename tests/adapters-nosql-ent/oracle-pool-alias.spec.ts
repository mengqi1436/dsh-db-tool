/**
 * Oracle 多池并存回归。
 *
 * 驱动事实（读源码 + 真实驱动离线实测确认，oracledb 7.0.1）：
 *  - 池登记在模块级 poolCache（lib/oracledb.js:71），但别名规则**与 dmdb 不同**：
 *    只有「显式传入的别名」或「'default' 尚空闲时取到的缺省值」会被登记；
 *    两者都被占用时，驱动创建的是 poolAlias === undefined 的**匿名池**
 *    （不报错，也无法经 getPool() 检索）；只有显式重复别名才抛 NJS-046
 *    ERR_POOL_WITH_ALIAS_ALREADY_EXISTS（lib/oracledb.js:640-649、lib/errors.js:352）。
 *  - 实测（poolMin:0 离线）：不传别名连建两池 → 第二池 poolAlias === undefined，不抛错；
 *    显式传重复别名 → NJS-046。
 *
 * 因此本插件的修复目标不是「消除崩溃」（不传别名并不会崩），而是让**每池都有唯一、
 * 可检索、且不抢占 getPool() 缺省键 'default' 的身份**。本测试据此断言实现传参契约
 * （断言的是 createPool 收到的 poolAlias，而非驱动反应），去掉 poolAlias 必然变红。
 * mock 只负责忠实复刻上述登记/判重规则，保证「多池能真正建起来」这一半也可验证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOracleAdapter, openOraclePool } from '../../lib/adapters/oracle/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

/** 复刻 oracledb 的 poolCache 与别名判定（含「匿名池」这一真实退化路径） */
const { createPoolMock, poolCache } = vi.hoisted(() => {
  const poolCache = new Map<string, unknown>();
  const createPoolMock = vi.fn(async (attrs: Record<string, unknown>) => {
    const explicit = attrs.poolAlias as string | undefined;
    // oracledb.js:640-649：显式别名原样使用；否则仅当 'default' 空闲时才取 default
    let alias = explicit;
    if (explicit === undefined && !poolCache.has('default')) alias = 'default';
    if (alias !== undefined && poolCache.has(alias)) {
      throw new Error(`NJS-046: pool alias "${alias}" already exists in the connection pool cache`);
    }
    const pool = {
      poolAlias: alias,
      getConnection: vi.fn(async () => ({
        execute: vi.fn(async () => ({ rows: [], metaData: [], rowsAffected: 0 })),
        commit: vi.fn(async () => undefined),
        rollback: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => {
        if (alias !== undefined) poolCache.delete(alias);
      }),
    };
    if (alias !== undefined) poolCache.set(alias, pool);
    return pool;
  });
  return { createPoolMock, poolCache };
});

vi.mock('oracledb', () => ({
  default: {
    createPool: createPoolMock,
    // 模块顶层副作用（fetchAsString/fetchAsBuffer 幂等追加）所需的运行时引用
    fetchAsString: [],
    fetchAsBuffer: [],
    CLOB: 1,
    BLOB: 2,
    Lob: class Lob {},
    OBJECT: 4001,
  },
}));

function mkConn(id: string): ResolvedConnection {
  return { meta: { id, kind: 'oracle' }, url: 'oracle://scott:tiger@dbhost:1521/ORCLPDB1' };
}

/** 实现实际传给 createPool 的别名序列（断言实现契约，不依赖驱动反应） */
function passedAliases(): Array<string | undefined> {
  return createPoolMock.mock.calls.map((c) => (c[0] as { poolAlias?: string }).poolAlias);
}

/** 每个池都必须有显式、唯一、非 'default' 的别名 */
function expectUniqueExplicitAliases(): void {
  const aliases = passedAliases();
  expect(aliases.length).toBeGreaterThan(1);
  expect(aliases.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
  expect(aliases).not.toContain('default');
  expect(new Set(aliases).size).toBe(aliases.length);
}

describe('Oracle 连接池别名（匿名池退化回归）', () => {
  beforeEach(() => {
    poolCache.clear();
    createPoolMock.mockClear();
  });

  it('两个不同 Oracle 连接并存：各持唯一非 default 别名', async () => {
    const a = await createOracleAdapter(mkConn('c1'));
    const b = await createOracleAdapter(mkConn('c2'));
    expectUniqueExplicitAliases();
    await a.close();
    await b.close();
  });

  it('已缓存连接再建池（测试连接 / ro+rw 双缓存）不退化、不撞名', async () => {
    const a = await createOracleAdapter(mkConn('c1'));
    const b = await createOracleAdapter(mkConn('c1'), { mode: 'ro' });
    expectUniqueExplicitAliases();
    await a.close();
    await b.close();
  });

  it('数据传输独立池与主连接池可并存', async () => {
    const a = await createOracleAdapter(mkConn('c1'));
    const p = await openOraclePool(mkConn('c1'));
    expectUniqueExplicitAliases();
    await a.close();
    await p.close();
  });

  it('并发建池：别名仍两两不同（nextPoolAlias 须在 await 前求值）', async () => {
    const [a, b, p] = await Promise.all([
      createOracleAdapter(mkConn('c1')),
      createOracleAdapter(mkConn('c2')),
      openOraclePool(mkConn('c1')),
    ]);
    expectUniqueExplicitAliases();
    await a.close();
    await b.close();
    await p.close();
  });

  it('池关闭后登记项清空，同名连接可再次打开（close 确实被调用）', async () => {
    const a = await createOracleAdapter(mkConn('c1'));
    await a.close();
    expect(poolCache.size).toBe(0);
    const b = await createOracleAdapter(mkConn('c1'));
    await b.close();
    expect(poolCache.size).toBe(0);
  });

  it('opts.pool 注入路径完全不建池（不消耗别名）', async () => {
    const injected = { getConnection: vi.fn(), close: vi.fn(async () => undefined) };
    const a = await createOracleAdapter(mkConn('c1'), { pool: injected });
    expect(createPoolMock).not.toHaveBeenCalled();
    await a.close();
  });

  it('建池失败仍经 humanizeOraError 包装（catch 路径）', async () => {
    createPoolMock.mockRejectedValueOnce(new Error('ORA-01017: invalid username/password'));
    await expect(createOracleAdapter(mkConn('c1'))).rejects.toThrow('用户名或密码错误');
    // 证明确实走的是建池调用（且只调一次），而非在校验/解析阶段提前失败
    expect(createPoolMock).toHaveBeenCalledTimes(1);
  });
});
