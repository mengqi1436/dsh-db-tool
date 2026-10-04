/**
 * 数据传输路由测试（真 sqlite 双连接，端到端走 HTTP）：
 * start 危险确认往返（NEEDS_CONFIRMATION → challengeId 重发）、进度轮询、
 * 同目标并发拒绝（注入假 running 任务，确定性）、取消与未知任务 NOT_FOUND。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DbToolHttpServer } from '../../lib/http/index.js';
import { DbToolStore, normalizeProjectKey } from '../../lib/store/index.js';
import { DbToolService } from '../../lib/manager.js';
import { ChallengeStore } from '../../lib/guard/index.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';

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
const anySqlite = nodeSqliteAvailable || betterAvailable;

let home = '';
let dir = '';
let srcFile = '';
let dstFile = '';
let store: DbToolStore;
let service: DbToolService;
let server: DbToolHttpServer;
let base = '';
let projectA = '';
let projectB = '';

async function get(pathname: string): Promise<any> {
  const res = await fetch(base + pathname);
  return res.json();
}

const pj = (p: string): string => `project=${encodeURIComponent(p)}`;

async function post(pathname: string, body: unknown): Promise<any> {
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const startBody = () => ({
  projectPath: projectA,
  sourceConnId: 'tsrc',
  targetConnId: 'tdst',
  tables: ['t'],
  writeMode: 'insert' as const,
  batchSize: 10,
});

describe.skipIf(!anySqlite)('transfer 路由（sqlite 端到端）', () => {
  beforeAll(async () => {
    process.env.DBT_SQLITE_DRIVER = nodeSqliteAvailable ? 'node' : 'better';
    home = makeTempHome();
    dir = mkdtempSync(join(os.tmpdir(), 'dbt-transfer-http-'));
    srcFile = join(dir, 'src.db');
    dstFile = join(dir, 'dst.db');
    store = new DbToolStore(home);
    store.connections.create({ id: 'tsrc', kind: 'sqlite', fields: { database: srcFile } });
    store.connections.create({ id: 'tdst', kind: 'sqlite', fields: { database: dstFile } });
    projectA = path.join(os.tmpdir(), 'dbt-test-transfer-proj');
    projectB = path.join(os.tmpdir(), 'dbt-test-transfer-proj-b'); // 从未授权的项目
    store.grants.grant(normalizeProjectKey(projectA), 'tsrc', 'ro');
    store.grants.grant(normalizeProjectKey(projectA), 'tdst', 'rw');
    service = new DbToolService(store, { challenges: new ChallengeStore({ sweepIntervalMs: 0 }) });
    server = new DbToolHttpServer(service);
    const addr = await server.start();
    base = addr.url;

    // 源库造数（真适配器直接建）：小表走确认往返；大表供传输内容
    const { createSqliteAdapter } = await import('../../lib/adapters/sqlite/index.js');
    const seed = await createSqliteAdapter({ meta: { id: 'seed', kind: 'sqlite' }, fields: { database: srcFile } });
    await seed.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    for (let i = 1; i <= 30; i++) await seed.execute('INSERT INTO t (id, v) VALUES (?, ?)', [i, `v${i}`]);
    await seed.execute('CREATE TABLE big2 (id INTEGER PRIMARY KEY)');
    await seed.execute('BEGIN');
    for (let i = 1; i <= 5000; i++) await seed.execute('INSERT INTO big2 (id) VALUES (?)', [i]);
    await seed.execute('COMMIT');
    await seed.close();
  });

  afterAll(async () => {
    await server?.stop();
    await service?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (home) cleanupDir(home);
    delete process.env.DBT_SQLITE_DRIVER;
  });

  it('start 定位直通：body 四定位字段经 optStr 进 manager（statement 追加片段），challenge 往返后任务跑通', async () => {
    // 独立源表（既有用例已把 t/big2 建到目标库，目标表已存在会让该表失败）
    const { createSqliteAdapter } = await import('../../lib/adapters/sqlite/index.js');
    const seed = await createSqliteAdapter({ meta: { id: 'seed-loc', kind: 'sqlite' }, fields: { database: srcFile } });
    await seed.execute('CREATE TABLE t_http_loc (id INTEGER PRIMARY KEY, v TEXT)');
    await seed.execute("INSERT INTO t_http_loc VALUES (1, 'a')");
    await seed.close();

    const body = { ...startBody(), tables: ['t_http_loc'], sourceDatabase: 'srcdb', targetDatabase: ' dstdb ', targetSchema: 'pub' };
    const r1 = await post('/api/transfer/start', body);
    expect(r1).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION', danger: 'danger' });
    // optStr 直通非空即收（manager 侧 trim）：' dstdb ' 收为 dstdb，定位进 statement
    expect(String(r1.statement)).toContain(' 源=srcdb 目标=dstdb.pub');

    const r2 = await post('/api/transfer/start', { ...body, challengeId: r1.challengeId });
    expect(r2).toMatchObject({ ok: true });
    const taskId = r2.data.taskId as string;
    let snap: any = null;
    for (let i = 0; i < 50; i++) {
      const res = await get(`/api/transfer/${taskId}?${pj(projectA)}`);
      expect(res.ok).toBe(true);
      snap = res.data;
      if (snap.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snap?.status).toBe('done');
    expect(snap.tables.find((t: { name: string }) => t.name === 't_http_loc')?.rows).toBe(1);
  }, 30000);

  it('start 无确认 → NEEDS_CONFIRMATION；带 challengeId → taskId；进度轮询到 done', async () => {
    const r1 = await post('/api/transfer/start', startBody());
    expect(r1).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION', danger: 'danger' });
    expect(typeof r1.challengeId).toBe('string');

    const r2 = await post('/api/transfer/start', { ...startBody(), challengeId: r1.challengeId });
    expect(r2).toMatchObject({ ok: true });
    const taskId = r2.data.taskId as string;

    // 轮询到终态（小表通常一跳即 done）
    let snap: any = null;
    for (let i = 0; i < 50; i++) {
      const res = await get(`/api/transfer/${taskId}?${pj(projectA)}`);
      expect(res.ok).toBe(true);
      snap = res.data;
      if (snap.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snap?.status).toBe('done');
    const big = snap.tables.find((t: { name: string }) => t.name === 't');
    expect(big?.rows).toBe(30);
    // 终态快照保留一个轮询窗口（60s TTL 后定时清理，下次 start 时 sweep 兜底）可查
    const r4 = await get(`/api/transfer/${taskId}?${pj(projectA)}`);
    expect(r4).toMatchObject({ ok: true, data: { status: 'done' } });
    // 终态已持久化到本机历史（JSONL），任何时候可查阅
    const h = await get(`/api/transfer-history?limit=30&${pj(projectA)}`);
    expect(h).toMatchObject({ ok: true });
    const rec = h.data.find((x: { taskId: string }) => x.taskId === taskId);
    expect(rec?.status).toBe('done');
    expect(rec?.statement).toContain('数据传输');
    expect(fs.existsSync((service.store as { transferLog: { file: string } }).transferLog.file)).toBe(true);
  }, 30000);

  it('同目标并发第二个 start → INVALID_ARGUMENT（注入假 running 任务，确定性）；取消与未知任务 NOT_FOUND', async () => {
    // HTTP start 链路（challenge 往返）→ taskId
    const body = { ...startBody(), tables: ['big2'], batchSize: 100 };
    const r1 = await post('/api/transfer/start', body);
    const r2 = await post('/api/transfer/start', { ...body, challengeId: r1.challengeId });
    expect(r2).toMatchObject({ ok: true });

    // 并发拒绝是同步段结构保证，HTTP 时序不可靠（本地 sqlite 分片并行传输过快，
    // 真实任务在下一往返前已完成并被 sweep）：
    // 注入假 running 任务（同目标 tdst / 可取消）占坑，对 service 层确定性断言
    let cancelCalled = false;
    const fakeTask = {
      id: 'fake-busy',
      snapshot: () => ({ status: 'running', tables: [], failures: [] }),
      cancel: () => {
        cancelCalled = true;
      },
      finished: new Promise(() => {}),
    };
    const tasks = (service as unknown as { transferTasks: Map<string, unknown> }).transferTasks;
    const r3 = await service.transferStart(projectA, startBody());
    expect(r3).toHaveProperty('needConfirmation');
    const challengeId = (r3 as { challengeId: string }).challengeId;
    tasks.set('fake-busy', { task: fakeTask, sourceConnId: 'tsrc', targetConnId: 'tdst', projectKey: normalizeProjectKey(projectA), statement: 'fake' });
    try {
      await expect(service.transferStart(projectA, startBody(), challengeId)).rejects.toThrow(/已有传输任务在执行/);
      await expect(service.transferStart(projectA, { ...startBody(), tables: ['t', 't'] })).rejects.toThrow(/重复表名/);
      await expect(service.transferCancel(projectA, 'fake-busy')).resolves.toMatchObject({ cancelled: true });
      expect(cancelCalled).toBe(true);
      // 取消落审计（与 start/finish 同链）
      expect(store.audit.tail(50).some((a) => a.action === 'transfer_cancel')).toBe(true);
      // 进度授权：非发起项目读取拒绝（taskId 可枚举，不能凭 id 越项目读取）；发起项目可查
      const r7 = await get(`/api/transfer/fake-busy?${pj(projectB)}`);
      expect(r7).toMatchObject({ ok: false, code: 'UNAUTHORIZED_PROJECT' });
      const r8 = await get(`/api/transfer/fake-busy?${pj(projectA)}`);
      expect(r8).toMatchObject({ ok: true, data: { status: 'running' } });
    } finally {
      tasks.delete('fake-busy');
    }

    // HTTP cancel/progress 路由：未知任务 NOT_FOUND
    const r5 = await post('/api/transfer/no-such-task/cancel', { projectPath: projectA });
    expect(r5).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const r6 = await get(`/api/transfer/no-such-task?${pj(projectA)}`);
    expect(r6).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  }, 30000);
});
