/**
 * 数据浏览字段筛选（Navicat「Filter & Sort」对齐）：条件解析 + 跨方言 WHERE 构造。
 *
 * Navicat 官方手册（Navicat 18, Data Editor → Filter & Sort）的构建器语义：
 *  每行 = [字段][操作符][值]，多行以 and / or 连接（本工具用全局 logic 表达，等价于
 *  Navicat 构建器各行连接符取同一值时的行为）；操作符对照见 BrowseFilterOp 注释。
 *
 * 安全边界：值一律走绑定参数（本模块只产出占位符与参数数组，绝不内联值）；
 * 列名经 assertIdent + 方言 quoteIdent 转义；op 白名单校验，未知操作符直接拒绝。
 */
import { assertIdent, escapeLikePattern } from './common.js';

/** 单个字段筛选条件（对应 Navicat 构建器一行） */
export interface BrowseFilter {
  column: string;
  op: string;
  value?: string;
  /** between/not_between 的上界 */
  value2?: string;
}

/**
 * 操作符全集（对齐 Navicat 构建器；PG 专属的大小写变体并入基础 contains——
 * 本工具各库 contains 统一大小写不敏感，与既有跨列搜索语义一致）：
 *   = != < <= > >= contains not_contains begin_with not_begin_with end_with not_end_with
 *   is_null is_not_null is_empty is_not_empty between not_between in not_in
 * （Navicat 的 exists / is field type 为 MongoDB 专属，内容筛选场景不提供）
 */
const OPS: ReadonlySet<string> = new Set([
  'eq', 'ne', 'lt', 'le', 'gt', 'ge',
  'contains', 'not_contains',
  'begin_with', 'not_begin_with', 'end_with', 'not_end_with',
  'is_null', 'is_not_null', 'is_empty', 'is_not_empty',
  'between', 'not_between', 'in', 'not_in',
]);

/** 无需取值的操作符（Navicat 语义：null/空串判定无值输入） */
const VALUELESS_OPS: ReadonlySet<string> = new Set(['is_null', 'is_not_null', 'is_empty', 'is_not_empty']);
/** 需要双值的操作符 */
const TWO_VALUE_OPS: ReadonlySet<string> = new Set(['between', 'not_between']);
/** 逗号列表操作符 */
const LIST_OPS: ReadonlySet<string> = new Set(['in', 'not_in']);

const MAX_FILTERS = 8;
const MAX_VALUE_LEN = 512;
const MAX_LIST_ITEMS = 100;

/** 筛选条件间逻辑（Navicat 构建器行间连接符）；缺省 and */
export function normalizeFilterLogic(raw: unknown): 'and' | 'or' {
  return raw === 'or' ? 'or' : 'and';
}

function valueOf(raw: unknown, label: string): string {
  if (raw == null || typeof raw === 'object') throw new Error(`筛选${label}必须是字符串`);
  const s = String(raw);
  if (s.length === 0) throw new Error(`筛选${label}不能为空`);
  if (s.length > MAX_VALUE_LEN) throw new Error(`筛选${label}超过 ${MAX_VALUE_LEN} 字符上限`);
  return s;
}

/** 解析并校验筛选条件（HTTP/管理层的入参边界；适配器复用同函数做二次校验） */
export function parseBrowseFilters(raw: unknown): BrowseFilter[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('筛选条件必须是数组');
  if (raw.length > MAX_FILTERS) throw new Error(`筛选条件超过 ${MAX_FILTERS} 个上限`);
  const out: BrowseFilter[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('筛选条件必须是 {column, op, value} 对象');
    }
    const rec = item as Record<string, unknown>;
    const column = assertIdent(typeof rec.column === 'string' ? rec.column : String(rec.column ?? ''), '筛选字段名');
    const op = typeof rec.op === 'string' ? rec.op : '';
    if (!OPS.has(op)) throw new Error(`未知筛选操作符: ${JSON.stringify(op)}`);
    const f: BrowseFilter = { column, op };
    if (!VALUELESS_OPS.has(op)) {
      f.value = valueOf(rec.value, '值');
      if (TWO_VALUE_OPS.has(op)) f.value2 = valueOf(rec.value2, '上界值');
      if (LIST_OPS.has(op) && f.value.split(',').filter((s) => s.trim() !== '').length > MAX_LIST_ITEMS) {
        throw new Error(`筛选列表超过 ${MAX_LIST_ITEMS} 个值上限`);
      }
    }
    out.push(f);
  }
  return out;
}

/** 方言钩子：标识符引用、文本化、LIKE 谓词（含大小写策略与 ESCAPE）、占位符 */
export interface FilterDialect {
  quote(col: string): string;
  /** 文本化表达式（CAST/TO_CHAR 等），用于 LIKE 与 '' 判定 */
  text(colSql: string): string;
  /** LIKE 谓词（入参为文本化列与占位符 SQL；pg 用 ILIKE、oracle/dmdb 两端 UPPER）；
   *  neg=true 生成 NOT 变体（NOT LIKE / NOT ILIKE） */
  like(textCol: string, paramSql: string, neg?: boolean): string;
  /** 占位符（i 从 1 起） */
  param(i: number): string;
}

const LIKE_ESC = " ESCAPE '#'";

/** 通用 SQL 方言（mysql/sqlite/mssql 语义：默认 collation 大小写不敏感的裸 LIKE） */
export function bareLikeDialect(quote: (c: string) => string, param: (i: number) => string, cast?: (c: string) => string): FilterDialect {
  return {
    quote,
    text: cast ?? ((c) => c),
    like: (t, p, neg) => `${t} ${neg ? 'NOT ' : ''}LIKE ${p}${LIKE_ESC}`,
    param,
  };
}

/** PG 系：::text 统一转文本 + ILIKE 大小写不敏感（与既有跨列搜索一致） */
export function pgLikeDialect(quote: (c: string) => string, param: (i: number) => string): FilterDialect {
  return {
    quote,
    text: (c) => `${c}::text`,
    like: (t, p, neg) => `${t} ${neg ? 'NOT ' : ''}ILIKE ${p}${LIKE_ESC}`,
    param,
  };
}

/** Oracle/DM：TO_CHAR 文本化 + 两端 UPPER 大小写不敏感（与既有跨列搜索一致） */
export function upperLikeDialect(quote: (c: string) => string, param: (i: number) => string): FilterDialect {
  return {
    quote,
    text: (c) => `TO_CHAR(${c})`,
    like: (t, p, neg) => `UPPER(${t}) ${neg ? 'NOT ' : ''}LIKE UPPER(${p})${LIKE_ESC}`,
    param,
  };
}

/** in/not_in 的值列表：英文逗号分隔，去首尾空白，丢弃空项 */
function listValues(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * 解析 Navicat 构建器的逐行逻辑连接符（logics[i] 连接第 i 与第 i+1 个条件）。
 * 缺省回退全局 logic；非法值/长度不符 → 抛错（与条件数组同级的入参边界）。
 */
export function parseFilterLogics(raw: unknown, count: number, dflt: 'and' | 'or'): Array<'and' | 'or'> {
  if (raw == null) return Array.from({ length: Math.max(0, count - 1) }, () => dflt);
  if (!Array.isArray(raw)) throw new Error('筛选逻辑连接符必须是数组');
  if (raw.length !== Math.max(0, count - 1)) {
    throw new Error(`筛选逻辑连接符数量必须是条件数-1（${Math.max(0, count - 1)}）`);
  }
  return raw.map((v) => {
    if (v !== 'and' && v !== 'or') throw new Error(`筛选逻辑连接符只能是 and/or: ${JSON.stringify(String(v))}`);
    return v;
  });
}

/**
 * 构造 WHERE 谓词（不含 WHERE 关键字）。占位符序号与 params 顺序严格一致，
 * 调用方按各自方言把 params 映射到绑定（位置数组 / 命名 input）。
 * 条件间连接（Navicat 构建器语义）：logics[i] 连接第 i 与第 i+1 个条件；混合
 * 连接符按左结合加括号——((c1 AND c2) OR c3)；logics 缺省时全部用 logic。
 */
export function buildFilterWhereSql(
  filters: BrowseFilter[],
  logic: 'and' | 'or',
  d: FilterDialect,
  logics?: Array<'and' | 'or'>,
): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = 0;
  const nextParam = (): string => d.param(++i);

  for (const f of filters) {
    if (!OPS.has(f.op)) throw new Error(`未知筛选操作符: ${JSON.stringify(f.op)}`);
    const c = d.quote(assertIdent(f.column, '筛选字段名'));
    const t = d.text(c);
    const bind = (v: string): string => {
      const p = nextParam();
      params.push(v);
      return p;
    };
    switch (f.op) {
      case 'eq': parts.push(`(${c} = ${bind(f.value!)})`); break;
      case 'ne': parts.push(`(${c} != ${bind(f.value!)})`); break;
      case 'lt': parts.push(`(${c} < ${bind(f.value!)})`); break;
      case 'le': parts.push(`(${c} <= ${bind(f.value!)})`); break;
      case 'gt': parts.push(`(${c} > ${bind(f.value!)})`); break;
      case 'ge': parts.push(`(${c} >= ${bind(f.value!)})`); break;
      // 文本包含类：模式走绑定（通配符字面化后 %…% 包裹），与跨列搜索同语义
      case 'contains': parts.push('(' + d.like(t, bind('%' + escapeLikePattern(f.value!) + '%')) + ')'); break;
      case 'not_contains': parts.push('(' + d.like(t, bind('%' + escapeLikePattern(f.value!) + '%'), true) + ')'); break;
      case 'begin_with': parts.push('(' + d.like(t, bind(escapeLikePattern(f.value!) + '%')) + ')'); break;
      case 'not_begin_with': parts.push('(' + d.like(t, bind(escapeLikePattern(f.value!) + '%'), true) + ')'); break;
      case 'end_with': parts.push('(' + d.like(t, bind('%' + escapeLikePattern(f.value!))) + ')'); break;
      case 'not_end_with': parts.push('(' + d.like(t, bind('%' + escapeLikePattern(f.value!)), true) + ')'); break;
      case 'is_null': parts.push(`(${c} IS NULL)`); break;
      case 'is_not_null': parts.push(`(${c} IS NOT NULL)`); break;
      case 'is_empty': parts.push(`(${t} = '')`); break;
      case 'is_not_empty': parts.push(`(${t} <> '')`); break;
      case 'between': parts.push(`(${c} BETWEEN ${bind(f.value!)} AND ${bind(f.value2!)})`); break;
      case 'not_between': parts.push(`(${c} NOT BETWEEN ${bind(f.value!)} AND ${bind(f.value2!)})`); break;
      case 'in': case 'not_in': {
        const vs = listValues(f.value!);
        if (vs.length === 0) throw new Error(`筛选列表不能为空: ${f.column}`);
        const ph = vs.map((v) => bind(v)).join(', ');
        parts.push(`(${c} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${ph}))`);
        break;
      }
      default: throw new Error(`未知筛选操作符: ${JSON.stringify(f.op)}`); // 白名单收敛，理论不可达
    }
  }
  // 连接：无 logics → 统一 glue；有 logics → 左结合括号（Navicat 混合连接符语义）
  if (!logics || logics.length === 0 || parts.length <= 1) {
    const glue = logic === 'or' ? ' OR ' : ' AND ';
    return { where: parts.join(glue), params };
  }
  let expr = parts[0]!;
  for (let k = 1; k < parts.length; k++) {
    const glue = logics[k - 1] === 'or' ? ' OR ' : ' AND ';
    expr = `(${expr}${glue}${parts[k]})`;
  }
  return { where: expr, params };
}

