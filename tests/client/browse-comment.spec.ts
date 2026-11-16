/**
 * 「数据浏览」对象树表行注释布局的离线测试（stub React 多轮渲染 + 脚本化 fetch）。
 *
 * 覆盖：
 *  1) mysql（两层：连接 → 库 → 表）与 postgresql（三层：连接 → 库 → schema → 表）两条树路径，
 *     表行的表名占左列且贴合内容（.dbt-treename.dbt-treename-fit），中文注释为紧跟其后的
 *     独立块（.dbt-treecomment），两者之间有竖向隔断（.dbt-treesep），不再以「 · 注释」拼进名称；
 *  2) 无注释的表行没有隔断与注释块；
 *  3) 普通表不挂「 · TABLE」类型后缀（大小写不敏感判定），视图等非普通表仍显示类型；
 *  4) 库内搜表结果行与树表行同一布局契约。
 *
 * 说明：stub React 不带调度器，state 更新只写槽位；用「渲染 → 逐层点击展开行 →
 * flush 微任务」的循环驱动懒加载（effect 在渲染后统一执行，对齐真实时序）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React：槽位持久 + effect 渲染后执行 + 可重复渲染 ---------- */

const reactStub = (() => {
	const slots = new Map<string, any>();
	let hookIdx = 0;
	let pending: { dk: string; fn: any; deps?: any[] }[] = []; // 本轮注册的 effect
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
		useEffect(fn: any, deps?: any[]) {
			const i = hookIdx++;
			pending.push({ dk: 'd' + i, fn, deps });
		},
		useLayoutEffect(fn: any, deps?: any[]) {
			const i = hookIdx++;
			pending.push({ dk: 'd' + i, fn, deps });
		},
	};
	return {
		React: R,
		/** 渲染一轮：清 hookIdx 让 hook 槽位从头对齐（state 槽位保留），随后执行新增/依赖变化的 effect */
		render(comp: (props: any) => any, props: any): El {
			hookIdx = 0;
			pending = [];
			const el = comp(props);
			for (const e of pending) {
				const prev = slots.get(e.dk);
				const ds = e.deps;
				if (ds && prev && Array.isArray(prev) && prev.length === ds.length && prev.every((d: any, k: number) => d === ds[k])) continue;
				slots.set(e.dk, ds ? ds.slice() : null);
				void e.fn();
			}
			return el;
		},
		reset() {
			slots.clear();
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

/* ---------- 被测模块装载 ---------- */

let T: any; // __testables
let fetchImpl: (url: string) => Promise<any> = () => Promise.resolve({ ok: true, text: () => Promise.resolve('') });

beforeAll(() => {
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	// fetch 走间接层：api() 闭包捕获的是装载期参数，测试内重派 fetchImpl 即可换应答
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, (url: string) => fetchImpl(url));
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T || typeof T.BrowseTree !== 'function') throw new Error('client.js 未导出 __testables.BrowseTree');
});

/* ---------- 驱动器：脚本化 fetch + 展开循环 ---------- */

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 让对象树逐层加载到位：每轮渲染后点击文本命中的可展开行（want 依次为库名/schema 名） */
async function expandTo(conn: any, tables: any[], ...want: string[]) {
	const byUrl = new Map<string, unknown>([
		['databases', ['mydb']],
		['tables', tables],
		['searchHits', tables.map((x: any) => ({ database: 'mydb', name: x.name, type: x.type, comment: x.comment || '' }))],
	]);
	if (conn.kind === 'postgresql') byUrl.set('schemas', ['public']);
	fetchImpl = (async (url: string) => {
		const path = String(url);
		let data: unknown = [];
		if (path.includes('/databases')) data = byUrl.get('databases');
		else if (path.includes('/schemas')) data = byUrl.get('schemas');
		else if (path.includes('/tables')) data = byUrl.get('tables');
		else if (path.includes('/search-tables')) data = byUrl.get('searchHits') ?? [];
		return { ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data })) };
	}) as any;
	reactStub.reset();
	const props = () => ({
		conns: [conn], projectPath: 'E:/proj', sel: null,
		onSelect: () => {}, autoExpand: true, refreshTick: 0,
	});
	let tree = reactStub.render(T.BrowseTree, props());
	await flush();
	// 树壳默认收起（PR #17 起对齐 Navicat 左侧目录树习惯）：先点标题行展开树体，再逐层导航
	const head = collect(tree).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-browse-treehead'));
	expect(head, '未找到对象树壳标题行').toBeTruthy();
	head!.props.onClick();
	await flush();
	for (const w of want) {
		tree = reactStub.render(T.BrowseTree, props());
		const row = collect(tree).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-treerow') && flatText(e).includes(w) && e.props.onClick);
		expect(row, `未找到可展开行「${w}」`).toBeTruthy();
		row!.props.onClick({ currentTarget: {} });
		await flush();
	}
	return reactStub.render(T.BrowseTree, props());
}

/* ---------- 表行结构断言辅助 ---------- */

/** 找到文本命中的表行，拆出名称块/隔断/注释块三个结构元素 */
function rowParts(tree: El, rowText: string) {
	const row = collect(tree).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-treerow') && flatText(e).includes(rowText));
	expect(row, `未找到表行「${rowText}」`).toBeTruthy();
	const kids = collect(row).filter((e) => e !== row && typeof e.props.className === 'string');
	const pick = (cls: string) => kids.find((e) => (e.props.className as string).includes(cls)) ?? null;
	return {
		name: pick('dbt-treename'),
		sep: pick('dbt-treesep'),
		comment: pick('dbt-treecomment'),
	};
}

/* ---------- 用例 ---------- */

describe('数据浏览对象树：表行注释布局（左表名、右注释、中间隔断）', () => {
	it('mysql 两层树：表名与注释分列两侧且有隔断，普通表不挂 TABLE 后缀', async () => {
		const tree = await expandTo(
			{ id: 'c1', name: '主库', kind: 'mysql' },
			[
				{ name: 'users', type: 'TABLE', comment: '用户表' },
				{ name: 'v_logs', type: 'VIEW', comment: '' },
			],
			'mydb',
		);
		const users = rowParts(tree, 'users');
		expect(flatText(users.name)).toBe('users'); // 表名单独占左列，不再拼接注释
		expect(users.sep, 'users 行缺竖向隔断').toBeTruthy();
		expect(users.comment, 'users 行缺注释块').toBeTruthy();
		expect(users.comment!.props.title).toBe('用户表'); // 截断时悬停可读全文
		expect(users.name!.props.className).toContain('dbt-treename-fit'); // 名称列贴合内容：隔断与注释紧跟表名
		const vlogs = rowParts(tree, 'v_logs');
		expect(flatText(vlogs.name)).toBe('v_logs · VIEW'); // 非普通表仍显示类型
		expect(vlogs.sep).toBeNull(); // 无注释：无隔断、无注释块
		expect(vlogs.comment).toBeNull();
		const text = flatText(tree);
		expect(text).not.toContain('users · 用户表'); // 注释不再拼进名称
		expect(text).not.toContain('· TABLE'); // 普通表不挂类型后缀（此前大小写敏感判定漏放）
	});

	it('postgresql 三层树（库→schema→表）：注释布局契约一致', async () => {
		const tree = await expandTo(
			{ id: 'c2', name: '分析库', kind: 'postgresql' },
			[{ name: 'orders', type: 'TABLE', comment: '订单主表' }],
			'mydb',
			'public',
		);
		const orders = rowParts(tree, 'orders');
		expect(flatText(orders.name)).toBe('orders');
		expect(orders.sep, 'orders 行缺竖向隔断').toBeTruthy();
		expect(flatText(orders.comment)).toBe('订单主表');
		expect(flatText(tree)).not.toContain('orders · 订单主表');
		expect(flatText(tree)).not.toContain('· TABLE');
	});

	it('库内搜表结果行：同一布局契约（库名.表名占左、注释右列、中间隔断）', async () => {
		const tree = await expandTo(
			{ id: 'c3', name: '主库', kind: 'mysql' },
			[{ name: 'users', type: 'TABLE', comment: '用户表' }],
			'mydb',
		);
		// 顶栏搜索框输入关键词后回车触发 /search-tables（闭包随渲染重建，回车须用重渲染后的新元素）
		const input = collect(tree).find((e) => e.type === 'input' && e.props['aria-label'] && typeof e.props.onKeyDown === 'function');
		expect(input, '未找到搜索输入框').toBeTruthy();
		input!.props.onChange({ target: { value: 'users' } });
		const fresh = reactStub.render(T.BrowseTree, {
			conns: [{ id: 'c3', name: '主库', kind: 'mysql' }], projectPath: 'E:/proj', sel: null,
			onSelect: () => {}, autoExpand: true, refreshTick: 0,
		});
		const freshInput = collect(fresh).find((e) => e.type === 'input' && e.props['aria-label'] && typeof e.props.onKeyDown === 'function');
		expect(freshInput, '重渲染后未找到搜索输入框').toBeTruthy();
		freshInput!.props.onKeyDown({ key: 'Enter' });
		await flush();
		const resultTree = reactStub.render(T.BrowseTree, {
			conns: [{ id: 'c3', name: '主库', kind: 'mysql' }], projectPath: 'E:/proj', sel: null,
			onSelect: () => {}, autoExpand: true, refreshTick: 0,
		});
		const hit = rowParts(resultTree, 'mydb.users');
		expect(flatText(hit.name)).toBe('mydb.users');
		expect(hit.sep, '搜索结果行缺竖向隔断').toBeTruthy();
		expect(flatText(hit.comment)).toBe('用户表');
		expect(flatText(resultTree)).not.toContain('mydb.users · 用户表');
	});
});
