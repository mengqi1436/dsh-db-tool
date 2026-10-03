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
      hasPassword: true,
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

  it('hasPassword 指示：带密码创建/更新后为 true，明文绝不出库；无密码为 false', () => {
    store.connections.create({ id: 'p', kind: 'mysql', fields: { host: 'h', password: 'SECRET1' } });
    store.connections.create({ id: 'n', kind: 'mysql', fields: { host: 'h' } });
    expect(store.connections.get('p')!.hasPassword).toBe(true);
    expect(store.connections.get('n')!.hasPassword).toBeUndefined();
    expect(store.connections.list().find((m) => m.id === 'p')!.hasPassword).toBe(true);
    // 密码留空更新 → 原密码保留，hasPassword 仍 true
    const updated = store.connections.update('p', { fields: { host: 'h2' } });
    expect(updated!.hasPassword).toBe(true);
    const listJson = readStoreFile(home, 'connections.json');
    expect(listJson).not.toContain('SECRET1');
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

  it('clearUrl 密码迁移：url 内嵌密码切分字段时迁移为 secrets.password', () => {
    store.connections.create({ id: 'm', kind: 'postgresql', url: 'postgresql://app:URLPASS%40x@h:5432/db' });
    const updated = store.connections.update('m', { clearUrl: true, fields: { host: 'h3', user: 'app' } });
    expect(updated!.mode).toBe('fields');
    const sec = store.secrets.get('m');
    expect(sec?.url).toBeUndefined();
    expect(sec?.password).toBe('URLPASS@x'); // decodeURIComponent 还原
    expect(store.connections.testTarget('m').fields?.password).toBe('URLPASS@x');
    // url 无内嵌密码时不误写空密码
    store.connections.create({ id: 'm2', kind: 'postgresql', url: 'postgresql://app@h:5432/db' });
    store.connections.update('m2', { clearUrl: true, fields: { host: 'h4' } });
    expect(store.secrets.get('m2')?.password).toBeUndefined();
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

describe('连接导出/导入', () => {
  let home: string;
  let store: DbToolStore;

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('exportBundle 包含全部连接记录与对应机密（含明文密码）', () => {
    store.connections.create({
      id: 'a',
      kind: 'mysql',
      name: '主库',
      url: URL_WITH_SECRET,
      fields: { host: 'localhost', password: 'FIELDSECRET' },
      ssl: true,
    });
    store.connections.create({ id: 'b', kind: 'sqlite' }); // 无机密

    const bundle = store.connections.exportBundle();
    expect(bundle.connections).toHaveLength(2);
    const recA = bundle.connections.find((c) => c.id === 'a')!;
    expect(recA.urlSafe).toBe('mysql://root:***@localhost:3306/shop'); // 记录侧仍脱敏
    expect(bundle.secrets['a']).toEqual({ url: URL_WITH_SECRET, password: 'FIELDSECRET' });
    expect(bundle.secrets['b']).toBeUndefined();
  });

  it('importBundle 跳过冲突 id（skipped），不覆盖已有数据；重复导入幂等', () => {
    store.connections.create({ id: 'a', kind: 'mysql', url: URL_WITH_SECRET });

    // 构造目标库：a 已存在（不同内容），b 为新连接
    const home2 = makeTempHome();
    const target = new DbToolStore(home2);
    try {
      target.connections.create({ id: 'a', kind: 'redis', url: 'redis://:OLDPW@h:6379' });
      const bundle = store.connections.exportBundle();
      // 补充一条新连接 b
      bundle.connections.push({ id: 'b', kind: 'postgresql', urlSafe: 'postgresql://u:***@h:5432/db' });
      bundle.secrets['b'] = { url: 'postgresql://u:BPASS@h:5432/db' };

      const res = target.connections.importBundle(bundle);
      expect(res.imported).toBe(1);
      expect(res.skipped).toEqual(['a']);
      expect(res.errors).toEqual([]);
      // 冲突的 a 未被覆盖
      expect(target.connections.testTarget('a').url).toBe('redis://:OLDPW@h:6379');
      // b 正常导入
      expect(target.connections.testTarget('b').url).toBe('postgresql://u:BPASS@h:5432/db');

      // 幂等重入：重复导入全部落入 skipped
      const res2 = target.connections.importBundle(bundle);
      expect(res2.imported).toBe(0);
      expect(res2.skipped.sort()).toEqual(['a', 'b']);
      expect(res2.errors).toEqual([]);
    } finally {
      cleanupDir(home2);
    }
  });

  it('importBundle 单条异常记入 errors 并继续后续条目', () => {
    const bundle = {
      connections: [
        { id: 'bad', kind: 'mysql' as const, fields: { host: 'h' } },
        { id: 'ok', kind: 'redis' as const },
      ],
      secrets: { bad: { password: 'X' } },
    };
    // 模拟单条写入机密时 I/O 故障：create 内 secrets.set 抛错 → 记入 errors，不阻塞后续
    const origSet = store.secrets.set.bind(store.secrets);
    store.secrets.set = (connId: string, patch: never) => {
      if (connId === 'bad') throw new Error('模拟写入失败');
      origSet(connId, patch);
    };
    try {
      const res = store.connections.importBundle(bundle);
      expect(res.imported).toBe(1);
      expect(res.skipped).toEqual([]);
      expect(res.errors).toEqual([{ id: 'bad', message: '模拟写入失败' }]);
      expect(store.connections.get('ok')).toBeDefined(); // 后续条目不受影响
    } finally {
      store.secrets.set = origSet;
    }
  });

  it('导出→导入 round-trip 后 testTarget 密码/URL 与源库一致', () => {
    store.connections.create({
      id: 'a',
      kind: 'mysql',
      name: '主库',
      url: URL_WITH_SECRET,
      fields: { host: 'localhost', port: 3306, database: 'shop', password: 'FIELDSECRET' },
      ssl: true,
    });
    store.connections.create({
      id: 'f',
      kind: 'postgresql',
      fields: { host: 'h2', port: 5432, user: 'app', password: 'FPASS' },
    });

    const home2 = makeTempHome();
    const target = new DbToolStore(home2);
    try {
      const res = target.connections.importBundle(store.connections.exportBundle());
      expect(res).toEqual({ imported: 2, skipped: [], errors: [] });

      const srcA = store.connections.testTarget('a');
      const dstA = target.connections.testTarget('a');
      expect(dstA.url).toBe(srcA.url); // 完整 URL 一致（含密码 TOPSECRET）
      expect(dstA.fields).toEqual(srcA.fields); // 含 password: FIELDSECRET
      expect(dstA.ssl).toBe(true);
      expect(dstA.meta.name).toBe('主库');

      const srcF = store.connections.testTarget('f');
      const dstF = target.connections.testTarget('f');
      expect(dstF.fields).toEqual(srcF.fields); // 含 password: FPASS
      // 目标库落盘检查：密码只在 secrets.json，connections.json 无明文
      const connsJson = readStoreFile(home2, 'connections.json');
      expect(connsJson).not.toContain('TOPSECRET');
      expect(connsJson).not.toContain('FIELDSECRET');
      expect(connsJson).not.toContain('FPASS');
    } finally {
      cleanupDir(home2);
    }
  });
});
