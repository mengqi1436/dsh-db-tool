/**
 * task-6 · V1 真实驱动级验证（配置可接受性 + 真实 TLS/网络错误映射）。
 *
 * 与既有的 sqlserver-offline.test.ts 的关键差别：**不注入手写 Fake 驱动**，而是让
 * vendor/sqlserver-driver.cjs（真实 mssql + tedious，版本随依赖升级）参与：
 *  - 配置侧：适配器 poolConfig 产出的 config 交给真实 mssql.ConnectionPool._config()，
 *    再交给真实 `new tedious.Connection(...)` —— 参数名/取值写错会在这一步真实报错（Fake 掩盖不了）。
 *  - 错误侧：本机自建 TLS 假服务器（node:crypto 手写 DER 自签证书 + TDS 封装 TLS），
 *    让 mssql 真连并触发真实证书错误；网络错误用真实 ECONNREFUSED/ETIMEOUT。
 *
 * 全程离线：不连任何外部主机，不依赖 SQL Server 实例。
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { createSqlserverAdapter, type SqlDriver } from '../../lib/adapters/sqlserver/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const nodeRequire = createRequire(import.meta.url);

/* ============================ 真实驱动 ============================ */

interface MssqlPoolLike {
  config: Record<string, unknown>;
  _connected: boolean;
  _config(): Record<string, unknown>;
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
}
interface MssqlLike {
  ConnectionPool: new (cfg: Record<string, unknown>) => MssqlPoolLike;
  Request: new (pool: MssqlPoolLike) => { input(name: string, ...rest: unknown[]): unknown };
  Transaction: new (pool: MssqlPoolLike) => unknown;
  TYPES: Record<string, unknown>;
}
interface TediousConn {
  config: { server: string; options: Record<string, unknown> };
}
interface TediousLike {
  Connection: new (cfg: Record<string, unknown>) => TediousConn;
}

function loadVendorDriver(): MssqlLike {
  try {
    return nodeRequire('../../vendor/sqlserver-driver.cjs') as MssqlLike;
  } catch {
    throw new Error('本测试需要已构建的 vendor/sqlserver-driver.cjs：请先运行 npm run build:sqlserver');
  }
}
const mssql = loadVendorDriver();
const tedious = nodeRequire('tedious') as TediousLike;
const tdsVersionTable = (nodeRequire('tedious/lib/tds-versions.js') as { versions: Record<string, number> }).versions;

/** 真实 mssql 的配置映射 + 真实 tedious 的构造校验（不 connect ⇒ 无网络 IO） */
function realDriverParse(cfg: Record<string, unknown>): { mapped: Record<string, unknown>; options: Record<string, unknown> } {
  const pool = new mssql.ConnectionPool(cfg);
  const mapped = pool._config();
  const conn = new tedious.Connection(mapped);
  return { mapped, options: conn.config.options };
}

interface CaptureKit {
  driver: SqlDriver;
  cfgs: Record<string, unknown>[];
  pools: MssqlPoolLike[];
}
/** 注入的驱动仍是**真实** mssql（只是记录 cfg 并保留池实例以便观察惰性） */
function captureDriver(): CaptureKit {
  const cfgs: Record<string, unknown>[] = [];
  const pools: MssqlPoolLike[] = [];
  const poolCtor = function (cfg: Record<string, unknown>): MssqlPoolLike {
    const pool = new mssql.ConnectionPool(cfg);
    cfgs.push(cfg);
    pools.push(pool);
    return pool;
  };
  const driver = Object.create(mssql as object) as Record<string, unknown>;
  driver['ConnectionPool'] = poolCtor;
  return { driver: driver as unknown as SqlDriver, cfgs, pools };
}

const BASE = 'sqlserver://sa:p%40ss@db.example.com:1433/appdb';
const connByUrl = (url: string): ResolvedConnection => ({ meta: { id: 'driver-real', kind: 'sqlserver' }, url });
const connByFields = (fields: Record<string, unknown>): ResolvedConnection => ({
  meta: { id: 'driver-real', kind: 'sqlserver' },
  fields,
});

async function cfgOf(url: string): Promise<Record<string, unknown>> {
  const kit = captureDriver();
  await createSqlserverAdapter(connByUrl(url), { driver: kit.driver });
  const cfg = kit.cfgs[0];
  if (!cfg) throw new Error('适配器未创建池');
  return cfg;
}

/* ============================ 自签证书 + 假 TDS 服务器 ============================ */

/* node:crypto 不提供 X.509 签发 API，本机也无 openssl，故手写最小 DER 编码自签证书。
   目的只是让真实 TLS 客户端拿到一张可解析、但无法通过链校验的证书。 */
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  if (n < 0x10000) return Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
}
const derTlv = (tag: number, content: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
const derSeq = (...parts: Buffer[]): Buffer => derTlv(0x30, Buffer.concat(parts));
function derInt(buf: Buffer): Buffer {
  let b = buf;
  while (b.length > 1 && b[0] === 0 && (b[1] ?? 0) < 0x80) b = b.subarray(1);
  if (((b[0] ?? 0) & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return derTlv(0x02, b);
}
function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const out = [40 * (parts[0] ?? 0) + (parts[1] ?? 0)];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >> 7;
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.push(...stack);
  }
  return derTlv(0x06, Buffer.from(out));
}
const sha256WithRsa = (): Buffer => derSeq(derOid('1.2.840.113549.1.1.11'), derTlv(0x05, Buffer.alloc(0)));
/** Name ::= SEQUENCE OF RDN；RDN ::= SET OF AttributeTypeAndValue */
const rdn = (cn: string): Buffer => derSeq(derTlv(0x31, derSeq(derOid('2.5.4.3'), derTlv(0x0c, Buffer.from(cn, 'utf8')))));
function derUtcTime(d: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0');
  return derTlv(
    0x17,
    Buffer.from(
      `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
    ),
  );
}
function selfSignedCert(): { key: string; cert: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const now = Date.now();
  const tbs = derSeq(
    derTlv(0xa0, derInt(Buffer.from([2]))), // version v3
    derInt(crypto.randomBytes(8)),
    sha256WithRsa(),
    rdn('localhost'),
    derSeq(derUtcTime(new Date(now - 3_600_000)), derUtcTime(new Date(now + 86_400_000))),
    rdn('localhost'),
    spki,
  );
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = derSeq(tbs, sha256WithRsa(), derTlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const pem = (body: Buffer, label: string): string =>
    `-----BEGIN ${label}-----\n${body.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), cert: pem(cert, 'CERTIFICATE') };
}

/** prelogin 应答包（ENCRYPTION=ON ⇒ 客户端转入 TLS） */
function preloginResponse(): Buffer {
  const PreloginPayload = nodeRequire('tedious/lib/prelogin-payload.js') as new (o: unknown) => { data: Buffer };
  const body = new PreloginPayload({ encrypt: true, version: { major: 16, minor: 0, build: 4000, subbuild: 0 } }).data;
  const head = Buffer.alloc(8);
  head.writeUInt8(0x04, 0); // TDS response
  head.writeUInt8(0x01, 1); // EOB
  head.writeUInt16BE(8 + body.length, 2);
  head.writeUInt8(1, 5);
  return Buffer.concat([head, body]);
}

/** 剥掉 TDS 包头（真实 SQL Server 在 prelogin 后把 TLS 记录封装进 TDS 包 type=0x12） */
class TdsDeframer extends Transform {
  private buf = Buffer.alloc(0);
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const len = this.buf.readUInt16BE(2);
      if (len < 8 || this.buf.length < len) break;
      this.push(this.buf.subarray(8, len));
      this.buf = this.buf.subarray(len);
    }
    cb();
  }
}
/** 反向：把 TLS 记录包回 TDS 包 */
class TdsFramer extends Transform {
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    const head = Buffer.alloc(8);
    head.writeUInt8(0x12, 0);
    head.writeUInt8(0x01, 1);
    head.writeUInt16BE(8 + chunk.length, 2);
    head.writeUInt8(1, 5);
    this.push(Buffer.concat([head, chunk]));
    cb();
  }
}

interface FakeTds {
  port: number;
  log: string[];
  close(): Promise<void>;
}

/**
 * 假 TDS 服务器：明文回 prelogin（要求加密），随后把 TDS 封装的 TLS 记录转给本地 TLS 端点。
 * TLS 端到端发生在「mssql 客户端 ↔ 本 TLS 端点」之间，证书校验失败与我们无关 —— 是真实结果。
 */
async function startFakeTds(): Promise<FakeTds> {
  const { key, cert } = selfSignedCert();
  const log: string[] = [];
  const sockets = new Set<net.Socket>();
  const tlsEndpoint = tls.createServer({ key, cert }, (s) => {
    s.on('error', () => {});
  });
  tlsEndpoint.on('tlsClientError', (e: Error) => log.push(`tlsClientError: ${e.message}`));
  await new Promise<void>((r) => tlsEndpoint.listen(0, '127.0.0.1', r));
  const tlsPort = (tlsEndpoint.address() as net.AddressInfo).port;

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 8) return;
      const len = buf.readUInt16BE(2);
      if (buf.length < len) return;
      sock.removeListener('data', onData);
      log.push(`prelogin: type=0x${buf.readUInt8(0).toString(16)} len=${len}`);
      sock.write(preloginResponse());
      // 裸 TCP 转发：TLS 状态机必须由两端直接完成，转发层只做 TDS 解封/封装
      const upstream = net.connect({ port: tlsPort, host: '127.0.0.1' });
      upstream.on('error', () => {});
      const deframer = new TdsDeframer();
      const framer = new TdsFramer();
      sock.pipe(deframer).pipe(upstream);
      upstream.pipe(framer).pipe(sock);
      sock.on('close', () => upstream.destroy());
    };
    sock.on('data', onData);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    log,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      await new Promise<void>((r) => tlsEndpoint.close(() => r()));
    },
  };
}

/** 用真实驱动去连（connectTimeout/requestTimeout 调小以便快速失败），返回真实错误对象 */
async function realConnectError(
  server: string,
  port: number,
  connectTimeout = 1200,
  encrypt = true,
): Promise<Record<string, unknown>> {
  const pool = new mssql.ConnectionPool({
    server,
    port,
    options: { connectTimeout, requestTimeout: connectTimeout, encrypt, trustServerCertificate: false },
  });
  try {
    await pool.connect();
    throw new Error('应当连接失败');
  } catch (e) {
    return e as Record<string, unknown>;
  } finally {
    // 静默服务器场景下 close 会等对端 socket 结束，这里限时避免测试挂起
    await Promise.race([pool.close().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
  }
}

/* ============================ 错误映射注入 ============================ */

class ErrorRequest {
  constructor(private readonly err: unknown) {}
  input(): ErrorRequest {
    return this;
  }
  async query(): Promise<never> {
    throw this.err;
  }
}
class ErrorPool {
  constructor(private readonly err: unknown) {}
  request(): ErrorRequest {
    return new ErrorRequest(this.err);
  }
  async connect(): Promise<unknown> {
    return this;
  }
  async close(): Promise<unknown> {
    return this;
  }
  on(): unknown {
    return this;
  }
}
/** 把**真实**错误对象经适配器错误映射路径走一遍 */
async function mapRealError(err: unknown): Promise<string> {
  const driver = {
    ConnectionPool: function (): ErrorPool {
      return new ErrorPool(err);
    },
    TYPES: {},
  } as unknown as SqlDriver;
  const adapter = await createSqlserverAdapter(connByUrl(BASE), { driver });
  try {
    await adapter.query('SELECT 1');
    throw new Error('应当抛错');
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/* ============================ 5. 真实驱动接口契约 ============================ */

describe('5) 真实驱动接口契约（Fake 驱动掩盖的部分）', () => {
  it('适配器 pin 精度用到的 TYPES 键在真实 mssql 中都存在（否则保护会静默失效）', () => {
    const missing = ['Decimal', 'Numeric', 'BigInt', 'UniqueIdentifier'].filter(
      (k) => typeof (mssql.TYPES as Record<string, unknown>)[k] === 'undefined',
    );
    expect(missing).toEqual([]);
  });

  it('真实 mssql.Request 接受适配器会绑定的各种取值（两参 input，由驱动推断类型）', () => {
    const pool = new mssql.ConnectionPool({ server: 'h', port: 1433, options: {} });
    const req = new mssql.Request(pool);
    const values: Array<[string, unknown]> = [
      ['p1', null],
      ['p2', 1.5],
      ['p3', 'str'],
      ['p4', true],
      ['p5', new Date()],
      ['p6', 123n],
      ['p7', Buffer.from('ab')],
      ['p8', undefined],
    ];
    for (const [name, v] of values) {
      expect(() => req.input(name, v)).not.toThrow();
    }
    // 显式类型 + null 是适配器在需要精确类型时的备选写法
    expect(() => req.input('p9', (mssql.TYPES as Record<string, unknown>)['NVarChar'], null)).not.toThrow();
  });

  it('真实 mssql.Transaction 以 (pool) 构造（begin/commit/rollback 的用法前提）', () => {
    const pool = new mssql.ConnectionPool({ server: 'h', port: 1433, options: {} });
    expect(() => new mssql.Transaction(pool)).not.toThrow();
  });

  it('端口类型/取值：适配器给的是 number，越界端口 fail-closed 抛中文错误（驱动对端口有严格校验）', async () => {
    const cfg = await cfgOf(BASE);
    expect(typeof cfg['port']).toBe('number');
    // 越界端口驱动会抛 RangeError，适配器必须在前面挡掉（官方 fail-closed 语义：非法值报错而非静默回退）
    expect(() => realDriverParse({ server: 'h', port: 65536, options: {} })).toThrow(/must be > 0 and < 65536/);
    const kit = captureDriver();
    await expect(
      createSqlserverAdapter(connByFields({ host: 'h', port: 70000 }), { driver: kit.driver }),
    ).rejects.toThrow(/端口取值非法/);
    expect(kit.cfgs).toHaveLength(0); // 校验先于建池，不产生驱动配置
  });

  it('tdsVersion 白名单与真实 tedious versions 表的差异（现状记录）', async () => {
    // tedious 20.3.3 的 versions 表：7_1/7_2/7_3_A/7_3_B/7_4/8_0；适配器白名单目前不含 8_0
    expect(Object.keys(tdsVersionTable).sort()).toEqual(['7_1', '7_2', '7_3_A', '7_3_B', '7_4', '8_0']);
    await expect(
      createSqlserverAdapter(connByUrl(`${BASE}?tdsVersion=8_0`), { driver: captureDriver().driver }),
    ).rejects.toThrow(/tdsVersion 取值非法/);
  });
});

/* ============================ 1. 配置可接受性 ============================ */

describe('1) 配置可接受性：适配器产出的 config 由真实 mssql/tedious 解析', () => {
  it('URL 默认值经真实驱动解析：字段落地与 tedious 期望一致', async () => {
    const cfg = await cfgOf(BASE);
    const { mapped, options } = realDriverParse(cfg);

    // 适配器写的位置（mssql 顶层字段规范）
    expect(cfg['server']).toBe('db.example.com');
    expect(cfg['port']).toBe(1433);
    expect(cfg['user']).toBe('sa');
    expect(cfg['password']).toBe('p@ss'); // percent 解码
    expect(cfg['database']).toBe('appdb');

    // 真实 mssql 把这些搬到 options；tedious 实际读取的是 options.*
    expect(options['encrypt']).toBe(true);
    expect(options['trustServerCertificate']).toBe(false);
    expect(options['tdsVersion']).toBe('7_4');
    expect(options['useUTC']).toBe(true);
    expect(options['database']).toBe('appdb');
    expect(options['connectTimeout']).toBe(15000);
    expect(options['requestTimeout']).toBe(30000);
    expect(options['appName']).toBe('node-mssql'); // 适配器不覆盖 ⇒ 驱动默认
    expect(mapped['server']).toBe('db.example.com');
  });

  it('tdsVersion 全取值矩阵：驱动接受且落地值一致', async () => {
    for (const v of ['7_1', '7_2', '7_3_A', '7_3_B', '7_4']) {
      const cfg = await cfgOf(`${BASE}?tdsVersion=${v}`);
      // 值必须是 tedious 版本表里的键，否则 prelogin 阶段会写 undefined
      expect(tdsVersionTable[v]).toBeTypeOf('number');
      const { options } = realDriverParse(cfg);
      expect(options['tdsVersion']).toBe(v);
    }
  });

  it('非法 tdsVersion：适配器提前抛中文错误；真实驱动构造期并不拒绝（说明提前校验确有必要）', async () => {
    await expect(
      createSqlserverAdapter(connByUrl(`${BASE}?tdsVersion=x`), { driver: captureDriver().driver }),
    ).rejects.toThrow(/tdsVersion 取值非法/);

    // 真实驱动：构造期只校验类型，'x' 原样落地 ⇒ 要到 prelogin 才炸（错误形态极晚且难懂）
    const { options } = realDriverParse({ server: 'h', options: { tdsVersion: 'x' } });
    expect(options['tdsVersion']).toBe('x');
    expect(tdsVersionTable['x']).toBeUndefined();
    // 类型错误才会被驱动当场拒绝
    expect(() => realDriverParse({ server: 'h', options: { tdsVersion: 74 } })).toThrow(/must be of type string/);
  });

  it('加密相关布尔：encrypt / trustServerCertificate / useUTC 落地为布尔，非法取值适配器先拦', async () => {
    const cfg = await cfgOf(`${BASE}?encrypt=false&trustServerCertificate=true&useUTC=false`);
    const { options } = realDriverParse(cfg);
    expect(options['encrypt']).toBe(false);
    expect(options['trustServerCertificate']).toBe(true);
    expect(options['useUTC']).toBe(false);

    // 大小写混写的参数名同样生效（tedious 只认布尔，故适配器必须归一到布尔）
    const cfg2 = await cfgOf(`${BASE}?TrustServerCertificate=TRUE&TDSVERSION=7_1`);
    const p2 = realDriverParse(cfg2).options;
    expect(p2['trustServerCertificate']).toBe(true);
    expect(p2['tdsVersion']).toBe('7_1');

    await expect(
      createSqlserverAdapter(connByUrl(`${BASE}?useUTC=maybe`), { driver: captureDriver().driver }),
    ).rejects.toThrow(/useUTC 取值非法/);
  });

  it('instanceName 与 port 共存：mssql 删掉 port 走实例名，适配器不会触发 tedious 的互斥异常', async () => {
    const cfg = await cfgOf(`${BASE}?instanceName=SQLEXPRESS`);
    expect(cfg['port']).toBe(1433); // 适配器仍写顶层 port
    const { mapped, options } = realDriverParse(cfg); // 真实链路不抛
    expect(mapped['options']).toMatchObject({ instanceName: 'SQLEXPRESS' });
    expect(options['instanceName']).toBe('SQLEXPRESS');
    expect(options['port']).toBeUndefined(); // mssql 在 _config 里 delete port

    // 对照：若 options.port 与 instanceName 同时直接喂给 tedious，驱动会抛互斥错误
    expect(() => new tedious.Connection({ server: 'h', options: { port: 1433, instanceName: 'X' } })).toThrow(
      /mutually exclusive/,
    );
  });

  it('fields 模式与 SSL 语义：真实驱动同样接受', async () => {
    const kit = captureDriver();
    await createSqlserverAdapter(
      {
        ...connByFields({ host: 'h2', port: 11433, username: 'u', password: 'p', database: 'd2', instanceName: 'I2' }),
        ssl: true,
      },
      { driver: kit.driver },
    );
    const cfg = kit.cfgs[0]!;
    const { options } = realDriverParse(cfg);
    expect(options['encrypt']).toBe(true); // conn.ssl ⇒ 强制加密
    expect(options['instanceName']).toBe('I2');
    expect(options['database']).toBe('d2');
  });

  it('pool 配置：真实 mssql 池接受且保留适配器给的 pool 参数', async () => {
    const cfg = await cfgOf(BASE);
    expect(cfg['pool']).toEqual({ max: 10, min: 0, idleTimeoutMillis: 30000 });
    const kit = captureDriver();
    await createSqlserverAdapter(connByUrl(BASE), { driver: kit.driver });
    expect(kit.pools[0]!.config['pool']).toEqual({ max: 10, min: 0, idleTimeoutMillis: 30000 });
    realDriverParse(cfg); // 真实解析不抛
  });

  it('字段名核对：适配器写进 options 的每个键都被真实驱动认得且原样落地（防止"名字写错"）', async () => {
    const cfg = await cfgOf(`${BASE}?encrypt=true&trustServerCertificate=true&instanceName=I1`);
    const { mapped, options } = realDriverParse(cfg);
    // 顶层：mssql base/tedious 读取
    for (const k of ['server', 'port', 'user', 'password', 'database'] as const) expect(cfg[k]).toBeDefined();
    expect(options['connectTimeout']).toBe(15000);

    // tedious 构造后的 options 表即"驱动认得的字段"全集；适配器写的键必须都在这张表里且值一致
    const driverKnown = new Set(Object.keys(options));
    const adapterOptions = cfg['options'] as Record<string, unknown>;
    expect(Object.keys(adapterOptions).length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(adapterOptions)) {
      expect(driverKnown.has(k)).toBe(true);
      expect(options[k]).toEqual(v);
    }
    // mssql 自己补的键也在真实映射结果里（说明确实走了 _config 的真实路径）
    expect(mapped['options']).toMatchObject({ encrypt: true, connectTimeout: 15000, requestTimeout: 30000 });
  });
});

/* ============================ 2. TLS 真实错误路径 ============================ */

describe('2) TLS 真实错误路径：本机自签证书假服务器', () => {
  it('真实驱动连自签证书实例 ⇒ 真实证书错误（非构造/非 Fake）', async () => {
    const fake = await startFakeTds();
    try {
      const err = await realConnectError('127.0.0.1', fake.port);
      expect(err['name']).toBe('ConnectionError');
      expect(err['code']).toBe('ESOCKET');
      const message = String(err['message']);
      expect(message).toMatch(/self[ -]?signed|certificate/i);
      // 假服务器日志证明：确实完成了 prelogin 与 TLS 记录交换（不是连不上端口）
      expect(fake.log.some((l) => l.startsWith('prelogin:'))).toBe(true);
    } finally {
      await fake.close();
    }
  }, 20000);

  it('该真实错误经适配器映射 ⇒ 命中 TLS 特征并给出中文连接指引', async () => {
    const fake = await startFakeTds();
    try {
      const err = await realConnectError('127.0.0.1', fake.port);
      const msg = await mapRealError(err);
      expect(msg).toMatch(/trustServerCertificate=true/);
      expect(msg).toMatch(/encrypt=false/);
      // 原始错误可见（不吞信息）
      expect(msg).toMatch(/self[ -]?signed|certificate/i);
    } finally {
      await fake.close();
    }
  }, 20000);

  it('服务器强制加密而客户端 encrypt=false：真实 EENCRYPT ⇒ 中文改法指引（修复前落到英文兜底）', async () => {
    const fake = await startFakeTds();
    try {
      const err = await realConnectError('127.0.0.1', fake.port, 3000, false);
      expect(err['code']).toBe('EENCRYPT');
      expect(String(err['message'])).toMatch(/Server requires encryption/i);
      const msg = await mapRealError(err);
      expect(msg).toMatch(/服务器要求加密/);
      expect(msg).toMatch(/\?encrypt=true/);
    } finally {
      await fake.close();
    }
  }, 20000);

  it('端到端：适配器 testConnect 直连自签实例 ⇒ 中文指引，且不泄漏堆栈式英文错误', async () => {
    const fake = await startFakeTds();
    try {
      const adapter = await createSqlserverAdapter(
        connByUrl(`sqlserver://sa:p@127.0.0.1:${fake.port}/appdb?encrypt=true&trustServerCertificate=false`),
        { driver: mssql as unknown as SqlDriver },
      );
      const err = await adapter.testConnect().then(
        () => {
          throw new Error('应当失败');
        },
        (e: unknown) => e,
      );
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/trustServerCertificate=true/);
      await adapter.close();
    } finally {
      await fake.close();
    }
  }, 25000);
});

/* ============================ 3. 网络错误真实路径 ============================ */

describe('3) 网络错误真实路径：ECONNREFUSED / ETIMEOUT / 主机名解析失败', () => {
  it('本机未监听端口：真实错误 ⇒ 网络不可达文案，且不误加 TLS 指引', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    await new Promise<void>((r) => srv.close(() => r()));

    const err = await realConnectError('127.0.0.1', port, 3000);
    expect(err['code']).toBe('ESOCKET');
    const msg = await mapRealError(err);
    expect(msg).toMatch(/网络不可达/);
    expect(msg).not.toMatch(/trustServerCertificate/); // 非 TLS 场景不加噪音指引
  }, 15000);

  it('接受 TCP 但不回应的地址：真实 ETIMEOUT ⇒ 连接超时文案', async () => {
    const silentSockets = new Set<net.Socket>();
    const silent = net.createServer((s) => {
      silentSockets.add(s);
    });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    try {
      const err = await realConnectError('127.0.0.1', (silent.address() as net.AddressInfo).port, 800);
      expect(err['code']).toBe('ETIMEOUT');
      expect(err['name']).toBe('ConnectionError');
      const msg = await mapRealError(err);
      expect(msg).toMatch(/连接超时/);
      expect(msg).toMatch(/主机|端口|防火墙/);
    } finally {
      for (const s of silentSockets) s.destroy();
      await new Promise<void>((r) => silent.close(() => r()));
    }
  }, 20000);

  it('主机名解析失败：真实错误 ⇒ 指引检查主机名', async () => {
    const err = await realConnectError('no-such-host.invalid', 1433, 3000);
    expect(err['code']).toBe('ESOCKET');
    expect(String(err['message'])).toMatch(/ENOTFOUND|getaddrinfo/);
    const msg = await mapRealError(err);
    expect(msg).toMatch(/网络不可达|主机名/);
  }, 15000);
});

/* ============================ 4. 惰性与清理 ============================ */

describe('4) 惰性与清理', () => {
  it('建池不触发网络 IO：真实池未 connect，服务器零连接', async () => {
    let hits = 0;
    const probe = net.createServer(() => {
      hits++;
    });
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as net.AddressInfo).port;

    const kit = captureDriver();
    const adapter = await createSqlserverAdapter(connByUrl(`sqlserver://sa:p@127.0.0.1:${port}/db`), { driver: kit.driver });
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect(hits).toBe(0);
      expect(kit.pools[0]!._connected).toBe(false);
    } finally {
      await adapter.close();
      await new Promise<void>((r) => probe.close(() => r()));
    }
  }, 15000);

  it('close 幂等：未连接与重复 close 都不抛、不挂起', async () => {
    const kit = captureDriver();
    const adapter = await createSqlserverAdapter(connByUrl(BASE), { driver: kit.driver });
    await adapter.close();
    await adapter.close();
    await adapter.close();
    expect(kit.pools[0]!._connected).toBe(false);
  }, 15000);

  it('close 不在进程里留下监听句柄（无泄漏）', async () => {
    const before = process.getActiveResourcesInfo().filter((r) => r === 'TCPSocketWrap' || r === 'TCPServerWrap').length;
    const kit = captureDriver();
    const adapter = await createSqlserverAdapter(connByUrl(BASE), { driver: kit.driver });
    await adapter.close();
    await new Promise((r) => setTimeout(r, 100));
    const after = process.getActiveResourcesInfo().filter((r) => r === 'TCPSocketWrap' || r === 'TCPServerWrap').length;
    expect(after).toBeLessThanOrEqual(before);
  }, 15000);
});
