import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbToolStore } from '../../lib/store/index.js';
import { cleanupDir, makeTempHome } from './helpers.js';

describe('SecretsBox', () => {
  let home: string;
  let store: DbToolStore;

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('set 合并写入并保留旧键，get/delete 正常', () => {
    store.secrets.set('c1', { password: 'p1' });
    store.secrets.set('c1', { url: 'mysql://u:p1@h/db' });

    expect(store.secrets.get('c1')).toEqual({ password: 'p1', url: 'mysql://u:p1@h/db' });

    store.secrets.delete('c1');
    expect(store.secrets.get('c1')).toBeUndefined();
    store.secrets.delete('c1'); // 重复删除静默
  });

  it('get 返回拷贝，外部修改不污染内部状态', () => {
    store.secrets.set('c1', { password: 'real' });
    const got = store.secrets.get('c1')!;
    got.password = 'tampered';
    expect(store.secrets.get('c1')!.password).toBe('real');
  });

  it('任何公开 API 返回值与元数据文件的序列化结果都不含密码', () => {
    store.connections.create({
      id: 'c1',
      kind: 'postgresql',
      name: '生产库',
      url: 'postgresql://admin:TOPSECRET@db.local:5432/prod',
      fields: { host: 'db.local', port: 5432, database: 'prod', password: 'FIELDSECRET' },
    });
    store.grants.grant('/some/project', 'c1', 'rw');
    store.audit.append({
      projectPathKey: '/some/project',
      connId: 'c1',
      action: 'query',
      statement: 'SELECT 1',
      danger: 'none',
      confirmed: false,
      ok: true,
    });

    // 全 store 序列化快照（list/get/grantsFor/audit tail 均在其中）
    const snapshot = JSON.stringify(store);
    expect(snapshot).not.toContain('TOPSECRET');
    expect(snapshot).not.toContain('FIELDSECRET');

    // 落盘文件：仅 secrets.json 持有机密
    const dir = path.join(home, 'db-tool');
    for (const name of ['connections.json', 'grants.json', 'audit.jsonl']) {
      expect(fs.readFileSync(path.join(dir, name), 'utf8')).not.toContain('TOPSECRET');
    }
    expect(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).toContain('TOPSECRET');

    // ConnectionMeta.safeUrl 密码段必须为 ***
    const meta = store.connections.get('c1')!;
    expect(meta.safeUrl).toBe('postgresql://admin:***@db.local:5432/prod');
  });

  it('secrets.json 写入后权限为 0600（POSIX；Windows 尽力而为跳过断言）', () => {
    if (process.platform === 'win32') return;
    store.secrets.set('c1', { password: 'p' });
    const mode = fs.statSync(path.join(home, 'db-tool', 'secrets.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
