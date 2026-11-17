/**
 * 连接测试反馈（一键测试 / 保存前测试共用）：
 *
 * 1) conciseServerInfo：把各库版本横幅压缩成「产品 + 短版本」——
 *    PG 的 `SELECT version()` 是完整编译信息（110+ 字符）、Oracle/达梦的 banner
 *    同样冗长，直接显示在一键测试的成功提示里不可读。只做展示层压缩，
 *    各库原始版本串仍可从 query 通道取到，不影响任何契约。
 * 2) friendlyConnectError：按错误特征把连接失败翻译成准确、可操作的中文提示。
 *    适用范围：驱动原文直出的库（mysql/postgresql/gaussdb/mongodb/redis/sqlite）——
 *    sqlserver/oracle/dmdb 的适配器层已有按错误码整形的中文文案（TLS 两族区分、
 *    ORA/DM 码针对性提示），这里直接放行不二次解读。
 *    判定顺序：网络层特征（全库通用）→ 各库错误码/消息特征 → 通用 TLS/证书 →
 *    不认识就返回 null（调用方保留原错误文案，不吞真实错误）。
 *    仅用于连接测试的展示路径（manager.testConnection / testDraft），
 *    query/execute 工具链路的 toDriverError 不经过这里。
 */
import type { DbKind } from './types.js';

/** 版本横幅 → 「产品 + 短版本」。已简短的（mysql/mongo/redis/sqlite）原样返回。 */
export function conciseServerInfo(kind: DbKind, raw: string): string {
	const s = String(raw ?? '').trim();
	if (s === '') return s;
	switch (kind) {
		case 'postgresql':
		case 'gaussdb': {
			// GaussDB 的 version() 形如 "PostgreSQL 9.2.4 (GaussDB Kernel 505.x build ...)"，
			// 内核版本才是用户关心的事实；纯 PostgreSQL 形如 "PostgreSQL 17.11 (Ubuntu ...) on ..."
			const g = /GaussDB Kernel ([\w.-]+)/.exec(s);
			if (g) return `GaussDB Kernel ${g[1]}`;
			return (s.split('(')[0] ?? s).trim() || s;
		}
		case 'oracle': {
			// banner: "Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Version 19.3.0.0.0"
			const m = /^(Oracle Database \S+)/.exec(s);
			if (m && m[1]) return m[1];
			return (s.split(/(\s+Release\s+|\()/)[0] ?? s).trim() || s;
		}
		case 'dmdb': {
			// DM banner: "DM Database Server 64 bit V8.1.2.128 (Build ...)" → "DM V8.1.2.128"
			const m = /\bV(\d[\w.-]*)/.exec(s);
			if (m) return `DM V${m[1]}`;
			return (s.split('(')[0] ?? s).trim() || s;
		}
		default:
			return s;
	}
}

/** 从错误文本提取 host:port（ECONNREFUSED 等提示指向具体目标） */
function extractHostPort(raw: string): string | undefined {
	return /((?:\d{1,3}(?:\.\d{1,3}){3}|\[[\w:]+\]|[\w.-]+):\d{2,5})/.exec(raw)?.[1];
}

/**
 * 连接失败 → 准确可操作的中文提示。返回 null 表示没有把握，
 * 调用方保留原错误文案（诊断细节不丢）。
 */
export function friendlyConnectError(kind: DbKind, err: unknown): string | null {
	const raw = err instanceof Error ? err.message : String(err ?? '');
	if (!raw) return null;
	// sqlserver/oracle/dmdb 的适配器层已有按错误码整形的中文文案（含 TLS 两族区分、
	// ORA/DM 码针对性提示与 e2e 契约测试），manager 层不再二次解读，原样保留。
	if (kind === 'sqlserver' || kind === 'oracle' || kind === 'dmdb') return null;

	/* ---- 网络层：全库通用，特征最可靠，优先判定 ---- */
	const target = extractHostPort(raw);
	if (/ECONNREFUSED/.test(raw)) {
		return `连接被拒绝：${target ?? '目标端口'} 无服务在监听，请确认数据库已启动、主机与端口正确（ECONNREFUSED）`;
	}
	if (/ENOTFOUND/.test(raw)) {
		const host = /getaddrinfo ([\w.-]+)/i.exec(raw)?.[1] ?? target?.split(':')[0];
		return `主机名无法解析：${host ?? ''}，请检查拼写与 DNS（ENOTFOUND）`;
	}
	if (/ETIMEDOUT/.test(raw) || /connection timeout/i.test(raw) || /Server selection timed out/i.test(raw)) {
		return `连接超时：主机不可达或端口被防火墙拦截（ETIMEDOUT）`;
	}
	if (/ECONNRESET/.test(raw)) {
		return `连接被重置：网络中断或服务端主动断开（ECONNRESET）`;
	}
	if (/EHOSTUNREACH|ENETUNREACH/.test(raw)) {
		return `网络不可达：请检查本机网络与防火墙（EHOSTUNREACH）`;
	}

	/* ---- 各库错误码 / 消息特征（人形化消息会被 humanize 保留原文，码与文本按包含匹配） ---- */
	switch (kind) {
		case 'mysql':
			if (/Access denied for user/i.test(raw)) return '用户名或密码错误（MySQL Access denied）';
			if (/Unknown database/i.test(raw)) return `数据库不存在（MySQL Unknown database）`;
			if (/does not support authentication/i.test(raw)) {
				return '客户端与服务端认证插件不兼容：可在服务端为该账号改用 mysql_native_password，或升级服务端（MySQL 1251）';
			}
			break;
		case 'postgresql':
		case 'gaussdb':
			if (/password authentication failed|28P01/.test(raw)) return '用户名或密码错误（PostgreSQL 28P01）';
			if (/does not exist|3D000/.test(raw) && /database/i.test(raw)) return `数据库不存在（PostgreSQL 3D000）`;
			if (/role "[^"]+" does not exist|28000/.test(raw)) return '角色不存在或认证配置错误（PostgreSQL 28000）';
			if (/57P03|the database system is starting/i.test(raw)) return '数据库暂不可用：正在启动或恢复中，稍后重试（PostgreSQL 57P03）';
			break;
		case 'mongodb':
			if (/AuthenticationFailed|auth(entication)? failed/i.test(raw)) {
				return '认证失败：用户名、密码或认证库（authSource）不对（MongoDB）';
			}
			break;
		case 'redis':
			if (/NOAUTH|WRONGPASS|invalid password/i.test(raw)) {
				return '认证失败：密码不对，或连接串缺少密码而服务端开启了 requirepass/ACL（Redis）';
			}
			break;
		case 'sqlite':
			if (/unable to open database file/i.test(raw)) {
				return '无法打开数据库文件：请检查文件路径存在且进程有读写权限（SQLite）';
			}
			break;
	}

	/* ---- 通用 TLS/证书（各库驱动文案不同，统一给配置方向） ---- */
	if (/self.signed certificate|certificate verify failed|unable to verify|TLS|SSL/i.test(raw)) {
		return `TLS/证书校验失败：证书不受信任或主机名不匹配，请配置受信 CA 或核对证书/加密参数（${raw.slice(0, 60).trim()}）`;
	}
	return null;
}
