/**
 * 请求信任校验的边界测试（lib/http/index.ts 的 isTrustedRequest / originHostPort）：
 * 这是本插件的安全边界——DNS rebinding 与跨站请求全靠它拦截，
 * 变异测试显示该函数的条件分支大量存活，故补齐逐分支断言。
 *
 * 覆盖：Host 缺失/非法、IPv4/IPv6/localhost 三种 loopback、方括号剥离、
 * trustedHosts 三种匹配形态、Origin 缺失放行、Origin 非法、同端口 loopback、
 * 端口不一致拒绝、https/http 默认端口推断、受信 Origin 放行、Referer 回退。
 */
import { describe, expect, it } from 'vitest';
import { isTrustedRequest } from '../../lib/http/index.js';

const req = (headers: Record<string, string | undefined>) => ({ headers } as never);

describe('isTrustedRequest：Host 判定', () => {
  it('Host 缺失 → 拒绝', () => {
    expect(isTrustedRequest(req({}))).toBe(false);
    expect(isTrustedRequest(req({ host: '' }))).toBe(false);
  });

  it('三种 loopback 主机名放行（127.0.0.1 / localhost / ::1）', () => {
    for (const host of ['127.0.0.1:3080', 'localhost:3080', '[::1]:3080']) {
      expect(isTrustedRequest(req({ host })), host).toBe(true);
    }
  });

  it('大小写不敏感 + IPv6 方括号剥离', () => {
    expect(isTrustedRequest(req({ host: 'LOCALHOST:3080' }))).toBe(true);
    expect(isTrustedRequest(req({ host: '[::1]:3080' }))).toBe(true);
  });

  it('非 loopback 且不在 trustedHosts → 拒绝（DNS rebinding 防护）', () => {
    expect(isTrustedRequest(req({ host: 'evil.example:3080' }))).toBe(false);
    expect(isTrustedRequest(req({ host: '192.168.1.9:3080' }))).toBe(false);
  });

  it('Host 非法（URL 解析失败）→ 拒绝而非抛错', () => {
    expect(isTrustedRequest(req({ host: 'http://[bad' }))).toBe(false);
  });

  it('trustedHosts 三种匹配形态（原样 / hostname / host:port）均放行', () => {
    const list = ['trusted.example:3080'];
    expect(isTrustedRequest(req({ host: 'trusted.example:3080' }), list)).toBe(true);
    expect(isTrustedRequest(req({ host: 'trusted.example:3080' }), ['trusted.example'])).toBe(true);
    expect(isTrustedRequest(req({ host: 'trusted.example:3080' }), ['other.example'])).toBe(false);
  });
});

describe('isTrustedRequest：Origin/Referer 判定', () => {
  it('无 Origin 且 Host loopback → 放行', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080' }))).toBe(true);
  });

  it('Origin 与 Host 同为 loopback 且同端口 → 放行', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }))).toBe(true);
  });

  it('Origin 端口与 Host 端口不一致 → 拒绝（跨端口即跨源）', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }))).toBe(false);
  });

  it('Origin 为 https 默认端口 443 时按 443 推断', () => {
    // Host 带 443，Origin 无显式端口（https 默认 443）→ 视为同端口
    expect(isTrustedRequest(req({ host: '127.0.0.1:443', origin: 'https://127.0.0.1' }))).toBe(true);
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', origin: 'https://127.0.0.1' }))).toBe(false);
  });

  it('Origin 为 http 默认端口 80 时按 80 推断', () => {
    expect(isTrustedRequest(req({ host: 'localhost:80', origin: 'http://localhost' }))).toBe(true);
  });

  it('跨站 Origin → 拒绝', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', origin: 'https://evil.example' }))).toBe(false);
  });

  it('Origin 非法 URL → 拒绝而非抛错', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', origin: 'not-a-url' }))).toBe(false);
  });

  it('无 Origin 时回退 Referer 判定', () => {
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', referer: 'http://127.0.0.1:3080/page' }))).toBe(true);
    expect(isTrustedRequest(req({ host: '127.0.0.1:3080', referer: 'https://evil.example/page' }))).toBe(false);
  });

  it('受信 Origin 放行（trustedHosts 命中 origin 的 host:port / host / 完整串）', () => {
    const host = '127.0.0.1:3080';
    expect(isTrustedRequest(req({ host, origin: 'https://trusted.example' }), ['trusted.example'])).toBe(true);
    expect(isTrustedRequest(req({ host, origin: 'https://trusted.example:8443' }), ['trusted.example:8443'])).toBe(true);
    expect(isTrustedRequest(req({ host, origin: 'https://trusted.example' }), ['https://trusted.example'])).toBe(true);
    expect(isTrustedRequest(req({ host, origin: 'https://trusted.example' }), ['nope.example'])).toBe(false);
  });

  it('Host 非 loopback 但 Origin 受信：仍要求 Host 本身受信（两道闸门独立）', () => {
    expect(isTrustedRequest(req({ host: 'evil.example:3080', origin: 'https://trusted.example' }), ['trusted.example'])).toBe(false);
  });
});
