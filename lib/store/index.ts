/**
 * dsh-db-tool 存储层顶层入口。
 *
 * 四类持久化数据位于 `$DSH_HOME/db-tool/`（DSH_HOME 环境变量，缺省 ~/.dsh）：
 *  - connections.json  连接元数据（不含密码，权限跟随目录 0700）
 *  - secrets.json      机密（密码/完整 URL，权限 0600）
 *  - grants.json       项目级连接授权
 *  - audit.jsonl       追加式审计日志
 *
 * 构造参数 homeDir 仅供测试注入临时目录。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLog } from './audit.js';
import { ConnectionStore } from './connections.js';
import { GrantStore } from './grants.js';
import { chmodBestEffort } from './io.js';
import { SecretsBox } from './secrets.js';

export { normalizeProjectKey } from './normalize.js';
export { redactUrl } from './connections.js';
export type { DangerLevel, AuditEntry, AuditEntryInput } from './audit.js';
export type {
  ConnectionCreateInput,
  ConnectionUpdateInput,
} from './connections.js';
export type { GrantEntry } from './grants.js';
export type { SecretEntry } from './secrets.js';
export { AuditLog, ConnectionStore, GrantStore, SecretsBox };

export class DbToolStore {
  /** 数据目录：$DSH_HOME/db-tool */
  readonly dir: string;
  readonly connections: ConnectionStore;
  readonly secrets: SecretsBox;
  readonly grants: GrantStore;
  readonly audit: AuditLog;

  constructor(homeDir?: string) {
    // || 而非 ??: DSH_HOME=""（空串）视为未设置，避免产出相对路径 'db-tool/'
    const home = homeDir ?? (process.env['DSH_HOME'] || path.join(os.homedir(), '.dsh'));
    this.dir = path.join(home, 'db-tool');
    fs.mkdirSync(this.dir, { recursive: true });
    chmodBestEffort(this.dir, 0o700);
    this.secrets = new SecretsBox(this.dir);
    this.grants = new GrantStore(this.dir);
    this.audit = new AuditLog(this.dir);
    this.connections = new ConnectionStore(this.dir, this.secrets, this.grants);
  }
}
