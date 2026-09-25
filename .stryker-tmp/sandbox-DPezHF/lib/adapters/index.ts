/**
 * 适配器注册表：惰性动态 import 各驱动工厂。
 *
 * 任何单个驱动缺失（依赖未安装 / vendor 未构建）都不能拖垮整个插件：
 * 每个模块独立 import + catch，缺失时 query 该 kind 报带安装指引的 DRIVER_ERROR。
 * 惰性加载保证：只有真正用到某 kind 才会 import 对应模块。
 *
 * 注意：绑定 createXxxAdapter 而非各模块的 `factory` 导出——后者签名 (conn) 会
 * 丢弃 opts.mode（会话级只读双保险依赖 mode 透传）。
 */
// @ts-nocheck

import type { AccessMode, DbKind, DatabaseAdapter, ResolvedConnection } from './types.js';

/** 服务层调用签名：mode 由 grants 决定，适配器层做会话级只读双保险 */
export type AdapterFactory = (
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
) => Promise<DatabaseAdapter>;

type Loader = () => Promise<AdapterFactory>;

const LOADERS: Record<DbKind, Loader> = {
  mysql: () => import('./mysql/index.js').then((m) => m.createMysqlAdapter),
  postgresql: () => import('./postgresql/index.js').then((m) => m.createPostgresqlAdapter),
  gaussdb: () => import('./gaussdb/index.js').then((m) => m.createGaussdbAdapter),
  sqlite: () => import('./sqlite/index.js').then((m) => m.createSqliteAdapter),
  redis: () => import('./redis/index.js').then((m) => m.createRedisAdapter),
  mongodb: () => import('./mongodb/index.js').then((m) => m.createMongoAdapter),
  oracle: () => import('./oracle/index.js').then((m) => m.createOracleAdapter),
  dmdb: () => import('./dmdb/index.js').then((m) => m.createDmAdapter),
};

/** 驱动缺失时的安装指引 */
const INSTALL_HINTS: Record<DbKind, string> = {
  mysql: 'npm install mysql2',
  postgresql: 'npm install pg',
  gaussdb: 'npm run build:gaussdb（构建 vendor/gaussdb-pg）',
  sqlite: 'npm install better-sqlite3',
  redis: 'npm install redis',
  mongodb: 'npm install mongodb',
  oracle: 'npm install oracledb',
  dmdb: 'npm install dmdb',
};

/** 生成带安装指引的驱动缺失错误 */
export function driverMissingError(kind: DbKind, cause?: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause ?? '');
  const err = new Error(
    `${kind} 驱动不可用：${detail}。请安装/构建后重试：${INSTALL_HINTS[kind]}`,
  );
  err.name = 'DriverMissingError';
  return err;
}

const cache = new Map<DbKind, Promise<AdapterFactory>>();

/** 取某 kind 的适配器工厂（惰性加载并缓存；失败清缓存以便重试） */
export function getAdapter(kind: DbKind): Promise<AdapterFactory> {
  let p = cache.get(kind);
  if (!p) {
    p = LOADERS[kind]().catch((e) => {
      cache.delete(kind);
      throw driverMissingError(kind, e);
    });
    cache.set(kind, p);
  }
  return p;
}

/** 测试/插件关闭用：清空工厂缓存（不关闭已创建的适配器实例，由服务层负责） */
export function clearAdapterCache(): void {
  cache.clear();
}
