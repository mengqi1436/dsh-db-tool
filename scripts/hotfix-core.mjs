#!/usr/bin/env node
/**
 * DSH ResolutionRouter hotfix —— 核心逻辑（纯 Node、零依赖、可被测试 import）。
 *
 * 修复的 bug：@deepseek-ai/dsh-app-boot 的 routeScoped() 直接对
 * `createRequire(parent).resolve.paths(name)` 做 for..of，而 Node 对 core-module
 * 同名包（punycode 等）返回 null，导致 hoisted profile 下 npm 安装插件导入失败
 * （TypeError: Cannot read properties of null）。
 *
 * 用法：node scripts/hotfix-core.mjs [--dsh-root <dir>] [--patch-file <file>]
 *           [--force] [--revert] [--dry-run]
 * 退出码：0 成功/已应用跳过；1 失败；2 版本不匹配且未给 --force。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 补丁文件里的目标版本声明行（patches/*.patch 注释头）。 */
export const TARGET_VERSION = '0.1.7-rc.2';
/** 判断目标文件是否已打补丁的标识串（hotfix 注释首行片段）。 */
export const HOTFIX_MARKER = 'local hotfix: resolve.paths returns null';
/** dsh-app-boot 内 lib/index.js 相对包根的路径。 */
export const BOOT_INDEX_REL = path.join('lib', 'index.js');
/** 应用前备份文件后缀。 */
export const BACKUP_SUFFIX = '.bak-hotfix';

/** 原始（未打补丁）单行 —— 必须与 dsh-app-boot@0.1.7-rc.2 lib/index.js 逐字节一致。 */
export const ORIGINAL_LINE =
	'\t\tfor (const searchPath of createRequire(parent).resolve.paths(name)) {';

/** 热修复代码块 —— 与 patches/dsh-app-boot-route-scoped-hotfix.patch 的 + 行一致。 */
const HOTFIX_BLOCK = [
	'\t\t/* local hotfix: resolve.paths returns null for core-module names (e.g. "punycode"),',
	'\t\t   which made the for..of throw TypeError and broke every hoisted profile install',
	'\t\t   whose dependency tree requires such an npm package. Fall back to the standard',
	'\t\t   node_modules search chain so the local candidate can still be found. */',
	'\t\tconst _hotReq = createRequire(parent);',
	'\t\tconst _hotPaths = _hotReq.resolve.paths(name)',
	'\t\t\t?? _hotReq("node:module")._nodeModulePaths(_hotReq("node:path").dirname(parent));',
	'\t\tfor (const searchPath of _hotPaths) {',
].join('\n');

/** 目标文件是否已包含热修复。 */
export function isApplied(content) {
	return content.includes(HOTFIX_MARKER);
}

/**
 * 在文件内容上应用热修复（幂等：已应用时返回 already-applied）。
 * @returns {{ ok: boolean, reason?: string, content: string }}
 */
export function applyToContent(content) {
	if (isApplied(content)) return { ok: false, reason: 'already-applied', content };
	if (!content.includes(ORIGINAL_LINE)) {
		return { ok: false, reason: 'target-line-not-found', content };
	}
	return { ok: true, content: content.replace(ORIGINAL_LINE, HOTFIX_BLOCK) };
}

/**
 * 还原热修复（优先用内建块反替换；调用方在磁盘层面应优先用 .bak-hotfix 备份）。
 * @returns {{ ok: boolean, reason?: string, content: string }}
 */
export function revertContent(content) {
	if (!isApplied(content)) return { ok: false, reason: 'not-applied', content };
	if (!content.includes(HOTFIX_BLOCK)) {
		return { ok: false, reason: 'hotfix-block-not-found', content };
	}
	return { ok: true, content: content.replace(HOTFIX_BLOCK, ORIGINAL_LINE) };
}

/** 从补丁文本解析注释头声明的目标版本（无则返回 undefined）。 */
export function parsePatchTargetVersion(patchText) {
	const m = /^\s*#\s*Target-Version:\s*(\S+)/m.exec(patchText);
	return m?.[1];
}

/**
 * 在候选 dsh 根下定位 dsh-app-boot/lib/index.js。
 * 候选解释：root=DSH 安装根（@deepseek-ai/dsh 包目录）；也接受直接指向
 * dsh-app-boot 包根或 node_modules/@deepseek-ai 层级。
 * @returns {string | undefined} lib/index.js 绝对路径
 */
export function findBootIndex(root) {
	const candidates = [
		path.join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', BOOT_INDEX_REL),
		path.join(root, '@deepseek-ai', 'dsh-app-boot', BOOT_INDEX_REL),
		path.join(root, BOOT_INDEX_REL),
	];
	for (const candidate of candidates) {
		try {
			if (!fs.statSync(candidate).isFile()) continue;
			// 防误伤：确认包根 package.json 的 name 是 dsh-app-boot。
			const pkg = JSON.parse(
				fs.readFileSync(path.join(path.dirname(path.dirname(candidate)), 'package.json'), 'utf8'),
			);
			if (pkg.name === '@deepseek-ai/dsh-app-boot') return candidate;
		} catch {
			/* 候选不存在或不可读，试下一个 */
		}
	}
	return undefined;
}

/**
 * 自动探测 DSH 安装根候选列表（dsh 包目录）。
 * 顺序：--dsh-root 参数 → DSH_HOME → which/where dsh 的 shim 反推 → 常见全局路径。
 * 调用方应逐个用 findBootIndex 试探（DSH_HOME 存在但不含 dsh-app-boot 时继续回退）。
 */
export function resolveCandidateRoots(explicitRoot) {
	const roots = [];
	if (explicitRoot) {
		if (fs.existsSync(explicitRoot)) roots.push(path.resolve(explicitRoot));
		return roots;
	}
	const fromEnv = process.env.DSH_HOME;
	if (fromEnv && fs.existsSync(fromEnv)) roots.push(path.resolve(fromEnv));

	const shim = findDshOnPath();
	if (shim) {
		// <global>/dsh(.cmd) → <global>/node_modules/@deepseek-ai/dsh
		const globalDir = path.dirname(path.dirname(shim));
		const candidate = path.join(globalDir, 'node_modules', '@deepseek-ai', 'dsh');
		if (fs.existsSync(candidate)) roots.push(candidate);
	}

	roots.push(...commonGlobalRoots());
	return roots;
}

/** resolveCandidateRoots 的单值便捷形式（取第一个候选）。 */
export function resolveDshRoot(explicitRoot) {
	return resolveCandidateRoots(explicitRoot)[0];
}

function findDshOnPath() {
	const isWin = process.platform === 'win32';
	try {
		const out = execFileSync(isWin ? 'where.exe' : 'which', ['dsh'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const first = out.split(/\r?\n/).find((line) => line.trim() !== '');
		return first ? first.trim() : undefined;
	} catch {
		return undefined;
	}
}

function commonGlobalRoots() {
	const isWin = process.platform === 'win32';
	const roots = [];
	if (isWin) {
		if (process.env.APPDATA) {
			roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
		}
		// nvm-windows: <drive>:\Tool\nvm\v*\node_modules\@deepseek-ai\dsh 与 C:\nvm\v*\...
		for (const base of ['E:\\Tool\\nvm', 'C:\\nvm', 'D:\\nvm']) {
			try {
				for (const entry of fs.readdirSync(base)) {
					if (/^v/.test(entry)) {
						roots.push(path.join(base, entry, 'node_modules', '@deepseek-ai', 'dsh'));
					}
				}
			} catch {
				/* base 不存在 */
			}
		}
	} else {
		for (const lib of ['/usr/local/lib', '/usr/lib', path.join(process.env.HOME ?? '', '.nvm')]) {
			try {
				if (lib.includes('.nvm')) {
					const versions = path.join(lib, 'versions', 'node');
					for (const v of fs.readdirSync(versions)) {
						roots.push(
							path.join(versions, v, 'lib', 'node_modules', '@deepseek-ai', 'dsh'),
						);
					}
				} else {
					roots.push(path.join(lib, 'node_modules', '@deepseek-ai', 'dsh'));
				}
			} catch {
				/* 不可读 */
			}
		}
	}
	return roots;
}

/**
 * 首选 git apply（若 git 可用且补丁可干净应用）；否则回退内建字符串替换。
 * 两种路径结果一致（内建块与补丁 + 行逐字节相同，测试保证）。
 */
export function applyToIndexFile(indexFile, patchFile) {
	if (isGitApplyable(indexFile, patchFile)) {
		const bootRoot = path.dirname(path.dirname(indexFile));
		execFileSync('git', ['apply', '-p1', '--directory', '.', patchFile], {
			cwd: bootRoot,
		});
		return 'git-apply';
	}
	const content = fs.readFileSync(indexFile, 'utf8');
	const result = applyToContent(content);
	if (!result.ok) throw new Error(`apply failed: ${result.reason}`);
	fs.writeFileSync(indexFile, result.content, 'utf8');
	return 'builtin-replace';
}

function isGitApplyable(indexFile, patchFile) {
	const bootRoot = path.dirname(path.dirname(indexFile));
	try {
		// --directory 只接受相对路径（git 拒绝绝对目标 "invalid path"），故以包根为 cwd。
		execFileSync('git', ['apply', '--check', '-p1', '--directory', '.', patchFile], {
			cwd: bootRoot,
		});
		return true;
	} catch {
		return false;
	}
}

/** 命令行主入口。@returns {number} 退出码 */
export function run(argv = process.argv.slice(2)) {
	let dshRoot;
	let patchFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'patches', 'dsh-app-boot-route-scoped-hotfix.patch');
	let force = false;
	let revert = false;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dsh-root') dshRoot = argv[++i];
		else if (arg === '--patch-file') patchFile = argv[++i];
		else if (arg === '--force') force = true;
		else if (arg === '--revert') revert = true;
		else if (arg === '--dry-run') dryRun = true;
		else if (arg === '--help' || arg === '-h') {
			console.log('usage: node scripts/hotfix-core.mjs [--dsh-root <dir>] [--patch-file <file>] [--force] [--revert] [--dry-run]');
			return 0;
		}
	}

	let indexFile;
	for (const root of resolveCandidateRoots(dshRoot)) {
		indexFile = findBootIndex(root);
		if (indexFile) {
			console.log(`[dsh-hotfix] using DSH root: ${root}`);
			break;
		}
	}
	if (!indexFile) {
		console.error('[dsh-hotfix] dsh-app-boot/lib/index.js not found in any candidate root; pass --dsh-root explicitly.');
		return 1;
	}

	const pkgPath = path.join(path.dirname(path.dirname(indexFile)), 'package.json');
	let actualVersion;
	try {
		actualVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
	} catch {
		/* 读不到版本号时跳过比对 */
	}
	const patchText = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';
	const declared = parsePatchTargetVersion(patchText) ?? TARGET_VERSION;
	if (actualVersion && actualVersion !== declared && !force) {
		console.warn(`[dsh-hotfix] version mismatch: installed ${actualVersion} != patch target ${declared}. Use --force to apply anyway.`);
		return 2;
	}

	let content;
	try {
		content = fs.readFileSync(indexFile, 'utf8');
	} catch (err) {
		console.error(`[dsh-hotfix] cannot read ${indexFile}: ${err.message}`);
		return 1;
	}

	if (revert) {
		const backup = indexFile + BACKUP_SUFFIX;
		if (fs.existsSync(backup)) {
			if (dryRun) {
				console.log(`[dsh-hotfix] dry-run: would restore ${backup} -> ${indexFile}`);
				return 0;
			}
			fs.copyFileSync(backup, indexFile);
			console.log(`[dsh-hotfix] reverted ${indexFile} from backup.`);
			return 0;
		}
		const result = revertContent(content);
		if (!result.ok) {
			console.error(`[dsh-hotfix] revert failed: ${result.reason} (no backup at ${backup}).`);
			return 1;
		}
		if (dryRun) {
			console.log('[dsh-hotfix] dry-run: would revert via builtin replacement.');
			return 0;
		}
		fs.writeFileSync(indexFile, result.content, 'utf8');
		console.log(`[dsh-hotfix] reverted ${indexFile} via builtin replacement.`);
		return 0;
	}

	if (isApplied(content)) {
		console.log('[dsh-hotfix] already applied; nothing to do.');
		return 0;
	}
	if (dryRun) {
		console.log(`[dsh-hotfix] dry-run: would apply patch to ${indexFile}.`);
		return 0;
	}
	const backup = indexFile + BACKUP_SUFFIX;
	if (!fs.existsSync(backup)) fs.copyFileSync(indexFile, backup);
	const method = applyToIndexFile(indexFile, patchFile);
	console.log(`[dsh-hotfix] applied to ${indexFile} (via ${method}; backup at ${backup}).`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = run(process.argv.slice(2));
}
