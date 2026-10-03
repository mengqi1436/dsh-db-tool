/**
 * 连接导出/导入的口令加解密（纯函数，仅用 Node stdlib crypto）。
 *
 * 方案：
 *  - KDF：scryptSync(passphrase, salt, 32) 派生 AES-256 密钥；
 *  - 算法：AES-256-GCM（机密性 + 完整性一体，tag 防篡改）；
 *  - iv：12 字节随机（GCM 推荐长度）；salt：16 字节随机；
 *  - 输出为 JSON 字符串：{ v: 1, kdf: 'scrypt', salt, iv, tag, data }，二进制段全部 base64。
 *
 * 失败统一抛 Error('口令错误或文件已损坏')，不向外泄漏是口令错还是文件坏，
 * 避免给攻击者侧信道。口令本身为空/非字符串时单独抛 Error（参数错误，非解密失败）。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** 解密失败/文件损坏的统一错误信息 */
export const DECRYPT_FAIL_MESSAGE = '口令错误或文件已损坏';

/** 加密输出的 JSON 信封结构 */
interface EncryptedBox {
  v: number;
  kdf: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

/** 口令断言：必须为非空字符串 */
function assertPassphrase(passphrase: unknown): asserts passphrase is string {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('口令必须为非空字符串');
  }
}

/** 加密任意可 JSON 序列化的 payload，返回信封 JSON 字符串 */
export function encryptPayload(plain: unknown, passphrase: string): string {
  assertPassphrase(passphrase);
  const salt = randomBytes(16);
  // 显式固定 scrypt 成本参数（与 Node 当前默认一致），加解密两侧同步使用，
  // 避免导出包跨运行时/跨 Node 版本时因默认值漂移而无法解密
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]);
  const box: EncryptedBox = {
    v: 1,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(box);
}

/** 结构校验：缺字段/类型不符即视为文件损坏 */
function isEncryptedBox(x: unknown): x is EncryptedBox {
  if (x === null || typeof x !== 'object') return false;
  const b = x as Record<string, unknown>;
  return (
    b.v === 1 &&
    b.kdf === 'scrypt' &&
    typeof b.salt === 'string' &&
    typeof b.iv === 'string' &&
    typeof b.tag === 'string' &&
    typeof b.data === 'string'
  );
}

/** 解密信封 JSON，返回原始 payload；口令错误或任一环节损坏统一抛 DECRYPT_FAIL_MESSAGE */
export function decryptPayload(encryptedJson: string, passphrase: string): unknown {
  assertPassphrase(passphrase);
  try {
    const box: unknown = JSON.parse(encryptedJson);
    if (!isEncryptedBox(box)) throw new Error('结构非法');
    const salt = Buffer.from(box.salt, 'base64');
    const iv = Buffer.from(box.iv, 'base64');
    const tag = Buffer.from(box.tag, 'base64');
    const data = Buffer.from(box.data, 'base64');
    // base64 解码静默容错，需显式校验解码后长度（iv 12B / tag 16B / salt 非空）
    if (iv.length !== 12 || tag.length !== 16 || salt.length === 0) throw new Error('长度非法');
    const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (err) {
    // 对外统一文案（防侧信道），原始错误挂 cause 供服务端日志区分失败模式
    throw new Error(DECRYPT_FAIL_MESSAGE, { cause: err });
  }
}
