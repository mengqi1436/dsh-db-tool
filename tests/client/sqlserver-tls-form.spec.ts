/**
 * SQL Server 前端加密参数接线测试（离线；浅渲染 ConnForm）。
 *
 * 背景：用户连 SQL Server 报 TLS/证书错误却「怎么改都连不上」，根因是分字段表单只暴露了
 * tlsMinVersion，没有 encrypt / trustServerCertificate 入口——而 tlsMinVersion 对证书族
 * 错误恰好无效。本测试锁住「控件存在 + 提交会带出 + 编辑能回填」三件套，防止再次断线。
 *
 * 手法沿用 tests/client/sqlserver-wiring.spec.ts：stub React 浅渲染 + 源码注入探针。
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
		flush() {
			const list = effects;
			effects = [];
			for (const e of list) e.fn();
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

/** 渲染 sqlserver 的 ConnForm（分字段模式），返回树 */
function renderForm(initial?: any): El {
	reactStub.reset();
	return reactStub.render(T.ConnForm, {
		// 不传 initial 时 freshForm() 的 kind 默认是 mysql，故必须显式给 sqlserver 才会渲染专有控件
		initial: initial ?? { ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields' },
		busy: false,
		onSubmit: () => {},
		onCancel: () => {},
	});
}

/** 按 aria-label 找控件 */
function byLabel(tree: El, label: string): El | undefined {
	return collect(tree).find((n) => n.props && n.props['aria-label'] === label);
}

describe('1 表单控件存在性：加密参数必须有入口', () => {
	it('sqlserver 分字段表单渲染 encrypt / tlsMinVersion / trustServerCertificate / serverName / caCert', () => {
		const tree = renderForm();
		expect(byLabel(tree, probe.t('fieldsEncrypt')), '缺 encrypt 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsTlsMinVersion')), '缺 tlsMinVersion 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsTrustCert')), '缺 trustServerCertificate 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsServerName')), '缺 serverName 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsCaCert')), '缺 caCert 控件').toBeDefined();
	});

	it('encrypt 下拉提供 默认/true/false/strict 四个选项（strict 是 TDS 8.0 的入口，不能缺）', () => {
		const tree = renderForm();
		const sel = byLabel(tree, probe.t('fieldsEncrypt'))!;
		const values = collect(sel).filter((n) => n.type === 'option').map((n) => n.props.value);
		expect(values).toEqual(['', 'true', 'false', 'strict']);
	});

	it('tdsVersion 不再出现在表单里（协议层天然降级，不把驱动已处理的问题转嫁用户）', () => {
		const tree = renderForm();
		const all = collect(tree).map((n) => flatText(n)).join('|');
		expect(all).not.toContain('tdsVersion');
		expect(all).not.toContain('TDS 版本');
	});

	it('非 sqlserver 库（如 mysql）不渲染这些 sqlserver 专有控件', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields', host: 'h', user: 'u' });
		expect(byLabel(tree, probe.t('fieldsTrustCert'))).toBeUndefined();
		expect(byLabel(tree, probe.t('fieldsCaCert'))).toBeUndefined();
	});
});

describe('2 提交：draftBody 必须带出这些参数', () => {
	/** 通过点击「测试」按钮触发 testDraft → draftBody → fetch，从请求体反查提交内容 */
	async function submittedOf(initial: any): Promise<any> {
		reactStub.reset();
		fetchCalls.length = 0;
		const tree = reactStub.render(T.ConnForm, {
			initial,
			busy: false,
			onSubmit: () => {},
			onCancel: () => {},
		});
		const testBtn = collect(tree).find((n) => n.type === 'button' && flatText(n) === probe.t('test'));
		if (!testBtn) throw new Error('未找到「测试」按钮');
		await testBtn.props.onClick();
		const call = fetchCalls.find((c) => String(c.url).includes('test-draft'));
		if (!call) throw new Error('未发出 test-draft 请求');
		return call.body;
	}

	it('encrypt=strict 会作为字符串 strict 提交（不是布尔 true）', async () => {
		const body = await submittedOf({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa', encrypt: 'strict' });
		expect(body.fields.encrypt).toBe('strict');
	});

	it('encrypt=false 提交布尔 false（而不是字符串 "false"）', async () => {
		const body = await submittedOf({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa', encrypt: 'false' });
		expect(body.fields.encrypt).toBe(false);
	});

	it('trustServerCertificate 勾选时提交 true；未勾选时不发该键（留空=沿用默认 false）', async () => {
		const on = await submittedOf({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa', trustServerCertificate: true });
		expect(on.fields.trustServerCertificate).toBe(true);
		const off = await submittedOf({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa', trustServerCertificate: false });
		expect('trustServerCertificate' in off.fields).toBe(false);
	});

	it('serverName / caCert 有值才提交，空值不注入（避免触发服务端 fail-closed 取值校验）', async () => {
		const filled = await submittedOf({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa', serverName: 'db.corp.local', caCert: '/tmp/ca.pem' });
		expect(filled.fields.serverName).toBe('db.corp.local');
		expect(filled.fields.caCert).toBe('/tmp/ca.pem');
		const empty = await submittedOf({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa' });
		expect('serverName' in empty.fields).toBe(false);
		expect('caCert' in empty.fields).toBe(false);
		expect('encrypt' in empty.fields).toBe(false);
	});

	it('非 sqlserver 库不提交这些键（避免无关库收到未知参数）', async () => {
		const body = await submittedOf({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields', host: 'h', user: 'u', encrypt: 'strict', trustServerCertificate: true, caCert: '/x.pem' });
		expect('encrypt' in body.fields).toBe(false);
		expect('trustServerCertificate' in body.fields).toBe(false);
		expect('caCert' in body.fields).toBe(false);
	});
});

describe('3 编辑回填：buildEditForm 必须还原已存配置', () => {
	it('encrypt 三态回填：布尔转字符串、strict 保持 strict、缺省为空串（=不注入）', () => {
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: true }).encrypt).toBe('true');
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: false }).encrypt).toBe('false');
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: 'strict' }).encrypt).toBe('strict');
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields' }).encrypt).toBe('');
	});

	it('trustServerCertificate / serverName / caCert 回填', () => {
		const f = T.buildEditForm({
			id: 'a', kind: 'sqlserver', mode: 'fields',
			trustServerCertificate: true, serverName: 'db.corp.local', caCert: '/tmp/ca.pem',
		});
		expect(f.trustServerCertificate).toBe(true);
		expect(f.serverName).toBe('db.corp.local');
		expect(f.caCert).toBe('/tmp/ca.pem');
	});

	it('缺省时回填安全默认：不信任证书、无 serverName/caCert', () => {
		const f = T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields' });
		expect(f.trustServerCertificate).toBe(false);
		expect(f.serverName).toBe('');
		expect(f.caCert).toBe('');
	});
});
