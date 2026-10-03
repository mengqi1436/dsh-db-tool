/**
 * DatabaseManager：dsh-db-tool 服务核心。
 *
 *  - DbToolService：授权（GrantStore.check + normalizeProjectKey）→ guard 分类 →
 *    challenge 确认 → 适配器调用 → 审计。HTTP 与模型工具共用同一套语义。
 *  - handleToolAction：模型工具（单工具多 action）的纯分发层，便于离线测试。
 *  - run_script：子进程隔离执行（permission model 禁 fs + 新 vm realm 双层），
 *    60s SIGKILL 强超时，仅注入受限 db 句柄（经 IPC 走完整 guard/审计链路；
 *    ro 连接拒绝写句柄）。
 */
import type {
  ColumnInfo,
  ConnectionMeta,
  DatabaseAdapter,
  DbKind,
  ExecResult,
  QueryResult,
  TableInfo,
  TestConnectResult,
  ResolvedConnection,
} from './adapters/types.js';
import { randomBytes } from 'node:crypto';
import { getAdapter, type ServiceAdapterFactory } from './adapters/index.js';
import {
  ChallengeStore,
  classifyStatement,
  sqlHead,
  SQL_READ_HEADS,
  type ChallengeScope,
  type GuardVerdict,
} from './guard/index.js';
import {
  DbToolStore,
  mergeUrlCredentials,
  normalizeProjectKey,
  DECRYPT_FAIL_MESSAGE,
  type AuditEntry,
  type DangerLevel,
} from './store/index.js';
import { runScriptInChild } from './script/runner.js';
import { decryptPayload, encryptPayload } from './store/export-crypto.js';

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

/**
 * 控制台事务会话：会话专用适配器（仿 runScript，独立于 adapterCache，回收时可
 * close 中断在途查询）+ 粘性事务通道。官方事务铁律（node-postgres）：事务绑定
 * 单一连接，禁止在 pool.query 上做事务。粘性语义完全复用仓库既有事务原子实现
 * （lib/adapters/types.ts 的 tx 可选成员，两种运行时形态）：
 *  - {begin,commit,rollback}（mysql/pg 系）：begin 后适配器把 query/execute 路由到
 *    同一粘性连接（checkout 的专用 client/connection），exec 直接走适配器即可；
 *  - tx(fn)（oracle/dmdb，隐式开始 + connection.commit()/rollback()）：一次 tx()
 *    调用挂起等待用户 commit/rollback——fn 内保留 exec 通道供逐条执行（读语句
 *    返回结果集、其余返回回执，分流在适配器 exec 回调内完成），
 *    commit 以 resolve 结束、rollback 以 reject 结束，提交/回滚与异常回滚
 *    全部由适配器 tx 原子实现完成（对应官方 try/commit、catch/rollback、finally release）。
 */
interface ConsoleTxSession {
  token: string;
  projectKey: string;
  connId: string;
  adapter: DatabaseAdapter;
  /** 空闲 TTL 触达时间（begin/exec/commit/rollback 均刷新） */
  lastAccess: number;
  /** 在粘性通道上串行执行一条语句（粘性连接上并发查询无定义行为，必须排队） */
  run(statement: string, params?: unknown[]): Promise<QueryResult | ExecResult>;
  /** 结束会话：粘性连接 COMMIT/ROLLBACK 后 close 适配器（无论成败都销毁） */
  finish(how: 'commit' | 'rollback'): Promise<void>;
}

/** 粘性通道的语句串行队列：前序失败不阻塞后续，但执行严格按到达顺序 */
function enqueue<T>(chain: { p: Promise<unknown> }, task: () => Promise<T>): Promise<T> {
  const next = chain.p.then(task, task);
  chain.p = next.catch(() => {});
  return next;
}

export interface DbToolServiceOptions {
  /** 覆盖适配器工厂来源（测试注入假适配器；缺省用注册表 getAdapter） */
  adapterResolver?: (kind: DbKind) => Promise<ServiceAdapterFactory>;
  challenges?: ChallengeStore;
  /** 控制台事务会话参数：空闲 TTL（默认 5 分钟）与回收扫描周期（默认 30s，0 禁用定时器） */
  consoleTx?: { ttlMs?: number; sweepIntervalMs?: number };
}

function assertNonEmpty(v: string | undefined, label: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s === '') throw new DbToolError('INVALID_ARGUMENT', `缺少必填参数: ${label}`);
  return s;
}

/** 单连接并发控制台事务会话上限（每会话独占驱动池 + checkout 连接，防连接耗尽） */
const MAX_CONSOLE_SESSIONS_PER_CONN = 4;

/* ---------------- 服务核心 ---------------- */

export class DbToolService {
  private readonly adapterCache = new Map<string, Promise<DatabaseAdapter>>();
  /** 控制台事务会话注册表（token → 会话） */
  private readonly consoleSessions = new Map<string, ConsoleTxSession>();
  private readonly consoleTtlMs: number;
  private consoleSweepTimer: NodeJS.Timeout | undefined;
  readonly challenges: ChallengeStore;
  private readonly resolver: (kind: DbKind) => Promise<ServiceAdapterFactory>;
  private disposed = false;

  constructor(readonly store: DbToolStore, opts?: DbToolServiceOptions) {
    this.resolver = opts?.adapterResolver ?? getAdapter;
    this.challenges = opts?.challenges ?? new ChallengeStore();
    this.consoleTtlMs = opts?.consoleTx?.ttlMs ?? 5 * 60 * 1000;
    const sweep = opts?.consoleTx?.sweepIntervalMs ?? 30 * 1000;
    if (sweep > 0) {
      this.consoleSweepTimer = setInterval(() => this.consoleSweep(), sweep);
      this.consoleSweepTimer.unref?.();
    }
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
    // url/凭证/ssl 变更后旧适配器仍持旧连接串，必须作废重建；
    // 控制台事务会话的专用适配器不在缓存里，单独回收（否则旧凭据最长存活到空闲 TTL）
    void this.dropAdapters(id);
    void this.dropConsoleSessions(id);
    this.audit('', id, 'update_connection', id, 'none', false, true);
    return meta;
  }

  removeConnection(id: string): boolean {
    const ok = this.store.connections.remove(id);
    if (!ok) throw new DbToolError('NOT_FOUND', `连接不存在: ${id}`);
    void this.dropAdapters(id);
    void this.dropConsoleSessions(id);
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

  /**
   * 测试未保存的连接草稿（侧边栏「保存前测试」）。不落库、不写审计，
   * 一次性适配器用完即关。url/fields 校验交给适配器层（与保存后测试同口径）。
   * 编辑已有连接时传 connId：密码留空/url 未改动时自动拼回已存机密
   * （仅注入本次测试，绝不回传客户端）。
   */
  async testDraft(input: {
    kind: DbKind;
    url?: string;
    /** URL 模式独立凭据（可选）：注入 URL userinfo（url 未发/脱敏时以已存 secrets.url 为基底） */
    urlUser?: string;
    urlPassword?: string;
    fields?: Record<string, unknown>;
    ssl?: boolean;
    connId?: string;
  }): Promise<TestConnectResult> {
    const rc: ResolvedConnection = {
      meta: { id: input.connId ?? '(draft)', kind: input.kind, name: '(draft)' },
    };
    let url = input.url;
    let fields = input.fields !== undefined ? { ...input.fields } : undefined;
    let secretsUrl: string | undefined;
    if (input.connId) {
      // 已存连接：编辑时客户端不发旧机密（留空语义），这里从 secrets 拼回
      const sec = this.store.secrets.get(input.connId);
      secretsUrl = sec?.url;
      if (url === undefined && secretsUrl !== undefined) url = secretsUrl;
      if (fields !== undefined && sec?.password !== undefined && fields.password === undefined) {
        fields.password = sec.password;
      }
    }
    // URL 模式独立凭据注入（拼回已存 URL 之后；无凭据字段时 helper 原样返回，?? 保持不变）
    url = mergeUrlCredentials({
      url,
      urlUser: input.urlUser,
      urlPassword: input.urlPassword,
      secretsUrl,
    }) ?? url;
    if (url !== undefined) rc.url = url;
    if (fields !== undefined) rc.fields = fields;
    if (input.ssl !== undefined) rc.ssl = input.ssl;
    try {
      const factory = await this.resolver(input.kind);
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

  /* -- 连接导出/导入（口令加密，无需授权；口令不落审计） -- */

  /** 口令下限：导出包含全部连接机密（明文密码/完整 URL），安全边界在服务端而非 UI */
  private static readonly PASSPHRASE_MIN = 8;

  /**
   * 导出全部连接（含机密）为口令加密的 JSON 密文。
   * 审计只记连接条数，绝不落口令与密文内容。
   */
  exportConnections(passphrase: string): string {
    const pp = assertNonEmpty(passphrase, 'passphrase');
    if (pp.length < DbToolService.PASSPHRASE_MIN) {
      throw new DbToolError('INVALID_ARGUMENT', `口令长度至少 ${DbToolService.PASSPHRASE_MIN} 位`);
    }
    const bundle = this.store.connections.exportBundle();
    const json = encryptPayload(bundle, pp);
    this.audit('', '', 'export_connections', `导出 ${bundle.connections.length} 个连接`, 'none', false, true);
    return json;
  }

  /**
   * 从口令加密的 JSON 密文导入连接。口令错误或密文损坏统一报
   * INVALID_ARGUMENT(DECRYPT_FAIL_MESSAGE)（不区分原因，防口令探测）。
   */
  importConnections(encryptedJson: string, passphrase: string): { imported: number; skipped: string[]; errors: { id: string; message: string }[] } {
    const enc = assertNonEmpty(encryptedJson, 'json');
    const pp = assertNonEmpty(passphrase, 'passphrase');
    if (pp.length < DbToolService.PASSPHRASE_MIN) {
      throw new DbToolError('INVALID_ARGUMENT', `口令长度至少 ${DbToolService.PASSPHRASE_MIN} 位`);
    }
    let bundle: unknown;
    try {
      bundle = decryptPayload(enc, pp);
    } catch {
      // 口令错误/密文损坏/非合法 JSON 统一归一（decryptPayload 已统一文案，这里兜底）
      throw new DbToolError('INVALID_ARGUMENT', DECRYPT_FAIL_MESSAGE);
    }
    // 结构校验：必须是含 connections 数组的对象，且每个元素为带非空 string id/kind 的对象。
    // 畸形元素会让 importBundle 在 try 之外抛 TypeError（绕开统一文案），
    // 或以 undefined id 静默落库成 UI 删不掉的幽灵记录
    const conns = (bundle as { connections?: unknown } | null)?.connections;
    if (
      !bundle ||
      typeof bundle !== 'object' ||
      !Array.isArray(conns) ||
      conns.some(
        (c) =>
          c === null ||
          typeof c !== 'object' ||
          typeof (c as { id?: unknown }).id !== 'string' ||
          (c as { id: string }).id === '' ||
          typeof (c as { kind?: unknown }).kind !== 'string' ||
          (c as { kind: string }).kind === '',
      )
    ) {
      throw new DbToolError('INVALID_ARGUMENT', DECRYPT_FAIL_MESSAGE);
    }
    const summary = this.store.connections.importBundle(bundle as Parameters<DbToolStore['connections']['importBundle']>[0]);
    this.audit('', '', 'import_connections', `导入 ${summary.imported} 个连接，跳过 ${summary.skipped.length} 个，失败 ${summary.errors.length} 个`, 'none', false, true);
    return summary;
  }

  /* -- 授权管理 -- */

  /** 项目路径归一化（/api/project-context 无会话解析器时的回退路径） */
  projectKey(projectPath: string): string {
    return normalizeProjectKey(projectPath);
  }

  grantsFor(projectPath: string): { connId: string; mode: 'ro' | 'rw' }[] {
    return this.store.grants.grantsFor(normalizeProjectKey(projectPath));
  }

  grant(projectPath: string, connId: string, mode: 'ro' | 'rw'): void {
    const key = normalizeProjectKey(projectPath);
    this.store.grants.grant(key, connId, mode);
    // 授权模式变更（含 rw→ro 降级）必须作废旧会话适配器，否则降级不生效；
    // 控制台事务会话的粘性适配器不在缓存里，单独回收（回滚未提交事务并 close）
    void this.dropAdapters(connId);
    void this.dropConsoleSessions(connId);
    this.audit(key, connId, 'grant', `${connId} -> ${mode}`, 'none', false, true);
  }

  revokeGrant(projectPath: string, connId: string): void {
    const key = normalizeProjectKey(projectPath);
    this.store.grants.revoke(key, connId);
    void this.dropAdapters(connId);
    void this.dropConsoleSessions(connId);
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

  /** 库内 schema 清单（仅 PG/GaussDB 等三层语义适配器实现；ro 即可）。 */
  async schemas(projectPath: string | undefined, connId: string, database?: string): Promise<string[]> {
    const { key, adapter } = await this.authorize(projectPath, connId, false);
    if (!adapter.listSchemas) return [];
    try {
      const result = await adapter.listSchemas(database);
      this.audit(key, connId, 'schemas', database ?? 'default', 'none', false, true);
      return result;
    } catch (e) {
      this.audit(key, connId, 'schemas', database ?? 'default', 'none', false, false, this.errText(e));
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
    offset?: number,
  ): Promise<QueryResult> {
    const t = assertNonEmpty(table, 'table');
    const capped = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    const off = Math.max(0, Math.floor(Number(offset) || 0));
    const { key, adapter } = await this.authorize(projectPath, connId, false);
    try {
      const result = await adapter.previewRows(t, capped, database, off);
      this.audit(key, connId, 'preview', `PREVIEW ${t} LIMIT ${capped} OFFSET ${off}`, 'none', false, true, undefined, result.rowCount);
      return result;
    } catch (e) {
      this.audit(key, connId, 'preview', `PREVIEW ${t} LIMIT ${capped} OFFSET ${off}`, 'none', false, false, this.errText(e));
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
    database?: string,
  ): Promise<QueryResult | NeedConfirm> {
    const statement = assertNonEmpty(sql, 'sql');
    return this.runGuarded({
      projectPath,
      connId,
      op: 'query',
      statement,
      challengeId,
      run: (adapter) => adapter.query(statement, params, database),
      rowsAffected: (r) => r.rowCount,
    });
  }

  async execute(
    projectPath: string | undefined,
    connId: string,
    statement: string,
    params?: unknown[],
    challengeId?: string,
    database?: string,
  ): Promise<ExecResult | NeedConfirm> {
    const stmt = assertNonEmpty(statement, 'statement');
    return this.runGuarded({
      projectPath,
      connId,
      op: 'execute',
      statement: stmt,
      challengeId,
      run: (adapter) => adapter.execute(stmt, params, database),
      rowsAffected: (r) => r.affectedRows,
    });
  }

  /**
   * run_script：子进程隔离执行（lib/script/worker.cjs + permission model + 新 vm realm）。
   *  - 会话专用适配器（不走缓存，超时即 close 中断在途调用，不污染共享缓存）；
   *  - db 句柄经 IPC 回父进程，走完整 guard/challenge/审计链路；
   *  - 脚本内 NEEDS_CONFIRMATION 以 DbToolError 形式抛出（message 为 JSON），
   *    由入口层还原为 NEEDS_CONFIRMATION 响应；
   *  - 审计后置：仅在拿到真实执行结果（成功/失败）后落盘。
   */
  async runScript(
    projectPath: string | undefined,
    connId: string,
    code: string,
    challengeId?: string,
  ): Promise<unknown | NeedConfirm> {
    const src = assertNonEmpty(code, 'code');
    // authorize(needWrite=true) 已拒绝 ro 授权；脚本内写句柄再经 runGuarded 双重校验
    const { key, mode } = await this.authorize(projectPath, connId, true);
    // 会话专用适配器：独立于缓存实例，脚本超时可立即 close（中断在途查询）
    const rc = this.requireConn(connId);
    const factory = await this.resolver(rc.meta.kind);
    const sessionAdapter = await factory(rc, { mode }).catch((e: unknown) => {
      throw e instanceof DbToolError ? e : this.toDriverError(e);
    });

    const auditStmt = src.length > 200 ? src.slice(0, 200) + '…' : src;
    try {
      const result = await runScriptInChild({
        code: src,
        dbQuery: async (sql, params, database) =>
          this.unwrapForScript(await this.query(key, connId, sql, params, challengeId, database)),
        dbExecute: async (statement, params, database) =>
          this.unwrapForScript(await this.execute(key, connId, statement, params, challengeId, database)),
        onLog: (level, text) =>
          level === 'error' ? console.error('[db-script]', text) : console.log('[db-script]', text),
        onTimeout: () => {
          void sessionAdapter.close().catch(() => {});
        },
      });
      this.audit(key, connId, 'script', auditStmt, 'none', false, true);
      return result;
    } catch (e) {
      if (!(e instanceof DbToolError && e.code === 'NEEDS_CONFIRMATION')) {
        this.audit(key, connId, 'script', auditStmt, 'none', false, false, this.errText(e));
      }
      if (e instanceof DbToolError) throw e;
      throw this.toDriverError(e);
    } finally {
      await sessionAdapter.close().catch(() => {});
    }
  }

  /* -- 控制台事务会话（粘性连接；语义对齐 runGuarded） -- */

  /**
   * 开始控制台事务：authorize(needWrite=true)（ro 直接 READ_ONLY 拒）→ 创建会话专用
   * 适配器并打开粘性事务通道 → 返回 sessionToken。database 入参显式拒绝：粘性事务
   * 绑定连接默认库、无法跨库，客户端切了非默认库时静默跑错库比报错更危险。
   */
  async consoleBegin(
    projectPath: string | undefined,
    connId: string,
    database?: string,
  ): Promise<{ sessionToken: string }> {
    if (database !== undefined) {
      throw new DbToolError('INVALID_ARGUMENT', '事务会话暂不支持指定数据库（粘性事务绑定连接默认库），请清空库选择后再开始事务');
    }
    // authorize(needWrite=true) 已拒绝 ro 授权（与 runScript 同构；顺带建立缓存适配器）
    const { key, mode } = await this.authorize(projectPath, connId, true);
    const rc = this.requireConn(connId);
    // 每会话独占一个驱动池 + checkout 连接，放任创建会耗尽数据库连接（ponytail: 固定上限，不做 LRU）
    const live = [...this.consoleSessions.values()].filter((s) => s.connId === connId).length;
    if (live >= MAX_CONSOLE_SESSIONS_PER_CONN) {
      throw new DbToolError('INVALID_ARGUMENT', `该连接并发事务会话已达上限（${MAX_CONSOLE_SESSIONS_PER_CONN}），请先提交或回滚既有事务`);
    }
    const factory = await this.resolver(rc.meta.kind);
    const sessionAdapter = await factory(rc, { mode }).catch((e: unknown) => {
      throw e instanceof DbToolError ? e : this.toDriverError(e);
    });
    try {
      const session = await this.openConsoleSession(key, connId, sessionAdapter);
      try {
        // 注册前复核授权：authorize → 注册之间有多次 await，窗口内 revoke/降级触发的
        // dropConsoleSessions 扫不到本会话（TOCTOU）；授权已变更则回滚并经外层审计后抛
        this.recheckConsoleAuth(session);
      } catch (e) {
        await session.finish('rollback').catch(() => {});
        throw e;
      }
      this.consoleSessions.set(session.token, session);
      this.audit(key, connId, 'console_begin', 'BEGIN', 'none', false, true);
      return { sessionToken: session.token };
    } catch (e) {
      await sessionAdapter.close().catch(() => {});
      this.audit(key, connId, 'console_begin', 'BEGIN', 'none', false, false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  /**
   * 会话内执行一条语句：语义等同 execute——classifyStatement + challenge + 审计，
   * 在粘性通道串行执行。读语句走适配器 query 通道保留结果集（事务内 SELECT 看
   * 未提交数据是核心场景）；写/管理语句走 execute 通道。
   */
  async consoleExec(
    sessionToken: string,
    statement: string,
    params?: unknown[],
    challengeId?: string,
  ): Promise<QueryResult | ExecResult | NeedConfirm> {
    const stmt = assertNonEmpty(statement, 'statement');
    if (params !== undefined && !Array.isArray(params)) {
      throw new DbToolError('INVALID_ARGUMENT', 'params 必须是数组（绑定参数）');
    }
    const s = this.requireConsoleSession(sessionToken);
    s.lastAccess = Date.now();
    // 授权复核：会话适配器不在 adapterCache，dropAdapters 管不到——revoke/rw→ro 降级必须即时生效
    this.recheckConsoleAuth(s);

    const kind = s.adapter.kind;
    const verdict = classifyStatement(kind, stmt, 'execute');
    if (verdict.level === 'danger') {
      const scope: ChallengeScope = { connId: s.connId, projectKey: s.projectKey };
      if (!challengeId) {
        const { id: cid } = this.challenges.create(stmt, scope);
        this.audit(s.projectKey, s.connId, 'console_exec', stmt, 'danger', false, false, 'NEEDS_CONFIRMATION');
        return { needConfirmation: true, challengeId: cid, statement: stmt, danger: 'danger', reason: verdict.reason ?? '危险操作，需要用户确认' };
      }
      if (!this.challenges.consume(challengeId, stmt, scope)) {
        this.audit(s.projectKey, s.connId, 'console_exec', stmt, 'danger', false, false, 'INVALID_CHALLENGE');
        throw new DbToolError('INVALID_CHALLENGE', '确认凭据无效（不存在、已使用、已过期或语句已变更），请重新发起');
      }
    }

    try {
      const result = await s.run(stmt, params);
      this.audit(
        s.projectKey, s.connId, 'console_exec', stmt, verdict.level as DangerLevel, verdict.level === 'danger',
        true, undefined, 'rowCount' in result ? result.rowCount : result.affectedRows,
      );
      return result;
    } catch (e) {
      this.audit(s.projectKey, s.connId, 'console_exec', stmt, verdict.level as DangerLevel, verdict.level === 'danger', false, this.errText(e));
      throw this.toDriverError(e);
    }
  }

  /** 粘性连接提交 → 销毁会话并 close 适配器（对应官方 finally release 语义）；审计照落 */
  consoleCommit(sessionToken: string): Promise<ExecResult> {
    return this.consoleTeardown(sessionToken, 'commit');
  }

  /** 粘性连接回滚 → 销毁会话并 close 适配器；审计照落 */
  consoleRollback(sessionToken: string): Promise<ExecResult> {
    return this.consoleTeardown(sessionToken, 'rollback');
  }

  /** commit/rollback 共用结算：授权复核 → 摘除会话 → finish → 审计（verb 参数化，两路镜像合一） */
  private async consoleTeardown(sessionToken: string, how: 'commit' | 'rollback'): Promise<ExecResult> {
    const s = this.requireConsoleSession(sessionToken);
    s.lastAccess = Date.now();
    this.recheckConsoleAuth(s);
    this.consoleSessions.delete(sessionToken); // 先摘除防并发重入；成败都销毁
    const action = how === 'commit' ? 'console_commit' : 'console_rollback';
    const verb = how.toUpperCase();
    try {
      await s.finish(how);
      this.audit(s.projectKey, s.connId, action, verb, 'none', false, true);
      return { message: how === 'commit' ? '事务已提交' : '事务已回滚' };
    } catch (e) {
      this.audit(s.projectKey, s.connId, action, verb, 'none', false, false, this.errText(e));
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

  /** 关闭缓存的适配器、回收控制台事务会话并停止 challenge/TTL 清理 */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.challenges.dispose();
    if (this.consoleSweepTimer) {
      clearInterval(this.consoleSweepTimer);
      this.consoleSweepTimer = undefined;
    }
    const sessions = [...this.consoleSessions.values()];
    this.consoleSessions.clear();
    for (const s of sessions) {
      try {
        await s.finish('rollback'); // 服务关闭：未提交事务一律回滚，不留悬挂连接
      } catch {
        // 已断开等场景忽略
      }
    }
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

  /** 关闭指定连接的全部缓存适配器（mode 变更/凭证变更/删除时） */
  private async dropAdapters(connId: string): Promise<void> {
    const keys = [...this.adapterCache.keys()].filter((k) => k.startsWith(`${connId}@mode=`));
    for (const k of keys) {
      const p = this.adapterCache.get(k);
      this.adapterCache.delete(k);
      if (!p) continue;
      try {
        const a = await p;
        await a.close().catch(() => {});
      } catch {
        // 加载失败或已断开的旧实例直接忽略
      }
    }
  }

  /* -- 控制台事务会话内部 -- */

  private requireConsoleSession(token: string): ConsoleTxSession {
    const s = this.consoleSessions.get(token);
    if (!s) throw new DbToolError('NOT_FOUND', '事务会话不存在（已提交/回滚或空闲超时回收）');
    return s;
  }

  /** 会话存活期间的授权复核（语义与 authorize 一致，但不取适配器） */
  private recheckConsoleAuth(s: ConsoleTxSession): void {
    const mode = this.store.grants.check(s.projectKey, s.connId);
    if (!mode) throw new DbToolError('UNAUTHORIZED_PROJECT', `项目未授权该连接: ${s.connId}`);
    if (mode === 'ro') throw new DbToolError('READ_ONLY', '该连接对本项目为只读授权（ro），拒绝写操作');
  }

  /**
   * 打开粘性事务通道。按适配器 tx 可选成员的两种运行时形态分派
   * （见 ConsoleTxSession 注释）。不支持事务的 kind（无 tx）报 INVALID_ARGUMENT。
   */
  private async openConsoleSession(
    key: string,
    connId: string,
    adapter: DatabaseAdapter,
  ): Promise<ConsoleTxSession> {
    const token = 't_' + randomBytes(12).toString('hex');
    const tx = adapter.tx;
    if (!tx) {
      throw new DbToolError('INVALID_ARGUMENT', `连接类型 ${adapter.kind} 不支持控制台事务会话`);
    }
    const chain: { p: Promise<unknown> } = { p: Promise.resolve() };
    // 结算标志：commit/rollback/sweep/drop/dispose 并发到达时首个 finisher 生效，后续 no-op
    // （finish 一律经 enqueue 排到链尾，等在途语句完成再提交/回滚，避免 exec 跑在事务外）
    let settled = false;
    const lastAccess = Date.now();

    if (typeof tx === 'function') {
      // —— tx(fn) 形态（oracle/dmdb）：挂起 fn 模式。fn 第一段同步登记 exec 通道并
      //    触发 ready；commit 以 resolve 结束 fn、rollback 以 reject 结束 fn，提交/
      //    回滚与异常回滚由适配器 tx 原子实现完成。opened 已把 reject 归一为
      //    { txError }（rollback 属正常路径，不算失败）。exec 通道按语句头返回
      //    双形状（读语句 QueryResult / 其余 ExecResult，分流在适配器内完成）；
      //    契约侧（types.ts）exec 返回 unknown，落地形状在 run 处收窄断言。
      let channel: ((sql: string, binds?: unknown[]) => Promise<unknown>) | null = null;
      let settle!: { resolve: () => void; reject: (e: unknown) => void };
      const done = new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      });
      let ready!: () => void;
      const readyP = new Promise<void>((r) => {
        ready = r;
      });
      const opened: Promise<{ txError?: unknown }> = tx(
        async (exec) => {
          channel = exec;
          ready();
          await done;
          return null;
        },
      )
        .then(
          () => ({}),
          (e: unknown) => ({ txError: e }),
        );
      // begin 等待：fn 被调用（通道就绪）或 tx 开启失败（getConnection/SET TRANSACTION 失败）
      const outcome = await Promise.race([
        readyP.then(() => ({ ok: true as const })),
        opened.then((v) => ({ ok: false as const, err: v.txError })),
      ]);
      if (!outcome.ok) throw this.toDriverError(outcome.err);
      return {
        token,
        projectKey: key,
        connId,
        adapter,
        lastAccess,
        run: (stmt, params) =>
          enqueue(chain, async () => {
            if (!channel) throw new DbToolError('DRIVER_ERROR', '事务通道已关闭');
            return (await channel(stmt, params)) as QueryResult | ExecResult;
          }),
        finish: (how) => {
          // 首个 finisher 生效；任务排到链尾等在途语句完成后才提交/回滚
          if (settled) return Promise.resolve();
          settled = true;
          return enqueue(chain, async () => {
            try {
              if (how === 'commit') {
                settle.resolve();
                const v = await opened;
                // commit 路径的 txError 是真实提交失败，必须上抛供审计
                if (v.txError !== undefined) throw v.txError;
              } else {
                // rollback 以 reject 结束 fn：tx 原子实现执行 ROLLBACK 并吞掉回滚自身的
                // 次生错误（适配器语义），占位 reject 原因不是真实故障，不上抛
                settle.reject(new Error('控制台事务回滚'));
                await opened;
              }
            } finally {
              await adapter.close().catch(() => {});
            }
          });
        },
      };
    }

    // —— TxHandle 形态（mysql/pg 系）：begin 即 checkout 粘性连接并执行 BEGIN；
    //    之后适配器把 query/execute 路由到同一连接，exec 直接透传即可。
    await tx.begin();
    return {
      token,
      projectKey: key,
      connId,
      adapter,
      lastAccess,
      run: (stmt, params) =>
        enqueue<QueryResult | ExecResult>(chain, () =>
          SQL_READ_HEADS.has(sqlHead(stmt)) ? adapter.query(stmt, params) : adapter.execute(stmt, params),
        ),
      finish: (how) => {
        // 首个 finisher 生效；任务排到链尾等在途语句完成后才提交/回滚
        if (settled) return Promise.resolve();
        settled = true;
        return enqueue(chain, async () => {
          try {
            if (how === 'commit') await tx.commit();
            else await tx.rollback();
          } finally {
            await adapter.close().catch(() => {});
          }
        });
      },
    };
  }

  /** 空闲 TTL 扫描：超时会话强制回滚（close 适配器）并审计一条超时回滚 */
  private consoleSweep(): void {
    const now = Date.now();
    for (const [token, s] of this.consoleSessions) {
      if (now - s.lastAccess <= this.consoleTtlMs) continue;
      this.consoleSessions.delete(token);
      void s
        .finish('rollback')
        // 回收原因放 statement 说明槽：ok:true 的记录不得带 error 槽（矛盾审计）
        .then(() =>
          this.audit(s.projectKey, s.connId, 'console_rollback', 'ROLLBACK（空闲超时自动回收）', 'none', false, true),
        )
        .catch((e: unknown) =>
          this.audit(
            s.projectKey, s.connId, 'console_rollback', 'ROLLBACK', 'none', false, false,
            `空闲超时自动回滚失败: ${this.errText(e)}`,
          ),
        );
    }
  }

  /** 授权变更时回收指定连接的全部控制台事务会话（回滚并 close，不审计——非业务事件） */
  private async dropConsoleSessions(connId: string): Promise<void> {
    for (const [token, s] of this.consoleSessions) {
      if (s.connId !== connId) continue;
      this.consoleSessions.delete(token);
      try {
        await s.finish('rollback');
      } catch {
        // 已断开等场景忽略
      }
    }
  }


  private adapterFor(connId: string, mode: 'ro' | 'rw'): Promise<DatabaseAdapter> {
    const cacheKey = `${connId}@mode=${mode}`;
    let p = this.adapterCache.get(cacheKey);
    if (!p) {
      p = (async () => {
        const rc = this.requireConn(connId);
        const factory = await this.resolver(rc.meta.kind);
        return factory(rc, { mode });
      })().catch((e) => {
        this.adapterCache.delete(cacheKey);
        throw e instanceof DbToolError ? e : this.toDriverError(e);
      });
      this.adapterCache.set(cacheKey, p);
    }
    return p;
  }

  /** guard 主流程：分类 → challenge → 执行 → 审计 */
  private async runGuarded<T>(args: {
    projectPath: string | undefined;
    connId: string;
    op: 'query' | 'execute';
    statement: string;
    params?: unknown[];
    challengeId?: string;
    run: (adapter: DatabaseAdapter) => Promise<T>;
    rowsAffected?: (r: T) => number | undefined;
  }): Promise<T | NeedConfirm> {
    const { projectPath, connId, op, statement, challengeId } = args;
    if (args.params !== undefined && !Array.isArray(args.params)) {
      throw new DbToolError('INVALID_ARGUMENT', 'params 必须是数组（绑定参数）');
    }
    const { key, adapter } = await this.authorize(projectPath, connId, op === 'execute');
    const kind = adapter.kind;
    const verdict = classifyStatement(kind, statement, op);

    if (verdict.level === 'danger') {
      const scope: ChallengeScope = { connId, projectKey: key };
      if (!challengeId) {
        const { id: cid } = this.challenges.create(statement, scope);
        this.audit(key, connId, op, statement, 'danger', false, false, 'NEEDS_CONFIRMATION');
        return { needConfirmation: true, challengeId: cid, statement, danger: 'danger', reason: verdict.reason ?? '危险操作，需要用户确认' };
      }
      if (!this.challenges.consume(challengeId, statement, scope)) {
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
  offset?: number;
  code?: string;
  challenge_id?: string;
  challengeId?: string;
}

function pick(args: ToolActionArgs, snake: 'conn_id' | 'challenge_id'): string | undefined {
  return args[snake] ?? (snake === 'conn_id' ? args.connId : args.challengeId);
}

/**
 * 工具 action 分发。危险待确认时文本内含确认指引，
 * 提示模型向用户 ask 确认后带 challenge_id 重试。
 * 返回 { text, isError } 对象：harness 工具契约要求结构化结果，
 * isError=true 仅用于被拒/失败；NEEDS_CONFIRMATION 不是失败。
 */
export async function handleToolAction(
  service: DbToolService,
  args: ToolActionArgs,
  projectPath: string,
): Promise<{ text: string; isError: boolean }> {
  const action = args.action;
  const connId = pick(args, 'conn_id');
  const challengeId = pick(args, 'challenge_id');
  const j = (v: unknown) => JSON.stringify(v, null, 2);

  const ok = (t: string): { text: string; isError: boolean } => ({ text: t, isError: false });

  try {
    switch (action) {
      case 'list_connections':
        return ok(j(service.listConnections()));

      case 'query': {
        const r = await service.query(projectPath, requireConn(connId), assertArg(args.sql, 'sql'), args.params, challengeId, args.database);
        return ok(needConfirmText(r) ?? j(r));
      }

      case 'execute': {
        const r = await service.execute(projectPath, requireConn(connId), assertArg(args.statement ?? args.sql, 'statement'), args.params, challengeId, args.database);
        return ok(needConfirmText(r) ?? j(r));
      }

      case 'schema': {
        const conn = requireConn(connId);
        if (args.table) return ok(j(await service.schema(projectPath, conn, args.table, args.database)));
        if (args.database) return ok(j(await service.tables(projectPath, conn, args.database)));
        return ok(j(await service.databases(projectPath, conn)));
      }

      case 'preview': {
        const r = await service.preview(projectPath, requireConn(connId), assertArg(args.table, 'table'), args.limit, args.database, args.offset);
        return ok(j(r));
      }

      case 'run_script': {
        const r = await service.runScript(projectPath, requireConn(connId), assertArg(args.code, 'code'), challengeId);
        return ok(needConfirmText(r) ?? j(r));
      }

      default:
        throw new DbToolError('INVALID_ARGUMENT', `未知 action: ${action}（可用: list_connections/query/execute/schema/preview/run_script）`);
    }
  } catch (e) {
    const code = e instanceof DbToolError ? e.code : 'DRIVER_ERROR';
    return { text: j({ ok: false, error: e instanceof Error ? e.message : String(e), code }), isError: true };
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
