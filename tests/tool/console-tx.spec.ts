/**
 * 控制台事务会话（契约 C）服务层测试（全离线，假适配器）：
 *  - begin：ro 拒（READ_ONLY）/ 未授权拒 / 不支持事务的 kind 拒 / 成功发 token 并审计；
 *  - 粘性：会话专用适配器（工厂只建一次）+ tx.begin 后 exec 走粘性事务通道；
 *  - exec：语义等同 execute——classifyStatement + challenge（扁平 NeedConfirm）+ 审计，
 *    读语句走 query 通道保留结果集；
 *  - commit/rollback：粘性连接提交/回滚后销毁会话并 close 适配器（finally release 语义）；
 *  - 空闲 TTL 自动回收：close 适配器并审计一条超时回滚；
 *  - 授权复核：会话存活期间 revoke / rw→ro 降级即时生效；
 *  - tx(fn) 函数式形态（oracle/dmdb）：挂起 fn 模式——exec 逐条进 tx 通道，
 *    commit resolve / rollback reject 由适配器 tx 原子实现完成提交/回滚。
 */
import { describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { DbToolStore, normalizeProjectKey } from '../../lib/store/index.js';
import { DbToolService, type NeedConfirm } from '../../lib/manager.js';
import { ChallengeStore, SQL_READ_HEADS } from '../../lib/guard/index.js';
import type { TxHandle } from '../../lib/adapters/sql-shared/pg-like.js';
import type {
  ColumnInfo,
  DatabaseAdapter,
  DbKind,
  ExecResult,
  QueryResult,
  TableInfo,
  TestConnectResult,
} from '../../lib/adapters/types.js';
import { CONN_ID, CONN_URL } from './fixture.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';

/* ---------------- 假适配器（带事务通道，记录调用轨迹） ---------------- */

/** 形态 1：{begin,commit,rollback} 句柄（mysql/pg 系语义）。log 记录内部粘性路由标志 */
function fakeHandleTxAdapter(log: string[]): DatabaseAdapter & { tx: TxHandle } {
  let inTx = false;
  return {
    kind: 'mysql',
    connId: CONN_ID,
    testConnect: async (): Promise<TestConnectResult> => ({ ok: true, serverInfo: 'fake-8.0' }),
    query: async (sql: string): Promise<QueryResult> => {
      log.push(`query:${sql}:sticky=${inTx}`);
      return { columns: ['answer'], rows: [[sql]], rowCount: 1 };
    },
    execute: async (sql: string): Promise<ExecResult> => {
      log.push(`execute:${sql}:sticky=${inTx}`);
      return { affectedRows: 1, message: `已执行: ${sql}` };
    },
    listDatabases: async () => ['app'],
    listTables: async (): Promise<TableInfo[]> => [],
    describeTable: async (): Promise<ColumnInfo[]> => [],
    previewRows: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
    tx: {
      begin: async () => {
        if (inTx) throw new Error('事务已开启，请勿重复 begin');
        inTx = true;
        log.push('BEGIN');
      },
      commit: async () => {
        if (!inTx) throw new Error('没有进行中的事务');
        inTx = false;
        log.push('COMMIT');
      },
      rollback: async () => {
        if (!inTx) throw new Error('没有进行中的事务');
        inTx = false;
        log.push('ROLLBACK');
      },
    },
    close: async () => {
      log.push('close');
    },
  };
}

/** 形态 2：函数式 tx(fn)（oracle/dmdb 语义：隐式开始，fn 结束自动 commit/异常 rollback） */
function fakeFnTxAdapter(log: string[]): DatabaseAdapter {
  return {
    kind: 'oracle',
    connId: CONN_ID,
    testConnect: async (): Promise<TestConnectResult> => ({ ok: true, serverInfo: 'fake-ora' }),
    query: async (sql: string): Promise<QueryResult> => {
      log.push(`query:${sql}`);
      return { columns: [], rows: [], rowCount: 0 };
    },
    execute: async (sql: string): Promise<ExecResult> => {
      log.push(`execute:${sql}`);
      return { message: 'ok' };
    },
    listDatabases: async () => ['APP'],
    listTables: async (): Promise<TableInfo[]> => [],
    describeTable: async (): Promise<ColumnInfo[]> => [],
    previewRows: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
    tx: async <T>(
      fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult | QueryResult>) => Promise<T>,
    ): Promise<T> => {
      log.push('tx:checkout'); // 对应 pool.getConnection() + SET TRANSACTION READ WRITE
      // 与真实适配器同口径：读首词命中 SQL_READ_HEADS 返回结果集，否则返回执行回执
      const exec = async (sql: string): Promise<ExecResult | QueryResult> => {
        log.push(`tx-exec:${sql}`);
        if (SQL_READ_HEADS.has(sql.trim().split(/\s+/)[0]?.toLowerCase() ?? '')) {
          return { columns: ['answer'], rows: [[sql]], rowCount: 1 };
        }
        return { affectedRows: 1, message: `tx 已执行: ${sql}` };
      };
      try {
        const out = await fn(exec);
        log.push('tx:commit'); // 对应 connection.commit()
        return out;
      } catch (e) {
        log.push('tx:rollback'); // 对应 connection.rollback()
        throw e;
      }
    },
    close: async () => {
      log.push('close');
    },
  };
}

/* ---------------- fixture（本地构造：fixture.ts 的假适配器无 tx，不可复用） ---------------- */

interface TxFixture {
  home: string;
  projectA: string;
  projectB: string;
  store: DbToolStore;
  service: DbToolService;
  /** 每个被创建适配器的调用轨迹（索引即创建序） */
  logs: string[][];
  /** 工厂收到的 mode 序列 */
  modes: ('ro' | 'rw' | undefined)[];
  dispose: () => Promise<void>;
}

async function makeTxFixture(
  mode: 'ro' | 'rw',
  opts?: { tx?: 'handle' | 'fn'; ttlMs?: number; sweepIntervalMs?: number },
): Promise<TxFixture> {
  const home = makeTempHome();
  const store = new DbToolStore(home);
  store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
  const projectA = path.join(os.tmpdir(), 'dbt-tx-test-proj-a');
  const projectB = path.join(os.tmpdir(), 'dbt-tx-test-proj-b');
  store.grants.grant(normalizeProjectKey(projectA), CONN_ID, mode);

  const logs: string[][] = [];
  const modes: ('ro' | 'rw' | undefined)[] = [];
  const service = new DbToolService(store, {
    adapterResolver: async () => (conn, o) => {
      modes.push(o?.mode);
      const log: string[] = [];
      logs.push(log);
      const adapter =
        opts?.tx === 'fn' ? fakeFnTxAdapter(log) : opts?.tx === 'handle' ? fakeHandleTxAdapter(log) : fakeNoTxAdapter(log);
      return Promise.resolve(adapter);
    },
    challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
    consoleTx: { ttlMs: opts?.ttlMs, sweepIntervalMs: opts?.sweepIntervalMs },
  });
  return {
    home,
    projectA,
    projectB,
    store,
    service,
    logs,
    modes,
    dispose: async () => {
      await service.dispose();
      cleanupDir(home);
    },
  };
}

/** 无 tx 成员的适配器（redis/mongodb/sqlite 形态） */
function fakeNoTxAdapter(log: string[]): DatabaseAdapter {
  return {
    kind: 'redis',
    connId: CONN_ID,
    testConnect: async (): Promise<TestConnectResult> => ({ ok: true }),
    query: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
    execute: async (): Promise<ExecResult> => ({ message: 'ok' }),
    listDatabases: async () => ['db0'],
    listTables: async (): Promise<TableInfo[]> => [],
    describeTable: async (): Promise<ColumnInfo[]> => [],
    previewRows: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
    close: async () => {
      log.push('close');
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ---------------- begin ---------------- */

describe('consoleBegin（事务会话创建）', () => {
  it('ro 授权直接 READ_ONLY 拒；未授权项目 UNAUTHORIZED_PROJECT', async () => {
    const ro = await makeTxFixture('ro', { tx: 'handle' });
    const rw = await makeTxFixture('rw', { tx: 'handle' });
    try {
      await expect(ro.service.consoleBegin(ro.projectA, CONN_ID)).rejects.toMatchObject({ code: 'READ_ONLY' });
      await expect(rw.service.consoleBegin(rw.projectB, CONN_ID)).rejects.toMatchObject({
        code: 'UNAUTHORIZED_PROJECT',
      });
      // 被拒的尝试不应创建任何适配器（authorize 在取适配器前即拒绝）
      expect(ro.logs).toHaveLength(0);
    } finally {
      await ro.dispose();
      await rw.dispose();
    }
  });

  it('无 tx 成员的 kind 拒绝（INVALID_ARGUMENT）且适配器被 close，不留泄漏', async () => {
    const fx = await makeTxFixture('rw');
    try {
      await expect(fx.service.consoleBegin(fx.projectA, CONN_ID)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      // logs[0]=authorize 的缓存适配器；logs[1]=会话适配器（开启失败后必须 close）
      expect(fx.logs[1]).toContain('close');
    } finally {
      await fx.dispose();
    }
  });

  it('成功：发 sessionToken、会话专用适配器收到 rw mode、审计 console_begin', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      expect(sessionToken).toMatch(/^t_/);
      // 缓存适配器（authorize）+ 会话专用适配器，后者 mode=rw
      expect(fx.logs).toHaveLength(2);
      expect(fx.modes[1]).toBe('rw');
      const begin = fx.service
        .auditTail(fx.projectA, 100)
        .find((e) => e.action === 'console_begin');
      expect(begin?.ok).toBe(true);
      // 收尾：提交销毁会话
      await fx.service.consoleCommit(sessionToken);
    } finally {
      await fx.dispose();
    }
  });
});

/* ---------------- 粘性 + exec 语义 ---------------- */

describe('consoleExec（粘性路由 + guard 语义等同 execute）', () => {
  it('会话专用适配器只建一次；begin 后写语句走 execute 且粘性、读语句走 query 有结果集', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await fx.service.consoleExec(sessionToken, "INSERT INTO t VALUES (1)");
      const sel = await fx.service.consoleExec(sessionToken, 'SELECT * FROM t');
      expect((sel as QueryResult).rowCount).toBe(1);
      // 会话内未新建适配器（begin 1 个；authorize 缓存适配器不算日志内轨迹——本地工厂只记会话适配器）
      expect(fx.logs).toHaveLength(2);
      const log = fx.logs[1]!;
      expect(log).toContain('BEGIN');
      expect(log).toContain('execute:INSERT INTO t VALUES (1):sticky=true');
      expect(log).toContain('query:SELECT * FROM t:sticky=true');
      await fx.service.consoleCommit(sessionToken);
    } finally {
      await fx.dispose();
    }
  });

  it('危险写语句无 challenge 返回扁平 NeedConfirm；带 challengeId 重试成功；错 challenge INVALID_CHALLENGE', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      const stmt = 'DROP TABLE t';
      const nc = (await fx.service.consoleExec(sessionToken, stmt)) as NeedConfirm;
      expect(nc.needConfirmation).toBe(true);
      expect(nc.challengeId).toBeTruthy();
      expect(nc.danger).toBe('danger');

      // challenge 绑定语句：换语句消费 → INVALID_CHALLENGE
      await expect(
        fx.service.consoleExec(sessionToken, 'DROP TABLE other', undefined, nc.challengeId),
      ).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' });

      // 原语句带有效 challenge → 成功执行
      const nc2 = (await fx.service.consoleExec(sessionToken, stmt)) as NeedConfirm;
      await fx.service.consoleExec(sessionToken, stmt, undefined, nc2.challengeId);
      expect(fx.logs[1]).toContain('execute:DROP TABLE t:sticky=true');
      await fx.service.consoleCommit(sessionToken);

      const audit = fx.service.auditTail(fx.projectA, 200);
      expect(audit.some((e) => e.action === 'console_exec' && e.error === 'NEEDS_CONFIRMATION')).toBe(true);
      expect(audit.some((e) => e.action === 'console_exec' && e.error === 'INVALID_CHALLENGE')).toBe(true);
      expect(audit.some((e) => e.action === 'console_exec' && e.statement === stmt && e.confirmed && e.ok)).toBe(true);
    } finally {
      await fx.dispose();
    }
  });

  it('未知 sessionToken → NOT_FOUND；params 非数组 → INVALID_ARGUMENT', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      await expect(fx.service.consoleExec('t_nope', 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await expect(
        fx.service.consoleExec(sessionToken, 'SELECT 1', 'not-array' as unknown as unknown[]),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await fx.service.consoleCommit(sessionToken);
    } finally {
      await fx.dispose();
    }
  });
});

/* ---------------- commit / rollback ---------------- */

describe('consoleCommit / consoleRollback（销毁会话 + close 适配器）', () => {
  it('commit：粘性通道提交、close 适配器、会话销毁（再操作 NOT_FOUND）、审计落盘', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await fx.service.consoleCommit(sessionToken);
      const log = fx.logs[1]!;
      expect(log[log.indexOf('BEGIN') + 1]).toBe('COMMIT');
      expect(log).toContain('close');
      await expect(fx.service.consoleExec(sessionToken, 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(fx.service.consoleCommit(sessionToken)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fx.service.auditTail(fx.projectA, 100).some((e) => e.action === 'console_commit' && e.ok)).toBe(true);
    } finally {
      await fx.dispose();
    }
  });

  it('rollback：粘性通道回滚、close 适配器、会话销毁、审计落盘', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await fx.service.consoleExec(sessionToken, "INSERT INTO t VALUES (1)");
      await fx.service.consoleRollback(sessionToken);
      const log = fx.logs[1]!;
      expect(log.slice(-2)).toEqual(['ROLLBACK', 'close']);
      await expect(fx.service.consoleExec(sessionToken, 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fx.service.auditTail(fx.projectA, 100).some((e) => e.action === 'console_rollback' && e.ok)).toBe(true);
    } finally {
      await fx.dispose();
    }
  });
});

/* ---------------- 空闲 TTL 回收 ---------------- */

describe('空闲 TTL 自动回收', () => {
  it('超时后会话被回收（NOT_FOUND）、适配器 close、审计一条超时回滚', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle', ttlMs: 30, sweepIntervalMs: 10 });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await sleep(200);
      await expect(fx.service.consoleExec(sessionToken, 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fx.logs[1]).toContain('ROLLBACK');
      expect(fx.logs[1]).toContain('close');
      const rb = fx.service
        .auditTail(fx.projectA, 200)
        .find((e) => e.action === 'console_rollback' && e.statement.includes('超时'));
      expect(rb?.ok).toBe(true);
      // ok:true 的记录不带 error 槽（回收原因在 statement 说明槽，杜绝矛盾审计）
      expect(rb?.error).toBeUndefined();
    } finally {
      await fx.dispose();
    }
  });
});

/* ---------------- 授权变更即时生效 ---------------- */

describe('会话存活期间授权变更', () => {
  it('revoke 后 exec 拒 UNAUTHORIZED_PROJECT；rw→ro 降级后 exec 拒 READ_ONLY', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      fx.store.grants.revoke(normalizeProjectKey(fx.projectA), CONN_ID);
      await expect(fx.service.consoleExec(sessionToken, 'SELECT 1')).rejects.toMatchObject({
        code: 'UNAUTHORIZED_PROJECT',
      });

      const fx2 = await makeTxFixture('rw', { tx: 'handle' });
      try {
        const t2 = await fx2.service.consoleBegin(fx2.projectA, CONN_ID);
        fx2.store.grants.grant(normalizeProjectKey(fx2.projectA), CONN_ID, 'ro');
        await expect(fx2.service.consoleExec(t2.sessionToken, 'SELECT 1')).rejects.toMatchObject({
          code: 'READ_ONLY',
        });
      } finally {
        await fx2.dispose();
      }
      await fx.service.consoleRollback(sessionToken).catch(() => {}); // 会话已被 revoke 复核拦截前的 finish 兜底
    } finally {
      await fx.dispose();
    }
  });
});

/* ---------------- tx(fn) 函数式形态（oracle/dmdb） ---------------- */

describe('consoleTx 函数式 tx(fn) 形态（oracle/dmdb）', () => {
  it('begin 挂起 tx 通道；exec 逐条进通道；commit 触发适配器内部 commit + close；再操作 NOT_FOUND', async () => {
    const fx = await makeTxFixture('rw', { tx: 'fn' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      const log = fx.logs[1]!;
      expect(log).toEqual(['tx:checkout']); // fn 挂起，尚未 commit/rollback
      await fx.service.consoleExec(sessionToken, "INSERT INTO t VALUES (1)");
      expect(log).toEqual(['tx:checkout', 'tx-exec:INSERT INTO t VALUES (1)']);
      await fx.service.consoleCommit(sessionToken);
      expect(log).toEqual(['tx:checkout', 'tx-exec:INSERT INTO t VALUES (1)', 'tx:commit', 'close']);
      await expect(fx.service.consoleExec(sessionToken, 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await fx.dispose();
    }
  });

  it('事务内 SELECT 走结果集通道：返回 columns/rows/rowCount，与写在同一事务连接逐条串行', async () => {
    const fx = await makeTxFixture('rw', { tx: 'fn' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      const r = await fx.service.consoleExec(sessionToken, 'SELECT * FROM t');
      expect(r).toMatchObject({ columns: ['answer'], rows: [['SELECT * FROM t']], rowCount: 1 });
      expect('affectedRows' in r).toBe(false);
      await fx.service.consoleExec(sessionToken, "INSERT INTO t VALUES (1)");
      expect(fx.logs[1]).toEqual(['tx:checkout', 'tx-exec:SELECT * FROM t', 'tx-exec:INSERT INTO t VALUES (1)']);
      await fx.service.consoleCommit(sessionToken);
    } finally {
      await fx.dispose();
    }
  });

  it('事务内写语句仍返回执行回执（affectedRows/message），不误入结果集通道', async () => {
    const fx = await makeTxFixture('rw', { tx: 'fn' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      const r = await fx.service.consoleExec(sessionToken, "INSERT INTO t VALUES (1)");
      expect(r).toMatchObject({ affectedRows: 1, message: 'tx 已执行: INSERT INTO t VALUES (1)' });
      expect('rowCount' in r).toBe(false);
      await fx.service.consoleCommit(sessionToken);
    } finally {
      await fx.dispose();
    }
  });

  it('rollback 经 fn reject 触发适配器内部 rollback + close', async () => {
    const fx = await makeTxFixture('rw', { tx: 'fn' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await fx.service.consoleRollback(sessionToken);
      expect(fx.logs[1]).toEqual(['tx:checkout', 'tx:rollback', 'close']);
      expect(fx.service.auditTail(fx.projectA, 100).some((e) => e.action === 'console_rollback' && e.ok)).toBe(true);
    } finally {
      await fx.dispose();
    }
  });
});

/* ---------------- OCR 审查修复回归（finish 竞态 / 参数拒绝 / 上限 / 回收覆盖面） ---------------- */

/** 可控假适配器（handle 形态）：execute 挂起直到 openGate() 放行，验证 finish 排队在途语句之后 */
function makeGatedFixture(): Promise<{
  home: string;
  projectA: string;
  service: DbToolService;
  log: string[];
  openGate: () => void;
}> {
  return (async () => {
    const home = makeTempHome();
    const store = new DbToolStore(home);
    store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
    const projectA = path.join(os.tmpdir(), 'dbt-tx-test-proj-gated');
    store.grants.grant(normalizeProjectKey(projectA), CONN_ID, 'rw');
    const log: string[] = [];
    let gate: (() => void) | undefined;
    let inTx = false;
    const service = new DbToolService(store, {
      adapterResolver: async () => async (): Promise<DatabaseAdapter> => ({
        kind: 'mysql',
        connId: CONN_ID,
        testConnect: async (): Promise<TestConnectResult> => ({ ok: true }),
        query: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
        execute: async (sql: string): Promise<ExecResult> => {
          log.push(`execute:${sql}:start`);
          await new Promise<void>((r) => {
            gate = r;
          });
          log.push(`execute:${sql}:end`);
          return { affectedRows: 1, message: 'ok' };
        },
        listDatabases: async () => ['app'],
        listTables: async (): Promise<TableInfo[]> => [],
        describeTable: async (): Promise<ColumnInfo[]> => [],
        previewRows: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
        tx: {
          begin: async () => {
            if (inTx) throw new Error('事务已开启');
            inTx = true;
            log.push('BEGIN');
          },
          commit: async () => {
            if (!inTx) throw new Error('没有进行中的事务');
            inTx = false;
            log.push('COMMIT');
          },
          rollback: async () => {
            if (!inTx) throw new Error('没有进行中的事务');
            inTx = false;
            log.push('ROLLBACK');
          },
        },
        close: async () => {
          log.push('close');
        },
      }),
      challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
    });
    return { home, projectA, service, log, openGate: () => gate?.() };
  })();
}

describe('OCR 修复回归', () => {
  it('finish 排队在途语句之后：exec 未完成时 commit 不抢先提交（防语句落到 close 后的池连接跑在事务外）', async () => {
    const fx = await makeGatedFixture();
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      const execP = fx.service.consoleExec(sessionToken, "INSERT INTO t VALUES (1)"); // 挂起在 execute
      await sleep(20);
      expect(fx.log).toEqual(['BEGIN', 'execute:INSERT INTO t VALUES (1):start']);
      const commitP = fx.service.consoleCommit(sessionToken); // 须排队等 INSERT 完成
      await sleep(20);
      expect(fx.log).not.toContain('COMMIT');
      fx.openGate();
      await Promise.all([execP, commitP]);
      expect(fx.log).toEqual([
        'BEGIN',
        'execute:INSERT INTO t VALUES (1):start',
        'execute:INSERT INTO t VALUES (1):end',
        'COMMIT',
        'close',
      ]);
    } finally {
      await fx.service.dispose();
      cleanupDir(fx.home);
    }
  });

  it('并发 commit/rollback 竞态：恰好一个结算生效，COMMIT/ROLLBACK 与 close 各恰好一次', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const { sessionToken } = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      const settled = await Promise.allSettled([
        fx.service.consoleCommit(sessionToken),
        fx.service.consoleRollback(sessionToken),
      ]);
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const log = fx.logs[1]!;
      expect(log.filter((x) => x === 'COMMIT' || x === 'ROLLBACK')).toHaveLength(1);
      expect(log.filter((x) => x === 'close')).toHaveLength(1);
    } finally {
      await fx.dispose();
    }
  });

  it('begin 传 database 显式拒绝（粘性事务绑定连接默认库，禁止静默跑错库）', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      await expect(fx.service.consoleBegin(fx.projectA, CONN_ID, 'app')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      // 参数校验在 authorize 之前，不创建任何适配器
      expect(fx.logs).toHaveLength(0);
    } finally {
      await fx.dispose();
    }
  });

  it('单连接会话数达上限后拒绝（INVALID_ARGUMENT），不建新适配器', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    try {
      for (let i = 0; i < 4; i++) await fx.service.consoleBegin(fx.projectA, CONN_ID);
      await expect(fx.service.consoleBegin(fx.projectA, CONN_ID)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      // authorize 缓存适配器 1 + 会话适配器 4；第 5 次在建适配器前拒绝
      expect(fx.logs).toHaveLength(5);
    } finally {
      await fx.dispose();
    }
  });

  it('updateConnection / removeConnection 回收该连接的控制台事务会话（旧凭据不滞留）', async () => {
    const fx = await makeTxFixture('rw', { tx: 'handle' });
    const fx2 = await makeTxFixture('rw', { tx: 'handle' });
    try {
      const t1 = await fx.service.consoleBegin(fx.projectA, CONN_ID);
      fx.service.updateConnection(CONN_ID, { name: 'renamed' });
      await expect(fx.service.consoleExec(t1.sessionToken, 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await sleep(20);
      expect(fx.logs[1]).toContain('ROLLBACK');
      expect(fx.logs[1]).toContain('close');

      const t2 = await fx2.service.consoleBegin(fx2.projectA, CONN_ID);
      fx2.service.removeConnection(CONN_ID);
      await expect(fx2.service.consoleExec(t2.sessionToken, 'SELECT 1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await sleep(20);
      expect(fx2.logs[1]).toContain('ROLLBACK');
    } finally {
      await fx.dispose();
      await fx2.dispose();
    }
  });

  it('注册前授权复核：authorize 之后、注册之前授权被撤销 → 拒绝且回滚 close，不留滞留会话', async () => {
    const home = makeTempHome();
    try {
      const store = new DbToolStore(home);
      store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
      const projectA = path.join(os.tmpdir(), 'dbt-tx-test-proj-toctou');
      store.grants.grant(normalizeProjectKey(projectA), CONN_ID, 'rw');
      const log: string[] = [];
      const service = new DbToolService(store, {
        adapterResolver: async () => async () => {
          // 模拟 authorize → 会话注册之间的授权变更窗口（TOCTOU）
          store.grants.revoke(normalizeProjectKey(projectA), CONN_ID);
          return fakeHandleTxAdapter(log);
        },
        challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
      });
      await expect(service.consoleBegin(projectA, CONN_ID)).rejects.toMatchObject({ code: 'UNAUTHORIZED_PROJECT' });
      expect(log).toEqual(expect.arrayContaining(['ROLLBACK', 'close']));
      expect(service.auditTail(projectA, 100).some((e) => e.action === 'console_begin' && !e.ok)).toBe(true);
    } finally {
      cleanupDir(home);
    }
  });
});
