/**
 * GaussDB（openGauss）适配器。
 *
 * ⚠️ 官方驱动 openGauss-connector-nodejs 未发布 npm，按 openGauss 官方 README/文档实现，
 * 使用 vendor/gaussdb-pg 构建产物（fork 自 pg 8.7 时代，API 与 pg 完全兼容），未真机验证。
 *
 * 构建方式：bash scripts/build-gaussdb.sh（或 npm run build:gaussdb）
 * 核心逻辑与 postgresql 适配器共享（sql-shared/pg-like.ts）。
 */
// @ts-nocheck

import { createRequire } from 'node:module';
import type {
  AccessMode,
  AdapterFactory,
  DatabaseAdapter,
  ResolvedConnection,
} from '../types.js';
import {
  createPgLikeAdapter,
  type PgLikeDriver,
  type TxHandle,
} from '../sql-shared/pg-like.js';

const require = createRequire(import.meta.url);
// packages 布局：pg lib 内 require('../../pg-protocol'/'../../pg-pool') 按 monorepo 假设向上两级解析
// 相对 createRequire base（lib/adapters/gaussdb/）需三级到项目根：gaussdb/ → adapters/ → lib/ → root
const VENDOR_PATH = '../../../vendor/gaussdb-pg/packages/pg';

function loadGaussDriver(): PgLikeDriver {
  try {
    // vendor 为 CJS 产物，结构同 pg：module.exports = { Pool, Client, ... }
    return require(VENDOR_PATH) as unknown as PgLikeDriver;
  } catch {
    throw new Error(
      'GaussDB 驱动未找到：官方 openGauss-connector-nodejs 未发布 npm，' +
        '请先执行 bash scripts/build-gaussdb.sh（或 npm run build:gaussdb）构建 vendor/gaussdb-pg',
    );
  }
}

export async function createGaussdbAdapter(
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  return createPgLikeAdapter('gaussdb', loadGaussDriver(), conn, opts);
}

export const factory: AdapterFactory = (conn) => createGaussdbAdapter(conn);
