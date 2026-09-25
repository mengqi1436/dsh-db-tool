/**
 * projectPathKey 规范化。
 *
 * 授权记录以项目路径为键，同一项目可能以不同写法出现：
 * 大小写不同的盘符、正/反斜杠、尾分隔符、相对路径。
 * 所有入口（授权、检查、审计）必须先经本函数归一化，
 * 否则同一项目会产生多条授权记录，ro/rw 检查会漏判。
 *
 * 规则（按序）：
 *  1. path.resolve → 转为绝对路径（相对路径基于 cwd 解析）
 *  2. 分隔符统一为 '/'
 *  3. Windows 盘符小写（'C:/' 与 'c:/' 是同一目录）
 *  4. 去尾分隔符（'c:/code/proj/' → 'c:/code/proj'）
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
export function normalizeProjectKey(p: string): string {
  if (stryMutAct_9fa48("1159")) {
    {}
  } else {
    stryCov_9fa48("1159");
    let key = path.resolve(p).replace(/\\/g, stryMutAct_9fa48("1160") ? "" : (stryCov_9fa48("1160"), '/'));
    key = key.replace(stryMutAct_9fa48("1162") ? /^([^A-Z]):/ : stryMutAct_9fa48("1161") ? /([A-Z]):/ : (stryCov_9fa48("1161", "1162"), /^([A-Z]):/), stryMutAct_9fa48("1163") ? () => undefined : (stryCov_9fa48("1163"), (_m, drive: string) => stryMutAct_9fa48("1164") ? `` : (stryCov_9fa48("1164"), `${stryMutAct_9fa48("1165") ? drive.toUpperCase() : (stryCov_9fa48("1165"), drive.toLowerCase())}:`)));
    if (stryMutAct_9fa48("1169") ? key.length <= 1 : stryMutAct_9fa48("1168") ? key.length >= 1 : stryMutAct_9fa48("1167") ? false : stryMutAct_9fa48("1166") ? true : (stryCov_9fa48("1166", "1167", "1168", "1169"), key.length > 1)) key = key.replace(stryMutAct_9fa48("1171") ? /\/$/ : stryMutAct_9fa48("1170") ? /\/+/ : (stryCov_9fa48("1170", "1171"), /\/+$/), stryMutAct_9fa48("1172") ? "Stryker was here!" : (stryCov_9fa48("1172"), ''));
    return key;
  }
}