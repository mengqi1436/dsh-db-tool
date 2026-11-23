/**
 * 「数据浏览 → 对话」@db: 表引用与 @col: 字段引用的离线测试（stub React 多轮渲染 + 脚本化 fetch + 记录器式宿主桩）。
 *
 * 覆盖：
 *  1) 记号编解码纯函数：buildDbMention 三段（连接/库/表）与四段（含模式）形态、段内空白与
 *     '/' 的 %XX 转义、parseDbMention 还原（database 归并 "库.模式"）与非法形态 invalid 标记；
 *  2) DB_MENTION_RULE 识别契约：词法边界（(?<!\S)）、from 偏移、尾标点剥离、裸 @db: 跳过、
 *     非 @db: 的 @ token 不捕获（留给宿主文件规则）；order 25 早于宿主文件/目录规则（30），
 *     同起点命中时低序规则胜出——@db: 记号由本插件渲染，不再落成指向不存在文件的文件 chip；
 *  3) DbTableChip 渲染：chip 展示表名 + 全文 title，无任何点击行为；
 *  4) insertDbMention 宿主链路：sessions.scope → conversation.input.for → actions.insertText
 *     （token + 空格）→ focus；链路缺失返回 "unsupported"，输入框拒插返回 "busy" 且不聚焦；
 *  5) BrowsePane 集成：选中表后面包屑出现「@添加到对话」按钮，点击后宿主通道收到
 *     "@db:c1/mydb/t1 "；无按钮时不渲染；
 *  6) apply() 注册：有 uiConversation 时注册 db-table 规则与 conversation.user.text.node 席位，
 *     无 uiConversation 时不注册（旧宿主降级）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

type El = { type: any; props: any; children: any[] };

/* ---------- stub React：槽位持久 + effect 渲染后执行 + 可重复渲染（对齐既有 client 规格 harness） ---------- */

const reactStub = (() => {
	const slots = new Map<string, any>();
	let hookIdx = 0;
	let pending: { dk: string; fn: any; deps?: any[] }[] = [];
	const R: any = {
		createElement(type: any, props: any, ...kids: any[]) {
			return { type, props: props || {}, children: kids };
		},
		isValidElement(el: any) { return !!el && typeof el === 'object' && el.type !== undefined; },
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
			// 必须返回对象本体（真实 React 语义）：BrowsePane 的 openSeq.current 是数字守卫，
			// 包装成数组会让 .current 变 undefined，seq 守卫永假、busy 永挂骨架
			return slots.get(key);
		},
		useCallback(fn: any) {
			const i = hookIdx++;
			void i;
			return fn;
		},
		useMemo(fn: any) {
			hookIdx++;
			return fn();
		},
		useEffect(fn: any, deps?: any[]) {
			const i = hookIdx++;
			pending.push({ dk: 'd' + i, fn, deps });
		},
		useLayoutEffect(fn: any, deps?: any[]) {
			const i = hookIdx++;
			pending.push({ dk: 'l' + i, fn, deps });
		},
		useSyncExternalStore(sub: any, get: any) {
			hookIdx++;
			if (typeof sub === 'function') sub(() => {});
			return get();
		},
	};
	return {
		React: R,
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
		/** 当前 hook 计数（嵌套渲染前取基准，后续每次嵌套渲染从同一基准续号，槽位才跨轮稳定） */
		mark(): number {
			return hookIdx;
		},
		/** 渲染但不重置 hook 计数（可传 base 回到基准）：嵌套渲染子组件时槽位不与父组件冲突且跨轮稳定 */
		renderNested(comp: (props: any) => any, props: any, base?: number): El {
			if (base !== undefined) hookIdx = base;
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

let T: any;
let mod: any;
let fetchImpl: (url: string) => Promise<any> = () => Promise.resolve({ ok: true, text: () => Promise.resolve('') });

beforeAll(() => {
	// apply() 里 ensureStyles() 会建 <style>，此处只需最小 document（对齐 sidebar-registration.spec）
	const stubEl: any = { textContent: '', style: {}, setAttribute() {}, appendChild() {} };
	(globalThis as any).document = {
		createElement: () => Object.assign({}, stubEl),
		head: { appendChild() {} },
		body: { appendChild() {} },
		documentElement: { appendChild() {} },
	};
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', 'fetch', src)(fakeWindow, console, (url: string) => fetchImpl(url));
	mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub.React;
		if (name === '../vendor/codemirror-sql.cjs') return { createConsoleEditor: () => ({ destroy: () => {}, setSchema: () => {}, view: {} }) };
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T || typeof T.buildDbMention !== 'function') throw new Error('client.js 未导出 __testables.buildDbMention');
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- 纯函数：编解码 ---------- */

describe('@db: 表引用记号编解码', () => {
	it('三段形态（连接/库/表）', () => {
		expect(T.buildDbMention('c1', 'mydb', null, 'users')).toBe('@db:c1/mydb/users');
		const parsed = T.parseDbMention('@db:c1/mydb/users');
		expect(parsed).toMatchObject({ connId: 'c1', database: 'mydb', schemaName: null, table: 'users', label: 'users', invalid: false });
	});

	it('四段形态（含模式）：database 归并为 "库.模式"，与 query/preview 的 database 参数一致', () => {
		expect(T.buildDbMention('c2', 'mydb', 'public', 'orders')).toBe('@db:c2/mydb/public/orders');
		const parsed = T.parseDbMention('@db:c2/mydb/public/orders');
		expect(parsed).toMatchObject({ connId: 'c2', database: 'mydb.public', schemaName: 'public', table: 'orders', label: 'orders', invalid: false });
	});

	it('段内空白与 / 转义为 %XX，解析时还原（round-trip）', () => {
		const token = T.buildDbMention('c1', 'my db', null, 'a/b table');
		expect(token).toBe('@db:c1/my%20db/a%2Fb%20table');
		const parsed = T.parseDbMention(token);
		expect(parsed).toMatchObject({ connId: 'c1', database: 'my db', schemaName: null, table: 'a/b table', label: 'a/b table', invalid: false });
	});

	it('非法 % 序列原样保留（不抛错）', () => {
		const parsed = T.parseDbMention('@db:c1/my%zzdb/users');
		expect(parsed).toMatchObject({ connId: 'c1', database: 'my%zzdb', table: 'users', invalid: false });
	});

	it('非法形态（段数不符/空段）标记 invalid，只保留原文', () => {
		expect(T.parseDbMention('@db:c1/users').invalid).toBe(true);
		expect(T.parseDbMention('@db:c1/mydb/a/b/c').invalid).toBe(true);
		const emptySeg = T.parseDbMention('@db:c1//users');
		expect(emptySeg.invalid).toBe(true);
		expect(emptySeg.label).toBe('c1//users');
	});

	it('@col: 四段形态（连接/库/表/列）', () => {
		expect(T.buildDbColMention('c1', 'mydb', null, 'orders', 'user_id')).toBe('@col:c1/mydb/orders/user_id');
		const parsed = T.parseDbColMention('@col:c1/mydb/orders/user_id');
		expect(parsed).toMatchObject({ connId: 'c1', database: 'mydb', schemaName: null, table: 'orders', column: 'user_id', label: 'orders.user_id', invalid: false });
	});

	it('@col: 五段形态（含模式）+ 列名转义 round-trip', () => {
		expect(T.buildDbColMention('c2', 'mydb', 'public', 'orders', 'a/b col')).toBe('@col:c2/mydb/public/orders/a%2Fb%20col');
		const parsed = T.parseDbColMention('@col:c2/mydb/public/orders/a%2Fb%20col');
		expect(parsed).toMatchObject({ connId: 'c2', database: 'mydb.public', schemaName: 'public', table: 'orders', column: 'a/b col', label: 'orders.a/b col', invalid: false });
	});

	it('@col: 非法形态标记 invalid，只保留原文', () => {
		expect(T.parseDbColMention('@col:c1/mydb/orders').invalid).toBe(true);
		expect(T.parseDbColMention('@col:c1//orders/x').invalid).toBe(true);
	});
});

/* ---------- 识别规则 ---------- */

/** 宿主文件/目录引用规则的词法镜像（ui-reference user-text-rules nextPath，folder=false 分支） */
function fileRuleMirror(text: string, from: number) {
	const tokens = /(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu;
	tokens.lastIndex = from;
	for (let match = tokens.exec(text); match !== null; match = tokens.exec(text)) {
		const token = match[0];
		const raw = token.startsWith('@"') ? token : token.replace(/[.,;:!?，。；：！？]+$/u, '');
		if (raw.length <= 1) continue;
		const path = raw.slice(1).replace(/^"|"$/gu, '');
		if (path.endsWith('/')) continue;
		return { start: match.index, end: match.index + raw.length };
	}
	return undefined;
}

describe('DB_MENTION_RULE 识别契约', () => {
	it('命中 @db: token，偏移与数据正确；from 偏移跳过更早命中', () => {
		const text = '看 @db:c1/mydb/users 和后续';
		const hit = T.DB_MENTION_RULE.match(text, 0);
		expect(hit).toBeTruthy();
		expect(hit.id).toBe('db-table');
		expect(text.slice(hit.start, hit.end)).toBe('@db:c1/mydb/users');
		expect(hit.data.table).toBe('users');
		const later = T.DB_MENTION_RULE.match(text, hit.end);
		expect(later).toBeUndefined();
	});

	it('多命中时 from 语义：第二个 @db: token 可达', () => {
		const text = '@db:c1/a/t1 @db:c1/b/t2';
		const first = T.DB_MENTION_RULE.match(text, 0);
		const second = T.DB_MENTION_RULE.match(text, first.end);
		expect(text.slice(second.start, second.end)).toBe('@db:c1/b/t2');
	});

	it('尾标点剥离出 token（句号留在正文）', () => {
		const text = '表是 @db:c1/mydb/users.';
		const hit = T.DB_MENTION_RULE.match(text, 0);
		expect(text.slice(hit.start, hit.end)).toBe('@db:c1/mydb/users');
	});

	it('裸 @db: 与非 @db: 的 @ token 不捕获（裸 token 留给宿主规则，普通文件引用不受影响）', () => {
		expect(T.DB_MENTION_RULE.match('裸 @db: 不是引用', 0)).toBeUndefined();
		expect(T.DB_MENTION_RULE.match('文件 @README.md 在根目录', 0)).toBeUndefined();
	});

	it('词法边界：@ 前紧贴非空白字符（邮箱形态）不命中', () => {
		expect(T.DB_MENTION_RULE.match('邮箱 a@db:c1/mydb/users', 0)).toBeUndefined();
	});

	it('@col: 命中分流为 db-column 节点，label 为 表.列；裸 @col: 不捕获', () => {
		const text = '列 @col:c1/mydb/orders/user_id 是外键';
		const hit = T.DB_MENTION_RULE.match(text, 0)!;
		expect(hit.id).toBe('db-column');
		expect(text.slice(hit.start, hit.end)).toBe('@col:c1/mydb/orders/user_id');
		expect(hit.data).toMatchObject({ connId: 'c1', database: 'mydb', schemaName: null, table: 'orders', column: 'user_id', label: 'orders.user_id', invalid: false });
		expect(T.DB_MENTION_RULE.match('裸 @col: 不是引用', 0)).toBeUndefined();
	});

	it('@col: 混合 @db: 文本各自命中；@db: 五段不会被当列引用', () => {
		const text = '@db:c1/a/t1 与 @col:c1/a/t1/user_id';
		const first = T.DB_MENTION_RULE.match(text, 0)!;
		expect(first.id).toBe('db-table');
		const second = T.DB_MENTION_RULE.match(text, first.end)!;
		expect(second.id).toBe('db-column');
		expect(T.parseDbMention('@db:c1/a/t1/extra/deeper').invalid).toBe(true); // 五段超出表记号语法
		expect(T.parseDbColMention('@col:c1/a/t1').invalid).toBe(true); // 列记号必须有列段
	});

	it('order 25 早于宿主文件/目录规则（30），同起点命中时低序规则胜出', () => {
		// 规则序：宿主按 order 升序遍历，winner 取「更早 start」，平局保留先遍历者
		expect(T.DB_MENTION_RULE.order).toBeLessThan(30);
		const text = '读 @db:c1/mydb/users 这张表';
		const ours = T.DB_MENTION_RULE.match(text, 0)!;
		const file = fileRuleMirror(text, 0)!;
		expect(file.start).toBe(ours.start); // 宿主规则本会捕获同一 token
		const winner = [ours, file].sort((a, b) => a.start - b.start)[0];
		expect(winner).toBe(ours); // 低序先遍历 → 平局保留本插件命中
	});
});

/* ---------- chip 渲染 ---------- */

describe('DbTableChip 渲染', () => {
	it('展示表名 + @db: 前缀，title 为原文，无点击行为', () => {
		const el = reactStub.render(T.DbTableChip, {
			node: { id: 'db-table', start: 0, end: 18, data: T.parseDbMention('@db:c1/mydb/users') },
			raw: '@db:c1/mydb/users',
		});
		expect(el.props.className).toBe('dbt-mention-chip');
		expect(el.props.title).toBe('@db:c1/mydb/users');
		expect(flatText(el)).toBe('@db:users');
		expect(el.props.onClick).toBeUndefined();
	});

	it('非法形态 chip 展示原文主体（不臆测结构）', () => {
		const el = reactStub.render(T.DbTableChip, {
			node: { id: 'db-table', start: 0, end: 11, data: T.parseDbMention('@db:c1/users') },
			raw: '@db:c1/users',
		});
		expect(flatText(el)).toBe('@db:c1/users');
	});

	it('@col: chip 展示 表.列 + @col: 前缀，title 为原文，无点击行为', () => {
		const el = reactStub.render(T.DbColumnChip, {
			node: { id: 'db-column', start: 0, end: 26, data: T.parseDbColMention('@col:c1/mydb/orders/user_id') },
			raw: '@col:c1/mydb/orders/user_id',
		});
		expect(el.props.className).toBe('dbt-mention-chip');
		expect(el.props.title).toBe('@col:c1/mydb/orders/user_id');
		expect(flatText(el)).toBe('@col:orders.user_id');
		expect(el.props.onClick).toBeUndefined();
	});
});

/* ---------- 宿主链路：插入会话输入框 ---------- */

/** 记录器式宿主桩：sessions.scope → conversation.input.for → actions.insertText / focus */
function makeHostCtx(sessionId: string, opts?: { accept?: boolean }) {
	const calls: Array<{ text: string; focused: boolean }> = [];
	const ctx: any = {
		get(name: string) {
			if (name !== 'sessions') return undefined;
			return {
				scope(id: string) {
					if (id !== sessionId) return undefined;
					const sctx: any = {};
					sctx.conversation = {
						input: {
							for(_c: any) {
								return {
									actions: {
										captureInsertion: () => ({ start: 0, end: 0, draftRev: 7 }),
										insertText: (text: string) => {
											calls.push({ text, focused: false });
											return opts?.accept === false ? false : true;
										},
									},
									focus: () => {
										if (calls.length) calls[calls.length - 1]!.focused = true;
									},
								};
							},
						},
					};
					return sctx;
				},
			};
		},
	};
	return { ctx, calls };
}

describe('insertDbMention 宿主链路', () => {
	it('成功路径：插入 "token + 空格" 并聚焦输入框', () => {
		const { ctx, calls } = makeHostCtx('s1');
		expect(T.insertDbMention(ctx, 's1', '@db:c1/mydb/users')).toBe('inserted');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.text).toBe('@db:c1/mydb/users ');
		expect(calls[0]!.focused).toBe(true);
	});

	it('会话不匹配（scope undefined）→ unsupported，不触碰输入框', () => {
		const { ctx, calls } = makeHostCtx('s1');
		expect(T.insertDbMention(ctx, 's-other', '@db:c1/mydb/users')).toBe('unsupported');
		expect(calls).toHaveLength(0);
	});

	it('宿主无 sessions 服务 → unsupported', () => {
		expect(T.insertDbMention({ get: () => undefined }, 's1', '@db:c1/mydb/users')).toBe('unsupported');
		expect(T.insertDbMention(undefined, 's1', '@db:c1/mydb/users')).toBe('unsupported');
	});

	it('输入框提交中拒插（insertText=false）→ busy，且不聚焦', () => {
		const { ctx, calls } = makeHostCtx('s1', { accept: false });
		expect(T.insertDbMention(ctx, 's1', '@db:c1/mydb/users')).toBe('busy');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.focused).toBe(false);
	});

	it('宿主链路抛错（conversation/input 缺失等）→ unsupported 而非冒泡', () => {
		const ctx: any = {
			get: () => ({
				scope: () => ({ conversation: { input: { for: () => { throw new Error('requires a retained Session scope'); } } } }),
			}),
		};
		expect(T.insertDbMention(ctx, 's1', '@db:c1/mydb/users')).toBe('unsupported');
	});
});

/* ---------- BrowsePane 集成：面包屑 @ 按钮 ---------- */

describe('BrowsePane 面包屑 @添加到对话', () => {
	async function selectTable(conn: any, table: any, schema?: any[]) {
		const byUrl = new Map<string, unknown>([
			['databases', ['mydb']],
			['schemas', ['public']],
			['tables', [table]],
			['schema', schema && schema.length ? schema : [{ name: 'id', dataType: 'int', nullable: false }]],
		]);
		fetchImpl = (async (url: string) => {
			const path = String(url);
			let data: unknown = [];
			if (path.includes('/databases')) data = byUrl.get('databases');
			else if (path.includes('/schemas')) data = byUrl.get('schemas');
			else if (path.includes('/tables')) data = byUrl.get('tables');
			else if (path.includes('/search-tables')) data = [];
			else if (path.includes('/schema?')) data = byUrl.get('schema');
			else if (path.includes('/preview')) data = { columns: ['id'], rows: [], truncated: false };
			return { ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data })) };
		}) as any;
		reactStub.reset();
		const host = makeHostCtx('s1');
		const props = {
			ctx: host.ctx,
			sessionId: 's1',
			conns: [conn], projectPath: 'E:/proj',
			grants: [{ connId: conn.id, mode: 'ro' }],
			askConfirm: () => Promise.resolve(false),
			active: true, refreshTick: 0,
		};
		let pane = reactStub.render(T.BrowsePane, props);
		await flush();
		// stub React 不展开函数组件：取出 Pane 渲染的 BrowseTree 元素，以「不重置 hook 计数」的
		// 嵌套渲染驱动它（槽位续号，不与 Pane 的 state 冲突）；行点击经 onSelect 写回 Pane 的 sel
		const btEl = collect(pane).find((e) => e.type === T.BrowseTree);
		expect(btEl, 'Pane 未渲染 BrowseTree').toBeTruthy();
		const base = reactStub.mark(); // 嵌套渲染基准：后续每轮从同一处续号，树内槽位跨轮稳定
		const drive = async (...want: string[]) => {
			let tree = reactStub.renderNested(T.BrowseTree, btEl!.props, base);
			await flush();
			const head = collect(tree).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-browse-treehead'));
			expect(head, '未找到对象树壳标题行').toBeTruthy();
			head!.props.onClick();
			await flush();
			for (const w of want) {
				tree = reactStub.renderNested(T.BrowseTree, btEl!.props, base);
				const row = collect(tree).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-treerow') && flatText(e).includes(w) && e.props.onClick);
				expect(row, `未找到可展开行「${w}」`).toBeTruthy();
				row!.props.onClick({ currentTarget: {} });
				await flush();
			}
		};
		await drive('mydb', ...(conn.kind === 'postgresql' ? ['public', table.name] : [table.name]));
		// 选中表后重渲染 Pane：sel 生效，openTable（schema+preview）与面包屑按钮就位
		pane = reactStub.render(T.BrowsePane, props);
		await flush();
		// 再渲染一轮：schema/preview 已到位，结构页字段行 @ 按钮就位
		pane = reactStub.render(T.BrowsePane, props);
		await flush();
		return { pane, host };
	}

	it('mysql 两层：选中表后面包屑出现 @ 按钮，点击经宿主通道插入 "@db:c1/mydb/t1 "', async () => {
		const { pane, host } = await selectTable({ id: 'c1', name: '主库', kind: 'mysql' }, { name: 't1', type: 'TABLE', comment: '' });
		const crumb = collect(pane).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-browse-crumb'));
		expect(crumb, '未找到面包屑').toBeTruthy();
		const btn = collect(crumb).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-btn') && flatText(e).includes('@'));
		expect(btn, '选中表后面包屑缺 @添加到对话按钮').toBeTruthy();
		btn!.props.onClick();
		expect(host.calls).toHaveLength(1);
		expect(host.calls[0]!.text).toBe('@db:c1/mydb/t1 ');
		expect(host.calls[0]!.focused).toBe(true);
	});

	it('postgresql 三层：插入带模式的四段记号 "@db:c2/mydb/public/orders "', async () => {
		const { pane, host } = await selectTable({ id: 'c2', name: '分析库', kind: 'postgresql' }, { name: 'orders', type: 'TABLE', comment: '' });
		const crumb = collect(pane).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-browse-crumb'));
		const btn = collect(crumb).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-btn') && flatText(e).includes('@'));
		expect(btn).toBeTruthy();
		btn!.props.onClick();
		expect(host.calls[0]!.text).toBe('@db:c2/mydb/public/orders ');
	});

	it('未选中表：面包屑无 @ 按钮', () => {
		reactStub.reset();
		fetchImpl = (async () => ({ ok: true, text: () => Promise.resolve(JSON.stringify({ ok: true, data: [] })) })) as any;
		const pane = reactStub.render(T.BrowsePane, {
			ctx: makeHostCtx('s1').ctx, sessionId: 's1',
			conns: [{ id: 'c1', name: '主库', kind: 'mysql' }], projectPath: 'E:/proj',
			grants: [{ connId: 'c1', mode: 'ro' }],
			askConfirm: () => Promise.resolve(false), active: false, refreshTick: 0,
		});
		const crumb = collect(pane).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-browse-crumb'));
		expect(crumb).toBeTruthy();
		const btn = collect(crumb).find((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-btn') && flatText(e).includes('@'));
		expect(btn, '未选中表不应渲染 @ 按钮').toBeUndefined();
	});

	it('结构页：每个字段行有 @ 按钮，点击插入 "@col:<连接>/<库>/<表>/<列> "', async () => {
		const { pane, host } = await selectTable(
			{ id: 'c1', name: '主库', kind: 'mysql' },
			{ name: 'orders', type: 'TABLE', comment: '' },
			[{ name: 'id', dataType: 'int', nullable: false }, { name: 'user_id', dataType: 'int', nullable: false }, { name: 'amount', dataType: 'int', nullable: true }],
		);
		// 默认视图即结构页：字段行末列挂行内 @ 按钮
		const colBtns = collect(pane).filter((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-btn')
			&& typeof e.props['aria-label'] === 'string' && e.props['aria-label'].includes('字段'));
		expect(colBtns.length, '结构页字段行缺 @ 按钮').toBe(3);
		// 点击 user_id 行按钮
		const target = colBtns.find((e) => e.props['aria-label'].includes('user_id'));
		expect(target).toBeTruthy();
		target!.props.onClick();
		expect(host.calls[0]!.text).toBe('@col:c1/mydb/orders/user_id ');
		expect(host.calls[0]!.focused).toBe(true);
	});

	it('结构页（PG 系含模式）：插入四段带模式记号 "@col:c2/mydb/public/orders/id "', async () => {
		const { pane, host } = await selectTable(
			{ id: 'c2', name: '分析库', kind: 'postgresql' },
			{ name: 'orders', type: 'TABLE', comment: '' },
			[{ name: 'id', dataType: 'int4', nullable: false }],
		);
		const colBtns = collect(pane).filter((e) => typeof e.props.className === 'string' && e.props.className.includes('dbt-btn')
			&& typeof e.props['aria-label'] === 'string' && e.props['aria-label'].includes('字段'));
		expect(colBtns.length).toBe(1);
		colBtns[0]!.props.onClick();
		expect(host.calls[0]!.text).toBe('@col:c2/mydb/public/orders/id ');
	});
});

/* ---------- apply() 注册 ---------- */

type Seat = { name: string; key: string; comp: any };

function makeApplyCtx(withConversation: boolean) {
	const state = {
		seats: [] as Seat[],
		rules: [] as any[],
		disposers: [] as Array<() => void>,
	};
	const ctx: any = {
		sidebarRightTabs: { register: () => () => {} },
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
		effect(fn: () => any, _label: string) {
			const dispose = fn();
			if (typeof dispose === 'function') state.disposers.push(dispose);
			return () => {};
		},
	};
	if (withConversation) {
		ctx.uiConversation = {
			userText: {
				register(rule: any) {
					state.rules.push(rule);
					return () => {
						const i = state.rules.indexOf(rule);
						if (i >= 0) state.rules.splice(i, 1);
					};
				},
			},
		};
	}
	return { ctx, state };
}

describe('apply() @db:/@col: 表字段引用管线注册', () => {
	it('宿主带 uiConversation：注册 db-mention 规则与 db-table/db-column 两个 chip 席位，且随 disposer 撤销', () => {
		const { ctx, state } = makeApplyCtx(true);
		mod.apply(ctx);
		expect(state.rules).toHaveLength(1);
		expect(state.rules[0].id).toBe('db-mention');
		const tableSeat = state.seats.find((s) => s.name === 'conversation.user.text.node' && s.key === 'db-table');
		const colSeat = state.seats.find((s) => s.name === 'conversation.user.text.node' && s.key === 'db-column');
		expect(tableSeat, '缺 db-table chip 席位').toBeTruthy();
		expect(colSeat, '缺 db-column chip 席位').toBeTruthy();
		expect(typeof tableSeat!.comp).toBe('function');
		expect(typeof colSeat!.comp).toBe('function');
		for (const dispose of state.disposers) dispose();
		expect(state.rules).toHaveLength(0);
		expect(state.seats).toHaveLength(0);
	});

	it('旧宿主无 uiConversation：不注册规则与 chip 席位（@db:/@col: 退化为普通文本）', () => {
		const { ctx, state } = makeApplyCtx(false);
		expect(() => mod.apply(ctx)).not.toThrow();
		expect(state.rules).toHaveLength(0);
		expect(state.seats.find((s) => s.name === 'conversation.user.text.node')).toBeUndefined();
	});
});
