/**
 * GaussDB 适配器 mock 单测（不依赖 vendor 存在，离线可跑）。
 * 核心逻辑由 pg-like.test.ts 覆盖；此处测 gaussdb 专属的驱动加载与工厂行为。
 */
// @ts-nocheck

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGaussdbAdapter } from '../../lib/adapters/gaussdb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const vendorPkg = fileURLToPath(new URL('../../vendor/gaussdb-pg/packages/pg/package.json', import.meta.url));
const vendorReady = existsSync(vendorPkg);

const conn: ResolvedConnection = {
  meta: { id: 'g1', kind: 'gaussdb' },
  fields: { host: '127.0.0.1', port: 5432, user: 'gaussdb', password: 'x', database: 'db' },
};

describe('gaussdb 适配器（mock，不依赖 vendor）', () => {
  it('vendor 不存在时抛出带构建指引的错误', async () => {
    if (vendorReady) return; // vendor 已构建时此路径不可达，由下一条覆盖
    await expect(createGaussdbAdapter(conn)).rejects.toThrow(/build-gaussdb/);
    await expect(createGaussdbAdapter(conn)).rejects.toThrow(/vendor\/gaussdb-pg/);
  });

  it('vendor 存在时创建成功，kind=gaussdb（Pool 构造不触发连接）', async () => {
    if (!vendorReady) return; // 未构建 vendor 时跳过（mock 逻辑见 pg-like.test.ts）
    const a = await createGaussdbAdapter(conn);
    expect(a.kind).toBe('gaussdb');
    expect(a.connId).toBe('g1');
    await a.close();
  });

  it('工厂导出与适配器签名一致', async () => {
    const { factory } = await import('../../lib/adapters/gaussdb/index.js');
    expect(typeof factory).toBe('function');
  });
});
