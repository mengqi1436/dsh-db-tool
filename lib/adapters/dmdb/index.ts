/**
 * 达梦 DM 适配器（dmdb 驱动，API 对齐 oracledb）。
 *
 * ⚠️ 推断标注（未真机验证项，由 env 门控真机集成测试覆盖）：
 *  - 数据字典复用 Oracle 兼容视图 ALL_TABLES / ALL_TAB_COLUMNS / ALL_CONSTRAINTS /
 *    ALL_CONS_COLUMNS（官方移植文档佐证的兼容行为）。
 *  - 分页统一 `OFFSET n ROWS FETCH FIRST m ROWS ONLY`（ANSI 风格，不依赖 compatibleMode=oracle）。
 *  - DDL 隐式提交语义按 Oracle 同等处理。
 *  - DM 事务隐式开始，无需 SET TRANSACTION。
 *
 * 驱动要点：
 *  - db.createPool({ connectString: 'dm://user:pass@host:5236', poolAlias: <逐池唯一>,
 *    poolMin: 1, poolMax: 10, poolTimeout: 60, queueTimeout: 60000 })；不启用压缩
 *    （默认 compress=0，规避 @napi-rs/snappy 跨平台坑）。
 *  - poolAlias 必须逐池唯一（不传即撞驱动缺省 'default' 并抛 [20006]；见 nextPoolAlias 注释）。
 *  - 通信加密：dmdb 默认 loginEncrypt=true；若 DM 服务器 COMM_ENCRYPT_NAME 配置为 DES_CFB，
 *    驱动选择 DES-CFB，而 Node 22+/OpenSSL 3 已移除 DES → 建连报 [6071] 消息加密失败
 *    （Unknown cipher / digital envelope routines::unsupported）。createDmPool 仅对该特征错误、
 *    且连接串未显式指定 loginEncrypt 时以 loginEncrypt=false 重试一次；显式参数不做自动降级。
 *    降级成功的结果按连接目标（connectString 去掉 userinfo）记忆，同目标后续建池直接带
 *    loginEncrypt=false，避免数据传输为每张表新建池时各撞一次失败握手。
 *  - execute 必须显式 maxRows（默认 0=无限制）；autoCommit 显式传 true 使语义
 *    不依赖驱动默认（驱动连接属性默认已是自动提交：dmdb connection.js
 *    conn_prop_autoCommit = !0；d.ts 三级优先链 执行选项 > dmdb.autoCommit > 连接属性）。
 *  - 返回 { metaData, rows, rowsAffected } 与 oracledb 兼容。
 */
import db from 'dmdb';
import { sqlHead, SQL_READ_HEADS } from '../../guard/index.js';
import { validPort } from '../sql-shared/common.js';
import type {
  AccessMode,
  AdapterFactory,
  ColumnInfo,
  DatabaseAdapter,
  ExecResult,
  NormalizedCell,
  QueryResult,
  ResolvedConnection,
  TableInfo,
  TestConnectResult,
} from '../types.js';

const ROWS_MAX = 500;
const CELL_TRUNC = 1000;
const DDL_KEYWORDS = new Set([
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE',
  'COMMENT', 'ANALYZE', 'AUDIT', 'NOAUDIT', 'FLASHBACK', 'PURGE',
]);

/** 标识符基本校验（DM 官方允许 $/# 开头等宽字符集，引用创建的名字可含任意字符）：
 *  非空、≤128、无 NUL/换行。防注入靠数据字典参数绑定 + preview 处 escIdent 转义。 */
export function sanitizeIdentifier(name: string, label: string): string {
  if (
    typeof name !== 'string' || name.length === 0 || name.length > 128 ||
    /[\0\r\n]/.test(name)
  ) {
    throw new Error(`非法 DM ${label}「${name}」：不允许为空、超 128 字符或含 NUL/换行`);
  }
  return name;
}

/** 双引号标识符转义（" → ""），拼接进 SQL 前必须过此函数 */
function escIdent(name: string): string {
  return name.replaceAll('"', '""');
}

function trunc(s: string, max = CELL_TRUNC): string {
  return s.length > max ? `${s.slice(0, max)}…[截断,共${s.length}字符]` : s;
}

/** 行值规范化为 NormalizedCell */
async function normalizeCell(v: unknown): Promise<NormalizedCell> {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return trunc(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return trunc(`0x${v.toString('hex')}`);
  return trunc(JSON.stringify(v));
}

/**
 * 是否为「本机 Node/OpenSSL 不支持 DM 通信加密算法」的特征错误。
 *
 * dmdb 把 crypto.createCipheriv 的异常包成 [6071] 消息加密失败，底层原文在
 * Node 22+/OpenSSL 3 上是 `digital envelope routines::unsupported`，部分 Node/Electron
 * 构建则是 `Unknown cipher`。只匹配这两个特征，避免把密码错误、真的加密失败等
 * [6071] 也误判成可降级重试。
 */
function isDmCipherUnavailableError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  const code = typeof e === 'object' && e !== null ? (e as { errCode?: unknown }).errCode : undefined;
  return (code === 6071 || message.includes('[6071]')) &&
    /Unknown cipher|digital envelope routines::unsupported/i.test(message);
}

export function humanizeDmError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const hint = isDmCipherUnavailableError(e)
    ? '（提示：当前 Node.js/OpenSSL 不支持达梦服务器的通信加密算法（DES-CFB/RC4）；可在连接串设置 loginEncrypt=false，或把服务器 dm.ini 的 COMM_ENCRYPT_NAME 设为 AES_256_CFB/留空后重启）'
    : '（提示：请检查连接串/凭据；错误码含义见达梦官方《DM8 错误码手册》）';
  return new Error(`达梦 DM 错误：${msg}${hint}`);
}

/** 连接参数解析：url（dm://user:pass@host:5236 直接可用）或 fields 拼 connectString */
export function resolveDmConn(conn: ResolvedConnection): { connectString: string; user: string; password: string } {
  if (conn.url) {
    if (!conn.url.startsWith('dm://')) {
      throw new Error('DM URL 应以 dm:// 开头，如 dm://user:pass@host:5236');
    }
    const u = new URL(conn.url);
    // 端口段校验：'dm://host:0' 等非法值抛中文错误，不再透传驱动报晦涩的 EADDRNOTAVAIL
    // （connectString 仍用原 URL 原样透传，不重组）
    if (u.port) validPort(u.port, 5236, 'dmdb');
    return {
      connectString: conn.url,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  }
  const f = conn.fields ?? {};
  const host = typeof f.host === 'string' ? f.host : '';
  // 前端原样发字符串端口：显式校验；历史 typeof==='number' 门把一切字符串（含合法 '14330'）
  // 静默丢弃回退 5236，且驱动侧 parseInt 对非法形态还有第二重静默回退
  const port = validPort(f.port, 5236, 'dmdb');
  if (host === '') {
    throw new Error('DM 连接需要 url（dm://user:pass@host:5236）或 fields（host/port）');
  }
  const user = typeof f.user === 'string' ? f.user : '';
  const password = typeof f.password === 'string' ? f.password : '';
  return { connectString: `dm://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`, user, password };
}

/** loginEncrypt 在驱动侧的规范键名：Properties.set 统一 toLowerCase（dmdb/src/desc/properties.js） */
const DM_LOGIN_ENCRYPT_KEY = 'loginencrypt';

/**
 * 把连接串切成「主体 / query / #fragment」，只用于改写 query 段。
 *
 * 不用 WHATWG URL 解析：驱动走的是 legacy url.parse()（dmdb/src/dm.js parseUrl），
 * 两者对 authority 的解读不同——`new URL()` 会把非 ASCII 主机名百分号编码、对含空格
 * 主机名直接抛 TypeError，重组后驱动要么解析出空 host、要么异常被重试分支吞掉。
 */
function splitDmConnectString(connectString: string): { base: string; query: string | null; fragment: string } {
  const hashAt = connectString.indexOf('#');
  const head = hashAt >= 0 ? connectString.slice(0, hashAt) : connectString;
  const fragment = hashAt >= 0 ? connectString.slice(hashAt) : '';
  const queryAt = head.indexOf('?');
  if (queryAt < 0) return { base: head, query: null, fragment };
  return { base: head.slice(0, queryAt), query: head.slice(queryAt + 1), fragment };
}

/** query 参数名按驱动语义还原：legacy url.parse 的 querystring 会百分号解码并把 + 视作空格 */
function decodeDmQueryKey(rawKey: string): string {
  try {
    return decodeURIComponent(rawKey.replaceAll('+', ' '));
  } catch {
    return rawKey;
  }
}

/** 取 query 段某个 key=value 对的键（无 = 时整段即键） */
function dmQueryPairKey(pair: string): string {
  const eqAt = pair.indexOf('=');
  return eqAt >= 0 ? pair.slice(0, eqAt) : pair;
}

/**
 * 连接串是否显式指定 loginEncrypt：显式值代表用户策略，不参与自动降级。
 *
 * 必须按驱动的键名归一化（小写 + 百分号解码）比较，而非 URLSearchParams.has 的
 * 大小写敏感匹配：驱动把 `?LOGINENCRYPT=true` 与 `?loginEncrypt=true` 视为同一属性，
 * 按字面比对会把用户显式策略误判成「没指定」并偷偷降级。
 */
function hasExplicitDmLoginEncrypt(connectString: string): boolean {
  const { query } = splitDmConnectString(connectString);
  if (query === null) return false;
  return query
    .split('&')
    .some((pair) => pair !== '' && decodeDmQueryKey(dmQueryPairKey(pair)).toLowerCase() === DM_LOGIN_ENCRYPT_KEY);
}

/**
 * 在保留原有 query 的前提下把 loginEncrypt 置为 false（仅降级重试用）。
 *
 * 与 resolveDmConn 里「connectString 原样透传、不重组」的纪律相比，这里是唯一例外：
 * 降级必须改写 query，而改写只能用字符串级操作——主体（含 authority 的 userinfo/host）
 * 与 #fragment 逐字节原样保留，才有上面 splitDmConnectString 那段注释的结论。
 */
function withDmLoginEncryptDisabled(connectString: string): string {
  const { base, query, fragment } = splitDmConnectString(connectString);
  const kept = query === null
    ? []
    : query.split('&').filter((pair) => pair === '' || decodeDmQueryKey(dmQueryPairKey(pair)).toLowerCase() !== DM_LOGIN_ENCRYPT_KEY);
  kept.push('loginEncrypt=false');
  return `${base}?${kept.join('&')}${fragment}`;
}

/**
 * 已确认「本机必须关闭达梦通信加密」的连接目标（key = connectString 去掉 userinfo）。
 *
 * 达梦服务器配 DES_CFB 时，同一个目标每建一个新池都要先撞一次 [6071] 才降级；数据传输
 * 为每张表各建一次池（默认并发 4），白付多轮失败握手。
 *
 * key 只取目标部分，不带 conn.meta.id：
 *  - 加密能力是服务器属性，与用哪个连接配置连它无关——同一目标不同连接（含 testDraft
 *    恒为 '(draft)' 的临时连接、传输端的独立池）共享同一次探测才是正确语义；
 *  - 反过来，用 id 参与 key 会让「换个连接名就连不上」这种偶发现象出现。
 * 改密码不会让记忆失效（加密能力与凭据无关），换 host/port/路径则视为不同目标重新探测。
 * 条目数与用户连接数同阶，无需淘汰。
 */
const dmLoginEncryptDisabledTargets = new Set<string>();

/** 记忆 key：连接串去掉 userinfo（密码变更不影响、host/port/路径变更重新探测） */
function dmFallbackKey(connectString: string): string {
  const { base } = splitDmConnectString(connectString);
  const schemeAt = base.indexOf('://');
  const authorityStart = schemeAt >= 0 ? schemeAt + 3 : 0;
  // userinfo 与 host 以 '@' 分隔，密码本身可能含 '@'（取 authority 内最后一个）；
  // 路径里的 '@' 不属于分隔符，故先把 authority 范围切出来
  const pathAt = base.indexOf('/', authorityStart);
  const authorityEnd = pathAt >= 0 ? pathAt : base.length;
  const atInAuthority = base.lastIndexOf('@', authorityEnd - 1);
  return atInAuthority >= authorityStart
    ? `${base.slice(0, authorityStart)}${base.slice(atInAuthority + 1)}`
    : base;
}

/** 传输端降级留痕去重：每表建池都会降级，逐池打日志会刷屏 */
const dmFallbackWarned = new Set<string>();

export interface DmAdapterOptions {
  mode?: AccessMode;
  /** 测试注入：跳过真实连接池创建 */
  pool?: unknown;
}

/**
 * 连接池别名：dmdb 把池登记在模块级全局 Map（dmdb.pools），key 即 poolAlias。
 * 驱动缺省别名恒为 'default'（driver/pool.js `_poolAlias = "default"`，仅显式传参才覆盖），
 * 且判重无条件执行 → 不传别名时第二个池必抛 [20006] 连接池别名已存在（src/dm.js:236）。
 * 本插件同进程内可并存多个池（连接的 ro/rw 各一份缓存、testConnection/testDraft 的
 * 一次性池、控制台事务会话、数据传输独立池），故必须逐池唯一。
 * 别名同时是 close 的回收键：正常路径 driver/pool.js 会 `pools.delete(alias)`，
 * 但 close 抛错的异常分支会跳过该删除（登记项残留，插件侧无可观测点）。
 */
let poolSeq = 0;
function nextPoolAlias(conn: ResolvedConnection): string {
  return `dsh-dm-${conn.meta.id}-${++poolSeq}`;
}

/** 单次建池：池参数与别名的唯一维护点。 */
async function createDmPoolOnce(conn: ResolvedConnection, connectString: string): Promise<DmPoolLike> {
  // 注意：实参对象不要直接包进 `as unknown as` 断言——变异工具不为该形态生成
  // ObjectLiteral 变异体，「删掉 poolAlias」这类关键退化会在变异报告中不可见（已验证）。
  const pool = await db.createPool({
    connectString,
    poolAlias: nextPoolAlias(conn),
    poolMin: 1,
    poolMax: 10,
    poolTimeout: 60,
    queueTimeout: 60000,
  });
  return pool as unknown as DmPoolLike;
}

/**
 * 降级重试后仍失败的专用提示。
 *
 * 不能复用 humanizeDmError 的提示：那条会让用户「在连接串设置 loginEncrypt=false」，
 * 而此刻已经设了并且重试过——按那条去排查只会原地打转。这里要说清已经做到哪一步，
 * 并把方向指向唯一还没排除的地方（服务端协商结果 / 凭据）。
 */
function dmFallbackFailedHint(retryError: unknown): string {
  if (isDmCipherUnavailableError(retryError)) {
    return '（提示：已按 loginEncrypt=false 重试仍报消息加密失败，说明握手阶段仍在协商加密；请检查服务器 dm.ini 的 COMM_ENCRYPT_NAME（建议设为 AES_256_CFB 或留空）后重启实例）';
  }
  return '（提示：已按 loginEncrypt=false 重试，加密握手已绕过，仍失败请按上一条错误排查凭据/权限/网络；错误码含义见达梦官方《DM8 错误码手册》）';
}

/**
 * 建池（连接串解析、池参数与别名单点维护，供适配器与数据传输入口共用）。
 *
 * 达梦服务器若启用 DES_CFB 通信加密，Node 22+/OpenSSL 3 没有 des-cfb 实现，首次建池会报
 * [6071] 消息加密失败 / Unknown cipher。这里做一次与 SQL Server encrypt=auto 同哲学的
 * 定向降级：只有特征错误且连接串未显式指定 loginEncrypt 时，才以 loginEncrypt=false 重试；
 * 其他错误原样包装，避免把凭据/网络/权限问题误报成加密问题，也避免无限重试。
 *
 * 降级确认过一次的目标会被记住（见 dmLoginEncryptDisabledTargets），后续建池直接关加密：
 * 传输端每张表都新建池，不记忆就要为每张表各付一次失败握手。
 */
async function createDmPool(conn: ResolvedConnection, onLoginEncryptFallback?: () => void): Promise<DmPoolLike> {
  const { connectString } = resolveDmConn(conn);
  const fallbackKey = dmFallbackKey(connectString);
  const explicit = hasExplicitDmLoginEncrypt(connectString);
  // 已确认需要关加密的目标：直接带 loginEncrypt=false，连失败的那次握手都省掉。
  // 仍按「降级过」上报，否则连接信息里的提示会在第二次建池后凭空消失。
  // 不走「命中却失败就清记忆重探」：那等于把省下的握手又花回去，且让 createPool 调用数
  // 随失败次数漂移。服务端改了 COMM_ENCRYPT_NAME 的恢复路径是用户在设置里重测/重连
  // （testConnect 走同一路径，报错会指明检查 COMM_ENCRYPT_NAME）。
  const useMemo = !explicit && dmLoginEncryptDisabledTargets.has(fallbackKey);
  try {
    const pool = await createDmPoolOnce(conn, useMemo ? withDmLoginEncryptDisabled(connectString) : connectString);
    if (useMemo) onLoginEncryptFallback?.();
    return pool;
  } catch (e) {
    // 命中记忆时已经用过 loginEncrypt=false，humanizeDmError 的「请设置 loginEncrypt=false」
    // 提示同样自相矛盾，统一走降级失败文案
    if (useMemo) throw new Error(`达梦 DM 错误：${e instanceof Error ? e.message : String(e)}${dmFallbackFailedHint(e)}`);
    if (!isDmCipherUnavailableError(e) || explicit) {
      throw humanizeDmError(e);
    }
    try {
      const pool = await createDmPoolOnce(conn, withDmLoginEncryptDisabled(connectString));
      dmLoginEncryptDisabledTargets.add(fallbackKey);
      onLoginEncryptFallback?.();
      return pool;
    } catch (retryError) {
      // 降级后仍失败：抛重试错误（例如 -2501 说明已绕过加密握手、是凭据问题），
      // 不把原始 6071 混进来误导排查方向。提示换成本场景专用文案，原因见 dmFallbackFailedHint。
      throw new Error(`达梦 DM 错误：${retryError instanceof Error ? retryError.message : String(retryError)}${dmFallbackFailedHint(retryError)}`);
    }
  }
}

/** dmdb 池的最小结构（与 oracledb 一致：Pool 没有 execute，语句必须在 Connection 上执行） */
export interface DmPoolLike {
  getConnection(): Promise<DmConnLike>;
  close(): Promise<void>;
}
export interface DmConnLike {
  execute(sql: string, binds?: unknown[], opts?: Record<string, unknown>): Promise<DmResultLike>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}
interface DmResultLike {
  metaData?: Array<{ name: string }>;
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
}

export async function createDmAdapter(
  conn: ResolvedConnection,
  opts?: DmAdapterOptions,
): Promise<DatabaseAdapter> {
  const mode: AccessMode = opts?.mode ?? 'rw';
  let pool: DmPoolLike;
  let loginEncryptFallback = false;
  if (opts?.pool) {
    pool = opts.pool as DmPoolLike;
  } else {
    pool = await createDmPool(conn, () => { loginEncryptFallback = true; });
  }
  /** 降级提示：只在本次建池确实发生 loginEncrypt=false 重试时展示 */
  const fallbackNote = (): string => (loginEncryptFallback
    ? '（注意：当前 Node.js 不支持 DM 的 DES-CFB 通信加密，已自动使用 loginEncrypt=false 连接）'
    : '');

  /** 默认 execute 选项：显式 maxRows（dmdb 默认 0=无限制，必须覆盖）+ 显式 autoCommit:true
   *  （驱动连接属性默认已是 true，显式传递仅让语义不依赖驱动默认；SELECT 立即结束隐式事务，避免 ro 事务悬挂） */
  const execOpts = { outFormat: db.OUT_FORMAT_OBJECT, maxRows: ROWS_MAX + 1, autoCommit: true };
  /** 事务内 execute：显式关闭自动提交，由 tx 的 commit/rollback 收口 */
  const execOptsTx = { ...execOpts, autoCommit: false };

  /**
   * 从池借一条连接执行后归还。⚠️ dmdb 的 Pool 没有 execute（与 oracledb 一致），
   * 一切语句必须在 Connection 上执行；close() 即归还连接。
   */
  async function withConn<T>(fn: (c: DmConnLike) => Promise<T>): Promise<T> {
    const c = await pool.getConnection();
    try {
      return await fn(c);
    } finally {
      await c.close().catch(() => { /* 归还失败忽略 */ });
    }
  }

  function requireRw(action: string): void {
    if (mode === 'ro') {
      throw new Error(`连接为只读(ro)模式，拒绝执行${action}；请使用 rw 连接或只发查询(query)`);
    }
  }

  function isDdl(sql: string): boolean {
    const first = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
    return DDL_KEYWORDS.has(first);
  }

  async function toExecResult(sql: string, r: DmResultLike): Promise<ExecResult> {
    // ⚠️ 推断：DDL 隐式提交语义按 Oracle 同等处理（未真机验证）
    const ddlNote = isDdl(sql) ? '（DDL 已隐式提交，不可回滚）' : '';
    return {
      affectedRows: typeof r.rowsAffected === 'number' && r.rowsAffected > 0 ? r.rowsAffected : undefined,
      message: `${sql.trim().split(/\s+/)[0]?.toUpperCase() ?? 'SQL'} 完成${r.rowsAffected ? `，影响 ${r.rowsAffected} 行` : ''}${ddlNote}`,
    };
  }

  async function rowsToQueryResult(r: DmResultLike): Promise<QueryResult> {
    const allRows = r.rows ?? [];
    const truncated = allRows.length > ROWS_MAX;
    const columns = (r.metaData ?? []).map((m) => m.name);
    const rows: NormalizedCell[][] = [];
    for (const row of allRows.slice(0, ROWS_MAX)) {
      rows.push(await Promise.all(Object.values(row).map(normalizeCell)));
    }
    return { columns, rows, rowCount: rows.length, truncated: truncated || undefined };
  }

  /** owner 解析：database 参数或默认当前用户（保留原样——引用创建的 schema 大小写敏感） */
  function ownerOf(database?: string): string {
    return sanitizeIdentifier(database ?? connUser, 'schema/owner 名');
  }

  /** DM 内建系统 schema：受安全体系保护，任何用户（含 SYSDBA）无 SELECT 权，列表中过滤 */
  const DM_SYSTEM_SCHEMAS = new Set(['SYS', 'SYSSSO', 'SYSAUDITOR', 'SYSSCO', 'CTISYS']);

  const connUser = resolveDmConn(conn).user.toUpperCase();

  /**
   * tx 为可选扩展成员：契约 DatabaseAdapter 尚未声明 tx（types.ts 为共享文件，本阶段不改），
   * 用交叉类型承载，运行时存在于返回对象上；注册/服务层可按需取用。
   * exec 回调按语句头分流：读语句返回 QueryResult，其余返回 ExecResult。
   */
  type AdapterWithTx = DatabaseAdapter & {
    tx?: <T>(
      fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult | QueryResult>) => Promise<T>,
    ) => Promise<T>;
  };
  const adapter: AdapterWithTx = {
    kind: 'dmdb',
    connId: conn.meta.id,

    async testConnect(): Promise<TestConnectResult> {
      try {
        const r = await withConn((c) => c.execute('SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1', [], execOpts));
        const row = r.rows?.[0];
        const banner = row ? String(Object.values(row)[0] ?? '') : '';
        return { ok: true, serverInfo: `${banner}${fallbackNote()}` };
      } catch {
        // V$VERSION 为推断兼容项（部分 DM 版本/驱动可能不可读）：
        // 版本信息尽力而为，连通性本身用 dual 兜底判定，避免误报连接失败
        try {
          await withConn((c) => c.execute('SELECT 1 FROM DUAL', [], execOpts));
          return { ok: true, serverInfo: `DM 数据库（版本信息不可读：V$VERSION 不可用）${fallbackNote()}` };
        } catch (e) {
          return { ok: false, error: humanizeDmError(e).message };
        }
      }
    },

    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const head = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (head !== 'SELECT' && head !== 'WITH') {
        throw new Error('DM query 仅允许 SELECT/WITH 语句；写操作或 DDL 请走 execute');
      }
      try {
        const r = await withConn((c) => c.execute(sql, params ?? [], execOpts));
        return await rowsToQueryResult(r);
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    async execute(statement: string, params?: unknown[]): Promise<ExecResult> {
      requireRw('execute');
      try {
        // 单语句语义：autoCommit: true（execOpts 默认已开启）
        const r = await withConn((c) => c.execute(statement, params ?? [], execOpts));
        return await toExecResult(statement, r);
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    /**
     * 事务：专用连接多条语句，成功 commit、异常 rollback。DM 事务隐式开始，无需 SET TRANSACTION。
     * exec 回调按语句头分流：读语句（SQL_READ_HEADS 命中首词，如 SELECT/WITH）在
     * 本事务连接上执行并返回结果集（事务内读未提交数据是官方标准用法）；
     * 其余语句返回执行回执。所有语句同处一个事务，随 commit/rollback 收口。
     */
    async tx<T>(
      fn: (exec: (sql: string, binds?: unknown[]) => Promise<ExecResult | QueryResult>) => Promise<T>,
    ): Promise<T> {
      requireRw('事务(tx)');
      const c = await pool.getConnection();
      try {
        const exec = async (sql: string, binds?: unknown[]): Promise<ExecResult | QueryResult> => {
          const r = await c.execute(sql, binds ?? [], execOptsTx);
          return SQL_READ_HEADS.has(sqlHead(sql)) ? rowsToQueryResult(r) : toExecResult(sql, r);
        };
        const out = await fn(exec);
        await c.commit();
        return out;
      } catch (e) {
        try {
          await c.rollback();
        } catch { /* 已断开等场景忽略 */ }
        throw humanizeDmError(e);
      } finally {
        try {
          await c.close();
        } catch { /* 归还失败忽略 */ }
      }
    },

    async listDatabases(): Promise<string[]> {
      // DM 为单库多 schema 模型：「数据库」下拉列出可浏览的 schema（有表者），
      // 失败回退当前用户 schema，绝不用 host 等占位值（会污染 owner 参数）。
      // 系统安全 schema（SYSSSO=MAC 标记/SYSAUDITOR=审计/SYSSCO/CTISYS=全密/SYS）
      // 连 SYSDBA 也无 SELECT 权（DM 有意保护），列出只会让展开时报 [-5504]，
      // 故过滤（保留当前用户自身，支持直接以系统用户连接的场景）。
      try {
        const r = await withConn((c) => c.execute(
          'SELECT DISTINCT OWNER FROM ALL_TABLES ORDER BY OWNER',
          [],
          execOpts,
        ));
        const owners = (r.rows ?? [])
          .map((row) => String(Object.values(row)[0] ?? '').trim())
          .filter(Boolean)
          .filter((o) => o === connUser || !DM_SYSTEM_SCHEMAS.has(o.toUpperCase()));
        return owners.length > 0 ? owners : [connUser];
      } catch {
        return [connUser];
      }
    },

    async listTables(database?: string): Promise<TableInfo[]> {
      const owner = ownerOf(database);
      try {
        // ⚠️ 推断：DM 兼容 Oracle 数据字典 ALL_TABLES（未真机验证）
        const r = await withConn((c) => c.execute(
          'SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :owner ORDER BY TABLE_NAME OFFSET 0 ROWS FETCH FIRST 500 ROWS ONLY',
          [owner],
          execOpts,
        ));
        const rows = r.rows ?? [];
        return rows.map((row) => ({ name: String(row.TABLE_NAME ?? ''), type: 'TABLE' }));
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    async describeTable(table: string, database?: string): Promise<ColumnInfo[]> {
      const owner = ownerOf(database);
      // 原名精确匹配优先；未引用创建的表名在字典中为大写存储，UPPER 兜底
      const tab = sanitizeIdentifier(table, '表名');
      try {
        // ⚠️ 推断：ALL_TAB_COLUMNS / ALL_CONSTRAINTS / ALL_CONS_COLUMNS 兼容（未真机验证）；同连接内两查保证一致性
        const { colsR, pkR } = await withConn(async (c) => ({
          colsR: await c.execute(
            `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE, NULLABLE, DATA_DEFAULT
            FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND (TABLE_NAME = :tab OR TABLE_NAME = UPPER(:tab)) ORDER BY COLUMN_ID`,
            [owner, tab],
            execOpts,
          ),
          pkR: await c.execute(
            `SELECT COLS.COLUMN_NAME
            FROM ALL_CONSTRAINTS CONS
            JOIN ALL_CONS_COLUMNS COLS
              ON CONS.OWNER = COLS.OWNER AND CONS.CONSTRAINT_NAME = COLS.CONSTRAINT_NAME
            WHERE CONS.CONSTRAINT_TYPE = 'P' AND CONS.OWNER = :owner AND (CONS.TABLE_NAME = :tab OR CONS.TABLE_NAME = UPPER(:tab))`,
            [owner, tab],
            execOpts,
          ),
        }));
        const pkSet = new Set((pkR.rows ?? []).map((r2) => String(r2.COLUMN_NAME ?? '')));
        return (colsR.rows ?? []).map((row) => {
          const dataType = String(row.DATA_TYPE ?? '');
          const precision = row.DATA_PRECISION;
          const scale = row.DATA_SCALE;
          const length = row.DATA_LENGTH;
          let typeStr = dataType;
          if (precision !== null && precision !== undefined) {
            typeStr = scale !== null && scale !== undefined && Number(scale) > 0
              ? `${dataType}(${Number(precision)},${Number(scale)})`
              : `${dataType}(${Number(precision)})`;
          } else if (/^(VARCHAR|NVARCHAR|CHAR|NCHAR|RAW|BIT)/.test(dataType) && length !== null && length !== undefined) {
            typeStr = `${dataType}(${Number(length)})`;
          }
          const def = row.DATA_DEFAULT;
          return {
            name: String(row.COLUMN_NAME ?? ''),
            dataType: typeStr,
            nullable: String(row.NULLABLE ?? 'Y') === 'Y',
            ...(pkSet.has(String(row.COLUMN_NAME ?? '')) ? { key: 'PRI' as const } : {}),
            default: def === null || def === undefined ? null : trunc(String(def).trim()),
          };
        });
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    async previewRows(table: string, limit: number, database?: string, offset?: number): Promise<QueryResult> {
      const owner = ownerOf(database);
      const tab = sanitizeIdentifier(table, '表名'); // 拼接前经 escIdent 转义
      const n = Math.max(1, Math.min(Math.floor(limit) || 20, ROWS_MAX));
      const off = Math.max(0, Math.floor(offset ?? 0) || 0);
      try {
        // 统一 ANSI 分页（不依赖 compatibleMode=oracle）。ROW_LIMIT 子句语法图的
        // <offset>/<大小> 均为字面 <整数>（DM8 SQL 手册），绑定占位符能否用于该
        // 位置无官方佐证 → 内联经 clamp 的整数（off/n 源自内部 offset/limit，无注入面）
        const r = await withConn((c) => c.execute(
          `SELECT * FROM "${escIdent(owner)}"."${escIdent(tab)}" OFFSET ${off} ROWS FETCH FIRST ${n} ROWS ONLY`,
          [],
          execOpts,
        ));
        return await rowsToQueryResult(r);
      } catch (e) {
        throw humanizeDmError(e);
      }
    },

    async close(): Promise<void> {
      try {
        await pool.close();
      } catch { /* 已关闭忽略 */ }
    },
  };

  return adapter;
}

export const factory: AdapterFactory = async (conn) => createDmAdapter(conn);

/**
 * 数据传输读写端用的独立连接池（别名逐池唯一，可与主连接池并存）。
 *
 * 与主连接池不同，这里没有适配器实例承载「本次是否降级」的状态，也不该抛错给传输层，
 * 所以降级只用一行日志留痕：按目标去重，避免每张表各刷一条。
 */
export async function openDmPool(conn: ResolvedConnection): Promise<DmPoolLike> {
  const key = dmFallbackKey(resolveDmConn(conn).connectString);
  return await createDmPool(conn, () => {
    if (dmFallbackWarned.has(key)) return;
    dmFallbackWarned.add(key);
    console.warn(
      `[dmdb] 连接「${conn.meta.id}」的达梦服务器协商了本机 Node/OpenSSL 不支持的通信加密算法，已自动以 loginEncrypt=false 建池（数据传输每表新建池，本目标不再重复尝试加密）`,
    );
  });
}
