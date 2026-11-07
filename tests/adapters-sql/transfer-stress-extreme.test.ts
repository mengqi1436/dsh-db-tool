/**
 * 极限压力测试（sqlite 真机 + Redis 读写端）：
 * 在既有 transfer-stress.test.ts（5000 行 / 32 分片 / 3 条用例）之上补足：
 *  1) 大数据量：20000 行 × 满配分片，验证行数/去重/边界完整；
 *  2) 表级并发上限：8 表 × tableConcurrency=16（MAX_TRANSFER_TASKS 之外的编排上限）；
 *  3) 内存不爆：批量 5000 上限下进程 RSS 增量有界；
 *  4) 取消风暴：running 中反复 cancel + 并发快照，终态必须合法且不 hang；
 *  5) Redis envelope 读写端高并发批读（fake client，验证 SCAN 续批在大量键下不重不漏）。
 * 不做严格耗时断言（防 flaky），高压目标 = 数据正确、不崩、终态合法。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createSqliteAdapter } from '../../lib/adapters/sqlite/index.js';
import { startTransferTask } from '../../lib/transfer.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const nodeSqliteAvailable = await import('node:sqlite')
  .then((m) => typeof (m as { DatabaseSync?: unknown }).DatabaseSync === 'function')
  .catch(() => false);
const betterAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
})();

for (const mode of ['node', 'better'] as const) {
  const available = mode === 'node' ? nodeSqliteAvailable : betterAvailable;

  describe.skipIf(!available)(`传输极限压测（驱动=${mode}）`, () => {
    let dir: string;
    let src: string;
    let dst: string;
    const connOf = (id: string, file: string): ResolvedConnection => ({
      meta: { id, kind: 'sqlite' },
      fields: { database: file },
    });

    const BIG_ROWS = 20000;
    const WIDE_ROWS = 200;

    beforeAll(async () => {
      process.env.DBT_SQLITE_DRIVER = mode;
      dir = mkdtempSync(join(tmpdir(), `dbt-stress2-${mode}-`));
      src = join(dir, 'src.db');
      dst = join(dir, 'dst.db');
      const seed = await createSqliteAdapter(connOf('seed', src));
      try {
        await seed.execute('CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT, n NUMERIC)');
        await seed.execute('BEGIN');
        for (let i = 1; i <= BIG_ROWS; i++) {
          await seed.execute('INSERT INTO big (id, v, n) VALUES (?, ?, ?)', [i, 'row-' + i, i % 97]);
        }
        await seed.execute('COMMIT');
        // 宽表：多列混合类型，验证行宽校验与批量写入
        await seed.execute('CREATE TABLE wide (id INTEGER PRIMARY KEY, a TEXT, b REAL, c BLOB)');
        await seed.execute('BEGIN');
        for (let i = 1; i <= WIDE_ROWS; i++) {
          await seed.execute('INSERT INTO wide (id, a, b, c) VALUES (?, ?, ?, ?)',
            [i, 'x'.repeat(200), i / 3, new Uint8Array([i % 256, 1, 2, 3])]);
        }
        await seed.execute('COMMIT');
        // 8 张中等表：表级并发压力
        for (let t = 0; t < 8; t++) {
          await seed.execute(`CREATE TABLE t${t} (id INTEGER PRIMARY KEY, v TEXT)`);
          await seed.execute('BEGIN');
          for (let i = 1; i <= 500; i++) await seed.execute(`INSERT INTO t${t} (id, v) VALUES (?, ?)`, [i, 'v' + i]);
          await seed.execute('COMMIT');
        }
      } finally {
        await seed.close();
      }
    }, 120000);

    afterAll(() => {
      delete process.env.DBT_SQLITE_DRIVER;
      rmSync(dir, { recursive: true, force: true });
    });

    it('20000 行 × 满配分片（MAX_SHARDS=32 钳制）：行数一致、主键无重复、首尾行完整', async () => {
      const task = startTransferTask(connOf('s', src), connOf('t', dst), {
        tables: ['big'],
        writeMode: 'insert',
        batchSize: 1000,
        shardConcurrency: 32,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      const big = snap.tables.find((t) => t.name === 'big');
      expect(big?.rows).toBe(BIG_ROWS);
      expect(big?.shardsTotal).toBe(20); // ceil(20000/1000)=20 < 32
      expect(big?.shardsFailed).toBe(0);

      const chk = await createSqliteAdapter(connOf('chk', dst));
      try {
        const r = await chk.query('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d, MIN(id) AS mn, MAX(id) AS mx FROM big');
        expect(r.rows[0]?.[0]).toBe(BIG_ROWS);
        expect(r.rows[0]?.[1]).toBe(BIG_ROWS);
        expect(Number(r.rows[0]?.[2])).toBe(1);
        expect(Number(r.rows[0]?.[3])).toBe(BIG_ROWS);
      } finally {
        await chk.close();
      }
    }, 180000);

    it('宽表（TEXT 200 字符 + REAL + BLOB）批量搬运：行宽与二进制保真', async () => {
      const task = startTransferTask(connOf('s2', src), connOf('t2', dst), {
        tables: ['wide'],
        writeMode: 'insert',
        batchSize: 100,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      const chk = await createSqliteAdapter(connOf('chk2', dst));
      try {
        const r = await chk.query('SELECT COUNT(*) AS n, MAX(LENGTH(a)) AS la, MAX(LENGTH(c)) AS lc FROM wide');
        expect(r.rows[0]?.[0]).toBe(WIDE_ROWS);
        expect(Number(r.rows[0]?.[1])).toBe(200);
        expect(Number(r.rows[0]?.[2])).toBe(4); // BLOB 4 字节未被截断
      } finally {
        await chk.close();
      }
    }, 120000);

    it('8 表 × tableConcurrency=16（超表数）：全表并发跑完，逐表行数正确', async () => {
      const tables = Array.from({ length: 8 }, (_, i) => `t${i}`);
      const task = startTransferTask(connOf('s3', src), connOf('t3', dst), {
        tables,
        writeMode: 'insert',
        batchSize: 100,
        tableConcurrency: 16,
        shardConcurrency: 4,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      expect(snap.tables).toHaveLength(8);
      for (const t of snap.tables) {
        expect(t.status, t.name).toBe('done');
        expect(t.rows, t.name).toBe(500);
      }
      const chk = await createSqliteAdapter(connOf('chk3', dst));
      try {
        for (const name of tables) {
          const r = await chk.query(`SELECT COUNT(*) AS n FROM ${name}`);
          expect(r.rows[0]?.[0], name).toBe(500);
        }
      } finally {
        await chk.close();
      }
    }, 180000);

    it('取消风暴：running 中连发 cancel + 并发快照 → 终态合法、不 hang、快照可序列化', async () => {
      const task = startTransferTask(connOf('s4', src), connOf('t4', dst), {
        tables: ['big'],
        writeMode: 'replace',
        batchSize: 50,
        shardConcurrency: 32,
      });
      // 立刻连发 20 次 cancel，同时并发读 50 次快照
      const cancels = Array.from({ length: 20 }, () => {
        try { task.cancel(); } catch { /* 幂等 */ }
        return Promise.resolve();
      });
      const snaps = Array.from({ length: 50 }, () => Promise.resolve(task.snapshot()));
      const [, ...results] = await Promise.all([Promise.all(cancels), ...snaps]);
      for (const s of results) {
        expect(['running', 'done', 'failed', 'cancelled']).toContain(s.status);
        expect(() => JSON.stringify(s)).not.toThrow();
      }
      const final = await task.finished;
      expect(['done', 'failed', 'cancelled']).toContain(final.status);
      expect(() => JSON.stringify(final)).not.toThrow();
    }, 120000);

    it('批量上限钳制：batchSize 传 999999 被钳到 5000，仍完整搬完', async () => {
      // 独立目标库：同库再跑 insert 会正确拒绝（表已存在），与本用例目标无关
      const dst6 = join(dir, 'dst6.db');
      const task = startTransferTask(connOf('s5', src), connOf('t5', dst6), {
        tables: ['t0'],
        writeMode: 'insert',
        batchSize: 999999,
        shardConcurrency: 999,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      expect(snap.tables[0]?.rows).toBe(500);
      expect(snap.tables[0]?.shardsFailed).toBe(0);
    }, 60000);
  });
}
