/**
 * grants.json：项目级连接授权（ro/rw）。
 * 键是 normalizeProjectKey 归一化后的项目路径。
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
import type { AccessMode } from '../adapters/types.js';
import { readJson, writeJsonAtomic } from './io.js';
export interface GrantEntry {
  connId: string;
  mode: AccessMode;
  grantedAt: string;
}
interface GrantsFile {
  grants: Record<string, GrantEntry[]>;
}
export class GrantStore {
  private readonly file: string;
  constructor(dir: string) {
    if (stryMutAct_9fa48("1036")) {
      {}
    } else {
      stryCov_9fa48("1036");
      this.file = path.join(dir, stryMutAct_9fa48("1037") ? "" : (stryCov_9fa48("1037"), 'grants.json'));
    }
  }
  private load(): GrantsFile {
    if (stryMutAct_9fa48("1038")) {
      {}
    } else {
      stryCov_9fa48("1038");
      return readJson<GrantsFile>(this.file, stryMutAct_9fa48("1039") ? {} : (stryCov_9fa48("1039"), {
        grants: {}
      }));
    }
  }
  private save(data: GrantsFile): void {
    if (stryMutAct_9fa48("1040")) {
      {}
    } else {
      stryCov_9fa48("1040");
      if (stryMutAct_9fa48("1041")) {
        ;
      } else {
        stryCov_9fa48("1041");
        writeJsonAtomic(this.file, data);
      }
    }
  }

  /** 某项目的全部授权（不含 grantedAt，展示层无需时间戳） */
  grantsFor(projectKey: string): {
    connId: string;
    mode: AccessMode;
  }[] {
    if (stryMutAct_9fa48("1042")) {
      {}
    } else {
      stryCov_9fa48("1042");
      return (stryMutAct_9fa48("1043") ? this.load().grants[projectKey] && [] : (stryCov_9fa48("1043"), this.load().grants[projectKey] ?? (stryMutAct_9fa48("1044") ? ["Stryker was here"] : (stryCov_9fa48("1044"), [])))).map(stryMutAct_9fa48("1045") ? () => undefined : (stryCov_9fa48("1045"), ({
        connId,
        mode
      }) => stryMutAct_9fa48("1046") ? {} : (stryCov_9fa48("1046"), {
        connId,
        mode
      })));
    }
  }

  /** 授权或改授权（同连接重复授权视为更新模式） */
  grant(projectKey: string, connId: string, mode: AccessMode): void {
    if (stryMutAct_9fa48("1047")) {
      {}
    } else {
      stryCov_9fa48("1047");
      const data = this.load();
      const list = stryMutAct_9fa48("1048") ? data.grants[projectKey] && [] : (stryCov_9fa48("1048"), data.grants[projectKey] ?? (stryMutAct_9fa48("1049") ? ["Stryker was here"] : (stryCov_9fa48("1049"), [])));
      const existing = list.find(stryMutAct_9fa48("1050") ? () => undefined : (stryCov_9fa48("1050"), g => stryMutAct_9fa48("1053") ? g.connId !== connId : stryMutAct_9fa48("1052") ? false : stryMutAct_9fa48("1051") ? true : (stryCov_9fa48("1051", "1052", "1053"), g.connId === connId)));
      if (stryMutAct_9fa48("1055") ? false : stryMutAct_9fa48("1054") ? true : (stryCov_9fa48("1054", "1055"), existing)) {
        if (stryMutAct_9fa48("1056")) {
          {}
        } else {
          stryCov_9fa48("1056");
          existing.mode = mode;
          existing.grantedAt = new Date().toISOString();
        }
      } else {
        if (stryMutAct_9fa48("1057")) {
          {}
        } else {
          stryCov_9fa48("1057");
          list.push(stryMutAct_9fa48("1059") ? {} : (stryCov_9fa48("1059"), {
            connId,
            mode,
            grantedAt: new Date().toISOString()
          }));
        }
      }
      data.grants[projectKey] = list;
      if (stryMutAct_9fa48("1060")) {
        ;
      } else {
        stryCov_9fa48("1060");
        this.save(data);
      }
    }
  }

  /** 撤销某项目对某连接的授权。不存在时静默返回 */
  revoke(projectKey: string, connId: string): void {
    if (stryMutAct_9fa48("1061")) {
      {}
    } else {
      stryCov_9fa48("1061");
      const data = this.load();
      const list = data.grants[projectKey];
      if (stryMutAct_9fa48("1064") ? false : stryMutAct_9fa48("1063") ? true : stryMutAct_9fa48("1062") ? list : (stryCov_9fa48("1062", "1063", "1064"), !list)) return;
      const next = stryMutAct_9fa48("1065") ? list : (stryCov_9fa48("1065"), list.filter(stryMutAct_9fa48("1066") ? () => undefined : (stryCov_9fa48("1066"), g => stryMutAct_9fa48("1069") ? g.connId === connId : stryMutAct_9fa48("1068") ? false : stryMutAct_9fa48("1067") ? true : (stryCov_9fa48("1067", "1068", "1069"), g.connId !== connId))));
      if (stryMutAct_9fa48("1072") ? next.length !== list.length : stryMutAct_9fa48("1071") ? false : stryMutAct_9fa48("1070") ? true : (stryCov_9fa48("1070", "1071", "1072"), next.length === list.length)) return;
      if (stryMutAct_9fa48("1075") ? next.length !== 0 : stryMutAct_9fa48("1074") ? false : stryMutAct_9fa48("1073") ? true : (stryCov_9fa48("1073", "1074", "1075"), next.length === 0)) delete data.grants[projectKey];else data.grants[projectKey] = next;
      if (stryMutAct_9fa48("1076")) {
        ;
      } else {
        stryCov_9fa48("1076");
        this.save(data);
      }
    }
  }

  /** 检查授权模式；未授权返回 undefined（ro < rw，rw 覆盖 ro） */
  check(projectKey: string, connId: string): AccessMode | undefined {
    if (stryMutAct_9fa48("1077")) {
      {}
    } else {
      stryCov_9fa48("1077");
      const modes = stryMutAct_9fa48("1078") ? (this.load().grants[projectKey] ?? []).map(g => g.mode) : (stryCov_9fa48("1078"), (stryMutAct_9fa48("1079") ? this.load().grants[projectKey] && [] : (stryCov_9fa48("1079"), this.load().grants[projectKey] ?? (stryMutAct_9fa48("1080") ? ["Stryker was here"] : (stryCov_9fa48("1080"), [])))).filter(stryMutAct_9fa48("1081") ? () => undefined : (stryCov_9fa48("1081"), g => stryMutAct_9fa48("1084") ? g.connId !== connId : stryMutAct_9fa48("1083") ? false : stryMutAct_9fa48("1082") ? true : (stryCov_9fa48("1082", "1083", "1084"), g.connId === connId))).map(stryMutAct_9fa48("1085") ? () => undefined : (stryCov_9fa48("1085"), g => g.mode)));
      if (stryMutAct_9fa48("1087") ? false : stryMutAct_9fa48("1086") ? true : (stryCov_9fa48("1086", "1087"), modes.includes(stryMutAct_9fa48("1088") ? "" : (stryCov_9fa48("1088"), 'rw')))) return stryMutAct_9fa48("1089") ? "" : (stryCov_9fa48("1089"), 'rw');
      return modes.includes(stryMutAct_9fa48("1090") ? "" : (stryCov_9fa48("1090"), 'ro')) ? stryMutAct_9fa48("1091") ? "" : (stryCov_9fa48("1091"), 'ro') : undefined;
    }
  }

  /** 级联清理：删除某连接在全项目范围的授权（由 ConnectionStore.remove 调用） */
  removeConn(connId: string): void {
    if (stryMutAct_9fa48("1092")) {
      {}
    } else {
      stryCov_9fa48("1092");
      const data = this.load();
      let dirty = stryMutAct_9fa48("1093") ? true : (stryCov_9fa48("1093"), false);
      for (const key of Object.keys(data.grants)) {
        if (stryMutAct_9fa48("1094")) {
          {}
        } else {
          stryCov_9fa48("1094");
          const list = data.grants[key];
          if (stryMutAct_9fa48("1097") ? false : stryMutAct_9fa48("1096") ? true : stryMutAct_9fa48("1095") ? list : (stryCov_9fa48("1095", "1096", "1097"), !list)) continue;
          const next = stryMutAct_9fa48("1098") ? list : (stryCov_9fa48("1098"), list.filter(stryMutAct_9fa48("1099") ? () => undefined : (stryCov_9fa48("1099"), g => stryMutAct_9fa48("1102") ? g.connId === connId : stryMutAct_9fa48("1101") ? false : stryMutAct_9fa48("1100") ? true : (stryCov_9fa48("1100", "1101", "1102"), g.connId !== connId))));
          if (stryMutAct_9fa48("1105") ? next.length === list.length : stryMutAct_9fa48("1104") ? false : stryMutAct_9fa48("1103") ? true : (stryCov_9fa48("1103", "1104", "1105"), next.length !== list.length)) {
            if (stryMutAct_9fa48("1106")) {
              {}
            } else {
              stryCov_9fa48("1106");
              dirty = stryMutAct_9fa48("1107") ? false : (stryCov_9fa48("1107"), true);
              if (stryMutAct_9fa48("1110") ? next.length !== 0 : stryMutAct_9fa48("1109") ? false : stryMutAct_9fa48("1108") ? true : (stryCov_9fa48("1108", "1109", "1110"), next.length === 0)) delete data.grants[key];else data.grants[key] = next;
            }
          }
        }
      }
      if (stryMutAct_9fa48("1112") ? false : stryMutAct_9fa48("1111") ? true : (stryCov_9fa48("1111", "1112"), dirty)) if (stryMutAct_9fa48("1113")) {
        ;
      } else {
        stryCov_9fa48("1113");
        this.save(data);
      }
    }
  }
}