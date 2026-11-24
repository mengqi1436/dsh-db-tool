/**
 * 「项目授权」卡片化的离线测试（stub React 浅渲染，复用 conn-cards.spec.ts 同款最小宿主）。
 *
 * 覆盖（授权视图从 inset grouped 行改为连接管理同款卡片）：
 *  1) 渲染结构：不再渲染 dbt-group/dbt-listrow 行；按数据库类型分组小节（dbt-kindgroup）+
 *     auto-fill 卡片网格（dbt-conncards/dbt-conncard），PG 显示简称；
 *  2) 卡片头行：kind 胶囊（带数据库图标 svg）+ 名称 + 模式徽标（ro/rw 才有，aria-hidden）；
 *  3) 地址副行：safeUrl / host:port 单行省略 + title 全文；
 *  4) 授权 seg：整卡宽三段均分（role=radiogroup/aria-checked 契约不变），当前模式高亮；
 *  5) 授权链路不变：seg 点击 → PUT/DELETE /grants → reload；busy=grant 时禁用；
 *  6) 状态行：空授权引导（文案改「卡片」）/ 已授权计数摘要；无连接时空态引导、无网格。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React（与 conn-cards.spec.ts 同款最小实现） ---------- */

const reactStub = (() => {
	const slots = new Map<string, any>();
	let hookIdx = 0;
	function regEffect(fn: any, deps?: any[]) {
		const i = hookIdx++;
		const dk = 'd' + i;
		const prev = slots.get(dk);
		if (deps && prev && Array.isArray(prev) && prev.length === deps.length && prev.every((d, k) => d === deps[k])) return;
		slots.set(dk, deps ? deps.slice() : null);
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
function byRole(tree: El, role: string): El[] {
	return collect(tree).filter((e) => e.props.role === role);
}
/** 微任务排空：fetch 桩的 promise 链全部落地 */
async function flushAsync(): Promise<void> {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

/* ---------- fetch 桩：记录全部调用的 method/body ---------- */

const fetchCalls: { url: string; init: any }[] = [];
const stubbedFetch = (url: any, init: any) => {
	fetchCalls.push({ url: String(url), init });
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data: {} })) });
};

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
	if (!T || typeof T.GrantsView !== 'function') {
		throw new Error('client.js 未导出 __testables.GrantsView');
	}
});

/* ---------- 数据与渲染 ---------- */

const conns = [
	{ id: 'c-pg', name: '生产 PG', kind: 'postgresql', safeUrl: 'postgres://u@10.0.0.8:5432/app' },
	{ id: 'c-my', name: '订单 MySQL', kind: 'mysql', host: '10.0.0.9', port: 3306 },
	{ id: 'c-rd', name: '缓存 Redis', kind: 'redis', safeUrl: 'redis://10.0.0.10:6379' },
];

function grantProps(over: any = {}) {
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
function renderGrants(over: any = {}) {
	return reactStub.render(T.GrantsView, grantProps(over));
}
function radiosOf(tree: El): El[] {
	return byRole(tree, 'radio');
}
function radiosForCard(tree: El, c: { id: string; name: string }): El[] {
	// 生产 aria-label 用 c.name || c.id（grantModeGroup），按名或 id 双路匹配
	const group = byRole(tree, 'radiogroup').find((g) => {
		const label = String(g.props['aria-label']);
		return label.includes(c.id) || label.includes(c.name);
	})!;
	return byRole(group, 'radio');
}

/* ---------- 1. 渲染结构：卡片化分组网格 ---------- */

describe('1 渲染结构：授权视图卡片化（对齐连接管理）', () => {
	it('不再渲染 inset grouped 行（dbt-group/dbt-listrow），改为分组小节 + 卡片网格', () => {
		const pane = renderGrants();
		expect(byClass(pane, 'dbt-listrow').length).toBe(0);
		expect(byClass(pane, 'dbt-group').length).toBe(0);
		// 三种 kind 各成一组，组内一张授权卡
		expect(byClass(pane, 'dbt-kindgroup').length).toBe(3);
		expect(byClass(pane, 'dbt-conncards').length).toBe(3);
		const cards = byClass(pane, 'dbt-conncard');
		expect(cards.length).toBe(3);
		// 节头：类型简称 + 数量（组序按 DB_KINDS）
		const heads = byClass(pane, 'dbt-kindgroup-head').map((h) => flatText(h));
		expect(heads).toEqual(['mysql1', 'PG1', 'redis1']);
	});

	it('卡片头行：kind 胶囊带数据库图标 + 名称 + 模式徽标（ro/rw 才有徽标且 aria-hidden）', () => {
		const pane = renderGrants({ grants: [{ connId: 'c-pg', mode: 'rw' }, { connId: 'c-my', mode: 'ro' }] });
		const cardOf = (name: string) => byClass(pane, 'dbt-conncard').find((c) => flatText(c).includes(name))!;
		const chipOf = (card: El) => collect(card).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-kindchip'))!;
		// kind 胶囊带图标（svg 子元素）与简称
		expect(flatText(chipOf(cardOf('生产 PG')))).toContain('PG');
		expect(chipOf(cardOf('生产 PG')).children.some((c: any) => c && c.type === 'svg')).toBe(true);
		// 徽标：pg=rw 绿「读写」、my=ro 灰「只读」、rd=未授权无徽标；徽标均为 aria-hidden（seg 是权威状态源）
		const isBadge = (e: El) => e.type === 'span' && e.props['aria-hidden'] === 'true' && (flatText(e) === '读写' || flatText(e) === '只读');
		const badges = collect(pane).filter(isBadge);
		expect(badges.map(flatText).sort()).toEqual(['只读', '读写']);
		// 未授权卡：无徽标（seg 里的「未授权」radio 仍照常渲染）
		expect(collect(cardOf('缓存 Redis')).find(isBadge)).toBeUndefined();
	});

	it('地址副行：safeUrl / host:port 单行省略 + title 全文，帮助区分同名连接', () => {
		const pane = renderGrants();
		const subs = byClass(pane, 'dbt-conncard-sub');
		expect(subs.length).toBe(3);
		const subOf = (name: string) => byClass(pane, 'dbt-conncard').find((c) => flatText(c).includes(name))!.children
			.find((k: any) => typeof k === 'object' && k.props.className === 'dbt-conncard-sub')!;
		expect(flatText(subOf('生产 PG'))).toBe('postgres://u@10.0.0.8:5432/app');
		expect(flatText(subOf('订单 MySQL'))).toBe('10.0.0.9:3306');
		expect(subOf('订单 MySQL').props.title).toBe('10.0.0.9:3306');
	});

	it('授权 seg：整卡宽三段均分，radiogroup/aria-checked 契约不变，当前模式高亮', () => {
		const pane = renderGrants({ grants: [{ connId: 'c-pg', mode: 'rw' }] });
		const groups = byRole(pane, 'radiogroup');
		expect(groups.length).toBe(3);
		// seg 拉通整卡宽（卡片化的关键视觉：选项变大易选）；border-box 防止 seg 自身 padding 溢出卡片内容盒
		for (const g of groups) {
			expect(g.props.style.width).toBe('100%');
			expect(g.props.style.marginTop).toBe('auto');
			expect(g.props.style.boxSizing).toBe('border-box');
		}
		// 每组三个 radio（未授权/只读/读写），均分拉伸
		for (const g of groups) {
			const rs = byRole(g, 'radio');
			expect(rs.length).toBe(3);
			for (const r of rs) expect(r.props.style.flex).toBe('1 1 0');
		}
		// aria-label 逐卡绑定连接名；当前模式 aria-checked 唯一
		const pg = radiosForCard(pane, conns[0]!);
		expect(pg.map((r) => flatText(r))).toEqual(['未授权', '只读', '读写']);
		expect(pg.map((r) => r.props['aria-checked'])).toEqual([false, false, true]);
		const rd = radiosForCard(pane, conns[2]!);
		expect(rd.map((r) => r.props['aria-checked'])).toEqual([true, false, false]);
	});

	it('状态行：空授权给引导文案，部分授权给计数摘要；无连接时空态引导且无网格', () => {
		const empty = renderGrants();
		expect(flatText(empty)).toContain('尚未授权任何连接');
		expect(flatText(empty)).toContain('每张卡片');
		const partial = renderGrants({ grants: [{ connId: 'c-pg', mode: 'rw' }] });
		expect(flatText(partial)).toContain('已授权 1/3 个连接');
		const none = renderGrants({ conns: [] });
		expect(flatText(none)).toContain('还没有连接');
		expect(byClass(none, 'dbt-conncards').length).toBe(0);
	});
});

/* ---------- 2. 授权链路：seg 点击 → PUT/DELETE /grants ---------- */

describe('2 授权链路不变', () => {
	it('点击「只读」PUT /grants（projectPath+connId+mode），成功后 reload', async () => {
		fetchCalls.length = 0;
		let reloads = 0;
		const props = grantProps({ reload: () => { reloads++; return Promise.resolve(); } });
		const pane = renderGrants(props);
		const pg = radiosForCard(pane, conns[0]!);
		pg[1]!.props.onClick(); // 只读
		await flushAsync();
		const put = fetchCalls.find((c) => c.url.includes('/grants') && c.init.method === 'PUT')!;
		expect(put).toBeTruthy();
		expect(JSON.parse(put.init.body)).toEqual({ projectPath: 'E:/proj', connId: 'c-pg', mode: 'ro' });
		expect(reloads).toBe(1);
	});

	it('已授权卡点击「未授权」DELETE /grants（仅 projectPath+connId）', async () => {
		fetchCalls.length = 0;
		const props = grantProps({ grants: [{ connId: 'c-my', mode: 'ro' }] });
		const pane = renderGrants(props);
		const my = radiosForCard(pane, conns[1]!);
		expect(my[0]!.props['aria-checked']).toBe(false); // 当前模式是 ro
		my[0]!.props.onClick(); // 未授权
		await flushAsync();
		const del = fetchCalls.find((c) => c.url.includes('/grants') && c.init.method === 'DELETE')!;
		expect(del).toBeTruthy();
		expect(JSON.parse(del.init.body)).toEqual({ projectPath: 'E:/proj', connId: 'c-my' });
	});

	it('busy=grant 时全部 radio 禁用（防重复提交）', () => {
		const pane = renderGrants({ busy: 'grant' });
		for (const r of radiosOf(pane)) expect(r.props.disabled).toBe(true);
		const idle = renderGrants();
		for (const r of radiosOf(idle)) expect(r.props.disabled).toBe(false);
	});
});
