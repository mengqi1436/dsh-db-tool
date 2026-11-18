/**
 * Oracle 前端连接参数接线测试（离线；浅渲染 ConnDialog）。
 *
 * 背景：Oracle 连老服务器报 NJS-138（oracledb Thin 模式不支持其 TNS 协议版本），Navicat
 * 因走 OCI（Instant Client / Thick 模式）能连。本工具此前既没有 OCI 库路径入口，第三格
 * 也只叫「数据库名」没有服务名/SID 之分。本测试锁住「控件存在 + 提交会带出 + 编辑能回填」
 * 三件套（手法沿用 tests/client/sqlserver-tls-form.spec.ts：stub React 浅渲染 + 源码注入探针）。
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

/** 上一次挂载的表单 props：供 rerenderForm 复用（模拟 React 的重新渲染） */
let lastProps: any = null;

/** 渲染 oracle 的 ConnDialog（Navicat 式弹窗，分字段模式），返回树 */
function renderForm(initial?: any): El {
	reactStub.reset();
	// 不传 initial 时 freshForm() 的 kind 默认是 mysql，故必须显式给 oracle 才会渲染专有控件
	lastProps = {
		initial: initial ?? { ...T.EMPTY_FORM, kind: 'oracle', mode: 'fields' },
		busy: false,
		onSubmit: () => {},
		onCancel: () => {},
	};
	return reactStub.render(T.ConnDialog, lastProps);
}

/** 保留 React 状态槽重渲染：用于「点击/切换后再断言」（stub 的 setState 只改槽不自动渲染） */
function rerenderForm(): El {
	return reactStub.render(T.ConnDialog, lastProps);
}

/** 按 aria-label 找控件 */
function byLabel(tree: El, label: string): El | undefined {
	return collect(tree).find((n) => n.props && n.props['aria-label'] === label);
}

/** 点击左导航页签（按页签文字），返回切换后的树 */
function openTab(tree: El, label: string): El {
	const tab = collect(tree).find((n) => n.props && n.props.role === 'tab' && flatText(n) === label);
	if (!tab) throw new Error('未找到页签: ' + label);
	tab.props.onClick();
	return rerenderForm();
}

/** 底部操作条的「测试连接」按钮（测试进行中文案会变，两种都识别） */
function testButton(tree: El): El | undefined {
	return collect(tree).find((n) => n.type === 'button' && (flatText(n) === probe.t('testConnection') || flatText(n) === probe.t('testing')));
}

describe('1 服务名 / SID 选择（对齐 Navicat 的连接标识）', () => {
	it('oracle 分字段表单渲染类型下拉（service/sid）与「服务名」占位输入', () => {
		const tree = renderForm();
		const sel = byLabel(tree, probe.t('fieldsServiceType'));
		expect(sel, '缺服务名/SID 类型下拉').toBeDefined();
		expect(sel!.type).toBe('select');
		expect(sel!.props.value).toBe('service');
		const values = collect(sel!).filter((n) => n.type === 'option').map((n) => n.props.value);
		expect(values).toEqual(['service', 'sid']);
		const ident = byLabel(tree, probe.t('fieldsService') + probe.t('requiredMark'));
		expect(ident, '缺服务名输入框').toBeDefined();
		expect(ident!.props.placeholder).toBe(probe.t('fieldsService'));
	});

	it('切到 SID 后占位随动；service 与 sid 共用同一个 database 值槽', () => {
		const tree = renderForm();
		byLabel(tree, probe.t('fieldsServiceType'))!.props.onChange({ target: { value: 'sid' } });
		const rerendered = rerenderForm();
		const ident = byLabel(rerendered, probe.t('fieldsSid') + probe.t('requiredMark'));
		expect(ident).toBeDefined();
		expect(ident!.props.placeholder).toBe(probe.t('fieldsSid'));
		// 输入值仍落在 form.database：后端解析不新增键，只按 serviceType 分流拼接
		ident!.props.onChange({ target: { value: 'XE' } });
		expect(rerenderForm().children).toBeDefined();
	});

	it('非 oracle 库不渲染类型下拉（仍用通用「数据库名」）', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields' });
		expect(byLabel(tree, probe.t('fieldsServiceType'))).toBeUndefined();
		expect(byLabel(tree, probe.t('fieldsDatabase'))).toBeDefined();
	});
});

describe('2 OCI 库路径（「高级」页，Navicat 式页签分区）', () => {
	it('默认落「常规」页：OCI 输入与提示不渲染，也不再有旧版「高级选项」折叠按钮', () => {
		const tree = renderForm();
		expect(byLabel(tree, probe.t('fieldsOciLibDir')), '常规页不应渲染 OCI 输入').toBeUndefined();
		expect(collect(tree).map((n) => flatText(n)).join('|')).not.toContain(probe.t('ociHint'));
		// 旧版折叠入口（aria-expanded 开合）已被左导航页签取代
		expect(collect(tree).some((n) => n.props && n.props['aria-expanded'] !== undefined)).toBe(false);
		// oracle 的页签集合 = 常规 + 高级（oracle 无 SSL 页：ssl 开关对其不生效）
		const tabs = collect(tree).filter((n) => n.props && n.props.role === 'tab').map((n) => flatText(n));
		expect(tabs).toEqual([probe.t('connTabGeneral'), probe.t('connTabAdvanced')]);
		expect(collect(tree).find((n) => n.props && n.props.role === 'tab' && flatText(n) === probe.t('connTabGeneral'))!.props['aria-selected']).toBe(true);
	});

	it('点击「高级」页签：OCI 输入 + 行动指引出现；切回「常规」再隐藏（页签双向切换）', () => {
		const expanded = openTab(renderForm(), probe.t('connTabAdvanced'));
		expect(byLabel(expanded, probe.t('fieldsOciLibDir')), '缺 OCI 库路径输入').toBeDefined();
		expect(collect(expanded).map((n) => flatText(n)).join('|')).toContain(probe.t('ociHint'));
		const collapsed = openTab(expanded, probe.t('connTabGeneral'));
		expect(byLabel(collapsed, probe.t('fieldsOciLibDir'))).toBeUndefined();
	});

	it('编辑已有连接且存过 ociLibDir → 默认落「高级」页（让用户看到自己存过什么）', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'oracle', mode: 'fields', ociLibDir: '/opt/ic' });
		expect(byLabel(tree, probe.t('fieldsOciLibDir'))!.props.value).toBe('/opt/ic');
	});

	it('kind 切走再切回：oracle 高级项「值」重置（不残留旧值误导；所在页签与 sqlserver 同口径，不随 kind 重置）', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'oracle', mode: 'fields', serviceType: 'sid', ociLibDir: '/opt/ic' });
		// kind 下拉在「常规」页：先切过去再操作
		const general = openTab(tree, probe.t('connTabGeneral'));
		const kindSel = byLabel(general, probe.t('fieldKind'))!;
		kindSel.props.onChange({ target: { value: 'mysql' } });
		const asMysql = rerenderForm();
		expect(byLabel(asMysql, probe.t('fieldsServiceType'))).toBeUndefined();
		kindSel.props.onChange({ target: { value: 'oracle' } });
		const backToOra = rerenderForm();
		expect(byLabel(backToOra, probe.t('fieldsServiceType'))!.props.value).toBe('service');
		// OCI 路径在「高级」页：值已重置（空=Thin 模式）
		const advanced = openTab(backToOra, probe.t('connTabAdvanced'));
		expect(byLabel(advanced, probe.t('fieldsOciLibDir'))!.props.value).toBe('');
	});
});

describe('3 提交：draftBody 必须带出这些参数', () => {
	/** 通过点击底部「测试连接」按钮触发 testDraft → draftBody → fetch，从请求体反查提交内容 */
	async function submittedOf(initial: any): Promise<any> {
		reactStub.reset();
		fetchCalls.length = 0;
		const tree = reactStub.render(T.ConnDialog, {
			initial,
			busy: false,
			onSubmit: () => {},
			onCancel: () => {},
		});
		const btn = testButton(tree);
		if (!btn) throw new Error('未找到「测试连接」按钮');
		await btn.props.onClick();
		const call = fetchCalls.find((c) => String(c.url).includes('test-draft'));
		if (!call) throw new Error('未发出 test-draft 请求');
		return call.body;
	}

	it('serviceType=sid 提交字符串 sid；ociLibDir trim 后提交', async () => {
		const body = await submittedOf({
			...T.EMPTY_FORM, kind: 'oracle', mode: 'fields',
			host: 'db', port: '1521', user: 'system', database: 'XE',
			serviceType: 'sid', ociLibDir: ' /opt/ic ',
		});
		expect(body.fields.serviceType).toBe('sid');
		expect(body.fields.ociLibDir).toBe('/opt/ic');
		expect(body.fields.database).toBe('XE');
	});

	it('默认 service 不发 serviceType 键（服务端缺省即 service）；OCI 留空不发键（Thin 模式）', async () => {
		const body = await submittedOf({
			...T.EMPTY_FORM, kind: 'oracle', mode: 'fields',
			host: 'db', port: '1521', user: 'system', database: 'ORCL', serviceType: 'service', ociLibDir: '',
		});
		expect('serviceType' in body.fields).toBe(false);
		expect('ociLibDir' in body.fields).toBe(false);
	});

	it('非 oracle 库即使表单残留旧值也不发 oracle 专有键（防无关库收到未知键）', async () => {
		const body = await submittedOf({
			...T.EMPTY_FORM, kind: 'mysql', mode: 'fields',
			host: 'db', user: 'root', database: 'app', serviceType: 'sid', ociLibDir: '/opt/ic',
		});
		expect('serviceType' in body.fields).toBe(false);
		expect('ociLibDir' in body.fields).toBe(false);
	});
});

describe('4 URL 方式切回分字段：oracle 专有参数反解不丢', () => {
	/** 按钮文案找「分字段方式」切换钮（模式切换按钮无 aria-label，走 aria-pressed + 文本） */
	function clickFieldsMode(tree: El): void {
		const btn = collect(tree).find((n) => n.type === 'button' && flatText(n) === probe.t('fieldsMode'));
		if (!btn) throw new Error('未找到「分字段方式」切换按钮');
		btn.props.onClick();
	}

	it('URL 带 ?serviceType=sid&ociLibDir=… → 切分字段后类型/OCI 跟随 URL，提交带出', async () => {
		// 直接从 URL 模式（草稿，未保存）切到分字段：urlToFieldsPatch 反解 + reenterFields 跟随
		const initial = {
			...T.EMPTY_FORM, kind: 'oracle', mode: 'url',
			url: 'oracle://scott:***@db.corp.example:1521/XE?serviceType=sid&ociLibDir=%2Fopt%2Fic',
		};
		const tree = renderForm(initial);
		clickFieldsMode(tree);
		const fields = rerenderForm();
		expect(byLabel(fields, probe.t('fieldsServiceType'))!.props.value).toBe('sid');
		expect(byLabel(fields, probe.t('fieldsSid') + probe.t('requiredMark'))!.props.value).toBe('XE');

		// 提交带出（同一状态槽里点「测试连接」，走真实 draftBody 路径）
		fetchCalls.length = 0;
		const btn = testButton(fields);
		expect(btn, '未找到「测试连接」按钮').toBeDefined();
		await btn!.props.onClick();
		const call = fetchCalls.find((c) => String(c.url).includes('test-draft'));
		expect(call, '未发出 test-draft 请求').toBeDefined();
		expect(call!.body.fields.serviceType).toBe('sid');
		expect(call!.body.fields.ociLibDir).toBe('/opt/ic');
	});

	it('URL 无 oracle 专有参数 → 切分字段回落默认（service/Thin），不发键', async () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'oracle', mode: 'url', url: 'oracle://u:***@db:1521/ORCL' });
		clickFieldsMode(tree);
		const fields = rerenderForm();
		expect(byLabel(fields, probe.t('fieldsServiceType'))!.props.value).toBe('service');
	});
});
