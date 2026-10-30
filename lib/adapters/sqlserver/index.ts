/**
 * SQL Server 适配器（SQL Server 2008/2008 R2 – 2022 与 Azure SQL；mssql@12，底层 tedious 纯 JS TDS）。
 *
 * 驱动加载：mssql 只在 devDependencies。它是唯一会把 buffer/events/process/string_decoder
 * 四个核心模块同名包带进生产依赖树的驱动（mssql → tedious → bl → readable-stream），
 * 会触发宿主 @deepseek-ai/dsh-app-boot 的 require.resolve.paths bug 使插件整体加载失败
 * （约束由 tests/guard/deps-core-collision.spec.ts 守护）。故运行时经 createRequire 相对
 * 加载 vendor/sqlserver-driver.cjs（scripts/build-sqlserver.mjs 产物），失败不缓存并给中文
 * 修复指引。mssql 12.7.4 不随包发 .d.ts（package.json 无 types 字段），类型在本文件自声明
 * 最小接口——与 pg-like.ts 的 PgLikeDriver 同一手法。
 *
 * 占位符：对外只接受 `?`（客户端 dialectOf('sqlserver') 返回 'q'），内部经词法扫描顺序重写为
 * `@p1..@pN` 并 request.input('pN', v)。扫描跳过单引号串（含 N'...' 与 '' 转义）、[方括号]、
 * "双引号"、行注释（--）与块注释内的 `?`；个数与 params 不一致即抛中文错误。
 *
 * 版本降级：SERVERPROPERTY('ProductMajorVersion') 探测（NULL 时回退 ProductVersion 前缀），
 * 按池缓存。>=11（2012+，含 Azure SQL 的 12）用 OFFSET/FETCH（T-SQL 强制要求 ORDER BY，
 * 用常量排序 ORDER BY (SELECT NULL) 保持「不指定顺序」的语义）；<11（2008/2008 R2）降级为
 * ROW_NUMBER() OVER (...) 子查询，并把内部序号列从结果集中剔除。
 *
 * 只读(ro)语义诚实降级：SQL Server 没有等价的会话级只读语句（不像 MySQL 的
 * SET SESSION TRANSACTION READ ONLY 或 PG 的 SET SESSION CHARACTERISTICS AS TRANSACTION
 * READ ONLY），无法在服务器侧强制只读。故 ro 强度弱于 mysql/pg，只有三层：
 * 服务层拦 execute + 适配器侧 query 首词白名单（复用 guard 的 SQL_READ_HEADS）+
 * 拒绝多语句（防 `SELECT 1; UPDATE ...` 堆叠写）。这里是应用层防线，不是服务器级保证。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as tls from 'node:tls';
import { SQL_READ_HEADS, sqlHead } from '../../guard/index.js';
import { assertIdent, clampLimit, clampOffset, humanize, normalizeCell } from '../sql-shared/common.js';
import type { TxHandle } from '../sql-shared/pg-like.js';
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
} from '../types.js';

/* ============================ 驱动最小接口 ============================ */

/**
 * 结果集：元素形态交由驱动决定（适配器内部按 Record 读取），故放宽为 unknown[]。
 * 真实 mssql 会把列元数据挂在结果集数组的 columns 属性上（tedious columnMetadata 投影）——
 * 放宽元素类型是为了让传输端与测试的最小 Fake 能直接兼容，无需复制列元数据结构。
 */
export type SqlRecordset = unknown[] & { columns?: Record<string, { type?: unknown }> };

export interface SqlQueryResult {
  recordset?: SqlRecordset | null;
  recordsets?: SqlRecordset[][] | null;
  /** 每条语句一项的受影响行数（多语句时为数组） */
  rowsAffected?: number[] | null;
}

export interface SqlRequest {
  input(name: string, value: unknown): SqlRequest;
  input(name: string, type: unknown, value: unknown): SqlRequest;
  query(command: string): Promise<SqlQueryResult>;
}

export interface SqlTransaction {
  begin(isolationLevel?: unknown): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<unknown>;
  request(): SqlRequest;
}

export interface SqlPool {
  request(): SqlRequest;
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
  on(event: string, cb: (...args: never[]) => void): unknown;
}

/** vendor bundle 导出的 mssql 命名空间最小面（含类型构造器，供传输端显式绑定用） */
export interface SqlDriver {
  ConnectionPool: new (config: Record<string, unknown>) => SqlPool;
  Transaction: new (pool: SqlPool) => SqlTransaction;
  /** TYPES.NVarChar / VarBinary / Decimal / DateTime2 / BigInt 等（对比列类型时用同一实例） */
  TYPES?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 数据传输端复用的原始句柄（绕过 normalizeCell 的展示化转换） */
export interface SqlserverRaw {
  pool: SqlPool;
  /** 幂等建连：query 前必须等待就绪，否则 mssql 池会以 ENOTOPEN 拒绝（并发调用共享同一次连接） */
  ready(): Promise<void>;
  /** 连接解析出的默认库（URL pathname 或 fields.database；都没有时为 ''） */
  database: string;
  /** 驱动命名空间：`new driver.Transaction(pool)` 与 input(name, driver.NVarChar, v) 用 */
  driver: SqlDriver;
}

let vendorCache: SqlDriver | undefined;

/** 容错加载 vendor bundle：缺失返回 undefined，成功后缓存；失败不缓存 → 构建完成即可恢复 */
function vendorOrNull(): SqlDriver | undefined {
  if (vendorCache === undefined) {
    try {
      // 相对路径从本模块出发：dist/adapters/sqlserver/ 或 lib/adapters/sqlserver/ 均指向包根 vendor/
      vendorCache = createRequire(import.meta.url)('../../../vendor/sqlserver-driver.cjs') as SqlDriver;
    } catch {
      return undefined;
    }
  }
  return vendorCache;
}

/** 严格加载：缺失时抛带修复指引的中文错误 */
function vendor(): SqlDriver {
  const m = vendorOrNull();
  if (m === undefined) {
    throw new Error('sqlserver 驱动不可用：缺少 vendor/sqlserver-driver.cjs。请在插件目录运行 npm run build:sqlserver 构建后重试');
  }
  return m;
}

/* ============================ 配置解析 ============================ */

/** tedious 支持的 TDS 协议版本（默认 7_4） */
const TDS_VERSIONS = new Set(['7_4', '7_3_A', '7_3_B', '7_2', '7_1']);

/**
 * 可显式下探的最低 TLS 版本（默认不设置，沿用 Node 默认下限 TLSv1.2）。
 *
 * 刻意不含 TLSv1.3：tedious message-io.js 在调用方未给 maxVersion 时硬性补成 'TLSv1.2'，
 * 于是 minVersion=TLSv1.3 会变成 min>max，握手直接抛 ERR_SSL_NO_PROTOCOLS_AVAILABLE
 * （已实测）——那是个 100% 失败的配置，放进白名单只会把用户引到另一条死路。
 */
const TLS_MIN_VERSIONS = ['TLSv1', 'TLSv1.1', 'TLSv1.2'] as const;

/** URLSearchParams 取值（参数名大小写不敏感，URL 里常见 camelCase 与全小写混写） */
function queryParam(sp: URLSearchParams, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of sp) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** 布尔 query 参数：非法值抛中文错误而非静默回退（连错加密策略是安全事故） */
function boolParam(sp: URLSearchParams, name: string, dflt: boolean): boolean {
  const v = queryParam(sp, name);
  if (v === undefined || v === '') return dflt;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw new Error(`sqlserver 连接 URL 的 ${name} 取值非法：${JSON.stringify(v)}（只接受 true/false）`);
}

/** fields 分支的布尔取值：分字段表单以字符串提交，故与 URL 同口径归一；非法值同样 fail-closed */
function boolField(v: unknown, name: string, dflt: boolean): boolean {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw new Error(`sqlserver 连接配置的 ${name} 取值非法：${JSON.stringify(v)}（只接受 true/false）`);
}

/** TDS 版本白名单（URL 与 fields 共用，避免两套文案漂移） */
function applyTdsVersion(options: Record<string, unknown>, raw: unknown, source: string): void {
  if (raw === undefined || raw === null || String(raw) === '') return;
  const v = String(raw);
  if (!TDS_VERSIONS.has(v)) {
    throw new Error(
      `sqlserver 连接${source}的 tdsVersion 取值非法：${JSON.stringify(raw)}（可选 ${[...TDS_VERSIONS].join('/')}，默认 7_4）`,
    );
  }
  options.tdsVersion = v;
}

/**
 * 加密模式（URL ?encrypt= 与 fields.encrypt 同口径）：true / false / strict 三态。
 *
 * strict 是 tedious 对 TDS 8.0 的支持：TLS 在登录包之前就完成握手（ALPN=tds/8.0），仅 SQL Server
 * 2022+ 开启 Force Strict Encryption 的实例可用；老实例必然拒绝，故非法值必须 fail-closed 报清
 * 三态，不能把拼错的 'stric' 之类静默当成 true（加密强度是安全承诺，连错不报是安全事故）。
 */
function applyEncrypt(options: Record<string, unknown>, raw: unknown, source: string): void {
  if (raw === undefined || raw === null || String(raw).trim() === '') return;
  if (typeof raw === 'boolean') {
    options.encrypt = raw;
    return;
  }
  const s = String(raw).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') {
    options.encrypt = true;
    return;
  }
  if (s === 'false' || s === '0' || s === 'no') {
    options.encrypt = false;
    return;
  }
  if (s === 'strict') {
    options.encrypt = 'strict';
    return;
  }
  throw new Error(
    `sqlserver 连接${source}的 encrypt 取值非法：${JSON.stringify(raw)}（只接受 true/false/strict；strict 表示 TDS 8.0 强制加密，仅 SQL Server 2022 及以上并开启 Force Strict Encryption 的实例支持）`,
  );
}

/**
 * 证书校验用的服务器名（URL ?serverName= 与 fields.serverName 同口径）。
 *
 * 两个真实场景需要它：① 用 IP 直连但证书签发给域名；② 走端口转发/NAT 后主机名与证书不符。
 * tedious 走 strict 时 servername 取 options.serverName（wrapWithTls），非 strict 时同样优先
 * 用它（startTls），故一个参数覆盖两条路径。留空不注入，沿用「主机名作校验名」的默认语义。
 */
function applyServerName(options: Record<string, unknown>, raw: unknown): void {
  if (raw === undefined || raw === null || String(raw) === '') return;
  options.serverName = String(raw);
}

/** 取（必要时创建）cryptoCredentialsDetails，供 minVersion 与 ca 合并写入而不互相覆盖 */
function credentialsOf(options: Record<string, unknown>): Record<string, unknown> {
  const cur = options.cryptoCredentialsDetails;
  if (cur !== undefined && cur !== null && typeof cur === 'object') return cur as Record<string, unknown>;
  const fresh: Record<string, unknown> = {};
  options.cryptoCredentialsDetails = fresh;
  return fresh;
}

/** PEM 证书起始标记（用于区分「直接传证书文本」与「传文件路径」） */
const PEM_HEADER = '-----BEGIN';

/**
 * 系统信任库中的 CA（Node >=22.15 的 tls.getCACertificates('system')）。
 *
 * 失败或不可用时返回空数组并静默回退：拿不到系统根证书不该阻断连接（用户显式给的 caCert 仍然
 * 生效）。之所以要主动合并——Node tls 一旦收到 ca 选项就只用这份列表校验，默认的系统信任库不再
 * 生效；只塞用户那张 CA 会让「装了自签 CA 之后连别的实例」全部失败。
 */
function systemCa(): string[] {
  try {
    const get = (tls as typeof tls & { getCACertificates?: (type: string) => string[] }).getCACertificates;
    if (typeof get !== 'function') return [];
    const list = get('system');
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is string => typeof x === 'string' && x !== '');
  } catch {
    return [];
  }
}

/**
 * 内置 bundle 的 CA（Node >=22.15 的 tls.getCACertificates('default')）。
 * 取不到时返回空数组——调用方据此跳过注入，保持 Node 默认校验行为。
 */
function defaultCa(): string[] {
  try {
    const get = (tls as typeof tls & { getCACertificates?: (type: string) => string[] }).getCACertificates;
    if (typeof get !== 'function') return [];
    const list = get('default');
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is string => typeof x === 'string' && x !== '');
  } catch {
    return [];
  }
}

/**
 * 显式受信 CA（URL ?caCert= 与 fields.caCert 同口径）：值可以是 PEM 文本，也可以是 PEM 文件路径。
 *
 * 两条硬约束：
 *  - 路径读不出来必须 fail-closed 抛中文错。若静默跳过，用户会以为「已装 CA 但还连不上」，实际
 *    仍按系统信任库校验——问题只会更难定位。
 *  - 写入的 ca 必须与系统信任库合并（见 systemCa 的注释），否则等于缩小信任范围。
 */
function applyCaCert(options: Record<string, unknown>, raw: unknown, source: string): void {
  if (raw === undefined || raw === null || String(raw) === '') return;
  const text = String(raw);
  // PEM 文本原样保留（换行是 PEM 结构的一部分）；只有当路径时才去掉两端空白
  const pem = text.includes(PEM_HEADER) ? text : readCaFile(text.trim(), source);
  const merged = systemCa().slice();
  if (!merged.includes(pem)) merged.push(pem);
  credentialsOf(options).ca = merged;
}

/**
 * 把系统信任库并入默认校验（未显式给 caCert 时也生效）。
 *
 * 为什么需要：Node 默认的 ca 是编译期内置的 bundle，**不读操作系统信任库**（只有 --use-system-ca
 * 或显式注入才读）。因此「用户按官方推荐把自签证书导入 Windows 受信任根」这一最常见的正确做法，
 * 在不注入的情况下对连接毫无帮助，用户会以为"导入没用"。此处在未给 caCert 时注入 system 列表，
 * 让该做法真正生效。
 *
 * 合并而非替换：注入系统库后 Node 不再使用内置 bundle，只给 system 会让"连公网/别家实例"反而失败，
 * 故 default + system 一起给。
 *
 * 兼容性（老环境不能因此连不上，故逐级降级而不是一刀切）：
 *  - 没有 tls.getCACertificates（Node < 22.15 / 非官方构建）→ defaultCa() 与 systemCa() 都返回 []，
 *    本函数不注入任何东西，保持 Node 原生默认行为（仍可用内置 bundle 正常连接公网证书）。
 *  - 有 API 但系统库为空（部分 Linux 容器、精简镜像）→ 只注入 bundled（等价于默认），
 *    不会把 ca 设成空数组（那会让校验彻底失败）。
 *  - 任何异常都被 defaultCa/systemCa 内部吞掉，绝不让"取系统证书失败"打断建连。
 */
function applySystemCaDefault(options: Record<string, unknown>): void {
  if (options.cryptoCredentialsDetails !== undefined) {
    const cur = options.cryptoCredentialsDetails as Record<string, unknown> | null;
    // 已经有人写过 ca（caCert 显式给过）就不再插手，避免覆盖用户的显式选择
    if (cur !== null && typeof cur === 'object' && cur['ca'] !== undefined) return;
  }
  const bundled = defaultCa();
  const system = systemCa();
  // 两者都拿不到 → 不注入：保持 Node 默认（内置 bundle 依然生效）
  if (bundled.length === 0 && system.length === 0) return;
  const merged = bundled.slice();
  for (const pem of system) if (!merged.includes(pem)) merged.push(pem);
  if (merged.length === 0) return;
  credentialsOf(options).ca = merged;
}

/** 读取 PEM 文件；任何失败都转成带修复指引的中文错误（绝不静默忽略该配置） */
function readCaFile(path: string, source: string): string {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(
      `sqlserver 连接${source}的 caCert 无法读取：${path}（${errText(e)}）。请给出可读的 PEM 证书文件路径，或直接传 PEM 文本；该配置不会被忽略——忽略等于换回系统信任库校验，真正的原因会被掩盖`,
    );
  }
  if (!text.includes(PEM_HEADER)) {
    throw new Error(
      `sqlserver 连接${source}的 caCert 指向的文件不含 PEM 证书：${path}（应形如 -----BEGIN CERTIFICATE----- 开头；若本来就想直接传文本，请确认文本未被截断）`,
    );
  }
  return text;
}

/**
 * 最低 TLS 版本（URL ?tlsMinVersion= 与 fields.tlsMinVersion 同口径）。
 *
 * 只写 cryptoCredentialsDetails.minVersion，不提供 ciphers / maxVersion 开关：
 *  - Electron 内置 Node 是 BoringSSL，OpenSSL 专有的 cipher 串（如 DEFAULT@SECLEVEL=0）会直接抛
 *    INVALID_COMMAND；而「连 2008/2008R2 只有 TLS 1.0」这个场景只需把下限从默认的 TLSv1.2 放开即可。
 *  - TLS 上限在非 strict 路径由 tedious 自己封顶：message-io.js 的 startTls 会把
 *    cryptoCredentialsDetails.maxVersion 就地改写为 'TLSv1.2'（只有在白名单 TLSv1/TLSv1.1/TLSv1.2
 *    内才原样保留），所以这里写 maxVersion=TLSv1.2 等价于「什么都不做」而不是「加固」。写更低的上限
 *    反而会真的降级到 1.0/1.1，属于削弱安全性——上限留给 tedious 定，本函数只管下限。
 *
 * 取值区分大小写、不做归一化（与 Node tls 官方 API 语义一致：'tlsv1' / 'TLSv1_0' 均会被底层拒绝）。
 * 非法值 fail-closed：静默回退到 Node 默认下限会让用户以为已下探，实际握手仍按 TLS 1.2 起步，
 * 白白多一轮失败排查。
 */
function applyTlsMinVersion(options: Record<string, unknown>, raw: unknown, source: string): void {
  if (raw === undefined || raw === null || String(raw) === '') return;
  const v = String(raw);
  const hit = TLS_MIN_VERSIONS.find((x) => x === v);
  if (hit === undefined) {
    throw new Error(
      `sqlserver 连接${source}的 tlsMinVersion 取值非法：${JSON.stringify(raw)}（可选 ${TLS_MIN_VERSIONS.join('/')}，默认不设置=沿用 Node 默认 TLSv1.2；TLSv1.3 不可选：底层 tedious 把 TLS 上限封顶在 1.2，设 1.3 会导致最小版本大于最大版本而握手失败）`,
    );
  }
  // 与 caCert 合并进同一份 cryptoCredentialsDetails：两者都可能被用户同时设置，直接整体赋值会互相覆盖
  credentialsOf(options).minVersion = hit;
}

function decodeCred(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new Error('sqlserver 连接 URL 的用户名或密码 percent 编码非法（如含未编码的 %），请 URL 编码后重试');
  }
}

/**
 * 端口校验（fail-closed，对齐官方语义）：仅「未提供」回退默认端口（tedious 对未提供 port
 * 默认 1433）；提供了但不是 1-65535 的整数则抛中文错误——与 tedious 对非法 port 抛
 * RangeError 的行为一致，绝不静默改写用户配置（排障会被假端口误导）。
 */
function validPort(v: unknown, dflt: number): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`sqlserver 连接的端口取值非法：${JSON.stringify(v)}（须为 1-65535 的整数；留空才使用默认端口 ${dflt}）`);
  }
  return n;
}

/**
 * URL 脱敏（错误消息可能进 audit.jsonl 与模型上下文，绝不能回显明文密码）：
 * 保留 scheme 与 host(:port)，userinfo 一律替换为 ***，query/fragment 丢弃。
 * 纯文本处理、不依赖 WHATWG URL —— 本函数正是在 new URL() 失败时使用。
 */
function redactUrl(url: string): string {
  const schemeEnd = url.indexOf('://');
  const head = schemeEnd >= 0 ? url.slice(0, schemeEnd + 3) : '';
  const rest = url.slice(head.length);
  const authEnd = /[/?#]/.exec(rest)?.index ?? rest.length;
  const authority = rest.slice(0, authEnd);
  const at = authority.lastIndexOf('@');
  const host = at >= 0 ? authority.slice(at + 1) : authority;
  return `${head}${at >= 0 ? '***@' : ''}${host}`;
}

/** ResolvedConnection → mssql 池配置（浏览适配器与传输端共用，保证连接语义一致） */
function poolConfig(conn: ResolvedConnection): Record<string, unknown> {
  const options: Record<string, unknown> = {
    encrypt: true,
    trustServerCertificate: false,
    tdsVersion: '7_4',
    useUTC: true,
  };
  const cfg: Record<string, unknown> = { options };

  if (conn.url) {
    let u: URL;
    try {
      u = new URL(conn.url);
    } catch {
      // 脱敏：错误消息会进 audit.jsonl 与模型上下文，绝不回显 userinfo 明文密码
      throw new Error(
        `sqlserver 连接 URL 无法解析：${redactUrl(conn.url)}（期望形态 sqlserver://user:pass@host:1433/db?encrypt=true；请检查端口是否在 1-65535、是否有多余字符；命名实例请改用 ?instanceName=实例名 参数）`,
      );
    }
    if (!u.hostname) throw new Error('sqlserver 连接 URL 缺少主机名（期望形态 sqlserver://user:pass@host:1433/db）');
    cfg.server = u.hostname;
    cfg.port = u.port ? validPort(u.port, 1433) : 1433;
    if (u.username) cfg.user = decodeCred(u.username);
    if (u.password) cfg.password = decodeCred(u.password);
    const path = u.pathname.replace(/^\//, '');
    if (path) cfg.database = decodeCred(path);

    // encrypt 是三态（true/false/strict），故不走 boolParam：strict 会被布尔白名单判为非法
    applyEncrypt(options, queryParam(u.searchParams, 'encrypt'), ' URL ');
    options.trustServerCertificate = boolParam(u.searchParams, 'trustServerCertificate', false);
    options.useUTC = boolParam(u.searchParams, 'useUTC', true);
    applyTdsVersion(options, queryParam(u.searchParams, 'tdsVersion'), ' URL ');
    applyTlsMinVersion(options, queryParam(u.searchParams, 'tlsMinVersion'), ' URL ');
    applyServerName(options, queryParam(u.searchParams, 'serverName'));
    applyCaCert(options, queryParam(u.searchParams, 'caCert'), ' URL ');
    const instance = queryParam(u.searchParams, 'instanceName');
    // instanceName 与 port 互斥：mssql 层在建连前会 delete 掉 port（tedious 对两者共存直接抛
    // 互斥 Error），端口改由 SQL Server Browser（UDP 1434）按实例名解析
    if (instance !== undefined && instance !== '') options.instanceName = instance;
    // fields.database 覆盖 URL 库名：传输端跨库定位（sqlserverLocate）按 pg/mysql 惯例、
    // 用浅拷贝在 fields 上写 database 而不改写 URL——此处让该覆盖生效，避免静默连回原库。
    const fdb = conn.fields?.['database'];
    if (fdb != null && String(fdb) !== '') cfg.database = String(fdb);
  } else if (conn.fields) {
    const f = conn.fields;
    cfg.server = String(f.host ?? 'localhost');
    cfg.port = validPort(f.port, 1433);
    if (f.user != null && String(f.user) !== '') cfg.user = String(f.user);
    else if (f.username != null && String(f.username) !== '') cfg.user = String(f.username);
    if (f.password != null) cfg.password = String(f.password);
    if (f.database != null && String(f.database) !== '') cfg.database = String(f.database);
    if (f.instanceName != null && String(f.instanceName) !== '') options.instanceName = String(f.instanceName);
    // 分字段表单此前完全读不到这几个键：用户在表单里关掉加密/信任证书、选 TDS 版本或下探
    // TLS 下限都不生效（连接仍按 URL 默认值走），排障时会误以为参数没被实现。此处与 URL 分支
    // 同口径补齐，默认值仍取自 options 初始值（encrypt=true / trustServerCertificate=false /
    // tdsVersion=7_4 / useUTC=true）。
    // encrypt 与 URL 分支同口径的三态校验（true/false/strict），缺省沿用 options 初始值 encrypt=true
    applyEncrypt(options, f.encrypt, '配置');
    options.trustServerCertificate = boolField(
      f.trustServerCertificate,
      'trustServerCertificate',
      options.trustServerCertificate as boolean,
    );
    applyTdsVersion(options, f.tdsVersion, '配置');
    applyTlsMinVersion(options, f.tlsMinVersion, '配置');
    applyServerName(options, f.serverName);
    applyCaCert(options, f.caCert, '配置');
  } else {
    throw new Error('sqlserver 连接缺少 url 或 fields 配置');
  }

  // conn.ssl 是通用字段（mysql/pg 适配器同样处理）：语义上等价要求加密信道。
  // 已显式选 strict（TDS 8.0）时不降级为 true——strict 是更强的加密承诺，降级会悄悄削弱安全要求。
  if (conn.ssl && options.encrypt !== 'strict') options.encrypt = true;

  // 未显式给 caCert 时把系统信任库并入默认校验：Node 默认只信任内置 bundle，不读操作系统信任库，
  // 因此"按官方推荐把自签证书导入 Windows 受信任根"若不注入就对连接毫无帮助（详见 applySystemCaDefault）。
  applySystemCaDefault(options);

  cfg.connectionTimeout = 15000;
  cfg.requestTimeout = 30000;
  cfg.pool = { max: 10, min: 0, idleTimeoutMillis: 30000 };
  return cfg;
}

function resolveDatabase(conn: ResolvedConnection): string | undefined {
  if (conn.fields && conn.fields.database != null && String(conn.fields.database) !== '') {
    return String(conn.fields.database);
  }
  if (conn.url) {
    const p = new URL(conn.url).pathname.replace(/^\//, '');
    if (p) return decodeCred(p);
  }
  return undefined;
}

/* ============================ 最小词法扫描（安全路径） ============================ */

interface SqlScan {
  /** 顶层 `?` 在原文中的下标（按出现顺序） */
  placeholders: number[];
  /** 顶层 token（小写；已跳过字符串/方括号与双引号标识符/注释），供写形态与混用检测 */
  words: string[];
  /** 顶层分号之后仍有非空白、非注释内容（多语句） */
  multi: boolean;
  /** 出现单 @ 开头的命名参数（@p1 等；@@ 系统变量不计），供 ? 与 @pN 混用检测 */
  hasNamedParam: boolean;
}

/** T-SQL token 字符（标识符/关键字/变量名；`@` `#` `$` 均可在标识符内） */
const WORD_CHAR = /[A-Za-z0-9_@$#]/;

/**
 * 单遍词法扫描：识别并跳过字符串/标识符/注释，统计顶层 `?`、顶层 token 与顶层分号。
 * 跳过规则（T-SQL 词法）：
 *  - '...'：单引号串（N'...' 的 N 是普通字符，无需特殊处理），内部 '' 为转义；
 *  - [..]：方括号标识符，内部 ]] 为转义；
 *  - "..."：双引号（QUOTED_IDENTIFIER ON 下是标识符），内部 "" 为转义；
 *  - -- 行注释（到行尾）、块注释。
 * 已知边界（不实现，保持失败可见）：T-SQL 允许嵌套块注释（块注释里再开一个块注释），
 * 本扫描器按首个注释结束符收尾 → 会把注释里剩余的 `?` 计入占位符，最终报「个数不一致」
 * （fail-closed，不会误放行；提示文案可能略显跳脱）。需要精确支持时再扩展为深度计数。
 */
function scanSql(sql: string): SqlScan {
  const placeholders: number[] = [];
  const words: string[] = [];
  let hasNamedParam = false;
  let multi = false;
  let sawSemi = false;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    // 注释与空白整体跳过：它们不构成语句，也不参与「分号之后是否还有语句」的判定
    if (ch === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // 多语句判定必须先于各跳过分支：顶层分号之后只要还有任何内容（word / `?` / 标点 / 字符串起手），
    // 就是第二条语句。原实现把该判定放在循环末尾、且被 word 分支的 continue 绕过 —— 于是
    // `SELECT 1;DROP TABLE t`、`SELECT 1;EXEC xp_cmdshell 'x'` 这类「第二条全为标识符」的堆叠写被放行。
    if (sawSemi) multi = true;
    if (ch === "'" || ch === '"') {
      i++;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < n) {
        if (sql[i] === ']') {
          if (sql[i + 1] === ']') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(n, i + 2);
      continue;
    }
    if (WORD_CHAR.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_CHAR.test(sql[j]!)) j++;
      const tok = sql.slice(i, j).toLowerCase();
      words.push(tok);
      // 只认精确的 @p1/@P1 形态（T-SQL 变量名大小写不敏感）：@p1x、@p、@@p1 都是普通标识符/系统变量，
      // 把它们当占位符会误报「混用」，让用户无法使用以 @p 开头的变量名。
      if (/^@p\d+$/i.test(tok)) hasNamedParam = true;
      i = j;
      continue;
    }
    if (ch === '?') placeholders.push(i);
    else if (ch === ';') sawSemi = true;
    i++;
  }
  return { placeholders, words, multi, hasNamedParam };
}

/** 占位符/参数一致性校验（在建池建请求之前调用：参数写错不该先触发网络 IO） */
function assertPlaceholderCount(scan: SqlScan, params: unknown[]): void {
  // 混用会让 @pN 之外的位置也被绑定成同一个参数（静默错值），必须直接拒绝
  if (scan.hasNamedParam && scan.placeholders.length > 0) {
    throw new Error(
      '不允许在同一条语句中混用 ? 与 @pN 占位符：请统一使用 ?（适配器会自动重写为 @p1..@pN 并按顺序绑定）',
    );
  }
  if (scan.placeholders.length !== params.length) {
    throw new Error(
      `SQL 中 ? 占位符个数(${scan.placeholders.length})与传入参数个数(${params.length})不一致：请补齐/减少参数以匹配 ? 的个数` +
        '（本适配器只接受 ? 占位符并自动重写为 @pN 绑定，不支持在 SQL 里直接写 @pN 再单独传参）',
    );
  }
}

/** 把顶层 `?` 顺序重写为 @p1..@pN 并绑定到 request（调用前须已 assertPlaceholderCount） */
function rewritePlaceholders(req: SqlRequest, sql: string, scan: SqlScan, params: unknown[]): string {
  let out = '';
  let prev = 0;
  scan.placeholders.forEach((pos, idx) => {
    out += sql.slice(prev, pos) + `@p${idx + 1}`;
    prev = pos + 1;
  });
  out += sql.slice(prev);
  params.forEach((v, idx) => req.input(`p${idx + 1}`, v));
  return out;
}

/**
 * ro 模式下 query 的只读闸门（应用层防线，见文件头注释）：
 *  1) 首词白名单（SQL_READ_HEADS）；
 *  2) 拒绝多语句；
 *  3) SQL Server 专属写形态——通用 guard 遮不住的三类，而 SQL Server 没有服务器级只读可兜底：
 *     - `SELECT ... INTO <目标>`：无确认建表并复制数据（guard 的 into 只匹配 MySQL 的 OUTFILE/DUMPFILE）；
 *     - `WITH ... INSERT|UPDATE|DELETE|MERGE`：CTE 直接跟写语句（guard 的 writeBody 能识别，但 ro 只查首词）；
 *     - `OPENQUERY(...)/OPENROWSET(...)/OPENDATASOURCE(...)`：其字符串参数在远端/外部数据源执行任意语句
 *       （含写与 xp_cmdshell），ro 连接上无法审计其内容，一律拒绝（保守：只读场景罕见，误拒代价远小于放行写）。
 *  所有判定都走 scanSql 的顶层 token（已跳过字符串/方括号/双引号标识符/注释），
 *  因此字符串里的 into、方括号标识符（如 [into]）、以及块注释里的 into 都不会误伤。
 *  局限（安全取舍）：裸标识符恰好叫 into/delete 等保留字的极端场景会被误拒（fail-closed）。
 */
function assertReadOnlyQuery(sql: string, scan: SqlScan): void {
  if (!SQL_READ_HEADS.has(sqlHead(sql))) {
    throw new Error(
      'DRIVER_ERROR: 只读(ro)模式下 query 仅允许读语句（select/with/show/describe/desc/explain/use/set/help/table），写操作请使用可写连接',
    );
  }
  if (scan.multi) {
    throw new Error('DRIVER_ERROR: 只读(ro)模式下 query 不允许一次提交多条语句（分号后仍有语句），请拆分为独立查询');
  }
  const words = new Set(scan.words);
  if (words.has('into')) {
    throw new Error('DRIVER_ERROR: 只读(ro)模式下不允许 SELECT ... INTO（会创建新表并复制数据），请使用可写连接');
  }
  if (
    scan.words[0] === 'with' &&
    (words.has('insert') || words.has('update') || words.has('delete') || words.has('merge'))
  ) {
    throw new Error(
      'DRIVER_ERROR: 只读(ro)模式下不允许 WITH 子句后跟写操作（insert/update/delete/merge），请使用可写连接',
    );
  }
  if (words.has('openquery') || words.has('openrowset') || words.has('opendatasource')) {
    throw new Error(
      'DRIVER_ERROR: 只读(ro)模式下不允许 OPENQUERY/OPENROWSET/OPENDATASOURCE（其字符串参数会在远端/外部数据源执行任意语句，无法审计），请使用可写连接',
    );
  }
}

/* ============================ 错误人性化 ============================ */

interface MssqlErrLike {
  name?: unknown;
  code?: unknown;
  number?: unknown;
  severity?: unknown;
  lineNumber?: unknown;
  message?: unknown;
  originalError?: unknown;
  cause?: unknown;
  precedingErrors?: unknown;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * SQL Server 引擎错误号 → 针对性的中文诊断与出口（仅覆盖「光看英文 message 会走错方向」的那些）。
 *
 * 原则：错误号是服务器给的结构化事实，比 message 文本可靠；但药方必须与成因正交地给对——
 *  - 17819 只要 TDS 8.0，与证书是否受信无关，绝不能给 trustServerCertificate；
 *  - 17898/17802 是 TDS 协议版本被拒，官方协议规定服务器会自动降级，故正解是升级客户端库，
 *    不是让用户去下调 tdsVersion（那会把问题从「连不上」变成「连上了但行为异常」）；
 *  - 17835 是服务器强制加密，解法是开 encrypt，同样与证书无关；
 *  - 17836/17828/17832 是包结构错配（代理/分片/加密中间层/连错端口），不是版本问题，
 *    给 tdsVersion 建议会把排查引向完全错误的方向；
 *  - 47072 是 Azure 的最低 TLS 版本门槛，只会由「版本太低」触发，不会由「证书不受信」触发。
 */
const EREQUEST_HINTS: Record<number, string> = {
  17819:
    '服务器只接受加密连接（要求 TDS 8.0 严格加密）：请在连接 URL 追加 ?encrypt=strict 后重试（strict 走 TDS 8.0，TLS 在登录包之前就完成握手，仅 SQL Server 2022 及以上且开启 Force Strict Encryption 的实例支持）',
  17898:
    '客户端声明的 TDS 协议版本不被服务器接受：官方协议（MS-TDS LOGIN7）规定服务器应降级到自身最高版本，所以正确做法是升级客户端驱动/库的版本，而不是下调 tdsVersion',
  17802:
    '服务器拒绝该 TDS 协议版本（中间 TDS 版本不受支持）：请升级客户端驱动/库的版本；下调 tdsVersion 只会让协议降级、后续行为更不可预期',
  17835:
    '服务器强制要求加密连接，而当前配置未启用加密：请在连接 URL 追加 ?encrypt=true 后重试（这是加密开关问题，与证书是否受信无关，不要用关闭证书校验的方式绕过）',
  17836:
    '登录包长度与网络包声明不一致：通常是代理、端口转发、加密中间层或分片设备改写了 TDS 包，或连到了并非 SQL Server 的端口。请核对端口与链路中间设备',
  17828:
    '预登录包结构非法（服务器认为客户端发来的预登录包不合法）：通常是代理或加密中间层改写了包结构，请核对网络链路中的中间设备与端口',
  17832:
    '服务器无法解析客户端登录包：可能是包被中间层改写、驱动版本与服务端加解密方式不匹配，或连到了非 SQL Server 端口。请核对链路中间设备',
  47072:
    'Azure SQL 要求的最低 TLS 版本未满足：请把客户端 TLS 版本提升到 1.2 及以上（不要下探 tlsMinVersion，也不要关闭证书校验——这个错误只由版本过低触发）',
};

/** 已知错误号对应的补充诊断（未收录返回 undefined，保持原有通用文案） */
function erequestHint(num: number | undefined): string | undefined {
  if (num === undefined) return undefined;
  return Object.prototype.hasOwnProperty.call(EREQUEST_HINTS, num) ? EREQUEST_HINTS[num] : undefined;
}

/**
 * mssql 错误码 → 中文可读提示。ETIMEOUT 在 ConnectionError（建连超时）与 RequestError
 * （语句执行超时）下语义不同，故结合 err.name 判断而非只看 code；originalError/precedingErrors
 * 附加在末尾用于追溯。无法识别时保留原始 message（不吞信息）。
 */
function mssqlReason(e: unknown): string {
  const err = (e ?? {}) as MssqlErrLike;
  const code = typeof err.code === 'string' ? err.code : '';
  const name = typeof err.name === 'string' ? err.name : '';
  const detail = typeof err.message === 'string' ? err.message : String(e);
  const num = typeof err.number === 'number' ? err.number : undefined;
  const sev = typeof err.severity === 'number' ? err.severity : undefined;
  const line = typeof err.lineNumber === 'number' ? err.lineNumber : undefined;

  // TLS 失败在 SQL Server 2008/2008 R2 上很常见，但根因分两族、解法正交，必须分开给：
  //  - 证书族（自签/链不可验证）：证书校验阶段失败 → trustServerCertificate=true / encrypt=false；
  //  - 协议族（无共同 TLS 版本）：版本协商阶段就失败，证书校验根本没执行 → 只能升服务端 TLS 1.2
  //    或让客户端下探 ?tlsMinVersion=。给它 trustServerCertificate 是开错药方（用户会白跑一轮）。
  // 默认 encrypt=true + trustServerCertificate=false 与 mssql 官方一致（不改默认值），且无论哪族
  // 都不能把「TCP 已连通、TLS 失败」误报成网络不可达（会把用户引向错误排查方向）。
  // tedious 建连期把底层 socket/TLS 错误用 ES cause 选项挂在 err.cause（originalError 是 mssql 事务
  // abort 专用，建连场景恒 undefined），message 已聚合底层原文但读 cause 更稳，一并纳入特征文本。
  const causeText = errText(err.cause);
  const tlsText = `${detail} ${errText(err.originalError)} ${causeText}`;
  // 协议族：BoringSSL/OpenSSL 的「没有共同协议版本」家族。UNSUPPORTED_PROTOCOL = SSL_R_UNSUPPORTED_PROTOCOL，
  // 在 ClientHello/ServerHello 版本协商阶段就返回，握手从未走到证书校验；`no protocols available` 是 Node
  // 侧同一语义的表述（ERR_SSL_NO_PROTOCOLS_AVAILABLE 亦含此串）。SSL routines 单独出现不足以判族
  // （证书错误也带该前缀），故要求同时含 UNSUPPORTED。
  const tlsProtoish =
    /UNSUPPORTED_PROTOCOL|no protocols available|alert protocol version|(?:SSL[ -_]?routines|OPENSSL_internal)[\s\S]{0,80}?UNSUPPORTED/i.test(
      tlsText,
    );
  // 证书族：证书本身不可信（自签、链断、主机名不符、已过期）
  const tlsCertish = /self[ -]?signed|certificate|unable to verify|CERT_/i.test(tlsText);
  // 兜底「确实是 TLS 层失败」的通用前缀：只用于把 base 从「网络不可达」纠正为「TCP 已连通」，
  // 不据此给任何具体药方（族未定就不该猜）。刻意不加 ECONNRESET/socket hang up/ENOTFOUND——
  // 与真实网络故障不可区分，误加会让 ECONNREFUSED 场景被套上 TLS 指引。
  const tlsish =
    tlsProtoish ||
    tlsCertish ||
    /ERR_SSL|EPROTO|SSL[ -_]?routines|OPENSSL_internal|handshake[ _-]?(failure|client|server)|TLSV1_ALERT|SSLV3_ALERT|alert handshake failure/i.test(
      tlsText,
    );

  // 已知错误号对应的针对性诊断（未收录为 undefined）：既用于 EREQUEST 文案，也用于抑制 TLS 族建议
  const knownHint = erequestHint(num);

  let base: string;
  switch (code) {
    case 'ELOGIN':
      base = `登录失败：用户名或密码错误，或账号不允许从当前主机登录（${detail}）`;
      break;
    case 'ETIMEOUT':
      base =
        name === 'ConnectionError'
          ? `连接超时：未能在超时时间内建立连接，请检查主机/端口/防火墙（${detail}）`
          : `请求超时：语句执行超过 requestTimeout，请拆小查询或调大超时（${detail}）`;
      break;
    case 'ESOCKET':
      // 保留「网络不可达」字样（既有断言与用户检索习惯依赖），但 TLS 特征时先说明 TCP 已连通。
      // 协议族与证书族分开表述：前者是版本协商失败，与证书无关。
      base = tlsProtoish
        ? `TCP 已连通但 TLS 协议版本协商失败：客户端与服务端没有共同的 TLS 协议版本（UNSUPPORTED_PROTOCOL 出现在版本协商阶段，此时证书校验尚未执行，故与证书是否受信无关）（${detail}）`
        : tlsish
          ? `TCP 已连通但 TLS 握手/证书校验失败（不是网络不可达：网络不可达指主机/端口不可达或连接被拒，此处 TCP 已建立）（${detail}）`
          : `网络不可达：无法与服务器建立 TCP 连接，请检查主机名、端口与网络；端口确认可达仍反复出现时，也可能是服务器在 TLS 握手阶段主动断开（如老实例仅支持 TLS 1.0）（${detail}）`;
      break;
    // 服务器强制加密（SQL Server 2022 / Azure SQL 默认）而客户端 encrypt=false：tedious 抛英文原文，
    // 不映射则中文界面里只剩英文，故单列一条给出可直接照做的改法。
    // 同一个 EENCRYPT 有两种相反成因，必须分开表述（tedious 20.3.7+ 新增了前者的校验）：
    //  - encrypt=true 而服务器预登录没回 ON/REQ → 服务器未协商加密，握手本会退化成明文，驱动现在直接拒绝；
    //  - encrypt=false 而服务器要求加密 → 服务器侧强制。
    // 两者的药方正好相反（一个要关、一个要开），合并成一句必然把用户引反方向。
    case 'EENCRYPT':
      base = /did not negotiate encryption/i.test(detail)
        ? `服务器未协商加密：客户端要求加密（encrypt=true）但服务器在预登录响应里没有回 ON/REQ，驱动为避免明文降级直接拒绝连接。若该实例确实不支持加密，可改用 ?encrypt=false 明文连接（内网可接受时）；若要求加密，请在服务器侧启用「强制加密」并配置有效证书（${detail}）`
        : `服务器要求加密连接：当前 encrypt=false 被服务器拒绝，请改用 ?encrypt=true 后重试（${detail}）`;
      break;
    case 'EINSTLOOKUP':
      base = `实例名解析失败：SQL Server Browser 服务可能未运行或 UDP 1434 不可达（命名实例可改用「主机，端口」直连，如 host,1433）（${detail}）`;
      break;
    case 'ENOTOPEN':
    case 'ECONNCLOSED':
      base = `连接已关闭或未打开：请重新连接后重试（${detail}）`;
      break;
    case 'ECANCEL':
      base = `请求已取消（${detail}）`;
      break;
    case 'EREQUEST': {
      base = `SQL 执行错误${num !== undefined ? `（错误号 ${num}${sev !== undefined ? `、严重级 ${sev}` : ''}${line !== undefined ? `、第 ${line} 行` : ''}）` : ''}：${knownHint === undefined ? detail : `${knownHint}。服务器原文：${detail}`}`;
      break;
    }
    default:
      base = detail;
  }

  const trail: string[] = [];
  // 已知错误号已经给出了针对性诊断时，抑制 TLS 族建议：这类错误的服务器原文常含 certificate /
  // encryption 字样（如 17819 的「TLS certificate is not configured to accept strict」），会被下面的
  // 正则命中；但真因是服务端配置/协议问题，客户端装 CA、关校验一律无效，叠加只会给出互相矛盾的药方。
  if (knownHint !== undefined) {
    // 已由 EREQUEST_HINTS 给出单一出口，此处不再追加任何族建议
  } else if (tlsProtoish) {
    // 顺序即优先级：服务端升级是正解（一次性、对所有客户端生效），客户端下探是权宜（仍受限于
    // 服务端实际支持的版本）。第③条显式点名「跳过证书校验」是先发制人——用户看到 TLS 报错的第一
    // 反应通常就是去信任证书，明说无效比沉默更省一轮排查；措辞必须是否定式，不得写成可尝试项。
    trail.push(
      '修复优先级：① 首选在服务端启用 TLS 1.2（SQL Server 2008 R2 SP3 装 KB4057113、SQL Server 2008 SP4 装 KB4057114，之后重启实例）——这是根治，且对所有客户端生效',
    );
    trail.push(
      '② 若暂时无法动服务端，可在连接 URL 追加 ?tlsMinVersion=TLSv1 让客户端把最低 TLS 版本下探到 1.0（本插件已支持；上限仍由 tedious 封顶在 TLS 1.2）',
    );
    trail.push(
      '③ 注意：跳过证书校验（信任任意证书）对这类错误无效——它只影响证书校验阶段，而此处是协议版本协商失败，证书校验根本没执行',
    );
  } else if (tlsCertish) {
    // 证书族（自签/链断/主机名不符/已过期）：解法有强弱两档，必须把官方推荐摆在前面。
    // ① 装 CA（?caCert= 给 PEM 或文件路径）——校验照旧生效，只把签发者加进信任列表，这是官方推荐做法；
    // ② strict（TDS 8.0）下 trustServerCertificate 完全失效：tedious 的 wrapWithTls 调 tls.connect
    //    时没有传 rejectUnauthorized，证书是强制校验的。必须说清，否则用户在 strict 下改这个开关
    //    会「改完还是同样的错」，白排查一轮。
    trail.push(
      '官方推荐先在客户端装 CA 而不是关校验：把签发服务器证书的根 CA（自签场景就是该证书本身）经 ?caCert= 指向 PEM 路径或直接给 PEM 文本，让证书校验照常生效；若证书签发给域名而你是用 IP/转发地址连接的，再用 ?serverName=域名 指定用于校验的名字',
    );
    trail.push(
      '② 不得已才关校验：?trustServerCertificate=true（跳过证书链与主机名校验，仅加密信道不保证对端身份），或 ?encrypt=false（前提是服务器未强制加密）——SQL Server 2008/2008 R2 与使用自签证书的实例常见此情形，但这两条都会削弱安全性，仅建议内网临时使用',
    );
    trail.push(
      '③ 注意：若当前用的是 ?encrypt=strict（TDS 8.0），trustServerCertificate 完全不生效（驱动 strict 路径不传 rejectUnauthorized，证书强制校验），只能装 CA 或改用 ?encrypt=true',
    );
  }
  if (err.originalError !== undefined) trail.push(`原始错误: ${errText(err.originalError)}`);
  else if (
    err.cause !== undefined &&
    err.cause !== null &&
    errText(err.cause) !== detail &&
    !detail.includes(errText(err.cause))
  ) {
    // 建连错误（ESOCKET 等）的底层错误在 cause 且已被 tedious 拼进 message 尾段；仅当
    // message 未包含其全文（如被截断/包装）时补一条干净的底层错误，避免重复
    trail.push(`原始错误: ${errText(err.cause)}`);
  }
  if (Array.isArray(err.precedingErrors) && err.precedingErrors.length > 0) {
    trail.push(`前序错误: ${err.precedingErrors.map(errText).join('; ')}`);
  }
  return trail.length > 0 ? `${base}。${trail.join('；')}` : base;
}

/** 映射错误并把结构化信息（code/number/…）透传给上层，便于日志与守卫判断 */
function mappedError(e: unknown): Error {
  const err = e instanceof Error ? e : new Error(String(e));
  const reason = mssqlReason(e);
  const out = new Error(reason);
  out.name = err.name;
  const src = err as MssqlErrLike;
  Object.assign(out, {
    code: src.code,
    number: src.number,
    severity: src.severity,
    lineNumber: src.lineNumber,
    originalError: err,
  });
  return out;
}

/** humanize + 错误码映射的组合包装 */
function wrap<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return humanize(label, async () => {
    try {
      return await fn();
    } catch (e) {
      throw mappedError(e);
    }
  });
}

/* ============================ 类型规范化 ============================ */

/** 字符/二进制类（max_length 即字符数）；N 前缀类型 max_length 是字节数（2 倍字符数） */
const CHAR_TYPES = new Set(['char', 'varchar', 'binary', 'varbinary']);
const NCHAR_TYPES = new Set(['nchar', 'nvarchar']);
const DECIMAL_TYPES = new Set(['decimal', 'numeric']);
const SCALED_TYPES = new Set(['datetime2', 'datetimeoffset', 'time']);

function formatDataType(name: string, maxLength: number, precision: number, scale: number): string {
  const t = name.toLowerCase();
  if (CHAR_TYPES.has(t) || NCHAR_TYPES.has(t)) {
    if (maxLength < 0) return `${name}(max)`;
    const len = NCHAR_TYPES.has(t) ? Math.floor(maxLength / 2) : maxLength;
    return `${name}(${len})`;
  }
  if (DECIMAL_TYPES.has(t)) return `${name}(${precision}, ${scale})`;
  if (SCALED_TYPES.has(t)) return `${name}(${scale})`;
  return name;
}

/** 版本探测 SQL（ProductMajorVersion 为 NULL 时用 ProductVersion 前缀回退） */
const VERSION_SQL = `SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int) AS major,
       CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version`;

function parseMajor(row: Record<string, unknown> | undefined): number {
  const m = row?.['major'];
  if (typeof m === 'number' && Number.isFinite(m) && m >= 1) return m;
  const v = row?.['version'];
  if (typeof v === 'string') {
    const p = Number.parseInt(v, 10);
    if (Number.isFinite(p) && p >= 1) return p;
  }
  return 0; // 探测失败按 <11 降级（ROW_NUMBER 在任意版本可用，保证能出结果）
}

/* ============================ 池包装 ============================ */

/** 结果行视图（元素形态在类型上放宽为 unknown，读取时统一按 Record 处理） */
function rowsOf(res: SqlQueryResult): Record<string, unknown>[] {
  return (res.recordset ?? res.recordsets?.[0] ?? []) as Record<string, unknown>[];
}

interface PoolBox {
  pool: SqlPool;
  /** 幂等建连（并发共享同一次连接；失败不缓存以便重试） */
  ready(): Promise<void>;
  /** 服务器主版本号（按池缓存；探测失败视为 0 → 降级路径） */
  major(): Promise<number>;
}

function makePoolBox(Driver: SqlDriver, cfg: Record<string, unknown>): PoolBox {
  const pool = new Driver.ConnectionPool(cfg);
  // 无条件兜底：mssql 的 ConnectionPool 在 acquire 失败（空闲连接被服务器断开等）时会
  // emit('error', err)，EventEmitter 无监听器时直接抛 → 崩掉宿主进程。这里只留痕不中断请求。
  pool.on('error', (e: unknown) => {
    console.error('[sqlserver] 连接池错误（不影响后续请求，连接将按需重建）:', e instanceof Error ? e.message : e);
  });

  let connecting: Promise<void> | undefined;
  const ready = (): Promise<void> => {
    if (connecting === undefined) {
      connecting = Promise.resolve(pool.connect()).then(
        () => undefined,
        (e: unknown) => {
          connecting = undefined; // 失败不缓存：允许下次重试
          throw e;
        },
      );
    }
    return connecting;
  };

  let majorPromise: Promise<number> | undefined;
  const major = (): Promise<number> => {
    if (majorPromise === undefined) {
      // 探测失败（SERVERPROPERTY 不可用 / 无权限 / 网络抖动）一律按 0 → 走 ROW_NUMBER 降级路径：
      // 探测本身不该把整个 previewRows 打挂，ROW_NUMBER 在任意版本都可用（与传输端 propOf 的容错对称）。
      majorPromise = (async () => {
        try {
          await ready();
          const res = await pool.request().query(VERSION_SQL);
          return parseMajor(rowsOf(res)[0]);
        } catch {
          return 0;
        }
      })();
    }
    return majorPromise;
  };

  return { pool, ready, major };
}

/* ============================ 适配器 ============================ */

const LIST_DATABASES_SQL = `SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name`;

// 系统 schema 过滤：guest/sys/INFORMATION_SCHEMA 与固定数据库角色 schema（schema_id >= 16384）
const LIST_SCHEMAS_SQL = `SELECT s.name AS name FROM sys.schemas s
 WHERE s.name NOT IN ('guest', 'sys', 'INFORMATION_SCHEMA') AND s.schema_id < 16384
 ORDER BY s.name`;

// sys.objects 同时覆盖表(U)与视图(V)；is_ms_shipped 排除系统附带对象
const LIST_TABLES_SQL = `SELECT o.name AS table_name, o.type AS obj_type
 FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
 WHERE s.name = @p1 AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
 ORDER BY o.name`;

// 元数据一律用 object_id/column_id 整数键关联（避免 collation/大小写差异）；
// 扩展属性 MS_Description 作列注释（2005+ 通用写法，无 STRING_AGG/CONCAT_WS 等新语法）
const DESCRIBE_COLUMNS_SQL = `SELECT c.column_id, c.name AS column_name, t.name AS type_name,
        c.max_length, c.precision, c.scale, c.is_nullable,
        dc.definition AS default_def, ep.value AS comment
 FROM sys.columns c
 JOIN sys.types t ON t.user_type_id = c.user_type_id
 LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
 LEFT JOIN sys.extended_properties ep ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = N'MS_Description'
 WHERE c.object_id = OBJECT_ID(@p1)
 ORDER BY c.column_id`;

const DESCRIBE_PK_SQL = `SELECT ic.column_id
 FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
 WHERE i.object_id = OBJECT_ID(@p1) AND i.is_primary_key = 1`;

const TEST_CONNECT_SQL = `SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version,
       CAST(SERVERPROPERTY('ProductMajorVersion') AS int) AS major,
       CAST(SERVERPROPERTY('EngineEdition') AS int) AS engine`;

const PRODUCT_NAMES: Record<number, string> = {
  9: '2005',
  10: '2008',
  11: '2012',
  12: '2014',
  13: '2016',
  14: '2017',
  15: '2019',
  16: '2022',
  17: '2025',
};

/** 版本串展示：'Microsoft SQL Server 2019 - 15.0.2000.5'（Azure SQL 按 EngineEdition=5 单独标注） */
function serverInfo(version: string, major: unknown, engine: unknown): string {
  if (engine === 5) return `Azure SQL Database - ${version}`;
  const m = typeof major === 'number' ? major : Number.parseInt(version, 10);
  let name = PRODUCT_NAMES[m];
  if (m === 10 && version.startsWith('10.5')) name = '2008 R2';
  return `Microsoft SQL Server ${name ?? m} - ${version}`;
}

export async function createSqlserverAdapter(
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode; driver?: SqlDriver },
): Promise<DatabaseAdapter & { tx: TxHandle }> {
  // 配置先于驱动解析：配置错误不依赖 vendor 是否构建，用户能立刻拿到正确指引
  const cfg = poolConfig(conn);
  const Driver = opts?.driver ?? vendor();
  const readOnly = opts?.mode === 'ro';
  const mainDb = resolveDatabase(conn);

  // 类型钉死：decimal/numeric/bigint/uniqueidentifier 一律转字符串。SQL Server 官方类型表里
  // decimal/numeric 返回 JS Number、bigint 返回 Number/String，超过 2^53 会静默丢精度；
  // 注意驱动在解析阶段已按数值解析过（精度损失发生在 tedious 内部），此处只能防止后续
  // 再被当数值处理——需要逐位保真的场景请在 SQL 里显式 CONVERT(nvarchar(...), col)。
  const TYPES = Driver.TYPES ?? {};
  const pinnedTypes = new Set<unknown>(
    [TYPES['Decimal'], TYPES['Numeric'], TYPES['BigInt'], TYPES['UniqueIdentifier']].filter(
      (t) => t !== undefined,
    ),
  );

  const cellOf = (v: unknown, meta?: { type?: unknown }): NormalizedCell => {
    if (v === null || v === undefined) return null;
    if (meta?.type !== undefined && pinnedTypes.has(meta.type)) {
      return typeof v === 'string' ? v : typeof v === 'bigint' ? v.toString() : String(v);
    }
    return normalizeCell(v);
  };

  const toQueryResult = (res: SqlQueryResult, dropColumns?: readonly string[]): QueryResult => {
    const recordset = (res.recordset ?? res.recordsets?.[0] ?? []) as SqlRecordset;
    const meta = recordset.columns;
    const first = recordset[0] as Record<string, unknown> | undefined;
    let names = meta ? Object.keys(meta) : first ? Object.keys(first) : [];
    if (dropColumns && dropColumns.length > 0) {
      const drop = new Set(dropColumns.map((c) => c.toLowerCase()));
      names = names.filter((c) => !drop.has(c.toLowerCase()));
    }
    const rows = recordset.map((r) => {
      const row = r as Record<string, unknown>;
      return names.map((c) => cellOf(row[c], meta?.[c]));
    });
    return { columns: names, rows, rowCount: rows.length };
  };

  const mainPool = makePoolBox(Driver, cfg);

  // 跨库（Navicat 式）：按库名缓存独立池，ro 时同样受首词白名单约束（query 路径统一校验）。
  /**
   * 关闭幂等标志：manager 在授权复核失败路径会关两次（pg-pool 二次 end() 会抛的教训）。
   * 关闭后一切访问都必须在此处被拦下——否则 mssql 池会以 ENOTOPEN 报英文错，
   * 且跨库访问还会新建池（关不掉的连接泄漏）。
   */
  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error('sqlserver 连接已关闭：请重新连接后重试');
  };

  const dbPools = new Map<string, PoolBox>();
  const poolOf = (db: string | undefined): PoolBox => {
    assertOpen();
    if (!db) return mainPool;
    // SQL Server 库名默认不区分大小写：池键归一为小写，避免 MyDB / mydb 各建一个池（连接泄漏）。
    const key = db.toLowerCase();
    if (mainDb !== undefined && key === mainDb.toLowerCase()) return mainPool;
    let box = dbPools.get(key);
    if (!box) {
      box = makePoolBox(Driver, { ...cfg, database: db });
      dbPools.set(key, box);
    }
    return box;
  };

  // 事务激活期间 query/execute 必须走同一连接（mssql 的事务请求自带该连接）
  let txObj: SqlTransaction | null = null;

  const defaultSchema = (): string => {
    const f = conn.fields;
    return f && typeof f.schema === 'string' && f.schema ? f.schema : 'dbo';
  };

  /** 浏览目标：'db.schema'（跨库） | 'schema'（当前库） | 空（当前库默认 schema） */
  const parseBrowseTarget = (
    ref: string | undefined,
    what: string,
  ): { db: string | undefined; schema: string } => {
    if (!ref) return { db: undefined, schema: defaultSchema() };
    const i = ref.indexOf('.');
    if (i < 0) return { db: undefined, schema: assertIdent(ref, what) };
    return { db: assertIdent(ref.slice(0, i), '数据库'), schema: assertIdent(ref.slice(i + 1), what) };
  };

  /** 取执行用的 request：事务中走事务连接（跨库请求不参与事务，与 pg-like 同语义） */
  const requestFor = async (db: string | undefined): Promise<{ req: SqlRequest; inTx: boolean }> => {
    assertOpen();
    if (txObj && db === undefined) return { req: txObj.request(), inTx: true };
    const box = poolOf(db);
    await box.ready();
    return { req: box.pool.request(), inTx: false };
  };

  const tx: TxHandle = {
    begin: () =>
      wrap('sqlserver 事务开启', async () => {
        if (txObj) throw new Error('事务已开启，请勿重复 begin');
        await mainPool.ready();
        const t = new Driver.Transaction(mainPool.pool);
        await t.begin();
        txObj = t;
      }),
    commit: () =>
      wrap('sqlserver 事务提交', async () => {
        const t = txObj;
        if (!t) throw new Error('没有进行中的事务');
        txObj = null;
        await t.commit();
      }),
    rollback: () =>
      wrap('sqlserver 事务回滚', async () => {
        const t = txObj;
        if (!t) throw new Error('没有进行中的事务');
        txObj = null;
        await t.rollback();
      }),
  };

  return {
    kind: 'sqlserver',
    connId: conn.meta.id,
    tx,

    testConnect: () =>
      wrap('sqlserver 连接测试', async () => {
        assertOpen();
        await mainPool.ready();
        const res = await mainPool.pool.request().query(TEST_CONNECT_SQL);
        const row = rowsOf(res)[0];
        const version = typeof row?.['version'] === 'string' ? row['version'] : '';
        if (version === '') return { ok: true, serverInfo: 'SQL Server（版本信息不可读）' };
        return { ok: true, serverInfo: serverInfo(version, row?.['major'], row?.['engine']) };
      }),

    query: (sql, params, database) =>
      wrap('sqlserver 查询失败', async () => {
        const scan = scanSql(sql);
        if (readOnly) assertReadOnlyQuery(sql, scan);
        const binds = params ?? [];
        assertPlaceholderCount(scan, binds);
        const db = database ? assertIdent(database, '数据库') : undefined;
        const { req } = await requestFor(db);
        const text = rewritePlaceholders(req, sql, scan, binds);
        const res = await req.query(text);
        return toQueryResult(res);
      }),

    execute: (statement, params, database) =>
      wrap('sqlserver 执行失败', async (): Promise<ExecResult> => {
        // ro 连接由服务层拦截（本适配器不重复拦 execute：控制台事务通道也会用 execute 发读语句）
        const scan = scanSql(statement);
        const binds = params ?? [];
        assertPlaceholderCount(scan, binds);
        const db = database ? assertIdent(database, '数据库') : undefined;
        const { req } = await requestFor(db);
        const text = rewritePlaceholders(req, statement, scan, binds);
        const res = await req.query(text);
        const arr = res.rowsAffected ?? [];
        let sum = 0;
        let known = false;
        for (const n of arr) {
          if (typeof n === 'number' && Number.isFinite(n)) {
            sum += n;
            known = true;
          }
        }
        return {
          affectedRows: known ? sum : undefined,
          message: known ? `执行成功，受影响 ${sum} 行` : '执行成功',
        };
      }),

    listDatabases: () =>
      wrap('sqlserver 列出数据库', async () => {
        const box = poolOf(undefined); // 走主池并经 assertOpen（关闭后抛中文错误而非驱动英文错）
        await box.ready();
        const res = await box.pool.request().query(LIST_DATABASES_SQL);
        return rowsOf(res).map((r) => String(r['name']));
      }),

    listSchemas: (database) =>
      wrap('sqlserver 列出模式', async () => {
        const box = poolOf(database ? assertIdent(database, '数据库') : undefined);
        await box.ready();
        const res = await box.pool.request().query(LIST_SCHEMAS_SQL);
        return rowsOf(res).map((r) => String(r['name']));
      }),

    listTables: (database) =>
      wrap('sqlserver 列出表', async () => {
        const { db, schema } = parseBrowseTarget(database, 'schema');
        const box = poolOf(db);
        await box.ready();
        const req = box.pool.request();
        req.input('p1', schema);
        const res = await req.query(LIST_TABLES_SQL);
        return rowsOf(res).map((r): TableInfo => {
          const raw = String(r['obj_type']);
          return {
            name: String(r['table_name']),
            type: raw === 'U' ? 'TABLE' : raw === 'V' ? 'VIEW' : raw,
            database: db ? `${db}.${schema}` : schema,
          };
        });
      }),

    describeTable: (table, database) =>
      wrap('sqlserver 查看表结构', async () => {
        const { db, schema } = parseBrowseTarget(database, 'schema');
        const tbl = assertIdent(table, '表名');
        const box = poolOf(db);
        await box.ready();
        const ref = `[${schema.replaceAll(']', ']]')}].[${tbl.replaceAll(']', ']]')}]`;

        const colReq = box.pool.request();
        colReq.input('p1', ref);
        const cols = await colReq.query(DESCRIBE_COLUMNS_SQL);
        const columnRows = rowsOf(cols);
        if (columnRows.length === 0) throw new Error(`表不存在: ${schema}.${tbl}`);

        const pkReq = box.pool.request();
        pkReq.input('p1', ref);
        const pkRes = await pkReq.query(DESCRIBE_PK_SQL);
        const pkIds = new Set(rowsOf(pkRes).map((r) => Number(r['column_id'])));

        return columnRows.map((r): ColumnInfo => {
          const typeName = String(r['type_name']);
          const comment = r['comment'];
          const dflt = r['default_def'];
          const id = Number(r['column_id']);
          return {
            name: String(r['column_name']),
            dataType: formatDataType(
              typeName,
              Number(r['max_length'] ?? 0),
              Number(r['precision'] ?? 0),
              Number(r['scale'] ?? 0),
            ),
            nullable: r['is_nullable'] === true || r['is_nullable'] === 1,
            key: pkIds.has(id) ? 'PRI' : undefined,
            default: dflt == null ? null : String(dflt),
            comment: comment == null || comment === '' ? undefined : String(comment),
          };
        });
      }),

    previewRows: (table, limit, database, offset) =>
      wrap('sqlserver 预览行', async () => {
        const { db, schema } = parseBrowseTarget(database, 'schema');
        const tbl = assertIdent(table, '表名');
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const box = poolOf(db);
        const major = await box.major();
        const q = (name: string): string => `[${name.replaceAll(']', ']]')}]`;
        const target = `${q(schema)}.${q(tbl)}`;

        if (major >= 11) {
          // T-SQL 的 OFFSET/FETCH 强制要求 ORDER BY；(SELECT NULL) 是常量排序，等价于不指定顺序。
          // 绑定：@p1 = 偏移，@p2 = 行数（FETCH NEXT @p2）。
          const req = box.pool.request();
          req.input('p1', off);
          req.input('p2', lim);
          const res = await req.query(
            `SELECT * FROM ${target} ORDER BY (SELECT NULL) OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY`,
          );
          return toQueryResult(res);
        }
        // 2008/2008 R2：无 OFFSET/FETCH，用 ROW_NUMBER 子查询降级；内部序号列在投影后剔除。
        // 绑定：@p1 = 偏移，@p2 = 上界（off + lim，不是 lim！否则 offset>0 时第 2 页起恒为空）。
        const req = box.pool.request();
        req.input('p1', off);
        req.input('p2', off + lim);
        const res = await req.query(
          `SELECT t.* FROM (SELECT *, ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS [__dsh_rn] FROM ${target}) AS t WHERE t.[__dsh_rn] > @p1 AND t.[__dsh_rn] <= @p2`,
        );
        return toQueryResult(res, ['__dsh_rn']);
      }),

    close: () =>
      wrap('sqlserver 关闭连接', async () => {
        if (closed) return;
        closed = true;
        await Promise.all([mainPool.pool.close(), ...[...dbPools.values()].map((b) => b.pool.close())]);
      }),
  };
}

/** 传输层等内部调用用的工厂（注意：会丢弃 opts.mode，服务层注册表不得使用） */
export const factory: AdapterFactory = (conn) => createSqlserverAdapter(conn);

/**
 * 数据传输端复用的独立原始池（绕过展示化转换，保真搬运）。
 * 库名与主连接一致（跨库由调用方在 conn 上覆盖 database）。
 */
export async function openSqlserverRaw(
  conn: ResolvedConnection,
  driver?: SqlDriver,
): Promise<SqlserverRaw> {
  const Driver = driver ?? vendor();
  const cfg = poolConfig(conn);
  const box = makePoolBox(Driver, cfg);
  const database = typeof cfg.database === 'string' ? cfg.database : '';
  return { pool: box.pool, ready: box.ready, database, driver: Driver };
}
