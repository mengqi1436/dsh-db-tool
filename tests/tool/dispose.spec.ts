/**
 * dispose 生命周期：适配器关闭、challenge store 停用、disposed 后拒绝新工作。
 * 对应 Stryker 存活 mutant（manager.ts dispose 块、guard dispose 标志）。
 */
import { describe, expect, it, afterAll } from 'vitest';
import type { Fixture } from '../tool/fixture.js';
import { CONN_ID, CONN_URL, makeFixture } from '../tool/fixture.js';

let fx: Fixture;

afterAll(async () => {
  if (fx) {
    const { cleanupDir } = await import('../store/helpers.js');
    cleanupDir(fx.home);
  }
});

describe('DbToolService.dispose', () => {
  it('dispose 关闭所有缓存适配器（含加载失败项不炸）', async () => {
    fx = await makeFixture('rw');
    // 建立两个连接的缓存
    fx.store.connections.create({ id: 'c2', kind: 'mysql', url: CONN_URL });
    fx.store.grants.grant((await import('../../lib/store/index.js')).normalizeProjectKey(fx.projectA), 'c2', 'rw');
    await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
    await fx.service.query(fx.projectA, 'c2', 'SELECT 1');

    // 记录 close 调用：包一层 spy
    const closed: string[] = [];
    const cache = (fx.service as unknown as { adapterCache: Map<string, Promise<DatabaseAdapterLike>> }).adapterCache;
    for (const p of cache.values()) {
      void p.then((a) => {
        const orig = a.close.bind(a);
        a.close = async () => {
          closed.push(a.connId);
          await orig();
        };
      });
    }

    await fx.service.dispose();
    await new Promise((r) => setTimeout(r, 10)); // 等 spy 挂上后的 close 完成
    expect(closed.sort()).toEqual(['c1', 'c2']);
    expect((fx.service as unknown as { adapterCache: Map<unknown, unknown> }).adapterCache.size).toBe(0);
  });

  it('dispose 后 ChallengeStore 停用（create 抛错）', async () => {
    fx = fx ?? (await makeFixture('rw'));
    await fx.service.dispose();
    const { ChallengeStore } = await import('../../lib/guard/index.js');
    const cs = (fx.service as unknown as { challenges: InstanceType<typeof ChallengeStore> }).challenges;
    expect(() => cs.create('SELECT 1')).toThrowError(/已关闭/);
  });

  it('dispose 后拒绝新工作（fail-closed：服务已关闭，而非静默执行）', async () => {
    fx = fx ?? (await makeFixture('rw'));
    await fx.service.dispose();
    await expect(fx.service.query(fx.projectA, CONN_ID, 'SELECT 1')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(fx.service.query(fx.projectB, CONN_ID, 'SELECT 1')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

interface DatabaseAdapterLike {
  connId: string;
  close(): Promise<void>;
  [k: string]: unknown;
}
