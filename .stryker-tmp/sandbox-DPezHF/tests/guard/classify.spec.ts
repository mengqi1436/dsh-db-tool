/** classifyStatement 全 kind 分级用例 + statementHash 稳定性 */
// @ts-nocheck

import { describe, expect, it } from 'vitest';
import { classifyStatement, statementHash } from '../../lib/guard/index.js';

describe('classifyStatement: SQL 系', () => {
  it('普通 SELECT 为 none', () => {
    expect(classifyStatement('mysql', 'SELECT * FROM users', 'query')).toMatchObject({ level: 'none' });
    expect(classifyStatement('oracle', 'explain plan for select 1', 'execute')).toMatchObject({ level: 'none' });
  });

  it('DDL 为 danger，原因是 DDL 不可回滚', () => {
    for (const stmt of ['DROP TABLE users', 'truncate table t', 'ALTER TABLE users ADD c int', 'drop database app']) {
      const v = classifyStatement('mysql', stmt, 'execute');
      expect(v.level).toBe('danger');
      expect(v.reason).toContain('不可回滚');
    }
  });

  it('DML 在 execute 通道为 warning，在 query 通道为 danger', () => {
    expect(classifyStatement('postgresql', 'UPDATE users SET a=1', 'execute').level).toBe('warning');
    expect(classifyStatement('postgresql', 'DELETE FROM users', 'query').level).toBe('danger');
    expect(classifyStatement('sqlite', 'INSERT INTO t VALUES (1)', 'execute').level).toBe('warning');
  });

  it('读语句内的危险片段升级为 danger', () => {
    for (const stmt of [
      'SELECT 1; DROP TABLE users',
      "SELECT * FROM t INTO OUTFILE '/tmp/x'",
      'SET GLOBAL max_connections=100',
    ]) {
      expect(classifyStatement('mysql', stmt, 'query').level).toBe('danger');
    }
  });

  it('维护命令为 danger', () => {
    expect(classifyStatement('mysql', 'FLUSH PRIVILEGES', 'execute').level).toBe('danger');
    expect(classifyStatement('mysql', 'KILL 12', 'execute').level).toBe('danger');
  });

  it('未知关键字：query 通道 danger，execute 通道 warning', () => {
    expect(classifyStatement('mysql', 'ADMINISH THINGS', 'query').level).toBe('danger');
    expect(classifyStatement('mysql', 'ADMINISH THINGS', 'execute').level).toBe('warning');
  });
});

describe('classifyStatement: Redis', () => {
  it('危险命令 danger（13 项清单）', () => {
    expect(classifyStatement('redis', 'FLUSHALL', 'execute').level).toBe('danger');
    expect(classifyStatement('redis', 'config get maxmemory', 'query').level).toBe('danger');
    expect(classifyStatement('redis', 'keys *', 'query').level).toBe('danger');
  });

  it('读命令 none、写命令 warning', () => {
    expect(classifyStatement('redis', 'GET key', 'query').level).toBe('none');
    expect(classifyStatement('redis', 'SET key v', 'execute').level).toBe('warning');
  });

  it('JSON 数组形式同样解析', () => {
    expect(classifyStatement('redis', '["FLUSHDB"]', 'execute').level).toBe('danger');
    expect(classifyStatement('redis', '["GET","key"]', 'query').level).toBe('none');
  });

  it('未知命令 fail-closed：query 通道 danger、execute 通道 warning', () => {
    expect(classifyStatement('redis', 'WHATCOMMAND a b', 'query').level).toBe('danger');
    expect(classifyStatement('redis', 'WHATCOMMAND a b', 'execute').level).toBe('warning');
  });
});

describe('classifyStatement: MongoDB', () => {
  it('危险操作 danger（8 项清单）', () => {
    expect(classifyStatement('mongodb', '{"dropDatabase":1}', 'execute').level).toBe('danger');
    expect(classifyStatement('mongodb', '{"dropCollection":"users"}', 'execute').level).toBe('danger');
    expect(classifyStatement('mongodb', '{"deleteMany":{"filter":{}}}', 'execute').level).toBe('danger');
  });

  it('写操作 warning、读操作 none', () => {
    expect(classifyStatement('mongodb', '{"insert":"users","documents":[]}', 'execute').level).toBe('warning');
    expect(classifyStatement('mongodb', '{"find":"users","filter":{}}', 'query').level).toBe('none');
  });

  it('非法 JSON danger', () => {
    expect(classifyStatement('mongodb', 'not json at all', 'query').level).toBe('danger');
  });
});

describe('statementHash', () => {
  it('trim 后哈希，稳定一致', () => {
    expect(statementHash('DROP TABLE users')).toBe(statementHash('  DROP TABLE users  '));
    expect(statementHash('DROP TABLE users')).not.toBe(statementHash('DROP TABLE users2'));
  });
});
