/**
 * grants.json：项目级连接授权（ro/rw）。
 * 键是 normalizeProjectKey 归一化后的项目路径。
 */
import * as path from 'node:path';
import type { AccessMode } from '../adapters/types.js';
import { readJson, writeJsonAtomic } from './io.js';

export interface GrantEntry {
  connId: string;
  mode: AccessMode;
  grantedAt: string;
}

interface GrantsFile {
  grants: Record<string, GrantEntry[]>;
}

export class GrantStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'grants.json');
  }

  private load(): GrantsFile {
    return readJson<GrantsFile>(this.file, { grants: {} });
  }

  private save(data: GrantsFile): void {
    // 0600 对齐 dsh-ssh-tunnel：授权关系本身也是敏感面（泄露项目↔库映射）
    writeJsonAtomic(this.file, data, 0o600);
  }

  /** 某项目的全部授权（不含 grantedAt，展示层无需时间戳） */
  grantsFor(projectKey: string): { connId: string; mode: AccessMode }[] {
    return (this.load().grants[projectKey] ?? []).map(({ connId, mode }) => ({ connId, mode }));
  }

  /** 授权或改授权（同连接重复授权视为更新模式） */
  grant(projectKey: string, connId: string, mode: AccessMode): void {
    const data = this.load();
    const list = data.grants[projectKey] ?? [];
    const existing = list.find((g) => g.connId === connId);
    if (existing) {
      existing.mode = mode;
      existing.grantedAt = new Date().toISOString();
    } else {
      list.push({ connId, mode, grantedAt: new Date().toISOString() });
    }
    data.grants[projectKey] = list;
    this.save(data);
  }

  /** 撤销某项目对某连接的授权。不存在时静默返回 */
  revoke(projectKey: string, connId: string): void {
    const data = this.load();
    const list = data.grants[projectKey];
    if (!list) return;
    const next = list.filter((g) => g.connId !== connId);
    if (next.length === list.length) return;
    if (next.length === 0) delete data.grants[projectKey];
    else data.grants[projectKey] = next;
    this.save(data);
  }

  /** 检查授权模式；未授权返回 undefined（ro < rw，rw 覆盖 ro） */
  check(projectKey: string, connId: string): AccessMode | undefined {
    const modes = (this.load().grants[projectKey] ?? [])
      .filter((g) => g.connId === connId)
      .map((g) => g.mode);
    if (modes.includes('rw')) return 'rw';
    return modes.includes('ro') ? 'ro' : undefined;
  }

  /** 级联清理：删除某连接在全项目范围的授权（由 ConnectionStore.remove 调用） */
  removeConn(connId: string): void {
    const data = this.load();
    let dirty = false;
    for (const key of Object.keys(data.grants)) {
      const list = data.grants[key];
      if (!list) continue;
      const next = list.filter((g) => g.connId !== connId);
      if (next.length !== list.length) {
        dirty = true;
        if (next.length === 0) delete data.grants[key];
        else data.grants[key] = next;
      }
    }
    if (dirty) this.save(data);
  }
}
