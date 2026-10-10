window.__ModuleLoader__.load({
	id: "dsh-db-tool",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		/* ============================================================
		 * dsh-db-tool 侧边栏客户端
		 * 形态与 dsh-ssh-tunnel 一致：单文件 __ModuleLoader__ 模块，
		 * exports.inject / exports.apply(ctx) 由 DSH web 宿主加载，
		 * 经 dsh-better-sidebar registerTab 注册侧边栏 tab。
		 * ============================================================ */

		// --- i18n（dsh-better-sidebar 同款模式）---
		// i18n 字典/HTTP 封装/CSS/对话框均无单元断言，仅变异下方纯函数层（Stryker 区段指令需精确匹配，不得带后缀文本）
	// Stryker disable all
	const LOCALE_NS = "dbTool";
		const zh = {
			tabTitle: "数据库",
			projectLabel: "项目: {path}",
			projectUnbound: "未识别当前项目路径，请在下方填写工作区绝对路径",
			projectPathPlaceholder: "工作区绝对路径（如 E:\\Code\\my-app）",
			viewManage: "连接管理",
			viewGrants: "项目授权",
			viewBrowse: "数据浏览",
			viewConsole: "SQL 控制台",
			viewTransfer: "数据传输",
			viewTransferLog: "传输日志",
			tlogEmpty: "暂无传输日志",
			tlogAuto: "自动刷新",
			tlogClear: "清除日志",
			tlogClearConfirm: "确定清除全部传输日志？",
			tlogTypeStart: "开始",
			tlogTypeTable: "表",
			tlogTypeProgress: "进度",
			tlogTypeFinish: "完成",
			trSource: "源连接",
			trTarget: "目标连接",
			trTables: "数据库对象",
			trGroupTable: "表",
			trGroupCollection: "集合",
			trGroupView: "视图",
			trGroupOther: "其他",
			trSelectAll: "全选",
			trClear: "清空",
			trWriteMode: "写入模式",
			trModeInsert: "插入（冲突报错）",
			trModeIgnore: "跳过重复",
			trModeReplace: "覆盖（按主键）",
			trModeTruncate: "清空后写入（危险）",
			trBatchSize: "每批行数",
			trTableConcurrency: "表级并行",
			trShardConcurrency: "分片并行",
			trStart: "开始传输",
			trCancel: "取消任务",
			trProgress: "传输进度",
			trStatus: "状态",
			trRows: "已写入行数",
			trShards: "分片",
			trFailures: "失败清单",
			trStatusRunning: "进行中",
			trStatusDone: "已完成",
			trStatusFailed: "有失败",
			trStatusCancelled: "已取消",
			trStatusPending: "排队中",
			trxOverwrite: "覆盖已有表结构（删除重建，危险）",
			trxOverwriteHint: "已存在的目标表将被删除重建，其中数据全部丢失",
			trHistory: "传输历史",
			trHistoryClear: "清除历史",
			trHistoryClearConfirm: "确定清除当前项目的全部传输历史？",
			trHistoryEmpty: "暂无历史记录",
			trSameConn: "源与目标上下文相同，请更改库或模式",
			trLoadingTables: "加载表清单…",
			// 数据传输（Navicat 式双栏）
			trxSource: "源",
			trxTarget: "目标",
			trxConn: "连接:",
			trxDatabase: "数据库:",
			trxSchema: "模式:",
			trxInfo: "信息",
			trxConnType: "连接类型",
			trxConnName: "连接名称",
			trxHost: "主机",
			trxPort: "端口",
			trxServerVer: "服务器版本",
			trxNoDbLevel: "默认上下文",
			trxPickSource: "请选择源连接以加载表清单",
			trxSelectedCount: "已选 {n} 项",
			trxOptions: "传输选项",
			trxArrowLabel: "传输方向：源到目标",
			trxPickTable: "请至少勾选一张表",
			trxLoadDbsFail: "库清单加载失败",
			footerHint: "管理在此侧栏；业务操作要求当前项目已获得对应连接的授权。",
			// 连接管理
			newConn: "新建连接",
			editConn: "编辑连接",
			noConns: "还没有连接，点击「新建连接」添加。",
			needProjectPath: "项目路径为空，数据浏览不可用：请在顶部输入框填写当前项目的绝对路径（如 E:\\Code\\my-app）后重试。",
			connName: "名称 / 别名",
			connId: "连接 ID",
			urlMode: "URL 方式",
			fieldsMode: "分字段方式",
			url: "连接 URL（密码将自动拆入密钥存储）",
			urlUser: "用户名（可选，自动注入 URL）",
			urlPassword: "密码（可选，自动注入 URL；留空保持已存）",
			fieldsHost: "主机地址",
			fieldsPort: "端口",
			fieldsUser: "用户名",
			fieldsPassword: "密码",
			passwordSaved: "已保存（留空保持不变）",
			fieldsDatabase: "数据库名",
			ssl: "启用 SSL",
			test: "测试",
			testing: "测试中…",
			testOk: "连接成功",
			testFail: "连接失败",
			edit: "编辑",
			trRefresh: "刷新（重新拉取已展开的库/模式/表）",
			delete: "删除",
			deleteConnConfirm: "确定删除连接「{name}」？将级联删除其密钥与所有项目的授权。",
			fieldKind: "数据库类型",
			requiredMark: "（必填）",
			deleteConnTitle: "删除连接",
			auditShort: "审计日志",
			noConnsGuide: "还没有连接，先添加一个，再授权给项目使用。",
			addConn: "添加连接",
			confirmParams: "参数",
			grantModeGroup: "{name} 授权模式",
			save: "保存",
			cancel: "取消",
			saving: "保存中…",
			idAutoHint: "留空则自动生成",
			auditTitle: "操作审计（最近 {n} 条）",
			auditEmpty: "当前项目暂无审计记录",
			auditTime: "时间",
			auditAction: "操作",
			auditConn: "连接",
			auditDetail: "详情",
			auditDenied: "拒绝",
			auditConfirmed: "已确认",
			// 连接导出/导入（口令加密备份）
			exportConns: "导出",
			importConns: "导入",
			passphrase: "口令",
			passphraseHint: "8 位以上，仅本次导出/导入使用",
			exportDone: "已导出 {n} 条连接",
			importResult: "已导入 {i} 条，跳过 {s} 条",
			importPartialFail: "部分失败：成功 {i} 条，跳过 {s} 条，失败 {f} 条",
			importDecryptFail: "口令错误或文件已损坏",
			pickFile: "选择文件",
			// 授权
			grantsHint: "为当前项目授权连接。只读=仅查询/浏览，读写=允许执行语句与脚本。未授权的连接在业务操作中一律拒绝。",
			grantsEmptyHint: "当前项目尚未授权任何连接，在下方每行选择「只读」或「读写」即可完成授权。",
			grantsSummary: "已授权 {granted}/{total} 个连接",
			modeBadgeRo: "只读",
			modeBadgeRw: "读写",
			modeNone: "未授权",
			modeRo: "只读",
			modeRw: "读写",
			// 浏览
			noDatabases: "无可用数据库",
			noSchemas: "无模式",
			noTables: "无表",
			defaultDb: "默认库",
			loadFailed: "加载失败",
			structure: "结构",
			preview: "数据预览",
			column: "列名",
			dataType: "类型",
			nullable: "可空",
			keyCol: "键",
			defaultVal: "默认值",
			comment: "注释",
			nextPage: "下一页",
			prevPage: "上一页",
			pageInfo: "第 {page} 页（每页 50 行）",
			previewTruncated: "结果已截断",
			browseDialogTitle: "{conn} / {db} / {table}",
			close: "关闭",
			emptyStructure: "暂无字段信息",
			emptyData: "暂无数据",
			retry: "重试",
			selectTableHint: "在左侧选择表后查看数据",
			// 单元格底部详情栏（Navicat 式就地写回）
			cellValue: "完整值",
			copyBtn: "复制",
			copied: "已复制",
			setNull: "设为 NULL",
			cellSaving: "保存中…",
			readOnlyRo: "只读授权，不可编辑",
			noPkHint: "该表无主键，不支持就地编辑",
			truncatedNoEdit: "值已截断显示，就地编辑可能覆盖数据，请改用 SQL 控制台",
			blobNoEdit: "二进制值不支持就地编辑",
			redisTypeRo: "Redis 该类型不支持就地编辑",
			// SQL 控制台
			modeScript: "脚本",
			run: "执行",
			running: "执行中…",
			sqlPlaceholder: "输入 SQL / 命令…（Redis: [\"GET\",\"key\"]；Mongo: {\"find\":\"users\",\"filter\":{}}）",
			// SQL 控制台（多标签重构）：标签 / 工具 / 预分类 / 事务 / 历史
			modeSql: "SQL",
			newTab: "新建标签",
			closeTab: "关闭标签页",
			queryTab: "查询 {n}",
			runSelection: "执行选中",
			formatSql: "格式化",
			skippedRo: "已跳过（只读授权）",
			locate: "定位",
			historyTitle: "历史",
			historyEmpty: "暂无历史",
			txBegin: "开始事务",
			txCommit: "提交事务",
			txRollback: "回滚事务",
			txActive: "事务进行中",
			txInline: "事务内",
			txDefaultDbOnly: "事务绑定连接默认库：请先清空库选择",
			routeQuery: "查询",
			routeExec: "写入",
			routeScript: "脚本",
			// 视图状态与控制台（T2）
			selectConn: "选择连接…",
			copyFailed: "复制失败",
			scriptPlaceholder: "输入 JS 脚本（vm 沙箱，含 db 助手对象）…",
			paramsJson: "查询参数（JSON 数组，可选；多语句时每条共用同一组参数）",
			rowsResult: "{n} 行",
			execResult: "受影响 {n} 行",
			needConfirmTitle: "危险操作确认",
			dangerLevel: "风险等级",
			reason: "原因",
			confirmRun: "确认执行",
			confirmCancel: "取消",
			confirmHint: "该语句经服务端判定为危险操作，需人工确认后才执行（确认凭据 5 分钟内有效）。",
			cancelled: "已取消",
			// 通用
			error: "错误",
			ok: "操作完成",
		};
		const en = {
			tabTitle: "Databases",
			projectLabel: "Project: {path}",
			projectUnbound: "Cannot detect current project path; enter the workspace absolute path below",
			projectPathPlaceholder: "workspace absolute path (e.g. /home/me/my-app)",
			viewManage: "Connections",
			viewGrants: "Project Access",
			viewBrowse: "Browse",
			viewConsole: "SQL Console",
			viewTransfer: "Data Transfer",
			viewTransferLog: "Transfer Log",
			tlogEmpty: "No transfer log yet",
			tlogAuto: "Auto refresh",
			tlogClear: "Clear log",
			tlogClearConfirm: "Clear all transfer log?",
			tlogTypeStart: "Start",
			tlogTypeTable: "Table",
			tlogTypeProgress: "Progress",
			tlogTypeFinish: "Finish",
			trSource: "Source connection",
			trTarget: "Target connection",
			trTables: "Database objects",
			trGroupTable: "Tables",
			trGroupCollection: "Collections",
			trGroupView: "Views",
			trGroupOther: "Other",
			trSelectAll: "Select all",
			trClear: "Clear",
			trWriteMode: "Write mode",
			trModeInsert: "Insert (error on conflict)",
			trModeIgnore: "Skip duplicates",
			trModeReplace: "Replace (by primary key)",
			trModeTruncate: "Clear then write (dangerous)",
			trBatchSize: "Batch size",
			trTableConcurrency: "Table parallelism",
			trShardConcurrency: "Shard parallelism",
			trStart: "Start transfer",
			trCancel: "Cancel task",
			trProgress: "Transfer progress",
			trStatus: "Status",
			trRows: "Rows written",
			trShards: "Shards",
			trFailures: "Failures",
			trStatusRunning: "Running",
			trStatusDone: "Done",
			trStatusFailed: "Failed",
			trStatusCancelled: "Cancelled",
			trStatusPending: "Pending",
			trxOverwrite: "Overwrite existing table structure (drop & recreate, dangerous)",
			trxOverwriteHint: "Existing target tables will be dropped and recreated; their data will be lost",
			trHistory: "Transfer History",
			trHistoryClear: "Clear history",
			trHistoryClearConfirm: "Clear all transfer history for this project?",
			trHistoryEmpty: "No history yet",
			trSameConn: "Source and target share the same context; pick a different database or schema",
			trLoadingTables: "Loading tables…",
			// Data transfer (Navicat-style two columns)
			trxSource: "Source",
			trxTarget: "Target",
			trxConn: "Connection:",
			trxDatabase: "Database:",
			trxSchema: "Schema:",
			trxInfo: "Information",
			trxConnType: "Type",
			trxConnName: "Name",
			trxHost: "Host",
			trxPort: "Port",
			trxServerVer: "Server version",
			trxNoDbLevel: "Default context",
			trxPickSource: "Pick a source connection to load tables",
			trxSelectedCount: "{n} selected",
			trxOptions: "Transfer options",
			trxArrowLabel: "Transfer direction: source to target",
			trxPickTable: "Select at least one table",
			trxLoadDbsFail: "Failed to load databases",
			footerHint: "Manage here in the sidebar; business operations require a project grant on the connection.",
			newConn: "New Connection",
			editConn: "Edit Connection",
			noConns: "No connections yet. Click \"New Connection\" to add one.",
			needProjectPath: "Project path is empty and browsing is unavailable: enter the current project's absolute path in the input above (e.g. /home/me/my-app), then retry.",
			connName: "Name / alias",
			connId: "Connection ID",
			urlMode: "URL",
			fieldsMode: "Fields",
			url: "Connection URL (password moved to secrets automatically)",
			urlUser: "Username (optional, injected into URL)",
			urlPassword: "Password (optional, injected into URL; blank keeps saved)",
			fieldsHost: "Host",
			fieldsPort: "Port",
			fieldsUser: "User",
			fieldsPassword: "Password",
			passwordSaved: "Saved (leave blank to keep)",
			fieldsDatabase: "Database",
			ssl: "Enable SSL",
			test: "Test",
			testing: "Testing…",
			testOk: "Connection OK",
			testFail: "Connection failed",
			edit: "Edit",
			trRefresh: "Refresh (reload expanded databases/schemas/tables)",
			delete: "Delete",
			deleteConnConfirm: "Delete connection \"{name}\"? Its secrets and all project grants will be removed.",
			fieldKind: "Database type",
			requiredMark: " (required)",
			deleteConnTitle: "Delete Connection",
			auditShort: "Audit log",
			noConnsGuide: "No connections yet — add one first, then grant it to your project.",
			addConn: "Add Connection",
			confirmParams: "Params",
			grantModeGroup: "Access mode for {name}",
			save: "Save",
			cancel: "Cancel",
			saving: "Saving…",
			idAutoHint: "leave empty to auto-generate",
			auditTitle: "Audit (last {n})",
			auditEmpty: "No audit entries for this project",
			auditTime: "Time",
			auditAction: "Action",
			auditConn: "Conn",
			auditDetail: "Detail",
			auditDenied: "denied",
			auditConfirmed: "confirmed",
			exportConns: "Export",
			importConns: "Import",
			passphrase: "Passphrase",
			passphraseHint: "8+ characters, used only for this export/import",
			exportDone: "Exported {n} connection(s)",
			importResult: "Imported {i}, skipped {s}",
			importPartialFail: "Partial failure: {i} imported, {s} skipped, {f} failed",
			importDecryptFail: "Wrong passphrase or corrupted file",
			pickFile: "Pick file",
			grantsHint: "Grant connections to the current project. ro = read-only (query/browse), rw = read-write (execute/script allowed). Unauthorized connections are always rejected.",
			grantsEmptyHint: "No connections granted to this project yet. Pick read-only or read-write on a row below to grant.",
			grantsSummary: "{granted}/{total} connections granted",
			modeBadgeRo: "RO",
			modeBadgeRw: "RW",
			modeNone: "none",
			modeRo: "read-only ro",
			modeRw: "read-write rw",
			noDatabases: "No databases available",
			noSchemas: "No schemas",
			noTables: "No tables",
			defaultDb: "Default DB",
			loadFailed: "Failed to load",
			structure: "Structure",
			preview: "Preview",
			column: "Column",
			dataType: "Type",
			nullable: "Nullable",
			keyCol: "Key",
			defaultVal: "Default",
			comment: "Comment",
			nextPage: "Next",
			prevPage: "Prev",
			pageInfo: "Page {page} (50 rows/page)",
			previewTruncated: "Result truncated",
			browseDialogTitle: "{conn} / {db} / {table}",
			close: "Close",
			emptyStructure: "No columns",
			emptyData: "No rows",
			retry: "Retry",
			selectTableHint: "Select a table on the left to view data",
			// Cell bottom detail bar (Navicat-style in-place write-back)
			cellValue: "Full value",
			copyBtn: "Copy",
			copied: "Copied",
			setNull: "Set NULL",
			cellSaving: "Saving…",
			readOnlyRo: "Read-only grant; editing disabled",
			noPkHint: "No primary key; in-place editing unavailable",
			truncatedNoEdit: "Value shown truncated; edit via SQL Console instead",
			blobNoEdit: "Binary values cannot be edited here",
			redisTypeRo: "This Redis type cannot be edited here",
			modeScript: "script",
			run: "Run",
			running: "Running…",
			sqlPlaceholder: "SQL / command… (Redis: [\"GET\",\"key\"]; Mongo: {\"find\":\"users\",\"filter\":{}})",
			// SQL console (multi-tab rework): tabs / toolbar / pre-classification / transactions / history
			modeSql: "SQL",
			newTab: "New tab",
			closeTab: "Close tab",
			queryTab: "Query {n}",
			runSelection: "Run selection",
			formatSql: "Format",
			skippedRo: "Skipped (read-only grant)",
			locate: "Locate",
			historyTitle: "History",
			historyEmpty: "No history yet",
			txBegin: "Begin",
			txCommit: "Commit",
			txRollback: "Roll back",
			txActive: "In transaction",
			txInline: "In tx",
			txDefaultDbOnly: "Transactions bind the connection's default database: clear the database selection first",
			routeQuery: "read",
			routeExec: "write",
			routeScript: "script",
			// View state & console (T2)
			selectConn: "Select a connection…",
			copyFailed: "Copy failed",
			scriptPlaceholder: "JS script (vm sandbox, with db helper)…",
			paramsJson: "params (JSON array, optional; shared by every statement in a batch)",
			rowsResult: "{n} rows",
			execResult: "{n} rows affected",
			needConfirmTitle: "Dangerous operation",
			dangerLevel: "Danger",
			reason: "Reason",
			confirmRun: "Confirm & run",
			confirmCancel: "Cancel",
			confirmHint: "The server flagged this statement as dangerous; it only runs after manual confirmation (challenge valid for 5 minutes).",
			cancelled: "Cancelled",
			error: "Error",
			ok: "Done",
		};

		let activeLocale = "zh";
		function attachLocale(locale) {
			try {
				activeLocale = (locale && locale.getSnapshot && locale.getSnapshot().active) || "zh";
			} catch (e) { /* 保持默认 */ }
		}
		function t(key, params) {
			let text = (activeLocale === "en" ? en[key] : undefined) || zh[key] || en[key] || key;
			if (params !== undefined && params !== null) {
				for (const [name, value] of Object.entries(params)) {
					text = String(text).split("{" + name + "}").join(String(value));
				}
			}
			return text;
		}

		const TAB_ID = "dsh-db-tool";
		const API = "/dsh-db-tool/api";
		const DB_KINDS = ["mysql", "postgresql", "gaussdb", "sqlite", "redis", "mongodb", "oracle", "dmdb"];
		const PAGE_SIZE = 50; // 契约：preview limit≤50 服务端强制

		// --- HTTP 封装：保留 code / challengeId 供确认通道使用 ---
		async function api(path, opts) {
			opts = opts || {};
			const method = opts.method || "GET";
			const init = { method, headers: {} };
			if (opts.body !== undefined) {
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(opts.body);
			}
			const response = await fetch(API + "/" + path, init);
			const text = await response.text();
			let data;
			try { data = text ? JSON.parse(text) : {}; }
			catch (e) { throw new Error("bad JSON (" + response.status + "): " + text.slice(0, 200)); }
			if (data && data.ok) return data.data;
			const err = new Error(String((data && data.error) || ("HTTP " + response.status)));
			err.code = data && data.code;
			if (data && data.challengeId) {
				err.challengeId = data.challengeId;
				err.statement = data.statement;
				err.danger = data.danger;
				err.reason = data.reason;
				err.params = data.params; // 服务端如回传参数则透传（对话框代入展示用；缺失时 undefined 无害）
			}
			throw err;
		}
		function qs(params) {
			const u = new URLSearchParams();
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
			}
			const s = u.toString();
			return s ? "?" + s : "";
		}

		// --- 危险操作确认通道：NEEDS_CONFIRMATION → 对话框 → 带 challengeId 重发 ---
		async function runGuarded(send, askConfirm) {
			try {
				return await send(undefined);
			} catch (e) {
				if (e && e.code === "NEEDS_CONFIRMATION" && e.challengeId) {
					const yes = await askConfirm({ statement: e.statement, danger: e.danger, reason: e.reason, params: e.params });
					if (!yes) { const err = new Error(t("cancelled")); err.cancelled = true; throw err; }
					return await send(e.challengeId);
				}
				throw e;
			}
		}

		function icon(size) {
			const s = size || 16;
			return React.createElement(
				"svg",
				{ width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8" },
				React.createElement("ellipse", { cx: "12", cy: "5.5", rx: "8", ry: "3" }),
				React.createElement("path", { d: "M4 5.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" }),
				React.createElement("path", { d: "M4 11.5v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" }),
			);
		}

		let styleEl = null;
		function ensureStyles() {
			if (styleEl) return;
			styleEl = document.createElement("style");
			styleEl.textContent = [
				"/* ===== Apple-style Design Tokens（dark 基线，light 经 media query 反转；.dbt-browse-root 并入以承载内嵌浏览面板与单元格浮层） ===== */",
				".dbt-panel,.dbt-browse-root{--dbt-accent:var(--dsh-accent,#0a84ff);--dbt-bg:transparent;--dbt-surface:rgba(120,120,128,.12);--dbt-surface-strong:rgba(120,120,128,.18);--dbt-separator:rgba(120,120,128,.24);--dbt-text:rgba(235,235,245,.92);--dbt-text-secondary:rgba(235,235,245,.6);--dbt-danger:#ff453a;--dbt-success:#30d158;--dbt-warning:#ffd60a;--dbt-dialog-bg:rgba(40,40,44,.85);--dbt-th-bg:rgba(30,30,32,.72);--dbt-seg-active:rgba(255,255,255,.14);--dbt-shadow:0 8px 32px rgba(0,0,0,.28);--dbt-radius-card:12px;--dbt-radius-ctrl:8px;--dbt-radius-pill:6px;--dbt-caption:11px;--dbt-caption-xs:10px;--dbt-ease:cubic-bezier(.25,.1,.25,1);--dbt-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif;}",
				"@media (prefers-color-scheme: light){.dbt-panel,.dbt-browse-root{--dbt-accent:var(--dsh-accent,#007aff);--dbt-surface:rgba(120,120,128,.08);--dbt-surface-strong:rgba(120,120,128,.14);--dbt-separator:rgba(60,60,67,.18);--dbt-text:rgba(30,30,32,.92);--dbt-text-secondary:rgba(60,60,67,.6);--dbt-danger:#ff3b30;--dbt-success:#34c759;--dbt-warning:#ff9f0a;--dbt-dialog-bg:rgba(252,252,252,.9);--dbt-th-bg:rgba(255,255,255,.72);--dbt-seg-active:rgba(255,255,255,.9);--dbt-shadow:0 8px 32px rgba(0,0,0,.12);}}",
				// 浏览面板根自持文字色：PiP 独立文档挂 body 后无侧栏祖先 color 可继承（内嵌/浮窗两态共用）
				".dbt-browse-root{color:var(--dbt-text);}",
				"/* ===== 根容器 ===== */",
				".dbt-panel{font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:10px;padding:16px;height:100%;box-sizing:border-box;overflow-y:auto;}",
				".dbt-panel input[type=\"checkbox\"]{width:16px;height:16px;flex:none;margin:0;accent-color:var(--dbt-accent);}",
				"/* ===== iOS segmented control（顶部 tab） ===== */",
				".dbt-tabs{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;}",
				".dbt-tabs button{flex:1;border:none;background:transparent;color:inherit;border-radius:var(--dbt-radius-pill);padding:5px 8px;font-size:12px;font-weight:500;cursor:pointer;transition:background .18s var(--dbt-ease),box-shadow .18s var(--dbt-ease);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
				".dbt-tabs button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				"/* ===== inset grouped 卡片 ===== */",
				".dbt-card{background:var(--dbt-surface);border:none;border-radius:var(--dbt-radius-card);padding:12px;display:flex;flex-direction:column;gap:8px;}",
				".dbt-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
				"/* ===== 共享列布局（T1 逐步替换各视图内联 flex-column） ===== */",
				".dbt-col{display:flex;flex-direction:column;gap:8px;}",
				".dbt-col.dbt-col-tight{gap:2px;}",
				"/* ===== 填充式无边框输入 ===== */",
				".dbt-row input,.dbt-row select,.dbt-card input,.dbt-card select,.dbt-card textarea,.dbt-group input,.dbt-group select{flex:1;min-width:60px;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:5px 12px;font-size:13px;font-family:inherit;transition:outline-color .18s var(--dbt-ease),outline-width .18s var(--dbt-ease);}",
				".dbt-row input:focus,.dbt-row select:focus,.dbt-card input:focus,.dbt-card select:focus,.dbt-card textarea:focus,.dbt-group input:focus,.dbt-group select:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
				".dbt-card textarea{font-family:var(--dbt-mono);min-height:96px;resize:vertical;}",
				"/* ===== 按钮 ===== */",
				".dbt-btn{border:none;background:var(--dbt-surface);color:inherit;border-radius:var(--dbt-radius-ctrl);padding:5px 12px;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .18s var(--dbt-ease),filter .18s var(--dbt-ease),transform .18s var(--dbt-ease),opacity .18s var(--dbt-ease);}",
				".dbt-btn:active{transform:scale(.97);}",
				".dbt-btn.primary{background:var(--dbt-accent);color:#fff;}",
				".dbt-btn.danger{color:var(--dbt-danger);background:transparent;border:1px solid var(--dbt-danger);}",
				".dbt-btn:disabled{opacity:.4;cursor:default;transform:none;}",
				"/* ===== 文本反馈 ===== */",
				".dbt-panel strong,.dbt-browse-root strong{font-size:13px;font-weight:600;}",
				".dbt-muted,.dbt-readhint{color:var(--dbt-text-secondary);font-size:11px;}",
				".dbt-err{color:var(--dbt-danger);font-size:12px;white-space:pre-wrap;}",
				".dbt-msg{color:var(--dbt-success);font-size:12px;white-space:pre-wrap;}",
				"/* ===== 行 hairline 表格 + 毛玻璃 sticky 表头 ===== */",
				".dbt-table{width:100%;border-collapse:collapse;font-size:12px;}",
				".dbt-table th,.dbt-table td{border:none;border-bottom:1px solid var(--dbt-separator);padding:7px 10px;text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".dbt-table th{position:sticky;top:0;z-index:1;background:var(--dbt-th-bg);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);font-weight:600;font-size:12px;}",
				".dbt-table td{font-family:var(--dbt-mono);}",
				".dbt-tablewrap{border:none;border-radius:var(--dbt-radius-card);overflow:auto;max-height:320px;background:var(--dbt-surface);}",
				"/* ===== 结果网格（SQL 控制台）：可排序表头按钮（毛玻璃 sticky 表头复用 .dbt-table th，不另设） ===== */",
				".dbt-grid-sort{border:none;background:transparent;color:inherit;font:inherit;font-weight:600;font-size:12px;padding:0;margin:0;cursor:pointer;display:block;width:100%;text-align:left;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".dbt-grid-sort:focus-visible{outline:2px solid var(--dbt-accent);outline-offset:-1px;border-radius:2px;}",
				"/* ===== SQL 控制台（多标签）：标签条 / 编辑器宿主 / 结果行路由徽标（全 token，跟随明暗） ===== */",
				".dbt-cm-tabbar{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;overflow-x:auto;}",
				".dbt-cm-tab{display:flex;align-items:center;gap:4px;border:none;background:transparent;color:inherit;font-size:12px;padding:5px 8px;border-radius:var(--dbt-radius-pill);cursor:pointer;white-space:nowrap;transition:background .18s var(--dbt-ease);}",
				".dbt-cm-tab.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				".dbt-cm-tabclose{border:none;background:transparent;color:inherit;opacity:.5;padding:0 1px;cursor:pointer;font-size:11px;line-height:1;}",
				".dbt-cm-tabclose:hover{opacity:1;}",
				".dbt-editor-host{height:280px;display:flex;flex-direction:column;}",
				".dbt-editor-host textarea{flex:1;font-family:var(--dbt-mono);background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:8px 10px;resize:none;}",
				".dbt-editor-host textarea:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
				".dbt-routechip{flex:none;background:var(--dbt-surface-strong);color:var(--dbt-text-secondary);border-radius:6px;padding:1px 6px;font-size:var(--dbt-caption-xs,10px);font-weight:600;line-height:1.45;}",
				"/* ===== 浏览面板表格：列分明（列间 hairline + 表头加深一档 + 行 hover） ===== */",
				".dbt-browse-root .dbt-table th + th,.dbt-browse-root .dbt-table td + td{border-left:1px solid var(--dbt-separator);}",
				".dbt-browse-root .dbt-table th{background:rgba(30,30,32,.85);}",
				".dbt-browse-root .dbt-table td{font-size:12px;}",
				"@media (prefers-color-scheme: light){.dbt-browse-root .dbt-table th{background:rgba(242,242,247,.9);}}",
				"/* ===== 对话框（macOS alert 材质） ===== */",
				".dbt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;}",
				".dbt-dialog{background:var(--dbt-dialog-bg);color:inherit;border:1px solid var(--dbt-separator);border-radius:var(--dbt-radius-card);padding:16px;max-width:460px;width:90%;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;font-size:13px;-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:var(--dbt-shadow);}",
				".dbt-dialog pre{background:var(--dbt-surface-strong);border-radius:var(--dbt-radius-pill);padding:8px;font-family:var(--dbt-mono);font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;}",
				".dbt-dialog .dbt-row{justify-content:flex-end;}",
				"/* ===== 授权/连接列表：inset grouped（一张卡多行 hairline） ===== */",
				".dbt-group{background:var(--dbt-surface);border-radius:var(--dbt-radius-card);overflow:hidden;display:flex;flex-direction:column;}",
				".dbt-listrow{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--dbt-separator);transition:background .18s var(--dbt-ease);}",
				".dbt-listrow:last-child{border-bottom:none;}",
				".dbt-tree{display:flex;flex-direction:column;}",
				"/* ===== Navicat 式对象树（数据浏览） ===== */",
				".dbt-treerow{display:flex;gap:6px;align-items:center;padding:10px 12px;font-size:13px;cursor:pointer;user-select:none;border-bottom:1px solid var(--dbt-separator);transition:background .15s var(--dbt-ease);}",
				".dbt-treerow:last-child{border-bottom:none;}",
				".dbt-treerow.active{color:var(--dbt-accent);font-weight:600;}",
				".dbt-chev{flex:none;width:12px;text-align:center;color:var(--dbt-text-secondary);font-size:var(--dbt-caption-xs);line-height:1;transition:transform .18s var(--dbt-ease);}",
				".dbt-chev.open{transform:rotate(90deg);}",
				".dbt-chev.leaf{visibility:hidden;}",
				".dbt-treename{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				/* ===== Navicat 式浏览（内嵌面板，纵向流式；浮窗壳类已随 DOM 回收） ===== */
				".dbt-browse-body{display:flex;flex-direction:column;gap:10px;min-height:0;}",
				".dbt-browse-tree{flex:none;max-height:280px;overflow-y:auto;background:var(--dbt-surface);border-radius:var(--dbt-radius-card);}",
				".dbt-browse-main{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;}",
				".dbt-browse-tabs{flex:none;}",
				".dbt-browse-content{flex:1;min-height:0;position:relative;display:flex;flex-direction:column;}",
				".dbt-browse-tablewrap{flex:1 1 auto;min-height:120px;overflow:auto;border:none;border-radius:var(--dbt-radius-card);background:var(--dbt-surface);}",
				".dbt-browse-footer{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);}",
				".dbt-browse-empty{display:flex;align-items:center;justify-content:center;color:var(--dbt-text-secondary);font-size:13px;padding:24px 12px;}",
				".dbt-browse-errorbox{display:flex;flex-direction:column;gap:8px;align-items:flex-start;}",
				".dbt-browse-skel{display:flex;flex-direction:column;gap:8px;}",
				".dbt-browse-skelrow{display:flex;gap:8px;}",
				".dbt-browse-skelcell{flex:1;height:24px;background:var(--dbt-surface-strong);border-radius:var(--dbt-radius-pill);}",
				"/* ===== 数据传输（Navicat 式双栏：摘要条 + 源/目标栏 + 信息区） ===== */",
				".dbt-transfer-summary{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;}",
				".dbt-transfer-endpoint{display:flex;align-items:baseline;gap:4px;min-width:0;}",
				".dbt-transfer-endpoint strong,.dbt-transfer-endpoint span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;}",
				".dbt-transfer-cols{display:flex;gap:8px;align-items:stretch;}",
				".dbt-transfer-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px;}",
				".dbt-transfer-coltitle,.dbt-transfer-infotitle{font-size:var(--dbt-caption,11px);font-weight:600;color:var(--dbt-accent);}",
				".dbt-transfer-field{display:flex;flex-direction:column;gap:2px;min-width:0;}",
				".dbt-transfer-fieldlabel{font-size:var(--dbt-caption-xs,10px);color:var(--dbt-text-secondary);}",
				".dbt-transfer-divider{flex:none;align-self:center;color:var(--dbt-text-secondary);}",
				".dbt-transfer-info{border-top:1px solid var(--dbt-separator);padding-top:6px;display:flex;flex-direction:column;gap:3px;}",
				".dbt-transfer-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin:0;font-size:var(--dbt-caption-xs,10px);}",
				".dbt-transfer-kv dt{color:var(--dbt-text-secondary);}",
				".dbt-transfer-kv dd{margin:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".dbt-transfer-tablelist{max-height:220px;overflow:auto;border:1px solid var(--dbt-separator);border-radius:var(--dbt-radius-ctrl,6px);padding:3px 0;font-size:12px;background:var(--dbt-surface-strong);}",
				".dbt-tr-group-head{display:flex;align-items:center;gap:6px;padding:3px 8px;min-height:26px;font-weight:600;cursor:pointer;user-select:none;}",
				".dbt-tr-group-head:hover{background:var(--dbt-surface);}",
				".dbt-tr-caret{display:inline-block;width:0;height:0;border-left:4px solid currentColor;border-top:3px solid transparent;border-bottom:3px solid transparent;opacity:.55;transform:rotate(0deg);transition:transform .12s var(--dbt-ease);flex:none;}",
				".dbt-tr-caret.open{transform:rotate(90deg);}",
				".dbt-tr-item{display:flex;align-items:center;padding:1px 8px 1px 26px;min-height:24px;}",
				".dbt-tr-item:hover{background:var(--dbt-surface);}",
				".dbt-tr-pair{display:flex;align-items:center;gap:6px;cursor:pointer;min-width:0;}",
				".dbt-tr-pair span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".dbt-tr-comment{color:var(--dbt-text-secondary);font-size:11px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0;}",
				".dbt-transfer-options>summary{cursor:pointer;font-size:var(--dbt-caption,11px);color:var(--dbt-text-secondary);padding:4px 0;}",
				"/* ===== 浏览面板：单元格按钮与详情底栏（Apple 分区卡） ===== */",
				".dbt-cellbtn{border:none;background:transparent;color:inherit;font:inherit;padding:0;margin:0;cursor:pointer;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;width:100%;text-align:left;}",
				".dbt-cellbtn:focus-visible{outline:2px solid var(--dbt-accent);outline-offset:-1px;border-radius:2px;}",
				".dbt-celldetail{flex:none;margin-top:10px;padding:12px;background:#2c2c2e;border-radius:var(--dbt-radius-card);display:flex;flex-direction:column;gap:8px;}",
				"@media (prefers-color-scheme: light){.dbt-celldetail{background:#f5f5f7;}}",
				".dbt-celldetail-input{font-family:var(--dbt-mono);font-size:12px;min-height:72px;resize:vertical;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:8px;width:100%;box-sizing:border-box;}",
				".dbt-celldetail-input:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
				".dbt-celledit{display:flex;flex-direction:column;gap:8px;}",
				".dbt-celledit textarea{font-family:var(--dbt-mono);font-size:13px;min-height:96px;resize:vertical;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:5px 12px;}",
				".dbt-celledit textarea:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
				".dbt-nullchip{display:inline-flex;align-items:center;border:1px solid var(--dbt-warning);color:var(--dbt-warning);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;}",
				"/* ===== 视图切换入场（仅 transform/opacity；reduced-motion 全局已禁） ===== */",
				"@keyframes dbt-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}",
				".dbt-view{display:flex;flex-direction:column;gap:10px;animation:dbt-in .22s var(--dbt-ease);}",
				"/* ===== mini segmented（ro/rw 等切换） ===== */",
				".dbt-seg{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;}",
				".dbt-seg button{flex:none;border:none;background:transparent;color:inherit;font-size:12px;padding:5px 12px;border-radius:var(--dbt-radius-pill);cursor:pointer;transition:background .18s var(--dbt-ease),box-shadow .18s var(--dbt-ease);}",
				".dbt-seg button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				"/* ===== hover 仅精确指针（触屏 tap 不残留 hover 底色） ===== */",
				"@media (hover:hover) and (pointer:fine){.dbt-btn:hover{background:var(--dbt-surface-strong);}.dbt-btn.primary:hover{filter:brightness(1.1);}.dbt-btn.danger:hover{background:rgba(255,69,58,.12);}.dbt-listrow:hover{background:var(--dbt-surface-strong);}.dbt-treerow:hover{background:var(--dbt-surface-strong);}.dbt-browse-root .dbt-table tbody tr:hover td{background:var(--dbt-surface-strong);}}",
				"/* ===== 降级：透明度减弱 / 动效减弱 ===== */",
				"@media (prefers-reduced-transparency: reduce){.dbt-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(0,0,0,.55);}.dbt-dialog{backdrop-filter:none;-webkit-backdrop-filter:none;background:#2c2c2e;}.dbt-celldetail{background:#2c2c2e;}.dbt-table th{backdrop-filter:none;-webkit-backdrop-filter:none;background:#1e1e20;}.dbt-browse-root .dbt-table th{background:#1e1e20;}}",
				"@media (prefers-color-scheme: light) and (prefers-reduced-transparency: reduce){.dbt-dialog{background:#f2f2f7;}.dbt-celldetail{background:#f2f2f7;}.dbt-table th,.dbt-browse-root .dbt-table th{background:#f2f2f7;}}",
				"@media (prefers-reduced-motion: reduce){.dbt-panel *,.dbt-browse-root *{transition:none!important;animation:none!important;}.dbt-btn:active{transform:none;}}",
			].join("\n");
			document.head.appendChild(styleEl);
		}

		function DangerDialog(props) {
			const ch = props.challenge; // {statement, danger, reason, resolve, target?, params?, title?, confirmLabel?, hint?}
			const dialogRef = React.useRef(null);
			const cancelRef = React.useRef(null);
			const titleId = "dbt-confirm-title";
			function done(v) { props.onClose(); ch.resolve(v); }
			// 键盘契约：Escape=取消；Tab/Shift+Tab 在「确认执行」「取消」两枚按钮间循环锁定，焦点不逃出对话框
			function onKeyDown(e) {
				if (e.key === "Escape") { e.preventDefault(); done(false); return; }
				if (e.key !== "Tab") return;
				const dialog = dialogRef.current;
				if (!dialog) return;
				const btns = dialog.querySelectorAll("button");
				if (btns.length === 0) return;
				const first = btns[0];
				const last = btns[btns.length - 1];
				const doc = dialog.ownerDocument || document;
				if (!dialog.contains(doc.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
				if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
				else if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
			}
			// 挂载后焦点落「取消」：次动作为键盘默认，防回车/空格误触危险确认
			React.useEffect(() => {
				if (cancelRef.current && typeof cancelRef.current.focus === "function") cancelRef.current.focus();
			}, []);
			// 有 params 时 pre 展示代入后的完整语句（? → 字面量）；params 为空/非法 JSON 视为无参数
			let hasParams = false;
			try {
				const parsed = typeof ch.params === "string" ? JSON.parse(ch.params) : ch.params;
				if (Array.isArray(parsed) && parsed.length > 0) hasParams = true;
			} catch (e) { /* 非法 JSON：按无参数展示 */ }
			const shownStatement = hasParams ? renderStatementWithParams(ch.statement, ch.params) : (ch.statement || "(?)");
			// 目标条徽标：ro=muted、rw=danger，形状对齐 kind 徽标（纯内联样式，样式块不承载对话框专属规则）
			const target = ch.target;
			const modeBadge = target && target.mode
				? React.createElement("span", {
					style: {
						background: "var(--dbt-surface-strong, rgba(120,120,128,.18))",
						borderRadius: "6px",
						padding: "2px 6px",
						fontSize: "11px",
						lineHeight: 1.45,
						fontWeight: 600,
						color: target.mode === "rw" ? "var(--dbt-danger, #ff453a)" : "var(--dbt-text-secondary, rgba(235,235,245,.6))",
					},
				}, target.mode === "rw" ? t("modeRw") : t("modeRo"))
				: null;
			return React.createElement(
				"div",
				{ className: "dbt-overlay", onClick: () => done(false), onKeyDown },
				React.createElement(
					"div",
					{
						className: "dbt-dialog",
						onClick: (e) => e.stopPropagation(),
						role: "dialog",
						"aria-modal": "true",
						"aria-labelledby": titleId,
						ref: dialogRef,
					},
					// macOS alert 风格：纯文字标题 + danger 色，不用 emoji；title 可被 challenge 覆盖（如删除连接）
					React.createElement("strong", { id: titleId, style: { color: "var(--dbt-danger, #ff453a)" } }, ch.title || t("needConfirmTitle")),
					// 目标条：连接名（semibold 主行）+ kind/db（muted）+ ro/rw 徽标；target 缺失不渲染
					target && target.conn ? React.createElement(
						"div",
						{ className: "dbt-row" },
						React.createElement("strong", { style: { fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, target.conn),
						target.kind ? React.createElement("span", { className: "dbt-muted" }, target.kind) : null,
						target.db ? React.createElement("span", { className: "dbt-muted" }, target.db) : null,
						modeBadge,
					) : null,
					React.createElement("pre", null, shownStatement),
					hasParams ? React.createElement(
						"div",
						{ className: "dbt-muted", style: { fontFamily: MONO_FONT, wordBreak: "break-all" } },
						t("confirmParams") + " " + (typeof ch.params === "string" ? ch.params : JSON.stringify(ch.params)),
					) : null,
					// 风险等级/原因行仅服务端危险判定场景渲染（删除连接等本地确认无此二字段）
					(ch.danger || ch.reason) ? React.createElement(
						"div",
						{ className: "dbt-muted" },
						t("dangerLevel") + ": " + (ch.danger || "danger") + " · " + t("reason") + ": " + (ch.reason || "-"),
					) : null,
					React.createElement("div", { className: "dbt-muted" }, ch.hint || t("confirmHint")),
					React.createElement(
						"div",
						// 末对齐由样式层 .dbt-dialog .dbt-row 规则承担，无需内联 style
						{ className: "dbt-row" },
						React.createElement("button", { className: "dbt-btn danger", onClick: () => done(true) }, ch.confirmLabel || t("confirmRun")),
						React.createElement("button", { className: "dbt-btn", onClick: () => done(false), ref: cancelRef }, t("confirmCancel")),
					),
				),
			);
		}

		/* ---------------- 连接管理 ---------------- */
		const EMPTY_FORM = { id: "", kind: "mysql", name: "", mode: "url", url: "", urlUser: "", urlPassword: "", host: "", port: "", user: "", password: "", database: "", ssl: false };

		// 口令弹窗（ManageView 局部复用，导出/导入共用）：键盘契约对齐 DangerDialog
		// （Escape=取消、Tab 在对话框内循环锁定）；差异：初始焦点在口令输入框，确认按钮主色。
		// ponytail: 仅两处使用，故为 ManageView 内部局部组件，不抽通用模块。
		function PassphraseDialog(props) {
			const [value, setValue] = React.useState("");
			const [err, setErr] = React.useState(""); // 就地错误（如口令过短）；读屏经 role=alert 播报
			const inputRef = React.useRef(null);
			const dialogRef = React.useRef(null);
			const titleId = "dbt-pass-title";
			function done(v) { props.onClose(v); }
			function submit() {
				const v = value.trim();
				if (v.length < 8) { setErr(t("passphraseHint")); return; } // 与服务端 PASSPHRASE_MIN=8 对齐（服务端为权威边界）
				done(v);
			}
			function onKeyDown(e) {
				if (e.key === "Escape") { e.preventDefault(); done(null); return; }
				if (e.key === "Enter" && e.target === inputRef.current) { e.preventDefault(); submit(); return; }
				if (e.key !== "Tab") return;
				const dialog = dialogRef.current;
				if (!dialog) return;
				const els = dialog.querySelectorAll("input,button");
				if (els.length === 0) return;
				const first = els[0];
				const last = els[els.length - 1];
				const doc = dialog.ownerDocument || document;
				if (!dialog.contains(doc.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
				if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
				else if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
			}
			// 挂载后焦点落口令输入框（与 DangerDialog 落「取消」不同：本弹窗无危险语义，输入即主路径）
			React.useEffect(() => {
				if (inputRef.current && typeof inputRef.current.focus === "function") inputRef.current.focus();
			}, []);
			return React.createElement(
				"div",
				{ className: "dbt-overlay", onClick: () => done(null), onKeyDown },
				React.createElement(
					"div",
					{
						className: "dbt-dialog",
						onClick: (e) => e.stopPropagation(),
						role: "dialog",
						"aria-modal": "true",
						"aria-labelledby": titleId,
						ref: dialogRef,
					},
					React.createElement("strong", { id: titleId }, props.title),
					React.createElement("input", {
						type: "password",
						"aria-label": t("passphrase"),
						placeholder: t("passphrase"),
						autoComplete: "off",
						value,
						ref: inputRef,
						onChange: (e) => { setValue(e.target.value); if (err) setErr(""); },
					}),
					React.createElement("div", { className: "dbt-muted" }, t("passphraseHint")),
					err ? React.createElement("div", { className: "dbt-err", role: "alert" }, err) : null,
					React.createElement(
						"div",
						{ className: "dbt-row" },
						React.createElement("button", { className: "dbt-btn primary", onClick: submit }, props.confirmLabel),
						React.createElement("button", { className: "dbt-btn", onClick: () => done(null) }, t("cancel")),
					),
				),
			);
		}
		// 通用表格渲染：columns + rows（审计列表与查询结果共用）；wrapClass 可选（浏览弹窗用自适应高度容器）
		function resultTable(columns, rows, cellTitles, wrapClass) {
			return React.createElement(
				"div",
				{ className: wrapClass || "dbt-tablewrap" },
				React.createElement(
					"table",
					{ className: "dbt-table" },
					React.createElement(
						"thead",
						null,
						React.createElement("tr", null, columns.map((c, i) => React.createElement("th", { key: i }, c))),
					),
					React.createElement(
						"tbody",
						null,
						rows.map((row, i) =>
							React.createElement("tr", { key: i },
								row.map((cell, j) =>
									React.createElement("td", { key: j, title: cellTitles ? cellTitles(row, cell, j) : cell === null ? "NULL" : String(cell) },
										// NULL 用 muted 弱化；其余保持 String(cell) 渲染语义不变
										cell === null ? React.createElement("span", { className: "dbt-muted" }, "NULL") : String(cell)))),
						),
					),
				),
			);
		}

	/* ---------------- 单元格写回：方言与命令构造（纯函数层，PreviewGrid 与测试共用） ---------------- */
		// Stryker restore all（以下至 buildMongoOp 为变异目标区）
		// 统一返回形状：{ ok:true, ops:[{statement, params?, database?}] }（多条顺序执行，如 redis 两步）
		// 或 { ok:false, error:"<i18n key>" }（error 为 key 名，组件侧 t() 本地化；null 表示通用错误）

		// 方言判定：q=问号占位符（mysql/sqlite）、dollar=$n（postgresql/gaussdb）、colon=:n（oracle/dmdb）
		function dialectOf(kind) {
			if (kind === "mysql" || kind === "sqlite") return "q";
			if (kind === "postgresql" || kind === "gaussdb") return "dollar";
			if (kind === "oracle" || kind === "dmdb") return "colon";
			if (kind === "redis") return "redis";
			if (kind === "mongodb") return "mongo";
			return null;
		}

		// 标识符引用：mysql 用反引号（内部双写转义），其余统一双引号（内部双写转义）
		function quoteIdent(kind, name) {
			const q = kind === "mysql" ? "`" : "\"";
			return q + String(name).split(q).join(q + q) + q;
		}

		// 单元格文本 → 写回值：JSON 可解析且结果非字符串才用解析值（类型不漂移：显示 "123" 保持字符串，
		// 数字列显示 123 → parse 得 number 123）
		function parseCellText(text) {
			try {
				const v = JSON.parse(text);
				if (typeof v !== "string") return v;
			} catch (e) { /* 非 JSON 按原字符串 */ }
			return text;
		}

		// 截断/BLOB 标记（后端 normalize 产物）：命中即禁止就地编辑，防旧值覆盖真实数据
		function isTruncatedCell(text) {
			const s = String(text);
			// sql-shared 嵌套 JSON 以 "…[已截断]" 结尾；redis/mongo/oracle/dmdb 的 "…[截断,共N字符]"
			// 结尾是"字符]"，endsWith 永不命中，故该形态用 includes 检测
			return s.endsWith("…[已截断]") || s.includes("…[截断,共");
		}
		function isBlobCell(text) {
			const s = String(text);
			return s.startsWith("[BLOB ") && s.endsWith("bytes]");
		}

		// SQL 6 库 UPDATE 构造：全限定表名 + 方言占位符 + 主键 WHERE；params 顺序 = [新值(非 NULL 时), ...pkValues]
		function buildUpdate(kind, tableName, dbRef, schemaName, colName, newRawText, isNull, pkCols, pkValues) {
			if (!Array.isArray(pkCols) || pkCols.length === 0 || !colName || !tableName) {
				return { ok: false, error: "noPkHint" };
			}
			// 表全限定：pg/gauss 用 schema 前缀（库由 execute 的 database 参数路由，语句内不写库名）；
			// mysql 带库名（adapter 无 database 路由）；oracle/dmdb 的 dbRef 即 OWNER；sqlite 仅表名
			// execute 的 database 参数只传库名（db.schema 形态取点前段），连接目标只能是库，schema 靠语句内全限定
			let table;
			if (kind === "postgresql" || kind === "gaussdb") {
				table = schemaName
					? quoteIdent(kind, schemaName) + "." + quoteIdent(kind, tableName)
					: quoteIdent(kind, tableName);
			} else if (kind === "mysql" || kind === "oracle" || kind === "dmdb") {
				table = quoteIdent(kind, dbRef) + "." + quoteIdent(kind, tableName);
			} else {
				table = quoteIdent(kind, tableName);
			}
			const dialect = dialectOf(kind);
			// 占位符编号按 params 顺序：新值（非 NULL 时占 1 号）→ 主键逐列
			const params = [];
			const ph = (i) => (dialect === "dollar" ? "$" + i : dialect === "colon" ? ":" + i : "?");
			let setSql;
			if (isNull) {
				setSql = quoteIdent(kind, colName) + " = NULL";
			} else {
				params.push(parseCellText(newRawText));
				setSql = quoteIdent(kind, colName) + " = " + ph(params.length);
			}
			const wheres = pkCols.map((c, i) => quoteIdent(kind, c) + " = " + ph((isNull ? 0 : 1) + i + 1));
			for (const v of (pkValues || [])) params.push(v);
			return {
				ok: true,
				ops: [{
					statement: "UPDATE " + table + " SET " + setSql + " WHERE " + wheres.join(" AND "),
					params,
					database: kind === "sqlite" ? undefined : dbRef.split(".")[0],
				}],
			};
		}

		// Redis 写命令构造（命令数组 JSON 化后经 execute 透传）：仅数据位（value/score/member）可改，
		// 键名/字段名只读；list/stream 与 NULL 写入不支持
		function buildRedisOp(tableName, tableType, columns, rowValues, colName, newRawText, isNull) {
			if (tableType === "list" || tableType === "stream" || isNull) {
				return { ok: false, error: "redisTypeRo" };
			}
			const valueOf = (col) => rowValues[columns.indexOf(col)];
			const one = (args) => ({ ok: true, ops: [{ statement: JSON.stringify(args) }] });
			const two = (a, b) => ({ ok: true, ops: [{ statement: JSON.stringify(a) }, { statement: JSON.stringify(b) }] });
			if (tableType === "string") {
				if (colName === "value") return one(["SET", tableName, newRawText]);
				if (colName === "key") return { ok: false, error: "readOnlyRo" };
			} else if (tableType === "hash") {
				if (colName === "value") return one(["HSET", tableName, valueOf("field"), newRawText]);
				if (colName === "field") return { ok: false, error: "readOnlyRo" };
			} else if (tableType === "zset") {
				if (colName === "score") {
					const score = Number(newRawText);
					if (!Number.isFinite(score)) return { ok: false, error: null };
					return one(["ZADD", tableName, score, valueOf("member")]);
				}
				if (colName === "member") {
					// member 是有序集身份值：两步「删旧加新」，score 保持原值
					return two(["ZREM", tableName, valueOf("member")], ["ZADD", tableName, valueOf("score"), newRawText]);
				}
			} else if (tableType === "set") {
				if (colName === "member") return two(["SREM", tableName, valueOf("member")], ["SADD", tableName, newRawText]);
			}
			return { ok: false, error: "redisTypeRo" };
		}

		// MongoDB updateOne 命令文档构造：$set 单字段；filter 的 _id 按主键类型用 $oid 表达，
		// date 列字符串值包 $date（Extended JSON 由服务端 reviveEjson 复活为 BSON 类型）
		function buildMongoOp(tableName, idValue, idIsObjectId, colName, newRawText, isNull, colDataType) {
			if (colName === "_id") return { ok: false, error: "readOnlyRo" };
			let value = isNull ? null : parseCellText(newRawText);
			if (!isNull && typeof value === "string" && typeof colDataType === "string" && colDataType.startsWith("date")) {
				value = { "$date": value };
			}
			const filter = idIsObjectId ? { _id: { "$oid": idValue } } : { _id: idValue };
			return {
				ok: true,
				ops: [{ statement: JSON.stringify({ updateOne: tableName, filter, update: { "$set": { [colName]: value } } }) }],
			};
		}

		// 危险确认对话框展示用：把语句里的 ? 占位符逐个替换为参数的字面渲染（仅展示，不参与真实执行）
		// params 支持 JSON 字符串/数组/undefined；字符串加单引号并内部双写转义，数字/布尔原样，
		// null/undefined 渲染为 NULL；字面量超 120 字符截断加省略号；占位符多于参数时剩余 ? 原样保留
		function renderStatementWithParams(statement, params) {
			let arr = params;
			if (typeof arr === "string") {
				try { arr = JSON.parse(arr); } catch (e) { arr = null; }
			}
			if (!Array.isArray(arr)) arr = [];
			const lit = (v) => {
				let s;
				if (v === null || v === undefined) s = "NULL";
				else if (typeof v === "number" || typeof v === "boolean") s = String(v);
				else s = "'" + String(v).split("'").join("''") + "'";
				return s.length > 120 ? s.slice(0, 120) + "…" : s;
			};
			const parts = String(statement == null ? "" : statement).split("?");
			return parts.map((seg, i) => (i === parts.length - 1 ? seg : seg + (i < arr.length ? lit(arr[i]) : "?"))).join("");
		}

		/* ---------------- 控制台工具纯函数（语句切分 / 格式化方言 / 导出 / 耗时，ConsoleView 与测试共用） ---------------- */

		// sql-formatter 方言映射（vendor bundle 的 format() 用）；mongodb/redis 非 SQL 方言返回 null
		function fmtDialectOf(kind) {
			if (kind === "mysql") return "mysql";
			if (kind === "postgresql" || kind === "gaussdb") return "postgresql";
			if (kind === "sqlite") return "sqlite";
			if (kind === "oracle" || kind === "dmdb") return "plsql";
			return null;
		}

		// SQL 文本 → 语句列表 [{ text, start }]：text 为原文切片（保留内部注释/空白），start 为语句
		// 首字符偏移（跳过前导空白/注释，错误就地显示后定位光标用）。词法跳过与 lang-sql 方言 spec
		// 一一对应：单/双引号字符串（反斜杠与双写转义，mysql 另含反引号标识符）、-- 行注释
		// （slashComments）、/* */ 块注释、$$...$$ dollar-quoting（doubleDollarQuotedStrings，仅
		// postgresql/gaussdb）、MySQL DELIMITER 自定义分隔符（客户端指令：仅语句缓冲为空时切换后续
		// 分隔符，指令行不产生语句）、Oracle/达梦 BEGIN..END 块（块内分号不切分；CREATE
		// PROCEDURE/FUNCTION 体的分号由该块覆盖）。空/纯注释语句被过滤；无尾分隔符的最后一条也返回。
		// ponytail: depth 计数不识别 CASE..END/LOOP/IF 等（块内混用可能提前切分）；需要时换完整 PL/SQL 词法
		function splitSqlStatements(sql, kind) {
			const src = String(sql == null ? "" : sql);
			const out = [];
			const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
			let sep = ";";
			let i = 0, stmtStart = 0, contentStart = 0, hasContent = false, depth = 0; // depth: BEGIN..END 嵌套计数
			while (i < src.length) {
				const c = src[i];
				if (c === "-" && src[i + 1] === "-") { // -- 行注释至行尾
					while (i < src.length && src[i] !== "\n") i++;
					continue;
				}
				if (c === "/" && src[i + 1] === "*") { // /* 块注释至 */（未闭合则吞到结尾）
					i += 2;
					while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
					i = Math.min(src.length, i + 2);
					continue;
				}
				if (c === "'" || c === '"' || (kind === "mysql" && c === "`")) { // 引号串：反斜杠与双写转义
					if (!hasContent) contentStart = i;
					hasContent = true;
					i++;
					while (i < src.length) {
						if (src[i] === "\\") { i += 2; continue; }
						if (src[i] === c) {
							if (src[i + 1] === c) { i += 2; continue; } // 双写转义
							i++;
							break;
						}
						i++;
					}
					continue;
				}
				if ((kind === "postgresql" || kind === "gaussdb") && c === "$" && src[i + 1] === "$") {
					if (!hasContent) contentStart = i; // $$dollar 串至下一 $$（未闭合则吞到结尾）
					hasContent = true;
					i += 2;
					while (i < src.length && !(src[i] === "$" && src[i + 1] === "$")) i++;
					i = Math.min(src.length, i + 2);
					continue;
				}
				// DELIMITER <sep> 客户端指令：仅当前语句缓冲无内容时生效（mysql cli 行首语义）
				if (kind === "mysql" && depth === 0 && !hasContent
					&& (i === 0 || !isWord(src[i - 1]))
					&& src.slice(i, i + 9).toUpperCase() === "DELIMITER"
					&& (src[i + 9] === " " || src[i + 9] === "\t")) {
					let j = i + 9, e = j;
					while (e < src.length && src[e] !== "\n" && src[e] !== "\r") e++;
					while (j < e && (src[j] === " " || src[j] === "\t")) j++;
					if (j < e) { sep = src.slice(j, e); stmtStart = e; i = e; continue; }
				}
				// BEGIN/END 词计数（oracle/dmdb）：块内分号不切分；END 不把 depth 减到负（顶层 CASE..END 不受影响）
				if ((kind === "oracle" || kind === "dmdb") && (i === 0 || !isWord(src[i - 1]))) {
					if (src.slice(i, i + 5).toUpperCase() === "BEGIN" && !isWord(src[i + 5] || " ")) {
						if (!hasContent) contentStart = i;
						depth++; hasContent = true; i += 5; continue;
					}
					if (src.slice(i, i + 3).toUpperCase() === "END" && !isWord(src[i + 3] || " ")) {
						if (depth > 0) depth--;
						if (!hasContent) contentStart = i;
						hasContent = true; i += 3; continue;
					}
				}
				if (depth === 0 && src.startsWith(sep, i)) { // 语句终止：收割有内容的语句
					if (hasContent) out.push({ text: src.slice(stmtStart, i), start: contentStart });
					i += sep.length;
					stmtStart = i;
					contentStart = i;
					hasContent = false;
					continue;
				}
				if (!/\s/.test(c)) { if (!hasContent) contentStart = i; hasContent = true; }
				i++;
			}
			if (hasContent) out.push({ text: src.slice(stmtStart), start: contentStart }); // 无尾分隔符的最后一条
			return out;
		}

		// 结果导出：CSV 侧 NULL/undefined → 空串，含逗号/引号/换行的值按 RFC 4180 双引号包裹且内部
		// 双写转义，行尾统一 \r\n；JSON 侧 NULL 保留 null（不落为空串，避免与空字符串列混淆）
		function csvCell(v) {
			const s = v == null ? "" : String(v);
			return /[",\r\n]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
		}
		function toCsv(columns, rows) {
			const cols = Array.isArray(columns) ? columns : [];
			const lines = [cols.map(csvCell).join(",")];
			for (const row of (Array.isArray(rows) ? rows : [])) {
				lines.push(cols.map((_, i) => csvCell((row || [])[i])).join(","));
			}
			return lines.join("\r\n") + "\r\n";
		}
		function toJson(columns, rows) {
			const cols = Array.isArray(columns) ? columns : [];
			return JSON.stringify((Array.isArray(rows) ? rows : []).map((row) => {
				const o = {};
				cols.forEach((c, i) => { o[c] = (row || [])[i] == null ? null : (row || [])[i]; });
				return o;
			}));
		}

		// 耗时展示：<1000ms 取整为 "N ms"，否则秒保留两位小数
		function fmtMs(n) {
			return n < 1000 ? Math.round(n) + " ms" : (n / 1000).toFixed(2) + " s";
		}

		// Stryker disable all（buildMongoOp 之后：以下 auditTable/KIND_DEFAULTS/buildEditForm 为连接表单工具，无单元断言）
		function auditTable(audit) {
			return resultTable(
				[t("auditTime"), t("auditAction"), t("auditConn"), t("auditDetail")],
				audit.map((a) => [
					a.ts || "",
					(a.action || "") +
						(a.ok === false ? "（" + t("auditDenied") + (a.error ? "：" + a.error : "") + "）" : "") +
						(a.confirmed ? "（" + t("auditConfirmed") + "）" : ""),
					a.connId || "",
					a.statement || "",
				]),
				// statement 全文进 td：视觉截断由 .dbt-table td 的 ellipsis 承担，title 悬浮看全文
			);
		}

		// 各数据库官方默认连接参数（分字段方式自动填充；用户仍可改）
		const KIND_DEFAULTS = {
			mysql: { host: "127.0.0.1", port: 3306, user: "root" },
			postgresql: { host: "127.0.0.1", port: 5432, user: "postgres", database: "postgres" },
			gaussdb: { host: "127.0.0.1", port: 8000, user: "gaussdb", database: "postgres" },
			sqlite: {},
			redis: { host: "127.0.0.1", port: 6379 },
			mongodb: { host: "127.0.0.1", port: 27017, database: "test" },
			oracle: { host: "127.0.0.1", port: 1521, user: "system" },
			dmdb: { host: "127.0.0.1", port: 5236, user: "SYSDBA" },
		};

		/**
		 * 按当前 kind 重填官方默认值。语义：用户手动改过的字段（dirty）保留，
		 * 其余字段重置为该库默认值；该库无此字段时清空（如 sqlite 无 host/port）。
		 */
		function withKindDefaults(form, dirty) {
			const def = KIND_DEFAULTS[form.kind] || {};
			const next = Object.assign({}, form);
			for (const k of ["host", "port", "user", "database"]) {
				if (dirty && dirty.has(k)) continue; // 手改过 → 保留
				next[k] = def[k] !== undefined ? String(def[k]) : "";
			}
			return next;
		}

		/** 新建表单初始态：分字段模式 + 当前 kind 的官方默认值 */
		const freshForm = () => withKindDefaults({ ...EMPTY_FORM, mode: "fields" });

		/** 编辑回填：从 meta 还原已存配置（密码不出库，留空=保留原密码）。
		 *  url 方式 → 回填脱敏 url；分字段方式 → 回填 host/port/user/database。 */
		function buildEditForm(c) {
			const mode = c.mode || (c.safeUrl ? "url" : "fields");
			return {
				...EMPTY_FORM,
				id: c.id, kind: c.kind, name: c.name || "", mode,
				url: c.safeUrl || "",
				urlUser: "", urlPassword: "",
				host: c.host || "", port: c.port != null ? String(c.port) : "",
				user: c.user || "", database: c.database || "",
				ssl: !!c.ssl,
			};
		}

	// UI 组件渲染层无单元断言（纯函数层止于此），禁用至文件尾
	// Stryker disable all
	// 键盘焦点环（单一事实源，ConnForm/ManageView/treerow/preview tr 共用）：样式块本轮冻结、
	// :focus-visible 无内联 style 通道，focus 事件中探测键盘聚焦后直写 accent 内缩描边，blur 还原。
	// selfCheck=true 用于行容器（tr）：子元素聚焦冒泡（React onFocus 走 focusin）时忽略，仅行自身生效。
	function focusRingProps(selfCheck) {
		return {
			onFocus: (e) => {
				const el = e.currentTarget;
				if (selfCheck && e.target !== el) return;
				if (el.matches && el.matches(":focus-visible")) {
					el.style.outline = "2px solid var(--dbt-accent, #0a84ff)";
					el.style.outlineOffset = "-1px";
				}
			},
			onBlur: (e) => { e.currentTarget.style.outline = ""; e.currentTarget.style.outlineOffset = ""; },
		};
	}
	function ConnForm(props) {
			// 新建（无 initial）默认分字段模式并预填官方默认值；编辑保持用户数据原样
			const [form, setForm] = React.useState(() => props.initial || freshForm());
			const [dirty, setDirty] = React.useState(() => new Set()); // 用户手改过的字段（切 kind 时保留）
			const [draftTest, setDraftTest] = React.useState(null); // null | {ok, msg}
			// 无障碍：URL/分字段切换（及表单挂载）后焦点引导进该模式首个输入，避免键盘/SR 用户滞留切换按钮
			const firstInputRef = React.useRef(null);
			React.useEffect(() => { if (firstInputRef.current) firstInputRef.current.focus(); }, [form.mode]);
			// 按钮焦点环：统一走模块级 focusRingProps()（语义同前）
			function patch(p) {
				setForm((prev) => Object.assign({}, prev, p));
				setDirty((prev) => { const n = new Set(prev); for (const k of Object.keys(p)) n.add(k); return n; });
			}
			function switchKind(kind) {
				setForm((prev) => withKindDefaults(Object.assign({}, prev, { kind }), dirty));
				setDirty(new Set());
				setDraftTest(null);
			}
			/** 从 URL 模式切回分字段：保留表单里已有值（编辑回填场景），只对空字段补官方默认值 */
			function reenterFields() {
				setForm((prev) => {
					const keep = new Set(dirty);
					for (const k of ["host", "port", "user", "database"]) if (prev[k]) keep.add(k);
					return withKindDefaults(Object.assign({}, prev, { mode: "fields" }), keep);
				});
				setDraftTest(null);
			}
			function draftBody() {
				const body = { kind: form.kind, ssl: !!form.ssl };
				// 编辑已有连接：透传 connId，服务端测试草稿时拼回已存机密（密码留空/url 未改动语义）
				if (props.initial) body.connId = form.id;
				// 编辑保存语义：url 模式未改动（仍等于回填的脱敏 url）→ 不发 url，保留 secrets 原值
				const origUrl = props.initial && props.initial.mode === "url" ? props.initial.url : undefined;
				if (form.mode === "url") {
					if (form.url && form.url !== origUrl) body.url = form.url;
					// 新建 url 连接必须发
					if (!props.initial && form.url) body.url = form.url;
					// URL 模式独立凭据：trim 后非空才发（服务端注入 userinfo；url 未发时以已存 URL 为基底）
					const uu = (form.urlUser || "").trim();
					const up = (form.urlPassword || "").trim();
					if (uu) body.urlUser = uu;
					if (up) body.urlPassword = up;
				} else {
					body.fields = { host: form.host, user: form.user, database: form.database || undefined };
					if (form.port) body.fields.port = Number(form.port);
					if (form.password) body.fields.password = form.password;
					// 从 url 方式切到分字段保存 → 服务端清除已存 url（否则连接仍走旧 url）
					if (props.initial && props.initial.mode === "url") body.clearUrl = true;
				}
				return body;
			}
			function submit() {
				const body = Object.assign(draftBody(), { id: form.id || undefined, name: form.name || undefined });
				props.onSubmit(body, () => setForm(freshForm()));
			}
			async function testDraft() {
				setDraftTest({ ok: null, msg: t("testing") });
				try {
					const r = await api("test-draft", { method: "POST", body: draftBody() });
					setDraftTest(r && r.ok ? { ok: true, msg: t("testOk") + (r.serverInfo ? " · " + r.serverInfo : "") } : { ok: false, msg: t("testFail") + (r && r.error ? "：" + r.error : "") });
				} catch (e) {
					setDraftTest({ ok: false, msg: t("testFail") + "：" + (e && e.message ? e.message : String(e)) });
				}
			}
			// aria-label 局部文案：与 placeholder 同源，避免表达式重复
			const pwLabel = props.initial && props.initial.hasPassword ? t("passwordSaved") : t("fieldsPassword");
			const idLabel = t("connId") + "（" + t("idAutoHint") + "）";
			return React.createElement(
				"div",
				{ className: "dbt-card" },
				React.createElement("strong", null, props.initial ? t("editConn") : t("newConn")),
				// 分组 1：基本属性（kind / name / id / ssl）
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("select", { value: form.kind, "aria-label": t("fieldKind"), onChange: (e) => switchKind(e.target.value) },
						DB_KINDS.map((k) => React.createElement("option", { key: k, value: k }, k))),
					React.createElement("input", { placeholder: t("connName"), "aria-label": t("connName"), value: form.name, onChange: (e) => patch({ name: e.target.value }) }),
					React.createElement("input", { placeholder: idLabel, "aria-label": idLabel, value: form.id, disabled: !!props.initial, onChange: (e) => patch({ id: e.target.value }) }),
					React.createElement("label", { className: "dbt-row", style: { flex: "none" } },
						React.createElement("input", { type: "checkbox", checked: !!form.ssl, onChange: (e) => patch({ ssl: e.target.checked }) }), t("ssl")),
				),
				// 分组 2：连接目标 —— 模式切换用 .dbt-seg mini segmented
				React.createElement(
					"div",
					{ className: "dbt-seg" },
					React.createElement("button", { className: form.mode === "url" ? "active" : "", "aria-pressed": form.mode === "url", onClick: () => patch({ mode: "url" }), ...focusRingProps() }, t("urlMode")),
					React.createElement("button", { className: form.mode === "fields" ? "active" : "", "aria-pressed": form.mode === "fields", onClick: reenterFields, ...focusRingProps() }, t("fieldsMode")),
				),
				form.mode === "url"
					? React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 6 } },
						React.createElement("input", { placeholder: t("url"), "aria-label": t("url") + t("requiredMark"), "aria-required": "true", ref: firstInputRef, value: form.url, onChange: (e) => patch({ url: e.target.value }) }),
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("urlUser"), "aria-label": t("urlUser"), value: form.urlUser, onChange: (e) => patch({ urlUser: e.target.value }) }),
							React.createElement("input", { type: "password", placeholder: t("urlPassword"), "aria-label": t("urlPassword"), value: form.urlPassword, onChange: (e) => patch({ urlPassword: e.target.value }) })),
					)
					: React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 6 } },
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("fieldsHost"), "aria-label": t("fieldsHost") + t("requiredMark"), "aria-required": "true", ref: firstInputRef, value: form.host, onChange: (e) => patch({ host: e.target.value }) }),
							React.createElement("input", { placeholder: t("fieldsPort"), "aria-label": t("fieldsPort"), value: form.port, onChange: (e) => patch({ port: e.target.value }) }),
							React.createElement("input", { placeholder: t("fieldsDatabase"), "aria-label": t("fieldsDatabase"), value: form.database, onChange: (e) => patch({ database: e.target.value }) })),
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("fieldsUser"), "aria-label": t("fieldsUser") + t("requiredMark"), "aria-required": "true", value: form.user, onChange: (e) => patch({ user: e.target.value }) }),
							React.createElement("input", { type: "password", placeholder: pwLabel, "aria-label": pwLabel, value: form.password, onChange: (e) => patch({ password: e.target.value }) })),
					),
				// 分组 3：操作
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn primary", disabled: props.busy, onClick: submit, ...focusRingProps() }, props.busy ? t("saving") : t("save")),
					React.createElement("button", { className: "dbt-btn", disabled: draftTest && draftTest.ok === null, onClick: testDraft, ...focusRingProps() },
						draftTest && draftTest.ok === null ? t("testing") : t("test")),
					React.createElement("button", { className: "dbt-btn", onClick: props.onCancel, ...focusRingProps() }, t("cancel")),
					draftTest && draftTest.ok !== null
						? React.createElement("span", { className: draftTest.ok ? "dbt-msg" : "dbt-err", role: draftTest.ok ? "status" : "alert" }, draftTest.msg)
						: null,
				),
			);
		}

		function ManageView(props) {
			const { conns, busy, reload } = props;
			const [editing, setEditing] = React.useState(null); // null | "new" | ConnectionMeta
			const [auditOpen, setAuditOpen] = React.useState(false);
			const [audit, setAudit] = React.useState(null);
			const [testInfo, setTestInfo] = React.useState({}); // connId -> "ok" | "fail: msg"
			// 导出/导入流程态：passReq 非空即弹口令窗（"export" | "import"）；fileRef 承载隐藏文件选择器
			const [passReq, setPassReq] = React.useState(null);
			const [pendingJson, setPendingJson] = React.useState(null); // 待导入的密文文本（选文件后暂存，口令确认后发送）
			const [ioInfo, setIoInfo] = React.useState(null); // null | {kind: "ok"|"err", text}
			const fileRef = React.useRef(null);
			// 键盘焦点态：统一走模块级 focusRingProps()（描边同 DESIGN.md focus 规范，accent 2px 内缩）

			async function saveConn(body, reset) {
				await props.run("save", async () => {
					if (editing && editing !== "new") {
						await api("connections/" + encodeURIComponent(body.id || editing.id), { method: "PUT", body });
					} else {
						await api("connections", { method: "POST", body });
					}
					reset();
					setEditing(null);
					await reload();
				});
			}
			async function testConn(id) {
				setTestInfo((prev) => Object.assign({}, prev, { [id]: t("testing") }));
				try {
					const r = await api("connections/" + encodeURIComponent(id) + "/test", { method: "POST", body: {} });
					setTestInfo((prev) => Object.assign({}, prev, { [id]: r && r.ok ? "✓ " + t("testOk") + (r.serverInfo ? " · " + r.serverInfo : "") : "✗ " + t("testFail") }));
				} catch (e) {
					setTestInfo((prev) => Object.assign({}, prev, { [id]: "✗ " + t("testFail") + ": " + e.message }));
				}
			}
			async function delConn(c) {
				// 删除确认走全局 DangerDialog（askConfirm 通道），与危险 SQL 确认同一对话框与键盘契约；
				// window.confirm 已移除（原生弹窗无 aria/焦点管理，且样式割裂）
				const desc = c.safeUrl || [c.kind, c.host ? c.host + (c.port ? ":" + c.port : "") : ""].filter(Boolean).join(" · ") || c.id;
				const yes = await props.askConfirm({
					title: t("deleteConnTitle"),
					statement: desc,
					hint: t("deleteConnConfirm", { name: c.name || c.id }),
					confirmLabel: t("delete"),
					target: { conn: c.name || c.id, kind: c.kind || "", db: "", mode: "" },
				});
				if (!yes) return;
				await props.run("del", async () => {
					await api("connections/" + encodeURIComponent(c.id), { method: "DELETE" });
					await reload();
				});
			}
			async function loadAudit() {
				const open = !auditOpen;
				setAuditOpen(open);
				if (open) {
					try { setAudit(await api("audit" + qs({ project: props.projectPath, limit: 50 }))); }
					catch (e) { props.onError(e); }
				}
			}

			// 口令弹窗确认回调：按 passReq 分流导出/导入；value 为 null 即取消
			async function onPassphrase(value) {
				const mode = passReq;
				setPassReq(null);
				if (value === null || value === undefined) { setPendingJson(null); return; } // 取消即清密文
				if (mode === "export") await doExport(value);
				else if (mode === "import") await doImport(value);
				setPendingJson(null); // 完成即清密文，避免敏感数据滞留组件状态
			}
			// 导出：POST /connections/export 拿密文 json → Blob + a[download] 落盘（文件名带日期戳）
			async function doExport(passphrase) {
				await props.run("export", async () => {
					const data = await api("connections/export", { method: "POST", body: { passphrase } });
					const json = data && data.json;
					const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
					const blob = new Blob([typeof json === "string" ? json : JSON.stringify(json, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = "dsh-db-connections-" + stamp + ".enc.json";
					document.body.appendChild(a);
					a.click();
					a.remove();
					// 延迟回收：部分浏览器在 click 后才异步 fetch blob，同步 revoke 可能中断下载（与结果导出 download 同模式）
					window.setTimeout(() => URL.revokeObjectURL(url), 1000);
					// 服务端回传权威条数 count；缺失时回退本地列表（不声称精确数字）
					const n = (data && typeof data.count === "number") ? data.count : conns.length;
					setIoInfo({ kind: "ok", text: t("exportDone", { n }) });
				});
			}
			// 导入：密文已在 pendingJson；口令错（INVALID_ARGUMENT + 解密失败文案）给专用提示，其余透传后端 message
			async function doImport(passphrase) {
				const json = pendingJson;
				await props.run("import", async () => {
					const data = await api("connections/import", { method: "POST", body: { json, passphrase } });
					await reload();
					const failed = (data && data.errors ? data.errors.length : 0);
					const i = (data && data.imported) || 0;
					const s = (data && data.skipped ? data.skipped.length : 0);
					setIoInfo(failed > 0
						? { kind: "err", text: t("importPartialFail", { i, s, f: failed }) }
						: { kind: "ok", text: t("importResult", { i, s }) });
				});
			}
			// 隐藏文件选择器回调：FileReader 读文本后暂存，再弹口令窗；读失败走通用错误通道
			function onPickFile(e) {
				const file = e.target.files && e.target.files[0];
				e.target.value = ""; // 允许重复选同一文件
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					setPendingJson(String(reader.result || ""));
					setPassReq("import");
				};
				reader.onerror = () => props.onError(reader.error || new Error(t("loadFailed")));
				reader.readAsText(file);
			}

			if (editing) {
				return React.createElement(ConnForm, {
					initial: editing === "new" ? null : buildEditForm(editing),
					busy: busy === "save",
					onSubmit: saveConn,
					onCancel: () => setEditing(null),
				});
			}
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
				// 顶部操作行：审计 + 导出/导入在左，「新建连接」主按钮置右侧
				React.createElement(
					"div",
					{ className: "dbt-row", style: { justifyContent: "space-between" } },
					React.createElement(
						"div",
						{ className: "dbt-row" },
						React.createElement("button", { className: "dbt-btn", "aria-expanded": auditOpen, ...focusRingProps(), onClick: loadAudit }, t("auditShort")),
						React.createElement("button", { className: "dbt-btn", disabled: busy === "export", ...focusRingProps(), onClick: () => setPassReq("export") }, t("exportConns")),
						React.createElement("button", { className: "dbt-btn", disabled: busy === "import", ...focusRingProps(), onClick: () => { if (fileRef.current) fileRef.current.click(); } }, t("importConns")),
					),
					React.createElement("button", { className: "dbt-btn primary", ...focusRingProps(), onClick: () => setEditing("new") }, t("newConn")),
				),
				// 隐藏文件选择器：仅导入用，accept 限定 .json
				React.createElement("input", { type: "file", accept: ".json", "aria-label": t("pickFile"), style: { display: "none" }, ref: fileRef, onChange: onPickFile }),
				// 导出/导入就地反馈（与测试反馈同语言：dbt-msg 绿 / dbt-err 红）
				ioInfo ? React.createElement("div", { role: ioInfo.kind === "ok" ? "status" : "alert", className: ioInfo.kind === "ok" ? "dbt-msg" : "dbt-err" }, ioInfo.text) : null,
				conns.length === 0
					? // 空状态引导：一句引导 + 主按钮直达新增表单（state 切换在 ManageView 内）
						React.createElement(
							"div",
							{ className: "dbt-card", style: { alignItems: "center", textAlign: "center" } },
							React.createElement("div", { className: "dbt-muted" }, t("noConnsGuide")),
							React.createElement("button", { className: "dbt-btn primary", ...focusRingProps(), onClick: () => setEditing("new") }, t("addConn")),
						)
					: // iOS inset grouped：一张卡装全部连接，行间 hairline 分隔
						React.createElement(
						"div",
						{ className: "dbt-group" },
						conns.map((c) =>
							React.createElement(
								"div",
								{ className: "dbt-listrow", key: c.id },
								// 左列：kind 徽标 pill + 名称主行，safeUrl 等宽副行
								React.createElement(
									"div",
									{ style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } },
									React.createElement(
										"div",
										{ className: "dbt-row" },
										// kind 为技术元数据，降次级色避免与名称主级争夺权重（DESIGN.md 次级文字语义）
										React.createElement("span", { style: { background: "var(--dbt-surface-strong, rgba(120,120,128,.18))", color: "var(--dbt-text-secondary, rgba(235,235,245,.6))", borderRadius: "6px", padding: "2px 6px", fontFamily: MONO_FONT, fontSize: "var(--dbt-caption, 11px)", lineHeight: 1.45 } }, c.kind),
										React.createElement("strong", { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name || c.id),
									),
									(c.safeUrl || c.host) ? React.createElement(
										"div",
										{ className: "dbt-muted", style: { fontFamily: MONO_FONT, fontSize: 11, wordBreak: "break-all" } },
										c.safeUrl || (c.host + ":" + (c.port || "")),
									) : null,
									// 测试反馈三态：✓ 绿=成功 / ✗ 红=失败 / 其余（测试中…）中性灰；DESIGN.md 语义色 红=失败 绿=成功，role=status 供读屏播报
									testInfo[c.id] ? React.createElement("div", { role: "status", className: testInfo[c.id].startsWith("✓") ? "dbt-msg" : testInfo[c.id].startsWith("✗") ? "dbt-err" : "dbt-muted" }, testInfo[c.id]) : null,
								),
								// 右列：动作按钮（次要语义，danger 仅删除）
								React.createElement(
									"div",
									{ className: "dbt-row", style: { flex: "none" } },
									React.createElement("button", { className: "dbt-btn", disabled: busy === "test", ...focusRingProps(), onClick: () => testConn(c.id) }, t("test")),
									React.createElement("button", { className: "dbt-btn", ...focusRingProps(), onClick: () => setEditing(c) }, t("edit")),
									React.createElement("button", { className: "dbt-btn danger", disabled: busy === "del", ...focusRingProps(), onClick: () => delConn(c) }, t("delete")),
								),
							),
						),
					),
				auditOpen
					? React.createElement(
						"div",
						// 展开入场复用既有 dbt-in（仅 opacity/transform、.22s、var(--dbt-ease)；reduced-motion 全局已关），与视图切换语言一致
						{ className: "dbt-card", style: { animation: "dbt-in .22s var(--dbt-ease)" } },
						React.createElement("strong", null, t("auditTitle", { n: 50 })),
						!props.projectPath ? React.createElement("div", { className: "dbt-muted" }, t("projectUnbound")) :
							!audit || audit.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("auditEmpty")) :
								auditTable(audit),
					)
					: null,
				// 口令弹窗：导出/导入共用；取消（null）不动作
				passReq ? React.createElement(PassphraseDialog, {
					title: passReq === "export" ? t("exportConns") : t("importConns"),
					confirmLabel: passReq === "export" ? t("exportConns") : t("importConns"),
					onClose: onPassphrase,
				}) : null,
			);
		}

		/* ---------------- 项目授权 ---------------- */
		function GrantsView(props) {
			const { conns, grants, projectPath } = props;
			const grantedCount = (grants || []).length;
			function modeOf(connId) {
				const g = (grants || []).find((x) => x.connId === connId);
				return g ? g.mode : "";
			}
			async function setGrant(connId, mode) {
				await props.run("grant", async () => {
					if (!mode) await api("grants", { method: "DELETE", body: { projectPath, connId } });
					else await api("grants", { method: "PUT", body: { projectPath, connId, mode } });
					await props.reload();
				});
			}
			// 模式徽标：语义色描边胶囊（rw=系统绿成功语义、ro=次级灰中性），颜色+文字双编码；
			// 描边胶囊复用 NULL chip 语言（11px/600、1px 8px、999px），light 模式自动跟 token 反转
			function modeBadge(m) {
				if (m !== "ro" && m !== "rw") return null;
				const color = m === "rw" ? "var(--dbt-success, #30d158)" : "var(--dbt-text-secondary, rgba(235,235,245,.6))";
				return React.createElement("span", {
					"aria-hidden": "true",
					style: {
						flex: "none",
						border: "1px solid " + color,
						color: color,
						borderRadius: "999px",
						padding: "1px 8px",
						fontSize: "var(--dbt-caption, 11px)",
						fontWeight: 600,
						lineHeight: 1.45,
					},
				}, m === "rw" ? t("modeBadgeRw") : t("modeBadgeRo"));
			}
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
				React.createElement("div", { className: "dbt-muted" }, t("grantsHint")),
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) :
					// 状态行：空授权引导 / 已授权计数摘要共用一槽（授权变更后 reload 触发重渲染，polite 播报）
					React.createElement(
						"div",
						{ className: "dbt-muted", "aria-live": "polite" },
						grantedCount === 0 ? t("grantsEmptyHint") : t("grantsSummary", { granted: grantedCount, total: conns.length }),
					),
					// iOS inset grouped：授权行装一张卡，行间 hairline（授权链路：seg 点击 → PUT/DELETE /grants）
					React.createElement(
						"div",
						{ className: "dbt-group" },
						conns.map((c) => {
							const m = modeOf(c.id);
							return React.createElement(
								"div",
								{ className: "dbt-listrow", key: c.id },
								// 主行对齐连接管理：kind 填充 pill + 名称 13px semibold + 模式徽标（seg 为权威状态源，徽标 aria-hidden 免重复播报）
								React.createElement(
									"div",
									{ className: "dbt-row", style: { flex: 1, minWidth: 0 } },
									React.createElement("span", { style: { background: "var(--dbt-surface-strong, rgba(120,120,128,.18))", borderRadius: "6px", padding: "2px 6px", fontFamily: MONO_FONT, fontSize: "var(--dbt-caption, 11px)", lineHeight: 1.45 } }, c.kind),
									React.createElement("strong", { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name || c.id),
									modeBadge(m),
								),
								React.createElement(
									"div",
									{ className: "dbt-seg", role: "radiogroup", "aria-label": t("grantModeGroup", { name: c.name || c.id }) },
									["", "ro", "rw"].map((mode) =>
										React.createElement("button", {
											key: mode || "none",
											className: mode === m ? "active" : "",
											role: "radio",
											"aria-checked": mode === m,
											disabled: props.busy === "grant",
											onClick: () => setGrant(c.id, mode),
										}, mode === "" ? t("modeNone") : mode === "ro" ? t("modeRo") : t("modeRw")),
									),
								),
							);
						}),
					),
			);
		}

		/* ---------------- 数据浏览 ---------------- */
		// Navicat 式对象树：连接 ▸ 库/[schema] ▸ 表，懒加载展开（浏览面板唯一树实例，展开状态随面板生命周期）
		function BrowseTree(props) {
			const { conns, projectPath, sel, onSelect, autoExpand, refreshTick } = props;
			// sel 由父组件持有（弹窗内 active 高亮与初始选中都依赖）；onSelect(选中记录, 触发元素) 上报
			const [open, setOpen] = React.useState({}); // "c:<id>" | "d:<id>/<db>" -> bool
			const [loading, setLoading] = React.useState({});
			const [error, setError] = React.useState({}); // 树节点加载失败信息（就地显示，可点重试）
			const [dbs, setDbs] = React.useState({}); // connId -> string[]
			const [schemasMap, setSchemasMap] = React.useState({}); // "<connId>/<db>" -> string[]（PG/GaussDB 库内 schema 层）
			const [tablesMap, setTablesMap] = React.useState({}); // "<connId>/<db|schema>" -> TableInfo[]

			// 会话项目切换时清空树缓存，避免陈旧授权下的旧数据
			React.useEffect(() => {
				setOpen({}); setLoading({}); setError({}); setDbs({}); setSchemasMap({}); setTablesMap({});
			}, [projectPath]);

			// 三层加载统一入口（toggle 展开与手动/自动刷新共用；key: c:<id> | d:<id>/<db> | s:<id>/<db>/<schema>）
			function loadByKey(key) {
				const cm = /^c:(.+)$/.exec(key);
				const dm = /^d:(.+?)\/(.+)$/.exec(key);
				const sm = /^s:(.+?)\/(.+?)\/(.+)$/.exec(key);
				const connOf = (id) => conns.find((x) => x.id === id);
				if (cm) {
					const c = connOf(cm[1]);
					if (!c) return Promise.resolve();
					return api("databases" + qs({ project: projectPath, connId: c.id })).then((list) => {
						setDbs((m) => Object.assign({}, m, { [c.id]: list || [] }));
					});
				}
				if (dm) {
					const c = connOf(dm[1]);
					if (!c) return Promise.resolve();
					const useSchemas = !!HAS_SCHEMAS[c.kind];
					const what = useSchemas ? "schemas" : "tables";
					return api(what + qs({ project: projectPath, connId: c.id, database: dm[2] })).then((list) => {
						const setter = useSchemas ? setSchemasMap : setTablesMap;
						setter((m) => Object.assign({}, m, { [c.id + "/" + dm[2]]: list || [] }));
					});
				}
				if (sm) {
					return api("tables" + qs({ project: projectPath, connId: sm[1], database: sm[2] + "." + sm[3] })).then((list) => {
						setTablesMap((m) => Object.assign({}, m, { [sm[1] + "/" + sm[2] + "/" + sm[3]]: list || [] }));
					});
				}
				return Promise.resolve();
			}

			// 手动刷新按钮 / 侧边栏切回可见：对所有已展开节点重新拉取（新库/新表即时可见），展开态保持
			React.useEffect(() => {
				if (!refreshTick) return;
				for (const [key, isOpen] of Object.entries(open)) {
					if (!isOpen || loading[key]) continue;
					setError((s) => Object.assign({}, s, { [key]: undefined }));
					setLoading((s) => Object.assign({}, s, { [key]: true }));
					loadByKey(key)
						.catch((e) => setError((s) => Object.assign({}, s, { [key]: e && e.message ? e.message : String(e) })))
						.finally(() => setLoading((s) => Object.assign({}, s, { [key]: false })));
				}
			}, [refreshTick]); // eslint-disable-line

			function toggle(key, load) {
				const isOpen = !!open[key];
				setOpen((o) => Object.assign({}, o, { [key]: !isOpen }));
				if (isOpen || !load || loading[key]) return;
				// 加载失败不弹全局错误：就地记 error[key]，树内显示可重试的错误行
				setError((s) => Object.assign({}, s, { [key]: undefined }));
				setLoading((s) => Object.assign({}, s, { [key]: true }));
				load()
					.catch((e) => setError((s) => Object.assign({}, s, { [key]: e && e.message ? e.message : String(e) })))
					.finally(() => setLoading((s) => Object.assign({}, s, { [key]: false })));
			}
			function retry(key, fn) {
				setError((s) => Object.assign({}, s, { [key]: undefined }));
				setOpen((o) => Object.assign({}, o, { [key]: false }));
				Promise.resolve().then(() => fn());
			}
			function toggleConn(c) {
				if (!projectPath) return;
				toggle("c:" + c.id, () => loadByKey("c:" + c.id));
			}
			// autoExpand：挂载后自动展开第一层级（连接节点），复用 toggleConn 的展开+懒加载；
			// 加载失败仍走既有就地错误行机制。声明在清缓存 effect 之后：项目切换时先清 open 再重新展开。
			// autoExpand 受控于父级（BrowsePane 首次激活才置 true）：常驻挂载下隐藏视图不自动发请求
			React.useEffect(() => {
				if (!autoExpand) return;
				for (const c of conns) {
					if (!open["c:" + c.id]) toggleConn(c);
				}
			}, [conns, projectPath, autoExpand]); // eslint-disable-line
			// PG/GaussDB 官方层级为 数据库 → 模式(schema) → 表：库节点下先列 schema 再列表
			const HAS_SCHEMAS = { postgresql: true, gaussdb: true };
			function toggleDb(c, d) {
				if (!projectPath) return;
				toggle("d:" + c.id + "/" + d, () => loadByKey("d:" + c.id + "/" + d));
			}
			function toggleSchema(c, d, s) {
				if (!projectPath) return;
				// PG 系跨库浏览：tables 的 database 传 "库名.schema"（Navicat 官方行为，服务端按库开连接）
				toggle("s:" + c.id + "/" + d + "/" + s, () => loadByKey("s:" + c.id + "/" + d + "/" + s));
			}
			// 树键盘导航（WAI-ARIA treeview / roving tabindex）：Tab 仅进停靠行，方向键在可见行间移动；
			// 右箭头展开、左箭头收起或回到父级（父级 = DOM 序向上第一个更浅层级行），Home/End 跳首尾
			const treeRef = React.useRef(null);
			const [rovingKey, setRovingKey] = React.useState(null); // roving 停靠行 key；null 时兜底首行
			const liveKeysRef = React.useRef(null); // 上一轮渲染的交互行 key 集：停靠行被折叠/清缓存后失效时回退首行
			const roving = rovingKey && liveKeysRef.current && liveKeysRef.current.has(rovingKey) ? rovingKey : null;
			const firstKey = conns.length ? "c:" + conns[0].id : null; // 树首行恒为第一个连接行
			const liveKeys = new Set(); // 本轮渲染收集，循环结束后写回 liveKeysRef
			function moveFocus(rows, i) {
				const row = rows[i];
				if (!row) return;
				row.focus();
				setRovingKey(row.getAttribute("data-treekey"));
			}
			function onTreeKeyDown(e) {
				const row = e.target && e.target.closest ? e.target.closest('[role="treeitem"]') : null;
				if (!row || !treeRef.current) return;
				const rows = Array.prototype.slice.call(treeRef.current.querySelectorAll('[role="treeitem"]'));
				const i = rows.indexOf(row);
				const exp = row.getAttribute("aria-expanded");
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					const j = e.key === "ArrowDown" ? i + 1 : i - 1;
					if (j >= 0 && j < rows.length) moveFocus(rows, j);
				} else if (e.key === "Home" || e.key === "End") {
					e.preventDefault();
					moveFocus(rows, e.key === "Home" ? 0 : rows.length - 1);
				} else if (e.key === "ArrowRight") {
					if (exp === "false") { e.preventDefault(); row.click(); } // 展开当前节点（复用点击行为）
				} else if (e.key === "ArrowLeft") {
					if (exp === "true") { e.preventDefault(); row.click(); return; } // 收起当前节点
					const lv = Number(row.getAttribute("data-level")) || 1;
					for (let j = i - 1; j >= 0; j--) {
						if ((Number(rows[j].getAttribute("data-level")) || 1) < lv) { e.preventDefault(); moveFocus(rows, j); break; }
					}
				}
			}
			// 树行：chevron（▸ 展开旋转 90°）+ 名称 + 可选右侧标注；交互行为 treeitem（roving tabindex 见上）
			function treerow(key, level, isOpen, leaf, label, onClick, active, extra) {
				if (onClick) liveKeys.add(key);
				return React.createElement(
					"div",
					{
						className: "dbt-treerow" + (active ? " active" : ""), key,
						role: onClick ? "treeitem" : undefined,
						"aria-expanded": onClick && !leaf ? isOpen : undefined, // 可展开节点披露展开态（叶/占位行不适用）
						"aria-level": onClick ? level + 1 : undefined, // 平铺树以 level 标注层级（WAI-ARIA treeview）
						"aria-selected": onClick && active ? true : undefined, // 选中表行的可访问标注（对应 .active 视觉态）
						"data-level": onClick ? level + 1 : undefined, // 左箭头父级查找依赖
						"data-treekey": key,
						tabIndex: onClick ? ((roving || firstKey) === key ? 0 : -1) : undefined,
						onClick: onClick ? (e) => { setRovingKey(key); onClick(e); } : undefined,
						...(onClick ? focusRingProps() : null), // 焦点描边统一走模块级 helper
						onKeyDown: onClick ? (e) => {
							if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRovingKey(key); onClick({ currentTarget: e.currentTarget }); }
						} : undefined,
						style: { paddingLeft: 12 + level * 16 },
					},
					React.createElement("span", { className: "dbt-chev" + (isOpen ? " open" : "") + (leaf ? " leaf" : "") }, "▶"),
					React.createElement("span", { className: "dbt-treename" }, label),
					extra || null,
				);
			}

			// 组装树：连接 → 库/schema → 表（懒加载缓存，未加载完成显示 …）；表节点点击上报选中记录与触发元素
			const treeRows = [];
			for (const c of conns) {
				const ck = "c:" + c.id;
				const isOpen = !!open[ck];
				treeRows.push(treerow(ck, 0, isOpen, false, c.name || c.id, () => toggleConn(c), false,
					React.createElement("span", { className: "dbt-muted", style: { flex: "none", fontSize: 11 } }, c.kind)));
				if (!isOpen) continue;
				const list = dbs[c.id];
				if (loading[ck]) { treeRows.push(treerow(ck + ":l", 1, false, true, "…")); continue; }
				if (error[ck]) { treeRows.push(treerow(ck + ":x", 1, false, true, t("loadFailed") + "：" + error[ck], () => retry(ck, () => toggleConn(c)), false)); continue; }
				if (!list) continue;
				if (list.length === 0) { treeRows.push(treerow(ck + ":e", 1, false, true, t("noDatabases"))); continue; }
				for (const d of list) {
					const useSchemas = !!HAS_SCHEMAS[c.kind];
					const dk = "d:" + c.id + "/" + d;
					const dOpen = !!open[dk];
					treeRows.push(treerow(dk, 1, dOpen, false, d, () => toggleDb(c, d)));
					if (!dOpen) continue;
					if (loading[dk]) { treeRows.push(treerow(dk + ":l", 2, false, true, "…")); continue; }
					if (error[dk]) { treeRows.push(treerow(dk + ":x", 2, false, true, t("loadFailed") + "：" + error[dk], () => retry(dk, () => toggleDb(c, d)))); continue; }
					// PG/GaussDB：库 → 模式 → 表（三层，Navicat 官方层级）；schema 节点复用 open/loading/error 状态
					if (useSchemas) {
						const slist = schemasMap[c.id + "/" + d];
						if (!slist) continue;
						if (slist.length === 0) { treeRows.push(treerow(dk + ":e", 2, false, true, t("noSchemas"))); continue; }
						for (const s of slist) {
							const sk = "s:" + c.id + "/" + d + "/" + s;
							const sOpen = !!open[sk];
							treeRows.push(treerow(sk, 2, sOpen, false, s, () => toggleSchema(c, d, s)));
							if (!sOpen) continue;
							const tlist = tablesMap[c.id + "/" + d + "/" + s];
							if (loading[sk]) { treeRows.push(treerow(sk + ":l", 3, false, true, "…")); continue; }
							if (error[sk]) { treeRows.push(treerow(sk + ":x", 3, false, true, t("loadFailed") + "：" + error[sk], () => retry(sk, () => toggleSchema(c, d, s)))); continue; }
							if (!tlist) continue;
							if (tlist.length === 0) { treeRows.push(treerow(sk + ":e", 3, false, true, t("noTables"))); continue; }
							for (const tb of tlist) {
								const active = !!sel && sel.connId === c.id && sel.db === d && sel.schemaName === s && sel.table.name === tb.name;
								treeRows.push(treerow("t:" + sk + "/" + tb.name, 3, false, true,
									tb.name + (tb.type && tb.type !== "table" ? " · " + tb.type : ""),
									(e) => onSelect({ connId: c.id, db: d, schemaName: s, table: tb }, e.currentTarget), active));
							}
						}
						continue;
					}
					const tlist = tablesMap[c.id + "/" + d];
					if (!tlist) continue;
					if (tlist.length === 0) { treeRows.push(treerow(dk + ":e", 2, false, true, t("noTables"))); continue; }
					for (const tb of tlist) {
						const active = !!sel && sel.connId === c.id && sel.db === d && sel.table.name === tb.name;
						treeRows.push(treerow("t:" + c.id + "/" + d + "/" + tb.name, 2, false, true,
							tb.name + (tb.type && tb.type !== "table" ? " · " + tb.type : ""),
							(e) => onSelect({ connId: c.id, db: d, table: tb }, e.currentTarget), active));
					}
				}
			}

			// 停靠行失效检测以下一轮渲染的可见集合为准（commit 后写回，不污染渲染期）
			React.useLayoutEffect(() => { liveKeysRef.current = liveKeys; });
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
				// projectPath 为空时所有展开动作静默 no-op（toggleConn 等防御），必须就地说明原因，
				// 否则用户点击连接无任何反馈（role=alert 使读屏播报，样式复用 dbt-err 醒目红字）
				!projectPath ? React.createElement("div", { className: "dbt-err", role: "alert" }, t("needProjectPath")) : null,
				// Navicat 式对象树：点击展开连接/库，点击表上报选中（由父组件就地预览）
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) :
					React.createElement("div", { className: "dbt-group" },
						React.createElement("div", { className: "dbt-tree", role: "tree", ref: treeRef, onKeyDown: onTreeKeyDown }, treeRows)),
			);
		}

		// Navicat 式浏览弹窗：左树选库-表，右看字段+数据（非模态可拖动浮动窗，由 Panel 层持有跨 tab 常驻）

		/* ---------------- PreviewGrid：数据预览网格（Navicat 式单元格查看/编辑） ---------------- */
		// props 契约：{ preview:{columns,rows,rowCount,truncated?}, schema:ColumnInfo[]（SQL/mongo；redis 为
		// type/encoding/ttl/length，无 PRI）, kind, editable:rw 授权布尔, tableType:sel.table.type（redis 键类型）,
		// tableName, dbRef, schemaName, connId, connName, grantMode, projectPath, onSaved:保存成功回调,
		// askConfirm:runGuarded 确认回调（确认信息附带 target:{conn,kind,db,mode} 与 params） }
		// redis 各键类型可就地编辑的数据列（与 buildRedisOp 分支保持一致；键名/字段名等定位列只读）
		const REDIS_EDITABLE_COLS = {
			string: ["value"],
			hash: ["value"],
			zset: ["score", "member"],
			set: ["member"],
		};
		function PreviewGrid(props) {
			const { preview, schema, kind, editable, tableType, tableName, dbRef, schemaName, connId, connName, grantMode, projectPath, onSaved, askConfirm } = props;
			const [sel, setSel] = React.useState(null); // {rowIdx, colName, cell} 底部详情栏当前单元格（null=收起底栏）
			const [text, setText] = React.useState(""); // 详情栏 textarea 值（选中即就位）
			const [editNull, setEditNull] = React.useState(false); // 「设为 NULL」勾选（null 单元格默认勾选）
			const [cellErr, setCellErr] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [copied, setCopied] = React.useState(""); // "" | "ok" | "fail"（复制结果反馈，1.5s 后还原 ""）
			const isMongo = kind === "mongodb";
			// SQL 系主键列名（schema 中 key==="PRI"）；mongo 由 _id 单列承担，redis 无主键概念
			const pkCols = (!isMongo && kind !== "redis" && Array.isArray(schema))
				? schema.filter((c) => c && c.key === "PRI").map((c) => c.name)
				: [];

			// 点单元格开合底栏：同格再点收起；新格选中即把 textarea 初值就位——textarea 空 ↔ 勾选设为 NULL
			function toggleCell(rowIdx, colName, cell) {
				setCellErr("");
				if (sel && sel.rowIdx === rowIdx && sel.colName === colName) { setSel(null); return; }
				setSel({ rowIdx, colName, cell });
				setEditNull(cell === null);
				setText(cell === null ? "" : String(cell));
			}
			function copyCell() {
				if (!sel) return;
				navigator.clipboard.writeText(String(sel.cell)).then(() => {
					setCopied("ok");
					window.setTimeout(() => setCopied(""), 1500);
				}, () => {
					// 剪贴板不可用（无权限等）：短暂显示失败文案后还原，不再静默
					setCopied("fail");
					window.setTimeout(() => setCopied(""), 1500);
				});
			}

			// 单元格编辑资格：返回 null=可编辑，否则为原因 i18n key（底栏 .dbt-readhint 展示）
			function cellReason(colName, shown) {
				if (!editable || !dialectOf(kind)) return "readOnlyRo";
				if (isMongo) return colName === "_id" ? "readOnlyRo" : null;
				if (kind === "redis") {
					if ((tableType === "string" && colName === "key") || (tableType === "hash" && colName === "field")) return "readOnlyRo";
					return (REDIS_EDITABLE_COLS[tableType] || []).includes(colName) ? null : "redisTypeRo";
				}
				// SQL 系：整表无主键 → 只读；截断/BLOB 单元格 → 防旧值覆盖
				if (pkCols.length === 0) return "noPkHint";
				if (isTruncatedCell(shown)) return "truncatedNoEdit";
				if (isBlobCell(shown)) return "blobNoEdit";
				return null;
			}

			// 保存：构造写回命令（按 kind 分派）→ 顺序执行（redis 两步）→ 全部成功收起底栏并回调 onSaved
			async function saveCell() {
				if (!sel) return;
				setCellErr("");
				const { rowIdx, colName } = sel;
				const row = (preview.rows || [])[rowIdx] || [];
				let r;
				if (kind === "redis") {
					r = buildRedisOp(tableName, tableType, preview.columns, row, colName, text, editNull);
				} else if (isMongo) {
					const idIdx = preview.columns.indexOf("_id");
					const idCol = (schema || []).find((c) => c && c.name === "_id");
					const colInfo = (schema || []).find((c) => c && c.name === colName);
					r = buildMongoOp(tableName, idIdx >= 0 ? row[idIdx] : undefined,
						!!(idCol && typeof idCol.dataType === "string" && idCol.dataType.startsWith("ObjectId")),
						colName, text, editNull, colInfo ? colInfo.dataType : undefined);
				} else {
					r = buildUpdate(kind, tableName, dbRef, schemaName, colName, text, editNull, pkCols,
						pkCols.map((c) => row[preview.columns.indexOf(c)]));
				}
				if (!r.ok) { setCellErr(r.error ? t(r.error) : t("error")); return; }
				setBusy(true);
				try {
					for (const op of r.ops) {
						// 确认信息附带目标数据（连接名/kind/库/授权模式）与实际参数（statement 中 ? 占位符的值）
						await runGuarded(
							(challengeId) => api("execute", { method: "POST", body: { projectPath, connId, statement: op.statement, params: op.params, database: op.database, challengeId } }),
							(info) => askConfirm(Object.assign({}, info, {
								target: { conn: connName || connId, kind: kind || "", db: dbRef || "", mode: grantMode || "" },
								params: op.params,
							})),
						);
					}
					setSel(null);
					if (onSaved) onSaved();
				} catch (e) {
					// 取消确认（e.cancelled）不算失败：底栏保持打开供重试
					if (!e.cancelled) setCellErr(t("error") + ": " + String(e && e.message ? e.message : e));
				} finally {
					setBusy(false);
				}
			}

			// 切表/翻页联动：预览数据引用变化即收起底栏，避免行号错位指向旧行
			React.useEffect(() => { setSel(null); }, [preview]);

			const shown = sel ? (sel.cell === null ? "NULL" : String(sel.cell)) : null;
			const selReason = sel ? cellReason(sel.colName, shown) : null;
			// 截断/BLOB 独立提示：命中即补显，若已作为只读原因展示过则不再重复
			const truncHint = !sel ? null : isTruncatedCell(shown) ? "truncatedNoEdit" : isBlobCell(shown) ? "blobNoEdit" : null;
			return React.createElement(
				"div",
				{ className: "dbt-browse-root", style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } },
				// 顶层只读提示：授权为 ro 时整格只读，单元格仍可点开底栏查看完整值；10px 分区 gap
				!editable ? React.createElement("div", { className: "dbt-readhint", style: { marginBottom: 10 } }, t("readOnlyRo")) : null,
				// 预览表格区（flex:1 撑满剩余空间；底部详情栏在表格之后、面板流内）
				React.createElement(
					"div",
					{ style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
					React.createElement(
						"div",
						{ className: "dbt-browse-tablewrap" },
						React.createElement(
							"table",
							{ className: "dbt-table" },
							React.createElement(
								"thead",
								null,
								React.createElement("tr", null, (preview.columns || []).map((c, i) => React.createElement("th", { key: i }, c))),
							),
							React.createElement(
								"tbody",
								null,
								(preview.rows || []).map((row, i) =>
									// 行级键盘可达：Tab 聚焦行、Enter 打开该行首格详情（与单击同走 toggleCell，同格再按收起）；
									// 焦点在行内 button 上时 Enter 已由 button 处理，target!==currentTarget 直接放行防双重触发
									React.createElement("tr", {
										key: i, tabIndex: 0,
										onKeyDown: (e) => {
											if (e.key !== "Enter" || e.target !== e.currentTarget || !(preview.columns || []).length) return;
											toggleCell(i, preview.columns[0], row[0]);
										},
										...focusRingProps(true), // 行容器：忽略子元素聚焦冒泡，仅行自身键盘聚焦描边
									},
										(preview.columns || []).map((colName, j) =>
											React.createElement("td", { key: j, title: row[j] === null ? "NULL" : String(row[j]) },
												React.createElement("button", {
													className: "dbt-cellbtn", type: "button",
													onClick: () => toggleCell(i, colName, row[j]),
												}, row[j] === null ? React.createElement("span", { className: "dbt-nullchip" }, "NULL") : String(row[j])))))),
							),
						),
					),
				),
				// 分页条（BrowsePane 传入）在详情栏之上，详情栏钉在面板最底部；
				// 包裹层 flex:none 承接钉底语义并补 10px 分区 gap（footer 自身无 margin，与底栏 10px 节奏对齐）
				props.children ? React.createElement("div", { style: { flex: "none", marginTop: 10 } }, props.children) : null,
				// 底部详情栏（Navicat/检查器式）：预览表格下方一栏，textarea 直接可编辑，点保存写回
				sel ? React.createElement(
					"div",
					{ className: "dbt-celldetail" },
					// 标题行：完整值 · 列名；null 单元格带 NULL 芯片；只读原因随之展示
					React.createElement(
						// 标题行 flex + 8px 控件 gap：值/列名、NULL 芯片、只读原因不再挤作一团；长列名 wrap 兜底
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
						React.createElement("strong", null, t("cellValue") + " · " + sel.colName),
						sel.cell === null ? React.createElement("span", { className: "dbt-nullchip" }, "NULL") : null,
						selReason ? React.createElement("span", { className: "dbt-readhint" }, t(selReason)) : null,
					),
					// 完整值编辑区：textarea 恒为编辑形态，不可编辑时只读
					React.createElement("textarea", {
						className: "dbt-celldetail-input",
						value: text,
						readOnly: selReason !== null,
						onChange: (e) => setText(e.target.value),
					}),
					sel.cell === null ? React.createElement(
						"label",
						// 不用 .dbt-row：全局 input flex:1 会把 checkbox 拉伸占满、标签被推到远端（视觉审查命中）
						{ style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", width: "fit-content" } },
						React.createElement("input", { type: "checkbox", checked: editNull, onChange: (e) => setEditNull(e.target.checked) }),
						t("setNull"),
					) : null,
					truncHint && truncHint !== selReason ? React.createElement("span", { className: "dbt-readhint" }, t(truncHint)) : null,
					cellErr ? React.createElement("span", { className: "dbt-err" }, cellErr) : null,
					React.createElement(
						"div",
						{ className: "dbt-row" },
						// 复制反馈三态附语义色（DESIGN.md：绿=成功、红=错误），静态内联色值走 --dbt-* token + 回退
						React.createElement("button", {
							className: "dbt-btn", onClick: copyCell,
							style: copied === "ok" ? { color: "var(--dbt-success,#30d158)" } : copied === "fail" ? { color: "var(--dbt-danger,#ff453a)" } : undefined,
						}, copied === "ok" ? t("copied") : copied === "fail" ? t("copyFailed") : t("copyBtn")),
						selReason === null ? React.createElement("button", { className: "dbt-btn primary", disabled: busy, onClick: saveCell }, busy ? t("cellSaving") : t("save")) : null,
						React.createElement("button", { className: "dbt-btn", onClick: () => setSel(null) }, t("close")),
					),
				) : null,
			);
		}

		// Navicat 式浏览面板（内嵌侧边栏）：上半对象树选库-表，下半结构/数据预览，点表即看，不再弹窗
		function BrowsePane(props) {
			const { conns, projectPath, grants, askConfirm, active } = props;
			// active：所属 tab 是否激活（Panel 常驻挂载后传入）；首次激活才展开树并拉取，隐藏不发请求
			// grants（editable 判定）与 askConfirm（单元格写回确认）下传 PreviewGrid
			const [sel, setSel] = React.useState(null); // 面板内当前选中（null=未选表，内容区显示引导空态）
			const [view, setView] = React.useState("structure"); // structure | preview（纯视图切换，不影响数据加载）
			const [schema, setSchema] = React.useState([]);
			const [preview, setPreview] = React.useState(null); // QueryResult
			const [page, setPage] = React.useState(1);
			const [busy, setBusy] = React.useState("");
			const [loadErr, setLoadErr] = React.useState(""); // 内容区加载失败（就地显示 + 重试）
			const openSeq = React.useRef(0); // 请求序号守卫

			// 请求序号守卫（沿用面板）：快速切表/翻页时丢弃晚到旧响应，防止旧数据覆盖新选中项
			const openTable = React.useCallback((s, pg) => {
				if (!s || !projectPath) return;
				// PG 系跨库：database 传 "库名.schema"；其它库传库名
				const dbRef = s.schemaName ? s.db + "." + s.schemaName : s.db;
				const seq = ++openSeq.current;
				setBusy("open"); setLoadErr("");
				Promise.all([
					api("schema" + qs({ project: projectPath, connId: s.connId, database: dbRef, table: s.table.name })),
					api("preview" + qs({ project: projectPath, connId: s.connId, database: dbRef, table: s.table.name, limit: PAGE_SIZE, offset: ((pg || 1) - 1) * PAGE_SIZE })),
				])
					.then(([sch, prev]) => {
						if (seq !== openSeq.current) return; // 旧请求晚到，丢弃
						setSchema(sch || []); setPreview(prev); setPage(pg || 1);
					})
					// 面板内错误就地显示（不走面板顶部错误区）
					.catch((e) => { if (seq === openSeq.current) setLoadErr(String(e && e.message ? e.message : e)); })
					.finally(() => { if (seq === openSeq.current) setBusy(""); });
			}, [projectPath]);
			React.useEffect(() => { if (sel) openTable(sel, 1); }, [sel]); // eslint-disable-line

			// 内容区互斥状态：未选中引导 / 加载骨架 / 错误重试 / 空态 / 表格
			function rightPane() {
				if (!sel && busy !== "open" && !loadErr) {
					// 未选表：显示引导空态（内嵌面板可直接浏览，不强制先选表）；flex:1 撑满内容区使类内居中生效
					return React.createElement("div", { className: "dbt-browse-empty", style: { flex: 1 } }, t("selectTableHint"));
				}
				if (busy === "open") {
					// 表形状骨架：6 行 6 列静态色块（不引入新动画，reduced-motion 天然安全）
					return React.createElement("div", { className: "dbt-browse-skel", role: "status", "aria-busy": "true" },
						[0, 1, 2, 3, 4, 5].map((r) => React.createElement("div", { className: "dbt-browse-skelrow", key: r },
							[0, 1, 2, 3, 4, 5].map((c) => React.createElement("div", { className: "dbt-browse-skelcell", key: c })))));
				}
				if (loadErr) {
					// 错误就地显示 + 重试（内嵌面板保持就地呈现，不走 props.onError）；role=alert 使异步失败被读屏播报（对齐 Panel 顶层 aria-live）
					return React.createElement("div", { className: "dbt-browse-errorbox", role: "alert" },
						React.createElement("div", { className: "dbt-err" }, t("error") + ": " + loadErr),
						React.createElement("button", { className: "dbt-btn", onClick: () => openTable(sel, 1) }, t("retry")));
				}
				if (view === "structure") {
					if (!schema.length) return React.createElement("div", { className: "dbt-browse-empty", style: { flex: 1 } }, t("emptyStructure"));
					return resultTable(
						[t("column"), t("dataType"), t("nullable"), t("keyCol"), t("defaultVal"), t("comment")],
						schema.map((col) => [col.name, col.dataType, col.nullable ? "YES" : "NO", col.key || "", col.default === null || col.default === undefined ? "" : String(col.default), col.comment || ""]),
						undefined, "dbt-browse-tablewrap");
				}
				if (!preview || !preview.rows || preview.rows.length === 0) {
					return React.createElement("div", { className: "dbt-browse-empty", style: { flex: 1 } }, t("emptyData"));
				}
				// Navicat 式单元格网格：kind/可编辑性由当前连接与授权决定（rw=可编辑），保存后重拉当前页
				const conn = conns.find((c) => c.id === sel.connId);
				const grant = (grants || []).find((g) => g.connId === sel.connId);
				// 分页条作为 children 传入：渲染顺序 表格 → 分页 → 详情栏（详情栏钉在面板最底部）
				const footer = sel && view === "preview" && !loadErr ? React.createElement(
					"div",
					{ className: "dbt-browse-footer" },
					React.createElement("button", { className: "dbt-btn", disabled: page <= 1 || busy === "open", onClick: () => openTable(sel, page - 1) }, "‹ " + t("prevPage")),
					React.createElement("span", { className: "dbt-muted" }, t("pageInfo", { page })),
					React.createElement("span", { style: { flex: 1 } }),
					preview && preview.truncated ? React.createElement("span", { className: "dbt-muted" }, t("previewTruncated")) : null,
					React.createElement("button", { className: "dbt-btn", disabled: (preview && preview.truncated) === false || busy === "open", onClick: () => openTable(sel, page + 1) }, t("nextPage") + " ›"),
				) : null;
				return React.createElement(PreviewGrid, {
					preview, schema,
					kind: conn ? conn.kind : undefined,
					editable: !!grant && grant.mode === "rw",
					tableType: sel.table.type,
					tableName: sel.table.name,
					dbRef: sel.schemaName ? sel.db + "." + sel.schemaName : sel.db,
					schemaName: sel.schemaName || null,
					connId: sel.connId, projectPath,
					connName: conn ? (conn.name || sel.connId) : sel.connId,
					grantMode: grant ? grant.mode : "",
					onSaved: () => openTable(sel, page),
					askConfirm,
				}, footer);
			}

			// 内嵌面板纵向布局：撑满面板高度（.dbt-panel 为 height:100% 的 flex column），
			// 树限高 / main flex:1 内滚 / 分页与详情栏依次钉底。
			// 根不再挂 .dbt-view：该类自带 dbt-in 入场动画，会与 Panel browse 容器同类叠加双播（4px+4px 位移），
			// 与 Panel 层「入场动画只在面板首次打开播一次」意图相悖；布局职责（flex column + 10px 分区 gap）内联承担
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 10, flex: "1 1 auto", minHeight: 0 } },
				React.createElement(
					"div",
					// flex:none：树卡固定限高不被压缩（面板过矮时收缩的是主区），对齐 DESIGN.md 分区规格
					{ style: { flex: "none", maxHeight: 280, overflowY: "auto" } },
					React.createElement(BrowseTree, {
						conns, projectPath, sel,
						autoExpand: !!active, // 首次激活才自动展开连接层级（常驻挂载下隐藏不发请求）
						refreshTick: props.refreshTick, // 手动刷新按钮 / 侧边栏切回可见时重拉已展开层
						onSelect: (s) => setSel(s), // 树内切表
					}),
				),
				React.createElement(
					"div",
					{ className: "dbt-browse-main" },
					// 结构/数据：mini segmented（复用面板同款与 i18n key）
					React.createElement(
						"div",
						{ className: "dbt-browse-tabs" },
						React.createElement(
							"div",
							// role 模式对齐 Panel 全局 tabs（tablist/tab/aria-selected），seg 交互语义一致
							{ className: "dbt-seg", role: "tablist" },
							["structure", "preview"].map((v) =>
								React.createElement("button", { key: v, className: view === v ? "active" : "", role: "tab", "aria-selected": view === v, onClick: () => setView(v) },
									v === "structure" ? t("structure") : t("preview"))),
						),
					),
					// 内容区由 flex 吃满 main 剩余高度（表格外滚），不再用固定 maxHeight 兜底
					React.createElement("div", { className: "dbt-browse-content" }, rightPane()),
				),
			);
		}

		/* ---------------- 结果网格（SQL 控制台查询结果：客户端分页/排序/复制/导出） ---------------- */
		// 单元格 → 数值：number 直接用；非空数字字符串可转；NaN/Infinity/其余 → null（走字符串比较）
		function gridNum(v) {
			if (typeof v === "number") return isFinite(v) ? v : null;
			if (typeof v === "string" && v.trim() !== "") { const n = Number(v); if (isFinite(n)) return n; }
			return null;
		}
		// 排序：dir="none" 或 colIndex<0 原样返回；null/undefined 恒最大（SQL NULL 语义：asc 尾部/desc 头部）；
		// 两值均可转有限数字时按数值比较（防 "9">"10" 字典序），否则字符串比较；相等按原序（稳定）
		function sortRows(rows, colIndex, dir) {
			if (!Array.isArray(rows) || (dir !== "asc" && dir !== "desc")) return rows;
			if (!Number.isInteger(colIndex) || colIndex < 0) return rows;
			const pairs = rows.map((row, i) => ({ row, i }));
			pairs.sort((a, b) => {
				const va = Array.isArray(a.row) ? a.row[colIndex] : undefined;
				const vb = Array.isArray(b.row) ? b.row[colIndex] : undefined;
				let c;
				const na = va === null || va === undefined, nb = vb === null || vb === undefined;
				if (na || nb) c = na && nb ? 0 : na ? 1 : -1;
				else {
					const fa = gridNum(va), fb = gridNum(vb);
					if (fa !== null && fb !== null) c = fa === fb ? 0 : fa < fb ? -1 : 1;
					else { const sa = String(va), sb = String(vb); c = sa < sb ? -1 : sa > sb ? 1 : 0; }
				}
				return c !== 0 ? (dir === "desc" ? -c : c) : a.i - b.i;
			});
			return pairs.map((p) => p.row);
		}
		// 分页切片：page 从 1 起；page≤0/NaN 返回空页（不触发 slice 负索引从尾部计数）
		function slicePage(rows, page, pageSize) {
			if (!Array.isArray(rows) || !(page >= 1)) return [];
			const size = pageSize || PAGE_SIZE;
			const start = (page - 1) * size;
			return rows.slice(start, start + size);
		}
		// 结果网格组件：exportHandlers { toCsv, toJson, download } 由集成层注入，缺省隐藏导出按钮
		function ResultSetGrid(props) {
			const { columns, rows, truncated, elapsedMs, exportHandlers } = props;
			const [sortCol, setSortCol] = React.useState(-1);
			const [dir, setDir] = React.useState("none");
			const [page, setPage] = React.useState(1);
			const [copyState, setCopyState] = React.useState(""); // ""|"ok"|"fail"（复制反馈 1.5s 还原，对齐 PreviewGrid）
			const allRows = rows || [];
			const sorted = sortRows(allRows, sortCol, dir);
			const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
			const curPage = Math.min(page, pageCount); // 数据重查变短时钳制显示页
			const pageRows = slicePage(sorted, curPage);
			// 表头三态轮换：none→asc→desc→none；换列直接 asc；重排后回第一页
			function toggleSort(i) {
				setPage(1);
				if (sortCol !== i) { setSortCol(i); setDir("asc"); return; }
				setDir(dir === "asc" ? "desc" : dir === "desc" ? "none" : "asc");
			}
			// 单元格点击复制：null 复制空串；反馈样式对齐 PreviewGrid（成功/失败各 1.5s 后还原）
			function copyCell(cell) {
				navigator.clipboard.writeText(cell === null ? "" : String(cell)).then(() => {
					setCopyState("ok");
					window.setTimeout(() => setCopyState(""), 1500);
				}, () => {
					setCopyState("fail");
					window.setTimeout(() => setCopyState(""), 1500);
				});
			}
			function exportAs(ext, pack) {
				if (!exportHandlers) return;
				exportHandlers.download("result." + ext, pack(columns, sorted));
			}
			const arrow = dir === "asc" ? " ↑" : dir === "desc" ? " ↓" : "";
			return React.createElement(
				"div",
				{ className: "dbt-col" },
				allRows.length === 0 ? React.createElement("div", { className: "dbt-browse-empty" }, t("emptyData")) : React.createElement(
					"div",
					{ className: "dbt-tablewrap" },
					React.createElement(
						"table",
						{ className: "dbt-table" },
						React.createElement("thead", null,
							React.createElement("tr", null, (columns || []).map((c, i) =>
								React.createElement("th", { key: i },
									React.createElement("button", { className: "dbt-grid-sort", onClick: () => toggleSort(i), title: String(c) },
										String(c) + (sortCol === i ? arrow : "")))))),
						React.createElement("tbody", null, pageRows.map((row, ri) =>
							React.createElement("tr", { key: ri }, (row || []).map((cell, ci) =>
								React.createElement("td", { key: ci },
									React.createElement("button", {
										className: "dbt-cellbtn",
										title: cell === null ? "NULL" : String(cell),
										onClick: () => copyCell(cell),
									}, cell === null ? React.createElement("span", { className: "dbt-muted" }, "NULL") : String(cell))))))),
					),
				),
				// 状态条 + 导出 + 分页条（复用 BrowsePane footer 模式）
				React.createElement(
					"div",
					{ className: "dbt-browse-footer" },
					React.createElement("span", { className: "dbt-muted" },
						t("rowsResult", { n: allRows.length })
						+ (truncated ? " · " + t("previewTruncated") : "")
						+ (typeof elapsedMs === "number" && isFinite(elapsedMs) ? " · " + fmtMs(elapsedMs) : "")),
					copyState ? React.createElement("span", {
						className: "dbt-muted",
						style: { color: copyState === "ok" ? "var(--dbt-success,#30d158)" : "var(--dbt-danger,#ff453a)" },
					}, copyState === "ok" ? t("copied") : t("copyFailed")) : null,
					React.createElement("span", { style: { flex: 1 } }),
					exportHandlers ? React.createElement("button", { className: "dbt-btn", onClick: () => exportAs("csv", exportHandlers.toCsv) }, "CSV") : null,
					exportHandlers ? React.createElement("button", { className: "dbt-btn", onClick: () => exportAs("json", exportHandlers.toJson) }, "JSON") : null,
					React.createElement("button", { className: "dbt-btn", disabled: curPage <= 1, onClick: () => setPage(curPage - 1) }, "‹ " + t("prevPage")),
					React.createElement("span", { className: "dbt-muted" }, t("pageInfo", { page: curPage })),
					React.createElement("button", { className: "dbt-btn", disabled: curPage >= pageCount, onClick: () => setPage(curPage + 1) }, t("nextPage") + " ›"),
				),
			);
		}

		/* ---------------- SQL 控制台（多标签 + CodeMirror + 逐条预分类 + 事务会话） ---------------- */
		// Apple 等宽字体栈（规范 §1）：优先样式层 --dbt-mono token，fallback 内联栈
		const MONO_FONT = "var(--dbt-mono, ui-monospace, \"SF Mono\", Menlo, Consolas, monospace)";

		// 逐条预分类（纯函数，挂 __testables）：SQL 读首词为契约清单（SELECT/WITH/SHOW/
		// EXPLAIN/DESC/DESCRIBE → /api/query，其余 → /api/execute）；redis/mongo 语句为 JSON
		// 命令形态（数组首元素 / 对象唯一键），比对客户端读命令表——完全镜像服务端
		// READ_COMMANDS（lib/adapters/redis/index.ts:34）与 READ_OPS（lib/adapters/mongodb/
		// index.ts:76）单一事实来源，避免客户端放行服务端拒绝（或反之）的读命令。
		const CONSOLE_SQL_READ_HEADS = new Set(["SELECT", "WITH", "SHOW", "EXPLAIN", "DESC", "DESCRIBE"]);
		const CONSOLE_REDIS_READ = new Set([
			"GET", "MGET", "EXISTS", "TYPE", "HGET", "HGETALL", "HKEYS", "HVALS", "HLEN", "LRANGE",
			"LLEN", "SMEMBERS", "SCARD", "SISMEMBER", "ZRANGE", "ZSCORE", "ZCARD", "ZRANK", "XLEN",
			"XRANGE", "SCAN", "DBSIZE", "INFO", "SELECT", "TTL", "PTTL", "GETRANGE", "STRLEN", "OBJECT", "MEMORY",
		]);
		const CONSOLE_MONGO_READ = new Set([
			"find", "aggregate", "count", "countDocuments", "estimatedDocumentCount",
			"distinct", "listCollections", "dbStats", "collStats", "indexes",
		]);
		function classifyHead(kind, statement) {
			const s = String(statement == null ? "" : statement).trim();
			if (kind === "redis" || kind === "mongodb") {
				let head = null;
				try {
					const v = JSON.parse(s);
					if (Array.isArray(v)) head = v[0];
					else if (v && typeof v === "object") head = Object.keys(v)[0];
				} catch (e) { /* 非 JSON 命令落回首词分类 */ }
				if (typeof head === "string") {
					return (kind === "redis" ? CONSOLE_REDIS_READ : CONSOLE_MONGO_READ).has(head) ? "query" : "execute";
				}
			}
			const head = (s.match(/^[A-Za-z]+/) || [""])[0].toUpperCase();
			return CONSOLE_SQL_READ_HEADS.has(head) ? "query" : "execute";
		}

		// vendor bundle 加载（单例 promise）：宿主 require 相对文件路径（Node/e2e 语境，与
		// vendor/mongodb-driver.cjs 同款通道）。require 失败（web 宿主 require 无文件模块）即
		// reject，调用方降级 textarea（失败后置空单例允许重试，如宿主后续就绪）。
		// 不做同源 fetch bundle + Function 动态执行：生产无 /vendor 静态路由（lib/http 仅 JSON
		// API），该分支必死；且 Function 构造器等价 eval，fetched 文本响应投毒即代码注入。
		let cmModulePromise = null;
		function loadConsoleEditorModule() {
			if (cmModulePromise) return cmModulePromise;
			cmModulePromise = (async () => {
				const m = require("../vendor/codemirror-sql.cjs");
				if (!(m && typeof m.createConsoleEditor === "function")) throw new Error("bundle 缺 createConsoleEditor");
				return m;
			})();
			cmModulePromise.catch(() => { cmModulePromise = null; });
			return cmModulePromise;
		}

		// 结果导出 download：Blob + a.download（点击后延时 revoke，防过早回收）；渲染期只建闭包不触 DOM
		function makeExportHandlers() {
			return {
				toCsv, toJson,
				download(name, text) {
					const blob = new Blob([String(text == null ? "" : text)], { type: "text/plain;charset=utf-8" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = name || "result.txt";
					document.body.appendChild(a);
					a.click();
					a.remove();
					window.setTimeout(() => URL.revokeObjectURL(url), 1000);
				},
			};
		}

		const CONSOLE_SQL_KINDS = { mysql: true, postgresql: true, gaussdb: true, sqlite: true, oracle: true, dmdb: true };

		function ConsoleView(props) {
			const { conns, grants, projectPath, askConfirm, onError } = props;
			const [connId, setConnId] = React.useState("");
			const [mode, setMode] = React.useState("sql"); // sql（逐条预分类）| script（整段 /api/script）
			const [params, setParams] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			// Navicat 式跨库操控：当前库下拉（""=连接默认库），查询/执行路由到所选库
			const [dbList, setDbList] = React.useState([]);
			const [db, setDb] = React.useState("");
			// 多标签（内存态，不落盘）：tabs[{id,title,sql,result,history}]
			const tabSeq = React.useRef(1);
			const [tabs, setTabs] = React.useState(() => [{ id: "t1", title: t("queryTab", { n: 1 }), sql: "", result: null, history: [] }]);
			const [activeIdx, setActiveIdx] = React.useState(0);
			// CodeMirror 模块与事务会话状态
			const [cm, setCm] = React.useState(null); // null（加载中）| module | "failed"（降级 textarea）
			const [txToken, setTxToken] = React.useState(null);
			const [txBusy, setTxBusy] = React.useState(false);
			const [historyOpen, setHistoryOpen] = React.useState(false);

			const editorHostRef = React.useRef(null);
			const editorRef = React.useRef(null); // { ed, kind }
			const schemaRef = React.useRef({}); // 最近一次拉取的 SQLNamespace（表 → 列名数组）
			const activeIdxRef = React.useRef(0);
			React.useLayoutEffect(() => { activeIdxRef.current = activeIdx; }); // commit 后写回，不污染渲染期
			const exportRef = React.useRef(null);
			if (!exportRef.current) exportRef.current = makeExportHandlers();

			const conn = conns.find((c) => c.id === connId);
			const kind = conn ? conn.kind : "";
			const grant = (grants || []).find((g) => g.connId === connId);
			const rw = !!grant && grant.mode === "rw";
			const activeTab = tabs[activeIdx] || tabs[0];
			const activeTabId = activeTab ? activeTab.id : "";

			// 跨库下拉（保留既有行为：换连接重置）
			React.useEffect(() => {
				setDbList([]); setDb("");
				if (!connId || !projectPath) return;
				api("databases" + qs({ project: projectPath, connId })).then((l) => setDbList(l || []), () => setDbList([]));
			}, [connId, projectPath]);

			// vendor bundle 异步加载（失败降级 textarea，静默）
			React.useEffect(() => {
				let dead = false;
				loadConsoleEditorModule().then(
					(m) => { if (!dead) setCm(m); },
					() => { if (!dead) setCm("failed"); },
				);
				return () => { dead = true; };
			}, []);

			// 编辑器挂载（CM6 生命周期：cleanup 调 destroy）；kind 变化（换连接）整体重建以切方言
			React.useEffect(() => {
				if (!cm || cm === "failed" || !editorHostRef.current) return undefined;
				let ed = null;
				try {
					ed = cm.createConsoleEditor(editorHostRef.current, {
						kind,
						onRunAll: () => runRef.current("all"),
						onRunSelection: () => runRef.current("selection"),
						onChange: (text) => patchActive({ sql: text }),
					});
				} catch (e) {
					setCm("failed");
					return undefined;
				}
				editorRef.current = { ed, kind };
				ed.setDoc((tabs[activeIdxRef.current] && tabs[activeIdxRef.current].sql) || "");
				if (Object.keys(schemaRef.current).length) ed.setSchema(schemaRef.current);
				return () => {
					ed.destroy();
					editorRef.current = null;
				};
			}, [cm, kind]);

			// 切换标签：编辑器文档同步到目标标签（不重建，保 undo 历史）
			React.useEffect(() => {
				const rec = editorRef.current;
				if (rec && rec.ed) rec.ed.setDoc((tabs[activeIdx] && tabs[activeIdx].sql) || "");
			}, [activeTabId]);

			// 表/列元数据异步拉取（tables + 逐表 schema → SQLNamespace）供编辑器 setSchema；
			// 失败静默降级（无补全但不影响编辑），单表失败跳过该表
			React.useEffect(() => {
				let dead = false;
				schemaRef.current = {};
				const rec = editorRef.current;
				if (rec && rec.ed) rec.ed.setSchema({});
				if (!connId || !projectPath || !CONSOLE_SQL_KINDS[kind]) return undefined;
				const dbRef = db || undefined;
				api("tables" + qs({ project: projectPath, connId, database: dbRef }))
					.then(async (list) => {
						const names = (Array.isArray(list) ? list : []).map((x) => x && x.name).filter(Boolean).slice(0, 50);
						const entries = await Promise.all(names.map((name) =>
							api("schema" + qs({ project: projectPath, connId, table: name, database: dbRef }))
								.then((cols) => [name, (Array.isArray(cols) ? cols : []).map((c) => c && c.name).filter(Boolean)])
								.catch(() => [name, []])));
						if (dead) return undefined;
						const ns = {};
						for (const [name, cols] of entries) ns[name] = cols;
						schemaRef.current = ns;
						const rec2 = editorRef.current;
						if (rec2 && rec2.ed) rec2.ed.setSchema(ns);
						return undefined;
					})
					.catch(() => { /* 静默降级 */ });
				return () => { dead = true; };
			}, [connId, db, projectPath, kind]);

			function patchActive(patch) {
				setTabs((prev) => prev.map((tb, i) => (i === activeIdxRef.current ? Object.assign({}, tb, patch) : tb)));
			}

			// 确认对话框目标信息：连接名 / kind / 当前库（空=默认库）/ 该连接的授权模式（无授权留空）
			function confirmTarget() {
				return { conn: conn ? (conn.name || connId) : connId, kind, db: db || "", mode: grant ? grant.mode : "" };
			}

			// 执行入口（scope："all" 全量 | "selection" 选中，无选区回退全量）。逐条分割后按
			// classifyHead 预分类路由；事务会话存在时全部语句走 /api/console/exec（粘性连接，
			// 能看到未提交数据）；ro 授权下写类语句跳过并标注。结果逐条就地渲染，错误带
			// start 偏移可定位光标。
			async function runBatch(scope) {
				if (busy || !connId) return;
				const rec = editorRef.current;
				let text = rec && rec.ed ? rec.ed.getDoc() : (activeTab ? activeTab.sql : "");
				if (scope === "selection") {
					const sel = rec && rec.ed ? rec.ed.getSelection() : textareaSelection();
					if (String(sel || "").trim()) text = sel;
				}
				if (!String(text || "").trim()) return;
				const tIdx = activeIdxRef.current; // 执行期间切标签不串写结果：锁定目标标签
				const targetTab = tabs[tIdx];
				let parsedParams;
				if (params.trim()) {
					try { parsedParams = JSON.parse(params); } catch (e) { onError(new Error(t("paramsJson") + ": " + e.message)); return; }
				}
				setBusy(true);
				const started = Date.now();
				const items = [];
				try {
					if (mode === "script") {
						const st = Date.now();
						try {
							const data = await runGuarded(
								(challengeId) => api("script", { method: "POST", body: { projectPath, connId, code: text, challengeId } }),
								(info) => askConfirm(Object.assign({}, info, { target: confirmTarget() })),
							);
							items.push({ text, start: 0, route: "script", status: "ok", elapsedMs: Date.now() - st, message: (data && data.message) || "", affectedRows: data && data.affectedRows });
						} catch (e) {
							if (!e.cancelled) onError(e);
							items.push({ text, start: 0, route: "script", status: e.cancelled ? "cancelled" : "error", error: String(e && e.message ? e.message : e), elapsedMs: Date.now() - st });
						}
					} else {
						const stmts = CONSOLE_SQL_KINDS[kind] ? splitSqlStatements(text, kind) : [{ text: String(text).trim(), start: 0 }];
						for (const s of stmts) {
							if (!String(s.text).trim()) continue;
							const route = classifyHead(kind, s.text);
							// ro 授权：写类语句（execute 路由）跳过并标注；事务会话仅 rw 可开，无需复查
							if (!rw && !txToken && route === "execute") {
								items.push({ text: s.text, start: s.start, route, status: "skipped" });
								continue;
							}
							const st = Date.now();
							try {
								let data;
								if (txToken) {
									data = await runGuarded(
										(challengeId) => api("console/exec", { method: "POST", body: { sessionToken: txToken, statement: s.text, params: parsedParams, challengeId } }),
										(info) => askConfirm(Object.assign({}, info, { target: confirmTarget(), params: parsedParams })),
									);
								} else if (route === "query") {
									data = await runGuarded(
										(challengeId) => api("query", { method: "POST", body: { projectPath, connId, sql: s.text, params: parsedParams, database: db || undefined, challengeId } }),
										(info) => askConfirm(Object.assign({}, info, { target: confirmTarget(), params: parsedParams })),
									);
								} else {
									data = await runGuarded(
										(challengeId) => api("execute", { method: "POST", body: { projectPath, connId, statement: s.text, params: parsedParams, database: db || undefined, challengeId } }),
										(info) => askConfirm(Object.assign({}, info, { target: confirmTarget(), params: parsedParams })),
									);
								}
								const item = { text: s.text, start: s.start, route, status: "ok", elapsedMs: Date.now() - st, inTx: !!txToken };
								if (data && Array.isArray(data.columns)) item.data = data; // QueryResult（结果集）
								else { item.message = (data && data.message) || ""; item.affectedRows = data && data.affectedRows; }
								items.push(item);
							} catch (e) {
								if (e.cancelled) items.push({ text: s.text, start: s.start, route, status: "cancelled" });
								else items.push({ text: s.text, start: s.start, route, status: "error", error: String(e && e.message ? e.message : e), elapsedMs: Date.now() - st });
							}
						}
					}
				} finally {
					setBusy(false);
				}
				const elapsedMs = Date.now() - started;
				const ok = items.length > 0 && items.every((it) => it.status === "ok");
				setTabs((prev) => prev.map((tb, i) => (i === tIdx ? Object.assign({}, tb, {
					result: { items, elapsedMs },
					history: [{ sql: text, ts: started, elapsedMs, ok }].concat(targetTab ? targetTab.history : []).slice(0, 50),
				}) : tb)));
			}
			const runRef = React.useRef(() => {});
			// 每轮 commit 后刷新闭包，按钮/编辑器回调恒拿最新 state（回调仅在 commit 后触发，时序不变）
			React.useLayoutEffect(() => { runRef.current = runBatch; });

			function textareaSelection() {
				const ta = editorHostRef.current && editorHostRef.current.querySelector("textarea");
				if (!ta || ta.selectionStart === ta.selectionEnd) return "";
				return ta.value.slice(ta.selectionStart, ta.selectionEnd);
			}

			// 错误定位：按语句 start 偏移移动编辑器光标（CM dispatch / textarea setSelectionRange）
			function locateOffset(start) {
				const rec = editorRef.current;
				if (rec && rec.ed && rec.ed.view && rec.ed.view.state) {
					try {
						rec.ed.view.dispatch({ selection: { anchor: Math.max(0, Math.min(start || 0, rec.ed.view.state.doc.length)) }, scrollIntoView: true });
						rec.ed.view.focus();
						return;
					} catch (e) { /* 落 textarea 降级 */ }
				}
				const ta = editorHostRef.current && editorHostRef.current.querySelector("textarea");
				if (ta) { ta.focus(); ta.setSelectionRange(start || 0, start || 0); }
			}

			function formatSql() {
				const rec = editorRef.current;
				if (rec && rec.ed && typeof rec.ed.format === "function") rec.ed.format();
			}

			async function txBegin() {
				// 服务端对非默认库 begin 显式拒绝（粘性事务无法跨库），客户端同等守卫避免无效请求
				if (!rw || txBusy || txToken || !connId || db) return;
				setTxBusy(true);
				try {
					const r = await api("console/begin", { method: "POST", body: { projectPath, connId, database: db || undefined } });
					setTxToken((r && r.sessionToken) || "");
				} catch (e) { onError(e); } finally { setTxBusy(false); }
			}
			async function txEnd(commit) {
				if (!txToken || txBusy) return;
				setTxBusy(true);
				try {
					const r = await api(commit ? "console/commit" : "console/rollback", { method: "POST", body: { sessionToken: txToken } });
					setTxToken(null);
					patchActive({
						result: { items: [{ text: commit ? "COMMIT" : "ROLLBACK", start: 0, route: "script", status: "ok", message: (r && r.message) || t("ok") }], elapsedMs: 0 },
					});
				} catch (e) { onError(e); } finally { setTxBusy(false); }
			}

			function addTab() {
				tabSeq.current += 1;
				const n = tabSeq.current;
				setTabs((prev) => prev.concat([{ id: "t" + n, title: t("queryTab", { n }), sql: "", result: null, history: [] }]));
				setActiveIdx(tabs.length);
			}
			function closeTab(i) {
				if (tabs.length <= 1) return;
				setTabs((prev) => prev.filter((_, k) => k !== i));
				setActiveIdx((cur) => (i < cur ? cur - 1 : Math.min(cur, tabs.length - 2)));
			}
			function restoreHistory(h) {
				const rec = editorRef.current;
				if (rec && rec.ed) rec.ed.setDoc(h.sql);
				patchActive({ sql: h.sql });
			}

			// 单条结果行：路由徽标 + 语句摘要 + 耗时 + 行数/状态；查询结果接 ResultSetGrid
			//（exportHandlers 由组件注入：toCsv/toJson 纯函数 + Blob download）
			function renderResultItem(it, i) {
				const routeLabel = it.route === "query" ? t("routeQuery") : it.route === "script" ? t("routeScript") : t("routeExec");
				const head = React.createElement(
					"div",
					{ className: "dbt-listrow", key: "h" + i },
					React.createElement("span", { className: "dbt-routechip" }, routeLabel),
					// 事务内执行的查询语句加「事务内」徽标；写语句维持路由徽标不变
					it.inTx && it.route === "query" ? React.createElement("span", { className: "dbt-routechip" }, t("txInline")) : null,
					React.createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO_FONT, fontSize: 12 }, title: it.text }, String(it.text || "").replace(/\s+/g, " ").trim().slice(0, 120)),
					it.elapsedMs != null ? React.createElement("span", { className: "dbt-muted", style: { flex: "none" } }, fmtMs(it.elapsedMs)) : null,
					it.status === "ok" && it.data ? React.createElement("span", { className: "dbt-muted", style: { flex: "none" } }, t("rowsResult", { n: it.data.rowCount })) : null,
					it.status === "ok" && !it.data ? React.createElement("span", { className: "dbt-msg", style: { flex: "none" } }, it.message + (it.affectedRows !== undefined ? " · " + t("execResult", { n: it.affectedRows }) : "")) : null,
					it.status === "skipped" ? React.createElement("span", { className: "dbt-readhint", style: { flex: "none" } }, t("skippedRo")) : null,
					it.status === "cancelled" ? React.createElement("span", { className: "dbt-muted", style: { flex: "none" } }, t("cancelled")) : null,
					it.status === "error" ? React.createElement("span", { className: "dbt-err", style: { flex: "none", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" } }, t("error") + ": " + it.error) : null,
					it.status === "error" ? React.createElement("button", { className: "dbt-btn", style: { flex: "none" }, "aria-label": t("locate"), onClick: () => locateOffset(it.start) }, t("locate")) : null,
				);
				const grid = it.status === "ok" && it.data ? React.createElement(ResultSetGrid, {
					key: "g" + i,
					columns: it.data.columns || [],
					rows: it.data.rows || [],
					truncated: it.data.truncated,
					elapsedMs: it.elapsedMs,
					exportHandlers: exportRef.current,
				}) : null;
				return grid ? [head, grid] : head;
			}

			const segBtn = (m, label) => React.createElement("button", { key: m, className: mode === m ? "active" : "", onClick: () => setMode(m) }, label);
			return React.createElement(
				"div",
				{ className: "dbt-card" },
				// 选择器：连接（事务进行中锁定，防语句写到另一连接）+ 跨库下拉
				React.createElement(
					"div",
					{ className: "dbt-group" },
					React.createElement(
						"div",
						{ className: "dbt-listrow" },
						React.createElement("select", { value: connId, disabled: !!txToken, onChange: (e) => setConnId(e.target.value) },
							React.createElement("option", { value: "" }, t("selectConn")),
							conns.map((c) => {
								const g = (grants || []).find((x) => x.connId === c.id);
								const suffix = g && g.mode ? " · " + g.mode : "";
								return React.createElement("option", { key: c.id, value: c.id }, (c.name || c.id) + " (" + c.kind + suffix + ")");
							})),
						dbList.length > 1 ? React.createElement("select", { value: db, disabled: !!txToken, onChange: (e) => setDb(e.target.value) },
							React.createElement("option", { value: "" }, t("defaultDb")),
							dbList.map((d) => React.createElement("option", { key: d, value: d }, d))) : null,
					),
				),
				// 多标签条（内存态）：标签 + 关闭 + 新建
				React.createElement(
					"div",
					{ className: "dbt-cm-tabbar" },
					tabs.map((tb, i) => React.createElement(
						"button",
						{
							key: tb.id, className: "dbt-cm-tab" + (i === activeIdx ? " active" : ""),
							onClick: () => setActiveIdx(i),
						},
						tb.title,
						tabs.length > 1 ? React.createElement("span", {
							className: "dbt-cm-tabclose", role: "button", "aria-label": t("closeTab"), tabIndex: 0,
							onClick: (e) => { e.stopPropagation(); closeTab(i); },
						}, "×") : null,
					)),
					React.createElement("button", { className: "dbt-cm-tab", "aria-label": t("newTab"), title: t("newTab"), onClick: addTab }, "+"),
				),
				// 工具行 1：SQL/脚本 seg + 格式化 + 事务按钮组（仅 rw 授权显示）
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("div", { className: "dbt-seg" }, [segBtn("sql", t("modeSql")), segBtn("script", t("modeScript"))]),
					mode === "sql" ? React.createElement("button", { className: "dbt-btn", disabled: !connId, onClick: formatSql }, t("formatSql")) : null,
					React.createElement("span", { style: { flex: 1 } }),
					rw ? React.createElement(
						"div",
						{ className: "dbt-row", style: { flex: "none" } },
						txToken
							? [
								React.createElement("span", { className: "dbt-muted", key: "txs" }, t("txActive")),
								React.createElement("button", { className: "dbt-btn primary", key: "c", disabled: txBusy, onClick: () => txEnd(true) }, t("txCommit")),
								React.createElement("button", { className: "dbt-btn danger", key: "r", disabled: txBusy, onClick: () => txEnd(false) }, t("txRollback")),
							]
							: React.createElement("button", { className: "dbt-btn", disabled: txBusy || !connId || !!db, title: db ? t("txDefaultDbOnly") : undefined, onClick: txBegin }, t("txBegin")),
					) : null,
				),
				// 工具行 2：执行（全量）/ 执行选中 + params（script 模式无绑定参数）
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn primary", disabled: busy || !connId, onClick: () => runRef.current("all") }, busy ? t("running") : t("run")),
					mode === "sql" ? React.createElement("button", { className: "dbt-btn", disabled: busy || !connId, onClick: () => runRef.current("selection") }, t("runSelection")) : null,
					mode !== "script" ? React.createElement("input", { placeholder: t("paramsJson"), value: params, onChange: (e) => setParams(e.target.value), style: { fontFamily: MONO_FONT } }) : null,
				),
				// 编辑器：CM 挂载（div ref）或降级 textarea（bundle 加载中/失败）；脚本模式提示 JS 占位
				React.createElement(
					"div",
					{ className: "dbt-editor-host", ref: editorHostRef },
					cm && cm !== "failed"
						? null // CM 自建 .cm-editor 填充宿主（bundle 主题 height:100%）
						: React.createElement("textarea", {
							placeholder: mode === "script" ? t("scriptPlaceholder") : t("sqlPlaceholder"),
							value: (activeTab && activeTab.sql) || "",
							onChange: (e) => patchActive({ sql: e.target.value }),
							style: Object.assign({ fontFamily: MONO_FONT },
								mode !== "sql" ? { outline: "1px solid var(--dbt-danger, #ff453a)" } : null),
						}),
				),
				// 结果区：逐条结果行 + 查询结果网格
				activeTab && activeTab.result && Array.isArray(activeTab.result.items)
					? React.createElement("div", { className: "dbt-col" }, activeTab.result.items.map(renderResultItem))
					: null,
				// 历史卡（每 tab 内存态）：可展开、点击回填，不落盘
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn", "aria-expanded": !!historyOpen, onClick: () => setHistoryOpen(!historyOpen) }, t("historyTitle")),
				),
				historyOpen ? (
					!activeTab || activeTab.history.length === 0
						? React.createElement("div", { className: "dbt-muted" }, t("historyEmpty"))
						: React.createElement(
							"div",
							{ className: "dbt-group" },
							activeTab.history.map((h, i) => React.createElement(
								"div",
								{ className: "dbt-listrow", key: i },
								React.createElement("span", { className: h.ok ? "dbt-msg" : "dbt-err", style: { flex: "none" } }, h.ok ? "✓" : "✗"),
								React.createElement("button", { className: "dbt-cellbtn", style: { flex: 1, fontFamily: MONO_FONT, fontSize: 12 }, title: h.sql, onClick: () => restoreHistory(h) }, String(h.sql).replace(/\s+/g, " ").trim().slice(0, 120)),
								React.createElement("span", { className: "dbt-muted", style: { flex: "none" } },
									new Date(h.ts).toLocaleTimeString() + (typeof h.elapsedMs === "number" ? " · " + fmtMs(h.elapsedMs) : "")),
							)),
						)
				) : null,
			);
		}

		/* ---------------- 数据传输（Navicat 式双栏：摘要条 + 源/目标层级联动 + 信息区 + 表清单 + 进度轮询） ---------------- */
		// 双向箭头（摘要条与栏间分隔共用；stroke currentColor 随容器变色）
		function transferArrow() {
			return React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "aria-hidden": true },
				React.createElement("path", { d: "M4 8.5h15M15.5 4.5L19 8.5l-3.5 4" }),
				React.createElement("path", { d: "M20 15.5H5M8.5 11.5L5 15.5l3.5 4" }));
		}
		// 信息区服务器版本探测：300ms 防抖 + 按 connId 缓存（组件卸载丢弃）+ 失败静默为空串 + 切走后只写缓存不改显示
		function useServerVer(connId, cacheRef) {
			const [ver, setVer] = React.useState("");
			const liveRef = React.useRef(connId); // 乱序护栏：慢响应回来时只服务当前选中连接
			React.useEffect(() => {
				liveRef.current = connId;
				if (!connId) { setVer(""); return undefined; }
				const cached = cacheRef.current[connId];
				if (cached !== undefined) { setVer(cached); return undefined; }
				const asked = connId;
				const timer = window.setTimeout(() => {
					api("connections/" + encodeURIComponent(asked) + "/test", { method: "POST", body: {} })
						.then((r) => {
							const info = r && r.ok && r.serverInfo ? String(r.serverInfo) : "";
							cacheRef.current[asked] = info; // 失败也缓存空串，会话内不反复探测
							if (liveRef.current === asked) setVer(info);
						})
						.catch(() => { cacheRef.current[asked] = ""; });
				}, 300);
				return () => window.clearTimeout(timer);
			}, [connId]);
			return ver;
		}
		function TransferView(props) {
			const conns = props.conns || [];
			const projectPath = props.projectPath;
			const askConfirm = props.askConfirm;
			const visible = props.visible; // Panel 传入：视图隐藏时停轮询
			const [srcId, setSrcId] = React.useState("");
			const [dstId, setDstId] = React.useState("");
			// 层级状态（BrowsePane 同语义：database=对象树第一层，schema=第二层仅 pg 系；""=连接默认上下文）
			const [srcDb, setSrcDb] = React.useState("");
			const [srcSchema, setSrcSchema] = React.useState("");
			const [dstDb, setDstDb] = React.useState("");
			const [dstSchema, setDstSchema] = React.useState("");
			const [srcDbs, setSrcDbs] = React.useState(null); // null=未加载
			const [srcSchemas, setSrcSchemas] = React.useState(null);
			const [dstDbs, setDstDbs] = React.useState(null);
			const [dstSchemas, setDstSchemas] = React.useState(null);
			const [dbsErr, setDbsErr] = React.useState({ src: "", dst: "" }); // 库清单加载失败就地显示（不弹全局）
			const [srcTables, setSrcTables] = React.useState([]); // {name,type}[] 可传输对象（表/集合）
			const [loadingTables, setLoadingTables] = React.useState(false);
			const [tablesErr, setTablesErr] = React.useState("");
			const [tablesTick, setTablesTick] = React.useState(0); // 表清单就地重试
			const [selected, setSelected] = React.useState([]); // 已勾选表名
			const [writeMode, setWriteMode] = React.useState("insert");
			const [batchSize, setBatchSize] = React.useState(1000);
			const [tableConcurrency, setTableConcurrency] = React.useState(4);
			const [shardConcurrency, setShardConcurrency] = React.useState(4);
			const [overwriteStructure, setOverwriteStructure] = React.useState(false);
			const [subTab, setSubTab] = React.useState("history"); // history=传输历史 | tlog=传输日志（同级子标签）
			const [liveTasks, setLiveTasks] = React.useState(null); // 运行中任务快照（2s 轮询）
			// 实时进度轮询：标签可见即轮（不依赖本视图发起的任务，重启/外部发起的传输也可见）
			React.useEffect(() => {
				const loadLive = () => {
					api("transfer/live" + qs({ project: projectPath }))
						.then((list) => setLiveTasks(Array.isArray(list) ? list : []))
						.catch(() => setLiveTasks([]));
				};
				loadLive();
				if (!visible) return undefined;
				const timer = setInterval(loadLive, 2000);
				return () => clearInterval(timer);
			}, [visible, projectPath]);
			const pct = (rows, total) => (total != null && total > 0 ? Math.min(100, Math.round((rows / total) * 100)) + "%" : "—");
			const [task, setTask] = React.useState(null); // {id, snap}
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const pollRef = React.useRef(null);
			const mountedRef = React.useRef(true);
			const dbsCacheRef = React.useRef({}); // connId -> string[]
			const schemasCacheRef = React.useRef({}); // connId + "/" + db -> string[]
			const verCacheRef = React.useRef({}); // connId -> serverInfo（含失败空串）
			React.useEffect(() => () => { mountedRef.current = false; }, []);
			const srcVer = useServerVer(srcId, verCacheRef);
			const dstVer = useServerVer(dstId, verCacheRef);

			const srcConn = conns.find((c) => c.id === srcId);
			const dstConn = conns.find((c) => c.id === dstId);
			const dstGrant = (props.grants || []).find((x) => x.connId === dstId);
			// PG/GaussDB 三层（库→模式→表），与 BrowsePane 同一张表；sqlite 无库层（连接默认上下文）
			const HAS_SCHEMAS = { postgresql: true, gaussdb: true };
			const NO_DB_LEVEL = { sqlite: true };

			// 项目切换清层级缓存（对齐 BrowsePane：避免陈旧授权下的旧数据）
			React.useEffect(() => {
				dbsCacheRef.current = {}; schemasCacheRef.current = {};
				setSrcDb(""); setSrcSchema(""); setDstDb(""); setDstSchema(""); setSrcDbs(null); setSrcSchemas(null); setDstDbs(null); setDstSchemas(null);
				setDbsErr({ src: "", dst: "" });
			}, [projectPath]);

			// 库清单加载（BrowsePane 同端点；缓存防重复拉取，失败就地记 dbsErr 可重试）
			function loadDbs(slot, connId) {
				const conn = conns.find((c) => c.id === connId);
				if (!connId || !projectPath || !conn || NO_DB_LEVEL[conn.kind]) return;
				const cached = dbsCacheRef.current[connId];
				if (cached) {
					if (slot === "src") setSrcDbs(cached); else setDstDbs(cached);
					return;
				}
				api("databases" + qs({ project: projectPath, connId }))
					.then((list) => {
						const v = Array.isArray(list) ? list : [];
						dbsCacheRef.current[connId] = v;
						if (slot === "src") setSrcDbs(v); else setDstDbs(v);
					})
					.catch((e) => setDbsErr((s) => Object.assign({}, s, { [slot]: String(e && e.message ? e.message : e) })));
			}
			// 源连接变化 → 清层级与表选中，拉库清单（目标侧连接变化只联动自身）
			React.useEffect(() => {
				setSrcDb(""); setSrcSchema(""); setSrcSchemas(null); setTablesErr("");
				setDbsErr((s) => Object.assign({}, s, { src: "" }));
				loadDbs("src", srcId);
			}, [srcId, projectPath]); // eslint-disable-line
			React.useEffect(() => {
				setDstDb(""); setDstSchema(""); setDstSchemas(null);
				setDbsErr((s) => Object.assign({}, s, { dst: "" }));
				loadDbs("dst", dstId);
			}, [dstId, projectPath]); // eslint-disable-line
			// 库变化（pg 系）→ 清模式并拉库内 schema 清单，完成后自动补选第一项（Navicat 式：进库即见表）；源/目标共用
			function loadSchemas(slot, connId, db) {
				const conn = conns.find((c) => c.id === connId);
				if (!connId || !db || !HAS_SCHEMAS[conn && conn.kind]) return;
				const setList = slot === "src" ? setSrcSchemas : setDstSchemas;
				const setPick = slot === "src" ? setSrcSchema : setDstSchema;
				setPick(""); setList(null);
				const ck = connId + "/" + db;
				const cached = schemasCacheRef.current[ck];
				if (cached) { setList(cached); setPick(cached[0] || ""); return; }
				api("schemas" + qs({ project: projectPath, connId, database: db }))
					.then((list) => {
						const v = Array.isArray(list) ? list : [];
						schemasCacheRef.current[ck] = v;
						setList(v);
						setPick(v[0] || "");
					})
					.catch(() => { setList([]); }); // 失败置空清单：模式/表区按「无模式」呈现，不弹全局错误
			}
			React.useEffect(() => { loadSchemas("src", srcId, srcDb); }, [srcId, srcDb, projectPath]); // eslint-disable-line
			React.useEffect(() => { loadSchemas("dst", dstId, dstDb); }, [dstId, dstDb, projectPath]); // eslint-disable-line
			// 表清单按源层级加载：pg 系需库+模式齐备（服务端 tables.database="库名.模式" 复合形态，与 BrowsePane 一致）；
			// 其余库层直传库名（""=默认库），sqlite/mongo 按连接默认上下文。只列 BASE TABLE/COLLECTION。乱序护栏 stopped。
			React.useEffect(() => {
				setSrcTables([]); setSelected([]); setTablesErr("");
				if (!srcId || !projectPath) return undefined;
				const kind = srcConn && srcConn.kind;
				let database;
				if (NO_DB_LEVEL[kind]) database = undefined;
				else if (HAS_SCHEMAS[kind]) {
					if (!srcDb || !srcSchema) return undefined; // 等模式下拉就位（schema effect 自动补选）
					database = srcDb + "." + srcSchema;
				} else database = srcDb || undefined;
				let stopped = false;
				setLoadingTables(true);
				api("tables" + qs({ project: projectPath, connId: srcId, database }))
					.then((list) => {
						if (stopped) return;
					const rows = (Array.isArray(list) ? list : [])
						.filter((x) => !x || !x.type || String(x.type).toUpperCase() === "TABLE" || String(x.type).toUpperCase() === "COLLECTION" || String(x.type).toUpperCase() === "BASE TABLE")
						.map((x) => ({ name: String(x.name), type: String((x && x.type) || "").toUpperCase(), comment: x && x.comment ? String(x.comment) : "" }))
						.filter((x) => x.name);
					setSrcTables(rows);
					})
					.catch((e) => { if (!stopped) { setSrcTables([]); setTablesErr(String(e && e.message ? e.message : e)); } })
					.finally(() => { if (!stopped) setLoadingTables(false); });
				return () => { stopped = true; };
			}, [srcId, srcDb, srcSchema, projectPath, tablesTick]); // eslint-disable-line

			// 轮询：running → 每 800ms；终态/NOT_FOUND 停止（NOT_FOUND = 终态即清除）
			const stopPoll = React.useCallback(() => {
				if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
			}, []);
			React.useEffect(() => stopPoll, [stopPoll]);
			function poll(id) {
				stopPoll();
				// 乱序护栏：慢响应（>800ms）晚到时本轮已被置失效，不得覆盖已到达的终态快照
				let stopped = false;
				pollRef.current = setInterval(async () => {
					if (stopped) return;
					try {
						const snap = await api("transfer/" + encodeURIComponent(id) + qs({ project: projectPath }));
						if (stopped) return; // 终态已先行（另一轮已 stopPoll）：丢弃本轮旧快照
						setTask({ id, snap });
						if (!snap || snap.status !== "running") { stopped = true; stopPoll(); }
					} catch (e) {
						stopped = true;
						stopPoll();
						// 任务条目已被清理（终态保留窗口过后/被新任务 sweep）：拉一次失败不报错，保持既有快照
						setTask((prev) => (prev && prev.snap && prev.snap.status !== "running" ? prev : null));
					}
				}, 800);
			}

			// 同连接且库/模式都相同才视为同上下文：允许同连接跨库（或同库跨模式）传输
			// （后端同目标互斥仍按 targetConnId，statement 携带定位入审计）
			const sameCtx = !!srcId && srcId === dstId && (srcDb || "") === (dstDb || "") && (srcSchema || "") === (dstSchema || "");
			const canStart = !!srcId && !!dstId && selected.length > 0 && !sameCtx;
			// 禁用提示按实际缺失条件给出（sameCtx 优先：结构性约束先于勾表提醒），不得与禁因不符
			const startHint = sameCtx ? t("trSameConn") : (!srcId || !dstId) ? t("selectConn") : t("trxPickTable");

			async function start() {
				if (busy || !canStart) return;
				setBusy(true); setError("");
				try {
					const data = await runGuarded(
						(challengeId) => api("transfer/start", {
							method: "POST",
							body: {
								projectPath, sourceConnId: srcId, targetConnId: dstId, tables: selected, writeMode, batchSize, tableConcurrency, shardConcurrency, overwriteStructure, challengeId,
								// 定位字段（undefined 序列化即省略 = 连接默认上下文，后端 optStr 语义）
								sourceDatabase: srcDb || undefined, sourceSchema: srcSchema || undefined,
								targetDatabase: dstDb || undefined, targetSchema: dstSchema || undefined,
							},
						}),
						(info) => askConfirm(Object.assign({}, info, {
							target: { conn: dstConn ? (dstConn.name || dstId) : dstId, kind: dstConn ? dstConn.kind : "", db: dstDb ? (dstDb + (dstSchema ? "." + dstSchema : "")) : t("defaultDb"), mode: dstGrant ? dstGrant.mode : "" },
						})),
					);
				const id = data && data.taskId;
				// 确认往返期间组件可能已卸载（locale 切换重建 Panel）：此时不再建立轮询
				if (id && mountedRef.current) {
					setTask({ id, snap: { status: "running", tables: [], failures: [] } });
					poll(id);
				}
				} catch (e) {
					if (!e.cancelled) setError(String(e && e.message ? e.message : e));
				} finally {
					setBusy(false);
				}
			}

			function cancel() {
				if (!task) return;
				api("transfer/" + encodeURIComponent(task.id) + "/cancel", { method: "POST", body: { projectPath } })
					.catch((e) => setError(String(e && e.message ? e.message : e)));
			}

			const toggle = (name) => setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.concat(name)));
			const [collapsed, setCollapsed] = React.useState({}); // 分组树折叠状态（{ [type]: true }）
			const [history, setHistory] = React.useState(null); // 终态历史条目数组（子标签激活时懒加载）
			const loadHistory = React.useCallback(() => {
				if (!projectPath) return;
				api("transfer-history" + qs({ limit: 30 }))
					.then((list) => setHistory(Array.isArray(list) ? list : []))
					.catch((e) => setError(String(e && e.message ? e.message : e)));
			}, [projectPath]);
			// 传输历史懒加载：子标签激活且顶级可见时拉取（默认激活子标签首次进入即加载，onClick 保持纯切换）
			React.useEffect(() => {
				if (visible && subTab === "history" && history === null) loadHistory();
			}, [visible, subTab, history, loadHistory]);
			// 清除确认走 askConfirm 通道（原生 confirm 已在库内移除：无 aria/焦点管理）
			async function clearHistory() {
				const yes = await props.askConfirm({
					title: t("trHistoryClear"),
					statement: t("trHistory"),
					hint: t("trHistoryClearConfirm"),
					confirmLabel: t("trHistoryClear"),
					target: { conn: "", kind: "", db: "", mode: "" },
				});
				if (!yes) return;
				api("transfer-history/clear", { method: "POST", body: {} })
					.then((r) => { setMessage(t("ok") + " (" + (r && r.removed != null ? r.removed : 0) + ")"); setHistory([]); })
					.catch((e) => setError(String(e && e.message ? e.message : e)));
			}
			const historyStatus = (s2) => s2 === "done" ? t("trStatusDone") : s2 === "failed" ? t("trStatusFailed") : s2 === "cancelled" ? t("trStatusCancelled") : s2;
			// 状态着色：failed 红 / done 绿 / 其余默认
			const statusColor = (s) => s === "failed" ? { color: "var(--dbt-danger,#ff453a)", fontWeight: 600 } : s === "done" ? { color: "var(--dbt-success,#30d158)" } : undefined;
			const statusLabel = (s) => s === "pending" ? t("trStatusPending") : s === "running" ? t("trStatusRunning") : s === "done" ? t("trStatusDone") : s === "failed" ? t("trStatusFailed") : s === "cancelled" ? t("trStatusCancelled") : s;
			const connOptions = (value, onPick, disabled, label) => React.createElement("select", { value, disabled: !!disabled || busy, "aria-label": label, onChange: (e) => onPick(e.target.value) },
				React.createElement("option", { value: "" }, t("selectConn")),
				conns.filter((c) => c.kind !== "redis").map((c) => {
					const g = (props.grants || []).find((x) => x.connId === c.id);
					const suffix = g && g.mode ? " · " + g.mode : "";
					return React.createElement("option", { key: c.id, value: c.id }, (c.name || c.id) + " (" + c.kind + suffix + ")");
				}));
			// 摘要条层级描述：pg 系「库名.模式名」，其余库层显库名，无层级/未选库显示默认库
			const scopeText = (conn, db, schema) => {
				if (!conn) return "—";
				const k = conn.kind;
				if (NO_DB_LEVEL[k] || !db) return t("defaultDb");
				return HAS_SCHEMAS[k] && schema ? db + "." + schema : db;
			};
			// 信息区键值：kind/name/host/port 直读连接元数据（URL 方式可能无 host/port，显示「—」不编造）
			function infoKv(conn, ver) {
				return React.createElement("dl", { className: "dbt-transfer-kv" },
					React.createElement("dt", null, t("trxConnType")), React.createElement("dd", null, conn.kind || "—"),
					React.createElement("dt", null, t("trxConnName")), React.createElement("dd", null, conn.name || conn.id),
					React.createElement("dt", null, t("trxHost")), React.createElement("dd", null, conn.host || "—"),
					React.createElement("dt", null, t("trxPort")), React.createElement("dd", null, conn.port != null ? String(conn.port) : "—"),
					React.createElement("dt", null, t("trxServerVer")), React.createElement("dd", null, ver || "—"));
			}
			// 单栏：栏标题（蓝）+ 连接/库(/模式)纵向下拉 + 底部信息区
			function transferCol(side) {
				const isSrc = side === "src";
				const connId = isSrc ? srcId : dstId;
				const conn = isSrc ? srcConn : dstConn;
				const kind = conn && conn.kind;
				const db = isSrc ? srcDb : dstDb;
				const onDb = isSrc ? setSrcDb : setDstDb;
				const dbs = isSrc ? srcDbs : dstDbs;
				const schemas = isSrc ? srcSchemas : dstSchemas;
				const schema = isSrc ? srcSchema : dstSchema;
				const onSchema = isSrc ? setSrcSchema : setDstSchema;
				const errText = isSrc ? dbsErr.src : dbsErr.dst;
				const titleId = "dbt-transfer-" + side + "-title";
				// mongo 源/目标栏均可选库：服务端 tables/preview 按 database 定位（mongodb/index.ts dbOf），
				// 表清单与 sourceDatabase/targetDatabase 同库对齐，无错位
				const noDbLevel = NO_DB_LEVEL[kind];
				return React.createElement("section", { className: "dbt-transfer-col", "aria-labelledby": titleId },
					React.createElement("header", { id: titleId, className: "dbt-transfer-coltitle" }, t(isSrc ? "trxSource" : "trxTarget")),
					React.createElement("label", { className: "dbt-transfer-field" },
						React.createElement("span", { className: "dbt-transfer-fieldlabel" }, t("trxConn")),
						connOptions(connId, isSrc ? setSrcId : setDstId, false, t("trxConn"))),
					noDbLevel
						? React.createElement("label", { className: "dbt-transfer-field" },
							React.createElement("span", { className: "dbt-transfer-fieldlabel" }, t("trxDatabase")),
							React.createElement("span", { className: "dbt-muted" }, t("trxNoDbLevel")))
						: React.createElement("label", { className: "dbt-transfer-field" },
							React.createElement("span", { className: "dbt-transfer-fieldlabel" }, t("trxDatabase")),
							React.createElement("select", { value: db, disabled: busy || !connId, "aria-label": t("trxDatabase"), onChange: (e) => onDb(e.target.value) },
								React.createElement("option", { value: "" }, t("defaultDb")),
								(dbs || []).map((d) => React.createElement("option", { key: d, value: d }, d)))),
					errText ? React.createElement("span", { className: "dbt-err" },
						t("trxLoadDbsFail") + "：" + errText + " ",
						React.createElement("button", { className: "dbt-btn", onClick: () => { setDbsErr((s) => Object.assign({}, s, { [side]: "" })); loadDbs(side, connId); } }, t("retry"))) : null,
					HAS_SCHEMAS[kind] ? React.createElement("label", { className: "dbt-transfer-field" },
						React.createElement("span", { className: "dbt-transfer-fieldlabel" }, t("trxSchema")),
						React.createElement("select", { value: schema, disabled: busy || !db || !schemas, "aria-label": t("trxSchema"), onChange: (e) => onSchema(e.target.value) },
							(schemas || []).map((s) => React.createElement("option", { key: s, value: s }, s)))) : null,
					conn ? React.createElement("footer", { className: "dbt-transfer-info" },
						React.createElement("div", { className: "dbt-transfer-infotitle" }, t("trxInfo")),
						infoKv(conn, isSrc ? srcVer : dstVer)) : null,
					!isSrc && sameCtx ? React.createElement("span", { className: "dbt-err", role: "alert" }, t("trSameConn")) : null,
				);
			}
			// 表清单三态：加载中 / 失败+就地重试 / 空态（未选连接或 pg 系未选库、库内无模式、无表）/ 分组树
			function tablesBody() {
				if (loadingTables) return React.createElement("div", { className: "dbt-muted" }, t("trLoadingTables"));
				if (tablesErr) return React.createElement("div", { className: "dbt-browse-errorbox" },
					React.createElement("span", { className: "dbt-err", role: "alert" }, tablesErr),
					React.createElement("button", { className: "dbt-btn", onClick: () => setTablesTick((x) => x + 1) }, t("retry")));
				const kind = srcConn && srcConn.kind;
				if (!srcId || (HAS_SCHEMAS[kind] && !srcDb)) return React.createElement("div", { className: "dbt-muted" }, t("trxPickSource"));
				if (HAS_SCHEMAS[kind] && srcDb && srcSchemas && srcSchemas.length === 0) return React.createElement("div", { className: "dbt-muted" }, t("noSchemas"));
				if (HAS_SCHEMAS[kind] && srcDb && !srcSchema) return React.createElement("div", { className: "dbt-muted" }, t("trLoadingTables"));
				if (srcTables.length === 0) return React.createElement("div", { className: "dbt-muted" }, t("noTables"));
				// 按类型分组（TABLE/BASE TABLE→表、COLLECTION→集合、其余→其他），对齐 Navicat 数据库对象树
				const byType = new Map();
				for (const row of srcTables) {
					const key = row.type === "COLLECTION" ? "COLLECTION" : row.type === "VIEW" ? "VIEW" : row.type === "" ? "OTHER" : "TABLE";
					if (!byType.has(key)) byType.set(key, []);
					byType.get(key).push(row);
				}
				const groupLabel = (key) => key === "COLLECTION" ? t("trGroupCollection") : key === "VIEW" ? t("trGroupView") : key === "OTHER" ? t("trGroupOther") : t("trGroupTable");
				const toggleGroup = (rows, allSelected) =>
					setSelected((prev) => allSelected
						? prev.filter((n) => !rows.some((r) => r.name === n))
						: prev.concat(rows.map((r) => r.name).filter((n) => !prev.includes(n))));
				const triRef = (all, some) => (el) => { if (el) el.indeterminate = some && !all; };
				return React.createElement("div", { className: "dbt-transfer-tablelist", role: "group", "aria-label": t("trTables") },
					[...byType.entries()].map(([key, rows]) => {
						const selCount = rows.filter((r) => selected.includes(r.name)).length;
						const all = selCount === rows.length;
						const some = selCount > 0;
						const open = !collapsed[key];
						const flip = () => setCollapsed((prev) => Object.assign({}, prev, { [key]: open }));
						return React.createElement("div", { key },
							React.createElement("div", { className: "dbt-tr-group-head", role: "button", tabIndex: 0, "aria-expanded": open,
								onClick: flip, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } } },
								React.createElement("span", { className: "dbt-tr-caret" + (open ? " open" : ""), "aria-hidden": "true" }),
								React.createElement("input", { type: "checkbox", ref: triRef(all, some), checked: all, onChange: () => toggleGroup(rows, all), onClick: (e) => e.stopPropagation(), "aria-label": groupLabel(key) }),
								React.createElement("span", null, groupLabel(key) + " (" + selCount + "/" + rows.length + ")")),
							open ? rows.map((row) => React.createElement("div", { key: row.name, className: "dbt-tr-item", title: row.comment || undefined },
								React.createElement("label", { className: "dbt-tr-pair" },
									React.createElement("input", { type: "checkbox", checked: selected.includes(row.name), onChange: () => toggle(row.name) }),
									React.createElement("span", null, row.name),
									row.comment ? React.createElement("span", { className: "dbt-tr-comment" }, row.comment) : null))) : null);
					}));
			}

			return React.createElement(
				"div",
				{ className: "dbt-card" },
				// 顶部摘要条：源连接/层级 ⇄ 目标连接/层级（源=目标同上下文时箭头转 danger 色）
				React.createElement("div", { className: "dbt-transfer-summary", "aria-label": t("trxArrowLabel") },
					React.createElement("span", { className: "dbt-transfer-endpoint" },
						React.createElement("strong", null, srcConn ? (srcConn.name || srcId) : t("selectConn")),
						React.createElement("span", { className: "dbt-muted" }, scopeText(srcConn, srcDb, srcSchema))),
					React.createElement("span", { className: "dbt-transfer-divider", style: sameCtx ? { color: "var(--dbt-danger)" } : undefined }, transferArrow()),
					React.createElement("span", { className: "dbt-transfer-endpoint" },
						React.createElement("strong", null, dstConn ? (dstConn.name || dstId) : t("selectConn")),
						React.createElement("span", { className: "dbt-muted" }, scopeText(dstConn, dstDb, dstSchema)))),
				// 双栏：源（连接/数据库/模式）⇄ 目标（连接/数据库）
				React.createElement("div", { className: "dbt-transfer-cols" },
					transferCol("src"),
					React.createElement("div", { className: "dbt-transfer-divider" }, transferArrow()),
					transferCol("dst")),
				// 传输对象：表清单按源层级联动加载
				React.createElement("div", { className: "dbt-group" },
					React.createElement("div", { className: "dbt-listrow" },
						React.createElement("span", { className: "dbt-muted" }, t("trTables")),
						React.createElement("span", { className: "dbt-muted" }, t("trxSelectedCount", { n: selected.length })),
						React.createElement("span", { style: { flex: 1 } }),
						srcTables.length > 0 ? React.createElement("button", { className: "dbt-btn", onClick: () => setSelected(srcTables.map((x) => x.name)) }, t("trSelectAll")) : null,
						selected.length > 0 ? React.createElement("button", { className: "dbt-btn", onClick: () => setSelected([]) }, t("trClear")) : null),
					tablesBody()),
				// 传输选项（原生 details 渐进披露；四控件沿用原逻辑）
				React.createElement("details", { className: "dbt-transfer-options" },
					React.createElement("summary", null, t("trxOptions")),
					React.createElement("div", { className: "dbt-group" },
						React.createElement("div", { className: "dbt-listrow" },
							React.createElement("span", { className: "dbt-muted" }, t("trWriteMode")),
							React.createElement("select", { value: writeMode, disabled: busy, "aria-label": t("trWriteMode"), onChange: (e) => setWriteMode(e.target.value) },
								React.createElement("option", { value: "insert" }, t("trModeInsert")),
								React.createElement("option", { value: "ignore" }, t("trModeIgnore")),
								React.createElement("option", { value: "replace" }, t("trModeReplace")),
								React.createElement("option", { value: "truncate" }, t("trModeTruncate")))),
						React.createElement("div", { className: "dbt-listrow" },
							React.createElement("span", { className: "dbt-muted" }, t("trBatchSize")),
							React.createElement("input", { type: "number", min: 1, max: 5000, "aria-label": t("trBatchSize"), value: batchSize, disabled: busy, onChange: (e) => setBatchSize(Math.min(5000, Math.max(1, Math.floor(Number(e.target.value) || 1)))) })),
						React.createElement("div", { className: "dbt-listrow" },
							React.createElement("span", { className: "dbt-muted" }, t("trTableConcurrency")),
							React.createElement("input", { type: "number", min: 1, max: 16, "aria-label": t("trTableConcurrency"), value: tableConcurrency, disabled: busy, onChange: (e) => setTableConcurrency(Math.min(16, Math.max(1, Math.floor(Number(e.target.value) || 1)))) })),
						React.createElement("div", { className: "dbt-listrow" },
							React.createElement("span", { className: "dbt-muted" }, t("trShardConcurrency")),
							React.createElement("input", { type: "number", min: 1, max: 32, "aria-label": t("trShardConcurrency"), value: shardConcurrency, disabled: busy, onChange: (e) => setShardConcurrency(Math.min(32, Math.max(1, Math.floor(Number(e.target.value) || 1)))) })),
					React.createElement("label", { className: "dbt-listrow", title: t("trxOverwriteHint") },
						React.createElement("input", { type: "checkbox", checked: overwriteStructure, disabled: busy, onChange: (e) => setOverwriteStructure(e.target.checked) }),
						React.createElement("span", { className: "dbt-muted" }, t("trxOverwrite"))))),

				// 动作行（禁用时 title 说明原因）+ 进度（仅任务存在时渲染）
				React.createElement("div", { className: "dbt-listrow" },
					React.createElement("button", { className: "dbt-btn primary", disabled: busy || !canStart, title: canStart ? undefined : startHint, onClick: () => { start(); } }, t("trStart")),
					task && task.snap && task.snap.status === "running"
						? React.createElement("button", { className: "dbt-btn", onClick: cancel }, t("trCancel"))
						: null,
					error ? React.createElement("span", { className: "dbt-err", role: "alert" }, error) : null),
				task && task.snap
					? React.createElement(
						"div",
						{ className: "dbt-group" },
						React.createElement("div", { className: "dbt-listrow" },
							React.createElement("span", { className: "dbt-muted" }, t("trProgress")),
							React.createElement("strong", null, React.createElement("span", { "aria-live": "polite", style: statusColor(task.snap.status) }, statusLabel(task.snap.status)))),
						React.createElement("table", { className: "dbt-table" },
							React.createElement("thead", null, React.createElement("tr", null,
								React.createElement("th", null, t("trTables")),
								React.createElement("th", null, t("trStatus")),
								React.createElement("th", null, t("trRows")),
								React.createElement("th", null, t("trShards")))),
							React.createElement("tbody", null, (task.snap.tables || []).map((tb) =>
								React.createElement("tr", { key: tb.name },
									React.createElement("td", null, tb.name),
									React.createElement("td", { style: statusColor(tb.status) }, statusLabel(tb.status)),
									React.createElement("td", null, String(tb.rows) + (tb.totalRows != null ? " / " + tb.totalRows + "（" + pct(tb.rows, tb.totalRows) + "）" : "")),
									React.createElement("td", null, tb.shardsDone + "/" + tb.shardsTotal + (tb.shardsFailed > 0 ? " (" + tb.shardsFailed + "×)" : "")))))),
						(task.snap.failures || []).length > 0
							? React.createElement("div", { className: "dbt-group" },
								React.createElement("div", { className: "dbt-muted" }, t("trFailures")),
								task.snap.failures.map((f, i) => React.createElement("div", { key: i, className: "dbt-err" },
									f.table + (f.shard >= 0 ? " #" + f.shard : "") + ": " + f.error)))
							: null)
					: null,
				// 传输历史/传输日志：同级子标签（分段控件复用 .dbt-tabs），内容常驻挂载 + hidden 切换（切换不丢状态）
				React.createElement("div", { className: "dbt-tabs", role: "tablist" },
					[["history", t("trHistory")], ["tlog", t("viewTransferLog")]].map(([v, label]) =>
						React.createElement("button", {
							key: v, className: subTab === v ? "active" : "",
							role: "tab", "aria-selected": subTab === v,
							onClick: () => setSubTab(v),
						}, label)),
				),
				React.createElement("div", { hidden: subTab !== "history" },
					React.createElement("div", { className: "dbt-group" },
						React.createElement("div", { className: "dbt-listrow" },
							React.createElement("span", { style: { flex: 1 } }),
							history !== null && history.length > 0
								? React.createElement("button", { className: "dbt-btn", onClick: () => { clearHistory(); } }, t("trHistoryClear"))
								: null),
						history === null
							? React.createElement("div", { className: "dbt-muted" }, "…")
							: history.length === 0
								? React.createElement("div", { className: "dbt-muted" }, t("trHistoryEmpty"))
								: history.map((h) => React.createElement("div", { key: h.taskId + h.ts, className: "dbt-tr-item", title: h.statement },
									React.createElement("span", { className: "dbt-muted", style: { flex: "none" } }, new Date(h.ts).toLocaleString()),
									React.createElement("strong", { style: statusColor(h.status) }, historyStatus(h.status)),
									React.createElement("span", { className: "dbt-tr-comment" },
										((h.statement.match(/表\[[^\]]*\]/) || [""])[0].slice(0, 80))
											+ " · " + (h.tables || []).filter((t2) => t2.status === "done").length + "✓/"
											+ (h.tables || []).filter((t2) => t2.status === "failed").length + "✗"
											+ ((h.failures || []).length > 0 ? " · " + t("trFailures") + " " + h.failures.length : ""))))),
				),
				// 传输日志：props 直取原始入参别名（2843-2846 行绑定），不经过本地遮蔽的 busy/error（那是传输任务自己的状态）；
				// visible=顶级标签激活且当前在日志子标签（切走即停 5s 轮询）
				React.createElement("div", { hidden: subTab !== "tlog" },
					React.createElement(TransferLogView, { projectPath, visible: visible && subTab === "tlog", askConfirm })),
			);
		}
		/* ---------------- 传输日志（「数据传输」内子标签：实时事件流，5s 自动刷新） ---------------- */
		function TransferLogView(props) {
			const projectPath = props.projectPath;
			const [rows, setRows] = React.useState(null); // 日志条目数组
			const [auto, setAuto] = React.useState(true);
			const [error, setError] = React.useState("");

			const load = React.useCallback(() => {
				api("transfer-log" + qs({ project: projectPath, limit: 300 }))
					.then((list) => setRows(Array.isArray(list) ? list : []))
					.catch((e) => setError(String(e && e.message ? e.message : e)));
			}, [projectPath]);

			// 子标签可见时 5s 轮询；隐藏即真正清除定时器（切走即停），重进/进入时立即拉取一次
			// （auto 关闭时这次拉取是唯一加载路径，等价替代已删除的手动刷新按钮）
			React.useEffect(() => {
				if (!props.visible) return undefined;
				load();
				if (!auto) return undefined;
				const timer = setInterval(load, 5000);
				return () => clearInterval(timer);
			}, [props.visible, auto, load]);

			async function clearLog() {
				const yes = await props.askConfirm({
					title: t("tlogClear"),
					statement: t("viewTransferLog"),
					hint: t("tlogClearConfirm"),
					confirmLabel: t("tlogClear"),
					target: { conn: "", kind: "", db: "", mode: "" },
				});
				if (!yes) return;
				api("transfer-history/clear", { method: "POST", body: {} })
					.then(() => load())
					.catch((e) => setError(String(e && e.message ? e.message : e)));
			}

			const typeLabel = (ty) => ty === "start" ? t("tlogTypeStart") : ty === "table" ? t("tlogTypeTable") : ty === "progress" ? t("tlogTypeProgress") : ty === "finish" ? t("tlogTypeFinish") : ty;

			return React.createElement(
				"div",
				{ className: "dbt-card" },
				React.createElement("div", { className: "dbt-listrow" },
					React.createElement("label", { className: "dbt-listrow", style: { flex: "none" } },
						React.createElement("input", { type: "checkbox", checked: auto, onChange: (e) => setAuto(e.target.checked) }),
						React.createElement("span", { className: "dbt-muted" }, t("tlogAuto"))),
					React.createElement("span", { style: { flex: 1 } }),
					React.createElement("button", { className: "dbt-btn", onClick: () => { clearLog(); } }, t("tlogClear"))),
				error ? React.createElement("div", { className: "dbt-err", role: "alert" }, error) : null,
				rows === null
					? React.createElement("div", { className: "dbt-muted" }, "…")
					: rows.length === 0
						? React.createElement("div", { className: "dbt-muted" }, t("tlogEmpty"))
						: React.createElement("div", { className: "dbt-transfer-tablelist", style: { maxHeight: 320 } },
							rows.map((r, i) => {
								const brief = r.type === "start"
									? (r.statement || "").replace(/表\[[^\]]*\]/, "表[" + ((r.statement.match(/表\[([^\]]*)\]/) || ["", ""])[1].split(",").length) + "张]")
									: r.type === "table" || r.type === "progress"
										? (r.table || "") + "  " + (r.rows != null ? r.rows : 0) + (r.totalRows != null ? " / " + r.totalRows : "") + " 行" + (r.status === "failed" ? "  " + (r.statusLabel || "") : "")
										: (r.statement || "").slice(0, 60) + "  " + (r.status || "");
								return React.createElement("div", { key: r.ts + i, className: "dbt-tr-item" },
									React.createElement("span", { className: "dbt-muted", style: { flex: "none", minWidth: 84 } }, new Date(r.ts).toLocaleTimeString()),
									React.createElement("span", { className: "dbt-tr-chip", style: { flex: "none" } }, typeLabel(r.type)),
									React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, brief));
							})),
			);
		}

		/* ---------------- 根面板 ---------------- */
		function Panel(props) {
			const visible = props.visible;
			const scope = props.scope || {};
			const [view, setView] = React.useState("manage");
			// 项目路径初始值：scope.cwd 优先；cwd 是工作区容器时用选中的 git 仓库 repoRoot 兜底
			//（SessionScope 契约字段：{ sessionId, cwd?, repoRoot? }；workspacePath 为历史遗留兜底）
			const [projectPath, setProjectPath] = React.useState(scope.cwd || scope.repoRoot || scope.workspacePath || "");
			const [projectEdited, setProjectEdited] = React.useState(!(scope.cwd || scope.repoRoot || scope.workspacePath));
			const [conns, setConns] = React.useState([]);
			const [grants, setGrants] = React.useState([]);
			const [busy, setBusy] = React.useState("");
			const [error, setError] = React.useState("");
			const [message, setMessage] = React.useState("");
			const [confirmReq, setConfirmReq] = React.useState(null); // {statement,danger,reason,resolve}
			const [treeRefresh, setTreeRefresh] = React.useState(0); // 浏览树刷新信号（手动按钮 / 切回可见自动）
			// 侧边栏切回可见时自动重拉已展开层：agents 等外部建库/建表后切回来即可见，无需手点刷新
			React.useEffect(() => {
				if (visible) setTreeRefresh((x) => x + 1);
			}, [visible]);

			const askConfirm = React.useCallback((info) => new Promise((resolve) => {
				setConfirmReq(Object.assign({}, info, { resolve }));
			}), []);

			// 项目路径权威解析（对齐 dsh-ssh-tunnel getProjectContext）：
			// host 端以会话 header.cwd 为准归一化出 projectPathKey，前端不自拼 key。
			// scope.cwd/sessionId 变化（切换会话）时自动重新解析；用户手填（projectEdited）时不覆盖。
			const sessionKey = scope.sessionId || "";
			const scopeCwd = scope.cwd || scope.repoRoot || scope.workspacePath || "";
			const resolvedRef = React.useRef("");
			React.useEffect(() => {
				if (!visible || projectEdited) return;
				api("project-context", { method: "POST", body: { sessionId: sessionKey, cwd: scopeCwd } })
					.then((r) => {
						if (r && r.hasProject && r.projectPathKey) {
							resolvedRef.current = r.projectPathKey;
							setProjectPath(r.projectPathKey);
						}
					})
					.catch(() => { /* 解析失败保留现值，仍可手填 */ });
			}, [visible, sessionKey, scopeCwd, projectEdited]);

			const reload = React.useCallback(async () => {
				const [c, g] = await Promise.all([
					api("connections"),
					projectPath ? api("grants" + qs({ project: projectPath })) : Promise.resolve([]),
				]);
				setConns(c || []);
				setGrants(g || []);
			}, [projectPath]);

			React.useEffect(() => {
				if (!visible) return;
				reload().catch((e) => setError(String(e && e.message ? e.message : e)));
			}, [visible, reload]);

			function run(name, fn) {
				setBusy(name); setError(""); setMessage("");
				return fn()
					.then(() => setMessage(t("ok")))
					.catch((e) => setError(String(e && e.message ? e.message : e)))
					.finally(() => setBusy(""));
			}
			function onError(e) { setError(String(e && e.message ? e.message : e)); }

			const shared = { conns, grants, projectPath, busy, run, reload, onError, askConfirm };
			// 四视图常驻元素：Panel 渲染期构建一次，切 tab 不重建（状态保留），ManageView/GrantsView/ConsoleView 复用 shared
			const viewEls = {
				manage: React.createElement(ManageView, shared),
				grants: React.createElement(GrantsView, shared),
				console: React.createElement(ConsoleView, shared),
				transfer: React.createElement(TransferView, Object.assign({}, shared, { visible })),
			};
			return React.createElement(
				"div",
				{ className: "dbt-panel" },
				React.createElement(
					"div",
					{ className: "dbt-tabs", role: "tablist" },
					[["manage", t("viewManage")], ["grants", t("viewGrants")], ["browse", t("viewBrowse")], ["console", t("viewConsole")], ["transfer", t("viewTransfer")]].map(([v, label]) =>
						React.createElement("button", {
							key: v, className: view === v ? "active" : "",
							role: "tab", "aria-selected": view === v,
							onClick: () => setView(v),
						}, label)),
				),
				(projectEdited || !projectPath)
					? React.createElement(
						"div",
						{ className: "dbt-row" },
						// 填充式输入：裸 input 命中样式层 .dbt-row input 契约（去掉旧 dbt-card + 内联 padding hack）
						React.createElement("input", {
							placeholder: t("projectPathPlaceholder"), value: projectPath,
							onChange: (e) => setProjectPath(e.target.value),
							// 失焦时：输入与权威解析一致才收回自动跟随；用户填了自己的路径则保持手填态（不被权威值打回）
							onBlur: (e) => {
								const v = (e.target.value || "").trim();
								if (!v || v === resolvedRef.current) setProjectEdited(false);
							},
						}),
					)
					: React.createElement("div", { className: "dbt-row" },
						React.createElement("span", { className: "dbt-muted" }, t("projectLabel", { path: projectPath })),
						// 编辑图标：极简铅笔 SVG（验收要求无 emoji；svg aria-hidden，按钮 aria-label 提供语义）
						React.createElement("button", {
								className: "dbt-btn", onClick: () => setProjectEdited(true), "aria-label": t("edit"),
							},
								React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true" },
									React.createElement("path", {
										d: "M8.6 1.4 L10.6 3.4 L4.2 9.8 L1.6 10.4 L2.2 7.8 Z",
										stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round",
									})),
							),
							// 刷新：重拉所有已展开的库/模式/表（agents 等外部建库后点一下即可见）
							React.createElement("button", {
								className: "dbt-btn", onClick: () => setTreeRefresh((x) => x + 1), "aria-label": t("trRefresh"), title: t("trRefresh"),
							},
								React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true" },
									React.createElement("path", {
										d: "M10.5 6a4.5 4.5 0 1 1-1.32-3.18M10.5 1v2.5H8",
										stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round",
									})),
							)),
				error ? React.createElement("div", { className: "dbt-err", "aria-live": "polite" }, t("error") + ": " + error) : null,
				message ? React.createElement("div", { className: "dbt-msg", "aria-live": "polite" }, message) : null,
				// 视图常驻挂载 + hidden 切换：切 tab 保留各视图内部状态（控制台 SQL、浏览选中不丢）；
				// dbt-in 入场动画只在面板首次打开播一次（.dbt-view 类自带，常驻后不随 tab 重播）；
				// browse 撑满面板剩余高度（BrowsePane 内详情栏才能钉在面板最底部），active 控制首次激活才拉树。
				// .dbt-view 类的 display:flex 会盖过 hidden 的 UA 样式，故内联 display 同步切换
				["manage", "grants", "browse", "console", "transfer"].map((v) =>
					React.createElement("div", {
						key: v, className: "dbt-view", hidden: view !== v,
						style: v === "browse"
							? (view === "browse" ? { flex: "1 1 auto", minHeight: 0 } : { display: "none" })
							: (view === v ? undefined : { display: "none" }),
					},
						v === "browse"
							? React.createElement(BrowsePane, { ctx: props.ctx, conns, projectPath, grants, askConfirm, active: view === "browse", refreshTick: treeRefresh })
							: viewEls[v])),
				React.createElement("div", { className: "dbt-muted" }, t("footerHint")),
				confirmReq ? React.createElement(DangerDialog, { challenge: confirmReq, onClose: () => setConfirmReq(null) }) : null,
			);
		}

		function DbToolRoot(props) {
			const ctx = props.ctx;
			// DSH locale 切换时重渲染（better-sidebar 同款模式）
			const localeKey = React.useSyncExternalStore(
				React.useCallback(function (cb) {
					if (!ctx.locale || typeof ctx.locale.subscribe !== "function") return function () {};
					return ctx.locale.subscribe(cb);
				}, [ctx]),
				React.useCallback(function () {
					try {
						return ctx.locale && ctx.locale.getSnapshot ? ctx.locale.getSnapshot().active : activeLocale;
					} catch (e) { return activeLocale; }
				}, [ctx]),
				function () { return "zh"; },
			);
			return React.createElement(Panel, {
				key: "db-tool-" + String(localeKey || "zh"),
				visible: props.visible,
				scope: props.scope,
				ctx: ctx, // 宿主 ctx 下传，Panel 透传给 BrowsePane
			});
		}

		const inject = ["betterSidebar", "locale"];
		function apply(ctx) {
			ensureStyles();
			if (ctx.locale) {
				attachLocale(ctx.locale);
				ctx.effect(function () {
					const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
					const offEn = ctx.locale.register(LOCALE_NS, "en", en);
					return function () {
						try { offZh(); } catch (e) {}
						try { offEn(); } catch (e) {}
					};
				}, "dsh-db-tool: dictionaries");
			}
			if (!ctx.betterSidebar) return;
			ctx.effect(function () {
				return ctx.betterSidebar.registerTab({
					id: TAB_ID,
					title: function () { return t("tabTitle"); },
					icon,
					order: 45,
					single: true,
					component: function (p) {
						return React.createElement(DbToolRoot, {
							ctx: ctx,
							visible: p.visible,
							scope: p.scope,
						});
					},
				});
			}, "dsh-db-tool: register tab");
		}
		exports.apply = apply;
		exports.inject = inject;
		// 测试面：单元格写回 + 控制台工具纯函数 + ConsoleView（集成测试浅渲染元素树）+ Panel/TransferView/TransferLogView（传输日志降级结构断言）
		exports.__testables = {
			dialectOf, quoteIdent, parseCellText, isTruncatedCell, isBlobCell,
			buildUpdate, buildRedisOp, buildMongoOp, renderStatementWithParams,
			splitSqlStatements, fmtDialectOf, toCsv, toJson, fmtMs,
			sortRows, slicePage, ResultSetGrid,
			classifyHead, ConsoleView,
			Panel, TransferView, TransferLogView,
		};
		return module.exports;
	},
});
// Stryker restore all
