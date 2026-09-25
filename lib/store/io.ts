/**
 * 存储层文件 IO 基础设施：原子写 + 损坏容错读 + 尽力而为的权限设置。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 尽力而为地设置 POSIX 权限。
 * Windows 的 chmod 仅支持只读位，失败时静默忽略，绝不崩溃。
 */
export function chmodBestEffort(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // 权限设置失败（Windows 等）不影响功能
  }
}

/**
 * 原子写 JSON：先写同目录临时文件，再 rename 覆盖目标。
 * rename 在同一文件系统内是原子操作，进程崩溃也不会留下半个 JSON。
 * fileMode 提供时写完设置文件权限（secrets.json 传 0o600）。
 */
export function writeJsonAtomic(file: string, value: unknown, fileMode?: number): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err;
  }
  if (fileMode !== undefined) chmodBestEffort(file, fileMode);
}

/**
 * 容错读 JSON：
 *  - 文件不存在 → 返回 fallback（不创建文件，首次写时才落盘）；
 *  - 解析失败（文件损坏/被截断）→ 将原文件备份为 `<file>.bak` 后返回 fallback，
 *    让调用方以空数据继续工作，损坏现场保留在 .bak 供人工恢复。
 */
export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    try {
      fs.rmSync(`${file}.bak`, { force: true });
      fs.renameSync(file, `${file}.bak`);
    } catch {
      // 备份失败也要继续重建
    }
    return fallback;
  }
}
