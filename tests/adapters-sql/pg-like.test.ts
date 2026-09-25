/**
 * pg / gaussdb 共享实现 createPgLikeAdapter 的 mock 驱动单测（离线可跑）。
 * 覆盖：query 规范化、execute、元数据 SQL、ro 会话只读、事务路由、防注入、limit 钳制。
 */
import { describe, expect, it } from 'vitest';
import {
  createPgLikeAdapter,
  type PgLikeClient,
  type PgLikeDriver,
  type PgLikePool,
} from '../../lib/adapters/sql-shared/pg-like.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

class FakeClient implements PgLikeClient {
  executed: { sql: string; params: unknown[] | undefined }[] = [];
  released = 0;
  releaseErr: unknown;
  constructor(
    private pool: FakePool,
    public result: { rows: Record<string, unknown>[]; fields?: { name: string }[]; rowCount: number | null } = { rows: [], rowCount: null },
    public failSqlPrefix?: string,
  ) {}
  async query(sql: string, params?: unknown[]) {
    if (this.failSqlPrefix && sql.startsWith(this.failSqlPrefix)) throw new Error(`mock SET 失败: ${sql}`);
    this.executed.push({ sql, params });
    return this.result;
  }
  release(err?: unknown) {
    this.released++;
    this.releaseErr = err;
    this.pool.liveClients = this.pool.liveClients.filter((c) => c !== this);
  }
}

class FakePool implements PgLikePool {
  connectHandlers: ((c: PgLikeClient) => void)[] = [];
  errorHandlers: ((c: PgLikeClient) => void)[] = [];
  liveClients: FakeClient[] = [];
  executed: { sql: string; params: unknown[] | undefined }[] = [];
  ended = 0;
  /** 每次 pool.query 返回的结果（按序出队） */
  queue: { rows: Record<string, unknown>[]; fields?: { name: string }[]; rowCount: number | null }[] = [];
  /** 注入：新建 client 对匹配前缀的 SQL 抛错（模拟 ro SET 失败） */
  clientFailSqlPrefix?: string;

  on(event: string, cb: (c: PgLikeClient) => void) {
    if (event === 'connect') this.connectHandlers.push(cb);
    else if (event === 'error') this.errorHandlers.push(cb);
    return this;
  }
  async query(sql: string, params?: unknown[]) {
    this.executed.push({ sql, params });
    const res = this.queue.shift() ?? { rows: [], rowCount: null };
    return res;
  }
  async connect() {
    const c = new FakeClient(this, { rows: [], rowCount: null }, this.clientFailSqlPrefix);
    this.liveClients.push(c);
    for (const h of this.connectHandlers) h(c);
    return c;
  }
  async end() {
    this.ended++;
  }
}

function conn(fields?: Record<string, unknown>): ResolvedConnection {
  return { meta: { id: 'c1', kind: 'postgresql' }, ...(fields ? { fields } : { url: 'postgres://u:p@h:5432/db' }) };
}

function okRes(rows: Record<string, unknown>[], fields?: string[], rowCount?: number) {
  return {
    rows,
    ...(fields ? { fields: fields.map((name) => ({ name })) } : {}),
    rowCount: rowCount ?? rows.length,
  };
}

describe('createPgLikeAdapter（mock 驱动）', () => {
  // createPgLikeAdapter 内部 new Driver.Pool(...)，用箭头构造器捕获同一 FakePool 实例
  async function make(kind: 'postgresql' | 'gaussdb', fields?: Record<string, unknown>) {
    const pool = new FakePool();
    const driver: PgLikeDriver = {
      Pool: function () { return pool; } as unknown as PgLikeDriver['Pool'],
    };
    const a = await createPgLikeAdapter(kind, driver, conn(fields));
    return { a, pool };
  }

  it('query 规范化 + 参数透传', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [
      okRes(
        [
          { id: 1, name: 'a', created: new Date('2024-01-02T03:04:05.000Z'), blob: Buffer.from([9]), extra: { x: 1 }, n: null },
        ],
        ['id', 'name', 'created', 'blob', 'extra', 'n'],
      ),
    ];
    const r = await a.query('SELECT * FROM t WHERE id = $1', [1]);
    expect(pool.executed[0]).toEqual({ sql: 'SELECT * FROM t WHERE id = $1', params: [1] });
    expect(r.columns).toEqual(['id', 'name', 'created', 'blob', 'extra', 'n']);
    expect(r.rows[0]).toEqual([1, 'a', '2024-01-02T03:04:05.000Z', '[BLOB 1 bytes]', '{"x":1}', null]);
    expect(r.rowCount).toBe(1);
  });

  it('query：fields 缺失时从首行推导列', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [okRes([{ b: 2, a: 1 }])];
    const r = await a.query('SELECT 1');
    expect(r.columns).toEqual(['b', 'a']);
  });

  it('execute 返回受影响行数与消息', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [{ rows: [], rowCount: 3 }];
    const r = await a.execute('UPDATE t SET x = 1');
    expect(r.affectedRows).toBe(3);
    expect(r.message).toContain('3');
  });

  it('listDatabases 使用官方查询', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [okRes([{ datname: 'postgres' }, { datname: 'demo' }])];
    const dbs = await a.listDatabases();
    expect(dbs).toEqual(['postgres', 'demo']);
    expect(pool.executed[0]?.sql).toContain('pg_database');
  });

  it('listSchemas 列 pg_namespace 用户模式，排除 pg_* 与 information_schema', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [okRes([{ nspname: 'app' }, { nspname: 'public' }])];
    const schemas = await a.listSchemas!();
    expect(schemas).toEqual(['app', 'public']);
    expect(pool.executed[0]?.sql).toContain('pg_namespace');
    expect(pool.executed[0]?.sql).toContain("NOT LIKE 'pg\\_%'");
    expect(pool.executed[0]?.sql).toContain("<> 'information_schema'");
  });

  it('gaussdb 同样具备 listSchemas（官方三层层级）', async () => {
    const { a, pool } = await make('gaussdb');
    pool.queue = [okRes([{ nspname: 'public' }])];
    expect(await a.listSchemas!()).toEqual(['public']);
  });

  it('listTables：BASE TABLE→TABLE，默认 schema public', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [okRes([{ table_name: 'users', table_type: 'BASE TABLE' }, { table_name: 'v1', table_type: 'VIEW' }])];
    const tables = await a.listTables();
    expect(tables[0]).toMatchObject({ name: 'users', type: 'TABLE', database: 'public' });
    expect(pool.executed[0]?.params).toEqual(['public']);
  });

  it('describeTable：主键 PRI + 注释 + 类型长度拼接', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [
      okRes(
        [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, col_comment: '主键' },
          { column_name: 'name', data_type: 'character varying', is_nullable: 'YES', column_default: null, character_maximum_length: 255, col_comment: null },
        ],
        undefined,
      ),
      okRes([{ column_name: 'id' }]),
    ];
    const cols = await a.describeTable('users');
    expect(cols[0]).toMatchObject({ name: 'id', dataType: 'integer', nullable: false, key: 'PRI', comment: '主键' });
    expect(cols[1]).toMatchObject({ name: 'name', dataType: 'character varying(255)', nullable: true, key: undefined });
    expect(pool.executed[0]?.sql).toContain('col_description');
  });

  it('previewRows：quoteIdent + LIMIT/OFFSET 绑定 + clamp 50', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [okRes([{ id: 1 }], ['id'])];
    const r = await a.previewRows('users', 999);
    expect(pool.executed[0]?.sql).toBe('SELECT * FROM "public"."users" LIMIT $1 OFFSET $2');
    expect(pool.executed[0]?.params).toEqual([50, 0]);
    expect(r.rowCount).toBe(1);
  });

  it('previewRows offset 透传（第 4 参数，缺省 0）', async () => {
    const { a, pool } = await make('postgresql');
    pool.queue = [okRes([], ['id']), okRes([], ['id'])];
    await a.previewRows('users', 50, 'public', 10);
    expect(pool.executed[0]?.sql).toBe('SELECT * FROM "public"."users" LIMIT $1 OFFSET $2');
    expect(pool.executed[0]?.params).toEqual([50, 10]); // OFFSET 10
    await a.previewRows('users', 50);
    expect(pool.executed[1]?.params).toEqual([50, 0]);
  });

  it('ro 模式：connect 钩子设置只读会话', async () => {
    const pool = new FakePool();
    const driver: PgLikeDriver = { Pool: function () { return pool; } as unknown as PgLikeDriver['Pool'] };
    await createPgLikeAdapter('postgresql', driver, conn(), { mode: 'ro' });
    expect(pool.connectHandlers.length).toBe(1);
    const c = await pool.connect();
    expect(c.executed[0]?.sql).toBe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  });

  it('ro 模式：会话级 SET 失败 → fail-closed（release(err) 销毁连接）', async () => {
    const pool = new FakePool();
    pool.clientFailSqlPrefix = 'SET SESSION';
    const driver: PgLikeDriver = { Pool: function () { return pool; } as unknown as PgLikeDriver['Pool'] };
    await createPgLikeAdapter('postgresql', driver, conn(), { mode: 'ro' });
    const c = await pool.connect(); // 触发 connect 钩子 → SET reject → release(err)
    await new Promise((r) => setTimeout(r, 0)); // flush 微任务，让 .catch 执行
    expect(c.released).toBe(1);
    expect(c.releaseErr).toBeInstanceOf(Error);
    expect(pool.liveClients.length).toBe(0); // 已被 release 移除
    expect(pool.errorHandlers.length).toBe(1); // 兜底监听 pool 'error' 防进程崩溃
    // 非 ro 模式不注册 error 兜底
    const { pool: p2 } = await make('postgresql');
    expect(p2.errorHandlers.length).toBe(0);
  });

  it('非 ro 模式不设置只读钩子', async () => {
    const { pool } = await make('postgresql');
    await pool.connect();
    expect(pool.connectHandlers.length).toBe(0);
  });

  it('事务：begin 后 query 路由到同一 client，commit 释放', async () => {
    const { a, pool } = await make('postgresql');
    await a.tx.begin();
    expect(pool.liveClients.length).toBe(1);
    const c = pool.liveClients[0];
    await a.query('SELECT 1');
    expect(c?.executed[0]?.sql).toBe('BEGIN');
    expect(c?.executed[1]?.sql).toBe('SELECT 1');
    await a.tx.commit();
    expect(c?.released).toBe(1);
    expect(pool.executed.some((e) => e.sql === 'SELECT 1')).toBe(false);
  });

  it('事务：rollback 回滚并释放；重复 begin 报错；无事务 commit 报错', async () => {
    const { a, pool } = await make('postgresql');
    await a.tx.begin();
    await a.tx.rollback();
    expect(pool.liveClients.length).toBe(0);
    await expect(a.tx.rollback()).rejects.toThrow('没有进行中的事务');
    await a.tx.begin();
    await expect(a.tx.begin()).rejects.toThrow('事务已开启');
    await a.tx.rollback();
  });

  it('kind/connId/close', async () => {
    const g = await make('gaussdb');
    expect(g.a.kind).toBe('gaussdb');
    const p = await make('postgresql', { schema: 'app' });
    expect(p.a.connId).toBe('c1');
    await p.a.close();
    expect(p.pool.ended).toBe(1);
  });

  it('注入类标识符被安全处理：参数绑定 + 引号转义（不再字符白名单拒绝）', async () => {
    const { a, pool } = await make('postgresql');
    // describeTable 走参数绑定：注入串只是普通表名 → 查无此表
    await expect(a.describeTable('u"; DROP TABLE x')).rejects.toThrow(/表不存在/);
    // listTables 绑定库名 → 空结果，绝不执行注入
    await expect(a.listTables('pub; drop')).resolves.toEqual([]);
    // previewRows：标识符被引用为 "t--" 普通表名（含连字符合法）
    await a.previewRows('t--', 10);
    const sql = pool.executed.at(-1)!.sql;
    expect(sql).toContain('FROM "public"."t--"');
    // NUL/换行仍被直接拒绝（引用标识符内也不允许）
    await expect(a.describeTable('a\nb')).rejects.toThrow(/非法/);
    await expect(a.previewRows('a\0b', 10)).rejects.toThrow(/非法/);
  });

  it('SSL 开关注入配置', async () => {
    // 只验证不抛错：url + ssl=true 走 connectionString 分支
    const pool = new FakePool();
    const driver: PgLikeDriver = { Pool: function () { return pool; } as unknown as PgLikeDriver['Pool'] };
    const a = await createPgLikeAdapter(
      'postgresql',
      driver,
      { meta: { id: 'c2', kind: 'postgresql' }, url: 'postgres://u:p@h/db?ssl=true', ssl: true },
    );
    await a.testConnect();
    expect(pool.executed[0]?.sql).toContain('version()');
  });

  // 跨库浏览：Driver.Pool 按 config.database 建池（真实 pg 驱动语义），记录每次建池的库名
  async function makeMulti(opts?: { mode: 'ro' }) {
    const pools = new Map<string, FakePool>();
    const createdDb: string[] = [];
    const driver: PgLikeDriver = {
      Pool: function (config: { database?: string }) {
        const db = String(config?.database ?? 'postgres');
        createdDb.push(db);
        const p = new FakePool();
        pools.set(db, p);
        return p;
      } as unknown as PgLikeDriver['Pool'],
    };
    const a = await createPgLikeAdapter('postgresql', driver, conn(), opts);
    return { a, pools, createdDb };
  }

  it('跨库浏览：非连接库按库名开独立池并缓存复用', async () => {
    const { a, pools, createdDb } = await makeMulti();
    // 首次访问懒建 gycwd 池
    await a.listSchemas!('gycwd');
    const g = pools.get('gycwd')!;
    g.queue = [okRes([{ table_name: 't1', table_type: 'BASE TABLE' }])];
    const tables = await a.listTables('gycwd.public');
    expect(tables[0]).toMatchObject({ name: 't1', type: 'TABLE', database: 'gycwd.public' });
    // 池缓存：两次操作只建一次 gycwd 池
    expect(createdDb.filter((d) => d === 'gycwd').length).toBe(1);
    // describeTable / previewRows 走同一跨库池
    g.queue = [okRes([{ column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, character_maximum_length: null, col_comment: null }]), okRes([{ id: 1 }], ['id'])];
    expect((await a.describeTable('t1', 'gycwd.public'))[0]?.name).toBe('id');
    await a.previewRows('t1', 10, 'gycwd.public');
    expect(g.executed.at(-1)?.sql).toBe('SELECT * FROM "public"."t1" LIMIT $1 OFFSET $2');
    // 连接自身库（url 库名）不建新池
    await a.previewRows('t1', 10, 'postgres');
    expect(createdDb.filter((d) => d !== 'gycwd')).toEqual(['postgres']); // 主池仅初始化 1 次
    // close 连同跨库池一起关闭
    await a.close();
    expect(g.ended).toBe(1);
  });

  it('跨库目标解析：无点=当前库 schema；非法字符被拒', async () => {
    const { a, pools, createdDb } = await makeMulti();
    // 无点 → 当前库默认 schema（public），走主池
    pools.get('postgres')!.queue = [okRes([])];
    await expect(a.listTables('app')).resolves.toEqual([]);
    expect(createdDb.length).toBe(1); // 只有主池
    // "db.schema" 里的非法字符（NUL/换行）仍被 assertIdent 拒绝
    await expect(a.listTables('gycwd.a\nb')).rejects.toThrow(/非法/);
    await expect(a.previewRows('t', 10, 'gycwd.a\0b')).rejects.toThrow(/非法/);
  });

  it('跨库 ro：新开的库池同样注册只读会话钩子与 error 兜底', async () => {
    const { a, pools } = await makeMulti({ mode: 'ro' });
    await a.listSchemas!('other'); // 懒建 other 池
    const p = pools.get('other')!;
    expect(p.connectHandlers.length).toBe(1);
    expect(p.errorHandlers.length).toBe(1);
    const c = await p.connect();
    expect(c.executed[0]?.sql).toBe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  });

  it('query/execute 跨库：database 参数路由到目标库池，非法库名被拒', async () => {
    const { a, pools, createdDb } = await makeMulti();
    await a.query('SELECT 1', [], 'gycwd'); // 首次访问懒建 gycwd 池
    pools.get('gycwd')!.queue = [okRes([{ n: 1 }], ['n']), { rows: [], rowCount: 2 }];
    const r = await a.query('SELECT count(*) AS n FROM users', [], 'gycwd');
    expect(r.rowCount).toBe(1);
    expect(pools.get('gycwd')!.executed[1]).toEqual({ sql: 'SELECT count(*) AS n FROM users', params: [] });
    const e = await a.execute('UPDATE users SET age = 1', [], 'gycwd');
    expect(e.affectedRows).toBe(2);
    // 池缓存：多次都复用同一个 gycwd 池
    expect(createdDb.filter((d) => d === 'gycwd').length).toBe(1);
    // 非法库名（控制字符）直接拒绝，不建池
    await expect(a.query('SELECT 1', [], 'db\0x')).rejects.toThrow(/非法/);
    // 无 database → 主池（事务路由路径）
    await a.query('SELECT 1');
    expect(createdDb.filter((d) => d !== 'gycwd')).toEqual(['postgres']);
  });
});
