/** DbToolService 构造默认值、DbToolError 契约、create_connection 审计 */
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DbToolError, DbToolService, type NeedConfirm } from '../../lib/manager.js';
import { DbToolStore, normalizeProjectKey } from '../../lib/store/index.js';
import { CONN_ID, CONN_URL, fakeAdapter, makeFixture } from './fixture.js';
import { cleanupDir, makeTempHome } from '../store/helpers.js';

function isConfirm(v: unknown): v is NeedConfirm {
  return Boolean(v && typeof v === 'object' && (v as NeedConfirm).needConfirmation === true);
}

describe('DbToolService: 构造与错误契约', () => {
  it('DbToolError.name 固定为 DbToolError', () => {
    expect(new DbToolError('NOT_FOUND', 'x').name).toBe('DbToolError');
  });

  it('必填参数为空白或非字符串 → INVALID_ARGUMENT，消息含字段名', async () => {
    const fx = await makeFixture('rw');
    try {
      await expect(fx.service.query(fx.projectA, CONN_ID, '   ')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: '缺少必填参数: sql',
      });
      await expect(
        fx.service.query(fx.projectA, CONN_ID, undefined as unknown as string),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: '缺少必填参数: sql',
      });
    } finally {
      await fx.dispose();
    }
  });

  it('默认构造（不传 opts）成功，listConnections 与默认 ChallengeStore 可用', () => {
    const home = makeTempHome();
    let service: DbToolService | undefined;
    try {
      const store = new DbToolStore(home);
      store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
      service = new DbToolService(store);
      expect(service.listConnections().map((m) => m.id)).toEqual([CONN_ID]);
      expect(service.challenges).toBeDefined();
    } finally {
      void service?.dispose();
      cleanupDir(home);
    }
  });

  it('仅注入 adapterResolver（不传 challenges）→ 默认 ChallengeStore 走危险确认流程', async () => {
    const home = makeTempHome();
    let service: DbToolService | undefined;
    try {
      const store = new DbToolStore(home);
      store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
      const projectA = path.join(os.tmpdir(), 'dbt-test-proj-a');
      store.grants.grant(normalizeProjectKey(projectA), CONN_ID, 'rw');
      service = new DbToolService(store, {
        adapterResolver: async () => (conn) => Promise.resolve(fakeAdapter({ connId: conn.meta.id })),
      });

      const r = await service.execute(projectA, CONN_ID, 'DROP TABLE t'); // DDL → danger → 需确认
      expect(isConfirm(r)).toBe(true);
      expect((r as NeedConfirm).challengeId).toBeTruthy();
      expect((r as NeedConfirm).danger).toBe('danger');
    } finally {
      await service?.dispose();
      cleanupDir(home);
    }
  });

  it('createConnection 写入审计：projectPathKey 为空、ok=true、confirmed=false', async () => {
    const fx = await makeFixture('rw');
    try {
      fx.service.createConnection({ id: 'c9', kind: 'mysql', url: CONN_URL });
      const last = fx.store.audit.tail(1)[0];
      expect(last).toMatchObject({
        projectPathKey: '',
        connId: 'c9',
        action: 'create_connection',
        statement: 'c9',
        danger: 'none',
        confirmed: false,
        ok: true,
      });
    } finally {
      await fx.dispose();
    }
  });
});
