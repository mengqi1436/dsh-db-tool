/**
 * rc.3 服务端契约：trustedHosts 来源切换 + 监听 bind 地址放行。
 *
 * 背景（DSH 0.2.1-rc.3）：
 *  - 宿主只 provide webApp/webStartup，从不注册 webRuntime（rc.2、rc.3 内均 0 命中）；
 *    信任权威在 webStartup.trustedHosts（本插件此前读 webRuntime 恒空）；
 *  - 宿主 Connection 另单独接受「监听 bind 地址」（isBindAddressAuthority 语义）。
 * 本插件在 lib/index.ts 里做本地兜底：webStartup 优先、webRuntime 回退；
 * 仅当 webStartup 存在（rc.3）时把 bind 地址补进 trustedHosts，且只补具体单播
 * 字面量——wildcard（0.0.0.0 / :: / *）与 loopback 一律跳过，避免放宽 DNS rebinding。
 *
 * 这些用例锁住上述行为，防止把 wildcard 误当 bind 地址放行（重点回归项）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { apply, inject } from '../../lib/index.js';

interface Route {
  kind: string;
  path: string;
  handler: (req: unknown, res: unknown) => Promise<void> | void;
}

interface EffectRecord {
  name?: string;
  dispose: () => void;
}

interface ToolRegistration {
  name: string;
  timeoutMs?: number;
  description: string;
  parameters: {
    type?: string;
    properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
    required?: string[];
  };
  output?: { schema?: { required?: string[] } };
  execute?: (...args: unknown[]) => Promise<unknown>;
}

interface CtxOptions {
  /** ctx.get(name, strict) 的返回值集合（模拟可选服务） */
  services?: Record<string, unknown>;
  /** ctx.webServer.host / port（模拟监听地址） */
  host?: string;
  port?: number;
  /** ctx.connection.requestRejection 的返回值（宿主鉴权栅栏） */
  rejection?: 401 | 403 | undefined;
}

interface FakeRes {
  statusCode: number;
  ended: boolean;
  headers: Record<string, string>;
  body: string;
  writeHead(code: number): void;
  setHeader(k: string, v: string): void;
  end(chunk?: unknown): void;
}

function makeRes(): FakeRes {
  return {
    statusCode: 0,
    ended: false,
    headers: {},
    body: '',
    writeHead(code) {
      this.statusCode = code;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(chunk) {
      this.ended = true;
      if (typeof chunk === 'string') this.body = chunk;
    },
  };
}

function makeCtx(options: CtxOptions = {}) {
  const routes: Route[] = [];
  const effects: EffectRecord[] = [];
  const tools: ToolRegistration[] = [];
  const canceled: string[] = [];

  const ctx = {
    webServer: {
      host: options.host,
      port: options.port,
      register: (h: Route) => {
        routes.push(h);
        return () => {
          canceled.push('route');
        };
      },
    },
    sessions: { get: () => ({ header: { cwd: path.join(os.tmpdir(), 'dbtool-proj') } }) },
    tools: {
      register: (t: ToolRegistration) => {
        tools.push(t);
      },
    },
    connection: { requestRejection: () => options.rejection },
    get: (name: string) => options.services?.[name],
    // 模拟 cordis 的 ctx.effect：立即执行并由 disposer 记录注销函数
    effect: (fn: () => () => void, name?: string) => {
      const dispose = fn();
      effects.push({ name, dispose });
    },
    logger: { info: () => {}, error: () => {} },
  };

  return { ctx, routes, effects, tools, canceled };
}

/** apply 后在 prefix handler 上发一个请求 */
async function request(options: CtxOptions, req: Record<string, unknown>) {
  const { ctx, routes, effects, tools, canceled } = makeCtx(options);
  apply(ctx as never);
  expect(routes).toHaveLength(1);
  const res = makeRes();
  await routes[0]!.handler(req, res);
  return { res, routes, effects, tools, canceled };
}

function optionsReq(host: string, origin?: string) {
  const headers: Record<string, string> = { host };
  if (origin !== undefined) headers.origin = origin;
  return { method: 'OPTIONS', url: '/dsh-db-tool/api/connections', headers };
}

let home = '';
let prevHome: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dbtool-rc3-trust-'));
  prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('rc.3 trustedHosts 来源（webStartup 优先 / webRuntime 回退）', () => {
  it('webStartup.trustedHosts 命中 Host/Origin 时放行（rc.3 新来源）', async () => {
    const { res } = await request(
      { services: { webStartup: { trustedHosts: ['192.168.1.5:3080'] } } },
      optionsReq('192.168.1.5:3080', 'http://192.168.1.5:3080'),
    );
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('只有 webRuntime.trustedHosts（无 webStartup）时同样放行（旧宿主回退）', async () => {
    const { res } = await request(
      { services: { webRuntime: { trustedHosts: ['192.168.1.5:3080'] } } },
      optionsReq('192.168.1.5:3080', 'http://192.168.1.5:3080'),
    );
    expect(res.statusCode).toBe(204);
  });

  it('旧宿主不补 bind 地址：webRuntime 在、webStartup 缺失时 bind 地址不放行', async () => {
    const { res } = await request(
      {
        services: { webRuntime: { trustedHosts: [] } },
        host: '10.0.0.9',
        port: 3080,
      },
      optionsReq('10.0.0.9:3080'),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FORBIDDEN');
  });

  it('两个服务都缺失：LAN Host 403，loopback Host 放行', async () => {
    const lan = await request({ services: {} }, optionsReq('192.168.1.5:3080'));
    expect(lan.res.statusCode).toBe(403);
    expect(JSON.parse(lan.res.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const loopback = await request({ services: {} }, optionsReq('127.0.0.1:55606'));
    expect(loopback.res.statusCode).toBe(204);
  });
});

describe('rc.3 bind 地址放行（isBindAddressAuthority 语义的本地兜底）', () => {
  it('webServer.host 为具体单播地址时，bind 地址（含/不含端口）都放行', async () => {
    const withPort = await request(
      { services: { webStartup: {} }, host: '192.168.1.5', port: 3080 },
      optionsReq('192.168.1.5:3080'),
    );
    expect(withPort.res.statusCode).toBe(204);

    const bare = await request(
      { services: { webStartup: {} }, host: '192.168.1.5', port: 3080 },
      optionsReq('192.168.1.5'),
    );
    expect(bare.res.statusCode).toBe(204);
  });

  it.each([
    ['0.0.0.0', '0.0.0.0:3080'],
    ['::', '[::]:3080'],
    ['*', '0.0.0.0:3080'],
  ])('wildcard bind 地址 %s 不放宽：同 Host %s 必须 403（重点回归项）', async (bindHost, requestHost) => {
    const { res } = await request(
      { services: { webStartup: {} }, host: bindHost, port: 3080 },
      optionsReq(requestHost),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('bind 地址不放宽到任意主机：Host=evil.example:3080 仍 403', async () => {
    const { res } = await request(
      { services: { webStartup: {} }, host: '192.168.1.5', port: 3080 },
      optionsReq('evil.example:3080'),
    );
    expect(res.statusCode).toBe(403);
  });

  it.each(['::1', '::ffff:127.0.0.1', '127.0.0.1', '127.0.0.5'])(
    'loopback bind 地址 %s 不补进 trustedHosts（非 loopback Host 仍 403）',
    async (bindHost) => {
      // 这些地址本身就是 loopback：若被当 bind 权威补进 trustedHosts，会放宽 DNS rebinding 攻击面
      const lan = await request(
        { services: { webStartup: {} }, host: bindHost, port: 3080 },
        optionsReq('evil.example:3080'),
      );
      expect(lan.res.statusCode, bindHost).toBe(403);
    },
  );

  it('bind host 非 IP 字面量（主机名）不补进 trustedHosts', async () => {
    const { res } = await request(
      { services: { webStartup: {} }, host: 'my-host.local', port: 3080 },
      optionsReq('my-host.local:3080'),
    );
    expect(res.statusCode).toBe(403);
  });

  it('bind 端口非法（0 / 负数 / NaN）时只补裸主机名，仍可按 hostname 命中', async () => {
    for (const port of [0, -1, Number.NaN]) {
      // 裸主机名进 trustedHosts；带端口的 Host 经 `e === url.hostname` 分支命中
      const bare = await request(
        { services: { webStartup: {} }, host: '192.168.1.5', port },
        optionsReq('192.168.1.5'),
      );
      expect(bare.res.statusCode, 'port=' + port).toBe(204);
      const withPort = await request(
        { services: { webStartup: {} }, host: '192.168.1.5', port },
        optionsReq('192.168.1.5:3080'),
      );
      expect(withPort.res.statusCode, 'port=' + port).toBe(204);
      // 但绝不放宽到无关主机
      const evil = await request(
        { services: { webStartup: {} }, host: '192.168.1.5', port },
        optionsReq('evil.example:3080'),
      );
      expect(evil.res.statusCode, 'port=' + port).toBe(403);
    }
  });

  it('bind host 为 IPv6 单播时补带方括号的 host:port 形态', async () => {
    const withPort = await request(
      { services: { webStartup: {} }, host: 'fd00::1', port: 3080 },
      optionsReq('[fd00::1]:3080'),
    );
    expect(withPort.res.statusCode).toBe(204);
  });
});

describe('宿主 Connection 栅栏（requestRejection 兜底）', () => {
  it('返回 401 时 handler 直接写出 JSON（不进入 http 层）', async () => {
    const { res } = await request({ services: {}, rejection: 401 }, optionsReq('127.0.0.1:55606'));
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/json');
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('返回 403 时 handler 直接写出 JSON', async () => {
    const { res } = await request({ services: {}, rejection: 403 }, optionsReq('127.0.0.1:55606'));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('返回 undefined 时继续走本地 trust 校验（loopback 放行）', async () => {
    const { res } = await request({ services: {}, rejection: undefined }, optionsReq('127.0.0.1:55606'));
    expect(res.statusCode).toBe(204);
  });
});

describe('注册契约快照（tools / inject / effect 注销）', () => {
  it('DatabaseManager 工具参数结构与 inject 清单', async () => {
    const { tools } = await request({ services: {} }, optionsReq('127.0.0.1:55606'));

    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.name).toBe('DatabaseManager');
    expect(tool.timeoutMs).toBe(90_000);
    expect(typeof tool.execute).toBe('function');

    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.required).toEqual(['action']);
    expect(tool.parameters.properties?.action?.enum).toEqual([
      'list_connections',
      'query',
      'execute',
      'schema',
      'preview',
      'run_script',
    ]);
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual([
      'action',
      'conn_id',
      'sql',
      'statement',
      'params',
      'database',
      'table',
      'limit',
      'offset',
      'code',
      'challenge_id',
    ]);
    expect(tool.output?.schema?.required).toEqual(['text']);

    expect(inject).toEqual(['webServer', 'sessions', 'tools', 'connection']);
    expect(inject).not.toContain('webRuntime');
  });

  it('prefix 路由注册参数与两个 effect 的注销 disposer', async () => {
    const { routes, effects, canceled } = await request({ services: {} }, optionsReq('127.0.0.1:55606'));

    expect(routes[0]?.kind).toBe('prefix');
    expect(routes[0]?.path).toBe('/dsh-db-tool/api');

    const apiEffect = effects.find((e) => e.name === 'db-tool-api');
    const disposeEffect = effects.find((e) => e.name === 'db-tool-dispose');
    expect(apiEffect).toBeDefined();
    expect(disposeEffect).toBeDefined();

    // 路由注销：调用 db-tool-api 的 disposer 应触发 webServer.register 返回的注销函数
    expect(canceled).toEqual([]);
    apiEffect!.dispose();
    expect(canceled).toEqual(['route']);

    // 服务收尾：dispose 不抛错（适配器/定时器清理）
    expect(() => disposeEffect!.dispose()).not.toThrow();
  });
});
