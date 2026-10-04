/**
 * 数据传输 sqlite↔sqlite 端到端测试（离线可跑，临时 .db 文件）。
 * 覆盖：结构映射（含 bigint 保真 / BLOB / NULL / 无主键表）、keyset 与 offset 游标
 * 不重不漏、写入冲突三态、事务回滚（一批中一条失败→零残留）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createSqliteAdapter } from '../../lib/adapters/sqlite/index.js';
import { createTransferReader, createTransferWriter } from '../../lib/adapters/transfer/model.js';
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

  describe.skipIf(!available)(`数据传输 sqlite（驱动=${mode}）`, () => {
    let dir: string;
    let src: string;
    let dst: string;
    const connOf = (id: string, file: string): ResolvedConnection => ({
      meta: { id, kind: 'sqlite' },
      fields: { database: file },
    });

    beforeAll(async () => {
      process.env.DBT_SQLITE_DRIVER = mode;
      dir = mkdtempSync(join(tmpdir(), 'dbt-transfer-'));
      src = join(dir, 'src.db');
      dst = join(dir, 'dst.db');
      const seed = await createSqliteAdapter(connOf('seed', src));
      // 主键表（int64 大值 + BLOB + NULL + TEXT 日期）
      await seed.execute('CREATE TABLE t_pk (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount NUMERIC, payload BLOB, created TEXT)');
      for (let i = 1; i <= 37; i++) {
        await seed.execute(
          'INSERT INTO t_pk (id, name, amount, payload, created) VALUES (?, ?, ?, ?, ?)',
          [
            9_000_000_000_000 + i, // > Number.MAX_SAFE_INTEGER，验证 bigint 保真
            `n${i}`,
            i % 7 === 0 ? null : `${i}.25`,
            i % 3 === 0 ? Buffer.from([i, 2, 3]) : null,
            `2026-01-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`,
          ],
        );
      }
      // 带声明长度的 string 列（VARCHAR(N) 长度解析断言用）
      await seed.execute('CREATE TABLE t_len (code VARCHAR(64))');
      await seed.execute("INSERT INTO t_len VALUES ('c1')");
      // 复合主键表（表级 PRIMARY KEY 约束路径）
      await seed.execute('CREATE TABLE t_compk (a INTEGER, b TEXT, v TEXT, PRIMARY KEY (a, b))');
      await seed.execute("INSERT INTO t_compk VALUES (1, 'x', 'v1'), (1, 'y', 'v2'), (2, 'x', 'v3')");
      // 无主键表（应降级 offset 全序读）
      await seed.execute('CREATE TABLE t_nopk (v TEXT)');
      for (let i = 1; i <= 11; i++) await seed.execute('INSERT INTO t_nopk (v) VALUES (?)', [`v${i}`]);
      await seed.close();
    });

    afterAll(async () => {
      delete process.env.DBT_SQLITE_DRIVER;
      rmSync(dir, { recursive: true, force: true });
    });

    it('describe 映射中间模型：INTEGER 主键→bigint+自增，可空性正确', async () => {
      const reader = await createTransferReader(connOf('r', src));
      try {
        const t = await reader.describe('t_pk');
        expect(t.name).toBe('t_pk');
        expect(t.columns.map((c) => c.name)).toEqual(['id', 'name', 'amount', 'payload', 'created']);
        expect(t.columns[0]).toMatchObject({ midType: 'bigint', primaryKey: true, autoIncrement: true, nullable: false });
        // TEXT 亲和归 text（无界）：映射 'string' 会在目标端建成 VARCHAR(255) 截断超长值
        expect(t.columns[1]).toMatchObject({ midType: 'text', nullable: false });
        expect(t.columns[2]?.nullable).toBe(true);
        expect(t.columns[3]).toMatchObject({ midType: 'bytes' });
      } finally {
        await reader.close();
      }
    });

    it('describe 映射 VARCHAR(N)：midType=string 且声明长度进 length（目标端按 N 建列）', async () => {
      const reader = await createTransferReader(connOf('r', src));
      try {
        const t = await reader.describe('t_len');
        expect(t.columns[0]).toMatchObject({ midType: 'string', length: 64 });
      } finally {
        await reader.close();
      }
    });

    it('shardKey：单列主键返回类型；无主键表返回 null（不用 rowid）', async () => {
      const reader = await createTransferReader(connOf('r', src));
      try {
        expect(await reader.shardKey('t_pk')).toBe('bigint');
        expect(await reader.shardKey('t_nopk')).toBeNull();
      } finally {
        await reader.close();
      }
    });

    it('keyset 游标批读不重不漏（跨批 bigint 键保真）', async () => {
      const reader = await createTransferReader(connOf('r', src));
      try {
        const seen: unknown[] = [];
        let after: import('../../lib/adapters/transfer/model.js').TransferCell | null = null;
        for (;;) {
          const rows = await reader.readBatch('t_pk', { mode: 'keyset', column: 'id', after }, 10);
          for (const r of rows) seen.push(r[0]);
          if (rows.length < 10) break;
          after = rows[rows.length - 1]![0]!;
        }
        expect(seen.length).toBe(37);
        expect(new Set(seen).size).toBe(37);
        expect(seen[0]).toBe(9_000_000_000_001n);
        expect(seen[36]).toBe(9_000_000_000_037n);
      } finally {
        await reader.close();
      }
    });

    it('offset 游标批读不重不漏（无主键表）', async () => {
      const reader = await createTransferReader(connOf('r', src));
      try {
        const seen: string[] = [];
        for (let offset = 0; ; offset += 4) {
          const rows = await reader.readBatch('t_nopk', { mode: 'offset', offset }, 4);
          for (const r of rows) seen.push(String(r[0]));
          if (rows.length < 4) break;
        }
        expect(seen.length).toBe(11);
        // 复合主键表行数（新增用例前置校验）
        expect(new Set(seen).size).toBe(11);
      } finally {
        await reader.close();
      }
    });

    it('端到端：建表+分批写入，行数与内容（bigint/BLOB/NULL）保真一致', async () => {
      const reader = await createTransferReader(connOf('r', src));
      const writer = await createTransferWriter(connOf('w', dst));
      try {
        const t = await reader.describe('t_pk');
        await writer.createTable(t);
        let total = 0;
        let after: import('../../lib/adapters/transfer/model.js').TransferCell | null = null;
        for (;;) {
          const rows = await reader.readBatch('t_pk', { mode: 'keyset', column: 'id', after }, 10);
          total += await writer.writeBatch(t, rows);
          if (rows.length < 10) break;
          after = rows[rows.length - 1]![0]!;
        }
        expect(total).toBe(await reader.count('t_pk'));

        // 目标端逐项抽查（用浏览适配器验证，顺带验证其规范化不掩盖差异）
        const check = await createSqliteAdapter(connOf('check', dst));
        try {
          const r = await check.query('SELECT id, name, payload FROM t_pk ORDER BY id LIMIT 1');
          expect(r.rows[0]?.[0]).toBe(9_000_000_000_001);
          const blob = await check.query("SELECT payload FROM t_pk WHERE id = 9000000000003");
          expect(blob.rows[0]?.[0]).toBe('[BLOB 3 bytes]');
          const nul = await check.query('SELECT amount FROM t_pk WHERE id = 9000000000014');
          expect(nul.rows[0]?.[0]).toBeNull();
        } finally {
          await check.close();
        }
      } finally {
        await reader.close();
        await writer.close();
      }
    });

    it('WriteMode=ignore 跳过重复；=replace 覆盖', async () => {
      const reader = await createTransferReader(connOf('r', src));
      const t = await reader.describe('t_pk');
      const first = await reader.readBatch('t_pk', { mode: 'keyset', column: 'id', after: null }, 1);
      try {
        const wIgnore = await createTransferWriter(connOf('w', dst), 'ignore');
        try {
          expect(await wIgnore.writeBatch(t, first)).toBe(0); // 已存在，跳过
        } finally {
          await wIgnore.close();
        }
        const wReplace = await createTransferWriter(connOf('w', dst), 'replace');
        try {
          expect(await wReplace.writeBatch(t, first)).toBe(1); // 覆盖
        } finally {
          await wReplace.close();
        }
      } finally {
        await reader.close();
      }
    });

    it('一批中一条失败整批回滚（零残留）', async () => {
      const writer = await createTransferWriter(connOf('w', dst));
      try {
        const bad = await createTransferReader(connOf('r', src));
        const t = await bad.describe('t_pk');
        await bad.close();
        const rows: import('../../lib/adapters/transfer/model.js').TransferRow[] = [
          [777n, 'ok', null, null, null],
          [888n, '宽度不足', null, null], // 少一列 → 行宽校验在事务前抛出
        ];
        await expect(writer.writeBatch(t, rows)).rejects.toThrow(/行宽不匹配/);
        // 事务路径：行宽合法但违反约束（重复主键 → insert 模式报错 → 回滚，首行不残留）
        const dup: import('../../lib/adapters/transfer/model.js').TransferRow[] = [
          [999n, 'will-rollback', null, null, null],
          [9_000_000_000_001n, 'dup-pk', null, null, null],
        ];
        await expect(writer.writeBatch(t, dup)).rejects.toThrow();
      } finally {
        await writer.close();
      }
      const check = await createSqliteAdapter(connOf('check', dst));
      try {
        const r = await check.query('SELECT COUNT(*) AS n FROM t_pk WHERE id IN (777, 999)');
        expect(r.rows[0]?.[0]).toBe(0);
      } finally {
        await check.close();
      }
    });

    it('定位参数被忽略（sqlite 无层级）：带 loc 的读写端行为与缺省一致', async () => {
      const plain = await createTransferReader(connOf('r', src));
      const located = await createTransferReader(connOf('r2', src), { database: 'other', schema: 'x' });
      const t = await plain.describe('t_pk');
      try {
        expect(await located.listTables()).toEqual(await plain.listTables());
        expect(await located.describe('t_pk')).toEqual(t);
      } finally {
        await plain.close();
        await located.close();
      }
      // writer 第三参（writeMode + loc 同给）：loc 忽略，写入照常
      const writer = await createTransferWriter(connOf('w3', join(dir, 'w3.db')), 'insert', { database: 'other' });
      try {
        await writer.createTable(t);
        expect(await writer.writeBatch(t, [[1n, 'a', null, null, null]])).toBe(1);
      } finally {
        await writer.close();
      }
    });

    it('createTable 重复建表抛错；未注册的 kind 给出明确错误', async () => {
      const reader = await createTransferReader(connOf('r', src));
      const writer = await createTransferWriter(connOf('w2', join(dir, 'w2.db')));
      try {
        const t = await reader.describe('t_pk');
        await writer.createTable(t);
        await expect(writer.createTable(t)).rejects.toThrow();
        await expect(
          createTransferReader({ meta: { id: 'x', kind: 'redis' }, fields: {} }),
        ).rejects.toThrow(/暂不支持读取 redis/);
      } finally {
        await reader.close();
        await writer.close();
      }
    });
  });
}
