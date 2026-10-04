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
  type TransferReader,
  type TransferRow,
  type TransferTable,
  type TransferWriter,
  type WriteMode,
} from './adapters/transfer/model.js';

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

  const finish = (): void => {
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
    emit({ type: 'table', status: 'running', table: name, rows: 0, totalRows: null });
      const r = await createTransferReader(source, srcLoc);
      reader = r; // 立即回填外层引用：writer 创建抛错时 finally 仍能关闭已打开的 reader
      const w = await createTransferWriter(target, opts.writeMode, dstLoc);
      writer = w;
      const t: TransferTable = await r.describe(name);
      prog.totalRows = await r.count(name);
      // 先查目标表是否存在——有无表都不该「建表失败」：
      // 无表 → 建表再写；有表 → 按写入模式处理（结构冲突可开覆盖表结构选项）
      const exists = await w.tableExists(name);
      if (exists && opts.overwriteStructure) {
        // 覆盖表结构：删除重建（危险选项；新表结构与源一致，无需清空）
        await w.dropTable(name);
        await w.createTable(t);
      } else if (exists) {
        if (opts.writeMode === 'truncate' && w.beforeLoad) {
          await w.beforeLoad(t); // 清空旧数据再写
        } else if (opts.writeMode === 'insert') {
          throw new Error(`目标表已存在: ${name}（insert 不覆盖已有数据，请改用 ignore/replace/truncate 或开启覆盖表结构）`);
        }
        // ignore/replace：写入语句自带冲突处理，直接写
      } else {
        await w.createTable(t);
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

  // 主流程：表级 worker 池（表间并行；表内分片并行在 runTable 内部）
  void Promise.resolve().then(async () => {
    const queue = [...opts.tables];
    const workers = Array.from({ length: Math.min(tableConcurrency, Math.max(queue.length, 1)) }, async () => {
      for (;;) {
        const name = queue.shift();
        if (name === undefined || cancelled) return;
        const prog = tables.find((t) => t.name === name);
        if (prog === undefined) continue;
        await runTable(name, prog);
      }
    });
    try {
      await Promise.all(workers);
      finish();
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
  }).catch((e) => {
    status = 'failed';
    failures.push({ table: '*', shard: -1, error: e instanceof Error ? e.message : String(e) });
    finish();
  });

  return {
    id,
    snapshot,
    cancel: () => {
      cancelled = true;
    },
    finished,
  };
}
