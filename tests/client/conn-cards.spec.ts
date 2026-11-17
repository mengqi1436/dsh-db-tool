/**
 * 「连接管理」卡片式自适应布局 + 一键测试的离线测试（stub React 浅渲染 + 源码结构断言）。
 *
 * 覆盖：
 *  1) 卡片网格：连接列表从 inset grouped 行（dbt-group/dbt-listrow）改为独立卡片网格
 *     （dbt-conncards / dbt-conncard），auto-fill + minmax 让列数与卡片大小随侧栏宽度自适应；
 *  2) 连通状态圆点：灰=未测试 / 黄闪=测试中 / 绿=成功 / 红=失败，装饰性冗余编码（aria-hidden）；
 *  3) 一键测试：一次点击并发（上限 4）测完全部连接，每卡状态各自就位，结束后顶部给计数汇总；
 *  4) 授权视图不受影响：仍走 dbt-group/dbt-listrow 行式布局，dbt-kindchip 全仓仍只有两处。
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React（与 browse-layout.spec.ts 同款最小实现） ---------- */

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
			slots.clear();
			effects = [];
			hookIdx = 0;
			return comp(props);
		},
		rerender(comp: (props: any) => any, props: any): El {
			effects = [];
			hookIdx = 0;
			return comp(props);
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
function byClass(tree: El, cls: string): El[] {
	return collect(tree).filter((e) => typeof e.props.className === 'string' && e.props.className.split(/\s+/).includes(cls));
}
function buttons(tree: El): El[] {
	return collect(tree).filter((e) => e.type === 'button');
}
/** 微任务排空：fetch 桩的 promise 链全部落地（多轮 setTimeout 覆盖嵌套 await） */
async function flushAsync(): Promise<void> {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

/* ---------- fetch 桩：单一稳定函数 + 可变状态（client.js 在装载时捕获函数对象） ---------- */

const fetchCalls: { url: string; init: any }[] = [];
let responder: ((url: string) => any) | null = null; // 按 URL 定制响应体（默认全部连通成功）
let hold = false; // true 时挂起全部请求（观察「测试中」中间态）
const pending: { url: string; resolve: (v: any) => void }[] = [];

const OK_BODY = { ok: true, data: { ok: true, serverInfo: 'PG 17.11' } };
function bodyOf(url: string): any {
	return responder ? responder(url) : OK_BODY;
}
const stubbedFetch = (url: any, init: any) => {
	const u = String(url);
	fetchCalls.push({ url: u, init });
	if (hold) return new Promise((resolve) => pending.push({ url: u, resolve }));
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(bodyOf(u))) });
};
function holdFetch() { hold = true; pending.length = 0; }
function releaseHeld() {
	const list = pending.splice(0);
	hold = false;
	for (const p of list) p.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(bodyOf(p.url))) });
}
function respondersUse(fn: (url: string) => any) { responder = fn; }
function respondersReset() { responder = null; }

/* ---------- 测试宿主装载 ---------- */

let src = '';
let T: any; // __testables

beforeAll(() => {
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, stubbedFetch);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T || typeof T.ManageView !== 'function') {
		throw new Error('client.js 未导出 __testables.ManageView');
	}
});

afterEach(() => {
	respondersReset();
	if (pending.length) releaseHeld();
	hold = false;
});

/* ---------- 1. 源码结构：卡片网格与状态圆点样式落地 ---------- */

describe('1 卡片网格样式（源码断言）', () => {
	it('dbt-conncards 网格容器：auto-fill + minmax 自适应列数与卡片大小', () => {
		const m = /\.dbt-conncards\{([^}]*)\}/.exec(src);
		expect(m, '缺少 .dbt-conncards 样式').toBeTruthy();
		expect(m![1]).toContain('grid-template-columns:repeat(auto-fill,minmax(');
		expect(m![1]).toContain('gap:8px');
	});

	it('dbt-conncard 卡片本体走既有 token（表面/圆角/hairline 描边），窄卡内容不溢出', () => {
		const m = /\.dbt-conncard\{([^}]*)\}/.exec(src);
		expect(m, '缺少 .dbt-conncard 样式').toBeTruthy();
		expect(m![1]).toContain('background:var(--dbt-surface');
		expect(m![1]).toContain('border:1px solid var(--dbt-separator');
		expect(m![1]).toContain('border-radius:var(--dbt-radius-card');
		expect(m![1]).toContain('min-width:0');
	});

	it('卡片读作离散对象而非表单行：地址副行单行省略 + title 全文，kind 胶囊带数据库图标', () => {
		const sub = /\.dbt-conncard-sub\{([^}]*)\}/.exec(src);
		expect(sub, '缺少 .dbt-conncard-sub 样式').toBeTruthy();
		expect(sub![1]).toContain('text-overflow:ellipsis');
		expect(sub![1]).not.toContain('word-break:break-all');
		expect(src).toContain('title: c.safeUrl || (c.host + ":" + (c.port || ""))');
		expect(src).toContain('icon(12), c.kind');
	});

	it('连通状态圆点四态齐全（未测试灰 / 测试中黄闪 / 成功绿 / 失败红）', () => {
		expect(src).toContain('.dbt-statusdot{');
		expect(src).toMatch(/\.dbt-statusdot\.ok\{background:var\(--dbt-success\)/);
		expect(src).toMatch(/\.dbt-statusdot\.fail\{background:var\(--dbt-danger\)/);
		expect(src).toMatch(/\.dbt-statusdot\.testing\{background:var\(--dbt-warning\)/);
		expect(src).toContain('@keyframes dbt-pulse{');
	});

	it('连接管理改用卡片网格，不再渲染 inset grouped 行（dbt-group/listrow 留给授权等其他视图）', () => {
		// 网格容器与卡片本体各出现一次（容器在 ManageView，卡片在 map 回调内）
		expect((src.match(/className: "dbt-conncards"/g) ?? []).length).toBe(1);
		expect((src.match(/className: "dbt-conncard", key: c\.id/g) ?? []).length).toBe(1);
		// kind 胶囊全仓仍两处：连接卡片 + 授权行（既有契约不变）
		const chips = src.match(/className: "dbt-kindchip"/g) ?? [];
		expect(chips.length).toBe(2);
	});
});

/* ---------- 2. 卡片渲染结构 ---------- */

const conns = [
	{ id: 'c-pg', name: '生产 PG', kind: 'postgresql', safeUrl: 'postgres://u@10.0.0.8:5432/app', mode: 'url' },
	{ id: 'c-my', name: '订单 MySQL', kind: 'mysql', host: '10.0.0.9', port: 3306, mode: 'fields' },
	{ id: 'c-rd', name: '缓存 Redis', kind: 'redis', safeUrl: 'redis://10.0.0.10:6379', mode: 'url' },
];

function manageProps(over: any = {}) {
	return Object.assign({
		conns,
		grants: [],
		projectPath: 'E:/proj',
		busy: '',
		run: (_n: string, fn: () => Promise<void>) => fn(),
		reload: () => Promise.resolve(),
		onError: () => {},
		askConfirm: () => Promise.resolve(true),
	}, over);
}
function renderManage(over: any = {}) {
	return reactStub.render(T.ManageView, manageProps(over));
}

describe('2 卡片渲染结构', () => {
	it('每条连接渲染为独立卡片，容器是网格；卡片含 kind 胶囊/名称/副行/动作行', () => {
		const pane = renderManage();
		const grids = byClass(pane, 'dbt-conncards');
		expect(grids.length).toBe(1);
		const cards = byClass(pane, 'dbt-conncard');
		expect(cards.length).toBe(3);
		const text = flatText(pane);
		for (const c of conns) {
			expect(text).toContain(c.name);
			expect(text).toContain(c.kind);
		}
		expect(text).toContain('postgres://u@10.0.0.8:5432/app');
		expect(text).toContain('10.0.0.9:3306'); // fields 模式回退 host:port
		// 每卡动作：测试/编辑/删除
		const btns = buttons(pane).map((b) => flatText(b));
		expect(btns.filter((t) => t === '测试').length).toBe(3);
		expect(btns.filter((t) => t === '编辑').length).toBe(3);
		expect(btns.filter((t) => t === '删除').length).toBe(3);
	});

	it('初始态：状态圆点无修饰类（灰=未测试），且为装饰性冗余编码（aria-hidden）', () => {
		const pane = renderManage();
		for (const dot of byClass(pane, 'dbt-statusdot')) {
			expect(String(dot.props.className).trim()).toBe('dbt-statusdot');
			expect(dot.props['aria-hidden']).toBe('true');
		}
	});

	it('顶部动作行含「一键测试」按钮；无连接时禁用且不渲染网格', () => {
		const pane = renderManage();
		const all = buttons(pane).find((b) => flatText(b) === '一键测试');
		expect(all, '缺少一键测试按钮').toBeTruthy();
		expect(all!.props.disabled).toBeFalsy();
		const empty = renderManage({ conns: [] });
		const allEmpty = buttons(empty).find((b) => flatText(b) === '一键测试');
		expect(allEmpty!.props.disabled).toBe(true);
		expect(byClass(empty, 'dbt-conncards').length).toBe(0);
	});
});

/* ---------- 3. 一键测试：请求、状态流转与汇总 ---------- */

describe('3 一键测试行为', () => {
	it('一键测试对每条连接各发一次 POST /connections/<id>/test，成功后各卡亮绿点', async () => {
		fetchCalls.length = 0;
		respondersReset();
		holdFetch();
		const props = manageProps();
		const pane = reactStub.render(T.ManageView, props);
		const all = buttons(pane).find((b) => flatText(b) === '一键测试')!;
		all.props.onClick();
		await flushAsync();
		// 请求全部发出（并发上限 4 ≥ 3 条连接）
		const testUrls = fetchCalls.filter((c) => c.url.includes('/test')).map((c) => c.url);
		expect(testUrls.length).toBe(3);
		for (const c of conns) expect(testUrls.some((u) => u.includes('/connections/' + c.id + '/test'))).toBe(true);
		// 中间态：全部卡片进入「测试中」，圆点黄闪、单卡测试按钮禁用
		let mid = reactStub.rerender(T.ManageView, props);
		let dots = byClass(mid, 'dbt-statusdot');
		expect(dots.length).toBe(3);
		for (const d of dots) expect(String(d.props.className)).toContain('testing');
		const testingBtns = buttons(mid).filter((b) => flatText(b) === '测试' && b.props.disabled);
		expect(testingBtns.length).toBe(3);
		// 放行：全部连通成功
		releaseHeld();
		await flushAsync();
		mid = reactStub.rerender(T.ManageView, props);
		dots = byClass(mid, 'dbt-statusdot');
		for (const d of dots) expect(String(d.props.className)).toContain('ok');
		expect(flatText(mid)).toContain('连接成功');
		// 汇总行：3 成功 0 失败，绿色 dbt-msg
		const summary = collect(mid).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-msg') && flatText(e).includes('一键测试完成'));
		expect(summary, '缺少一键测试汇总反馈').toBeTruthy();
		expect(flatText(summary!)).toContain('3 个成功');
		expect(flatText(summary!)).toContain('0 个失败');
	});

	it('部分失败：失败卡亮红点并显示服务端错误提示，汇总行红色含失败计数', async () => {
		fetchCalls.length = 0;
		respondersReset();
		respondersUse((u) => (u.includes('/connections/c-my/test')
			? { ok: true, data: { ok: false, error: '连接被拒绝：127.0.0.1:3306 无服务在监听（ECONNREFUSED）' } }
			: { ok: true, data: { ok: true, serverInfo: 'PG 17.11' } }));
		const props = manageProps();
		const pane = reactStub.render(T.ManageView, props);
		const all = buttons(pane).find((b) => flatText(b) === '一键测试')!;
		all.props.onClick();
		await flushAsync();
		const mid = reactStub.rerender(T.ManageView, props);
		const dots = byClass(mid, 'dbt-statusdot');
		const states = dots.map((d) => String(d.props.className));
		expect(states.filter((s) => s.includes('ok')).length).toBe(2);
		expect(states.filter((s) => s.includes('fail')).length).toBe(1);
		const text = flatText(mid);
		expect(text).toContain('无服务在监听'); // 服务端映射后的准确提示原样展示
		const summary = collect(mid).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-err') && flatText(e).includes('一键测试完成'));
		expect(summary, '失败时缺少红色汇总').toBeTruthy();
		expect(flatText(summary!)).toContain('2 个成功');
		expect(flatText(summary!)).toContain('1 个失败');
	});

	it('ok:false 无 error 时回退本地「连接失败」文案', async () => {
		fetchCalls.length = 0;
		respondersReset();
		respondersUse(() => ({ ok: true, data: { ok: false } }));
		const props = manageProps();
		const pane = reactStub.render(T.ManageView, props);
		buttons(pane).find((b) => flatText(b) === '一键测试')!.props.onClick();
		await flushAsync();
		const mid = reactStub.rerender(T.ManageView, props);
		expect(flatText(mid)).toContain('连接失败');
	});

	it('单卡测试：请求对应连接，结果只更新本卡状态（不波及他卡）', async () => {
		fetchCalls.length = 0;
		respondersReset();
		respondersUse((u) => (u.includes('/connections/c-rd/test')
			? { ok: true, data: { ok: false, error: '主机名无法解析：db.invalid（ENOTFOUND）' } }
			: { ok: true, data: { ok: true, serverInfo: 'PG 17.11' } }));
		const props = manageProps();
		const pane = reactStub.render(T.ManageView, props);
		const cards = byClass(pane, 'dbt-conncard');
		const rdBtns = buttons(cards[2]!).filter((b) => flatText(b) === '测试');
		expect(rdBtns.length).toBe(1);
		rdBtns[0]!.props.onClick();
		await flushAsync();
		const after = reactStub.rerender(T.ManageView, props);
		const dots = byClass(after, 'dbt-statusdot');
		expect(String(dots[0]!.props.className)).not.toContain('ok'); // 前两卡未被波及
		expect(String(dots[2]!.props.className)).toContain('fail');
		expect(flatText(after)).toContain('无法解析');
	});
});
