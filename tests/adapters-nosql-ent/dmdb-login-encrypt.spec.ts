/**
 * 达梦通信加密降级回归（[6071] 消息加密失败 / Unknown cipher）。
 *
 * 驱动事实（dmdb@1.0.52452）：createPool 默认 loginEncrypt=true；服务器
 * COMM_ENCRYPT_NAME=DES_CFB（或协商结果为算法 0）时驱动选择 DES-CFB，而
 * Node 22+/OpenSSL 3 已移除 DES，crypto.createCipheriv 抛 Unknown cipher /
 * digital envelope routines::unsupported，被驱动包成 [6071]。
 *
 * 本测试用 mock 复刻驱动行为：首次 createPool 抛该特征错误、第二次（带
 * loginEncrypt=false 的连接串）成功，锁定「仅定向降级一次」的契约。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDmAdapter, openDmPool } from '../../lib/adapters/dmdb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const { createPoolMock } = vi.hoisted(() => ({ createPoolMock: vi.fn() }));

vi.mock('dmdb', () => ({
  default: { createPool: createPoolMock, OUT_FORMAT_OBJECT: 4001 },
}));

function makePool(): {
  getConnection: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return {
    getConnection: vi.fn(async () => ({
      execute: vi.fn(async () => ({ rows: [], metaData: [], rowsAffected: 0 })),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    })),
    close: vi.fn(async () => undefined),
  };
}

function mkConn(id = 'c1', url = 'dm://SYSDBA:SYSDBA@localhost:5236'): ResolvedConnection {
  return { meta: { id, kind: 'dmdb' }, url };
}

/** 与 dmdb 实际抛出的对象同形（DBError 同时带 errCode 与 message） */
function cipherError(): Error & { errCode: number } {
  return Object.assign(new Error('[6071] 消息加密失败\nError: Unknown cipher'), { errCode: 6071 });
}

function firstAttrs(callIndex: number): Record<string, unknown> {
  return createPoolMock.mock.calls[callIndex]![0] as Record<string, unknown>;
}

describe('达梦通信加密降级（[6071] 回归）', () => {
  beforeEach(() => {
    createPoolMock.mockReset();
    createPoolMock.mockImplementation(async () => makePool());
  });

  it('DES-CFB / Unknown cipher 时自动以 loginEncrypt=false 重试一次', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn());

    expect(createPoolMock).toHaveBeenCalledTimes(2);
    expect(firstAttrs(0)['connectString']).toBe('dm://SYSDBA:SYSDBA@localhost:5236');
    const retryUrl = String(firstAttrs(1)['connectString']);
    expect(new URL(retryUrl).searchParams.get('loginEncrypt')).toBe('false');
    // 失败那次与重试那次都必须持有互不相同的池别名（failed attempt 也消耗一个序号）
    expect(firstAttrs(0)['poolAlias']).not.toBe(firstAttrs(1)['poolAlias']);
    expect(firstAttrs(1)['poolAlias']).not.toBe('default');
    await a.close();
  });

  it('重试保留原 query 参数，只追加/替换 loginEncrypt', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn('c1', 'dm://u:p@dbhost:5236?schema=APP&foo=bar'));
    const retry = new URL(String(firstAttrs(1)['connectString']));
    expect(retry.searchParams.get('schema')).toBe('APP');
    expect(retry.searchParams.get('foo')).toBe('bar');
    expect(retry.searchParams.get('loginEncrypt')).toBe('false');
    await a.close();
  });

  it('非加密能力错误不重试（[-2501] 用户名或密码错误）', async () => {
    createPoolMock.mockRejectedValueOnce(new Error('[-2501] 用户名或密码错误'));
    await expect(createDmAdapter(mkConn())).rejects.toThrow('达梦 DM 错误：[-2501] 用户名或密码错误');
    expect(createPoolMock).toHaveBeenCalledTimes(1);
  });

  it('显式 loginEncrypt=true 时不做自动降级，错误提示给出服务器配置路径', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    await expect(createDmAdapter(mkConn('c1', 'dm://u:p@dbhost:5236?loginEncrypt=true')))
      .rejects.toThrow('COMM_ENCRYPT_NAME');
    expect(createPoolMock).toHaveBeenCalledTimes(1);
  });

  it('重试仍失败时抛重试错误（不把原始 6071 混入）', async () => {
    createPoolMock
      .mockRejectedValueOnce(cipherError())
      .mockRejectedValueOnce(new Error('[-2501] 用户名或密码错误'));
    await expect(createDmAdapter(mkConn())).rejects.toThrow('[-2501] 用户名或密码错误');
    expect(createPoolMock).toHaveBeenCalledTimes(2);
  });

  it('降级成功后 testConnect 的 serverInfo 明示 loginEncrypt=false', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn());
    const r = await a.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toContain('loginEncrypt=false');
    await a.close();
  });

  it('数据传输独立池 openDmPool 同样享受降级', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const p = await openDmPool(mkConn('transfer'));
    expect(createPoolMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(firstAttrs(1)['connectString'])).searchParams.get('loginEncrypt')).toBe('false');
    await p.close();
  });
});
