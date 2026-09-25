import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbToolStore, redactUrl } from '../../lib/store/index.js';
import { cleanupDir, makeTempHome, readStoreFile } from './helpers.js';

const URL_WITH_SECRET = 'mysql://root:TOPSECRET@localhost:3306/shop';

describe('ConnectionStore', () => {
  let home: string;
  let store: DbToolStore;

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('create 返回脱敏 meta，密码不出现在 connections.json', () => {
    const meta = store.connections.create({
      id: 'main',
      kind: 'mysql',
      name: '主库',
      url: URL_WITH_SECRET,
      fields: { host: 'localhost', port: 3306, database: 'shop', password: 'FIELDSECRET' },
      ssl: true,
    });

    expect(meta).toEqual({
      id: 'main',
      kind: 'mysql',
      name: '主库',
      safeUrl: 'mysql://root:***@localhost:3306/shop',
      mode: 'url',
      host: 'localhost',
      port: 3306,
      database: 'shop',
    });

    const connsJson = readStoreFile(home, 'connections.json');
    expect(connsJson).not.toContain('TOPSECRET');
    expect(connsJson).not.toContain('FIELDSECRET');
    expect(connsJson).not.toContain('"password"');

    const secretsJson = readStoreFile(home, 'secrets.json');
    expect(secretsJson).toContain('TOPSECRET');
    expect(secretsJson).toContain('FIELDSECRET');
  });

  it('create 重复 id 抛错', () => {
    store.connections.create({ id: 'a', kind: 'redis' });
    expect(() => store.connections.create({ id: 'a', kind: 'redis' })).toThrow('连接已存在');
  });

  it('list / get 返回脱敏数据，get 不存在返回 undefined', () => {
    store.connections.create({ id: 'a', kind: 'redis', url: 'redis://:PW1@h:6379' });
    store.connections.create({ id: 'b', kind: 'sqlite', name: '本地' });

    const list = store.connections.list();
    expect(list).toHaveLength(2);
    expect(list.map((m) => m.id).sort()).toEqual(['a', 'b']);

    expect(store.connections.get('b')).toMatchObject({ id: 'b', kind: 'sqlite', name: '本地' });
    expect(store.connections.get('nope')).toBeUndefined();
  });

  it('update 更新 name/ssl/fields/url 并同步 secrets', () => {
    store.connections.create({ id: 'a', kind: 'postgresql', url: URL_WITH_SECRET });

    const updated = store.connections.update('a', {
      name: '新名字',
      ssl: true,
      url: 'postgresql://u2:NEWSECRET@h2:5432/db2',
      fields: { host: 'h2', port: 5432 },
    });
    expect(updated).toMatchObject({ name: '新名字', safeUrl: 'postgresql://u2:***@h2:5432/db2' });

    const secretsJson = readStoreFile(home, 'secrets.json');
    expect(secretsJson).toContain('NEWSECRET');
    expect(secretsJson).not.toContain('TOPSECRET');
    expect(store.connections.update('ghost', { name: 'x' })).toBeUndefined();
  });

  it('toMeta 回填 mode/user：fields 创建 → fields 模式，url 创建 → url 模式', () => {
    store.connections.create({ id: 'f', kind: 'mysql', fields: { host: 'h', port: 3306, user: 'app', database: 'db1' } });
    store.connections.create({ id: 'u', kind: 'mysql', url: URL_WITH_SECRET });
    const f = store.connections.get('f')!;
    expect(f.mode).toBe('fields');
    expect(f.user).toBe('app');
    expect(f.safeUrl).toBeUndefined();
    expect(store.connections.get('u')!.mode).toBe('url');
  });

  it('clearUrl：从 url 方式切到分字段保存时清除 urlSafe 与 secrets.url，密码保留', () => {
    store.connections.create({
      id: 'a', kind: 'postgresql', url: URL_WITH_SECRET,
      fields: { host: 'h1', password: 'FIELDSECRET' },
    });
    const updated = store.connections.update('a', {
      clearUrl: true,
      fields: { host: 'h2', port: 5432, user: 'u2' }, // password 留空 → secrets.password 原样保留
    });
    expect(updated).toMatchObject({ mode: 'fields', host: 'h2', user: 'u2' });
    expect(updated!.safeUrl).toBeUndefined();
    const sec = store.secrets.get('a');
    expect(sec?.url).toBeUndefined(); // url 机密已清除
    expect(sec?.password).toBe('FIELDSECRET'); // 分字段密码不受影响
    // testTarget 不再带 url，改走 fields
    const target = store.connections.testTarget('a');
    expect(target.url).toBeUndefined();
    expect(target.fields).toEqual({ host: 'h2', port: 5432, user: 'u2', password: 'FIELDSECRET' });
  });

  it('testTarget 返回含机密的 ResolvedConnection；不存在抛错', () => {
    store.connections.create({
      id: 'a',
      kind: 'mongodb',
      url: URL_WITH_SECRET,
      fields: { host: 'localhost', password: 'FIELDSECRET' },
      ssl: true,
    });

    const target = store.connections.testTarget('a');
    expect(target.meta.id).toBe('a');
    expect(target.url).toBe(URL_WITH_SECRET);
    expect(target.fields).toEqual({ host: 'localhost', password: 'FIELDSECRET' });
    expect(target.ssl).toBe(true);

    expect(() => store.connections.testTarget('ghost')).toThrow('连接不存在');
  });

  it('remove 级联删除 secrets 与全部项目的 grants', () => {
    store.connections.create({ id: 'a', kind: 'mysql', url: URL_WITH_SECRET });
    store.grants.grant('/p1', 'a', 'ro');
    store.grants.grant('/p2', 'a', 'rw');
    store.grants.grant('/p1', 'other', 'rw');

    expect(store.connections.remove('a')).toBe(true);
    expect(store.connections.get('a')).toBeUndefined();
    expect(store.secrets.get('a')).toBeUndefined();
    expect(store.grants.check('/p1', 'a')).toBeUndefined();
    expect(store.grants.check('/p2', 'a')).toBeUndefined();
    expect(store.grants.check('/p1', 'other')).toBe('rw'); // 其它连接不受影响
    expect(store.connections.remove('a')).toBe(false); // 二次删除返回 false
  });

  it('redactUrl 覆盖各类 URL 形态', () => {
    expect(redactUrl('mysql://root:pass@h/db')).toBe('mysql://root:***@h/db');
    expect(redactUrl('mongodb+srv://admin:s3cr3t@c/dbc')).toBe('mongodb+srv://admin:***@c/dbc');
    expect(redactUrl('redis://:pw@h:6379')).toBe('redis://:***@h:6379');
    expect(redactUrl('mysql://h/db')).toBe('mysql://h/db'); // 无凭证段
    expect(redactUrl('mysql://user@h/db')).toBe('mysql://user@h/db'); // 有用户无密码
    expect(redactUrl('sqlite:///data/app.db')).toBe('sqlite:///data/app.db'); // 非 URL 凭证形态
  });

  it('redactUrl 边界：密码含 @ 或 ?、主机端口、非 URL 文本', () => {
    expect(redactUrl('mysql://u:p@ss@h/db')).toBe('mysql://u:***@h/db'); // 以最后一个 @ 为界，整个 userinfo 段脱敏
    expect(redactUrl('mysql://u:p?x@h/db')).toBe('mysql://u:p?x@h/db'); // 密码含 ?：凭证段在 ? 截断，@ 不在段内 → 原样
    expect(redactUrl('mysql://u:pa/ss@h/db')).toBe('mysql://u:pa/ss@h/db'); // 密码含 /：定位不到凭证段，原样返回
    expect(redactUrl('mysql://h:3306/db')).toBe('mysql://h:3306/db'); // 主机:端口不误脱敏
    expect(redactUrl('see mysql://u:pw@h/db please')).toBe('see mysql://u:pw@h/db please'); // 仅识别开头的 URL
    expect(redactUrl('random text no url')).toBe('random text no url'); // 非 URL 原样返回不抛错
  });
});
