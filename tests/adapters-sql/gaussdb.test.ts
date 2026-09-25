/**
 * GaussDB 适配器 mock 单测（不依赖 vendor 存在，离线可跑）。
 * 核心逻辑由 pg-like.test.ts 覆盖；此处测 gaussdb 专属的驱动加载与工厂行为。
 */
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
  // skipIf 使报告显式呈现 skipped（原 if-return 写法显示为 pass，掩盖了用例未真正执行）
  it.skipIf(vendorReady)('vendor 不存在时抛出带构建指引的错误', async () => {
    await expect(createGaussdbAdapter(conn)).rejects.toThrow(/build-gaussdb/);
    await expect(createGaussdbAdapter(conn)).rejects.toThrow(/vendor\/gaussdb-pg/);
  });

  it.skipIf(!vendorReady)('vendor 存在时创建成功，kind=gaussdb（Pool 构造不触发连接）', async () => {
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
