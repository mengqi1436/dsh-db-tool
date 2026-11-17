/**
 * 插件版本徽标行为（离线，stub React 执行副作用 + fetch 桩，渲染真实 Panel）：
 *  1) 面板可见时拉取 GET /api/version，徽标显示版本号；
 *  2) 版本号在每次面板转为可见时重新拉取：插件在宿主里更新后，切回面板即见新版本，无需整页刷新；
 *  3) 拉取失败静默保留现值（首拉失败不显示徽标），不污染面板错误条。
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React（与 conn-cards.spec.ts 同款，useEffect 执行副作用） ---------- */

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
		pendingEffects: () => effects,
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
/** 微任务排空：fetch 桩的 promise 链全部落地 */
async function flushAsync(): Promise<void> {
	for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

/* ---------- fetch 桩：按 URL 定制响应 ---------- */

const fetchCalls: string[] = [];
let versionResponder: (() => any) | null = null; // null = 默认 9.9.9
const stubbedFetch = (url: any) => {
	const u = String(url);
	fetchCalls.push(u);
	let data: any = { ok: true, data: {} };
	if (u.includes('/version')) data = versionResponder ? versionResponder() : { ok: true, data: { version: '9.9.9' } };
	else if (u.includes('/connections') || u.includes('/grants')) data = { ok: true, data: [] };
	else if (u.includes('/project-context')) data = { ok: true, data: { hasProject: false } };
	if (data === null) return Promise.reject(new Error('network down')); // 模拟网络失败
	return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(data)) });
};
const versionCalls = () => fetchCalls.filter((u) => u.includes('/version'));
function badgeText(tree: El): string | null {
	const b = collect(tree).find((e) => typeof e.props.className === 'string' && e.props.className.split(/\s+/).includes('dbt-ver'));
	return b ? flatText(b) : null;
}
/** 渲染 + 排空本次注册的副作用（stub 只登记不执行，这里手动驱动），再重渲染取更新后的元素树 */
async function drive(p: any, initial = false): Promise<El> {
	initial ? reactStub.render(T.Panel, p) : reactStub.rerender(T.Panel, p);
	for (let i = 0; i < 10 && reactStub.pendingEffects().length; i++) {
		for (const e of reactStub.pendingEffects().splice(0)) {
			try { e.fn(); } catch { /* 个别副作用在 stub 下无宿主环境，忽略 */ }
		}
		await new Promise((r) => setTimeout(r, 0));
	}
	await flushAsync();
	return reactStub.rerender(T.Panel, p); // 状态已更新，重取快照
}

/* ---------- 测试宿主装载 ---------- */

let T: any;

beforeAll(() => {
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, stubbedFetch);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T || typeof T.Panel !== 'function') throw new Error('client.js 未导出 __testables.Panel');
});

afterEach(() => {
	versionResponder = null;
});

const props = (visible: boolean) => ({ visible, scope: { sessionId: 's1', cwd: 'E:/proj' }, ctx: {} });

describe('插件版本徽标', () => {
	it('面板可见时拉取 /api/version，徽标显示版本号', async () => {
		fetchCalls.length = 0;
		const tree = await drive(props(true), true);
		expect(versionCalls().length).toBe(1);
		expect(badgeText(tree)).toBe('v9.9.9');
	});

	it('面板隐藏→再可见会重新拉取版本号（插件更新后切回即见新版本，无需整页刷新）', async () => {
		fetchCalls.length = 0;
		await drive(props(true), true);
		expect(versionCalls().length).toBe(1);
		// 隐藏：早退不拉取
		await drive(props(false));
		expect(versionCalls().length).toBe(1);
		// 再可见：重新拉取，徽标更新为新版本
		versionResponder = () => ({ ok: true, data: { version: '10.0.0' } });
		const tree = await drive(props(true));
		expect(versionCalls().length).toBe(2);
		expect(badgeText(tree)).toBe('v10.0.0');
	});

	it('拉取失败静默保留现值：徽标不变、错误条不受污染', async () => {
		fetchCalls.length = 0;
		await drive(props(true), true);
		expect(badgeText(await drive(props(true)))).toBe('v9.9.9');
		versionResponder = () => null; // 网络失败
		const tree = await drive(props(false));
		const after = await drive(props(true));
		expect(versionCalls().length).toBe(2);
		expect(badgeText(after)).toBe('v9.9.9'); // 保留现值
		expect(badgeText(tree)).toBe(badgeText(after));
		const alerts = collect(after).filter((e) => e.props.role === 'alert');
		expect(alerts.length).toBe(0); // 不弹错误
	});
});
