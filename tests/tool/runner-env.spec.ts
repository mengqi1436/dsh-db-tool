/** run_script 子进程环境变量白名单：脚本可读 process.env，fork 必须裁剪到最小集 */
import { describe, expect, it } from 'vitest';
import { minimalEnv } from '../../lib/script/runner.js';

const ALLOWED = new Set([
  'PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'HOME', 'LANG', 'TZ',
]);

describe('minimalEnv（fork env 白名单）', () => {
  it('仅含白名单键，宿主其余环境变量（含敏感项）不透传', () => {
    const env = minimalEnv();
    for (const key of Object.keys(env)) {
      expect(ALLOWED.has(key), `非白名单环境变量泄漏: ${key}`).toBe(true);
    }
  });

  it('PATH 必须在（worker 启动/子进程解析依赖）', () => {
    expect(minimalEnv().PATH).toBeDefined();
  });

  it('不被 fork 直接继承的宿主变量确实存在于 process.env 时被裁掉（对照）', () => {
    // 用 process.env 里真实存在但不在白名单的任一变量验证裁剪逻辑
    const leaked = Object.keys(process.env).find((k) => !ALLOWED.has(k));
    if (leaked === undefined) return; // 极端环境无多余变量时跳过对照
    expect(minimalEnv()[leaked]).toBeUndefined();
  });
});
