/**
 * 适配器共享工具：单元格规范化、标识符校验/引用、limit 钳制、端口校验、错误包装。
 */
import type { NormalizedCell } from '../types.js';

const MAX_JSON_LEN = 1000;
/** 标识符基本校验：非空、长度 ≤128、无 NUL/换行等控制字符。
 *  防注入不靠字符白名单（各库引用标识符合法字符极宽：MySQL 反引号内任意、PG/SQLite "..." 任意、
 *  Oracle/DM 引用创建的名字可含任意字符——白名单会误杀合法对象名，如 DM ## 开头内部表、
 *  MySQL `my-table`/中文表名），而是靠「参数绑定 + quoteIdent 引号转义」。 */
export function assertIdent(name: string, label = '标识符'): string {
  if (
    typeof name !== 'string' || name.length === 0 || name.length > 128 ||
    /[\0\r\n]/.test(name)
  ) {
    throw new Error(`非法${label}: ${JSON.stringify(String(name))}（不允许为空、超 128 字符或含 NUL/换行）`);
  }
  return name;
}

/** 校验并用引号包裹标识符，内部引号转义（"..." 内 " → ""，`...` 内 ` → ``）。
 *  引用标识符内唯一需要转义的就是引号自身，转义后任意名字均安全。 */
export function quoteIdent(name: string, quote: '"' | '`' = '"'): string {
  return quote + assertIdent(name).replaceAll(quote, quote + quote) + quote;
}

/** preview limit 钳制到 [1, max]（服务层已限 50，适配器再兜底一次） */
export function clampLimit(limit: number, max = 50): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n > max ? max : n;
}

/** preview offset 钳制到 [0, ∞)（服务层已限 ≥0，适配器再兜底一次；缺省 0） */
export function clampOffset(offset?: number): number {
  const n = Math.floor(Number(offset ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** LIKE 关键字转义：通配符（% _）与转义符（#）字面化，SQL 侧统一 ESCAPE '#'。
 *  选 '#' 而非 '\' 是因为反斜杠在 MySQL 字符串字面量里还要二次转义，各库字面量
 *  规则不一；'#' 不是任何库的特殊字符，ESCAPE 子句写法跨方言一致。
 *  关键字本体一律走绑定参数，本函数只影响通配符语义，无注入面。 */
export function escapeLikePattern(kw: string): string {
  return kw.replace(/[%_#]/g, (m) => '#' + m);
}

/**
 * 端口校验（fail-closed，sqlserver validPort 同口径，各适配器 fields/URL 两路径共用）：
 * 仅「未提供」（undefined/null/''，表单留空的官方语义）回退该库默认端口；提供了但
 * Number() 后不是 1-65535 的整数则抛中文错误——绝不静默改写用户配置（各驱动普遍对
 * falsy 端口 `|| 默认` 静默回退、对非整数静默截断，连错服务/端口后排障会被误导）。
 */
export function validPort(v: unknown, dflt: number, label: string): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`${label} 连接的端口取值非法：${JSON.stringify(v)}（须为 1-65535 的整数；留空才使用默认端口 ${dflt}）`);
  }
  return n;
}

/** 任意单元格 → NormalizedCell（string | number | null） */
export function normalizeCell(v: unknown): NormalizedCell {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string') return v as string;
  if (t === 'number') return v as number;
  if (t === 'boolean') return v ? 1 : 0;
  if (t === 'bigint') {
    const b = v as bigint;
    return b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(b)
      : b.toString();
  }
  // Invalid Date（如驱动返回无法解析的日期）不能抛 RangeError：单格异常会放大成整查询失败
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? String(v) : v.toISOString();
  if (v instanceof Uint8Array) return `[BLOB ${v.byteLength} bytes]`;
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > MAX_JSON_LEN ? s.slice(0, MAX_JSON_LEN) + '…[已截断]' : s;
}

/** 统一错误包装：转成人类可读并保留原始 message */
export async function humanize<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: ${msg}`);
  }
}
