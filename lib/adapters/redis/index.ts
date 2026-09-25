/**
 * Redis 适配器（redis v6，单连接多路复用，官方免池）。
 *
 * 设计要点（依据官方文档调研）：
 *  - createClient({ url }) + 显式 await connect()；socket 5s 连接超时、指数退避重连。
 *  - query() 只允许读白名单命令；SCAN 用 scanIterator（禁用 KEYS）。
 *  - execute() 只允许写白名单命令，统一经 sendCommand 透传
 *    （官方：sendCommand 不解析键位/不加 keyPrefix——本插件不使用 keyPrefix，无影响）。
 *  - ro 模式适配器层直接拒绝 execute（服务层另有拦截）。
 *  - 只读账号建议由用户在服务端配置 ACL 只读用户（见 README/文档）。
 */
import { createClient, type RedisClientType } from 'redis';
import type {
  AccessMode,
  AdapterFactory,
  ColumnInfo,
  DatabaseAdapter,
  ExecResult,
  NormalizedCell,
  QueryResult,
  ResolvedConnection,
  TableInfo,
  TestConnectResult,
} from '../types.js';

/** 危险命令：服务层拦截器在用户确认前拒绝执行（KEYS 同时被 query 白名单禁用）。对齐官方 ACL dangerous 类。 */
export const DANGEROUS_COMMANDS: ReadonlySet<string> = new Set([
  'FLUSHALL', 'FLUSHDB', 'SWAPDB', 'CONFIG', 'DEBUG', 'SAVE', 'SHUTDOWN',
  'REPLICAOF', 'SLAVEOF', 'MIGRATE', 'RESTORE', 'SORT', 'SORT_RO', 'ACL', 'KEYS',
  'MODULE', 'FUNCTION', 'SCRIPT', 'RESET',
]);

/** 读白名单（OBJECT 仅限 ENCODING、MEMORY 仅限 USAGE 子命令） */
export const READ_COMMANDS: ReadonlySet<string> = new Set([
  'GET', 'MGET', 'EXISTS', 'TYPE', 'HGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN',
  'LRANGE', 'LLEN', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'ZRANGE', 'ZSCORE',
  'ZCARD', 'ZRANK', 'XLEN', 'XRANGE', 'SCAN', 'DBSIZE', 'INFO', 'SELECT',
  'TTL', 'PTTL', 'GETRANGE', 'STRLEN', 'OBJECT', 'MEMORY',
]);

/** 写白名单 */
export const WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'SET', 'SETEX', 'DEL', 'UNLINK', 'INCR', 'DECR', 'INCRBY', 'HSET', 'HDEL',
  'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'SADD', 'SREM', 'ZADD', 'ZREM', 'EXPIRE',
  'PERSIST', 'RENAME', 'APPEND', 'SETRANGE',
]);

/** 键类型 → 对应长度命令（describeTable 用） */
const LENGTH_CMD_BY_TYPE: Record<string, { cmd: string; method: 'strLen' | 'hLen' | 'lLen' | 'sCard' | 'zCard' | 'xLen' }> = {
  string: { cmd: 'STRLEN', method: 'strLen' },
  hash: { cmd: 'HLEN', method: 'hLen' },
  list: { cmd: 'LLEN', method: 'lLen' },
  set: { cmd: 'SCARD', method: 'sCard' },
  zset: { cmd: 'ZCARD', method: 'zCard' },
  stream: { cmd: 'XLEN', method: 'xLen' },
};

const CELL_TRUNC = 1000;
const SCAN_COUNT = 100;
const SCAN_MAX_KEYS = 200;
const LIST_TABLES_MAX = 500;
const PREVIEW_MAX = 50;
/** query 通道集合类读命令（HGETALL/HKEYS/HVALS/SMEMBERS）结果行数上限 */
const READ_CLAMP = 500;

function trunc(s: string, max = CELL_TRUNC): string {
  return s.length > max ? `${s.slice(0, max)}…[截断,共${s.length}字符]` : s;
}

/** 规范化 Redis 回复为 NormalizedCell：数字原样、字符串截断、Buffer 转 utf8、其余 JSON 序列化 */
function cell(v: unknown): NormalizedCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return trunc(v);
  if (typeof v === 'object' && Buffer.isBuffer(v)) return trunc((v as Buffer).toString('utf8'));
  try {
    return trunc(JSON.stringify(v) ?? String(v));
  } catch {
    return trunc(String(v));
  }
}

/**
 * 解析命令输入：JSON 数组（'["GET","key with space"]'）或空格分隔（"GET key"）。
 * 带空格的值必须用 JSON 数组形式（空格分隔无法表达）。
 */
export function parseRedisCommand(input: string): string[] {
  const s = input.trim();
  if (s === '') throw new Error('Redis 命令不能为空。示例：\'["GET","key"]\' 或 "GET key"');
  if (s.startsWith('[')) {
    let arr: unknown;
    try {
      arr = JSON.parse(s);
    } catch (e) {
      throw new Error(`Redis 命令 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(arr) || arr.length === 0 || !arr.every((x) => typeof x === 'string')) {
      throw new Error('Redis 命令必须为非空字符串数组，如 \'["GET","key"]\'');
    }
    return arr as string[];
  }
  return s.split(/\s+/);
}

/** 列出支持的命令（错误提示用） */
function supportedList(): string {
  return `读命令: ${[...READ_COMMANDS].sort().join('/')}（OBJECT 仅 ENCODING、MEMORY 仅 USAGE）；写命令(execute): ${[...WRITE_COMMANDS].sort().join('/')}`;
}

/** 解析 INFO 输出为 [key, value] 行（跳过 # 注释与空行） */
function parseInfo(raw: string): [string, NormalizedCell][] {
  const rows: [string, NormalizedCell][] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx);
    const v = line.slice(idx + 1);
    const n = Number(v);
    rows.push([k, v !== '' && Number.isFinite(n) ? n : trunc(v)]);
  }
  return rows;
}

/** 从 fields 拼接连接 URL（url 缺省时） */
function buildUrl(fields: Record<string, unknown> | undefined, ssl?: boolean): string {
  const host = typeof fields?.host === 'string' && fields.host !== '' ? fields.host : '127.0.0.1';
  const port = typeof fields?.port === 'number' ? fields.port : 6379;
  const user = typeof fields?.user === 'string' ? fields.user : '';
  const pass = typeof fields?.password === 'string' ? `:${encodeURIComponent(fields.password)}@` : '';
  const db = typeof fields?.database === 'number' && fields.database !== 0 ? `/${fields.database}` : '';
  const scheme = ssl || connSsl(fields) ? 'rediss' : 'redis';
  return `${scheme}://${user}${pass}${host}:${port}${db}`;
}

function connSsl(fields: Record<string, unknown> | undefined): boolean {
  return fields?.ssl === true || fields?.tls === true;
}

export interface RedisAdapterOptions {
  mode?: AccessMode;
  /** 测试注入：跳过真实连接 */
  client?: unknown;
}

export async function createRedisAdapter(
  conn: ResolvedConnection,
  opts?: RedisAdapterOptions,
): Promise<DatabaseAdapter> {
  const mode: AccessMode = opts?.mode ?? 'rw';
  let client: RedisClientType;
  if (opts?.client) {
    client = opts.client as RedisClientType;
  } else {
    const url = conn.url ?? buildUrl(conn.fields, conn.ssl);
    client = createClient({
      url,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries: number) => Math.min(retries * 50, 2000),
      },
    });
    try {
      await client.connect();
    } catch (e) {
      throw new Error(`Redis 连接失败（${sanitizeUrl(url)}）：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function wrap(e: unknown): Error {
    return new Error(`Redis 错误：${e instanceof Error ? e.message : String(e)}`);
  }

  function requireRw(action: string): void {
    if (mode === 'ro') {
      throw new Error(`连接为只读(ro)模式，拒绝执行${action}；请使用 rw 连接或只发查询(query)`);
    }
  }

  /** 统一入口：解析并校验命令白名单 */
  function parseAndCheck(input: string, whitelist: ReadonlySet<string>, action: string): string[] {
    const args = parseRedisCommand(input);
    const cmd = (args[0] ?? '').toUpperCase();
    if (DANGEROUS_COMMANDS.has(cmd)) {
      throw new Error(`Redis 命令 ${cmd} 属于危险命令（KEYS/FLUSHALL/CONFIG 等），已被本工具禁用或需服务层确认`);
    }
    if (!whitelist.has(cmd)) {
      throw new Error(`Redis ${action} 不支持命令 ${cmd}。${supportedList()}`);
    }
    if ((cmd === 'OBJECT' && (args[1] ?? '').toUpperCase() !== 'ENCODING') ||
        (cmd === 'MEMORY' && (args[1] ?? '').toUpperCase() !== 'USAGE')) {
      throw new Error(`Redis ${action} 仅支持 OBJECT ENCODING 与 MEMORY USAGE`);
    }
    if (args.length < 2 && !['DBSIZE', 'INFO', 'SCAN', 'SELECT'].includes(cmd)) {
      throw new Error(`Redis ${cmd} 缺少参数`);
    }
    return args;
  }

  const adapter: DatabaseAdapter = {
    kind: 'redis',
    connId: conn.meta.id,

    async testConnect(): Promise<TestConnectResult> {
      try {
        const pong = await client.ping();
        let serverInfo = pong;
        try {
          const info = await client.info('server');
          const m = /redis_version:([^\r\n]+)/.exec(info);
          if (m?.[1]) serverInfo = `Redis ${m[1].trim()}`;
        } catch { /* INFO 失败不影响连通性 */ }
        return { ok: true, serverInfo };
      } catch (e) {
        return { ok: false, error: wrap(e).message };
      }
    },

    async query(sql: string): Promise<QueryResult> {
      try {
        const args = parseAndCheck(sql, READ_COMMANDS, 'query');
        const cmd = args[0]!.toUpperCase();
        const rest = args.slice(1);

        // SCAN：scanIterator 实现，禁用 KEYS；透传用户 MATCH/COUNT，行数仍 clamp 200
        if (cmd === 'SCAN') {
          let match = '*';
          let count = SCAN_COUNT;
          for (let i = 0; i < rest.length; i++) {
            const a = (rest[i] ?? '').toUpperCase();
            if (a === 'MATCH' && rest[i + 1] !== undefined) {
              match = rest[i + 1]!;
              i++;
            } else if (a === 'COUNT' && rest[i + 1] !== undefined) {
              const c = Number(rest[i + 1]);
              if (Number.isInteger(c) && c > 0) count = c;
              i++;
            }
          }
          const rows: NormalizedCell[][] = [];
          const keys: string[] = [];
          for await (const k of client.scanIterator({ MATCH: match, COUNT: count })) {
            keys.push(...(Array.isArray(k) ? k : [String(k)]));
            if (keys.length >= SCAN_MAX_KEYS) break;
          }
          if (keys.length > 0) {
            const multi = client.multi();
            for (const k of keys) multi.type(k);
            const types = (await multi.exec()) as unknown[];
            for (let i = 0; i < keys.length; i++) {
              rows.push([keys[i] ?? '', cell(types[i] ?? 'none')]);
            }
          }
          return { columns: ['key', 'type'], rows, rowCount: rows.length, truncated: keys.length >= SCAN_MAX_KEYS || undefined };
        }

        // SELECT：切换逻辑库
        if (cmd === 'SELECT') {
          const db = Number(rest[0]);
          if (!Number.isInteger(db) || db < 0) throw new Error('SELECT 需要非负整数库号，如 "SELECT 1"');
          await client.select(db);
          return { columns: ['name', 'value'], rows: [['db', db]], rowCount: 1, };
        }

        // INFO：解析为 key/value 行
        if (cmd === 'INFO') {
          const raw = await client.info(rest[0]);
          const rows = parseInfo(raw).map(([k, v]) => [k, v] as NormalizedCell[]);
          return { columns: ['key', 'value'], rows, rowCount: rows.length };
        }

        // DBSIZE
        if (cmd === 'DBSIZE') {
          const n = await client.dbSize();
          return { columns: ['name', 'value'], rows: [['dbsize', n]], rowCount: 1 };
        }

        // MEMORY USAGE / OBJECT ENCODING：sendCommand 透传
        if (cmd === 'MEMORY' || cmd === 'OBJECT') {
          const reply = await client.sendCommand(args);
          const key = rest[1] ?? '';
          return { columns: ['key', 'value'], rows: [[cell(key), cell(reply)]], rowCount: 1 };
        }

        // ---- 单键值类 → ['key','value'] ----
        const key = rest[0] ?? '';
        switch (cmd) {
          case 'GET': {
            const v = await client.get(key);
            return kv(key, v);
          }
          case 'MGET': {
            const vals = await client.mGet(rest);
            const rows = rest.map((k, i) => [cell(k), cell(vals[i])] as NormalizedCell[]);
            return { columns: ['key', 'value'], rows, rowCount: rows.length };
          }
          case 'EXISTS': {
            // redis v6：exists 接受 RedisVariadicArgument（string | string[]），直接传数组
            const n = await client.exists(rest);
            return kv(key, n);
          }
          case 'TYPE': {
            const t = await client.type(key);
            return kv(key, t);
          }
          case 'HGET': {
            const v = await client.hGet(key, rest[1] ?? '');
            return kv(rest[1] ?? '', v);
          }
          case 'TTL': return kv(key, await client.ttl(key));
          case 'PTTL': return kv(key, await client.pTTL(key));
          case 'STRLEN': return kv(key, await client.strLen(key));
          case 'GETRANGE': return kv(key, await client.getRange(key, Number(rest[1] ?? 0), Number(rest[2] ?? -1)));
          case 'HLEN': return kv(key, await client.hLen(key));
          case 'LLEN': return kv(key, await client.lLen(key));
          case 'SCARD': return kv(key, await client.sCard(key));
          case 'ZCARD': return kv(key, await client.zCard(key));
          case 'XLEN': return kv(key, await client.xLen(key));
          case 'SISMEMBER': return kv(rest[1] ?? '', await client.sIsMember(key, rest[1] ?? ''));
          case 'ZSCORE': return kv(rest[1] ?? '', await client.zScore(key, rest[1] ?? ''));
          case 'ZRANK': return kv(rest[1] ?? '', await client.zRank(key, rest[1] ?? ''));
          case 'HGETALL': {
            const map = await client.hGetAll(key);
            const all = Object.entries(map).map(([f, v]) => [cell(f), cell(v)] as NormalizedCell[]);
            const rows = all.slice(0, READ_CLAMP);
            return { columns: ['field', 'value'], rows, rowCount: rows.length, truncated: all.length > READ_CLAMP || undefined };
          }
          case 'HKEYS': {
            const vals = await client.hKeys(key);
            const all = (vals ?? []).map((f) => [cell(f)] as NormalizedCell[]);
            const rows = all.slice(0, READ_CLAMP);
            return { columns: ['field'], rows, rowCount: rows.length, truncated: all.length > READ_CLAMP || undefined };
          }
          case 'HVALS': {
            const vals = await client.hVals(key);
            const all = (vals ?? []).map((v) => [cell(v)] as NormalizedCell[]);
            const rows = all.slice(0, READ_CLAMP);
            return { columns: ['value'], rows, rowCount: rows.length, truncated: all.length > READ_CLAMP || undefined };
          }
          case 'LRANGE': {
            const all = await client.lRange(key, Number(rest[1] ?? 0), Number(rest[2] ?? -1));
            const rows = all.slice(0, PREVIEW_MAX).map((v) => [cell(v)] as NormalizedCell[]);
            return { columns: ['value'], rows, rowCount: rows.length, truncated: all.length > PREVIEW_MAX || undefined };
          }
          case 'SMEMBERS': {
            const vals = await client.sMembers(key);
            const all = (vals ?? []).map((v) => [cell(v)] as NormalizedCell[]);
            const rows = all.slice(0, READ_CLAMP);
            return { columns: ['member'], rows, rowCount: rows.length, truncated: all.length > READ_CLAMP || undefined };
          }
          case 'ZRANGE': {
            const withScores = rest.slice(3).some((a) => a.toUpperCase() === 'WITHSCORES');
            if (withScores) {
              const pairs = await client.zRangeWithScores(key, rest[1] ?? '0', rest[2] ?? '-1');
              const rows = pairs.map((m) => [cell(m.value), cell(m.score)] as NormalizedCell[]);
              return { columns: ['member', 'score'], rows, rowCount: rows.length };
            }
            const vals = await client.zRange(key, rest[1] ?? '0', rest[2] ?? '-1');
            const rows = vals.map((v) => [cell(v)] as NormalizedCell[]);
            return { columns: ['member'], rows, rowCount: rows.length };
          }
          case 'XRANGE': {
            const countIdx = rest.findIndex((a, i) => i > 0 && a.toUpperCase() === 'COUNT');
            const entries = await client.xRange(
              key,
              rest[1] ?? '-',
              rest[2] ?? '+',
              countIdx > 0 ? { COUNT: Number(rest[countIdx + 1] ?? 20) } : undefined,
            );
            const rows: NormalizedCell[][] = [];
            for (const entry of entries) {
              const fields = Object.entries(entry.message ?? {});
              if (fields.length === 0) rows.push([cell(entry.id), null, null]);
              for (const [f, v] of fields) rows.push([cell(entry.id), cell(f), cell(v)]);
            }
            return { columns: ['id', 'field', 'value'], rows, rowCount: rows.length };
          }
          default:
            throw new Error(`Redis query 暂未实现命令 ${cmd}`);
        }
      } catch (e) {
        throw wrap(e);
      }
    },

    async execute(statement: string): Promise<ExecResult> {
      requireRw('写命令(execute)');
      try {
        const args = parseAndCheck(statement, WRITE_COMMANDS, 'execute');
        const cmd = args[0]!.toUpperCase();
        const reply = await client.sendCommand(args);
        const affected = typeof reply === 'number' ? reply : undefined;
        return {
          affectedRows: affected,
          message: `${cmd} 成功${affected !== undefined ? `（影响 ${affected}）` : String(reply) !== 'OK' ? `（${String(reply)}）` : ''}`,
        };
      } catch (e) {
        throw wrap(e);
      }
    },

    async listDatabases(): Promise<string[]> {
      try {
        const raw = await client.info('keyspace');
        const dbs = [...raw.matchAll(/^(db\d+):/gm)].map((m) => m[1]!).sort();
        return dbs.length > 0 ? dbs : ['db0'];
      } catch {
        return ['db0'];
      }
    },

    async listTables(): Promise<TableInfo[]> {
      try {
        const keys: string[] = [];
        for await (const k of client.scanIterator({ MATCH: '*', COUNT: SCAN_COUNT })) {
          keys.push(...(Array.isArray(k) ? k : [String(k)]));
          if (keys.length >= LIST_TABLES_MAX) break;
        }
        if (keys.length === 0) return [];
        const multi = client.multi();
        for (const k of keys) multi.type(k);
        const types = (await multi.exec()) as unknown[];
        return keys.map((name, i) => ({ name, type: String(types[i] ?? 'none') }));
      } catch (e) {
        throw wrap(e);
      }
    },

    async describeTable(key: string): Promise<ColumnInfo[]> {
      try {
        const type = await client.type(key);
        const lenCmd = LENGTH_CMD_BY_TYPE[type];
        const encoding = await client.sendCommand(['OBJECT', 'ENCODING', key]);
        const ttl = await client.ttl(key);
        const length = lenCmd ? await (client[lenCmd.method] as (k: string) => Promise<unknown>)(key) : null;
        const cols: ColumnInfo[] = [
          { name: 'type', dataType: type, nullable: false },
          { name: 'encoding', dataType: 'OBJECT ENCODING', nullable: true, default: encoding === null ? null : String(encoding) },
          { name: 'ttl', dataType: 'seconds', nullable: true, default: String(ttl), comment: '-1 表示未设置过期' },
        ];
        if (lenCmd) {
          cols.push({ name: 'length', dataType: lenCmd.cmd, nullable: true, default: length === null ? null : String(length) });
        }
        return cols;
      } catch (e) {
        throw wrap(e);
      }
    },

    // KV 型无行偏移语义（契约允许忽略 database/offset），仅按 limit 取样本
    async previewRows(key: string, limit: number, _database?: string, _offset?: number): Promise<QueryResult> {
      try {
        const n = Math.max(1, Math.min(Math.floor(limit) || PREVIEW_MAX, PREVIEW_MAX));
        const type = await client.type(key);
        switch (type) {
          case 'string': {
            const v = await client.get(key);
            return { columns: ['key', 'value'], rows: [[cell(key), cell(v)]], rowCount: v === null ? 0 : 1 };
          }
          case 'hash': {
            const map = await client.hGetAll(key);
            const rows = Object.entries(map).slice(0, n).map(([f, v]) => [cell(f), cell(v)] as NormalizedCell[]);
            return { columns: ['field', 'value'], rows, rowCount: rows.length };
          }
          case 'list': {
            const vals = await client.lRange(key, 0, n - 1);
            return { columns: ['value'], rows: vals.map((v) => [cell(v)]), rowCount: vals.length };
          }
          case 'set': {
            const vals = await client.sMembers(key);
            const rows = (vals ?? []).slice(0, n).map((v) => [cell(v)]);
            return { columns: ['member'], rows, rowCount: rows.length };
          }
          case 'zset': {
            const pairs = await client.zRangeWithScores(key, '0', String(n - 1));
            const rows = pairs.map((m) => [cell(m.value), cell(m.score)]);
            return { columns: ['member', 'score'], rows, rowCount: rows.length };
          }
          case 'stream': {
            const entries = await client.xRange(key, '-', '+', { COUNT: n });
            const rows: NormalizedCell[][] = [];
            for (const entry of entries) {
              const fields = Object.entries(entry.message ?? {});
              if (fields.length === 0) rows.push([cell(entry.id), null, null]);
              for (const [f, v] of fields) rows.push([cell(entry.id), cell(f), cell(v)]);
            }
            return { columns: ['id', 'field', 'value'], rows, rowCount: rows.length };
          }
          default:
            return { columns: ['value'], rows: [], rowCount: 0 };
        }
      } catch (e) {
        throw wrap(e);
      }
    },

    async close(): Promise<void> {
      try {
        await client.quit();
      } catch { /* 已断开等场景忽略 */ }
    },
  };

  function kv(key: string, v: unknown): QueryResult {
    return { columns: ['key', 'value'], rows: [[cell(key), cell(v)]], rowCount: 1 };
  }

  return adapter;
}

function sanitizeUrl(url: string): string {
  return url.replace(/:\/\/[^@/]*@/, '://***:***@');
}

export const factory: AdapterFactory = async (conn) => createRedisAdapter(conn);
