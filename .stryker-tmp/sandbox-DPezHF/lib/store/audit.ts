/**
 * audit.jsonl：追加式审计日志。每行一条 JSON，供侧边栏 tail 查看。
 * 追加写天然原子（单行 < 4KB 时 POSIX/Windows 均保证不交错），
 * tail 解析时跳过损坏行，单行损坏不影响其余历史。
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

/** 危险等级：none / warning（需注意）/ danger（需用户显式确认） */
export type DangerLevel = 'none' | 'warning' | 'danger';
export interface AuditEntry {
  ts: string;
  projectPathKey: string;
  connId: string;
  action: string;
  statement: string;
  danger: DangerLevel;
  confirmed: boolean;
  ok: boolean;
  error?: string;
  rowsAffected?: number;
}
export type AuditEntryInput = Omit<AuditEntry, 'ts'> & {
  ts?: string;
};
export class AuditLog {
  private readonly file: string;
  constructor(dir: string) {
    if (stryMutAct_9fa48("827")) {
      {}
    } else {
      stryCov_9fa48("827");
      this.file = path.join(dir, stryMutAct_9fa48("828") ? "" : (stryCov_9fa48("828"), 'audit.jsonl'));
    }
  }

  /** 追加一条审计；ts 省略时自动填充当前 UTC 时间 */
  append(entry: AuditEntryInput): AuditEntry {
    if (stryMutAct_9fa48("829")) {
      {}
    } else {
      stryCov_9fa48("829");
      const full: AuditEntry = stryMutAct_9fa48("830") ? {} : (stryCov_9fa48("830"), {
        ...entry,
        ts: stryMutAct_9fa48("831") ? entry.ts && new Date().toISOString() : (stryCov_9fa48("831"), entry.ts ?? new Date().toISOString())
      });
      fs.appendFileSync(this.file, JSON.stringify(full) + (stryMutAct_9fa48("833") ? "" : (stryCov_9fa48("833"), '\n')), stryMutAct_9fa48("834") ? "" : (stryCov_9fa48("834"), 'utf8'));
      return full;
    }
  }

  /** 最近 n 条（时间正序）。文件不存在返回空数组；损坏行跳过。
   *  设计取舍：tail 全量读入后取尾。审计日志不轮转（保留完整历史是审计语义），
   *  单用户桌面工具的量级（数十万行 ≈ 数十 MB）一次性读取在可接受范围；
   *  反向块读的复杂度不值得。若未来出现服务端长驻场景再优化。 */
  tail(n: number): AuditEntry[] {
    if (stryMutAct_9fa48("835")) {
      {}
    } else {
      stryCov_9fa48("835");
      if (stryMutAct_9fa48("838") ? false : stryMutAct_9fa48("837") ? true : stryMutAct_9fa48("836") ? fs.existsSync(this.file) : (stryCov_9fa48("836", "837", "838"), !fs.existsSync(this.file))) return stryMutAct_9fa48("839") ? ["Stryker was here"] : (stryCov_9fa48("839"), []);
      const lines = fs.readFileSync(this.file, stryMutAct_9fa48("840") ? "" : (stryCov_9fa48("840"), 'utf8')).split(stryMutAct_9fa48("841") ? "" : (stryCov_9fa48("841"), '\n'));
      const out: AuditEntry[] = stryMutAct_9fa48("842") ? ["Stryker was here"] : (stryCov_9fa48("842"), []);
      for (let i = stryMutAct_9fa48("843") ? lines.length + 1 : (stryCov_9fa48("843"), lines.length - 1); stryMutAct_9fa48("845") ? i >= 0 || out.length < n : stryMutAct_9fa48("844") ? false : (stryCov_9fa48("844", "845"), (stryMutAct_9fa48("848") ? i < 0 : stryMutAct_9fa48("847") ? i > 0 : stryMutAct_9fa48("846") ? true : (stryCov_9fa48("846", "847", "848"), i >= 0)) && (stryMutAct_9fa48("851") ? out.length >= n : stryMutAct_9fa48("850") ? out.length <= n : stryMutAct_9fa48("849") ? true : (stryCov_9fa48("849", "850", "851"), out.length < n))); stryMutAct_9fa48("852") ? i++ : (stryCov_9fa48("852"), i--)) {
        if (stryMutAct_9fa48("853")) {
          {}
        } else {
          stryCov_9fa48("853");
          const line = stryMutAct_9fa48("855") ? lines[i].trim() : stryMutAct_9fa48("854") ? lines[i] : (stryCov_9fa48("854", "855"), lines[i]?.trim());
          if (stryMutAct_9fa48("858") ? false : stryMutAct_9fa48("857") ? true : stryMutAct_9fa48("856") ? line : (stryCov_9fa48("856", "857", "858"), !line)) continue;
          try {
            if (stryMutAct_9fa48("859")) {
              {}
            } else {
              stryCov_9fa48("859");
              if (stryMutAct_9fa48("860")) {
                ;
              } else {
                stryCov_9fa48("860");
                out.push(JSON.parse(line) as AuditEntry);
              }
            }
          } catch {
            // 跳过损坏行
          }
        }
      }
      return stryMutAct_9fa48("861") ? out : (stryCov_9fa48("861"), out.reverse());
    }
  }
}