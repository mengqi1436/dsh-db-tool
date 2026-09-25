/**
 * Oracle / 达梦 DM 适配器离线单测（mock pool 注入，不真连）。
 * 覆盖：SQL 守卫、DML/DDL 语义、错误转换、标识符校验、元数据查询、ro 模式、dmdb 驱动选项。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createDmAdapter,
  humanizeDmError,
  sanitizeIdentifier as sanitizeDmIdent,
} from '../../lib/adapters/dmdb/index.js';
import {
  createOracleAdapter,
  humanizeOraError,
  ORA_HINTS,
  resolveOracleConn,
  sanitizeIdentifier,
} from '../../lib/adapters/oracle/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const oraConn: ResolvedConnection = {
  meta: { id: 'o1', kind: 'oracle' },
  url: 'oracle://scott:tiger@dbhost:1521/ORCLPDB1',
};
const dmConn: ResolvedConnection = {
  meta: { id: 'd1', kind: 'dmdb' },
  url: 'dm://SYSDBA:SYSDBA@localhost:5236',
};

/**
 * 真实驱动形态：oracledb/dmdb 的 Pool 没有 execute（曾因此出过 pool.execute is not a function
 * 的线上 bug），一切语句必须 pool.getConnection() 后在连接上执行——stub 与该形态对齐：
 * pool 上不挂 execute，若适配器回退为直接 pool.execute 会立即失败（防回归）。
 */
function makeOraPool(rows: Record<string, unknown>[] = [], meta: Array<{ name: string }> = [{ name: 'A' }]) {
  const connObj = {
    execute: vi.fn(async (_sql?: string, _binds?: unknown[], _opts?: unknown) => ({ rows, metaData: meta, rowsAffected: 1 })),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const pool = {
    getConnection: vi.fn(async () => connObj),
    close: vi.fn(async () => undefined),
    connObj,
  };
  return pool;
}

function makeDmPool(rows: Record<string, unknown>[] = [], meta: Array<{ name: string }> = [{ name: 'A' }]) {
  const connObj = {
    execute: vi.fn(async (_sql?: string, _binds?: unknown[], _opts?: unknown) => ({ rows, metaData: meta, rowsAffected: 1 })),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const pool = {
    getConnection: vi.fn(async () => connObj),
    close: vi.fn(async () => undefined),
    connObj,
  };
  return pool;
}

describe('Oracle 纯函数', () => {
  it('resolveOracleConn 解析 URL → connectString', () => {
    const r = resolveOracleConn(oraConn);
    expect(r).toEqual({ user: 'scott', password: 'tiger', connectString: 'dbhost:1521/ORCLPDB1' });
  });
  it('resolveOracleConn 缺少 service 报错', () => {
    expect(() => resolveOracleConn({ meta: { id: 'x', kind: 'oracle' }, url: 'oracle://u:p@h:1521/' })).toThrow('SERVICE_NAME');
  });
  it('sanitizeIdentifier 大写化并校验', () => {
    expect(sanitizeIdentifier('my_table$#1', '表名')).toBe('MY_TABLE$#1');
    expect(() => sanitizeIdentifier('1abc', '表名')).toThrow('非法 Oracle');
    expect(() => sanitizeIdentifier('a-b', '表名')).toThrow('非法 Oracle');
    expect(() => sanitizeIdentifier('', '表名')).toThrow('非法 Oracle');
  });
  it('humanizeOraError 转中文提示', () => {
    expect(humanizeOraError(new Error('ORA-01017: invalid username/password')).message).toContain('用户名或密码错误');
    expect(humanizeOraError(new Error('ORA-12154: TNS:could not resolve')).message).toContain('服务名');
    expect(humanizeOraError(new Error('ORA-28040: no matching authentication protocol')).message).toContain('密码验证器');
  });
  it('ORA_HINTS 覆盖 12 条', () => {
    expect(ORA_HINTS.length).toBeGreaterThanOrEqual(12);
  });
});

describe('Oracle query/execute（mock pool）', () => {
  it('query 非 SELECT 拒绝', async () => {
    const a = await createOracleAdapter(oraConn, { pool: makeOraPool() });
    await expect(a.query('DELETE FROM t')).rejects.toThrow('仅允许 SELECT/WITH');
  });
  it('query 规范化：Date → ISO、列名取 metaData', async () => {
    const pool = makeOraPool(
      [{ A: new Date('2024-03-04T05:06:07.000Z'), B: null, C: 3.14 }],
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    );
    const a = await createOracleAdapter(oraConn, { pool });
    const r = await a.query('SELECT * FROM t');
    expect(r.columns).toEqual(['A', 'B', 'C']);
    expect(r.rows[0]).toEqual(['2024-03-04T05:06:07.000Z', null, 3.14]);
  });
  it('execute 断言 autoCommit:true，DML 报告影响行数', async () => {
    const pool = makeOraPool();
    const a = await createOracleAdapter(oraConn, { pool });
    const r = await a.execute('UPDATE t SET x = :1', [1]);
    const opts = pool.connObj.execute.mock.calls[0]![2] as { autoCommit?: boolean };
    expect(opts.autoCommit).toBe(true);
    expect(r.affectedRows).toBe(1);
  });
  it('DDL 返回 message 附注隐式提交', async () => {
    const a = await createOracleAdapter(oraConn, { pool: makeOraPool() });
    const r = await a.execute('CREATE TABLE t (id NUMBER)');
    expect(r.message).toContain('DDL 已隐式提交，不可回滚');
  });
  it('query 传 maxRows=501（用于截断判定）', async () => {
    const pool = makeOraPool();
    const a = await createOracleAdapter(oraConn, { pool });
    await a.query('SELECT 1 FROM dual');
    const opts = pool.connObj.execute.mock.calls[0]![2] as { maxRows?: number };
    expect(opts.maxRows).toBe(501);
  });
  it('query 显式 autoCommit:true（SELECT 立即结束隐式事务，避免事务悬挂）', async () => {
    const pool = makeOraPool();
    const a = await createOracleAdapter(oraConn, { pool });
    await a.query('SELECT 1 FROM dual');
    const opts = pool.connObj.execute.mock.calls[0]![2] as { autoCommit?: boolean };
    expect(opts.autoCommit).toBe(true);
  });
  it('连接借用后归还（getConnection → 语句执行 → conn.close）', async () => {
    const pool = makeOraPool([{ A: 1 }], [{ name: 'A' }]);
    const a = await createOracleAdapter(oraConn, { pool });
    await a.query('SELECT 1 FROM dual');
    expect(pool.connObj.close).toHaveBeenCalled();
  });
  it('tx 事务内 execute 显式 autoCommit:false（由 commit/rollback 收口）', async () => {
    const pool = makeOraPool();
    const a = await createOracleAdapter(oraConn, { pool });
    const withTx = a as typeof a & { tx: (fn: (exec: (sql: string, binds?: unknown[]) => Promise<unknown>) => Promise<unknown>) => Promise<unknown> };
    await withTx.tx(async (exec) => exec('UPDATE t SET x = 1'));
    const connObj = await pool.getConnection.mock.results[0]!.value;
    // calls[0] 是 SET TRANSACTION READ WRITE（无 opts）；取带 opts 的业务语句调用
    const calls = connObj.execute.mock.calls as Array<[string, unknown[]?, { autoCommit?: boolean }?]>;
    const stmtCall = calls.find((c) => c[2] !== undefined);
    expect(stmtCall![2]!.autoCommit).toBe(false);
  });
  it('ro 模式拒绝 execute（错误信息含「连接为只读(ro)模式」）', async () => {
    const a = await createOracleAdapter(oraConn, { mode: 'ro', pool: makeOraPool() });
    await expect(a.execute('DELETE FROM t')).rejects.toThrow('连接为只读(ro)模式');
  });
  it('ro 模式仍允许 query', async () => {
    const a = await createOracleAdapter(oraConn, { mode: 'ro', pool: makeOraPool([{ A: 1 }]) });
    const r = await a.query('SELECT 1 FROM dual');
    expect(r.rowCount).toBe(1);
  });
});

describe('Oracle 元数据（mock pool）', () => {
  it('testConnect 返回 banner', async () => {
    const a = await createOracleAdapter(oraConn, { pool: makeOraPool([{ BANNER: 'Oracle Database 19c' }], [{ name: 'BANNER' }]) });
    const r = await a.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toBe('Oracle Database 19c');
  });
  it('listDatabases 列 all_tables 有表 schema，空/失败回退当前用户', async () => {
    const pool = makeOraPool([{ OWNER: 'SCOTT' }, { OWNER: 'HR' }], [{ name: 'OWNER' }]);
    const a = await createOracleAdapter(oraConn, { pool });
    expect(await a.listDatabases()).toEqual(['SCOTT', 'HR']);
    expect(pool.connObj.execute.mock.calls[0]![0] as string).toContain('all_tables');

    const empty = await createOracleAdapter(oraConn, { pool: makeOraPool([], []) });
    expect(await empty.listDatabases()).toEqual(['SCOTT']);

    const broken = makeOraPool();
    broken.connObj.execute.mockRejectedValue(new Error('network down'));
    const b = await createOracleAdapter(oraConn, { pool: broken });
    expect(await b.listDatabases()).toEqual(['SCOTT']);
  });
  it('listTables 查 all_tables，owner 默认大写用户', async () => {
    const pool = makeOraPool([{ TABLE_NAME: 'EMP' }], [{ name: 'TABLE_NAME' }]);
    const a = await createOracleAdapter(oraConn, { pool });
    const ts = await a.listTables();
    expect(pool.connObj.execute.mock.calls[0]![0] as string).toContain('all_tables');
    expect(pool.connObj.execute.mock.calls[0]![1]).toEqual(['SCOTT']);
    expect(ts).toEqual([{ name: 'EMP', type: 'TABLE' }]);
  });
  it('describeTable 组合类型串与主键 PRI', async () => {
    const pool = makeOraPool();
    let call = 0;
    pool.connObj.execute.mockImplementation(async () => {
      call++;
      if (call === 1) {
        return {
          rows: [
            { COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', DATA_LENGTH: 22, DATA_PRECISION: 10, DATA_SCALE: 0, NULLABLE: 'N', DATA_DEFAULT: null },
            { COLUMN_NAME: 'NAME', DATA_TYPE: 'VARCHAR2', DATA_LENGTH: 100, DATA_PRECISION: null, DATA_SCALE: null, NULLABLE: 'Y', DATA_DEFAULT: "'x'" },
          ],
          metaData: [],
          rowsAffected: 0,
        };
      }
      return { rows: [{ COLUMN_NAME: 'ID' }], metaData: [], rowsAffected: 0 };
    });
    const a = await createOracleAdapter(oraConn, { pool });
    const cols = await a.describeTable('emp');
    expect(cols[0]).toEqual({ name: 'ID', dataType: 'NUMBER(10)', nullable: false, key: 'PRI', default: null });
    expect(cols[1]!.dataType).toBe('VARCHAR2(100)');
    expect(cols[1]!.default).toBe("'x'");
  });
  it('previewRows 用 FETCH NEXT 分页、offset/limit 均 bind 透传', async () => {
    const pool = makeOraPool([{ A: 1 }], [{ name: 'A' }]);
    const a = await createOracleAdapter(oraConn, { pool });
    const r = await a.previewRows('emp', 9999);
    expect(pool.connObj.execute.mock.calls[0]![0] as string).toContain('OFFSET :o ROWS FETCH NEXT :n ROWS ONLY');
    expect(pool.connObj.execute.mock.calls[0]![1]).toEqual([0, 500]);
    expect(r.rows).toEqual([[1]]);
    await a.previewRows('emp', 10, undefined, 20);
    expect(pool.connObj.execute.mock.calls[1]![0] as string).toContain('OFFSET :o ROWS FETCH NEXT :n ROWS ONLY');
    expect(pool.connObj.execute.mock.calls[1]![1]).toEqual([20, 10]);
  });
});

describe('达梦 DM（mock pool）', () => {
  it('kind 为 dmdb（契约 DbKind）', async () => {
    const a = await createDmAdapter(dmConn, { pool: makeDmPool() });
    expect(a.kind).toBe('dmdb');
  });
  it('execute 显式 maxRows=501 且 autoCommit:true', async () => {
    const pool = makeDmPool();
    const a = await createDmAdapter(dmConn, { pool });
    await a.execute('INSERT INTO t VALUES (:1)', [9]);
    const opts = pool.connObj.execute.mock.calls[0]![2] as { maxRows?: number; autoCommit?: boolean };
    expect(opts.maxRows).toBe(501);
    expect(opts.autoCommit).toBe(true);
  });
  it('query 非 SELECT 拒绝', async () => {
    const a = await createDmAdapter(dmConn, { pool: makeDmPool() });
    await expect(a.query('DROP TABLE t')).rejects.toThrow('仅允许 SELECT/WITH');
  });
  it('query 显式 autoCommit:true 且 maxRows=501（SELECT 立即结束隐式事务，避免事务悬挂）', async () => {
    const pool = makeDmPool();
    const a = await createDmAdapter(dmConn, { pool });
    await a.query('SELECT 1 FROM dual');
    const opts = pool.connObj.execute.mock.calls[0]![2] as { maxRows?: number; autoCommit?: boolean };
    expect(opts.maxRows).toBe(501);
    expect(opts.autoCommit).toBe(true);
  });
  it('连接借用后归还（getConnection → 语句执行 → conn.close）', async () => {
    const pool = makeDmPool([{ A: 1 }], [{ name: 'A' }]);
    const a = await createDmAdapter(dmConn, { pool });
    await a.query('SELECT 1 FROM dual');
    expect(pool.connObj.close).toHaveBeenCalled();
  });
  it('tx 事务内 execute 显式 autoCommit:false', async () => {
    const pool = makeDmPool();
    const a = await createDmAdapter(dmConn, { pool });
    const withTx = a as typeof a & { tx: (fn: (exec: (sql: string, binds?: unknown[]) => Promise<unknown>) => Promise<unknown>) => Promise<unknown> };
    await withTx.tx(async (exec) => exec('INSERT INTO t VALUES (1)'));
    const connObj = await pool.getConnection.mock.results[0]!.value;
    const opts = connObj.execute.mock.calls[0]![2] as { autoCommit?: boolean };
    expect(opts.autoCommit).toBe(false);
    expect(connObj.commit).toHaveBeenCalled();
  });
  it('DDL 附注隐式提交（推断标注）', async () => {
    const a = await createDmAdapter(dmConn, { pool: makeDmPool() });
    const r = await a.execute('TRUNCATE TABLE t');
    expect(r.message).toContain('DDL 已隐式提交，不可回滚');
  });
  it('previewRows 统一 ANSI 分页，OFFSET/FETCH bind 透传（offset 用例）', async () => {
    const pool = makeDmPool([{ A: 1 }], [{ name: 'A' }]);
    const a = await createDmAdapter(dmConn, { pool });
    await a.previewRows('t', 10);
    expect(pool.connObj.execute.mock.calls[0]![0] as string).toContain('OFFSET :o ROWS FETCH FIRST :n ROWS ONLY');
    expect(pool.connObj.execute.mock.calls[0]![1]).toEqual([0, 10]);
    await a.previewRows('t', 5, undefined, 15);
    expect(pool.connObj.execute.mock.calls[1]![1]).toEqual([15, 5]);
  });
  it('listTables 复用 ALL_TABLES 数据字典', async () => {
    const pool = makeDmPool([{ TABLE_NAME: 'T1' }], [{ name: 'TABLE_NAME' }]);
    const a = await createDmAdapter(dmConn, { pool });
    const ts = await a.listTables();
    expect(pool.connObj.execute.mock.calls[0]![0] as string).toContain('ALL_TABLES');
    expect(ts).toEqual([{ name: 'T1', type: 'TABLE' }]);
  });
  it('listDatabases 列 ALL_TABLES 有表 schema（非 host 占位），空/失败回退当前用户', async () => {
    const pool = makeDmPool([{ OWNER: 'SYSDBA' }, { OWNER: 'APP' }], [{ name: 'OWNER' }]);
    const a = await createDmAdapter(dmConn, { pool });
    expect(await a.listDatabases()).toEqual(['SYSDBA', 'APP']);
    expect(pool.connObj.execute.mock.calls[0]![0] as string).toContain('ALL_TABLES');

    const empty = await createDmAdapter(dmConn, { pool: makeDmPool([], []) });
    expect(await empty.listDatabases()).toEqual(['SYSDBA']);

    const broken = makeDmPool();
    broken.connObj.execute.mockRejectedValue(new Error('network down'));
    const b = await createDmAdapter(dmConn, { pool: broken });
    expect(await b.listDatabases()).toEqual(['SYSDBA']);
  });
  it('ro 模式拒绝 execute（错误信息含「连接为只读(ro)模式」）', async () => {
    const a = await createDmAdapter(dmConn, { mode: 'ro', pool: makeDmPool() });
    await expect(a.execute('DELETE FROM t')).rejects.toThrow('连接为只读(ro)模式');
  });
  it('humanizeDmError 通用包装', () => {
    expect(humanizeDmError(new Error('网络异常')).message).toContain('达梦 DM 错误');
  });
  it('sanitizeDmIdent 校验非法标识符', () => {
    expect(sanitizeDmIdent('t1', '表名')).toBe('t1');
    expect(() => sanitizeDmIdent('1t', '表名')).toThrow('非法 DM');
  });
});
