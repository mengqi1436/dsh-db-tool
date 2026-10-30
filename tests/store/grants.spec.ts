import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProjectKey } from '../../lib/store/normalize.js';
import { DbToolStore } from '../../lib/store/index.js';
import { cleanupDir, makeTempHome } from './helpers.js';

describe('GrantStore', () => {
  let home: string;
  let store: DbToolStore;
  const p1 = normalizeProjectKey('/work/app1');
  const p2 = normalizeProjectKey('/work/app2');

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('grant 后 grantsFor/check 可见', () => {
    store.grants.grant(p1, 'conn-a', 'ro');
    expect(store.grants.grantsFor(p1)).toEqual([{ connId: 'conn-a', mode: 'ro' }]);
    expect(store.grants.check(p1, 'conn-a')).toBe('ro');
    expect(store.grants.check(p1, 'ghost')).toBeUndefined();
    expect(store.grants.check(p2, 'conn-a')).toBeUndefined(); // 其它项目不受影响
  });

  it('grants.json 以 0600 落盘（对齐 dsh-ssh-tunnel；Windows chmod 仅只读位，仅 posix 断言）', () => {
    store.grants.grant(p1, 'conn-a', 'ro');
    const file = path.join(home, 'db-tool', 'grants.json');
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('同连接重复授权更新模式（ro → rw）', () => {
    store.grants.grant(p1, 'conn-a', 'ro');
    store.grants.grant(p1, 'conn-a', 'rw');
    expect(store.grants.grantsFor(p1)).toEqual([{ connId: 'conn-a', mode: 'rw' }]);
    expect(store.grants.check(p1, 'conn-a')).toBe('rw');
  });

  it('revoke 撤销后不可见；撤销不存在者静默', () => {
    store.grants.grant(p1, 'conn-a', 'ro');
    store.grants.grant(p1, 'conn-b', 'rw');
    store.grants.revoke(p1, 'conn-a');
    expect(store.grants.check(p1, 'conn-a')).toBeUndefined();
    expect(store.grants.check(p1, 'conn-b')).toBe('rw');
    store.grants.revoke(p1, 'ghost');
    store.grants.revoke(p2, 'conn-a'); // 其它项目键
    expect(store.grants.grantsFor(p1)).toEqual([{ connId: 'conn-b', mode: 'rw' }]);
  });

  it('同一连接多项目授权互不干扰', () => {
    store.grants.grant(p1, 'conn-a', 'ro');
    store.grants.grant(p2, 'conn-a', 'rw');
    store.grants.revoke(p1, 'conn-a');
    expect(store.grants.check(p2, 'conn-a')).toBe('rw');
  });

  it('grantsFor 未授权项目返回空数组', () => {
    expect(store.grants.grantsFor(p1)).toEqual([]);
  });

  it('无变化操作不落盘：revoke 未命中 / removeConn 未命中时文件字节保持原样', () => {
    const file = path.join(home, 'db-tool', 'grants.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = '{"grants":{"k1":[],"k2":[{"connId":"a","mode":"ro","grantedAt":"T"}]}}';
    fs.writeFileSync(file, raw, 'utf8');
    store = new DbToolStore(home);

    store.grants.revoke('k2', 'ghost'); // 长度未变 → 不得重写（含空数组键 k1 不得被清理）
    store.grants.removeConn('ghost'); // 全键未变 → 不得重写
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);

    // 真正删除：k2 整键删除，空数组键 k1 原样保留
    store.grants.removeConn('a');
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as { grants: Record<string, unknown> };
    expect(Object.keys(after.grants).sort()).toEqual(['k1']);
    expect(after.grants.k1).toEqual([]);
  });

  it('revoke 清空最后一项时整键从 grants.json 删除', () => {
    store.grants.grant('rkey', 'only', 'ro');
    store.grants.revoke('rkey', 'only');
    expect(store.grants.grantsFor('rkey')).toEqual([]);
    const data = JSON.parse(fs.readFileSync(path.join(home, 'db-tool', 'grants.json'), 'utf8')) as {
      grants: Record<string, unknown>;
    };
    expect('rkey' in data.grants).toBe(false); // 空列表键必须删掉，而非残留 [] 永久占位
  });

  it('空库 removeConn 未命中时不产生 grants.json', () => {
    expect(fs.existsSync(path.join(home, 'db-tool', 'grants.json'))).toBe(false);
    store.grants.removeConn('nobody');
    expect(fs.existsSync(path.join(home, 'db-tool', 'grants.json'))).toBe(false);
  });

  it('迁移：修复前保留大小写的键读入即归一，check 以归一写法命中（回归：Windows 大小写授权错位）', () => {
    // 仅在键与归一形式存在差异的平台上可构造（Windows 全路径小写；POSIX 无差异则跳过）
    const legacy = process.platform === 'win32' ? 'E:\\GitHub\\MyApp' : '';
    if (!legacy) return;
    const file = path.join(home, 'db-tool', 'grants.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const normalized = normalizeProjectKey(legacy); // 'e:/github/myapp'
    expect(normalized).not.toBe(legacy.replace(/\\/g, '/')); // 确认确有归一差异
    fs.writeFileSync(
      file,
      JSON.stringify({
        grants: {
          [legacy.replace(/\\/g, '/')]: [{ connId: 'conn-a', mode: 'ro', grantedAt: '2026-01-01T00:00:00.000Z' }],
        },
      }),
      'utf8',
    );
    store = new DbToolStore(home);
    // 授权写法（旧格式保留大小写）与会话 cwd 写法（任意大小写）都必须命中同一条授权
    expect(store.grants.check(normalized, 'conn-a')).toBe('ro');
    expect(store.grants.check(normalizeProjectKey('e:/GITHUB/myapp'), 'conn-a')).toBe('ro');
    // 变体合并后 grantsFor 以归一键返回
    expect(store.grants.grantsFor(normalized)).toEqual([{ connId: 'conn-a', mode: 'ro' }]);
  });

  it('迁移：同一目录的大小写变体键合并为一条，同连接 rw 胜出且 grantedAt 取较新', () => {
    if (process.platform !== 'win32') return;
    const file = path.join(home, 'db-tool', 'grants.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        grants: {
          'e:/GitHub/MyApp': [{ connId: 'conn-a', mode: 'ro', grantedAt: '2026-01-01T00:00:00.000Z' }],
          'E:/github/MYAPP': [
            { connId: 'conn-a', mode: 'rw', grantedAt: '2026-01-02T00:00:00.000Z' },
            { connId: 'conn-b', mode: 'ro', grantedAt: '2026-01-02T00:00:00.000Z' },
          ],
        },
      }),
      'utf8',
    );
    store = new DbToolStore(home);
    const key = normalizeProjectKey('e:/github/myapp');
    expect(store.grants.check(key, 'conn-a')).toBe('rw'); // rw 胜出
    expect(store.grants.check(key, 'conn-b')).toBe('ro');
    expect(store.grants.grantsFor(key)).toEqual([
      { connId: 'conn-a', mode: 'rw' },
      { connId: 'conn-b', mode: 'ro' },
    ]);
    // 下次 save 落盘为单一归一键
    store.grants.grant(key, 'conn-c', 'ro');
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as { grants: Record<string, unknown> };
    expect(Object.keys(after.grants)).toEqual([key]);
  });
});
