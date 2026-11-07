/**
 * dsh-db-tool 存储层顶层入口。
 *
 * 五类持久化数据位于 `<我的文档>/DSH/db-tool/`（与 transfer-log.jsonl 同目录，用户可直接打开查看）：
 *  - connections.json      连接元数据（不含密码，权限跟随目录 0700）
 *  - secrets.json          机密（密码/完整 URL，权限 0600）
 *  - grants.json           项目级连接授权
 *  - transfer-config.json  项目级数据传输页配置（权限 0600）
 *  - audit.jsonl           追加式审计日志
 *
 * 路径解析优先级：显式 homeDir（测试注入）> DSH_DB_TOOL_DIR > <我的文档>/DSH。
 * 历史版本把数据放在 `$DSH_HOME/db-tool/`，首次启动时按文件粒度迁移（见 migrateLegacyDir）。
 * 构造参数 homeDir 仅供测试注入临时目录。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLog } from './audit.js';
import { TransferLog, documentsDir } from './transfer-history.js';
export type { TransferLogEntry, TransferLogType } from './transfer-history.js';
import { ConnectionStore } from './connections.js';
import { GrantStore } from './grants.js';
import { chmodBestEffort } from './io.js';
import { SecretsBox } from './secrets.js';
import { TransferConfigStore } from './transfer-config.js';

/** 数据文件名（迁移按此清单逐文件搬运，避免把无关文件带过来） */
const DATA_FILES = [
  'connections.json',
  'secrets.json',
  'grants.json',
  'transfer-config.json',
  'audit.jsonl',
] as const;

/** 旧位置：$DSH_HOME/db-tool（DSH_HOME 缺省 ~/.dsh） */
function legacyDataDir(): string {
  const home = process.env['DSH_HOME'] || path.join(os.homedir(), '.dsh');
  return path.join(home, 'db-tool');
}

/**
 * 从旧位置迁移到新位置：逐文件「目标不存在才复制」，绝不覆盖新位置已有数据。
 * 迁移后保留旧文件（不删），用户可自行清理；任一文件失败不影响其余。
 */
function migrateLegacyDir(target: string, legacy: string): void {
  if (path.resolve(target) === path.resolve(legacy)) return;
  if (!fs.existsSync(legacy)) return;
  for (const name of DATA_FILES) {
    const from = path.join(legacy, name);
    const to = path.join(target, name);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.copyFileSync(from, to);
      const st = fs.statSync(from);
      chmodBestEffort(to, st.mode & 0o777);
    } catch {
      // 迁移是尽力而为：失败就保持旧位置可用，不阻塞启动
    }
  }
}

export { normalizeProjectKey } from './normalize.js';
export { mergeUrlCredentials, redactUrl, DuplicateConnectionError } from './connections.js';
export { encryptPayload, decryptPayload, DECRYPT_FAIL_MESSAGE } from './export-crypto.js';
export type { DangerLevel, AuditEntry, AuditEntryInput } from './audit.js';
export type {
  ConnectionCreateInput,
  ConnectionUpdateInput,
  ConnRecord,
} from './connections.js';
export type { GrantEntry } from './grants.js';
export type { SecretEntry } from './secrets.js';
export type { TransferConfig } from './transfer-config.js';
export { DEFAULT_TRANSFER_CONFIG } from './transfer-config.js';
export { AuditLog, ConnectionStore, GrantStore, SecretsBox, TransferConfigStore };

export class DbToolStore {
  /** 数据目录：<我的文档>/DSH/db-tool（测试注入时为 <homeDir>/db-tool） */
  readonly dir: string;
  readonly connections: ConnectionStore;
  readonly secrets: SecretsBox;
  readonly grants: GrantStore;
  readonly audit: AuditLog;
  readonly transferLog: TransferLog;
  readonly transferConfig: TransferConfigStore;

  constructor(homeDir?: string) {
    // 显式 homeDir（测试注入）优先；否则 DSH_DB_TOOL_DIR > <我的文档>/DSH
    const base = homeDir
      ?? (process.env['DSH_DB_TOOL_DIR'] && process.env['DSH_DB_TOOL_DIR'] !== ''
        ? process.env['DSH_DB_TOOL_DIR']
        : path.join(documentsDir(), 'DSH'));
    this.dir = path.join(base, 'db-tool');
    fs.mkdirSync(this.dir, { recursive: true });
    chmodBestEffort(this.dir, 0o700);
    // 旧位置 $DSH_HOME/db-tool 的数据迁移（仅生产路径；测试注入 homeDir 时跳过）
    if (!homeDir) migrateLegacyDir(this.dir, legacyDataDir());
    this.secrets = new SecretsBox(this.dir);
    this.grants = new GrantStore(this.dir);
    this.audit = new AuditLog(this.dir);
    // 传输历史与 db-tool 同根：<我的文档>/DSH/transfer-log.jsonl 供用户直接查看；
    // vitest 运行时仍走临时数据根，避免测试写用户真实文档目录
    this.transferLog = new TransferLog(
      process.env.VITEST === 'true' ? this.dir : path.dirname(this.dir),
    );
    this.connections = new ConnectionStore(this.dir, this.secrets, this.grants);
    this.transferConfig = new TransferConfigStore(this.dir);
  }
}
