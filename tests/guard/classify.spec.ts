/** classifyStatement 全 kind 分级用例 + statementHash 稳定性 */
import { describe, expect, it } from 'vitest';
import { classifyStatement, sqlHead, statementHash } from '../../lib/guard/index.js';

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

describe('sqlHead 白盒：注释剥离与首词提取', () => {
  it('注释剥离行为：跨行块注释、防粘连、行注释吃满、空输入', () => {
    expect(sqlHead('/* multi\nline */ SELECT 1')).toBe('select'); // 跨行块注释完整剥离
    expect(sqlHead('sele/*x*/ct')).toBe('sele'); // 剥离替换为空格，'sele'/'ct' 不粘连成 'select'
    expect(sqlHead('SET--update a=1')).toBe('set'); // -- 注释吃到行尾
    expect(sqlHead('SET#update a=1')).toBe('set');
    expect(sqlHead('')).toBe('');
    expect(sqlHead('/* 只有注释 */')).toBe('');
    expect(sqlHead('123 numbers')).toBe('');
  });
});

describe('classifyStatement: SQL 注释剥离', () => {
  it('块注释剥离用于首词提取：剥离后首词正确（含跨行注释）', () => {
    expect(classifyStatement('mysql', '/* multi\nline */ SELECT 1', 'query').level).toBe('none');
    expect(classifyStatement('mysql', 'SELECT/*x*/1', 'query').level).toBe('none');
  });

  it('注释内写词不触发语句体扫描（body 基于剥注释文本，消除误报）', () => {
    const v = classifyStatement('mysql', 'SELECT /* DROP TABLE users */ 1', 'query');
    expect(v.level).toBe('none');
    expect(classifyStatement('mysql', 'SELECT 1 /* drop */', 'query').level).toBe('none');
    // SET 是白名单读头：剥注释后 'SET' 无写词 → none（注释里藏的 update 不再误报）
    expect(classifyStatement('mysql', 'SET--update a=1', 'query').level).toBe('none');
    expect(classifyStatement('mysql', 'SET#update a=1', 'query').level).toBe('none');
  });

  it('前导块注释不使 DDL 漏判（/* x */ DROP 按危险语句确认，堵绕过）', () => {
    const v = classifyStatement('mysql', '/* 注释 */ DROP TABLE users', 'execute');
    expect(v.level).toBe('danger');
    expect(v.reason).toContain('DDL');
    expect(classifyStatement('mysql', '/* 注释 */ DELETE FROM t', 'execute').level).toBe('warning');
    expect(classifyStatement('mysql', '/* 注释 */ DROP TABLE users', 'query').level).toBe('danger');
  });

  it('WITH CTE 语句体中的写词扫描为 danger', () => {
    expect(classifyStatement('mysql', 'WITH x AS (SELECT 1) DELETE FROM t', 'query').level).toBe('danger');
  });

  it('行注释（-- 与 #）剥离：行首注释不破坏首词提取', () => {
    expect(classifyStatement('mysql', '-- c\nSELECT 1', 'query').level).toBe('none');
    expect(classifyStatement('mysql', '# c\nSELECT 1', 'query').level).toBe('none');
    // 行尾注释内写词不触发 body 扫描（剥注释后为纯 SELECT）
    expect(classifyStatement('mysql', 'SELECT 1 -- DROP TABLE x', 'query').level).toBe('none');
  });

  it('首词提取容忍前导空白与括号', () => {
    expect(classifyStatement('mysql', '  SELECT 1', 'query').level).toBe('none');
    expect(classifyStatement('mysql', '(( select 1', 'query').level).toBe('none');
  });

  it('无法提取首词时 fail-closed 为 danger', () => {
    const v = classifyStatement('mysql', '123 numbers', 'query');
    expect(v.level).toBe('danger');
    expect(v.reason).toContain('无法解析语句关键字');
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
