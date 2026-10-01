/**
 * client.js 单元格写回纯函数层测试（离线，不依赖 react 渲染）：
 * 用 stub 宿主加载 client/client.js 模块，断言 exports.__testables 暴露的
 * 命令构造函数在 8 库方言下的正反用例。值一律走绑定参数，语句不含值拼接。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let T; // exports.__testables

beforeAll(() => {
	// stub 宿主：window.__ModuleLoader__ 捕获 load 定义；react 仅需对象占位（纯函数不触渲染）
	const fakeWindow = {
		__ModuleLoader__: {
			load(def) {
				fakeWindow.__DEF__ = def;
			},
		},
	};
	const sandbox = { window: fakeWindow, console };
	// client.js 是纯脚本（无 import/export），用 Function 包装执行
	const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
	new Function('window', 'console', src)(sandbox.window, console);
	const mod = fakeWindow.__DEF__.factory((name) => {
		if (name === 'react') return {};
		throw new Error('未预期的依赖: ' + name);
	});
	T = mod.__testables;
	if (!T) throw new Error('client.js 未导出 __testables');
});

describe('dialectOf', () => {
	it('SQL 三族方言映射正确', () => {
		expect(T.dialectOf('mysql')).toBe('q');
		expect(T.dialectOf('sqlite')).toBe('q');
		expect(T.dialectOf('postgresql')).toBe('dollar');
		expect(T.dialectOf('gaussdb')).toBe('dollar');
		expect(T.dialectOf('oracle')).toBe('colon');
		expect(T.dialectOf('dmdb')).toBe('colon');
	});
	it('redis/mongo 有专属方言，未知库为 null', () => {
		expect(T.dialectOf('redis')).toBe('redis');
		expect(T.dialectOf('mongodb')).toBe('mongo');
		expect(T.dialectOf('unknown')).toBe(null);
	});
});

describe('quoteIdent', () => {
	it('mysql 反引号且内部双写转义', () => {
		expect(T.quoteIdent('mysql', 'order`1')).toBe('`order``1`');
	});
	it('其余库双引号且内部双写转义', () => {
		expect(T.quoteIdent('postgresql', 'a"b')).toBe('"a""b"');
		expect(T.quoteIdent('oracle', 'EMP')).toBe('"EMP"');
	});
});

describe('parseCellText', () => {
	it('数字/布尔/对象解析为类型值，纯文本保持字符串', () => {
		expect(T.parseCellText('123')).toBe(123);
		expect(T.parseCellText('true')).toBe(true);
		expect(T.parseCellText('{"a":1}')).toEqual({ a: 1 });
		expect(T.parseCellText('张三')).toBe('张三');
		// 契约：解析结果为 string 时返回原文本（含引号），不做二次拆解
		expect(T.parseCellText('"123"')).toBe('"123"');
	});
	it('非法 JSON 原样返回字符串', () => {
		expect(T.parseCellText('{"a":')).toBe('{"a":');
	});
});

describe('isTruncatedCell / isBlobCell', () => {
	it('识别 SQL 与 redis/mongo 两种截断标记', () => {
		expect(T.isTruncatedCell('x…[已截断]')).toBe(true);
		expect(T.isTruncatedCell('x…[截断,共1200字符]')).toBe(true);
		expect(T.isTruncatedCell('普通值')).toBe(false);
	});
	it('识别 BLOB 占位', () => {
		expect(T.isBlobCell('[BLOB 4096 bytes]')).toBe(true);
		expect(T.isBlobCell('[BLOB')).toBe(false);
		expect(T.isBlobCell('bytes]')).toBe(false);
	});
});

describe('buildUpdate（SQL 6 库）', () => {
	const pk = ['id'];
	const pkVals = [7];

	it('mysql：反引号全限定 + ? 占位 + 库名路由', () => {
		const r = T.buildUpdate('mysql', 'users', 'shop', null, 'name', '李四', false, pk, pkVals);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe('UPDATE `shop`.`users` SET `name` = ? WHERE `id` = ?');
		expect(r.ops[0]!.params).toEqual(['李四', 7]);
		expect(r.ops[0]!.database).toBe('shop');
	});

	it('postgresql：schema 全限定 + $n 占位 + database 含 schema', () => {
		const r = T.buildUpdate('postgresql', 'users', 'shop.public', 'public', 'name', 'Lee', false, pk, pkVals);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe('UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2');
		expect(r.ops[0]!.params).toEqual(['Lee', 7]);
		expect(r.ops[0]!.database).toBe('shop.public');
	});

	it('oracle：owner 全限定 + :n 占位（主键列名随 schema 原样大写）', () => {
		const r = T.buildUpdate('oracle', 'EMP', 'SCOTT', null, 'NAME', 'King', false, ['ID'], [7]);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe('UPDATE "SCOTT"."EMP" SET "NAME" = :1 WHERE "ID" = :2');
		expect(r.ops[0]!.params).toEqual(['King', 7]);
	});

	it('sqlite：库内表名 + ? 占位，database 为空', () => {
		const r = T.buildUpdate('sqlite', 'users', 'main', null, 'name', 'x', false, pk, pkVals);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe('UPDATE "users" SET "name" = ? WHERE "id" = ?');
		expect(r.ops[0]!.database).toBeUndefined();
	});

	it('NULL 语义：SET col = NULL 且 params 只含主键', () => {
		const r = T.buildUpdate('mysql', 'users', 'shop', null, 'email', '', true, pk, pkVals);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe('UPDATE `shop`.`users` SET `email` = NULL WHERE `id` = ?');
		expect(r.ops[0]!.params).toEqual([7]);
	});

	it('复合主键逐列 AND 连接；数字文本解析为 number', () => {
		const r = T.buildUpdate('mysql', 't', 'db', null, 'v', '1', false, ['a', 'b'], [1, 'x']);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe('UPDATE `db`.`t` SET `v` = ? WHERE `a` = ? AND `b` = ?');
		expect(r.ops[0]!.params).toEqual([1, 1, 'x']);
	});

	it('值不经拼接：文本值只出现在 params，语句字符串不含值', () => {
		const evil = "x'; DROP TABLE users; --";
		const r = T.buildUpdate('mysql', 'users', 'shop', null, 'name', evil, false, pk, pkVals);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement.includes(evil)).toBe(false);
		expect(r.ops[0]!.params![0]).toBe(evil);
	});

	it('无主键拒绝构造', () => {
		expect(T.buildUpdate('mysql', 'users', 'shop', null, 'name', 'x', false, [], [])).toEqual({ ok: false, error: 'noPkHint' });
	});
});

describe('buildRedisOp', () => {
	const cols = ['field', 'value'];
	const row = ['host', '127.0.0.1'];

	it('hash value：HSET 单步', () => {
		const r = T.buildRedisOp('cfg', 'hash', cols, row, 'value', '0.0.0.0', false);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe(JSON.stringify(['HSET', 'cfg', 'host', '0.0.0.0']));
	});
	it('zset score：ZADD；member：ZREM+ZADD 两步', () => {
		const zc = ['member', 'score'];
		const zr = ['alice', '96.5'];
		const s = T.buildRedisOp('rank', 'zset', zc, zr, 'score', '99', false);
		expect(s.ok).toBe(true);
		expect(s.ops[0]!.statement).toBe(JSON.stringify(['ZADD', 'rank', 99, 'alice']));
		const m = T.buildRedisOp('rank', 'zset', zc, zr, 'member', 'bob', false);
		expect(m.ok).toBe(true);
		expect(m.ops.map((o) => o.statement)).toEqual([
			JSON.stringify(['ZREM', 'rank', 'alice']),
			JSON.stringify(['ZADD', 'rank', '96.5', 'bob']),
		]);
	});
	it('set member：SREM+SADD 两步', () => {
		const r = T.buildRedisOp('tags', 'set', ['member'], ['a'], 'member', 'b', false);
		expect(r.ok).toBe(true);
		expect(r.ops.map((o) => o.statement)).toEqual([
			JSON.stringify(['SREM', 'tags', 'a']),
			JSON.stringify(['SADD', 'tags', 'b']),
		]);
	});
	it('string value：SET；key 列只读', () => {
		const r = T.buildRedisOp('user:1', 'string', ['key', 'value'], ['user:1', '张三'], 'value', '李四', false);
		expect(r.ok).toBe(true);
		expect(r.ops[0]!.statement).toBe(JSON.stringify(['SET', 'user:1', '李四']));
		expect(T.buildRedisOp('user:1', 'string', ['key', 'value'], ['user:1', 'x'], 'key', 'y', false).ok).toBe(false);
	});
	it('list/stream 与 NULL 拒绝', () => {
		expect(T.buildRedisOp('q', 'list', ['value'], ['x'], 'value', 'y', false).error).toBe('redisTypeRo');
		expect(T.buildRedisOp('s', 'stream', ['id', 'field', 'value'], ['1', 'f', 'v'], 'value', 'y', false).error).toBe('redisTypeRo');
		expect(T.buildRedisOp('cfg', 'hash', cols, row, 'value', '', true).error).toBe('redisTypeRo');
	});
	it('score 非数字拒绝（error 为 null，组件兜底通用错误）', () => {
		const r = T.buildRedisOp('rank', 'zset', ['member', 'score'], ['alice', '96.5'], 'score', 'abc', false);
		expect(r.ok).toBe(false);
		expect(r.error).toBe(null);
	});
});

describe('buildMongoOp', () => {
	it('ObjectId _id：filter 走 $oid；_id 列只读', () => {
		const hex = '652a1b2c3d4e5f6a7b8c9d0e';
		const r = T.buildMongoOp('users', hex, true, 'name', 'Alice2', false, 'string (inferred)');
		expect(r.ok).toBe(true);
		const doc = JSON.parse(r.ops[0]!.statement);
		expect(doc.updateOne).toBe('users');
		expect(doc.filter).toEqual({ _id: { $oid: hex } });
		expect(doc.update).toEqual({ $set: { name: 'Alice2' } });
		expect(T.buildMongoOp('users', hex, true, '_id', 'x', false, 'ObjectId').ok).toBe(false);
	});
	it('date 列包 $date；NULL 写入 $set null', () => {
		const hex = '652a1b2c3d4e5f6a7b8c9d0e';
		const d = T.buildMongoOp('users', hex, true, 'created', '2026-05-01T00:00:00.000Z', false, 'date (inferred)');
		expect(JSON.parse(d.ops[0]!.statement).update.$set.created).toEqual({ $date: '2026-05-01T00:00:00.000Z' });
		const n = T.buildMongoOp('users', hex, true, 'age', '', true, 'number (inferred)');
		expect(JSON.parse(n.ops[0]!.statement).update.$set.age).toBe(null);
	});
	it('字符串 _id：filter 直值', () => {
		const r = T.buildMongoOp('users', 'abc123', false, 'name', 'Bob', false, 'string');
		expect(JSON.parse(r.ops[0]!.statement).filter).toEqual({ _id: 'abc123' });
	});
});
