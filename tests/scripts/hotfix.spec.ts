import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	applyToContent,
	BACKUP_SUFFIX,
	findBootIndex,
	HOTFIX_MARKER,
	isApplied,
	ORIGINAL_LINE,
	parsePatchTargetVersion,
	revertContent,
	TARGET_VERSION,
} from '../../scripts/hotfix-core.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const patchFile = path.join(repoRoot, 'patches', 'dsh-app-boot-route-scoped-hotfix.patch');
const coreFile = path.join(repoRoot, 'scripts', 'hotfix-core.mjs');

/** 构造假 DSH 安装根：<root>/node_modules/@deepseek-ai/dsh-app-boot/{package.json,lib/index.js} */
function makeFakeDsh(root: string, indexContent: string): string {
	const bootRoot = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot');
	fs.mkdirSync(path.join(bootRoot, 'lib'), { recursive: true });
	fs.writeFileSync(
		path.join(bootRoot, 'package.json'),
		JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: TARGET_VERSION }),
		'utf8',
	);
	fs.writeFileSync(path.join(bootRoot, 'lib', 'index.js'), indexContent, 'utf8');
	return bootRoot;
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
});

describe('apply-dsh-hotfix end-to-end (subprocess, temp DSH tree)', () => {
	it('applies, is idempotent, and reverts on a synthetic sample', () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-hotfix-test-'));
		try {
			const original = `line1\n${ORIGINAL_LINE}\nline3\n`;
			const bootRoot = makeFakeDsh(tmp, original);
			const indexFile = path.join(bootRoot, 'lib', 'index.js');

			// 1) 应用（git 上下文对不上合成样本时自动回退内建替换）
			let res = spawnSync(process.execPath, [coreFile, '--dsh-root', tmp], { encoding: 'utf8' });
			expect(res.status).toBe(0);
			expect(fs.readFileSync(indexFile, 'utf8')).toContain(HOTFIX_MARKER);
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
	it('patch applies cleanly to the pristine upstream file via git apply', () => {
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
			// 从 npm 缓存 pack 取原始文件；失败则跳过（离线环境）。
			let tgz: string;
			try {
				execFileSync('npm', ['pack', `@deepseek-ai/dsh-app-boot@${TARGET_VERSION}`], {
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
			execFileSync('git', ['apply', '-p1', '--directory', 'pkg', patchFile], {
				cwd: tmp,
			});
			const patched = fs.readFileSync(path.join(work, 'index.js'), 'utf8');
			expect(isApplied(patched)).toBe(true);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
