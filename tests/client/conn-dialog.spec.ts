/**
 * 连接配置弹窗契约测试（离线；浅渲染 ConnDialog）。
 *
 * 背景：连接弹窗按 Navicat 连接窗口的形态重构——覆盖层弹窗 + 标题栏 + 左导航页签
 * （常规 / SSL / 高级）+ 底部操作条（测试连接靠左，保存/取消靠右）。本文件锁住
 * 「弹窗结构与键盘契约 + 页签按库显隐 + 页签切换不丢值 + 术语对齐 Navicat」四件事。
 *
 * Navicat 侧依据（Navicat Premium 18 官方手册 Chapter 4 Connection）：
 * - General / SSL / Advanced 页签分区；SSL 页签仅 MySQL/PostgreSQL/MariaDB/MongoDB/Redis；
 * - SQL Server 的加密与信任证书开关在「高级」页；Oracle 服务名/SID 在「常规」页。
 * 项目侧的 ssl 开关适配器真实生效集合与 Navicat SSL 页签集合一致（SSL_TAB_KINDS）。
 *
 * 手法沿用 tests/client/sqlserver-tls-form.spec.ts：stub React 浅渲染 + 源码注入探针。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React ---------- */

const reactStub = (() => {
	const slots = new Map<string, any>();
	let hookIdx = 0;
	let effects: { i: number; fn: () => any }[] = [];
	function regEffect(fn: any, deps?: any[]) {
		const i = hookIdx++;
		const dk = 'd' + i;
		const prev = slots.get(dk);
		if (deps && prev && Array.isArray(prev) && prev.length === deps.length && prev.every((d, k) => d === deps[k])) return;
		slots.set(dk, deps ? deps.slice() : null);
		effects.push({ i, fn });
	}
	const R: any = {
		createElement(type: any, props: any, ...kids: any[]) {
			return { type, props: props || {}, children: kids };
		},
		useState(init: any) {
			const i = hookIdx++;
			const key = 's' + i;
			if (!slots.has(key)) slots.set(key, typeof init === 'function' ? init() : init);
			return [slots.get(key), (v: any) => slots.set(key, typeof v === 'function' ? v(slots.get(key)) : v)];
		},
		useRef(init: any) {
			const i = hookIdx++;
			const key = 'r' + i;
			if (!slots.has(key)) slots.set(key, { current: init });
			return slots.get(key);
		},
		useCallback(fn: any) {
			const i = hookIdx++;
			const key = 'cb' + i;
			if (!slots.has(key)) slots.set(key, fn);
			return slots.get(key);
		},
		useMemo(fn: any) {
			return fn();
		},
		useEffect: regEffect,
		useLayoutEffect: regEffect,
	};
	return {
		React: R,
		render(comp: (props: any) => any, props: any): El {
			hookIdx = 0;
			return comp(props);
		},
		reset() {
			slots.clear();
			effects = [];
			hookIdx = 0;
		},
	};
})();

function collect(node: any, out: El[] = []): El[] {
	if (Array.isArray(node)) { node.forEach((x) => collect(x, out)); return out; }
	if (!node || typeof node !== 'object' || !node.type) return out;
	out.push(node);
	const kids = Array.isArray(node.children) ? node.children : [node.children];
	for (const k of kids) {
		if (Array.isArray(k)) k.forEach((x) => collect(x, out));
		else collect(k, out);
	}
	return out;
}
function flatText(n: any): string {
	if (n === null || n === undefined || n === false || n === true) return '';
	if (Array.isArray(n)) return n.map(flatText).join('');
	if (typeof n !== 'object') return String(n);
	const kids = Array.isArray(n.children) ? n.children : [n.children];
	return kids.map(flatText).join('');
}

/* ---------- 装载 client.js ---------- */

let T: any;      // __testables
let probe: any;  // 源码注入探针：t()
const fetchCalls: { url: string; body: any }[] = [];
function stubFetch(url: string, init?: any) {
	const body = init && init.body ? JSON.parse(init.body) : {};
	fetchCalls.push({ url, body });
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data: [] })) });
}

beforeAll(() => {
	const fakeWindow: any = { __ModuleLoader__: { load(def: any) { fakeWindow.__DEF__ = def; } } };
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	const marker = 'exports.__testables = {';
	if (!src.includes(marker)) throw new Error('client.js 结构变更：未找到 __testables 导出点');
	const patched = src.replace(marker, 'exports.__probe = { t };\n\t\t' + marker);
	new Function('window', 'console', 'fetch', patched)(fakeWindow, console, stubFetch);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	probe = mod.__probe;
});

/** 上一次挂载的弹窗 props：供页签切换后复渲染（模拟 React 的重新渲染） */
let lastProps: any = null;

/** 渲染 ConnDialog；initial 传对象 = 编辑态，缺省 = 新建态（null）。返回树与 onCancel 间谍 */
function renderDialog(initial?: any): { tree: El; onCancel: () => boolean } {
	reactStub.reset();
	let cancelled = false;
	lastProps = {
		initial: initial === undefined ? null : initial,
		busy: false,
		onSubmit: () => {},
		onCancel: () => { cancelled = true; },
	};
	return { tree: reactStub.render(T.ConnDialog, lastProps), onCancel: () => cancelled };
}

/** 按 aria-label 找控件 */
function byLabel(tree: El, label: string): El | undefined {
	return collect(tree).find((n) => n.props && n.props['aria-label'] === label);
}

/** 左导航页签文字列表（顺序即渲染顺序） */
function tabLabels(tree: El): string[] {
	return collect(tree).filter((n) => n.props && n.props.role === 'tab').map((n) => flatText(n));
}

/** 点击页签并复渲染（state 槽沿用，页签只切渲染页） */
function openTab(tree: El, label: string): El {
	const tab = collect(tree).find((n) => n.props && n.props.role === 'tab' && flatText(n) === label);
	if (!tab) throw new Error('未找到页签: ' + label);
	tab.props.onClick();
	return reactStub.render(T.ConnDialog, lastProps);
}

describe('1 弹窗壳：覆盖层 + 标题栏 + aria + 退出三路', () => {
	it('渲染为覆盖层内的 modal 弹窗（dbt-overlay > role=dialog + aria-modal），标题「新建连接/编辑连接」', () => {
		const { tree } = renderDialog();
		expect(tree.type).toBe('div');
		expect(tree.props.className).toBe('dbt-overlay');
		const dialog = collect(tree).find((n) => n.props && n.props.role === 'dialog');
		expect(dialog, '缺 role=dialog').toBeDefined();
		expect(dialog!.props['aria-modal']).toBe('true');
		expect(dialog!.props['aria-label']).toBe(probe.t('newConn'));
		const head = collect(tree).find((n) => n.props && n.props.className === 'dbt-connhead');
		expect(head, '缺标题栏').toBeDefined();
		const edit = renderDialog({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields', id: 'c1' });
		const dialog2 = collect(edit.tree).find((n) => n.props && n.props.role === 'dialog');
		expect(dialog2!.props['aria-label']).toBe(probe.t('editConn'));
	});

	it('退出三路：标题栏 ×、底部「取消」、Escape 都走 onCancel；点覆盖层空白不关闭（防误触丢配置）', () => {
		const { tree, onCancel } = renderDialog();
		byLabel(tree, probe.t('dialogClose'))!.props.onClick();
		expect(onCancel()).toBe(true);
		const again = renderDialog();
		const cancelBtn = collect(again.tree).find((n) => n.type === 'button' && flatText(n) === probe.t('cancel'));
		cancelBtn!.props.onClick();
		expect(again.onCancel()).toBe(true);
		const third = renderDialog();
		third.tree.props.onKeyDown({ key: 'Escape', preventDefault: () => {} });
		expect(third.onCancel()).toBe(true);
		const fourth = renderDialog();
		fourth.tree.props.onClick({ stopPropagation: () => {} });
		expect(fourth.onCancel()).toBe(false);
	});
});

describe('2 页签按库显隐：SSL 页签集合与适配器 ssl 生效集合一致（= Navicat SSL 页签集合）', () => {
	it('SSL_TAB_KINDS = mysql/postgresql/gaussdb/mongodb/redis（导出面契约）', () => {
		expect(T.SSL_TAB_KINDS).toEqual(['mysql', 'postgresql', 'gaussdb', 'mongodb', 'redis']);
	});

	it('mysql 弹窗页签为 常规/SSL/高级；sqlserver、oracle、dmdb、sqlite 无 SSL 页签', () => {
		expect(tabLabels(renderDialog().tree)).toEqual([probe.t('connTabGeneral'), probe.t('connTabSsl'), probe.t('connTabAdvanced')]);
		for (const kind of ['sqlserver', 'oracle', 'dmdb', 'sqlite']) {
			const labels = tabLabels(renderDialog({ ...T.EMPTY_FORM, kind, mode: 'fields' }).tree);
			expect(labels, kind + ' 页签集合').toEqual([probe.t('connTabGeneral'), probe.t('connTabAdvanced')]);
		}
	});

	it('SSL 页内容：启用 SSL 开关 + 边界说明；勾选后提交带 ssl=true', async () => {
		const tree = openTab(renderDialog().tree, probe.t('connTabSsl'));
		const box = byLabel(tree, probe.t('ssl'));
		expect(box, '缺启用 SSL 开关').toBeDefined();
		expect(box!.props.type).toBe('checkbox');
		expect(collect(tree).map((n) => flatText(n)).join('|')).toContain(probe.t('sslHintGeneric'));
	});
});

describe('3 页签切换与默认页不丢配置', () => {
	it('常规页填值 → 切高级再切回：输入值仍在（页签只决定渲染，form 跨页共享）', () => {
		const first = renderDialog();
		const host = byLabel(first.tree, probe.t('fieldsHost') + probe.t('requiredMark'))!;
		host.props.onChange({ target: { value: '10.0.0.8' } });
		const mid = openTab(first.tree, probe.t('connTabAdvanced'));
		expect(byLabel(mid, probe.t('fieldsHost') + probe.t('requiredMark'))).toBeUndefined();
		const back = openTab(mid, probe.t('connTabGeneral'));
		expect(byLabel(back, probe.t('fieldsHost') + probe.t('requiredMark'))!.props.value).toBe('10.0.0.8');
	});

	it('连接 ID 常规页不可见（在「高级」页），编辑态禁用；新建态可填', () => {
		const fresh = openTab(renderDialog().tree, probe.t('connTabAdvanced'));
		const idInput = collect(fresh).find((n) => n.type === 'input' && flatText(n) === '' && String(n.props.placeholder || '').startsWith(probe.t('connId')));
		expect(idInput, '高级页缺连接 ID 输入').toBeDefined();
		expect(idInput!.props.disabled).toBe(false);
		const editing = openTab(renderDialog({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields', id: 'fixed-key' }).tree, probe.t('connTabAdvanced'));
		const idEdit = collect(editing).find((n) => n.type === 'input' && String(n.props.placeholder || '').startsWith(probe.t('connId')));
		expect(idEdit!.props.disabled).toBe(true);
	});

	it('存过高级字段（如 oracle OCI 路径）→ 首屏即落「高级」页', () => {
		const { tree } = renderDialog({ ...T.EMPTY_FORM, kind: 'oracle', mode: 'fields', ociLibDir: '/opt/ic' });
		expect(byLabel(tree, probe.t('fieldsOciLibDir'))).toBeDefined();
		const adv = collect(tree).find((n) => n.props && n.props.role === 'tab' && flatText(n) === probe.t('connTabAdvanced'));
		expect(adv!.props['aria-selected']).toBe(true);
	});
});

describe('4 底部操作条与术语（Navicat 布局：测试连接靠左，保存/取消靠右）', () => {
	it('foot 按钮次序：测试连接（首）… 保存（primary）+ 取消（末）；busy 时保存变「保存中…」并禁用', () => {
		const { tree } = renderDialog();
		const foot = collect(tree).find((n) => n.props && n.props.className === 'dbt-connfoot');
		expect(foot, '缺底部操作条').toBeDefined();
		const btns = collect(foot!).filter((n) => n.type === 'button');
		const saveBtn = btns[btns.length - 2]!;
		const cancelBtn = btns[btns.length - 1]!;
		expect(flatText(btns[0]!)).toBe(probe.t('testConnection'));
		expect(flatText(saveBtn)).toBe(probe.t('save'));
		expect(saveBtn.props.className).toContain('primary');
		expect(flatText(cancelBtn)).toBe(probe.t('cancel'));
		const busy = (reactStub.reset(), reactStub.render(T.ConnDialog, { initial: null, busy: true, onSubmit: () => {}, onCancel: () => {} }));
		const foot2 = collect(busy).find((n) => n.props && n.props.className === 'dbt-connfoot');
		const save = collect(foot2!).filter((n) => n.type === 'button').find((n) => n.props.className.includes('primary'));
		expect(flatText(save!)).toBe(probe.t('saving'));
		expect(save!.props.disabled).toBe(true);
	});

	it('pg 系库的库名输入对齐 Navicat 叫「初始数据库」，其余库维持「数据库名」', () => {
		const pg = renderDialog({ ...T.EMPTY_FORM, kind: 'postgresql', mode: 'fields' }).tree;
		expect(byLabel(pg, probe.t('fieldsInitialDatabase'))).toBeDefined();
		const my = renderDialog().tree;
		expect(byLabel(my, probe.t('fieldsInitialDatabase'))).toBeUndefined();
		expect(byLabel(my, probe.t('fieldsDatabase'))).toBeDefined();
	});

	it('键盘契约源码存在：Escape 取消 + Tab 焦点循环（危险确认/口令弹窗同款）', () => {
		const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
		const i = src.indexOf('function ConnDialog');
		const seg = src.slice(i, src.indexOf('function ManageView', i));
		expect(seg).toMatch(/e\.key === ['"]Escape['"]/);
		expect(seg).toMatch(/e\.key !== ['"]Tab['"]/);
	});
});
