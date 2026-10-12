/**
 * projectPathKey 规范化。
 *
 * 授权记录以项目路径为键，同一项目可能以不同写法出现：
 * 大小写不同的盘符、正/反斜杠、尾分隔符、相对路径。
 * 所有入口（授权、检查、审计）必须先经本函数归一化，
 * 否则同一项目会产生多条授权记录，ro/rw 检查会漏判。
 *
 * 规则（按序）：
 *  1. path.resolve → 转为绝对路径（相对路径基于 cwd 解析）
 *  2. 分隔符统一为 '/'
 *  3. Windows 盘符小写（'C:/' 与 'c:/' 是同一目录）
 *  4. Windows 全路径小写（NTFS 默认大小写不敏感：'E:/Code/App' 与
 *     'e:/code/app' 是同一目录。修复前仅盘符小写，路径段大小写保留，
 *     会话 cwd 大小写与授权时不一致（重启/不同入口的常见现象）即授权
 *     错位 → 「项目未授权该连接」，数据浏览树展开后无库无表）
 *  5. 去尾分隔符（'c:/code/proj/' → 'c:/code/proj'）
 *
 * platform 参数仅供测试注入（默认 process.platform）；非 Windows 文件
 * 系统大小写敏感，路径段保持原样。
 */
import * as path from 'node:path';

export function normalizeProjectKey(p: string, platform: NodeJS.Platform = process.platform): string {
  let key = path.resolve(p).replace(/\\/g, '/');
  key = key.replace(/^([A-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
  if (platform === 'win32') key = key.toLowerCase();
  if (key.length > 1) key = key.replace(/\/+$/, '');
  return key;
}
