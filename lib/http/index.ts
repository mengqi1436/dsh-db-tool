/**
 * lib/http：数据库工具 HTTP API（docs/api-contract.md v1）。
 *
 * 默认挂载方式：由插件入口经 DSH webServer（kind:'prefix'，/dsh-db-tool/api）
 * 调用 handleDbToolRequest——前端同源相对路径 fetch 即可达。
 *
 * trust 校验（等价移植 dsh-ssh-tunnel lib/shared/http-trust.js，自包含）：
 *  - Host 必须是 loopback（或 ctx.webRuntime.trustedHosts 中的条目）；
 *  - 带 Origin/Referer 时其 host 必须是 loopback（且同端口）或受信条目。
 *  - 0.0.0.0 不是 loopback。违者 403 FORBIDDEN。
 *
 * 统一响应：成功 {ok:true,data}；失败 {ok:false,error,code}（业务错 HTTP 200，
 * code 供前端分支）；协议级错误（403/404/405/400）用 HTTP 状态码。
 * NEEDS_CONFIRMATION 返回扁平 {ok:false,code,challengeId,statement,danger,reason}。
 */
import * as http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { DbToolService, DbToolError, type NeedConfirm } from '../manager.js';

export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

/* ---------------- trust 校验（自包含，逻辑等价 dsh-ssh-tunnel http-trust.js） ---------------- */

export function isLoopbackHostname(hostname: string): boolean {
  const h = String(hostname ?? '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function originHostPort(originHeader: string): { host: string; port: string; hostHeaderLike: string } | null {
  try {
    const u = new URL(String(originHeader));
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const port = u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '');
    return { host, port, hostHeaderLike: port !== '' ? `${host}:${port}` : host };
  } catch {
    return null;
  }
}

/** Host 必须 loopback 或在 trustedHosts；Origin/Referer 存在时必须 loopback 同端口或受信 */
export function isTrustedRequest(req: Pick<IncomingMessage, 'headers'>, trustedHosts?: string[]): boolean {
  try {
    const hostHeader = req.headers?.host;
    if (!hostHeader) return false;
    const url = new URL(`http://${hostHeader}`);
    const reqHost = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const list = Array.isArray(trustedHosts) ? trustedHosts : [];
    const hostOk =
      isLoopbackHostname(reqHost) ||
      list.some((entry) => {
        const e = String(entry);
        return e === hostHeader || e === url.hostname || e === url.host;
      });
    if (!hostOk) return false;

    const origin = req.headers?.origin ?? req.headers?.referer ?? '';
    if (origin === '') return true;
    const parsed = originHostPort(origin);
    if (!parsed) return false;
    if (isLoopbackHostname(parsed.host) && isLoopbackHostname(reqHost)) {
      const reqPort = url.port || '80';
      if (parsed.port !== '' && parsed.port !== reqPort) return false;
      return true;
    }
    return list.some((entry) => {
      const e = String(entry);
      return e === parsed.hostHeaderLike || e === parsed.host || e === origin;
    });
  } catch {
    return false;
  }
}

/* ---------------- 请求处理入口 ---------------- */

export interface DbToolRequestOptions {
  /** 受信主机列表（通常来自 ctx.webRuntime.trustedHosts） */
  trustedHosts?: string[];
  /**
   * 项目上下文权威解析（对齐 dsh-ssh-tunnel 的 getProjectContext）：
   * host 端以会话 header.cwd 为准（sessionId 优先，客户端 cwd 仅回退），
   * 并做 normalizeProjectKey 归一化——前端不自行拼 key，避免授权与
   * 模型工具两端的项目键错位。
   */
  resolveProject?: (sessionId: string, fallbackCwd: string) => { projectPathKey: string; hasProject: boolean };
}

/**
 * 处理一个数据库工具 API 请求（可在 webServer prefix handler 中直接调用）。
 * 兼容两种路径形态：独立挂载 /api/...，prefix 挂载 /dsh-db-tool/api/...
 * （取 pathname 中 /api 起的路由段匹配）。
 */
export async function handleDbToolRequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: DbToolService,
  opts?: DbToolRequestOptions,
): Promise<void> {
  try {
    // 1) trust 校验（DNS rebinding / 跨站防护）
    if (!isTrustedRequest(req, opts?.trustedHosts)) {
      send(res, 403, { ok: false, error: '非本机来源，已拒绝', code: 'FORBIDDEN' });
      return;
    }

    const hostHeader = req.headers.host ?? '';
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Max-Age': '600' });
      res.end();
      return;
    }

    // 2) 路径规范化：截取 /api 起的路由段
    const url = new URL(req.url ?? '/', `http://${hostHeader || '127.0.0.1'}`);
    let rawPath = url.pathname;
    if (!rawPath.endsWith('/api') && !rawPath.includes('/api/')) {
      send(res, 404, { ok: false, error: `未知路由: ${req.method} ${rawPath}`, code: 'NOT_FOUND' });
      return;
    }
    const apiIdx = rawPath.indexOf('/api/');
    if (rawPath.endsWith('/api')) {
      rawPath = '/api';
    } else if (apiIdx >= 0) {
      rawPath = rawPath.slice(apiIdx);
    }
    const path = rawPath.replace(/\/+$/, '') || '/';
    const q = url.searchParams;

    await route(req, res, service, path, q, opts);
  } catch (e) {
    sendError(res, e);
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  service: DbToolService,
  path: string,
  q: URLSearchParams,
  opts?: DbToolRequestOptions,
): Promise<void> {
  // 项目上下文权威解析：host 端会话 header.cwd 优先（对齐 ssh-tunnel getProjectContext 语义）
  if (path === '/api/project-context' && req.method === 'POST') {
    const b = await readBody(req);
    const sessionId = str(b['sessionId'] ?? b['session_id']);
    const fallbackCwd = str(b['cwd'] ?? b['projectPath'] ?? '');
    if (!opts?.resolveProject) {
      // 未提供解析器（如独立测试挂载）：仅归一化回退值
      const key = fallbackCwd ? service.projectKey(fallbackCwd) : '';
      return sendOk(res, { sessionId, projectPathKey: key, hasProject: key !== '' });
    }
    return sendOk(res, { sessionId, ...opts.resolveProject(sessionId, fallbackCwd) });
  }

  if (path === '/api/connections') {
    if (req.method === 'GET') return sendOk(res, service.listConnections());
    if (req.method === 'POST') {
      const b = await readBody(req);
      // id 留空自动生成（前端提示「留空则自动生成」）
      const id = str(b['id']) || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const kind = str(b['kind']);
      if (!kind) return send(res, 400, { ok: false, error: '缺少 kind', code: 'INVALID_ARGUMENT' });
      const ssl = parseSsl(b['ssl']);
      if (ssl === 'invalid') return send(res, 400, { ok: false, error: 'ssl 必须是布尔值', code: 'INVALID_ARGUMENT' });
      return sendOk(res, service.createConnection({
        id, kind: kind as never,
        ...(b['name'] !== undefined ? { name: str(b['name']) } : {}),
        ...(b['url'] !== undefined ? { url: str(b['url']) } : {}),
        ...(b['fields'] !== undefined ? { fields: b['fields'] as Record<string, unknown> } : {}),
        ...(ssl !== undefined ? { ssl } : {}),
      }));
    }
  }

  // 测试未保存的连接草稿（保存前测试；不落库）
  if (path === '/api/test-draft' && req.method === 'POST') {
    const b = await readBody(req);
    const kind = str(b['kind']);
    if (!kind) return send(res, 400, { ok: false, error: '缺少 kind', code: 'INVALID_ARGUMENT' });
    const ssl = parseSsl(b['ssl']);
    if (ssl === 'invalid') return send(res, 400, { ok: false, error: 'ssl 必须是布尔值', code: 'INVALID_ARGUMENT' });
    return sendMaybeConfirm(res, service.testDraft({
      kind: kind as never,
      ...(b['url'] !== undefined ? { url: str(b['url']) } : {}),
      ...(b['fields'] !== undefined ? { fields: b['fields'] as Record<string, unknown> } : {}),
      ...(ssl !== undefined ? { ssl } : {}),
    }));
  }

  const connMatch = /^\/api\/connections\/([^/]+)(\/test)?$/.exec(path);
  if (connMatch) {
    const id = decodeURIComponent(connMatch[1] ?? '');
    if (connMatch[2] === '/test' && req.method === 'POST') {
      return sendMaybeConfirm(res, service.testConnection(id));
    }
    if (req.method === 'PUT') {
      const b = await readBody(req);
      const ssl = parseSsl(b['ssl']);
      if (ssl === 'invalid') return send(res, 400, { ok: false, error: 'ssl 必须是布尔值', code: 'INVALID_ARGUMENT' });
      return sendOk(res, service.updateConnection(id, {
        ...(b['name'] !== undefined ? { name: str(b['name']) } : {}),
        ...(b['url'] !== undefined ? { url: str(b['url']) } : {}),
        ...(b['fields'] !== undefined ? { fields: b['fields'] as Record<string, unknown> } : {}),
        ...(ssl !== undefined ? { ssl } : {}),
      }));
    }
    if (req.method === 'DELETE') {
      service.removeConnection(id);
      return sendOk(res, { removed: id });
    }
  }

  if (path === '/api/grants') {
    if (req.method === 'GET') {
      const project = q.get('project') ?? '';
      return sendOk(res, service.grantsFor(project));
    }
    if (req.method === 'PUT') {
      const b = await readBody(req);
      const mode = str(b['mode']);
      if (mode !== 'ro' && mode !== 'rw') return send(res, 400, { ok: false, error: 'mode 必须是 ro 或 rw', code: 'INVALID_ARGUMENT' });
      service.grant(str(b['projectPath'] ?? b['project'] ?? ''), str(b['connId']), mode);
      return sendOk(res, { granted: true });
    }
    if (req.method === 'DELETE') {
      const b = await readBody(req);
      service.revokeGrant(str(b['projectPath'] ?? b['project'] ?? ''), str(b['connId']));
      return sendOk(res, { revoked: true });
    }
  }

  if (path === '/api/databases' && req.method === 'GET') {
    return sendOk(res, await service.databases(projectOf(q), required(q, 'connId')));
  }
  if (path === '/api/tables' && req.method === 'GET') {
    return sendOk(res, await service.tables(projectOf(q), required(q, 'connId'), q.get('database') ?? undefined));
  }
  if (path === '/api/schemas' && req.method === 'GET') {
    return sendOk(res, await service.schemas(projectOf(q), required(q, 'connId'), q.get('database') ?? undefined));
  }
  if (path === '/api/schema' && req.method === 'GET') {
    return sendOk(res, await service.schema(projectOf(q), required(q, 'connId'), required(q, 'table'), q.get('database') ?? undefined));
  }
  if (path === '/api/preview' && req.method === 'GET') {
    const limit = q.get('limit') !== null ? Number(q.get('limit')) : undefined;
    return sendOk(res, await service.preview(projectOf(q), required(q, 'connId'), required(q, 'table'), limit, q.get('database') ?? undefined, q.get('offset') ? Number(q.get('offset')) : undefined));
  }

  if (path === '/api/query' && req.method === 'POST') {
    const b = await readBody(req);
    return await sendMaybeConfirm(res, service.query(
      projectOfBody(b), str(b['connId']), str(b['sql']),
      b['params'] as unknown[] | undefined, optStr(b['challengeId']),
    ));
  }
  if (path === '/api/execute' && req.method === 'POST') {
    const b = await readBody(req);
    return await sendMaybeConfirm(res, service.execute(
      projectOfBody(b), str(b['connId']), str(b['statement']),
      b['params'] as unknown[] | undefined, optStr(b['challengeId']),
    ));
  }
  if (path === '/api/script' && req.method === 'POST') {
    const b = await readBody(req);
    return await sendMaybeConfirm(res, service.runScript(
      projectOfBody(b), str(b['connId']), str(b['code']), optStr(b['challengeId']),
    ));
  }

  if (path === '/api/audit' && req.method === 'GET') {
    const limit = q.get('limit') !== null ? Number(q.get('limit')) : undefined;
    return sendOk(res, service.auditTail(q.get('project') ?? undefined, limit));
  }
  if (path === '/api/state' && req.method === 'GET') {
    return sendOk(res, service.state(q.get('project') ?? undefined));
  }

  send(res, 404, { ok: false, error: `未知路由: ${req.method} ${path}`, code: 'NOT_FOUND' });
}

/* ---------------- 可选：独立 loopback server（薄包装 handleDbToolRequest） ---------------- */

export interface DbToolHttpServerOptions {
  host?: string;
  port?: number;
  trustedHosts?: string[];
}

export class DbToolHttpServer {
  private server: Server | null = null;
  private actualPort = 0;
  private actualHost = '';

  constructor(
    private readonly service: DbToolService,
    private readonly opts?: DbToolHttpServerOptions,
  ) {}

  /** 启动并解析端口；返回实际监听地址 */
  start(): Promise<{ host: string; port: number; url: string }> {
    if (this.server) return Promise.resolve(this.address());
    const server = http.createServer((req, res) => {
      void handleDbToolRequest(req, res, this.service, { trustedHosts: this.opts?.trustedHosts }).catch(() => {
        send(res, 500, { ok: false, error: 'internal error', code: 'DRIVER_ERROR' });
      });
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts?.port ?? 0, this.opts?.host ?? '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.actualPort = addr.port;
          this.actualHost = addr.address;
        }
        resolve(this.address());
      });
    });
  }

  address(): { host: string; port: number; url: string } {
    const host = this.actualHost || this.opts?.host || '127.0.0.1';
    const port = this.actualPort || this.opts?.port || 0;
    return { host, port, url: `http://${host}:${port}` };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/* ---------------- 辅助 ---------------- */

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_JSON_BODY_BYTES) {
        reject(new DbToolError('INVALID_ARGUMENT', '请求体超过 2MB 上限'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') return resolve({});
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          reject(new DbToolError('INVALID_ARGUMENT', '请求体必须是 JSON 对象'));
        }
      } catch {
        reject(new DbToolError('INVALID_ARGUMENT', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendOk(res: ServerResponse, data: unknown): void {
  send(res, 200, { ok: true, data });
}

/** service 结果可能是值或 NeedConfirm（script 则以 NEEDS_CONFIRMATION DbToolError 抛出） */
async function sendMaybeConfirm(res: ServerResponse, p: Promise<unknown>): Promise<void> {
  try {
    const r = await p;
    if (isNeedConfirm(r)) {
      send(res, 200, { ok: false, code: 'NEEDS_CONFIRMATION', ...r });
    } else {
      sendOk(res, r);
    }
  } catch (e) {
    sendError(res, e);
  }
}

function sendError(res: ServerResponse, e: unknown): void {
  // 脚本内危险语句以 DbToolError('NEEDS_CONFIRMATION', JSON) 抛出 → 还原为扁平响应
  if (e instanceof DbToolError && e.code === 'NEEDS_CONFIRMATION') {
    try {
      const nc = JSON.parse(e.message) as NeedConfirm;
      if (isNeedConfirm(nc)) {
        send(res, 200, { ok: false, code: 'NEEDS_CONFIRMATION', ...nc });
        return;
      }
    } catch {
      // fallthrough
    }
  }
  if (e instanceof DbToolError) {
    send(res, 200, { ok: false, error: e.message, code: e.code });
    return;
  }
  send(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e), code: 'DRIVER_ERROR' });
}

function isNeedConfirm(v: unknown): v is NeedConfirm {
  return Boolean(v && typeof v === 'object' && (v as NeedConfirm).needConfirmation === true);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** ssl 字段严格布尔解析：防 Boolean("false") === true 的坑。非法值返回 'invalid' */
function parseSsl(v: unknown): boolean | undefined | 'invalid' {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return 'invalid';
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function projectOf(q: URLSearchParams): string | undefined {
  return q.has('project') ? (q.get('project') ?? undefined) : undefined;
}

function projectOfBody(b: Record<string, unknown>): string | undefined {
  const v = b['projectPath'] ?? b['project'];
  return typeof v === 'string' ? v : undefined;
}

function required(q: URLSearchParams, name: string): string {
  const v = q.get(name);
  if (!v) throw new DbToolError('INVALID_ARGUMENT', `缺少查询参数: ${name}`);
  return v;
}
