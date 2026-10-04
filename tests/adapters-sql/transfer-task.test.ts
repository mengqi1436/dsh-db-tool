/**
 * 数据传输编排器测试（sqlite↔sqlite 真机，临时 .db 文件）。
 * 覆盖：多表传输、分片并行不重不漏（大表切块）、无主键表 offset 降级、
 * 目标表已存在失败记录、取消、快照 JSON-safe（bigint 键转字符串）。
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

  describe.skipIf(!available)(`传输编排（驱动=${mode}）`, () => {
    let dir: string;
    let src: string;
    let dst: string;
    let dst2: string;
    const connOf = (id: string, file: string): ResolvedConnection => ({
      meta: { id, kind: 'sqlite' },
      fields: { database: file },
    });

    beforeAll(async () => {
      process.env.DBT_SQLITE_DRIVER = mode;
      dir = mkdtempSync(join(tmpdir(), 'dbt-orch-'));
      src = join(dir, 'src.db');
      dst = join(dir, 'dst.db');
      dst2 = join(dir, 'dst2.db');
      const seed = await createSqliteAdapter(connOf('seed', src));
      // 大表（450 行，batchSize 50 → 切 9 片并行）+ 小表 + 无主键表
      await seed.execute('CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT)');
      for (let i = 1; i <= 450; i++) {
        await seed.execute('INSERT INTO big (id, v) VALUES (?, ?)', [1000 + i, `v${i}`]);
      }
      await seed.execute('CREATE TABLE small (a TEXT PRIMARY KEY, b INTEGER)');
      await seed.execute("INSERT INTO small VALUES ('k1', 1)");
      await seed.execute('CREATE TABLE t_compk (a INTEGER, b TEXT, v TEXT, PRIMARY KEY (a, b))');
      await seed.execute("INSERT INTO t_compk VALUES (1, 'x', 'v1'), (1, 'y', 'v2'), (2, 'x', 'v3')");
      await seed.execute('CREATE TABLE nopk (x TEXT)');
      for (let i = 1; i <= 7; i++) await seed.execute('INSERT INTO nopk VALUES (?)', [`n${i}`]);
      await seed.close();
    });

    afterAll(async () => {
      delete process.env.DBT_SQLITE_DRIVER;
      rmSync(dir, { recursive: true, force: true });
    });

    it('多表 + 分片并行：行数一致、无重复无遗漏', async () => {
      const task = startTransferTask(connOf('s', src), connOf('t', dst), {
        tables: ['big', 'small', 'nopk', 't_compk'],
        writeMode: 'insert',
        batchSize: 50,
        tableConcurrency: 2,
        shardConcurrency: 3,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      const big = snap.tables.find((t) => t.name === 'big');
      expect(big?.rows).toBe(450);
      expect(big?.shardsTotal).toBeGreaterThan(1);

      // 目标端校验：行数 + 去重计数（不重不漏）
      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        const n = await check.query('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM big');
        expect(n.rows[0]?.[0]).toBe(450);
        expect(n.rows[0]?.[1]).toBe(450);
        const small = await check.query('SELECT a, b FROM small');
        expect(small.rows[0]).toEqual(['k1', 1]);
        const nopk = await check.query('SELECT COUNT(*) AS n FROM nopk');
        expect(nopk.rows[0]?.[0]).toBe(7);
        const compk = await check.query('SELECT COUNT(*) AS n, COUNT(DISTINCT a || b) AS d FROM t_compk');
        expect(compk.rows[0]?.[0]).toBe(3);
        expect(compk.rows[0]?.[1]).toBe(3);
      } finally {
        await check.close();
      }
    }, 30000);

    it('目标表已存在 → 该表失败进快照，其余表照常', async () => {
      const pre = await createSqliteAdapter(connOf('pre', dst2));
      try {
        await pre.execute('CREATE TABLE small (a TEXT PRIMARY KEY, b INTEGER)');
      } finally {
        await pre.close();
      }
      const task = startTransferTask(connOf('s', src), connOf('t', dst2), {
        tables: ['small'],
        writeMode: 'insert',
        batchSize: 10,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('failed');
      expect(snap.failures[0]?.table).toBe('small');
      expect(snap.failures[0]?.error).toContain('目标表已存在');
    }, 30000);

    it('truncate 模式：目标表已存在 → 清空旧数据后写入', async () => {
      // 目标表已存在且含旧行：truncate 模式建表失败降级清空，旧数据不得残留
      const pre = await createSqliteAdapter(connOf('pre2', dst2));
      try {
        await pre.execute('INSERT INTO small (a, b) VALUES (?, ?)', ['old-row', 999]);
      } finally {
        await pre.close();
      }
      const task = startTransferTask(connOf('s', src), connOf('t', dst2), {
        tables: ['small'],
        writeMode: 'truncate',
        batchSize: 10,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
      const check = await createSqliteAdapter(connOf('chk2', dst2));
      try {
        const n = await check.query('SELECT COUNT(*) AS n FROM small');
        expect(n.rows[0]?.[0]).toBe(1); // 旧行被清空，仅剩源端 1 行
        const v = await check.query('SELECT a FROM small');
        expect(v.rows[0]?.[0]).toBe('k1');
      } finally {
        await check.close();
      }
    }, 30000);

    it('overwriteStructure：insert 模式 + 目标表已存在 → 删除重建成功（默认 insert 报已存在）', async () => {
      // 默认（不覆盖）：insert 遇已存在表明确报错
      const t1 = startTransferTask(connOf('s1', src), connOf('t1', dst2), { tables: ['small'], writeMode: 'insert', batchSize: 10 });
      const s1 = await t1.finished;
      expect(s1.status).toBe('failed');
      expect(s1.failures[0]?.error).toContain('目标表已存在');
      // 开覆盖表结构：删除重建，写入成功且旧数据被替换
      const t2 = startTransferTask(connOf('s2', src), connOf('t2', dst2), { tables: ['small'], writeMode: 'insert', batchSize: 10, overwriteStructure: true });
      const s2 = await t2.finished;
      expect(s2.status).toBe('done');
      expect(s2.failures).toHaveLength(0);
      const check = await createSqliteAdapter(connOf('chk3', dst2));
      try {
        const v = await check.query('SELECT a, b FROM small');
        expect(v.rows[0]).toEqual(['k1', 1]); // 旧行 old-row 被重建清掉
      } finally {
        await check.close();
      }
    }, 30000);

    it('取消：running 中 cancel → 终态 cancelled，快照可序列化（JSON-safe）', async () => {
      const task = startTransferTask(connOf('s', src), connOf('t', dst2), {
        tables: ['big'],
        writeMode: 'ignore',
        batchSize: 10,
        tableConcurrency: 1,
        shardConcurrency: 1,
      });
      task.cancel();
      const snap = await task.finished;
      // 严格终态：startTransferTask 主流程经微任务启动，同步 cancel 必先于任何检查点，
      // 正确实现下确定性 cancelled（'done' 只会是 cancel 链路失效的回归信号）
      expect(snap.status).toBe('cancelled');
      // worker 未开始任何分片：该表不得误标 done/failed
      expect(snap.tables.find((t) => t.name === 'big')?.status).toBe('pending');
      // 快照可 JSON 序列化（bigint 键防护）：不抛即通过
      expect(() => JSON.stringify(snap)).not.toThrow();
    }, 30000);

    it('writer 创建失败（目标 kind 不支持写）→ 单表失败进 failures，任务不挂起、失败表有终态', async () => {
      const task = startTransferTask(connOf('s', src), { meta: { id: 'bad', kind: 'redis' }, fields: {} }, {
        tables: ['big', 'small'],
        writeMode: 'insert',
        batchSize: 10,
        tableConcurrency: 1,
      });
      const snap = await task.finished;
      expect(snap.status).toBe('failed');
      // 失败按真实表名记录（旧实现会以 table:'*' 兜底且表级停留在 pending）
      expect(snap.failures.map((f) => f.table).sort()).toEqual(['big', 'small']);
      expect(snap.failures[0]?.error).toContain('暂不支持写入');
      expect(snap.tables.find((t) => t.name === 'big')?.status).toBe('failed');
    }, 30000);
  });
}
