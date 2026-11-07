import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	applyToContent,
	BACKUP_SUFFIX,
	FIXED_NPD_BLOCK,
	findBootIndex,
	HOTFIX_BLOCK,
	HOTFIX_MARKER,
	isApplied,
	isNpdApplied,
	NPD_FIXED_LINE,
	ORIGINAL_LINE,
	ORIGINAL_NPD_BLOCK,
	parsePatchTargetVersion,
	PATCH_BY_VERSION,
	revertContent,
	TARGET_VERSION,
	TARGET_VERSIONS,
} from '../../scripts/hotfix-core.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const patchFile = path.join(repoRoot, 'patches', 'dsh-app-boot-route-scoped-hotfix.patch');
const coreFile = path.join(repoRoot, 'scripts', 'hotfix-core.mjs');

/** 构造假 DSH 安装根：<root>/node_modules/@deepseek-ai/dsh-app-boot/{package.json,lib/index.js} */
function makeFakeDsh(root: string, indexContent: string, version: string = TARGET_VERSION): string {
	const bootRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot');
	fs.mkdirSync(path.join(bootRoot, 'lib'), { recursive: true });
	fs.writeFileSync(
		path.join(bootRoot, 'package.json'),
		JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version }),
		'utf8',
	);
	fs.writeFileSync(path.join(bootRoot, 'lib', 'index.js'), indexContent, 'utf8');
	return bootRoot;
}

/** 从 patch 文本中提取指定 hunk 的全部 + 行（去掉前缀 '+'，不含 '+++' 文件头）。 */
function extractAddedLines(text: string, hunkHeader: string): string[] {
	const lines = text.split('\n');
	const start = lines.findIndex((l) => l.startsWith(hunkHeader));
	expect(start).toBeGreaterThanOrEqual(0);
	const added: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith('@@')) break;
		if (line.startsWith('+')) added.push(line.slice(1));
	}
	return added;
}

describe('patch file contract', () => {
	it('exists and declares the target version', () => {
		expect(fs.existsSync(patchFile)).toBe(true);
		expect(parsePatchTargetVersion(fs.readFileSync(patchFile, 'utf8'))).toBe(TARGET_VERSION);
	});

	it('has the expected hunk header and hotfix marker', () => {
		const text = fs.readFileSync(patchFile, 'utf8');
		expect(text).toContain('@@ -1419,7 +1419,14 @@');
		expect(text).toContain(HOTFIX_MARKER);
	});

	it('covers the second defect site (nativePackageDir) and matches builtin blocks byte-for-byte', () => {
		const text = fs.readFileSync(patchFile, 'utf8');
		expect(text).toContain('@@ -1244,7 +1244,10 @@');
		expect(text).toContain('nativePackageDir: resolve.paths returns null');
		// 内建替换块与 patch + 行必须逐字节一致（git apply 与 builtin-replace 两条路径等价的保证）。
		// FIXED_NPD_BLOCK 的首行（函数签名）在 patch 中是上下文行，故从第二行起对比。
		const fix1Added = extractAddedLines(text, '@@ -1419,7 +1419,14 @@');
		expect(HOTFIX_BLOCK.split('\n')).toEqual(fix1Added);
		const fix2Added = extractAddedLines(text, '@@ -1244,7 +1244,10 @@');
		expect(FIXED_NPD_BLOCK.split('\n').slice(1)).toEqual(fix2Added);
	});
});

describe('0.2.0-rc.1 patch file contract', () => {
	const rc1 = '0.2.0-rc.1';
	const rc1PatchFile = path.join(repoRoot, 'patches', PATCH_BY_VERSION[rc1]!);

	it('is registered for the rc.1 version and exists with the declared target version', () => {
		expect(PATCH_BY_VERSION[rc1]).toBe('dsh-app-boot-route-scoped-hotfix-0.2.0-rc.1.patch');
		expect(TARGET_VERSIONS).toContain(rc1);
		expect(TARGET_VERSIONS).toContain(TARGET_VERSION);
		expect(fs.existsSync(rc1PatchFile)).toBe(true);
		expect(parsePatchTargetVersion(fs.readFileSync(rc1PatchFile, 'utf8'))).toBe(rc1);
	});

	it('has +1 shifted hunk headers and the same hotfix blocks byte-for-byte', () => {
		const text = fs.readFileSync(rc1PatchFile, 'utf8');
		expect(text).toContain('@@ -1420,7 +1423,14 @@');
		expect(text).toContain('@@ -1245,7 +1245,10 @@');
		expect(text).toContain(HOTFIX_MARKER);
		// 锚点行与 rc.2 逐字节一致 → 内建替换块与 rc.1 patch + 行也必须逐字节一致
		const fix1Added = extractAddedLines(text, '@@ -1420,7 +1423,14 @@');
		expect(HOTFIX_BLOCK.split('\n')).toEqual(fix1Added);
		const fix2Added = extractAddedLines(text, '@@ -1245,7 +1245,10 @@');
		expect(FIXED_NPD_BLOCK.split('\n').slice(1)).toEqual(fix2Added);
	});
});

describe('0.2.0-rc.2 patch file contract', () => {
	const rc2 = '0.2.0-rc.2';
	const rc2PatchFile = path.join(repoRoot, 'patches', PATCH_BY_VERSION[rc2]!);

	it('is registered for the rc.2 version and exists with the declared target version', () => {
		expect(PATCH_BY_VERSION[rc2]).toBe('dsh-app-boot-route-scoped-hotfix-0.2.0-rc.2.patch');
		expect(TARGET_VERSIONS).toContain(rc2);
		expect(fs.existsSync(rc2PatchFile)).toBe(true);
		expect(parsePatchTargetVersion(fs.readFileSync(rc2PatchFile, 'utf8'))).toBe(rc2);
	});

	it('has rc.1-identical hunk headers and the same hotfix blocks byte-for-byte', () => {
		const text = fs.readFileSync(rc2PatchFile, 'utf8');
		expect(text).toContain('@@ -1420,7 +1423,14 @@');
		expect(text).toContain('@@ -1245,7 +1245,10 @@');
		expect(text).toContain(HOTFIX_MARKER);
		// 0.2.0-rc.2 的 lib/index.js 与 0.2.0-rc.1 逐字节一致 → hunk 与内建块也必须逐字节一致
		const fix1Added = extractAddedLines(text, '@@ -1420,7 +1423,14 @@');
		expect(HOTFIX_BLOCK.split('\n')).toEqual(fix1Added);
		const fix2Added = extractAddedLines(text, '@@ -1245,7 +1245,10 @@');
		expect(FIXED_NPD_BLOCK.split('\n').slice(1)).toEqual(fix2Added);
	});
});

describe('applyToContent / revertContent (pure)', () => {
	it('applies the hotfix to the original line and is idempotent-guarded', () => {
		const applied = applyToContent(`before\n${ORIGINAL_LINE}\nafter\n`);
		expect(applied.ok).toBe(true);
		expect(isApplied(applied.content)).toBe(true);
		expect(applied.content).toContain('for (const searchPath of _hotPaths) {');
		// 原始行不得残留
		expect(applied.content).not.toContain('createRequire(parent).resolve.paths(name)');
		// 已应用再应用 → already-applied
		expect(applyToContent(applied.content).reason).toBe('already-applied');
	});

	it('reverts back to the original line byte-for-byte', () => {
		const original = `before\n${ORIGINAL_LINE}\nafter\n`;
		const applied = applyToContent(original);
		expect(applied.ok).toBe(true);
		const reverted = revertContent(applied.content);
		expect(reverted.ok).toBe(true);
		expect(reverted.content).toBe(original);
		// 未应用时还原 → not-applied
		expect(revertContent(original).reason).toBe('not-applied');
	});

	it('rejects content without the expected original line', () => {
		expect(applyToContent('nothing to see here').reason).toBe('target-line-not-found');
	});

	it('applies both fixes to a full two-defect sample', () => {
		const original = `before\n${ORIGINAL_LINE}\nmid\n${ORIGINAL_NPD_BLOCK}\n\tconst candidate = join(searchPath, name);\nafter\n`;
		const applied = applyToContent(original);
		expect(applied.ok).toBe(true);
		expect(isApplied(applied.content)).toBe(true);
		expect(isNpdApplied(applied.content)).toBe(true);
		expect(applied.content).toContain('for (const searchPath of _hotPaths) {');
		expect(applied.content).toContain(NPD_FIXED_LINE);
		// 两处原始形态均不得残留
		expect(applied.content).not.toContain(ORIGINAL_LINE);
		expect(applied.content).not.toContain(ORIGINAL_NPD_BLOCK);
		// 幂等：再应用 → already-applied
		expect(applyToContent(applied.content).reason).toBe('already-applied');
		// 还原 → 逐字节回到原文
		const reverted = revertContent(applied.content);
		expect(reverted.ok).toBe(true);
		expect(reverted.content).toBe(original);
	});

	it('completes the second fix on a machine that already has the first hotfix', () => {
		// 模拟只打过旧版（仅 routeScoped）补丁的机器：FIX1 已在 + FIX2 原始块
		const fix1Only = applyToContent(`before\n${ORIGINAL_LINE}\nafter\n`);
		expect(fix1Only.ok).toBe(true);
		const partial = `${fix1Only.content}\n${ORIGINAL_NPD_BLOCK}\n\tconst candidate = join(searchPath, name);\n`;
		const completed = applyToContent(partial);
		expect(completed.ok).toBe(true);
		expect(isApplied(completed.content)).toBe(true);
		expect(isNpdApplied(completed.content)).toBe(true);
		// FIX1 块不得被重复注入（幂等判据：HOTFIX_MARKER 只出现一次）
		expect(completed.content.split(HOTFIX_MARKER).length - 1).toBe(1);
	});
});

describe('apply-dsh-hotfix end-to-end (subprocess, temp DSH tree)', () => {
	/** 含两处缺陷形态的合成样本（覆盖 FIX1 + FIX2 双修复路径）。 */
	function twoDefectSample(): string {
		return [
			'line1',
			ORIGINAL_LINE,
			'line3',
			ORIGINAL_NPD_BLOCK,
			'\tconst candidate = join(searchPath, name);',
			'line6',
			'',
		].join('\n');
	}

	it('applies, is idempotent, and reverts on a synthetic sample', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-test-'));
		try {
			const original = twoDefectSample();
			const bootRoot = makeFakeDsh(tmp, original);
			const indexFile = path.join(bootRoot, 'lib', 'index.js');

			// 1) 应用（git 上下文对不上合成样本时自动回退内建替换）
			let res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			const after = fs.readFileSync(indexFile, 'utf8');
			expect(isApplied(after)).toBe(true);
			expect(isNpdApplied(after)).toBe(true);
			expect(fs.existsSync(indexFile + BACKUP_SUFFIX)).toBe(true);
			// 备份内容 = 原文
			expect(fs.readFileSync(indexFile + BACKUP_SUFFIX, 'utf8')).toBe(original);

			// 2) 幂等：再跑一次跳过
			res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			expect(res.stdout).toContain('already applied');

			// 3) 还原
			res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp, '--revert'], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			expect(fs.readFileSync(indexFile, 'utf8')).toBe(original);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it('completes the second fix on a machine that already has the old routeScoped-only patch', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-partial-'));
		try {
			// 预置：旧版补丁已应用（仅 FIX1），FIX2 仍是原始缺陷块
			const fix1Only = applyToContent(`before\n${ORIGINAL_LINE}\nafter\n`);
			expect(fix1Only.ok).toBe(true);
			const partial = `${fix1Only.content}\n${ORIGINAL_NPD_BLOCK}\n\tconst candidate = join(searchPath, name);\n`;
			const bootRoot = makeFakeDsh(tmp, partial);
			const indexFile = path.join(bootRoot, 'lib', 'index.js');

			const res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			const after = fs.readFileSync(indexFile, 'utf8');
			expect(isApplied(after)).toBe(true);
			expect(isNpdApplied(after)).toBe(true);
			expect(after.split(HOTFIX_MARKER).length - 1).toBe(1);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it('supports a 0.2.0-rc.1 install via per-version patch selection (synthetic sample → builtin fallback)', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-rc1-'));
		try {
			const original = twoDefectSample();
			const bootRoot = makeFakeDsh(tmp, original, '0.2.0-rc.1');
			const indexFile = path.join(bootRoot, 'lib', 'index.js');

			const res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			const after = fs.readFileSync(indexFile, 'utf8');
			expect(isApplied(after)).toBe(true);
			expect(isNpdApplied(after)).toBe(true);
			// 还原路径同样按 rc.1 语义工作（内建反替换 + 备份）
			const rev = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp, '--revert'], { encoding: 'utf8' });
			expect(rev.status).toBe(0);
			expect(fs.readFileSync(indexFile, 'utf8')).toBe(original);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it('exits 2 on an unsupported installed version without --force, applies with --force', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-unsup-'));
		try {
			const original = `${ORIGINAL_LINE}\n`;
			makeFakeDsh(tmp, original, '9.9.9');

			const res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(2);
			// 默认补丁声明 Target-Version 0.1.7-rc.2 → 走 mismatch 分支（而非 supported-list 分支）
			expect(res.stderr).toContain('version mismatch');

			const forced = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp, '--force'], { encoding: 'utf8' });
			expect(forced.status).toBe(0);
			expect(isApplied(fs.readFileSync(path.join(tmp, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'), 'utf8'))).toBe(true);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it('findBootIndex rejects directories whose package.json is not dsh-app-boot', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-neg-'));
		try {
			const fake = makeFakeDsh(tmp, 'x');
			fs.writeFileSync(
				path.join(fake, 'package.json'),
				JSON.stringify({ name: '@deepseek-ai/something-else', version: '1.0.0' }),
				'utf8',
			);
			expect(findBootIndex(tmp)).toBeUndefined();
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it('exits 1 when no candidate root contains dsh-app-boot', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-empty-'));
		try {
			const res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(1);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== 'win32')('ps1 wrapper passes through to core', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-ps1-'));
		try {
			const original = `${ORIGINAL_LINE}\n`;
			makeFakeDsh(tmp, original);
			const ps1 = path.join(repoRoot, 'scripts', 'apply-dsh-hotfix.ps1');
			const res = spawnSync(
				'powershell.exe',
				['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-DshRoot', tmp],
				{ encoding: 'utf8' },
			);
			expect(res.status).toBe(0);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

// git apply 路径验证：对真实 npm 原始文件的副本应用补丁（若环境无 git 则跳过）。
describe('git apply path', () => {
	/** 对 <version> 的真实 npm 原始文件应用 <patch>，断言 git apply 干净落地且与内建替换逐字节一致。 */
	function gitApplyContract(patch: string, version: string) {
		let hasGit = true;
		try {
			execFileSync('git', ['--version'], { stdio: 'ignore' });
		} catch {
			hasGit = false;
		}
		if (!hasGit) return;
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-git-'));
		try {
			const work = path.join(tmp, 'pkg', 'lib');
			fs.mkdirSync(work, { recursive: true });
			// 从 npm pack 取原始文件；失败则跳过（离线环境）。
			let tgz: string;
			try {
				execFileSync('npm', ['pack', `@deepseek-ai/dsh-app-boot@${version}`], {
					cwd: tmp,
					stdio: 'ignore',
				});
				tgz = fs
					.readdirSync(tmp)
					.find((name) => name.endsWith('.tgz')) as string;
			} catch {
				return;
			}
			execFileSync('tar', ['-xzf', tgz, '-C', tmp], { cwd: tmp, stdio: 'ignore' });
			fs.copyFileSync(path.join(tmp, 'package', 'lib', 'index.js'), path.join(work, 'index.js'));
			// git apply 的 --directory 不接受绝对路径（git 拒绝 "invalid path"），必须相对 cwd。
			execFileSync('git', ['apply', '-p1', '--directory', 'pkg', patch], {
				cwd: tmp,
			});
			const patched = fs.readFileSync(path.join(work, 'index.js'), 'utf8');
			expect(isApplied(patched)).toBe(true);
			// 两个 hunk 都必须生效
			expect(isNpdApplied(patched)).toBe(true);
			expect(patched).not.toContain(ORIGINAL_LINE);
			expect(patched).not.toContain(ORIGINAL_NPD_BLOCK);
			// git apply 与内建替换两条路径产出必须逐字节一致
			const pristine = fs.readFileSync(path.join(tmp, 'package', 'lib', 'index.js'), 'utf8');
			expect(patched).toBe(applyToContent(pristine).content);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	}

	it('patch applies cleanly to the pristine upstream 0.1.7-rc.2 file via git apply', () => {
		gitApplyContract(patchFile, TARGET_VERSION);
	});

	it('patch applies cleanly to the pristine upstream 0.2.0-rc.1 file via git apply', () => {
		gitApplyContract(
			path.join(repoRoot, 'patches', PATCH_BY_VERSION['0.2.0-rc.1']!),
			'0.2.0-rc.1',
		);
	});

	it('patch applies cleanly to the pristine upstream 0.2.0-rc.2 file via git apply', () => {
		gitApplyContract(
			path.join(repoRoot, 'patches', PATCH_BY_VERSION['0.2.0-rc.2']!),
			'0.2.0-rc.2',
		);
	});
});

/* ---------------- 0.2.1-rc.3（DSH 0.2.1-rc.3 适配） ---------------- */

const RC3 = '0.2.1-rc.3';
const rc3PatchFile = path.join(repoRoot, 'patches', PATCH_BY_VERSION[RC3]!);

/** git 可用性（与现有 gitApplyContract 同一判据，供内联 fixture 用例复用）。 */
function gitAvailable(): boolean {
	try {
		execFileSync('git', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** nativePackageDir hunk 的 7 行原文（上下文 3 + 原始缺陷行 + 上下文 3）。 */
const NPD_HUNK_LINES = [
	'\treturn treePrefix + (end < 0 ? rest : rest.slice(0, end));',
	'}',
	'function nativePackageDir(parent, name) {',
	// 注意：nativePackageDir 函数体内是 1 个 tab 缩进（与 routeScoped 的 2 tab 不同）
	ORIGINAL_NPD_BLOCK.split('\n')[1]!,
	'\t\tconst candidate = join(searchPath, name);',
	'\t\tif (existsSync(join(candidate, "package.json"))) return candidate;',
	'\t}',
];

/** routeScoped hunk 的 7 行原文。 */
const ROUTE_HUNK_LINES = [
	'\t\tconst target = resolution.entries.get(name);',
	'\t\tconst candidates = [];',
	'\t\tconst localSearchPaths = [];',
	ORIGINAL_LINE,
	'\t\t\tif (!searchPath.startsWith(layer.localPrefix)) break;',
	'\t\t\tlocalSearchPaths.push(searchPath);',
	'\t\t\tconst candidate = localPackageCandidate(searchPath, name, flavor);',
];

/**
 * 按 hunk 头的旧文件行号构造最小 LF fixture（行号对齐，其余行用填充行）。
 * 不依赖 /tmp 提取件、npm pack 或网络——补丁的上下文行在此逐字节复现。
 */
function buildAlignedFixture(segments: Array<{ start: number; lines: string[] }>): string {
	const out: string[] = [];
	const sorted = [...segments].sort((a, b) => a.start - b.start);
	let cursor = 1;
	for (const seg of sorted) {
		while (cursor < seg.start) {
			out.push(`// filler ${cursor}`);
			cursor++;
		}
		for (const line of seg.lines) {
			out.push(line);
			cursor++;
		}
	}
	out.push('');
	return out.join('\n');
}

/** 各受支持版本的 hunk 起点（来自各 patch 的 @@ 头）。 */
const HUNK_START_BY_VERSION: Record<string, { npd: number; route: number }> = {
	'0.1.7-rc.2': { npd: 1244, route: 1419 },
	'0.2.0-rc.1': { npd: 1245, route: 1420 },
	'0.2.0-rc.2': { npd: 1245, route: 1420 },
	'0.2.1-rc.3': { npd: 1368, route: 1625 },
};

function fixtureForVersion(version: string): string {
	const starts = HUNK_START_BY_VERSION[version];
	if (!starts) throw new Error(`no hunk map for ${version}`);
	return buildAlignedFixture([
		{ start: starts.npd, lines: NPD_HUNK_LINES },
		{ start: starts.route, lines: ROUTE_HUNK_LINES },
	]);
}

describe('0.2.1-rc.3 patch file contract', () => {
	it('is registered for the rc.3 version and exists with the declared target version', () => {
		expect(PATCH_BY_VERSION[RC3]).toBe('dsh-app-boot-route-scoped-hotfix-0.2.1-rc.3.patch');
		expect(TARGET_VERSIONS).toContain(RC3);
		expect(fs.existsSync(rc3PatchFile)).toBe(true);
		expect(parsePatchTargetVersion(fs.readFileSync(rc3PatchFile, 'utf8'))).toBe(RC3);
	});

	it('has rc.3 line-shifted hunk headers and the same hotfix blocks byte-for-byte', () => {
		const text = fs.readFileSync(rc3PatchFile, 'utf8');
		// 0.2.1-rc.3 的 lib/index.js：npd for 行 1371、routeScoped for 行 1628
		expect(text).toContain('@@ -1368,7 +1368,10 @@');
		expect(text).toContain('@@ -1625,7 +1628,14 @@');
		expect(text).toContain(HOTFIX_MARKER);
		const routeAdded = extractAddedLines(text, '@@ -1625,7 +1628,14 @@');
		expect(HOTFIX_BLOCK.split('\n')).toEqual(routeAdded);
		const npdAdded = extractAddedLines(text, '@@ -1368,7 +1368,10 @@');
		expect(FIXED_NPD_BLOCK.split('\n').slice(1)).toEqual(npdAdded);
	});

	it('keeps one patch per supported version and every patch declares its own version', () => {
		expect(PATCH_BY_VERSION['0.1.7-rc.2']).toBe('dsh-app-boot-route-scoped-hotfix.patch');
		expect(PATCH_BY_VERSION['0.2.0-rc.1']).toBe('dsh-app-boot-route-scoped-hotfix-0.2.0-rc.1.patch');
		expect(PATCH_BY_VERSION['0.2.0-rc.2']).toBe('dsh-app-boot-route-scoped-hotfix-0.2.0-rc.2.patch');
		expect(PATCH_BY_VERSION[RC3]).toBe('dsh-app-boot-route-scoped-hotfix-0.2.1-rc.3.patch');
		for (const [version, file] of Object.entries(PATCH_BY_VERSION)) {
			const text = fs.readFileSync(path.join(repoRoot, 'patches', file), 'utf8');
			expect(parsePatchTargetVersion(text)).toBe(version);
		}
	});

	it.skipIf(!gitAvailable())('applies cleanly to a line-aligned LF fixture via git apply (no network)', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-rc3-git-'));
		try {
			const fixture = fixtureForVersion(RC3);
			const work = path.join(tmp, 'pkg', 'lib');
			fs.mkdirSync(work, { recursive: true });
			fs.writeFileSync(path.join(work, 'index.js'), fixture, 'utf8');

			// --check：证明补丁上下文与 rc.3 行号布局逐字节匹配
			execFileSync(
				'git',
				['-c', 'core.autocrlf=false', 'apply', '--check', '-p1', '--directory', 'pkg', rc3PatchFile],
				{ cwd: tmp },
			);
			// 真应用：两处 hunk 都生效，且与内建替换路径逐字节一致
			execFileSync(
				'git',
				['-c', 'core.autocrlf=false', 'apply', '-p1', '--directory', 'pkg', rc3PatchFile],
				{ cwd: tmp },
			);
			const patched = fs.readFileSync(path.join(work, 'index.js'), 'utf8');
			expect(isApplied(patched)).toBe(true);
			expect(isNpdApplied(patched)).toBe(true);
			expect(patched).not.toContain(ORIGINAL_LINE);
			expect(patched).not.toContain(ORIGINAL_NPD_BLOCK);
			expect(patched).toBe(applyToContent(fixture).content);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it.skipIf(!gitAvailable())('selects the rc.3 patch for an installed 0.2.1-rc.3 (no exit 2, git-apply path)', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-rc3-select-'));
		try {
			const fixture = fixtureForVersion(RC3);
			makeFakeDsh(tmp, fixture, RC3);
			const res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			expect(res.stderr).not.toContain('version mismatch');
			// 只有选中行号匹配的 rc.3 补丁才会走 git-apply；选错补丁会失配回退 builtin-replace
			expect(res.stdout).toContain('via git-apply');
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	for (const version of ['0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2']) {
		it.skipIf(!gitAvailable())(
			`keeps selecting the per-version patch for an installed ${version} (git-apply path)`,
			() => {
				const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-ver-select-'));
				try {
					makeFakeDsh(tmp, fixtureForVersion(version), version);
					const res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
					expect(res.status).toBe(0);
					expect(res.stdout).toContain('via git-apply');
				} finally {
					fs.rmSync(tmp, { recursive: true, force: true });
				}
			},
		);
	}

	it('is idempotent on the rc.3 fixture (second run reports already applied) and reverts byte-for-byte', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-rc3-idem-'));
		try {
			const fixture = fixtureForVersion(RC3);
			const bootRoot = makeFakeDsh(tmp, fixture, RC3);
			const indexFile = path.join(bootRoot, 'lib', 'index.js');

			const first = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(first.status).toBe(0);
			const after = fs.readFileSync(indexFile, 'utf8');
			expect(isApplied(after)).toBe(true);
			expect(isNpdApplied(after)).toBe(true);

			const second = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(second.status).toBe(0);
			expect(second.stdout).toContain('already applied');

			const reverted = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp, '--revert'], {
				encoding: 'utf8',
			});
			expect(reverted.status).toBe(0);
			expect(fs.readFileSync(indexFile, 'utf8')).toBe(fixture);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe('package.json engines.dsh（严格 semver）', () => {
	it('accepts supported DSH versions and rejects 0.3.x', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
			engines?: { dsh?: string };
		};
		const range = pkg.engines?.dsh;
		expect(typeof range).toBe('string');
		const require = createRequire(import.meta.url);
		const semver = require('semver') as { satisfies(version: string, range: string): boolean };

		for (const version of ['0.2.2-rc.1', '0.2.1-rc.3', '0.2.1-rc.2', '0.2.0-rc.2', '0.1.7-rc.2']) {
			expect(semver.satisfies(version, range!), `${version} 应在 engines.dsh 范围内`).toBe(true);
		}
		// 0.2.2 系列 prerelease 必须显式列元组：`>=0.2.1-rc.2 <0.3.0-0` 在严格 semver 下不命中 0.2.2-rc.1
		// （prerelease 只在同一 [主,次,补] 元组描述符内比较），缺少 `>=0.2.2-rc.1 <0.3.0-0` 段会让宿主准入失败。
		for (const version of ['0.3.0-0', '0.3.0']) {
			expect(semver.satisfies(version, range!), `${version} 不应在 engines.dsh 范围内`).toBe(false);
		}
	});
});
