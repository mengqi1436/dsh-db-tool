/**
 * 管理器层池生命周期契约：一个连接同时存在几个适配器（= 几个驱动池）。
 *
 * 背景：每个适配器实例持有一个驱动池。dmdb/oracledb 的池已改为逐池唯一别名，
 * 但「同进程内一个连接会有几个池」由本层决定：
 *  - adapterCache 按 `${connId}@mode=${mode}` 缓存 → 同连接 ro/rw 各一个池；
 *  - testConnection / testDraft 恒新建一次性适配器（用完即关，不入缓存）；
 *  - 连接变更/删除会 dropAdapters 丢弃缓存（fire-and-forget）。
 * 这些数量关系此前无断言，而它们正是池堆积的直接来源。
 */
import { describe, expect, it } from 'vitest';
import { normalizeProjectKey } from '../../lib/store/index.js';
import { CONN_ID, makeFixture } from './fixture.js';

/** dropAdapters 为 void fire-and-forget，让出一个宏任务再断言 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('管理器层池生命周期', () => {
  it('缓存复用：同 conn+mode 多次查询只创建一次适配器', async () => {
    const fx = await makeFixture('rw');
    try {
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls).toHaveLength(1);
    } finally {
      await fx.dispose();
    }
  });

  it('ro/rw 双缓存：同一连接两种 mode 各建一个适配器（两池并存）', async () => {
    const fx = await makeFixture('rw');
    try {
      fx.store.grants.grant(normalizeProjectKey(fx.projectB), CONN_ID, 'ro');
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      await fx.service.query(fx.projectB, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls.map((c) => c.mode).sort()).toEqual(['ro', 'rw']);
      // 再分别查询：两个实例各自复用缓存，不再新建
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      await fx.service.query(fx.projectB, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls).toHaveLength(2);
    } finally {
      await fx.dispose();
    }
  });

  it('testConnection：每次新建一次性适配器并立即关闭，不污染缓存', async () => {
    const fx = await makeFixture('rw');
    try {
      await fx.service.testConnection(CONN_ID);
      await fx.service.testConnection(CONN_ID);
      expect(fx.factoryCalls).toHaveLength(2);
      expect(fx.closeCount()).toBe(2);
      // 缓存仍为空：随后查询才建立常驻适配器（第 3 次工厂调用）
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls).toHaveLength(3);
    } finally {
      await fx.dispose();
    }
  });

  it('连接删除：缓存适配器被 close，不再复用', async () => {
    const fx = await makeFixture('rw');
    try {
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls).toHaveLength(1);
      fx.service.removeConnection(CONN_ID);
      await tick();
      expect(fx.closeCount()).toBe(1);
    } finally {
      await fx.dispose();
    }
  });

  it('dispose：回收缓存适配器', async () => {
    const fx = await makeFixture('rw');
    try {
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      await fx.service.dispose();
      expect(fx.closeCount()).toBe(1);
    } finally {
      await fx.dispose(); // dispose 幂等；同时完成临时目录清理
    }
  });

  it('并发去重：同一 conn+mode 并发查询只创建一个适配器', async () => {
    const fx = await makeFixture('rw');
    try {
      // adapterCache 同步 set 后返回同一 Promise（manager.ts:1123-1138）——
      // 若该去重失效，每次并发都会新建驱动池（dmdb 会直接撞 [20006]）
      await Promise.all([
        fx.service.query(fx.projectA, CONN_ID, 'SELECT 1'),
        fx.service.query(fx.projectA, CONN_ID, 'SELECT 1'),
        fx.service.query(fx.projectA, CONN_ID, 'SELECT 1'),
      ]);
      expect(fx.factoryCalls).toHaveLength(1);
    } finally {
      await fx.dispose();
    }
  });

  it('updateConnection：丢弃并关闭缓存适配器，下次查询重建', async () => {
    const fx = await makeFixture('rw');
    try {
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls).toHaveLength(1);
      fx.service.updateConnection(CONN_ID, { name: 'renamed' });
      await tick(); // dropAdapters 为 fire-and-forget
      expect(fx.closeCount()).toBe(1);
      await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(fx.factoryCalls).toHaveLength(2);
    } finally {
      await fx.dispose();
    }
  });

  it('runScript：脚本期间存在缓存池 + 会话池两个适配器，结束后会话池被回收', async () => {
    const fx = await makeFixture('rw');
    try {
      await fx.service.runScript(fx.projectA, CONN_ID, 'return 1');
      // authorize 建缓存适配器 + 会话专用适配器（manager.ts:485,489）= 2 次工厂调用
      expect(fx.factoryCalls).toHaveLength(2);
      // 会话适配器已在 finally 关闭；缓存适配器留待 dispose
      expect(fx.closeCount()).toBe(1);
    } finally {
      await fx.dispose();
      expect(fx.closeCount()).toBe(2); // dispose 回收缓存适配器
    }
  });
});
