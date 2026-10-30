/**
 * 官方右侧栏注册契约断言（离线，照 console-view.spec.ts 先例）：
 * - exports.inject 恰为 slots / sidebarRightTabs / locale 三项；
 * - 阶段一 sidebarRightTabs.register 的类型定义：id 与 kind 同为 dsh-db-tool、
 *   keepMounted=true（不声明则切标签/切会话/收起右栏会卸载正文丢状态）、
 *   priority=extension、guide 单条 order 45、且为页类型（无 patterns、无 multiple）；
 * - 阶段二两个席位 key 必须等于类型 id 而非 kind（官方允许 extension 接管 builtin 的 kind，
 *   按 id 派发才不串位），这是本项目最易写错处；
 * - 全部注册可随 ctx.effect disposer 撤销；
 * - 源码不得再出现第三方侧边栏 dsh-better-sidebar 的旧痕迹。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let mod: any; // client.js factory 产物
let src: string; // 源码原文（断言旧名词已清理）

/* ---------- 最小 React stub ---------- */

const reactStub = (() => {
	const R: any = {
		createElement(type: any, props: any, ...kids: any[]) {
			return { type, props: props || {}, children: kids };
		},
		Fragment: 'Fragment',
		useState(init: any) { return [typeof init === 'function' ? init() : init, () => {}]; },
		useRef(init: any) { return { current: init }; },
		useCallback(fn: any) { return fn; },
		useMemo(fn: any) { return fn(); },
		useEffect() {},
		useLayoutEffect() {},
		useSyncExternalStore(_sub: any, get: any) { return get(); },
	};
	return R;
})();

/* ---------- 记录器式 ctx 桩 ---------- */

type Seat = { name: string; key: string; comp: any };

function makeCtx() {
	const state = {
		types: [] as any[],
		seats: [] as Seat[],
		effectLabels: [] as string[],
		disposers: [] as Array<() => void>,
		localeRegisterCalls: [] as Array<[string, string, any]>,
	};
	const ctx: any = {
		locale: {
			register(ns: string, lang: string, dict: any) {
				state.localeRegisterCalls.push([ns, lang, dict]);
				return () => {};
			},
			subscribe() { return () => {}; },
			getSnapshot() { return { active: 'zh' }; },
		},
		effect(fn: () => any, label: string) {
			state.effectLabels.push(label);
			const dispose = fn();
			if (typeof dispose === 'function') state.disposers.push(dispose);
			return () => {};
		},
		sidebarRightTabs: {
			register(def: any) {
				state.types.push(def);
				return () => {
					const i = state.types.indexOf(def);
					if (i >= 0) state.types.splice(i, 1);
				};
			},
		},
		slots: {
			inject(_name: string, cb: () => any) {
				const dispose = cb();
				return typeof dispose === 'function' ? dispose : () => {};
			},
			register(entry: any, comp: any) {
				const seat: Seat = { name: entry.name, key: entry.key, comp };
				state.seats.push(seat);
				return () => {
					const i = state.seats.indexOf(seat);
					if (i >= 0) state.seats.splice(i, 1);
				};
			},
		},
	};
	return { ctx, state };
}

/* ---------- 测试宿主装载 ---------- */

beforeAll(() => {
	// apply() 里 ensureStyles() 会建 <style>，此处只需最小 document
	const stubEl: any = { textContent: '', style: {}, setAttribute() {}, appendChild() {} };
	(globalThis as any).document = {
		createElement: () => Object.assign({}, stubEl),
		head: { appendChild() {} },
		body: { appendChild() {} },
		documentElement: { appendChild() {} },
	};
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) { fakeWindow.__DEF__ = def; },
		},
	};
	src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, () => Promise.resolve({ ok: true, text: () => Promise.resolve('{}') }));
	mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub;
		throw new Error('未预期的依赖: ' + name);
	});
});

describe('官方右侧栏注册契约', () => {
	it('exports.inject 恰为 slots / sidebarRightTabs / locale', () => {
		expect(mod.inject).toEqual(['slots', 'sidebarRightTabs', 'locale']);
	});

	it('阶段一：类型定义 id 与 kind 同为 dsh-db-tool', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		expect(state.types).toHaveLength(1);
		expect(state.types[0].id).toBe('dsh-db-tool');
		expect(state.types[0].kind).toBe('dsh-db-tool');
	});

	it('阶段一：keepMounted 为 true（否则切标签/切会话/收起右栏会丢面板状态）', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		expect(state.types[0].keepMounted).toBe(true);
	});

	it('阶段一：priority 为 extension', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		expect(state.types[0].priority).toBe('extension');
	});

	it('阶段一：是页类型 —— 无 patterns、无 multiple', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		expect(state.types[0].patterns).toBeUndefined();
		expect(state.types[0].multiple).toBeUndefined();
	});

	it('阶段一：guide 单条 order 45，title/description 为可现读文案，icon 为组件', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		const guide = state.types[0].guide;
		expect(guide).toHaveLength(1);
		expect(guide[0].id).toBe('dsh-db-tool');
		expect(guide[0].order).toBe(45);
		expect(typeof guide[0].title).toBe('function');
		expect(typeof guide[0].description).toBe('function');
		// 文案走 thunk：每次调用现读，语言切换无需重注册
		expect(guide[0].title()).toBe('数据库');
		expect(guide[0].description().length).toBeGreaterThan(0);
		expect(typeof guide[0].icon).toBe('function');
	});

	it('阶段二：两个席位 key 均等于类型 id（不是 kind）', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		expect(state.seats).toHaveLength(2);
		const bodySeat = state.seats.find((s) => s.name === 'sidebar.right.pane.tab');
		const titleSeat = state.seats.find((s) => s.name === 'sidebar.right.pane.tab.title');
		expect(bodySeat).toBeTruthy();
		expect(titleSeat).toBeTruthy();
		// key 必须等于类型 id（不是 kind）：官方允许 extension 接管 builtin 的 kind，按 id 派发才不串位
		expect(bodySeat!.key).toBe('dsh-db-tool');
		expect(titleSeat!.key).toBe('dsh-db-tool');
		expect(typeof bodySeat!.comp).toBe('function');
		expect(typeof titleSeat!.comp).toBe('function');
	});

	it('阶段二：正文可渲染，visible 取 tab.visible、cwd 取 useSessions', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		const body = state.seats.find((s) => s.name === 'sidebar.right.pane.tab')!.comp;
		const el = body({
			sessionId: 's1',
			useTabInfo: () => ({
				sidebar: { expanded: true, fullscreen: false },
				panel: { id: 'p1' },
				tab: { visible: true, id: 't1', kind: 'dsh-db-tool' },
			}),
			useSessions: (sel: any) => sel({ byId: { s1: { cwd: 'D:/demo' } } }),
		});
		expect(el).toBeTruthy();
		expect(el.props.visible).toBe(true);
		expect(el.props.scope).toEqual({ sessionId: 's1', cwd: 'D:/demo' });
	});

	it('注册全部随 ctx.effect disposer 撤销', () => {
		const { ctx, state } = makeCtx();
		mod.apply(ctx);
		expect(state.types).toHaveLength(1);
		expect(state.seats).toHaveLength(2);
		for (const dispose of state.disposers) dispose();
		expect(state.types).toHaveLength(0);
		expect(state.seats).toHaveLength(0);
	});

	it('服务缺失时 warn 且不抛错、不注册', () => {
		const warn = console.warn;
		const calls: any[] = [];
		console.warn = (...args: any[]) => { calls.push(args); };
		try {
			const ctx: any = {
				locale: { register: () => () => {}, subscribe: () => () => {}, getSnapshot: () => ({ active: 'zh' }) },
				effect(fn: () => any) { return fn(); },
			};
			expect(() => mod.apply(ctx)).not.toThrow();
			expect(calls.length).toBe(1);
			expect(String(calls[0][0])).toContain('sidebarRightTabs');
		} finally {
			console.warn = warn;
		}
	});

	it('源码不再出现第三方侧边栏 dsh-better-sidebar 的痕迹', () => {
		expect(src.includes('betterSidebar')).toBe(false);
		expect(src.includes('better-sidebar')).toBe(false);
	});

	it('文案 thunk 现读语言：切 en 返回英文，切回 zh 返回中文（不依赖重挂载）', () => {
		let active = 'zh';
		const { ctx, state } = makeCtx();
		ctx.locale.getSnapshot = () => ({ active });
		mod.apply(ctx);
		const def = state.types[0];
		expect(def.title()).toBe('数据库');
		active = 'en';
		expect(def.title()).toBe('Databases');
		active = 'zh';
		expect(def.title()).toBe('数据库');
	});

	it('重新 apply 时 locale 快照暂缺 active，不得把已切好的语言打回默认', () => {
		let active = 'en';
		const first = makeCtx();
		first.ctx.locale.getSnapshot = () => ({ active });
		mod.apply(first.ctx);
		const firstTitle = first.state.types[0].title;
		expect(firstTitle()).toBe('Databases');

		// 模拟插件重载：新 ctx 的 locale 服务尚未报告 active
		const second = makeCtx();
		second.ctx.locale.getSnapshot = () => ({});
		mod.apply(second.ctx);
		expect(firstTitle()).toBe('Databases');
	});
});
