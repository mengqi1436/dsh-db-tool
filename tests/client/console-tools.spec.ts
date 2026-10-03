/**
 * client.js 控制台工具纯函数测试（离线，不依赖 react 渲染）：
 * stub 宿主加载 client/client.js 模块，断言 exports.__testables 暴露的
 * SQL 语句切分 / 格式化方言 / 导出 / 耗时函数。词法规则与 lang-sql 方言
 * spec 字段一一对应（slashComments、doubleDollarQuotedStrings 等）。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let T: any; // exports.__testables

beforeAll(() => {
	// stub 宿主：window.__ModuleLoader__ 捕获 load 定义；react 仅需对象占位（纯函数不触渲染）
	const fakeWindow: any = {
		__ModuleLoader__: {
			load(def: any) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const sandbox = { window: fakeWindow, console };
	// client.js 是纯脚本（无 import/export），用 Function 包装执行
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', src)(sandbox.window, console);
	const mod = fakeWindow.__DEF__.factory((name: string) => {
		if (name === 'react') return {};
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T) throw new Error('client.js 未导出 __testables');
});

describe('splitSqlStatements', () => {
	it('基础切分：按分号切多条，start 指向语句首字符（text 为原文切片）', () => {
		const sql = 'SELECT 1; SELECT 2;';
		expect(T.splitSqlStatements(sql, 'mysql')).toEqual([
			{ text: 'SELECT 1', start: 0 },
			{ text: ' SELECT 2', start: 10 },
		]);
	});

	it('无尾分号的最后一条也返回', () => {
		const sql = 'SELECT 1; SELECT 2';
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(2);
		expect(r[1]).toEqual({ text: ' SELECT 2', start: 10 });
	});

	it('空串/null/undefined 返回空数组', () => {
		expect(T.splitSqlStatements('', 'mysql')).toEqual([]);
		expect(T.splitSqlStatements(null, 'mysql')).toEqual([]);
		expect(T.splitSqlStatements(undefined, 'mysql')).toEqual([]);
	});

	it('纯注释输入返回空数组；注释与语句混排时只留语句', () => {
		expect(T.splitSqlStatements('-- a; b\n/* c; d */', 'postgresql')).toEqual([]);
		const sql = '-- 头注释; x\nSELECT 1; /* 尾注释 */';
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(1);
		expect(r[0].start).toBe(sql.indexOf('SELECT'));
	});

	it('单引号字符串内分号不切（双写转义）', () => {
		const sql = "SELECT ';' AS a, 'it''s' AS b; SELECT 2;";
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(2);
		expect(r[0].start).toBe(0);
		expect(r[1].start).toBe(sql.indexOf('SELECT 2'));
	});

	it('单引号内反斜杠转义不结束字符串', () => {
		const sql = "SELECT 'a\\'; SELECT 2";
		// 语句实际内容：SELECT 'a\'; SELECT 2 —— \' 是字符串内转义，真实语句直到结尾未闭合
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(1);
		expect(r[0].text).toBe(sql);
	});

	it('双引号内分号不切', () => {
		const sql = 'SELECT "a;b" AS c; SELECT 2;';
		expect(T.splitSqlStatements(sql, 'postgresql')).toHaveLength(2);
	});

	it('-- 行注释内的分号不切', () => {
		const sql = '-- 注释; 分号\nSELECT 1;';
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(1);
		expect(r[0].start).toBe(sql.indexOf('SELECT'));
	});

	it('/* */ 块注释内的分号不切；未闭合块注释吞掉其余内容', () => {
		expect(T.splitSqlStatements('/* a; b */ SELECT 1;', 'mysql')).toHaveLength(1);
		expect(T.splitSqlStatements('SELECT 1; /* 未闭合 SELECT 2;', 'mysql')).toHaveLength(1);
	});

	it('PG/GaussDB $$dollar 串内分号不切（对应 doubleDollarQuotedStrings）', () => {
		const sql = 'SELECT $$a;b$$ AS c; SELECT 2;';
		expect(T.splitSqlStatements(sql, 'postgresql')).toHaveLength(2);
		expect(T.splitSqlStatements(sql, 'gaussdb')).toHaveLength(2);
	});

	it('连续多对 $$（嵌套 dollar 场景）互不串扰', () => {
		const sql = 'SELECT $$a$$ + $$b;c$$; SELECT 2;';
		const r = T.splitSqlStatements(sql, 'postgresql');
		expect(r).toHaveLength(2);
		expect(r[1].start).toBe(sql.indexOf('SELECT 2'));
	});

	it('非 PG 方言不启用 $$：$ 为普通字符照常切分', () => {
		expect(T.splitSqlStatements('SELECT $$a;b$$; SELECT 2;', 'mysql')).toHaveLength(3);
	});

	it('MySQL DELIMITER 切换分隔符，指令行不产生语句', () => {
		const sql = 'DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\nDELIMITER ;\nSELECT 2;';
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(2);
		expect(r[0].start).toBe(sql.indexOf('CREATE')); // start 跳过前导换行指向语句首字符
		expect(r[0].text).toContain('CREATE PROCEDURE');
		expect(r[0].text).toContain('BEGIN SELECT 1; END');
		expect(r[1].text).toBe('\nSELECT 2'); // 分隔符已还原，尾分号是终止符
	});

	it('DELIMITER 后未还原：后续一直用新分隔符，分号保留在语句内', () => {
		const sql = 'DELIMITER //\nSELECT 1//\nSELECT 2;';
		const r = T.splitSqlStatements(sql, 'mysql');
		expect(r).toHaveLength(2);
		expect(r[1].text).toBe('\nSELECT 2;');
	});

	it('DELIMITER 不在语句起始处出现则不切换（普通词处理）', () => {
		expect(T.splitSqlStatements('SELECT 1 DELIMITER ; SELECT 2;', 'mysql')).toHaveLength(2);
	});

	it('Oracle BEGIN..END 嵌套块内分号不切', () => {
		const sql = 'BEGIN\n  UPDATE t SET a = 1;\n  BEGIN UPDATE u SET b = 2; END;\nEND;\nSELECT 3;';
		const r = T.splitSqlStatements(sql, 'oracle');
		expect(r).toHaveLength(2);
		expect(r[0].text).toContain('UPDATE u');
		expect(r[1].text).toBe('\nSELECT 3');
	});

	it('达梦 CREATE PROCEDURE 体（AS BEGIN..END）内分号不切', () => {
		const sql = 'CREATE PROCEDURE p AS BEGIN INSERT INTO t VALUES (1); END;\nSELECT 2;';
		const r = T.splitSqlStatements(sql, 'dmdb');
		expect(r).toHaveLength(2);
		expect(r[0].text).toContain('CREATE PROCEDURE');
		expect(r[1].text).toContain('SELECT 2');
	});

	it('顶层 CASE..END 不被误认为块结束（END 不把 depth 减到负）', () => {
		const sql = 'SELECT CASE WHEN a THEN 1 ELSE 2 END FROM t; SELECT 2;';
		expect(T.splitSqlStatements(sql, 'oracle')).toHaveLength(2);
	});

	it('块逻辑仅 oracle/dmdb：mysql 下 BEGIN/END 不影响切分（BEGIN 与 SELECT 1 间无分号则同条）', () => {
		const sql = 'BEGIN\nSELECT 1;\nEND;\nSELECT 2;';
		expect(T.splitSqlStatements(sql, 'mysql')).toHaveLength(3);
	});
});

describe('fmtDialectOf', () => {
	it('SQL 四族映射到 sql-formatter 方言', () => {
		expect(T.fmtDialectOf('mysql')).toBe('mysql');
		expect(T.fmtDialectOf('postgresql')).toBe('postgresql');
		expect(T.fmtDialectOf('gaussdb')).toBe('postgresql');
		expect(T.fmtDialectOf('sqlite')).toBe('sqlite');
		expect(T.fmtDialectOf('oracle')).toBe('plsql');
		expect(T.fmtDialectOf('dmdb')).toBe('plsql');
	});
	it('mongodb/redis 非 SQL 方言返回 null', () => {
		expect(T.fmtDialectOf('mongodb')).toBe(null);
		expect(T.fmtDialectOf('redis')).toBe(null);
		expect(T.fmtDialectOf('unknown')).toBe(null);
	});
});

describe('toCsv', () => {
	it('基础：表头 + 数据行，行尾统一 \\r\\n', () => {
		expect(T.toCsv(['a', 'b'], [[1, 'x'], [2, 'y']])).toBe('a,b\r\n1,x\r\n2,y\r\n');
	});
	it('NULL/undefined 单元格输出空串', () => {
		expect(T.toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,\r\n');
	});
	it('含逗号/引号/换行的值按 CSV 规则转义', () => {
		expect(T.toCsv(['v'], [['x,y']])).toBe('v\r\n"x,y"\r\n');
		expect(T.toCsv(['v'], [['a"b']])).toBe('v\r\n"a""b"\r\n');
		expect(T.toCsv(['v'], [['a\nb']])).toBe('v\r\n"a\nb"\r\n');
	});
	it('空行集只输出表头', () => {
		expect(T.toCsv(['a'], [])).toBe('a\r\n');
	});
});

describe('toJson', () => {
	it('按列名输出对象数组', () => {
		expect(T.toJson(['a', 'b'], [[1, 'x']])).toBe(JSON.stringify([{ a: 1, b: 'x' }]));
	});
	it('NULL 保留 JSON null（不落为空串，避免与空字符串列混淆）', () => {
		expect(T.toJson(['a'], [[null]])).toBe('[{"a":null}]');
	});
	it('空行集输出 []', () => {
		expect(T.toJson(['a'], [])).toBe('[]');
	});
});

describe('fmtMs', () => {
	it('<1000 为整数毫秒', () => {
		expect(T.fmtMs(0)).toBe('0 ms');
		expect(T.fmtMs(850)).toBe('850 ms');
		expect(T.fmtMs(850.4)).toBe('850 ms');
		expect(T.fmtMs(999)).toBe('999 ms');
	});
	it('≥1000 为秒保留两位小数', () => {
		expect(T.fmtMs(1000)).toBe('1.00 s');
		expect(T.fmtMs(1234.5)).toBe('1.23 s');
		expect(T.fmtMs(5999)).toBe('6.00 s');
	});
});
