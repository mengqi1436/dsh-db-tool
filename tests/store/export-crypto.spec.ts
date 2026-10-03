import { describe, expect, it } from 'vitest';
import { decryptPayload, DECRYPT_FAIL_MESSAGE, encryptPayload } from '../../lib/store/export-crypto.js';

describe('export-crypto', () => {
  const PASS = '迁移口令-2024';

  it('加解密 round-trip：对象原样还原', () => {
    const plain = {
      connections: [{ id: 'a', kind: 'mysql', urlSafe: 'mysql://u:***@h/db' }],
      secrets: { a: { url: 'mysql://u:TOPSECRET@h/db', password: 'TOPSECRET' } },
    };
    const encrypted = encryptPayload(plain, PASS);
    // 密文中不得出现明文机密
    expect(encrypted).not.toContain('TOPSECRET');
    const box = JSON.parse(encrypted) as Record<string, unknown>;
    expect(box).toMatchObject({ v: 1, kdf: 'scrypt' });
    for (const k of ['salt', 'iv', 'tag', 'data']) expect(typeof box[k]).toBe('string');

    expect(decryptPayload(encrypted, PASS)).toEqual(plain);
  });

  it('同一明文两次加密产出不同密文（随机 salt/iv）', () => {
    const a = encryptPayload({ x: 1 }, PASS);
    const b = encryptPayload({ x: 1 }, PASS);
    expect(a).not.toBe(b);
    expect(decryptPayload(a, PASS)).toEqual({ x: 1 });
    expect(decryptPayload(b, PASS)).toEqual({ x: 1 });
  });

  it('错误口令抛统一错误', () => {
    const encrypted = encryptPayload({ x: 'secret' }, PASS);
    expect(() => decryptPayload(encrypted, '错误口令')).toThrow(DECRYPT_FAIL_MESSAGE);
  });

  it('篡改密文/信封字段抛统一错误', () => {
    const box = JSON.parse(encryptPayload({ x: 'secret' }, PASS)) as Record<string, string>;
    // 篡改密文数据（翻转一个 base64 字符）
    box.data = (box.data![0] === 'A' ? 'B' : 'A') + box.data!.slice(1);
    expect(() => decryptPayload(JSON.stringify(box), PASS)).toThrow(DECRYPT_FAIL_MESSAGE);
    // 篡改 tag
    const box2 = JSON.parse(encryptPayload({ x: 'secret' }, PASS)) as Record<string, string>;
    box2.tag = 'AAAAAAAAAAAAAAAAAAAAAA==';
    expect(() => decryptPayload(JSON.stringify(box2), PASS)).toThrow(DECRYPT_FAIL_MESSAGE);
    // 非 JSON / 结构非法
    expect(() => decryptPayload('not json', PASS)).toThrow(DECRYPT_FAIL_MESSAGE);
    expect(() => decryptPayload('{"v":2}', PASS)).toThrow(DECRYPT_FAIL_MESSAGE);
  });

  it('空口令/非字符串口令拒绝', () => {
    expect(() => encryptPayload({}, '')).toThrow('口令必须为非空字符串');
    expect(() => decryptPayload('{}', '')).toThrow('口令必须为非空字符串');
    // @ts-expect-error 故意传非字符串
    expect(() => encryptPayload({}, undefined)).toThrow('口令必须为非空字符串');
    // @ts-expect-error 故意传非字符串
    expect(() => decryptPayload('{}', null)).toThrow('口令必须为非空字符串');
  });
});
