import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ci-ok 是分支保护唯一要求的 check（ruleset protected-branches 的 context 为 "CI passed"），
// 它的失败判定直接决定合并门禁。此前写 `needs.verify.result != 'success'`，把并发覆盖
// （concurrency.cancel-in-progress 被连续快推顶掉）产生的 cancelled 一并判失败，配合
// strict_required_status_checks 就变成假红阻塞合并（05de42b、07885fb 即此）。
// 本用例把这两条钉死，防止回退。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

describe('CI 工作流 ci-ok 聚合判定', () => {
	it('分支保护依赖的 check 名仍是 "CI passed"', () => {
		expect(ciWorkflow).toContain('name: CI passed');
	});

	it('失败判定精确匹配 failure，不再把 cancelled 一并判失败', () => {
		expect(ciWorkflow).not.toContain("needs.verify.result != 'success'");
		expect(ciWorkflow).toContain("needs.verify.result == 'failure'");
	});

	it('cancelled 有独立分支且该分支不 exit 1', () => {
		const start = ciWorkflow.indexOf('- name: Report cancelled matrix jobs');
		expect(start).toBeGreaterThan(-1);
		const next = ciWorkflow.indexOf('- name:', start + 1);
		const step = ciWorkflow.slice(start, next === -1 ? undefined : next);
		expect(step).toContain("needs.verify.result == 'cancelled'");
		expect(step).not.toContain('exit 1');
	});

	it('success 分支仍有显式步骤，避免整步被删后静默通过', () => {
		expect(ciWorkflow).toContain("needs.verify.result == 'success'");
	});
});
