/**
 * secrets.json：连接级机密存储（密码、完整 URL、其余敏感键值）。
 *
 * 硬性约束：
 *  - 文件落盘后设置权限 0600（Windows 上尽力而为，失败不崩溃）；
 *  - 本类的任何返回值都是浅拷贝，外部改动不污染内部状态；
 *  - 机密绝不进入 connections.json / grants.json / 审计等其它文件。
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
import { readJson, writeJsonAtomic } from './io.js';
export interface SecretEntry {
  password?: string;
  url?: string;
  /** 适配器需要的其余敏感键值（如 MongoDB 的凭证参数） */
  [key: string]: string | undefined;
}
interface SecretsFile {
  secrets: Record<string, SecretEntry>;
}
const FILE_MODE = 0o600;
export class SecretsBox {
  private readonly file: string;
  constructor(dir: string) {
    if (stryMutAct_9fa48("1173")) {
      {}
    } else {
      stryCov_9fa48("1173");
      this.file = path.join(dir, stryMutAct_9fa48("1174") ? "" : (stryCov_9fa48("1174"), 'secrets.json'));
    }
  }
  private load(): SecretsFile {
    if (stryMutAct_9fa48("1175")) {
      {}
    } else {
      stryCov_9fa48("1175");
      return readJson<SecretsFile>(this.file, stryMutAct_9fa48("1176") ? {} : (stryCov_9fa48("1176"), {
        secrets: {}
      }));
    }
  }
  private save(data: SecretsFile): void {
    if (stryMutAct_9fa48("1177")) {
      {}
    } else {
      stryCov_9fa48("1177");
      if (stryMutAct_9fa48("1178")) {
        ;
      } else {
        stryCov_9fa48("1178");
        writeJsonAtomic(this.file, data, FILE_MODE);
      }
    }
  }

  /** 读取某连接的机密（浅拷贝）。不存在返回 undefined。 */
  get(connId: string): SecretEntry | undefined {
    if (stryMutAct_9fa48("1179")) {
      {}
    } else {
      stryCov_9fa48("1179");
      const entry = this.load().secrets[connId];
      return entry ? stryMutAct_9fa48("1180") ? {} : (stryCov_9fa48("1180"), {
        ...entry
      }) : undefined;
    }
  }

  /** 合并写入机密（保留未提及的旧键） */
  set(connId: string, patch: SecretEntry): void {
    if (stryMutAct_9fa48("1181")) {
      {}
    } else {
      stryCov_9fa48("1181");
      const data = this.load();
      data.secrets[connId] = stryMutAct_9fa48("1182") ? {} : (stryCov_9fa48("1182"), {
        ...(stryMutAct_9fa48("1183") ? data.secrets[connId] && {} : (stryCov_9fa48("1183"), data.secrets[connId] ?? {})),
        ...patch
      });
      if (stryMutAct_9fa48("1184")) {
        ;
      } else {
        stryCov_9fa48("1184");
        this.save(data);
      }
    }
  }

  /** 删除某连接的全部机密。不存在时静默返回。 */
  delete(connId: string): void {
    if (stryMutAct_9fa48("1185")) {
      {}
    } else {
      stryCov_9fa48("1185");
      const data = this.load();
      if (stryMutAct_9fa48("1188") ? false : stryMutAct_9fa48("1187") ? true : stryMutAct_9fa48("1186") ? connId in data.secrets : (stryCov_9fa48("1186", "1187", "1188"), !(connId in data.secrets))) return;
      delete data.secrets[connId];
      if (stryMutAct_9fa48("1189")) {
        ;
      } else {
        stryCov_9fa48("1189");
        this.save(data);
      }
    }
  }
}