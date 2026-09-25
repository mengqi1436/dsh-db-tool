/**
 * SQLite 适配器真机全流程测试（离线可跑，临时 .db 文件）。
 */
// @ts-nocheck

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteAdapter } from '../../lib/adapters/sqlite/index.js';
import type { DatabaseAdapter, ResolvedConnection } from '../../lib/adapters/types.js';

let dir: string;
let file: string;
let adapter: DatabaseAdapter;
let ro: DatabaseAdapter;

function conn(database?: string): ResolvedConnection {
  return {
    meta: { id: 'sqlite-test', kind: 'sqlite' },
    fields: database != null ? { database } : undefined,
    ...(database != null ? {} : { url: `file://${file}` }),
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dbt-sqlite-'));
  file = join(dir, 'test.db');
  const seed = new Database(file);
  seed.exec(
    'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL, data BLOB);' +
      'CREATE VIEW v_users AS SELECT id, name FROM users;',
  );
  const ins = seed.prepare('INSERT INTO users (name, score, data) VALUES (?, ?, ?)');
  for (let i = 1; i <= 60; i++) {
    ins.run(`user${i}`, i * 1.5, Buffer.from([1, 2, 3]));
  }
  seed.close();
  adapter = await createSqliteAdapter(conn());
  ro = await createSqliteAdapter({ meta: { id: 'sqlite-ro', kind: 'sqlite' }, fields: { database: file } }, { mode: 'ro' });
});

afterAll(async () => {
  await adapter?.close();
  await ro?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('sqlite 适配器（真机）', () => {
  it('testConnect 返回版本', async () => {
    const r = await adapter.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toMatch(/^SQLite \d/);
  });

  it('query 返回规范化行列', async () => {
    const r = await adapter.query('SELECT * FROM users ORDER BY id LIMIT 2');
    expect(r.columns).toEqual(['id', 'name', 'score', 'data']);
    expect(r.rowCount).toBe(2);
    expect(r.rows[0]).toEqual([1, 'user1', 1.5, '[BLOB 3 bytes]']);
  });

  it('query 支持 ? 参数绑定', async () => {
    const r = await adapter.query('SELECT name FROM users WHERE id = ?', [5]);
    expect(r.rows[0]).toEqual(['user5']);
  });

  it('NULL 单元格 → null', async () => {
    const r = await adapter.query('SELECT score FROM users WHERE id = 1');
    expect(r.rows[0]).toEqual([1.5]);
    await adapter.execute('UPDATE users SET score = NULL WHERE id = 1');
    const r2 = await adapter.query('SELECT score FROM users WHERE id = 1');
    expect(r2.rows[0]).toEqual([null]);
  });

  it('execute 返回受影响行数', async () => {
    const r = await adapter.execute('INSERT INTO users (name, score) VALUES (?, ?)', ['bob', 9.9]);
    expect(r.affectedRows).toBe(1);
    expect(r.message).toContain('1');
  });

  it('listDatabases = [main]；listTables 含表与视图', async () => {
    expect(await adapter.listDatabases()).toEqual(['main']);
    const tables = await adapter.listTables();
    const names = tables.map((t) => t.name);
    expect(names).toContain('users');
    expect(names).toContain('v_users');
    expect(tables.find((t) => t.name === 'users')?.type).toBe('TABLE');
    expect(tables.find((t) => t.name === 'v_users')?.type).toBe('VIEW');
  });

  it('describeTable 标注主键 PRI 与可空性', async () => {
    const cols = await adapter.describeTable('users');
    expect(cols.map((c) => c.name)).toEqual(['id', 'name', 'score', 'data']);
    expect(cols[0]?.key).toBe('PRI');
    expect(cols[0]?.nullable).toBe(false);
    expect(cols[1]?.nullable).toBe(false);
    expect(cols[2]?.nullable).toBe(true);
  });

  it('previewRows clamp 上限 50', async () => {
    const r = await adapter.previewRows('users', 999);
    expect(r.rowCount).toBe(50);
    expect(r.rowCount).toBe(r.rows.length);
  });

  it('previewRows offset 真翻页（第 4 参数行偏移，缺省 0）', async () => {
    const page2 = await adapter.previewRows('users', 5, undefined, 10);
    expect(page2.rowCount).toBe(5);
    expect(page2.rows[0]?.[0]).toBe(11); // 跳过前 10 行
    expect(page2.rows[0]?.[1]).toBe('user11');
    expect(page2.rows[4]?.[0]).toBe(15);
    const page1 = await adapter.previewRows('users', 5);
    expect(page1.rows[0]?.[0]).toBe(1); // offset 缺省 0
  });

  it('非法标识符被拒绝（防注入）', async () => {
    await expect(adapter.describeTable('users; DROP TABLE users')).rejects.toThrow(/非法/);
    await expect(adapter.previewRows('users"--', 10)).rejects.toThrow(/非法/);
  });

  it('ro 模式：query 可用，execute 被拒', async () => {
    const r = await ro.query('SELECT COUNT(*) AS n FROM users');
    expect(r.rows[0]?.[0]).toBeGreaterThan(0);
    await expect(ro.execute("INSERT INTO users (name) VALUES ('x')")).rejects.toThrow();
  });

  it('url 方式打开（file:// 前缀）', async () => {
    const byUrl = await createSqliteAdapter(conn());
    try {
      const r = await byUrl.query('SELECT 1 AS one');
      expect(r.rows[0]).toEqual([1]);
    } finally {
      await byUrl.close();
    }
  });
});
