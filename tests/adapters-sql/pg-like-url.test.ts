/**
 * GaussDB 多主机 / JDBC 风格 URL 修复的单测（离线可跑）：
 * - normalizeUrl：解析与还原不变式（jdbc: 前缀、多主机 authority、userinfo、边界）；
 * - pickHost：fake 驱动逐台探测（失败换台、备节点跳过、全败回退、end 必调）；
 * - createPgLikeAdapter 接线：多主机选台后主池/跨库池 connectionString、全败回退、postgresql 不 probe。
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  createPgLikeAdapter,
  normalizeUrl,
  pgCfgWithDatabase,
  pickHost,
  type PgLikeDriver,
  type PgLikePool,
  type PgLikeProbeClient,
  type PgLikeResult,
} from '../../lib/adapters/sql-shared/pg-like.js';

/** pickHost 用的探测客户端：connect/query/end 行为可注入 */
class FakeProbeClient implements PgLikeProbeClient {
  ended = 0;
  queries: string[] = [];
  constructor(
    public config: Record<string, unknown>,
    private opts: { failConnect?: boolean; inRecovery?: boolean } = {},
  ) {}
  async connect() {
    if (this.opts.failConnect) throw new Error(`ECONNREFUSED ${String(this.config.host)}`);
  }
  async query(sql: string): Promise<PgLikeResult> {
    this.queries.push(sql);
    return { rows: [{ in_recovery: this.opts.inRecovery === true }], rowCount: 1 };
  }
  async end() {
    this.ended++;
  }
}

/** 记录型探测驱动：按台序出队行为脚本（脚本越界 = 连接成功且非备节点）；pickHost 不用 Pool */
function probeDriver(scripts: { failConnect?: boolean; inRecovery?: boolean }[]) {
  const clients: FakeProbeClient[] = [];
  const driver = {
    Client: function (config: Record<string, unknown>) {
      const c = new FakeProbeClient(config, scripts[clients.length]);
      clients.push(c);
      return c;
    },
  } as unknown as PgLikeDriver;
  return { driver, clients };
}

describe('normalizeUrl', () => {
  it('验收 URL：三主机 gaussdb 多端口（逐字用例），prefix/hosts/suffix 与逐台重组', () => {
    const url = 'gaussdb://10.192.37.217:8000,10.192.37.216:8000,10.192.37.218:8000/gycwd?';
    const n = normalizeUrl(url);
    expect(n.prefix).toBe('gaussdb://');
    expect(n.suffix).toBe('/gycwd?'); // 尾随空 query 原样保留
    expect(n.hosts).toEqual([
      { host: '10.192.37.217', port: 8000 },
      { host: '10.192.37.216', port: 8000 },
      { host: '10.192.37.218', port: 8000 },
    ]);
    // 还原不变式：prefix + hosts 逐台重组 + suffix === 原始串
    expect(n.prefix + n.hosts!.map((h) => `${h.host}:${h.port}`).join(',') + n.suffix).toBe(url);
  });

  it('jdbc: 前缀剥除（大小写不敏感）', () => {
    for (const head of ['jdbc:', 'JDBC:', 'Jdbc:']) {
      const n = normalizeUrl(`${head}gaussdb://h1:8000,h2:8000/gycwd`);
      expect(n.prefix).toBe('gaussdb://');
      expect(n.hosts).toEqual([{ host: 'h1', port: 8000 }, { host: 'h2', port: 8000 }]);
      expect(n.suffix).toBe('/gycwd');
      expect(n.prefix + n.hosts!.map((h) => `${h.host}:${h.port}`).join(',') + n.suffix).toBe(
        'gaussdb://h1:8000,h2:8000/gycwd',
      );
    }
  });

  it('userinfo 原样保留（不编码），按最后一个 @ / 最后一个 : 分界，解码互逆', () => {
    const n = normalizeUrl('jdbc:gaussdb://ops:p%40ss@h1:8000,h2:8000/db?ssl=true');
    expect(n.prefix).toBe('gaussdb://ops:p%40ss@');
    expect(n.hosts).toEqual([{ host: 'h1', port: 8000 }, { host: 'h2', port: 8000 }]);
    expect(n.suffix).toBe('/db?ssl=true');
    // decode 与 percent-encode 注入互逆：p%40ss → p@ss
    expect(decodeURIComponent(n.prefix.slice('gaussdb://'.length).split(':')[1]!.replace(/@$/, ''))).toBe('p@ss');
    // 密码含裸 @ 时按最后一个 @ 分界不串台
    const bare = normalizeUrl('gaussdb://u:p@x@h1:8000,h2:8000/db');
    expect(bare.prefix).toBe('gaussdb://u:p@x@');
    expect(bare.hosts).toEqual([{ host: 'h1', port: 8000 }, { host: 'h2', port: 8000 }]);
  });

  it('单主机：hosts 不设，prefix 含完整 authority', () => {
    const n = normalizeUrl('gaussdb://h1:8000/gycwd');
    expect(n.hosts).toBeUndefined();
    expect(n.prefix).toBe('gaussdb://h1:8000');
    expect(n.suffix).toBe('/gycwd');
    expect(n.prefix + n.suffix).toBe('gaussdb://h1:8000/gycwd');
  });

  it('无 ://（无 authority）：原样返回，hosts 不设', () => {
    const n = normalizeUrl('jdbc:gaussdb:h1:8000/gycwd');
    expect(n).toEqual({ prefix: 'gaussdb:h1:8000/gycwd', suffix: '' });
    expect(n.hosts).toBeUndefined();
  });

  it('边界：无 path 的 ?、# 结尾、无端口段', () => {
    const q = normalizeUrl('gaussdb://h1:8000,h2:8000?a=b');
    expect(q.hosts).toEqual([{ host: 'h1', port: 8000 }, { host: 'h2', port: 8000 }]);
    expect(q.suffix).toBe('?a=b');
    const h = normalizeUrl('gaussdb://h1,h2/db#frag');
    expect(h.hosts).toEqual([{ host: 'h1' }, { host: 'h2' }]);
    expect(h.suffix).toBe('/db#frag');
  });
});

describe('pickHost', () => {
  const hosts = [
    { host: 'h1', port: 8000 },
    { host: 'h2', port: 8000 },
    { host: 'h3', port: 8000 },
  ];
  const base: Record<string, unknown> = {
    connectionString: 'will-be-cleared',
    ssl: { rejectUnauthorized: false },
    urlUser: 'ops',
    urlPassword: 'pw',
  };

  it('第 1 台 connect 失败换第 2 台成功；已试过的台 end 被调用', async () => {
    const { driver, clients } = probeDriver([{ failConnect: true }]);
    const picked = await pickHost(driver, base, hosts, false);
    expect(picked).toEqual({ host: 'h2', port: 8000 });
    expect(clients.length).toBe(2); // 第 3 台不再创建
    expect(clients[0]!.ended).toBe(1);
    expect(clients[1]!.ended).toBe(1); // 成功台探测完同样 end
    // 逐台配置：connectionString 清空、host/port 逐台、凭据自 base.urlUser/urlPassword 解出
    expect(clients[0]!.config).toEqual({
      connectionString: undefined,
      ssl: base.ssl,
      host: 'h1',
      port: 8000,
      user: 'ops',
      password: 'pw',
    });
  });

  it('masterOnly：in_recovery=true 备节点跳过，选下一台', async () => {
    const { driver, clients } = probeDriver([{ inRecovery: true }]);
    const picked = await pickHost(driver, base, hosts, true);
    expect(picked).toEqual({ host: 'h2', port: 8000 });
    expect(clients[0]!.queries).toContain('SELECT pg_is_in_recovery() AS in_recovery');
    expect(clients[0]!.ended).toBe(1);
    expect(clients[1]!.queries).toContain('SELECT pg_is_in_recovery() AS in_recovery');
  });

  it('masterOnly=false 不发 pg_is_in_recovery 查询，首台可用即返回', async () => {
    const { driver, clients } = probeDriver([{ inRecovery: true }]); // 即便第 1 台是备也不查
    const picked = await pickHost(driver, base, hosts, false);
    expect(picked).toEqual({ host: 'h1', port: 8000 });
    expect(clients[0]!.queries).toEqual([]);
  });

  it('全部失败返回 undefined；每台 end 被调用；无凭据时 user/password 不设', async () => {
    const { driver, clients } = probeDriver([{ failConnect: true }, { failConnect: true }, { failConnect: true }]);
    const picked = await pickHost(
      driver,
      { host: 'x', urlUser: undefined, urlPassword: undefined },
      hosts,
      false,
    );
    expect(picked).toBeUndefined();
    expect(clients.length).toBe(3);
    expect(clients.map((c) => c.ended)).toEqual([1, 1, 1]);
    expect('user' in clients[0]!.config).toBe(false);
    expect('password' in clients[0]!.config).toBe(false);
  });

  it('驱动未导出 Client 时防御性返回 undefined', async () => {
    const picked = await pickHost({} as PgLikeDriver, base, hosts, false);
    expect(picked).toBeUndefined();
  });
});

describe('pgCfgWithDatabase（覆盖库名：connectionString 解析值覆盖显式字段的驱动合并语义）', () => {
  it('URL 形态：改写 path 段为目标库，scheme/userinfo/hosts/query 原样保留；无 path 时补 /db', () => {
    expect(pgCfgWithDatabase({ connectionString: 'postgres://u:p@h1:5432/appdb', max: 10 }, 'other')).toEqual({
      connectionString: 'postgres://u:p@h1:5432/other',
      max: 10,
    });
    // 多台 hosts 与 query 原样保留（探测选定台后的 connectionString 形态）
    expect(pgCfgWithDatabase({ connectionString: 'postgres://h1:5432,h2:5433/db?sslmode=require' }, 'x')).toEqual({
      connectionString: 'postgres://h1:5432,h2:5433/x?sslmode=require',
    });
    expect(pgCfgWithDatabase({ connectionString: 'postgres://u:p@h1:5432' }, 'other')).toEqual({
      connectionString: 'postgres://u:p@h1:5432/other',
    });
  });

  it('写回库名 percent-encode，与驱动 parse 的 decodeURI 往返无损（pg/gaussdb 实测 parse(\'.../a%20b\') → \'a b\'）', () => {
    const r = pgCfgWithDatabase({ connectionString: 'postgres://h1/db' }, 'a b');
    expect(r.connectionString).toBe('postgres://h1/a%20b');
    const parse = createRequire(import.meta.url)('pg-connection-string').parse as (s: string) => { database?: string };
    expect(parse(String(r.connectionString)).database).toBe('a b');
  });

  it('字段形态：叠加 database；无 authority 的 connectionString 不产生垃圾改写', () => {
    expect(pgCfgWithDatabase({ host: 'h', port: 5432 }, 'other')).toEqual({ host: 'h', port: 5432, database: 'other' });
    expect(pgCfgWithDatabase({ connectionString: 'unix:/run/pg', max: 4 }, 'other')).toEqual({
      connectionString: 'unix:/run/pg',
      max: 4,
      database: 'other',
    });
  });
});

/** createPgLikeAdapter 接线用的池：记录每次建池配置，其余行为最小化 */
class SilentPool implements PgLikePool {
  on() {
    return this;
  }
  async query(): Promise<PgLikeResult> {
    return { rows: [], rowCount: null };
  }
  async connect(): Promise<never> {
    throw new Error('测试不应从池取连接');
  }
  async end() {}
}

describe('createPgLikeAdapter 多主机接线', () => {
  /** fake 驱动：Pool 记录配置，Client 按脚本逐台探测 */
  function multiHostDriver(scripts: { failConnect?: boolean; inRecovery?: boolean }[]) {
    const pool = new SilentPool();
    const configs: Record<string, unknown>[] = [];
    const probeClients: FakeProbeClient[] = [];
    const driver: PgLikeDriver = {
      Pool: function (config: Record<string, unknown>) {
        configs.push(config ?? {});
        return pool;
      } as unknown as PgLikeDriver['Pool'],
      Client: function (config: Record<string, unknown>) {
        const c = new FakeProbeClient(config, scripts[probeClients.length]);
        probeClients.push(c);
        return c;
      } as unknown as PgLikeDriver['Client'],
    };
    return { driver, configs, probeClients };
  }

  it('gaussdb 多主机：probe 选可用台，主池 connectionString 指向它；连接自身库不另建池', async () => {
    const { driver, configs, probeClients } = multiHostDriver([{ failConnect: true }]);
    const a = await createPgLikeAdapter('gaussdb', driver, {
      meta: { id: 'c1', kind: 'gaussdb' },
      url: 'jdbc:gaussdb://h1:8000,h2:8000/gycwd?',
    });
    expect(probeClients.length).toBe(2);
    expect(probeClients[0]!.ended).toBe(1);
    expect(probeClients[1]!.ended).toBe(1);
    // 无 targetServerType=master → 不发恢复查询
    expect(probeClients[0]!.queries).toEqual([]);
    expect(configs[0]!.connectionString).toBe('gaussdb://h2:8000/gycwd?');
    // mainDb 基于规范化后的最终 URL：gycwd 是连接自身库，跨库访问不建第二池
    await a.listSchemas!('gycwd');
    expect(configs.length).toBe(1);
    await a.close();
  });

  it('targetServerType=master：备节点被跳过；userinfo 凭据解出传给探测，最终 URL 保留原样 userinfo', async () => {
    const { driver, configs, probeClients } = multiHostDriver([{ inRecovery: true }]);
    const a = await createPgLikeAdapter('gaussdb', driver, {
      meta: { id: 'c2', kind: 'gaussdb' },
      url: 'jdbc:gaussdb://ops:p%40ss@h1:8000,h2:8000/gycwd?TargetServerType=MASTER',
    });
    // 第 1 台是备节点：发过恢复查询后被跳过
    expect(probeClients[0]!.queries).toContain('SELECT pg_is_in_recovery() AS in_recovery');
    expect(probeClients[0]!.config).toMatchObject({ user: 'ops', password: 'p@ss', host: 'h1', port: 8000 });
    expect(configs[0]!.connectionString).toBe(
      'gaussdb://ops:p%40ss@h2:8000/gycwd?TargetServerType=MASTER',
    );
    await a.close();
  });

  it('全部失败回退首台重组值（testConnect 报真实连接错误）', async () => {
    const { driver, configs, probeClients } = multiHostDriver([{ failConnect: true }, { failConnect: true }]);
    const a = await createPgLikeAdapter('gaussdb', driver, {
      meta: { id: 'c3', kind: 'gaussdb' },
      url: 'jdbc:gaussdb://h1:8000,h2:8000/gycwd',
    });
    expect(probeClients.map((c) => c.ended)).toEqual([1, 1]);
    expect(configs[0]!.connectionString).toBe('gaussdb://h1:8000/gycwd');
    await a.close();
  });

  it('postgresql 多主机同样逐台探测（纯 JS pg 驱动无 libpq 多主机 failover：带端口多台 parse 抛 Invalid URL）', async () => {
    const { driver, configs, probeClients } = multiHostDriver([{ failConnect: true }]);
    const a = await createPgLikeAdapter('postgresql', driver, {
      meta: { id: 'c4', kind: 'postgresql' },
      url: 'postgres://h1:5432,h2:5432/db',
    });
    expect(probeClients.length).toBe(2); // 第 1 台失败换第 2 台
    expect(probeClients[0]!.ended).toBe(1);
    expect(probeClients[1]!.ended).toBe(1);
    expect(configs[0]!.connectionString).toBe('postgres://h2:5432/db');
    await a.close();
  });
});
