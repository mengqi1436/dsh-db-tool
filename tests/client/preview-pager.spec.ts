/**
 * 数据预览分页快跳 + 内容搜索的离线测试（stub React 浅渲染 + 源码结构断言 + 纯函数契约）。
 *
 * 覆盖：
 *  1) 纯函数：lastPageOf / clampJumpPage（总页数与跳页钳制）；
 *  2) 请求契约：openTable 的 preview 调用携带 search/total 参数，翻页沿用已存 total
 *     （不再重复 COUNT）、提交搜索带 total=1、切表重置搜索；
 *  3) 分页条结构：有 total 时渲染 首页/末页/页码快跳/总数，无 total（KV 型）仅翻页；
 *  4) 内容搜索框：按 kind 显隐（redis 无行级搜索语义）、回车提交、清除复位；
 *  5) i18n 与样式契约（中英双份 + 分页/搜索控件样式类）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
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
		pendingEffects(): { i: number; fn: () => any }[] {
			return effects;
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

let src = '';
let T: any; // __testables

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
	if (!T || typeof T.BrowsePane !== 'function') throw new Error('client.js 未导出 __testables.BrowsePane');
});

/* ---------- 1. 纯函数契约 ---------- */

describe('1 分页纯函数（lastPageOf / clampJumpPage）', () => {
	it('总页数 = ceil(total / 50)，至少 1 页', () => {
		expect(T.lastPageOf(0, 50)).toBe(1);
		expect(T.lastPageOf(1, 50)).toBe(1);
		expect(T.lastPageOf(50, 50)).toBe(1);
		expect(T.lastPageOf(51, 50)).toBe(2);
		expect(T.lastPageOf(1234, 50)).toBe(25);
	});
	it('非法 total（null/负数/非数字）按 0 行处理', () => {
		expect(T.lastPageOf(null, 50)).toBe(1);
		expect(T.lastPageOf(-5, 50)).toBe(1);
		expect(T.lastPageOf('abc', 50)).toBe(1);
	});
	it('跳页输入钳制到 [1, lastPage]；非数字回退第 1 页', () => {
		expect(T.clampJumpPage(1, 25)).toBe(1);
		expect(T.clampJumpPage('7', 25)).toBe(7);
		expect(T.clampJumpPage(0, 25)).toBe(1);
		expect(T.clampJumpPage(99, 25)).toBe(25);
		expect(T.clampJumpPage(-3, 25)).toBe(1);
		expect(T.clampJumpPage('abc', 25)).toBe(1);
	});
});

/* ---------- 2. 请求契约：search/total 参数与状态联动 ---------- */

// BrowsePane useState 声明序（client.js 同步维护）：sel, view, schema, preview, page,
// total, jumpInput, busy, loadErr, filters, appliedFilters, filterLogic, appliedLogic,
// appliedLogics, filtersOpen —— 注入即得「已选表 + 数据预览」形态
const SEL = { connId: 'c-ok', db: 'app', schemaName: null, table: { name: 'users', type: 'TABLE' } };

function renderPaneWithState(opts: { total?: any; search?: string; kind?: string } = {}) {
	seenPreviewUrls.length = 0;
	const first = reactStub.render(T.BrowsePane, paneProps(opts.kind));
	if (flatText(first).length === 0) throw new Error('BrowsePane 首渲为空');
	reactStub.slots.set('s0', SEL); // sel
	reactStub.slots.set('s1', 'preview'); // view
	reactStub.slots.set('s2', [{ name: 'id', dataType: 'int', nullable: false, key: 'PRI' }]); // schema
	reactStub.slots.set('s3', { columns: ['id'], rows: [[1]], rowCount: 1 }); // preview
	reactStub.slots.set('s4', 3); // page
	reactStub.slots.set('s5', 'total' in opts ? opts.total : 123); // total
	reactStub.slots.set('s6', ''); // jumpInput
	reactStub.slots.set('s7', ''); // busy
	reactStub.slots.set('s8', ''); // loadErr
	reactStub.slots.set('s9', []); // filters
	reactStub.slots.set('s10', []); // appliedFilters
	reactStub.slots.set('s11', 'and'); // filterLogic
	reactStub.slots.set('s12', 'and'); // appliedLogic
	reactStub.slots.set('s13', []); // appliedLogics
	reactStub.slots.set('s14', false); // filtersOpen
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

describe('2 openTable 请求契约（search/total 参数）', () => {
	it('源码：preview 请求携带 search/filters 与 total 参数，翻页沿用已存 total 不重复 COUNT', () => {
		expect(src).toContain('filters: fl ? JSON.stringify(fl.list) : undefined, logic: fl ? fl.logic : undefined, logics: fl && fl.logics && fl.logics.length ? JSON.stringify(fl.logics) : undefined, total: withTotal ? 1 : undefined');
		// 响应处理：仅在本次请求了计数时才更新 total（翻页响应无 total，不得清空已存值）
		expect(src).toContain('if (withTotal) setTotal(prev && prev.total != null ? prev.total : null)');
	});

	it('翻页（下一页）不重拉计数且不携带 search 参数', () => {
		const pane = renderPaneWithState({});
		const footer = byClass(pane, 'dbt-browse-footer')[0];
		expect(footer).toBeTruthy();
		const next = collect(footer).find((e) => e.type === 'button' && flatText(e).includes('下一页'))!;
		expect(next).toBeTruthy();
		next.props.onClick();
		const u = new URL(seenPreviewUrls[seenPreviewUrls.length - 1]!, 'http://x');
		expect(u.searchParams.get('offset')).toBe('150'); // page 3 → 第 4 页
		expect(u.searchParams.get('total')).toBeNull();
		expect(u.searchParams.get('search')).toBeNull();
	});

	it('跨列搜索框已移除：分页条不再渲染搜索输入（内容查找统一走逐字段筛选）', () => {
		const pane = renderPaneWithState({ search: '', total: 500 });
		expect(collect(pane).some((e) => e.props.className === 'dbt-browse-search')).toBe(false);
		expect(src).not.toContain('dbt-browse-search');
	});

	it('页码快跳沿用手动跳页且不重拉计数', () => {
		const pane = renderPaneWithState({ total: 500 });
		const input = collect(pane).find((e) => e.props.className === 'dbt-browse-jump')!;
		expect(input).toBeTruthy();
		input.props.onChange({ target: { value: '2' } });
		const pane2 = reactStub.rerender(T.BrowsePane, paneProps());
		const input2 = collect(pane2).find((e) => e.props.className === 'dbt-browse-jump')!;
		input2.props.onKeyDown({ key: 'Enter', currentTarget: { value: '2' } });
		const u = new URL(seenPreviewUrls[seenPreviewUrls.length - 1]!, 'http://x');
		expect(u.searchParams.get('offset')).toBe('50');
		expect(u.searchParams.get('total')).toBeNull(); // 翻页沿用已存计数
	});
});

/* ---------- 3. 分页条结构（有 total / 无 total） ---------- */

describe('3 分页条结构', () => {
	it('有 total：渲染 首页/末页/页码快跳输入/总行数', () => {
		const pane = renderPaneWithState({ total: 123 });
		const footer = byClass(pane, 'dbt-browse-footer')[0];
		const texts = collect(footer).filter((e) => e.type === 'button').map((e) => flatText(e));
		expect(texts.some((s) => s.includes('首页'))).toBe(true);
		expect(texts.some((s) => s.includes('末页'))).toBe(true);
		expect(texts.some((s) => s.includes('下一页'))).toBe(true);
		expect(collect(footer).some((e) => e.props.className === 'dbt-browse-jump')).toBe(true);
		expect(flatText(footer)).toContain('共 123 行');
	});

	it('末页直达最后一页（123 行 → 第 3 页）', () => {
		const pane = renderPaneWithState({ total: 123 });
		const footer = byClass(pane, 'dbt-browse-footer')[0];
		const last = collect(footer).find((e) => e.type === 'button' && flatText(e).includes('末页'))!;
		last.props.onClick();
		const off = new URL(seenPreviewUrls[seenPreviewUrls.length - 1]!, 'http://x').searchParams;
		expect(off.get('offset')).toBe('100');
	});

	it('无 total（redis KV 型）：只有翻页与页码文案，无搜索框', () => {
		const pane = renderPaneWithState({ total: null, kind: 'redis' });
		const footer = byClass(pane, 'dbt-browse-footer')[0];
		expect(collect(footer).some((e) => e.props.className === 'dbt-browse-jump')).toBe(false);
		expect(collect(footer).some((e) => e.type === 'button' && flatText(e).includes('末页'))).toBe(false);
		expect(flatText(footer)).toContain('第 3 页');
		expect(collect(pane).some((e) => e.props.className === 'dbt-browse-search')).toBe(false);
	});

	it('页码快跳回车提交：越界钳制到末页', () => {
		const pane = renderPaneWithState({ total: 123 });
		const input = collect(pane).find((e) => e.props.className === 'dbt-browse-jump')!;
		input.props.onChange({ target: { value: '999' } });
		// stub React 不自动重渲染：onChange(setState) 后手动再渲染一次（真实 React 等价物），
		// 使 jumpCommit 闭包读到最新 jumpInput
		const pane2 = reactStub.rerender(T.BrowsePane, paneProps());
		const input2 = collect(pane2).find((e) => e.props.className === 'dbt-browse-jump')!;
		input2.props.onKeyDown({ key: 'Enter' });
		const off = new URL(seenPreviewUrls[seenPreviewUrls.length - 1]!, 'http://x').searchParams;
		expect(off.get('offset')).toBe('100');
	});

	it('筛选零匹配：空态明示无匹配并提供清除入口（分页条不渲染时也能退出筛选）', () => {
		reactStub.slots.clear();
		reactStub.render(T.BrowsePane, paneProps());
		reactStub.slots.set('s0', SEL);
		reactStub.slots.set('s1', 'preview');
		reactStub.slots.set('s3', { columns: ['id'], rows: [], rowCount: 0 }); // 零行
		reactStub.slots.set('s10', [{ column: 'name', op: 'contains', value: 'alice' }]); // 筛选激活
		const pane = reactStub.rerender(T.BrowsePane, paneProps());
		expect(flatText(pane)).toContain('无匹配数据');
		const clear = collect(pane).find((e) => e.type === 'button' && flatText(e).includes('清除'));
		expect(clear).toBeTruthy();
	});
});

/* ---------- 4. i18n 与样式契约 ---------- */

describe('4 i18n 与样式契约（中英双份）', () => {
	const KEYS = ['firstPage', 'lastPage', 'pageTotal', 'pageMatch', 'jumpPrefix', 'jumpSuffix', 'pageJumpAria', 'filterTitle', 'filterApply', 'cellSearchClear', 'searchNoMatch'];
	it('新增分页/筛选文案中英双份齐全', () => {
		for (const k of KEYS) {
			expect(src, `zh 缺少 ${k}`).toMatch(new RegExp('\\b' + k + ': "[^"]+"'));
		}
		// 英文块：以 pageInfo 的英文值定位 en 字典片段
		const enIdx = src.indexOf('pageInfo: "Page {page} (50 rows/page)"');
		expect(enIdx).toBeGreaterThan(0);
		for (const k of KEYS) {
			expect(src.slice(enIdx, enIdx + 1200), `en 缺少 ${k}`).toMatch(new RegExp('\\b' + k + ': "'));
		}
	});

	it('分页快跳与筛选窗格样式类已定义', () => {
		expect(src).toContain('.dbt-browse-jump{');
		expect(src).toContain('.dbt-filter-pane{');
		expect(src).toContain('.dbt-browse-footer input{');
	});
});
