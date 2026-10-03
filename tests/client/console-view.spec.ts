/**
 * ConsoleView 集成断言（离线，不依赖真实浏览器/CodeMirror）：
 * - classifyHead：逐条预分类（读首词/读命令 → query，其余 → execute）
 * - stub React（useState/useRef/useEffect 最小模拟，effect 支持依赖数组比对）浅渲染
 *   ConsoleView 元素树，断言：骨架（连接/标签条/工具行/params/历史）、事务按钮组
 *   ro/rw 差异、编辑器挂载与 destroy 生命周期（CM6 对应 cleanup）、执行流逐条路由
 *   （/api/query、/api/execute、/api/console/exec）、ro 下写语句跳过标注、
 *   多标签切换 setDoc、历史点击回填。
 *
 * vendor bundle 经测试宿主 require("../vendor/codemirror-sql.cjs") 注入 fake 编辑器模块
 * （loadConsoleEditorModule 唯一加载途径；require 失败即降级 textarea）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let mod: any; // client.js factory 产物
let T: any; // exports.__testables
let ConsoleViewRef: any; // T.ConsoleView（仅测试面导出）

/* ---------- stub 基建 ---------- */

type El = { type: any; props: any; children: any[] };

// fetch 调用记录与响应表（按 path 关键字分派）
let fetchCalls: { url: string; body: any }[] = [];
let fetchHandler: (url: string, body: any) => any = () => ({});
function stubFetch(url: string, init?: any) {
	const body = init && init.body ? JSON.parse(init.body) : {};
	fetchCalls.push({ url, body });
	const data = fetchHandler(url, body);
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data })) });
}
const tick = () => new Promise((r) => setImmediate(r));

// 最小 React stub：hooks 槽位 + 依赖数组 effect（重渲染时浅比对，变了才重跑并先跑旧 cleanup）。
// factory 只 require 一次 react，stub 必须全局单例；makeHarness 时 __reset() 清槽位防测试间串扰。
const reactStub = (() => {
	const slots = new Map<string, any>();
	let hookIdx = 0;
	let effects: { i: number; fn: () => any }[] = [];
	// effect 登记（useEffect 与 useLayoutEffect 同一实现：flush() 模拟 commit 后统一执行）
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
		useEffect: regEffect,
		useLayoutEffect: regEffect,
	};
	return {
		React: R,
		render(comp: (props: any) => any, props: any): El {
			hookIdx = 0;
			const tree = comp(props);
			attachRefs(tree); // 模拟 React commit：props.ref 对象指向对应元素（编辑器挂载依赖它）
			return tree;
		},
		flush() {
			const list = effects;
			effects = [];
			for (const e of list) {
				const ck = 'c' + e.i;
				const old = slots.get(ck);
				if (typeof old === 'function') old();
				const c = e.fn();
				slots.set(ck, typeof c === 'function' ? c : null);
			}
		},
		destroy() {
			// 模拟卸载：跑全部已登记 cleanup（对齐 CM6 destroy 语义）
			for (let i = 0; i < 300; i++) {
				const c = slots.get('c' + i);
				if (typeof c === 'function') c();
			}
		},
		reset() {
			slots.clear();
			effects = [];
			hookIdx = 0;
		},
	};
})();

// 元素树工具：collect 深度收集、flatText 递归取文本（含嵌套数组，如 conns.map/tabs.map）
function collect(node: any, out: El[] = []): El[] {
	if (Array.isArray(node)) { node.forEach((x) => collect(x, out)); return out; } // 任意深度嵌套数组（renderResultItem 返回 [head, grid]）
	if (!node || typeof node !== 'object' || !node.type) return out;
	out.push(node);
	const kids = Array.isArray(node.children) ? node.children : [node.children];
	for (const k of kids) {
		if (Array.isArray(k)) k.forEach((x) => collect(x, out));
		else collect(k, out);
	}
	return out;
}
function attachRefs(n: any) {
	if (!n || typeof n !== 'object' || !n.type) return;
	if (n.props && n.props.ref && typeof n.props.ref === 'object' && 'current' in n.props.ref) n.props.ref.current = n;
	const kids = Array.isArray(n.children) ? n.children : [n.children];
	for (const k of kids) {
		if (Array.isArray(k)) k.forEach(attachRefs);
		else attachRefs(k);
	}
}
function flatText(n: any): string {
	if (n === null || n === undefined || n === false || n === true) return '';
	if (Array.isArray(n)) return n.map(flatText).join('');
	if (typeof n !== 'object') return String(n);
	const kids = Array.isArray(n.children) ? n.children : [n.children];
	return kids.map(flatText).join('');
}
function buttonByText(tree: El, text: string): El | undefined {
	return collect(tree).find((n) => n.type === 'button' && flatText(n).trim() === text);
}
function buttonByLabel(tree: El, label: string): El | undefined {
	return collect(tree).find((n) => n.type === 'button' && n.props['aria-label'] === label);
}

/* ---------- fake 编辑器模块（vendor/codemirror-sql.cjs 替身） ---------- */

const editorInstances: any[] = [];
function makeFakeEditor() {
	return {
		view: { state: { doc: { length: 999 } }, dispatch: () => {}, focus: () => {} },
		destroyed: false,
		destroy() { this.destroyed = true; },
		setSchema: () => {},
		setDoc: function (this: any, text: string) { this.lastDoc = text; },
		lastDoc: '',
		getDoc: () => 'SELECT 1; DELETE FROM t',
		getSelection: () => '',
		format: function (this: any) { return this.lastDoc; },
	};
}

/* ---------- 测试宿主装载 ---------- */

beforeAll(() => {
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, stubFetch);
	mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React; // ConsoleView 集成测试用 hooks stub
		if (name === '../vendor/codemirror-sql.cjs') {
			const ed = makeFakeEditor();
			editorInstances.push(ed);
			return { createConsoleEditor: () => ed };
		}
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T) throw new Error('client.js 未导出 __testables');
	ConsoleViewRef = T.ConsoleView;
	if (typeof ConsoleViewRef !== 'function') throw new Error('client.js 未导出 __testables.ConsoleView');
	fetchHandler = (url) => {
		if (url.includes('/api/databases')) return ['db1', 'db2'];
		if (url.includes('/api/tables')) return [{ name: 'users' }, { name: 'orders' }];
		if (url.includes('/api/schema')) return [{ name: 'id' }, { name: 'name' }];
		if (url.includes('/api/console/begin')) return { sessionToken: 'tok-1' };
		if (url.includes('/api/console/exec')) return { message: 'OK', affectedRows: 1 };
		if (url.includes('/api/console/commit')) return { message: '事务已提交' };
		if (url.includes('/api/query')) return { columns: ['1'], rows: [['1']], rowCount: 1 };
		if (url.includes('/api/execute')) return { message: 'OK', affectedRows: 1 };
		return {};
	};
});

/* ---------- 测试驱动器：ConsoleView 渲染循环 ---------- */

interface Harness {
	render(): void;
	flush(): void;
	step(): void;
	settle(): Promise<void>;
	tree(): El;
	errors: string[];
	unmount(): void;
}

function makeHarness(mode: 'ro' | 'rw'): Harness {
	const host = reactStub;
	host.reset(); // 清 hooks 槽位与 effect 队列，防测试间串扰
	const errors: string[] = [];
	const props = {
		conns: [{ id: 'c1', kind: 'mysql', name: '本地MySQL' }],
		grants: [{ connId: 'c1', mode }],
		projectPath: 'E:/proj',
		busy: '',
		run: () => Promise.resolve(),
		reload: () => Promise.resolve(),
		onError: (e: any) => errors.push(String(e && e.message ? e.message : e)),
		askConfirm: () => Promise.resolve(false),
	};
	fetchCalls = [];
	let tree: El = null as any;
	const h: Harness = {
		errors,
		render() { tree = host.render(ConsoleViewRef, props); },
		flush() { host.flush(); },
		step() { tree = host.render(ConsoleViewRef, props); host.flush(); },
		async settle() { await tick(); await tick(); await tick(); },
		tree: () => tree,
		unmount() { host.destroy(); },
	};
	h.render();
	h.flush();
	return h;
}
// 选连接并让状态生效：settle 放行 vendor bundle 异步加载，再 step 挂载编辑器
// （真实浏览器中编辑器就绪前点执行：textarea 分支文本为空则不执行——同实现的空文本守卫）
async function pickConn(h: Harness) {
	const sel = collect(h.tree()).find((n) => n.type === 'select');
	sel!.props.onChange({ target: { value: 'c1' } });
	h.step();
	await h.settle();
	h.step();
}
async function clickRun(h: Harness) {
	await buttonByText(h.tree(), '执行')!.props.onClick();
	await h.settle();
	h.step();
}

/* ---------- classifyHead 预分类 ---------- */

describe('classifyHead 预分类', () => {
	it('SQL 读首词（含小写）→ query', () => {
		expect(T.classifyHead('mysql', 'SELECT 1')).toBe('query');
		expect(T.classifyHead('mysql', '  select * from t')).toBe('query');
		expect(T.classifyHead('postgresql', 'WITH x AS (SELECT 1) SELECT * FROM x')).toBe('query');
		expect(T.classifyHead('mysql', 'SHOW TABLES')).toBe('query');
		expect(T.classifyHead('mysql', 'EXPLAIN SELECT 1')).toBe('query');
		expect(T.classifyHead('oracle', 'DESC t')).toBe('query');
		expect(T.classifyHead('dmdb', 'DESCRIBE t')).toBe('query');
	});
	it('SQL 写/管理首词 → execute', () => {
		expect(T.classifyHead('mysql', 'INSERT INTO t VALUES (1)')).toBe('execute');
		expect(T.classifyHead('mysql', 'UPDATE t SET a=1')).toBe('execute');
		expect(T.classifyHead('mysql', 'DELETE FROM t')).toBe('execute');
		expect(T.classifyHead('mysql', 'CREATE TABLE t (id INT)')).toBe('execute');
		expect(T.classifyHead('mysql', 'DROP TABLE t')).toBe('execute');
		expect(T.classifyHead('mysql', '-- 注释\nUPDATE t SET a=1')).toBe('execute');
	});
	it('redis JSON 命令：读命令 → query、写命令 → execute', () => {
		expect(T.classifyHead('redis', '["GET","k"]')).toBe('query');
		expect(T.classifyHead('redis', '["HGETALL","h"]')).toBe('query');
		expect(T.classifyHead('redis', '["SET","k","v"]')).toBe('execute');
		expect(T.classifyHead('redis', '["DEL","k"]')).toBe('execute');
	});
	it('mongo JSON 命令：find → query、insertOne → execute', () => {
		expect(T.classifyHead('mongodb', '{"find":"users"}')).toBe('query');
		expect(T.classifyHead('mongodb', '{"count":"users"}')).toBe('query');
		expect(T.classifyHead('mongodb', '{"insertOne":"users"}')).toBe('execute');
	});
});

/* ---------- 渲染骨架与授权差异 ---------- */

describe('ConsoleView 渲染骨架与授权差异', () => {
	it('骨架：连接选择/SQL·脚本 seg/执行按钮/params 输入/历史/默认单标签；ro 无事务按钮', () => {
		const h = makeHarness('ro');
		const tree = h.tree();
		expect(collect(tree).some((n) => n.type === 'select')).toBe(true);
		expect(buttonByText(tree, 'SQL')).toBeTruthy();
		expect(buttonByText(tree, '执行')).toBeTruthy();
		expect(collect(tree).some((n) => n.type === 'input')).toBe(true);
		expect(buttonByText(tree, '历史')).toBeTruthy();
		expect(buttonByText(tree, '开始事务')).toBeUndefined();
		expect(buttonByText(tree, '查询 1')).toBeTruthy();
	});
	it('rw 授权选中连接后显示事务按钮组（开始事务）；未选连接不显示', async () => {
		const h = makeHarness('rw');
		expect(buttonByText(h.tree(), '开始事务')).toBeUndefined(); // 未选连接：rw 不成立
		await pickConn(h);
		expect(buttonByText(h.tree(), '开始事务')).toBeTruthy();
	});
});

/* ---------- 编辑器挂载（CM6 生命周期） ---------- */

describe('编辑器挂载', () => {
	it('vendor bundle 注入后挂载编辑器并 setDoc 初值；卸载 cleanup 调 destroy', async () => {
		const h = makeHarness('rw');
		await h.settle(); // 放行 loadConsoleEditorModule（async require 途径）
		h.step();
		const ed = editorInstances[editorInstances.length - 1];
		expect(ed).toBeTruthy();
		h.unmount();
		expect(ed.destroyed).toBe(true);
	});
});

/* ---------- 执行流：逐条预分类路由与 ro 跳过 ---------- */

describe('执行流', () => {
	it('ro 授权：SELECT 走 /api/query，DELETE 跳过并标注（不调 /api/execute）', async () => {
		const h = makeHarness('ro');
		await pickConn(h);
		const runBtn = buttonByText(h.tree(), '执行')!;
		expect(runBtn.props.disabled).toBeFalsy();
		await clickRun(h);
		const urls = fetchCalls.map((c) => c.url);
		expect(urls.some((u) => u.includes('/api/query'))).toBe(true);
		expect(urls.some((u) => u.includes('/api/execute'))).toBe(false);
		const text = flatText(h.tree());
		expect(text).toContain('已跳过（只读授权）');
		expect(text).toContain('1 行');
	});
	it('rw 授权：DELETE 走 /api/execute 并显示受影响行数', async () => {
		const h = makeHarness('rw');
		await pickConn(h);
		await clickRun(h);
		expect(fetchCalls.some((c) => c.url.includes('/api/execute'))).toBe(true);
		expect(flatText(h.tree())).toContain('受影响 1 行');
	});
});

/* ---------- 事务会话按钮组 ---------- */

	describe('事务会话按钮组', () => {
		it('tx 态 exec 响应含 rowCount（QueryResult）：查询行渲染网格并带「事务内」徽标，写行维持「写入」', async () => {
			const h = makeHarness('rw');
			await pickConn(h);
			await buttonByText(h.tree(), '开始事务')!.props.onClick();
			await h.settle();
			h.step();
			const prev = fetchHandler;
			// oracle/dmdb 事务内 SELECT 服务端契约：SELECT 回 QueryResult，写语句仍回 message/affectedRows
			fetchHandler = (url, body) => {
				if (url.includes('/api/console/exec')) {
					return /^SELECT/i.test(String(body.statement))
						? { columns: ['ID'], rows: [[1], [2]], rowCount: 2 }
						: { message: 'OK', affectedRows: 1 };
				}
				return prev(url, body);
			};
			try {
				await clickRun(h);
				expect(fetchCalls.some((c) => c.url.includes('/api/console/exec'))).toBe(true);
				// 网格渲染：与 /api/query 同路（ResultSetGrid 接 columns/rows）
				const grids = collect(h.tree()).filter((n) => n.type === T.ResultSetGrid);
				expect(grids.length).toBe(1); // 仅 SELECT 有结果集
				expect(grids[0]!.props.columns).toEqual(['ID']);
				expect(grids[0]!.props.rows).toEqual([[1], [2]]);
				// 「事务内」徽标仅出现在查询行；写语句行维持「写入」徽标
				const txBadges = collect(h.tree()).filter((n) => n.type === 'span' && flatText(n) === '事务内');
				expect(txBadges.length).toBe(1);
				expect(flatText(h.tree())).toContain('写入');
			} finally {
				fetchHandler = prev;
			}
		});
		it('rw：开始 → 执行走 /api/console/exec → 提交后销毁会话回到「开始事务」', async () => {
		const h = makeHarness('rw');
		await pickConn(h);
		await buttonByText(h.tree(), '开始事务')!.props.onClick();
		await h.settle();
		h.step();
		expect(fetchCalls.some((c) => c.url.includes('/api/console/begin'))).toBe(true);
		expect(flatText(h.tree())).toContain('事务进行中');
		await clickRun(h);
		const execCall = fetchCalls.find((c) => c.url.includes('/api/console/exec'));
		expect(execCall).toBeTruthy();
		expect(execCall!.body.sessionToken).toBe('tok-1');
		await buttonByText(h.tree(), '提交事务')!.props.onClick();
		await h.settle();
		h.step();
		expect(fetchCalls.some((c) => c.url.includes('/api/console/commit'))).toBe(true);
		expect(buttonByText(h.tree(), '开始事务')).toBeTruthy();
	});
});

/* ---------- 多标签与历史 ---------- */

describe('多标签与历史', () => {
	it('新建标签后标签数为 2，且切换标签触发编辑器 setDoc 同步空文档', async () => {
		const h = makeHarness('rw');
		await h.settle();
		h.step();
		expect(buttonByLabel(h.tree(), '新建标签')).toBeTruthy();
		buttonByLabel(h.tree(), '新建标签')!.props.onClick();
		h.step();
		const tabTitles = collect(h.tree()).filter(
			(n) => n.type === 'button' && String(n.props.className || '').includes('dbt-cm-tab')
				&& /^查询 \d+/.test(flatText(n).trim()),
		);
		expect(tabTitles.length).toBe(2);
		const ed = editorInstances[editorInstances.length - 1];
		expect(ed.lastDoc).toBe(''); // 切到新标签：setDoc 同步该标签空 SQL
	});
	it('执行后历史有条目；展开历史点击行回填编辑器 setDoc', async () => {
		const h = makeHarness('rw');
		await pickConn(h);
		await clickRun(h);
		await buttonByText(h.tree(), '历史')!.props.onClick();
		h.step();
		const ed = editorInstances[editorInstances.length - 1];
		const histBtn = collect(h.tree()).find(
			(n) => n.type === 'button' && n.props.className && String(n.props.className).includes('dbt-cellbtn'),
		);
		expect(histBtn).toBeTruthy();
		histBtn!.props.onClick();
		expect(ed.lastDoc).toContain('SELECT 1; DELETE FROM t');
	});
});
