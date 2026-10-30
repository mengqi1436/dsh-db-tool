/**
 * 插件自身版本号（用于前端展示，让用户一眼看到当前装的是哪一版）。
 *
 * 为什么要从 package.json 读而不是写常量：发版时版本号已经在 package.json/lock/CHANGELOG
 * 三处同步，再维护一份前端常量必然漂移（最坏情况是界面显示 1.9.2 而实际装的是 1.9.1，
 * 用户报障时会给出错误版本，排障直接走偏）。
 *
 * 读取失败（打包形态差异、文件缺失）时返回 'unknown' 而不是抛错：版本展示是辅助信息，
 * 绝不能因为它让整个 API 或面板失败。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let cached: string | undefined;

/**
 * 相对本模块定位包根 package.json：lib/http/version.ts 与 dist/http/version.js 都位于包根下
 * 两级，故 '../../package.json' 对源码与构建产物同时成立（实测 dist/http 上溯两级可命中）。
 */
export function pluginVersion(): string {
  if (cached !== undefined) return cached;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = path.resolve(here, '../../package.json');
    const raw = JSON.parse(readFileSync(pkg, 'utf8')) as { version?: unknown };
    const v = typeof raw.version === 'string' ? raw.version.trim() : '';
    cached = v === '' ? 'unknown' : v;
  } catch {
    cached = 'unknown';
  }
  return cached;
}
