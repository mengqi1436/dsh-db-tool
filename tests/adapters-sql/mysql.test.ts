/**
 * MySQL 适配器真机集成测试——仅当 DBT_TEST_MYSQL_URL 存在时运行，否则整体 skip。
 * 地址形如 mysql://user:pass@host:3306/db（需对 db 有 DDL 权限）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMysqlAdapter } from '../../lib/adapters/mysql/index.js';
import type { TxHandle } from '../../lib/adapters/sql-shared/pg-like.js';
import type { DatabaseAdapter, ResolvedConnection } from '../../lib/adapters/types.js';

const url = process.env.DBT_TEST_MYSQL_URL;
const suite = url ? describe : describe.skip;

let adapter: DatabaseAdapter;

const conn: ResolvedConnection = {
  meta: { id: 'mysql-test', kind: 'mysql' },
  ...(url ? { url } : {}),
};

suite('mysql 适配器（真机，DBT_TEST_MYSQL_URL 门控）', () => {
  // 钩子必须在 suite 回调内：skip 时随用例一起跳过，避免无 URL 时真连炸整个文件
  beforeAll(async () => {
    adapter = await createMysqlAdapter(conn);
    await adapter.execute('DROP TABLE IF EXISTS dbt_test_users');
    await adapter.execute(
      'CREATE TABLE dbt_test_users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL, score DECIMAL(10,2), created DATETIME)',
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
    expect(r.serverInfo).toMatch(/MySQL/);
  });

  it('execute 写入 + query 读取（占位符 ?）', async () => {
    const ex = await adapter.execute('INSERT INTO dbt_test_users (name, score, created) VALUES (?, ?, NOW())', ['alice', '3.14']);
    expect(ex.affectedRows).toBe(1);
    const qr = await adapter.query('SELECT id, name, score FROM dbt_test_users WHERE name = ?', ['alice']);
    expect(qr.columns).toEqual(['id', 'name', 'score']);
    expect(qr.rows[0]?.[1]).toBe('alice');
    expect(qr.rows[0]?.[2]).toBe('3.14'); // DECIMAL 保持 string
  });

  it('dateStrings：DATETIME 输出字符串', async () => {
    await adapter.query('SELECT 1');
    const qr = await adapter.query('SELECT created FROM dbt_test_users LIMIT 1');
    expect(typeof qr.rows[0]?.[0]).toBe('string');
  });

  it('listDatabases / listTables / describeTable', async () => {
    const dbs = await adapter.listDatabases();
    expect(dbs.length).toBeGreaterThan(0);
    const tables = await adapter.listTables(dbs[0]);
    expect(Array.isArray(tables)).toBe(true);
    const cols = await adapter.describeTable('dbt_test_users');
    expect(cols.find((c) => c.name === 'id')?.key).toBe('PRI');
    expect(cols.find((c) => c.name === 'score')?.dataType).toBe('decimal(10,2)');
  });

  it('previewRows clamp 50 + 注入串安全引用', async () => {
    const r = await adapter.previewRows('dbt_test_users', 100);
    expect(r.rowCount).toBeLessThanOrEqual(50);
    // 注入串被反引号转义为普通表名：查无此表（注入永不执行）
    await expect(adapter.describeTable('u`; DROP TABLE x')).rejects.toThrow(/表不存在/);
  });

  it('事务 begin/commit（同一连接生效）', async () => {
    const a = adapter as DatabaseAdapter & { tx: TxHandle };
    await a.tx.begin();
    await adapter.execute("INSERT INTO dbt_test_users (name) VALUES ('tx-row')");
    await a.tx.commit();
    const qr = await adapter.query("SELECT COUNT(*) AS n FROM dbt_test_users WHERE name = 'tx-row'");
    expect(Number(qr.rows[0]?.[0])).toBe(1);
  });
});
