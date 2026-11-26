/**
 * 数据浏览字段筛选（Navicat「Filter & Sort」对齐）客户端测试：
 * stub React 浅渲染 BrowsePane（筛选窗格结构、请求契约）与 PreviewGrid（表头漏斗），
 * 断言应用/清除/翻页的 preview 请求契约（filters/logic/total 参数）与 Redis 能力面隐藏。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let src = '';
let T: any;

type El = { type: any; props: any; children: any[] };

/* ---------- stub React（与 preview-pager.spec.ts 同款，支持跨渲染状态槽位） ---------- */

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
		slots,
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

/* ---------- 测试宿主装载 ---------- */

const seenPreviewUrls: string[] = [];
function stubFetch(url: string) {
	if (String(url).includes('/api/preview')) seenPreviewUrls.push(String(url));
	return Promise.resolve({
		ok: true,
		text: () => Promise.resolve(JSON.stringify({ ok: true, data: url.includes('/api/preview') ? { columns: ['id'], rows: [[1]], rowCount: 1, total: 123 } : [] })),
	});
}

beforeAll(() => {
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, stubFetch);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T || typeof T.BrowsePane !== 'function' || typeof T.PreviewGrid !== 'function') {
		throw new Error('client.js 未导出 __testables.BrowsePane / PreviewGrid');
	}
});

/* ---------- 状态注入 ---------- */

// BrowsePane useState 声明序（client.js 同步维护）：sel, view, schema, preview, page,
// total, jumpInput, busy, loadErr, filters, appliedFilters, filterLogic, appliedLogic,
// appliedLogics, filtersOpen
const SEL = { connId: 'c-ok', db: 'app', schemaName: null, table: { name: 'users', type: 'TABLE' } };
const SCHEMA = [
	{ name: 'id', dataType: 'int', nullable: false, key: 'PRI' },
	{ name: 'name', dataType: 'varchar', nullable: true },
];

function renderPaneWithState(opts: { kind?: string; draft?: any[]; applied?: any[]; appliedLogic?: string; open?: boolean } = {}) {
	seenPreviewUrls.length = 0;
	const first = reactStub.render(T.BrowsePane, paneProps(opts.kind));
	if (flatText(first).length === 0) throw new Error('BrowsePane 首渲为空');
	reactStub.slots.set('s0', SEL); // sel
	reactStub.slots.set('s1', 'preview'); // view
	reactStub.slots.set('s2', SCHEMA); // schema
	reactStub.slots.set('s3', { columns: ['id'], rows: [[1]], rowCount: 1 }); // preview
	reactStub.slots.set('s4', 1); // page
	reactStub.slots.set('s5', 123); // total
	reactStub.slots.set('s6', ''); // jumpInput
	reactStub.slots.set('s7', ''); // busy
	reactStub.slots.set('s8', ''); // loadErr
	reactStub.slots.set('s9', opts.draft ?? opts.applied?.slice() ?? []); // filters（草稿）
	reactStub.slots.set('s10', opts.applied?.slice() ?? []); // appliedFilters
	reactStub.slots.set('s11', opts.appliedLogic ?? 'and'); // filterLogic
	reactStub.slots.set('s12', opts.appliedLogic ?? 'and'); // appliedLogic
	reactStub.slots.set('s13', []); // appliedLogics
	reactStub.slots.set('s14', opts.open ?? false); // filtersOpen
	return reactStub.rerender(T.BrowsePane, paneProps(opts.kind));
}

function paneProps(kind?: string) {
	return {
		conns: [{ id: 'c-ok', name: '已授权库', kind: kind ?? 'mysql' }],
		projectPath: 'E:/proj',
		grants: [{ connId: 'c-ok', mode: 'ro' }],
		askConfirm: () => Promise.resolve(true),
		active: false,
		refreshTick: 0,
		onGoGrants: () => {},
	};
}

function lastPreviewUrl(): URL {
	return new URL(seenPreviewUrls[seenPreviewUrls.length - 1]!, 'http://x');
}

/** 筛选窗格元素（仅当展开/有草稿行时非空） */
function paneOf(tree: El): El | undefined {
	return byClass(tree, 'dbt-filter-pane')[0];
}

/* ---------- 用例 ---------- */

describe('1 能力面与筛选窗格结构', () => {
	it('常量契约：FILTER_OPS 全集与取值分类（对齐 Navicat 构建器操作符表）', () => {
		expect(T.FILTER_OPS.map((o: any) => o.v)).toEqual([
			'contains', 'eq', 'ne', 'begin_with', 'end_with', 'not_contains', 'not_begin_with', 'not_end_with',
			'lt', 'le', 'gt', 'ge', 'is_null', 'is_not_null', 'is_empty', 'is_not_empty',
			'between', 'not_between', 'in', 'not_in',
		]);
		expect([...T.FILTER_VALUELESS]).toEqual(['is_null', 'is_not_null', 'is_empty', 'is_not_empty']);
		expect([...T.FILTER_TWO_VALUES]).toEqual(['between', 'not_between']);
	});

	it('mysql：面包屑行有「筛选」入口（零新增高度）；redis：无筛选入口（KV 型无行级筛选语义）', () => {
		const mysqlPane = renderPaneWithState();
		const crumb = byClass(mysqlPane, 'dbt-browse-crumb')[0];
		expect(collect(crumb).some((e) => e.type === 'button' && flatText(e).includes('筛选'))).toBe(true);
		const redisPane = renderPaneWithState({ kind: 'redis' });
		expect(collect(byClass(redisPane, 'dbt-browse-crumb')[0]).some((e) => e.type === 'button' && flatText(e).includes('筛选'))).toBe(false);
	});

	it('点「筛选」展开窗格并补一空行（Navicat 构建器布局）：工具条 + 行复选框 + 字段/操作符下拉', () => {
		const pane = renderPaneWithState();
		const toggle = collect(byClass(pane, 'dbt-browse-crumb')[0]).find((e) => e.type === 'button' && flatText(e).includes('筛选'))!;
		toggle.props.onClick();
		const paneEl = paneOf(reactStub.rerender(T.BrowsePane, paneProps()))!;
		expect(paneEl).toBeTruthy();
		const selects = collect(paneEl).filter((e) => e.type === 'select');
		expect(selects.length).toBe(2); // 单行时：字段 + 操作符（行间逻辑下拉只在非末行出现）
		const text = flatText(paneEl);
		expect(text).toContain('添加条件');
		expect(text).toContain('应用筛选');
		expect(text).toContain('清除筛选');
		const colOptions = collect(selects[0]).filter((e) => e.type === 'option').map((o) => o.props.value);
		expect(colOptions).toEqual(['id', 'name']); // schema 字段清单
		const checkbox = collect(paneEl).find((e) => e.type === 'input' && e.props.type === 'checkbox')!;
		expect(checkbox.props.checked).toBe(true);
		const input = collect(paneEl).filter((e) => e.type === 'input' && e.props.type !== 'checkbox')[0]!;
		expect(input.props.placeholder).toBe('筛选值');
	});

	it('Navicat 构建器语义：行复选框启停（未勾选行变暗且不提交）、行间 AND/OR 下拉在非末行', () => {
		const pane = renderPaneWithState({ draft: [
			{ column: 'id', op: 'ge', value: '10', logic: 'and', enabled: true },
			{ column: 'name', op: 'contains', value: 'a', logic: 'and', enabled: false },
		], open: true });
		const paneEl = paneOf(pane)!;
		const rows = byClass(paneEl, 'dbt-filter-row').filter((r) => collect(r).some((e) => e.type === 'select'));
		expect(rows).toHaveLength(2);
		const off = byClass(paneEl, 'dbt-filter-off');
		expect(off).toHaveLength(1); // 未勾选行变暗
		const logics = collect(paneEl).filter((e) => e.type === 'select' && typeof e.props.className === 'string' && e.props.className.includes('dbt-filter-logic'));
		expect(logics).toHaveLength(1); // 只有第 1 行有连接符（末行无）
		expect(logics[0]!.props.value).toBe('and');
	});

	it('between 操作符出现第二个输入（上界）；is_null 无值输入', () => {
		const pane = renderPaneWithState();
		const toggle = collect(byClass(pane, 'dbt-browse-crumb')[0]).find((e) => e.type === 'button' && flatText(e).includes('筛选'))!;
		toggle.props.onClick();
		const paneEl = paneOf(reactStub.rerender(T.BrowsePane, paneProps()))!;
		const opSelect = collect(paneEl).filter((e) => e.type === 'select')
			.find((s) => collect(s).some((o) => o.type === 'option' && o.props.value === 'contains'))!;
		opSelect.props.onChange({ target: { value: 'between' } });
		const pane2 = reactStub.rerender(T.BrowsePane, paneProps());
		expect(collect(paneOf(pane2)!).filter((e) => e.type === 'input' && e.props.type !== 'checkbox')).toHaveLength(2);
		const pane3state = paneOf(pane2)!;
		const opSelect2 = collect(pane3state).filter((e) => e.type === 'select')
			.find((s) => collect(s).some((o) => o.type === 'option' && o.props.value === 'contains'))!;
		opSelect2.props.onChange({ target: { value: 'is_null' } });
		const pane3 = reactStub.rerender(T.BrowsePane, paneProps());
		expect(collect(paneOf(pane3)!).filter((e) => e.type === 'input' && e.props.type !== 'checkbox')).toHaveLength(0);
	});
});

describe('2 表头漏斗入口（PreviewGrid）', () => {
	const gridProps = (over: Record<string, unknown> = {}) => ({
		preview: { columns: ['id', 'name'], rows: [[1, 'x']], rowCount: 1 },
		schema: SCHEMA,
		kind: 'mysql',
		editable: false,
		tableType: 'TABLE',
		tableName: 'users',
		dbRef: 'app',
		schemaName: null,
		connId: 'c-ok',
		projectPath: 'E:/proj',
		connName: 'c',
		grantMode: 'ro',
		askConfirm: () => Promise.resolve(true),
		...over,
	});

	it('注入 onFilterColumn 时列头有筛选按钮，点击回调携带列名', () => {
		const seen: string[] = [];
		const el = reactStub.render(T.PreviewGrid, gridProps({ onFilterColumn: (c: string) => seen.push(c) }));
		const funnels = byClass(el, 'dbt-colfilter');
		expect(funnels.length).toBe(2); // 两列各一个
		funnels[1]!.props.onClick();
		expect(seen).toEqual(['name']);
	});

	it('已生效筛选列高亮（active 类）；未注入 onFilterColumn 时无漏斗', () => {
		const el = reactStub.render(T.PreviewGrid, gridProps({ onFilterColumn: () => {}, filterCols: ['name'] }));
		const funnels = byClass(el, 'dbt-colfilter');
		expect(funnels).toHaveLength(2);
		expect(funnels[0]!.props.className).not.toContain('active');
		expect(funnels[1]!.props.className).toContain('active');
		const bare = reactStub.render(T.PreviewGrid, gridProps());
		expect(byClass(bare, 'dbt-colfilter')).toHaveLength(0);
	});
});

describe('3 应用/清除/翻页请求契约', () => {
	it('应用筛选：第 1 页 + filters/logic/logics/total=1，且不携带 search（与内容搜索互斥提交）', () => {
		const pane = renderPaneWithState({ open: true, draft: [{ column: 'id', op: 'contains', value: '' }] });
		const paneEl = paneOf(pane)!;
		collect(paneEl).filter((e) => e.type === 'input' && e.props.type !== 'checkbox')[0]!.props.onChange({ target: { value: 'ali' } });
		const pane2 = reactStub.rerender(T.BrowsePane, paneProps());
		const apply = collect(paneOf(pane2)!).find((e) => e.type === 'button' && flatText(e) === '应用筛选')!;
		apply.props.onClick();
		const u = lastPreviewUrl();
		expect(JSON.parse(u.searchParams.get('filters')!)).toEqual([{ column: 'id', op: 'contains', value: 'ali' }]);
		expect(u.searchParams.get('logic')).toBe('and');
		expect(u.searchParams.get('logics')).toBeNull(); // 单行无连接符
		expect(u.searchParams.get('total')).toBe('1');
		expect(u.searchParams.get('offset')).toBe('0');
		// 应用后收起窗格并清空草稿：数据区不被遮挡（「筛选 · 1」按钮可重新展开并带回已提交条件）
		const paneAfter = paneOf(reactStub.rerender(T.BrowsePane, paneProps()));
		expect(paneAfter).toBeUndefined();
	});

	it('多行混合连接符：logics 数组逐行上报；未勾选行被排除', () => {
		const pane = renderPaneWithState({ open: true, draft: [
			{ column: 'id', op: 'ge', value: '10', logic: 'or', enabled: true },
			{ column: 'name', op: 'contains', value: 'a', logic: 'and', enabled: true },
			{ column: 'note', op: 'is_empty', logic: 'and', enabled: true },
			{ column: 'qty', op: 'is_null', logic: 'and', enabled: false },
		] });
		const apply = collect(paneOf(pane)!).find((e) => e.type === 'button' && flatText(e) === '应用筛选')!;
		apply.props.onClick();
		const u = lastPreviewUrl();
		expect(JSON.parse(u.searchParams.get('filters')!)).toEqual([
			{ column: 'id', op: 'ge', value: '10' },
			{ column: 'name', op: 'contains', value: 'a' },
			{ column: 'note', op: 'is_empty' },
		]); // 未勾选行（qty is_null）不提交
		// 连接符 = 启用行的行间下拉（rows[i].logic 连接 rows[i] 与 rows[i+1]）：
		// 3 个启用行 → 2 个连接符 ['or','and']；未勾选行不参与，其前置连接符一并消失
		expect(JSON.parse(u.searchParams.get('logics')!)).toEqual(['or', 'and']);
	});

	it('全部行未勾选时应用 = 清除筛选（复位全量视图）', () => {
		const pane = renderPaneWithState({ applied: [{ column: 'name', op: 'contains', value: 'a' }], draft: [{ column: 'id', op: 'contains', value: 'x', logic: 'and', enabled: false }], open: true });
		const apply = collect(paneOf(pane)!).find((e) => e.type === 'button' && flatText(e) === '应用筛选')!;
		apply.props.onClick();
		const u = lastPreviewUrl();
		expect(u.searchParams.get('filters')).toBeNull();
		expect(u.searchParams.get('total')).toBe('1');
	});

	it('翻页沿用已提交筛选且不重拉计数（无 total=1）', () => {
		const pane = renderPaneWithState({ applied: [{ column: 'name', op: 'contains', value: 'a' }] });
		const foot = byClass(pane, 'dbt-browse-footer')[0];
		const next = collect(foot).find((e) => e.type === 'button' && e.props['aria-label'] === '下一页')!;
		next.props.onClick();
		const u = lastPreviewUrl();
		expect(JSON.parse(u.searchParams.get('filters')!)).toEqual([{ column: 'name', op: 'contains', value: 'a' }]);
		expect(u.searchParams.get('total')).toBeNull();
	});

	it('筛选计数展示「匹配 n 行」；筛选入口带生效条件数', () => {
		const pane = renderPaneWithState({ applied: [{ column: 'name', op: 'contains', value: 'a' }, { column: 'id', op: 'ge', value: '1' }] });
		const foot = byClass(pane, 'dbt-browse-footer')[0];
		expect(flatText(foot)).toContain('匹配 123 行');
		const filterBtn = collect(pane).find((e) => e.type === 'button' && flatText(e).includes('筛选'))!;
		expect(flatText(filterBtn)).toContain('2');
	});

	it('清除筛选复位全量视图并重拉表格总行数', () => {
		const pane = renderPaneWithState({ applied: [{ column: 'name', op: 'contains', value: 'a' }], open: true });
		const clear = collect(paneOf(pane)!).find((e) => e.type === 'button' && flatText(e) === '清除筛选')!;
		clear.props.onClick();
		const u = lastPreviewUrl();
		expect(u.searchParams.get('filters')).toBeNull();
		expect(u.searchParams.get('search')).toBeNull();
		expect(u.searchParams.get('total')).toBe('1');
	});
});
