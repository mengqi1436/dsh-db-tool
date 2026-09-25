/**
 * dsh-db-tool 存储层顶层入口。
 *
 * 四类持久化数据位于 `$DSH_HOME/db-tool/`（DSH_HOME 环境变量，缺省 ~/.dsh）：
 *  - connections.json  连接元数据（不含密码，权限跟随目录 0700）
 *  - secrets.json      机密（密码/完整 URL，权限 0600）
 *  - grants.json       项目级连接授权
 *  - audit.jsonl       追加式审计日志
 *
 * 构造参数 homeDir 仅供测试注入临时目录。
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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuditLog } from './audit.js';
import { ConnectionStore } from './connections.js';
import { GrantStore } from './grants.js';
import { chmodBestEffort } from './io.js';
import { SecretsBox } from './secrets.js';
export { normalizeProjectKey } from './normalize.js';
export { redactUrl } from './connections.js';
export type { DangerLevel, AuditEntry, AuditEntryInput } from './audit.js';
export type { ConnectionCreateInput, ConnectionUpdateInput } from './connections.js';
export type { GrantEntry } from './grants.js';
export type { SecretEntry } from './secrets.js';
export { AuditLog, ConnectionStore, GrantStore, SecretsBox };
export class DbToolStore {
  /** 数据目录：$DSH_HOME/db-tool */
  readonly dir: string;
  readonly connections: ConnectionStore;
  readonly secrets: SecretsBox;
  readonly grants: GrantStore;
  readonly audit: AuditLog;
  constructor(homeDir?: string) {
    if (stryMutAct_9fa48("1114")) {
      {}
    } else {
      stryCov_9fa48("1114");
      const home = stryMutAct_9fa48("1115") ? (homeDir ?? process.env['DSH_HOME']) && path.join(os.homedir(), '.dsh') : (stryCov_9fa48("1115"), (stryMutAct_9fa48("1116") ? homeDir && process.env['DSH_HOME'] : (stryCov_9fa48("1116"), homeDir ?? process.env[stryMutAct_9fa48("1117") ? "" : (stryCov_9fa48("1117"), 'DSH_HOME')])) ?? path.join(os.homedir(), stryMutAct_9fa48("1118") ? "" : (stryCov_9fa48("1118"), '.dsh')));
      this.dir = path.join(home, stryMutAct_9fa48("1119") ? "" : (stryCov_9fa48("1119"), 'db-tool'));
      fs.mkdirSync(this.dir, stryMutAct_9fa48("1121") ? {} : (stryCov_9fa48("1121"), {
        recursive: stryMutAct_9fa48("1122") ? false : (stryCov_9fa48("1122"), true)
      }));
      if (stryMutAct_9fa48("1123")) {
        ;
      } else {
        stryCov_9fa48("1123");
        chmodBestEffort(this.dir, 0o700);
      }
      this.secrets = new SecretsBox(this.dir);
      this.grants = new GrantStore(this.dir);
      this.audit = new AuditLog(this.dir);
      this.connections = new ConnectionStore(this.dir, this.secrets, this.grants);
    }
  }
}