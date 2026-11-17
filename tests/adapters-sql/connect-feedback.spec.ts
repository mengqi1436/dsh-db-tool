/**
 * 连接测试反馈：成功提示压缩（conciseServerInfo）与失败提示错误码映射（friendlyConnectError）。
 *
 * 覆盖：
 *  1) 各库版本横幅 → 「产品 + 短版本」（PG/GaussDB 编译信息、Oracle/DM banner 压缩，
 *     已简短的 mysql/mongo/redis/sqlite 原样返回）；
 *  2) 失败按网络层特征（全库通用）→ 各库错误码/消息 → 通用 TLS/证书分层映射；
 *     无把握的返回 null（调用方保留原文，不吞真实错误）；
 *  3) manager.testConnection / testDraft 整链路：抛错与 {ok:false,error} 两条路径都过映射。
 */
import { describe, expect, it, afterAll } from 'vitest';
import { conciseServerInfo, friendlyConnectError } from '../../lib/adapters/connect-feedback.js';
import { DbToolStore } from '../../lib/store/index.js';
import { DbToolService } from '../../lib/manager.js';
import type { DatabaseAdapter, DbKind, TestConnectResult } from '../../lib/adapters/types.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';

/* ---------- 1. conciseServerInfo ---------- */

describe('conciseServerInfo：版本横幅压缩', () => {
	it('PostgreSQL version() 完整编译信息 → 产品 + 短版本', () => {
		expect(conciseServerInfo('postgresql', 'PostgreSQL 17.11 (Ubuntu 17.11-1.pgdg26.04+2) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0, 64-bit')).toBe('PostgreSQL 17.11');
		expect(conciseServerInfo('postgresql', 'PostgreSQL 16.4')).toBe('PostgreSQL 16.4');
	});

	it('GaussDB：优先取内核版本（version() 外层是兼容的 PostgreSQL 壳）', () => {
		expect(conciseServerInfo('gaussdb', 'PostgreSQL 9.2.4 (GaussDB Kernel 505.1.0.SPC0000 build 3749550) compiled at ...')).toBe('GaussDB Kernel 505.1.0.SPC0000');
		expect(conciseServerInfo('gaussdb', 'PostgreSQL 9.2.4')).toBe('PostgreSQL 9.2.4');
	});

	it('Oracle banner → Oracle Database + 版本号', () => {
		expect(conciseServerInfo('oracle', 'Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Version 19.3.0.0.0')).toBe('Oracle Database 19c');
		expect(conciseServerInfo('oracle', 'Oracle Database 19c')).toBe('Oracle Database 19c'); // 既有契约形态不变
	});

	it('DM banner → DM V+版本号', () => {
		expect(conciseServerInfo('dmdb', 'DM Database Server 64 bit V8.1.2.128 (Build 2023.06.15)')).toBe('DM V8.1.2.128');
		expect(conciseServerInfo('dmdb', 'DM Database Server 64 bit')).toBe('DM Database Server 64 bit');
	});

	it('已简短的库原样返回，空串安全', () => {
		expect(conciseServerInfo('mysql', 'MySQL 8.0.36')).toBe('MySQL 8.0.36');
		expect(conciseServerInfo('mongodb', 'MongoDB 7.0.14')).toBe('MongoDB 7.0.14');
		expect(conciseServerInfo('redis', 'Redis 7.2.4')).toBe('Redis 7.2.4');
		expect(conciseServerInfo('sqlite', 'SQLite 3.54.0 (node:sqlite)')).toBe('SQLite 3.54.0 (node:sqlite)');
		expect(conciseServerInfo('postgresql', '')).toBe('');
	});
});

/* ---------- 2. friendlyConnectError：网络层 + 各库错误码 ---------- */

describe('friendlyConnectError：网络层特征（全库通用）', () => {
	it('ECONNREFUSED 提取目标地址并给可操作指引', () => {
		const m = friendlyConnectError('mysql', new Error('mysql 连接测试: connect ECONNREFUSED 127.0.0.1:3306'))!;
		expect(m).toContain('连接被拒绝');
		expect(m).toContain('127.0.0.1:3306');
		expect(m).toContain('ECONNREFUSED');
	});

	it('ENOTFOUND 提取主机名', () => {
		const m = friendlyConnectError('postgresql', new Error('postgresql 连接测试: getaddrinfo db1.internal ENOTFOUND'))!;
		expect(m).toContain('主机名无法解析');
		expect(m).toContain('db1.internal');
	});

	it('超时 / 重置 / 不可达', () => {
		expect(friendlyConnectError('postgresql', new Error('x ETIMEDOUT'))!).toContain('连接超时');
		expect(friendlyConnectError('postgresql', new Error('Connection terminated due to connection timeout'))!).toContain('连接超时');
		expect(friendlyConnectError('mysql', new Error('read ECONNRESET'))!).toContain('连接被重置');
		expect(friendlyConnectError('mongodb', new Error('mongodb://h:27017 EHOSTUNREACH'))!).toContain('网络不可达');
	});
});

describe('friendlyConnectError：各库错误码/消息', () => {
	it('mysql：Access denied / Unknown database / 认证插件不兼容', () => {
		expect(friendlyConnectError('mysql', new Error("Access denied for user 'root'@'localhost' (using password: YES)"))!).toContain('用户名或密码错误');
		expect(friendlyConnectError('mysql', new Error("mysql 连接测试: Unknown database 'app'"))!).toContain('数据库不存在');
		expect(friendlyConnectError('mysql', new Error('Client does not support authentication protocol requested by server'))!).toContain('认证插件');
	});

	it('postgresql：28P01 / 3D000 / 28000 / 57P03（humanize 前缀不影响匹配）', () => {
		expect(friendlyConnectError('postgresql', new Error('postgresql 连接测试: password authentication failed for user "u"'))!).toContain('用户名或密码错误');
		expect(friendlyConnectError('postgresql', new Error('FATAL: database "app" does not exist'))!).toContain('数据库不存在');
		expect(friendlyConnectError('postgresql', new Error('FATAL: role "u" does not exist'))!).toContain('角色不存在');
		expect(friendlyConnectError('postgresql', new Error('the database system is starting up'))!).toContain('正在启动');
	});

	it('sqlserver：适配器层已按错误码整形，manager 层放行不二次解读', () => {
		expect(friendlyConnectError('sqlserver', new Error("sqlserver 连接测试: Login failed for user 'sa'."))).toBe(null);
		expect(friendlyConnectError('sqlserver', new Error('网络不可达：无法与服务器建立 TCP 连接（Failed to connect to db1.example.com:1433）'))).toBe(null);
	});

	it('oracle/dmdb：适配器层已带 ORA/DM 码针对性提示，放行保留', () => {
		expect(friendlyConnectError('oracle', new Error('Oracle 错误：ORA-12541: TNS:no listener（提示：检查监听）'))).toBe(null);
		expect(friendlyConnectError('dmdb', new Error('达梦 DM 错误：[-70021]: 用户名或密码错误'))).toBe(null);
		expect(friendlyConnectError('dmdb', new Error('达梦 DM 错误：[6071] 消息加密失败（提示：……loginEncrypt=false……）'))).toBe(null);
	});

	it('mongodb / redis / sqlite 错误码映射', () => {
		expect(friendlyConnectError('mongodb', new Error('MongoDB 错误：AuthenticationFailed, authentication failed'))!).toContain('认证失败');
		expect(friendlyConnectError('redis', new Error('Redis 错误：WRONGPASS invalid username-password pair'))!).toContain('认证失败');
		expect(friendlyConnectError('sqlite', new Error('sqlite 打开失败 (/data/app.db, 驱动 node:sqlite): unable to open database file'))!).toContain('无法打开数据库文件');
	});

	it('通用 TLS/证书兜底 + 无把握返回 null', () => {
		expect(friendlyConnectError('postgresql', new Error('self signed certificate in certificate chain'))!).toContain('TLS/证书校验失败');
		expect(friendlyConnectError('mysql', new Error('某种未知驱动异常：xyz-99'))).toBe(null);
		expect(friendlyConnectError('mysql', '')).toBe(null);
	});
});

/* ---------- 3. manager 整链路：抛错与 ok:false 两条路径 ---------- */

function stubAdapter(kind: DbKind, testConnect: () => Promise<TestConnectResult>): DatabaseAdapter {
	return {
		kind,
		connId: 'c1',
		testConnect,
		query: async () => { throw new Error('not used'); },
		execute: async () => { throw new Error('not used'); },
		listDatabases: async () => [],
		listTables: async () => [],
		describeTable: async () => [],
		previewRows: async () => ({ columns: [], rows: [], rowCount: 0 }),
		close: async () => {},
	} as DatabaseAdapter;
}

function makeService(kind: DbKind, testConnect: () => Promise<TestConnectResult>): { service: DbToolService; home: string } {
	const home = makeTempHome();
	const store = new DbToolStore(home);
	store.connections.create({ id: 'c1', kind, url: 'mysql://u:p@127.0.0.1:3306/app' });
	const service = new DbToolService(store, {
		adapterResolver: async () => async () => stubAdapter(kind, testConnect),
	});
	return { service, home };
}

describe('manager.testConnection：两条失败路径都过错误码映射', () => {
	it('适配器抛错（humanize 标签 + ECONNREFUSED）→ 抛出映射后的准确提示', async () => {
		const { service, home } = makeService('mysql', async () => {
			throw new Error('mysql 连接测试: connect ECONNREFUSED 127.0.0.1:3306');
		});
		try {
			await expect(service.testConnection('c1')).rejects.toThrow(/连接被拒绝：127\.0\.0\.1:3306.*ECONNREFUSED/);
		} finally {
			await service.dispose();
			cleanupDir(home);
		}
	});

	it('适配器返回 ok:false + error（redis NOAUTH）→ error 字段被替换为准确提示', async () => {
		const { service, home } = makeService('redis', async () => ({ ok: false, error: 'Redis 错误：WRONGPASS invalid username-password pair' }));
		try {
			const r = await service.testConnection('c1');
			expect(r.ok).toBe(false);
			expect(r.error).toContain('认证失败');
		} finally {
			await service.dispose();
			cleanupDir(home);
		}
	});

	it('无把握错误保留原文（不吞真实错误）', async () => {
		const { service, home } = makeService('mysql', async () => {
			throw new Error('某种未知驱动异常：xyz-99 深层细节');
		});
		try {
			await expect(service.testConnection('c1')).rejects.toThrow(/某种未知驱动异常：xyz-99 深层细节/);
		} finally {
			await service.dispose();
			cleanupDir(home);
		}
	});

	it('testDraft 走同一映射（保存前测试提示一致）', async () => {
		const home = makeTempHome();
		const store = new DbToolStore(home);
		const service = new DbToolService(store, {
			adapterResolver: async () => async () => stubAdapter('postgresql', async () => {
				throw new Error('postgresql 连接测试: password authentication failed for user "u"');
			}),
		});
		try {
			await expect(service.testDraft({ kind: 'postgresql', url: 'postgresql://u:p@127.0.0.1:5432/app' })).rejects.toThrow(/用户名或密码错误/);
		} finally {
			await service.dispose();
			cleanupDir(home);
		}
	});

	it('成功路径：serverInfo 原样透传（压缩在适配器层完成，manager 不动 ok:true）', async () => {
		const { service, home } = makeService('mysql', async () => ({ ok: true, serverInfo: 'MySQL 8.0.36' }));
		try {
			const r = await service.testConnection('c1');
			expect(r).toEqual({ ok: true, serverInfo: 'MySQL 8.0.36' });
		} finally {
			await service.dispose();
			cleanupDir(home);
		}
	});
});

afterAll(() => { /* 每用例自清临时目录 */ });
