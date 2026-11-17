/**
 * 传输编排器目标端依赖门控测试（假读写端注入，vi.mock 替换 model.js 工厂）。
 * 覆盖：装载门控（父表完成前子表不装载）、覆盖删除趟（子表先删、删除先于建表）、
 * 循环组整组删除（dropTables）、被选择集外引用的覆盖删除预检快速失败、
 * truncate 清空趟（子表先清空、不重复清空）、无边直通（FIFO 输入序）、
 * 规划失败退化现状路径、失败上游不阻塞下游装载。
 */
import { describe, expect, it, vi } from 'vitest';
import { startTransferTask } from '../../lib/transfer.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const h = vi.hoisted(() => {
  const state = {
    /** 目标端外键边（listForeignKeys 返回） */
    edges: [] as Array<{ table: string; referencedTable: string }>,
    /** 目标端已存在的表 */
    existing: new Set<string>(),
    /** 操作序列（drop:/create:/load:/clear: 前缀） */
    ops: [] as string[],
    /** 指定表 dropTable 时抛错（模拟被引用删除失败） */
    failDropOf: new Map<string, string>(),
    /** 指定表 writeBatch 时抛错 */
    failLoadOf: new Map<string, string>(),
    /** dropTables 整组删除调用记录 */
    dropTablesCalls: [] as string[][],
    /** listForeignKeys 抛错（模拟目录查询失败） */
    throwOnListFk: false,
    writerCloseCount: 0,
  };
  return { state };
});

vi.mock('../../lib/adapters/transfer/model.js', () => {
  const reset = (): void => {
    h.state.edges = [];
    h.state.existing = new Set();
    h.state.ops = [];
    h.state.failDropOf = new Map();
    h.state.failLoadOf = new Map();
    h.state.dropTablesCalls = [];
    h.state.throwOnListFk = false;
    h.state.writerCloseCount = 0;
  };
  const makeReader = () => ({
    kind: 'mysql' as const,
    listTables: async () => [],
    describe: async (t: string) => ({
      name: t,
      columns: [{ name: 'id', midType: 'int' as const, nullable: false, primaryKey: true }],
    }),
    count: async () => 2,
    shardKey: async () => null,
    readBatch: async () => [[1]],
    close: async () => {},
  });
  const makeWriter = () => ({
    kind: 'mysql' as const,
    tableExists: async (name: string) => h.state.existing.has(name),
    dropTable: async (name: string) => {
      const err = h.state.failDropOf.get(name);
      if (err !== undefined) throw new Error(err);
      h.state.ops.push(`drop:${name}`);
      h.state.existing.delete(name);
    },
    dropTables: async (names: string[]) => {
      h.state.dropTablesCalls.push([...names]);
      for (const n of names) {
        h.state.ops.push(`drop:${n}`);
        h.state.existing.delete(n);
      }
    },
    createTable: async (t: { name: string }) => {
      h.state.ops.push(`create:${t.name}`);
      h.state.existing.add(t.name);
    },
    writeBatch: async (t: { name: string }) => {
      const err = h.state.failLoadOf.get(t.name);
      if (err !== undefined) throw new Error(err);
      h.state.ops.push(`load:${t.name}`);
      return 2;
    },
    beforeLoad: async (name: string) => {
      h.state.ops.push(`clear:${name}`);
    },
    listForeignKeys: async () => {
      if (h.state.throwOnListFk) throw new Error('catalog permission denied');
      return h.state.edges;
    },
    close: async () => {
      h.state.writerCloseCount += 1;
    },
  });
  return {
    reset,
    makeReader,
    makeWriter,
    createTransferReader: async () => makeReader(),
    createTransferWriter: async () => makeWriter(),
  };
});

const connOf = (id: string): ResolvedConnection => ({ meta: { id, kind: 'mysql' }, fields: { database: 'db' } });

/** 每用例独立的假工厂状态（vi.mock 工厂闭包共享，用例间手工复位） */
async function resetState(): Promise<typeof h.state> {
  const mod = (await import('../../lib/adapters/transfer/model.js')) as unknown as {
    reset: () => void;
  };
  mod.reset();
  return h.state;
}

const indexOfOp = (ops: string[], op: string): number => {
  const i = ops.indexOf(op);
  expect(i, `操作 ${op} 应发生（实际序列 ${JSON.stringify(ops)}）`).toBeGreaterThanOrEqual(0);
  return i;
};

describe('传输编排：目标端依赖门控', () => {
  it('装载门控：父表完成装载前，引用它的子表不装载', async () => {
    const s = await resetState();
    s.edges = [{ table: 'child', referencedTable: 'parent' }];
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['child', 'parent', 'other'],
      writeMode: 'insert',
      tableConcurrency: 4,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('done');
    expect(snap.failures).toHaveLength(0);
    const { ops } = h.state;
    // 门控：parent 全部完成（load）后 child 才开始（create）
    expect(indexOfOp(ops, 'load:parent')).toBeLessThan(indexOfOp(ops, 'create:child'));
    expect(indexOfOp(ops, 'load:parent')).toBeLessThan(indexOfOp(ops, 'load:child'));
    // 无依赖的 other 表不受影响
    expect(ops).toContain('load:other');
  }, 30000);

  it('覆盖删除趟：子表先删、整批删除先于任何建表，装载仍父表先行', async () => {
    const s = await resetState();
    s.edges = [{ table: 'child', referencedTable: 'parent' }];
    s.existing = new Set(['child', 'parent']);
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['parent', 'child'],
      writeMode: 'insert',
      overwriteStructure: true,
      tableConcurrency: 4,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('done');
    const { ops } = h.state;
    const firstCreate = ops.findIndex((o) => o.startsWith('create:'));
    expect(firstCreate).toBeGreaterThan(indexOfOp(ops, 'drop:child'));
    expect(firstCreate).toBeGreaterThan(indexOfOp(ops, 'drop:parent'));
    expect(indexOfOp(ops, 'drop:child')).toBeLessThan(indexOfOp(ops, 'drop:parent'));
    expect(indexOfOp(ops, 'load:parent')).toBeLessThan(indexOfOp(ops, 'create:child'));
    // 规划写端趟结束后关闭
    expect(h.state.writerCloseCount).toBeGreaterThanOrEqual(3); // 规划 + 两表各一
  }, 30000);

  it('循环外键组：整组删除（dropTables 一次收口），不逐表重复删', async () => {
    const s = await resetState();
    s.edges = [
      { table: 'a', referencedTable: 'b' },
      { table: 'b', referencedTable: 'a' },
    ];
    s.existing = new Set(['a', 'b']);
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['a', 'b'],
      writeMode: 'insert',
      overwriteStructure: true,
      tableConcurrency: 4,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('done');
    expect(h.state.dropTablesCalls).toEqual([['a', 'b']]);
    expect(h.state.ops.filter((o) => o.startsWith('drop:')).sort()).toEqual(['drop:a', 'drop:b']);
    // 循环组成员照常装载（不参与门控，但不得被漏排）
    expect(h.state.ops.filter((o) => o.startsWith('create:')).sort()).toEqual(['create:a', 'create:b']);
    expect(h.state.ops.filter((o) => o.startsWith('load:')).sort()).toEqual(['load:a', 'load:b']);
  }, 30000);

  it('预检：目标表被选择集之外的表引用 → 覆盖删除前快速失败，不做删除', async () => {
    const s = await resetState();
    s.edges = [{ table: 'outside_child', referencedTable: 'parent' }];
    s.existing = new Set(['parent']);
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['parent', 'plain'],
      writeMode: 'insert',
      overwriteStructure: true,
      tableConcurrency: 2,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('failed');
    const parentFail = snap.failures.find((f) => f.table === 'parent');
    expect(parentFail?.error).toContain('被选择集之外的表 outside_child 外键引用');
    // 预检失败的表不做删除（保留目标现状），其余表照常
    expect(h.state.ops).not.toContain('drop:parent');
    expect(h.state.ops).toContain('load:plain');
  }, 30000);

  it('预检传染：被阻塞的引用表沿引用链阻塞其父表', async () => {
    const s = await resetState();
    // mid 被 outside 引用（阻塞）→ mid 引用的 root 也删不掉 → 一并快速失败
    s.edges = [
      { table: 'outside', referencedTable: 'mid' },
      { table: 'mid', referencedTable: 'root' },
    ];
    s.existing = new Set(['mid', 'root']);
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['root', 'mid', 'plain'],
      writeMode: 'insert',
      overwriteStructure: true,
      tableConcurrency: 2,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('failed');
    const errors = snap.failures.map((f) => `${f.table}:${f.error}`).join('\n');
    expect(errors).toContain('mid');
    expect(errors).toContain('root');
    expect(h.state.ops).not.toContain('drop:mid');
    expect(h.state.ops).not.toContain('drop:root');
    expect(h.state.ops).toContain('load:plain');
  }, 30000);

  it('truncate 清空趟：子表先清空、每表只清一次，装载父表先行', async () => {
    const s = await resetState();
    s.edges = [{ table: 'child', referencedTable: 'parent' }];
    s.existing = new Set(['child', 'parent']);
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['parent', 'child'],
      writeMode: 'truncate',
      tableConcurrency: 4,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('done');
    const { ops } = h.state;
    expect(indexOfOp(ops, 'clear:child')).toBeLessThan(indexOfOp(ops, 'clear:parent'));
    expect(ops.filter((o) => o === 'clear:child')).toHaveLength(1);
    expect(ops.filter((o) => o === 'clear:parent')).toHaveLength(1);
    expect(indexOfOp(ops, 'load:parent')).toBeLessThan(indexOfOp(ops, 'load:child'));
  }, 30000);

  it('无边直通：FIFO 输入序装载（现状行为不变）', async () => {
    const s = await resetState();
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['t2', 't1'],
      writeMode: 'insert',
      tableConcurrency: 1,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('done');
    expect(h.state.ops.filter((o) => o.startsWith('load:'))).toEqual(['load:t2', 'load:t1']);
  }, 30000);

  it('规划失败（目录查询抛错）退化为现状路径，传输照常完成', async () => {
    const s = await resetState();
    s.throwOnListFk = true;
    s.edges = [{ table: 'child', referencedTable: 'parent' }];
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['child', 'parent'],
      writeMode: 'insert',
      tableConcurrency: 1,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('done');
    expect(snap.failures).toHaveLength(0);
  }, 30000);

  it('失败上游不阻塞下游：父表装载失败后子表照常尝试', async () => {
    const s = await resetState();
    s.edges = [{ table: 'child', referencedTable: 'parent' }];
    s.failLoadOf.set('parent', '源表读取失败');
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['child', 'parent'],
      writeMode: 'insert',
      tableConcurrency: 2,
    });
    const snap = await task.finished;
    expect(snap.status).toBe('failed');
    expect(snap.failures.map((f) => f.table)).toContain('parent');
    // 子表被释放并尝试装载（与无门控行为一致，不因上游失败而跳过）
    expect(h.state.ops).toContain('load:child');
  }, 30000);

  it('门控等待期间取消：任务以 cancelled 收口，不悬挂', async () => {
    const s = await resetState();
    s.edges = [{ table: 'child', referencedTable: 'parent' }];
    s.failLoadOf.set('parent', 'BLOCK'); // parent 永远失败
    const task = startTransferTask(connOf('s'), connOf('t'), {
      tables: ['child', 'parent', 'gate1', 'gate2', 'gate3'],
      writeMode: 'insert',
      tableConcurrency: 1,
    });
    void Promise.resolve().then(() => task.cancel());
    const snap = await task.finished;
    expect(['cancelled', 'failed']).toContain(snap.status);
  }, 30000);
});
