/**
 * GaussDB（openGauss）适配器。
 *
 * 驱动：npm 包 gaussdb-node（华为云官方组织 HuaweiCloudDeveloper/gaussdb-node，
 * pg 兼容 fork，导出结构同 pg：Pool/Client）。npm 安装即含 GaussDB 支持，无需
 * 额外构建；依赖树（gaussdb-connection-string/gaussdb-pool/gaussdb-protocol/
 * pg-types/pgpass/gaussdb-cloudflare）无 p-limit 等高版本要求，Node ≥ 20 即可。
 *
 * 认证支持（依包内实现核对，未真机验证）：
 * - sha256（RFC5802，password_encryption_type=2 默认）：已实现——
 *   gaussdb-node/lib/crypto/rfc5802.js + client.js _handleAuthSHA256Password、
 *   gaussdb-protocol parser AuthenticationSHA256Password（case 10）分支；
 * - md5（标准 PG 形态 md5(md5(password+user)+salt)）：已实现（gaussdbMd5PasswordHash）；
 * - md5-sha256 混合（type=1）与 SM3（type=3）：包内未提供（rfc5802 仅支持 sha256
 *   method、无 gm-crypto 依赖）——sha256/md5 已证，md5-sha256 混合与 SM3 未证，
 *   服务端要求这两种认证方式时会握手失败。
 *
 * 已按官方文档对齐（证据见 skills/db-admin/SKILL.md GaussDB 节）：
 * - 默认端口 8000（集中式 DN / 分布式 CN）、ro 会话 `SET SESSION CHARACTERISTICS AS
 *   TRANSACTION READ ONLY` 两形态官方支持（rf-dist/gaussdb-08-0400、rf-cent/gaussdb-38-0416）；
 * - 已知限制：SERIALIZABLE 功能不支持（等价 REPEATABLE READ，与 PG 的 SSI 行为不同）；
 *   SSL 仅布尔开关（不支持 sslmode require/verify-ca/verify-full 细分）；
 *   information_schema.tables/columns 集中式有官方视图文档、分布式参考无原生视图文档
 *   （仅 M-Compatibility 模式），跨库浏览在分布式实例上以真机行为为准。
 *
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

function loadGaussDriver(): PgLikeDriver {
  try {
    // gaussdb-node 为 CJS 包，结构同 pg：module.exports = { Pool, Client, ... }
    return require('gaussdb-node') as unknown as PgLikeDriver;
  } catch (e) {
    // 附原始错误：区分「依赖未安装」与「安装产物损坏」两类故障
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      'GaussDB 驱动未找到：请重新安装插件（npm install gaussdb-node 或重装 dsh-db-tool）。' +
        `原始错误: ${msg}`,
    );
  }
}

/** 数据传输模块用的驱动加载入口 */
export { loadGaussDriver };

export async function createGaussdbAdapter(
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  return createPgLikeAdapter('gaussdb', loadGaussDriver(), conn, opts);
}

export const factory: AdapterFactory = (conn) => createGaussdbAdapter(conn);
