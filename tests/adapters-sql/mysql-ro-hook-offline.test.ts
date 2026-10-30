/**
 * mysql 适配器 ro 钩子的离线契约测试。
 *
 * 背景（真实故障，PR #1）：ro 模式下适配器在 `pool.on('connection')` 钩子里执行
 * `SET SESSION TRANSACTION READ ONLY`，若给返回的 Query 命令对象挂 `.on('error')` 监听，
 * 会打断 mysql2 池接管前的命令处理序列 → 连接状态机卡死 → 该连接后续一切查询永挂，
 * 表现为「测试连接成功但数据浏览树只显示 …」。
 *
 * 该故障的回归用例原本只在真机（`DBT_TEST_MYSQL_URL` 门控）里跑，CI 无 MySQL 时整文件
 * 跳过 → 修复没有自动化保护。本文件用注入的 Fake 驱动把「钩子注册形态」这一契约固定住：
 *   - ro 模式必须注册 connection 钩子；
 *   - 钩子内必须回调式调用（第二个参数是函数）；
 *   - **绝不可**对返回的 Query 命令对象挂 error 监听。
 * 任一条件被改回旧形态，这里立即变红，不需要真实数据库。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedConnection } from '../../lib/adapters/types.js';
import { createMysqlAdapter, type MysqlDriver } from '../../lib/adapters/mysql/index.js';

/** 记录 Query 命令对象上挂过哪些监听 */
interface QueryRecord {
  sql: string;
  argCount: number;
  secondArgIsFunction: boolean;
  /** 该命令对象上被注册的事件名（旧实现会在此出现 'error'） */
  listeners: string[];
}

class FakeQuery {
  listeners: string[] = [];
  on(event: string): this {
    this.listeners.push(event);
    return this;
  }
}

class FakeConnection {
  records: QueryRecord[];
  /** 本连接上创建过的所有 Query 命令对象（含各自的监听注册） */
  queries: FakeQuery[] = [];

  constructor(records: QueryRecord[]) {
    this.records = records;
  }

  /**
   * callback 版连接：`query(sql, cb)` 返回 Query 命令对象（EventEmitter）。
   * 若只传一个参数（非回调式），真实 mysql2 会走另一条路径并与 promise 池冲突。
   */
  query(sql: string, cb?: (err: unknown, rows?: unknown[]) => void): FakeQuery {
    const q = new FakeQuery();
    this.queries.push(q);
    this.records.push({
      sql,
      argCount: cb === undefined ? 1 : 2,
      secondArgIsFunction: typeof cb === 'function',
      listeners: q.listeners,
    });
    // 模仿真实行为：有回调则异步回调（空回调也要被调用）
    if (typeof cb === 'function') setImmediate(() => cb(null, []));
    return q;
  }

  /** 该连接上所有 Query 命令对象被注册过的事件名合集 */
  allListeners(): string[] {
    return this.queries.flatMap((q) => q.listeners);
  }
}

/** 最小 Fake 池：只需 on / query / end 等适配器实际会碰的表面 */
class FakePool {
  readonly connectionHandlers: Array<(c: FakeConnection) => void> = [];
  readonly records: QueryRecord[] = [];
  closed = 0;

  constructor(readonly config: Record<string, unknown>) {}

  on(event: string, cb: (c: FakeConnection) => void): this {
    if (event === 'connection') this.connectionHandlers.push(cb);
    return this;
  }

  /** 模拟「池新建了一条底层连接」→ 触发所有 connection 钩子 */
  emitConnection(): FakeConnection {
    const conn = new FakeConnection(this.records);
    for (const h of this.connectionHandlers) h(conn);
    return conn;
  }

  async query(): Promise<[unknown[], unknown[]]> {
    return [[], []];
  }

  async end(): Promise<void> {
    this.closed++;
  }

  async getConnection(): Promise<{ query: () => Promise<unknown[]>; release: () => void }> {
    return { query: async () => [], release: () => {} };
  }
}

/** 记录所有被创建出来的池，便于断言跨库池是否也注册了 ro 钩子 */
class FakeDriver implements MysqlDriver {
  readonly pools: FakePool[] = [];

  createPool(opts: Parameters<MysqlDriver['createPool']>[0]): ReturnType<MysqlDriver['createPool']> {
    const p = new FakePool(opts as unknown as Record<string, unknown>);
    this.pools.push(p);
    return p as unknown as ReturnType<MysqlDriver['createPool']>;
  }
}

const conn = (): ResolvedConnection => ({
  meta: { id: 'c1', kind: 'mysql', mode: 'fields' },
  fields: { host: '127.0.0.1', user: 'u', password: 'p', database: 'shop' },
});

describe('mysql ro 钩子注册形态（离线契约）', () => {
  it('ro 模式必须注册 connection 钩子', async () => {
    const driver = new FakeDriver();
    const a = await createMysqlAdapter(conn(), { mode: 'ro', driver });
    expect(driver.pools).toHaveLength(1);
    expect(driver.pools[0]!.connectionHandlers).toHaveLength(1);
    await a.close();
  });

  it('rw 模式不得注册 connection 钩子（不做会话级只读设置）', async () => {
    const driver = new FakeDriver();
    const a = await createMysqlAdapter(conn(), { mode: 'rw', driver });
    expect(driver.pools[0]!.connectionHandlers).toHaveLength(0);
    await a.close();
  });

  it('ro 钩子必须回调式执行 SET SESSION TRANSACTION READ ONLY', async () => {
    const driver = new FakeDriver();
    const a = await createMysqlAdapter(conn(), { mode: 'ro', driver });
    const pool = driver.pools[0]!;

    pool.emitConnection();
    expect(pool.records).toHaveLength(1);

    const rec = pool.records[0]!;
    expect(rec.sql).toBe('SET SESSION TRANSACTION READ ONLY');
    // 非回调式（只传 sql）会与 promise 池的连接建立序列冲突 —— 必须两个参数
    expect(rec.argCount).toBe(2);
    expect(rec.secondArgIsFunction).toBe(true);
    await a.close();
  });

  it('ro 钩子绝不能给 Query 命令对象挂 error 监听（挂即连接卡死）', async () => {
    const driver = new FakeDriver();
    const a = await createMysqlAdapter(conn(), { mode: 'ro', driver });
    const pool = driver.pools[0]!;

    const fakeConn = pool.emitConnection();
    // 这是本用例的核心断言：旧实现的 swallowSetError 会在此处留下 'error'
    expect(fakeConn.allListeners()).not.toContain('error');
    expect(fakeConn.allListeners()).toHaveLength(0);
    await a.close();
  });

  it('跨库池同样注册 ro 钩子、且同样不挂 error 监听', async () => {
    const driver = new FakeDriver();
    const a = await createMysqlAdapter(conn(), { mode: 'ro', driver });

    // 跨库池由 query/execute 的 database 参数触发（listTables 走主池，不建跨库池）
    await a.query('SELECT 1', [], 'other').catch(() => {});

    expect(driver.pools.length).toBeGreaterThanOrEqual(2);
    const crossPool = driver.pools[1]!;
    expect(crossPool.connectionHandlers).toHaveLength(1);

    const fakeConn = crossPool.emitConnection();
    expect(crossPool.records[0]!.sql).toBe('SET SESSION TRANSACTION READ ONLY');
    expect(fakeConn.allListeners()).not.toContain('error');
    await a.close();
  });

  it('关闭后不再新建跨库池（ro 钩子不会在关闭后继续注册）', async () => {
    const driver = new FakeDriver();
    const a = await createMysqlAdapter(conn(), { mode: 'ro', driver });
    const before = driver.pools.length;
    await a.close();
    await expect(a.query('SELECT 1', [], 'another')).rejects.toThrow(/已关闭/);
    expect(driver.pools.length).toBe(before);
  });
});
