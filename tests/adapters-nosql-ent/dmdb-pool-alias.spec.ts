/**
 * 达梦多池共存回归（复现 [20006] 连接池别名已存在）。
 *
 * 驱动事实（node_modules/dmdb 源码）：池登记在模块级全局 Map（dmdb.pools），key 即
 * poolAlias；缺省别名**恒为 'default'**（src/driver/pool.js 的 `this._poolAlias = "default"`，
 * 仅显式传参才覆盖），且判重无条件执行（src/dm.js:236）→ 不传别名时第二个池**必抛**
 * [20006]（与 oracledb 的「退化匿名池」不同，见 oracle-pool-alias.spec.ts）。
 * 本测试用 mock 复刻该规则：不传别名即两个池同落 'default'，第二池抛出，据此锁定
 * 「实现必须逐池传唯一别名」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDmAdapter, openDmPool } from '../../lib/adapters/dmdb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

/** 复刻驱动的池登记表与判重逻辑（别名缺省即 'default'，无条件判重） */
const { createPoolMock, pools } = vi.hoisted(() => {
  const pools = new Map<string, unknown>();
  const createPoolMock = vi.fn(async (attrs: Record<string, unknown>) => {
    const key = (attrs.poolAlias as string | undefined) ?? 'default';
    if (pools.has(key)) {
      throw new Error('[20006] 连接池别名已存在');
    }
    const pool = {
      getConnection: vi.fn(async () => ({
        execute: vi.fn(async () => ({ rows: [], metaData: [], rowsAffected: 0 })),
        commit: vi.fn(async () => undefined),
        rollback: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => {
        pools.delete(key);
      }),
    };
    pools.set(key, pool);
    return pool;
  });
  return { createPoolMock, pools };
});

vi.mock('dmdb', () => ({
  default: { createPool: createPoolMock, OUT_FORMAT_OBJECT: 4001 },
}));

function mkConn(id: string): ResolvedConnection {
  return { meta: { id, kind: 'dmdb' }, url: 'dm://SYSDBA:SYSDBA@localhost:5236' };
}

/** 实现实际传给 createPool 的别名序列（断言实现契约） */
function passedAliases(): Array<string | undefined> {
  return createPoolMock.mock.calls.map((c) => (c[0] as { poolAlias?: string }).poolAlias);
}

describe('达梦连接池别名（[20006] 回归）', () => {
  beforeEach(() => {
    pools.clear();
    createPoolMock.mockClear();
  });

  it('同进程内两个不同达梦连接可并存', async () => {
    const a = await createDmAdapter(mkConn('c1'));
    const b = await createDmAdapter(mkConn('c2'));
    expect(createPoolMock).toHaveBeenCalledTimes(2);
    await a.close();
    await b.close();
  });

  it('已缓存连接再建池（测试连接 / ro+rw 双缓存）不撞名', async () => {
    const a = await createDmAdapter(mkConn('c1'));
    // manager 的 testConnection / testDraft / 控制台事务会话都不走 adapterCache，会在缓存池存活时另建一池
    const b = await createDmAdapter(mkConn('c1'), { mode: 'ro' });
    await a.close();
    await b.close();
  });

  it('数据传输独立池与主连接池可并存', async () => {
    const a = await createDmAdapter(mkConn('c1'));
    const p = await openDmPool(mkConn('c1'));
    await a.close();
    await p.close();
  });

  it('每池别名唯一，且不复用驱动默认别名 default', async () => {
    const a = await createDmAdapter(mkConn('c1'));
    const p = await openDmPool(mkConn('c1'));
    const aliases = passedAliases();
    expect(aliases).toHaveLength(2);
    expect(aliases).not.toContain('default');
    expect(new Set(aliases).size).toBe(2);
    await a.close();
    await p.close();
  });

  it('并发建池：别名仍两两不同（nextPoolAlias 须在 await 前求值）', async () => {
    const [a, b, p] = await Promise.all([
      createDmAdapter(mkConn('c1')),
      createDmAdapter(mkConn('c2')),
      openDmPool(mkConn('c1')),
    ]);
    const aliases = passedAliases();
    expect(aliases).toHaveLength(3);
    expect(new Set(aliases).size).toBe(3);
    await a.close();
    await b.close();
    await p.close();
  });

  it('建池失败不占用后续别名：失败后再建仍成功且每次调用都带唯一别名', async () => {
    createPoolMock.mockRejectedValueOnce(new Error('[-2501] 用户名或密码错误'));
    await expect(createDmAdapter(mkConn('c1'))).rejects.toThrow('达梦 DM 错误：[-2501] 用户名或密码错误');
    const a = await createDmAdapter(mkConn('c1'));
    // 含失败那次调用（实参在调用前求值）：两次都必须带非空且互异的别名
    const aliases = passedAliases();
    expect(aliases).toHaveLength(2);
    expect(aliases.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
    expect(new Set(aliases).size).toBe(2);
    await a.close();
  });

  it('opts.pool 注入路径完全不建池（不消耗别名）', async () => {
    const injected = { getConnection: vi.fn(), close: vi.fn(async () => undefined) };
    const a = await createDmAdapter(mkConn('c1'), { pool: injected });
    expect(createPoolMock).not.toHaveBeenCalled();
    await a.close();
  });

  it('池关闭后别名释放，同名连接可再次打开', async () => {
    const a = await createDmAdapter(mkConn('c1'));
    await a.close();
    const b = await createDmAdapter(mkConn('c1'));
    await b.close();
    expect(pools.size).toBe(0);
  });
});
