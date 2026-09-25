/**
 * secrets.json：连接级机密存储（密码、完整 URL、其余敏感键值）。
 *
 * 硬性约束：
 *  - 文件落盘后设置权限 0600（Windows 上尽力而为，失败不崩溃）；
 *  - 本类的任何返回值都是浅拷贝，外部改动不污染内部状态；
 *  - 机密绝不进入 connections.json / grants.json / 审计等其它文件。
 */
import * as path from 'node:path';
import { readJson, writeJsonAtomic } from './io.js';

export interface SecretEntry {
  password?: string;
  url?: string;
  /** 适配器需要的其余敏感键值（如 MongoDB 的凭证参数） */
  [key: string]: string | undefined;
}

interface SecretsFile {
  secrets: Record<string, SecretEntry>;
}

const FILE_MODE = 0o600;

export class SecretsBox {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'secrets.json');
  }

  private load(): SecretsFile {
    return readJson<SecretsFile>(this.file, { secrets: {} });
  }

  private save(data: SecretsFile): void {
    writeJsonAtomic(this.file, data, FILE_MODE);
  }

  /** 读取某连接的机密（浅拷贝）。不存在返回 undefined。 */
  get(connId: string): SecretEntry | undefined {
    const entry = this.load().secrets[connId];
    return entry ? { ...entry } : undefined;
  }

  /** 合并写入机密（保留未提及的旧键） */
  set(connId: string, patch: SecretEntry): void {
    const data = this.load();
    data.secrets[connId] = { ...(data.secrets[connId] ?? {}), ...patch };
    this.save(data);
  }

  /** 删除某连接的全部机密。不存在时静默返回。 */
  delete(connId: string): void {
    const data = this.load();
    if (!(connId in data.secrets)) return;
    delete data.secrets[connId];
    this.save(data);
  }
}
