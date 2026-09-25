import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbToolStore } from '../../lib/store/index.js';
import { cleanupDir, makeTempHome } from './helpers.js';

describe('AuditLog', () => {
  let home: string;
  let store: DbToolStore;

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('append 落盘为 JSONL，ts 省略时自动补当前时间', () => {
    const before = Date.now();
    const entry = store.audit.append({
      projectPathKey: '/p',
      connId: 'c1',
      action: 'query',
      statement: 'SELECT 1',
      danger: 'none',
      confirmed: false,
      ok: true,
      rowsAffected: 1,
    });

    expect(entry.ts).toBeDefined();
    expect(new Date(entry.ts).getTime()).toBeGreaterThanOrEqual(before);

    const lines = fs.readFileSync(path.join(home, 'db-tool', 'audit.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      projectPathKey: '/p',
      connId: 'c1',
      statement: 'SELECT 1',
      danger: 'none',
      confirmed: false,
      ok: true,
      rowsAffected: 1,
    });
  });

  it('tail 返回最近 n 条且时间正序', () => {
    for (let i = 1; i <= 5; i++) {
      store.audit.append({
        projectPathKey: '/p',
        connId: 'c1',
        action: 'query',
        statement: `SELECT ${i}`,
        danger: 'none',
        confirmed: false,
        ok: true,
      });
    }
    const tail = store.audit.tail(3);
    expect(tail.map((e) => e.statement)).toEqual(['SELECT 3', 'SELECT 4', 'SELECT 5']);
    expect(store.audit.tail(100)).toHaveLength(5);
  });

  it('文件不存在时 tail 返回空数组', () => {
    expect(store.audit.tail(10)).toEqual([]);
  });

  it('单个损坏行被跳过，不影响其余历史', () => {
    store.audit.append({
      projectPathKey: '/p', connId: 'c1', action: 'query', statement: 'A',
      danger: 'none', confirmed: false, ok: true,
    });
    store.audit.append({
      projectPathKey: '/p', connId: 'c1', action: 'query', statement: 'B',
      danger: 'none', confirmed: false, ok: true,
    });
    const file = path.join(home, 'db-tool', 'audit.jsonl');
    fs.appendFileSync(file, '{broken json\n', 'utf8');
    store.audit.append({
      projectPathKey: '/p', connId: 'c1', action: 'query', statement: 'C',
      danger: 'none', confirmed: false, ok: true,
    });

    const tail = store.audit.tail(10);
    expect(tail.map((e) => e.statement)).toEqual(['A', 'B', 'C']);
  });
});
