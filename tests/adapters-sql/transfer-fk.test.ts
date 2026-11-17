/**
 * 数据传输目标端外键依赖回归测试（sqlite 真机，node:sqlite 默认启用外键约束——
 * 实测新连接 PRAGMA foreign_keys=1）。
 *
 * 复现原始问题：目标端 schema 已有外键关系（父表被子表引用）时，按选择顺序
 * 逐表「删除/清空/写入」会让父表操作被子表数据拦截——正是用户反馈的
 * 「因为有其他对象依赖它」失败（PG 2BP01 等同型：SQLite 报 FOREIGN KEY constraint failed）。
 * 修复后：删除/清空趟子表先行、装载趟父表先行、循环组走 foreign_keys=OFF 窗口整组删除。
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

const FK_TARGET_DDL = [
  'CREATE TABLE parent (id INTEGER PRIMARY KEY, v TEXT)',
  'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))',
];

for (const mode of ['node', 'better'] as const) {
  const available = mode === 'node' ? nodeSqliteAvailable : betterAvailable;

  describe.skipIf(!available)(`传输目标端外键依赖（驱动=${mode}）`, () => {
    let dir: string;
    let srcFile: string;
    const dstFiles: string[] = [];
    let seq = 0;
    const connOf = (id: string, file: string): ResolvedConnection => ({
      meta: { id, kind: 'sqlite' },
      fields: { database: file },
    });

    /** 建一个带外键关系且已有数据的目标库 */
    const makeFkTarget = async (ddl: string[], seed: string[]): Promise<string> => {
      const file = join(dir, `dst-${++seq}.db`);
      dstFiles.push(file);
      const db = await createSqliteAdapter(connOf('mk', file));
      try {
        for (const sql of ddl) await db.execute(sql);
        for (const sql of seed) await db.execute(sql);
      } finally {
        await db.close();
      }
      return file;
    };

    beforeAll(async () => {
      process.env.DBT_SQLITE_DRIVER = mode;
      dir = mkdtempSync(join(tmpdir(), 'dbt-fk-'));
      srcFile = join(dir, 'src.db');
      const seed = await createSqliteAdapter(connOf('seed', srcFile));
      try {
        // 源端数据：全新键集（目标端旧行与新行无交集，外键引用只在新键集内成立）
        await seed.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY, v TEXT)');
        await seed.execute('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL)');
        await seed.execute("INSERT INTO parent VALUES (2, 'p2')");
        await seed.execute('INSERT INTO child VALUES (20, 2)');
        await seed.execute('CREATE TABLE a (id INTEGER PRIMARY KEY, other_id INTEGER)');
        await seed.execute('CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER)');
        await seed.execute('INSERT INTO a VALUES (2, NULL)');
        await seed.execute('INSERT INTO b VALUES (2, 2)');
        // 写入门控用：源端是目标端旧行的超集
        await seed.execute('CREATE TABLE p2 (id INTEGER PRIMARY KEY, v TEXT)');
        await seed.execute('CREATE TABLE c2 (id INTEGER PRIMARY KEY, p_id INTEGER NOT NULL)');
        await seed.execute("INSERT INTO p2 VALUES (1, 'p1'), (2, 'p2')");
        await seed.execute('INSERT INTO c2 VALUES (10, 1), (20, 2)');
      } finally {
        await seed.close();
      }
    });

    afterAll(async () => {
      delete process.env.DBT_SQLITE_DRIVER;
      rmSync(dir, { recursive: true, force: true });
    });

    it('覆盖表结构：父表被子表引用（子表有数据）→ 删除趟子表先行，传输完成', async () => {
      const dst = await makeFkTarget(FK_TARGET_DDL, [
        "INSERT INTO parent VALUES (1, 'p1')",
        'INSERT INTO child VALUES (10, 1)',
      ]);
      const task = startTransferTask(connOf('s', srcFile), connOf('t', dst), {
        tables: ['parent', 'child'],
        writeMode: 'insert',
        overwriteStructure: true,
        tableConcurrency: 2,
      });
      const snap = await task.finished;
      expect(snap.failures).toHaveLength(0);
      expect(snap.status).toBe('done');
      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        const parent = await check.query('SELECT id, v FROM parent ORDER BY id');
        const child = await check.query('SELECT id, parent_id FROM child ORDER BY id');
        expect(parent.rows).toEqual([[2, 'p2']]);
        expect(child.rows).toEqual([[20, 2]]);
      } finally {
        await check.close();
      }
    }, 30000);

    it('truncate 模式：父表被子表引用（子表有数据）→ 清空趟子表先行，传输完成', async () => {
      const dst = await makeFkTarget(FK_TARGET_DDL, [
        "INSERT INTO parent VALUES (1, 'p1')",
        'INSERT INTO child VALUES (10, 1)',
      ]);
      const task = startTransferTask(connOf('s', srcFile), connOf('t', dst), {
        tables: ['parent', 'child'],
        writeMode: 'truncate',
        tableConcurrency: 2,
      });
      const snap = await task.finished;
      expect(snap.failures).toHaveLength(0);
      expect(snap.status).toBe('done');
      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        const parent = await check.query('SELECT id FROM parent ORDER BY id');
        const child = await check.query('SELECT id FROM child ORDER BY id');
        expect(parent.rows).toEqual([[2]]);
        expect(child.rows).toEqual([[20]]);
      } finally {
        await check.close();
      }
    }, 30000);

    it('写入顺序门控：目标表已存在（insert+ignore）→ 父表先装载，子表引用不落空', async () => {
      const dst = await makeFkTarget(FK_TARGET_DDL, [
        "INSERT INTO parent VALUES (1, 'p1')",
        'INSERT INTO child VALUES (10, 1)',
      ]);
      const task = startTransferTask(connOf('s', srcFile), connOf('t', dst), {
        tables: ['p2', 'c2'],
        writeMode: 'ignore',
        tableConcurrency: 2,
      });
      const snap = await task.finished;
      expect(snap.failures).toHaveLength(0);
      expect(snap.status).toBe('done');
      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        const parent = await check.query('SELECT id FROM p2 ORDER BY id');
        const child = await check.query('SELECT id FROM c2 ORDER BY id');
        expect(parent.rows).toEqual([[1], [2]]);
        expect(child.rows).toEqual([[10], [20]]);
      } finally {
        await check.close();
      }
    }, 30000);

    it('循环外键组：互为引用且双方有数据 → foreign_keys=OFF 窗口整组删除，覆盖传输完成', async () => {
      const dst = await makeFkTarget(
        [
          'CREATE TABLE a (id INTEGER PRIMARY KEY, other_id INTEGER REFERENCES b(id))',
          'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id))',
        ],
        ['INSERT INTO a VALUES (1, NULL)', 'INSERT INTO b VALUES (1, 1)'],
      );
      const task = startTransferTask(connOf('s', srcFile), connOf('t', dst), {
        tables: ['a', 'b'],
        writeMode: 'insert',
        overwriteStructure: true,
        tableConcurrency: 2,
      });
      const snap = await task.finished;
      expect(snap.failures).toHaveLength(0);
      expect(snap.status).toBe('done');
      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        const a = await check.query('SELECT id FROM a ORDER BY id');
        const b = await check.query('SELECT id FROM b ORDER BY id');
        expect(a.rows).toEqual([[2]]);
        expect(b.rows).toEqual([[2]]);
      } finally {
        await check.close();
      }
    }, 30000);

    it('sqlite 写端 listForeignKeys：PRAGMA foreign_key_list 返回引用边（含列清单）', async () => {
      const dst = await makeFkTarget(FK_TARGET_DDL, []);
      const { createSqliteTransferWriterFromConn } = await import('../../lib/adapters/transfer/kinds/sqlite.js');
      const w = await createSqliteTransferWriterFromConn(connOf('w', dst), 'insert');
      try {
        const edges = await w.listForeignKeys!();
        const edge = edges.find((e) => e.table === 'child' && e.referencedTable === 'parent');
        expect(edge).toBeDefined();
        expect(edge?.columns).toEqual(['parent_id']);
        expect(edge?.referencedColumns).toEqual(['id']);
      } finally {
        await w.close();
      }
    }, 30000);

    it('结构随迁：源端索引与外键 → 覆盖传输后目标端还原（索引建出、外键内联、行数一致）', async () => {
      const srcFile = join(dir, `src-struct-${++seq}.db`);
      const seed = await createSqliteAdapter(connOf('seed2', srcFile));
      try {
        await seed.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY, v TEXT)');
        await seed.execute('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))');
        await seed.execute('CREATE INDEX idx_child_parent ON child (parent_id)');
        await seed.execute("INSERT INTO parent VALUES (2, 'p2')");
        await seed.execute('INSERT INTO child VALUES (20, 2)');
      } finally {
        await seed.close();
      }
      const dst = join(dir, `dst-struct-${seq}.db`);
      const task = startTransferTask(connOf('s', srcFile), connOf('t', dst), {
        tables: ['parent', 'child'],
        writeMode: 'insert',
        overwriteStructure: true,
        tableConcurrency: 2,
      });
      const snap = await task.finished;
      expect(snap.failures).toHaveLength(0);
      expect(snap.status).toBe('done');
      const check = await createSqliteAdapter(connOf('chk', dst));
      try {
        // 行数一致
        const parent = await check.query('SELECT id FROM parent ORDER BY id');
        const child = await check.query('SELECT id FROM child ORDER BY id');
        expect(parent.rows).toEqual([[2]]);
        expect(child.rows).toEqual([[20]]);
        // 索引随迁：目标端存在同名二级索引
        const indexes = await check.query("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name");
        expect(indexes.rows.flat()).toContain('idx_child_parent');
        // 外键随迁：重建后的 child 表内联 REFERENCES（SQLite 无 ALTER ADD CONSTRAINT）
        const fks = await check.query('PRAGMA foreign_key_list(child)');
        expect(fks.rows.some((row) => row[2] === 'parent')).toBe(true);
      } finally {
        await check.close();
      }
    }, 30000);

    it('结构随迁去重：目标端已有同名索引/同边外键 → 跳过创建，无失败记录', async () => {
      const srcFile = join(dir, `src-dup-${++seq}.db`);
      const seed = await createSqliteAdapter(connOf('seed3', srcFile));
      try {
        await seed.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY, v TEXT)');
        await seed.execute('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))');
        await seed.execute('CREATE INDEX idx_child_parent ON child (parent_id)');
        await seed.execute("INSERT INTO parent VALUES (2, 'p2')");
        await seed.execute('INSERT INTO child VALUES (20, 2)');
      } finally {
        await seed.close();
      }
      const dst = join(dir, `dst-dup-${seq}.db`);
      // 第一遍：覆盖传输（建索引 + 内联外键）
      const first = startTransferTask(connOf('s1', srcFile), connOf('t', dst), {
        tables: ['parent', 'child'],
        writeMode: 'insert',
        overwriteStructure: true,
        tableConcurrency: 2,
      });
      expect((await first.finished).status).toBe('done');
      // 第二遍：ignore 模式增量重跑（结构已存在 → 全部跳过，不产生失败）
      const second = startTransferTask(connOf('s2', srcFile), connOf('t', dst), {
        tables: ['parent', 'child'],
        writeMode: 'ignore',
        tableConcurrency: 2,
      });
      const snap = await second.finished;
      expect(snap.status).toBe('done');
      expect(snap.failures).toHaveLength(0);
    }, 30000);
  });
}
