/**
 * 数据浏览字段筛选（Navicat「Filter & Sort」对齐）测试。
 * - parseBrowseFilters/buildFilterWhereSql 纯函数：校验边界 + 各方言 SQL/参数契约；
 * - sqlite 适配器真机（临时 .db）：filterRows/countRows 筛选语义与 and/or 联合。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  bareLikeDialect,
  buildFilterWhereSql,
  normalizeFilterLogic,
  parseBrowseFilters,
  pgLikeDialect,
  upperLikeDialect,
} from '../../lib/adapters/sql-shared/filters.js';
import { createSqliteAdapter } from '../../lib/adapters/sqlite/index.js';
import type { DatabaseAdapter, ResolvedConnection } from '../../lib/adapters/types.js';

const betterAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
})();

/* ---------- parse：校验边界 ---------- */

describe('parseBrowseFilters（入参边界）', () => {
  it('null/undefined → 空数组；合法条件原样返回', () => {
    expect(parseBrowseFilters(null)).toEqual([]);
    expect(parseBrowseFilters(undefined)).toEqual([]);
    expect(parseBrowseFilters([{ column: 'name', op: 'contains', value: 'a' }])).toEqual([
      { column: 'name', op: 'contains', value: 'a' },
    ]);
  });

  it('非数组 / 条件非对象 → 抛错', () => {
    expect(() => parseBrowseFilters('x')).toThrow(/数组/);
    expect(() => parseBrowseFilters(42)).toThrow(/数组/);
    expect(() => parseBrowseFilters(['x'])).toThrow(/对象/);
    expect(() => parseBrowseFilters([null])).toThrow(/对象/);
  });

  it('未知操作符 → 抛错（白名单收敛）', () => {
    expect(() => parseBrowseFilters([{ column: 'a', op: 'drop', value: 'x' }])).toThrow(/未知筛选操作符/);
    expect(() => parseBrowseFilters([{ column: 'a', op: '', value: 'x' }])).toThrow(/未知筛选操作符/);
    expect(() => parseBrowseFilters([{ column: 'a', op: 'eq' }])).toThrow(/未知筛选操作符|筛选值/);
  });

  it('取值类操作符缺值 / between 缺上界 → 抛错；is_null 无需值', () => {
    expect(() => parseBrowseFilters([{ column: 'a', op: 'eq', value: '' }])).toThrow(/筛选值不能为空/);
    expect(() => parseBrowseFilters([{ column: 'a', op: 'between', value: '1' }])).toThrow(/筛选上界值/);
    expect(parseBrowseFilters([{ column: 'a', op: 'is_null' }])).toEqual([{ column: 'a', op: 'is_null' }]);
  });

  it('字段名走 assertIdent（空/超长/控制字符拒绝）', () => {
    expect(() => parseBrowseFilters([{ column: '', op: 'eq', value: '1' }])).toThrow(/非法筛选字段名/);
    expect(() => parseBrowseFilters([{ column: 'a\nb', op: 'eq', value: '1' }])).toThrow(/非法筛选字段名/);
  });

  it('上限：条件 ≤ 8、值 ≤ 512 字符、in 列表 ≤ 100 项', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ column: `c${i}`, op: 'eq', value: '1' }));
    expect(() => parseBrowseFilters(many)).toThrow(/筛选条件超过 8 个上限/);
    expect(() => parseBrowseFilters([{ column: 'a', op: 'eq', value: 'x'.repeat(513) }])).toThrow(/512 字符上限/);
    const bigList = Array.from({ length: 101 }, (_, i) => `${i}`).join(',');
    expect(() => parseBrowseFilters([{ column: 'a', op: 'in', value: bigList }])).toThrow(/100 个值上限/);
    const okList = Array.from({ length: 100 }, (_, i) => `${i}`).join(',');
    expect(parseBrowseFilters([{ column: 'a', op: 'in', value: okList }])).toHaveLength(1);
  });
});

describe('normalizeFilterLogic', () => {
  it('缺省/非法 → and；仅 "or" → or', () => {
    expect(normalizeFilterLogic(undefined)).toBe('and');
    expect(normalizeFilterLogic('AND')).toBe('and');
    expect(normalizeFilterLogic('or')).toBe('or');
    expect(normalizeFilterLogic('xor')).toBe('and');
  });
});

/* ---------- buildFilterWhereSql：各方言 SQL/参数契约 ---------- */

const mysqlD = bareLikeDialect((c) => '`' + c + '`', () => '?');
const pgD = pgLikeDialect((c) => '"' + c + '"', (i) => `$${i}`);
const oraD = upperLikeDialect((c) => '"' + c + '"', (i) => `:b${i}`);
const mssqlD = bareLikeDialect((c) => `[${c}]`, (i) => `@p${i}`, (c) => `CAST(${c} AS NVARCHAR(MAX))`);

describe('buildFilterWhereSql（SQL/参数契约）', () => {
  it('contains：通配符字面化 + %…% 包裹 + ESCAPE（值走绑定）', () => {
    const { where, params } = buildFilterWhereSql(
      parseBrowseFilters([{ column: 'name', op: 'contains', value: 'a%b#c_' }]),
      'and',
      mysqlD,
    );
    expect(where).toBe("(`name` LIKE ? ESCAPE '#')");
    expect(params).toEqual(['%a#%b##c#_%']);
  });

  it('多条件 AND 联合（默认），占位符序号与参数顺序一致', () => {
    const conds = parseBrowseFilters([
      { column: 'name', op: 'contains', value: 'alice' },
      { column: 'age', op: 'ge', value: '18' },
      { column: 'note', op: 'is_not_null' },
    ]);
    const { where, params } = buildFilterWhereSql(conds, 'and', pgD);
    expect(where).toBe('("name"::text ILIKE $1 ESCAPE \'#\') AND ("age" >= $2) AND ("note" IS NOT NULL)');
    expect(params).toEqual(['%alice%', '18']);
  });

  it('or 逻辑：条件间 OR', () => {
    const { where } = buildFilterWhereSql(
      parseBrowseFilters([
        { column: 'a', op: 'eq', value: '1' },
        { column: 'b', op: 'eq', value: '2' },
      ]),
      'or',
      mysqlD,
    );
    expect(where).toBe('(`a` = ?) OR (`b` = ?)');
  });

  it('begin_with/end_with/not_contains：锚定模式与 NOT LIKE', () => {
    const conds = parseBrowseFilters([
      { column: 'a', op: 'begin_with', value: 'x' },
      { column: 'b', op: 'end_with', value: 'y' },
      { column: 'c', op: 'not_contains', value: 'z' },
    ]);
    const { where, params } = buildFilterWhereSql(conds, 'and', mysqlD);
    expect(where).toBe("(`a` LIKE ? ESCAPE '#') AND (`b` LIKE ? ESCAPE '#') AND (`c` NOT LIKE ? ESCAPE '#')");
    expect(params).toEqual(['x%', '%y', '%z%']);
  });

  it('between/not_between：双值绑定', () => {
    const { where, params } = buildFilterWhereSql(
      parseBrowseFilters([{ column: 'score', op: 'between', value: '1', value2: '9' }]),
      'and',
      mysqlD,
    );
    expect(where).toBe('(`score` BETWEEN ? AND ?)');
    expect(params).toEqual(['1', '9']);
  });

  it('in/not_in：逗号列表去空白，逐项绑定', () => {
    const { where, params } = buildFilterWhereSql(
      parseBrowseFilters([{ column: 'city', op: 'in', value: ' 北京 , 上海 ,,' }]),
      'and',
      pgD,
    );
    expect(where).toBe('("city" IN ($1, $2))');
    expect(params).toEqual(['北京', '上海']);
  });

  it('is_null/is_empty：无参数谓词', () => {
    const { where, params } = buildFilterWhereSql(
      parseBrowseFilters([
        { column: 'a', op: 'is_null' },
        { column: 'b', op: 'is_empty' },
        { column: 'c', op: 'is_not_empty' },
      ]),
      'and',
      mysqlD,
    );
    expect(where).toBe("(`a` IS NULL) AND (`b` = '') AND (`c` <> '')");
    expect(params).toEqual([]);
  });

  it('oracle 方言：TO_CHAR + 两端 UPPER + :bN 位置绑定', () => {
    const { where, params } = buildFilterWhereSql(
      parseBrowseFilters([
        { column: 'name', op: 'contains', value: 'AL' },
        { column: 'age', op: 'lt', value: '30' },
      ]),
      'and',
      oraD,
    );
    expect(where).toBe('(UPPER(TO_CHAR("name")) LIKE UPPER(:b1) ESCAPE \'#\') AND ("age" < :b2)');
    expect(params).toEqual(['%AL%', '30']);
  });

  it('mssql 方言：NVARCHAR(MAX) 文本化 + @pN 命名占位', () => {
    const { where } = buildFilterWhereSql(
      parseBrowseFilters([{ column: 'note', op: 'contains', value: 'x' }]),
      'and',
      mssqlD,
    );
    expect(where).toBe("(CAST([note] AS NVARCHAR(MAX)) LIKE @p1 ESCAPE '#')");
  });

  it('sqlite 方言：CAST AS TEXT 文本化', () => {
    const { where } = buildFilterWhereSql(
      parseBrowseFilters([{ column: 'data', op: 'contains', value: 'x' }]),
      'and',
      bareLikeDialect((c) => `"${c}"`, () => '?', (c) => `CAST(${c} AS TEXT)`),
    );
    expect(where).toBe("(CAST(\"data\" AS TEXT) LIKE ? ESCAPE '#')");
  });

  it('适配器侧二次校验：未知操作符在构造时抛错（防绕过服务层直调）', () => {
    expect(() => buildFilterWhereSql([{ column: 'a', op: 'drop table', value: 'x' }], 'and', mysqlD)).toThrow(/未知筛选操作符/);
  });
});

/* ---------- sqlite 真机：filterRows/countRows 筛选语义 ---------- */

describe.skipIf(!betterAvailable)('sqlite filterRows/countRows（真机）', () => {
  let dir: string;
  let adapter: DatabaseAdapter;

  function conn(): ResolvedConnection {
    return { meta: { id: 'sqlite-filter', kind: 'sqlite' }, fields: { database: join(dir, 'filter.db') } };
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dbt-filters-'));
    const seed = await createSqliteAdapter(conn());
    await seed.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, score INTEGER, note TEXT)');
    const rows = [
      [1, 'alice', 90, 'alpha'],
      [2, 'bob', 40, null],
      [3, 'Alice', 70, ''],
      [4, 'carol', 55, 'beta'],
    ];
    for (const [id, name, score, note] of rows) {
      await seed.execute('INSERT INTO users (id, name, score, note) VALUES (?, ?, ?, ?)', [id, name, score, note]);
    }
    await seed.close();
    adapter = await createSqliteAdapter(conn());
  });

  afterAll(async () => {
    await adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('contains 单字段：大小写不敏感包含（LIKE 语义）', async () => {
    const r = await adapter.filterRows!('users', [{ column: 'name', op: 'contains', value: 'ALI' }], 'and', 50);
    expect(r.rowCount).toBe(2); // alice + Alice
    const c = await adapter.countRows!('users', undefined, undefined, [{ column: 'name', op: 'contains', value: 'ALI' }], 'and');
    expect(c).toBe(2);
  });

  it('多字段 AND 联合：name contains + score ge', async () => {
    const filters = [
      { column: 'name', op: 'contains', value: 'a' },
      { column: 'score', op: 'ge', value: '70' },
    ];
    const r = await adapter.filterRows!('users', filters, 'and', 50);
    expect(r.rows.map((row) => row[0])).toEqual([1, 3]); // alice(90) 与 Alice(70)
    expect(await adapter.countRows!('users', undefined, undefined, filters, 'and')).toBe(2);
  });

  it('多字段 OR 联合：任一条件命中', async () => {
    const filters = [{ column: 'name', op: 'begin_with', value: 'bo' }, { column: 'score', op: 'lt', value: '50' }];
    const r = await adapter.filterRows!('users', filters, 'or', 50);
    expect(r.rows.map((row) => row[0])).toEqual([2]); // bob 命中两条
  });

  it('between + in + is_null 组合', async () => {
    const between = await adapter.filterRows!('users', [{ column: 'score', op: 'between', value: '50', value2: '75' }], 'and', 50);
    expect(between.rows.map((row) => row[0])).toEqual([3, 4]);
    const inList = await adapter.filterRows!('users', [{ column: 'name', op: 'in', value: 'bob,carol' }], 'and', 50);
    expect(inList.rows.map((row) => row[0])).toEqual([2, 4]);
    const nulls = await adapter.filterRows!('users', [{ column: 'note', op: 'is_null' }], 'and', 50);
    expect(nulls.rows.map((row) => row[0])).toEqual([2]); // 空字符串 ≠ NULL
    const empty = await adapter.filterRows!('users', [{ column: 'note', op: 'is_empty' }], 'and', 50);
    expect(empty.rows.map((row) => row[0])).toEqual([3]);
  });

  it('not_contains / not_in 取反', async () => {
    const notContains = await adapter.filterRows!('users', [{ column: 'name', op: 'not_contains', value: 'ali' }], 'and', 50);
    expect(notContains.rows.map((row) => row[0])).toEqual([2, 4]);
    const notIn = await adapter.filterRows!('users', [{ column: 'name', op: 'not_in', value: 'alice,Alice' }], 'and', 50);
    expect(notIn.rows.map((row) => row[0])).toEqual([2, 4]);
  });

  it('通配符字面匹配：% 不当通配符', async () => {
    await adapter.execute('INSERT INTO users (id, name, score, note) VALUES (?, ?, ?, ?)', [5, '100%best', 10, 'pct']);
    const r = await adapter.filterRows!('users', [{ column: 'name', op: 'contains', value: '0%b' }], 'and', 50);
    expect(r.rows.map((row) => row[0])).toEqual([5]); // 字面 "0%b" 只命中本行
  });

  it('分页：limit/offset 生效；空条件数组返回空结果', async () => {
    const p1 = await adapter.filterRows!('users', [{ column: 'score', op: 'gt', value: '0' }], 'and', 2, undefined, 0);
    const p2 = await adapter.filterRows!('users', [{ column: 'score', op: 'gt', value: '0' }], 'and', 2, undefined, 2);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(2);
    expect(p1.rows[0]![0]).not.toBe(p2.rows[0]![0]);
    const none = await adapter.filterRows!('users', [], 'and', 50);
    expect(none.rowCount).toBe(0);
  });

  it('非法条件直调适配器 → 抛错（二次校验）', async () => {
    await expect(adapter.filterRows!('users', [{ column: 'name', op: 'drop', value: 'x' }], 'and', 50)).rejects.toThrow(/未知筛选操作符/);
    await expect(adapter.countRows!('users', undefined, undefined, [{ column: '', op: 'eq', value: '1' }], 'and')).rejects.toThrow(/非法筛选字段名/);
  });
});
