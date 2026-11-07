/**
 * 依赖树 core-module 同名包守卫（DSH 宿主 routeScoped resolve.paths bug 规避）。
 *
 * 背景：宿主 @deepseek-ai/dsh-app-boot 0.1.7-rc.2 在插件安装/加载时会对依赖树中的每个包名
 * 调 `require.resolve.paths(name)` 并对返回值做 for..of；Node 对核心模块同名包（如 punycode）
 * 返回 null → TypeError，导致整个插件无法加载。规避方式：生产依赖树中不得出现任何
 * core-module 同名包（mongodb 链上的 tr46→punycode 即此问题，mongodb 已改为构建期 bundle
 * 进 vendor/mongodb-driver.cjs，见 scripts/build-mongodb.ps1）。
 *
 * 断言 1（声明层）：package.json dependencies 键集 ⊆ 白名单 —— 防止未来把 mongodb 或其他
 *   会引入 core 同名传递依赖的包误加回生产依赖。
 * 断言 2（实树层）：package-lock.json 中非 dev 条目（= 生产树会安装的包）与 core-module
 *   黑名单（module.builtinModules + punycode）的交集必须为空。
 */
import { readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgUrl = fileURLToPath(new URL('../../package.json', import.meta.url));
const lockUrl = fileURLToPath(new URL('../../package-lock.json', import.meta.url));

/** 允许出现在 dependencies/optionalDependencies 中的包白名单（bson 是 mongodb bundle 的 external，必须保留；
 * gaussdb-node 是 GaussDB 适配器驱动，依赖树 gaussdb-{connection-string,pool,protocol,cloudflare}/
 * pg-types/pgpass 无 core-module 同名包，见下方 lockfile 实树断言） */
const DEPS_ALLOWLIST = new Set([
  'better-sqlite3',
  'bson',
  'dmdb',
  'gaussdb-node',
  'mysql2',
  'oracledb',
  'pg',
  'redis',
]);

/** core-module 黑名单：builtinModules 加上 punycode（Node 21+ builtinModules 可能不含它，
 * 但 require.resolve.paths('punycode') 仍返回 null，宿主 bug 照样触发） */
const CORE_NAME_BLACKLIST = new Set([...builtinModules, 'punycode']);

/** 从 lockfile packages 段的键（如 "node_modules/@scope/name" 或嵌套
 * "node_modules/a/node_modules/b"）提取包名（最后一个 node_modules 段，scoped 取两段）。
 * 注意顶层键形如 "node_modules/x"（无前导斜杠），不能只用 "/node_modules/" 匹配。 */
function packageNameFromLockKey(key: string): string | undefined {
  if (!key.includes('node_modules/')) return undefined; // 根条目 "" 等非包键
  const parts = key.split('node_modules/').filter(Boolean);
  const tail = parts[parts.length - 1];
  if (tail === undefined) return undefined;
  if (tail.startsWith('@')) {
    const m = /^(@[^/]+\/[^/]+)/.exec(tail); // scoped 包 "@scope/name"（可能再嵌 node_modules/...）
    return m ? m[1] : undefined;
  }
  return tail.split('/')[0];
}

describe('依赖树 core-module 同名包守卫（宿主 resolve.paths bug 规避）', () => {
  it('package.json dependencies 键集 ⊆ 白名单（不得把 mongodb 等加回生产依赖）', () => {
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    const offenders = deps.filter((name) => !DEPS_ALLOWLIST.has(name));
    expect(offenders).toEqual([]);
  });

  it('package.json optionalDependencies 键集 ⊆ 白名单（better-sqlite3 为原生模块，仅可作可选依赖）', () => {
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { optionalDependencies?: Record<string, string> };
    const deps = Object.keys(pkg.optionalDependencies ?? {});
    const offenders = deps.filter((name) => !DEPS_ALLOWLIST.has(name));
    expect(offenders).toEqual([]);
  });

  it('package-lock.json 生产树（非 dev 条目）不含任何 core-module 同名包', () => {
    const lock = JSON.parse(readFileSync(lockUrl, 'utf8')) as {
      packages?: Record<string, { dev?: boolean; devOptional?: boolean }>;
    };
    const prodNames = new Set<string>();
    for (const [key, meta] of Object.entries(lock.packages ?? {})) {
      // dev/devOptional 标记 = 仅开发依赖可达，不会随插件发布安装
      if (meta?.dev || meta?.devOptional) continue;
      const name = packageNameFromLockKey(key);
      if (name) prodNames.add(name);
    }
    const collisions = [...prodNames].filter((name) => CORE_NAME_BLACKLIST.has(name));
    expect(collisions).toEqual([]);
  });
});

/**
 * 已知漏洞包的 overrides 守卫。
 *
 * 背景：这几条漏洞全部落在开发依赖链（变异测试链 @stryker-mutator/core / stryker-cli）上，
 * 生产运行时零暴露，但 Dependabot 仍会持续告警。上游迟迟不发修复版：external-editor 仍锁
 * `tmp ^0.0.33`、stryker-cli 仍锁 `inquirer ^6.2.2`，只能在 package.json 的 overrides 里
 * 强制提到修复版本（与既有的 `tedious` 覆盖同一手法）。
 *
 * 断言：lockfile 实树中这些包的实际解析版本必须 ≥ 各自的修复下限。删掉 overrides 条目会让
 * 版本回落到漏洞区间，此用例即失败——防止「以为修好了其实没生效」。
 */
const VULN_FLOORS: Record<string, string> = {
  // GHSA: tmp 经未净化 prefix/postfix 做路径穿越（high），0.2.6 修复
  tmp: '0.2.7',
  // GHSA: qs arrayFormat 'comma' 下非可调用 toString 触发未捕获 TypeError（medium），6.16.1 修复
  qs: '6.17.1',
  // GHSA: minimatch 经 globparts 放大的拒绝服务（medium），11.0.1 修复（10.x 无修复版）
  minimatch: '11.0.5',
  // GHSA: zod 校验超大受限集合时可耗尽内存（high），4.6.6 修复
  zod: '4.6.7',
};

describe('已知漏洞包 overrides 守卫（Dependabot open 告警回归）', () => {
  it('lockfile 实树中漏洞包版本均不低于修复下限', () => {
    const lock = JSON.parse(readFileSync(lockUrl, 'utf8')) as {
      packages?: Record<string, { version?: string }>;
    };
    const resolve = createRequire(import.meta.url);
    const semver = resolve('semver') as {
      satisfies(version: string, range: string): boolean;
      lt(a: string, b: string): boolean;
      valid(v: string): string | null;
    };

    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const [key, meta] of Object.entries(lock.packages ?? {})) {
      const name = packageNameFromLockKey(key);
      if (!name || !(name in VULN_FLOORS)) continue;
      const ver = meta?.version;
      if (typeof ver !== 'string' || semver.valid(ver) === null) continue;
      seen.add(name);
      const floor = VULN_FLOORS[name]!;
      if (semver.lt(ver, floor)) offenders.push(`${name}@${ver} < ${floor} (${key})`);
    }

    expect(offenders).toEqual([]);
    // 四条都应实装（防止某条覆盖被整体移除后用例因「没找到包」而空转通过）
    expect([...seen].sort()).toEqual(Object.keys(VULN_FLOORS).sort());
  });

  it('package.json overrides 声明了这些包的修复范围', () => {
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { overrides?: Record<string, string> };
    const overrides = pkg.overrides ?? {};
    for (const name of Object.keys(VULN_FLOORS)) {
      expect(overrides[name], `package.json overrides 缺少 ${name}，版本会回落到漏洞区间`).toBeDefined();
    }
  });
});
