/**
 * client.js 里 sqlserver 的「接线存在性」测试（离线；不依赖浏览器/CodeMirror）。
 *
 * 后端链路已由 tests/e2e-mock/sqlserver.spec.ts 覆盖；这里补前端的三个断线高发点：
 *  1) 连接表单类型下拉（DB_KINDS）是否含 sqlserver、分字段默认值（KIND_DEFAULTS）是否为 1433/sa；
 *  2) 传输页源/目标下拉是否会出现 sqlserver 连接、选中后是否呈现「库 → 模式」两级
 *     （HAS_SCHEMAS / NO_DB_LEVEL 的行为差异）；
 *  3) 控制台事务判定集合（CONSOLE_SQL_KINDS）是否把 sqlserver 算作支持事务的 kind。
 * 手法沿用 tests/client/console-view.spec.ts：stub React 浅渲染 + 源码内注入取值探针。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React（与 console-view.spec.ts 同款最小实现） ---------- */

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

/* ---------- 测试宿主装载 ---------- */

let src = '';
let T: any;      // __testables
let probe: any;  // 源码内注入的取值探针：DB_KINDS / KIND_DEFAULTS
let TransferViewRef: any;

const fetchCalls: { url: string; body: any }[] = [];
function stubFetch(url: string, init?: any) {
	const body = init && init.body ? JSON.parse(init.body) : {};
	fetchCalls.push({ url, body });
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
	// 只读注入：把 factory 作用域内的连接表单常量暴露给测试求值（不改仓库源码）
	const marker = 'exports.__testables = {';
	if (!src.includes(marker)) throw new Error('client.js 结构变更：未找到 __testables 导出点');
	const patched = src.replace(marker, 'exports.__probe = { DB_KINDS, KIND_DEFAULTS, t, urlToFieldsPatch };\n\t\t' + marker);
	new Function('window', 'console', 'fetch', patched)(fakeWindow, console, stubFetch);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	probe = mod.__probe;
	TransferViewRef = T && T.TransferView;
	if (typeof TransferViewRef !== 'function') throw new Error('client.js 未导出 __testables.TransferView');
});

/* ---------- 1. 连接表单：类型下拉与默认值 ---------- */

describe('1 连接表单接线', () => {
	it('DB_KINDS 含 sqlserver（kind 下拉数据源，client.js:471）', () => {
		expect(probe.DB_KINDS).toContain('sqlserver');
		expect(probe.DB_KINDS).toEqual(['mysql', 'postgresql', 'gaussdb', 'sqlite', 'redis', 'mongodb', 'oracle', 'dmdb', 'sqlserver']);
	});

	it('KIND_DEFAULTS.sqlserver = 127.0.0.1 / sa，端口不预填（官方 port 可选默认 1433，命名实例场景端口互斥）', () => {
		expect(probe.KIND_DEFAULTS.sqlserver).toEqual({ host: '127.0.0.1', user: 'sa' });
	});

	it('urlToFieldsPatch：从 URL（含脱敏 safeUrl）反解 host/port/user/database，URL 切分字段不再丢真实端口', () => {
		// safeUrl 形态：redactUrl 只脱敏密码段，用户名/主机/端口是真实值（connections.ts:87-88）
		expect(probe.urlToFieldsPatch('sqlserver://sa:***@db1.example.com:14330/appdb')).toEqual({
			host: 'db1.example.com', port: '14330', user: 'sa', database: 'appdb',
		});
		// URL 编码的 userinfo/pathname 反解为原文
		expect(probe.urlToFieldsPatch('sqlserver://u%40x:p%40ss@h1/db%2Fname')).toEqual({
			host: 'h1', port: '', user: 'u@x', database: 'db/name',
		});
		// 无端口/无 userinfo/database：对应字段为空串，reenterFields 对空字段不填、走默认值
		expect(probe.urlToFieldsPatch('sqlserver://db9.example.com')).toEqual({
			host: 'db9.example.com', port: '', user: '', database: '',
		});
		// 非法/空 URL 返回 null，reenterFields 原样走官方默认值
		expect(probe.urlToFieldsPatch('not a url')).toBeNull();
		expect(probe.urlToFieldsPatch('')).toBeNull();
	});
});

/* ---------- 2. 传输页：源/目标下拉与层级 ---------- */

describe('2 传输页接线（TransferView 浅渲染）', () => {
	const conns = [
		{ id: 'ss1', kind: 'sqlserver', name: 'ss-prod' },
		{ id: 'sq1', kind: 'sqlite', name: 'local-file' },
		{ id: 'rd', kind: 'redis', name: 'rd-cache' },
	];
	const grants = [{ connId: 'ss1', mode: 'rw' }];

	function render(): El {
		reactStub.reset();
		return reactStub.render(TransferViewRef, {
			conns,
			grants,
			projectPath: 'E:/proj',
			visible: false, // 停轮询：避免 setInterval 泄漏
			askConfirm: () => Promise.resolve(false),
		});
	}
	const selects = (tree: El): El[] => collect(tree).filter((n) => n.type === 'select');
	/** 源栏连接下拉：label 为「连接」的第一个 select */
	function srcConnSelect(tree: El): El {
		const n = selects(tree).find((s) => flatText(s).includes('ss-prod'));
		if (!n) throw new Error('未找到含 sqlserver 连接的源连接下拉');
		return n;
	}

	it('源/目标下拉列出全部连接（redis 也出现在下拉，不再被排除）', () => {
		const tree = render();
		const all = selects(tree).map((s) => flatText(s)).join('|');
		expect(all).toContain('ss-prod (sqlserver · rw)');
		expect(all).toContain('local-file (sqlite)');
		expect(all).toContain('rd-cache (redis)'); // S4：redis 连接现在可作为源/目标
	});

	it('选中 sqlserver 源 → 出现「库 + 模式」两级；选中 sqlite 源 → 无库层（HAS_SCHEMAS / NO_DB_LEVEL 行为差异）', () => {
		const schemaLabel = probe.t('trxSchema'); // 「模式:」
		const hasSchemaSelect = (tree: El | El[]): boolean =>
			collect(tree).some((n) => n.type === 'select' && n.props['aria-label'] === schemaLabel);

		const tree = render();
		const before = selects(tree).length;
		expect(hasSchemaSelect(tree)).toBe(false); // 未选连接：无模式下拉

		srcConnSelect(tree).props.onChange({ target: { value: 'ss1' } });
		const afterSqlserver = selects(reactStub.render(TransferViewRef, {
			conns, grants, projectPath: 'E:/proj', visible: false, askConfirm: () => Promise.resolve(false),
		}));
		expect(hasSchemaSelect(afterSqlserver)).toBe(true); // HAS_SCHEMAS.sqlserver → 源栏出现模式下拉
		expect(afterSqlserver.length).toBe(before + 1);

		reactStub.reset();
		const tree2 = reactStub.render(TransferViewRef, {
			conns, grants, projectPath: 'E:/proj', visible: false, askConfirm: () => Promise.resolve(false),
		});
		const sqliteSelect = selects(tree2).find((s) => flatText(s).includes('local-file'));
		sqliteSelect!.props.onChange({ target: { value: 'sq1' } });
		const afterSqlite = selects(reactStub.render(TransferViewRef, {
			conns, grants, projectPath: 'E:/proj', visible: false, askConfirm: () => Promise.resolve(false),
		}));
		expect(hasSchemaSelect(afterSqlite)).toBe(false); // sqlite 无模式层
		expect(afterSqlite.length).toBe(before - 1); // NO_DB_LEVEL.sqlite：源栏库下拉降级为纯文本
	});
});

/* ---------- 3. 控制台事务与只读闸门的 kind 集合（静态接线） ---------- */

describe('3 控制台/浏览的 kind 集合接线（静态断言）', () => {
	it('CONSOLE_SQL_KINDS 把 sqlserver 算作支持事务会话的 kind，且该集合真的参与判定', () => {
		const m = /const CONSOLE_SQL_KINDS = \{([^}]*)\}/.exec(src);
		expect(m, '未找到 CONSOLE_SQL_KINDS 定义').not.toBeNull();
		expect(m![1]).toMatch(/sqlserver:\s*true/);
		expect(src).toContain('CONSOLE_SQL_KINDS[kind]'); // 判定处引用（client.js:2544/2610）
	});

	it('HAS_SCHEMAS（浏览/传输两级层级）对 sqlserver 为 true，sqlite 不在集合内', () => {
		const defs = src.match(/const HAS_SCHEMAS = \{[^}]*\}/g) ?? [];
		expect(defs.length).toBeGreaterThanOrEqual(2); // BrowsePane + TransferView 各一处
		for (const d of defs) expect(d).toMatch(/sqlserver:\s*true/);
		for (const d of defs) expect(d).not.toMatch(/sqlite:\s*true/);
	});

	it('NO_DB_LEVEL 含 sqlite/redis、不含 sqlserver（sqlserver 必须走库层，redis 无库层）', () => {
		const m = /const NO_DB_LEVEL = \{([^}]*)\}/.exec(src);
		expect(m, '未找到 NO_DB_LEVEL 定义').not.toBeNull();
		expect(m![1]).toMatch(/sqlite:\s*true/);
		expect(m![1]).toMatch(/redis:\s*true/); // S4：redis listTables 忽略 database，归到无库层
		expect(m![1]).not.toContain('sqlserver');
	});
});
