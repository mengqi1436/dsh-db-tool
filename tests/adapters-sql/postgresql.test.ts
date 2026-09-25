/**
 * PostgreSQL 适配器真机集成测试——仅当 DBT_TEST_PG_URL 存在时运行，否则整体 skip。
 * 地址形如 postgres://user:pass@host:5432/db（需对 public schema 有 DDL 权限）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresqlAdapter } from '../../lib/adapters/postgresql/index.js';
import type { DatabaseAdapter, ResolvedConnection } from '../../lib/adapters/types.js';

const url = process.env.DBT_TEST_PG_URL;
const suite = url ? describe : describe.skip;

let adapter: DatabaseAdapter & { tx: { begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void> } };

const conn: ResolvedConnection = {
  meta: { id: 'pg-test', kind: 'postgresql' },
  ...(url ? { url } : {}),
};

suite('postgresql 适配器（真机，DBT_TEST_PG_URL 门控）', () => {
  // 钩子必须在 suite 回调内：skip 时随用例一起跳过，避免无 URL 时真连炸整个文件
  beforeAll(async () => {
    adapter = await createPostgresqlAdapter(conn);
    await adapter.execute('DROP TABLE IF EXISTS dbt_test_users');
    await adapter.execute(
      'CREATE TABLE dbt_test_users (id SERIAL PRIMARY KEY, name VARCHAR(64) NOT NULL, score NUMERIC(10,2), created TIMESTAMPTZ)',
    );
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.execute('DROP TABLE IF EXISTS dbt_test_users').catch(() => {});
    await adapter.close();
  });

  it('testConnect 返回版本', async () => {
    const r = await adapter.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toMatch(/PostgreSQL/i);
  });

  it('execute 写入 + query 读取（占位符 $1）', async () => {
    const ex = await adapter.execute('INSERT INTO dbt_test_users (name, score, created) VALUES ($1, $2, NOW())', ['alice', '3.14']);
    expect(ex.affectedRows).toBe(1);
    const qr = await adapter.query('SELECT id, name, score FROM dbt_test_users WHERE name = $1', ['alice']);
    expect(qr.columns).toEqual(['id', 'name', 'score']);
    expect(qr.rows[0]?.[1]).toBe('alice');
    expect(qr.rows[0]?.[2]).toBe('3.14'); // NUMERIC 保持 string
  });

  it('listDatabases / listTables / describeTable（主键+注释）', async () => {
    const dbs = await adapter.listDatabases();
    expect(dbs.length).toBeGreaterThan(0);
    const tables = await adapter.listTables('public');
    expect(tables.some((t) => t.name === 'dbt_test_users' && t.type === 'TABLE')).toBe(true);
    await adapter.execute("COMMENT ON COLUMN dbt_test_users.name IS '名字'");
    const cols = await adapter.describeTable('dbt_test_users', 'public');
    expect(cols.find((c) => c.name === 'id')?.key).toBe('PRI');
    expect(cols.find((c) => c.name === 'name')?.comment).toBe('名字');
    expect(cols.find((c) => c.name === 'name')?.dataType).toBe('character varying(64)');
  });

  it('previewRows：LIMIT/OFFSET 参数化 + clamp', async () => {
    const r = await adapter.previewRows('dbt_test_users', 100, 'public');
    expect(r.rowCount).toBeLessThanOrEqual(50);
  });

  it('ro 模式：服务器级只读会话生效', async () => {
    const ro = (await createPostgresqlAdapter(conn, { mode: 'ro' })) as DatabaseAdapter;
    try {
      await ro.query('SELECT 1');
      await expect(ro.execute("INSERT INTO dbt_test_users (name) VALUES ('ro-write')")).rejects.toThrow(/read-only/i);
    } finally {
      await ro.close();
    }
  });

  it('事务 begin/commit/rollback（同一 client 生效）', async () => {
    await adapter.tx.begin();
    await adapter.execute("INSERT INTO dbt_test_users (name) VALUES ('tx-a')");
    await adapter.tx.commit();
    const qr = await adapter.query("SELECT COUNT(*)::int AS n FROM dbt_test_users WHERE name = 'tx-a'");
    expect(qr.rows[0]?.[0]).toBe(1);

    await adapter.tx.begin();
    await adapter.execute("INSERT INTO dbt_test_users (name) VALUES ('tx-b')");
    await adapter.tx.rollback();
    const qr2 = await adapter.query("SELECT COUNT(*)::int AS n FROM dbt_test_users WHERE name = 'tx-b'");
    expect(qr2.rows[0]?.[0]).toBe(0);
  });
});
