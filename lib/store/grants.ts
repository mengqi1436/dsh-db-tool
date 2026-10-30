/**
 * grants.json：项目级连接授权（ro/rw）。
 * 键是 normalizeProjectKey 归一化后的项目路径。
 */
import * as path from 'node:path';
import type { AccessMode } from '../adapters/types.js';
import { normalizeProjectKey } from './normalize.js';
import { readJson, writeJsonAtomic } from './io.js';

export interface GrantEntry {
  connId: string;
  mode: AccessMode;
  grantedAt: string;
}

/** 迁移合并：同键两条授权列表按连接去重，rw 胜出（rw > ro，对齐 check），grantedAt 取较新 */
function mergeGrantLists(a: GrantEntry[], b: GrantEntry[]): GrantEntry[] {
  const map = new Map<string, GrantEntry>();
  for (const g of [...a, ...b]) {
    const prev = map.get(g.connId);
    if (!prev) {
      map.set(g.connId, { ...g });
      continue;
    }
    const mode: AccessMode = prev.mode === 'rw' || g.mode === 'rw' ? 'rw' : g.mode;
    map.set(g.connId, { connId: g.connId, mode, grantedAt: prev.grantedAt > g.grantedAt ? prev.grantedAt : g.grantedAt });
  }
  return [...map.values()];
}

interface GrantsFile {
  grants: Record<string, GrantEntry[]>;
}

/** 绝对路径形态的键（盘符开头或 POSIX 根开头）：仅这类键参与迁移归一 */
const PATH_KEY = /^(?:[a-z]:\/|\/)/i;

export class GrantStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'grants.json');
  }

  /**
   * 读入 + 兼容迁移：修复前的 grants.json 键未做 Windows 全路径小写归一
   * （仅盘符小写），同一目录可能存在多个大小写变体键。读入时把「绝对路径
   * 形态」的键统一归一化，变体合并为同一键（同连接多模式时 rw 胜出、
   * grantedAt 取最新，与 check 语义一致），下次 save 自然落盘为新键。
   * 非路径形态的键（历史遗留/测试桩，非 normalizeProjectKey 产出物）
   * 原样保留——resolve 会把它们误改写为绝对路径。归一化幂等，对新格式文件零开销。
   */
  private load(): GrantsFile {
    const raw = readJson<GrantsFile>(this.file, { grants: {} });
    const grants: GrantsFile['grants'] = {};
    for (const [k, list] of Object.entries(raw.grants ?? {})) {
      const key = PATH_KEY.test(k) ? normalizeProjectKey(k) : k;
      const prev = grants[key];
      grants[key] = prev ? mergeGrantLists(prev, list) : list;
    }
    return { grants };
  }

  private save(data: GrantsFile): void {
    // 0600 对齐 dsh-ssh-tunnel：授权关系本身也是敏感面（泄露项目↔库映射）
    writeJsonAtomic(this.file, data, 0o600);
  }

  /** 某项目的全部授权（不含 grantedAt，展示层无需时间戳） */
  grantsFor(projectKey: string): { connId: string; mode: 'ro' | 'rw' }[] {
    const key = normalizeProjectKey(projectKey);
    return (this.load().grants[key] ?? []).map(({ connId, mode }) => ({ connId, mode }));
  }

  /** 授权或改授权（同连接重复授权视为更新模式）。键在入口归一化，调用方传原始路径亦可 */
  grant(projectKey: string, connId: string, mode: AccessMode): void {
    const key = normalizeProjectKey(projectKey);
    const data = this.load();
    const list = data.grants[key] ?? [];
    const existing = list.find((g) => g.connId === connId);
    if (existing) {
      existing.mode = mode;
      existing.grantedAt = new Date().toISOString();
    } else {
      list.push({ connId, mode, grantedAt: new Date().toISOString() });
    }
    data.grants[key] = list;
    this.save(data);
  }

  /** 撤销某项目对某连接的授权。不存在时静默返回 */
  revoke(projectKey: string, connId: string): void {
    const key = normalizeProjectKey(projectKey);
    const data = this.load();
    const list = data.grants[key];
    if (!list) return;
    const next = list.filter((g) => g.connId !== connId);
    if (next.length === list.length) return;
    if (next.length === 0) delete data.grants[key];
    else data.grants[key] = next;
    this.save(data);
  }

  /** 检查授权模式；未授权返回 undefined（ro < rw，rw 覆盖 ro）。键在入口归一化 */
  check(projectKey: string, connId: string): AccessMode | undefined {
    const key = normalizeProjectKey(projectKey);
    const modes = (this.load().grants[key] ?? [])
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
