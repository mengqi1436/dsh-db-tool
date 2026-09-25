/**
 * PostgreSQL 适配器（pg 8.x）。核心逻辑在 sql-shared/pg-like.ts，此处仅做驱动绑定。
 * ro 模式：pool 'connect' 事件设只读会话（服务器级）+ 服务层拦截 execute（双保险）。
 *
 * 说明：pg 包未提供 ESM 类型入口（exports 无 types 条件），统一用 createRequire
 * 加载 CJS 入口并按 PgLikeDriver 结构使用——与 gaussdb vendor 加载路径对称。
 */
import { createRequire } from 'node:module';
import type { AccessMode, AdapterFactory, DatabaseAdapter, ResolvedConnection } from '../types.js';
import { createPgLikeAdapter, type PgLikeDriver, type TxHandle } from '../sql-shared/pg-like.js';

const require = createRequire(import.meta.url);

export async function createPostgresqlAdapter(
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  const driver = require('pg') as unknown as PgLikeDriver;
  return createPgLikeAdapter('postgresql', driver, conn, opts);
}

export const factory: AdapterFactory = (conn) => createPostgresqlAdapter(conn);
