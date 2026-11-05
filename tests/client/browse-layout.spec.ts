/**
 * 「数据浏览」页面布局与权限过滤的离线测试（stub React 浅渲染 + 源码结构断言）。
 *
 * 覆盖本轮四项改动：
 *  1) 分区重排：工具条（库筛选/表名搜索）从树内嵌行上提到树壳顶部，树体可折叠，
 *     分区自上而下为 对象树壳（工具条+树体）→ 面包屑 → 结构/数据分段 → 内容区；
 *  2) 权限过滤：数据浏览只渲染本项目已授权的连接，未授权连接不再出现在树里（原先是
 *     「看得见、点开必被服务端拒绝」的死链），并给出隐藏计数与授权入口；
 *  3) 无授权空态：一条授权都没有时整块引导替代空树；
 *  4) 面包屑：把当前位置（连接 / 库[.模式] / 表）从树内高亮提升为显式文字。
 *
 * 说明：stub React 不展开函数组件（会打乱 hook 计数），故跨组件断言一律取
 * 组件节点的 props 契约，单组件内部顺序则各自单独渲染断言。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React（与 sqlserver-wiring.spec.ts 同款最小实现） ---------- */

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
		/** 每次渲染前清空 hook 槽位，保证单组件渲染的 hook 序号从头开始 */
		render(comp: (props: any) => any, props: any): El {
			slots.clear();
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
/** 渲染结果里所有带该 className 的节点（按 DOM 序） */
function byClass(tree: El, cls: string): El[] {
	return collect(tree).filter((e) => typeof e.props.className === 'string' && e.props.className.split(/\s+/).includes(cls));
}
/** 渲染结果里所有该组件类型的节点（浅渲染：函数组件节点不展开，只取 props 契约） */
function byType(tree: El, comp: any): El[] {
	return collect(tree).filter((e) => e.type === comp);
}

/* ---------- 测试宿主装载 ---------- */

let src = '';
let T: any; // __testables

function stubFetch() {
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data: [] })) });
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
	if (!T || typeof T.BrowsePane !== 'function' || typeof T.BrowseTree !== 'function') {
		throw new Error('client.js 未导出 __testables.BrowsePane / BrowseTree');
	}
});

/* ---------- 1. 源码结构：工具条上提与样式类落地 ---------- */

describe('1 浏览页分区结构（源码断言）', () => {
	it('树内不再有 filterRow（库筛选/表名搜索已上提到树壳顶部工具条）', () => {
		expect(src).not.toContain('function filterRow');
		expect(src).not.toMatch(/treeRows\.push\(filterRow/);
	});

	it('工具条与树壳、面包屑的样式类均已定义并实际使用', () => {
		for (const cls of ['dbt-browse-toolbar', 'dbt-browse-treeshell', 'dbt-browse-treehead', 'dbt-browse-crumb']) {
			expect(src, `缺少样式定义: ${cls}`).toContain('.' + cls + '{');
			expect(src, `缺少渲染使用: ${cls}`).toContain(cls);
		}
	});

	it('树体限高 + 标题行可折叠（aria-expanded 绑定 treeCollapsed）', () => {
		expect(src).toMatch(/\.dbt-browse-tree\{max-height:\d+px;overflow-y:auto;\}/);
		expect(src).toContain('"aria-expanded": !treeCollapsed');
	});
});

/* ---------- 2. 权限过滤：未授权连接不出现在数据浏览 ---------- */

const connGranted = { id: 'c-ok', name: '已授权库', kind: 'mysql' };
const connUngranted = { id: 'c-no', name: '未授权库', kind: 'mysql' };

function renderPane(over: any = {}) {
	return reactStub.render(T.BrowsePane, Object.assign({
		conns: [connGranted, connUngranted],
		projectPath: 'E:/proj',
		grants: [{ connId: 'c-ok', mode: 'ro' }],
		askConfirm: () => Promise.resolve(true),
		active: false,
		refreshTick: 0,
		onGoGrants: () => {},
	}, over));
}

describe('2 权限过滤（未授权连接隐藏）', () => {
	it('下传给对象树的连接只含已授权项', () => {
		const pane = renderPane();
		const treeNode = byType(pane, T.BrowseTree)[0];
		expect(treeNode, '未渲染对象树组件').toBeTruthy();
		expect(treeNode!.props.conns.map((c: any) => c.id)).toEqual(['c-ok']);
	});

	it('隐藏计数可见（告知被隐藏的数量，不是静默丢弃）', () => {
		expect(flatText(renderPane())).toContain('已隐藏 1 个未授权连接');
	});

	it('连接全部未授权时整块空态 + 授权入口，不渲染对象树', () => {
		const pane = renderPane({ conns: [connUngranted], grants: [] });
		expect(flatText(pane)).toContain('数据浏览只显示已授权的连接');
		expect(byType(pane, T.BrowseTree).length).toBe(0);
		const btn = collect(pane).find((e) => e.type === 'button' && flatText(e).includes('前往授权'));
		expect(btn, '缺少「前往授权」入口').toBeTruthy();
	});

	it('授权入口回调被接到 props.onGoGrants', () => {
		let clicked = 0;
		const pane = renderPane({ conns: [connUngranted], grants: [], onGoGrants: () => { clicked += 1; } });
		const btn = collect(pane).find((e) => e.type === 'button' && flatText(e).includes('前往授权'))!;
		btn.props.onClick();
		expect(clicked).toBe(1);
	});

	it('未授权连接不进入树，故树内不出现其名称', () => {
		const tree = reactStub.render(T.BrowseTree, {
			conns: [connGranted], projectPath: 'E:/proj', sel: null,
			onSelect: () => {}, autoExpand: false, refreshTick: 0,
		});
		expect(flatText(tree)).toContain('已授权库');
		expect(flatText(tree)).not.toContain('未授权库');
	});
});

/* ---------- 4. 控件尺寸一致性（统一走 token，不靠各自 padding 拼高度） ---------- */

/** 从样式块里取出某条规则体（第一个 .cls{ ... }） */
function ruleBody(cls: string): string {
	const m = new RegExp('\\.' + cls.replace(/[-.]/g, (c) => '\\' + c) + '\\{([^}]*)\\}').exec(src);
	if (!m) throw new Error('样式规则未找到: ' + cls);
	return m[1] as string;
}

describe('4 控件尺寸一致性', () => {
	it('尺寸 token 已定义：控件高 / 行高 / 胶囊高', () => {
		expect(src).toContain('--dbt-ctrl-h:');
		expect(src).toContain('--dbt-row-h:');
		expect(src).toContain('--dbt-chip-h:');
	});

	it('按钮、输入框、下拉框、分段项、标签页全部锁定同一控件高度 token', () => {
		// 主按钮：固定高 + 上下 padding 归零（不再靠 padding 撑高）
		const btn = ruleBody('dbt-btn');
		expect(btn).toContain('height:var(--dbt-ctrl-h');
		expect(btn).toMatch(/padding:0 12px/);
		// 输入/下拉：同一 token
		const inputRule = /\.dbt-row input,\.dbt-row select[^{]*\{([^}]*)\}/.exec(src);
		expect(inputRule, '未找到输入框规则').toBeTruthy();
		expect(inputRule![1]).toContain('height:var(--dbt-ctrl-h');
		expect(inputRule![1]).toMatch(/padding:0 12px/);
		// 分段项与标签页：token 减去容器 2px*2 内边距，保证与外层等高
		expect(ruleBody('dbt-seg button')).toContain('height:calc(var(--dbt-ctrl-h');
		expect(/\.dbt-tabs button\{([^}]*)\}/.exec(src)![1]).toContain('height:calc(var(--dbt-ctrl-h');
		// 代码编辑器标签页
		expect(ruleBody('dbt-cm-tab')).toContain('height:calc(var(--dbt-ctrl-h');
	});

	it('行级容器统一最小行高（树行/列表行/树标题行/面包屑）', () => {
		expect(ruleBody('dbt-treerow')).toContain('min-height:var(--dbt-row-h');
		expect(ruleBody('dbt-listrow')).toContain('min-height:var(--dbt-row-h');
		expect(ruleBody('dbt-browse-treehead')).toContain('height:var(--dbt-row-h');
		expect(ruleBody('dbt-browse-crumb')).toContain('min-height:var(--dbt-row-h');
	});

	it('胶囊统一高度 token（kind / route / NULL），不再各拼 padding', () => {
		for (const cls of ['dbt-kindchip', 'dbt-routechip', 'dbt-nullchip']) {
			const body = ruleBody(cls);
			expect(body, `${cls} 未使用 chip token`).toContain('height:var(--dbt-chip-h');
			expect(body, `${cls} 仍用纵向 padding 撑高`).toMatch(/padding:0 /);
		}
	});

	it('kind 胶囊不再以内联 padding/lineHeight 拼装（两处视图均改用 .dbt-kindchip）', () => {
		// 旧实现：style 里带 padding: "2px 6px" + lineHeight: 1.45 的 kind 胶囊
		expect(src).not.toContain('padding: "2px 6px", fontFamily: MONO_FONT');
		const uses = src.match(/className: "dbt-kindchip"/g) ?? [];
		expect(uses.length).toBe(2); // 连接管理 + 授权两处列表行
	});
});


describe('3 分区顺序与面包屑', () => {
	it('面板内分区自上而下：面包屑 → 分段内容区（树壳在更上层由 BrowseTree 自持）', () => {
		const pane = renderPane();
		const nodes = collect(pane).filter((e) => typeof e.props.className === 'string');
		const crumb = nodes.findIndex((e) => e.props.className.includes('dbt-browse-crumb'));
		const main = nodes.findIndex((e) => e.props.className.includes('dbt-browse-main'));
		expect(crumb).toBeGreaterThanOrEqual(0);
		expect(main).toBeGreaterThan(crumb);
		// 树组件位于面包屑之前（导航入口在内容之上）
		const treeIdx = collect(pane).findIndex((e) => e.type === T.BrowseTree);
		expect(treeIdx).toBeGreaterThanOrEqual(0);
		expect(treeIdx).toBeLessThan(collect(pane).findIndex((e) => e.props && typeof e.props.className === 'string' && e.props.className.includes('dbt-browse-crumb')));
	});

	it('未选中表时面包屑给出显式「未选择表」而非空白', () => {
		expect(flatText(byClass(renderPane(), 'dbt-browse-crumb')[0])).toContain('未选择表');
	});

	it('树内工具条位于树体之前（筛选/搜索是导航入口，不藏在展开行里）', () => {
		const tree = reactStub.render(T.BrowseTree, {
			conns: [connGranted], projectPath: 'E:/proj', sel: null,
			onSelect: () => {}, autoExpand: false, refreshTick: 0,
		});
		const nodes = collect(tree).filter((e) => typeof e.props.className === 'string');
		const tb = nodes.findIndex((e) => e.props.className.includes('dbt-browse-toolbar'));
		const body = nodes.findIndex((e) => e.props.className.includes('dbt-browse-tree'));
		expect(tb).toBeGreaterThanOrEqual(0);
		expect(body).toBeGreaterThan(tb);
	});

	it('树壳标题行渲染对象树入口并带折叠状态', () => {
		const tree = reactStub.render(T.BrowseTree, {
			conns: [connGranted], projectPath: 'E:/proj', sel: null,
			onSelect: () => {}, autoExpand: false, refreshTick: 0,
		});
		const head = byClass(tree, 'dbt-browse-treehead')[0];
		expect(head, '缺少树壳标题行').toBeTruthy();
		expect(head!.props['aria-expanded']).toBe(true);
		expect(flatText(head)).toContain('对象树');
	});
});
