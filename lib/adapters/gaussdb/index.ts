/**
 * GaussDB（openGauss）适配器。
 *
 * ⚠️ 官方驱动 openGauss-connector-nodejs 未发布 npm（华为云 HCS 26.861.0 官方文档
 * 应用程序接口清单仅 JDBC/ODBC/libpq/Psycopg/Go/ECPG，无 Node 驱动），Node 接入基于
 * PostgreSQL 协议兼容自行验证。使用 vendor/gaussdb-pg 构建产物（fork 自 pg 8.6.0，
 * API 与 pg 完全兼容），未真机验证。
 *
 * 已按官方文档对齐（证据见 skills/db-admin/SKILL.md GaussDB 节）：
 * - 认证：驱动实现 openGauss SHA256 / MD5-SHA256 / SM3 握手（vendor pg-protocol parser.ts:335-357、
 *   rfc5802.js:44），对应服务端 password_encryption_type 默认 2 (sha256)；
 * - 默认端口 8000（集中式 DN / 分布式 CN）、ro 会话 `SET SESSION CHARACTERISTICS AS
 *   TRANSACTION READ ONLY` 两形态官方支持（rf-dist/gaussdb-08-0400、rf-cent/gaussdb-38-0416）；
 * - 已知限制：SERIALIZABLE 功能不支持（等价 REPEATABLE READ，与 PG 的 SSI 行为不同）；
 *   SSL 仅布尔开关（不支持 sslmode require/verify-ca/verify-full 细分）；
 *   information_schema.tables/columns 集中式有官方视图文档、分布式参考无原生视图文档
 *   （仅 M-Compatibility 模式），跨库浏览在分布式实例上以真机行为为准。
 *
 * 构建方式：bash scripts/build-gaussdb.sh（或 npm run build:gaussdb）
 * 核心逻辑与 postgresql 适配器共享（sql-shared/pg-like.ts）。
 */
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
  } catch (e) {
    // 附原始错误：区分「vendor 未构建」与「构建产物损坏/依赖缺失」两类故障
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      'GaussDB 驱动未找到：官方 openGauss-connector-nodejs 未发布 npm，' +
        '请先执行 bash scripts/build-gaussdb.sh（或 npm run build:gaussdb）构建 vendor/gaussdb-pg。' +
        `原始错误: ${msg}`,
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
