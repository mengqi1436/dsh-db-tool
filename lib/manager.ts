/**
 * DatabaseManager：dsh-db-tool 服务核心。
 *
 *  - DbToolService：授权（GrantStore.check + normalizeProjectKey）→ guard 分类 →
 *    challenge 确认 → 适配器调用 → 审计。HTTP 与模型工具共用同一套语义。
 *  - handleToolAction：模型工具（单工具多 action）的纯分发层，便于离线测试。
 *  - run_script：node:vm 新 context、60s 超时、仅注入受限 db 句柄
 *    （无 require/process/network/fs；ro 连接拒绝写句柄）。
 */
import * as vm from 'node:vm';
import type {
  ColumnInfo,
  ConnectionMeta,
  DatabaseAdapter,
  DbKind,
  ExecResult,
  QueryResult,
  TableInfo,
  TestConnectResult,
} from './adapters/types.js';
import { getAdapter, type AdapterFactory } from './adapters/index.js';
import {
  ChallengeStore,
  classifyStatement,
  type GuardVerdict,
} from './guard/index.js';
import {
  DbToolStore,
  normalizeProjectKey,
  type AuditEntry,
  type DangerLevel,
} from './store/index.js';

/* ---------------- 错误与结果类型 ---------------- */

/** 携带机器可读 code 的业务错误（HTTP 层直接映射 {ok:false,error,code}） */
export class DbToolError extends Error {
  constructor(
    readonly code:
      | 'UNAUTHORIZED_PROJECT'
      | 'READ_ONLY'
      | 'NEEDS_CONFIRMATION'
      | 'INVALID_CHALLENGE'
      | 'NOT_FOUND'
      | 'INVALID_ARGUMENT'
      | 'DRIVER_ERROR'
      | 'SCRIPT_TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'DbToolError';
  }
}

/** 危险操作待确认（HTTP → {ok:false, code:'NEEDS_CONFIRMATION', ...}） */
export interface NeedConfirm {
  needConfirmation: true;
  challengeId: string;
  statement: string;
  danger: 'danger';
  reason: string;
}

export interface DbToolServiceOptions {
  /** 覆盖适配器工厂来源（测试注入假适配器；缺省用注册表 getAdapter） */
  adapterResolver?: (kind: DbKind) => Promise<AdapterFactory>;
  challenges?: ChallengeStore;
}

function assertNonEmpty(v: string | undefined, label: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s === '') throw new DbToolError('INVALID_ARGUMENT', `缺少必填参数: ${label}`);
  return s;
}

/* ---------------- 服务核心 ---------------- */

export class DbToolService {
  private readonly adapterCache = new Map<string, Promise<DatabaseAdapter>>();
  readonly challenges: ChallengeStore;
  private readonly resolver: (kind: DbKind) => Promise<AdapterFactory>;
  private disposed = false;

  constructor(readonly store: DbToolStore, opts?: DbToolServiceOptions) {
    this.resolver = opts?.adapterResolver ?? getAdapter;
    this.challenges = opts?.challenges ?? new ChallengeStore();
  }

  /* -- 连接管理（无需授权） -- */

  listConnections(): ConnectionMeta[] {
    return this.store.connections.list();
  }

  createConnection(input: Parameters<DbToolStore['connections']['create']>[0]): ConnectionMeta {
    const meta = this.store.connections.create(input);
    this.audit('', input.id, 'create_connection', input.id, 'none', false, true);
    return meta;
  }

  updateConnection(id: string, patch: Parameters<DbToolStore['connections']['update']>[1]): ConnectionMeta {
    const meta = this.store.connections.update(id, patch);
    if (!meta) throw new DbToolError('NOT_FOUND', `连接不存在: ${id}`);
    this.audit('', id, 'update_connection', id, 'none', false, true);
    return meta;
  }

  removeConnection(id: string): boolean {
    const ok = this.store.connections.remove(id);
    if (!ok) throw new DbToolError('NOT_FOUND', `连接不存在: ${id}`);
    this.adapterCache.delete(id);
    this.audit('', id, 'remove_connection', id, 'none', false, true);
    return ok;
  }

  async testConnection(id: string): Promise<TestConnectResult> {
    const rc = this.requireConn(id);
    try {
      const factory = await this.resolver(rc.meta.kind);
      const adapter = await factory(rc);
      try {
        return await adapter.testConnect();
      } finally {
        await adapter.close().catch(() => {});
      }
    } catch (e) {
      throw this.toDriverError(e);
    }
  }

  /* -- 授权管理 -- */

  grantsFor(projectPath: string): { connId: string; mode: 'ro' | 'rw' }[] {
    return this.store.grants.grantsFor(normalizeProjectKey(projectPath));
  }

  grant(projectPath: string, connId: string, mode: 'ro' | 'rw'): void {
    const key = normalizeProjectKey(projectPath);
    this.store.grants.grant(key, connId, mode);
    this.audit(key, connId, 'grant', `${connId} -> ${mode}`, 'none', false, true);
  }

  revokeGrant(projectPath: string, connId: string): void {
    const key = normalizeProjectKey(projectPath);
    this.store.grants.revoke(key, connId);
    this.audit(key, connId, 'revoke', connId, 'none', false, true);
  }

  /* -- 浏览（ro 即可） -- */

  async databases(projectPath: string | undefined, connId: string): Promise<string[]> {
    const { key, adapter } = await this.authorize(projectPath, connId, false);
    try {
      const result = await adapter.listDatabases();
      this.audit(key, connId, 'databases', 'listDatabases', 'none', false, true);
      return result;
    } catch (e) {
      this.audit(key, connId, 'databases', 'listDatabases', 'none', false, false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  async tables(projectPath: string | undefined, connId: string, database?: string): Promise<TableInfo[]> {
    const { key, adapter } = await this.authorize(projectPath, connId, false);
    try {
      const result = await adapter.listTables(database);
      this.audit(key, connId, 'tables', database ?? 'default', 'none', false, true);
      return result;
    } catch (e) {
      this.audit(key, connId, 'tables', database ?? 'default', 'none', false, false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  async schema(projectPath: string | undefined, connId: string, table: string, database?: string): Promise<ColumnInfo[]> {
    const t = assertNonEmpty(table, 'table');
    const { key, adapter } = await this.authorize(projectPath, connId, false);
    try {
      const result = await adapter.describeTable(t, database);
      this.audit(key, connId, 'schema', t, 'none', false, true);
      return result;
    } catch (e) {
      this.audit(key, connId, 'schema', t, 'none', false, false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  async preview(
    projectPath: string | undefined,
    connId: string,
    table: string,
    limit?: number,
    database?: string,
  ): Promise<QueryResult> {
    const t = assertNonEmpty(table, 'table');
    const capped = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    const { key, adapter } = await this.authorize(projectPath, connId, false);
    try {
      const result = await adapter.previewRows(t, capped, database);
      this.audit(key, connId, 'preview', `PREVIEW ${t} LIMIT ${capped}`, 'none', false, true, undefined, result.rowCount);
      return result;
    } catch (e) {
      this.audit(key, connId, 'preview', `PREVIEW ${t} LIMIT ${capped}`, 'none', false, false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  /* -- SQL 控制台（guard + challenge） -- */

  async query(
    projectPath: string | undefined,
    connId: string,
    sql: string,
    params?: unknown[],
    challengeId?: string,
  ): Promise<QueryResult | NeedConfirm> {
    const statement = assertNonEmpty(sql, 'sql');
    return this.runGuarded({
      projectPath,
      connId,
      op: 'query',
      statement,
      challengeId,
      run: (adapter) => adapter.query(statement, params),
      rowsAffected: (r) => r.rowCount,
    });
  }

  async execute(
    projectPath: string | undefined,
    connId: string,
    statement: string,
    params?: unknown[],
    challengeId?: string,
  ): Promise<ExecResult | NeedConfirm> {
    const stmt = assertNonEmpty(statement, 'statement');
    return this.runGuarded({
      projectPath,
      connId,
      op: 'execute',
      statement: stmt,
      challengeId,
      run: (adapter) => adapter.execute(stmt, params),
      rowsAffected: (r) => r.affectedRows,
    });
  }

  /**
   * run_script：node:vm 新 context，60s 超时；仅注入 { db, console }。
   * db.execute 仅 rw 连接可用；危险语句走 guard（脚本内 NEEDS_CONFIRMATION 以
   * DbToolError 形式抛出，message 为 JSON，由入口层还原为 NEEDS_CONFIRMATION 响应）。
   */
  async runScript(
    projectPath: string | undefined,
    connId: string,
    code: string,
    challengeId?: string,
  ): Promise<unknown | NeedConfirm> {
    const src = assertNonEmpty(code, 'code');
    const { key, mode, adapter } = await this.authorize(projectPath, connId, true);

    const db = {
      query: async (sql: string, params?: unknown[]): Promise<unknown> => {
        const r = await this.query(key, connId, sql, params);
        return this.unwrapForScript(r);
      },
      execute: async (statement: string, params?: unknown[]): Promise<unknown> => {
        const r = await this.execute(key, connId, statement, params, challengeId);
        return this.unwrapForScript(r);
      },
    };
    // ro 连接：写句柄直接拒（authorize needWrite 已拦，此处为句柄级兜底）
    if (mode !== 'rw') {
      db.execute = async () => {
        throw new DbToolError('READ_ONLY', '该连接对本项目为只读授权（ro），脚本不可执行写操作');
      };
    }

    this.audit(key, connId, 'script', src.length > 200 ? src.slice(0, 200) + '…' : src, 'none', false, true);
    const sandbox: Record<string, unknown> = {
      db,
      console: { log: (...a: unknown[]) => console.log('[db-script]', ...a), error: (...a: unknown[]) => console.error('[db-script]', ...a) },
    };
    try {
      const p = vm.runInNewContext(`(async () => {\n${src}\n})()`, sandbox, {
        timeout: 60_000,
        filename: 'db-script.js',
      }) as Promise<unknown>;
      return await Promise.race([
        p,
        new Promise<never>((_, rej) => {
          const t = setTimeout(() => rej(new DbToolError('SCRIPT_TIMEOUT', '脚本执行超时（60s）')), 60_000);
          t.unref?.();
        }),
      ]);
    } catch (e) {
      if (e instanceof DbToolError) throw e;
      throw this.toDriverError(e);
    }
  }

  /* -- 审计与状态 -- */

  auditTail(projectPath: string | undefined, limit?: number): AuditEntry[] {
    const n = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
    if (!projectPath || projectPath.trim() === '') return this.store.audit.tail(n);
    const key = normalizeProjectKey(projectPath);
    return this.store.audit.tail(n).filter((e) => e.projectPathKey === key);
  }

  state(projectPath: string | undefined): {
    connections: ConnectionMeta[];
    grants: { connId: string; mode: 'ro' | 'rw' }[];
    auditTail: AuditEntry[];
  } {
    const grants = projectPath && projectPath.trim() !== '' ? this.grantsFor(projectPath) : [];
    return {
      connections: this.listConnections(),
      grants,
      auditTail: this.auditTail(projectPath, 50),
    };
  }

  /** 关闭缓存的适配器并停止 challenge 清理 */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.challenges.dispose();
    const pending = [...this.adapterCache.values()];
    this.adapterCache.clear();
    for (const p of pending) {
      try {
        const a = await p;
        await a.close().catch(() => {});
      } catch {
        // 缓存里的加载失败项直接忽略
      }
    }
  }

  /* ---------------- 内部 ---------------- */

  private requireConn(connId: string): ReturnType<DbToolStore['connections']['testTarget']> {
    try {
      return this.store.connections.testTarget(connId);
    } catch {
      throw new DbToolError('NOT_FOUND', `连接不存在: ${connId}`);
    }
  }

  /** 授权校验 + 取（缓存的）适配器 */
  private async authorize(
    projectPath: string | undefined,
    connId: string,
    needWrite: boolean,
  ): Promise<{ key: string; mode: 'ro' | 'rw'; adapter: DatabaseAdapter }> {
    if (this.disposed) throw new DbToolError('INVALID_ARGUMENT', '服务已关闭');
    if (!projectPath || projectPath.trim() === '') {
      throw new DbToolError('UNAUTHORIZED_PROJECT', '业务操作需要 projectPath（匿名项目仅可管理连接）');
    }
    const key = normalizeProjectKey(projectPath);
    const mode = this.store.grants.check(key, connId);
    if (!mode) throw new DbToolError('UNAUTHORIZED_PROJECT', `项目未授权该连接: ${connId}`);
    if (needWrite && mode === 'ro') {
      throw new DbToolError('READ_ONLY', '该连接对本项目为只读授权（ro），拒绝写操作');
    }
    const adapter = await this.adapterFor(connId, mode);
    return { key, mode, adapter };
  }

  private adapterFor(connId: string, mode: 'ro' | 'rw'): Promise<DatabaseAdapter> {
    let p = this.adapterCache.get(connId);
    if (!p) {
      p = (async () => {
        const rc = this.requireConn(connId);
        const factory = await this.resolver(rc.meta.kind);
        return factory(rc, { mode });
      })().catch((e) => {
        this.adapterCache.delete(connId);
        throw e instanceof DbToolError ? e : this.toDriverError(e);
      });
      this.adapterCache.set(connId, p);
    }
    return p;
  }

  /** guard 主流程：分类 → challenge → 执行 → 审计 */
  private async runGuarded<T>(args: {
    projectPath: string | undefined;
    connId: string;
    op: 'query' | 'execute';
    statement: string;
    challengeId?: string;
    run: (adapter: DatabaseAdapter) => Promise<T>;
    rowsAffected?: (r: T) => number | undefined;
  }): Promise<T | NeedConfirm> {
    const { projectPath, connId, op, statement, challengeId } = args;
    const { key, adapter } = await this.authorize(projectPath, connId, op === 'execute');
    const kind = adapter.kind;
    const verdict = classifyStatement(kind, statement, op);

    if (verdict.level === 'danger') {
      if (!challengeId) {
        const { id: cid } = this.challenges.create(statement);
        this.audit(key, connId, op, statement, 'danger', false, false, 'NEEDS_CONFIRMATION');
        return { needConfirmation: true, challengeId: cid, statement, danger: 'danger', reason: verdict.reason ?? '危险操作，需要用户确认' };
      }
      if (!this.challenges.consume(challengeId, statement)) {
        this.audit(key, connId, op, statement, 'danger', false, false, 'INVALID_CHALLENGE');
        throw new DbToolError('INVALID_CHALLENGE', '确认凭据无效（不存在、已使用、已过期或语句已变更），请重新发起');
      }
    }

    try {
      const result = await args.run(adapter);
      this.audit(key, connId, op, statement, verdict.level as DangerLevel, verdict.level === 'danger', true, undefined, args.rowsAffected?.(result));
      return result;
    } catch (e) {
      this.audit(key, connId, op, statement, verdict.level as DangerLevel, verdict.level === 'danger', false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  /** 脚本内句柄：NeedConfirm 无法在脚本中交互，转为可还原的 DbToolError */
  private unwrapForScript(r: unknown): unknown {
    if (r && typeof r === 'object' && (r as NeedConfirm).needConfirmation === true) {
      const nc = r as NeedConfirm;
      throw new DbToolError('NEEDS_CONFIRMATION', JSON.stringify(nc));
    }
    return r;
  }

  private audit(
    projectPathKey: string,
    connId: string,
    action: string,
    statement: string,
    danger: DangerLevel,
    confirmed: boolean,
    ok: boolean,
    error?: string,
    rowsAffected?: number,
  ): void {
    try {
      this.store.audit.append({
        projectPathKey, connId, action, statement, danger, confirmed, ok,
        ...(error !== undefined ? { error } : {}),
        ...(rowsAffected !== undefined ? { rowsAffected } : {}),
      });
    } catch {
      // 审计失败不阻塞业务（best-effort）
    }
  }

  private errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  private toDriverError(e: unknown): Error {
    if (e instanceof DbToolError) return e;
    return new DbToolError('DRIVER_ERROR', this.errText(e));
  }
}

/** guard 判定（导出供 HTTP 层/script 入口识别） */
export type { GuardVerdict };

/* ---------------- 模型工具分发层 ---------------- */

export interface ToolActionArgs {
  action: string;
  /** snake_case 为主（与 SSHManager 风格一致），兼容 camelCase */
  conn_id?: string;
  connId?: string;
  sql?: string;
  statement?: string;
  params?: unknown[];
  database?: string;
  table?: string;
  limit?: number;
  code?: string;
  challenge_id?: string;
  challengeId?: string;
}

function pick(args: ToolActionArgs, snake: 'conn_id' | 'challenge_id'): string | undefined {
  return args[snake] ?? (snake === 'conn_id' ? args.connId : args.challengeId);
}

/**
 * 工具 action 分发（返回 JSON 文本）。危险待确认时文本内含确认指引，
 * 提示模型向用户 ask 确认后带 challenge_id 重试。
 */
export async function handleToolAction(
  service: DbToolService,
  args: ToolActionArgs,
  projectPath: string,
): Promise<string> {
  const action = args.action;
  const connId = pick(args, 'conn_id');
  const challengeId = pick(args, 'challenge_id');
  const j = (v: unknown) => JSON.stringify(v, null, 2);

  try {
    switch (action) {
      case 'list_connections':
        return j(service.listConnections());

      case 'query': {
        const r = await service.query(projectPath, requireConn(connId), assertArg(args.sql, 'sql'), args.params, challengeId);
        return needConfirmText(r) ?? j(r);
      }

      case 'execute': {
        const r = await service.execute(projectPath, requireConn(connId), assertArg(args.statement ?? args.sql, 'statement'), args.params, challengeId);
        return needConfirmText(r) ?? j(r);
      }

      case 'schema': {
        const conn = requireConn(connId);
        if (args.table) return j(await service.schema(projectPath, conn, args.table, args.database));
        if (args.database) return j(await service.tables(projectPath, conn, args.database));
        return j(await service.databases(projectPath, conn));
      }

      case 'preview': {
        const r = await service.preview(projectPath, requireConn(connId), assertArg(args.table, 'table'), args.limit, args.database);
        return j(r);
      }

      case 'run_script': {
        const r = await service.runScript(projectPath, requireConn(connId), assertArg(args.code, 'code'), challengeId);
        return needConfirmText(r) ?? j(r);
      }

      default:
        throw new DbToolError('INVALID_ARGUMENT', `未知 action: ${action}（可用: list_connections/query/execute/schema/preview/run_script）`);
    }
  } catch (e) {
    const code = e instanceof DbToolError ? e.code : 'DRIVER_ERROR';
    return j({ ok: false, error: e instanceof Error ? e.message : String(e), code });
  }
}

function requireConn(connId: string | undefined): string {
  if (!connId || connId.trim() === '') throw new DbToolError('INVALID_ARGUMENT', '缺少必填参数: conn_id');
  return connId;
}

function assertArg(v: string | undefined, label: string): string {
  if (!v || v.trim() === '') throw new DbToolError('INVALID_ARGUMENT', `缺少必填参数: ${label}`);
  return v;
}

function needConfirmText(r: unknown): string | null {
  if (!(r && typeof r === 'object' && (r as NeedConfirm).needConfirmation === true)) return null;
  const nc = r as NeedConfirm;
  return JSON.stringify({
    ok: false,
    code: 'NEEDS_CONFIRMATION',
    ...nc,
    hint: `该操作危险（${nc.reason}）。请先向用户说明并征得确认，用户同意后携带 challenge_id=${nc.challengeId} 重试同一语句；challenge 一次性、5 分钟内有效、绑定本语句。`,
  }, null, 2);
}
