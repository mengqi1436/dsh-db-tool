// @ts-nocheck
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
});
