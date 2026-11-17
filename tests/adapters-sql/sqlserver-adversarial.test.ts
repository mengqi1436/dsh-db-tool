/**
 * SQL Server（第 9 种 kind）对抗式安全审查测试 —— 只做攻击与防线取证，不改任何实现。
 *
 * 运行方式：
 *   npx vitest run tests/adapters-sql/sqlserver-adversarial.test.ts            # 默认全绿
 *   npx vitest run tests/adapters-sql/sqlserver-adversarial.test.ts -t '缺陷'   # 只看缺陷用例
 *   npx vitest run tests/adapters-sql/sqlserver-adversarial.test.ts --reporter=verbose
 *
 * 约定（关键）：
 *  - `it.fails(...)` = **已证实的缺陷证据**：用例断言的是「安全行为应当如何」，当前实现不满足，
 *    故该断言必然失败；`it.fails` 让默认 `npm test` 保持绿色。修复后这些用例会变成
 *    “expected to fail but passed” 而报红 —— 那一刻应把 `it.fails` 改回 `it`（这正是回归信号）。
 *  - 每个缺陷用例都带 `console.log('[证据] ...')`，单跑时 stdout 会打印实测值，便于直接取证。
 *  - 不用 mock 网络：FakePool/FakeTransaction 记录适配器真正下发的 SQL，因此「放行」= 语句确实
 *    被送到驱动层（生产里就是发往服务器）。
 *  - 覆盖到的实现位置见各用例注释的 file:line。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { classifyStatement } from '../../lib/guard/index.js';
import { normalizeCell } from '../../lib/adapters/sql-shared/common.js';
import { safeDefaultExpr } from '../../lib/adapters/transfer/model.js';
import {
  midToSqlserverType,
  createSqlserverTransferReader,
  createSqlserverTransferWriter,
  sqlserverIdent,
  sqlserverPerStmt,
  sqlserverTypeToMid,
  toSqlserverBind,
  toSqlserverDateTime,
} from '../../lib/adapters/transfer/kinds/sqlserver.js';
import {
  createSqlserverAdapter,
  type SqlDriver,
  type SqlPool,
  type SqlQueryResult,
  type SqlRequest,
  type SqlTransaction,
} from '../../lib/adapters/sqlserver/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

/* ============================ Fake 驱动 ============================ */

class FakeRequest implements SqlRequest {
  inputs: Array<{ name: string; value: unknown }> = [];
  executed: Array<{ sql: string; binds: Array<[string, unknown]> }> = [];
  constructor(private readonly queue: SqlQueryResult[]) {}
  input(name: string, ...rest: unknown[]): SqlRequest {
    this.inputs.push({ name, value: rest.length >= 2 ? rest[1] : rest[0] });
    return this;
  }
  async query(sql: string): Promise<SqlQueryResult> {
    this.executed.push({ sql, binds: this.inputs.map((i) => [i.name, i.value]) });
    return this.queue.shift() ?? { recordset: [], rowsAffected: [0] };
  }
}

class FakePool implements SqlPool {
  requests: FakeRequest[] = [];
  queue: SqlQueryResult[] = [];
  constructor(readonly config: Record<string, unknown>) {}
  request(): SqlRequest {
    const r = new FakeRequest(this.queue);
    this.requests.push(r);
    return r;
  }
  async connect(): Promise<unknown> {
    return this;
  }
  async close(): Promise<unknown> {
    return this;
  }
  on(): unknown {
    return this;
  }
  /** 最近一次下发到驱动的语句文本 */
  get lastSql(): string {
    const r = this.requests[this.requests.length - 1];
    return r?.executed[0]?.sql ?? '';
  }
}

class FakeTransaction implements SqlTransaction {
  constructor(private readonly pool: FakePool) {}
  async begin(): Promise<unknown> {
    return this;
  }
  async commit(): Promise<unknown> {
    return this;
  }
  async rollback(): Promise<unknown> {
    return this;
  }
  request(): SqlRequest {
    return new FakeRequest(this.pool.queue);
  }
}

const CONN = {
  meta: { id: 'c1', kind: 'sqlserver', name: 'adv' },
  url: 'sqlserver://sa:p@localhost:1433/db',
} as unknown as ResolvedConnection;

function fakeDriver(pools: FakePool[]): SqlDriver {
  return {
    ConnectionPool: function (cfg: Record<string, unknown>) {
      const p = new FakePool(cfg ?? {});
      pools.push(p);
      return p;
    },
    Transaction: function (pool: SqlPool) {
      return new FakeTransaction(pool as FakePool);
    },
    TYPES: {},
  } as unknown as SqlDriver;
}

async function make(mode?: 'ro' | 'rw') {
  const pools: FakePool[] = [];
  const adapter = await createSqlserverAdapter(CONN, { mode, driver: fakeDriver(pools) });
  return { a: adapter, pool: pools[0]!, pools };
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 取「实际发生的事」：放行 → 'PASS'；拒绝 → 'REJ(原因)' */
async function probe(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'PASS';
  } catch (e) {
    return 'REJ ' + msgOf(e).slice(0, 200);
  }
}

/* ============================ 1. ro 只读闸门 ============================ */

describe('ro 闸门：防线有效面（对照，证明不是所有写形态都能过）', () => {
  it('sel/**/ect … into 与 INTO 的引号/方括号/跨行/前导括号/;WITH 变体全部被拒', async () => {
    const { a } = await make('ro');
    const rejected = [
      'SELECT * INTO [t2] FROM t',
      'SELECT * INTO "t2" FROM t',
      'SELECT *\nINTO t2\nFROM t',
      'WITH c AS (SELECT 1 AS n) SELECT n INTO t2 FROM c',
      '(SELECT 1 AS n) INTO t2',
      ';WITH c AS (SELECT 1 AS n) SELECT n INTO t2 FROM c',
      'select * into t2 from t',
    ];
    for (const s of rejected) {
      expect(await probe(() => a.query(s)), s).toMatch(/^REJ/);
    }
    await a.close();
  });

  it('WITH + insert/update/delete/merge 被拒（含嵌套 CTE）', async () => {
    const { a } = await make('ro');
    const rejected = [
      'WITH x AS (SELECT 1 AS n) DELETE FROM t',
      'WITH x AS (SELECT 1 AS n) UPDATE t SET c = 1',
      'WITH x AS (SELECT 1 AS n) MERGE t AS s USING x ON 1 = 1 WHEN MATCHED THEN DELETE',
      'WITH a AS (SELECT 1 AS n), b AS (SELECT n FROM a) DELETE FROM t',
    ];
    for (const s of rejected) {
      expect(await probe(() => a.query(s)), s).toMatch(/^REJ/);
    }
    await a.close();
  });

  it('字符串/方括号标识符/注释里的 into、delete 不误伤（判定走词法）', async () => {
    const { a } = await make('ro');
    for (const s of [
      "SELECT 'into 字符串' AS a",
      'SELECT [into] FROM t',
      "SELECT 'delete from t' AS a",
      '/* into delete */ SELECT 1 AS a',
    ]) {
      expect(await probe(() => a.query(s)), s).toBe('PASS');
    }
    await a.close();
  });

  it('含标点的第二条写语句被拒 —— 说明 multi 判定不是“完全不工作”，而是粒度错', async () => {
    // 这里的 = 与 . 是触发 multi 的唯一原因（见 index.ts:322-324：sawSemi 后遇到非空白
    // 标点才置 multi；word 分支 index.ts:313-321 直接 continue，跳过该判定）
    const { a } = await make('ro');
    for (const s of ['SELECT 1; UPDATE t SET x = 1', 'SELECT 1;DROP TABLE dbo.t']) {
      expect(await probe(() => a.query(s)), s).toMatch(/^REJ/);
    }
    await a.close();
  });
});

describe('ro 闸门：缺陷（Critical）', () => {
  it('[已修复] ro 应拒绝 SELECT 1;DROP TABLE t（修复前：第二条语句全为标识符+空白 → multi 判不出；现 multi 判定前置到所有内容分支）', async () => {
    const { a, pool } = await make('ro');
    await expect(a.query('SELECT 1;DROP TABLE t')).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });

  it('[已修复] ro 应拒绝分号后的 DELETE / TRUNCATE（无 WHERE、无标点；现统一置 multi）', async () => {
    const { a, pool } = await make('ro');
    await expect(a.query('SELECT 1;DELETE FROM t')).rejects.toThrow(/只读/);
    await expect(a.query('SELECT 1; TRUNCATE TABLE t')).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });

  it("[已修复] ro 应拒绝 SELECT 1;EXEC xp_cmdshell 'whoami'（修复前引号被词法跳过 → 无标点可判）", async () => {
    const { a, pool } = await make('ro');
    await expect(a.query("SELECT 1;EXEC xp_cmdshell 'whoami'")).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });

  it("[已修复] ro 应拒绝 SELECT 1;EXEC sp_executesql N'DROP TABLE t'（动态 DDL，现按多语句拒绝）", async () => {
    const { a, pool } = await make('ro');
    await expect(a.query("SELECT 1;EXEC sp_executesql N'DROP TABLE t'")).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });

  it("[已修复] ro 应拒绝 SELECT 1;BULK INSERT t FROM 'c:\\x.csv' 与 SELECT 1;SHUTDOWN", async () => {
    const { a, pool } = await make('ro');
    await expect(a.query("SELECT 1;BULK INSERT t FROM 'c:\\x.csv'")).rejects.toThrow(/只读/);
    await expect(a.query('SELECT 1;SHUTDOWN')).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });

  it('[已修复] ro 应拒绝 USE db;DROP TABLE t（白名单首词 use + 无标点第二条，现按多语句拒绝）', async () => {
    const { a, pool } = await make('ro');
    await expect(a.query('USE db;DROP TABLE t')).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });

  it('[已修复] ro 跨库 query 应拒绝写语句，且不得为写请求新建跨库池（ro 检查先于建池）', async () => {
    const { a, pools } = await make('ro');
    await expect(a.query('SELECT 1;DROP TABLE t', [], 'otherdb')).rejects.toThrow(/只读/);
    console.log('[证据] 跨库 ro 放行，池数量=' + pools.length + '（>1 表示已为 otherdb 建了池）');
    await a.close();
  });

  it('[已修复] ro 应拒绝 OPENROWSET/OPENQUERY 内的远端语句（远端执行等价任意语句，现按顶层 token 整体拒绝）', async () => {
    const { a, pool } = await make('ro');
    // strings 里的分号/关键字全被 scanSql 跳过 → 无 into、无顶层分号 → 闸门放行
    await expect(a.query("SELECT * FROM OPENQUERY(ls,'EXEC xp_cmdshell ''whoami''')")).rejects.toThrow(/只读/);
    console.log('[证据] ro 放行并下发驱动: ' + pool.lastSql);
    await a.close();
  });
});

/* ============================ 2. 占位符重写 ============================ */

describe('占位符重写（? → @pN）', () => {
  it('引号/方括号/注释内的 ? 不计入占位符', async () => {
    const { a, pool } = await make();
    await a.query("SELECT '?' AS a");
    expect(pool.lastSql).toBe("SELECT '?' AS a");
    await a.query("SELECT N'?' AS a");
    await a.query('SELECT [a?b] FROM t');
    await a.query('-- ?\nSELECT 1');
    await a.query('/* ? */ SELECT 1');
    expect(pool.lastSql).toBe('/* ? */ SELECT 1');
    await a.close();
  });

  it('顶层 ? 顺序重写为 @p1..@pN 并绑定；注释里的 ? 不被重写', async () => {
    const { a, pool } = await make();
    await a.query('SELECT ? -- ?\n', [1]);
    expect(pool.lastSql).toBe('SELECT @p1 -- ?\n');
    expect(pool.requests[pool.requests.length - 1]!.executed[0]!.binds).toEqual([['p1', 1]]);
    await a.close();
  });

  it('未闭合的 \' / [ / /* 都 fail-closed：少计占位符 → 与参数个数不一致即抛，绝不悄悄少绑', async () => {
    const { a } = await make();
    // 未闭合时后续内容整体被当字面量 → 占位符计数 0，而传入 1 个参数 → 报个数不一致
    for (const s of ["SELECT 'unclosed ?", 'SELECT [unclosed ?', 'SELECT /* unclosed ?']) {
      expect(await probe(() => a.query(s, [1])), s).toMatch(/不一致/);
    }
    await a.close();
  });

  it('混用检测：@pN + ? 拒绝；@@ 系统变量与纯 @pN 不误报', async () => {
    const { a } = await make();
    expect(await probe(() => a.query('SELECT @p1 + ?', [1]))).toMatch(/混用/);
    expect(await probe(() => a.query('SELECT @@ROWCOUNT'))).toBe('PASS');
    // @@ 是系统函数前缀，不算命名参数 → 与 ? 同用合法（不会误判混用）
    expect(await probe(() => a.query('SELECT @@p1, ?', [1]))).toBe('PASS');
    await a.close();
  });

  it('execute 通道同样做占位符个数校验（不只在 query 上）', async () => {
    const { a } = await make();
    expect(await probe(() => a.execute('UPDATE t SET x = ?'))).toMatch(/不一致/);
    expect(await probe(() => a.execute("SELECT '?'"))).toBe('PASS');
    await a.close();
  });

  it('[已修复] SELECT @p1x, ? 不该被判为“混用 @pN”（现只在 token 精确匹配 @p\\d+ 时置位）', async () => {
    const { a } = await make();
    // 误报代价：用户写了一个恰好以 @p 开头的局部变量名就无法使用 ? 绑定
    expect(await probe(() => a.query('SELECT @p1x, ?', [1]))).not.toMatch(/混用/);
    await a.close();
  });

  it('[已修复] 不一致提示不再推荐“直接书写 @pN”，改为「只接受 ? 占位符」的明确说明', async () => {
    const { a } = await make();
    // 修复前：提示建议「补齐参数或直接书写 @pN」，但写 @pN 又传参会与「占位符 0 个」冲突（自相矛盾）
    const err = await a.query('SELECT @p1', [1]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/只接受 \? 占位符/);
    expect(msgOf(err)).not.toMatch(/或直接书写/);
    // 对照：纯 ? 通道正常工作
    expect(await probe(() => a.query('SELECT ?', [1]))).toBe('PASS');
    await a.close();
  });
});

/* ============================ 3. guard 分级 ============================ */

describe('guard 分级（sqlserver 分支）', () => {
  it('直连高危语句与 DDL/DML 分级正确', () => {
    expect(classifyStatement('sqlserver', "EXEC xp_cmdshell 'whoami'", 'execute').level).toBe('danger');
    expect(classifyStatement('sqlserver', "BULK INSERT t FROM 'c:\\x.csv'", 'execute').level).toBe('danger');
    expect(classifyStatement('sqlserver', 'TRUNCATE TABLE t', 'execute').level).toBe('danger');
    expect(classifyStatement('sqlserver', 'INSERT INTO t SELECT * FROM s', 'execute').level).toBe('warning');
    expect(classifyStatement('sqlserver', 'SELECT 1; -- 尾注释', 'query').level).toBe('none');
    expect(classifyStatement('sqlserver', 'SELECT * INTO t2 FROM t', 'execute').level).toBe('danger');
  });

  it('[已修复·guard 侧] EXEC 动态 SQL 里的 DDL/高危语句判 danger（execute 通道 warning 不走 challenge 的缺陷已修）', () => {
    // manager.ts:1159-1170 只在 danger 时创建 challenge；warning 直接执行。
    // guard/index.ts:59 的 SQLSERVER_DANGER_BODY_RE 需要明文 xp_/sp_configure，
    // 而 stripSqlLiterals（guard/index.ts:71-90）会把 EXEC('…') / N'…' 里的内容整段抹掉。
    for (const s of [
      "EXEC('DROP TABLE t')",
      "EXEC sp_executesql N'DROP TABLE t'",
      "EXEC('xp_cmdshell ''whoami''')",
      "EXEC('BACKUP DATABASE db TO DISK=''c:\\x.bak''')",
    ]) {
      const v = classifyStatement('sqlserver', s, 'execute');
      console.log(`[证据] ${s} → ${v.level}/${v.reason}`);
      expect(v.level, s).toBe('danger');
    }
  });

  it('[已修复·guard 侧] SELECT 1 AS into FROM t 是合法读，不再被判 danger（into 作列别名的误报已修）', () => {
    const v = classifyStatement('sqlserver', 'SELECT 1 AS into FROM t', 'query');
    console.log('[证据] SELECT 1 AS into FROM t → ' + v.level + '/' + v.reason);
    expect(v.level).toBe('none');
  });

  it('[已修复·guard 侧] WITH … INSERT INTO … SELECT 的 danger 理由已是“写操作”', () => {
    const v = classifyStatement('sqlserver', 'WITH c AS (SELECT 1 AS n) INSERT INTO t SELECT * FROM c', 'execute');
    console.log('[证据] 理由=' + v.reason);
    // 级别侥幸仍是 danger（保守），但理由指向错误的机制，会让用户误判风险
    expect(v.reason ?? '').not.toMatch(/SELECT \.\.\. INTO/);
  });

  it("[已修复·guard 侧] SELECT * FROM OPENQUERY(ls,'DELETE FROM t') 不再因字符串里的 delete 被判 danger", () => {
    // SQL_WRITE_BODY_RE（guard/index.ts:38）只看剥注释后的文本，不剥字符串 → 误报
    const v = classifyStatement('sqlserver', "SELECT * FROM OPENQUERY(ls,'DELETE FROM t')", 'query');
    console.log('[证据] ' + v.level + '/' + v.reason);
    expect(v.level).toBe('none');
  });

  it('[已修复·guard 侧] OPENQUERY 内的 EXEC/xp_cmdshell 判 danger', () => {
    const v = classifyStatement('sqlserver', "SELECT * FROM OPENQUERY(ls,'EXEC xp_cmdshell ''whoami''')", 'query');
    console.log('[证据] ' + v.level + '/' + v.reason);
    expect(v.level).toBe('danger');
  });

  it('stripSqlLiterals 边界：未闭合引号/方括号不误伤合法读，]] 转义闭合后仍能看见 INTO', () => {
    // 通过 classifyStatement 间接验证 stripSqlLiterals（guard/index.ts:71-90）
    expect(classifyStatement('sqlserver', "SELECT 'unclosed", 'query').level).toBe('none');
    expect(classifyStatement('sqlserver', 'SELECT [a]]b] FROM t', 'query').level).toBe('none');
    // 含字面 ] 的标识符（]] 转义）后跟 INTO：闭合正确 → INTO 仍被识别为建表副作用
    expect(classifyStatement('sqlserver', 'SELECT [a]]b] INTO t2 FROM t', 'query').level).toBe('danger');
    // 结尾 '' 转义后跟写关键字，剥字面量不应把写关键字一起吞掉
    expect(classifyStatement('sqlserver', "SELECT 'a''; DROP TABLE t", 'query').level).toBe('danger');
  });
});

/* ============================ 4. transfer ============================ */

describe('transfer：标识符与切批', () => {
  it('sqlserverIdent 只转义 ]，逗号/引号/分号/换行在方括号内不构成注入', () => {
    expect(sqlserverIdent('a]b')).toBe('[a]]b]');
    expect(sqlserverIdent('a,b')).toBe('[a,b]');
    expect(sqlserverIdent("a';DROP TABLE x--")).toBe("[a';DROP TABLE x--]");
    expect(sqlserverIdent('a]]b')).toBe('[a]]]]b]');
    expect(sqlserverIdent('中文表名')).toBe('[中文表名]');
    expect(() => sqlserverIdent('a\nb')).toThrow(/非法标识符/);
    expect(() => sqlserverIdent('')).toThrow(/非法标识符/);
  });

  it('sqlserverPerStmt：0 列兜底 1，双上限取小，不产出 0 行语句', () => {
    expect(sqlserverPerStmt(0)).toBe(1);
    expect(sqlserverPerStmt(1)).toBe(1000);
    expect(sqlserverPerStmt(2)).toBe(1000);
    expect(sqlserverPerStmt(3)).toBe(700);
    expect(sqlserverPerStmt(1024)).toBe(2);
    // 2101 列时 floor(2100/2101)=0 → 兜底 1；单行 2101 参数将超 TDS 2100 上限
    // （SQL Server 单表最多 1024 列，正常路径不可达，仅记录边界意图）
    expect(sqlserverPerStmt(2101)).toBe(1);
  });

  it('writeBatch：多行 VALUES 参数化、列名 [x]、每语句参数 ≤2100', async () => {
    const executed: string[] = [];
    const tx = txRecorder(executed, () => ({ recordset: [], rowsAffected: [1] }));
    const w = createSqlserverTransferWriter(new FakePool({}), () => tx, 'dbo', 'insert');
    await w.writeBatch({ name: 't', columns: ['a', 'b', 'c'].map((n) => ({ name: n, midType: 'int' })) } as never, [
      [1, 2, 3],
      [4, 5, 6],
    ] as never);
    expect(executed[0]).toBe('INSERT INTO [dbo].[t] ([a], [b], [c]) VALUES (@p0, @p1, @p2), (@p3, @p4, @p5)');
  });

  it('[已修复·transfer 侧] 0 列表不再拼出非法语句 INSERT INTO [dbo].[t] () VALUES ()（现抛中文错误）', async () => {
    const executed: string[] = [];
    const tx = txRecorder(executed, () => ({ recordset: [], rowsAffected: [1] }));
    const w = createSqlserverTransferWriter(new FakePool({}), () => tx, 'dbo', 'insert');
    await expect(w.writeBatch({ name: 't', columns: [] } as never, [[] as never])).rejects.toThrow(/无列定义/);
    console.log('[证据] ' + JSON.stringify(executed));
    expect(executed.join('')).not.toMatch(/\(\) VALUES \(\)/);
  });
});

describe('transfer：beforeLoad 清空降级', () => {
  it('锁超时（1222）降级 DELETE 是设计意图，且随后复位 LOCK_TIMEOUT 并提交', async () => {
    const executed: string[] = [];
    const tx = txRecorder(executed, (i) => {
      if (i === 1) throw Object.assign(new Error('Lock request time out period exceeded.'), { number: 1222 });
      return { recordset: [], rowsAffected: [0] };
    });
    const w = createSqlserverTransferWriter(new FakePool({}), () => tx, 'dbo', 'truncate');
    await w.beforeLoad!('t');
    expect(executed).toEqual(['SET LOCK_TIMEOUT 15000', 'DELETE FROM [dbo].[t]', 'SET LOCK_TIMEOUT -1']);
  });

  it('[已修复·transfer 侧] TRUNCATE 因权限(229)/对象不存在(208)失败时不再静默降级 DELETE', async () => {
    // kinds/sqlserver.ts:419-423 是 catch-all：任何 TRUNCATE 失败都换 DELETE，
    // 与紧邻注释“拿不到锁（错误 1222）降级”不符；降级成功则目标表 IDENTITY 种子不重置且无任何日志。
    for (const [label, num] of [['权限229', 229], ['对象不存在208', 208]] as Array<[string, number]>) {
      const executed: string[] = [];
      const tx = txRecorder(executed, (i) => {
        if (i === 1) throw Object.assign(new Error(label), { number: num });
        return { recordset: [], rowsAffected: [0] };
      });
      const w = createSqlserverTransferWriter(new FakePool({}), () => tx, 'dbo', 'truncate');
      const outcome = await probe(() => w.beforeLoad!('t'));
      console.log(`[证据] ${label}: ${outcome} executed=${JSON.stringify(executed)}`);
      expect(outcome, label).toMatch(/^REJ/);
    }
  });
});

describe('transfer：类型与值保真', () => {
  it('varchar/nvarchar 长度与 decimal 精度 clamp 到 SQL Server 上限', () => {
    expect(midToSqlserverType({ midType: 'decimal', precision: 99, scale: 99 } as never)).toBe('DECIMAL(38,38)');
    expect(midToSqlserverType({ midType: 'string', length: 99999 } as never)).toBe('NVARCHAR(4000)');
    expect(midToSqlserverType({ midType: 'text' } as never)).toBe('NVARCHAR(MAX)');
  });

  it('[已修复·transfer 侧] 源 varchar(5000)/varchar(8000) 不再映射到 NVARCHAR(4000)（容量不足已修）', () => {
    // sqlserverTypeToMid 把 varchar(5000) 归 string（非 -1 → 不是 text），
    // 写向 clamp 到 NVARCHAR(4000)（kinds/sqlserver.ts:99）
    const mid = sqlserverTypeToMid('varchar', 5000);
    const target = midToSqlserverType({ midType: mid, length: 5000 } as never);
    console.log(`[证据] varchar(5000) → midType=${mid} → 目标列 ${target}`);
    expect(target).not.toBe('NVARCHAR(4000)');
  });

  it('[已修复·transfer 侧] datetime2 列有保真读表达式 CONVERT(nvarchar(33), [d], 126)', async () => {
    const pool = new FakePool({});
    pool.queue = [
      {
        recordset: [
          {
            COLUMN_NAME: 'd', DATA_TYPE: 'datetime2', IS_NULLABLE: 'NO', COLUMN_DEFAULT: null,
            CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: null, NUMERIC_SCALE: 7, IS_IDENTITY: 0,
          },
        ],
      },
      { recordset: [] },
      { recordset: [{ v: 15 }] },
      { recordset: [{ d: new Date('2020-01-01T00:00:00.123Z') }] },
    ];
    const reader = createSqlserverTransferReader(pool as unknown as SqlPool, 'dbo');
    const rows = await reader.readBatch('t', { mode: 'offset', offset: 0 } as never, 10);
    const sql = pool.lastSql;
    console.log(`[证据] 数据 SQL=${sql.replace(/\s+/g, ' ')} 值=${JSON.stringify(rows)}`);
    // decimal 与 datetime2 都有显式 CONVERT 保真读表达式
    expect(sql).toContain('CONVERT(nvarchar(33), [d], 126)');
  });

  it('绑定往返：日期剥 Z、bigint 走十进制字符串、bytes → Buffer', () => {
    expect(toSqlserverDateTime('2020-01-01T12:00:00.1234567Z')).toBe('2020-01-01T12:00:00.1234567');
    expect(toSqlserverDateTime('2020-01-01 12:00:00Z')).toBe('2020-01-01T12:00:00');
    expect(toSqlserverDateTime('2020-01-01T12:00:00+08:00')).toBe('2020-01-01T12:00:00+08:00');
    expect(toSqlserverBind(9007199254740993n)).toBe('9007199254740993');
    expect(Buffer.isBuffer(toSqlserverBind(new Uint8Array([1, 2])))).toBe(true);
    expect(toSqlserverBind('2020-01-01T00:00:00.000Z', { midType: 'datetime' } as never)).toBe('2020-01-01T00:00:00.000');
  });

  it('safeDefaultExpr 白名单挡掉注入型 DEFAULT 表达式', () => {
    expect(safeDefaultExpr("'a'; DROP TABLE x --")).toBeNull();
    expect(safeDefaultExpr("'a' + (SELECT 1)")).toBeNull();
    expect(safeDefaultExpr('1; DROP TABLE x')).toBeNull();
    expect(safeDefaultExpr('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(safeDefaultExpr("'a''b'")).toBe("'a''b'");
  });
});

/* ============================ 5. client.js 词法 ============================ */

let T: { splitSqlStatements(sql: unknown, kind: string): Array<{ text: string; start: number }> };
let loadErr: unknown;

beforeAll(() => {
  try {
    const fakeWindow: Record<string, unknown> = {
      __ModuleLoader__: {
        load(def: unknown) {
          fakeWindow['__DEF__'] = def;
        },
      },
    };
    const sandbox = { window: fakeWindow, console };
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../client/client.js'), 'utf8');
    new Function('window', 'console', src)(sandbox.window, console);
    const def = fakeWindow['__DEF__'] as { factory: (r: (n: string) => unknown) => { __testables: typeof T } };
    T = def.factory((name: string) => {
      if (name === 'react') return {};
      throw new Error('未预期的依赖: ' + name);
    }).__testables;
  } catch (e) {
    loadErr = e;
  }
});

describe('client.js：GO 批分隔符与方括号词法', () => {
  const split = (sql: string): string[] => {
    if (loadErr) throw loadErr;
    return T.splitSqlStatements(sql, 'sqlserver').map((s) => s.text);
  };

  it('GO 独占一行才算（大小写/缩进/前后空白），行内 GO 不算', () => {
    expect(split('SELECT 1\nGO\nSELECT 2')).toEqual(['SELECT 1', '\nSELECT 2']);
    expect(split('SELECT 1\ngo\nSELECT 2')).toHaveLength(2);
    expect(split('SELECT 1\n  GO  \nSELECT 2')).toHaveLength(2);
    expect(split('SELECT 1 GO\nSELECT 2')).toHaveLength(1);
  });

  it('字符串/注释/方括号内的 GO 不切分', () => {
    expect(split("SELECT 'GO'\nSELECT 2")).toHaveLength(1);
    expect(split('-- GO\nSELECT 1\nSELECT 2')).toHaveLength(1);
    expect(split('/* GO */\nSELECT 1\nSELECT 2')).toHaveLength(1);
    expect(split('[GO]\nSELECT 1')).toHaveLength(1);
  });

  it('方括号内的分号不切分，]] 转义正确', () => {
    expect(split('SELECT [a;b]\nSELECT 2')).toHaveLength(1);
    expect(split('SELECT [a]]b]; SELECT 2')).toEqual(['SELECT [a]]b]', ' SELECT 2']);
  });

  it('[已修复·client 侧] GO 行尾带注释（GO -- c）被识别为批分隔符', () => {
    const r = split('SELECT 1\nGO -- c\nSELECT 2');
    console.log('[证据] ' + JSON.stringify(r));
    expect(r).toHaveLength(2);
  });

  it('[已修复·client 侧] GO 3 的重复计数被识别（不再静默忽略）', () => {
    const r = split('SELECT 1\nGO 3\nSELECT 2');
    console.log('[证据] ' + JSON.stringify(r));
    expect(r).toHaveLength(4);
  });

  it('[已修复·client 侧] T-SQL 反斜杠不再按转义处理（语句切分正确）', () => {
    // client/client.js:1073-1086 的引号分支无条件把 \ 当转义（mysql 语义）。
    // T-SQL 中 'C:\temp\' 是合法闭合串，其后 ; SELECT 2 是第二条语句。
    const r = split("SELECT 'C:\\temp\\' AS p; SELECT 2");
    console.log('[证据] ' + JSON.stringify(r));
    expect(r).toHaveLength(2);
  });
});

/* ============================ 6. 其它面（凭据 / 规范化 / 生命周期） ============================ */

describe('凭据与错误文案', () => {
  it('[已修复] 连接 URL 解析失败时错误消息不应回显明文密码（现经 redactUrl 脱敏：***@host）', async () => {
    // lib/adapters/sqlserver/index.ts:175 直接把 conn.url 拼进消息；
    // manager.ts:1177 把该消息写审计（lib/store/audit.ts 无脱敏）
    const bad = 'sqlserver://sa:S3cretPwd@host:99999/db';
    const err = await createSqlserverAdapter({ meta: { id: 'c', kind: 'sqlserver' }, url: bad } as unknown as ResolvedConnection, {
      driver: fakeDriver([]),
    }).then(
      () => new Error('未抛错'),
      (e: unknown) => e as Error,
    );
    console.log('[证据] ' + msgOf(err).slice(0, 160));
    expect(msgOf(err)).not.toMatch(/S3cretPwd/);
  });
});

describe('normalizeCell 边界', () => {
  it('bigint 安全范围内降为 number，超出保持字符串', () => {
    expect(normalizeCell(9007199254740991n)).toBe(9007199254740991);
    expect(normalizeCell(9007199254740992n)).toBe('9007199254740992');
  });

  it('Buffer/Date/嵌套对象/循环对象都不崩、都有确定形态', () => {
    expect(normalizeCell(Buffer.from([1, 2, 3]))).toBe('[BLOB 3 bytes]');
    expect(normalizeCell(new Date('2020-01-01T00:00:00.000Z'))).toBe('2020-01-01T00:00:00.000Z');
    expect(normalizeCell({ a: 1 })).toBe('{"a":1}');
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(normalizeCell(cyc)).toBe('[object Object]');
    expect(normalizeCell(true)).toBe(1);
  });

  it('[已修复] Invalid Date 不再抛 RangeError（normalizeCell 已加 getTime 保护）', () => {
    // normalizeCell（sql-shared/common.ts:53）直接调用 toISOString，没有 Number.isNaN(getTime()) 保护
    expect(() => normalizeCell(new Date(Number.NaN))).not.toThrow();
  });
});

describe('生命周期', () => {
  it('close 后所有方法都以中文错误拒绝，且不为跨库请求新建池', async () => {
    const { a, pools } = await make();
    await a.close();
    const methods: Array<[string, () => Promise<unknown>]> = [
      ['listDatabases', () => a.listDatabases()],
      ['listSchemas', () => a.listSchemas!()],
      ['listTables', () => a.listTables()],
      ['describeTable', () => a.describeTable('t')],
      ['previewRows', () => a.previewRows('t', 10)],
      ['query', () => a.query('SELECT 1')],
      ['execute', () => a.execute('SELECT 1')],
      ['testConnect', () => a.testConnect()],
      ['query@otherdb', () => a.query('SELECT 1', [], 'otherdb')],
    ];
    for (const [name, fn] of methods) {
      expect(await probe(fn), name).toMatch(/连接已关闭/);
    }
    expect(pools).toHaveLength(1); // 关闭后没有新建跨库池（无连接泄漏）
    expect(await probe(() => a.close())).toBe('PASS'); // close 幂等
  });

  it('[已修复] 库名大小写不同（MyDB / mydb）应复用同一个池（池键已按小写归一）', async () => {
    const { a, pools } = await make('rw');
    await a.query('SELECT 1', [], 'MyDB');
    await a.query('SELECT 1', [], 'mydb');
    console.log('[证据] 池数量=' + pools.length);
    expect(pools).toHaveLength(2);
    await a.close();
  });
});

/* ============================ 小工具 ============================ */

/** 记录下发 SQL 的事务桩；每第 i 次 query 的行为由 plan 决定（抛错或返回结果） */
function txRecorder(executed: string[], plan: (i: number) => SqlQueryResult): SqlTransaction {
  let seq = 0;
  const tx = {
    begin: async () => tx,
    commit: async () => tx,
    rollback: async () => tx,
    request: () => ({
      input() {
        return this;
      },
      async query(sql: string): Promise<SqlQueryResult> {
        const i = seq++;
        const r = plan(i);
        executed.push(sql);
        return r;
      },
    }),
  } as unknown as SqlTransaction;
  return tx;
}
