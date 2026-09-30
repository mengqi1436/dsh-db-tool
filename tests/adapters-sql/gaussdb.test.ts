/**
 * GaussDB 适配器 mock 单测（不依赖真实 GaussDB 服务端，离线可跑）。
 * 核心逻辑由 pg-like.test.ts 覆盖；此处测 gaussdb 专属的驱动加载与工厂行为。
 * 驱动为 npm 依赖 gaussdb-node（dependencies，测试环境必装），成功路径无条件执行；
 * 缺失路径通过劫持 CJS 加载入口（Module._load）模拟包未安装——
 * createRequire 生成的 require 必经该入口，且不受模块缓存影响。
 */
import { describe, expect, it } from 'vitest';
import { createGaussdbAdapter } from '../../lib/adapters/gaussdb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const conn: ResolvedConnection = {
  meta: { id: 'g1', kind: 'gaussdb' },
  fields: { host: '127.0.0.1', port: 5432, user: 'gaussdb', password: 'x', database: 'db' },
};

describe('gaussdb 适配器（mock，离线）', () => {
  it('npm 依赖 gaussdb-node 就绪时创建成功，kind=gaussdb（Pool 构造不触发连接）', async () => {
    const a = await createGaussdbAdapter(conn);
    expect(a.kind).toBe('gaussdb');
    expect(a.connId).toBe('g1');
    await a.close();
  });

  it('驱动缺失时报错指向依赖安装（不再指向 build 脚本 / vendor 路径）', async () => {
    const mod = await import('node:module');
    const Module = (mod.default ?? mod) as unknown as Record<string, unknown>;
    // 劫持 Module._load 而非 _resolveFilename：前者是 createRequire require 的必经入口，
    // 且不受 Node relResolveCache「命中即跳过解析」影响（首个用例已加载过该包）
    const orig = Module._load as (request: string, parent: unknown, isMain: boolean) => unknown;
    Module._load = function patched(request: string) {
      if (request === 'gaussdb-node') {
        const err = new Error(`Cannot find module '${request}'`);
        Object.assign(err, { code: 'MODULE_NOT_FOUND' });
        throw err;
      }
      return orig(request, arguments[1], arguments[2] as boolean);
    } as typeof orig;
    try {
      const err = await createGaussdbAdapter(conn).then(
        () => null,
        (e: unknown) => e as Error,
      );
      // instanceof 收窄同时兼任「必须 reject」断言（成功路径会在此失败）
      if (!(err instanceof Error)) {
        throw new Error(`期望驱动加载失败，实际: ${String(err)}`);
      }
      // 新文案指向依赖安装，并附原始错误（区分未安装与产物损坏）
      expect(err.message).toMatch(/gaussdb-node/);
      expect(err.message).toMatch(/重新安装插件|npm install/);
      expect(err.message).toContain('Cannot find module');
      // 旧文案（build 脚本 / vendor 路径）必须不复存在
      expect(err.message).not.toMatch(/build-gaussdb|vendor\/gaussdb-pg/);
    } finally {
      Module._load = orig;
    }
  });

  it('工厂导出与适配器签名一致', async () => {
    const { factory } = await import('../../lib/adapters/gaussdb/index.js');
    expect(typeof factory).toBe('function');
  });
});
