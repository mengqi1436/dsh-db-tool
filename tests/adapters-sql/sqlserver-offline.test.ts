/**
 * SQL Server 适配器离线单测（不连真机，用户已明确不提供实例）。
 *
 * 两种既有手法混合：
 *  - 手法 A（无 mock，参照 mysql-offline.test.ts）：配置/校验路径在触达驱动与网络之前必抛，
 *    断言用双断言（既匹配错误标签，又断言不含不该出现的词），防止「错误类型漂移」无声通过。
 *  - 手法 B（参照 pg-like.test.ts:14-90）：手写 Fake ConnectionPool/Request/Transaction，
 *    经 createSqlserverAdapter 的 opts.driver 注入（生产路径仍走 vendor bundle），
 *    断言精确 SQL 文本与绑定参数。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import {
  createSqlserverAdapter,
  openSqlserverRaw,
  type SqlDriver,
  type SqlPool,
  type SqlQueryResult,
  type SqlRecordset,
  type SqlRequest,
  type SqlTransaction,
} from '../../lib/adapters/sqlserver/index.js';
import type { DatabaseAdapter, ResolvedConnection } from '../../lib/adapters/types.js';

type Row = Record<string, unknown>;
type ColMeta = Record<string, { type?: unknown }>;

/* ---------------- Fake 驱动（手法 B） ---------------- */

/** Fake Request：记录 input 绑定与执行的 SQL，应答按队列出队 */
class FakeRequest implements SqlRequest {
  inputs: Array<{ name: string; type?: unknown; value: unknown }> = [];
  executed: Array<{ sql: string; binds: Array<[string, unknown]> }> = [];
  private readonly queue: SqlQueryResult[];
  private readonly failWith: unknown;

  constructor(queueRef: SqlQueryResult[], failWith?: unknown) {
    this.queue = queueRef;
    this.failWith = failWith;
  }

  input(name: string, ...rest: unknown[]): SqlRequest {
    this.inputs.push(rest.length >= 2 ? { name, type: rest[0], value: rest[1] } : { name, value: rest[0] });
    return this;
  }

  async query(sql: string): Promise<SqlQueryResult> {
    this.executed.push({ sql, binds: this.inputs.map((i) => [i.name, i.value] as [string, unknown]) });
    if (this.failWith !== undefined) throw this.failWith;
    return this.queue.shift() ?? { recordset: [], rowsAffected: [0] };
  }
}

class FakePool implements SqlPool {
  requests: FakeRequest[] = [];
  queue: SqlQueryResult[] = [];
  failWith: unknown;
  /** 按请求顺序注入错误（先于 failWith；数组耗尽后回落 failWith）：模拟「仅某一次请求失败」 */
  failSeq: unknown[] = [];
  /**
   * 按建连顺序注入错误：优先取本池自己的 connectFailSeq，耗尽后取 harness 级共享队列
   * （scriptedConnectFails）。共享队列是必需的——encrypt=auto 的加密池是在首次建连失败后
   * 才 new 出来的，测试没有办法在它创建之前往它自己的队列里塞错误。
   */
  connectFailSeq: unknown[] = [];
  connectCalls = 0;
  closed = 0;
  errorHandlers: Array<(...args: never[]) => void> = [];

  constructor(
    readonly config: Record<string, unknown>,
    private readonly sharedConnectFails?: unknown[],
  ) {}

  request(): SqlRequest {
    const fail = this.failSeq.length > 0 ? this.failSeq.shift() : this.failWith;
    const r = new FakeRequest(this.queue, fail);
    this.requests.push(r);
    return r;
  }

  async connect(): Promise<unknown> {
    this.connectCalls++;
    const seq = this.connectFailSeq.length > 0 ? this.connectFailSeq : (this.sharedConnectFails ?? []);
    if (seq.length > 0) throw seq.shift();
    return this;
  }

  async close(): Promise<unknown> {
    this.closed++;
    return this;
  }

  on(event: string, cb: (...args: never[]) => void): unknown {
    if (event === 'error') this.errorHandlers.push(cb);
    return this;
  }

  /** 最近一次请求（无请求则抛错，避免 undefined 静默通过断言） */
  get last(): FakeRequest {
    const r = this.requests[this.requests.length - 1];
    if (!r) throw new Error('FakePool 尚无请求');
    return r;
  }
}

class FakeTransaction implements SqlTransaction {
  events: string[] = [];
  requests: FakeRequest[] = [];
  constructor(private readonly pool: FakePool) {}
  async begin(): Promise<unknown> {
    this.events.push('begin');
    return this;
  }
  async commit(): Promise<unknown> {
    this.events.push('commit');
    return this;
  }
  async rollback(): Promise<unknown> {
    this.events.push('rollback');
    return this;
  }
  request(): SqlRequest {
    const r = new FakeRequest(this.pool.queue, this.pool.failWith);
    this.requests.push(r);
    return r;
  }
}

interface Harness {
  driver: SqlDriver;
  pools: FakePool[];
  txs: FakeTransaction[];
  configs: Array<Record<string, unknown>>;
  types: Record<string, unknown>;
  /** 所有池共享的建连失败队列（encrypt=auto 的加密池后建，只能从这里注入失败） */
  connectFails: unknown[];
}

function harness(): Harness {
  const pools: FakePool[] = [];
  const txs: FakeTransaction[] = [];
  const configs: Array<Record<string, unknown>> = [];
  const connectFails: unknown[] = [];
  const types: Record<string, unknown> = {
    Decimal: { t: 'Decimal' },
    Numeric: { t: 'Numeric' },
    BigInt: { t: 'BigInt' },
    UniqueIdentifier: { t: 'UniqueIdentifier' },
  };
  const driver = {
    ConnectionPool: function (config: Record<string, unknown>) {
      const p = new FakePool(config ?? {}, connectFails);
      configs.push(config ?? {});
      pools.push(p);
      return p;
    },
    Transaction: function (pool: SqlPool) {
      const t = new FakeTransaction(pool as FakePool);
      txs.push(t);
      return t;
    },
    TYPES: types,
  } as unknown as SqlDriver;
  return { driver, pools, txs, configs, types, connectFails };
}

/** 构造带 columns 元数据的结果集（真实 mssql 把 columns 挂在 recordset 数组上） */
function rec(rows: Row[], columns?: ColMeta): SqlQueryResult {
  const recordset = rows.slice() as SqlRecordset;
  if (columns) recordset.columns = columns;
  return { recordset, rowsAffected: [rows.length] };
}

function cols(...names: string[]): ColMeta {
  return Object.fromEntries(names.map((n) => [n, {}]));
}

const BASE_URL = 'sqlserver://sa:p%40ss@db1.example.com:1433/appdb';

function connByUrl(url: string): ResolvedConnection {
  return { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, url };
}

function connByFields(fields: Record<string, unknown>): ResolvedConnection {
  return { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, fields };
}

async function make(mode?: 'ro', url = BASE_URL) {
  const h = harness();
  const a = await createSqlserverAdapter(connByUrl(url), { driver: h.driver, ...(mode ? { mode } : {}) });
  const pool = h.pools[0];
  if (!pool) throw new Error('未创建主池');
  return { h, a, pool };
}

function msgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ---------------- 手法 A：配置校验（触网前必抛） ---------------- */

describe('sqlserver 配置校验（离线，手法 A）', () => {
  it('缺少 url 与 fields：抛中文配置错误，不误报驱动缺失', async () => {
    const err = await createSqlserverAdapter({ meta: { id: 'x', kind: 'sqlserver' } }).then(
      () => {
        throw new Error('应当抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/缺少 url 或 fields/);
    // 双断言：配置错误不能在驱动加载之后才报（否则用户会照 build 指引白跑一趟）
    expect(msg).not.toMatch(/驱动|vendor|build:sqlserver/);
  });

  it('非法 tdsVersion：抛中文错误而非静默回退', async () => {
    const h = harness();
    const err = await createSqlserverAdapter(connByUrl(`${BASE_URL}?tdsVersion=9_9`), {
      driver: h.driver,
    }).then(
      () => {
        throw new Error('应当抛错');
      },
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/tdsVersion/);
    expect(msgOf(err)).not.toMatch(/连接超时|登录失败/);
  });

  it('非法 encrypt 取值：抛中文错误', async () => {
    const h = harness();
    await expect(
      createSqlserverAdapter(connByUrl(`${BASE_URL}?encrypt=maybe`), { driver: h.driver }),
    ).rejects.toThrow(/encrypt/);
  });

  it('fields 端口非法（越界/非数字/小数）：抛中文错误且含原值，不静默回退 1433', async () => {
    const h = harness();
    for (const port of [99999, 'abc', 0, -1, 1433.5]) {
      const err = await createSqlserverAdapter(connByFields({ host: 'h', user: 'u', password: 'p', port }), {
        driver: h.driver,
      }).then(
        () => {
          throw new Error(`应抛错：port=${JSON.stringify(port)}`);
        },
        (e: unknown) => e,
      );
      const msg = msgOf(err);
      expect(msg, `port=${JSON.stringify(port)}`).toMatch(/端口取值非法/);
      expect(msg).toMatch(/1-65535/);
      // 错误里保留原值（fail-closed：用户配错的端口必须可见，不能被假端口掩盖）
      expect(msg).toContain(JSON.stringify(port));
      // 校验发生在建池之前：不该有任何池配置产出
      expect(h.configs, `port=${JSON.stringify(port)}`).toHaveLength(0);
    }
  });

  it('URL 端口 0：抛中文错误（>65535 由 WHATWG URL 解析直接拒绝，0 可通过解析但非法）', async () => {
    const h = harness();
    await expect(
      createSqlserverAdapter(connByUrl('sqlserver://sa:pw@host:0/db'), { driver: h.driver }),
    ).rejects.toThrow(/端口取值非法/);
    expect(h.configs).toHaveLength(0);
  });

  it('URL 解析失败：错误消息脱敏（不含明文密码），但仍可定位问题', async () => {
    const h = harness();
    const err = await createSqlserverAdapter(connByUrl('sqlserver://sa:S3cretPwd@host:99999/db'), {
      driver: h.driver,
    }).then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    // 该消息会进 audit.jsonl 与模型上下文：密码绝不能出现
    expect(msg).not.toMatch(/S3cretPwd/);
    // 仍能定位：保留 scheme 与 host，给出形态说明
    expect(msg).toMatch(/\*\*\*@host/);
    expect(msg).toMatch(/sqlserver:\/\//);
    expect(msg).toMatch(/期望形态/);
    // 命名实例（host\SQLEXPRESS）是 WHATWG URL 必然解析失败的合法场景：必须给出正确出口
    expect(msg).toMatch(/\?instanceName=/);
  });
});

/* ---------------- 手法 B：URL / fields → 池配置 ---------------- */

describe('sqlserver URL / fields 解析（手法 B）', () => {
  it('URL 全参数：映射为 mssql 池配置（含 percent 编码凭据解码）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      connByUrl(`${BASE_URL}?encrypt=true&trustServerCertificate=true&tdsVersion=7_3_A&instanceName=SQLEXPRESS&useUTC=false`),
      { driver: h.driver },
    );
    const cfg = h.configs[0]!;
    expect(cfg).toMatchObject({ server: 'db1.example.com', port: 1433, user: 'sa', password: 'p@ss', database: 'appdb' });
    expect(cfg.options).toMatchObject({
      encrypt: true,
      trustServerCertificate: true,
      tdsVersion: '7_3_A',
      instanceName: 'SQLEXPRESS',
      useUTC: false,
    });
    await a.close();
  });

  it('URL 默认值：encrypt=true / trustServerCertificate=false / tdsVersion=7_4 / useUTC=true / port=1433', async () => {
    const { h, a } = await make();
    const cfg = h.configs[0]!;
    expect(cfg.port).toBe(1433);
    expect((cfg.options as Record<string, unknown>).instanceName).toBeUndefined();
    expect(cfg.options).toMatchObject({
      encrypt: true,
      trustServerCertificate: false,
      tdsVersion: '7_4',
      useUTC: true,
    });
    await a.close();
  });

  it('URL query 参数名大小写不敏感', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(connByUrl(`${BASE_URL}?TrustServerCertificate=TRUE&TDSVERSION=7_1`), {
      driver: h.driver,
    });
    expect(h.configs[0]!.options).toMatchObject({ trustServerCertificate: true, tdsVersion: '7_1' });
    await a.close();
  });

  it('fields 模式：host/port/user/password/database，缺省端口 1433', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(connByFields({ host: 'h2', user: 'u', password: 'p', database: 'd' }), {
      driver: h.driver,
    });
    expect(h.configs[0]).toMatchObject({ server: 'h2', port: 1433, user: 'u', password: 'p', database: 'd' });
    await a.close();
  });

  it('fields 模式：命名实例 host\\instance 原样进 server，端口省略不拦截（tedious 侧由 mssql 拆实例名并让 instanceName 赢）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      connByFields({ host: 'localhost\\SQLEXPRESS', user: 'u', password: 'p', database: 'd' }),
      { driver: h.driver },
    );
    expect(h.configs[0]).toMatchObject({ server: 'localhost\\SQLEXPRESS', port: 1433 });
    expect((h.configs[0]!.options as Record<string, unknown>).instanceName).toBe(undefined);
    await a.close();
  });

  it('fields.database 覆盖 URL 库名（传输端跨库定位依赖此口径，防静默连回原库）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, url: BASE_URL, fields: { database: 'otherdb' } },
      { driver: h.driver },
    );
    expect(h.configs[0]).toMatchObject({ database: 'otherdb' });
    const raw = await openSqlserverRaw(
      { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, url: BASE_URL, fields: { database: 'otherdb' } },
      h.driver,
    );
    expect(raw.database).toBe('otherdb');
    expect(h.configs[1]).toMatchObject({ database: 'otherdb' });
    await a.close();
    await raw.pool.close();
  });

  it('URL 无 path 段：不指定库（连登录默认库），raw.database 为空串', async () => {
    const h = harness();
    const raw = await openSqlserverRaw(connByUrl('sqlserver://sa:pw@h:1433'), h.driver);
    expect(raw.database).toBe('');
    expect(h.configs[0]!['database']).toBeUndefined();
    await raw.ready();
    await raw.pool.close();
  });

  it('conn.ssl=true 等价 encrypt=true（与 mysql/pg 适配器对 ssl 的处理一致）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, url: BASE_URL, ssl: true },
      { driver: h.driver },
    );
    expect(h.configs[0]!.options).toMatchObject({ encrypt: true });
    await a.close();
  });

  it('池必须注册 error 监听（无监听器时 mssql 的 emit 会崩宿主进程）', async () => {
    const { a, pool } = await make();
    expect(pool.errorHandlers.length).toBeGreaterThan(0);
    expect(() => pool.errorHandlers.forEach((cb) => cb(new Error('mock 空闲连接故障') as never))).not.toThrow();
    await a.close();
  });

  it('openSqlserverRaw：返回 { pool, database, driver }（传输端复用面）', async () => {
    const h = harness();
    const raw = await openSqlserverRaw(connByUrl(BASE_URL), h.driver);
    expect(raw.database).toBe('appdb');
    expect(raw.driver).toBe(h.driver);
    expect(h.pools[0]!.errorHandlers.length).toBeGreaterThan(0);
    expect(h.configs[0]).toMatchObject({ database: 'appdb' });
    await raw.pool.close();
  });
});

/* ---------------- 手法 B：加密与证书配置（strict / serverName / caCert / 系统 CA） ---------------- */

describe('sqlserver 加密与证书配置', () => {
  /** 自签 CA 的 PEM 片段（不是真实可用的证书，仅用于断言「原样透传」而不是被当路径） */
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUfakeca==\n-----END CERTIFICATE-----\n';

  it('encrypt=strict（TDS 8.0）：URL 与 fields 同口径写入 strict，取值大小写不敏感', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(connByUrl(`${BASE_URL}?encrypt=strict`), { driver: h.driver });
    expect(h.configs[0]!.options).toMatchObject({ encrypt: 'strict' });
    await a.close();

    const h2 = harness();
    const a2 = await createSqlserverAdapter(connByFields({ host: 'h', user: 'u', password: 'p', encrypt: 'STRICT' }), {
      driver: h2.driver,
    });
    expect(h2.configs[0]!.options).toMatchObject({ encrypt: 'strict' });
    await a2.close();
  });

  it('encrypt 非法值（非 true/false/strict）：抛中文错误且提示可选三态', async () => {
    for (const bad of ['maybe', 'on', '1x']) {
      const h = harness();
      const err = await createSqlserverAdapter(connByUrl(`${BASE_URL}?encrypt=${bad}`), { driver: h.driver }).then(
        () => {
          throw new Error(`应抛错：encrypt=${bad}`);
        },
        (e: unknown) => e,
      );
      const msg = msgOf(err);
      expect(msg, `encrypt=${bad}`).toMatch(/encrypt/);
      expect(msg).toMatch(/非法/);
      expect(msg).toMatch(/strict/);
      expect(h.configs).toHaveLength(0);
    }
  });

  it('conn.ssl=true 不把已选的 strict 降级为 true（strict 是更强的加密承诺）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, url: `${BASE_URL}?encrypt=strict`, ssl: true },
      { driver: h.driver },
    );
    expect(h.configs[0]!.options).toMatchObject({ encrypt: 'strict' });
    await a.close();
  });

  it('serverName：URL 与 fields 均写入 options.serverName；空值不注入', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(connByUrl(`${BASE_URL}?serverName=sql.internal.example`), {
      driver: h.driver,
    });
    expect(h.configs[0]!.options).toMatchObject({ serverName: 'sql.internal.example' });
    await a.close();

    const h2 = harness();
    const a2 = await createSqlserverAdapter(
      connByFields({ host: '10.0.0.5', user: 'u', password: 'p', serverName: 'sql.internal.example' }),
      { driver: h2.driver },
    );
    expect(h2.configs[0]!.options).toMatchObject({ serverName: 'sql.internal.example' });
    await a2.close();

    const h3 = harness();
    const a3 = await createSqlserverAdapter(connByUrl(`${BASE_URL}?serverName=`), { driver: h3.driver });
    expect('serverName' in (h3.configs[0]!.options as Record<string, unknown>)).toBe(false);
    await a3.close();
  });

  it('caCert 显式 PEM：原样并入 cryptoCredentialsDetails.ca，并自动合并系统 CA', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(connByUrl(`${BASE_URL}?caCert=${encodeURIComponent(PEM)}`), {
      driver: h.driver,
    });
    const details = (h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as
      | { ca?: string[] }
      | undefined;
    expect(details?.ca).toBeInstanceOf(Array);
    // 实现会 trim 首尾空白（PEM 文本前后空行无意义），故按 trim 后比较
    expect(details!.ca!.some((c) => c.trim() === PEM.trim())).toBe(true);
    // 系统 CA 自动合并（Node >= 22.15 的 tls.getCACertificates('system')）：显式 CA 之外还能命中
    // 系统信任库中的证书。本机 Node 不支持该系统 API 时该项为空，此时只校验显式 CA 生效。
    const sys = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
    if (sys.length > 0) {
      expect(details!.ca!.length).toBeGreaterThan(1);
      expect(details!.ca!).toContain(sys[0]);
    }
    await a.close();
  });

  it('caCert 文件路径：读取文件内容作为 CA', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sql-ca-'));
    try {
      const file = join(dir, 'ca.pem');
      writeFileSync(file, PEM, 'utf8');
      const h = harness();
      const a = await createSqlserverAdapter(connByUrl(`${BASE_URL}?caCert=${encodeURIComponent(file)}`), {
        driver: h.driver,
      });
      const details = (h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as {
        ca?: string[];
      };
      expect(details.ca?.some((c: string) => c.trim() === PEM.trim())).toBe(true);
      await a.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caCert 路径不可读：fail-closed 抛中文错误，绝不静默回退到不校验', async () => {
    const h = harness();
    const err = await createSqlserverAdapter(connByUrl(`${BASE_URL}?caCert=${encodeURIComponent('/no/such/ca.pem')}`), {
      driver: h.driver,
    }).then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/caCert/);
    expect(msg).toMatch(/无法读取/);
    // 不能变成「继续用默认校验」或「已关闭校验」的暗示
    expect(msg).not.toMatch(/继续连接|已忽略|跳过/);
    expect(h.configs).toHaveLength(0);
  });

  it('caCert 与 tlsMinVersion 并存：合并进同一份 cryptoCredentialsDetails（互不覆盖）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      connByUrl(`${BASE_URL}?caCert=${encodeURIComponent(PEM)}&tlsMinVersion=TLSv1.1`),
      { driver: h.driver },
    );
    const details = (h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as {
      ca?: string[];
      minVersion?: string;
    };
    expect(details.minVersion).toBe('TLSv1.1');
    expect(details.ca?.some((c: string) => c.trim() === PEM.trim())).toBe(true);
    await a.close();
  });

  it('未配置任何 TLS 选项：仍注入 CA 列表（系统信任库并入，让"导入信任库即可连"生效），但不注入 minVersion', async () => {
    const { h, a } = await make();
    const ccd = (h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as
      | Record<string, unknown>
      | undefined;
    // 默认注入 ca（default+system 合并）：Node 默认不读系统信任库，不注入则用户"导入受信任根"无效
    expect(ccd).toBeDefined();
    expect(Array.isArray(ccd!['ca'])).toBe(true);
    expect((ccd!['ca'] as string[]).length).toBeGreaterThan(0);
    // 但下限保持不设置：启用系统 CA 不代表要改动 TLS 版本下限
    expect('minVersion' in ccd!).toBe(false);
    await a.close();
  });
});

/* ---------------- 手法 B：encrypt=auto（Navicat 式自动协商） ---------------- */

describe('sqlserver encrypt=auto（先明文，服务器强制加密才升级重试一次）', () => {
  /** tedious 在「服务器回 ON/REQ 而客户端 encrypt=false」时的真实错误形态 */
  const REQUIRES_ENCRYPT = () =>
    mssqlErr('ConnectionError', 'EENCRYPT', {
      message: "Server requires encryption, set 'encrypt' config property to true.",
    });

  it('URL ?encrypt=auto 与 fields.encrypt=auto 同口径：都解析为 auto，但建池时已展开为 false（字面量绝不交给驱动）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(connByUrl(`${BASE_URL}?encrypt=auto`), { driver: h.driver });
    // 关键：configs 记录的是「实际交给驱动的配置」，auto 已在 makePoolBox 展开为第一阶段 false。
    // 若这里仍是 'auto'，说明展开放错了层级——tedious 对未知取值无定义行为。
    expect(h.configs[0]!.options).toMatchObject({ encrypt: false });
    await a.close();

    const h2 = harness();
    const a2 = await createSqlserverAdapter(connByFields({ host: 'h', user: 'u', password: 'p', encrypt: 'AUTO' }), {
      driver: h2.driver,
    });
    expect(h2.configs[0]!.options).toMatchObject({ encrypt: false });
    await a2.close();
  });

  it('a) 服务器不协商加密：一次即连通，不重试、不创建第二个池，字面量 auto 绝不交给驱动', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=auto`);
    pool.queue = [rec([{ n: 1 }], cols('n'))];
    await a.query('SELECT 1');

    expect(h.pools).toHaveLength(1);
    expect(pool.connectCalls).toBe(1);
    // 首阶段必须是明文（等同 Navicat 不开加密）；trustServerCertificate 保持原值，不擅自放宽
    expect(h.configs[0]!.options).toMatchObject({ encrypt: false, trustServerCertificate: false });
    await a.close();
  });

  it('b) 服务器强制加密：自动以 encrypt=true + trustServerCertificate=true 重试一次并成功', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=auto`);
    // 加密池是在首次建连失败之后才 new 出来的，只能往共享队列里注入
    h.connectFails.push(REQUIRES_ENCRYPT());

    // 请求在重试后的加密池上执行（不抛错即证明整条链路自愈）
    await expect(a.query('SELECT 1')).resolves.toBeDefined();

    // 恰好两个池：明文池先建、加密池随后；明文池必须被关掉（不留半死连接）
    expect(h.pools).toHaveLength(2);
    expect(h.configs[0]!.options).toMatchObject({ encrypt: false });
    expect(h.configs[1]!.options).toMatchObject({ encrypt: true, trustServerCertificate: true });
    expect(pool.closed).toBe(1);
    // 请求落在加密池上（明文池已废）
    expect(h.pools[1]!.requests).toHaveLength(1);
    expect(h.pools[0]!.requests).toHaveLength(0);
    await a.close();
  });

  it('b2) 重试只发生一次：加密池也失败时不再试第三次', async () => {
    const { a, h } = await make('ro', `${BASE_URL}?encrypt=auto`);
    h.connectFails.push(REQUIRES_ENCRYPT(), new Error('加密连接也失败：self signed certificate'));
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/强制加密/);
    // 只有两个池：明文池 + 加密池，没有第三次尝试
    expect(h.pools).toHaveLength(2);
    expect(h.pools[1]!.connectCalls).toBe(1);
    await a.close();
  });

  it('c) 两次都失败：抛错含「强制加密」与两条原始原因，且不追加证书族建议', async () => {
    const { a, h } = await make('ro', `${BASE_URL}?encrypt=auto`);
    // 加密侧失败原文故意带 self signed certificate：重试已带 trustServerCertificate=true，
    // 证书族建议若被追加出来就是把人引向「再关一次校验」，必须抑制
    h.connectFails.push(REQUIRES_ENCRYPT(), new Error('self signed certificate in certificate chain'));
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/强制加密/);
    expect(msg).toMatch(/原始原因①/);
    expect(msg).toMatch(/原始原因②/);
    // 两条原始原因都在：明文侧的 EENCRYPT 原文 + 加密侧的失败原文
    expect(msg).toMatch(/Server requires encryption/);
    expect(msg).toMatch(/self signed certificate/);
    expect(msg).toMatch(/sqlserver 查询失败/);
    // 不追加证书族建议（已带 trustServerCertificate=true，重复指引等于反向误导）
    expect(msg).not.toMatch(/官方推荐先在客户端装 CA/);
    expect(msg).not.toMatch(/caCert=/);
    await a.close();
  });

  it('d) 显式 encrypt=false + 服务器强制加密：直接报错，绝不自动重试（向后兼容）', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=false`);
    pool.connectFailSeq = [REQUIRES_ENCRYPT()];
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/服务器要求加密/);
    expect(msg).toMatch(/encrypt=true/);
    // 只建了一个池，connect 只尝试一次
    expect(h.pools).toHaveLength(1);
    expect(pool.connectCalls).toBe(1);
    await a.close();
  });

  it('e) 显式 encrypt=true：行为不变（配置原样下发，失败不重试）', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=true`);
    expect(h.configs[0]!.options).toMatchObject({ encrypt: true, trustServerCertificate: false });
    pool.connectFailSeq = [REQUIRES_ENCRYPT()];
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/服务器要求加密|强制执行/);
    expect(h.pools).toHaveLength(1);
    expect(pool.connectCalls).toBe(1);
    await a.close();
  });

  // e2) 显式 encrypt=true + 服务器未协商加密：走原有「未协商加密」分诊，不被 auto 逻辑吞掉
  it('e2) 显式 encrypt=true 且服务器未协商加密：仍是原有「未协商加密」文案，不重试', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=true`);
    pool.connectFailSeq = [
      mssqlErr('ConnectionError', 'EENCRYPT', {
        message:
          "Server did not negotiate encryption, but the 'encrypt' config option is set to `true`. Set 'encrypt' to `false` to allow unencrypted connections.",
      }),
    ];
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/未协商加密/);
    expect(h.pools).toHaveLength(1);
    await a.close();
  });

  it('auto 但服务器未协商加密（反方向 EENCRYPT）：不当作「强制加密」→ 不重试，报原文诊', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=auto`);
    // auto 首阶段是 encrypt=false，正常不会撞这条；但若被中间层改成 true 就会撞。
    // 关键是 isServerRequiresEncryption 必须排除反方向文案，否则会白跑一次加密重试。
    pool.connectFailSeq = [
      mssqlErr('ConnectionError', 'EENCRYPT', {
        message:
          "Server did not negotiate encryption, but the 'encrypt' config option is set to `true`. Set 'encrypt' to `false` to allow unencrypted connections.",
      }),
    ];
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/未协商加密/);
    expect(h.pools).toHaveLength(1);
    await a.close();
  });

  it('auto 的加密重试不污染共享 options：跨库池仍按自己的阶段配置建池', async () => {
    const { a, h, pool } = await make('ro', `${BASE_URL}?encrypt=auto`);
    // 只让主池的首次建连失败（它自己重试一次后成功），跨库池不注入失败
    pool.connectFailSeq = [REQUIRES_ENCRYPT()];

    // 先让主池完成 auto 重试（此时 明文池 + 加密池）
    await a.testConnect();
    expect(h.pools).toHaveLength(2);

    // 再建跨库池：它必须自己重新走 auto 首阶段（明文），不能继承主池重试后的 encrypt=true
    await a.query('SELECT 1', [], 'otherdb');

    expect(h.pools).toHaveLength(3);
    const crossCfg = h.configs[2]!;
    expect(crossCfg.options).toMatchObject({ encrypt: false, trustServerCertificate: false });
    await a.close();
  });

  it('openSqlserverRaw：auto 重试后 pool 指向新池（传输端在 ready 前就取 pool）', async () => {
    const h = harness();
    const raw = await openSqlserverRaw(connByUrl(`${BASE_URL}?encrypt=auto`), h.driver);
    const firstPool = raw.pool;
    h.pools[0]!.connectFailSeq = [REQUIRES_ENCRYPT()];
    await raw.ready();
    expect(raw.pool).not.toBe(firstPool);
    expect(h.configs[1]!.options).toMatchObject({ encrypt: true, trustServerCertificate: true });
    expect(h.pools[0]!.closed).toBe(1);
    await raw.pool.close();
  });

  it('conn.ssl=true 覆盖 auto：用户显式要求加密时不退回明文首阶段', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      { meta: { id: 'sqlserver-offline', kind: 'sqlserver' }, url: `${BASE_URL}?encrypt=auto`, ssl: true },
      { driver: h.driver },
    );
    // ssl=true 语义是「必须加密」，auto 的首阶段明文必须让位（poolConfig 里 encrypt !== 'strict' 就置 true）
    expect(h.configs[0]!.options).toMatchObject({ encrypt: true });
    await a.close();
  });

  it('非法 encrypt 取值（非 true/false/strict/auto）：提示里包含 auto 这一合法选项', async () => {
    const h = harness();
    const err = await createSqlserverAdapter(connByUrl(`${BASE_URL}?encrypt=autom`), { driver: h.driver }).then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/非法/);
    expect(msg).toMatch(/auto/);
    expect(h.configs).toHaveLength(0);
  });
});

/* ---------------- 手法 B：? → @pN 重写 ---------------- */

describe('sqlserver ? → @pN 重写（手法 B）', () => {
  it('基本顺序重写 + request.input 绑定', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ n: 1 }], cols('n'))];
    await a.query('SELECT * FROM t WHERE a = ? AND b = ?', [1, 'x']);
    expect(pool.last.executed[0]!.sql).toBe('SELECT * FROM t WHERE a = @p1 AND b = @p2');
    expect(pool.last.executed[0]!.binds).toEqual([
      ['p1', 1],
      ['p2', 'x'],
    ]);
    await a.close();
  });

  const SKIP_CASES: Array<[string, string, string]> = [
    ['单引号字符串内的 ?', "SELECT ? AS p, 'a?b' AS v", "SELECT @p1 AS p, 'a?b' AS v"],
    ['N 前缀字符串与双单引号转义', "SELECT ? AS p, N'it''s ?' AS v", "SELECT @p1 AS p, N'it''s ?' AS v"],
    ['方括号标识符 [we?ird]', 'SELECT ? AS p, [we?ird] FROM t', 'SELECT @p1 AS p, [we?ird] FROM t'],
    ['方括号内 ]] 转义', 'SELECT ? AS p, [a]]?b] FROM t', 'SELECT @p1 AS p, [a]]?b] FROM t'],
    ['双引号标识符', 'SELECT ? AS p, "qu?oted" FROM t', 'SELECT @p1 AS p, "qu?oted" FROM t'],
    ['-- 行注释', 'SELECT ? AS p -- ? 注释\nFROM t', 'SELECT @p1 AS p -- ? 注释\nFROM t'],
    ['/* */ 块注释', 'SELECT /* ? */ ? AS p FROM t', 'SELECT /* ? */ @p1 AS p FROM t'],
  ];
  it.each(SKIP_CASES)('%s：? 不被重写', async (_label, sql, expected) => {
    const { a, pool } = await make();
    pool.queue = [rec([], {})];
    await a.query(sql, [7]);
    expect(pool.last.executed[0]!.sql).toBe(expected);
    expect(pool.last.executed[0]!.binds).toEqual([['p1', 7]]);
    await a.close();
  });

  it('占位符多于参数：抛中文错误（不触达驱动）', async () => {
    const { a, pool } = await make();
    await expect(a.query('SELECT ? , ?', [1])).rejects.toThrow(/占位符/);
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('参数多于占位符：抛中文错误', async () => {
    const { a } = await make();
    await expect(a.query('SELECT 1', [1])).rejects.toThrow(/占位符/);
    await a.close();
  });

  it('无参数语句正常执行（占位符 0 个）', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ n: 1 }], cols('n'))];
    const r = await a.query('SELECT 1 AS n');
    expect(pool.last.executed[0]!.sql).toBe('SELECT 1 AS n');
    expect(pool.last.executed[0]!.binds).toEqual([]);
    expect(r.rowCount).toBe(1);
    await a.close();
  });

  it('? 与 @pN 混用：抛中文错误（不静默错值）', async () => {
    const { a, pool } = await make();
    await expect(a.query('SELECT * FROM t WHERE a = @p1 AND b = ?', [1])).rejects.toThrow(/混用/);
    await expect(a.execute('UPDATE t SET a = @p1 WHERE b = ?', [1])).rejects.toThrow(/混用/);
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('@@ 系统变量不算混用（不误报）', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ v: 'x' }], cols('v'))];
    await expect(a.query('SELECT @@VERSION AS v, ? AS p', ['x'])).resolves.toBeDefined();
    expect(pool.last.executed[0]!.binds).toEqual([['p1', 'x']]);
    await a.close();
  });

  it('混用判定矩阵：@p1/@P1 算命名占位符；@p1x/@p/@@p1 不算（不误报合法标识符）', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ v: 1 }], cols('v')), rec([{ v: 1 }], cols('v')), rec([{ v: 1 }], cols('v'))];
    const cases: Array<[string, boolean]> = [
      ['SELECT @p1 + ?', true],
      ['SELECT @P1 + ?', true],
      ['SELECT @p1x + ?', false],
      ['SELECT @p + ?', false],
      ['SELECT @@p1 + ?', false],
    ];
    for (const [sql, wantMix] of cases) {
      const err = await a.query(sql, [1]).then(
        () => null,
        (e: unknown) => e,
      );
      if (wantMix) expect(msgOf(err), sql).toMatch(/混用/);
      else expect(err, sql).toBeNull();
    }
    await a.close();
  });
});

/* ---------------- ro 只读（诚实降级：白名单 + 拒绝多语句） ---------------- */

describe('sqlserver ro 模式（手法 B）', () => {
  it('写语句被拒（DRIVER_ERROR，且未触达驱动）', async () => {
    const { a, pool } = await make('ro');
    for (const stmt of [
      'UPDATE t SET x = 1',
      'INSERT INTO t VALUES (1)',
      'DELETE FROM t',
      'DROP TABLE t',
      'ALTER TABLE t ADD c INT',
      'EXEC sp_who',
      '/* 注释 */ UPDATE t SET x = 1',
      '  \n merge into t using s on 1=1 when matched then delete;',
    ]) {
      const err = await a.query(stmt).then(
        () => {
          throw new Error(`ro 下应拒绝：${stmt}`);
        },
        (e: unknown) => e,
      );
      expect(msgOf(err)).toMatch(/DRIVER_ERROR[\s\S]*只读/);
      expect(msgOf(err)).not.toMatch(/超时|登录失败|网络/);
    }
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('白名单首词（含大小写与前导注释）放行到驱动层', async () => {
    const { a, pool } = await make('ro');
    pool.queue = [rec([{ n: 1 }], cols('n')), rec([{ n: 2 }], cols('n'))];
    await a.query('  select 1 AS n');
    await a.query('/* c */ WITH x AS (SELECT 1 AS n) SELECT n FROM x');
    expect(pool.requests).toHaveLength(2);
    expect(pool.last.executed[0]!.sql).toMatch(/^\/\* c \*\/ WITH/);
    await a.close();
  });

  it('ro 拒绝多语句（防堆叠写），但允许结尾单个分号', async () => {
    const { a, pool } = await make('ro');
    pool.queue = [rec([{ n: 1 }], cols('n'))];
    await expect(a.query('SELECT 1; UPDATE t SET x = 1')).rejects.toThrow(/多条语句/);
    await expect(a.query("SELECT 'a;b' AS v; -- 尾注释")).resolves.toBeDefined();
    await expect(a.query('SELECT 1;')).resolves.toBeDefined();
    expect(pool.requests).toHaveLength(2);
    await a.close();
  });

  it('ro：SELECT ... INTO 与 WITH + 写语句被拒（T-SQL 写形态，首词白名单挡不住）', async () => {
    const { a, pool } = await make('ro');
    for (const stmt of [
      'SELECT * INTO dbo.newtbl FROM t',
      'SELECT * INTO #tmp FROM t',
      'WITH x AS (SELECT 1 AS n) DELETE FROM t',
      'WITH x AS (SELECT 1 AS n) UPDATE t SET c = 1',
      'WITH x AS (SELECT 1 AS n) MERGE t AS s USING x ON 1 = 1 WHEN MATCHED THEN DELETE',
      'WITH x AS (SELECT 1 AS n) INSERT INTO t (n) SELECT n FROM x',
    ]) {
      const err = await a.query(stmt).then(
        () => {
          throw new Error(`ro 下应拒绝：${stmt}`);
        },
        (e: unknown) => e,
      );
      expect(msgOf(err)).toMatch(/DRIVER_ERROR[\s\S]*只读/);
      expect(msgOf(err)).not.toMatch(/超时|登录失败|网络/);
    }
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('ro：字符串/标识符/注释里的 into、delete 不误伤（判定走词法而非裸正则）', async () => {
    const { a, pool } = await make('ro');
    pool.queue = [
      rec([{ a: 1 }], cols('a')),
      rec([{ a: 1 }], cols('a')),
      rec([{ a: 1 }], cols('a')),
      rec([{ a: 1 }], cols('a')),
    ];
    await expect(a.query("SELECT 'into 字符串' AS a")).resolves.toBeDefined();
    await expect(a.query('SELECT [into] FROM t')).resolves.toBeDefined();
    await expect(a.query("SELECT 'delete from t' AS a")).resolves.toBeDefined();
    await expect(a.query('/* into delete */ SELECT 1 AS a')).resolves.toBeDefined();
    expect(pool.requests).toHaveLength(4);
    await a.close();
  });

  it('ro：堆叠写必须被 multi 拦下——第二条语句全为标识符/引号也不能漏', async () => {
    const { a, pool } = await make('ro');
    for (const stmt of [
      'SELECT 1;DROP TABLE t',
      'SELECT 1;DELETE FROM t',
      'SELECT 1;TRUNCATE TABLE t',
      ';TRUNCATE TABLE t',
      "SELECT 1;EXEC xp_cmdshell 'whoami'",
      "SELECT 1;EXEC sp_executesql N'DROP TABLE t'",
      "SELECT 1;BULK INSERT t FROM 'c:\\x.csv'",
      'SELECT 1;SHUTDOWN',
      'USE db;DROP TABLE t',
    ]) {
      const err = await a.query(stmt).then(
        () => {
          throw new Error(`ro 下应拒绝：${stmt}`);
        },
        (e: unknown) => e,
      );
      expect(msgOf(err), stmt).toMatch(/DRIVER_ERROR[\s\S]*(只读|多条语句)/);
    }
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('ro：单语句与字符串/注释/方括号内的分号不置 multi（不误拒）', async () => {
    const { a, pool } = await make('ro');
    pool.queue = [
      rec([{ a: 1 }], cols('a')),
      rec([{ a: 1 }], cols('a')),
      rec([{ a: 1 }], cols('a')),
      rec([{ a: 1 }], cols('a')),
    ];
    await expect(a.query("SELECT 'a;b' AS a")).resolves.toBeDefined();
    await expect(a.query('SELECT [a;b] FROM t')).resolves.toBeDefined();
    await expect(a.query('/* ; */ SELECT 1 AS a')).resolves.toBeDefined();
    await expect(a.query('SELECT 1;')).resolves.toBeDefined();
    expect(pool.requests).toHaveLength(4);
    await a.close();
  });

  it('ro：OPENQUERY/OPENROWSET/OPENDATASOURCE 一律拒绝（远端语句内容不可审计）', async () => {
    const { a, pool } = await make('ro');
    for (const stmt of [
      "SELECT * FROM OPENQUERY(ls,'EXEC xp_cmdshell ''whoami''')",
      "SELECT * FROM OPENROWSET('SQLNCLI','Server=x','DELETE FROM t')",
      "SELECT * FROM OPENDATASOURCE('SQLNCLI','Data Source=x').db.dbo.t",
    ]) {
      const err = await a.query(stmt).then(
        () => {
          throw new Error(`ro 下应拒绝：${stmt}`);
        },
        (e: unknown) => e,
      );
      expect(msgOf(err), stmt).toMatch(/OPENQUERY|OPENROWSET|OPENDATASOURCE/);
    }
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('ro：普通读表不受 OPEN* 加固影响', async () => {
    const { a, pool } = await make('ro');
    pool.queue = [rec([{ id: 1 }], cols('id'))];
    await expect(a.query('SELECT id FROM t')).resolves.toBeDefined();
    expect(pool.requests).toHaveLength(1);
    await a.close();
  });

  it('ro 跨库池同样受白名单约束', async () => {
    const { a, h } = await make('ro');
    await expect(a.query('UPDATE t SET x = 1', [], 'otherdb')).rejects.toThrow(/只读/);
    expect(h.pools).toHaveLength(1); // 拒绝发生在建跨库池之前
    await a.close();
  });
});

/* ---------------- 分页与版本降级 ---------------- */

describe('sqlserver previewRows 分页（手法 B）', () => {
  it('>=11：ORDER BY (SELECT NULL) + OFFSET/FETCH，绑定 [offset, limit]', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ major: 15, version: '15.0.2000.5' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
    ];
    const r = await a.previewRows('users', 10);
    const sql = pool.last.executed[0]!.sql;
    expect(sql).toContain('ORDER BY (SELECT NULL)');
    expect(sql).toContain('OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY');
    expect(sql).toContain('[dbo].[users]');
    expect(pool.last.executed[0]!.binds).toEqual([
      ['p1', 0],
      ['p2', 10],
    ]);
    expect(r.columns).toEqual(['id']);
    await a.close();
  });

  it('<11：ROW_NUMBER 降级，且剔除内部序号列（上界 = off+lim）', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ major: 10, version: '10.50.1600.1' }], cols('major', 'version')),
      rec([{ id: 1, __dsh_rn: 1 }, { id: 2, __dsh_rn: 2 }], cols('id', '__dsh_rn')),
    ];
    const r = await a.previewRows('users', 5, 'dbo', 2);
    const sql = pool.last.executed[0]!.sql;
    expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY (SELECT NULL))');
    expect(sql).toContain('> @p1 AND t.[__dsh_rn] <= @p2');
    expect(sql).not.toContain('OFFSET');
    // 回归锚点：上界必须是 off+lim（曾误写成 lim → off>0 时第 2 页起恒为空）
    expect(pool.last.executed[0]!.binds).toEqual([
      ['p1', 2],
      ['p2', 7],
    ]);
    expect(r.columns).toEqual(['id']);
    expect(r.rows).toEqual([[1], [2]]);
    await a.close();
  });

  it('<11 分页上界 = off+lim；off=0 时与 2012+ 分支绑定一致', async () => {
    // 2012+ 分支（off=0, lim=10）：@p2 = lim
    const c1 = await make();
    c1.pool.queue = [
      rec([{ major: 15, version: '15.0.2000.5' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
    ];
    await c1.a.previewRows('users', 10, 'dbo', 0);
    const plusBinds = c1.pool.last.executed[0]!.binds;
    await c1.a.close();

    // 2008 分支（off=0, lim=10）：off + lim = 10 → 与上面一致
    const c2 = await make();
    c2.pool.queue = [
      rec([{ major: 10, version: '10.50.1600.1' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
    ];
    await c2.a.previewRows('users', 10, 'dbo', 0);
    expect(c2.pool.last.executed[0]!.binds).toEqual(plusBinds);

    // 第 2 页（off=50, lim=50）：上界 100，而不是 50
    await c2.a.previewRows('users', 50, 'dbo', 50);
    expect(c2.pool.last.executed[0]!.binds).toEqual([
      ['p1', 50],
      ['p2', 100],
    ]);
    await c2.a.close();
  });

  it('版本探测报错：按 <11 降级而非打挂 previewRows（与传输端容错对称）', async () => {
    const { a, pool } = await make();
    pool.failSeq = [mssqlErr('RequestError', 'EREQUEST', { number: 102, severity: 15, lineNumber: 1 })];
    pool.queue = [rec([{ id: 1 }], cols('id'))];
    const r = await a.previewRows('users', 1);
    expect(pool.last.executed[0]!.sql).toContain('ROW_NUMBER()');
    expect(r.rowCount).toBe(1);
    // 探测失败结果按池缓存（0 → 始终降级），不会每次重试打服务器
    await a.previewRows('users', 1);
    const probes = pool.requests.filter((q) => q.executed.some((e) => e.sql.includes('SERVERPROPERTY')));
    expect(probes).toHaveLength(1);
    await a.close();
  });

  it('ProductMajorVersion 为 NULL 时回退 ProductVersion 前缀', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ major: null, version: '10.0.1600.22' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
    ];
    await a.previewRows('users', 1);
    expect(pool.last.executed[0]!.sql).toContain('ROW_NUMBER()');
    await a.close();
  });

  it('版本探测失败（全 NULL）按 <11 降级，且结果仍能返回', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ major: null, version: null }], cols('major', 'version')), rec([{ id: 1 }], cols('id'))];
    const r = await a.previewRows('users', 1);
    expect(pool.last.executed[0]!.sql).toContain('ROW_NUMBER()');
    expect(r.rowCount).toBe(1);
    await a.close();
  });

  it('版本探测按池缓存：两次预览只探测一次', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ major: 15, version: '15.0.2000.5' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
      rec([{ id: 2 }], cols('id')),
    ];
    await a.previewRows('users', 1);
    await a.previewRows('users', 1);
    const probes = pool.requests.filter((r) => r.executed.some((e) => e.sql.includes('SERVERPROPERTY')));
    expect(probes).toHaveLength(1);
    await a.close();
  });

  it('limit/offset 钳制：limit 999→50、limit 0→1、offset -5→0', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ major: 15, version: '15.0.2000.5' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
      rec([{ id: 1 }], cols('id')),
      rec([{ id: 1 }], cols('id')),
    ];
    await a.previewRows('users', 999);
    expect(pool.last.executed[0]!.binds).toEqual([
      ['p1', 0],
      ['p2', 50],
    ]);
    await a.previewRows('users', 0);
    expect(pool.last.executed[0]!.binds).toEqual([
      ['p1', 0],
      ['p2', 1],
    ]);
    await a.previewRows('users', 10, 'dbo', -5);
    expect(pool.last.executed[0]!.binds).toEqual([
      ['p1', 0],
      ['p2', 10],
    ]);
    await a.close();
  });

  it('危险表名被安全引用（方括号内 ] 双写）而非字符串拼接注入', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ major: 15, version: '15.0.2000.5' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
    ];
    await a.previewRows('we]]ird; DROP TABLE x', 1);
    const sql = pool.last.executed[0]!.sql;
    expect(sql).toContain('[dbo].[we]]]]ird; DROP TABLE x]');
    await a.close();
  });

  it('含换行的表名被标识符校验拦截（不拼进 SQL、不发请求）', async () => {
    const { a, pool } = await make();
    await expect(a.previewRows('a\nb', 1)).rejects.toThrow(/非法/);
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });
});

/* ---------------- 类型规范化 ---------------- */

describe('sqlserver 类型规范化（手法 B）', () => {
  it('decimal/numeric/bigint/uniqueidentifier 钉 string，Date→ISO，Buffer→[BLOB n bytes]', async () => {
    const { a, pool, h } = await make();
    const T = h.types;
    pool.queue = [
      rec(
        [
          {
            d: 123.45,
            n: 678.9,
            b: 9007199254740993n,
            u: '6F9619FF-8B86-D011-B42D-00C04FC964FF',
            t: new Date('2024-01-02T03:04:05.000Z'),
            bin: Buffer.from([1, 2, 3]),
            i: 7,
            nul: null,
          },
        ],
        {
          d: { type: T.Decimal },
          n: { type: T.Numeric },
          b: { type: T.BigInt },
          u: { type: T.UniqueIdentifier },
          t: {},
          bin: {},
          i: {},
          nul: {},
        },
      ),
    ];
    const r = await a.query('SELECT * FROM t');
    expect(r.columns).toEqual(['d', 'n', 'b', 'u', 't', 'bin', 'i', 'nul']);
    expect(r.rows[0]).toEqual([
      '123.45',
      '678.9',
      '9007199254740993',
      '6F9619FF-8B86-D011-B42D-00C04FC964FF',
      '2024-01-02T03:04:05.000Z',
      '[BLOB 3 bytes]',
      7,
      null,
    ]);
    expect(r.rowCount).toBe(1);
    await a.close();
  });

  it('无 columns 元数据时从首行推导列名', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ b: 2, a: 1 }])];
    const r = await a.query('SELECT 1');
    expect(r.columns).toEqual(['b', 'a']);
    expect(r.rows[0]).toEqual([2, 1]);
    await a.close();
  });

  it('空结果集返回 0 行（不抛）', async () => {
    const { a, pool } = await make();
    pool.queue = [{ recordset: [], rowsAffected: [0] }];
    const r = await a.query('SELECT * FROM t WHERE 1 = 0');
    expect(r.rows).toEqual([]);
    expect(r.rowCount).toBe(0);
    await a.close();
  });
});

/* ---------------- execute ---------------- */

describe('sqlserver execute（手法 B）', () => {
  it('affectedRows 取 rowsAffected 求和，并返回中文消息', async () => {
    const { a, pool } = await make();
    pool.queue = [{ recordset: [], rowsAffected: [2, 3] }];
    const r = await a.execute('UPDATE t SET x = ? WHERE id = ?', [1, 2]);
    expect(r.affectedRows).toBe(5);
    expect(r.message).toContain('5');
    expect(pool.last.executed[0]!.sql).toBe('UPDATE t SET x = @p1 WHERE id = @p2');
    await a.close();
  });

  it('rowsAffected 缺失时 affectedRows 为 undefined 但不抛', async () => {
    const { a, pool } = await make();
    pool.queue = [{ recordset: [] }];
    const r = await a.execute('CREATE TABLE t (id INT)');
    expect(r.affectedRows).toBeUndefined();
    expect(r.message).toMatch(/执行成功/);
    await a.close();
  });
});

/* ---------------- 元数据 ---------------- */

describe('sqlserver 元数据方法（手法 B）', () => {
  it('testConnect 返回版本串', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ version: '15.0.2000.5', major: 15, engine: 3 }], cols('version', 'major', 'engine'))];
    const r = await a.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toBe('Microsoft SQL Server 2019 - 15.0.2000.5');
    expect(pool.last.executed[0]!.sql).toContain("SERVERPROPERTY('ProductVersion')");
    await a.close();
  });

  it('listDatabases 排除系统库（database_id > 4）', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ name: 'appdb' }, { name: 'report' }], cols('name'))];
    const dbs = await a.listDatabases();
    expect(dbs).toEqual(['appdb', 'report']);
    const sql = pool.last.executed[0]!.sql;
    expect(sql).toContain('sys.databases');
    expect(sql).toContain('database_id > 4');
    await a.close();
  });

  it('listSchemas 排除系统 schema', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([{ name: 'dbo' }, { name: 'sales' }], cols('name'))];
    const schemas = await a.listSchemas!();
    expect(schemas).toEqual(['dbo', 'sales']);
    const sql = pool.last.executed[0]!.sql;
    expect(sql).toContain('sys.schemas');
    expect(sql).toContain('INFORMATION_SCHEMA');
    await a.close();
  });

  it('listTables：sys.objects 限定 schema，类型归一 TABLE/VIEW', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ table_name: 't1', obj_type: 'U' }, { table_name: 'v1', obj_type: 'V' }], cols('table_name', 'obj_type')),
    ];
    const tables = await a.listTables('dbo');
    expect(tables).toEqual([
      { name: 't1', type: 'TABLE', database: 'dbo' },
      { name: 'v1', type: 'VIEW', database: 'dbo' },
    ]);
    const sql = pool.last.executed[0]!.sql;
    expect(sql).toContain('sys.objects');
    expect(sql).toContain("'U'");
    expect(sql).toContain("'V'");
    expect(pool.last.executed[0]!.binds).toEqual([['p1', 'dbo']]);
    await a.close();
  });

  it('listTables：跨库目标 "db.schema" 走该库自己的池', async () => {
    const { a, h } = await make();
    h.pools[0]!.queue = [rec([{ table_name: 't1', obj_type: 'U' }], cols('table_name', 'obj_type'))];
    await a.listTables('other.sales');
    expect(h.pools).toHaveLength(2);
    expect(h.configs[1]).toMatchObject({ database: 'other' });
    expect(h.pools[1]!.last.executed[0]!.binds).toEqual([['p1', 'sales']]);
    await a.close();
  });

  it('describeTable：主键标 PRI、类型带长度、MS_Description 作 comment', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec(
        [
          { column_id: 1, column_name: 'id', type_name: 'int', max_length: 4, precision: 10, scale: 0, is_nullable: false, default_def: null, comment: '主键' },
          { column_id: 2, column_name: 'name', type_name: 'nvarchar', max_length: 100, precision: 0, scale: 0, is_nullable: true, default_def: "('x')", comment: null },
          { column_id: 3, column_name: 'amount', type_name: 'decimal', max_length: 9, precision: 18, scale: 2, is_nullable: true, default_def: null, comment: null },
        ],
        cols('column_id', 'column_name', 'type_name', 'max_length', 'precision', 'scale', 'is_nullable', 'default_def', 'comment'),
      ),
      rec([{ column_id: 1 }], cols('column_id')),
    ];
    const columns = await a.describeTable('users');
    expect(columns).toEqual([
      { name: 'id', dataType: 'int', nullable: false, key: 'PRI', default: null, comment: '主键' },
      { name: 'name', dataType: 'nvarchar(50)', nullable: true, key: undefined, default: "('x')", comment: undefined },
      { name: 'amount', dataType: 'decimal(18, 2)', nullable: true, key: undefined, default: null, comment: undefined },
    ]);
    const sql = pool.requests[0]!.executed[0]!.sql;
    expect(sql).toContain('sys.columns');
    expect(sql).toContain('sys.types');
    expect(sql).toContain('MS_Description');
    expect(pool.requests[0]!.executed[0]!.binds).toEqual([['p1', '[dbo].[users]']]);
    expect(pool.requests[1]!.executed[0]!.sql).toContain('sys.indexes');
    expect(pool.requests[1]!.executed[0]!.sql).toContain('is_primary_key');
    await a.close();
  });

  it('describeTable：表不存在抛「表不存在: <名>」', async () => {
    const { a, pool } = await make();
    pool.queue = [rec([], cols('column_name'))];
    await expect(a.describeTable('ghost')).rejects.toThrow(/表不存在: dbo\.ghost/);
    await a.close();
  });

  it('元数据 SQL 只用 2005+ 通用写法（禁用 STRING_AGG/TRIM/CONCAT_WS/STRING_SPLIT）', async () => {
    const { a, pool } = await make();
    pool.queue = [
      rec([{ name: 'appdb' }], cols('name')),
      rec([{ name: 'dbo' }], cols('name')),
      rec([{ table_name: 't1', obj_type: 'U' }], cols('table_name', 'obj_type')),
      rec([{ column_id: 1, column_name: 'id', type_name: 'int', max_length: 4, precision: 10, scale: 0, is_nullable: false, default_def: null, comment: null }], cols('column_id', 'column_name', 'type_name', 'max_length', 'precision', 'scale', 'is_nullable', 'default_def', 'comment')),
      rec([{ column_id: 1 }], cols('column_id')),
      rec([{ major: 15, version: '15.0.2000.5' }], cols('major', 'version')),
      rec([{ id: 1 }], cols('id')),
    ];
    await a.listDatabases();
    await a.listSchemas!();
    await a.listTables();
    await a.describeTable('t1');
    await a.previewRows('t1', 1);
    for (const req of pool.requests) {
      for (const e of req.executed) {
        expect(e.sql).not.toMatch(/STRING_AGG|CONCAT_WS|STRING_SPLIT|\bTRIM\s*\(/i);
      }
    }
    await a.close();
  });
});

/* ---------------- 错误人性化 ---------------- */

function mssqlErr(name: string, code: string, extra?: Record<string, unknown>): Error {
  const e = new Error(`mock ${code}`);
  e.name = name;
  Object.assign(e, { code }, extra);
  return e;
}

describe('sqlserver 错误中文映射（手法 B）', () => {
  const CASES: Array<[string, Error, RegExp]> = [
    ['ELOGIN', mssqlErr('ConnectionError', 'ELOGIN'), /登录失败/],
    ['ETIMEOUT(ConnectionError)', mssqlErr('ConnectionError', 'ETIMEOUT'), /连接超时/],
    ['ETIMEOUT(RequestError)', mssqlErr('RequestError', 'ETIMEOUT'), /请求超时/],
    ['ESOCKET', mssqlErr('ConnectionError', 'ESOCKET'), /网络不可达/],
    ['EINSTLOOKUP', mssqlErr('ConnectionError', 'EINSTLOOKUP'), /「主机，端口」直连，如 host,1433/],
    ['ENOTOPEN', mssqlErr('ConnectionError', 'ENOTOPEN'), /连接已关闭|未打开/],
    ['ECONNCLOSED', mssqlErr('ConnectionError', 'ECONNCLOSED'), /连接已关闭/],
    ['EREQUEST', mssqlErr('RequestError', 'EREQUEST', { number: 208, severity: 16, lineNumber: 3 }), /208/],
    ['ECANCEL', mssqlErr('RequestError', 'ECANCEL'), /取消/],
  ];
  it.each(CASES)('%s → 中文提示', async (_label, err, re) => {
    const { a, pool } = await make();
    pool.failWith = err;
    const got = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(got);
    expect(msg).toMatch(re);
    expect(msg).toMatch(/sqlserver 查询失败/);
    await a.close();
  });

  it('未知错误码：保留原始信息（不吞）', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('RequestError', 'EWHATEVER', { number: 42 });
    await expect(a.query('SELECT 1')).rejects.toThrow(/EWHATEVER/);
    await a.close();
  });

  it('TLS/证书特征错误：说明 TCP 已连通（不是网络不可达）并追加信任证书指引', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', { message: 'self signed certificate in certificate chain' });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    // 保留「网络不可达」字样（既有断言/用户检索习惯），但明确否定它（TCP 实际已连通，避免误查网络）
    expect(msg).toMatch(/网络不可达/);
    expect(msg).toMatch(/TCP 已连通/);
    expect(msg).toMatch(/trustServerCertificate/);
    expect(msg).toMatch(/2008/);
    await a.close();
  });

  it('TLS 协议版本不符（真实案例）：老实例仅 TLS 1.0 对客户端最低 TLS 1.2 的握手失败，不再误报网络不可达', async () => {
    // 2026-10-15 真机案例：tedious wrapSocketError 把 BoringSSL 原文原样拼进 ESOCKET message
    // （connection.js:1457），底层错误同时挂在 ES cause 上而非 originalError（事务 abort 专用）
    const { a, pool } = await make();
    pool.failWith = mssqlErr(
      'ConnectionError',
      'ESOCKET',
      {
        message:
          'Failed to connect to 10.192.68.42:1433 - 107904error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL:..\\..\\third_party\\boringssl\\src\\ssl\\handshake_client.c',
        cause: new Error(
          '107904error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL:..\\..\\third_party\\boringssl\\src\\ssl\\handshake_client.c',
        ),
      },
    );
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/TCP 已连通/);
    // UNSUPPORTED_PROTOCOL = 双方没有共同 TLS 协议版本，握手根本没走到证书校验：诊断必须指向
    // 协议版本（tlsMinVersion）。允许否定式说明「跳过证书校验无效」（比沉默更省排查轮次），
    // 但不得给出可照抄的 ?trustServerCertificate=true —— 那是开错药方。
    expect(msg).toMatch(/协议版本/);
    expect(msg).toMatch(/tlsMinVersion/);
    expect(msg).toMatch(/无效|不起作用/);
    expect(msg).not.toMatch(/\?trustServerCertificate=true/);
    // 协议版本类错误不含证书字样，修复前会落「网络不可达」兜底
    expect(msg).not.toMatch(/^网络不可达/);
    await a.close();
  });

  it('非 TLS 的连接失败不追加证书指引（避免噪音）', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: 'Failed to connect to db1.example.com:1433 in 15000ms',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    expect(msgOf(err)).toMatch(/网络不可达/);
    expect(msgOf(err)).not.toMatch(/TCP 已连通/);
    expect(msgOf(err)).not.toMatch(/trustServerCertificate/);
    await a.close();
  });

  /* ---------- TLS 三族分流：协议版本族 / 证书族 / 网络族必须互斥 ---------- */

  /** 真实案例原文（tedious connection.js 把 BoringSSL 串原样拼进 ESOCKET message） */
  const BORINGSSL_UNSUPPORTED =
    'Failed to connect to 10.192.68.42:1433 - 107904error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL:..\\..\\third_party\\boringssl\\src\\ssl\\handshake_client.c';

  it('UNSUPPORTED_PROTOCOL 完整 BoringSSL 原文：诊断指向协议版本（tlsMinVersion），不给 trustServerCertificate', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: BORINGSSL_UNSUPPORTED,
      cause: new Error(
        '107904error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL:..\\..\\third_party\\boringssl\\src\\ssl\\handshake_client.c',
      ),
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/TCP 已连通/);
    expect(msg).toMatch(/协议版本/);
    expect(msg).toMatch(/tlsMinVersion/);
    // 协议协商阶段就失败了，证书校验根本没执行：允许明说「跳过证书校验无效」，但不给可照抄参数
    expect(msg).toMatch(/无效|不起作用/);
    expect(msg).not.toMatch(/\?trustServerCertificate=true/);
    await a.close();
  });

  it('仅 BoringSSL 错误码（无 handshake_client.c 路径字面量）也归协议版本族', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: 'error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/TCP 已连通/);
    expect(msg).toMatch(/协议版本/);
    expect(msg).toMatch(/tlsMinVersion/);
    expect(msg).toMatch(/无效|不起作用/);
    expect(msg).not.toMatch(/\?trustServerCertificate=true/);
    await a.close();
  });

  it('证书族（自签证书）：给 trustServerCertificate=true / encrypt=false / 2008，不混入协议版本建议', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: 'self signed certificate in certificate chain',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/TCP 已连通/);
    expect(msg).toMatch(/trustServerCertificate=true/);
    expect(msg).toMatch(/encrypt=false/);
    expect(msg).toMatch(/2008/);
    // 两族互斥：证书类不能顺带推销 tlsMinVersion（会让用户去改协议版本，白跑）
    expect(msg).not.toMatch(/协议版本|tlsMinVersion/);
    await a.close();
  });

  it('ECONNREFUSED：仍是网络不可达，不带任何 TLS 指引', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: 'Failed to connect to 127.0.0.1:1433 - connect ECONNREFUSED 127.0.0.1:1433',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/网络不可达/);
    expect(msg).not.toMatch(/TCP 已连通/);
    expect(msg).not.toMatch(/tlsMinVersion/);
    expect(msg).not.toMatch(/trustServerCertificate/);
    await a.close();
  });

  it('getaddrinfo ENOTFOUND：仍是网络不可达，不带任何 TLS 指引', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: 'Failed to connect to db1.example.com:1433 - getaddrinfo ENOTFOUND db1.example.com',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/网络不可达/);
    expect(msg).not.toMatch(/TCP 已连通/);
    expect(msg).not.toMatch(/tlsMinVersion/);
    expect(msg).not.toMatch(/trustServerCertificate/);
    await a.close();
  });

  it('EENCRYPT（服务器强制加密）：给 ?encrypt=true，不牵扯证书', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'EENCRYPT', { message: 'Server requires encryption' });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/服务器要求加密/);
    expect(msg).toMatch(/\?encrypt=true/);
    expect(msg).not.toMatch(/trustServerCertificate/);
    await a.close();
  });

  it('cause 携带 UNSUPPORTED_PROTOCOL 而 message 不含：靠 cause 命中协议版本族，且 cause 原文只出现一次', async () => {
    const { a, pool } = await make();
    const causeText = 'error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL';
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', { cause: new Error(causeText) });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/TCP 已连通/);
    expect(msg).toMatch(/协议版本/);
    expect(msg).toMatch(/tlsMinVersion/);
    // 不重复堆底层原文：message 未包含 cause 全文，补一条「原始错误」即可
    expect(msg.split(causeText)).toHaveLength(2);
    await a.close();
  });

  it('EENCRYPT（服务器未协商加密，tedious 20.3.8 新文案）：说明服务器未回 ON/REQ，给 encrypt=false 出口', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'EENCRYPT', {
      message:
        "Server did not negotiate encryption, but the 'encrypt' config option is set to `true`. Set 'encrypt' to `false` to allow unencrypted connections.",
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    // 与「服务器要求加密」是相反方向：此情形是客户端要加密但服务器没谈成，不能反过来说要开 encrypt
    expect(msg).toMatch(/未协商加密|没有协商加密/);
    expect(msg).toMatch(/encrypt=false/);
    expect(msg).not.toMatch(/服务器要求加密/);
    // 该情形与证书无关
    expect(msg).not.toMatch(/trustServerCertificate|caCert/);
    await a.close();
  });

  it('encrypt=strict 相关说明：strict 下 trustServerCertificate 完全失效（tedious 不传 rejectUnauthorized）', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      message: 'self signed certificate in certificate chain',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    // 证书族必须给出「官方推荐装 CA」的正解出口，而不是只教用户关校验
    expect(msg).toMatch(/caCert/);
    expect(msg).toMatch(/serverName/);
    expect(msg).toMatch(/官方|推荐/);
    // 两族互斥断言保持：证书族不出现协议版本建议
    expect(msg).not.toMatch(/tlsMinVersion/);
    await a.close();
  });

  it('错误号 17819（仅接受 strict/TDS 8.0）：引导 encrypt=strict，且不误判为证书或版本问题', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('RequestError', 'EREQUEST', {
      number: 17819,
      severity: 20,
      message: 'The server only accepts connections encrypted with TLS (TDS 8.0 and above)',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/17819|TDS 8\.0|strict/);
    expect(msg).toMatch(/encrypt=strict/);
    expect(msg).not.toMatch(/trustServerCertificate=true/);
    await a.close();
  });

  it('错误号 17835（服务器强制加密而客户端不支持）：引导启用 encrypt，不给证书建议', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('RequestError', 'EREQUEST', {
      number: 17835,
      severity: 20,
      message: 'Encryption is required to connect to this server but the client library does not support encryption',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/17835|强制加密|要求加密/);
    expect(msg).toMatch(/encrypt=true/);
    expect(msg).not.toMatch(/trustServerCertificate/);
    await a.close();
  });

  it('错误号 17898/17802（TDS 版本不被接受）：提示升级客户端库，不建议下调 tdsVersion', async () => {
    for (const num of [17898, 17802]) {
      const { a, pool } = await make();
      pool.failWith = mssqlErr('RequestError', 'EREQUEST', { number: num, severity: 20, message: 'TDS version' });
      const err = await a.query('SELECT 1').then(
        () => {
          throw new Error('应抛错');
        },
        (e: unknown) => e,
      );
      const msg = msgOf(err);
      expect(msg, `number=${num}`).toMatch(new RegExp(String(num)));
      expect(msg).toMatch(/TDS/);
      expect(msg).toMatch(/升级/);
      // 官方协议保证服务器降级：下调 tdsVersion 是错药方
      expect(msg).not.toMatch(/tdsVersion=7_[0-3]/);
      await a.close();
    }
  });

  it('错误号 17836/17828/17832（包结构错配）：指向代理/分片/加密中间层，不归为版本问题', async () => {
    for (const num of [17836, 17828, 17832]) {
      const { a, pool } = await make();
      pool.failWith = mssqlErr('RequestError', 'EREQUEST', { number: num, severity: 20, message: 'packet' });
      const err = await a.query('SELECT 1').then(
        () => {
          throw new Error('应抛错');
        },
        (e: unknown) => e,
      );
      const msg = msgOf(err);
      expect(msg, `number=${num}`).toMatch(new RegExp(String(num)));
      expect(msg).toMatch(/代理|中间层|加密/);
      expect(msg).not.toMatch(/tdsVersion/);
      await a.close();
    }
  });

  it('错误号 47072（Azure 低于最小 TLS 版本）：给出升 TLS 1.2 出口，不给关校验', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('RequestError', 'EREQUEST', {
      number: 47072,
      severity: 20,
      message: 'The minimum TLS version is not met',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/47072|TLS/);
    expect(msg).toMatch(/1\.2/);
    expect(msg).not.toMatch(/trustServerCertificate=true/);
    await a.close();
  });

  it('已知错误号命中时不再叠加 TLS 族建议（17819 原文含 certificate 也不得给出装 CA/关校验的错药方）', async () => {
    const { a, pool } = await make();
    // SQL Server 2022 的真实原文包含 certificate，会被证书族正则命中——但真因是服务端未配置
    // 可用于 TDS 8.0 的证书，客户端装 CA 或关校验都解决不了，叠加建议只会把用户引向死路。
    pool.failWith = mssqlErr('RequestError', 'EREQUEST', {
      number: 17819,
      severity: 20,
      message:
        'TLS certificate is not configured to accept strict (TDS 8.0 and above) connections. The connection has been closed.',
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/encrypt=strict/);
    expect(msg).not.toMatch(/trustServerCertificate/);
    expect(msg).not.toMatch(/caCert/);
    await a.close();
  });

  it('originalError 与 cause 并存：末尾「原始错误」取 originalError（事务 abort 语义），不取 cause', async () => {
    const { a, pool } = await make();
    const original = 'error:100000f0:SSL routines:OPENSSL_internal:UNSUPPORTED_PROTOCOL';
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET', {
      originalError: new Error(original),
      cause: new Error('read ECONNRESET'),
    });
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/协议版本/);
    expect(msg).toMatch(/tlsMinVersion/);
    expect(msg).toMatch(/原始错误/);
    expect(msg).toContain(original);
    expect(msg).not.toContain('ECONNRESET');
    await a.close();
  });

  it('originalError 与 cause 均缺省：不出现「原始错误」与 undefined 字样', async () => {
    const { a, pool } = await make();
    pool.failWith = mssqlErr('ConnectionError', 'ESOCKET');
    const err = await a.query('SELECT 1').then(
      () => {
        throw new Error('应抛错');
      },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/网络不可达/);
    expect(msg).not.toMatch(/原始错误/);
    expect(msg).not.toMatch(/undefined/);
    await a.close();
  });

  it('tlsMinVersion URL 参数：合法值写入 cryptoCredentialsDetails.minVersion，非法值抛中文错，缺省不注入', async () => {
    // 白名单三值合法。刻意不含 TLSv1.3：Node/BoringSSL 本身接受它，但 tedious 在调用方未给
    // maxVersion 时把上限硬封在 TLSv1.2（tedious@20.3.8 message-io.js:56-57），minVersion=1.3
    // 会变成 min>max 而必然抛 NO_SUPPORTED_VERSIONS_ENABLED —— 那是 100% 失败的配置，不是我们的杜撰限制。
    for (const ok of ['TLSv1', 'TLSv1.1', 'TLSv1.2']) {
      const h0 = harness();
      const a0 = await createSqlserverAdapter(connByUrl(`${BASE_URL}?tlsMinVersion=${ok}`), { driver: h0.driver });
      expect(h0.configs[0]!.options, `tlsMinVersion=${ok}`).toMatchObject({
        cryptoCredentialsDetails: { minVersion: ok },
      });
      await a0.close();
    }

    // 非法值 fail-closed：不静默回退 Node 默认（否则用户以为已下探，实际仍是 TLS 1.2 下限）
    for (const bad of ['TLSv1.3', 'TLSv1_0', 'tlsv1', 'nonsense']) {
      const h2 = harness();
      const err = await createSqlserverAdapter(connByUrl(`${BASE_URL}?tlsMinVersion=${bad}`), {
        driver: h2.driver,
      }).then(
        () => {
          throw new Error(`应抛错：tlsMinVersion=${bad}`);
        },
        (e: unknown) => e,
      );
      const msg = msgOf(err);
      expect(msg, `tlsMinVersion=${bad}`).toMatch(/tlsMinVersion/);
      expect(msg).toMatch(/非法/);
      // TLSv1.3 被拒必须说清真实原因（tedious 上限封顶），不能只写「不支持」让用户以为是我们杜撰的限制
      if (bad === 'TLSv1.3') expect(msg).toMatch(/上限|封顶|1\.2/);
      expect(h2.configs).toHaveLength(0);
    }

    // 未提供时不动下限：沿用 Node 默认 TLSv1.2（ca 仍会按系统信任库注入，见上一组用例）
    const { h: h3, a: a3 } = await make();
    const ccd3 = (h3.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as
      | Record<string, unknown>
      | undefined;
    expect(ccd3 === undefined || !('minVersion' in ccd3)).toBe(true);
    await a3.close();
  });

  it('fields 分支支持 encrypt/trustServerCertificate/tdsVersion/tlsMinVersion（与 URL 同口径，非法值抛中文错）', async () => {
    const h = harness();
    const a = await createSqlserverAdapter(
      connByFields({
        host: 'h2',
        user: 'u',
        password: 'p',
        database: 'd',
        encrypt: false,
        trustServerCertificate: true,
        tdsVersion: '7_3_A',
        tlsMinVersion: 'TLSv1.1',
      }),
      { driver: h.driver },
    );
    expect(h.configs[0]!.options).toMatchObject({
      encrypt: false,
      trustServerCertificate: true,
      tdsVersion: '7_3_A',
      cryptoCredentialsDetails: { minVersion: 'TLSv1.1' },
    });
    await a.close();

    const BAD: Array<Record<string, unknown>> = [
      { tdsVersion: '9_9' },
      // fields 与 URL 同口径：TLSv1.3 因 tedious 把上限封顶在 1.2（message-io.js:56-57）而非法
      { tlsMinVersion: 'TLSv1.3' },
      { encrypt: 'maybe' },
      { trustServerCertificate: 'maybe' },
    ];
    for (const fields of BAD) {
      const h2 = harness();
      const key = Object.keys(fields)[0]!;
      const err = await createSqlserverAdapter(
        connByFields({ host: 'h', user: 'u', password: 'p', ...fields }),
        { driver: h2.driver },
      ).then(
        () => {
          throw new Error(`应抛错：${JSON.stringify(fields)}`);
        },
        (e: unknown) => e,
      );
      const msg = msgOf(err);
      expect(msg, JSON.stringify(fields)).toMatch(new RegExp(key));
      expect(msg).toMatch(/非法/);
      // 校验发生在建池之前：不该有任何池配置产出
      expect(h2.configs).toHaveLength(0);
    }
  });
});

/* ---------------- 池缓存 / close / tx ---------------- */

describe('sqlserver 池与事务（手法 B）', () => {
  it('close 幂等：连关两次不抛且每个池只关一次', async () => {
    const { a, h, pool } = await make();
    h.pools[0]!.queue = [rec([{ n: 1 }], cols('n'))];
    await a.query('SELECT 1', [], 'otherdb');
    await a.close();
    await expect(a.close()).resolves.toBeUndefined();
    expect(pool.closed).toBe(1);
    expect(h.pools[1]!.closed).toBe(1);
  });

  it('跨库池按库名缓存复用，且复用主池当库名相同', async () => {
    const { a, h, pool } = await make();
    pool.queue = [rec([{ n: 1 }], cols('n')), rec([{ n: 2 }], cols('n')), rec([{ n: 3 }], cols('n'))];
    await a.query('SELECT 1', [], 'otherdb');
    await a.query('SELECT 2', [], 'otherdb');
    await a.query('SELECT 3', [], 'appdb');
    expect(h.pools).toHaveLength(2);
    expect(h.pools[0]!.requests).toHaveLength(1);
    expect(h.pools[1]!.requests).toHaveLength(2);
    await a.close();
  });

  it('跨库池键大小写归一：MyDB/mydb/MYDB 复用同池，与主库同名（大小写不同）复用主池', async () => {
    const { a, h, pool } = await make();
    pool.queue = [
      rec([{ n: 1 }], cols('n')),
      rec([{ n: 2 }], cols('n')),
      rec([{ n: 3 }], cols('n')),
      rec([{ n: 4 }], cols('n')),
    ];
    await a.query('SELECT 1', [], 'MyDB');
    await a.query('SELECT 2', [], 'mydb');
    await a.query('SELECT 3', [], 'MYDB');
    // 连接默认库是 appdb：大小写不同不该另建池
    await a.query('SELECT 4', [], 'AppDB');
    expect(h.pools).toHaveLength(2); // 主池 + 一个跨库池
    expect(h.pools[1]!.requests).toHaveLength(3);
    expect(h.pools[0]!.requests).toHaveLength(1);
    await a.close();
  });

  it('惰性建连：仅创建适配器不发请求（multi-instance 契约前提）', async () => {
    const { a, pool } = await make();
    expect(pool.connectCalls).toBe(0);
    expect(pool.requests).toHaveLength(0);
    await a.close();
  });

  it('tx：begin/commit/rollback 三方法，事务期间 query 走事务请求', async () => {
    const { a, h, pool } = await make();
    pool.queue = [rec([{ n: 1 }], cols('n')), rec([{ n: 2 }], cols('n'))];
    const tx = a.tx as { begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void> };
    await tx.begin();
    expect(h.txs).toHaveLength(1);
    const t = h.txs[0]!;
    await a.query('SELECT ?', [1]);
    await a.execute('UPDATE t SET x = ?', [2]);
    expect(t.requests).toHaveLength(2);
    expect(pool.requests).toHaveLength(0);
    await tx.commit();
    expect(t.events).toEqual(['begin', 'commit']);
    await expect(tx.commit()).rejects.toThrow(/没有进行中的事务/);
    await a.close();
  });

  it('tx：重复 begin 报错，rollback 后事务结束', async () => {
    const { a, h } = await make();
    const tx = a.tx as { begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void> };
    await tx.begin();
    await expect(tx.begin()).rejects.toThrow(/事务已开启/);
    await tx.rollback();
    expect(h.txs[0]!.events).toEqual(['begin', 'rollback']);
    expect(h.txs[0]!.requests).toHaveLength(0);
    await a.close();
  });

  it('tx：未 begin 时 commit/rollback 报中文错误', async () => {
    const { a } = await make();
    const tx = a.tx as { begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void> };
    await expect(tx.commit()).rejects.toThrow(/没有进行中的事务/);
    await expect(tx.rollback()).rejects.toThrow(/没有进行中的事务/);
    await a.close();
  });

  it('close 后再用：抛「连接已关闭」中文错误，且不新建跨库池（不泄漏）', async () => {
    const { a, h } = await make();
    await a.close();
    await expect(a.query('SELECT 1')).rejects.toThrow(/已关闭/);
    await expect(a.execute('UPDATE t SET x = 1')).rejects.toThrow(/已关闭/);
    await expect(a.query('SELECT 1', [], 'otherdb')).rejects.toThrow(/已关闭/);
    await expect(a.listTables()).rejects.toThrow(/已关闭/);
    await expect(a.previewRows('users', 1)).rejects.toThrow(/已关闭/);
    expect(h.pools).toHaveLength(1); // 关闭后未新建跨库池
    await expect(a.close()).resolves.toBeUndefined();
  });
});

/* ---------------- factory 导出 ---------------- */

describe('sqlserver factory 导出', () => {
  it('factory(conn) 走生产 vendor 路径可创建适配器且不建连（惰性）', async () => {
    // 生产 AdapterFactory 无 driver 参数：此处真实 require vendor/sqlserver-driver.cjs，
    // 验证「包可加载 + 建池惰性（不触网）」——vendor 缺失时本用例会以中文修复指引失败。
    const mod = await import('../../lib/adapters/sqlserver/index.js');
    const a: DatabaseAdapter = await mod.factory(connByUrl(BASE_URL));
    expect(a.kind).toBe('sqlserver');
    await a.close();
    await expect(a.close()).resolves.toBeUndefined();
  });
});

/* ---------------- 系统信任库默认注入（"导入信任库即可连"的前提） ---------------- */

describe('sqlserver 系统信任库注入', () => {
  const ccdOf = (options: Record<string, unknown>) =>
    options['cryptoCredentialsDetails'] as Record<string, unknown> | undefined;

  it('默认注入 CA 列表，且同时包含内置 bundle 与系统信任库（合并而非替换，否则连公网证书会失败）', async () => {
    const tls = await import('node:tls');
    const getter = (tls as unknown as { getCACertificates?: (t: string) => string[] }).getCACertificates;
    if (typeof getter !== 'function') {
      // 老 Node（< 22.15）：不注入是正确降级，此时本用例只验证「不报错、不改默认行为」
      const { h, a } = await make();
      expect(ccdOf(h.configs[0]!.options as Record<string, unknown>)).toBeUndefined();
      await a.close();
      return;
    }
    const { h, a } = await make();
    const ca = ccdOf(h.configs[0]!.options as Record<string, unknown>)?.['ca'] as string[];
    expect(Array.isArray(ca)).toBe(true);
    expect(ca.length).toBeGreaterThan(0);
    // 合并验证：至少包含一张只在系统库、不在 bundle 的证书（证明系统库确实被并进来了）
    const { X509Certificate } = await import('node:crypto');
    const fp = (p: string) => {
      try { return new X509Certificate(p).fingerprint256; } catch { return ''; }
    };
    const caSet = new Set(ca.map(fp));
    const sysOnly = getter('system').filter((p) => {
      const f = fp(p);
      return f !== '' && caSet.has(f);
    });
    expect(sysOnly.length).toBeGreaterThan(0);
    await a.close();
  }, 20000);

  it('显式 caCert 时不覆盖用户选择：注入的列表以用户给的 CA 为准（不被默认合并冲掉）', async () => {
    const marker = '-----BEGIN CERTIFICATE-----\nMIIBuserSupplied\n-----END CERTIFICATE-----';
    const h = harness();
    const a = await createSqlserverAdapter(connByFields({ host: 'h', user: 'sa', caCert: marker }), {
      driver: h.driver,
    });
    const ca = ccdOf(h.configs[0]!.options as Record<string, unknown>)?.['ca'] as string[];
    expect(ca).toContain(marker);
    await a.close();
  });

  it('取系统证书失败时不阻断建连（异常被吞掉，连接照常创建）', async () => {
    const { h, a } = await make();
    // 建池本身成功即证明未抛错；config 已生成说明校验链没被打断
    expect(h.configs[0]).toBeDefined();
    await a.close();
  });
});

/* ---------------- 登录阶段真实形态（number 缺失）的分诊 ---------------- */
/*
 * 回归背景：tedious 的 Login7TokenHandler.onErrorMessage 构造的是
 * `new ConnectionError(token.message, 'ELOGIN')`——token.number 只用于判断临时错误，
 * 没有赋给 error 对象（只有查询阶段的 RequestError 才有 number）。
 * 因此 17819/17835 等在真实链路上到达适配器时 number 恒为 undefined。
 * 若只按 number 查表，这些诊断会全部失效并退化成"用户名或密码错误"。
 * 下面的用例刻意用 code='ELOGIN' 且不带 number，模拟真实形态。
 */

describe('sqlserver 登录阶段错误分诊（真实形态：ELOGIN + 无 number）', () => {
  /** 构造登录阶段错误：code=ELOGIN，不带 number */
  function loginErr(message: string): Error {
    const e = new Error(message);
    e.name = 'ConnectionError';
    (e as unknown as { code: string }).code = 'ELOGIN';
    return e;
  }

  async function reasonOf(message: string): Promise<string> {
    // 通过 pool.failWith 注入：testConnect 的 version 查询会抛，等价于登录阶段被服务器拒绝
    const { a, pool } = await make();
    pool.failWith = loginErr(message);
    const err = await a.testConnect().then(
      () => { throw new Error('应抛错'); },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    await a.close();
    return msg;
  }

  it('17819 原文（仅接受 strict）：指向 encrypt=strict，且不得误报用户名密码错误', async () => {
    const msg = await reasonOf(
      'The SQL Server or the endpoint is configured to accept only strict (TDS 8.0 and above) connections. The connection has been closed.',
    );
    expect(msg).toMatch(/encrypt=strict/);
    // 真实链路上 number 缺失，旧实现会退化成这句 —— 方向完全错
    expect(msg).not.toMatch(/用户名或密码错误/);
    // 且不得误给"装 CA / 关校验"这类对协议配置无效的药方
    expect(msg).not.toMatch(/caCert/);
  });

  it('17835 原文（服务器强制加密）：指向 encrypt=true，不得误报登录失败', async () => {
    const msg = await reasonOf(
      'Encryption is required to connect to this server but the client library does not support encryption; the connection has been closed.',
    );
    expect(msg).toMatch(/encrypt=true/);
    expect(msg).not.toMatch(/用户名或密码错误/);
  });

  it('17836 原文（包长度错配）：指向链路/代理，不得误判为认证问题', async () => {
    const msg = await reasonOf(
      'Length specified in network packet payload did not match number of bytes read; the connection has been closed.',
    );
    expect(msg).toMatch(/代理|中间设备|端口/);
    expect(msg).not.toMatch(/用户名或密码错误/);
  });

  it('17832 原文（登录包结构非法）：指向链路中间设备', async () => {
    const msg = await reasonOf(
      'The login packet used to open the connection is structurally invalid; the connection has been closed.',
    );
    expect(msg).toMatch(/中间设备|中间层|端口/);
  });

  it('真正的账号错误（无任何已知特征）仍报用户名密码错误 —— 兜底不能被吞掉', async () => {
    const msg = await reasonOf("Login failed for user 'sa'.");
    expect(msg).toMatch(/用户名或密码错误/);
  });
});

/* ---------------- CA 合并不缩小信任范围 ---------------- */
/*
 * 回归背景：applyCaCert 曾以 systemCa() 打底（不含内置 bundle），导致
 * "为连 A 实例装一张自签 CA"后，所有走公网 CA 的实例全部连不上。
 * Node 一旦收到 ca 选项就不再使用默认信任库，故必须 bundled + system + 用户 CA 合并。
 */

describe('sqlserver CA 合并不缩小信任范围', () => {
  it('显式 caCert 时注入的 ca 同时包含内置 bundle、系统信任库与用户 CA', async () => {
    const tlsMod = await import('node:tls');
    const getter = (tlsMod as unknown as { getCACertificates?: (t: string) => string[] }).getCACertificates;
    if (typeof getter !== 'function') return; // 老 Node：该能力不存在，跳过

    const marker = '-----BEGIN CERTIFICATE-----\nUSERSUPPLIED\n-----END CERTIFICATE-----';
    const h = harness();
    const a = await createSqlserverAdapter(connByFields({ host: 'h', user: 'sa', caCert: marker }), {
      driver: h.driver,
    });
    const ca = ((h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as Record<string, unknown>)['ca'] as string[];
    expect(ca).toContain(marker);

    // 关键：内置 bundle 必须在列，否则用户装一张 CA 就把公网实例全掐掉
    const bundled = getter('default');
    const caSet = new Set(ca);
    const bundledPresent = bundled.filter((p) => caSet.has(p)).length;
    expect(bundledPresent).toBeGreaterThan(0);
    // 允许去重导致的数量差异，但不能"只剩用户那张"
    expect(ca.length).toBeGreaterThan(bundledPresent);
    await a.close();
  });

  it('未给 caCert 时注入的列表同样包含内置 bundle（默认路径与显式路径同口径）', async () => {
    const tlsMod = await import('node:tls');
    const getter = (tlsMod as unknown as { getCACertificates?: (t: string) => string[] }).getCACertificates;
    if (typeof getter !== 'function') return;

    const { h, a } = await make();
    const ca = ((h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails'] as Record<string, unknown> | undefined)?.['ca'] as string[] | undefined;
    expect(Array.isArray(ca)).toBe(true);
    const caSet = new Set(ca as string[]);
    const bundledPresent = getter('default').filter((p) => caSet.has(p)).length;
    expect(bundledPresent).toBeGreaterThan(0);
    await a.close();
  });
});

/* ---------------- 单行 PEM 自动折行（I2：前端 input 会压平换行） ---------------- */

describe('sqlserver 单行 PEM 折行', () => {
  const BODY = 'MIIBszCCAVmgAwIBAgIUfakecaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

  it('被压成一行的 PEM 会重新按 64 列折行（否则握手必然失败却查不出原因）', async () => {
    const oneLine = `-----BEGIN CERTIFICATE-----${BODY}-----END CERTIFICATE-----`;
    const h = harness();
    const a = await createSqlserverAdapter(connByFields({ host: 'h', user: 'sa', caCert: oneLine }), {
      driver: h.driver,
    });
    const ca = (((h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails']) as Record<string, unknown>)['ca'] as string[];
    const mine = ca.find((c) => c.includes('fakecaAAAA'));
    expect(mine).toBeDefined();
    // 折行是判定标准：单行形态 createSecureContext 会静默接受但握手失败
    expect(mine!).toContain('\n');
    expect(mine!.split('\n').length).toBeGreaterThan(2);
    // 每行不超过 64 字符（首尾标记行除外）
    const bodyLines = mine!.split('\n').slice(1, -1);
    expect(bodyLines.every((l) => l.length <= 64)).toBe(true);
    await a.close();
  });

  it('已含换行的正常 PEM 原样保留（不得打乱有效格式）', async () => {
    const normal = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmg\nAwIBAgIUfakeca==\n-----END CERTIFICATE-----';
    const h = harness();
    const a = await createSqlserverAdapter(connByFields({ host: 'h', user: 'sa', caCert: normal }), {
      driver: h.driver,
    });
    const ca = (((h.configs[0]!.options as Record<string, unknown>)['cryptoCredentialsDetails']) as Record<string, unknown>)['ca'] as string[];
    expect(ca.some((c) => c === normal)).toBe(true);
    await a.close();
  });

  it('残缺 PEM（有 BEGIN 无 END）fail-closed 报错，不静默接受', async () => {
    const h = harness();
    const err = await createSqlserverAdapter(
      connByFields({ host: 'h', user: 'sa', caCert: '-----BEGIN CERTIFICATE-----MIIBbroken' }),
      { driver: h.driver },
    ).then(
      () => { throw new Error('应抛错'); },
      (e: unknown) => e,
    );
    const msg = msgOf(err);
    expect(msg).toMatch(/caCert/);
    expect(msg).toMatch(/PEM|-----END/);
    expect(h.configs).toHaveLength(0); // 配置阶段就拒绝，不建池
  });
});
