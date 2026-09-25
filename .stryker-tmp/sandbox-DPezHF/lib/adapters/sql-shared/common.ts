/**
 * SQL 系适配器共享工具：单元格规范化、标识符校验/引用、limit 钳制、错误包装。
 */
// @ts-nocheck

import type { NormalizedCell } from '../types.js';

const MAX_JSON_LEN = 1000;
const IDENT_RE = /^[A-Za-z0-9_$]+$/;

/** 校验合法标识符（防注入），不合法直接抛错 */
export function assertIdent(name: string, label = '标识符'): string {
  if (typeof name !== 'string' || name.length === 0 || !IDENT_RE.test(name)) {
    throw new Error(`非法${label}: ${JSON.stringify(String(name))}（仅允许字母、数字、_、$）`);
  }
  return name;
}

/** 校验并用引号包裹标识符（PG/SQLite 用 "，MySQL 用 `） */
export function quoteIdent(name: string, quote: '"' | '`' = '"'): string {
  return quote + assertIdent(name) + quote;
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
