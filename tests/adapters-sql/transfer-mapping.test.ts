/**
 * 数据传输类型映射矩阵离线测试（纯函数，不连服务器）。
 * 覆盖：各库声明类型 → midType 读向映射、midType → 目标列类型写向映射、绑定值转换。
 */
import { describe, expect, it } from 'vitest';
import {
  mysqlTypeToMid,
  midToMysqlType,
  toMysqlBind,
  toMysqlDateTime,
} from '../../lib/adapters/transfer/kinds/mysql.js';
import { pgTypeToMid, midToPgType, toPgBind } from '../../lib/adapters/transfer/kinds/pg.js';
import {
  oraTypeToMid,
  midToOraType,
  toOraBind,
  toOraDateTime,
} from '../../lib/adapters/transfer/kinds/oralike.js';
import { cellToBson, toUtcParse } from '../../lib/adapters/transfer/kinds/mongo.js';
import type { TransferColumn } from '../../lib/adapters/transfer/model.js';

const col = (over: Partial<TransferColumn>): TransferColumn => ({
  name: 'c',
  midType: 'string',
  nullable: true,
  primaryKey: false,
  ...over,
});

describe('mysql 类型映射', () => {
  it('COLUMN_TYPE → midType（读向）', () => {
    expect(mysqlTypeToMid('int')).toBe('int');
    expect(mysqlTypeToMid('int unsigned')).toBe('int');
    expect(mysqlTypeToMid('bigint(20)')).toBe('bigint');
    expect(mysqlTypeToMid('tinyint(1)')).toBe('int');
    expect(mysqlTypeToMid('decimal(10,2)')).toBe('decimal');
    expect(mysqlTypeToMid('double')).toBe('double');
    expect(mysqlTypeToMid('float')).toBe('float');
    expect(mysqlTypeToMid('varchar(255)')).toBe('string');
    expect(mysqlTypeToMid('longtext')).toBe('text');
    expect(mysqlTypeToMid('mediumblob')).toBe('bytes');
    expect(mysqlTypeToMid('json')).toBe('json');
    expect(mysqlTypeToMid('date')).toBe('date');
    expect(mysqlTypeToMid('time')).toBe('time');
    expect(mysqlTypeToMid('datetime')).toBe('datetime');
    expect(mysqlTypeToMid('timestamp')).toBe('timestamptz');
    expect(mysqlTypeToMid('bit(1)')).toBe('bytes');
    expect(mysqlTypeToMid("set('a','b')")).toBe('string');
  });

  it('midType → 目标列类型（写向）', () => {
    expect(midToMysqlType(col({ midType: 'int' }))).toBe('INT');
    expect(midToMysqlType(col({ midType: 'bigint' }))).toBe('BIGINT');
    expect(midToMysqlType(col({ midType: 'decimal', precision: 10, scale: 2 }))).toBe('DECIMAL(10,2)');
    expect(midToMysqlType(col({ midType: 'decimal' }))).toBe('DECIMAL(38,10)');
    expect(midToMysqlType(col({ midType: 'string', length: 100 }))).toBe('VARCHAR(100)');
    expect(midToMysqlType(col({ midType: 'string', length: 99999 }))).toBe('VARCHAR(16383)');
    expect(midToMysqlType(col({ midType: 'timestamptz' }))).toBe('TIMESTAMP');
  });

  it('绑定值转换：bigint→字符串、boolean→0/1、bytes→Buffer', () => {
    expect(toMysqlBind(9007199254740993n)).toBe('9007199254740993');
    expect(toMysqlBind(true)).toBe(1);
    expect(toMysqlBind(false)).toBe(0);
    expect(toMysqlBind(null)).toBeNull();
    expect(toMysqlBind(new Uint8Array([1, 2]))).toEqual(Buffer.from([1, 2]));
    expect(toMysqlBind('x')).toBe('x');
  });

  it('日期列绑定归一：ISO 带 Z → UTC 墙钟（MySQL 不接受 Z 后缀），非日期列/无列参数原样', () => {
    const dt = col({ midType: 'datetime' });
    const tz = col({ midType: 'timestamptz' });
    const d = col({ midType: 'date' });
    const s = col({ midType: 'string' });
    expect(toMysqlDateTime('2024-01-01T10:00:00.000Z')).toBe('2024-01-01 10:00:00');
    expect(toMysqlDateTime('2024-01-01 10:00:00')).toBe('2024-01-01 10:00:00'); // 墙钟原样
    expect(toMysqlDateTime('2024-01-01')).toBe('2024-01-01'); // 纯日期原样
    expect(toMysqlBind('2024-01-01T10:00:00.000Z', dt)).toBe('2024-01-01 10:00:00');
    expect(toMysqlBind('2024-01-01T10:00:00.000Z', tz)).toBe('2024-01-01 10:00:00');
    expect(toMysqlBind('2024-01-01T10:00:00.000Z', d)).toBe('2024-01-01 10:00:00');
    expect(toMysqlBind('2024-01-01T10:00:00.000Z', s)).toBe('2024-01-01T10:00:00.000Z'); // 非日期列不转换
    expect(toMysqlBind('2024-01-01T10:00:00.000Z')).toBe('2024-01-01T10:00:00.000Z'); // 无列参数不转换
  });
});

describe('pg 类型映射', () => {
  it('information_schema data_type → midType（读向）', () => {
    expect(pgTypeToMid('smallint')).toBe('int');
    expect(pgTypeToMid('integer')).toBe('int');
    expect(pgTypeToMid('bigint')).toBe('bigint');
    expect(pgTypeToMid('numeric')).toBe('decimal');
    expect(pgTypeToMid('real')).toBe('float');
    expect(pgTypeToMid('double precision')).toBe('double');
    expect(pgTypeToMid('boolean')).toBe('boolean');
    expect(pgTypeToMid('character varying')).toBe('string');
    expect(pgTypeToMid('text')).toBe('text');
    expect(pgTypeToMid('bytea')).toBe('bytes');
    expect(pgTypeToMid('json')).toBe('json');
    expect(pgTypeToMid('jsonb')).toBe('json');
    expect(pgTypeToMid('date')).toBe('date');
    expect(pgTypeToMid('time without time zone')).toBe('time');
    expect(pgTypeToMid('timestamp without time zone')).toBe('datetime');
    expect(pgTypeToMid('timestamp with time zone')).toBe('timestamptz');
    expect(pgTypeToMid('uuid')).toBe('string');
  });

  it('midType → 目标列类型（写向）', () => {
    expect(midToPgType(col({ midType: 'int' }))).toBe('INTEGER');
    expect(midToPgType(col({ midType: 'bigint' }))).toBe('BIGINT');
    expect(midToPgType(col({ midType: 'decimal', precision: 10, scale: 2 }))).toBe('NUMERIC(10,2)');
    expect(midToPgType(col({ midType: 'double' }))).toBe('DOUBLE PRECISION');
    expect(midToPgType(col({ midType: 'bytes' }))).toBe('BYTEA');
    expect(midToPgType(col({ midType: 'datetime' }))).toBe('TIMESTAMP');
    expect(midToPgType(col({ midType: 'timestamptz' }))).toBe('TIMESTAMPTZ');
  });

  it('绑定值转换：bigint→字符串（pg 不接受 bigint 绑定）', () => {
    expect(toPgBind(123n)).toBe('123');
    expect(toPgBind(true)).toBe(true);
    expect(toPgBind(null)).toBeNull();
  });
});

describe('oracle/dm 类型映射', () => {
  it('DATA_TYPE → midType（读向，NUMBER 按 precision/scale 分档防窄列）', () => {
    expect(oraTypeToMid('NUMBER', 9, 0)).toBe('int');
    expect(oraTypeToMid('NUMBER', 18, 0)).toBe('bigint');
    expect(oraTypeToMid('NUMBER', 38, 0)).toBe('decimal');
    expect(oraTypeToMid('NUMBER', null, null)).toBe('decimal');
    expect(oraTypeToMid('NUMBER', 10, 2)).toBe('decimal');
    expect(oraTypeToMid('VARCHAR2', 100, null)).toBe('string');
    expect(oraTypeToMid('CLOB')).toBe('text');
    expect(oraTypeToMid('BLOB')).toBe('bytes');
    expect(oraTypeToMid('DATE')).toBe('datetime');
    expect(oraTypeToMid('TIMESTAMP')).toBe('datetime');
    expect(oraTypeToMid('TIMESTAMP WITH TIME ZONE')).toBe('timestamptz');
    expect(oraTypeToMid('TIMESTAMP WITH LOCAL TIME ZONE')).toBe('timestamptz');
    expect(oraTypeToMid('RAW')).toBe('bytes');
  });

  it('midType → 目标列类型（写向，oracle 无原生 TIME/BOOLEAN 的降级）', () => {
    expect(midToOraType(col({ midType: 'int' }), false)).toBe('NUMBER(10)');
    expect(midToOraType(col({ midType: 'bigint' }), false)).toBe('NUMBER(19)');
    expect(midToOraType(col({ midType: 'boolean' }), false)).toBe('NUMBER(1)');
    expect(midToOraType(col({ midType: 'boolean' }), true)).toBe('BIT');
    expect(midToOraType(col({ midType: 'time' }), false)).toBe('VARCHAR2(64)');
    expect(midToOraType(col({ midType: 'time' }), true)).toBe('TIME');
    expect(midToOraType(col({ midType: 'timestamptz' }), false)).toBe('TIMESTAMP WITH TIME ZONE');
    expect(midToOraType(col({ midType: 'string', length: 100 }), true)).toBe('VARCHAR2(100)');
  });

  it('绑定值转换：bigint→字符串、boolean→0/1', () => {
    expect(toOraBind(1n)).toBe('1');
    expect(toOraBind(true)).toBe(1);
    expect(toOraBind(null)).toBeNull();
  });

  it('日期列绑定归一：ISO 带 Z → UTC 墙钟（会话 NLS 格式对齐），非日期列原样', () => {
    const dt = col({ midType: 'datetime' });
    const s = col({ midType: 'string' });
    expect(toOraDateTime('2024-01-01T10:00:00.000Z')).toBe('2024-01-01 10:00:00');
    expect(toOraDateTime('2024-01-01 10:00:00')).toBe('2024-01-01 10:00:00');
    expect(toOraBind('2024-01-01T10:00:00.000Z', dt)).toBe('2024-01-01 10:00:00');
    expect(toOraBind('2024-01-01T10:00:00.000Z', s)).toBe('2024-01-01T10:00:00.000Z');
    expect(toOraBind('2024-01-01T10:00:00.000Z')).toBe('2024-01-01T10:00:00.000Z');
  });
});

describe('mongo 值转换', () => {
  // date 分支不触碰 M：以最小 stub 满足类型即可
  const M = {} as unknown as Parameters<typeof cellToBson>[2];

  it('无时区日期串按 UTC 解析（进程本地时区不再参与）', () => {
    expect(toUtcParse('2024-01-01 10:00:00')).toBe('2024-01-01T10:00:00Z');
    expect(toUtcParse('2024-01-01T10:00:00')).toBe('2024-01-01T10:00:00Z');
    expect(toUtcParse('2024-01-01')).toBe('2024-01-01T00:00:00Z');
    expect(toUtcParse('2024-01-01T10:00:00.000Z')).toBe('2024-01-01T10:00:00.000Z'); // 已带时区原样
    expect(toUtcParse('2024-01-01 10:00:00+08:00')).toBe('2024-01-01 10:00:00+08:00');
  });

  it('cellToBson：墙钟串产出同一时刻 Date（UTC 语义），非法值抛错', () => {
    const got = cellToBson('2024-01-01 10:00:00', 'datetime', M) as Date;
    expect(got.toISOString()).toBe('2024-01-01T10:00:00.000Z');
    expect(() => cellToBson('not-a-date', 'datetime', M)).toThrow(/非法日期值/);
  });
});
