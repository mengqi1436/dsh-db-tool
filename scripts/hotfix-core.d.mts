/**
 * 类型声明：scripts/hotfix-core.mjs（无 allowJs，为 tests/scripts/hotfix.spec.ts 提供 import 类型）。
 */
export declare const TARGET_VERSION: string;
export declare const HOTFIX_MARKER: string;
export declare const BOOT_INDEX_REL: string;
export declare const BACKUP_SUFFIX: string;
export declare const ORIGINAL_LINE: string;

export declare function isApplied(content: string): boolean;
export declare function applyToContent(content: string): {
	ok: boolean;
	reason?: string;
	content: string;
};
export declare function revertContent(content: string): {
	ok: boolean;
	reason?: string;
	content: string;
};
export declare function parsePatchTargetVersion(patchText: string): string | undefined;
export declare function findBootIndex(root: string): string | undefined;
export declare function resolveCandidateRoots(explicitRoot?: string): string[];
export declare function resolveDshRoot(explicitRoot?: string): string | undefined;
export declare function applyToIndexFile(indexFile: string, patchFile: string): string;
export declare function run(argv?: string[]): number;
