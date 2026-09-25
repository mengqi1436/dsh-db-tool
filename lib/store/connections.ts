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
  /** 分字段配置；若含 password 自动拆出到 secrets */
  fields?: Record<string, unknown>;
  ssl?: boolean;
}

export interface ConnectionUpdateInput {
  name?: string;
  url?: string;
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

/** 将 URL 中的密码段替换为 ***：scheme://user:pass@host → scheme://user:***@host。
 *  密码可能包含 / ? # @ 等字符：先取 scheme:// 到首个 /?#  的 authority 段，
 *  在 authority 内以最后一个 @ 分界取 userinfo，再以最后一个 : 分界取密码。 */
export function redactUrl(url: string): string {
  const m = url.match(/^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i);
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

/** ConnRecord → 用户可见的 ConnectionMeta（契约见 lib/adapters/types.ts） */
function toMeta(rec: ConnRecord): ConnectionMeta {
  const meta: ConnectionMeta = { id: rec.id, kind: rec.kind };
  if (rec.name !== undefined) meta.name = rec.name;
  if (rec.urlSafe !== undefined) {
    meta.safeUrl = rec.urlSafe;
    meta.mode = 'url';
  } else {
    meta.mode = 'fields';
  }
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

  list(): ConnectionMeta[] {
    return this.load().connections.map(toMeta);
  }

  get(id: string): ConnectionMeta | undefined {
    const rec = this.findRec(this.load(), id);
    return rec ? toMeta(rec) : undefined;
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
    if (input.url !== undefined) {
      rec.urlSafe = redactUrl(input.url);
      secretPatch.url = input.url;
    }
    if (password !== undefined) secretPatch.password = password;
    if (Object.keys(secretPatch).length > 0) this.secrets.set(input.id, secretPatch);

    data.connections.push(rec);
    this.save(data);
    return toMeta(rec);
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
    if (patch.url !== undefined) {
      rec.urlSafe = redactUrl(patch.url);
      this.secrets.set(id, { url: patch.url });
    }
    if (patch.clearUrl && rec.urlSafe !== undefined) {
      delete rec.urlSafe;
      // set 为合并写；显式置 undefined 经 JSON 序列化后等效删除该键
      this.secrets.set(id, { url: undefined });
    }
    this.save(data);
    return toMeta(rec);
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
    const meta = toMeta(rec);
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
