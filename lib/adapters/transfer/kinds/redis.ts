/**
 * Redis 传输读写端（经既有中间模型以固定 envelope 表参与互迁）。
 *
 * Redis 无表/行/列，故用 `__redis_keys` 六列承载：key(string,PK)/type(string)/
 * ttl_ms(bigint)/encoding(string)/payload(json)/dump(bytes)。全部落在 MidType 与
 * TransferCell 内，不扩模型、不建点对点管道。
 *
 * 读端：SCAN 游标是服务端不透明字符串，TransferCursor.offset 是数字 → reader 内
 * 维护 Map<table, AsyncIterator>，忽略数值 offset 续同一迭代器；迭代器耗尽返回 []，
 * 保证 lib/transfer.ts 的 runOffset 能收尾。持原始驱动句柄绕开浏览侧 cell() 截断。
 *
 * 写端：dump 非空走 RESTORE ... REPLACE（同构 Redis 保真）；否则按 payload 用
 * SET/HSET/RPUSH/SADD/ZADD/XADD 类型化重建。TTL 取 ttl_ms（0=永不过期），
 * payload 路径补 PEXPIRE/PERSIST（SET 不清旧 TTL）。
 *
 * ponytail: 明确排除 stream consumer group / PEL、跨版本 DUMP 兼容、逻辑库 dbN
 * 定位与 Redis 原生键空间无损；升级路径是扩 TransferColumn/TransferCursor。
 */
import { createClient } from 'redis';
import { buildUrl } from '../../redis/index.js';
import type { ResolvedConnection } from '../../types.js';
import type {
  ShardKeyType,
  TransferCell,
  TransferColumn,
  TransferCursor,
  TransferReader,
  TransferRow,
  TransferTable,
  TransferWriter,
  WriteMode,
} from '../model.js';

export const REDIS_ENVELOPE_TABLE = '__redis_keys';

/** SCAN COUNT 与浏览侧一致（lib/adapters/redis/index.ts:60）；MATCH 恒为 * 全量迁 */
const SCAN_COUNT = 100;
/** 内部登记键前缀：不进数据行，避免自迁时把登记项当业务键 */
const INTERNAL_PREFIX = '__dbt_xfer:';

type CmdArg = string | Buffer;
type Key = string | Buffer;

/** 传输端持原始驱动句柄的最小面（不走 guard / 适配器白名单，transferStart 已有 danger challenge） */
interface RedisRawClient {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  dbSize(): Promise<number>;
  type(key: Key): Promise<unknown>;
  pTTL(key: Key): Promise<unknown>;
  get(key: Key): Promise<unknown>;
  hGetAll(key: Key): Promise<unknown>;
  lRange(key: Key, start: number, stop: number): Promise<unknown>;
  sMembers(key: Key): Promise<unknown>;
  zRangeWithScores(key: Key, start: string, stop: string): Promise<unknown>;
  xRange(key: Key, start: string, end: string): Promise<unknown>;
  // 真实驱动逐页 yield 键数组（@redis/client index.d.ts：AsyncGenerator<Key[]>），不是逐键
  scanIterator(opts: { MATCH: string; COUNT: number }): AsyncIterable<Key[]>;
  sendCommand(args: CmdArg[]): Promise<unknown>;
  /** pipeline：sendCommand 入队，execAsPipeline 按序返回结果（redis@6 的 multi 代理） */
  multi(): {
    sendCommand(args: CmdArg[]): unknown;
    execAsPipeline(): Promise<unknown[]>;
  };
}

// 固定 envelope 不是从源库推导的结构，不填 sourceType（该字段仅承载源库原始类型诊断）
const columns: TransferColumn[] = [
  { name: 'key', midType: 'string', nullable: false, primaryKey: true },
  { name: 'type', midType: 'string', nullable: false, primaryKey: false },
  { name: 'ttl_ms', midType: 'bigint', nullable: false, primaryKey: false },
  { name: 'encoding', midType: 'string', nullable: true, primaryKey: false },
  { name: 'payload', midType: 'json', nullable: false, primaryKey: false },
  { name: 'dump', midType: 'bytes', nullable: true, primaryKey: false },
];

function envelope(): TransferTable {
  return { name: REDIS_ENVELOPE_TABLE, columns: columns.map((c) => ({ ...c })) };
}

/** Buffer/字符串统一为 base64url，用于内部登记键名（可逆、无 glob 元字符） */
function b64(v: Key): string {
  return Buffer.isBuffer(v) ? v.toString('base64url') : Buffer.from(v, 'utf8').toString('base64url');
}

function isInternal(k: Key): boolean {
  return typeof k === 'string' && k.startsWith(INTERNAL_PREFIX);
}

const markerOf = (name: string): string => `${INTERNAL_PREFIX}tbl:${b64(name)}`;
const idxOf = (name: string): string => `${INTERNAL_PREFIX}idx:${b64(name)}`;

function asArg(v: unknown): CmdArg {
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === 'bigint') return v.toString();
  return v === null || v === undefined ? '' : String(v);
}

/** payload JSON 里的二进制值：Buffer 直接 JSON.stringify 会变成 {type:'Buffer',data:[…]}，写入端还原不回来 */
const B64_TAG = '__b64';

function encodeCell(v: unknown): unknown {
  if (v instanceof Uint8Array) return { [B64_TAG]: Buffer.from(v).toString('base64') };
  if (typeof v === 'bigint') return v.toString();
  // number 原样保留（zset score）；±Infinity/NaN 走字符串，否则 JSON.stringify 会变 null
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  return v === null || v === undefined ? '' : String(v);
}

function decodeCell(v: unknown): CmdArg {
  if (v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>)[B64_TAG] === 'string') {
    return Buffer.from((v as Record<string, string>)[B64_TAG]!, 'base64');
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(v);
  return v === null || v === undefined ? '' : String(v);
}

/** 值 → payload（typed reconstruction）；object/array 不进中间模型，统一 JSON 串 */
function payloadOf(type: string, value: unknown): string {
  switch (type) {
    case 'string':
      return JSON.stringify({ v: value === null || value === undefined ? null : encodeCell(value) });
    case 'hash': {
      // typeMapping 37=Map：hGetAll 返回 Map（保留 __proto__/constructor 等字段），不再走 Object.entries
      const src = value instanceof Map ? [...value.entries()] : Object.entries((value ?? {}) as Record<string, unknown>);
      const entries = src.map(([f, v]) => [f, encodeCell(v)]);
      return JSON.stringify({ f: entries });
    }
    case 'list':
    case 'set':
      return JSON.stringify({ v: ((value ?? []) as unknown[]).map(encodeCell) });
    case 'zset':
      return JSON.stringify({
        // score 走 encodeCell：±Infinity/NaN 经 JSON.stringify 会变 null，ZADD 拒收
        v: ((value ?? []) as Array<{ value: unknown; score: number }>).map((m) => [encodeCell(m.value), encodeCell(m.score)]),
      });
    case 'stream':
      return JSON.stringify({
        v: ((value ?? []) as Array<{ id: string; message?: Record<string, unknown> }>).map((e) => [
          e.id,
          Object.entries(e.message ?? {}).map(([f, v]) => [f, encodeCell(v)]),
        ]),
      });
    default:
      return '{}';
  }
}

/** 值读取命令（与 readValue 一一对应），供 pipeline 批量发送 */
function readValueCmds(type: string, key: CmdArg): CmdArg[][] {
  switch (type) {
    case 'string': return [['GET', key]];
    case 'hash': return [['HGETALL', key]];
    case 'list': return [['LRANGE', key, '0', '-1']];
    case 'set': return [['SMEMBERS', key]];
    case 'zset': return [['ZRANGE', key, '0', '-1', 'WITHSCORES']];
    case 'stream': return [['XRANGE', key, '-', '+']];
    default: return [];
  }
}

export function createRedisTransferReader(raw: RedisRawClient): TransferReader {
  const iters = new Map<string, AsyncIterator<Key[]>>();
  const pendingKeys = new Map<string, Key[]>();
  const exhausted = new Set<string>();

  /** pipeline 执行一组命令，按序返回结果（失败整体抛出，由调用方决定语义） */
  async function pipeline(cmds: CmdArg[][]): Promise<unknown[]> {
    if (cmds.length === 0) return [];
    const m = raw.multi();
    for (const c of cmds) m.sendCommand(c);
    return m.execAsPipeline();
  }

  return {
    kind: 'redis',

    listTables: async () => [REDIS_ENVELOPE_TABLE],

    describe: async () => envelope(),

    // 不能直接用 dbSize()：它把 __dbt_xfer:* 登记键也算进去，进度分母虚高导致永远到不了 100%
    count: async () => Math.max(0, Number(await raw.dbSize() ?? 0) - 2),

    shardKey: async (): Promise<ShardKeyType | null> => null, // SCAN 无全序键 → 编排层走 runOffset
    // 省略 keyAt：无分片并行

    readBatch: async (_table: string, _cursor: TransferCursor, limit: number): Promise<TransferRow[]> => {
      const table = _table || REDIS_ENVELOPE_TABLE;
      const n = Math.max(1, Math.floor(Number(limit) || 1));
      if (exhausted.has(table)) return [];
      if (!iters.has(table)) {
        iters.set(table, raw.scanIterator({ MATCH: '*', COUNT: SCAN_COUNT })[Symbol.asyncIterator]());
      }
      const iter = iters.get(table)!;
      // 驱动逐页 yield 键数组：页内键跨批次持久（局部变量会在批边界丢键）
      if (!pendingKeys.has(table)) pendingKeys.set(table, []);
      const pending = pendingKeys.get(table)!;

      /** 从 SCAN 流里凑够 want 个键（跳过内部登记键）；返回不足表示已耗尽 */
      const take = async (want: number): Promise<Key[]> => {
        const out: Key[] = [];
        while (out.length < want) {
          if (pending.length === 0) {
            const next = await iter.next();
            if (next.done) {
              exhausted.add(table);
              break;
            }
            for (const k of next.value ?? []) pending.push(k);
            continue;
          }
          const k = pending.shift()!;
          if (isInternal(k)) continue; // 登记键不作为业务数据迁出
          out.push(k);
        }
        return out;
      };

      // 按批预取：PTTL/TYPE/OBJECT ENCODING/DUMP 互不依赖，整批合成一次 pipeline。
      // 逐键串行时每键 5 次 RTT，30ms 链路下 1000 键要 150s。
      const batchKeys = await take(n);
      if (batchKeys.length === 0) return [];

      const probe = await pipeline(batchKeys.flatMap((k) => [
        ['PTTL', asArg(k)],
        ['TYPE', asArg(k)],
        ['OBJECT', 'ENCODING', asArg(k)],
        ['DUMP', asArg(k)],
      ]));

      // 第二轮：按第一轮得到的 TYPE 取各自的值（取命令依赖 type，无法并入上一轮）
      const live: Array<{ k: Key; ttl: number; type: string; encoding: unknown; dump: unknown }> = [];
      for (let i = 0; i < batchKeys.length; i += 1) {
        const ttlRaw = Number(probe[i * 4] ?? -2);
        if (ttlRaw === -2) continue; // 键在 SCAN 与 PTTL 之间消失
        const type = String(probe[i * 4 + 1] ?? 'none');
        if (type === 'none') continue;
        live.push({ k: batchKeys[i]!, ttl: ttlRaw, type, encoding: probe[i * 4 + 2], dump: probe[i * 4 + 3] });
      }
      if (live.length === 0) return [];

      const valRows = await pipeline(live.flatMap(({ k, type }) => readValueCmds(type, asArg(k))));
      return live.map(({ k, ttl, type, encoding, dump }, vi) => [
        asArg(k),
        type,
        BigInt(ttl < 0 ? 0 : ttl), // PTTL -1 → 0（永不过期）
        encoding === null || encoding === undefined ? null : String(encoding),
        payloadOf(type, valRows[vi]),
        dump === null || dump === undefined ? null : Buffer.from(dump as Uint8Array),
      ]);
    },

    close: async () => {
      await raw.quit().catch(() => {});
    },
  };
}

/** payload → 写命令序列（不含 TTL；由调用方按 writeMode 与 ttl 补齐） */
function rebuildCommands(type: string, key: Key, payload: string): CmdArg[][] {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new Error(`Redis payload 非法 JSON（键 ${b64(key)}）`);
  }
  const v = (doc.v ?? null) as unknown;
  const f = (doc.f ?? []) as Array<[string, unknown]>;
  switch (type) {
    case 'string':
      return [['SET', asArg(key), decodeCell(v)]];
    case 'hash':
      return f.length === 0 ? [] : [['HSET', asArg(key), ...f.flatMap(([field, val]) => [asArg(field), decodeCell(val)])]];
    case 'list': {
      const arr = (v ?? []) as unknown[];
      return arr.length === 0 ? [] : [['RPUSH', asArg(key), ...arr.map(decodeCell)]];
    }
    case 'set': {
      const arr = (v ?? []) as unknown[];
      return arr.length === 0 ? [] : [['SADD', asArg(key), ...arr.map(decodeCell)]];
    }
    case 'zset': {
      const pairs = (v ?? []) as Array<[unknown, unknown]>;
      return pairs.length === 0 ? [] : [['ZADD', asArg(key), ...pairs.flatMap(([m, s]) => [String(decodeCell(s)), decodeCell(m)])]];
    }    case 'stream': {
      const entries = (v ?? []) as Array<[string, Array<[string, unknown]>]>;
      return entries.map(([id, fields]) => [
        'XADD', asArg(key), id,
        ...fields.flatMap(([field, val]) => [asArg(field), decodeCell(val)]),
      ]);
    }
    default:
      throw new Error(`Redis 目标暂不支持重建键类型 ${type}（键 ${b64(key)}）`);
  }
}

export function createRedisTransferWriter(raw: RedisRawClient, writeMode: WriteMode = 'insert'): TransferWriter {
  async function exists(key: Key): Promise<boolean> {
    return Number(await raw.sendCommand(['EXISTS', asArg(key)]) ?? 0) > 0;
  }

  /** 清掉某表登记的数据键；drop=true 连 marker 一并删 */
  async function clear(name: string, drop: boolean): Promise<void> {
    const idx = idxOf(name);
    const members = (await raw.sendCommand(['SMEMBERS', idx])) as Key[] ?? [];
    for (const m of members) await raw.sendCommand(['DEL', asArg(m)]);
    await raw.sendCommand(['DEL', idx]);
    if (drop) await raw.sendCommand(['DEL', markerOf(name)]);
  }

  /** 本表已成功写入过数据（用于判断失败时是否应回收 marker，避免留下「空表」假象） */
  const wroteAny = new Set<string>();

  return {
    kind: 'redis',

    tableExists: async (name) => exists(markerOf(name)),

    dropTable: async (name) => {
      await clear(name, true);
      wroteAny.delete(name);
    },

    beforeLoad: async (table) => {
      await clear(table.name, false);
      wroteAny.delete(table.name);
    },

    createTable: async (table) => {
      await raw.sendCommand(['SET', markerOf(table.name), '1']);
    },

    writeBatch: async (table, rows: TransferRow[]): Promise<number> => {
      if (rows.length === 0) return 0;
      const width = table.columns.length;
      // 列名必须与 envelope 一致：只校验宽度时，恰好 6 列的普通 SQL 表会被按位置静默错写
      const names = table.columns.map((c) => c.name);
      if (names.length !== columns.length || names.some((n, i) => n !== columns[i]!.name)) {
        throw new Error(
          `Redis 传输仅接受 envelope 列（${columns.map((c) => c.name).join('/')}），实际为 ${names.join('/')}`,
        );
      }
      for (const r of rows) {
        if (r.length !== width) {
          throw new Error(`行宽不匹配：期望 ${width} 列，实际 ${r.length} 列（表 ${table.name}）`);
        }
      }

      // model.ts:104 契约「单批单事务，失败整批回滚」：先全量预检，再统一写入。
      // 任一键冲突即整批放弃（此时尚未写任何数据），避免留下半批脏数据。
      const planned: Array<{ r: TransferRow; skip: boolean; present: boolean }> = [];
      const dropMarkerIfEmpty = async (): Promise<void> => {
        // createTable 已建 marker 但从未写入成功：清掉 marker，否则下次 insert 误报「表已存在」
        if (wroteAny.has(table.name)) return;
        await raw.sendCommand(['DEL', markerOf(table.name)]).catch(() => {});
        await raw.sendCommand(['DEL', idxOf(table.name)]).catch(() => {});
      };
      try {
        for (const r of rows) {
          const keyArg = asArg(asArg(r[0] ?? null));
          const present = await exists(keyArg);
          if (present) {
            if (writeMode === 'insert') {
              throw new Error(`目标键已存在: ${b64(asArg(r[0] ?? null))}（insert 不覆盖已有数据，请改用 ignore/replace/truncate 或开启覆盖表结构）`);
            }
            if (writeMode === 'ignore') {
              planned.push({ r, skip: true, present });
              continue;
            }
          }
          planned.push({ r, skip: false, present });
        }
      } catch (e) {
        await dropMarkerIfEmpty();
        throw e;
      }

      let written = 0;
      try {
        for (const { r, skip, present } of planned) {
          if (skip) continue;
          const key = asArg(r[0] ?? null);
          const keyArg = asArg(key);
          const type = String(r[1] ?? 'string');
          const ttlBig = typeof r[2] === 'bigint' ? r[2] : BigInt(Math.max(0, Number(r[2] ?? 0)));
          const ttl = ttlBig > 0n ? ttlBig.toString() : '0';
          const payload = r[4] === null || r[4] === undefined ? '{}' : String(r[4]);
          const dump = r[5] instanceof Uint8Array ? Buffer.from(r[5]) : null;

          // replace：预检已确认存在，先删再重建（含残留 TTL）
          if (writeMode === 'replace' && present) await raw.sendCommand(['DEL', keyArg]);

          if (dump !== null) {
            // 同构 Redis 保真：RESTORE 自带 TTL 与 REPLACE，无需额外 PEXPIRE/PERSIST
            await raw.sendCommand(['RESTORE', keyArg, ttl, dump, 'REPLACE']);
          } else {
            for (const cmd of rebuildCommands(type, keyArg, payload)) await raw.sendCommand(cmd);
            // SET 不清旧 TTL：0 显式 PERSIST，正值 PEXPIRE
            await raw.sendCommand(ttlBig > 0n ? ['PEXPIRE', keyArg, ttl] : ['PERSIST', keyArg]);
          }
          await raw.sendCommand(['SADD', idxOf(table.name), keyArg]);
          written += 1;
        }
        if (written > 0) wroteAny.add(table.name);
      } catch (e) {
        // 写入中途失败（网络/命令错误）：回滚本批已写的键与登记，保持「失败整批回滚」
        for (const { r, skip } of planned) {
          if (skip) continue;
          const keyArg = asArg(asArg(r[0] ?? null));
          await raw.sendCommand(['DEL', keyArg]).catch(() => {});
          await raw.sendCommand(['SREM', idxOf(table.name), keyArg]).catch(() => {});
        }
        // createTable 已建 marker 但从未写入成功：清掉 marker，否则下次 insert 误报「表已存在」
        await dropMarkerIfEmpty();
        throw e;
      }
      return written;
    },

    close: async () => {
      await raw.quit().catch(() => {});
    },
  };
}

async function openRaw(rc: ResolvedConnection): Promise<RedisRawClient> {
  const url = rc.url ?? buildUrl(rc.fields, rc.ssl);
  const client = createClient({
    url,
    // 36=BLOB_STRING 映射为 Buffer：默认按 UTF-8 解码会破坏 DUMP 与所有非 UTF-8 值
    // 37=MAP 映射为 Map：默认转 plain object 会静默丢弃 hash 的 __proto__/constructor 字段
    commandOptions: { typeMapping: { 36: Buffer, 37: Map } },
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries: number) => Math.min(retries * 50, 2000),
    },
  });
  // EventEmitter 异常会绕过编排层 try/catch 直接崩宿主进程，必须显式吞掉
  client.on('error', () => {});
  await client.connect();
  return client as unknown as RedisRawClient;
}

/** loc 忽略：逻辑库由连接 URL path 决定，dbN 下拉与跨库定位明确排除 */
export async function createRedisTransferReaderFromConn(rc: ResolvedConnection): Promise<TransferReader> {
  return createRedisTransferReader(await openRaw(rc));
}

export async function createRedisTransferWriterFromConn(
  rc: ResolvedConnection,
  writeMode: WriteMode,
): Promise<TransferWriter> {
  return createRedisTransferWriter(await openRaw(rc), writeMode);
}
