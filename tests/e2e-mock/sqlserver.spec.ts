/**
 * SQL Server 端到端链路验证（面板 → HTTP → manager → 真实适配器注册表 → 假 TDS 驱动）。
 *
 * 与 tests/adapters-sql/sqlserver-offline.test.ts 的区别：那份证明「适配器自身」正确，
 * 本文件证明「链路接线」正确 —— 全链路只把最底层驱动换成 Fake：
 *   client 契约（字段名/参数名）→ handleDbToolRequest（lib/http）→ DbToolService（lib/manager）
 *   → getAdapter（lib/adapters/index.ts 真实注册表）→ createSqlserverAdapter（真实适配器）
 *   → Fake mssql 驱动（断言下发的池配置与精确 SQL 文本）。
 * 任一层漏接线（kind 分支缺失、参数名不匹配、缓存键错、错误被吞）都会在这里红。
 *
 * 断点用 it.fails 标注（预期失败=缺陷证据），不污染 npm test 基线。
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleDbToolRequest } from '../../lib/http/index.js';
import { DbToolService } from '../../lib/manager.js';
import { ChallengeStore } from '../../lib/guard/index.js';
import { DbToolStore } from '../../lib/store/index.js';
import { getAdapter } from '../../lib/adapters/index.js';
import type { AccessMode, DbKind, ResolvedConnection } from '../../lib/adapters/types.js';
import type {
  SqlDriver,
  SqlPool,
  SqlQueryResult,
  SqlRecordset,
  SqlRequest,
  SqlTransaction,
} from '../../lib/adapters/sqlserver/index.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';

/**
 * 传输读写端替身：只替 kinds/sqlserver.js 的建连入口（真驱动建连已由
 * tests/adapters-sql/transfer-sqlserver.test.ts 的 mock pool 覆盖），
 * 使本文件能验证「HTTP → manager.transferStart → transfer.ts 编排 → model 分派 → 读写端」
 * 的整条服务层链路真的能跑完并把定位参数送到读写端。
 */
const transferSeen = vi.hoisted(() => ({
  readers: [] as Array<{ id: unknown; loc: unknown }>,
  writers: [] as Array<{ id: unknown; mode: unknown; loc: unknown }>,
}));

vi.mock('../../lib/adapters/transfer/kinds/sqlserver.js', () => ({
  createSqlserverTransferReaderFromConn: async (rc: { meta: { id: string } }, loc: unknown) => {
    transferSeen.readers.push({ id: rc.meta.id, loc });
    return {
      kind: 'sqlserver',
      listTables: async () => ['users'],
      describe: async (name: string) => ({
        name,
        columns: [{ name: 'id', midType: 'int', nullable: false, primaryKey: true }],
      }),
      count: async () => 2,
      shardKey: async () => null, // 无分片键 → 编排层顺序读
      readBatch: async (_t: string, cursor: { mode: string; offset?: number }) =>
        cursor.mode === 'offset' && (cursor.offset ?? 0) > 0 ? [] : [[1], [2]],
      close: async () => {},
    };
  },
  createSqlserverTransferWriterFromConn: async (rc: { meta: { id: string } }, mode: unknown, loc: unknown) => {
    transferSeen.writers.push({ id: rc.meta.id, mode, loc });
    return {
      kind: 'sqlserver',
      tableExists: async () => false,
      dropTable: async () => {},
      createTable: async () => {},
      writeBatch: async (_t: unknown, rows: unknown[]) => rows.length,
      close: async () => {},
    };
  },
}));

/* ============================ Fake TDS 驱动 ============================ */

type Row = Record<string, unknown>;
type ColMeta = Record<string, { type?: unknown }>;

/** 构造真实 mssql 形态的结果集（列元数据挂在数组的 columns 属性上） */
function rec(rows: Row[], columns?: ColMeta): SqlQueryResult {
  const recordset = rows.slice() as SqlRecordset;
  if (columns) recordset.columns = columns;
  return { recordset, rowsAffected: [rows.length] };
}
function cols(...names: string[]): ColMeta {
  return Object.fromEntries(names.map((n) => [n, {}]));
}

class FakeRequest implements SqlRequest {
  readonly binds: Record<string, unknown> = {};
  constructor(private readonly drive: FakeTds) {}
  input(name: string, ...rest: unknown[]): SqlRequest {
    this.binds[name] = rest.length >= 2 ? rest[1] : rest[0];
    return this;
  }
  query(sql: string): Promise<SqlQueryResult> {
    return Promise.resolve(this.drive.respond(sql, { ...this.binds }));
  }
}

class FakePool implements SqlPool {
  connects = 0;
  closes = 0;
  errorHandlers: Array<(...args: never[]) => void> = [];
  constructor(
    readonly config: Record<string, unknown>,
    private readonly drive: FakeTds,
  ) {}
  request(): SqlRequest {
    return new FakeRequest(this.drive);
  }
  connect(): Promise<unknown> {
    this.connects += 1;
    return Promise.resolve(this);
  }
  close(): Promise<unknown> {
    this.closes += 1;
    return Promise.resolve();
  }
  on(event: string, cb: (...args: never[]) => void): unknown {
    if (event === 'error') this.errorHandlers.push(cb);
    return this;
  }
}

class FakeTransaction implements SqlTransaction {
  events: string[] = [];
  constructor(
    readonly pool: FakePool,
    private readonly drive: FakeTds,
  ) {}
  begin(): Promise<unknown> {
    this.events.push('begin');
    return Promise.resolve(this);
  }
  commit(): Promise<unknown> {
    this.events.push('commit');
    return Promise.resolve();
  }
  rollback(): Promise<unknown> {
    this.events.push('rollback');
    return Promise.resolve();
  }
  request(): SqlRequest {
    // 事务内请求走同一 Fake 记录器（SQL 与绑定照记）
    return new FakeRequest(this.drive);
  }
}

/** 可编程的假 mssql：按 SQL 文本分派应答，记录池配置/执行 SQL/绑定参数 */
class FakeTds {
  pools: FakePool[] = [];
  configs: Record<string, unknown>[] = [];
  txs: FakeTransaction[] = [];
  executed: Array<{ sql: string; binds: Record<string, unknown> }> = [];
  /** 命中 includes 的 SQL 一律抛该错（模拟驱动/服务器错误） */
  fail?: { includes: string; error: unknown };
  /** testConnect / 版本探测应答（默认 SQL Server 2022） */
  version = { version: '16.0.4165.4', major: 16, engine: 3 };

  databases = ['appdb', 'reportdb'];
  schemas = ['dbo', 'sales'];
  tablesBySchema: Record<string, Array<{ name: string; type: string }>> = {
    dbo: [
      { name: 'users', type: 'U' },
      { name: 'v_users', type: 'V' },
    ],
    sales: [{ name: 'orders', type: 'U' }],
  };
  columnsByRef: Record<string, Row[]> = {
    '[dbo].[users]': [
      { column_id: 1, column_name: 'id', type_name: 'int', max_length: 4, precision: 10, scale: 0, is_nullable: false, default_def: null, comment: '主键' },
      { column_id: 2, column_name: 'name', type_name: 'nvarchar', max_length: 200, precision: 0, scale: 0, is_nullable: true, default_def: null, comment: null },
    ],
  };
  pkByRef: Record<string, number[]> = { '[dbo].[users]': [1] };
  dataRows: Row[] = [
    { id: 1, name: 'alice' },
    { id: 2, name: 'bob' },
  ];

  readonly driver: SqlDriver = (() => {
    const self = this; // 字段初始化期捕获本实例：ConnectionPool/Transaction 需支持 new
    return {
      ConnectionPool: function (config: Record<string, unknown>) {
        const pool = new FakePool(config ?? {}, self);
        self.pools.push(pool);
        self.configs.push(config ?? {});
        return pool;
      },
      Transaction: function (pool: SqlPool) {
        const tx = new FakeTransaction(pool as FakePool, self);
        self.txs.push(tx);
        return tx;
      },
      TYPES: { Decimal: { t: 'Decimal' }, Numeric: { t: 'Numeric' }, BigInt: { t: 'BigInt' }, UniqueIdentifier: { t: 'UniqueIdentifier' } },
    } as unknown as SqlDriver;
  })();

  /** 最近一次执行的 SQL（按 includes 过滤；未命中抛错，避免 undefined 静默通过） */
  lastSql(includes: string): { sql: string; binds: Record<string, unknown> } {
    const hit = [...this.executed].reverse().find((e) => e.sql.includes(includes));
    if (!hit) throw new Error(`FakeTds 未执行含「${includes}」的 SQL；已执行: ${this.executed.map((e) => e.sql.slice(0, 60)).join(' | ')}`);
    return hit;
  }

  /** 池配置快照（server/port/user/password/database 由适配器从 URL/fields 解析下发） */
  get lastConfig(): Record<string, unknown> {
    const c = this.configs[this.configs.length - 1];
    if (!c) throw new Error('FakeTds 尚未创建连接池');
    return c;
  }

  respond(sql: string, binds: Record<string, unknown>): SqlQueryResult {
    this.executed.push({ sql, binds });
    if (this.fail && sql.includes(this.fail.includes)) throw this.fail.error;
    // testConnect 探针（含 nvarchar(128) 强转）先于通用版本探测判定
    if (sql.includes('AS nvarchar(128)')) {
      const v = this.version;
      return rec([{ version: v.version, major: v.major, engine: v.engine }], cols('version', 'major', 'engine'));
    }
    if (sql.includes('ProductMajorVersion')) return rec([{ major: this.version.major }], cols('major'));
    if (sql.includes('sys.databases')) return rec(this.databases.map((name) => ({ name })), cols('name'));
    // 注意顺序：LIST_TABLES_SQL 同时含 sys.objects 与 sys.schemas（JOIN），必须先判 sys.objects
    if (sql.includes('sys.objects')) {
      const schema = String(binds['p1'] ?? '');
      const list = this.tablesBySchema[schema] ?? [];
      return rec(list.map((t) => ({ table_name: t.name, obj_type: t.type })), cols('table_name', 'obj_type'));
    }
    if (sql.includes('sys.schemas')) return rec(this.schemas.map((name) => ({ name })), cols('name'));
    if (sql.includes('sys.columns')) {
      const rows = this.columnsByRef[String(binds['p1'] ?? '')] ?? [];
      return rec(rows.slice(), cols('column_id', 'column_name', 'type_name', 'max_length', 'precision', 'scale', 'is_nullable', 'default_def', 'comment'));
    }
    if (sql.includes('sys.indexes')) {
      const ids = this.pkByRef[String(binds['p1'] ?? '')] ?? [];
      return rec(ids.map((column_id) => ({ column_id })), cols('column_id'));
    }
    // 数据浏览计数（含搜索谓词版）：先于通用 ROW_NUMBER/preview 判定
    if (sql.includes('COUNT(*) AS [n]')) return rec([{ n: 123 }], cols('n'));
    // 内容搜索列探测（SELECT TOP 0 *）：0 行但带列元数据
    if (/SELECT TOP 0 \* FROM/.test(sql)) return rec([], cols('id', 'name'));
    // 预览/用户查询
    if (/OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY/.test(sql) || /ROW_NUMBER\(\)/.test(sql)) {
      return rec(this.dataRows, cols('id', 'name'));
    }
    // 内容搜索（11+ 路径）：绑定 @pN 谓词 + @dsh_off/@dsh_lim 分页
    if (/OFFSET @dsh_off ROWS FETCH NEXT @dsh_lim ROWS ONLY/.test(sql)) {
      return rec(this.dataRows, cols('id', 'name'));
    }
    return rec([{ answer: 1 }], cols('answer'));
  }
}

/* ============================ HTTP 桩与测试环境 ============================ */

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = { host: '127.0.0.1' };
  (req as unknown as { method: string }).method = method;
  (req as unknown as { url: string }).url = url;
  queueMicrotask(() => {
    if (body !== undefined) (req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)));
    (req as unknown as EventEmitter).emit('end');
  });
  return req;
}

class MockRes {
  statusCode = 200;
  body = '';
  headersSent = false;
  writeHead(status: number): this {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }
  setHeader(): void {}
  end(chunk?: string): this {
    if (chunk !== undefined) this.body += chunk;
    return this;
  }
}

const SS_URL = 'sqlserver://sa:P%40ss1@db1.example.com:1433/appdb?encrypt=true';

interface Env {
  home: string;
  project: string;
  store: DbToolStore;
  service: DbToolService;
  tds: FakeTds;
  /** 每次适配器工厂调用记录（connId + mode）——断言 ro/rw 双实例语义 */
  factoryCalls: Array<{ connId: string; mode?: AccessMode }>;
  call(method: string, p: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<{ status: number; json: any }>;
  dispose(): Promise<void>;
}

/** 环境：真实 store + 真实 manager + 真实 registry，只把 TDS 驱动换成 FakeTds */
function makeEnv(): Env {
  const home = makeTempHome();
  const store = new DbToolStore(home);
  const project = path.join(os.tmpdir(), 'dbt-ss-e2e-proj');
  const tds = new FakeTds();
  const factoryCalls: Array<{ connId: string; mode?: AccessMode }> = [];
  const service = new DbToolService(store, {
    // 真实注册表 getAdapter：LOAEDRS 里没有 sqlserver 分支这里就直接炸（driverMissingError）
    adapterResolver: async (kind: DbKind) => {
      const load = await getAdapter(kind);
      return (conn: ResolvedConnection, opts?: { mode?: AccessMode }) => {
        factoryCalls.push({ connId: conn.meta.id, mode: opts?.mode });
        return load(conn, { ...(opts ?? {}), driver: tds.driver } as never);
      };
    },
    challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
  });

  async function call(
    method: string,
    p: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<{ status: number; json: any }> {
    const entries = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '');
    const qs = entries.length > 0 ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : '';
    const res = new MockRes();
    await handleDbToolRequest(
      mockReq(method, '/dsh-db-tool/api/' + p + qs, body),
      res as unknown as ServerResponse,
      service,
    );
    return { status: res.statusCode, json: JSON.parse(res.body || '{}') as any };
  }

  return {
    home,
    project,
    store,
    service,
    tds,
    factoryCalls,
    call,
    dispose: async () => {
      await service.dispose();
      cleanupDir(home);
    },
  };
}

/** 建一个 sqlserver 连接（走 HTTP，等价面板保存）并授权 */
async function seed(env: Env, id = 'ss1', mode: AccessMode = 'rw'): Promise<void> {
  const r = await env.call('POST', 'connections', {
    id,
    kind: 'sqlserver',
    url: SS_URL,
  });
  expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
  const g = await env.call('PUT', 'grants', { projectPath: env.project, connId: id, mode });
  expect(g.json.ok).toBe(true);
}

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.dispose();
});

/* ============================ 1. 连接表单 → 建连 → 脱敏 ============================ */

describe('1 建连接（面板表单契约 → HTTP → store 脱敏）', () => {
  it('URL 模式：sqlserver 连接落盘，明文密码只进 secrets，meta.safeUrl 脱敏且 mode=url', async () => {
    const created = await env.call('POST', 'connections', {
      id: 'ss1',
      kind: 'sqlserver',
      name: 'ss-prod',
      url: SS_URL,
      ssl: true,
    });
    expect(created.json.ok, JSON.stringify(created.json)).toBe(true);
    expect(created.json.data).toMatchObject({ id: 'ss1', kind: 'sqlserver', name: 'ss-prod', mode: 'url' });
    // redactUrl 对 sqlserver:// 成立（scheme 无关正则）
    expect(created.json.data.safeUrl).toBe('sqlserver://sa:***@db1.example.com:1433/appdb?encrypt=true');

    // 落盘：connections.json 不得含明文，secrets.json 保留完整 URL
    const conns = fs.readFileSync(path.join(env.home, 'db-tool', 'connections.json'), 'utf8');
    expect(conns).not.toContain('P%40ss1');
    expect(conns).not.toContain('P@ss1');
    const secrets = fs.readFileSync(path.join(env.home, 'db-tool', 'secrets.json'), 'utf8');
    expect(secrets).toContain(SS_URL);

    // 回读（面板列表）：也不得回传明文。
    // 注意：URL 模式的密码存在 secrets.url（非 secrets.password），故 hasPassword 不置位 ——
    // 前端 URL 模式用独立的 urlPassword 输入框（占位「留空保持已存」），不依赖该标志。
    const list = await env.call('GET', 'connections');
    expect(list.json.data[0]).toMatchObject({ id: 'ss1', kind: 'sqlserver', mode: 'url' });
    expect(list.json.data[0].safeUrl).toBe('sqlserver://sa:***@db1.example.com:1433/appdb?encrypt=true');
    expect(list.json.data[0].hasPassword).toBeUndefined();
    expect(JSON.stringify(list.json)).not.toContain('P%40ss1');
  });

  it('分字段模式：fields.host/port/user/password/database 落库，密码拆入 secrets，hasPassword=true', async () => {
    const created = await env.call('POST', 'connections', {
      id: 'ss3',
      kind: 'sqlserver',
      fields: { host: '10.0.0.9', port: 14330, user: 'sa', password: 'P@ss:w/rd', database: 'appdb' },
    });
    expect(created.json.ok, JSON.stringify(created.json)).toBe(true);
    expect(created.json.data).toMatchObject({ id: 'ss3', kind: 'sqlserver', mode: 'fields', hasPassword: true });
    expect(created.json.data).toMatchObject({ host: '10.0.0.9', port: 14330, user: 'sa', database: 'appdb' });

    const conns = fs.readFileSync(path.join(env.home, 'db-tool', 'connections.json'), 'utf8');
    expect(conns).not.toContain('P@ss:w/rd');
    expect(JSON.parse(conns).connections[0].fields).not.toHaveProperty('password');

    // 保存后测试：服务端拼回机密 → 适配器 fields 分支解析
    const test = await env.call('POST', 'connections/ss3/test');
    expect(test.json.ok, JSON.stringify(test.json)).toBe(true);
    expect(env.tds.lastConfig).toMatchObject({
      server: '10.0.0.9', port: 14330, user: 'sa', password: 'P@ss:w/rd', database: 'appdb',
    });
  });

  it('workaround（已可用）：重新输入不含 *** 的完整 URL 才能改端口/库名', async () => {
    await env.call('POST', 'connections', { id: 'ss1', kind: 'sqlserver', url: SS_URL });
    const r = await env.call('PUT', 'connections/ss1', {
      url: 'sqlserver://sa:P%40ss1@db1.example.com:14330/appdb2?encrypt=true', // 完整重输（非回填的脱敏值）
    });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const test = await env.call('POST', 'connections/ss1/test');
    expect(test.json.ok, JSON.stringify(test.json)).toBe(true);
    expect(env.tds.lastConfig).toMatchObject({ user: 'sa', password: 'P@ss1', port: 14330, database: 'appdb2' });
  });

  it('编辑 URL 连接：改了端口并补填 urlPassword 时，端口改动生效（凭据按已存真值合并）', async () => {
    await env.call('POST', 'connections', { id: 'ss1', kind: 'sqlserver', url: SS_URL });
    const r = await env.call('PUT', 'connections/ss1', {
      url: 'sqlserver://sa:***@db1.example.com:14330/appdb?encrypt=true',
      urlPassword: 'P@ss1',
    });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const test = await env.call('POST', 'connections/ss1/test');
    expect(test.json.ok, JSON.stringify(test.json)).toBe(true);
    // 期望：用户输入的端口 14330 生效（实际：base 被替换为已存 URL，端口仍是 1433）
    expect(env.tds.lastConfig['port']).toBe(14330);
  });

  it('编辑 URL 连接：只改端口（密码留空）时保留真实密码，*** 不落盘、连接仍可连', async () => {
    // 前端 ConnDialog 编辑 URL 连接时表单里就是脱敏值（client.js:1255 url: c.safeUrl），
    // 用户只改端口 → draftBody 判定 url !== 回填值 → PUT 发含 *** 的 URL（client.js:1315）。
    // 服务端 mergeUrlCredentials 在无 urlUser/urlPassword 时原样返回该串（connections.ts:112），
    // update 随后把它写进 secrets.url（connections.ts:293-296）→ 真密码被 *** 覆盖。
    await env.call('POST', 'connections', { id: 'ss1', kind: 'sqlserver', url: SS_URL });
    const edited = 'sqlserver://sa:***@db1.example.com:14330/appdb?encrypt=true';
    const r = await env.call('PUT', 'connections/ss1', { url: edited });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);

    // 期望（正确行为）：机密里绝不能出现脱敏占位，真密码必须保留或明确报错
    const secretsRaw = fs.readFileSync(path.join(env.home, 'db-tool', 'secrets.json'), 'utf8');
    expect(secretsRaw).not.toContain('***');
    expect(secretsRaw).toContain('P%40ss1');

    // 期望：保存后连接仍可连（实际已连不上：适配器拿到的 password 是字面量 ***）
    const test = await env.call('POST', 'connections/ss1/test');
    expect(test.json.ok, JSON.stringify(test.json)).toBe(true);
    expect(env.tds.lastConfig['password']).toBe('P@ss1');
  });

  it('URL 无 userinfo + urlUser/urlPassword 独立凭据：注入后适配器能还原特殊字符密码（round-trip）', async () => {
    const created = await env.call('POST', 'connections', {
      id: 'ss2',
      kind: 'sqlserver',
      url: 'sqlserver://db9.example.com:1433/appdb',
      urlUser: 'sa',
      urlPassword: 'P@ss:w/rd', // '@', ':', '/' 全踩一遍
    });
    expect(created.json.ok, JSON.stringify(created.json)).toBe(true);
    expect(created.json.data.safeUrl).toBe('sqlserver://sa:***@db9.example.com:1433/appdb');

    // 编辑态「保存前测试」：url 未发（前端只发 connId）→ 服务端拼回已存机密
    const test = await env.call('POST', 'test-draft', { kind: 'sqlserver', connId: 'ss2', urlUser: 'sa' });
    expect(test.json.ok, JSON.stringify(test.json)).toBe(true);
    const cfg = env.tds.lastConfig;
    expect(cfg['server']).toBe('db9.example.com');
    expect(cfg['user']).toBe('sa');
    expect(cfg['password']).toBe('P@ss:w/rd'); // percent-encode ↔ decodeCred 互逆
    expect(cfg['database']).toBe('appdb');
  });
});

/* ============================ 2. 连接测试（多版本） ============================ */

describe('2 连接测试：/api/test-draft → manager.testDraft → 适配器 testConnect 整形', () => {
  const cases: Array<{ name: string; v: { version: string; major: number; engine: number }; expect: string }> = [
    { name: 'SQL Server 2022', v: { version: '16.0.4165.4', major: 16, engine: 3 }, expect: 'Microsoft SQL Server 2022 - 16.0.4165.4' },
    { name: 'SQL Server 2012', v: { version: '11.0.2100.60', major: 11, engine: 3 }, expect: 'Microsoft SQL Server 2012 - 11.0.2100.60' },
    { name: 'SQL Server 2008 R2', v: { version: '10.50.6000.34', major: 10, engine: 3 }, expect: 'Microsoft SQL Server 2008 R2 - 10.50.6000.34' },
    { name: 'Azure SQL', v: { version: '12.0.2000.8', major: 12, engine: 5 }, expect: 'Azure SQL Database - 12.0.2000.8' },
  ];

  for (const c of cases) {
    it(`${c.name}：serverInfo 正确整形，且 URL 参数完整下发到驱动池配置`, async () => {
      env.tds.version = c.v;
      const r = await env.call('POST', 'test-draft', { kind: 'sqlserver', url: SS_URL });
      expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
      expect(r.json.data).toEqual({ ok: true, serverInfo: c.expect });

      const cfg = env.tds.lastConfig;
      expect(cfg).toMatchObject({ server: 'db1.example.com', port: 1433, user: 'sa', database: 'appdb' });
      expect((cfg['options'] as Record<string, unknown>)['encrypt']).toBe(true);
      // URL 里的 percent-encode 密码必须解码后交给驱动（P%40ss1 → P@ss1）
      expect(cfg['password']).toBe('P@ss1');
    });
  }

  it('已保存连接测试：POST /api/connections/:id/test 走同一条链路', async () => {
    await seed(env);
    const r = await env.call('POST', 'connections/ss1/test');
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data.ok).toBe(true);
    expect(env.tds.lastSql("SERVERPROPERTY('ProductMajorVersion')").sql).toContain('AS nvarchar(128)');
  });
});

/* ============================ 3. 授权与 ro/rw 双实例 ============================ */

describe('3 授权：ro/rw 双缓存实例，只读连接不被复用到可写', () => {
  it('ro：query 可用、execute 被服务层拒；同模式复用同一池', async () => {
    await seed(env, 'ss1', 'ro');
    const q1 = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: 'SELECT 1 AS answer' });
    expect(q1.json.ok, JSON.stringify(q1.json)).toBe(true);
    const poolsAfterFirst = env.tds.pools.length;

    const q2 = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: 'SELECT 2 AS answer' });
    expect(q2.json.ok).toBe(true);
    expect(env.tds.pools.length).toBe(poolsAfterFirst); // 同 mode 命中缓存，不新建池

    const w = await env.call('POST', 'execute', { projectPath: env.project, connId: 'ss1', statement: 'DELETE FROM users' });
    expect(w.json).toMatchObject({ ok: false, code: 'READ_ONLY' });
  });

  it('授权升 rw：旧 ro 实例被回收，新实例独立建立（mode 进缓存键）', async () => {
    await seed(env, 'ss1', 'ro');
    await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: 'SELECT 1 AS answer' });
    const roPool = env.tds.pools[0]!;
    expect(env.factoryCalls.map((c) => c.mode)).toEqual(['ro']);

    await env.call('PUT', 'grants', { projectPath: env.project, connId: 'ss1', mode: 'rw' });
    await new Promise((r) => setImmediate(r)); // dropAdapters 是 void 异步
    expect(roPool.closes).toBeGreaterThan(0);

    const w = await env.call('POST', 'execute', { projectPath: env.project, connId: 'ss1', statement: 'INSERT INTO users VALUES (1)' });
    expect(w.json.ok, JSON.stringify(w.json)).toBe(true);
    expect(env.factoryCalls.map((c) => c.mode)).toEqual(['ro', 'rw']);
    expect(env.tds.pools.length).toBe(2);
    expect(env.tds.pools[1]).not.toBe(roPool);
  });
});

/* ============================ 4. 浏览三层 ============================ */

describe('4 浏览：库 → schema → 表 → 表结构（PRI）→ 预览分页', () => {
  it('databases/schemas/tables/schema/preview 五步全链路（含 db.schema 三段与 offset）', async () => {
    await seed(env, 'ss1', 'ro');
    const P = { project: env.project, connId: 'ss1' };

    const dbs = await env.call('GET', 'databases', undefined, P);
    expect(dbs.json.data).toEqual(['appdb', 'reportdb']);

    const schemas = await env.call('GET', 'schemas', undefined, { ...P, database: 'appdb' });
    expect(schemas.json.data).toEqual(['dbo', 'sales']);

    // 前端 BrowsePane 传 db.schema 三段（client.js:1740），适配器 parseBrowseTarget 解析
    const tables = await env.call('GET', 'tables', undefined, { ...P, database: 'appdb.dbo' });
    expect(tables.json.data).toEqual([
      { name: 'users', type: 'TABLE', database: 'appdb.dbo' },
      { name: 'v_users', type: 'VIEW', database: 'appdb.dbo' },
    ]);
    expect(env.tds.lastSql('sys.objects').binds['p1']).toBe('dbo');

    // 跨库：database=reportdb.dbo 必须路由到 database=reportdb 的独立池
    const cross = await env.call('GET', 'tables', undefined, { ...P, database: 'reportdb.dbo' });
    expect(cross.json.ok, JSON.stringify(cross.json)).toBe(true);
    expect(env.tds.configs.some((c) => c['database'] === 'reportdb')).toBe(true);

    const cols = await env.call('GET', 'schema', undefined, { ...P, database: 'appdb.dbo', table: 'users' });
    expect(cols.json.ok, JSON.stringify(cols.json)).toBe(true);
    expect(cols.json.data.map((c: any) => c.name)).toEqual(['id', 'name']);
    expect(cols.json.data[0].key).toBe('PRI'); // 驱动前端 pkCols（client.js:1957 key==='PRI'）
    expect(cols.json.data[1].key).toBeUndefined();
    expect(String(cols.json.data[1].dataType)).toContain('nvarchar');

    const preview = await env.call('GET', 'preview', undefined, { ...P, database: 'appdb.dbo', table: 'users', limit: 50, offset: 50 });
    expect(preview.json.ok, JSON.stringify(preview.json)).toBe(true);
    expect(preview.json.data).toMatchObject({ columns: ['id', 'name'], rowCount: 2 });
    const pv = env.tds.lastSql('OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY');
    expect(pv.binds).toMatchObject({ p1: 50, p2: 50 });
  });

  it('服务层 limit 上限 50 与 offset 下界 0 对 sqlserver 生效', async () => {
    await seed(env, 'ss1', 'ro');
    await env.call('GET', 'preview', undefined, { project: env.project, connId: 'ss1', table: 'users', limit: 999, offset: -5 });
    expect(env.tds.lastSql('OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY').binds).toMatchObject({ p1: 0, p2: 50 });
  });

  it('浏览计数与内容搜索：COUNT/列探测/搜索 SQL 与绑定契约（total=1 与 search=）', async () => {
    await seed(env, 'ss1', 'ro');
    const P = { project: env.project, connId: 'ss1' };
    const B = { database: 'appdb.dbo', table: 'users' };

    // total=1 → COUNT(*) AS [n]，manager 把计数挂到 total
    const withTotal = await env.call('GET', 'preview', undefined, { ...P, ...B, limit: 50, total: 1 });
    expect(withTotal.json.ok, JSON.stringify(withTotal.json)).toBe(true);
    expect(withTotal.json.data).toMatchObject({ rowCount: 2, total: 123 });
    expect(env.tds.lastSql('COUNT(*) AS [n]').sql).toBe('SELECT COUNT(*) AS [n] FROM [dbo].[users]');

    // search → 列探测 + 全列 CAST NVARCHAR(MAX) LIKE ESCAPE '#'，通配符字面化
    const searched = await env.call('GET', 'preview', undefined, { ...P, ...B, limit: 50, search: 'a%b_c' });
    expect(searched.json.ok, JSON.stringify(searched.json)).toBe(true);
    expect(searched.json.data).toMatchObject({ columns: ['id', 'name'], rowCount: 2, total: 123 });
    const probe = env.tds.lastSql('SELECT TOP 0 * FROM [dbo].[users]');
    expect(probe.binds).toEqual({});
    const search = env.tds.lastSql('OFFSET @dsh_off ROWS FETCH NEXT @dsh_lim ROWS ONLY');
    expect(search.sql).toBe(
      "SELECT * FROM [dbo].[users] WHERE (CAST([id] AS NVARCHAR(MAX)) LIKE @p1 ESCAPE '#' OR CAST([name] AS NVARCHAR(MAX)) LIKE @p2 ESCAPE '#') ORDER BY (SELECT NULL) OFFSET @dsh_off ROWS FETCH NEXT @dsh_lim ROWS ONLY",
    );
    expect(search.binds).toMatchObject({ p1: '%a#%b#_c%', p2: '%a#%b#_c%', dsh_off: 0, dsh_lim: 50 });
    // 搜索计数走同一谓词（匹配行数口径）
    const searchCount = env.tds.lastSql('SELECT COUNT(*) AS [n] FROM [dbo].[users] WHERE (CAST(');
    expect(searchCount.binds).toMatchObject({ p1: '%a#%b#_c%', p2: '%a#%b#_c%' });
  });

  it('2008（major<11）降级：搜索谓词下推 ROW_NUMBER 子查询，偏移上界 off+lim', async () => {
    await seed(env, 'ss1', 'ro');
    env.tds.version = { version: '10.50.6000.34', major: 10, engine: 3 };
    await env.call('GET', 'preview', undefined, { project: env.project, connId: 'ss1', database: 'appdb.dbo', table: 'users', limit: 50, search: 'bob' });
    const search = env.tds.lastSql('ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS [__dsh_rn] FROM [dbo].[users] WHERE (CAST(');
    expect(search.sql).toContain(
      "SELECT t.* FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS [__dsh_rn] FROM [dbo].[users] WHERE (CAST([id] AS NVARCHAR(MAX)) LIKE @p1 ESCAPE '#' OR CAST([name] AS NVARCHAR(MAX)) LIKE @p2 ESCAPE '#')) AS t WHERE t.[__dsh_rn] > @dsh_off AND t.[__dsh_rn] <= @dsh_end",
    );
    expect(search.binds).toMatchObject({ p1: '%bob%', p2: '%bob%', dsh_off: 0, dsh_end: 50 });
  });

  it('表不存在：适配器中文错误经 HTTP 透传（不返回空表结构）', async () => {
    await seed(env, 'ss1', 'ro');
    const r = await env.call('GET', 'schema', undefined, { project: env.project, connId: 'ss1', table: 'nope' });
    expect(r.json.ok).toBe(false);
    expect(String(r.json.error)).toContain('表不存在');
  });
});

/* ============================ 5. SQL 控制台（含事务会话） ============================ */

describe('5 SQL 控制台：占位符重写 / 事务会话 / ro 只读闸门', () => {
  it('query：? 占位符重写为 @p1..@pN 并按序绑定', async () => {
    await seed(env, 'ss1', 'ro');
    const r = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: 'SELECT ? AS a, ? AS b', params: [7, 'x'] });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    const exec = env.tds.lastSql('SELECT @p1 AS a, @p2 AS b');
    expect(exec.binds).toMatchObject({ p1: 7, p2: 'x' });
  });

  it('query：占位符与参数个数不符 → 中文错误（在建池/触网前拦下）', async () => {
    await seed(env, 'ss1', 'ro');
    const r = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: 'SELECT ? AS a, ? AS b', params: [1] });
    expect(r.json.ok).toBe(false);
    expect(String(r.json.error)).toContain('占位符个数');
  });

  it('ro 授权：query 里的写语句先被 guard 判危险，确认重放后仍被适配器只读闸门拒绝（全程未下发驱动）', async () => {
    await seed(env, 'ss1', 'ro');
    const stmt = 'UPDATE users SET name = ?';
    const guard = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: stmt, params: ['x'] });
    expect(guard.json, JSON.stringify(guard.json)).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION' });

    const replay = await env.call('POST', 'query', {
      projectPath: env.project, connId: 'ss1', sql: stmt, params: ['x'], challengeId: guard.json.challengeId,
    });
    expect(replay.json.ok).toBe(false);
    expect(String(replay.json.error)).toMatch(/只读\(ro\)/);
    // 关键安全性质：ro 下写语句从未到达驱动
    expect(env.tds.executed.some((e) => /UPDATE users/i.test(e.sql))).toBe(false);
  });

  it('ro 授权：SELECT ... INTO（T-SQL 建表副作用）先要求确认，确认后仍被只读闸门拒绝', async () => {
    await seed(env, 'ss1', 'ro');
    const stmt = 'SELECT * INTO backup_users FROM users';
    const g = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: stmt });
    expect(g.json, JSON.stringify(g.json)).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION' });

    const replay = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: stmt, challengeId: g.json.challengeId });
    expect(replay.json.ok).toBe(false);
    expect(String(replay.json.error)).toMatch(/只读\(ro\)/);
    expect(env.tds.executed.some((e) => /INTO backup_users/i.test(e.sql))).toBe(false);
  });

  it('事务会话：begin → exec → commit 走同一事务句柄（manager 把 sqlserver 识别为支持事务的 kind）', async () => {
    await seed(env, 'ss1', 'rw');
    const begin = await env.call('POST', 'console/begin', { projectPath: env.project, connId: 'ss1' });
    expect(begin.json.ok, JSON.stringify(begin.json)).toBe(true);
    const token = begin.json.data.sessionToken as string;
    expect(token).toMatch(/^t_/);

    const exec = await env.call('POST', 'console/exec', { sessionToken: token, statement: 'INSERT INTO users VALUES (1)' });
    expect(exec.json.ok, JSON.stringify(exec.json)).toBe(true);

    const commit = await env.call('POST', 'console/commit', { sessionToken: token });
    expect(commit.json.ok, JSON.stringify(commit.json)).toBe(true);
    expect(commit.json.data.message).toBe('事务已提交');

    const tx = env.tds.txs[0];
    expect(tx, '未创建 mssql 事务对象').toBeDefined();
    expect(tx!.events).toEqual(['begin', 'commit']);
  });

  it('事务会话：rollback 路径与「指定数据库」拒绝语义', async () => {
    await seed(env, 'ss1', 'rw');
    const begin = await env.call('POST', 'console/begin', { projectPath: env.project, connId: 'ss1' });
    const token = begin.json.data.sessionToken as string;
    const rb = await env.call('POST', 'console/rollback', { sessionToken: token });
    expect(rb.json.ok, JSON.stringify(rb.json)).toBe(true);
    expect(env.tds.txs[0]!.events).toEqual(['begin', 'rollback']);

    const withDb = await env.call('POST', 'console/begin', { projectPath: env.project, connId: 'ss1', database: 'appdb' });
    expect(withDb.json).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    expect(String(withDb.json.error)).toContain('不支持指定数据库');
  });
});

/* ============================ 6. run_script ============================ */

describe('6 run_script：db.query 句柄对 sqlserver 可用', () => {
  it('POST /api/script 内 db.query 回父进程执行并返回结果', async () => {
    await seed(env, 'ss1', 'rw');
    const r = await env.call('POST', 'script', {
      projectPath: env.project,
      connId: 'ss1',
      code: 'const r = await db.query("SELECT 1 AS answer"); return r.rowCount;',
    });
    expect(r.json.ok, JSON.stringify(r.json)).toBe(true);
    expect(r.json.data).toBe(1);
  }, 30_000);

  it('ro 授权下 run_script 直接拒绝（写语义）', async () => {
    await seed(env, 'ss1', 'ro');
    const r = await env.call('POST', 'script', { projectPath: env.project, connId: 'ss1', code: 'return 1;' });
    expect(r.json).toMatchObject({ ok: false, code: 'READ_ONLY' });
  });
});

/* ============================ 7. 数据传输 ============================ */

describe('7 数据传输：源/目标可为 sqlserver，定位参数进 challenge 语句', () => {
  it('transfer/start 首次进入危险确认，statement 含 kind 与源/目标定位', async () => {
    await seed(env, 'ss1', 'ro');
    await seed(env, 'ss2', 'rw');
    const r = await env.call('POST', 'transfer/start', {
      projectPath: env.project,
      sourceConnId: 'ss1',
      targetConnId: 'ss2',
      tables: ['users'],
      writeMode: 'insert',
      sourceDatabase: 'appdb',
      sourceSchema: 'sales',
      targetDatabase: 'reportdb',
      targetSchema: 'dbo',
    });
    expect(r.json, JSON.stringify(r.json)).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION' });
    expect(String(r.json.statement)).toContain('sqlserver(ss1) → sqlserver(ss2)');
    expect(String(r.json.statement)).toContain('源=appdb.sales');
    expect(String(r.json.statement)).toContain('目标=reportdb.dbo');
  });

  it('tables 重复/为空在授权之前被拦（INVALID_ARGUMENT）', async () => {
    await seed(env, 'ss1', 'ro');
    await seed(env, 'ss2', 'rw');
    const dup = await env.call('POST', 'transfer/start', {
      projectPath: env.project, sourceConnId: 'ss1', targetConnId: 'ss2', tables: ['users', 'users'],
    });
    expect(dup.json).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    const empty = await env.call('POST', 'transfer/start', {
      projectPath: env.project, sourceConnId: 'ss1', targetConnId: 'ss2', tables: [],
    });
    expect(empty.json).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  it('challenge 重放 → 编排真跑：读写端收到源/目标定位，进度快照 done 且行数一致', async () => {
    await seed(env, 'ss1', 'ro');
    await seed(env, 'ss2', 'rw');
    transferSeen.readers.length = 0;
    transferSeen.writers.length = 0;

    const input = {
      projectPath: env.project,
      sourceConnId: 'ss1',
      targetConnId: 'ss2',
      tables: ['users'],
      writeMode: 'insert' as const,
      sourceDatabase: 'appdb',
      sourceSchema: 'sales',
      targetDatabase: 'reportdb',
      targetSchema: 'dbo',
    };
    const first = await env.call('POST', 'transfer/start', input);
    expect(first.json.code).toBe('NEEDS_CONFIRMATION');

    const started = await env.call('POST', 'transfer/start', { ...input, challengeId: first.json.challengeId });
    expect(started.json.ok, JSON.stringify(started.json)).toBe(true);
    const taskId = started.json.data.taskId as string;
    expect(taskId).toMatch(/^t/);

    // 轮询到终态（编排是异步任务）
    let snap: any = null;
    for (let i = 0; i < 80; i++) {
      const p = await env.call('GET', 'transfer/' + encodeURIComponent(taskId), undefined, { project: env.project });
      expect(p.json.ok, JSON.stringify(p.json)).toBe(true);
      snap = p.json.data;
      if (snap.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(snap.status, JSON.stringify(snap)).toBe('done');
    expect(snap.tables).toEqual([
      expect.objectContaining({ name: 'users', status: 'done', rows: 2 }),
    ]);
    expect(snap.failures).toEqual([]);

    // 定位参数真的送到了读写端（sqlserverLocate 的上游）
    expect(transferSeen.readers[0]).toEqual({ id: 'ss1', loc: { database: 'appdb', schema: 'sales' } });
    expect(transferSeen.writers[0]).toEqual({ id: 'ss2', mode: 'insert', loc: { database: 'reportdb', schema: 'dbo' } });

    // 传输历史（终态持久化）落盘
    const hist = await env.call('GET', 'transfer-history', undefined, { project: env.project });
    expect(hist.json.ok).toBe(true);
    expect(hist.json.data.length).toBeGreaterThan(0);
  });
});

/* ============================ 8. 连接导出/导入 ============================ */

describe('8 连接导出/导入对 sqlserver 成立（含机密迁移）', () => {
  it('导出密文 → 导入新 store：kind/safeUrl/hasPassword 保留，且能用迁移后的机密连通', async () => {
    await seed(env, 'ss1', 'rw');
    const exported = await env.call('POST', 'connections/export', { passphrase: 'pass1234' });
    expect(exported.json.ok, JSON.stringify(exported.json)).toBe(true);
    expect(exported.json.data.count).toBe(1);

    // 新环境（新临时 home + 新 service）模拟另一台机器导入
    const env2 = makeEnv();
    try {
      const imported = await env2.call('POST', 'connections/import', {
        json: exported.json.data.json,
        passphrase: 'pass1234',
      });
      expect(imported.json.ok, JSON.stringify(imported.json)).toBe(true);
      expect(imported.json.data).toMatchObject({ imported: 1, skipped: [], errors: [] });

      const list = await env2.call('GET', 'connections');
      expect(list.json.data[0]).toMatchObject({ id: 'ss1', kind: 'sqlserver', mode: 'url' });
      expect(list.json.data[0].safeUrl).toBe('sqlserver://sa:***@db1.example.com:1433/appdb?encrypt=true');
      expect(JSON.stringify(list.json)).not.toContain('P%40ss1');

      await env2.call('PUT', 'grants', { projectPath: env2.project, connId: 'ss1', mode: 'rw' });
      const test = await env2.call('POST', 'connections/ss1/test');
      expect(test.json.ok, JSON.stringify(test.json)).toBe(true);
      expect(env2.tds.lastConfig['password']).toBe('P@ss1'); // 机密随包迁移
    } finally {
      await env2.dispose();
    }
  });
});

/* ============================ 9. 错误回显 ============================ */

describe('9 错误回显：适配器中文错误原样透传到 UI 契约层', () => {
  it('ESOCKET/ELOGIN 类驱动错误 → 中文可读提示 + code DRIVER_ERROR', async () => {
    env.tds.fail = {
      includes: "SERVERPROPERTY('ProductVersion')",
      error: Object.assign(new Error('Failed to connect to db1.example.com:1433 in 15000ms'), {
        name: 'ConnectionError',
        code: 'ESOCKET',
      }),
    };
    const r = await env.call('POST', 'test-draft', { kind: 'sqlserver', url: SS_URL });
    expect(r.json.ok).toBe(false);
    expect(r.json.code).toBe('DRIVER_ERROR');
    expect(String(r.json.error)).toContain('网络不可达');
    expect(String(r.json.error)).toContain('Failed to connect to db1.example.com:1433'); // 原始信息不吞
  });

  it('SQL 执行错误（EREQUEST）→ 中文错误号/行号，且 HTTP 仍 200 + ok:false（前端 api() 抛 message）', async () => {
    await seed(env, 'ss1', 'ro');
    env.tds.fail = {
      includes: 'SELECT @p1 AS a',
      error: Object.assign(new Error("Invalid object name 'nope'."), {
        name: 'RequestError',
        code: 'EREQUEST',
        number: 208,
        severity: 16,
        lineNumber: 1,
      }),
    };
    const r = await env.call('POST', 'query', { projectPath: env.project, connId: 'ss1', sql: 'SELECT ? AS a', params: [1] });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(false);
    expect(String(r.json.error)).toContain('SQL 执行错误（错误号 208');
    expect(String(r.json.error)).toContain("Invalid object name 'nope'.");
  });

  it('未授权项目：错误是 UNAUTHORIZED_PROJECT 而非 DRIVER_ERROR（不误报成连接问题）', async () => {
    await seed(env, 'ss1', 'ro');
    const r = await env.call('POST', 'query', { projectPath: path.join(os.tmpdir(), 'other-proj'), connId: 'ss1', sql: 'SELECT 1 AS answer' });
    expect(r.json).toMatchObject({ ok: false, code: 'UNAUTHORIZED_PROJECT' });
  });
});

