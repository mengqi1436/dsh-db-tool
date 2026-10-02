/**
 * connections.json：连接元数据（绝不含密码）。
 *
 * create/update 时自动做机密拆分：
 *  - url → 完整 URL 进 secrets.json，脱敏副本（密码段 ***）留在本文件 urlSafe；
 *  - fields.password → 进 secrets.json，本文件的 fields 不再含有。
 * remove 级联清理 secrets 与该连接的全部项目授权。
 */
import * as path from 'node:path';
import type { ConnectionMeta, DbKind, ResolvedConnection } from '../adapters/types.js';
import { readJson, writeJsonAtomic } from './io.js';
import type { GrantStore } from './grants.js';
import type { SecretsBox } from './secrets.js';

/** fields 中被视为机密的键，落盘前拆出到 secrets.json */
const PASSWORD_KEY = 'password';

export interface ConnectionCreateInput {
  id: string;
  kind: DbKind;
  name?: string;
  /** 完整连接 URL（可含密码）；传入后密码段自动脱敏 */
  url?: string;
  /** URL 模式独立凭据（可选）：注入 URL userinfo 后按 url 路径存储 */
  urlUser?: string;
  urlPassword?: string;
  /** 分字段配置；若含 password 自动拆出到 secrets */
  fields?: Record<string, unknown>;
  ssl?: boolean;
}

export interface ConnectionUpdateInput {
  name?: string;
  url?: string;
  /** URL 模式独立凭据（可选）：注入 URL userinfo 后按 url 路径存储 */
  urlUser?: string;
  urlPassword?: string;
  fields?: Record<string, unknown>;
  ssl?: boolean;
  /** 清除已存 URL（用户从 url 方式切到分字段方式保存时），连同 secrets.url 一并删除 */
  clearUrl?: boolean;
}

/** connections.json 单条记录（无任何机密） */
interface ConnRecord {
  id: string;
  kind: DbKind;
  name?: string;
  /** 密码脱敏后的 URL（密码段为 ***） */
  urlSafe?: string;
  /** 不含 password 的分字段配置 */
  fields?: Record<string, unknown>;
  ssl?: boolean;
}

interface ConnectionsFile {
  connections: ConnRecord[];
}

/** authority 段定位：scheme:// 到首个 /?#（兼容可选 jdbc: 前缀，如 jdbc:gaussdb://），
 *  捕获组 1 为 scheme:// 部分、组 2 为 authority（多主机逗号串整体落在该段内）。
 *  redactUrl 与 mergeUrlCredentials 的字符串回退注入共用。 */
const AUTHORITY_RE = /^((?:jdbc:)?[a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i;

/** 将 URL 中的密码段替换为 ***：scheme://user:pass@host → scheme://user:***@host。
 *  密码可能包含 / ? # @ 等字符：先取 scheme:// 到首个 /?#  的 authority 段，
 *  在 authority 内以最后一个 @ 分界取 userinfo，再以最后一个 : 分界取密码。
 *  scheme 兼容可选 jdbc: 前缀（jdbc:gaussdb://…），无前缀行为不变。 */
export function redactUrl(url: string): string {
  const m = url.match(AUTHORITY_RE);
  if (!m) return url;
  const authority = m[2] ?? '';
  const at = authority.lastIndexOf('@');
  if (at < 0) return url; // 无 userinfo
  const userinfo = authority.slice(0, at);
  const colon = userinfo.lastIndexOf(':');
  if (colon < 0) return url; // 只有用户名，无密码段
  const redacted =
    m[1] + userinfo.slice(0, colon + 1) + '***@' + authority.slice(at + 1);
  return redacted + url.slice(m[0].length);
}

/** URL 模式独立凭据注入：把 urlUser/urlPassword 合并进 URL userinfo（8 库 scheme 均为标准 URL 形态）。
 *  - 两者均空 → 原样返回（url 可为 undefined，现状语义不变）；
 *  - url 为 undefined → 有 secretsUrl（编辑场景已存真实 URL）以其为基底注入，否则凭据忽略返回 undefined；
 *  - url 含脱敏标记 ':***@'（编辑回填值）→ 有 secretsUrl 以其为基底整体替换，否则报错；
 *  - 注入用 WHATWG URL 的 username/password setter（自动 percent-encode '@:/?# ' 等特殊字符），
 *    与适配器侧 decodeURIComponent / 驱动 RFC 3986 解码严格互逆；只填一项只覆盖一项
 *    （redis 'redis://:pass@host' 无用户名形态、oracle 必填用户名校验均兼容）。
 *  - WHATWG 解析失败（如多主机逗号端口 gaussdb://h1:8000,h2:8000/…）或 setter 静默无效
 *    （jdbc:gaussdb://… 为 opaque path、host 为空）时回退字符串注入：正则定位 authority 段
 *    （兼容可选 jdbc: 前缀），段内以最后一个 @ 为界替换/插入 userinfo，其余部分逐字保留；
 *    凭据按 encodeURIComponent 编码，只填一项只覆盖一项的语义与 setter 对齐；
 *    无 scheme://authority 形态的残缺串仍报「URL 无效」。 */
export function mergeUrlCredentials(opts: {
  url?: string;
  urlUser?: string;
  urlPassword?: string;
  /** 编辑场景：该连接已存的真实 URL（url 未发/脱敏时的基底回退） */
  secretsUrl?: string;
}): string | undefined {
  const { url, urlUser, urlPassword, secretsUrl } = opts;
  if (urlUser === undefined && urlPassword === undefined) return url;
  let base: string;
  if (url === undefined) {
    if (secretsUrl === undefined) return undefined; // 无 URL 可注入，凭据忽略
    base = secretsUrl;
  } else if (url.includes(':***@')) {
    if (secretsUrl === undefined) {
      throw new Error('URL 中含脱敏占位（***）且无已存真实 URL 可回退，请重新输入完整 URL 或清空用户名/密码框');
    }
    base = secretsUrl;
  } else {
    base = url;
  }
  let u: URL | undefined;
  try {
    u = new URL(base);
  } catch {
    u = undefined; // WHATWG 解析失败：多主机逗号端口、残缺串等
  }
  const m = base.match(AUTHORITY_RE);
  // 回退条件：解析失败；或 opaque path（host 为空、setter no-op）且 authority 非空。
  // authority 为空（sqlite:// 等无主机形态）不回退，维持 setter no-op 的现状语义。
  if (u === undefined || (u.host === '' && (m?.[2] ?? '') !== '')) {
    if (m === null) throw new Error('连接 URL 无效，无法注入用户名/密码');
    return injectUserInfo(base, m, urlUser, urlPassword);
  }
  if (urlUser !== undefined && urlUser !== '') u.username = urlUser;
  if (urlPassword !== undefined && urlPassword !== '') u.password = urlPassword;
  return u.toString();
}

/** 字符串回退注入：在 authority（m[2]）内以最后一个 @ 为界替换/插入 userinfo。
 *  与 WHATWG setter 语义对齐：只填一项只覆盖一项（另一项保留基底值）；
 *  两者均无效时不改动原样返回。凭据按 encodeURIComponent 编码（与适配器侧
 *  decodeURIComponent 互逆），authority 之外（path/query/fragment）逐字保留。 */
function injectUserInfo(base: string, m: RegExpMatchArray, urlUser?: string, urlPassword?: string): string {
  const whole = m[0] ?? '';
  const authority = m[2] ?? '';
  const user = urlUser !== undefined && urlUser !== '' ? encodeURIComponent(urlUser) : undefined;
  const pass = urlPassword !== undefined && urlPassword !== '' ? encodeURIComponent(urlPassword) : undefined;
  if (user === undefined && pass === undefined) return base;
  const at = authority.lastIndexOf('@');
  const oldUserinfo = at >= 0 ? authority.slice(0, at) : '';
  const colon = oldUserinfo.lastIndexOf(':');
  const oldUser = colon >= 0 ? oldUserinfo.slice(0, colon) : oldUserinfo;
  const oldPass = colon >= 0 ? oldUserinfo.slice(colon + 1) : undefined;
  let userinfo: string;
  if (user !== undefined && pass !== undefined) {
    userinfo = `${user}:${pass}`;
  } else if (user !== undefined) {
    userinfo = oldPass !== undefined ? `${user}:${oldPass}` : user;
  } else {
    userinfo = `${oldUser}:${pass}`;
  }
  const hostPart = at >= 0 ? authority.slice(at + 1) : authority;
  return whole.slice(0, whole.length - authority.length) + userinfo + '@' + hostPart + base.slice(whole.length);
}

function splitPassword(fields: Record<string, unknown> | undefined): {
  clean: Record<string, unknown> | undefined;
  password: string | undefined;
} {
  if (!fields || typeof fields[PASSWORD_KEY] !== 'string') {
    return { clean: fields, password: undefined };
  }
  const { [PASSWORD_KEY]: password, ...clean } = fields;
  return { clean, password: password as string };
}

/** ConnRecord → 用户可见的 ConnectionMeta（契约见 lib/adapters/types.ts）。
 *  hasPassword 只回布尔指示，明文绝不出库。 */
function toMeta(rec: ConnRecord, hasPassword = false): ConnectionMeta {
  const meta: ConnectionMeta = { id: rec.id, kind: rec.kind };
  if (rec.name !== undefined) meta.name = rec.name;
  if (rec.urlSafe !== undefined) {
    meta.safeUrl = rec.urlSafe;
    meta.mode = 'url';
  } else {
    meta.mode = 'fields';
  }
  if (hasPassword) meta.hasPassword = true;
  if (rec.fields) {
    const { host, port, user, database } = rec.fields;
    if (typeof host === 'string') meta.host = host;
    if (typeof port === 'number') meta.port = port;
    if (typeof user === 'string') meta.user = user;
    if (typeof database === 'string') meta.database = database;
  }
  return meta;
}

export class ConnectionStore {
  private readonly file: string;

  constructor(
    dir: string,
    private readonly secrets: SecretsBox,
    private readonly grants: GrantStore,
  ) {
    this.file = path.join(dir, 'connections.json');
  }

  private load(): ConnectionsFile {
    return readJson<ConnectionsFile>(this.file, { connections: [] });
  }

  private save(data: ConnectionsFile): void {
    writeJsonAtomic(this.file, data);
  }

  private findRec(data: ConnectionsFile, id: string): ConnRecord | undefined {
    return data.connections.find((c) => c.id === id);
  }

  /** 该连接是否已存密码（布尔指示，不读明文） */
  private hasPassword(id: string): boolean {
    return this.secrets.get(id)?.password !== undefined;
  }

  list(): ConnectionMeta[] {
    return this.load().connections.map((r) => toMeta(r, this.hasPassword(r.id)));
  }

  get(id: string): ConnectionMeta | undefined {
    const rec = this.findRec(this.load(), id);
    return rec ? toMeta(rec, this.hasPassword(id)) : undefined;
  }

  /** 新建连接；id 已存在时抛错 */
  create(input: ConnectionCreateInput): ConnectionMeta {
    const data = this.load();
    if (this.findRec(data, input.id)) {
      throw new Error(`连接已存在: ${input.id}`);
    }
    const rec: ConnRecord = { id: input.id, kind: input.kind };
    if (input.name !== undefined) rec.name = input.name;
    if (input.ssl !== undefined) rec.ssl = input.ssl;

    const { clean, password } = splitPassword(input.fields);
    if (clean !== undefined) rec.fields = clean;

    const secretPatch: Record<string, string> = {};
    // URL 模式独立凭据注入（无凭据字段时 mergeUrlCredentials 原样返回，现状语义不变）
    const finalUrl = mergeUrlCredentials({
      url: input.url,
      urlUser: input.urlUser,
      urlPassword: input.urlPassword,
    });
    if (finalUrl !== undefined) {
      rec.urlSafe = redactUrl(finalUrl);
      secretPatch.url = finalUrl;
    }
    if (password !== undefined) secretPatch.password = password;
    if (Object.keys(secretPatch).length > 0) this.secrets.set(input.id, secretPatch);

    data.connections.push(rec);
    this.save(data);
    return toMeta(rec, this.hasPassword(input.id));
  }

  /** 部分更新；不存在返回 undefined。url/fields 变更时同步拆分 secrets */
  update(id: string, patch: ConnectionUpdateInput): ConnectionMeta | undefined {
    const data = this.load();
    const rec = this.findRec(data, id);
    if (!rec) return undefined;

    if (patch.name !== undefined) rec.name = patch.name;
    if (patch.ssl !== undefined) rec.ssl = patch.ssl;
    if (patch.fields !== undefined) {
      const { clean, password } = splitPassword(patch.fields);
      rec.fields = clean;
      if (password !== undefined) this.secrets.set(id, { password });
    }
    // URL 模式独立凭据注入：url 未发/发脱敏回填值时以已存 secrets.url 为基底（update 场景）；
    // 无 url 且无凭据字段时 mergeUrlCredentials 返回 undefined，自然跳过（无需外层守卫）
    const finalUrl = mergeUrlCredentials({
      url: patch.url,
      urlUser: patch.urlUser,
      urlPassword: patch.urlPassword,
      secretsUrl: this.secrets.get(id)?.url,
    });
    if (finalUrl !== undefined) {
      rec.urlSafe = redactUrl(finalUrl);
      this.secrets.set(id, { url: finalUrl });
    }
    if (patch.clearUrl && rec.urlSafe !== undefined) {
      delete rec.urlSafe;
      // 密码迁移：原 url 内嵌密码 → fields 密码（切方式后保持可连，编辑留空即保留）
      const secUrl = this.secrets.get(id)?.url;
      if (secUrl !== undefined) {
        try {
          const u = new URL(secUrl);
          if (u.password && this.secrets.get(id)?.password === undefined) {
            this.secrets.set(id, { password: decodeURIComponent(u.password) });
          }
        } catch {
          /* 非 URL 形态，忽略迁移 */
        }
      }
      // set 为合并写；显式置 undefined 经 JSON 序列化后等效删除该键
      this.secrets.set(id, { url: undefined });
    }
    this.save(data);
    return toMeta(rec, this.hasPassword(id));
  }

  /** 删除连接，级联删除 secrets 与该连接的所有项目授权。
   *  顺序按"失败开放"原则：先删权限（grants），再删机密（secrets），最后改
   *  连接表——中途崩溃最多残留垃圾机密，绝不残留可用授权。 */
  remove(id: string): boolean {
    const data = this.load();
    const idx = data.connections.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.grants.removeConn(id);
    this.secrets.delete(id);
    data.connections.splice(idx, 1);
    this.save(data);
    return true;
  }

  /**
   * 组装适配器工厂所需的 ResolvedConnection（含真实密码，绝不返回给模型/HTTP）。
   * 不存在抛错——调用方（工具服务层）应先 get() 展示层校验。
   */
  testTarget(id: string): ResolvedConnection {
    const rec = this.findRec(this.load(), id);
    if (!rec) throw new Error(`连接不存在: ${id}`);
    const meta = toMeta(rec, this.secrets.get(id)?.password !== undefined);
    const rc: ResolvedConnection = { meta };
    const sec = this.secrets.get(id);
    if (sec?.url !== undefined) rc.url = sec.url;
    let fields = rec.fields ? { ...rec.fields } : undefined;
    if (sec?.password !== undefined) (fields ??= {}).password = sec.password;
    if (fields !== undefined) rc.fields = fields;
    if (rec.ssl !== undefined) rc.ssl = rec.ssl;
    return rc;
  }
}
