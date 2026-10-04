/**
 * 传输定位（TransferLocator）最小用例：
 *  - pgLocate 纯函数（离线）：schema 校验/缺省、database 跨库浅拷贝仅覆盖 fields.database；
 *  - manager transferStart 透传：全缺省 statement 无定位片段（与现状一致）、带定位
 *    statement 追加片段且 challenge 重放稳定、sqlite 端到端跑通（sqlite 忽略定位走现状路径）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pgLocate } from '../../lib/adapters/transfer/kinds/pg.js';
import { createPgTransferReaderFromConn, createPgTransferWriterFromConn } from '../../lib/adapters/transfer/kinds/pg.js';
import type { PgLikeDriver, PgLikePool } from '../../lib/adapters/sql-shared/pg-like.js';
import { DbToolStore, normalizeProjectKey } from '../../lib/store/index.js';
import { DbToolService } from '../../lib/manager.js';
import { ChallengeStore } from '../../lib/guard/index.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const rcOf = (fields?: Record<string, unknown>): ResolvedConnection => ({
  meta: { id: 'p', kind: 'postgresql' },
  ...(fields ? { fields } : {}),
});

describe('pg 定位解析（pgLocate，离线）', () => {
  it('缺省：schema = 连接 schema ?? public，rc 原样返回', () => {
    const rc = rcOf({ database: 'app', schema: 's1' });
    expect(pgLocate(rc)).toEqual({ rc, schema: 's1' });
    expect(pgLocate(rc, {}).rc).toBe(rc);
    expect(pgLocate(rcOf({ database: 'app' }), {}).schema).toBe('public');
  });

  it('loc.schema 校验后生效；空串拒绝（assertIdent 卫生校验）', () => {
    const rc = rcOf({ database: 'app' });
    expect(pgLocate(rc, { schema: 'other' }).schema).toBe('other');
    expect(() => pgLocate(rc, { schema: '' })).toThrow(/非法模式名/);
    expect(() => pgLocate(rc, { schema: 'a\nb' })).toThrow(/非法模式名/);
  });

  it('database 跨库：浅拷贝 rc 仅覆盖 fields.database（原 rc 不被改）；同库/缺省不改', () => {
    const rc = rcOf({ database: 'app', schema: 's1', user: 'u' });
    expect(pgLocate(rc, { database: 'app' }).rc).toBe(rc);
    const cross = pgLocate(rc, { database: 'other', schema: 'pub' });
    expect(cross.rc).not.toBe(rc);
    expect(cross.rc.fields).toEqual({ database: 'other', schema: 's1', user: 'u' });
    expect(rc.fields).toEqual({ database: 'app', schema: 's1', user: 'u' });
    expect(cross.schema).toBe('pub');
  });

  it('无 fields 连接跨库：fields 补建', () => {
    expect(pgLocate(rcOf(), { database: 'x' }).rc.fields).toEqual({ database: 'x' });
  });
});

/** 传输池记录型驱动：Pool 记录每次建池配置（openPgLikePool 非 export，经 FromConn 构造器验证） */
function poolRecordingDriver() {
  const configs: Record<string, unknown>[] = [];
  const driver: PgLikeDriver = {
    Pool: function (config: Record<string, unknown>) {
      configs.push(config ?? {});
      return {
        on() {
          return this;
        },
        async query() {
          return { rows: [], rowCount: null };
        },
        async connect(): Promise<never> {
          throw new Error('构造期不应取连接');
        },
        async end() {},
      } as unknown as PgLikePool;
    } as unknown as PgLikeDriver['Pool'],
  };
  return { driver, configs };
}

describe('pg 传输池定位接线（openPgLikePool，离线）', () => {
  it('jdbc: URL 剥前缀（与浏览路径同源规范化），无 jdbc: 特判的驱动 parse 会产出垃圾 host/库名', async () => {
    const { driver, configs } = poolRecordingDriver();
    await createPgTransferReaderFromConn('gaussdb', driver, {
      meta: { id: 'x', kind: 'gaussdb' },
      url: 'jdbc:gaussdb://h1:8000/appdb',
    });
    expect(configs[0]!.connectionString).toBe('gaussdb://h1:8000/appdb');
    expect(configs[0]).toMatchObject({ max: 4 });
  });

  it('URL 形态跨库定位：connectionString path 改写为目标库（叠加 database 字段会被驱动里 URL 原库名覆盖）', async () => {
    const { driver, configs } = poolRecordingDriver();
    await createPgTransferReaderFromConn(
      'postgresql',
      driver,
      { meta: { id: 'x', kind: 'postgresql' }, url: 'postgres://u:p@h1:5432/appdb' },
      { database: 'other' },
    );
    expect(configs[0]!.connectionString).toBe('postgres://u:p@h1:5432/other');
    expect(configs[0]!.database).toBeUndefined();
  });

  it('字段形态跨库定位：database 字段覆盖生效', async () => {
    const { driver, configs } = poolRecordingDriver();
    await createPgTransferWriterFromConn(
      'postgresql',
      driver,
      { meta: { id: 'x', kind: 'postgresql' }, fields: { host: 'h', port: 5432, database: 'app' } },
      'insert',
      { database: 'other' },
    );
    expect(configs[0]).toMatchObject({ host: 'h', port: 5432, database: 'other' });
  });

  it('多主机 jdbc: URL：逐台探测选可用台（传输端与浏览端同一前置）', async () => {
    const configs: Record<string, unknown>[] = [];
    const probeConfigs: Record<string, unknown>[] = [];
    const driver: PgLikeDriver = {
      Pool: function (config: Record<string, unknown>) {
        configs.push(config ?? {});
        return {
          on() {
            return this;
          },
          async query() {
            return { rows: [], rowCount: null };
          },
          async connect(): Promise<never> {
            throw new Error('构造期不应取连接');
          },
          async end() {},
        } as unknown as PgLikePool;
      } as unknown as PgLikeDriver['Pool'],
      Client: function (config: Record<string, unknown>) {
        probeConfigs.push(config ?? {});
        // 构造不抛、connect 抛：pickHost 的 try 自 connect 起（FakeProbeClient 同款行为面）
        return {
          connect: async () => {
            throw new Error(`ECONNREFUSED ${String(config.host)}`);
          },
          query: async () => ({ rows: [], rowCount: null }),
          end: async () => {},
        };
      } as unknown as PgLikeDriver['Client'],
    };
    await createPgTransferReaderFromConn('gaussdb', driver, {
      meta: { id: 'x', kind: 'gaussdb' },
      url: 'jdbc:gaussdb://h1:8000,h2:8000/appdb',
    });
    // 全败回退首台重组值（剥 jdbc:），报真实连接错误
    expect(configs[0]!.connectionString).toBe('gaussdb://h1:8000/appdb');
    expect(probeConfigs.map((c) => c.host)).toEqual(['h1', 'h2']);
  });
});

const nodeSqliteAvailable = await import('node:sqlite')
  .then((m) => typeof (m as { DatabaseSync?: unknown }).DatabaseSync === 'function')
  .catch(() => false);
const betterAvailable = (() => {
  try {
    createRequire(import.meta.url).resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!nodeSqliteAvailable && !betterAvailable)('manager transferStart 定位透传（sqlite 端到端）', () => {
  let home = '';
  let dir = '';
  let srcFile = '';
  let service: DbToolService;
  let project = '';

  beforeAll(async () => {
    process.env.DBT_SQLITE_DRIVER = nodeSqliteAvailable ? 'node' : 'better';
    home = makeTempHome();
    dir = mkdtempSync(join(os.tmpdir(), 'dbt-transfer-locate-'));
    srcFile = join(dir, 'src.db');
    const store = new DbToolStore(home);
    store.connections.create({ id: 'tsrc', kind: 'sqlite', fields: { database: srcFile } });
    store.connections.create({ id: 'tdst', kind: 'sqlite', fields: { database: join(dir, 'dst.db') } });
    project = path.join(os.tmpdir(), 'dbt-test-locate-proj');
    store.grants.grant(normalizeProjectKey(project), 'tsrc', 'ro');
    store.grants.grant(normalizeProjectKey(project), 'tdst', 'rw');
    service = new DbToolService(store, { challenges: new ChallengeStore({ sweepIntervalMs: 0 }) });
    const { createSqliteAdapter } = await import('../../lib/adapters/sqlite/index.js');
    const seed = await createSqliteAdapter({ meta: { id: 'seed', kind: 'sqlite' }, fields: { database: srcFile } });
    await seed.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    for (let i = 1; i <= 5; i++) await seed.execute('INSERT INTO t (id, v) VALUES (?, ?)', [i, `v${i}`]);
    // 第二张表：定位用例独立目标表（目标表已存在会让该表失败，两用例共用目标库）
    await seed.execute('CREATE TABLE t2 (id INTEGER PRIMARY KEY, v TEXT)');
    for (let i = 1; i <= 5; i++) await seed.execute('INSERT INTO t2 (id, v) VALUES (?, ?)', [i, `v${i}`]);
    await seed.close();
  });

  afterAll(async () => {
    await service?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (home) cleanupDir(home);
    delete process.env.DBT_SQLITE_DRIVER;
  });

  const startBody = (extra: Partial<Parameters<DbToolService['transferStart']>[1]> = {}): Parameters<DbToolService['transferStart']>[1] => ({
    sourceConnId: 'tsrc',
    targetConnId: 'tdst',
    tables: ['t'],
    writeMode: 'insert',
    batchSize: 10,
    ...extra,
  });

  const untilDone = async (taskId: string) => {
    for (let i = 0; i < 100; i++) {
      const snap = await service.transferProgress(project, taskId);
      if (snap.status !== 'running') return snap;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('传输任务未在限时内终态');
  };

  it('全缺省：statement 无定位片段（与现状一致），challenge 往返后任务跑通', async () => {
    const r1 = await service.transferStart(project, startBody());
    const st = (r1 as unknown as { statement: string }).statement;
    expect(st).not.toContain('源=');
    expect(st).not.toContain('目标=');
    const cid = (r1 as unknown as { challengeId: string }).challengeId;
    const r2 = await service.transferStart(project, startBody(), cid);
    const taskId = (r2 as unknown as { taskId: string }).taskId;
    const snap = await untilDone(taskId);
    expect(snap.status).toBe('done');
    expect(snap.tables[0]?.rows).toBe(5);
  });

  it('带定位：statement 追加片段（trim 非空才收），challenge 重放同值成功；statement 变更绑定拒绝', async () => {
    const body = startBody({ tables: ['t2'], sourceDatabase: ' srcdb ', sourceSchema: ' ', targetDatabase: 'dstdb', targetSchema: 'pub' });
    const r1 = await service.transferStart(project, body);
    const st = (r1 as unknown as { statement: string }).statement;
    // sourceSchema 空白被忽略；定位片段追加在模板尾部
    expect(st.endsWith(' 源=srcdb 目标=dstdb.pub')).toBe(true);
    const cid = (r1 as unknown as { challengeId: string }).challengeId;
    // 同 input 重放：statement 稳定 → challenge 消费成功
    const r2 = await service.transferStart(project, body, cid);
    expect(r2).toHaveProperty('taskId');
    const snap = await untilDone((r2 as unknown as { taskId: string }).taskId);
    expect(snap.status).toBe('done'); // sqlite 忽略定位，现状路径照常
    // 定位属 statement：不同 input 重放同 challengeId → INVALID_CHALLENGE
    const r3 = await service.transferStart(project, startBody({ targetDatabase: 'x' }));
    const cid3 = (r3 as unknown as { challengeId: string }).challengeId;
    await expect(
      service.transferStart(project, startBody({ targetDatabase: 'y' }), cid3),
    ).rejects.toThrow(/确认凭据无效/);
  });
});
