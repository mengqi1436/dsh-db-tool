/**
 * Oracle 连接参数解析与 Thick（OCI）模式回归（NJS-138 修复）。
 *
 * 驱动事实（读 oracledb 26.0.0 源码确认，lib/errors.js:515、lib/thin/connection.js:1238）：
 *  - NJS-138 = ERR_SERVER_VERSION_NOT_SUPPORTED："connections to this database server
 *    version are not supported by node-oracledb in Thin mode"。thin 模式在建连时校验
 *    服务器 ACCEPT 包里的 TNS 协议版本，< 315（约 11g 之前）直接拒绝，connectString
 *    参数无法绕过——唯一出路是 Thick 模式（oracledb.initOracleClient + Instant Client/OCI，
 *    即 Navicat 的连接路径）。
 *  - initOracleClient 是模块级一次性、不可逆操作：thin 连接建过之后再启用抛 NJS-118
 *    （lib/oracledb.js:871-873）；不同参数重复调用抛 NJS-090。
 *
 * 本测试锁住三件事：
 *  1. resolveOracleConn 的 serviceType/sid 描述符与 ociLibDir 解析契约（fields 与 URL 同口径）；
 *  2. ensureOracleClient 的进程级守卫（幂等 / 冲突路径 / thin 已建池的拒绝）；
 *  3. NJS-138 / DPI-1047 / NJS-118 的 humanize 提示带行动指引。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertOraSid,
  createOracleAdapter,
  ensureOracleClient,
  humanizeOraError,
  resetOraClientStateForTest,
  resolveOracleConn,
} from '../../lib/adapters/oracle/index.js';
import type { ResolvedConnection } from '../../lib/adapters/types.js';

/* ---------- oracledb mock：复刻 initOracleClient 与 createPool 的模式级约束 ---------- */

const { createPoolMock, initClientMock } = vi.hoisted(() => ({
  createPoolMock: vi.fn(),
  initClientMock: vi.fn(),
}));

vi.mock('oracledb', () => ({
  default: {
    createPool: createPoolMock,
    initOracleClient: initClientMock,
    // 模块顶层副作用（fetchAsString/fetchAsBuffer 幂等追加）所需的运行时引用
    fetchAsString: [],
    fetchAsBuffer: [],
    CLOB: 1,
    BLOB: 2,
    Lob: class Lob {},
    OBJECT: 4001,
  },
}));

function mkConn(id: string, extra: Partial<ResolvedConnection> = {}): ResolvedConnection {
  return { meta: { id, kind: 'oracle' }, ...extra };
}

function fieldsConn(id: string, fields: Record<string, unknown>): ResolvedConnection {
  return mkConn(id, { fields });
}

beforeEach(() => {
  resetOraClientStateForTest();
  createPoolMock.mockReset();
  initClientMock.mockReset();
  createPoolMock.mockImplementation(async () => ({
    getConnection: vi.fn(),
    close: vi.fn(async () => undefined),
  }));
});

afterEach(() => {
  resetOraClientStateForTest();
});

describe('resolveOracleConn：服务名（默认，行为不变）', () => {
  it('fields：host/port/database → EZConnect，serviceType 缺省 service', () => {
    const r = resolveOracleConn(fieldsConn('a', { host: 'db', port: '1521', user: 'u', database: 'ORCL' }));
    expect(r.connectString).toBe('db:1521/ORCL');
    expect(r.serviceType).toBe('service');
    expect(r.ociLibDir).toBeUndefined();
  });

  it('fields：f.service 优先于 f.database（既有契约）', () => {
    const r = resolveOracleConn(fieldsConn('a', { host: 'db', user: 'u', service: 'SVC', database: 'OLD' }));
    expect(r.connectString).toBe('db:1521/SVC');
  });

  it('fields：非法端口仍 fail-closed（既有契约不被新字段破坏）', () => {
    expect(() => resolveOracleConn(fieldsConn('a', { host: 'db', port: '0', user: 'u', database: 'X' })))
      .toThrow('端口取值非法');
  });
});

describe('resolveOracleConn：SID 模式（对齐 Navicat）', () => {
  it('fields：serviceType=sid → 完整 TNS 描述符 CONNECT_DATA=(SID=…)', () => {
    const r = resolveOracleConn(fieldsConn('a', { host: 'db', port: '1521', user: 'u', database: 'XE', serviceType: 'sid' }));
    expect(r.connectString).toBe('(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db)(PORT=1521))(CONNECT_DATA=(SID=XE)))');
    expect(r.serviceType).toBe('sid');
  });

  it('fields：SID 含描述符破坏字符（括号）→ fail-closed', () => {
    expect(() => resolveOracleConn(fieldsConn('a', { host: 'db', user: 'u', database: 'X)ORCL', serviceType: 'sid' })))
      .toThrow('SID 取值非法');
  });

  it('fields：SID 模式主机名含括号（IPv6 等）→ fail-closed 并引导服务名模式', () => {
    expect(() => resolveOracleConn(fieldsConn('a', { host: '[::1]', user: 'u', database: 'XE', serviceType: 'sid' })))
      .toThrow('主机名');
  });

  it('fields：serviceType 非法取值 → fail-closed', () => {
    expect(() => resolveOracleConn(fieldsConn('a', { host: 'db', user: 'u', database: 'XE', serviceType: 'foo' })))
      .toThrow('serviceType 取值非法');
  });

  it('assertOraSid：合法 SID 原样返回', () => {
    expect(assertOraSid('XE')).toBe('XE');
    expect(assertOraSid('ORCL_1')).toBe('ORCL_1');
  });
});

describe('resolveOracleConn：ociLibDir（Thick/OCI 模式入口）', () => {
  it('fields：ociLibDir trim 后透传；空串=未提供（Thin）', () => {
    const r = resolveOracleConn(fieldsConn('a', { host: 'db', user: 'u', database: 'ORCL', ociLibDir: ' /opt/oracle/instantclient_19_19 ' }));
    expect(r.ociLibDir).toBe('/opt/oracle/instantclient_19_19');
    const thin = resolveOracleConn(fieldsConn('a', { host: 'db', user: 'u', database: 'ORCL', ociLibDir: '  ' }));
    expect(thin.ociLibDir).toBeUndefined();
  });

  it('URL：?serviceType=sid&ociLibDir=… 与 fields 同口径', () => {
    const r = resolveOracleConn(mkConn('a', { url: 'oracle://u:p@db:1521/XE?serviceType=sid&ociLibDir=%2Fopt%2Fic' }));
    expect(r.connectString).toBe('(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db)(PORT=1521))(CONNECT_DATA=(SID=XE)))');
    expect(r.ociLibDir).toBe('/opt/ic');
  });

  it('URL：?serviceType=foo → fail-closed；缺 query → 行为不变', () => {
    expect(() => resolveOracleConn(mkConn('a', { url: 'oracle://u:p@db:1521/XE?serviceType=foo' }))).toThrow('serviceType 取值非法');
    const r = resolveOracleConn(mkConn('a', { url: 'oracle://u:p@db:1521/ORCLPDB1' }));
    expect(r.connectString).toBe('db:1521/ORCLPDB1');
    expect(r.serviceType).toBe('service');
  });
});

describe('ensureOracleClient：进程级守卫（thick 一次性、不可逆）', () => {
  it('首次启用 → initOracleClient({ libDir })；同路径幂等不重复调用', () => {
    ensureOracleClient('/opt/ic');
    expect(initClientMock).toHaveBeenCalledTimes(1);
    expect(initClientMock).toHaveBeenCalledWith({ libDir: '/opt/ic' });
    ensureOracleClient('/opt/ic');
    expect(initClientMock).toHaveBeenCalledTimes(1);
  });

  it('不同 libDir 再启用 → 拒绝且不再触碰驱动（NJS-090 语义的可操作版）', () => {
    ensureOracleClient('/opt/ic');
    expect(() => ensureOracleClient('/other/ic')).toThrow('不同的 OCI 库路径');
    expect(initClientMock).toHaveBeenCalledTimes(1);
  });

  it('thin 池建过之后再启用 → 拒绝且 initOracleClient 未被调用（NJS-118 语义）', async () => {
    const a = await createOracleAdapter(mkConn('thin-a', { fields: { host: 'db', user: 'u', database: 'ORCL' } }));
    await a.close();
    expect(createPoolMock).toHaveBeenCalledTimes(1);
    expect(() => ensureOracleClient('/opt/ic')).toThrow('已创建过 Thin 模式连接');
    expect(initClientMock).not.toHaveBeenCalled();
  });

  it('thin 建池失败同样封死后续 thick（驱动在建池调用时就加载 thin 协议栈）', async () => {
    createPoolMock.mockRejectedValueOnce(new Error('ORA-01017: invalid username/password'));
    await expect(createOracleAdapter(mkConn('thin-b', { fields: { host: 'db', user: 'u', database: 'ORCL' } })))
      .rejects.toThrow();
    expect(() => ensureOracleClient('/opt/ic')).toThrow('已创建过 Thin 模式连接');
  });

  it('thick 路径不设置 thin 标记：thick 池建完仍允许同路径幂等', async () => {
    const a = await createOracleAdapter(mkConn('thick-a', {
      fields: { host: 'db', user: 'u', database: 'ORCL', ociLibDir: '/opt/ic' },
    }));
    await a.close();
    expect(initClientMock).toHaveBeenCalledTimes(1);
    // createOraPool 走默认驱动（= mock），ensureOracleClient 幂等短路不会二次调用
    ensureOracleClient('/opt/ic');
    expect(initClientMock).toHaveBeenCalledTimes(1);
  });

  it('驱动加载 OCI 库失败（DPI-1047）→ 包装为带行动指引的中文错误', () => {
    initClientMock.mockImplementation(() => {
      throw new Error('DPI-1047: Cannot locate a file specified by the library path');
    });
    expect(() => ensureOracleClient('/bad/path')).toThrow('OCI 库路径');
    // 初始化失败不落状态：修复路径后可重试
    expect(() => ensureOracleClient('/bad/path')).toThrow();
    expect(initClientMock).toHaveBeenCalledTimes(2);
  });
});

describe('humanizeOraError：NJS-138 / DPI-1047 / NJS-118 行动指引', () => {
  it('NJS-138 → 引导 OCI/Thick', () => {
    const msg = humanizeOraError(new Error('NJS-138: connections to this database server version are not supported by node-oracledb in Thin mode')).message;
    expect(msg).toContain('Thick');
  });

  it('NJS-118 → 提示重启宿主', () => {
    const msg = humanizeOraError(new Error('NJS-118: node-oracledb Thick mode cannot be enabled because a Thin mode connection has already been created')).message;
    expect(msg).toContain('重启宿主');
  });

  it('DPI-1047 → 提示检查 OCI 库路径/位数/版本', () => {
    const msg = humanizeOraError(new Error('DPI-1047: Cannot locate a file specified by the library path')).message;
    expect(msg).toContain('位数');
  });

  it('未知错误维持既有包装格式', () => {
    expect(humanizeOraError(new Error('ORA-99999: boom')).message).toBe('Oracle 错误：ORA-99999: boom');
  });
});
