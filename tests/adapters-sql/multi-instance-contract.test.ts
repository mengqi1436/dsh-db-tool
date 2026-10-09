/**
 * 多实例并存 + close 幂等契约（有连接池、且建池惰性的驱动：mysql / postgresql / gaussdb）。
 *
 * 背景：dmdb 与 oracledb 的驱动都用「进程级池登记表 + 别名」登记池（dmdb 不传别名必抛
 * [20006]；oracledb 不传则退化为匿名池），两者各有专项回归测试。其余驱动经源码审计
 * 无命名参数、无进程级注册表——本测试把「同进程可并存多个独立实例」与「close 可重复
 * 调用」固化为契约，防止驱动升级引入同类全局状态或破坏幂等假设。
 *
 * 边界：这些驱动建池惰性（不触网），故本测试只证明「创建/关闭不抛错且实例彼此独立」，
 * **不证明实例可用**（可用性由真机集成用例覆盖）。
 * 不在本文件：redis / mongodb（创建即建连，见 integration.spec.ts 真机用例）；
 * sqlite（无池概念）；oracle / dmdb（专项回归测试）。
 */
import { describe, expect, it } from 'vitest';
import { createMysqlAdapter } from '../../lib/adapters/mysql/index.js';
import { createPostgresqlAdapter } from '../../lib/adapters/postgresql/index.js';
import { createGaussdbAdapter } from '../../lib/adapters/gaussdb/index.js';
import type { DatabaseAdapter, DbKind, ResolvedConnection } from '../../lib/adapters/types.js';

type Create = (conn: ResolvedConnection) => Promise<DatabaseAdapter>;

const CASES: Array<[DbKind, string, Create]> = [
  ['mysql', 'mysql://u:p@127.0.0.1:3326/dbx', createMysqlAdapter],
  ['postgresql', 'postgresql://u:p@127.0.0.1:5432/postgres', createPostgresqlAdapter],
  ['gaussdb', 'gaussdb://u:p@127.0.0.1:8000/postgres', createGaussdbAdapter],
];

describe.each(CASES)('%s 多实例并存契约', (kind, url, create) => {
  const mk = (id: string): ResolvedConnection => ({ meta: { id, kind }, url });

  it('同进程内可同时创建多个实例（同一连接），各自关闭互不影响', async () => {
    const a = await create(mk('a'));
    const b = await create(mk('b'));
    const c = await create(mk('c'));
    // 三个实例并存：能走到这里即未抛驱动级注册冲突；任一实例 close 失败都会让本用例 reject
    await expect(Promise.all([a.close(), b.close(), c.close()])).resolves.toHaveLength(3);
  });

  it('同一 connId 连续建两个实例也不冲突（测试连接 / 传输独立池路径）', async () => {
    const a = await create(mk('same'));
    const b = await create(mk('same'));
    // 只断言「两次创建都未抛」与「各自可关」——实例引用必然不同，断言它恒真无信息量
    await expect(Promise.all([a.close(), b.close()])).resolves.toHaveLength(2);
  });

  /**
   * manager 的 console 会话在授权复核失败路径会关闭同一适配器两次
   * （lib/manager.ts:554 的 finish('rollback') 与 :561 的 finally），故 close 必须幂等。
   * 鉴别力说明：pg / gaussdb 二次 end() 会真抛 "Called end on pool more than once"，
   * 本用例对二者有效；mysql2 的二次 end() 本身即 no-op，故对 mysql 恒绿（无信息量）。
   */
  it('close 幂等：重复 close 不抛错', async () => {
    const a = await create(mk('idem'));
    await a.close();
    await expect(a.close()).resolves.toBeUndefined();
  });
});
