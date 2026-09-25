/**
 * SQL 系适配器共享工具：单元格规范化、标识符校验/引用、limit 钳制、错误包装。
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
  if (v instanceof Date) return v.toISOString();
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
