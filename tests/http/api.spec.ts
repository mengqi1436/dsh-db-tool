/** HTTP 层：trust 校验（isTrustedRequest 语义）、路由、NEEDS_CONFIRMATION 流程、脱敏 */
import { describe, expect, it, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DbToolHttpServer, handleDbToolRequest, isTrustedRequest } from '../../lib/http/index.js';
import type { Fixture } from '../tool/fixture.js';
import { CONN_ID, makeFixture } from '../tool/fixture.js';

let fx: Fixture | null = null;
let server: DbToolHttpServer | null = null;
let base = '';

async function ensureStarted(): Promise<{ fx: Fixture; base: string }> {
  if (!server) {
    fx = await makeFixture('rw');
    server = new DbToolHttpServer(fx.service);
    const addr = await server.start();
    base = addr.url;
  }
  return { fx: fx as Fixture, base };
}

/** 绕过 fetch 的受控 Host 头限制，直接发原始请求 */
function rawRequest(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: '127.0.0.1', port: u.port, path: u.pathname, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function get(pathname: string, headers?: Record<string, string>): Promise<{ status: number; json: any }> {
  const { base } = await ensureStarted();
  const res = await fetch(base + pathname, { headers });
  return { status: res.status, json: (await res.json()) as any };
}

async function post(pathname: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any }> {
  const { base } = await ensureStarted();
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

afterAll(async () => {
  await server?.stop();
  await fx?.dispose();
});

describe('fenced 校验', () => {
  it('跨站 Origin → 403 FORBIDDEN', async () => {
    const { status, json } = await get('/api/connections', { origin: 'https://evil.example' });
    expect(status).toBe(403);
    expect(json).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('伪造 Host（DNS rebinding）→ 403', async () => {
    const { base } = await ensureStarted();
    const res = await rawRequest(base + '/api/connections', { Host: 'evil.example' });
    expect(res.status).toBe(403);
    expect(res.body).toContain('FORBIDDEN');
  });

  it('loopback Origin 端口不一致 → 403', async () => {
    const { status, json } = await get('/api/connections', { origin: 'http://127.0.0.1:5173' });
    expect(status).toBe(403);
    expect(json.code).toBe('FORBIDDEN');
  });

  it('loopback Origin 同端口放行', async () => {
    const { base } = await ensureStarted();
    const { status, json } = await get('/api/connections', { origin: base });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('无 Origin/Referer（本地脚本）放行', async () => {
    const { json } = await get('/api/state');
    expect(json.ok).toBe(true);
  });
});

/* ---------- mock req/res 直打 handleDbToolRequest（webServer handler 同一路径） ---------- */

function mockReq(method: string, url: string, headers: Record<string, string>, body?: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = headers;
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
  headers: Record<string, string> = {};
  writeHead(status: number, hdrs?: Record<string, string>): this {
    this.statusCode = status;
    this.headersSent = true;
    Object.assign(this.headers, hdrs ?? {});
    return this;
  }
  setHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  end(b?: unknown): void {
    if (b !== undefined) this.body = String(b);
  }
}

async function callHandler(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  trustedHosts?: string[],
  resolveProject?: (sessionId: string, fallbackCwd: string) => { projectPathKey: string; hasProject: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { fx } = await ensureStarted();
  const res = new MockRes();
  await handleDbToolRequest(
    mockReq(method, url, headers, body),
    res as unknown as ServerResponse,
    fx.service,
    { ...(trustedHosts ? { trustedHosts } : {}), ...(resolveProject ? { resolveProject } : {}) },
  );
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') as Record<string, unknown> };
}

describe('handleDbToolRequest 直调（prefix 挂载形态 + trust）', () => {
  it('非 loopback Host → 403 FORBIDDEN', async () => {
    const r = await callHandler('GET', '/dsh-db-tool/api/state', { host: 'evil.example' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('恶意 Origin → 403', async () => {
    const r = await callHandler('GET', '/dsh-db-tool/api/state', {
      host: '127.0.0.1:3080', origin: 'https://evil.example',
    });
    expect(r.status).toBe(403);
  });

  it('loopback 同端口 + prefix 路径 /dsh-db-tool/api/state → 200', async () => {
    const r = await callHandler('GET', '/dsh-db-tool/api/state', { host: '127.0.0.1:3080' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('trustedHosts 条目放行（非 loopback Host + 受信 Origin）', async () => {
    const ok = await callHandler('GET', '/api/state', {
      host: 'dsh.internal:3080', origin: 'http://dsh.internal:3080',
    }, undefined, ['dsh.internal']);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    // 同样请求，未提供 trustedHosts → 403
    const denied = await callHandler('GET', '/api/state', {
      host: 'dsh.internal:3080', origin: 'http://dsh.internal:3080',
    });
    expect(denied.status).toBe(403);
  });

  it('isTrustedRequest 纯函数：0.0.0.0 非 loopback；空 Host 拒绝', () => {
    const req = (host?: string, origin?: string) =>
      ({ headers: { ...(host !== undefined ? { host } : {}), ...(origin !== undefined ? { origin } : {}) } }) as Pick<IncomingMessage, 'headers'>;
    expect(isTrustedRequest(req('0.0.0.0'))).toBe(false);
    expect(isTrustedRequest(req('localhost:3080'))).toBe(true);
    expect(isTrustedRequest(req())).toBe(false);
    expect(isTrustedRequest(req('127.0.0.1', 'http://[::1]:9'))).toBe(false);
  });

  it('POST /api/project-context：resolveProject 权威解析（sessionId 优先语义由 host 端保证）', async () => {
    const r = await callHandler('POST', '/api/project-context', { host: '127.0.0.1:3080' },
      { sessionId: 's1', cwd: 'E:\\Code\\my-app' }, undefined,
      (sid, fb) => {
        expect(sid).toBe('s1');
        // host 端模拟「会话命中」，返回归一化 key
        return sid ? { projectPathKey: 'e:/code/real-session', hasProject: true } : { projectPathKey: fb, hasProject: !!fb };
      });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ sessionId: 's1', projectPathKey: 'e:/code/real-session', hasProject: true });
  });

  it('POST /api/project-context：未提供 resolveProject → 回退 service.projectKey 归一化', async () => {
    const r = await callHandler('POST', '/api/project-context', { host: '127.0.0.1:3080' },
      { cwd: 'E:\\Code\\My-App\\' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ projectPathKey: 'e:/Code/My-App', hasProject: true });
  });

  it('POST body 直打：query 路由经 handler 正常返回', async () => {
    const { fx } = await ensureStarted();
    const r = await callHandler('POST', '/dsh-db-tool/api/query', {
      host: '127.0.0.1', 'content-type': 'application/json',
    }, { projectPath: fx.projectA, connId: CONN_ID, sql: 'SELECT 1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
  });
});

describe('连接管理与授权路由', () => {
  it('GET /api/connections 脱敏（无密码，含 ***）', async () => {
    const { json } = await get('/api/connections');
    expect(json.ok).toBe(true);
    const text = JSON.stringify(json);
    expect(text).not.toContain('s3cret');
    expect(text).toContain('***');
  });

  it('POST /api/connections 创建 + PUT 更新 + DELETE 删除', async () => {
    const { fx } = await ensureStarted();
    const created = await post('/api/connections', { id: 'c2', kind: 'sqlite', fields: { file: 'x.db' }, url: 'sqlite://./x.db' });
    expect(created.json.ok).toBe(true);
    expect(created.json.data.safeUrl).not.toContain('s3cret');

    const updated = await fetch(`${(await ensureStarted()).base}/api/connections/c2`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });
    expect(((await updated.json()) as any).data.name).toBe('renamed');

    const del = await fetch(`${(await ensureStarted()).base}/api/connections/c2`, { method: 'DELETE' });
    expect(((await del.json()) as any).ok).toBe(true);
    expect(fx.service.listConnections()).toHaveLength(1);
  });

  it('POST /api/connections id 留空 → 自动生成 c-* id', async () => {
    const a = await post('/api/connections', { kind: 'sqlite', fields: { file: 'auto1.db' } });
    expect(a.status).toBe(200);
    expect(String(a.json.data.id)).toMatch(/^c-/);
    const b = await post('/api/connections', { kind: 'sqlite', fields: { file: 'auto2.db' } });
    expect(String(b.json.data.id)).toMatch(/^c-/);
    expect(b.json.data.id).not.toBe(a.json.data.id); // 随机 id 不冲突
    // 清理，恢复单连接基线
    await fetch(`${(await ensureStarted()).base}/api/connections/${encodeURIComponent(a.json.data.id)}`, { method: 'DELETE' });
    await fetch(`${(await ensureStarted()).base}/api/connections/${encodeURIComponent(b.json.data.id)}`, { method: 'DELETE' });
  });

  it('POST /api/test-draft：草稿测试走通；缺 kind → 400', async () => {
    const ok = await post('/api/test-draft', { kind: 'mysql', url: 'mysql://u:p@127.0.0.1:3306/d' });
    expect(ok.json).toMatchObject({ ok: true, data: { ok: true, serverInfo: 'fake-8.0' } });
    const noKind = await post('/api/test-draft', { url: 'mysql://u:p@h/d' });
    expect(noKind.status).toBe(400);
    expect(noKind.json).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
  });

  it('grants PUT/GET/DELETE', async () => {
    const { fx } = await ensureStarted();
    const put = await fetch(`${(await ensureStarted()).base}/api/grants`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: fx.projectA, connId: CONN_ID, mode: 'ro' }),
    });
    expect(((await put.json()) as any).ok).toBe(true);
    const list = await get(`/api/grants?project=${encodeURIComponent(fx.projectA)}`);
    expect(list.json.data).toEqual([{ connId: CONN_ID, mode: 'ro' }]);

    const del = await fetch(`${(await ensureStarted()).base}/api/grants`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: fx.projectA, connId: CONN_ID }),
    });
    expect(((await del.json()) as any).ok).toBe(true);
    // 恢复授权供后续用例
    const restore = await fetch(`${(await ensureStarted()).base}/api/grants`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: fx.projectA, connId: CONN_ID, mode: 'rw' }),
    });
    expect(((await restore.json()) as any).ok).toBe(true);
  });

  it('mode 非法 → INVALID_ARGUMENT', async () => {
    const { fx } = await ensureStarted();
    const res = await fetch(`${(await ensureStarted()).base}/api/grants`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: fx.projectA, connId: CONN_ID, mode: 'root' }),
    });
    expect(((await res.json()) as any).code).toBe('INVALID_ARGUMENT');
  });
});

describe('业务路由与确认流程', () => {
  it('未授权项目 → UNAUTHORIZED_PROJECT', async () => {
    const { fx } = await ensureStarted();
    const { json } = await post('/api/query', { projectPath: fx.projectB, connId: CONN_ID, sql: 'SELECT 1' });
    expect(json).toMatchObject({ ok: false, code: 'UNAUTHORIZED_PROJECT' });
  });

  it('GET /api/databases、/api/tables、/api/schema、/api/preview', async () => {
    const { fx } = await ensureStarted();
    const q = `project=${encodeURIComponent(fx.projectA)}&connId=${CONN_ID}`;
    expect((await get(`/api/databases?${q}`)).json.data).toEqual(['app', 'test']);
    expect((await get(`/api/tables?${q}`)).json.data).toHaveLength(1);
    expect((await get(`/api/schema?${q}&table=users`)).json.data).toHaveLength(1);
    expect((await get(`/api/preview?${q}&table=users&limit=999`)).json.ok).toBe(true);
    expect((await get(`/api/databases?project=${encodeURIComponent(fx.projectA)}`)).json.code).toBe('INVALID_ARGUMENT');
  });

  it('危险 execute → NEEDS_CONFIRMATION；携 challengeId 重发放行；重放被拒', async () => {
    const { fx } = await ensureStarted();
    const first = await post('/api/execute', { projectPath: fx.projectA, connId: CONN_ID, statement: 'DROP TABLE users' });
    expect(first.json).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION', statement: 'DROP TABLE users', danger: 'danger' });
    expect(first.json.challengeId).toMatch(/^c_[0-9a-f]{24}$/);
    expect(first.json.reason).toContain('不可回滚');

    const second = await post('/api/execute', {
      projectPath: fx.projectA, connId: CONN_ID, statement: 'DROP TABLE users', challengeId: first.json.challengeId,
    });
    expect(second.json).toMatchObject({ ok: true });

    const replay = await post('/api/execute', {
      projectPath: fx.projectA, connId: CONN_ID, statement: 'DROP TABLE users', challengeId: first.json.challengeId,
    });
    expect(replay.json).toMatchObject({ ok: false, code: 'INVALID_CHALLENGE' });
  });

  it('query 危险读（FOR UPDATE）→ NEEDS_CONFIRMATION；携 challengeId 重发放行；篡改语句与重放均被拒', async () => {
    const { fx } = await ensureStarted();
    const sql = 'SELECT * FROM users FOR UPDATE';
    const first = await post('/api/query', { projectPath: fx.projectA, connId: CONN_ID, sql });
    expect(first.json).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION', statement: sql, danger: 'danger' });
    expect(first.json.challengeId).toMatch(/^c_[0-9a-f]{24}$/);

    const second = await post('/api/query', {
      projectPath: fx.projectA, connId: CONN_ID, sql, challengeId: first.json.challengeId,
    });
    expect(second.json).toMatchObject({ ok: true, data: { rowCount: 1 } });

    // challenge 已消费：篡改语句重放 → INVALID_CHALLENGE（consume 无论成败都取走，防探测）
    const tampered = await post('/api/query', {
      projectPath: fx.projectA, connId: CONN_ID, sql: 'SELECT * FROM other FOR UPDATE', challengeId: first.json.challengeId,
    });
    expect(tampered.json).toMatchObject({ ok: false, code: 'INVALID_CHALLENGE' });

    const replay = await post('/api/query', {
      projectPath: fx.projectA, connId: CONN_ID, sql, challengeId: first.json.challengeId,
    });
    expect(replay.json).toMatchObject({ ok: false, code: 'INVALID_CHALLENGE' });
  });

  it('改语句带原 challengeId → INVALID_CHALLENGE', async () => {
    const { fx } = await ensureStarted();
    const first = await post('/api/execute', { projectPath: fx.projectA, connId: CONN_ID, statement: 'DROP TABLE old' });
    const second = await post('/api/execute', {
      projectPath: fx.projectA, connId: CONN_ID, statement: 'DROP TABLE other', challengeId: first.json.challengeId,
    });
    expect(second.json).toMatchObject({ ok: false, code: 'INVALID_CHALLENGE' });
  });

  it('POST /api/script：正常脚本与 NEEDS_CONFIRMATION（message JSON 还原为扁平响应）', async () => {
    const { fx } = await ensureStarted();
    const ok = await post('/api/script', { projectPath: fx.projectA, connId: CONN_ID, code: 'return await db.query("SELECT 1")' });
    expect(ok.json).toMatchObject({ ok: true });

    const confirm = await post('/api/script', { projectPath: fx.projectA, connId: CONN_ID, code: 'await db.execute("DROP TABLE users")' });
    expect(confirm.json).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION' });
    expect(confirm.json.challengeId).toMatch(/^c_[0-9a-f]{24}$/);

    // 携 challengeId 重发脚本 → 脚本内 consume 成功放行
    const pass = await post('/api/script', {
      projectPath: fx.projectA, connId: CONN_ID, code: 'await db.execute("DROP TABLE users")', challengeId: confirm.json.challengeId,
    });
    expect(pass.json).toMatchObject({ ok: true });
  });

  it('GET /api/audit 与 /api/state', async () => {
    const { fx } = await ensureStarted();
    const audit = await get(`/api/audit?project=${encodeURIComponent(fx.projectA)}&limit=10`);
    expect(audit.json.ok).toBe(true);
    expect(audit.json.data.length).toBeGreaterThan(0);
    expect(audit.json.data[0]).toHaveProperty('statement');

    const state = await get(`/api/state?project=${encodeURIComponent(fx.projectA)}`);
    expect(state.json.data).toMatchObject({ grants: [{ connId: CONN_ID, mode: 'rw' }] });
    expect(JSON.stringify(state.json)).not.toContain('s3cret');
  });

  it('未知路由 → 404；坏 JSON → INVALID_ARGUMENT', async () => {
    const { base } = await ensureStarted();
    const nf = await get('/api/nope');
    expect(nf.status).toBe(404);
    const bad = await fetch(base + '/api/query', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
    });
    expect(((await bad.json()) as any).code).toBe('INVALID_ARGUMENT');
  });
});
