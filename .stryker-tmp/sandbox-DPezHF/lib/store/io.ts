/**
 * 存储层文件 IO 基础设施：原子写 + 损坏容错读 + 尽力而为的权限设置。
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
import * as path from 'node:path';

/**
 * 尽力而为地设置 POSIX 权限。
 * Windows 的 chmod 仅支持只读位，失败时静默忽略，绝不崩溃。
 */
export function chmodBestEffort(target: string, mode: number): void {
  if (stryMutAct_9fa48("1124")) {
    {}
  } else {
    stryCov_9fa48("1124");
    try {
      if (stryMutAct_9fa48("1125")) {
        {}
      } else {
        stryCov_9fa48("1125");
        if (stryMutAct_9fa48("1126")) {
          ;
        } else {
          stryCov_9fa48("1126");
          fs.chmodSync(target, mode);
        }
      }
    } catch {
      // 权限设置失败（Windows 等）不影响功能
    }
  }
}

/**
 * 原子写 JSON：先写同目录临时文件，再 rename 覆盖目标。
 * rename 在同一文件系统内是原子操作，进程崩溃也不会留下半个 JSON。
 * fileMode 提供时写完设置文件权限（secrets.json 传 0o600）。
 */
export function writeJsonAtomic(file: string, value: unknown, fileMode?: number): void {
  if (stryMutAct_9fa48("1127")) {
    {}
  } else {
    stryCov_9fa48("1127");
    const dir = path.dirname(file);
    fs.mkdirSync(dir, stryMutAct_9fa48("1129") ? {} : (stryCov_9fa48("1129"), {
      recursive: stryMutAct_9fa48("1130") ? false : (stryCov_9fa48("1130"), true)
    }));
    const tmp = path.join(dir, stryMutAct_9fa48("1131") ? `` : (stryCov_9fa48("1131"), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`));
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + (stryMutAct_9fa48("1133") ? "" : (stryCov_9fa48("1133"), '\n')), stryMutAct_9fa48("1134") ? "" : (stryCov_9fa48("1134"), 'utf8'));
    try {
      if (stryMutAct_9fa48("1135")) {
        {}
      } else {
        stryCov_9fa48("1135");
        if (stryMutAct_9fa48("1136")) {
          ;
        } else {
          stryCov_9fa48("1136");
          fs.renameSync(tmp, file);
        }
      }
    } catch (err) {
      if (stryMutAct_9fa48("1137")) {
        {}
      } else {
        stryCov_9fa48("1137");
        try {
          if (stryMutAct_9fa48("1138")) {
            {}
          } else {
            stryCov_9fa48("1138");
            fs.rmSync(tmp, stryMutAct_9fa48("1140") ? {} : (stryCov_9fa48("1140"), {
              force: stryMutAct_9fa48("1141") ? false : (stryCov_9fa48("1141"), true)
            }));
          }
        } catch {
          // 清理失败不掩盖原始错误
        }
        throw err;
      }
    }
    if (stryMutAct_9fa48("1144") ? fileMode === undefined : stryMutAct_9fa48("1143") ? false : stryMutAct_9fa48("1142") ? true : (stryCov_9fa48("1142", "1143", "1144"), fileMode !== undefined)) if (stryMutAct_9fa48("1145")) {
      ;
    } else {
      stryCov_9fa48("1145");
      chmodBestEffort(file, fileMode);
    }
  }
}

/**
 * 容错读 JSON：
 *  - 文件不存在 → 返回 fallback（不创建文件，首次写时才落盘）；
 *  - 解析失败（文件损坏/被截断）→ 将原文件备份为 `<file>.bak` 后返回 fallback，
 *    让调用方以空数据继续工作，损坏现场保留在 .bak 供人工恢复。
 */
export function readJson<T>(file: string, fallback: T): T {
  if (stryMutAct_9fa48("1146")) {
    {}
  } else {
    stryCov_9fa48("1146");
    if (stryMutAct_9fa48("1149") ? false : stryMutAct_9fa48("1148") ? true : stryMutAct_9fa48("1147") ? fs.existsSync(file) : (stryCov_9fa48("1147", "1148", "1149"), !fs.existsSync(file))) return fallback;
    try {
      if (stryMutAct_9fa48("1150")) {
        {}
      } else {
        stryCov_9fa48("1150");
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
      }
    } catch {
      if (stryMutAct_9fa48("1151")) {
        {}
      } else {
        stryCov_9fa48("1151");
        try {
          if (stryMutAct_9fa48("1152")) {
            {}
          } else {
            stryCov_9fa48("1152");
            fs.rmSync(stryMutAct_9fa48("1154") ? `` : (stryCov_9fa48("1154"), `${file}.bak`), stryMutAct_9fa48("1155") ? {} : (stryCov_9fa48("1155"), {
              force: stryMutAct_9fa48("1156") ? false : (stryCov_9fa48("1156"), true)
            }));
            fs.renameSync(file, stryMutAct_9fa48("1158") ? `` : (stryCov_9fa48("1158"), `${file}.bak`));
          }
        } catch {
          // 备份失败也要继续重建
        }
        return fallback;
      }
    }
  }
}