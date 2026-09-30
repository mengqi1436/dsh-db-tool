/**
 * URL 模式独立凭据注入（urlUser/urlPassword → URL userinfo）单测。
 * 覆盖：mergeUrlCredentials 纯函数（编码往返/单项覆盖/脱敏基底替换/错误路径）
 * 与 ConnectionStore create/update 的存储集成（secrets 含编码凭据、urlSafe 脱敏）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DbToolStore, mergeUrlCredentials } from '../../lib/store/index.js';
import { DbToolService } from '../../lib/manager.js';
import { fakeAdapter } from '../tool/fixture.js';
import { cleanupDir, makeTempHome, readStoreFile } from './helpers.js';

describe('mergeUrlCredentials（纯函数）', () => {
  it('两者均空 → 原样返回（undefined 透传，现状语义不变）', () => {
    expect(mergeUrlCredentials({ url: 'mysql://h:3306/db' })).toBe('mysql://h:3306/db');
    expect(mergeUrlCredentials({ url: undefined, urlUser: '', urlPassword: '' })).toBeUndefined();
  });

  it('注入用户名+密码：特殊字符自动 percent-encode', () => {
    const out = mergeUrlCredentials({
      url: 'mysql://localhost:3306/shop',
      urlUser: 'root',
      urlPassword: 'p@ss:wo/rd?',
    });
    expect(out).toBe('mysql://root:p%40ss%3Awo%2Frd%3F@localhost:3306/shop');
  });

  it('只注入密码：保留基底用户名；redis 无用户名形态兼容', () => {
    expect(mergeUrlCredentials({ url: 'redis://h:6379/0', urlPassword: 'pw' })).toBe('redis://:pw@h:6379/0');
    expect(mergeUrlCredentials({ url: 'mysql://old@h:3306', urlPassword: 'np' })).toBe('mysql://old:np@h:3306');
  });

  it('只注入用户名：保留基底密码', () => {
    expect(mergeUrlCredentials({ url: 'mysql://:old@h:3306', urlUser: 'u' })).toBe('mysql://u:old@h:3306');
  });

  it('覆盖已有凭据', () => {
    expect(mergeUrlCredentials({ url: 'mysql://u:p@h:3306', urlUser: 'u2', urlPassword: 'p2' })).toBe(
      'mysql://u2:p2@h:3306',
    );
  });

  it('mongodb+srv:// 形态：注入凭据不动 host（SRV 禁端口约束不受影响）', () => {
    expect(mergeUrlCredentials({ url: 'mongodb+srv://u@cluster.example.com/db', urlPassword: 'p' })).toBe(
      'mongodb+srv://u:p@cluster.example.com/db',
    );
  });

  it('脱敏 url（含 :***@）→ 以 secretsUrl 为基底整体替换', () => {
    expect(
      mergeUrlCredentials({
        url: 'mysql://root:***@h:3306/db',
        urlPassword: 'np',
        secretsUrl: 'mysql://root:OLD@h:3306/db',
      }),
    ).toBe('mysql://root:np@h:3306/db');
  });

  it('脱敏 url 无 secretsUrl → 报错（新建场景不应输入 ***）', () => {
    expect(() => mergeUrlCredentials({ url: 'mysql://root:***@h:3306', urlPassword: 'x' })).toThrow(/脱敏/);
  });

  it('无效 URL → 报错', () => {
    expect(() => mergeUrlCredentials({ url: 'not a url', urlPassword: 'x' })).toThrow(/URL 无效/);
  });

  it('url 为 undefined → 返回 undefined（凭据忽略）', () => {
    expect(mergeUrlCredentials({ url: undefined, urlUser: 'u' })).toBeUndefined();
  });
});

describe('mergeUrlCredentials（公开官方样例）', () => {
  it('libpq 官方形态：无密码 + query 参数 → 注入密码后 query 原样保留', () => {
    // PostgreSQL 文档 34.1.1.2：postgresql://other@localhost/otherdb?connect_timeout=10&application_name=myapp
    expect(
      mergeUrlCredentials({
        url: 'postgresql://other@localhost/otherdb?connect_timeout=10&application_name=myapp',
        urlPassword: 'p@ss',
      }),
    ).toBe('postgresql://other:p%40ss@localhost/otherdb?connect_timeout=10&application_name=myapp');
  });

  it('libpq 官方 percent-encoding 语义：密码 @ 编码为 %40（与手写 %40 等价）', () => {
    const injected = mergeUrlCredentials({ url: 'postgresql://u@h/db', urlPassword: 'a@b' });
    const handwritten = 'postgresql://u:a%40b@h/db';
    expect(injected).toBe(handwritten);
  });

  it('libpq IPv6 字面量 host：注入凭据后 [::1] 形态保留', () => {
    expect(mergeUrlCredentials({ url: 'postgresql://[2001:db8::1234]:5432/db', urlUser: 'u', urlPassword: 'p' })).toBe(
      'postgresql://u:p@[2001:db8::1234]:5432/db',
    );
  });

  it('MongoDB Atlas 官方样例（+srv + query）：注入凭据不动 host 与 query', () => {
    const atlas = 'mongodb+srv://user@cluster0.ab1cd.mongodb.net/myFirstDatabase?retryWrites=true&w=majority';
    expect(mergeUrlCredentials({ url: atlas, urlPassword: 'p@ss w' })).toBe(
      'mongodb+srv://user:p%40ss%20w@cluster0.ab1cd.mongodb.net/myFirstDatabase?retryWrites=true&w=majority',
    );
  });

  it('MySQL 预编码基底：注入用户名不破坏已编码密码', () => {
    expect(mergeUrlCredentials({ url: 'mysql://old:pa%40ss@h:3306/db', urlUser: 'new' })).toBe(
      'mysql://new:pa%40ss@h:3306/db',
    );
  });

  it('Redis 6+ ACL 官方形态：default 用户 + 密码', () => {
    expect(mergeUrlCredentials({ url: 'redis://redis.example.com:6379/0', urlUser: 'default', urlPassword: 'secret' })).toBe(
      'redis://default:secret@redis.example.com:6379/0',
    );
  });

  it('Oracle easy connect 官方样例：oracle://admin@dbhost:1521/SERVICE 注入密码', () => {
    expect(
      mergeUrlCredentials({ url: 'oracle://admin@dbhost.example.com:1521/mycontainerservice', urlPassword: 'pw' }),
    ).toBe('oracle://admin:pw@dbhost.example.com:1521/mycontainerservice');
  });

  it('用户名含特殊字符（user@corp 形邮箱前缀）→ username 同样 percent-encode', () => {
    expect(mergeUrlCredentials({ url: 'mysql://h:3306', urlUser: 'user@corp', urlPassword: 'p' })).toBe(
      'mysql://user%40corp:p@h:3306',
    );
  });

  it('非 ASCII 凭据（中文密码）→ 按 UTF-8 percent-encode', () => {
    const out = mergeUrlCredentials({ url: 'mysql://h:3306', urlPassword: '密码123' });
    expect(out).toBe('mysql://:%E5%AF%86%E7%A0%81123@h:3306');
  });

  it('空串凭据（trim 前）视为未提供 → 原样返回', () => {
    expect(mergeUrlCredentials({ url: 'mysql://h:3306', urlUser: '', urlPassword: '' })).toBe('mysql://h:3306');
  });

  it('大写 scheme：WHATWG URL 规范化为小写（行为锁定）', () => {
    expect(mergeUrlCredentials({ url: 'POSTGRES://u@h/db', urlPassword: 'p' })).toBe('postgres://u:p@h/db');
  });

  it('无凭据字段 + 非法 URL → 原样返回不抛错（短路守卫）', () => {
    expect(mergeUrlCredentials({ url: 'not a url' })).toBe('not a url');
    expect(mergeUrlCredentials({ url: undefined })).toBeUndefined();
  });

  it('urlUser 空串：不注入、保留基底用户名', () => {
    expect(mergeUrlCredentials({ url: 'mysql://keep@h:3306', urlUser: '', urlPassword: 'p' })).toBe(
      'mysql://keep:p@h:3306',
    );
  });

  it('urlPassword 空串：不注入、保留基底密码', () => {
    expect(mergeUrlCredentials({ url: 'mysql://u:keep@h:3306', urlUser: 'nu', urlPassword: '' })).toBe(
      'mysql://nu:keep@h:3306',
    );
  });
});

describe('ConnectionStore URL 模式独立凭据（存储集成）', () => {
  let home: string;
  let store: DbToolStore;

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('create：urlUser/urlPassword 注入后按 url 路径存储（secrets 含编码凭据，urlSafe 脱敏）', () => {
    const meta = store.connections.create({
      id: 'a',
      kind: 'mysql',
      url: 'mysql://localhost:3306/shop',
      urlUser: 'root',
      urlPassword: 'p@ss',
    });
    expect(meta.safeUrl).toBe('mysql://root:***@localhost:3306/shop');
    expect(meta.mode).toBe('url');

    const secretsJson = readStoreFile(home, 'secrets.json');
    expect(secretsJson).toContain('p%40ss');
    expect(readStoreFile(home, 'connections.json')).not.toContain('p@ss');
  });

  it('create：仅 urlUser → 用户名注入、无密码段（oracle 必填用户名形态）', () => {
    const meta = store.connections.create({
      id: 'b',
      kind: 'oracle',
      url: 'oracle://h:1521/SVC',
      urlUser: 'sysoper',
    });
    expect(meta.safeUrl).toBe('oracle://sysoper@h:1521/SVC');
    expect(readStoreFile(home, 'secrets.json')).toContain('oracle://sysoper@h:1521/SVC');
  });

  it('update：url 未发 + urlPassword → 以已存 secrets.url 为基底仅覆盖密码', () => {
    store.connections.create({ id: 'a', kind: 'mysql', url: 'mysql://root:OLD@h:3306/db' });
    const meta = store.connections.update('a', { urlPassword: 'NEW' });
    expect(meta?.safeUrl).toBe('mysql://root:***@h:3306/db');

    const secretsJson = readStoreFile(home, 'secrets.json');
    expect(secretsJson).toContain('NEW');
    expect(secretsJson).not.toContain('OLD');
  });

  it('update：发脱敏 url（客户端回填值）+ urlPassword → 基底替换，*** 不落库', () => {
    store.connections.create({ id: 'a', kind: 'mysql', url: 'mysql://root:OLD@h:3306/db' });
    const meta = store.connections.update('a', { url: 'mysql://root:***@h:3306/db', urlPassword: 'NEW2' });
    expect(meta?.safeUrl).toBe('mysql://root:***@h:3306/db');

    const secretsJson = readStoreFile(home, 'secrets.json');
    expect(secretsJson).not.toContain('***');
    expect(secretsJson).toContain('NEW2');
  });

  it('create 纯 fields（无 url 无密码）→ 不写 secrets 记录', () => {
    store.connections.create({ id: 'f1', kind: 'mysql', fields: { host: 'h', port: 3306 } });
    expect(store.secrets.get('f1')).toBeUndefined();
    // 无任何机密时 secrets.json 整个文件都不落盘（比"无记录"更强的证据）
    expect(fs.existsSync(path.join(home, 'db-tool', 'secrets.json'))).toBe(false);
  });

  it('update 只发 url（无凭据字段）→ 正常更新 URL', () => {
    store.connections.create({ id: 'a', kind: 'mysql', url: 'mysql://root:OLD@h:3306/db' });
    const meta = store.connections.update('a', { url: 'mysql://u2:p2@h2:3306/db2' });
    expect(meta?.safeUrl).toBe('mysql://u2:***@h2:3306/db2');
    expect(readStoreFile(home, 'secrets.json')).toContain('p2');
    expect(readStoreFile(home, 'secrets.json')).not.toContain('OLD');
  });

  it('update 只发 urlUser（有已存 url）→ 仅覆盖用户名', () => {
    store.connections.create({ id: 'a', kind: 'mysql', url: 'mysql://u:p@h:3306/db' });
    const meta = store.connections.update('a', { urlUser: 'nu' });
    expect(meta?.safeUrl).toBe('mysql://nu:***@h:3306/db');
    expect(readStoreFile(home, 'secrets.json')).toContain('mysql://nu:p@h:3306/db');
  });

  it('update 发 url+urlPassword 于从未有机密的连接 → 正常建立 secrets（无已存可回退不抛错）', () => {
    store.connections.create({ id: 'f2', kind: 'mysql', fields: { host: 'h', port: 3306 } });
    const meta = store.connections.update('f2', { url: 'mysql://h:3306/db', urlPassword: 'p' });
    expect(meta?.safeUrl).toBe('mysql://:***@h:3306/db');
    expect(readStoreFile(home, 'secrets.json')).toContain('mysql://:p@h:3306/db');
  });

  it('update 只发 urlUser（url 未发且连接无已存 url）→ 无操作不抛错', () => {
    store.connections.create({ id: 'f3', kind: 'mysql', fields: { host: 'h' } });
    const meta = store.connections.update('f3', { urlUser: 'u' });
    expect(meta?.mode).toBe('fields');
    expect(store.secrets.get('f3')).toBeUndefined();
  });
});

describe('DbToolService.testDraft URL 模式独立凭据（拼回语义）', () => {
  let home: string;

  beforeEach(() => {
    home = makeTempHome();
  });

  afterEach(() => cleanupDir(home));

  it('编辑场景：url 未发 + urlPassword → 拼回已存 secrets.url 后注入新密码交给适配器', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'a', kind: 'mysql', url: 'mysql://root:OLD@h:3306/db' });
    let seenUrl: string | undefined;
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenUrl = conn.url;
        return Promise.resolve(fakeAdapter({ kind: 'mysql' }));
      },
    });
    try {
      const r = await service.testDraft({ kind: 'mysql', connId: 'a', urlPassword: 'NEW' });
      expect(r.ok).toBe(true);
      expect(seenUrl).toBe('mysql://root:NEW@h:3306/db');
    } finally {
      await service.dispose();
    }
  });

  it('编辑场景：发脱敏回填 url + urlUser → 基底替换后注入用户名', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'a', kind: 'oracle', url: 'oracle://old:pw@h:1521/SVC' });
    let seenUrl: string | undefined;
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenUrl = conn.url;
        return Promise.resolve(fakeAdapter({ kind: 'oracle' }));
      },
    });
    try {
      await service.testDraft({ kind: 'oracle', connId: 'a', url: 'oracle://old:***@h:1521/SVC', urlUser: 'newuser' });
      expect(seenUrl).toBe('oracle://newuser:pw@h:1521/SVC');
    } finally {
      await service.dispose();
    }
  });

  it('无凭据字段 → 行为与现状一致（拼回已存 URL 原样）', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'a', kind: 'redis', url: 'redis://:PW@h:6379/0' });
    let seenUrl: string | undefined;
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenUrl = conn.url;
        return Promise.resolve(fakeAdapter({ kind: 'redis' }));
      },
    });
    try {
      await service.testDraft({ kind: 'redis', connId: 'a' });
      expect(seenUrl).toBe('redis://:PW@h:6379/0');
    } finally {
      await service.dispose();
    }
  });

  it('connId 指向无机密连接 → 不抛错（secrets.get 为 undefined 的路径）', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'plain', kind: 'mysql', fields: { host: 'h', port: 3306 } });
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => Promise.resolve(fakeAdapter({ kind: 'mysql' })),
    });
    try {
      const r = await service.testDraft({ kind: 'mysql', connId: 'plain' });
      expect(r.ok).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it('显式发 url + connId 有已存 url → 优先用户所发 url（不被已存覆盖）', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'a', kind: 'mysql', url: 'mysql://saved:s3cret@h:3306/db' });
    let seenUrl: string | undefined;
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenUrl = conn.url;
        return Promise.resolve(fakeAdapter({ kind: 'mysql' }));
      },
    });
    try {
      await service.testDraft({ kind: 'mysql', connId: 'a', url: 'mysql://draft:pw@other:3306/db' });
      expect(seenUrl).toBe('mysql://draft:pw@other:3306/db');
    } finally {
      await service.dispose();
    }
  });

  it('fields 模式连接：发 fields（密码留空）+ connId → 拼回已存 fields 密码（不回传客户端）', async () => {
    const store = new DbToolStore(home);
    store.connections.create({
      id: 'f',
      kind: 'mysql',
      fields: { host: 'h', port: 3306, user: 'root', password: 'FIELDPW' },
    });
    let seenFields: Record<string, unknown> | undefined;
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenFields = conn.fields;
        return Promise.resolve(fakeAdapter({ kind: 'mysql' }));
      },
    });
    try {
      const r = await service.testDraft({
        kind: 'mysql',
        connId: 'f',
        fields: { host: 'h', port: 3306, user: 'root' }, // 编辑表单形态：密码框留空
      });
      expect(r.ok).toBe(true);
      expect(seenFields?.['password']).toBe('FIELDPW');
    } finally {
      await service.dispose();
    }
  });

  it('纯 kind 草稿（无 url/fields/connId）→ 适配器收到 rc.url/rc.fields 均未设置', async () => {
    const store = new DbToolStore(home);
    let seenUrl: unknown = 'SENTINEL';
    let seenFields: unknown = 'SENTINEL';
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenUrl = conn.url;
        seenFields = conn.fields;
        return Promise.resolve(fakeAdapter({ kind: 'mysql' }));
      },
    });
    try {
      await service.testDraft({ kind: 'mysql' });
      expect(seenUrl).toBeUndefined();
      expect(seenFields).toBeUndefined();
    } finally {
      await service.dispose();
    }
  });

  it('fields 连接（有已存密码）+ 只发 kind+connId（不发 fields）→ 不抛错、不拼回', async () => {
    const store = new DbToolStore(home);
    store.connections.create({
      id: 'f',
      kind: 'mysql',
      fields: { host: 'h', port: 3306, password: 'PW' },
    });
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => Promise.resolve(fakeAdapter({ kind: 'mysql' })),
    });
    try {
      const r = await service.testDraft({ kind: 'mysql', connId: 'f' });
      expect(r.ok).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it('无机密连接 + 发 fields → 正常测试（无密码可拼回不报错）', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'plain', kind: 'mysql', fields: { host: 'h', port: 3306 } });
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => Promise.resolve(fakeAdapter({ kind: 'mysql' })),
    });
    try {
      const r = await service.testDraft({ kind: 'mysql', connId: 'plain', fields: { host: 'h' } });
      expect(r.ok).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it('ssl: true 草稿 → 适配器收到 rc.ssl=true', async () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'plain', kind: 'mysql', fields: { host: 'h' } });
    let seenSsl: unknown = 'SENTINEL';
    const service = new DbToolService(store, {
      adapterResolver: async () => (conn) => {
        seenSsl = conn.ssl;
        return Promise.resolve(fakeAdapter({ kind: 'mysql' }));
      },
    });
    try {
      await service.testDraft({ kind: 'mysql', connId: 'plain', ssl: true });
      expect(seenSsl).toBe(true);
    } finally {
      await service.dispose();
    }
  });
});
