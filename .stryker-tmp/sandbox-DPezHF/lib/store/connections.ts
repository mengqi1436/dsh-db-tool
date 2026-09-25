/**
 * connections.json：连接元数据（绝不含密码）。
 *
 * create/update 时自动做机密拆分：
 *  - url → 完整 URL 进 secrets.json，脱敏副本（密码段 ***）留在本文件 urlSafe；
 *  - fields.password → 进 secrets.json，本文件的 fields 不再含有。
 * remove 级联清理 secrets 与该连接的全部项目授权。
 */
// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import * as path from 'node:path';
import type { ConnectionMeta, DbKind, ResolvedConnection } from '../adapters/types.js';
import { readJson, writeJsonAtomic } from './io.js';
import type { GrantStore } from './grants.js';
import type { SecretsBox } from './secrets.js';

/** fields 中被视为机密的键，落盘前拆出到 secrets.json */
const PASSWORD_KEY = stryMutAct_9fa48("862") ? "" : (stryCov_9fa48("862"), 'password');
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
  if (stryMutAct_9fa48("863")) {
    {}
  } else {
    stryCov_9fa48("863");
    const m = url.match(stryMutAct_9fa48("869") ? /^([a-z][a-z0-9+.-]*:\/\/)([/?#]*)/i : stryMutAct_9fa48("868") ? /^([a-z][a-z0-9+.-]*:\/\/)([^/?#])/i : stryMutAct_9fa48("867") ? /^([a-z][^a-z0-9+.-]*:\/\/)([^/?#]*)/i : stryMutAct_9fa48("866") ? /^([a-z][a-z0-9+.-]:\/\/)([^/?#]*)/i : stryMutAct_9fa48("865") ? /^([^a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i : stryMutAct_9fa48("864") ? /([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i : (stryCov_9fa48("864", "865", "866", "867", "868", "869"), /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)/i));
    if (stryMutAct_9fa48("872") ? false : stryMutAct_9fa48("871") ? true : stryMutAct_9fa48("870") ? m : (stryCov_9fa48("870", "871", "872"), !m)) return url;
    const authority = stryMutAct_9fa48("873") ? m[2] && '' : (stryCov_9fa48("873"), m[2] ?? (stryMutAct_9fa48("874") ? "Stryker was here!" : (stryCov_9fa48("874"), '')));
    const at = authority.lastIndexOf(stryMutAct_9fa48("875") ? "" : (stryCov_9fa48("875"), '@'));
    if (stryMutAct_9fa48("879") ? at >= 0 : stryMutAct_9fa48("878") ? at <= 0 : stryMutAct_9fa48("877") ? false : stryMutAct_9fa48("876") ? true : (stryCov_9fa48("876", "877", "878", "879"), at < 0)) return url; // 无 userinfo
    const userinfo = stryMutAct_9fa48("880") ? authority : (stryCov_9fa48("880"), authority.slice(0, at));
    const colon = userinfo.lastIndexOf(stryMutAct_9fa48("881") ? "" : (stryCov_9fa48("881"), ':'));
    if (stryMutAct_9fa48("885") ? colon >= 0 : stryMutAct_9fa48("884") ? colon <= 0 : stryMutAct_9fa48("883") ? false : stryMutAct_9fa48("882") ? true : (stryCov_9fa48("882", "883", "884", "885"), colon < 0)) return url; // 只有用户名，无密码段
    const redacted = (stryMutAct_9fa48("886") ? m[1] - userinfo.slice(0, colon + 1) : (stryCov_9fa48("886"), m[1] + (stryMutAct_9fa48("887") ? userinfo : (stryCov_9fa48("887"), userinfo.slice(0, stryMutAct_9fa48("888") ? colon - 1 : (stryCov_9fa48("888"), colon + 1)))))) + (stryMutAct_9fa48("889") ? "" : (stryCov_9fa48("889"), '***@')) + (stryMutAct_9fa48("890") ? authority : (stryCov_9fa48("890"), authority.slice(stryMutAct_9fa48("891") ? at - 1 : (stryCov_9fa48("891"), at + 1))));
    return stryMutAct_9fa48("892") ? redacted - url.slice(m[0].length) : (stryCov_9fa48("892"), redacted + (stryMutAct_9fa48("893") ? url : (stryCov_9fa48("893"), url.slice(m[0].length))));
  }
}
function splitPassword(fields: Record<string, unknown> | undefined): {
  clean: Record<string, unknown> | undefined;
  password: string | undefined;
} {
  if (stryMutAct_9fa48("894")) {
    {}
  } else {
    stryCov_9fa48("894");
    if (stryMutAct_9fa48("897") ? !fields && typeof fields[PASSWORD_KEY] !== 'string' : stryMutAct_9fa48("896") ? false : stryMutAct_9fa48("895") ? true : (stryCov_9fa48("895", "896", "897"), (stryMutAct_9fa48("898") ? fields : (stryCov_9fa48("898"), !fields)) || (stryMutAct_9fa48("900") ? typeof fields[PASSWORD_KEY] === 'string' : stryMutAct_9fa48("899") ? false : (stryCov_9fa48("899", "900"), typeof fields[PASSWORD_KEY] !== (stryMutAct_9fa48("901") ? "" : (stryCov_9fa48("901"), 'string')))))) {
      if (stryMutAct_9fa48("902")) {
        {}
      } else {
        stryCov_9fa48("902");
        return stryMutAct_9fa48("903") ? {} : (stryCov_9fa48("903"), {
          clean: fields,
          password: undefined
        });
      }
    }
    const {
      [PASSWORD_KEY]: password,
      ...clean
    } = fields;
    return stryMutAct_9fa48("904") ? {} : (stryCov_9fa48("904"), {
      clean,
      password: password as string
    });
  }
}

/** ConnRecord → 用户可见的 ConnectionMeta（契约见 lib/adapters/types.ts） */
function toMeta(rec: ConnRecord): ConnectionMeta {
  if (stryMutAct_9fa48("905")) {
    {}
  } else {
    stryCov_9fa48("905");
    const meta: ConnectionMeta = stryMutAct_9fa48("906") ? {} : (stryCov_9fa48("906"), {
      id: rec.id,
      kind: rec.kind
    });
    if (stryMutAct_9fa48("909") ? rec.name === undefined : stryMutAct_9fa48("908") ? false : stryMutAct_9fa48("907") ? true : (stryCov_9fa48("907", "908", "909"), rec.name !== undefined)) meta.name = rec.name;
    if (stryMutAct_9fa48("912") ? rec.urlSafe === undefined : stryMutAct_9fa48("911") ? false : stryMutAct_9fa48("910") ? true : (stryCov_9fa48("910", "911", "912"), rec.urlSafe !== undefined)) meta.safeUrl = rec.urlSafe;
    if (stryMutAct_9fa48("914") ? false : stryMutAct_9fa48("913") ? true : (stryCov_9fa48("913", "914"), rec.fields)) {
      if (stryMutAct_9fa48("915")) {
        {}
      } else {
        stryCov_9fa48("915");
        const {
          host,
          port,
          database
        } = rec.fields;
        if (stryMutAct_9fa48("918") ? typeof host !== 'string' : stryMutAct_9fa48("917") ? false : stryMutAct_9fa48("916") ? true : (stryCov_9fa48("916", "917", "918"), typeof host === (stryMutAct_9fa48("919") ? "" : (stryCov_9fa48("919"), 'string')))) meta.host = host;
        if (stryMutAct_9fa48("922") ? typeof port !== 'number' : stryMutAct_9fa48("921") ? false : stryMutAct_9fa48("920") ? true : (stryCov_9fa48("920", "921", "922"), typeof port === (stryMutAct_9fa48("923") ? "" : (stryCov_9fa48("923"), 'number')))) meta.port = port;
        if (stryMutAct_9fa48("926") ? typeof database !== 'string' : stryMutAct_9fa48("925") ? false : stryMutAct_9fa48("924") ? true : (stryCov_9fa48("924", "925", "926"), typeof database === (stryMutAct_9fa48("927") ? "" : (stryCov_9fa48("927"), 'string')))) meta.database = database;
      }
    }
    return meta;
  }
}
export class ConnectionStore {
  private readonly file: string;
  constructor(dir: string, private readonly secrets: SecretsBox, private readonly grants: GrantStore) {
    if (stryMutAct_9fa48("928")) {
      {}
    } else {
      stryCov_9fa48("928");
      this.file = path.join(dir, stryMutAct_9fa48("929") ? "" : (stryCov_9fa48("929"), 'connections.json'));
    }
  }
  private load(): ConnectionsFile {
    if (stryMutAct_9fa48("930")) {
      {}
    } else {
      stryCov_9fa48("930");
      return readJson<ConnectionsFile>(this.file, stryMutAct_9fa48("931") ? {} : (stryCov_9fa48("931"), {
        connections: stryMutAct_9fa48("932") ? ["Stryker was here"] : (stryCov_9fa48("932"), [])
      }));
    }
  }
  private save(data: ConnectionsFile): void {
    if (stryMutAct_9fa48("933")) {
      {}
    } else {
      stryCov_9fa48("933");
      if (stryMutAct_9fa48("934")) {
        ;
      } else {
        stryCov_9fa48("934");
        writeJsonAtomic(this.file, data);
      }
    }
  }
  private findRec(data: ConnectionsFile, id: string): ConnRecord | undefined {
    if (stryMutAct_9fa48("935")) {
      {}
    } else {
      stryCov_9fa48("935");
      return data.connections.find(stryMutAct_9fa48("936") ? () => undefined : (stryCov_9fa48("936"), c => stryMutAct_9fa48("939") ? c.id !== id : stryMutAct_9fa48("938") ? false : stryMutAct_9fa48("937") ? true : (stryCov_9fa48("937", "938", "939"), c.id === id)));
    }
  }
  list(): ConnectionMeta[] {
    if (stryMutAct_9fa48("940")) {
      {}
    } else {
      stryCov_9fa48("940");
      return this.load().connections.map(toMeta);
    }
  }
  get(id: string): ConnectionMeta | undefined {
    if (stryMutAct_9fa48("941")) {
      {}
    } else {
      stryCov_9fa48("941");
      const rec = this.findRec(this.load(), id);
      return rec ? toMeta(rec) : undefined;
    }
  }

  /** 新建连接；id 已存在时抛错 */
  create(input: ConnectionCreateInput): ConnectionMeta {
    if (stryMutAct_9fa48("942")) {
      {}
    } else {
      stryCov_9fa48("942");
      const data = this.load();
      if (stryMutAct_9fa48("944") ? false : stryMutAct_9fa48("943") ? true : (stryCov_9fa48("943", "944"), this.findRec(data, input.id))) {
        if (stryMutAct_9fa48("945")) {
          {}
        } else {
          stryCov_9fa48("945");
          throw new Error(stryMutAct_9fa48("947") ? `` : (stryCov_9fa48("947"), `连接已存在: ${input.id}`));
        }
      }
      const rec: ConnRecord = stryMutAct_9fa48("948") ? {} : (stryCov_9fa48("948"), {
        id: input.id,
        kind: input.kind
      });
      if (stryMutAct_9fa48("951") ? input.name === undefined : stryMutAct_9fa48("950") ? false : stryMutAct_9fa48("949") ? true : (stryCov_9fa48("949", "950", "951"), input.name !== undefined)) rec.name = input.name;
      if (stryMutAct_9fa48("954") ? input.ssl === undefined : stryMutAct_9fa48("953") ? false : stryMutAct_9fa48("952") ? true : (stryCov_9fa48("952", "953", "954"), input.ssl !== undefined)) rec.ssl = input.ssl;
      const {
        clean,
        password
      } = splitPassword(input.fields);
      if (stryMutAct_9fa48("957") ? clean === undefined : stryMutAct_9fa48("956") ? false : stryMutAct_9fa48("955") ? true : (stryCov_9fa48("955", "956", "957"), clean !== undefined)) rec.fields = clean;
      const secretPatch: Record<string, string> = {};
      if (stryMutAct_9fa48("960") ? input.url === undefined : stryMutAct_9fa48("959") ? false : stryMutAct_9fa48("958") ? true : (stryCov_9fa48("958", "959", "960"), input.url !== undefined)) {
        if (stryMutAct_9fa48("961")) {
          {}
        } else {
          stryCov_9fa48("961");
          rec.urlSafe = redactUrl(input.url);
          secretPatch.url = input.url;
        }
      }
      if (stryMutAct_9fa48("964") ? password === undefined : stryMutAct_9fa48("963") ? false : stryMutAct_9fa48("962") ? true : (stryCov_9fa48("962", "963", "964"), password !== undefined)) secretPatch.password = password;
      if (stryMutAct_9fa48("968") ? Object.keys(secretPatch).length <= 0 : stryMutAct_9fa48("967") ? Object.keys(secretPatch).length >= 0 : stryMutAct_9fa48("966") ? false : stryMutAct_9fa48("965") ? true : (stryCov_9fa48("965", "966", "967", "968"), Object.keys(secretPatch).length > 0)) if (stryMutAct_9fa48("969")) {
        ;
      } else {
        stryCov_9fa48("969");
        this.secrets.set(input.id, secretPatch);
      }
      if (stryMutAct_9fa48("970")) {
        ;
      } else {
        stryCov_9fa48("970");
        data.connections.push(rec);
      }
      if (stryMutAct_9fa48("971")) {
        ;
      } else {
        stryCov_9fa48("971");
        this.save(data);
      }
      return toMeta(rec);
    }
  }

  /** 部分更新；不存在返回 undefined。url/fields 变更时同步拆分 secrets */
  update(id: string, patch: ConnectionUpdateInput): ConnectionMeta | undefined {
    if (stryMutAct_9fa48("972")) {
      {}
    } else {
      stryCov_9fa48("972");
      const data = this.load();
      const rec = this.findRec(data, id);
      if (stryMutAct_9fa48("975") ? false : stryMutAct_9fa48("974") ? true : stryMutAct_9fa48("973") ? rec : (stryCov_9fa48("973", "974", "975"), !rec)) return undefined;
      if (stryMutAct_9fa48("978") ? patch.name === undefined : stryMutAct_9fa48("977") ? false : stryMutAct_9fa48("976") ? true : (stryCov_9fa48("976", "977", "978"), patch.name !== undefined)) rec.name = patch.name;
      if (stryMutAct_9fa48("981") ? patch.ssl === undefined : stryMutAct_9fa48("980") ? false : stryMutAct_9fa48("979") ? true : (stryCov_9fa48("979", "980", "981"), patch.ssl !== undefined)) rec.ssl = patch.ssl;
      if (stryMutAct_9fa48("984") ? patch.fields === undefined : stryMutAct_9fa48("983") ? false : stryMutAct_9fa48("982") ? true : (stryCov_9fa48("982", "983", "984"), patch.fields !== undefined)) {
        if (stryMutAct_9fa48("985")) {
          {}
        } else {
          stryCov_9fa48("985");
          const {
            clean,
            password
          } = splitPassword(patch.fields);
          rec.fields = clean;
          if (stryMutAct_9fa48("988") ? password === undefined : stryMutAct_9fa48("987") ? false : stryMutAct_9fa48("986") ? true : (stryCov_9fa48("986", "987", "988"), password !== undefined)) this.secrets.set(id, stryMutAct_9fa48("990") ? {} : (stryCov_9fa48("990"), {
            password
          }));
        }
      }
      if (stryMutAct_9fa48("993") ? patch.url === undefined : stryMutAct_9fa48("992") ? false : stryMutAct_9fa48("991") ? true : (stryCov_9fa48("991", "992", "993"), patch.url !== undefined)) {
        if (stryMutAct_9fa48("994")) {
          {}
        } else {
          stryCov_9fa48("994");
          rec.urlSafe = redactUrl(patch.url);
          this.secrets.set(id, stryMutAct_9fa48("996") ? {} : (stryCov_9fa48("996"), {
            url: patch.url
          }));
        }
      }
      if (stryMutAct_9fa48("997")) {
        ;
      } else {
        stryCov_9fa48("997");
        this.save(data);
      }
      return toMeta(rec);
    }
  }

  /** 删除连接，级联删除 secrets 与该连接的所有项目授权。
   *  顺序按"失败开放"原则：先删权限（grants），再删机密（secrets），最后改
   *  连接表——中途崩溃最多残留垃圾机密，绝不残留可用授权。 */
  remove(id: string): boolean {
    if (stryMutAct_9fa48("998")) {
      {}
    } else {
      stryCov_9fa48("998");
      const data = this.load();
      const idx = data.connections.findIndex(stryMutAct_9fa48("999") ? () => undefined : (stryCov_9fa48("999"), c => stryMutAct_9fa48("1002") ? c.id !== id : stryMutAct_9fa48("1001") ? false : stryMutAct_9fa48("1000") ? true : (stryCov_9fa48("1000", "1001", "1002"), c.id === id)));
      if (stryMutAct_9fa48("1006") ? idx >= 0 : stryMutAct_9fa48("1005") ? idx <= 0 : stryMutAct_9fa48("1004") ? false : stryMutAct_9fa48("1003") ? true : (stryCov_9fa48("1003", "1004", "1005", "1006"), idx < 0)) return stryMutAct_9fa48("1007") ? true : (stryCov_9fa48("1007"), false);
      if (stryMutAct_9fa48("1008")) {
        ;
      } else {
        stryCov_9fa48("1008");
        this.grants.removeConn(id);
      }
      if (stryMutAct_9fa48("1009")) {
        ;
      } else {
        stryCov_9fa48("1009");
        this.secrets.delete(id);
      }
      if (stryMutAct_9fa48("1010")) {
        ;
      } else {
        stryCov_9fa48("1010");
        data.connections.splice(idx, 1);
      }
      if (stryMutAct_9fa48("1011")) {
        ;
      } else {
        stryCov_9fa48("1011");
        this.save(data);
      }
      return stryMutAct_9fa48("1012") ? false : (stryCov_9fa48("1012"), true);
    }
  }

  /**
   * 组装适配器工厂所需的 ResolvedConnection（含真实密码，绝不返回给模型/HTTP）。
   * 不存在抛错——调用方（工具服务层）应先 get() 展示层校验。
   */
  testTarget(id: string): ResolvedConnection {
    if (stryMutAct_9fa48("1013")) {
      {}
    } else {
      stryCov_9fa48("1013");
      const rec = this.findRec(this.load(), id);
      if (stryMutAct_9fa48("1016") ? false : stryMutAct_9fa48("1015") ? true : stryMutAct_9fa48("1014") ? rec : (stryCov_9fa48("1014", "1015", "1016"), !rec)) throw new Error(stryMutAct_9fa48("1018") ? `` : (stryCov_9fa48("1018"), `连接不存在: ${id}`));
      const meta = toMeta(rec);
      const rc: ResolvedConnection = stryMutAct_9fa48("1019") ? {} : (stryCov_9fa48("1019"), {
        meta
      });
      const sec = this.secrets.get(id);
      if (stryMutAct_9fa48("1022") ? sec?.url === undefined : stryMutAct_9fa48("1021") ? false : stryMutAct_9fa48("1020") ? true : (stryCov_9fa48("1020", "1021", "1022"), (stryMutAct_9fa48("1023") ? sec.url : (stryCov_9fa48("1023"), sec?.url)) !== undefined)) rc.url = sec.url;
      let fields = rec.fields ? stryMutAct_9fa48("1024") ? {} : (stryCov_9fa48("1024"), {
        ...rec.fields
      }) : undefined;
      if (stryMutAct_9fa48("1027") ? sec?.password === undefined : stryMutAct_9fa48("1026") ? false : stryMutAct_9fa48("1025") ? true : (stryCov_9fa48("1025", "1026", "1027"), (stryMutAct_9fa48("1028") ? sec.password : (stryCov_9fa48("1028"), sec?.password)) !== undefined)) (stryMutAct_9fa48("1029") ? fields &&= {} : (stryCov_9fa48("1029"), fields ??= {})).password = sec.password;
      if (stryMutAct_9fa48("1032") ? fields === undefined : stryMutAct_9fa48("1031") ? false : stryMutAct_9fa48("1030") ? true : (stryCov_9fa48("1030", "1031", "1032"), fields !== undefined)) rc.fields = fields;
      if (stryMutAct_9fa48("1035") ? rec.ssl === undefined : stryMutAct_9fa48("1034") ? false : stryMutAct_9fa48("1033") ? true : (stryCov_9fa48("1033", "1034", "1035"), rec.ssl !== undefined)) rc.ssl = rec.ssl;
      return rc;
    }
  }
}