/**
 * 传输读写端池回收回归（owner 非法时不得泄漏已建池）。
 *
 * 缺陷（审查发现）：`lib/adapters/transfer/model.ts` 的 oracle/dmdb 分支原先「先开池、
 * 后求值 owner」。**写端**的 createOraLikeTransferWriter 在构造期第一行就
 * sanitize(owner)（oralike.ts:343），故 owner 非法（超长 / 含 NUL 换行）或缺失
 * （连接无用户名 → ownerOfFromConn 抛错）时构造期同步抛错，而池已建且无人持有 →
 * 驱动登记项永不释放（池泄漏）。owner 源自 HTTP 的 source/targetDatabase，manager
 * 只做 trim、无长度校验，用户可触达。
 * **读端**的 sanitize(owner) 是惰性的（describe/keyAt 方法内），不构成泄漏窗口；
 * 但 ownerOfFromConn 仍在实参处求值，故连接缺用户名时读端同样会构造期抛错。
 *
 * 修复：构造期抛错时回收已建池（model.ts 内 try/catch）。本测试用 mock 复刻 dmdb 的
 * 进程级登记表，断言「抛错后登记表回落为 0」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransferReader, createTransferWriter } from '../../lib/adapters/transfer/model.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

/** 复刻 dmdb 的进程级池登记表（不传别名即 'default'，判重抛 20006） */
const { createPoolMock, pools } = vi.hoisted(() => {
  const pools = new Map<string, unknown>();
  const createPoolMock = vi.fn(async (attrs: Record<string, unknown>) => {
    const key = (attrs.poolAlias as string | undefined) ?? 'default';
    if (pools.has(key)) throw new Error('[20006] 连接池别名已存在');
    const pool = {
      getConnection: vi.fn(async () => ({
        execute: vi.fn(async () => ({ rows: [], metaData: [], rowsAffected: 0 })),
        commit: vi.fn(async () => undefined),
        rollback: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      })),
      close: vi.fn(async () => {
        pools.delete(key);
      }),
    };
    pools.set(key, pool);
    return pool;
  });
  return { createPoolMock, pools };
});

vi.mock('dmdb', () => ({
  default: { createPool: createPoolMock, OUT_FORMAT_OBJECT: 4001 },
}));

const rc: ResolvedConnection = {
  meta: { id: 'dm1', kind: 'dmdb' },
  url: 'dm://SYSDBA:SYSDBA@localhost:5236',
};

describe('传输读写端池回收（owner 非法不得泄漏池）', () => {
  beforeEach(() => {
    pools.clear();
    createPoolMock.mockClear();
  });

  it('writer：owner 超长 → 抛错且已建池被回收', async () => {
    await expect(
      createTransferWriter(rc, 'insert', { database: 'a'.repeat(200) }),
    ).rejects.toThrow('非法');
    expect(createPoolMock).toHaveBeenCalledTimes(1); // 池确实建过
    expect(pools.size).toBe(0); // 但已被回收
  });

  it('reader：连接无用户名 → ownerOfFromConn 抛错时回收池', async () => {
    const noUser: ResolvedConnection = { meta: { id: 'dm3', kind: 'dmdb' }, url: 'dm://:@localhost:5236' };
    await expect(createTransferReader(noUser)).rejects.toThrow('缺少用户名');
    expect(pools.size).toBe(0);
  });

  it('reader：owner 非法不在构造期抛错（oralike 内为惰性校验），池交由调用方回收', async () => {
    // reader 的 sanitize(owner) 在 describe/keyAt 等方法内才执行（oralike.ts:194,317），
    // 构造期不校验 → 不存在「池已建却无人持有」的窗口；非法 owner 在首次调用时抛错，
    // 此时池仍由调用方持有并按既有 finally 回收。
    const r = await createTransferReader(rc, { database: 'a\nb' });
    expect(pools.size).toBe(1);
    await r.close();
    expect(pools.size).toBe(0);
  });

  it('writer：连接无用户名 → ownerOfFromConn 抛错时也回收池', async () => {
    const noUser: ResolvedConnection = { meta: { id: 'dm2', kind: 'dmdb' }, url: 'dm://:@localhost:5236' };
    await expect(createTransferWriter(noUser, 'insert')).rejects.toThrow('缺少用户名');
    expect(pools.size).toBe(0);
  });

  it('owner 合法：正常创建，close 后登记表回落（修复未误伤正常路径）', async () => {
    const w = await createTransferWriter(rc, 'insert', { database: 'SYSDBA' });
    expect(pools.size).toBe(1);
    await w.close();
    expect(pools.size).toBe(0);
  });

  it('owner 合法：reader 同样正常', async () => {
    const r = await createTransferReader(rc, { database: 'SYSDBA' });
    expect(pools.size).toBe(1);
    await r.close();
    expect(pools.size).toBe(0);
  });
});
