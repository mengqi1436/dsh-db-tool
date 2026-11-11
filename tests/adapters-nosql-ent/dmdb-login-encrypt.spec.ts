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
 *
 * 隔离纪律：实现会记忆「同一实例已降级过」（传输端每张表都新建读写端池，不记忆
 * 就会每池先吃一次 6071），所以凡预计触发降级的用例都各用不同 host，避免前一条
 * 用例留下的记忆让后一条少一次握手而误红。
 */
import { parse as legacyUrlParse } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDmAdapter, openDmPool } from '../../lib/adapters/dmdb/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

const { createPoolMock } = vi.hoisted(() => ({ createPoolMock: vi.fn() }));

// 真实常量：OUT_FORMAT_ARRAY=4001、OUT_FORMAT_OBJECT=4002（node -e "require('dmdb')" 实测）。
// 写成 4001 会让「按 4002 走对象行」的实现偏差在单测里不可见。
vi.mock('dmdb', () => ({
  default: { createPool: createPoolMock, OUT_FORMAT_OBJECT: 4002 },
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
    const a = await createDmAdapter(mkConn('c1', 'dm://SYSDBA:SYSDBA@dm-fallback-a.example:5236'));

    expect(createPoolMock).toHaveBeenCalledTimes(2);
    expect(firstAttrs(0)['connectString']).toBe('dm://SYSDBA:SYSDBA@dm-fallback-a.example:5236');
    const retryUrl = String(firstAttrs(1)['connectString']);
    expect(new URL(retryUrl).searchParams.get('loginEncrypt')).toBe('false');
    // 失败那次与重试那次都必须持有互不相同的池别名（failed attempt 也消耗一个序号）
    expect(firstAttrs(0)['poolAlias']).not.toBe(firstAttrs(1)['poolAlias']);
    expect(firstAttrs(1)['poolAlias']).not.toBe('default');
    await a.close();
  });

  it('重试保留原 query 参数，只追加/替换 loginEncrypt', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn('c1', 'dm://u:p@dm-fallback-b.example:5236?schema=APP&foo=bar'));
    const retry = new URL(String(firstAttrs(1)['connectString']));
    expect(retry.searchParams.get('schema')).toBe('APP');
    expect(retry.searchParams.get('foo')).toBe('bar');
    expect(retry.searchParams.get('loginEncrypt')).toBe('false');
    await a.close();
  });

  it('非加密能力错误不重试（[-2501] 用户名或密码错误）', async () => {
    createPoolMock.mockRejectedValueOnce(new Error('[-2501] 用户名或密码错误'));
    await expect(createDmAdapter(mkConn('c1', 'dm://u:p@dm-fallback-f.example:5236')))
      .rejects.toThrow('达梦 DM 错误：[-2501] 用户名或密码错误');
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
    await expect(createDmAdapter(mkConn('c1', 'dm://u:p@dm-fallback-e.example:5236')))
      .rejects.toThrow('[-2501] 用户名或密码错误');
    expect(createPoolMock).toHaveBeenCalledTimes(2);
  });

  it('降级成功后 testConnect 的 serverInfo 明示 loginEncrypt=false', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn('c1', 'dm://SYSDBA:SYSDBA@dm-fallback-c.example:5236'));
    const r = await a.testConnect();
    expect(r.ok).toBe(true);
    expect(r.serverInfo).toContain('loginEncrypt=false');
    await a.close();
  });

  it('数据传输独立池 openDmPool 同样享受降级', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    const p = await openDmPool(mkConn('transfer', 'dm://SYSDBA:SYSDBA@dm-fallback-d.example:5236'));
    expect(createPoolMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(firstAttrs(1)['connectString'])).searchParams.get('loginEncrypt')).toBe('false');
    await p.close();
  });

  /**
   * 显式参数判定必须按驱动语义做大小写不敏感匹配。
   *
   * 驱动事实（node_modules/dmdb/src/desc/properties.js）：Properties.set 统一
   * `innerProps.set(t.toLowerCase(), r)`，parseUrl 逐 key 调 set（src/dm.js 的
   * parseUrl）→ 对驱动而言 ?LOGINENCRYPT=true 与 ?loginEncrypt=true 完全等价。
   * 若实现用 URLSearchParams.has('loginEncrypt') 判定，大小写变体会被误判成「用户
   * 没指定」而强制降级成 false，直接违背「显式参数不做自动降级」的承诺。
   */
  it.each([
    { param: '?LOGINENCRYPT=true', url: 'dm://u:p@dm-case-a1.example:5236?LOGINENCRYPT=true' },
    { param: '?LoginEncrypt=true', url: 'dm://u:p@dm-case-a2.example:5236?LoginEncrypt=true' },
    { param: '?loginencrypt=TRUE', url: 'dm://u:p@dm-case-a3.example:5236?loginencrypt=TRUE' },
    // 百分号编码：query 段出现 %6C（小写 l）时，驱动经 url.parse 的解码后同样把它当
    // loginEncrypt；若实现自己切 query 字符串而漏了解码，这条就会掉进降级分支。
    { param: '?%6CoginEncrypt=true', url: 'dm://u:p@dm-case-a6.example:5236?%6CoginEncrypt=true' },
  ])('显式参数大小写变体 $param 一律不降级（createPool 只调用 1 次）', async ({ url }) => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    await expect(createDmAdapter(mkConn('c1', url))).rejects.toThrow('COMM_ENCRYPT_NAME');
    expect(createPoolMock).toHaveBeenCalledTimes(1);
  });

  /**
   * 显式 loginEncrypt=false 是用户主动选择「不加密」，再「降级成 false」既无意义，
   * 也会把用户写在连接串里的策略当默认值覆盖掉。
   */
  it('显式 loginEncrypt=false 同样不降级（createPool 只调用 1 次）', async () => {
    createPoolMock.mockRejectedValueOnce(cipherError());
    await expect(createDmAdapter(mkConn('c1', 'dm://u:p@dm-case-a4.example:5236?loginEncrypt=false')))
      .rejects.toThrow('COMM_ENCRYPT_NAME');
    expect(createPoolMock).toHaveBeenCalledTimes(1);
  });

  /**
   * 降级只允许改 query 段，authority 必须逐字节保留。
   *
   * 驱动用 legacy url.parse 解析连接串（src/dm.js 的 parseUrl 走 url_1.parse），
   * 而 WHATWG URL 与它对 authority 的解读不同：非 ASCII 主机名经 new URL 重组后变成
   * 百分号编码形式，legacy parse 得到空 host（实测 host=''）→ 重试必然 DNS 失败，
   * 原始 6071 被吞掉，提示还反向指向「检查连接串」。主机名含空格时 new URL 直接抛
   * TypeError: Invalid URL，而该异常在重试分支内求值，会把原始错误顶掉。
   */
  it('降级只改 query：authority 对 legacy url.parse 逐字节等价', async () => {
    const original = 'dm://u:p@数据库主机:5236';
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn('c1', original));

    const retry = String(firstAttrs(1)['connectString']);
    const retryParsed = legacyUrlParse(retry);
    const originalParsed = legacyUrlParse(original);
    // 主机名不能被 URL 重组改写：驱动看到的主机必须与用户写的一致
    expect(retryParsed.host).toBe(originalParsed.host);
    expect(retryParsed.host).not.toBe('');
    expect(retryParsed.auth).toBe(originalParsed.auth);
    expect(new URL(retry).searchParams.get('loginEncrypt')).toBe('false');
    await a.close();
  });

  /**
   * 已按 loginEncrypt=false 重试仍失败时，humanizeDmError 的通用 6071 提示会建议
   * 「在连接串设置 loginEncrypt=false」——这正是刚刚做过的事，自相矛盾会把排查方向
   * 带偏（例如真的配置错了、或是服务端强制加密）。
   * 契约：此时提示须说明已按 loginEncrypt=false 重试、仍失败在加密层，并把矛头指向
   * 服务端 COMM_ENCRYPT_NAME。
   */
  it('降级后仍失败：提示不再建议已经做过的 loginEncrypt=false', async () => {
    createPoolMock.mockRejectedValue(cipherError());
    let err: Error | undefined;
    try {
      await createDmAdapter(mkConn('c1', 'dm://u:p@dm-case-a5.example:5236'));
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    // 必须保留「已做过什么」和「下一步查哪里」，否则用户会重复同一个动作
    expect(err!.message).toContain('loginEncrypt=false');
    expect(err!.message).toContain('COMM_ENCRYPT_NAME');
    // 已经做到的事不能再被建议一次
    expect(err!.message).not.toContain('可在连接串设置');
    expect(createPoolMock).toHaveBeenCalledTimes(2);
  });

  /**
   * 降级结果必须按实例记忆。
   *
   * lib/transfer.ts 的 runTable 每张表都调 createTransferReader/Writer，即每表新建
   * 一个达梦池；默认并发 4 时若不记忆，每池都要先吃一次 [6071] 再降级，等于每批多
   * 4 次失败握手。契约：同一实例（connectString 去掉 userinfo 后相同）第二次建池直接
   * 带 loginEncrypt=false，不再先试加密；用 openDmPool（传输端入口）验证记忆对独立池
   * 同样生效。
   *
   * 第二次建池故意不预置 reject：断言本身就足以抓回归，预置反而会打掉「有记忆」时那
   * 唯一一次调用（call3 直接被队列里的 reject 打死，用例报 6071 而非真的实现缺陷）。
   *  - 有记忆：call1 原串 → 6071、call2 带 false → 成功、call3 带 false → 成功，共 3 次。
   *  - 无记忆（回归）：call3 又带原串且队列已空 → 建池成功，但 connectString 不含
   *    loginEncrypt=false → 下面的断言失败，正是要抓的退化。
   */
  it('同一实例二次建池直接带 loginEncrypt=false（降级记忆，createPool 共 3 次）', async () => {
    const url = 'dm://SYSDBA:SYSDBA@dm-memo.example:5236';
    createPoolMock.mockRejectedValueOnce(cipherError());
    const a = await createDmAdapter(mkConn('memo-1', url));
    expect(createPoolMock).toHaveBeenCalledTimes(2);

    const p = await openDmPool(mkConn('memo-2', url));
    expect(createPoolMock).toHaveBeenCalledTimes(3);
    expect(String(firstAttrs(2)['connectString'])).toContain('loginEncrypt=false');

    await a.close();
    await p.close();
  });
});
