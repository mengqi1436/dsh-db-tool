/**
 * client.js 结果网格测试（离线，不依赖真实 React 渲染）：
 * - sortRows/slicePage/fmtElapsed 纯函数（exports.__testables）
 * - ResultSetGrid 组件用 stub React（createElement 返回可检查的元素树）桩测
 *   导出按钮的出现/隐藏与点击回调，不渲染 DOM。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let T: any; // exports.__testables

// stub React：createElement 返回普通对象树（type + props，children 归一到 props.children）；
// useState 返回 [初值, noop]——只支撑组件首次渲染出初始树，交互态由纯函数测试覆盖。
const reactStub = {
	createElement(type: any, props: any, ...kids: any[]) {
		const p = Object.assign({}, props);
		if (kids.length === 1) p.children = kids[0];
		else if (kids.length > 1) p.children = kids;
		return { type, props: p };
	},
	useState: (init: any) => [init, () => {}],
	Fragment: Symbol('react.fragment'),
};

// 深度收集元素树：React 元素 → 递归 children；数组 → 逐项；字符串/数字 → 原样；null/undefined 跳过
function collect(el: any, out: any[] = []) {
	if (el === null || el === undefined || el === false || el === true) return out;
	if (Array.isArray(el)) { el.forEach((e) => collect(e, out)); return out; }
	if (typeof el === 'object') {
		out.push(el);
		if (el.props) collect(el.props.children, out);
		return out;
	}
	out.push(el); // 字符串/数字文本节点
	return out;
}
function buttonsOf(el: any) {
	return collect(el).filter((n) => typeof n === 'object' && n !== null && n.type === 'button');
}
function textOf(el: any) {
	return collect(el)
		.filter((n) => typeof n === 'string' || typeof n === 'number')
		.join('');
}

beforeAll(() => {
	// stub 宿主：window.__ModuleLoader__ 捕获 load 定义（照 preview-edit.spec 模式）
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const sandbox = { window: fakeWindow, console };
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', src)(sandbox.window, console);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return reactStub;
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T) throw new Error('client.js 未导出 __testables');
});

describe('sortRows', () => {
	it('字符串列 asc/desc', () => {
		expect(T.sortRows([['b'], ['a'], ['c']], 0, 'asc').map((r: any) => r[0])).toEqual(['a', 'b', 'c']);
		expect(T.sortRows([['a'], ['c'], ['b']], 0, 'desc').map((r: any) => r[0])).toEqual(['c', 'b', 'a']);
	});
	it('数值感知：数值与数字字符串均按数值比较（"9" < "10"）', () => {
		expect(T.sortRows([['9'], ['10'], ['2']], 0, 'asc').map((r: any) => r[0])).toEqual(['2', '9', '10']);
		expect(T.sortRows([[9], [10], [2]], 0, 'desc').map((r: any) => r[0])).toEqual([10, 9, 2]);
	});
	it('混合列：可数值化的走数值，其余字符串比较兜底', () => {
		expect(T.sortRows([['x'], [5], ['3']], 0, 'asc').map((r: any) => String(r[0]))).toEqual(['3', '5', 'x']);
	});
	it('稳定排序：相等键保持原相对顺序', () => {
		const rows = [['b', 1], ['a', 2], ['b', 0], ['a', 1]];
		expect(T.sortRows(rows, 0, 'asc').map((r: any) => r[1])).toEqual([2, 1, 1, 0]);
	});
	it('null/undefined 恒最大（SQL NULL 语义）：asc 尾部、desc 头部', () => {
		expect(T.sortRows([[null], ['a']], 0, 'asc').map((r: any) => r[0])).toEqual(['a', null]);
		expect(T.sortRows([[null], ['a']], 0, 'desc').map((r: any) => r[0])).toEqual([null, 'a']);
		expect(T.sortRows([[undefined], ['a']], 0, 'asc').map((r: any) => r[0])).toEqual(['a', undefined]);
	});
	it('dir=none 原样返回；排序返回新数组不改入参', () => {
		const src = [['b'], ['a']];
		expect(T.sortRows(src, 0, 'none')).toBe(src);
		const out = T.sortRows(src, 0, 'asc');
		expect(out).not.toBe(src);
		expect(src.map((r: any) => r[0])).toEqual(['b', 'a']); // 入参未被打乱
	});
	it('非法入参：colIndex<0 早退原引用；越界/空数组/null rows 安全', () => {
		const src = [['b'], ['a']];
		expect(T.sortRows(src, -1, 'asc')).toBe(src);
		expect(T.sortRows(src, 99, 'asc')).toEqual(src); // 越界格全 undefined → 稳定原序
		expect(T.sortRows([], 0, 'asc')).toEqual([]);
		expect(T.sortRows(null, 0, 'asc')).toBe(null);
	});
});

describe('slicePage', () => {
	it('空行返回空页', () => {
		expect(T.slicePage([], 1)).toEqual([]);
	});
	it('恰 50 行：第 1 页满页，第 2 页空', () => {
		const rows = Array.from({ length: 50 }, (_, i) => [i]);
		expect(T.slicePage(rows, 1)).toHaveLength(50);
		expect(T.slicePage(rows, 2)).toEqual([]);
	});
	it('50+1 行：第 2 页仅剩 1 行', () => {
		const rows = Array.from({ length: 51 }, (_, i) => [i]);
		expect(T.slicePage(rows, 2)).toEqual([[50]]);
	});
	it('默认 pageSize=50，可自定义', () => {
		expect(T.slicePage([1, 2, 3], 1)).toEqual([1, 2, 3]);
		expect(T.slicePage([1, 2, 3], 1, 2)).toEqual([1, 2]);
		expect(T.slicePage([1, 2, 3], 2, 2)).toEqual([3]);
	});
	it('page≤0 钳制安全（不触发负索引从尾部计数）', () => {
		expect(T.slicePage([1, 2, 3], 0)).toEqual([]);
		expect(T.slicePage([1, 2, 3], -1)).toEqual([]);
	});
	it('返回切片副本，不改入参', () => {
		const rows = [[1], [2]];
		const out = T.slicePage(rows, 1);
		expect(out).not.toBe(rows);
		expect(out).toEqual([[1], [2]]);
	});
});

describe('ResultSetGrid（stub React 元素树桩测）', () => {
	const handlers = () => {
		const calls: any[] = [];
		return {
			calls,
			toCsv: (cols: any, rows: any) => 'CSV:' + rows.length,
			toJson: (cols: any, rows: any) => 'JSON:' + rows.length,
			download: (name: any, text: any) => calls.push({ name, text }),
		};
	};

	it('注入 exportHandlers 时出现 CSV/JSON 导出按钮，点击经 download 落盘', () => {
		const h = handlers();
		const el = T.ResultSetGrid({ columns: ['a'], rows: [['1'], ['2']], exportHandlers: h });
		const labels = buttonsOf(el).map(textOf);
		expect(labels).toContain('CSV');
		expect(labels).toContain('JSON');
		const csvBtn = buttonsOf(el).find((b) => textOf(b) === 'CSV')!;
		csvBtn.props.onClick();
		expect(h.calls).toEqual([{ name: 'result.csv', text: 'CSV:2' }]);
		const jsonBtn = buttonsOf(el).find((b) => textOf(b) === 'JSON')!;
		jsonBtn.props.onClick();
		expect(h.calls[1]).toEqual({ name: 'result.json', text: 'JSON:2' });
	});

	it('缺省 exportHandlers 时隐藏导出按钮（分页/表头按钮不受影响）', () => {
		const el = T.ResultSetGrid({ columns: ['a'], rows: [['1']] });
		const labels = buttonsOf(el).map(textOf);
		expect(labels).not.toContain('CSV');
		expect(labels).not.toContain('JSON');
		// 分页条仍渲染：上一页/下一页都在
		expect(labels.some((l) => l.includes('上一页'))).toBe(true);
		expect(labels.some((l) => l.includes('下一页'))).toBe(true);
	});

	it('状态条：行数 · 已截断 · 耗时', () => {
		const el = T.ResultSetGrid({ columns: ['a'], rows: [['1']], truncated: true, elapsedMs: 120 });
		const text = textOf(el);
		expect(text).toContain('1 行');
		expect(text).toContain('结果已截断');
		expect(text).toContain('120 ms');
	});

	it('分页边界：50 行下一页禁用；51 行下一页可用', () => {
		const r50 = Array.from({ length: 50 }, (_, i) => [String(i)]);
		const el50 = T.ResultSetGrid({ columns: ['a'], rows: r50 });
		const next50 = buttonsOf(el50).find((b) => textOf(b).includes('下一页'))!;
		expect(next50.props.disabled).toBe(true);
		const r51 = Array.from({ length: 51 }, (_, i) => [String(i)]);
		const el51 = T.ResultSetGrid({ columns: ['a'], rows: r51 });
		const next51 = buttonsOf(el51).find((b) => textOf(b).includes('下一页'))!;
		expect(next51.props.disabled).toBe(false);
		// 初始仅渲染第一页 50 行（tbody 单元格按钮数 = 50）
		const cellBtns = buttonsOf(el51).filter((b) => b.props.className === 'dbt-cellbtn');
		expect(cellBtns).toHaveLength(50);
	});

	it('每格渲染复制按钮（dbt-cellbtn），NULL 弱化显示', () => {
		const el = T.ResultSetGrid({ columns: ['a', 'b'], rows: [[null, 'x']] });
		const cells = buttonsOf(el).filter((b) => b.props.className === 'dbt-cellbtn');
		expect(cells).toHaveLength(2);
		const text = textOf(el);
		expect(text).toContain('NULL');
		expect(text).toContain('x');
	});

	it('空结果显示空态文案，不渲染表格', () => {
		const el = T.ResultSetGrid({ columns: ['a'], rows: [] });
		expect(collect(el).some((n) => typeof n === 'object' && n.type === 'table')).toBe(false);
		expect(textOf(el)).toContain('暂无数据');
	});
});
