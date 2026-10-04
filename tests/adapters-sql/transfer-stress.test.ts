/**
 * 数据传输高压测试（sqlite 真机，临时 .db 文件）：
 * 大表 × 满配分片并行、truncate 大表、多表混合任务、取消风暴下的快照一致性。
 * 不做严格耗时断言（防 flaky）；高压目标 = 满配并发下数据正确、不崩、终态合法。
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

  describe.skipIf(!available)(`传输高压（驱动=${mode}）`, () => {
    let dir: string;
    let src: string;
    let dst: string;
    const connOf = (id: string, file: string): ResolvedConnection => ({
      meta: { id, kind: 'sqlite' },
      fields: { database: file },
    });

    beforeAll(async () => {
      process.env.DBT_SQLITE_DRIVER = mode;
      dir = mkdtempSync(join(tmpdir(), 'dbt-stress-'));
      src = join(dir, 'src.db');
      dst = join(dir, 'dst.db');
      const seed = await createSqliteAdapter(connOf('seed', src));
      await seed.execute('BEGIN');
      // 大表 5000 行（满配 32 分片切块）+ 中表 800 行 + 无主键 300 行
      await seed.execute('CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT, n NUMERIC)');
      for (let i = 1; i <= 5000; i++) {
        await seed.execute('INSERT INTO big (id, v, n) VALUES (?, ?, ?)', [i, `v${i}`, i % 7 === 0 ? null : i * 1.5]);
      }
      await seed.execute('COMMIT');
      await seed.execute('CREATE TABLE mid (id INTEGER PRIMARY KEY)');
      await seed.execute('BEGIN');
      for (let i = 1; i <= 800; i++) await seed.execute('INSERT INTO mid (id) VALUES (?)', [i]);
      await seed.execute('COMMIT');
      await seed.execute('CREATE TABLE nopk (x TEXT)');
      await seed.execute('BEGIN');
      for (let i = 1; i <= 300; i++) await seed.execute('INSERT INTO nopk (x) VALUES (?)', [`x${i}`]);
      await seed.execute('COMMIT');
      await seed.close();
    });

    afterAll(async () => {
      delete process.env.DBT_SQLITE_DRIVER;
      rmSync(dir, { recursive: true, force: true });
    });

    it('满配分片并行（32 切片）大表 + truncate 目标已有数据：行数一致、无重复', async () => {
      // 目标先放旧数据（truncate 需清掉）
      const pre = await createSqliteAdapter(connOf('pre', dst));
      try {
        await pre.execute('CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT, n NUMERIC)');
        await pre.execute('BEGIN');
        for (let i = 1; i <= 50; i++) await pre.execute('INSERT INTO big (id, v, n) VALUES (?, ?, ?)', [-i, 'old', null]);
        await pre.execute('COMMIT');
      } finally {
        await pre.close();
      }
      const task = startTransferTask(connOf('s', src), connOf('t', dst), {
        tables: ['big'],
        writeMode: 'truncate',
        batchSize: 200,
        shardConcurrency: 32,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      const big = snap.tables.find((t) => t.name === 'big');
      expect(big?.rows).toBe(5000);
      expect(big?.shardsTotal).toBe(25); // ceil(5000/batchSize 200)=25，受 MAX_SHARDS=32 钳制

      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        const n = await check.query('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d, MIN(id) AS mn FROM big');
        expect(n.rows[0]?.[0]).toBe(5000);
        expect(n.rows[0]?.[1]).toBe(5000);
        expect(Number(n.rows[0]?.[2])).toBeGreaterThan(0); // 旧负键已被清空
      } finally {
        await check.close();
      }
    }, 60000);

    it('多表混合任务（满配并行 + truncate 与 insert 混用不了——单任务单模式）：4 表并发全对', async () => {
      const task = startTransferTask(connOf('s', src), connOf('t', dst), {
        tables: ['mid', 'nopk'],
        writeMode: 'insert',
        batchSize: 100,
        tableConcurrency: 4,
        shardConcurrency: 32,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      const check = await createSqliteAdapter(connOf('chk2', dst));
      try {
        const mid = await check.query('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM mid');
        expect(mid.rows[0]?.[0]).toBe(800);
        expect(mid.rows[0]?.[1]).toBe(800);
        const nopk = await check.query('SELECT COUNT(*) AS n FROM nopk');
        expect(nopk.rows[0]?.[0]).toBe(300);
        // 表级终态断言（杀变异：runOffset 空批返回值决定 done/cancelled 判定）
        const nopkProg = snap.tables.find((t) => t.name === 'nopk');
        expect(nopkProg?.status).toBe('done');
        expect(nopkProg?.shardsDone).toBe(1);
      } finally {
        await check.close();
      }
    }, 60000);

    it('取消风暴：running 中连发 cancel + 并发快照读取 → 终态合法、快照结构一致', async () => {
      const task = startTransferTask(connOf('s', src), connOf('t', dst), {
        tables: ['big'],
        writeMode: 'ignore',
        batchSize: 50,
        shardConcurrency: 8,
      });
      // 并发风暴：cancel×3 + 快照×20（快照在任务 running 与终态间交错读取）
      const snaps: import('../../lib/transfer.js').TransferSnapshot[] = [];
      task.cancel();
      task.cancel();
      const storm = (async () => {
        for (let i = 0; i < 20; i++) snaps.push(task.snapshot());
      })();
      const [final] = await Promise.all([task.finished, storm]);
      task.cancel(); // 终态后再 cancel：no-op 不崩
      expect(['cancelled', 'done']).toContain(final.status);
      expect(() => JSON.stringify(final)).not.toThrow();
      for (const s of snaps) {
        expect(['running', 'cancelled', 'done', 'failed']).toContain(s.status);
        expect(Array.isArray(s.tables)).toBe(true);
        expect(Array.isArray(s.failures)).toBe(true);
      }
    }, 60000);
  });
}
