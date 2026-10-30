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

/** 上一次挂载的表单 props：供 rerenderForm 复用（模拟 React 的重新渲染） */
let lastProps: any = null;

/** 渲染 sqlserver 的 ConnForm（分字段模式），返回树 */
function renderForm(initial?: any): El {
	reactStub.reset();
	// 不传 initial 时 freshForm() 的 kind 默认是 mysql，故必须显式给 sqlserver 才会渲染专有控件
	lastProps = {
		initial: initial ?? { ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields' },
		busy: false,
		onSubmit: () => {},
		onCancel: () => {},
	};
	return reactStub.render(T.ConnForm, lastProps);
}

/** 保留 React 状态槽重渲染：用于「点击展开/收起后再断言」（stub 的 setState 只改槽不自动渲染） */
function rerenderForm(): El {
	return reactStub.render(T.ConnForm, lastProps);
}

/** 点击「高级选项」入口展开，返回展开后的树（高级区默认收起，断言前必须显式展开） */
function renderExpandedForm(initial?: any): El {
	const tree = renderForm(initial);
	const toggle = byLabel(tree, probe.t('advancedTls'));
	if (!toggle) throw new Error('未找到「高级选项」入口');
	toggle.props.onClick();
	return rerenderForm();
}

/** 按 aria-label 找控件 */
function byLabel(tree: El, label: string): El | undefined {
	return collect(tree).find((n) => n.props && n.props['aria-label'] === label);
}

describe('1 高级区默认收起：sqlserver 分字段表单不再平铺 TLS 参数', () => {
	it('默认收起：只留「高级选项」入口，五个高级控件与 tlsHint 都不渲染', () => {
		const tree = renderForm();
		const toggle = byLabel(tree, probe.t('advancedTls'));
		expect(toggle, '缺「高级选项」入口').toBeDefined();
		expect(toggle!.type).toBe('button');
		expect(toggle!.props['aria-expanded']).toBe(false);
		expect(byLabel(tree, probe.t('fieldsEncrypt')), '收起时不应渲染 encrypt 控件').toBeUndefined();
		expect(byLabel(tree, probe.t('fieldsTlsMinVersion'))).toBeUndefined();
		expect(byLabel(tree, probe.t('fieldsTrustCert'))).toBeUndefined();
		expect(byLabel(tree, probe.t('fieldsServerName'))).toBeUndefined();
		expect(byLabel(tree, probe.t('fieldsCaCert'))).toBeUndefined();
		expect(collect(tree).map((n) => flatText(n)).join('|')).not.toContain(probe.t('tlsHint'));
	});

	it('展开后：aria-expanded=true，五个控件 + tlsHint 全部出现', () => {
		const tree = renderExpandedForm();
		expect(byLabel(tree, probe.t('advancedTls'))!.props['aria-expanded']).toBe(true);
		expect(byLabel(tree, probe.t('fieldsEncrypt')), '缺 encrypt 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsTlsMinVersion')), '缺 tlsMinVersion 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsTrustCert')), '缺 trustServerCertificate 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsServerName')), '缺 serverName 控件').toBeDefined();
		expect(byLabel(tree, probe.t('fieldsCaCert')), '缺 caCert 控件').toBeDefined();
		expect(collect(tree).map((n) => flatText(n)).join('|')).toContain(probe.t('tlsHint'));
	});

	it('折叠是双向的：展开后再次点击可收起', () => {
		const expanded = renderExpandedForm();
		expect(byLabel(expanded, probe.t('fieldsCaCert'))).toBeDefined();
		byLabel(expanded, probe.t('advancedTls'))!.props.onClick();
		const collapsed = rerenderForm();
		expect(byLabel(collapsed, probe.t('advancedTls'))!.props['aria-expanded']).toBe(false);
		expect(byLabel(collapsed, probe.t('fieldsCaCert'))).toBeUndefined();
	});

	it('编辑已有连接且存过高级字段 → 默认展开（让用户看到自己存过什么）', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', serverName: 'db.corp.local' });
		expect(byLabel(tree, probe.t('advancedTls'))!.props['aria-expanded']).toBe(true);
		expect(byLabel(tree, probe.t('fieldsServerName'))).toBeDefined();
	});

	it('只存了 encrypt=auto（默认策略）不算高级配置 → 仍然默认收起', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', encrypt: 'auto' });
		expect(byLabel(tree, probe.t('advancedTls'))!.props['aria-expanded']).toBe(false);
	});

	it('encrypt 下拉：auto 置首项，其后 true/false/strict（strict 是 TDS 8.0 的入口，不能缺）', () => {
		const tree = renderExpandedForm();
		const sel = byLabel(tree, probe.t('fieldsEncrypt'))!;
		const values = collect(sel).filter((n) => n.type === 'option').map((n) => n.props.value);
		expect(values).toEqual(['auto', 'true', 'false', 'strict']);
	});

	it('tdsVersion 不再出现在表单里（协议层天然降级，不把驱动已处理的问题转嫁用户）', () => {
		const tree = renderExpandedForm();
		const all = collect(tree).map((n) => flatText(n)).join('|');
		expect(all).not.toContain('tdsVersion');
		expect(all).not.toContain('TDS 版本');
	});

	it('非 sqlserver 库（如 mysql）连「高级选项」入口都不渲染', () => {
		const tree = renderForm({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields', host: 'h', user: 'u' });
		expect(byLabel(tree, probe.t('advancedTls'))).toBeUndefined();
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
		// encrypt 默认已是 'auto'（不再是空串）：默认就要把自动策略发给适配器，
		// 否则适配器会退回 encrypt=true，Navicat 式「开箱即连」失效
		expect(empty.fields.encrypt).toBe('auto');
	});

	it('收起高级区不影响提交：已存的高级配置照样带出（绝不因隐藏丢配置）', async () => {
		reactStub.reset();
		fetchCalls.length = 0;
		lastProps = {
			initial: {
				...T.EMPTY_FORM, kind: 'sqlserver', mode: 'fields', host: 'h', user: 'sa',
				serverName: 'db.corp.local', caCert: '/tmp/ca.pem', trustServerCertificate: true, tlsMinVersion: 'TLSv1.2', encrypt: 'strict',
			},
			busy: false, onSubmit: () => {}, onCancel: () => {},
		};
		// 编辑已存高级配置 → 默认展开；这里显式收起，模拟用户点了「收起」后直接保存/测试
		const tree = reactStub.render(T.ConnForm, lastProps);
		byLabel(tree, probe.t('advancedTls'))!.props.onClick();
		const collapsed = rerenderForm();
		expect(byLabel(collapsed, probe.t('advancedTls'))!.props['aria-expanded']).toBe(false);
		expect(byLabel(collapsed, probe.t('fieldsCaCert')), '收起后控件确实不渲染').toBeUndefined();
		const testBtn = collect(collapsed).find((n) => n.type === 'button' && flatText(n) === probe.t('test'));
		if (!testBtn) throw new Error('未找到「测试」按钮');
		await testBtn.props.onClick();
		const call = fetchCalls.find((c) => String(c.url).includes('test-draft'));
		if (!call) throw new Error('未发出 test-draft 请求');
		// 折叠只是不渲染，form 里的值原样提交
		expect(call.body.fields.serverName).toBe('db.corp.local');
		expect(call.body.fields.caCert).toBe('/tmp/ca.pem');
		expect(call.body.fields.trustServerCertificate).toBe(true);
		expect(call.body.fields.tlsMinVersion).toBe('TLSv1.2');
		expect(call.body.fields.encrypt).toBe('strict');
	});

	it('非 sqlserver 库不提交这些键（避免无关库收到未知参数）', async () => {
		const body = await submittedOf({ ...T.EMPTY_FORM, kind: 'mysql', mode: 'fields', host: 'h', user: 'u', encrypt: 'strict', trustServerCertificate: true, caCert: '/x.pem' });
		expect('encrypt' in body.fields).toBe(false);
		expect('trustServerCertificate' in body.fields).toBe(false);
		expect('caCert' in body.fields).toBe(false);
	});
});

describe('3 编辑回填：buildEditForm 必须还原已存配置', () => {
	it('encrypt 四态回填：布尔转字符串、strict/auto 原样保留、缺省为 auto', () => {
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: true }).encrypt).toBe('true');
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: false }).encrypt).toBe('false');
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: 'strict' }).encrypt).toBe('strict');
		// auto 必须能回填：否则编辑一次已存连接就把自动策略悄悄换成 encrypt=true
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields', encrypt: 'auto' }).encrypt).toBe('auto');
		expect(T.buildEditForm({ id: 'a', kind: 'sqlserver', mode: 'fields' }).encrypt).toBe('auto');
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

/* ---------------- 版本号胶囊（项目行最右侧） ---------------- */

describe('4 版本号胶囊接线', () => {
  it('client.js 含 /api/version 拉取与 dbt-ver 胶囊渲染', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
    // 版本号必须来自后端接口（而非前端写死常量，否则发版漏改会显示过期版本）
    expect(src).toContain('api("version")');
    expect(src).toContain('dbt-ver');
    // marginLeft:auto 是把胶囊推到行尾的关键；用 flex:none 防止被压缩
    expect(src).toMatch(/marginLeft:\s*"auto"/);
    expect(src).toMatch(/flex:\s*"none"/);
  });

  it('版本标签在只读态与编辑态两处都渲染（进入编辑后不应消失）', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
    // 抽成 versionBadge 局部变量并至少被引用两次（只读行 + 编辑行）
    expect(src).toContain('const versionBadge');
    const refs = src.split('versionBadge').length - 1;
    expect(refs).toBeGreaterThanOrEqual(3); // 1 次定义 + 2 次使用
  });

  it('版本号请求失败不影响面板：catch 分支不 setError', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
    const i = src.indexOf('api("version")');
    // 只取到该 effect 结束处，避免把紧邻的其它 setError 误判进来
    const end = src.indexOf('}, [visible]);', i);
    const seg = src.slice(i, end > i ? end : i + 400);
    expect(seg).toContain('catch');
    // 版本号是辅助信息，失败只能静默；一旦 setError 会污染整个面板的错误条
    expect(seg).not.toContain('setError');
  });

  it('中英文都提供 pluginVersion 文案（title/aria-label 依赖它）', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
    expect(src).toContain('pluginVersion: "插件版本"');
    expect(src).toContain('pluginVersion: "Plugin version"');
  });
});
