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
import { createOracleAdapter } from '../../lib/adapters/oracle/index.js';
import { createDmAdapter } from '../../lib/adapters/dmdb/index.js';
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
});
