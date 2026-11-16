/**
 * 传输目标端依赖规划纯函数测试（lib/adapters/transfer/deps.ts）。
 * 覆盖：选择集收窄（跨集边剔除、大小写归一、自引用剔除）、拓扑装载序（父表在前）、
 * 删除序（子表在前）、循环组识别（SCC ≥ 2；自引用不成组）、链式多级依赖、
 * 无边 = 输入序（不门控）、大小写冲突防御退化。
 */
import { describe, expect, it } from 'vitest';
import { edgeKey, planDependencies, restrictToSelection, type ForeignKeyEdge } from '../../lib/adapters/transfer/deps.js';

const e = (table: string, referencedTable: string): ForeignKeyEdge => ({ table, referencedTable });

describe('restrictToSelection', () => {
  it('两端都在选择集内的边保留，跨集边与自引用剔除', () => {
    const edges = [e('child', 'parent'), e('child', 'outside'), e('outside', 'parent'), e('self', 'self')];
    expect(restrictToSelection(['child', 'parent'], edges)).toEqual([e('child', 'parent')]);
  });

  it('大小写归一匹配（目录存储形态与选择名不同形）', () => {
    expect(restrictToSelection(['Orders', 'order_items'], [e('order_items', 'ORDERS')])).toEqual([
      { table: 'order_items', referencedTable: 'Orders' },
    ]);
  });

  it('选择集内大小写冲突时放弃归一（返回空集退化）', () => {
    expect(restrictToSelection(['users', 'USERS'], [e('users', 'USERS')])).toEqual([]);
  });

  it('归一后两端都用选择集拼写', () => {
    expect(restrictToSelection(['T1', 't2'], [e('T2', 't1')])).toEqual([e('t2', 'T1')]);
  });
});

describe('planDependencies', () => {
  it('无边 = 输入序（不改变既有行为）', () => {
    const plan = planDependencies(['b', 'a', 'c'], []);
    expect(plan.loadOrder).toEqual(['b', 'a', 'c']);
    expect(plan.dropOrder).toEqual(['c', 'a', 'b']);
    expect(plan.cycleGroups).toEqual([]);
  });

  it('装载序父表在前，删除序子表在前（输入序为子表在前也应正确）', () => {
    const plan = planDependencies(['child', 'parent'], [e('child', 'parent')]);
    expect(plan.loadOrder).toEqual(['parent', 'child']);
    expect(plan.dropOrder).toEqual(['child', 'parent']);
  });

  it('链式多级依赖：根 → 中间 → 叶', () => {
    const plan = planDependencies(['leaf', 'root', 'mid'], [e('mid', 'root'), e('leaf', 'mid')]);
    expect(plan.loadOrder).toEqual(['root', 'mid', 'leaf']);
    expect(plan.dropOrder).toEqual(['leaf', 'mid', 'root']);
  });

  it('无依赖表保持输入相对序，穿插在依赖表之间', () => {
    const plan = planDependencies(['z_free', 'child', 'a_free', 'parent'], [e('child', 'parent')]);
    // 无依赖组按输入序（z_free → a_free → parent），child 依赖 parent 排最后
    expect(plan.loadOrder).toEqual(['z_free', 'a_free', 'parent', 'child']);
  });

  it('互为引用的两表识别为循环组，组外表仍参与排序', () => {
    const plan = planDependencies(['a', 'b', 'plain'], [e('a', 'b'), e('b', 'a')]);
    expect(plan.cycleGroups).toEqual([['a', 'b']]);
    // 循环组不参与装载门控：装载序仍给出一个可行序（组内输入序）
    expect(plan.loadOrder).toEqual(['a', 'b', 'plain']);
    expect(plan.dropOrder).toEqual(['plain', 'b', 'a']);
  });

  it('三表循环组（a→b→c→a）', () => {
    const plan = planDependencies(['a', 'b', 'c'], [e('a', 'b'), e('b', 'c'), e('c', 'a')]);
    expect(plan.cycleGroups).toEqual([['a', 'b', 'c']]);
  });

  it('自引用不成循环组', () => {
    const plan = planDependencies(['emp'], [e('emp', 'emp')]);
    expect(plan.cycleGroups).toEqual([]);
    expect(plan.loadOrder).toEqual(['emp']);
  });

  it('循环组外的依赖照常排序：root → [循环组] 与独立表', () => {
    // x→y+y→x 循环组；root 被 group.x 引用：root 是父表须先装载
    const plan = planDependencies(['x', 'y', 'root'], [e('x', 'y'), e('y', 'x'), e('x', 'root')]);
    expect(plan.cycleGroups).toEqual([['x', 'y']]);
    expect(plan.loadOrder.indexOf('root')).toBeLessThan(plan.loadOrder.indexOf('x'));
  });

  it('指向循环组之外的正确边：父表先装载、子表先删除', () => {
    const plan = planDependencies(['p', 'q'], [e('p', 'q')]);
    expect(plan.loadOrder).toEqual(['q', 'p']);
    expect(plan.dropOrder).toEqual(['p', 'q']);
  });

  it('大小写不同的目录名与选择名归一后仍正确排序', () => {
    const plan = planDependencies(['Orders', 'items'], [e('ITEMS', 'ORDERS')]);
    expect(plan.loadOrder).toEqual(['Orders', 'items']);
    expect(plan.cycleGroups).toEqual([]);
  });
});

describe('edgeKey', () => {
  it('大小写归一', () => {
    expect(edgeKey('Users')).toBe('USERS');
    expect(edgeKey('users')).toBe(edgeKey('USERS'));
  });
});
