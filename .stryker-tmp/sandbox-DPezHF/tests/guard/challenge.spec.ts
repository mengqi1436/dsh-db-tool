/** ChallengeStore：一次性、绑定语句 hash、TTL 过期、sweep、dispose */
// @ts-nocheck

import { describe, expect, it } from 'vitest';
import { ChallengeStore } from '../../lib/guard/index.js';

function makeStore(ttlMs = 5 * 60 * 1000) {
  let now = 1_000_000;
  const store = new ChallengeStore({ ttlMs, sweepIntervalMs: 0, now: () => now });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ChallengeStore', () => {
  it('一次性：consume 成功后立即失效', () => {
    const { store } = makeStore();
    const ch = store.create('DROP TABLE users');
    expect(store.consume(ch.id, 'DROP TABLE users')).toBe(true);
    expect(store.consume(ch.id, 'DROP TABLE users')).toBe(false);
  });

  it('绑定语句：换语句消费失败（重放改语句被拒）', () => {
    const { store } = makeStore();
    const ch = store.create('DROP TABLE users');
    expect(store.consume(ch.id, 'DROP TABLE users2')).toBe(false);
  });

  it('TTL 过期后 consume 失败', () => {
    const { store, advance } = makeStore(5 * 60 * 1000);
    const ch = store.create('DROP TABLE users');
    advance(5 * 60 * 1000 + 1);
    expect(store.consume(ch.id, 'DROP TABLE users')).toBe(false);
  });

  it('TTL 内正常消费', () => {
    const { store, advance } = makeStore(5 * 60 * 1000);
    const ch = store.create('DROP TABLE users');
    advance(4 * 60 * 1000);
    expect(store.consume(ch.id, 'DROP TABLE users')).toBe(true);
  });

  it('sweep 清理过期项', () => {
    const { store, advance } = makeStore(1000);
    const a = store.create('A');
    const b = store.create('B');
    advance(2000);
    store.sweep();
    expect(store.consume(a.id, 'A')).toBe(false);
    expect(store.consume(b.id, 'B')).toBe(false);
  });

  it('dispose 后不可再用', () => {
    const { store } = makeStore();
    store.dispose();
    expect(() => store.create('X')).toThrow();
    expect(store.consume('c_any', 'X')).toBe(false);
  });

  it('id 形如 c_<hex> 且互不相同', () => {
    const { store } = makeStore();
    const a = store.create('A');
    const b = store.create('B');
    expect(a.id).toMatch(/^c_[0-9a-f]{24}$/);
    expect(a.id).not.toBe(b.id);
  });
});
