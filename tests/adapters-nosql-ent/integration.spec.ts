/**
 * 真机集成冒烟测试（env 门控：不设环境变量时整组 skip）。
 *  - DBT_TEST_REDIS_URL        redis://localhost:6379
 *  - DBT_TEST_MONGO_URL        mongodb://localhost:27017/testdb
 *  - DBT_TEST_ORACLE_CONNECT   oracle://user:pass@host:1521/SERVICE（作为 url 传入）
 *  - DBT_TEST_DM_CONNECT       dm://user:pass@host:5236
 * 只做最小连通与读写语义验证，不造数据破坏。
 */
import { describe, expect, it } from 'vitest';
import { createRedisAdapter } from '../../lib/adapters/redis/index.js';
import { createMongoAdapter } from '../../lib/adapters/mongodb/index.js';
import { createOracleAdapter, openOraclePool } from '../../lib/adapters/oracle/index.js';
import { createDmAdapter, openDmPool } from '../../lib/adapters/dmdb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const REDIS_URL = process.env.DBT_TEST_REDIS_URL;
const MONGO_URL = process.env.DBT_TEST_MONGO_URL;
const ORACLE_URL = process.env.DBT_TEST_ORACLE_CONNECT;
const DM_URL = process.env.DBT_TEST_DM_CONNECT;

function mkConn(kind: ResolvedConnection['meta']['kind'], id: string, url: string): ResolvedConnection {
  return { meta: { id, kind }, url };
}

describe.skipIf(!REDIS_URL)('Redis 真机集成', () => {
  it('testConnect + listDatabases + query GET', async () => {
    const a = await createRedisAdapter(mkConn('redis', 'it-redis', REDIS_URL!));
    try {
      const tc = await a.testConnect();
      expect(tc.ok).toBe(true);
      expect((await a.listDatabases())[0]).toMatch(/^db\d+$/);
      await a.execute('SET dbt_it_key hello');
      const r = await a.query('GET dbt_it_key');
      expect(r.rows[0]![1]).toBe('hello');
      await a.execute('DEL dbt_it_key');
    } finally {
      await a.close();
    }
  });

  it('多实例并存：两个连接同时创建不冲突（无进程级命名注册表）', async () => {
    const a = await createRedisAdapter(mkConn('redis', 'it-redis-a', REDIS_URL!));
    const b = await createRedisAdapter(mkConn('redis', 'it-redis-b', REDIS_URL!));
    try {
      expect((await a.testConnect()).ok).toBe(true);
      expect((await b.testConnect()).ok).toBe(true);
    } finally {
      await b.close().catch(() => {});
      await a.close().catch(() => {});
    }
  });
});

describe.skipIf(!MONGO_URL)('MongoDB 真机集成', () => {
  it('testConnect + listDatabases + find', async () => {
    const a = await createMongoAdapter(mkConn('mongodb', 'it-mongo', MONGO_URL!));
    try {
      const tc = await a.testConnect();
      expect(tc.ok).toBe(true);
      expect((await a.listDatabases()).length).toBeGreaterThan(0);
      const r = await a.query('{"find":"dbt_it_coll","limit":5}');
      expect(r.columns.length).toBeGreaterThan(0);
    } finally {
      await a.close();
    }
  });
  it('空 filter deleteMany 被适配器拦截', async () => {
    const a = await createMongoAdapter(mkConn('mongodb', 'it-mongo2', MONGO_URL!));
    try {
      await expect(a.execute('{"deleteMany":"dbt_it_coll","filter":{}}')).rejects.toThrow('缺少显式 filter');
    } finally {
      await a.close();
    }
  });

  it('多实例并存：两个客户端同时创建不冲突（无进程级命名注册表）', async () => {
    const a = await createMongoAdapter(mkConn('mongodb', 'it-mongo-a', MONGO_URL!));
    const b = await createMongoAdapter(mkConn('mongodb', 'it-mongo-b', MONGO_URL!));
    try {
      expect((await a.testConnect()).ok).toBe(true);
      expect((await b.testConnect()).ok).toBe(true);
    } finally {
      await b.close().catch(() => {});
      await a.close().catch(() => {});
    }
  });
});

describe.skipIf(!ORACLE_URL)('Oracle 真机集成', () => {
  it('testConnect + listTables + query dual', async () => {
    const a = await createOracleAdapter(mkConn('oracle', 'it-ora', ORACLE_URL!));
    try {
      const tc = await a.testConnect();
      expect(tc.ok).toBe(true);
      const r = await a.query('SELECT 1 AS ONE FROM dual');
      expect(r.rows[0]![0]).toBe(1);
      const ts = await a.listTables();
      expect(Array.isArray(ts)).toBe(true);
    } finally {
      await a.close();
    }
  });

  it('多池并存：主连接 + 第二连接 + 传输独立池各自持有唯一别名', async () => {
    const a = await createOracleAdapter(mkConn('oracle', 'it-ora-a', ORACLE_URL!));
    let b: Awaited<ReturnType<typeof createOracleAdapter>> | undefined;
    let p: Awaited<ReturnType<typeof openOraclePool>> | undefined;
    try {
      // 说明：oracledb 不传别名时第二池会退化为匿名池（poolAlias === undefined，不抛错
      // 也无法经 getPool() 检索），并非抛 NJS-046；NJS-046 只在显式重复别名时出现。
      // 本用例验证「多池并存且均可用」，「每池必须显式持有唯一别名」由离线单测锁定。
      b = await createOracleAdapter(mkConn('oracle', 'it-ora-b', ORACLE_URL!));
      p = await openOraclePool(mkConn('oracle', 'it-ora-pool', ORACLE_URL!));
      expect((await b.testConnect()).ok).toBe(true);
    } finally {
      await p?.close().catch(() => {});
      await b?.close().catch(() => {});
      await a.close().catch(() => {});
    }
  });
});

describe.skipIf(!DM_URL)('达梦 DM 真机集成（含数据字典推断路径）', () => {
  it('testConnect + query + listTables/describeTable', async () => {
    const a = await createDmAdapter(mkConn('dmdb', 'it-dm', DM_URL!));
    try {
      const tc = await a.testConnect();
      expect(tc.ok).toBe(true);
      const r = await a.query('SELECT 1 AS ONE');
      expect(r.rows.length).toBe(1);
      const ts = await a.listTables();
      expect(Array.isArray(ts)).toBe(true);
      if (ts.length > 0) {
        const cols = await a.describeTable(ts[0]!.name);
        expect(cols.length).toBeGreaterThan(0);
      }
    } finally {
      await a.close();
    }
  });

  it('多池并存：主连接 + 第二连接 + 传输独立池不报 [20006] 别名冲突', async () => {
    const a = await createDmAdapter(mkConn('dmdb', 'it-dm-a', DM_URL!));
    let b: Awaited<ReturnType<typeof createDmAdapter>> | undefined;
    let p: Awaited<ReturnType<typeof openDmPool>> | undefined;
    try {
      // 驱动池登记表为进程级全局，缺省别名恒为 'default'：修复前此处第二个池即抛 20006
      b = await createDmAdapter(mkConn('dmdb', 'it-dm-b', DM_URL!));
      p = await openDmPool(mkConn('dmdb', 'it-dm-pool', DM_URL!));
      expect((await b.testConnect()).ok).toBe(true);
    } finally {
      await p?.close().catch(() => {});
      await b?.close().catch(() => {});
      await a.close().catch(() => {});
    }
  });
});
