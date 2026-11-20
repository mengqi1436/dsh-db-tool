/**
 * MySQL 跨库路由（Navicat 式）离线契约测试（mock mysql2/promise，不连真库）。
 *
 * mysql2 官方结论：池上 changeUser/USE 只影响被调用的那条池内连接，多库方案是多池管理。
 * 本文件锁定实现契约：query/execute 第三参 database 按库名建池缓存路由；
 * URL path 首段 / fields.database 对应的主库复用主池；ro 跨库池同样挂只读监听；
 * close 级联关闭全部池且幂等；close 后不再新建池（防泄漏）；事务粘主池。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMysqlAdapter } from '../../lib/adapters/mysql/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

/** 记录型 createPool mock：每个池记录建池 opts、请求序列、connection 监听与 end 次数 */
const { createPoolMock, pools } = vi.hoisted(() => {
  type Req = { fn: string; sql: string; params: unknown[] };
  const pools: Array<{
    opts: Record<string, unknown>;
    requests: Req[];
    /** 预置响应队列（按 query 调用顺序出队，形如 [rows, fields]）；空则回退默认空结果 */
    scripted: Array<[unknown[], unknown[]]>;
    connectionListeners: Array<(c: unknown) => void>;
    ended: number;
    on(ev: string, cb: (c: unknown) => void): unknown;
    query(sql: string, params?: unknown[]): Promise<[unknown[], unknown[]]>;
    execute(sql: string, params?: unknown[]): Promise<[{ affectedRows: number }, undefined]>;
    getConnection(): Promise<Record<string, unknown>>;
    end(): Promise<void>;
  }> = [];
  const createPoolMock = vi.fn((opts: Record<string, unknown>) => {
    const p = {
      opts,
      requests: [] as Req[],
      scripted: [] as Array<[unknown[], unknown[]]>,
      connectionListeners: [] as Array<(c: unknown) => void>,
      ended: 0,
      // mysql2 池的 on 支持链式；这里只需记录 'connection' 监听（ro 会话注册断言用）
      on(ev: string, cb: (c: unknown) => void) {
        if (ev === 'connection') this.connectionListeners.push(cb);
        return this;
      },
      async query(sql: string, params?: unknown[]): Promise<[unknown[], unknown[]]> {
        this.requests.push({ fn: 'query', sql, params: params ?? [] });
        if (this.scripted.length) return this.scripted.shift()!;
        return [[], []];
      },
      async execute(sql: string, params?: unknown[]): Promise<[{ affectedRows: number }, undefined]> {
        this.requests.push({ fn: 'execute', sql, params: params ?? [] });
        return [{ affectedRows: 1 }, undefined];
      },
      async getConnection() {
        // FakeConnection：事务路径的最低依赖面（beginTransaction/commit/rollback async、release 同步）
        const self = this;
        return {
          beginTransaction: async () => {},
          commit: async () => {},
          rollback: async () => {},
          release: () => {},
          query(sql: string, params?: unknown[]) {
            self.requests.push({ fn: 'txQuery', sql, params: params ?? [] });
            return Promise.resolve([[], []]);
          },
          execute(sql: string, params?: unknown[]) {
            self.requests.push({ fn: 'txExecute', sql, params: params ?? [] });
            return Promise.resolve([{ affectedRows: 1 }, undefined]);
          },
        };
      },
      async end() {
        this.ended += 1;
      },
    };
    pools.push(p);
    return p;
  });
  return { createPoolMock, pools };
});

vi.mock('mysql2/promise', () => ({ default: { createPool: createPoolMock } }));

function connByUrl(url: string): ResolvedConnection {
  return { meta: { id: 'mysql-cross-db', kind: 'mysql' }, url };
}

describe('mysql 跨库路由（按库名建池缓存）', () => {
  beforeEach(() => {
    pools.length = 0;
    createPoolMock.mockClear();
  });

  it('query 带 database：按库名新建池，SQL 发到跨库池、主池零请求', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      await a.query('SELECT 1', [], 'db2');
      expect(createPoolMock).toHaveBeenCalledTimes(2);
      expect(pools[1]!.opts.database).toBe('db2');
      expect(pools[1]!.requests).toHaveLength(1);
      expect(pools[0]!.requests).toHaveLength(0); // 主池零请求
    } finally {
      await a.close();
    }
  });

  it('同库两次 query 只建一次池（缓存复用）', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      await a.query('SELECT 1', [], 'db2');
      await a.query('SELECT 2', [], 'db2');
      expect(createPoolMock).toHaveBeenCalledTimes(2); // 主池 + db2 池
      expect(pools[1]!.requests).toHaveLength(2);
    } finally {
      await a.close();
    }
  });

  it('database 等于连接默认库（URL path 首段）复用主池不新建', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      await a.query('SELECT 1', [], 'maindb');
      expect(createPoolMock).toHaveBeenCalledTimes(1); // 仅建池时的主池
      expect(pools[0]!.requests).toHaveLength(1);
    } finally {
      await a.close();
    }
  });

  it('fields 模式：fields.database 是主库，其他库名建池、主库名复用主池', async () => {
    const a = await createMysqlAdapter({
      meta: { id: 'mysql-cross-db', kind: 'mysql' },
      fields: { host: '127.0.0.1', port: 3326, user: 'u', database: 'fdb' },
    });
    try {
      await a.query('SELECT 1', [], 'other');
      await a.query('SELECT 2', [], 'fdb');
      expect(createPoolMock).toHaveBeenCalledTimes(2);
      expect(pools[1]!.opts.database).toBe('other');
      expect(pools[1]!.requests).toHaveLength(1);
      expect(pools[0]!.requests).toHaveLength(1); // fdb 走主池
    } finally {
      await a.close();
    }
  });

  it('URL 无 path 段（无默认库）：任意 database 建独立池', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326'));
    try {
      await a.query('SELECT 1', [], 'anydb');
      expect(createPoolMock).toHaveBeenCalledTimes(2);
      expect(pools[1]!.opts.database).toBe('anydb');
    } finally {
      await a.close();
    }
  });

  it('execute 带 database 同样按库名路由', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      await a.execute('UPDATE t SET x = 1', [], 'db2');
      expect(createPoolMock).toHaveBeenCalledTimes(2);
      expect(pools[1]!.requests.map((r) => r.fn)).toEqual(['execute']);
      expect(pools[0]!.requests).toHaveLength(0);
    } finally {
      await a.close();
    }
  });

  it('ro：写语句带 database 在建池前被拒（不新建池）；跨库池同样挂只读监听', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'), { mode: 'ro' });
    try {
      await expect(a.query('UPDATE t SET x = 1', [], 'otherdb')).rejects.toThrow(/只读/);
      expect(createPoolMock).toHaveBeenCalledTimes(1); // 拒绝发生在建跨库池之前
      await a.query('SELECT 1', [], 'otherdb');
      expect(createPoolMock).toHaveBeenCalledTimes(2);
      expect(pools[1]!.connectionListeners).toHaveLength(1); // 跨库池同样注册会话只读
      expect(pools[0]!.connectionListeners).toHaveLength(1); // 主池行为不变
    } finally {
      await a.close();
    }
  });

  it('close 级联：主池与跨库池均 end，二次 close 幂等（不重复关）', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    await a.query('SELECT 1', [], 'db2');
    await a.close();
    expect(pools[0]!.ended).toBe(1);
    expect(pools[1]!.ended).toBe(1);
    await expect(a.close()).resolves.toBeUndefined();
    expect(pools[0]!.ended).toBe(1);
    expect(pools[1]!.ended).toBe(1);
  });

  it('close 后 query/execute 带 database：中文「已关闭」且不新建池（不泄漏）', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    await a.close();
    await expect(a.query('SELECT 1', [], 'otherdb')).rejects.toThrow(/已关闭/);
    await expect(a.execute('UPDATE t SET x = 1', [], 'otherdb')).rejects.toThrow(/已关闭/);
    expect(createPoolMock).toHaveBeenCalledTimes(1); // 关闭后未新建跨库池
  });

  it('非法库名（空/换行/NUL/超 128）被校验拒绝且不建池', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      for (const bad of ['', 'db\nc', 'x'.repeat(129), 'db\0x']) {
        await expect(a.query('SELECT 1', [], bad), `应拒绝: ${JSON.stringify(bad)}`).rejects.toThrow(/非法库名/);
      }
      expect(createPoolMock).toHaveBeenCalledTimes(1); // 校验发生在建池之前
    } finally {
      await a.close();
    }
  });

  it('特殊字符库名 db;x 通过校验并按原名建池（防误加字符白名单的回归锚定）', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      await a.query('SELECT 1', [], 'db;x');
      expect(createPoolMock).toHaveBeenCalledTimes(2);
      expect(pools[1]!.opts.database).toBe('db;x');
    } finally {
      await a.close();
    }
  });

  it('事务粘主池：begin 后无 database 的 query/execute 走事务连接、不建池', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/maindb'));
    try {
      const tx = a.tx as { begin(): Promise<void>; commit(): Promise<void> };
      await tx.begin();
      await a.query('SELECT 1');
      await a.execute('UPDATE t SET x = 1');
      expect(pools[0]!.requests.map((r) => r.fn)).toEqual(['txQuery', 'txExecute']);
      expect(createPoolMock).toHaveBeenCalledTimes(1); // 事务期间不建跨库池
      await tx.commit();
    } finally {
      await a.close();
    }
  });
});

describe('mysql 数据浏览计数与内容搜索（countRows/searchRows SQL 契约）', () => {
  beforeEach(() => {
    pools.length = 0;
    createPoolMock.mockClear();
  });

  it('countRows：COUNT(*) AS n + Number 归一；带 search 时先探测列再拼跨列谓词', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/app'));
    try {
      const p = pools[0]!;
      p.scripted = [[[{ n: '61' }], []]];
      expect(await a.countRows!('users')).toBe(61);
      expect(p.requests[0]).toEqual({ fn: 'query', sql: 'SELECT COUNT(*) AS n FROM `app`.`users`', params: [] });

      p.requests.length = 0;
      p.scripted = [
        [[], [{ name: 'id' }, { name: 'na`me' }]], // WHERE 1=0 的列探测 fields
        [[{ n: '7' }], []],
      ];
      expect(await a.countRows!('users', undefined, 'a%b_c')).toBe(7);
      expect(p.requests[0]).toEqual({ fn: 'query', sql: 'SELECT * FROM `app`.`users` WHERE 1=0', params: [] });
      expect(p.requests[1]).toEqual({
        fn: 'query',
        sql: "SELECT COUNT(*) AS n FROM `app`.`users` WHERE (`id` LIKE ? ESCAPE '#' OR `na``me` LIKE ? ESCAPE '#')",
        params: ['%a#%b#_c%', '%a#%b#_c%'],
      });
    } finally {
      await a.close();
    }
  });

  it('searchRows：跨列 LIKE + LIMIT/OFFSET 尾随绑定，行/列走 toQueryResult', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/app'));
    try {
      const p = pools[0]!;
      p.scripted = [
        [[], [{ name: 'id' }, { name: 'name' }]],
        [[{ id: 1, name: 'alice' }], [{ name: 'id' }, { name: 'name' }]],
      ];
      const r = await a.searchRows!('users', 'bob', 50, undefined, 50);
      expect(p.requests[0]).toEqual({ fn: 'query', sql: 'SELECT * FROM `app`.`users` WHERE 1=0', params: [] });
      expect(p.requests[1]).toEqual({
        fn: 'query',
        sql: "SELECT * FROM `app`.`users` WHERE (`id` LIKE ? ESCAPE '#' OR `name` LIKE ? ESCAPE '#') LIMIT ? OFFSET ?",
        params: ['%bob%', '%bob%', 50, 50],
      });
      expect(r).toMatchObject({ columns: ['id', 'name'], rows: [[1, 'alice']], rowCount: 1 });
    } finally {
      await a.close();
    }
  });

  it('无列（探测 fields 为空）：searchRows 空结果、countRows(search) 恒 0', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/app'));
    try {
      const p = pools[0]!;
      p.scripted = [[[], []], [[], []]];
      expect(await a.searchRows!('empty_t', 'kw', 50)).toMatchObject({ columns: [], rows: [], rowCount: 0 });
      expect(await a.countRows!('empty_t', undefined, 'kw')).toBe(0);
    } finally {
      await a.close();
    }
  });
});
