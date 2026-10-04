/**
 * 传输日志降级结构断言（离线，浅渲染元素树，照 console-view.spec.ts 先例）：
 * - 顶级标签只余五项（管理/授权/浏览/控制台/数据传输），「传输日志」不再是顶级标签；
 * - TransferView 内「传输历史」「传输日志」是同级子标签（dbt-tabs 分段控件，role=tab）；
 * - TransferLogView 常驻挂载（hidden 切换，切子标签不丢状态）；
 * - TransferLogView 无手动「刷新」按钮（只保留 5s 自动刷新与清除日志）；
 * - TransferLogView 的 props 只从 TransferView 原始入参接线（projectPath/visible/askConfirm），
 *   visible=顶级激活且当前在日志子标签，不得混入 TransferView 本地遮蔽的 busy/error（传输任务自己的状态）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let mod: any; // client.js factory 产物
let T: any; // exports.__testables

/* ---------- stub 基建（console-view.spec.ts 同款最小 React stub） ---------- */

type El = { type: any; props: any; children: any[] };

let fetchCalls: string[] = [];
function stubFetch(url: string) {
	fetchCalls.push(url);
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data: {} })) });
}

const reactStub = (() => {
	const slots = new Map<string, any>();
	let hookIdx = 0;
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
		// useEffect 只登记不执行：浅渲染不触副作用（轮询 interval 不建立，树结构与激活态一致）
		useEffect() { hookIdx++; },
		useLayoutEffect() { hookIdx++; },
	};
	return {
		React: R,
		render(comp: (props: any) => any, props: any): El {
			hookIdx = 0;
			return comp(props);
		},
		reset() {
			slots.clear();
			hookIdx = 0;
		},
	};
})();

function flatText(n: any): string {
	if (n === null || n === undefined || n === false || n === true) return '';
	if (Array.isArray(n)) return n.map(flatText).join('');
	if (typeof n !== 'object') return String(n);
	const kids = Array.isArray(n.children) ? n.children : [n.children];
	return kids.map(flatText).join('');
}

/* ---------- 装载 ---------- */

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
			if (name === 'react') return reactStub.React;
			throw new Error('未预期的依赖: ' + name);
		});
		T = mod.__testables;
		if (!T) throw new Error('client.js 未导出 __testables');
	});

/* ---------- 顶级标签 ---------- */

describe('顶级标签', () => {
	it('标签条只余五项，不含「传输日志」', () => {
		reactStub.reset();
		fetchCalls = [];
		const tree = reactStub.render(T.Panel, { visible: true, scope: { cwd: 'E:/proj', sessionId: 's1' }, ctx: {} });
		const tabs = (function walk(n: any, out: El[] = []): El[] {
			if (Array.isArray(n)) { n.forEach((x) => walk(x, out)); return out; }
			if (!n || typeof n !== 'object' || !n.type) return out;
			if (n.type === 'button' && n.props.role === 'tab') out.push(n);
			const kids = Array.isArray(n.children) ? n.children : [n.children];
			for (const k of kids) walk(k, out);
			return out;
		})(tree);
		expect(tabs.map((b) => flatText(b).trim())).toEqual(['连接管理', '项目授权', '数据浏览', 'SQL 控制台', '数据传输']);
		// 常驻视图容器列表同步收窄：不再有第六个 hidden 视图壳
		const viewShells = (function walk(n: any, out: El[] = []): El[] {
			if (Array.isArray(n)) { n.forEach((x) => walk(x, out)); return out; }
			if (!n || typeof n !== 'object' || !n.type) return out;
			if (n.type === 'div' && String(n.props.className || '').includes('dbt-view')) out.push(n);
			const kids = Array.isArray(n.children) ? n.children : [n.children];
			for (const k of kids) walk(k, out);
			return out;
		})(tree);
		expect(viewShells.length).toBe(5);
	});
});

/* ---------- TransferView 内部降级结构 ---------- */

describe('TransferView 内的传输日志区块', () => {
	const askConfirm = () => Promise.resolve(false);

	it('「传输历史」「传输日志」是同级子标签，TransferLogView 常驻挂载', () => {
		reactStub.reset();
		fetchCalls = [];
		const tree = reactStub.render(T.TransferView, {
			conns: [], grants: [], projectPath: 'E:/proj', visible: false, askConfirm, // visible=false 免挂轮询 interval，树结构与激活态一致
		});
		expect(tree.type).toBe('div');
		expect(String(tree.props.className)).toContain('dbt-card');
		// TransferView 树内 role=tab 按钮只有子标签条的两个（顶级标签条在 Panel，不在本树）
		const tabs = (function walk(n: any, out: El[] = []): El[] {
			if (Array.isArray(n)) { n.forEach((x) => walk(x, out)); return out; }
			if (!n || typeof n !== 'object' || !n.type) return out;
			if (n.type === 'button' && n.props.role === 'tab') out.push(n);
			const kids = Array.isArray(n.children) ? n.children : [n.children];
			for (const k of kids) walk(k, out);
			return out;
		})(tree);
		expect(tabs.map((b) => flatText(b).trim())).toEqual(['传输历史', '传输日志']);
		// TransferLogView 常驻挂载（hidden 切换而非条件渲染，切子标签不丢状态）
		const logEl = (function walk(n: any): El | null {
			if (Array.isArray(n)) { for (const x of n) { const r = walk(x); if (r) return r; } return null; }
			if (!n || typeof n !== 'object' || !n.type) return null;
			if (n.type === T.TransferLogView) return n;
			const kids = Array.isArray(n.children) ? n.children : [n.children];
			for (const k of kids) { const r = walk(k); if (r) return r; }
			return null;
		})(tree);
		expect(logEl).toBeTruthy(); // 组件引用比对，非恒真
	});

	it('TransferLogView 无手动「刷新」按钮（只留自动刷新与清除日志）', () => {
		reactStub.reset();
		fetchCalls = [];
		const tree = reactStub.render(T.TransferLogView, { projectPath: 'E:/proj', visible: false, askConfirm });
		const buttons = (function walk(n: any, out: El[] = []): El[] {
			if (Array.isArray(n)) { n.forEach((x) => walk(x, out)); return out; }
			if (!n || typeof n !== 'object' || !n.type) return out;
			if (n.type === 'button') out.push(n);
			const kids = Array.isArray(n.children) ? n.children : [n.children];
			for (const k of kids) walk(k, out);
			return out;
		})(tree);
		const labels = buttons.map((b) => flatText(b).trim());
		expect(labels).not.toContain('刷新'); // 手动刷新已移除
		expect(labels).toContain('清除日志');
	});

	it('props 只从 TransferView 原始入参接线，不混入本地遮蔽的 busy/error', () => {
		reactStub.reset();
		fetchCalls = [];
		const findLog = (n: any): El | null => {
			if (Array.isArray(n)) { for (const x of n) { const r = findLog(x); if (r) return r; } return null; }
			if (!n || typeof n !== 'object' || !n.type) return null;
			if (n.type === T.TransferLogView) return n;
			const kids = Array.isArray(n.children) ? n.children : [n.children];
			for (const k of kids) { const r = findLog(k); if (r) return r; }
			return null;
		};
		const logEl = findLog(reactStub.render(T.TransferView, {
			conns: [], grants: [], projectPath: 'E:/proj', visible: false, askConfirm,
		}));
		expect(logEl).toBeTruthy();
		expect(logEl!.props.projectPath).toBe('E:/proj');
		expect(logEl!.props.visible).toBe(false); // 顶级未激活：false && (subTab==="tlog") 为 false
		expect(logEl!.props.askConfirm).toBe(askConfirm);
		expect(logEl!.props).not.toHaveProperty('busy'); // TransferView 本地 busy 是布尔传输任务态，串台即 bug
		expect(logEl!.props).not.toHaveProperty('error'); // TransferLogView 自管错误展示（内部自己的 error state）
		// visible=true 但默认子标签是「传输历史」：锁定 && subTab==="tlog" 因子（漏掉该条件时此处会变 true）
		reactStub.reset();
		const logElActive = findLog(reactStub.render(T.TransferView, {
			conns: [], grants: [], projectPath: 'E:/proj', visible: true, askConfirm,
		}));
		expect(logElActive!.props.visible).toBe(false);
	});
});
