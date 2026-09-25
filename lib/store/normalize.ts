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
 *  4. 去尾分隔符（'c:/code/proj/' → 'c:/code/proj'）
 */
import * as path from 'node:path';

export function normalizeProjectKey(p: string): string {
  let key = path.resolve(p).replace(/\\/g, '/');
  key = key.replace(/^([A-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
  if (key.length > 1) key = key.replace(/\/+$/, '');
  return key;
}
