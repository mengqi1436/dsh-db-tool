/**
 * Oracle/DM 传输读写端离线测试（mock pool，不真连）。
 * 覆盖（驱动 API 误用修复回归）：
 *  - 会话前置语句按 kind 分流：DM 用官方 SET TIME ZONE 且不下发 NLS_NUMERIC_CHARACTERS
 *    （DM8 SQL 手册 3.14 可设清单不含该参数）；Oracle 保留 ALTER SESSION 官方语法。
 *  - readBatch/keyAt 分页 OFFSET/FETCH 内联 clamp 整数（ROW_LIMIT 语法图为字面
 *    <整数>，绑定占位符无官方佐证），WHERE 值绑定保留。
 *  - Lob materialize 后防御性 close（dmdb 官方未覆盖 close 必要性，存在即调用）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createOraLikeTransferReader,
  oralikeSessionStmts,
} from '../../lib/adapters/transfer/kinds/oralike.js';
import type { OraLikeConn, OraLikePool } from '../../lib/adapters/transfer/kinds/oralike.js';

function makePool(dataRows: Record<string, unknown>[] = [], meta: Array<{ name: string }> = [{ name: 'C1' }]): OraLikePool & {
  connObj: OraLikeConn & { execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
} {
  // describe 查 ALL_TAB_COLUMNS（COLUMN_NAME 风格元数据行），其余语句回数据行
  const colsRows = [{
    COLUMN_NAME: 'C1', DATA_TYPE: 'VARCHAR2', DATA_PRECISION: null, DATA_SCALE: null,
    CHAR_LENGTH: 10, NULLABLE: 'Y', DATA_DEFAULT: null,
  }];
  const connObj = {
    execute: vi.fn(async (sql?: string) => {
      if (typeof sql === 'string' && sql.includes('ALL_TAB_COLUMNS')) {
        return { rows: colsRows, metaData: [], rowsAffected: 0 };
      }
      return { rows: dataRows, metaData: meta, rowsAffected: 0 };
    }),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as OraLikeConn & { execute: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  return {
    getConnection: vi.fn(async () => connObj),
    close: vi.fn(async () => undefined),
    connObj,
  } as never;
}

describe('oralikeSessionStmts 按 kind 分流（官方语法）', () => {
  it('DM：时区用 SET TIME ZONE，不下发 NLS_NUMERIC_CHARACTERS（DM8 SQL 手册 3.14 清单不含）', () => {
    const stmts = oralikeSessionStmts('dmdb');
    expect(stmts).toContain("SET TIME ZONE '+00:00'");
    expect(stmts.some((s) => s.includes('TIME_ZONE') && s.startsWith('ALTER'))).toBe(false);
    expect(stmts.some((s) => s.includes('NLS_NUMERIC_CHARACTERS'))).toBe(false);
    expect(stmts.some((s) => s.includes("NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'"))).toBe(true);
  });
  it('Oracle：保留 ALTER SESSION SET TIME_ZONE 与 NLS_NUMERIC_CHARACTERS（官方语法）', () => {
    const stmts = oralikeSessionStmts('oracle');
    expect(stmts).toContain("ALTER SESSION SET TIME_ZONE = '+00:00'");
    expect(stmts).toContain("ALTER SESSION SET NLS_NUMERIC_CHARACTERS = '. '");
    expect(stmts.some((s) => s.startsWith("SET TIME ZONE"))).toBe(false);
  });
});

describe('oralike 读端 readBatch/keyAt 分页（内联 clamp 整数）', () => {
  it('offset 分页：SQL 内联整数，无 :o/:n 占位符，binds 为空', async () => {
    const pool = makePool([{ C1: 'v' }], [{ name: 'C1' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    await r.readBatch('T', { mode: 'offset', offset: 120 }, 50);
    const sql = pool.connObj.execute.mock.calls.at(-1)![0] as string;
    expect(sql).toContain('OFFSET 120 ROWS FETCH FIRST 50 ROWS ONLY');
    expect(sql).not.toContain(':o');
    expect(sql).not.toContain(':n');
    expect(pool.connObj.execute.mock.calls.at(-1)![1]).toEqual([]);
  });
  it('keyset 分页：仅 WHERE 值绑定保留（:after），FETCH FIRST 内联', async () => {
    const pool = makePool([{ C1: 'v' }], [{ name: 'C1' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    await r.readBatch('T', { mode: 'keyset', column: 'C1', after: 'k1' }, 50);
    const call = pool.connObj.execute.mock.calls.at(-1)!;
    expect(call[0] as string).toContain('WHERE "C1" > :after');
    expect(call[0] as string).toContain('FETCH FIRST 50 ROWS ONLY');
    expect(call[1]).toEqual(['k1']);
  });
  it('limit 非法值 clamp ≥1（防内联出 0/负数破坏语法）', async () => {
    const pool = makePool([{ C1: 'v' }], [{ name: 'C1' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    await r.readBatch('T', { mode: 'offset', offset: 0 }, 0);
    expect(pool.connObj.execute.mock.calls.at(-1)![0] as string).toContain('FETCH FIRST 1 ROWS ONLY');
  });
  it('keyAt：offset 内联整数', async () => {
    const pool = makePool([{ K: 'k9' }], [{ name: 'K' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    const k = await r.keyAt!('T', 'C1', 7);
    expect(pool.connObj.execute.mock.calls.at(-1)![0] as string).toContain('OFFSET 7 ROWS FETCH FIRST 1 ROWS ONLY');
    expect(k).toBe('k9');
  });
  it('会话前置：DM 连接首用下发 SET TIME ZONE（吞错不影响主路径）', async () => {
    const pool = makePool([{ C1: 'v' }], [{ name: 'C1' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    await r.listTables();
    const stmts = pool.connObj.execute.mock.calls.slice(0, 3).map((c) => c[0] as string);
    expect(stmts[0]).toBe("SET TIME ZONE '+00:00'");
  });
});

describe('oralike materialize：Lob getData 后防御性 close', () => {
  it('getData 存在的行值 → 拉全量并调用 close（存在即调用，失败忽略）', async () => {
    const close = vi.fn(async () => undefined);
    const lob = { getData: vi.fn(async () => '大文本'), close };
    const pool = makePool([{ C1: lob }], [{ name: 'C1' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    const rows = await r.readBatch('T', { mode: 'offset', offset: 0 }, 10);
    expect(lob.getData.mock.calls.length).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(rows[0]![0]).toBe('大文本');
  });
  it('close 抛错不阻断读批（释放失败忽略）', async () => {
    const lob = { getData: vi.fn(async () => '数据'), close: vi.fn(async () => { throw new Error('already closed'); }) };
    const pool = makePool([{ C1: lob }], [{ name: 'C1' }]);
    const r = await createOraLikeTransferReader('dmdb', pool, 'SYSDBA');
    const rows = await r.readBatch('T', { mode: 'offset', offset: 0 }, 10);
    expect(rows[0]![0]).toBe('数据');
  });
});
