/**
 * 控制台事务会话（契约 C）HTTP 全链路测试：直打 handleDbToolRequest，
 * 走完 begin → exec（NEEDS_CONFIRMATION → challenge 重试）→ commit/rollback →
 * 审计落盘 全链路，并覆盖 ro 拒绝与未知会话 NOT_FOUND。全离线（假适配器）。
 */
import { describe, expect, it, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleDbToolRequest } from '../../lib/http/index.js';
import { DbToolStore, normalizeProjectKey } from '../../lib/store/index.js';
import { DbToolService } from '../../lib/manager.js';
import { ChallengeStore } from '../../lib/guard/index.js';
import type { TxHandle } from '../../lib/adapters/sql-shared/pg-like.js';
import type {
  ColumnInfo,
  DatabaseAdapter,
  ExecResult,
  QueryResult,
  TableInfo,
  TestConnectResult,
} from '../../lib/adapters/types.js';
import { CONN_ID, CONN_URL } from '../tool/fixture.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';

/* ---------------- 带事务句柄的假适配器（记录轨迹） ---------------- */

function fakeHandleTxAdapter(log: string[]): DatabaseAdapter & { tx: TxHandle } {
  let inTx = false;
  return {
    kind: 'mysql',
    connId: CONN_ID,
    testConnect: async (): Promise<TestConnectResult> => ({ ok: true, serverInfo: 'fake-8.0' }),
    query: async (sql: string): Promise<QueryResult> => {
      log.push(`query:${sql}:sticky=${inTx}`);
      return { columns: ['answer'], rows: [[sql]], rowCount: 1 };
    },
    execute: async (sql: string): Promise<ExecResult> => {
      log.push(`execute:${sql}:sticky=${inTx}`);
      return { affectedRows: 1, message: `已执行: ${sql}` };
    },
    listDatabases: async () => ['app'],
    listTables: async (): Promise<TableInfo[]> => [],
    describeTable: async (): Promise<ColumnInfo[]> => [],
    previewRows: async (): Promise<QueryResult> => ({ columns: [], rows: [], rowCount: 0 }),
    tx: {
      begin: async () => {
        if (inTx) throw new Error('事务已开启');
        inTx = true;
        log.push('BEGIN');
      },
      commit: async () => {
        if (!inTx) throw new Error('没有进行中的事务');
        inTx = false;
        log.push('COMMIT');
      },
      rollback: async () => {
        if (!inTx) throw new Error('没有进行中的事务');
        inTx = false;
        log.push('ROLLBACK');
      },
    },
    close: async () => {
      log.push('close');
    },
  };
}

/* ---------------- fixture + HTTP mock（与 e2e.spec 相同形态） ---------------- */

let fx: {
  home: string;
  projectA: string;
  service: DbToolService;
  sessionLog: string[];
  dispose: () => Promise<void>;
} | null = null;

async function ensureFixture(mode: 'rw' | 'ro' = 'rw'): Promise<NonNullable<typeof fx>> {
  if (fx) return fx;
  const home = makeTempHome();
  const store = new DbToolStore(home);
  store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
  const projectA = path.join(os.tmpdir(), 'dbt-tx-e2e-proj-a');
  store.grants.grant(normalizeProjectKey(projectA), CONN_ID, mode);
  const sessionLog: string[] = [];
  const service = new DbToolService(store, {
    adapterResolver: async () => async () => fakeHandleTxAdapter(sessionLog),
    challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
  });
  fx = {
    home,
    projectA,
    service,
    sessionLog,
    dispose: async () => {
      await service.dispose();
      cleanupDir(home);
    },
  };
  return fx;
}

afterAll(async () => {
  await fx?.dispose();
});

function mockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as unknown as { headers: Record<string, string> }).headers = { host: '127.0.0.1' };
  (req as unknown as { method: string }).method = method;
  (req as unknown as { url: string }).url = url;
  queueMicrotask(() => {
    if (body !== undefined) (req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)));
    (req as unknown as EventEmitter).emit('end');
  });
  return req;
}

class MockRes {
  statusCode = 200;
  body = '';
  headersSent = false;
  writeHead(status: number): this {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }
  setHeader(): void {}
  end(chunk?: string): this {
    if (chunk !== undefined) this.body += chunk;
    return this;
  }
}

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const f = await ensureFixture();
  const res = new MockRes();
  await handleDbToolRequest(mockReq(method, url, body), res as unknown as ServerResponse, f.service);
  return { status: res.statusCode, json: JSON.parse(res.body) as any };
}

/* ---------------- 四路由全链路 ---------------- */

describe('POST /api/console/*（事务会话全链路）', () => {
  it('begin → exec 危险写 NEEDS_CONFIRMATION → challenge 重试成功 → commit 销毁会话 → 审计落盘', async () => {
    const begin = await call('POST', '/api/console/begin', { projectPath: (await ensureFixture()).projectA, connId: CONN_ID });
    expect(begin.json.ok).toBe(true);
    const token = begin.json.data.sessionToken as string;
    expect(token).toMatch(/^t_/);

    // exec：读语句直接成功（query 通道 + 结果集）
    const sel = await call('POST', '/api/console/exec', { sessionToken: token, statement: 'SELECT * FROM t' });
    expect(sel.json.ok).toBe(true);
    expect(sel.json.data.rowCount).toBe(1);

    // exec：危险写无 challenge → 扁平 NEEDS_CONFIRMATION
    const stmt = 'DROP TABLE t';
    const nc = await call('POST', '/api/console/exec', { sessionToken: token, statement: stmt });
    expect(nc.json).toMatchObject({ ok: false, code: 'NEEDS_CONFIRMATION', danger: 'danger' });
    expect(typeof nc.json.challengeId).toBe('string');

    // challenge 重试 → 成功；challenge 一次性 → 再用 INVALID_CHALLENGE
    const okExec = await call('POST', '/api/console/exec', {
      sessionToken: token, statement: stmt, challengeId: nc.json.challengeId,
    });
    expect(okExec.json.ok).toBe(true);
    const replay = await call('POST', '/api/console/exec', {
      sessionToken: token, statement: stmt, challengeId: nc.json.challengeId,
    });
    expect(replay.json).toMatchObject({ ok: false, code: 'INVALID_CHALLENGE' });

    // commit：销毁会话（对应官方 finally release 语义）
    const commit = await call('POST', '/api/console/commit', { sessionToken: token });
    expect(commit.json.ok).toBe(true);

    // 会话已销毁：exec / commit / rollback 全部 NOT_FOUND
    const gone = await call('POST', '/api/console/exec', { sessionToken: token, statement: 'SELECT 1' });
    expect(gone.json).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const goneCommit = await call('POST', '/api/console/commit', { sessionToken: token });
    expect(goneCommit.json).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const goneRb = await call('POST', '/api/console/rollback', { sessionToken: token });
    expect(goneRb.json).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    // 粘性轨迹：BEGIN 后同通道执行，COMMIT 后 close
    const f = await ensureFixture();
    expect(f.sessionLog).toEqual([
      'BEGIN',
      'query:SELECT * FROM t:sticky=true',
      'execute:DROP TABLE t:sticky=true',
      'COMMIT',
      'close',
    ]);

    // 审计：begin / exec（含 NEEDS_CONFIRMATION 与 INVALID_CHALLENGE）/ commit 全部落盘
    const audit = f.service.auditTail(f.projectA, 200);
    expect(audit.some((e) => e.action === 'console_begin' && e.ok)).toBe(true);
    expect(audit.some((e) => e.action === 'console_exec' && e.error === 'NEEDS_CONFIRMATION')).toBe(true);
    expect(audit.some((e) => e.action === 'console_exec' && e.error === 'INVALID_CHALLENGE')).toBe(true);
    expect(audit.some((e) => e.action === 'console_exec' && e.statement === stmt && e.confirmed && e.ok)).toBe(true);
    expect(audit.some((e) => e.action === 'console_commit' && e.ok)).toBe(true);
  });

  it('rollback 全链路：粘性回滚 + close + 审计', async () => {
    const f = await ensureFixture();
    const begin = await call('POST', '/api/console/begin', { projectPath: f.projectA, connId: CONN_ID });
    const token = begin.json.data.sessionToken as string;
    const rb = await call('POST', '/api/console/rollback', { sessionToken: token });
    expect(rb.json.ok).toBe(true);
    expect(f.sessionLog.slice(-2)).toEqual(['ROLLBACK', 'close']);
    expect(f.service.auditTail(f.projectA, 200).some((e) => e.action === 'console_rollback' && e.ok)).toBe(true);
  });

  it('ro 授权 begin → READ_ONLY；缺 body 字段 → INVALID_ARGUMENT / NOT_FOUND', async () => {
    // ro fixture 与 rw fixture 不能共存（ensureFixture 单例）——ro 用独立 service 直打
    const home = makeTempHome();
    try {
      const store = new DbToolStore(home);
      store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
      const projectA = path.join(os.tmpdir(), 'dbt-tx-e2e-proj-ro');
      store.grants.grant(normalizeProjectKey(projectA), CONN_ID, 'ro');
      const service = new DbToolService(store, {
        adapterResolver: async () => async () => fakeHandleTxAdapter([]),
        challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
      });
      const res = new MockRes();
      await handleDbToolRequest(
        mockReq('POST', '/api/console/begin', { projectPath: projectA, connId: CONN_ID }),
        res as unknown as ServerResponse,
        service,
      );
      expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'READ_ONLY' });

      // 未知会话操作（rw 主 fixture）
      const unknown = await call('POST', '/api/console/exec', { sessionToken: 't_missing', statement: 'SELECT 1' });
      expect(unknown.json).toMatchObject({ ok: false, code: 'NOT_FOUND' });

      // 缺 statement → INVALID_ARGUMENT
      const begin = await call('POST', '/api/console/begin', { projectPath: (await ensureFixture()).projectA, connId: CONN_ID });
      const noStmt = await call('POST', '/api/console/exec', { sessionToken: begin.json.data.sessionToken });
      expect(noStmt.json).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
      await call('POST', '/api/console/rollback', { sessionToken: begin.json.data.sessionToken });
      await service.dispose();
    } finally {
      cleanupDir(home);
    }
  });
});
