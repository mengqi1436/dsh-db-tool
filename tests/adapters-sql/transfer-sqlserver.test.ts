/**
 * SQL Server 传输读写端离线测试（mock pool / mock 事务，不真连）。
 * 覆盖：
 *  - 类型映射矩阵（sys 类型 → midType、midType → T-SQL 列类型）；
 *  - **参数上限边界**：TDS 单语句 2100 参数 与 VALUES 表值构造器 1000 行两条限制取小；
 *  - 写端：多行 VALUES 参数化、MERGE（ignore/replace）、事务包裹与失败回滚、
 *    标识符 `[x]` 与 `]` 双写、日期剥 Z、decimal 字符串绑定；
 *  - 读端：keyset/range/offset 三种游标的 OFFSET...FETCH 形态、decimal 列 CONVERT 保精度、
 *    identity/主键/长度元数据、materialize（Date → ISO）；
 *  - 版本适配：主版本 >=11 走 OFFSET/FETCH，<11（2008/2008R2）降级 TOP/ROW_NUMBER，
 *    探测失败（0）保守降级且只探测一次；
 *  - beforeLoad：SET LOCK_TIMEOUT 15000 后 TRUNCATE，拿不到锁降级 DELETE；
 *  - 定位解析与 model.ts 分派（mock openSqlserverRaw，验证不再抛「暂不支持」）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { TransferColumn } from '../../lib/adapters/transfer/model.js';

// vi.mock 工厂被提升到文件顶部：mock 对象用 vi.hoisted 提前建立（不能引用普通顶层变量）
const rawMock = vi.hoisted(() => ({
  openSqlserverRaw: vi.fn(async () => ({
    pool: {} as never,
    ready: async () => undefined,
    database: 'app',
    driver: { Transaction: function () { return {}; } },
  })),
}));
vi.mock('../../lib/adapters/sqlserver/index.js', () => rawMock);

import {
  SQLSERVER_MAX_PARAMS,
  SQLSERVER_MAX_VALUES_ROWS,
  createSqlserverTransferReader,
  createSqlserverTransferWriter,
  midToSqlserverType,
  sqlserverIdent,
  sqlserverLocate,
  sqlserverMajorFromProps,
  sqlserverPerStmt,
  sqlserverTypeToMid,
  toSqlserverBind,
  toSqlserverDateTime,
} from '../../lib/adapters/transfer/kinds/sqlserver.js';

/* ---------------- mock 执行面 ---------------- */

interface Rec { sql: string; params: Record<string, unknown> }

type Responder = (sql: string, params?: Record<string, unknown>) => { recordset?: unknown[]; rowsAffected?: number[] };

function makeReq(recs: Rec[], respond: Responder) {
  const params: Record<string, unknown> = {};
  const req = {
    input(name: string, value: unknown) { params[name] = value; return req; },
    async query(sql: string) {
      recs.push({ sql, params: { ...params } });
      return respond(sql, params);
    },
  };
  return req;
}

/** 默认元数据响应：无返回行；可被 overrides 覆盖。
 *  opts 控制版本探测响应：默认 major=16（2012+，走 OFFSET/FETCH）；major=10 → 2008 降级路径；
 *  major=null + productVersion='' → 两次探测都判不出 → 0（保守降级）。 */
interface PoolOpts { major?: number | null; productVersion?: string }

function makePool(
  respond: Responder = () => ({ recordset: [], rowsAffected: [0] }),
  opts: PoolOpts = {},
) {
  const recs: Rec[] = [];
  const counts = { begin: 0, commit: 0, rollback: 0, versionCalls: 0 };
  const major = opts.major === undefined ? 16 : opts.major;
  const productVersion = opts.productVersion ?? '16.0.1000.6';
  const routed: Responder = (sql, params) => {
    if (sql.includes("SERVERPROPERTY('ProductMajorVersion')")) {
      counts.versionCalls += 1;
      return { recordset: [{ v: major }] };
    }
    if (sql.includes("SERVERPROPERTY('ProductVersion')")) {
      counts.versionCalls += 1;
      return { recordset: [{ v: productVersion }] };
    }
    return respond(sql, params);
  };
  const pool = {
    request: () => makeReq(recs, routed),
    connect: async () => ({}),
    close: async () => undefined,
    on: () => pool,
  };
  const openTx = () => ({
    begin: async () => { counts.begin += 1; },
    commit: async () => { counts.commit += 1; },
    rollback: async () => { counts.rollback += 1; },
    request: () => makeReq(recs, routed),
  });
  return { pool, recs, counts, openTx };
}

const col = (over: Partial<TransferColumn>): TransferColumn => ({
  name: 'c', midType: 'string', nullable: true, primaryKey: false, ...over,
});

/** 共享元数据响应：COLUMNS = 列定义（CHARACTER_MAXIMUM_LENGTH 为字符数，nvarchar(max) 为 -1）；
 *  TABLE_CONSTRAINTS = 主键列；TABLES = 表清单；COUNT_BIG = 行数 */
const metaResponder: Responder = (sql) => {
  if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
    return {
      recordset: [
        { COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: false, IS_IDENTITY: true, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
        { COLUMN_NAME: 'name', DATA_TYPE: 'nvarchar', IS_NULLABLE: true, IS_IDENTITY: false, CHARACTER_MAXIMUM_LENGTH: 100, NUMERIC_PRECISION: 0, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
        { COLUMN_NAME: 'amount', DATA_TYPE: 'decimal', IS_NULLABLE: true, IS_IDENTITY: false, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 2, COLUMN_DEFAULT: null },
        { COLUMN_NAME: 'note', DATA_TYPE: 'nvarchar', IS_NULLABLE: true, IS_IDENTITY: false, CHARACTER_MAXIMUM_LENGTH: -1, NUMERIC_PRECISION: 0, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
      ],
    };
  }
  if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [{ COLUMN_NAME: 'id' }] };
  if (sql.includes('COUNT_BIG')) return { recordset: [{ n: 42 }] };
  if (sql.includes('INFORMATION_SCHEMA.TABLES')) return { recordset: [{ TABLE_NAME: 't1' }, { TABLE_NAME: 't2' }] };
  return { recordset: [], rowsAffected: [0] };
};

/* ---------------- 类型映射 ---------------- */

describe('sqlserver 类型映射（离线）', () => {
  it('sys 类型 → midType（读向），-1 长度的 unicode/非 unicode 大类型归 text', () => {
    expect(sqlserverTypeToMid('int')).toBe('int');
    expect(sqlserverTypeToMid('smallint')).toBe('int');
    expect(sqlserverTypeToMid('tinyint')).toBe('int');
    expect(sqlserverTypeToMid('bigint')).toBe('bigint');
    expect(sqlserverTypeToMid('bit')).toBe('boolean');
    expect(sqlserverTypeToMid('decimal')).toBe('decimal');
    expect(sqlserverTypeToMid('numeric')).toBe('decimal');
    expect(sqlserverTypeToMid('money')).toBe('decimal');
    expect(sqlserverTypeToMid('smallmoney')).toBe('decimal');
    expect(sqlserverTypeToMid('float')).toBe('double');
    expect(sqlserverTypeToMid('real')).toBe('float');
    expect(sqlserverTypeToMid('nvarchar', 200)).toBe('string');
    expect(sqlserverTypeToMid('nvarchar', -1)).toBe('text');
    expect(sqlserverTypeToMid('varchar', -1)).toBe('text');
    expect(sqlserverTypeToMid('nchar', 20)).toBe('string');
    expect(sqlserverTypeToMid('char', 10)).toBe('string');
    expect(sqlserverTypeToMid('text')).toBe('text');
    expect(sqlserverTypeToMid('ntext')).toBe('text');
    expect(sqlserverTypeToMid('xml')).toBe('text');
    expect(sqlserverTypeToMid('varbinary', 16)).toBe('bytes');
    expect(sqlserverTypeToMid('varbinary', -1)).toBe('bytes');
    expect(sqlserverTypeToMid('binary', 8)).toBe('bytes');
    expect(sqlserverTypeToMid('image')).toBe('bytes');
    expect(sqlserverTypeToMid('timestamp')).toBe('bytes');
    expect(sqlserverTypeToMid('rowversion')).toBe('bytes');
    expect(sqlserverTypeToMid('uniqueidentifier')).toBe('string');
    expect(sqlserverTypeToMid('date')).toBe('date');
    expect(sqlserverTypeToMid('time')).toBe('time');
    expect(sqlserverTypeToMid('datetime')).toBe('datetime');
    expect(sqlserverTypeToMid('datetime2')).toBe('datetime');
    expect(sqlserverTypeToMid('smalldatetime')).toBe('datetime');
    expect(sqlserverTypeToMid('datetimeoffset')).toBe('timestamptz');
    // CLR/空间 UDT：驱动返回 Buffer → bytes 二进制保真（归 string 会以 NVARCHAR 绑定而乱码/报错）
    expect(sqlserverTypeToMid('hierarchyid')).toBe('bytes');
    expect(sqlserverTypeToMid('geometry')).toBe('bytes');
    expect(sqlserverTypeToMid('geography')).toBe('bytes');
    // sql_variant 值类型不定：归 text + 读端显式 CONVERT（见读端 SQL 用例）
    expect(sqlserverTypeToMid('sql_variant')).toBe('text');
  });

  it('midType → T-SQL 列类型（写向），长度/精度 clamp 到 SQL Server 上限', () => {
    expect(midToSqlserverType(col({ midType: 'int' }))).toBe('INT');
    expect(midToSqlserverType(col({ midType: 'bigint' }))).toBe('BIGINT');
    expect(midToSqlserverType(col({ midType: 'boolean' }))).toBe('BIT');
    expect(midToSqlserverType(col({ midType: 'float' }))).toBe('REAL');
    expect(midToSqlserverType(col({ midType: 'double' }))).toBe('FLOAT');
    expect(midToSqlserverType(col({ midType: 'decimal', precision: 10, scale: 2 }))).toBe('DECIMAL(10,2)');
    expect(midToSqlserverType(col({ midType: 'decimal' }))).toBe('DECIMAL(38,10)');
    // SQL Server decimal 精度上限 38，超限 clamp（源库可能声明 65）
    expect(midToSqlserverType(col({ midType: 'decimal', precision: 65, scale: 2 }))).toBe('DECIMAL(38,2)');
    expect(midToSqlserverType(col({ midType: 'string', length: 100 }))).toBe('NVARCHAR(100)');
    // NVARCHAR 上限 4000，超限 clamp（更长的值必须走 NVARCHAR(MAX) 即 text 映射）
    expect(midToSqlserverType(col({ midType: 'string', length: 99999 }))).toBe('NVARCHAR(4000)');
    expect(midToSqlserverType(col({ midType: 'text' }))).toBe('NVARCHAR(MAX)');
    expect(midToSqlserverType(col({ midType: 'bytes' }))).toBe('VARBINARY(MAX)');
    expect(midToSqlserverType(col({ midType: 'json' }))).toBe('NVARCHAR(MAX)');
    expect(midToSqlserverType(col({ midType: 'date' }))).toBe('DATE');
    expect(midToSqlserverType(col({ midType: 'time' }))).toBe('TIME');
    expect(midToSqlserverType(col({ midType: 'datetime' }))).toBe('DATETIME2');
    expect(midToSqlserverType(col({ midType: 'timestamptz' }))).toBe('DATETIMEOFFSET');
  });

  it('字符类型长度矩阵：源 >4000 与 (max) 归 text（目标 NVARCHAR 容量足够，不 8152 截断）', () => {
    expect(sqlserverTypeToMid('varchar', 4000)).toBe('string');
    expect(sqlserverTypeToMid('char', 4000)).toBe('string');
    expect(sqlserverTypeToMid('nvarchar', 4000)).toBe('string');
    expect(sqlserverTypeToMid('nchar', 4000)).toBe('string');
    expect(sqlserverTypeToMid('varchar', 4001)).toBe('text');
    expect(sqlserverTypeToMid('varchar', 5000)).toBe('text');
    expect(sqlserverTypeToMid('varchar', 8000)).toBe('text');
    expect(sqlserverTypeToMid('char', 8000)).toBe('text');
    expect(sqlserverTypeToMid('varchar', -1)).toBe('text');
    expect(sqlserverTypeToMid('nvarchar', -1)).toBe('text');
    // 写向：text 一律 NVARCHAR(MAX)；手造越界 string（调用方违约）仍 clamp 4000 不产生非法 DDL
    expect(midToSqlserverType(col({ midType: 'text' }))).toBe('NVARCHAR(MAX)');
    expect(midToSqlserverType(col({ midType: sqlserverTypeToMid('varchar', 5000), length: 5000 }))).toBe('NVARCHAR(MAX)');
    expect(midToSqlserverType(col({ midType: 'string', length: 99999 }))).toBe('NVARCHAR(4000)');
  });

  it('标识符一律 [x]，] 双写为 ]]；非法标识符沿用 assertIdent 校验', () => {
    expect(sqlserverIdent('users')).toBe('[users]');
    expect(sqlserverIdent('a]b')).toBe('[a]]b]');
    expect(sqlserverIdent('weird name')).toBe('[weird name]');
    expect(() => sqlserverIdent('')).toThrow(/非法标识符/);
    expect(() => sqlserverIdent('a\nb')).toThrow(/非法标识符/);
  });

  it('绑定值转换：bigint→十进制字符串、bytes→Buffer、日期列剥 Z（T-SQL 不接受 Z 后缀）', () => {
    expect(toSqlserverBind(9007199254740993n)).toBe('9007199254740993');
    expect(toSqlserverBind(true)).toBe(true);
    expect(toSqlserverBind(null)).toBeNull();
    expect(toSqlserverBind(new Uint8Array([1, 2]))).toEqual(Buffer.from([1, 2]));
    expect(toSqlserverDateTime('2024-01-01T10:00:00.000Z')).toBe('2024-01-01T10:00:00.000');
    expect(toSqlserverDateTime('2024-01-01T10:00:00Z')).toBe('2024-01-01T10:00:00');
    expect(toSqlserverDateTime('2024-01-01 10:00:00')).toBe('2024-01-01 10:00:00'); // 墙钟原样
    expect(toSqlserverDateTime('2024-01-01')).toBe('2024-01-01'); // 纯日期原样
    expect(toSqlserverBind('2024-01-01T10:00:00.000Z', col({ midType: 'datetime' }))).toBe('2024-01-01T10:00:00.000');
    expect(toSqlserverBind('2024-01-01T10:00:00.000Z', col({ midType: 'string' }))).toBe('2024-01-01T10:00:00.000Z');
    expect(toSqlserverBind('2024-01-01T10:00:00.000Z')).toBe('2024-01-01T10:00:00.000Z');
  });
});

/* ---------------- 参数上限边界（硬约束） ---------------- */

describe('sqlserverPerStmt：TDS 2100 参数 × VALUES 1000 行双上限', () => {
  it('按列数切分：5 列 → 420 行/语句（floor(2100/5)）', () => {
    expect(sqlserverPerStmt(5)).toBe(420);
    expect(sqlserverPerStmt(10)).toBe(210);
    expect(sqlserverPerStmt(3)).toBe(700);
  });

  it('列数很少时由 1000 行上限兜住（1 列/2 列）', () => {
    expect(SQLSERVER_MAX_PARAMS).toBe(2100);
    expect(SQLSERVER_MAX_VALUES_ROWS).toBe(1000);
    expect(sqlserverPerStmt(1)).toBe(1000); // floor(2100/1)=2100 但 TVC 上限 1000
    expect(sqlserverPerStmt(2)).toBe(1000); // floor(2100/2)=1050 → 1000
    expect(sqlserverPerStmt(3)).toBe(700); // 700 < 1000，参数上限生效
  });

  it('列数非法/极大值兜底为 1（不得产出 0 行语句）', () => {
    expect(sqlserverPerStmt(0)).toBe(1);
    expect(sqlserverPerStmt(-3)).toBe(1);
    expect(sqlserverPerStmt(9999)).toBe(1);
  });
});

/* ---------------- 读端 ---------------- */

describe('sqlserver 读端（mock pool）', () => {
  it('describe：identity/主键/长度（nvarchar 字节数 ÷2、-1 → text）/precision', async () => {
    const { pool } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    const t = await r.describe('users');
    expect(t.name).toBe('users');
    expect(t.columns.map((c) => c.name)).toEqual(['id', 'name', 'amount', 'note']);
    expect(t.columns[0]).toMatchObject({ midType: 'int', primaryKey: true, autoIncrement: true, nullable: false });
    expect(t.columns[1]).toMatchObject({ midType: 'string', length: 100, nullable: true });
    expect(t.columns[2]).toMatchObject({ midType: 'decimal', precision: 10, scale: 2 });
    expect(t.columns[3]).toMatchObject({ midType: 'text' });
  });

  it('listTables / count：走 INFORMATION_SCHEMA 与 COUNT_BIG，参数绑定 schema', async () => {
    const { pool, recs } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    expect(await r.listTables()).toEqual(['t1', 't2']);
    expect(await r.count('users')).toBe(42);
    expect(recs[0]!.params.schema).toBe('dbo');
    expect(recs[0]!.sql).toContain('TABLE_TYPE');
  });

  it('shardKey：单列主键返回类型；复合主键返回 null', async () => {
    const { pool } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    expect(await r.shardKey('users')).toBe('int');
    const composite: Responder = (sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return metaResponder(sql);
      if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [{ COLUMN_NAME: 'id' }, { COLUMN_NAME: 'name' }] };
      return { recordset: [], rowsAffected: [0] };
    };
    const compositePool = makePool(composite);
    const r2 = await createSqlserverTransferReader(compositePool.pool as never, 'dbo');
    expect(await r2.shardKey('users')).toBeNull();
  });

  it('readBatch keyset：WHERE [key] > @after + ORDER BY + OFFSET 0 FETCH NEXT n ROWS ONLY', async () => {
    const { pool, recs } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'keyset', column: 'id', after: 10 }, 50);
    const dataCall = recs.find((c) => c.sql.startsWith('SELECT [id]') || c.sql.includes('FROM [dbo].[users]'))!;
    expect(dataCall.sql).toContain('WHERE [id] > @after');
    expect(dataCall.sql).toContain('ORDER BY [id]');
    expect(dataCall.sql).toContain('OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY');
    expect(dataCall.params.after).toBe(10);
  });

  it('readBatch offset：ORDER BY (SELECT NULL) + OFFSET n ROWS（T-SQL 无 LIMIT，OFFSET 必须有 ORDER BY）', async () => {
    const { pool, recs } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'offset', offset: 120 }, 50);
    const dataCall = recs.at(-1)!;
    expect(dataCall.sql).toContain('ORDER BY (SELECT NULL)');
    expect(dataCall.sql).toContain('OFFSET 120 ROWS FETCH NEXT 50 ROWS ONLY');
  });

  it('readBatch range：>= lo（含）与 < hi（开）绑定，limit 内联', async () => {
    const { pool, recs } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'range', column: 'id', lo: 1, loInclusive: true, hi: 9 }, 20);
    const dataCall = recs.at(-1)!;
    expect(dataCall.sql).toContain('WHERE [id] >= @p0 AND [id] < @p1');
    expect(dataCall.sql).toContain('FETCH NEXT 20 ROWS ONLY');
    expect(dataCall.params).toMatchObject({ p0: 1, p1: 9 });
  });

  it('decimal 列 SELECT 走 CONVERT(nvarchar)（tedious 把 decimal 解析为 JS number，>15 位丢精度）', async () => {
    const { pool, recs } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'offset', offset: 0 }, 10);
    const dataCall = recs.at(-1)!;
    expect(dataCall.sql).toContain('CONVERT(nvarchar(64), [amount])');
    expect(dataCall.sql).toContain('[id]');
    expect(dataCall.sql).not.toContain('CONVERT(nvarchar(64), [id])');
  });

  it('sql_variant 列显式 CONVERT(nvarchar(max))；UDT（geography）按 bytes 原样二进制读', async () => {
    const udt: Responder = (sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return {
          recordset: [
            { COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: false, IS_IDENTITY: true, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
            { COLUMN_NAME: 'shape', DATA_TYPE: 'geography', IS_NULLABLE: true, IS_IDENTITY: false, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: 0, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
            { COLUMN_NAME: 'v', DATA_TYPE: 'sql_variant', IS_NULLABLE: true, IS_IDENTITY: false, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: 0, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
          ],
        };
      }
      if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [{ COLUMN_NAME: 'id' }] };
      return { recordset: [{ id: 1, shape: Buffer.from([0xe6, 0x10]), v: '42' }] };
    };
    const { pool, recs } = makePool(udt);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    const t = await r.describe('geo');
    expect(t.columns[1]).toMatchObject({ midType: 'bytes', sourceType: 'geography' });
    expect(t.columns[2]).toMatchObject({ midType: 'text', sourceType: 'sql_variant' });
    const rows = await r.readBatch('geo', { mode: 'offset', offset: 0 }, 10);
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('CONVERT(nvarchar(max), [v])'); // sql_variant 显式转文本
    expect(sql).not.toContain('CONVERT(nvarchar(max), [shape])'); // UDT 二进制原样搬运
    expect(rows[0]![1]).toEqual(Buffer.from([0xe6, 0x10]));
  });

  it('datetime2/datetimeoffset/time 读端走 CONVERT(…, 126) 保真（亚毫秒不丢、墙钟不被进程时区解释）', async () => {
    const dt: Responder = (sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return {
          recordset: [
            { COLUMN_NAME: 'd', DATA_TYPE: 'datetime2', IS_NULLABLE: 'NO', IS_IDENTITY: 0, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: null, NUMERIC_SCALE: 7, COLUMN_DEFAULT: null },
            { COLUMN_NAME: 'o', DATA_TYPE: 'datetimeoffset', IS_NULLABLE: 'YES', IS_IDENTITY: 0, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: null, NUMERIC_SCALE: 7, COLUMN_DEFAULT: null },
            { COLUMN_NAME: 't', DATA_TYPE: 'time', IS_NULLABLE: 'YES', IS_IDENTITY: 0, CHARACTER_MAXIMUM_LENGTH: null, NUMERIC_PRECISION: null, NUMERIC_SCALE: 7, COLUMN_DEFAULT: null },
            { COLUMN_NAME: 's', DATA_TYPE: 'nvarchar', IS_NULLABLE: 'YES', IS_IDENTITY: 0, CHARACTER_MAXIMUM_LENGTH: 10, NUMERIC_PRECISION: 0, NUMERIC_SCALE: 0, COLUMN_DEFAULT: null },
          ],
        };
      }
      if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [] };
      return {
        recordset: [{
          d: '2020-01-01T12:00:00.1234567',
          o: '2020-01-01T12:00:00.1234567+08:00',
          t: '12:00:00.1234567',
          s: 'x',
        }],
      };
    };
    const { pool, recs } = makePool(dt);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    const rows = await r.readBatch('t', { mode: 'offset', offset: 0 }, 10);
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('CONVERT(nvarchar(33), [d], 126)');
    expect(sql).toContain('CONVERT(nvarchar(33), [o], 126)');
    expect(sql).toContain('CONVERT(nvarchar(16), [t], 126)');
    expect(sql).not.toContain('CONVERT(nvarchar(33), [s], 126)'); // 普通字符列不加转换
    expect(rows[0]![0]).toBe('2020-01-01T12:00:00.1234567'); // 7 位小数完整保留
    expect(rows[0]![2]).toBe('12:00:00.1234567');
  });

  it('materialize：Date → ISO 字符串，Buffer/boolean 原样，缺失列 → null', async () => {
    const rows: Responder = (sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return metaResponder(sql);
      if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [{ COLUMN_NAME: 'id' }] };
      return { recordset: [{ id: 1, name: new Date('2024-01-01T10:00:00.000Z'), amount: '12.34', note: undefined }] };
    };
    const { pool } = makePool(rows);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    const got = await r.readBatch('users', { mode: 'offset', offset: 0 }, 1);
    expect(got[0]).toEqual([1, '2024-01-01T10:00:00.000Z', '12.34', null]);
  });

  it('limit/offset 非法值内联兜底：0/NaN 不拼进 SQL（OFFSET/FETCH 只接受字面整数）', async () => {
    const { pool, recs } = makePool(metaResponder);
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'offset', offset: Number.NaN }, 0);
    expect(recs.at(-1)!.sql).toContain('OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY');
    await r.readBatch('users', { mode: 'keyset', column: 'id', after: null }, -5);
    expect(recs.at(-1)!.sql).toContain('FETCH NEXT 1 ROWS ONLY');
    await r.keyAt!('users', 'id', -1);
    expect(recs.at(-1)!.sql).toContain('OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY');
    expect(recs.every((c) => !/NaN|OFFSET -\d/.test(c.sql))).toBe(true);
  });

  it('keyAt：OFFSET n FETCH NEXT 1 ROWS ONLY', async () => {
    const { pool, recs } = makePool((sql) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return metaResponder(sql);
      if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [{ COLUMN_NAME: 'id' }] };
      return { recordset: [{ k: 7 }] };
    });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    expect(await r.keyAt!('users', 'id', 7)).toBe(7);
    expect(recs.at(-1)!.sql).toContain('OFFSET 7 ROWS FETCH NEXT 1 ROWS ONLY');
  });
});

/* ---------------- 版本探测与 2008/2008R2 降级 ---------------- */

describe('sqlserver 版本探测与 2008/2008R2 降级（需求：可连各版本）', () => {
  const metaWithPk: Responder = (sql, params) => {
    if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return metaResponder(sql, params);
    if (sql.includes('TABLE_CONSTRAINTS')) return { recordset: [{ COLUMN_NAME: 'id' }] };
    return { recordset: [{ k: 7 }] };
  };

  it('sqlserverMajorFromProps：ProductMajorVersion 优先、ProductVersion 前缀回退、都判不出 → 0', () => {
    expect(sqlserverMajorFromProps(16, null)).toBe(16);
    expect(sqlserverMajorFromProps('11', null)).toBe(11);
    expect(sqlserverMajorFromProps(16, '10.0.1600')).toBe(16); // major 属性优先
    expect(sqlserverMajorFromProps(null, '10.50.1600.1')).toBe(10); // 2008R2
    expect(sqlserverMajorFromProps(null, '9.00.5000')).toBe(9);
    expect(sqlserverMajorFromProps(0, '10.0')).toBe(10); // 0 视为不可用 → 回退
    expect(sqlserverMajorFromProps(null, null)).toBe(0);
    expect(sqlserverMajorFromProps(undefined, '')).toBe(0);
    expect(sqlserverMajorFromProps('abc', 'abc')).toBe(0);
  });

  it('主版本 >= 11：仍是 OFFSET/FETCH（现状不变，边界 11 即 2012）', async () => {
    const { pool, recs } = makePool(metaResponder, { major: 11 });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'keyset', column: 'id', after: 10 }, 50);
    expect(recs.at(-1)!.sql).toContain('OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY');
  });

  it('主版本 < 11：keyset/range 降级为 TOP (n) + ORDER BY，SQL 内不含 OFFSET', async () => {
    const { pool, recs } = makePool(metaResponder, { major: 10 });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'keyset', column: 'id', after: 10 }, 50);
    expect(recs.at(-1)!.sql).toContain('SELECT TOP (50)');
    expect(recs.at(-1)!.sql).toContain('WHERE [id] > @after ORDER BY [id]');
    expect(recs.at(-1)!.sql).not.toContain('OFFSET');
    expect(recs.at(-1)!.params.after).toBe(10);
    await r.readBatch('users', { mode: 'range', column: 'id', lo: 1, loInclusive: true, hi: 9 }, 20);
    expect(recs.at(-1)!.sql).toContain('SELECT TOP (20)');
    expect(recs.at(-1)!.sql).toContain('WHERE [id] >= @p0 AND [id] < @p1');
    expect(recs.at(-1)!.sql).not.toContain('OFFSET');
  });

  it('主版本 < 11：offset 全序降级为 ROW_NUMBER 子查询（按可排序列，不依赖 (SELECT NULL)）', async () => {
    const { pool, recs } = makePool(metaResponder, { major: 10 });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'offset', offset: 120 }, 50);
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY [id], [name], [amount], [note])');
    expect(sql).toContain('WHERE [__dbt_rn] > 120 AND [__dbt_rn] <= 170');
    expect(sql).toContain('CONVERT(nvarchar(64), [amount]) AS [amount]'); // decimal 保真别名
    expect(sql).not.toContain('OFFSET');
    expect(sql).not.toContain('(SELECT NULL)');
  });

  it('主版本 < 11：keyAt 降级为 ROW_NUMBER 按分片键排序定位', async () => {
    const { pool, recs } = makePool(metaWithPk, { major: 10 });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    expect(await r.keyAt!('users', 'id', 7)).toBe(7);
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('SELECT TOP (1) [k] FROM (SELECT [id] AS [k], ROW_NUMBER() OVER (ORDER BY [id])');
    expect(sql).toContain('WHERE [__dbt_rn] = 8');
    expect(sql).not.toContain('OFFSET');
  });

  it('探测失败（两属性都判不出 → 0）：保守走降级，不生成老版本不认的 OFFET/FETCH', async () => {
    const { pool, recs } = makePool(metaResponder, { major: null, productVersion: '' });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'keyset', column: 'id', after: null }, 5);
    expect(recs.at(-1)!.sql).toContain('SELECT TOP (5)');
    expect(recs.at(-1)!.sql).not.toContain('OFFSET');
  });

  it('版本只探测一次：多次 readBatch/keyAt 复用缓存结果', async () => {
    const { pool, counts } = makePool(metaResponder, { major: 10 });
    const r = await createSqlserverTransferReader(pool as never, 'dbo');
    await r.readBatch('users', { mode: 'offset', offset: 0 }, 5);
    await r.readBatch('users', { mode: 'offset', offset: 5 }, 5);
    await r.keyAt!('users', 'id', 1);
    expect(counts.versionCalls).toBe(1);
  });
});

/* ---------------- 写端 ---------------- */

const cols3: TransferColumn[] = [
  col({ name: 'id', midType: 'int', nullable: false, primaryKey: true }),
  col({ name: 'name', midType: 'string', length: 50 }),
  col({ name: 'amount', midType: 'decimal', precision: 10, scale: 2 }),
];

describe('sqlserver 写端（mock pool + mock 事务）', () => {
  it('createTable：T-SQL 类型 + NOT NULL + DEFAULT 白名单 + PRIMARY KEY，标识符 [x]/]]', async () => {
    const { pool, recs, openTx } = makePool();
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await w.createTable({
      name: 'or]der',
      columns: [
        col({ name: 'id', midType: 'int', nullable: false, primaryKey: true }),
        col({ name: 'tag]x', midType: 'string', length: 32, nullable: false, default: "'a'" }),
        col({ name: 'evil', midType: 'string', default: 'NOW()' }), // 非白名单默认值丢弃
        col({ name: 'amt', midType: 'decimal', precision: 12, scale: 4 }),
      ],
    });
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('CREATE TABLE [dbo].[or]]der]');
    expect(sql).toContain('[id] INT NOT NULL');
    expect(sql).toContain("[tag]]x] NVARCHAR(32) NOT NULL DEFAULT 'a'");
    expect(sql).toContain('DECIMAL(12,4)');
    expect(sql).toContain('PRIMARY KEY ([id])');
    expect(sql).not.toContain('NOW()');
  });

  it('writeBatch：多行 VALUES 参数化，参数名 @pN，事务包裹并 commit', async () => {
    const { pool, recs, counts, openTx } = makePool((sql) => {
      if (sql.startsWith('INSERT')) return { rowsAffected: [2] };
      return { recordset: [], rowsAffected: [0] };
    });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    const n = await w.writeBatch({ name: 't', columns: cols3 }, [
      [1, 'a', '1.25'],
      [2, 'b', null],
    ]);
    expect(n).toBe(2);
    expect(counts).toMatchObject({ begin: 1, commit: 1, rollback: 0 });
    const sql = recs.at(-1)!.sql;
    expect(sql).toBe('INSERT INTO [dbo].[t] ([id], [name], [amount]) VALUES (@p0, @p1, @p2), (@p3, @p4, @p5)');
    expect(recs.at(-1)!.params).toMatchObject({ p0: 1, p1: 'a', p2: '1.25', p3: 2, p4: 'b', p5: null });
  });

  it('writeBatch 切分：5 列 421 行 → 420 + 1 两语句，每语句参数 ≤2100', async () => {
    const five: TransferColumn[] = ['a', 'b', 'c', 'd', 'e'].map((n) => col({ name: n }));
    const inserts: Rec[] = [];
    const { pool, openTx, counts } = makePool((sql) => {
      if (sql.startsWith('INSERT')) return { rowsAffected: [0] };
      return { recordset: [], rowsAffected: [0] };
    });
    const recs: Rec[] = [];
    const recordingPool = { ...pool, request: () => makeReq(recs, (sql) => {
      if (sql.startsWith('INSERT')) { inserts.push({ sql, params: {} }); return { rowsAffected: [0] }; }
      return { recordset: [], rowsAffected: [0] };
    }) };
    // 事务上的 request 也要计数：重建 openTx 指向同一 recorder
    const txRecs: Rec[] = [];
    const openTxRec = () => ({
      begin: async () => { counts.begin += 1; },
      commit: async () => { counts.commit += 1; },
      rollback: async () => { counts.rollback += 1; },
      request: () => makeReq(txRecs, (sql) => {
        if (sql.startsWith('INSERT')) { inserts.push({ sql, params: {} }); return { rowsAffected: [0] }; }
        return { recordset: [], rowsAffected: [0] };
      }),
    });
    const w = createSqlserverTransferWriter(recordingPool as never, openTxRec, 'dbo', 'insert');
    const rows = Array.from({ length: 421 }, (_, i) => [i, 'x', null, 1, 'y']);
    await w.writeBatch({ name: 't5', columns: five }, rows);
    expect(inserts.length).toBe(2);
    const paramCount = (sql: string): number => (sql.match(/@p\d+/g) ?? []).length;
    expect(paramCount(inserts[0]!.sql)).toBe(2100);
    expect(paramCount(inserts[1]!.sql)).toBe(5);
    // 全局参数名在每条语句内从 @p0 重新开始（独立 request）
    expect(inserts[0]!.sql).toContain('VALUES (@p0, @p1, @p2, @p3, @p4),');
    expect(inserts[1]!.sql).toBe('INSERT INTO [dbo].[t5] ([a], [b], [c], [d], [e]) VALUES (@p0, @p1, @p2, @p3, @p4)');
    expect(rows.length).toBe(SQLSERVER_MAX_PARAMS / 5 + 1);
  });

  it('writeBatch 行宽不匹配：事务前抛出，不产生语句', async () => {
    const { pool, recs, openTx, counts } = makePool();
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await expect(w.writeBatch({ name: 't', columns: cols3 }, [[1, 'a']])).rejects.toThrow(/行宽不匹配/);
    expect(recs.length).toBe(0);
    expect(counts.begin).toBe(0);
  });

  it('writeBatch 失败：rollback 且错误上抛（单批单事务，失败整批回滚）', async () => {
    const { pool, openTx, counts } = makePool(() => { throw new Error('duplicate key'); });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await expect(w.writeBatch({ name: 't', columns: cols3 }, [[1, 'a', null]])).rejects.toThrow(/duplicate key/);
    expect(counts).toMatchObject({ begin: 1, commit: 0, rollback: 1 });
  });

  it('ignore 模式走 MERGE WHEN NOT MATCHED（T-SQL 无 INSERT IGNORE）', async () => {
    const { pool, recs, openTx } = makePool((sql) => sql.startsWith('MERGE') ? { rowsAffected: [1] } : { recordset: [], rowsAffected: [0] });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'ignore');
    const n = await w.writeBatch({ name: 't', columns: cols3 }, [[1, 'a', null]]);
    expect(n).toBe(1);
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('MERGE INTO [dbo].[t]');
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT ([id], [name], [amount]) VALUES (src.[id], src.[name], src.[amount])');
    expect(sql).not.toContain('WHEN MATCHED');
    expect(sql).toContain('ON tgt.[id] = src.[id]');
  });

  it('replace 模式：MERGE WHEN MATCHED UPDATE 非主键列 + 未匹配 INSERT；无主键抛错', async () => {
    const { pool, recs, openTx } = makePool((sql) => sql.startsWith('MERGE') ? { rowsAffected: [2] } : { recordset: [], rowsAffected: [0] });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'replace');
    expect(await w.writeBatch({ name: 't', columns: cols3 }, [[1, 'a', null]])).toBe(2);
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('WHEN MATCHED THEN UPDATE SET tgt.[name] = src.[name], tgt.[amount] = src.[amount]');
    expect(sql).toContain('WHEN NOT MATCHED THEN INSERT');
    const w2 = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'replace');
    await expect(w2.writeBatch({ name: 't', columns: [col({ name: 'a' })] }, [[1]])).rejects.toThrow(/replace 模式需要主键/);
  });

  it('beforeLoad：SET LOCK_TIMEOUT 15000 → TRUNCATE → 复位默认；拿不到锁降级 DELETE', async () => {
    const ok: Rec[] = [];
    const okTx = () => ({
      begin: async () => undefined, commit: async () => undefined, rollback: async () => undefined,
      request: () => makeReq(ok, () => ({ rowsAffected: [0] })),
    });
    const { pool } = makePool();
    const w = createSqlserverTransferWriter(pool as never, okTx, 'dbo', 'truncate');
    await w.beforeLoad!('t');
    // 成功路径必须复位 -1（会话级设置随连接回池，否则 15s 上限残留给后续请求）
    expect(ok.map((c) => c.sql)).toEqual(['SET LOCK_TIMEOUT 15000', 'TRUNCATE TABLE [dbo].[t]', 'SET LOCK_TIMEOUT -1']);

    const bad: Rec[] = [];
    const badTx = () => ({
      begin: async () => undefined, commit: async () => undefined, rollback: async () => undefined,
      request: () => makeReq(bad, (sql) => {
        if (sql.startsWith('TRUNCATE')) throw new Error('lock request time out');
        return { rowsAffected: [0] };
      }),
    });
    const w2 = createSqlserverTransferWriter(pool as never, badTx, 'dbo', 'truncate');
    await w2.beforeLoad!('t');
    expect(bad.map((c) => c.sql)).toEqual(['SET LOCK_TIMEOUT 15000', 'TRUNCATE TABLE [dbo].[t]', 'DELETE FROM [dbo].[t]', 'SET LOCK_TIMEOUT -1']);
  });

  it('只有锁超时/死锁降级 DELETE；权限(229)/对象不存在(208) 等上抛（带错误号，不静默换语义）', async () => {
    const run = async (err: Error, num?: number): Promise<{ rejected: boolean; sqls: string[] }> => {
      const recs: Rec[] = [];
      const tx = () => ({
        begin: async () => undefined, commit: async () => undefined, rollback: async () => undefined,
        request: () => makeReq(recs, (sql) => {
          if (sql.startsWith('TRUNCATE')) throw num === undefined ? err : Object.assign(err, { number: num });
          return { rowsAffected: [0] };
        }),
      });
      const { pool } = makePool();
      const w = createSqlserverTransferWriter(pool as never, tx, 'dbo', 'truncate');
      try {
        await w.beforeLoad!('t');
        return { rejected: false, sqls: recs.map((c) => c.sql) };
      } catch {
        return { rejected: true, sqls: recs.map((c) => c.sql) };
      }
    };

    // 锁超时类（1222/1221/1205）与锁超时文案 → 降级 DELETE
    expect((await run(new Error('Lock request time out period exceeded.'), 1222)).sqls).toContain('DELETE FROM [dbo].[t]');
    expect((await run(new Error('lock request time out'), 1221)).sqls).toContain('DELETE FROM [dbo].[t]');
    expect((await run(new Error('Transaction was deadlocked'), 1205)).sqls).toContain('DELETE FROM [dbo].[t]');
    expect((await run(new Error('Lock request time out period exceeded.'))).sqls).toContain('DELETE FROM [dbo].[t]'); // 无 number 时按文案

    // 非锁超时 → 上抛，且不执行 DELETE（两种错误对象构造都要走到上抛）
    for (const num of [229, 208]) {
      const out = await run(new Error('denied'), num);
      expect(out.rejected, String(num)).toBe(true);
      expect(out.sqls).not.toContain('DELETE FROM [dbo].[t]');
    }
    // 包装形态：number 在 originalError 上、顶层 message 恰好是锁超时文案 ——
    // 必须以错误号（229）为准上抛，不得被文案兜底误判成可降级
    const wrapped = Object.assign(new Error('Lock request time out period exceeded.'), {
      originalError: Object.assign(new Error('permission denied'), { number: 229 }),
    });
    const ow = await run(wrapped);
    expect(ow.rejected).toBe(true);
    expect(ow.sqls).not.toContain('DELETE FROM [dbo].[t]');
    // 反之：顶层 message 通用、originalError.number=1222（真实驱动包装形态）→ 仍降级
    const wrappedLock = Object.assign(new Error('Request failed'), {
      originalError: Object.assign(new Error('Lock request time out period exceeded.'), { number: 1222 }),
    });
    expect((await run(wrappedLock)).sqls).toContain('DELETE FROM [dbo].[t]');
  });

  it('列数为 0：createTable / writeBatch 抛中文错误，不拼非法 SQL', async () => {
    const { pool, openTx, recs } = makePool();
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await expect(w.createTable({ name: 't', columns: [] })).rejects.toThrow(/无列定义/);
    await expect(w.writeBatch({ name: 't', columns: [] }, [[]])).rejects.toThrow(/无列定义/);
    expect(recs.length).toBe(0);
  });

  it('tableExists / dropTable：INFORMATION_SCHEMA 判定 + DROP TABLE [x]', async () => {
    const { pool, recs, openTx } = makePool((sql) => sql.includes('INFORMATION_SCHEMA.TABLES') ? { recordset: [{ n: 1 }] } : { recordset: [], rowsAffected: [0] });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    expect(await w.tableExists('t')).toBe(true);
    await w.dropTable('t');
    expect(recs.at(-1)!.sql).toBe('DROP TABLE [dbo].[t]');
  });
});

/* ---------------- 定位 ---------------- */

describe('sqlserverLocate（离线）', () => {
  const rcOf = (fields?: Record<string, unknown>) => ({ meta: { id: 'p', kind: 'sqlserver' as const }, ...(fields ? { fields } : {}) });

  it('缺省 schema = 连接 schema ?? dbo；database 覆盖浅拷贝，原 rc 不动', () => {
    expect(sqlserverLocate(rcOf())).toEqual({ rc: rcOf(), schema: 'dbo' });
    const rc = rcOf({ database: 'app', schema: 'sales' });
    expect(sqlserverLocate(rc).schema).toBe('sales');
    expect(sqlserverLocate(rc, { database: 'app' }).rc).toBe(rc);
    const cross = sqlserverLocate(rc, { database: 'other' });
    expect(cross.rc).not.toBe(rc);
    expect(cross.rc.fields).toEqual({ database: 'other', schema: 'sales' });
    expect(rc.fields).toEqual({ database: 'app', schema: 'sales' });
  });

  it('loc.schema 经 assertIdent 校验（空串/换行拒绝）', () => {
    expect(sqlserverLocate(rcOf(), { schema: 'sales' }).schema).toBe('sales');
    expect(() => sqlserverLocate(rcOf(), { schema: '' })).toThrow(/非法模式名/);
    expect(() => sqlserverLocate(rcOf(), { schema: 'a\nb' })).toThrow(/非法模式名/);
  });
});

/* ---------------- model.ts 分派 ---------------- */

describe('model.ts 分派接入 sqlserver', () => {
  it('createTransferReader/Writer 走到 sqlserver 分支（不再抛「暂不支持」）', async () => {
    const { createTransferReader, createTransferWriter } = await import('../../lib/adapters/transfer/model.js');
    rawMock.openSqlserverRaw.mockClear();
    const rc = { meta: { id: 's', kind: 'sqlserver' as const }, fields: { host: 'h', database: 'app' } };
    const r = await createTransferReader(rc);
    expect(r.kind).toBe('sqlserver');
    const w = await createTransferWriter(rc, 'insert');
    expect(w.kind).toBe('sqlserver');
    expect(rawMock.openSqlserverRaw).toHaveBeenCalledTimes(2);
  });
});

describe('sqlserver 结构随迁（IDENTITY / 索引 / 外键）', () => {
  it('createTable：自增列生成 IDENTITY(1,1) NOT NULL（仅整数/大整数控）', async () => {
    const { pool, recs, openTx } = makePool();
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await w.createTable({
      name: 't',
      columns: [
        col({ name: 'id', midType: 'bigint', nullable: false, primaryKey: true, autoIncrement: true }),
        col({ name: 'v', midType: 'string', length: 10 }),
      ],
    });
    const sql = recs.at(-1)!.sql;
    expect(sql).toContain('[id] BIGINT IDENTITY(1,1) NOT NULL');
    expect(sql).toContain('PRIMARY KEY ([id])');
    // 非整数自增（ pathological midType）不生成 IDENTITY
    await w.createTable({
      name: 't2',
      columns: [col({ name: 'id', midType: 'string', nullable: false, primaryKey: true, autoIncrement: true })],
    });
    expect(recs.at(-1)!.sql).not.toContain('IDENTITY');
  });

  it('writeBatch：含自增列时以 SET IDENTITY_INSERT ON/OFF 包裹（同事务、commit 前 OFF）', async () => {
    const { pool, recs, openTx } = makePool((sql) => {
      if (sql.startsWith('INSERT')) return { rowsAffected: [1] };
      return { recordset: [], rowsAffected: [0] };
    });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await w.writeBatch(
      {
        name: 't',
        columns: [
          col({ name: 'id', midType: 'bigint', nullable: false, primaryKey: true, autoIncrement: true }),
          col({ name: 'v', midType: 'string', length: 10 }),
        ],
      },
      [[1, 'a']],
    );
    const sqls = recs.map((r) => r.sql);
    expect(sqls[0]).toBe('SET IDENTITY_INSERT [dbo].[t] ON');
    expect(sqls[sqls.length - 1]).toBe('SET IDENTITY_INSERT [dbo].[t] OFF');
    expect(sqls.some((s) => s.startsWith('INSERT INTO'))).toBe(true);
  });

  it('writeBatch：无自增列不注入 IDENTITY_INSERT', async () => {
    const { pool, recs, openTx } = makePool((sql) => {
      if (sql.startsWith('INSERT')) return { rowsAffected: [1] };
      return { recordset: [], rowsAffected: [0] };
    });
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await w.writeBatch({ name: 't', columns: cols3 }, [[1, 'a', null]]);
    expect(recs.map((r) => r.sql).some((s) => s.includes('IDENTITY_INSERT'))).toBe(false);
  });

  it('createIndex / createForeignKey / listIndexes：官方形态与去重键', async () => {
    const { pool, recs, openTx } = makePool(() => ({ recordset: [], rowsAffected: [0] }));
    const w = createSqlserverTransferWriter(pool as never, openTx, 'dbo', 'insert');
    await w.createIndex!('t', { name: 'idx_t_v', columns: ['v'], unique: true });
    await w.createForeignKey!('t', {
      name: 'fk_t_p',
      columns: ['pid'],
      referencedTable: 'p',
      referencedColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    });
    const sqls = recs.map((r) => r.sql);
    expect(sqls).toContain('CREATE UNIQUE NONCLUSTERED INDEX [idx_t_v] ON [dbo].[t] ([v])');
    expect(
      sqls.some((s) =>
        s.includes('ADD CONSTRAINT [fk_t_p] FOREIGN KEY ([pid]) REFERENCES [dbo].[p] ([id]) ON DELETE CASCADE'),
      ),
    ).toBe(true);
    await w.listIndexes!();
    expect(recs.at(-1)!.sql).toContain('FROM sys.indexes');
  });
});
