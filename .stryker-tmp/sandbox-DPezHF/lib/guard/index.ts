/**
 * 语句风险分级 + 一次性挑战（用户确认）凭据存储。
 *
 * classifyStatement：把任意 kind 的一条语句分为 'danger' | 'warning' | 'none'，
 * 并给出中文原因。Redis/Mongo 危险清单直接复用各适配器导出的官方清单；
 * SQL 系按首个关键字 + 语句内危险片段识别。
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
import { createHash, randomBytes } from 'node:crypto';
import { DANGEROUS_COMMANDS, READ_COMMANDS, WRITE_COMMANDS, parseRedisCommand } from '../adapters/redis/index.js';
import { DANGEROUS_OPS, READ_OPS } from '../adapters/mongodb/index.js';
import type { DbKind } from '../adapters/types.js';
export type DangerLevel = 'danger' | 'warning' | 'none';
export interface GuardVerdict {
  level: DangerLevel;
  /** 中文原因：danger 时必给出，说明为何需要用户确认 */
  reason?: string;
}

/** SQL 读取类首词白名单（大小写不敏感；首词必须命中，否则视为非读） */
const SQL_READ_HEADS = new Set(stryMutAct_9fa48("0") ? [] : (stryCov_9fa48("0"), [stryMutAct_9fa48("1") ? "" : (stryCov_9fa48("1"), 'select'), stryMutAct_9fa48("2") ? "" : (stryCov_9fa48("2"), 'with'), stryMutAct_9fa48("3") ? "" : (stryCov_9fa48("3"), 'show'), stryMutAct_9fa48("4") ? "" : (stryCov_9fa48("4"), 'describe'), stryMutAct_9fa48("5") ? "" : (stryCov_9fa48("5"), 'desc'), stryMutAct_9fa48("6") ? "" : (stryCov_9fa48("6"), 'explain'), stryMutAct_9fa48("7") ? "" : (stryCov_9fa48("7"), 'use'), stryMutAct_9fa48("8") ? "" : (stryCov_9fa48("8"), 'set'), stryMutAct_9fa48("9") ? "" : (stryCov_9fa48("9"), 'help'), stryMutAct_9fa48("10") ? "" : (stryCov_9fa48("10"), 'table')]));

/** DDL：隐式提交、不可回滚 */
const SQL_DDL_RE = stryMutAct_9fa48("13") ? /^\S*(drop|truncate|alter|create|rename|comment|grant|revoke|flashback|purge)\b/i : stryMutAct_9fa48("12") ? /^\s(drop|truncate|alter|create|rename|comment|grant|revoke|flashback|purge)\b/i : stryMutAct_9fa48("11") ? /\s*(drop|truncate|alter|create|rename|comment|grant|revoke|flashback|purge)\b/i : (stryCov_9fa48("11", "12", "13"), /^\s*(drop|truncate|alter|create|rename|comment|grant|revoke|flashback|purge)\b/i);
/** DML：修改数据 */
const SQL_DML_RE = stryMutAct_9fa48("16") ? /^\S*(insert|update|delete|merge|replace|upsert|call|do)\b/i : stryMutAct_9fa48("15") ? /^\s(insert|update|delete|merge|replace|upsert|call|do)\b/i : stryMutAct_9fa48("14") ? /\s*(insert|update|delete|merge|replace|upsert|call|do)\b/i : (stryCov_9fa48("14", "15", "16"), /^\s*(insert|update|delete|merge|replace|upsert|call|do)\b/i);
/** 维护类（oracle/dm 等：shutdown/startup/analyze 等） */
const SQL_MAINT_RE = stryMutAct_9fa48("23") ? /^\s*(shutdown|startup|archive\s+log|recover|analyze|optimize|check\S+table|repair|lock|unlock|kill|flush)\b/i : stryMutAct_9fa48("22") ? /^\s*(shutdown|startup|archive\s+log|recover|analyze|optimize|check\stable|repair|lock|unlock|kill|flush)\b/i : stryMutAct_9fa48("21") ? /^\s*(shutdown|startup|archive\S+log|recover|analyze|optimize|check\s+table|repair|lock|unlock|kill|flush)\b/i : stryMutAct_9fa48("20") ? /^\s*(shutdown|startup|archive\slog|recover|analyze|optimize|check\s+table|repair|lock|unlock|kill|flush)\b/i : stryMutAct_9fa48("19") ? /^\S*(shutdown|startup|archive\s+log|recover|analyze|optimize|check\s+table|repair|lock|unlock|kill|flush)\b/i : stryMutAct_9fa48("18") ? /^\s(shutdown|startup|archive\s+log|recover|analyze|optimize|check\s+table|repair|lock|unlock|kill|flush)\b/i : stryMutAct_9fa48("17") ? /\s*(shutdown|startup|archive\s+log|recover|analyze|optimize|check\s+table|repair|lock|unlock|kill|flush)\b/i : (stryCov_9fa48("17", "18", "19", "20", "21", "22", "23"), /^\s*(shutdown|startup|archive\s+log|recover|analyze|optimize|check\s+table|repair|lock|unlock|kill|flush)\b/i);

/** 读取语句内出现即 danger 的片段（多语句、文件读写、全局设置、跨行锁读） */
const SQL_HIDDEN_DANGER_RE = stryMutAct_9fa48("41") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\S+update\b/i : stryMutAct_9fa48("40") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\supdate\b/i : stryMutAct_9fa48("39") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\s]*\bfor\s+update\b/i : stryMutAct_9fa48("38") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\S\S]*\bfor\s+update\b/i : stryMutAct_9fa48("37") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[^\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("36") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]\bfor\s+update\b/i : stryMutAct_9fa48("35") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\S+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("34") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("33") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\S+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("32") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("31") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\S*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("30") ? /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("29") ? /[;]\s*\S|into\S+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("28") ? /[;]\s*\S|into\s(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("27") ? /[;]\s*\s|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("26") ? /[;]\S*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("25") ? /[;]\s\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : stryMutAct_9fa48("24") ? /[^;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i : (stryCov_9fa48("24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41"), /[;]\s*\S|into\s+(outfile|dumpfile)|load_file\s*\(|set\s+(global|persist)|select\s+[\s\S]*\bfor\s+update\b/i);
/** 读语句体内出现写关键字即 danger（WITH...DELETE / EXPLAIN ANALYZE DELETE 等） */
const SQL_WRITE_BODY_RE = /\b(insert|update|delete|merge|drop|alter|truncate)\b/i;

/** MongoDB 读操作白名单（复用 mongodb 适配器导出的 READ_OPS，单一事实来源） */
const MONGO_READ_OPS: ReadonlySet<string> = READ_OPS;

/** MongoDB 写操作清单（适配器未导出，此处按 DANGEROUS_OPS 之外的写命令复述） */
const MONGO_WRITE_OPS: ReadonlySet<string> = new Set(stryMutAct_9fa48("42") ? [] : (stryCov_9fa48("42"), [stryMutAct_9fa48("43") ? "" : (stryCov_9fa48("43"), 'insert'), stryMutAct_9fa48("44") ? "" : (stryCov_9fa48("44"), 'insertOne'), stryMutAct_9fa48("45") ? "" : (stryCov_9fa48("45"), 'insertMany'), stryMutAct_9fa48("46") ? "" : (stryCov_9fa48("46"), 'updateOne'), stryMutAct_9fa48("47") ? "" : (stryCov_9fa48("47"), 'updateMany'), stryMutAct_9fa48("48") ? "" : (stryCov_9fa48("48"), 'replaceOne'), stryMutAct_9fa48("49") ? "" : (stryCov_9fa48("49"), 'findOneAndUpdate'), stryMutAct_9fa48("50") ? "" : (stryCov_9fa48("50"), 'findAndModify'), stryMutAct_9fa48("51") ? "" : (stryCov_9fa48("51"), 'bulkWrite'), stryMutAct_9fa48("52") ? "" : (stryCov_9fa48("52"), 'deleteOne'), stryMutAct_9fa48("53") ? "" : (stryCov_9fa48("53"), 'createCollection'), stryMutAct_9fa48("54") ? "" : (stryCov_9fa48("54"), 'renameCollection'), stryMutAct_9fa48("55") ? "" : (stryCov_9fa48("55"), 'mapReduce')]));

/** 首个 SQL 关键字（剥掉注释与括号） */
export function sqlHead(statement: string): string {
  if (stryMutAct_9fa48("56")) {
    {}
  } else {
    stryCov_9fa48("56");
    const s = stryMutAct_9fa48("57") ? statement.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ') : (stryCov_9fa48("57"), statement.replace(stryMutAct_9fa48("61") ? /\/\*[\s\s]*?\*\//g : stryMutAct_9fa48("60") ? /\/\*[\S\S]*?\*\//g : stryMutAct_9fa48("59") ? /\/\*[^\s\S]*?\*\//g : stryMutAct_9fa48("58") ? /\/\*[\s\S]\*\//g : (stryCov_9fa48("58", "59", "60", "61"), /\/\*[\s\S]*?\*\//g), stryMutAct_9fa48("62") ? "" : (stryCov_9fa48("62"), ' ')).replace(stryMutAct_9fa48("64") ? /--[\n]*/g : stryMutAct_9fa48("63") ? /--[^\n]/g : (stryCov_9fa48("63", "64"), /--[^\n]*/g), stryMutAct_9fa48("65") ? "" : (stryCov_9fa48("65"), ' ')).replace(stryMutAct_9fa48("67") ? /#[\n]*/g : stryMutAct_9fa48("66") ? /#[^\n]/g : (stryCov_9fa48("66", "67"), /#[^\n]*/g), stryMutAct_9fa48("68") ? "" : (stryCov_9fa48("68"), ' ')).trim());
    const m = (stryMutAct_9fa48("74") ? /^[\s(]*([^a-zA-Z_]+)/ : stryMutAct_9fa48("73") ? /^[\s(]*([a-zA-Z_])/ : stryMutAct_9fa48("72") ? /^[\S(]*([a-zA-Z_]+)/ : stryMutAct_9fa48("71") ? /^[^\s(]*([a-zA-Z_]+)/ : stryMutAct_9fa48("70") ? /^[\s(]([a-zA-Z_]+)/ : stryMutAct_9fa48("69") ? /[\s(]*([a-zA-Z_]+)/ : (stryCov_9fa48("69", "70", "71", "72", "73", "74"), /^[\s(]*([a-zA-Z_]+)/)).exec(s);
    return stryMutAct_9fa48("75") ? m?.[1]?.toLowerCase() && '' : (stryCov_9fa48("75"), (stryMutAct_9fa48("78") ? m[1]?.toLowerCase() : stryMutAct_9fa48("77") ? m?.[1].toLowerCase() : stryMutAct_9fa48("76") ? m?.[1]?.toUpperCase() : (stryCov_9fa48("76", "77", "78"), m?.[1]?.toLowerCase())) ?? (stryMutAct_9fa48("79") ? "Stryker was here!" : (stryCov_9fa48("79"), '')));
  }
}

/** 语句 SHA256（challenge 绑定用；trim 后哈希） */
export function statementHash(statement: string): string {
  if (stryMutAct_9fa48("80")) {
    {}
  } else {
    stryCov_9fa48("80");
    return createHash(stryMutAct_9fa48("81") ? "" : (stryCov_9fa48("81"), 'sha256')).update(stryMutAct_9fa48("82") ? statement : (stryCov_9fa48("82"), statement.trim()), stryMutAct_9fa48("83") ? "" : (stryCov_9fa48("83"), 'utf8')).digest(stryMutAct_9fa48("84") ? "" : (stryCov_9fa48("84"), 'hex'));
  }
}

/**
 * 语句风险分级。op 指明调用通道：query 通道收到任何写语句一律 danger
 * （只读通道混入写）；execute 通道 SELECT 类放行（如 SELECT ... INTO 之外
 * 的合法场景由各适配器会话级只读兜底）。
 */
export function classifyStatement(kind: DbKind, statement: string, op: 'query' | 'execute'): GuardVerdict {
  if (stryMutAct_9fa48("85")) {
    {}
  } else {
    stryCov_9fa48("85");
    if (stryMutAct_9fa48("88") ? kind !== 'redis' : stryMutAct_9fa48("87") ? false : stryMutAct_9fa48("86") ? true : (stryCov_9fa48("86", "87", "88"), kind === (stryMutAct_9fa48("89") ? "" : (stryCov_9fa48("89"), 'redis')))) return classifyRedis(statement, op);
    if (stryMutAct_9fa48("92") ? kind !== 'mongodb' : stryMutAct_9fa48("91") ? false : stryMutAct_9fa48("90") ? true : (stryCov_9fa48("90", "91", "92"), kind === (stryMutAct_9fa48("93") ? "" : (stryCov_9fa48("93"), 'mongodb')))) return classifyMongo(statement, op);
    return classifySql(statement, op);
  }
}

/* ---------------- SQL 系（mysql/postgresql/gaussdb/sqlite/oracle/dmdb） ---------------- */

function classifySql(statement: string, op: 'query' | 'execute'): GuardVerdict {
  if (stryMutAct_9fa48("94")) {
    {}
  } else {
    stryCov_9fa48("94");
    const head = sqlHead(statement);
    if (stryMutAct_9fa48("97") ? head !== '' : stryMutAct_9fa48("96") ? false : stryMutAct_9fa48("95") ? true : (stryCov_9fa48("95", "96", "97"), head === (stryMutAct_9fa48("98") ? "Stryker was here!" : (stryCov_9fa48("98"), '')))) return stryMutAct_9fa48("99") ? {} : (stryCov_9fa48("99"), {
      level: stryMutAct_9fa48("100") ? "" : (stryCov_9fa48("100"), 'danger'),
      reason: stryMutAct_9fa48("101") ? "" : (stryCov_9fa48("101"), '无法解析语句关键字，按危险语句处理')
    });
    const isRead = SQL_READ_HEADS.has(head);
    if (stryMutAct_9fa48("103") ? false : stryMutAct_9fa48("102") ? true : (stryCov_9fa48("102", "103"), isRead)) {
      if (stryMutAct_9fa48("104")) {
        {}
      } else {
        stryCov_9fa48("104");
        if (stryMutAct_9fa48("106") ? false : stryMutAct_9fa48("105") ? true : (stryCov_9fa48("105", "106"), SQL_HIDDEN_DANGER_RE.test(statement))) {
          if (stryMutAct_9fa48("107")) {
            {}
          } else {
            stryCov_9fa48("107");
            return stryMutAct_9fa48("108") ? {} : (stryCov_9fa48("108"), {
              level: stryMutAct_9fa48("109") ? "" : (stryCov_9fa48("109"), 'danger'),
              reason: stryMutAct_9fa48("110") ? "" : (stryCov_9fa48("110"), '读语句包含危险片段（多语句 / 文件读写 / 全局设置 / 锁读），需要确认')
            });
          }
        }
        // 读头不等于只读：WITH...DELETE / EXPLAIN ANALYZE DELETE 语句体内含写关键字
        if (stryMutAct_9fa48("112") ? false : stryMutAct_9fa48("111") ? true : (stryCov_9fa48("111", "112"), SQL_WRITE_BODY_RE.test(statement))) {
          if (stryMutAct_9fa48("113")) {
            {}
          } else {
            stryCov_9fa48("113");
            return stryMutAct_9fa48("114") ? {} : (stryCov_9fa48("114"), {
              level: stryMutAct_9fa48("115") ? "" : (stryCov_9fa48("115"), 'danger'),
              reason: stryMutAct_9fa48("116") ? "" : (stryCov_9fa48("116"), '读语句体内包含写操作关键字（如 WITH...DELETE / EXPLAIN 写语句），需要确认')
            });
          }
        }
        return stryMutAct_9fa48("117") ? {} : (stryCov_9fa48("117"), {
          level: stryMutAct_9fa48("118") ? "" : (stryCov_9fa48("118"), 'none')
        });
      }
    }
    if (stryMutAct_9fa48("120") ? false : stryMutAct_9fa48("119") ? true : (stryCov_9fa48("119", "120"), SQL_DDL_RE.test(statement))) return stryMutAct_9fa48("121") ? {} : (stryCov_9fa48("121"), {
      level: stryMutAct_9fa48("122") ? "" : (stryCov_9fa48("122"), 'danger'),
      reason: stryMutAct_9fa48("123") ? "" : (stryCov_9fa48("123"), 'DDL 不可回滚（隐式提交），可能破坏表结构或数据')
    });
    if (stryMutAct_9fa48("125") ? false : stryMutAct_9fa48("124") ? true : (stryCov_9fa48("124", "125"), SQL_DML_RE.test(statement))) {
      if (stryMutAct_9fa48("126")) {
        {}
      } else {
        stryCov_9fa48("126");
        if (stryMutAct_9fa48("129") ? op !== 'query' : stryMutAct_9fa48("128") ? false : stryMutAct_9fa48("127") ? true : (stryCov_9fa48("127", "128", "129"), op === (stryMutAct_9fa48("130") ? "" : (stryCov_9fa48("130"), 'query')))) return stryMutAct_9fa48("131") ? {} : (stryCov_9fa48("131"), {
          level: stryMutAct_9fa48("132") ? "" : (stryCov_9fa48("132"), 'danger'),
          reason: stryMutAct_9fa48("133") ? "" : (stryCov_9fa48("133"), '只读通道（query）出现写语句，需要确认')
        });
        return stryMutAct_9fa48("134") ? {} : (stryCov_9fa48("134"), {
          level: stryMutAct_9fa48("135") ? "" : (stryCov_9fa48("135"), 'warning'),
          reason: stryMutAct_9fa48("136") ? "" : (stryCov_9fa48("136"), '写操作将修改数据')
        });
      }
    }
    if (stryMutAct_9fa48("138") ? false : stryMutAct_9fa48("137") ? true : (stryCov_9fa48("137", "138"), SQL_MAINT_RE.test(statement))) return stryMutAct_9fa48("139") ? {} : (stryCov_9fa48("139"), {
      level: stryMutAct_9fa48("140") ? "" : (stryCov_9fa48("140"), 'danger'),
      reason: stryMutAct_9fa48("141") ? "" : (stryCov_9fa48("141"), '维护/管理命令影响服务器状态，需要确认')
    });

    // 未知关键字：execute 通道 warning（适配器只读兜底），query 通道 danger
    if (stryMutAct_9fa48("144") ? op !== 'query' : stryMutAct_9fa48("143") ? false : stryMutAct_9fa48("142") ? true : (stryCov_9fa48("142", "143", "144"), op === (stryMutAct_9fa48("145") ? "" : (stryCov_9fa48("145"), 'query')))) return stryMutAct_9fa48("146") ? {} : (stryCov_9fa48("146"), {
      level: stryMutAct_9fa48("147") ? "" : (stryCov_9fa48("147"), 'danger'),
      reason: stryMutAct_9fa48("148") ? `` : (stryCov_9fa48("148"), `只读通道（query）出现非读取语句（${head}），需要确认`)
    });
    return stryMutAct_9fa48("149") ? {} : (stryCov_9fa48("149"), {
      level: stryMutAct_9fa48("150") ? "" : (stryCov_9fa48("150"), 'warning'),
      reason: stryMutAct_9fa48("151") ? `` : (stryCov_9fa48("151"), `未识别的语句类型（${head}），请确认后执行`)
    });
  }
}

/* ---------------- Redis ---------------- */

function classifyRedis(statement: string, op: 'query' | 'execute'): GuardVerdict {
  if (stryMutAct_9fa48("152")) {
    {}
  } else {
    stryCov_9fa48("152");
    const parts = parseRedisCommand(statement);
    const head = stryMutAct_9fa48("153") ? (parts[0] ?? '').toLowerCase() : (stryCov_9fa48("153"), (stryMutAct_9fa48("154") ? parts[0] && '' : (stryCov_9fa48("154"), parts[0] ?? (stryMutAct_9fa48("155") ? "Stryker was here!" : (stryCov_9fa48("155"), '')))).toUpperCase());
    if (stryMutAct_9fa48("158") ? head !== '' : stryMutAct_9fa48("157") ? false : stryMutAct_9fa48("156") ? true : (stryCov_9fa48("156", "157", "158"), head === (stryMutAct_9fa48("159") ? "Stryker was here!" : (stryCov_9fa48("159"), '')))) return stryMutAct_9fa48("160") ? {} : (stryCov_9fa48("160"), {
      level: stryMutAct_9fa48("161") ? "" : (stryCov_9fa48("161"), 'danger'),
      reason: stryMutAct_9fa48("162") ? "" : (stryCov_9fa48("162"), '无法解析 Redis 命令，按危险命令处理')
    });
    if (stryMutAct_9fa48("164") ? false : stryMutAct_9fa48("163") ? true : (stryCov_9fa48("163", "164"), DANGEROUS_COMMANDS.has(head))) {
      if (stryMutAct_9fa48("165")) {
        {}
      } else {
        stryCov_9fa48("165");
        return stryMutAct_9fa48("166") ? {} : (stryCov_9fa48("166"), {
          level: stryMutAct_9fa48("167") ? "" : (stryCov_9fa48("167"), 'danger'),
          reason: stryMutAct_9fa48("168") ? `` : (stryCov_9fa48("168"), `Redis 危险命令 ${head}，可能清空/重配置实例，需要确认`)
        });
      }
    }
    if (stryMutAct_9fa48("170") ? false : stryMutAct_9fa48("169") ? true : (stryCov_9fa48("169", "170"), WRITE_COMMANDS.has(head))) {
      if (stryMutAct_9fa48("171")) {
        {}
      } else {
        stryCov_9fa48("171");
        if (stryMutAct_9fa48("174") ? op !== 'query' : stryMutAct_9fa48("173") ? false : stryMutAct_9fa48("172") ? true : (stryCov_9fa48("172", "173", "174"), op === (stryMutAct_9fa48("175") ? "" : (stryCov_9fa48("175"), 'query')))) return stryMutAct_9fa48("176") ? {} : (stryCov_9fa48("176"), {
          level: stryMutAct_9fa48("177") ? "" : (stryCov_9fa48("177"), 'danger'),
          reason: stryMutAct_9fa48("178") ? `` : (stryCov_9fa48("178"), `只读通道（query）出现 Redis 写命令 ${head}，需要确认`)
        });
        return stryMutAct_9fa48("179") ? {} : (stryCov_9fa48("179"), {
          level: stryMutAct_9fa48("180") ? "" : (stryCov_9fa48("180"), 'warning'),
          reason: stryMutAct_9fa48("181") ? `` : (stryCov_9fa48("181"), `Redis 写命令 ${head} 将修改数据`)
        });
      }
    }
    if (stryMutAct_9fa48("183") ? false : stryMutAct_9fa48("182") ? true : (stryCov_9fa48("182", "183"), READ_COMMANDS.has(head))) return stryMutAct_9fa48("184") ? {} : (stryCov_9fa48("184"), {
      level: stryMutAct_9fa48("185") ? "" : (stryCov_9fa48("185"), 'none')
    });
    if (stryMutAct_9fa48("188") ? op !== 'query' : stryMutAct_9fa48("187") ? false : stryMutAct_9fa48("186") ? true : (stryCov_9fa48("186", "187", "188"), op === (stryMutAct_9fa48("189") ? "" : (stryCov_9fa48("189"), 'query')))) return stryMutAct_9fa48("190") ? {} : (stryCov_9fa48("190"), {
      level: stryMutAct_9fa48("191") ? "" : (stryCov_9fa48("191"), 'danger'),
      reason: stryMutAct_9fa48("192") ? `` : (stryCov_9fa48("192"), `只读通道（query）出现未识别的 Redis 命令（${head}），需要确认`)
    });
    return stryMutAct_9fa48("193") ? {} : (stryCov_9fa48("193"), {
      level: stryMutAct_9fa48("194") ? "" : (stryCov_9fa48("194"), 'warning'),
      reason: stryMutAct_9fa48("195") ? `` : (stryCov_9fa48("195"), `未识别的 Redis 命令（${head}），请确认后执行`)
    });
  }
}

/* ---------------- MongoDB ---------------- */

/** MongoDB 命令：JSON 对象，首键为操作名 */
function classifyMongo(statement: string, op: 'query' | 'execute'): GuardVerdict {
  if (stryMutAct_9fa48("196")) {
    {}
  } else {
    stryCov_9fa48("196");
    let head = stryMutAct_9fa48("197") ? "Stryker was here!" : (stryCov_9fa48("197"), '');
    try {
      if (stryMutAct_9fa48("198")) {
        {}
      } else {
        stryCov_9fa48("198");
        const parsed: unknown = JSON.parse(statement);
        if (stryMutAct_9fa48("201") ? parsed && typeof parsed === 'object' || !Array.isArray(parsed) : stryMutAct_9fa48("200") ? false : stryMutAct_9fa48("199") ? true : (stryCov_9fa48("199", "200", "201"), (stryMutAct_9fa48("203") ? parsed || typeof parsed === 'object' : stryMutAct_9fa48("202") ? true : (stryCov_9fa48("202", "203"), parsed && (stryMutAct_9fa48("205") ? typeof parsed !== 'object' : stryMutAct_9fa48("204") ? true : (stryCov_9fa48("204", "205"), typeof parsed === (stryMutAct_9fa48("206") ? "" : (stryCov_9fa48("206"), 'object')))))) && (stryMutAct_9fa48("207") ? Array.isArray(parsed) : (stryCov_9fa48("207"), !Array.isArray(parsed))))) {
          if (stryMutAct_9fa48("208")) {
            {}
          } else {
            stryCov_9fa48("208");
            head = stryMutAct_9fa48("209") ? Object.keys(parsed as Record<string, unknown>)[0] && '' : (stryCov_9fa48("209"), Object.keys(parsed as Record<string, unknown>)[0] ?? (stryMutAct_9fa48("210") ? "Stryker was here!" : (stryCov_9fa48("210"), '')));
          }
        }
      }
    } catch {
      if (stryMutAct_9fa48("211")) {
        {}
      } else {
        stryCov_9fa48("211");
        return stryMutAct_9fa48("212") ? {} : (stryCov_9fa48("212"), {
          level: stryMutAct_9fa48("213") ? "" : (stryCov_9fa48("213"), 'danger'),
          reason: stryMutAct_9fa48("214") ? "" : (stryCov_9fa48("214"), 'MongoDB 命令不是合法 JSON 对象，按危险命令处理')
        });
      }
    }
    if (stryMutAct_9fa48("217") ? head !== '' : stryMutAct_9fa48("216") ? false : stryMutAct_9fa48("215") ? true : (stryCov_9fa48("215", "216", "217"), head === (stryMutAct_9fa48("218") ? "Stryker was here!" : (stryCov_9fa48("218"), '')))) return stryMutAct_9fa48("219") ? {} : (stryCov_9fa48("219"), {
      level: stryMutAct_9fa48("220") ? "" : (stryCov_9fa48("220"), 'danger'),
      reason: stryMutAct_9fa48("221") ? "" : (stryCov_9fa48("221"), '无法解析 MongoDB 命令，按危险命令处理')
    });
    if (stryMutAct_9fa48("223") ? false : stryMutAct_9fa48("222") ? true : (stryCov_9fa48("222", "223"), DANGEROUS_OPS.has(head))) {
      if (stryMutAct_9fa48("224")) {
        {}
      } else {
        stryCov_9fa48("224");
        return stryMutAct_9fa48("225") ? {} : (stryCov_9fa48("225"), {
          level: stryMutAct_9fa48("226") ? "" : (stryCov_9fa48("226"), 'danger'),
          reason: stryMutAct_9fa48("227") ? `` : (stryCov_9fa48("227"), `MongoDB 危险操作 ${head}，可能删库/删集合，需要确认`)
        });
      }
    }
    if (stryMutAct_9fa48("229") ? false : stryMutAct_9fa48("228") ? true : (stryCov_9fa48("228", "229"), MONGO_WRITE_OPS.has(head))) {
      if (stryMutAct_9fa48("230")) {
        {}
      } else {
        stryCov_9fa48("230");
        if (stryMutAct_9fa48("233") ? op !== 'query' : stryMutAct_9fa48("232") ? false : stryMutAct_9fa48("231") ? true : (stryCov_9fa48("231", "232", "233"), op === (stryMutAct_9fa48("234") ? "" : (stryCov_9fa48("234"), 'query')))) return stryMutAct_9fa48("235") ? {} : (stryCov_9fa48("235"), {
          level: stryMutAct_9fa48("236") ? "" : (stryCov_9fa48("236"), 'danger'),
          reason: stryMutAct_9fa48("237") ? `` : (stryCov_9fa48("237"), `只读通道（query）出现 MongoDB 写操作 ${head}，需要确认`)
        });
        return stryMutAct_9fa48("238") ? {} : (stryCov_9fa48("238"), {
          level: stryMutAct_9fa48("239") ? "" : (stryCov_9fa48("239"), 'warning'),
          reason: stryMutAct_9fa48("240") ? `` : (stryCov_9fa48("240"), `MongoDB 写操作 ${head} 将修改数据`)
        });
      }
    }
    if (stryMutAct_9fa48("242") ? false : stryMutAct_9fa48("241") ? true : (stryCov_9fa48("241", "242"), MONGO_READ_OPS.has(head))) return stryMutAct_9fa48("243") ? {} : (stryCov_9fa48("243"), {
      level: stryMutAct_9fa48("244") ? "" : (stryCov_9fa48("244"), 'none')
    });
    if (stryMutAct_9fa48("247") ? op !== 'query' : stryMutAct_9fa48("246") ? false : stryMutAct_9fa48("245") ? true : (stryCov_9fa48("245", "246", "247"), op === (stryMutAct_9fa48("248") ? "" : (stryCov_9fa48("248"), 'query')))) return stryMutAct_9fa48("249") ? {} : (stryCov_9fa48("249"), {
      level: stryMutAct_9fa48("250") ? "" : (stryCov_9fa48("250"), 'danger'),
      reason: stryMutAct_9fa48("251") ? `` : (stryCov_9fa48("251"), `只读通道（query）出现未识别的 MongoDB 操作（${head}），需要确认`)
    });
    return stryMutAct_9fa48("252") ? {} : (stryCov_9fa48("252"), {
      level: stryMutAct_9fa48("253") ? "" : (stryCov_9fa48("253"), 'none')
    });
  }
}

/* ---------------- ChallengeStore ---------------- */

export interface Challenge {
  id: string;
  statementHash: string;
  createdAt: number;
  expiresAt: number;
  /** 绑定作用域：challenge 只能在同一连接+项目上消费，防跨库重放 */
  connId?: string;
  projectKey?: string;
}

/** challenge 的作用域（创建时绑定，消费时必须一致） */
export interface ChallengeScope {
  connId: string;
  projectKey: string;
}
export interface ChallengeStoreOptions {
  /** TTL 毫秒，默认 5min */
  ttlMs?: number;
  /** 注入时钟（测试过期） */
  now?: () => number;
  /** 清理周期毫秒，默认 60s；传 0 禁用定时器（测试用） */
  sweepIntervalMs?: number;
}

/**
 * 一次性确认凭据：绑定语句 SHA256、5 分钟过期、定期清理。
 * consume(id, statement)：存在 + 未过期 + hash 一致才通过，且立即失效（一次性）。
 */
export class ChallengeStore {
  private readonly ttl: number;
  private readonly nowFn: () => number;
  private readonly map = new Map<string, Challenge>();
  private timer: NodeJS.Timeout | undefined;
  private disposed = stryMutAct_9fa48("254") ? true : (stryCov_9fa48("254"), false);
  constructor(opts?: ChallengeStoreOptions) {
    if (stryMutAct_9fa48("255")) {
      {}
    } else {
      stryCov_9fa48("255");
      this.ttl = stryMutAct_9fa48("256") ? opts?.ttlMs && 5 * 60 * 1000 : (stryCov_9fa48("256"), (stryMutAct_9fa48("257") ? opts.ttlMs : (stryCov_9fa48("257"), opts?.ttlMs)) ?? (stryMutAct_9fa48("258") ? 5 * 60 / 1000 : (stryCov_9fa48("258"), (stryMutAct_9fa48("259") ? 5 / 60 : (stryCov_9fa48("259"), 5 * 60)) * 1000)));
      this.nowFn = stryMutAct_9fa48("260") ? opts?.now && (() => Date.now()) : (stryCov_9fa48("260"), (stryMutAct_9fa48("261") ? opts.now : (stryCov_9fa48("261"), opts?.now)) ?? (stryMutAct_9fa48("262") ? () => undefined : (stryCov_9fa48("262"), () => Date.now())));
      const interval = stryMutAct_9fa48("263") ? opts?.sweepIntervalMs && 60 * 1000 : (stryCov_9fa48("263"), (stryMutAct_9fa48("264") ? opts.sweepIntervalMs : (stryCov_9fa48("264"), opts?.sweepIntervalMs)) ?? (stryMutAct_9fa48("265") ? 60 / 1000 : (stryCov_9fa48("265"), 60 * 1000)));
      if (stryMutAct_9fa48("269") ? interval <= 0 : stryMutAct_9fa48("268") ? interval >= 0 : stryMutAct_9fa48("267") ? false : stryMutAct_9fa48("266") ? true : (stryCov_9fa48("266", "267", "268", "269"), interval > 0)) {
        if (stryMutAct_9fa48("270")) {
          {}
        } else {
          stryCov_9fa48("270");
          this.timer = setInterval(stryMutAct_9fa48("271") ? () => undefined : (stryCov_9fa48("271"), () => this.sweep()), interval);
          stryMutAct_9fa48("272") ? this.timer.unref() : (stryCov_9fa48("272"), this.timer.unref?.());
        }
      }
    }
  }

  /** 生成绑定语句+作用域的一次性 challenge */
  create(statement: string, scope?: ChallengeScope): Challenge {
    if (stryMutAct_9fa48("273")) {
      {}
    } else {
      stryCov_9fa48("273");
      if (stryMutAct_9fa48("275") ? false : stryMutAct_9fa48("274") ? true : (stryCov_9fa48("274", "275"), this.disposed)) throw new Error(stryMutAct_9fa48("277") ? "" : (stryCov_9fa48("277"), 'ChallengeStore 已关闭'));
      const now = this.nowFn();
      const ch: Challenge = stryMutAct_9fa48("278") ? {} : (stryCov_9fa48("278"), {
        id: (stryMutAct_9fa48("279") ? "" : (stryCov_9fa48("279"), 'c_')) + randomBytes(12).toString(stryMutAct_9fa48("280") ? "" : (stryCov_9fa48("280"), 'hex')),
        statementHash: statementHash(statement),
        createdAt: now,
        expiresAt: stryMutAct_9fa48("281") ? now - this.ttl : (stryCov_9fa48("281"), now + this.ttl),
        ...(scope ? stryMutAct_9fa48("282") ? {} : (stryCov_9fa48("282"), {
          connId: scope.connId,
          projectKey: scope.projectKey
        }) : {})
      });
      if (stryMutAct_9fa48("283")) {
        ;
      } else {
        stryCov_9fa48("283");
        this.map.set(ch.id, ch);
      }
      return ch;
    }
  }

  /** 一次性消费：存在 + 未过期 + hash 与作用域一致才通过，且立即失效；否则 false（不改状态） */
  consume(id: string, statement: string, scope?: ChallengeScope): boolean {
    if (stryMutAct_9fa48("284")) {
      {}
    } else {
      stryCov_9fa48("284");
      const ch = this.map.get(id);
      if (stryMutAct_9fa48("287") ? false : stryMutAct_9fa48("286") ? true : stryMutAct_9fa48("285") ? ch : (stryCov_9fa48("285", "286", "287"), !ch)) return stryMutAct_9fa48("288") ? true : (stryCov_9fa48("288"), false);
      if (stryMutAct_9fa48("289")) {
        ;
      } else {
        stryCov_9fa48("289");
        this.map.delete(id);
      } // 无论成败都取走，防重放探测
      if (stryMutAct_9fa48("293") ? this.nowFn() <= ch.expiresAt : stryMutAct_9fa48("292") ? this.nowFn() >= ch.expiresAt : stryMutAct_9fa48("291") ? false : stryMutAct_9fa48("290") ? true : (stryCov_9fa48("290", "291", "292", "293"), this.nowFn() > ch.expiresAt)) return stryMutAct_9fa48("294") ? true : (stryCov_9fa48("294"), false);
      if (stryMutAct_9fa48("297") ? ch.statementHash === statementHash(statement) : stryMutAct_9fa48("296") ? false : stryMutAct_9fa48("295") ? true : (stryCov_9fa48("295", "296", "297"), ch.statementHash !== statementHash(statement))) return stryMutAct_9fa48("298") ? true : (stryCov_9fa48("298"), false);
      // 作用域绑定：创建时带 scope 则消费时必须完全一致（防同语句跨连接/跨项目重放）
      if (stryMutAct_9fa48("301") ? ch.connId !== undefined || ch.connId !== scope?.connId : stryMutAct_9fa48("300") ? false : stryMutAct_9fa48("299") ? true : (stryCov_9fa48("299", "300", "301"), (stryMutAct_9fa48("303") ? ch.connId === undefined : stryMutAct_9fa48("302") ? true : (stryCov_9fa48("302", "303"), ch.connId !== undefined)) && (stryMutAct_9fa48("305") ? ch.connId === scope?.connId : stryMutAct_9fa48("304") ? true : (stryCov_9fa48("304", "305"), ch.connId !== (stryMutAct_9fa48("306") ? scope.connId : (stryCov_9fa48("306"), scope?.connId)))))) return stryMutAct_9fa48("307") ? true : (stryCov_9fa48("307"), false);
      if (stryMutAct_9fa48("310") ? ch.projectKey !== undefined || ch.projectKey !== scope?.projectKey : stryMutAct_9fa48("309") ? false : stryMutAct_9fa48("308") ? true : (stryCov_9fa48("308", "309", "310"), (stryMutAct_9fa48("312") ? ch.projectKey === undefined : stryMutAct_9fa48("311") ? true : (stryCov_9fa48("311", "312"), ch.projectKey !== undefined)) && (stryMutAct_9fa48("314") ? ch.projectKey === scope?.projectKey : stryMutAct_9fa48("313") ? true : (stryCov_9fa48("313", "314"), ch.projectKey !== (stryMutAct_9fa48("315") ? scope.projectKey : (stryCov_9fa48("315"), scope?.projectKey)))))) return stryMutAct_9fa48("316") ? true : (stryCov_9fa48("316"), false);
      return stryMutAct_9fa48("317") ? false : (stryCov_9fa48("317"), true);
    }
  }

  /** 清理过期项 */
  sweep(): void {
    if (stryMutAct_9fa48("318")) {
      {}
    } else {
      stryCov_9fa48("318");
      const now = this.nowFn();
      for (const [id, ch] of this.map) {
        if (stryMutAct_9fa48("319")) {
          {}
        } else {
          stryCov_9fa48("319");
          if (stryMutAct_9fa48("323") ? now <= ch.expiresAt : stryMutAct_9fa48("322") ? now >= ch.expiresAt : stryMutAct_9fa48("321") ? false : stryMutAct_9fa48("320") ? true : (stryCov_9fa48("320", "321", "322", "323"), now > ch.expiresAt)) if (stryMutAct_9fa48("324")) {
            ;
          } else {
            stryCov_9fa48("324");
            this.map.delete(id);
          }
        }
      }
    }
  }
  dispose(): void {
    if (stryMutAct_9fa48("325")) {
      {}
    } else {
      stryCov_9fa48("325");
      this.disposed = stryMutAct_9fa48("326") ? false : (stryCov_9fa48("326"), true);
      if (stryMutAct_9fa48("328") ? false : stryMutAct_9fa48("327") ? true : (stryCov_9fa48("327", "328"), this.timer)) {
        if (stryMutAct_9fa48("329")) {
          {}
        } else {
          stryCov_9fa48("329");
          if (stryMutAct_9fa48("330")) {
            ;
          } else {
            stryCov_9fa48("330");
            clearInterval(this.timer);
          }
          this.timer = undefined;
        }
      }
      if (stryMutAct_9fa48("331")) {
        ;
      } else {
        stryCov_9fa48("331");
        this.map.clear();
      }
    }
  }
}