/**
 * 插件入口 Connection 鉴权栅栏测试（0.2.0-rc.1 适配）：
 * - ctx.connection.requestRejection 在 handler 顶层应用，401/403 时兜底写 JSON 响应；
 * - undefined 放行 → 进入 handleDbToolRequest（本地 trust 校验仍在）；
 * - 宿主无 connection 服务 → 回退本地 trust 校验；
 * - inject 清单含 'connection'。
 */
import { describe, expect, it, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { apply, inject } from '../../lib/index.js';

const homes: string[] = [];
const disposers: Array<() => void> = [];

afterAll(() => {
  for (const d of disposers) {
    try {
      d();
    } catch {
      /* 清理失败不影响测试结果 */
    }
  }
  for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
});

function mockReq(
  url: string,
  headers: Record<string, string> = { host: '127.0.0.1' },
  opts: { method?: string; body?: unknown } = {},
): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = headers;
  (req as unknown as { method: string }).method = opts.method ?? 'GET';
  (req as unknown as { url: string }).url = url;
  // readBody 超限时会 req.destroy()；EventEmitter 形态需补空实现
  (req as unknown as { destroy: () => void }).destroy = () => {};
  queueMicrotask(() => {
    if (opts.body !== undefined) (req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(opts.body)));
    (req as unknown as EventEmitter).emit('end');
  });
  return req;
}

class MockRes {
  statusCode = 200;
  body = '';
  setHeader(): void {}
  writeHead(status: number): this {
    this.statusCode = status;
    return this;
  }
  end(chunk?: string): this {
    if (chunk !== undefined) this.body += chunk;
    return this;
  }
}

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

/** 构建最小 DSH ctx：捕获 prefix 注册对象，effect 工厂立即执行并收集 disposer */
function makeCtx(opts: {
  rejection?: (req: unknown) => 401 | 403 | undefined;
  sessionsGet?: (id: string) => unknown;
}): Handler {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-fence-'));
  homes.push(home);
  process.env.DSH_HOME = home;
  const registrations: Array<{ kind?: string; path?: string; handler: Handler }> = [];
  const ctx = {
    webServer: {
      register: (h: { kind?: string; path?: string; handler: Handler }) => {
        registrations.push(h);
        return () => {};
      },
    },
    sessions: { get: opts.sessionsGet ?? (() => ({ header: { cwd: path.join(home, 'proj') } })) },
    tools: { register: () => {} },
    webRuntime: { trustedHosts: [] },
    connection: opts.rejection ? { requestRejection: opts.rejection } : undefined,
    effect: (fn: () => () => void) => {
      disposers.push(fn());
    },
  };
  apply(ctx as Parameters<typeof apply>[0]);
  expect(registrations.length).toBe(1);
  // 挂载形态契约：必须以 prefix 挂在 /dsh-db-tool/api 下
  expect(registrations[0]!.kind).toBe('prefix');
  expect(registrations[0]!.path).toBe('/dsh-db-tool/api');
  return registrations[0]!.handler;
}

describe('插件入口 Connection 鉴权栅栏', () => {
  it('inject 清单含 connection', () => {
    expect(inject).toContain('connection');
  });

  it('requestRejection=403 → 兜底写 403 JSON，不进入业务 handler', async () => {
    const handler = makeCtx({ rejection: () => 403 });
    const res = new MockRes();
    await handler(mockReq('/dsh-db-tool/api/state'), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(403);
    const json = JSON.parse(res.body) as { ok: boolean; code: string; error: string };
    expect(json.ok).toBe(false);
    expect(json.code).toBe('FORBIDDEN');
    expect(json.error).toBe('forbidden: untrusted request');
  });

  it('requestRejection=401 → 兜底写 401 JSON', async () => {
    const handler = makeCtx({ rejection: () => 401 });
    const res = new MockRes();
    await handler(mockReq('/dsh-db-tool/api/state'), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body) as { code: string; error: string };
    expect(json.code).toBe('UNAUTHORIZED');
    expect(json.error).toBe('unauthorized: browser authentication required');
  });

  it('requestRejection=undefined → 放行进入业务 handler（未知路由得到业务 404）', async () => {
    const handler = makeCtx({ rejection: () => undefined });
    const res = new MockRes();
    await handler(mockReq('/dsh-db-tool/api/definitely-not-a-route'), res as unknown as ServerResponse);
    // 栅栏放行的证明：响应由 handleDbToolRequest 写出（NOT_FOUND），而非静默或栅栏 JSON
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { ok: boolean; code: string }).code).toBe('NOT_FOUND');
  });

  it('宿主无 connection 服务 → 回退本地 trust 校验（无 Host 头 → 403）', async () => {
    const handler = makeCtx({});
    const res = new MockRes();
    await handler(mockReq('/dsh-db-tool/api/state', {}), res as unknown as ServerResponse);
    expect(res.statusCode).toBe(403);
  });

  it('resolveProject 会话反查：sessionId → sessions.get(header.cwd) → projectPathKey', async () => {
    const seen: string[] = [];
    const handler = makeCtx({
      rejection: () => undefined,
      sessionsGet: (id) => {
        seen.push(id);
        return { header: { cwd: 'E:/tmp/dbt-proj-x' } };
      },
    });
    const res = new MockRes();
    await handler(
      mockReq(
        '/dsh-db-tool/api/project-context',
        { host: '127.0.0.1' },
        { method: 'POST', body: { sessionId: 'sess-1' } },
      ),
      res as unknown as ServerResponse,
    );
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual(['sess-1']);
    const json = JSON.parse(res.body) as {
      ok: boolean;
      data: { sessionId: string; projectPathKey: string; hasProject: boolean };
    };
    expect(json.ok).toBe(true);
    expect(json.data.sessionId).toBe('sess-1');
    expect(json.data.hasProject).toBe(true);
    expect(json.data.projectPathKey).not.toBe('');
  });
});
