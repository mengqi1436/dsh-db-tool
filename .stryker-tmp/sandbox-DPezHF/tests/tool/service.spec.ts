/** DbToolService：授权 / 只读 / 危险确认 / challenge / 审计 / 脚本沙箱 / secrets 脱敏 */
// @ts-nocheck

import { describe, expect, it } from 'vitest';
import { DbToolError, type NeedConfirm } from '../../lib/manager.js';
import { handleToolAction } from '../../lib/manager.js';
import { readStoreFile } from '../store/helpers.js';
import { CONN_ID, CONN_URL, makeFixture, type Fixture } from './fixture.js';

function isConfirm(v: unknown): v is NeedConfirm {
  return Boolean(v && typeof v === 'object' && (v as NeedConfirm).needConfirmation === true);
}

async function confirmFlow(fx: Fixture, stmt: string): Promise<NeedConfirm> {
  const r = await fx.service.execute(fx.projectA, CONN_ID, stmt);
  expect(isConfirm(r)).toBe(true);
  return r as NeedConfirm;
}

describe('DbToolService: 授权与只读', () => {
  it('未授权项目 → UNAUTHORIZED_PROJECT；缺 projectPath 同样拒绝', async () => {
    const fx = await makeFixture('rw');
    try {
      await expect(fx.service.query(fx.projectB, CONN_ID, 'SELECT 1')).rejects.toMatchObject({
        code: 'UNAUTHORIZED_PROJECT',
      });
      await expect(fx.service.query(undefined, CONN_ID, 'SELECT 1')).rejects.toMatchObject({
        code: 'UNAUTHORIZED_PROJECT',
      });
      await expect(fx.service.databases(fx.projectB, CONN_ID)).rejects.toMatchObject({
        code: 'UNAUTHORIZED_PROJECT',
      });
    } finally {
      await fx.dispose();
    }
  });

  it('未授权连接一概 UNAUTHORIZED_PROJECT（不泄露存在性）；已知项目下未知连接 remove → NOT_FOUND', async () => {
    const fx = await makeFixture('rw');
    try {
      // 授权按 (project, conn) 存在：未授权连接（哪怕真不存在）先拒，避免探测
      await expect(fx.service.query(fx.projectA, 'nope', 'SELECT 1')).rejects.toMatchObject({
        code: 'UNAUTHORIZED_PROJECT',
      });
      // 管理通道（无需授权）才暴露 NOT_FOUND
      expect(() => fx.service.removeConnection('nope')).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }) as unknown as Error,
      );
    } finally {
      await fx.dispose();
    }
  });

  it('ro 连接 execute / run_script → READ_ONLY；query 可用；mode 透传工厂', async () => {
    const fx = await makeFixture('ro');
    try {
      await expect(fx.service.execute(fx.projectA, CONN_ID, 'UPDATE users SET a=1')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
      await expect(fx.service.runScript(fx.projectA, CONN_ID, 'return 1')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
      const r = await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(r).toMatchObject({ rowCount: 1 });
      expect(fx.seenMode.mode).toBe('ro');
    } finally {
      await fx.dispose();
    }
  });

  it('rw 连接 mode=rw 透传，DML 直接执行', async () => {
    const fx = await makeFixture('rw');
    try {
      const r = await fx.service.execute(fx.projectA, CONN_ID, 'UPDATE users SET a=1');
      expect(r).toMatchObject({ affectedRows: 1 });
      expect(fx.seenMode.mode).toBe('rw');
    } finally {
      await fx.dispose();
    }
  });
});

describe('DbToolService: 危险确认与 challenge', () => {
  it('危险语句首次 → NEEDS_CONFIRMATION；带 challengeId 重试成功', async () => {
    const fx = await makeFixture('rw');
    try {
      const nc = await confirmFlow(fx, 'DROP TABLE users');
      expect(nc.challengeId).toMatch(/^c_[0-9a-f]{24}$/);
      expect(nc.statement).toBe('DROP TABLE users');
      expect(nc.reason).toContain('不可回滚');

      const r = await fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users', undefined, nc.challengeId);
      expect(r).toMatchObject({ affectedRows: 1 });
    } finally {
      await fx.dispose();
    }
  });

  it('challenge 一次性：重放同 id → INVALID_CHALLENGE', async () => {
    const fx = await makeFixture('rw');
    try {
      const nc = await confirmFlow(fx, 'DROP TABLE users');
      await fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users', undefined, nc.challengeId);
      await expect(
        fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users', undefined, nc.challengeId),
      ).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' });
    } finally {
      await fx.dispose();
    }
  });

  it('challenge 绑 hash：带 id 但语句已变更 → INVALID_CHALLENGE', async () => {
    const fx = await makeFixture('rw');
    try {
      const nc = await confirmFlow(fx, 'DROP TABLE users');
      await expect(
        fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users2', undefined, nc.challengeId),
      ).rejects.toMatchObject({ code: 'INVALID_CHALLENGE' });
    } finally {
      await fx.dispose();
    }
  });

  it('query 通道的写语句同样需要确认；SELECT 直通', async () => {
    const fx = await makeFixture('ro');
    try {
      const nc = await fx.service.query(fx.projectA, CONN_ID, 'UPDATE users SET a=1');
      expect(isConfirm(nc)).toBe(true);
      const r = await fx.service.query(fx.projectA, CONN_ID, 'SELECT 1');
      expect(isConfirm(r)).toBe(false);
    } finally {
      await fx.dispose();
    }
  });

  it('ro 连接对危险语句也先报 READ_ONLY（授权优先于 guard）', async () => {
    const fx = await makeFixture('ro');
    try {
      await expect(fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users')).rejects.toMatchObject({
        code: 'READ_ONLY',
      });
    } finally {
      await fx.dispose();
    }
  });
});

describe('DbToolService: 浏览与审计', () => {
  it('databases/tables/schema/preview 正常；preview limit 强制 ≤50', async () => {
    let seenLimit = 0;
    const fx = await makeFixture('rw', {
      previewRows: async (_t, limit) => {
        seenLimit = limit;
        return { columns: ['id'], rows: [], rowCount: 0 };
      },
    });
    try {
      expect(await fx.service.databases(fx.projectA, CONN_ID)).toEqual(['app', 'test']);
      expect(await fx.service.tables(fx.projectA, CONN_ID)).toHaveLength(1);
      expect(await fx.service.schema(fx.projectA, CONN_ID, 'users')).toHaveLength(1);
      await fx.service.preview(fx.projectA, CONN_ID, 'users', 999);
      expect(seenLimit).toBe(50);
    } finally {
      await fx.dispose();
    }
  });

  it('危险确认与执行都留审计', async () => {
    const fx = await makeFixture('rw');
    try {
      const nc = await confirmFlow(fx, 'DROP TABLE users');
      await fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users', undefined, nc.challengeId);
      const entries = fx.service.auditTail(undefined, 100);
      const confirms = entries.filter((e) => e.error === 'NEEDS_CONFIRMATION');
      expect(confirms.length).toBeGreaterThanOrEqual(1);
      expect(confirms[0]).toMatchObject({ connId: CONN_ID, danger: 'danger', ok: false, confirmed: false });
      const execs = entries.filter((e) => e.action === 'execute' && e.ok === true);
      expect(execs.length).toBeGreaterThanOrEqual(1);
      expect(execs[0]).toMatchObject({ danger: 'danger', confirmed: true });
    } finally {
      await fx.dispose();
    }
  });

  it('INVALID_CHALLENGE 也留审计', async () => {
    const fx = await makeFixture('rw');
    try {
      const nc = await confirmFlow(fx, 'DROP TABLE users');
      await fx.service.execute(fx.projectA, CONN_ID, 'DROP TABLE users2', undefined, nc.challengeId).catch(() => {});
      const bad = fx.service.auditTail(undefined, 100).filter((e) => e.error === 'INVALID_CHALLENGE');
      expect(bad.length).toBe(1);
    } finally {
      await fx.dispose();
    }
  });
});

describe('DbToolService: run_script 沙箱', () => {
  it('rw：脚本可 db.query / db.execute，结果返回', async () => {
    const fx = await makeFixture('rw');
    try {
      const r1 = await fx.service.runScript(fx.projectA, CONN_ID, 'return await db.query("SELECT 1")');
      expect(r1).toMatchObject({ rowCount: 1 });
      const r2 = await fx.service.runScript(
        fx.projectA,
        CONN_ID,
        'const r = await db.execute("UPDATE t SET a=1"); return r.affectedRows',
      );
      expect(r2).toBe(1);
    } finally {
      await fx.dispose();
    }
  });

  it('沙箱内无 require/process/globalThis.fs 逃逸面', async () => {
    const fx = await makeFixture('rw');
    try {
      await expect(
        fx.service.runScript(fx.projectA, CONN_ID, 'return typeof require'),
      ).resolves.toBe('undefined');
      await expect(
        fx.service.runScript(fx.projectA, CONN_ID, 'return process.version'),
      ).rejects.toThrow();
    } finally {
      await fx.dispose();
    }
  });

  it('脚本内危险语句 → NEEDS_CONFIRMATION（challengeId 为空时生成新 challenge）', async () => {
    const fx = await makeFixture('rw');
    try {
      await expect(
        fx.service.runScript(fx.projectA, CONN_ID, 'await db.execute("DROP TABLE users")'),
      ).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
    } finally {
      await fx.dispose();
    }
  });

  it('脚本语法错误 → DRIVER_ERROR 而非崩溃', async () => {
    const fx = await makeFixture('rw');
    try {
      await expect(fx.service.runScript(fx.projectA, CONN_ID, 'syntax ((( error')).rejects.toMatchObject({
        code: 'DRIVER_ERROR',
      });
    } finally {
      await fx.dispose();
    }
  });
});

describe('DbToolService: 连接管理与 secrets', () => {
  it('connections.json 无密码（*** 脱敏），密码只进 secrets.json', async () => {
    const fx = await makeFixture('rw');
    try {
      const conns = readStoreFile(fx.home, 'connections.json');
      expect(conns).not.toContain('s3cret');
      expect(conns).toContain('***');
      const secrets = readStoreFile(fx.home, 'secrets.json');
      expect(secrets).toContain('s3cret');
    } finally {
      await fx.dispose();
    }
  });

  it('remove 级联；重复 remove → NOT_FOUND', async () => {
    const fx = await makeFixture('rw');
    try {
      fx.service.removeConnection(CONN_ID);
      expect(fx.service.listConnections()).toHaveLength(0);
      expect(() => fx.service.removeConnection(CONN_ID)).toThrowError(DbToolError);
    } finally {
      await fx.dispose();
    }
  });
});

describe('handleToolAction（工具分发层）', () => {
  it('list_connections 返回脱敏 JSON 文本', async () => {
    const fx = await makeFixture('rw');
    try {
      const text = await handleToolAction(fx.service, { action: 'list_connections' }, fx.projectA);
      expect(text).not.toContain('s3cret');
      expect(text).toContain(CONN_ID);
    } finally {
      await fx.dispose();
    }
  });

  it('query 直通与 NEEDS_CONFIRMATION 带 hint 指引', async () => {
    const fx = await makeFixture('rw');
    try {
      const ok = await handleToolAction(fx.service, { action: 'query', conn_id: CONN_ID, sql: 'SELECT 1' }, fx.projectA);
      expect(ok).toContain('"rowCount": 1');

      const nc = await handleToolAction(
        fx.service,
        { action: 'execute', conn_id: CONN_ID, statement: 'DROP TABLE users' },
        fx.projectA,
      );
      expect(nc).toContain('NEEDS_CONFIRMATION');
      expect(nc).toContain('challenge_id=');
    } finally {
      await fx.dispose();
    }
  });

  it('未授权在工具层也拒（错误 JSON 而非抛出）', async () => {
    const fx = await makeFixture('rw');
    try {
      const text = await handleToolAction(
        fx.service,
        { action: 'query', conn_id: CONN_ID, sql: 'SELECT 1' },
        fx.projectB,
      );
      expect(text).toContain('UNAUTHORIZED_PROJECT');
    } finally {
      await fx.dispose();
    }
  });

  it('缺参数 / 未知 action → INVALID_ARGUMENT 错误 JSON', async () => {
    const fx = await makeFixture('rw');
    try {
      expect(await handleToolAction(fx.service, { action: 'query' }, fx.projectA)).toContain('INVALID_ARGUMENT');
      expect(await handleToolAction(fx.service, { action: 'wat' }, fx.projectA)).toContain('INVALID_ARGUMENT');
    } finally {
      await fx.dispose();
    }
  });

  it('run_script action 返回脚本结果；ro 被拒', async () => {
    const fxRo = await makeFixture('ro');
    try {
      const text = await handleToolAction(
        fxRo.service,
        { action: 'run_script', conn_id: CONN_ID, code: 'return 1' },
        fxRo.projectA,
      );
      expect(text).toContain('READ_ONLY');
    } finally {
      await fxRo.dispose();
    }
    const fx = await makeFixture('rw');
    try {
      const text = await handleToolAction(
        fx.service,
        { action: 'run_script', conn_id: CONN_ID, code: 'return await db.query("SELECT 1")' },
        fx.projectA,
      );
      expect(text).toContain('"rowCount": 1');
    } finally {
      await fx.dispose();
    }
  });
});

describe('连接 URL 常量', () => {
  it('fixture 密码存在（供脱敏断言对照）', () => {
    expect(CONN_URL).toContain('s3cret');
  });
});
