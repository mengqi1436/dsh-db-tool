/**
 * 数据传输编排器：多表并行 + 大表分片并行的任务引擎。
 *
 * 并行设计：
 *  - 表级并行：每表独立 reader/writer 连接（transfer 读写端工厂按连接配置创建），
 *    tableConcurrency 个 worker 同时传不同表；
 *  - 表内分片并行：源支持 keyAt 切块且分片键可范围比较时，按 batchSize 采样切块
 *    （[lo, hi) 半开区间，不重不漏），shardConcurrency 个 worker 并行读+写；
 *  - 并行降级链：目标 sqlite（单写者）→ 表级与分片全部串行；源 oracle/dm（读端
 *    专用单连接）→ 表内不分片（表级并行仍生效）。
 * 错误恢复：失败分片重试 1 次（幂等性依赖 writeMode=ignore/replace；insert 模式
 * 部分写入后重试会唯一键冲突，如实进失败清单）；最终失败记录到 failures（JSON-safe，
 * bigint 键转字符串——JSON.stringify 对 bigint 抛 TypeError，进度接口会整个崩）。
 */
import type { ResolvedConnection } from './adapters/types.js';
import {
  createTransferReader,
  createTransferWriter,
  type TransferCell,
  type TransferForeignKey,
  type TransferIndex,
  type TransferReader,
  type TransferRow,
  type TransferTable,
  type TransferWriter,
  type WriteMode,
} from './adapters/transfer/model.js';
import {
  edgeKey,
  planDependencies,
  restrictToSelection,
  type DependencyPlan,
  type ForeignKeyEdge,
} from './adapters/transfer/deps.js';

export interface TransferTaskOptions {
  /** 源表清单（纯表名，连接默认上下文内） */
  tables: string[];
  writeMode: WriteMode;
  /** 每批行数（默认 500） */
  batchSize?: number;
  /** 表级并行度（默认 2） */
  tableConcurrency?: number;
  /** 单表分片并行度（默认 2；源不支持切块或分片键不可用时自动回退顺序） */
  shardConcurrency?: number;
  /** 源/目标库与模式定位（BrowsePane 语义；全缺省 = 连接默认上下文） */
  sourceDatabase?: string;
  sourceSchema?: string;
  targetDatabase?: string;
  targetSchema?: string;
  /** 覆盖已有表结构：目标表存在时删除重建（危险——旧数据全部丢失；默认 false，按写入模式处理） */
  overwriteStructure?: boolean;
  /** 传输日志事件回调：任务开始/表状态变化/进度节流/终态时触发（宿主落盘到日志文件） */
  onLog?: (ev: {
    type: 'start' | 'table' | 'progress' | 'finish';
    taskId: string;
    status?: string;
    table?: string;
    rows?: number;
    totalRows?: number | null;
    tables?: TransferTableProgress[];
    failures?: TransferFailure[];
  }) => void;
}

export interface TransferTableProgress {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  /** 已写入行数 */
  rows: number;
  totalRows: number | null;
  shardsTotal: number;
  shardsDone: number;
  shardsFailed: number;
  error?: string;
}

export interface TransferFailure {
  table: string;
  /** 分片序号；全表失败为 -1 */
  shard: number;
  error: string;
  /** 分片下界键（bigint 已转字符串保精度） */
  lastKey?: string;
}

export interface TransferSnapshot {
  status: 'running' | 'done' | 'failed' | 'cancelled';
  tables: TransferTableProgress[];
  failures: TransferFailure[];
}

export interface TransferTask {
  readonly id: string;
  /** JSON-safe 快照（进度轮询直接序列化返回） */
  snapshot(): TransferSnapshot;
  cancel(): void;
  /** 任务终态（含 cancelled）；不 reject——失败进快照 */
  finished: Promise<TransferSnapshot>;
}

// 默认值按各驱动官方批量实践取：oracledb executeMany 防 DPI-1015 需分批（批 ~1000）、
// mongo bulkWrite 由驱动按 maxWriteBatchSize 自动切批（客户端批大小不敏感）、
// mysql2/pg 逐行 execute+事务包裹（批大小只影响事务粒度）——批 1000 为全库安全交集
const DEFAULT_BATCH = 1000;
const DEFAULT_TABLE_CONCURRENCY = 4;
const DEFAULT_SHARD_CONCURRENCY = 4;
/** 单表分片数上限（切块探测查询随之有界） */
const MAX_SHARDS = 32;
/** 单批行数上限：readBatch 单批整批进内存（HTTP 可传任意大值打内存） */
const MAX_BATCH = 5000;
/** 并行度上限：每 worker 独立 reader/writer 连接池，无界并发会打爆两端（前端表单 max 同值）；
 *  ponytail: 连接预算 ≈ tableConcurrency × 目标端单池 max（pg 4/mysql 10），目标库 max_connections 偏小时由用户自行调低 */
const MAX_TABLE_CONCURRENCY = 16;
const MAX_SHARD_CONCURRENCY = 32;
/** 失败分片重试次数 */
const SHARD_RETRIES = 1;

let seq = 0;

/** 目标端单写者（SQLite 同库并发写锁死）→ 表级/分片全部串行 */
function isSingleWriterTarget(kind: ResolvedConnection['meta']['kind']): boolean {
  return kind === 'sqlite';
}

/** 源端读走专用单连接（oralike）→ 表内分片并行不可用 */
function supportsShardRead(kind: ResolvedConnection['meta']['kind']): boolean {
  return kind !== 'oracle' && kind !== 'dmdb';
}

export function startTransferTask(
  source: ResolvedConnection,
  target: ResolvedConnection,
  opts: TransferTaskOptions,
): TransferTask {
  const id = `t${Date.now().toString(36)}-${++seq}`;
  const batchSize = Math.min(MAX_BATCH, Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH)));
  // 目标端单写者（SQLite 同库多连接并发写锁死）→ 表级并行钳 1；
  // 表内分片仍可并行：分片共享同一 writer，其事务块为同步原子段，写入天然串行化
  const tableConcurrency = isSingleWriterTarget(target.meta.kind)
    ? 1
    : Math.min(MAX_TABLE_CONCURRENCY, Math.max(1, Math.floor(opts.tableConcurrency ?? DEFAULT_TABLE_CONCURRENCY)));
  const shardConcurrency = Math.min(
    MAX_SHARD_CONCURRENCY,
    Math.max(1, Math.floor(opts.shardConcurrency ?? DEFAULT_SHARD_CONCURRENCY)),
  );

  // 定位组装（全缺省 = undefined，读写端走现状路径）；定位仅影响工厂入口，
  // 分片/进度/快照编排不感知
  const srcLoc = (opts.sourceDatabase ?? opts.sourceSchema)
    ? { database: opts.sourceDatabase, schema: opts.sourceSchema }
    : undefined;
  const dstLoc = (opts.targetDatabase ?? opts.targetSchema)
    ? { database: opts.targetDatabase, schema: opts.targetSchema }
    : undefined;

  const tables: TransferTableProgress[] = opts.tables.map((name) => ({
    name,
    status: 'pending',
    rows: 0,
    totalRows: null,
    shardsTotal: 0,
    shardsDone: 0,
    shardsFailed: 0,
  }));
  const failures: TransferFailure[] = [];
  let status: TransferSnapshot['status'] = 'running';
  let cancelled = false;
  let resolveFinished: ((s: TransferSnapshot) => void) | undefined;
  /** 门控装载趟的就绪队列唤醒句柄：worker 空转等待时由完成回调/取消触发（见 sleep/notify） */
  let wakeScheduler: (() => void) | null = null;
  const finished = new Promise<TransferSnapshot>((resolve) => {
    resolveFinished = resolve;
  });

  const snapshot = (): TransferSnapshot => ({
    status,
    tables: tables.map((t) => ({ ...t })),
    failures: failures.map((f) => ({ ...f })),
  });
  const emit = (ev: {
    type: 'start' | 'table' | 'progress' | 'finish';
    status?: string;
    table?: string;
    rows?: number;
    totalRows?: number | null;
    tables?: TransferTableProgress[];
    failures?: TransferFailure[];
  }): void => {
    if (!opts.onLog) return;
    opts.onLog({ taskId: id, ...ev });
  };

  let finishEmitted = false;
  const finish = (): void => {
    if (finishEmitted) return; // 门控/无门控两路径兜底都可能收口，终态事件只发一次
    finishEmitted = true;
    if (status === 'running') status = cancelled ? 'cancelled' : failures.length > 0 ? 'failed' : 'done';
    emit({ type: 'finish', status, tables: tables.map((t) => ({ ...t })), failures: failures.map((f) => ({ ...f })) });
    resolveFinished?.(snapshot());
  };

  /** 分片切块：按 batchSize 采样边界键 → [lo, hi) 区间清单（探测查询 ≤ 分片数） */
  async function planShards(
    reader: TransferReader,
    table: string,
    column: string,
    totalRows: number,
  ): Promise<Array<{ lo: TransferCell | null; hi: TransferCell | null; index: number }>> {
    const shardCount = Math.min(Math.max(1, Math.ceil(totalRows / batchSize)), MAX_SHARDS);
    if (shardCount <= 1 || !reader.keyAt) return [{ lo: null, hi: null, index: 0 }];
    const bounds: Array<{ lo: TransferCell | null; hi: TransferCell | null; index: number }> = [];
    let prev: TransferCell | null = null;
    for (let i = 1; i < shardCount; i++) {
      if (cancelled) break;
      const key = await reader.keyAt(table, column, i * batchSize);
      if (key === null) break; // 边界越界（实际行数少于估计）：提前收口
      if (prev !== null && String(key) === String(prev)) continue; // 键重复（同值多行）：跳过空区间
      bounds.push({ lo: prev, hi: key, index: bounds.length });
      prev = key;
    }
    bounds.push({ lo: bounds.length > 0 ? prev : null, hi: null, index: bounds.length });
    return bounds;
  }

  async function runShard(
    reader: TransferReader,
    writer: TransferWriter,
    t: TransferTable,
    column: string,
    shard: { lo: TransferCell | null; hi: TransferCell | null },
    prog: TransferTableProgress,
  ): Promise<boolean> {
    const keyIdx = Math.max(0, t.columns.findIndex((c) => c.name === column));
    const attempt = async (): Promise<boolean> => {
      let lo = shard.lo;
      let loInclusive = true;
      for (;;) {
        if (cancelled) return false; // 取消中断：与「完整跑完」区分（表级 status 依赖此判定）
        const rows = await reader.readBatch(
          t.name,
          { mode: 'range', column, lo, loInclusive, hi: shard.hi },
          batchSize,
        );
        if (rows.length === 0) return true;
        // 两步累加：`+= await` 的读改写跨 await，分片并发共享 prog 时会丢其他分片的增量
        const written = await writer.writeBatch(t, rows);
        prog.rows += written;
        if (rows.length < batchSize) return true;
        const nextLo = rows[rows.length - 1]?.[keyIdx] ?? null;
        // 守恒断言：批间链式（k > lo）下 lastKey 不前进 = 结构漂移致列错位，恒取同一批 → 死循环
        if (!loInclusive && lo !== null && nextLo !== null && String(nextLo) === String(lo)) {
          throw new Error(`keyset 分片无进展（键 ${String(lo)}），已中止：源表结构可能在传输期间被变更`);
        }
        lo = nextLo;
        loInclusive = false; // 批间链式：k > lastKey 且 k < hi
      }
    };
    try {
      return await attempt();
    } catch (e) {
      if (cancelled) throw e;
      return await attempt(); // 分片级重试 1 次（幂等性依赖 writeMode=ignore/replace）
    }
  }

  async function runTable(name: string, prog: TransferTableProgress): Promise<void> {
    // reader/writer 创建也在 try 内：单表连接失败只毁该表（进 failures），
    // 不冒泡终止整个任务；writer 失败时已打开的 reader 由 finally 关闭
    let reader: TransferReader | undefined;
    let writer: TransferWriter | undefined;
    try {
      prog.status = 'running';
    emit({ type: 'table', status: 'running', table: name, rows: 0, totalRows: null });
      const r = await createTransferReader(source, srcLoc);
      reader = r; // 立即回填外层引用：writer 创建抛错时 finally 仍能关闭已打开的 reader
      const w = await createTransferWriter(target, opts.writeMode, dstLoc);
      writer = w;
      const t: TransferTable = await r.describe(name);
      prog.totalRows = await r.count(name);
      // 结构随迁采集：源端索引/外键定义（读取失败不阻断数据传输，记入失败清单）
      if (r.describeIndexes !== undefined || r.describeForeignKeys !== undefined) {
        try {
          const idx = await r.describeIndexes?.(name);
          if (idx !== undefined && idx.length > 0) structIdx.set(name, idx);
        } catch (e) {
          failures.push({
            table: name,
            shard: -1,
            error: `结构随迁：读取源端索引失败: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
        try {
          const fks = await r.describeForeignKeys?.(name);
          if (fks !== undefined && fks.length > 0) structFks.set(name, fks);
        } catch (e) {
          failures.push({
            table: name,
            shard: -1,
            error: `结构随迁：读取源端外键失败: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      // 先查目标表是否存在——有无表都不该「建表失败」：
      // 无表 → 建表再写；有表 → 按写入模式处理（结构冲突可开覆盖表结构选项）
      const exists = await w.tableExists(name);
      if (exists && opts.overwriteStructure) {
        // 覆盖表结构：删除重建（危险选项；新表结构与源一致，无需清空）。
        // 门控模式下删除趟已先行整批删除（子表先删），此处仅作兜底
        try {
          await w.dropTable(name);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`删除目标表 ${name} 失败（可能仍被其他表/视图依赖）: ${msg}`);
        }
        await w.createTable(t, structFks.get(name));
      } else if (exists) {
        if (opts.writeMode === 'truncate' && w.beforeLoad) {
          // 清空趟（门控模式）已按子表先行的顺序整批清空过的表不再重复清空
          if (!cleared.has(name)) await w.beforeLoad(name); // 清空旧数据再写
        } else if (opts.writeMode === 'insert') {
          throw new Error(`目标表已存在: ${name}（insert 不覆盖已有数据，请改用 ignore/replace/truncate 或开启覆盖表结构）`);
        }
        // ignore/replace：写入语句自带冲突处理，直接写
      } else {
        await w.createTable(t, structFks.get(name));
      }
      const keyType = await r.shardKey(name);
      const keyCol = keyType ? (t.columns.find((c) => c.primaryKey) ?? t.columns[0]) : undefined;
      const shardable =
        keyType !== null &&
        keyCol !== undefined &&
        shardConcurrency > 1 &&
        supportsShardRead(source.meta.kind) &&
        r.keyAt !== undefined &&
        (prog.totalRows ?? 0) > batchSize * 2;

      if (shardable && keyCol) {
        const shards = await planShards(r, name, keyCol.name, prog.totalRows ?? 0);
        prog.shardsTotal = shards.length;
        const workers = Array.from({ length: Math.min(shardConcurrency, shards.length) }, async () => {
          for (;;) {
            const shard = shards.shift();
            if (shard === undefined || cancelled) return;
            try {
              // 返回值区分「完整跑完」与「取消中断」：后者不计入 shardsDone（表级不得标 done）
              if (await runShard(r, w, t, keyCol.name, shard, prog)) prog.shardsDone += 1;
            } catch (e) {
              prog.shardsFailed += 1;
              failures.push({
                table: name,
                shard: shard.index,
                error: e instanceof Error ? e.message : String(e),
                lastKey: shard.lo === null ? undefined : String(shard.lo),
              });
            }
          }
        });
        await Promise.all(workers);
      } else {
        // 顺序链：单分片 range 全序（含 keyset 链语义）；无分片键走 offset
        prog.shardsTotal = 1;
        try {
          const complete = keyType !== null && keyCol
            ? await runShard(r, w, t, keyCol.name, { lo: null, hi: null }, prog)
            : await runOffset(r, w, t, prog);
          if (complete) prog.shardsDone += 1;
        } catch (e) {
          prog.shardsFailed += 1;
          failures.push({ table: name, shard: -1, error: e instanceof Error ? e.message : String(e) });
        }
      }
      // 表级终态：分片未跑完（取消时 worker 提前退出）不得标 done——否则被误读为「已完整传输」
      const complete = prog.shardsDone + prog.shardsFailed >= prog.shardsTotal;
      // 自增序列起点校准（pg 系 serial：显式插入原值不推进序列，需 setval 到 max+1）。
      // 失败仅记失败清单，不改变数据已完整的表级状态
      if (complete && w.afterLoad !== undefined) {
        try {
          await w.afterLoad(t);
        } catch (e) {
          failures.push({
            table: name,
            shard: -1,
            error: `结构随迁：自增序列起点校准失败: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      prog.status = complete
        ? (prog.shardsFailed > 0 ? 'failed' : 'done')
        : 'cancelled';
      emit({ type: 'table', status: prog.status, table: name, rows: prog.rows, totalRows: prog.totalRows });
    } catch (e) {
      prog.status = 'failed';
      prog.error = e instanceof Error ? e.message : String(e);
      failures.push({ table: name, shard: -1, error: prog.error });
    } finally {
      await reader?.close().catch(() => {});
      await writer?.close().catch(() => {});
    }
  }

  /** 无分片键降级：offset 全序（sqlite 无主键表不用 rowid——评审已证伪该路径） */
  async function runOffset(
    reader: TransferReader,
    writer: TransferWriter,
    t: TransferTable,
    prog: TransferTableProgress,
  ): Promise<boolean> {
    for (let offset = 0; ; offset += batchSize) {
      if (cancelled) return false; // 取消中断：与「完整跑完」区分（表级 status 依赖此判定）
      const rows = await reader.readBatch(t.name, { mode: 'offset', offset }, batchSize);
      if (rows.length === 0) return true;
      const written = await writer.writeBatch(t, rows);
      prog.rows += written;
      if (rows.length < batchSize) return true;
    }
  }

  /** 结构随迁趟：全部表数据装载完成后建索引、加外键约束（数据齐备后校验才能通过，
   *  循环引用与自引用亦然）。逐条失败隔离记入失败清单，不阻断、不改变表级状态。
   *  目标端已有同名索引 / 同边外键（重复传输、目标预置结构）跳过创建。 */
  async function runStructurePass(): Promise<void> {
    if (structIdx.size === 0 && structFks.size === 0) return;
    let writer: TransferWriter;
    try {
      writer = await createTransferWriter(target, opts.writeMode, dstLoc);
    } catch (e) {
      failures.push({
        table: '*',
        shard: -1,
        error: `结构随迁：目标写端创建失败: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    try {
      // 目标端既有索引名 / 外键边内省：失败按空集处理（尽力创建，冲突由失败清单呈现）
      let existingIdx = new Set<string>();
      let existingFks: ForeignKeyEdge[] = [];
      try {
        existingIdx = new Set(((await writer.listIndexes?.()) ?? []).map(normalizeIdxKey));
        existingFks = (await writer.listForeignKeys?.()) ?? [];
      } catch {
        existingIdx = new Set();
        existingFks = [];
      }
      const sameCols = (a: string[], b: string[]): boolean => {
        const ka = [...a].map(edgeKey).sort();
        const kb = [...b].map(edgeKey).sort();
        return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
      };
      const fkExists = (table: string, fk: TransferForeignKey): boolean =>
        existingFks.some((e) => {
          if (edgeKey(e.table) !== edgeKey(table) || edgeKey(e.referencedTable) !== edgeKey(fk.referencedTable)) {
            return false;
          }
          if (e.name !== undefined && e.name !== '') return e.name === fk.name;
          if ((e.columns?.length ?? 0) > 0) {
            return sameCols(e.columns ?? [], fk.columns) && sameCols(e.referencedColumns ?? [], fk.referencedColumns);
          }
          return false;
        });
      for (const [table, indexes] of structIdx) {
        for (const idx of indexes) {
          if (cancelled) return;
          // 索引键统一「表名.索引名」形态（mysql/sqlserver 索引名仅表内唯一）
          if (existingIdx.has(normalizeIdxKey(`${table}.${idx.name}`))) continue;
          if (writer.createIndex === undefined) continue;
          try {
            await writer.createIndex(table, idx);
          } catch (e) {
            failures.push({
              table,
              shard: -1,
              error: `结构随迁：索引 ${table}.${idx.name} 创建失败: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
      }
      for (const [table, fks] of structFks) {
        for (const fk of fks) {
          if (cancelled) return;
          if (fkExists(table, fk)) continue;
          if (writer.createForeignKey === undefined) continue;
          try {
            await writer.createForeignKey(table, fk);
          } catch (e) {
            failures.push({
              table,
              shard: -1,
              error: `结构随迁：外键 ${table}.${fk.name} 创建失败（引用表是否在本次传输范围内？）: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
      }
    } finally {
      await writer.close().catch(() => {});
    }
  }

  // ---------- 目标端依赖门控 ----------
  // 目标端已有外键关系（预置 schema；本工具建表不创建外键）时，按用户选择顺序处理
  // 各表会让父表的删除/清空被未处理子表引用而失败（PG 2BP01「有其他对象依赖它」/
  // SQL Server 3726 / MySQL 3730 / Oracle ORA-02449），写入也会因子表先于父表装载而
  // 外键冲突（MySQL 1452 / PG 23503 / SQL Server 547 / Oracle ORA-02291）。
  // 规划一次目标端外键图（编排器独占一个写端连接查目录），选择集内存在依赖边才启用
  // 门控：删除/清空趟子表先行（删除序 = 装载序逆序），装载趟父表先行（就绪队列）。
  // 无边场景（本工具自建目标表的绝大多数传输）与 mongo/redis 零开销直通现状路径。

  interface Gating {
    plan: DependencyPlan;
    /** 循环组成员 → 所在组（整组删除用） */
    cycleOf: Map<string, string[]>;
    /** 选择集内的外键边（装载门控的依据） */
    restricted: ForeignKeyEdge[];
    /** 规划/趟阶段专用的写端（趟结束后由主流程关闭） */
    writer: TransferWriter;
    /** 规划期已终态失败的表（覆盖删除预检） */
    preFailed: Set<string>;
  }

  /** 清空趟已清空的表（truncate 模式，runTable 跳过二次清空） */
  const cleared = new Set<string>();

  /** 结构随迁采集：源端索引/外键定义（按源表名分组，装载趟时逐表采集） */
  const structIdx = new Map<string, TransferIndex[]>();
  const structFks = new Map<string, TransferForeignKey[]>();

  /** 索引键归一：「表名.索引名」按 edgeKey 大小写归一（末段为索引名，表名可含点号的
   *  病理名按最后一段切分） */
  const normalizeIdxKey = (raw: string): string => {
    const dot = raw.lastIndexOf('.');
    if (dot < 0) return edgeKey(raw);
    return `${edgeKey(raw.slice(0, dot))}.${edgeKey(raw.slice(dot + 1))}`;
  };

  /** 把一张表按失败收口（预检/删除趟/清空趟的提前失败），快照与进度事件同步 */
  function failUpfront(name: string, error: string): void {
    const prog = tables.find((t) => t.name === name);
    if (prog === undefined || prog.status !== 'pending') return;
    prog.status = 'failed';
    prog.error = error;
    failures.push({ table: name, shard: -1, error });
    emit({ type: 'table', status: 'failed', table: name, rows: 0, totalRows: prog.totalRows });
  }

  /**
   * 目标端外键图规划。仅多表且目标端存在选择集内的依赖边时返回门控；
   * 目录查询失败/无边/单表都返回 null（退化为现状路径，与既有行为一致）。
   * 预检在规划期完成：覆盖删除时，被「选择集之外」的表引用的目标表删除必然被
   * 数据库拦截，提前给出可行动的明确提示并沿引用链向上传染（引用方不删除，
   * 被引用方也无法删除）。
   */
  async function planGating(): Promise<Gating | null> {
    if (opts.tables.length <= 1) return null; // 单表无排序可言
    let writer: TransferWriter | null = null;
    try {
      writer = await createTransferWriter(target, opts.writeMode, dstLoc);
      const rawEdges = (await writer.listForeignKeys?.()) ?? [];
      if (rawEdges.length === 0) {
        await writer.close().catch(() => {});
        return null;
      }
      // 预检先于「选择集内无边」判定：选择集内无边但存在跨选择集引用时（父子表只有
      // 一端被选中），覆盖删除同样必然失败，预检提示仍然成立（其余表走现状路径）
      const preFailed = new Set<string>();
      if (opts.overwriteStructure && target.meta.kind !== 'sqlite') {
        // sqlite 不做删除预检：SQLite 对 DROP 的外键检查是数据相关的（隐式 DELETE + 约束
        // 校验，子表无行时不报错），预检会误拦本可成功的传输；选择集内的删除顺序由
        // 删除趟（子表先行 + 循环组 foreign_keys=OFF 窗口）保证
        const selected = new Set(opts.tables.map((t) => edgeKey(t)));
        const blockedBy = new Map<string, Set<string>>();
        for (const e of rawEdges) {
          if (selected.has(edgeKey(e.table))) continue; // 选择集内子表会先删，不拦截
          const parent = opts.tables.find((t) => edgeKey(t) === edgeKey(e.referencedTable));
          if (parent === undefined) continue;
          const set = blockedBy.get(parent) ?? new Set<string>();
          set.add(e.table);
          blockedBy.set(parent, set);
        }
        for (const [parent, children] of blockedBy) {
          preFailed.add(edgeKey(parent));
          failUpfront(parent, `目标表 ${parent} 被选择集之外的表 ${[...children].join('、')} 外键引用，覆盖删除会失败：请把引用表一并纳入传输，或先处理其外键约束`);
        }
      }
      const restricted = restrictToSelection(opts.tables, rawEdges);
      if (restricted.length === 0) {
        await writer.close().catch(() => {});
        return null;
      }
      const plan = planDependencies(opts.tables, rawEdges);
      const cycleOf = new Map<string, string[]>();
      for (const group of plan.cycleGroups) for (const m of group) cycleOf.set(m, group);
      // 沿引用链向上传染：选择集内的引用方被阻塞（不会被删除）时，它引用的父表同样删不掉
      if (preFailed.size > 0) {
        for (;;) {
          let grew = false;
          for (const e of restricted) {
            if (!preFailed.has(edgeKey(e.table)) || preFailed.has(edgeKey(e.referencedTable))) continue;
            const parent = opts.tables.find((t) => edgeKey(t) === edgeKey(e.referencedTable));
            if (parent === undefined) continue;
            preFailed.add(edgeKey(parent));
            failUpfront(parent, `目标表 ${parent} 的引用表 ${e.table} 无法覆盖删除，删除序被阻塞：请把选择集之外的依赖表一并纳入传输，或先处理其外键约束`);
            grew = true;
          }
          if (!grew) break;
        }
      }
      return { plan, cycleOf, restricted, writer, preFailed };
    } catch {
      // 规划失败（目录查询权限、驱动差异等）不阻断传输：退化为无门控路径
      await writer?.close().catch(() => {});
      return null;
    }
  }

  /** 删除趟（仅覆盖表结构）：按删除序（子表先行）整批删除，循环组走官方整组删除 */
  async function runDropPass(gate: Gating, failed: Set<string>): Promise<void> {
    if (!opts.overwriteStructure) return;
    for (const k of gate.preFailed) failed.add(k);
    const dropped = new Set<string>();
    for (const name of gate.plan.dropOrder) {
      if (cancelled) return;
      const key = edgeKey(name);
      const group = gate.cycleOf.get(name);
      if (group !== undefined && !failed.has(key) && group.some((m) => failed.has(edgeKey(m)))) {
        // 组内成员被预检阻塞：整组放弃删除（部分删除会让组内其余表失去引用方而
        // 残留悬空状态），成员按已失败收口
        for (const m of group) {
          if (failed.has(edgeKey(m))) continue;
          failUpfront(m, `循环外键组内表 ${name} 被选择集之外的表依赖，整组覆盖删除已放弃`);
          failed.add(edgeKey(m));
        }
        continue;
      }
      if (failed.has(key) || dropped.has(key)) continue;
      try {
        if (group !== undefined) {
          // 循环组整组删除：单表删除互为引用必失败，各库官方形态见各写端 dropTables
          const dropGroup = gate.writer.dropTables;
          if (dropGroup === undefined) throw new Error(`循环外键组 ${group.join('、')} 缺少整组删除支持`);
          await dropGroup.call(gate.writer, group);
          for (const m of group) dropped.add(edgeKey(m));
        } else if (await gate.writer.tableExists(name)) {
          await gate.writer.dropTable(name);
        }
        dropped.add(key);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failUpfront(name, `覆盖删除目标表 ${name} 失败（可能仍被其他对象依赖）: ${msg}`);
        failed.add(key);
      }
    }
  }

  /** 清空趟（仅 truncate 模式）：按删除序（子表先行）整批清空，父表清空时引用它的
   *  选择集内子表已先清空，DELETE/TRUNCATE 不再被子表数据拦截 */
  async function runClearPass(gate: Gating, failed: Set<string>): Promise<void> {
    if (opts.writeMode !== 'truncate' || gate.writer.beforeLoad === undefined) return;
    for (const name of gate.plan.dropOrder) {
      if (cancelled) return;
      if (failed.has(edgeKey(name))) continue;
      try {
        await gate.writer.beforeLoad(name);
        cleared.add(name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failUpfront(name, `清空目标表 ${name} 失败（可能被子表引用）: ${msg}`);
        failed.add(edgeKey(name));
      }
    }
  }

  /** 装载趟（门控模式）：就绪队列 + 依赖门控——被引用表完成后引用它的表才开跑；
   *  上游表无论成败都视为完成（失败上游的下游照常尝试，行为与无门控时一致），
   *  规划期失败的表不参与排程；循环组成员照常装载但不参与门控（互相等待会死锁，
   *  与无门控一致的并发装载，写入冲突如实进失败清单）。依赖键统一按 edgeKey 归一
   *  （目标目录返回的表名大小写可能与选择名不同形）。 */
  async function runGatedLoad(gate: Gating, failed: Set<string>): Promise<void> {
    const schedule = opts.tables.filter((n) => !failed.has(edgeKey(n)));
    const inSchedule = new Set(schedule.map((n) => edgeKey(n)));
    /** 表 → 尚未完成的上游（被引用）表，键为 edgeKey 归一名 */
    const waiting = new Map<string, Set<string>>();
    for (const n of schedule) {
      const deps = new Set<string>();
      if (!gate.cycleOf.has(n)) {
        for (const e of gate.restricted) {
          if (edgeKey(e.table) === edgeKey(n) && inSchedule.has(edgeKey(e.referencedTable))) {
            deps.add(edgeKey(e.referencedTable));
          }
        }
      }
      waiting.set(n, deps);
    }
    const ready: string[] = schedule.filter((n) => (waiting.get(n) as Set<string>).size === 0);
    const remaining = new Set(schedule);
    // 广播唤醒：worker 可同时多个空转睡眠，单槽唤醒句柄会被覆盖造成永久睡眠
    // （丢唤醒 → Promise.all 不收敛 → 任务终态悬挂），故一律唤醒全部等待者，
    // 多余唤醒者重查状态后再次入睡
    const sleepers: Array<() => void> = [];
    const sleep = (): Promise<void> =>
      new Promise<void>((resolve) => {
        sleepers.push(resolve);
      });
    const notifyAll = (): void => {
      for (const wake of sleepers.splice(0)) wake();
    };
    wakeScheduler = notifyAll;
    const workers = Array.from(
      { length: Math.min(tableConcurrency, Math.max(schedule.length, 1)) },
      async () => {
        for (;;) {
          if (cancelled || remaining.size === 0) return;
          const name = ready.shift();
          if (name === undefined) {
            await sleep();
            continue;
          }
          const prog = tables.find((t) => t.name === name);
          if (prog !== undefined) await runTable(name, prog);
          remaining.delete(name);
          for (const [n, deps] of waiting) {
            if (deps.delete(edgeKey(name)) && deps.size === 0) ready.push(n);
          }
          notifyAll();
        }
      },
    );
    try {
      await Promise.all(workers);
    } catch (e) {
      // 兜底（runTable 理论上全捕获）：置取消让残余 worker 退出，不吞错误
      cancelled = true;
      notifyAll();
      throw e;
    }
  }

  // 主流程：先做目标端依赖规划，无边/规划失败走现状 FIFO 路径（行为不变），
  // 有边走「删除趟 → 清空趟 → 门控装载趟」；表内分片并行仍在 runTable 内部
  void Promise.resolve().then(async () => {
    const gate = await planGating();
    if (gate === null) {
      await runUngated();
      await runStructurePass();
      finish();
      return;
    }
    const failed = new Set<string>();
    try {
      await runDropPass(gate, failed);
      await runClearPass(gate, failed);
      await gate.writer.close().catch(() => {});
      await runGatedLoad(gate, failed);
      await runStructurePass();
      finish();
    } catch (e) {
      // 兜底（趟与 runTable 理论上全捕获）：终态前等残余 worker 收尾
      cancelled = true;
      wakeScheduler?.();
      status = 'failed';
      failures.push({ table: '*', shard: -1, error: e instanceof Error ? e.message : String(e) });
      finish();
    }
  }).catch((e) => {
    status = 'failed';
    failures.push({ table: '*', shard: -1, error: e instanceof Error ? e.message : String(e) });
    finish();
  });

  /** 无门控路径：表级 worker 池按输入序 FIFO（与既有行为逐字节一致） */
  async function runUngated(): Promise<void> {
    const queue = [...opts.tables];
    const workers = Array.from({ length: Math.min(tableConcurrency, Math.max(queue.length, 1)) }, async () => {
      for (;;) {
        const name = queue.shift();
        if (name === undefined || cancelled) return;
        const prog = tables.find((t) => t.name === name);
        if (prog === undefined) continue;
        if (prog.status !== 'pending') continue; // 规划期预检已收口的表不再重跑（避免重复失败记录）
        await runTable(name, prog);
      }
    });
    try {
      await Promise.all(workers);
    } catch (e) {
      // 兜底（runTable 理论上全捕获）：终态前先等残余 worker 收尾（writer close 在其
      // finally），否则快照已终态而其他表的写入仍在向目标库进行——同目标互斥按 status
      // 判定，会让新任务与残余写入并发
      cancelled = true;
      await Promise.allSettled(workers);
      status = 'failed';
      failures.push({ table: '*', shard: -1, error: e instanceof Error ? e.message : String(e) });
      finish();
    }
  }

  return {
    id,
    snapshot,
    cancel: () => {
      cancelled = true;
      wakeScheduler?.();
      wakeScheduler = null;
    },
    finished,
  };
}
