/**
 * 传输目标端外键依赖规划（纯函数，无 IO）。
 *
 * 根因背景：传输编排此前按用户选择的表顺序处理各表（覆盖删除 / 清空 / 写入），
 * 目标端已有外键关系时（预置 schema，本工具建表不创建外键），先处理父表会被
 * 未处理的子表引用而失败——PG 2BP01「because other objects depend on it」、
 * SQL Server 3726、MySQL 3730、Oracle ORA-02449。Navicat 等工具按依赖排序传输。
 *
 * 这里把外键边收窄到选择集内（跨库/跨模式引用与选择集无关，排序无意义），
 * 用 Tarjan SCC 找出循环组（互为引用的表组），再按凝聚 DAG 拓扑排序：
 * 装载序父表在前（子表写入前父表数据已就位），删除序取其逆序（子表先删，
 * 父表删除时引用它的选择集内子表已删除——本工具重建表不建外键，重建后即无引用）。
 * 自引用边（table === referencedTable）不参与排序：删表时随表消亡，写序靠
 * 源数据键序；真正的循环组（SCC ≥ 2）单独返回，由编排层按各库官方形态处理。
 */
export interface ForeignKeyEdge {
  /** 引用方（子表） */
  table: string;
  /** 被引用方（父表） */
  referencedTable: string;
}

export interface DependencyPlan {
  /** 装载顺序（父表在前；循环组内保持输入相对序，组间仍按拓扑） */
  loadOrder: string[];
  /** 删除/清空顺序（= loadOrder 逆序，子表在前） */
  dropOrder: string[];
  /** 循环组（SCC ≥ 2 的成员表名，组内顺序为输入序） */
  cycleGroups: string[][];
}

/** 名称归一键：Oracle/DM/MySQL 目录存储大小写与用户选择名可能不同形，防御性不区分大小写 */
export function edgeKey(name: string): string {
  return name.toUpperCase();
}

/**
 * 把外键边收窄到选择集内（两端均为选中表），排除自引用边。
 * 大小写按 edgeKey 归一匹配；选择集内大小写冲突（两个表名仅大小写不同）时
 * 无法安全归一，返回空集（编排层退化为不门控，与既有行为一致）。
 */
export function restrictToSelection(tables: string[], edges: ForeignKeyEdge[]): ForeignKeyEdge[] {
  const byKey = new Map<string, string>();
  for (const t of tables) {
    const k = edgeKey(t);
    if (byKey.has(k)) return []; // 大小写冲突：归一不可靠，放弃门控
    byKey.set(k, t);
  }
  const out: ForeignKeyEdge[] = [];
  for (const e of edges) {
    const child = byKey.get(edgeKey(e.table));
    const parent = byKey.get(edgeKey(e.referencedTable));
    if (child === undefined || parent === undefined || child === parent) continue;
    out.push({ table: child, referencedTable: parent });
  }
  return out;
}

/** 邻接：child → parents（T 引用 P 时 T 依赖 P） */
function parentMapOf(tables: string[], edges: ForeignKeyEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const t of tables) m.set(t, new Set());
  for (const e of edges) m.get(e.table)?.add(e.referencedTable);
  return m;
}

/**
 * Tarjan SCC（迭代实现，防爆栈）。返回 SCC 清单：每个成员互达；
 * 顺序为逆拓扑（Tarjan 输出序），调用方自行整理。
 */
function stronglyConnected(tables: string[], parents: Map<string, Set<string>>): string[][] {
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comps: string[][] = [];
  let counter = 0;

  for (const root of tables) {
    if (indexOf.has(root)) continue;
    // 显式栈帧：节点 + 父遍历游标（迭代化递归）
    const frame: Array<{ node: string; iter: Iterator<string> }> = [];
    const visit = (node: string): void => {
      indexOf.set(node, counter);
      low.set(node, counter);
      counter += 1;
      stack.push(node);
      onStack.add(node);
      frame.push({ node, iter: (parents.get(node) ?? new Set()).values() });
    };
    visit(root);
    while (frame.length > 0) {
      const top = frame[frame.length - 1];
      if (top === undefined) break;
      const next = top.iter.next();
      if (next.done) {
        frame.pop();
        if (low.get(top.node) === indexOf.get(top.node)) {
          const comp: string[] = [];
          for (;;) {
            const w = stack.pop();
            if (w === undefined) break;
            onStack.delete(w);
            comp.push(w);
            if (w === top.node) break;
          }
          comps.push(comp);
        }
        const parentFrame = frame[frame.length - 1];
        if (parentFrame !== undefined) {
          low.set(parentFrame.node, Math.min(low.get(parentFrame.node) ?? 0, low.get(top.node) ?? 0));
        }
        continue;
      }
      const w = next.value;
      if (!indexOf.has(w)) {
        visit(w);
      } else if (onStack.has(w)) {
        low.set(top.node, Math.min(low.get(top.node) ?? 0, indexOf.get(w) ?? 0));
      }
    }
  }
  return comps;
}

/**
 * 依赖规划主入口：输入选择集与选择集内边（先过 restrictToSelection）。
 * 输出装载序 / 删除序 / 循环组。边为空时与输入序一致（不门控）。
 */
export function planDependencies(tables: string[], edges: ForeignKeyEdge[]): DependencyPlan {
  const restricted = restrictToSelection(tables, edges);
  const parents = parentMapOf(tables, restricted);
  const comps = stronglyConnected(tables, parents);

  // 循环组 = SCC ≥ 2（自引用边已排除，单点 SCC 不会成环）；成员按输入序，保证
  // 整组删除等下游动作的确定性
  const cycleGroups = comps
    .filter((c) => c.length >= 2)
    .map((c) => c.slice().sort((a, b) => firstIndexOf(tables, [a]) - firstIndexOf(tables, [b])));

  // 凝聚 DAG：SCC → SCC（edge child→parent），Kahn 拓扑排序（依赖=父表组先出）
  const compIdOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((n) => compIdOf.set(n, i)));
  const compParents = new Map<number, Set<number>>(); // comp i 依赖的 comp 集合
  const compChildren = new Map<number, Set<number>>();
  const compFirst = new Map<number, number>(); // 组内最早输入位次（无依赖时按输入序出队）
  comps.forEach((c, i) => {
    compParents.set(i, new Set());
    compChildren.set(i, new Set());
    compFirst.set(i, firstIndexOf(tables, c));
  });
  for (const e of restricted) {
    const ci = compIdOf.get(e.table);
    const pi = compIdOf.get(e.referencedTable);
    if (ci === undefined || pi === undefined || ci === pi) continue;
    compParents.get(ci)?.add(pi);
    compChildren.get(pi)?.add(ci);
  }
  // in-degree = 依赖数；先输出无依赖的（父表组）
  const indegree = new Map<number, number>();
  comps.forEach((_, i) => indegree.set(i, compParents.get(i)?.size ?? 0));
  const queue: number[] = comps.map((_, i) => i).filter((i) => indegree.get(i) === 0);
  const compOrder: number[] = [];
  while (queue.length > 0) {
    // 取输入序最靠前的组，保证无依赖场景与用户输入序一致
    let pick = 0;
    for (let i = 1; i < queue.length; i++) {
      if ((compFirst.get(queue[i] as number) ?? Infinity) < (compFirst.get(queue[pick] as number) ?? Infinity)) {
        pick = i;
      }
    }
    const ci = queue.splice(pick, 1)[0];
    if (ci === undefined) break;
    compOrder.push(ci);
    for (const child of compChildren.get(ci) ?? []) {
      const rest = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, rest);
      if (rest === 0) queue.push(child);
    }
  }

  const loadOrder: string[] = [];
  for (const ci of compOrder) {
    // 组内按输入序（组即循环组或单点；循环组内部顺序交由各库官方抑制机制处理）
    const members = (comps[ci] ?? []).slice().sort((a, b) => firstIndexOf(tables, [a]) - firstIndexOf(tables, [b]));
    loadOrder.push(...members);
  }
  return { loadOrder, dropOrder: [...loadOrder].reverse(), cycleGroups };
}

function firstIndexOf(tables: string[], members: string[]): number {
  const set = new Set(members.map((m) => edgeKey(m)));
  return tables.findIndex((t) => set.has(edgeKey(t)));
}
