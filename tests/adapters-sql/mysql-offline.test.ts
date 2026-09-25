/**
 * MySQL 适配器离线负向用例（mock-free，不连服务器）。
 * mysql2 createPool 惰性建连，以下用例的断言都在触达网络之前抛出。
 * 覆盖：ro 模式 query 首词只读白名单、defaultDb 从 URL pathname 解析默认库。
 */
import { describe, expect, it } from 'vitest';
import { createMysqlAdapter } from '../../lib/adapters/mysql/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

function connByUrl(url: string): ResolvedConnection {
  return { meta: { id: 'mysql-offline', kind: 'mysql' }, url };
}

describe('mysql 适配器（离线负向用例）', () => {
  it('ro 模式：query 首词白名单外的语句被拒绝（DRIVER_ERROR，不触达服务器）', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/dbx'), { mode: 'ro' });
    try {
      await expect(a.query('UPDATE t SET x = 1')).rejects.toThrow(/DRIVER_ERROR[\s\S]*只读/);
      await expect(a.query('INSERT INTO t VALUES (1)')).rejects.toThrow(/只读/);
      await expect(a.query('DELETE FROM t')).rejects.toThrow(/只读/);
      await expect(a.query('DROP TABLE t')).rejects.toThrow(/只读/);
      await expect(a.query('CREATE TABLE t9 (id INT)')).rejects.toThrow(/只读/);
      await expect(a.query('ALTER TABLE t ADD c INT')).rejects.toThrow(/只读/);
      await expect(a.query('GRANT ALL ON *.* TO u')).rejects.toThrow(/只读/);
      await expect(a.query('/* 注释 */ UPDATE t SET x = 1')).rejects.toThrow(/只读/);
    } finally {
      await a.close();
    }
  });

  it('ro 模式：白名单首词（含大小写/空白）不被适配器层拒绝（此后才触达服务器）', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/dbx'), { mode: 'ro' });
    try {
      // 校验层放行；离线环境随后报连接错误（而非「只读拒绝」），以此区分两层
      await expect(a.query('  select 1')).rejects.toThrow(/mysql 查询失败/).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).not.toMatch(/只读/);
      });
    } finally {
      await a.close();
    }
  });

  it('defaultDb：URL pathname 提供默认库，非法库名被 assertIdent 拒绝', async () => {
    // 库名 db`x（URL 编码 %60）含非法字符：defaultDb 解析后过校验抛「非法」；
    // 若未实现 URL 解析则会抛「未指定数据库」，以此区分两种实现
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326/db%60x'));
    try {
      await expect(a.listTables()).rejects.toThrow(/非法/);
      await expect(a.describeTable('t')).rejects.toThrow(/非法/);
      await expect(a.previewRows('t', 1)).rejects.toThrow(/非法/);
    } finally {
      await a.close();
    }
  });

  it('defaultDb：URL 无 pathname → 报「未指定数据库」', async () => {
    const a = await createMysqlAdapter(connByUrl('mysql://u:p@127.0.0.1:3326'));
    try {
      await expect(a.listTables()).rejects.toThrow(/未指定数据库/);
    } finally {
      await a.close();
    }
  });

  it('defaultDb：fields.database 优先于 URL pathname', async () => {
    const a = await createMysqlAdapter({
      meta: { id: 'mysql-offline', kind: 'mysql' },
      url: 'mysql://u:p@127.0.0.1:3326/db%60x',
      fields: { database: 'realdb' },
    });
    try {
      // fields 提供的库名合法，通过校验后才会去连服务器（离线报连接错误，不是校验错误）
      await expect(a.listTables()).rejects.toThrow(/mysql 列出数据库|mysql 列出表/);
    } finally {
      await a.close();
    }
  });
});
