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
			footerHint: "管理在此侧栏；业务操作要求当前项目已获得对应连接的授权。",
			// 连接管理
			newConn: "新建连接",
			editConn: "编辑连接",
			noConns: "还没有连接，点击「新建连接」添加。",
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
			delete: "删除",
			deleteConnConfirm: "确定删除连接「{name}」？将级联删除其密钥与所有项目的授权。",
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
			// 授权
			grantsHint: "为当前项目授权连接。只读=仅查询/浏览，读写=允许执行语句与脚本。未授权的连接在业务操作中一律拒绝。",
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
			browsePanelHint: "数据浏览已在浮动窗口打开，可继续操作其他功能。",
			reopenBrowse: "打开数据浏览",
			selectTableHint: "在左侧选择表后查看数据",
			// 单元格查看/编辑（Navicat 式就地写回）
			editCell: "编辑",
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
			cellSaved: "已保存",
			// SQL 控制台
			modeQuery: "只读查询",
			modeExecute: "写入执行",
			modeScript: "脚本",
			run: "执行",
			running: "执行中…",
			sqlPlaceholder: "输入 SQL / 命令…（Redis: [\"GET\",\"key\"]；Mongo: {\"find\":\"users\",\"filter\":{}}）",
			scriptPlaceholder: "输入 JS 脚本（vm 沙箱，含 db 助手对象）…",
			paramsJson: "查询参数（JSON 数组，可选）",
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
			footerHint: "Manage here in the sidebar; business operations require a project grant on the connection.",
			newConn: "New Connection",
			editConn: "Edit Connection",
			noConns: "No connections yet. Click \"New Connection\" to add one.",
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
			delete: "Delete",
			deleteConnConfirm: "Delete connection \"{name}\"? Its secrets and all project grants will be removed.",
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
			grantsHint: "Grant connections to the current project. ro = read-only (query/browse), rw = read-write (execute/script allowed). Unauthorized connections are always rejected.",
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
			browsePanelHint: "Browse is open in a floating window; you can keep working here.",
			reopenBrowse: "Open Data Browser",
			selectTableHint: "Select a table on the left to view data",
			// Cell view/edit (Navicat-style in-place write-back)
			editCell: "Edit",
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
			cellSaved: "Saved",
			modeQuery: "query (read-only)",
			modeExecute: "execute (write)",
			modeScript: "script",
			run: "Run",
			running: "Running…",
			sqlPlaceholder: "SQL / command… (Redis: [\"GET\",\"key\"]; Mongo: {\"find\":\"users\",\"filter\":{}})",
			scriptPlaceholder: "JS script (vm sandbox, with db helper)…",
			paramsJson: "params (JSON array, optional)",
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
					const yes = await askConfirm({ statement: e.statement, danger: e.danger, reason: e.reason });
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
				"/* ===== Apple-style Design Tokens（dark 基线，light 经 media query 反转；.dbt-browse-root 并入以承载 portal 弹窗） ===== */",
				".dbt-panel,.dbt-browse-root{--dbt-accent:var(--dsh-accent,#0a84ff);--dbt-bg:transparent;--dbt-surface:rgba(120,120,128,.12);--dbt-surface-strong:rgba(120,120,128,.18);--dbt-separator:rgba(120,120,128,.24);--dbt-text:rgba(235,235,245,.92);--dbt-text-secondary:rgba(235,235,245,.6);--dbt-danger:#ff453a;--dbt-success:#30d158;--dbt-warning:#ffd60a;--dbt-dialog-bg:rgba(40,40,44,.85);--dbt-th-bg:rgba(30,30,32,.72);--dbt-seg-active:rgba(255,255,255,.14);--dbt-shadow:0 8px 32px rgba(0,0,0,.28);--dbt-radius-card:12px;--dbt-radius-ctrl:8px;--dbt-radius-pill:6px;--dbt-ease:cubic-bezier(.25,.1,.25,1);--dbt-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif;}",
				"@media (prefers-color-scheme: light){.dbt-panel,.dbt-browse-root{--dbt-accent:var(--dsh-accent,#007aff);--dbt-surface:rgba(120,120,128,.08);--dbt-surface-strong:rgba(120,120,128,.14);--dbt-separator:rgba(60,60,67,.18);--dbt-text:rgba(30,30,32,.92);--dbt-text-secondary:rgba(60,60,67,.6);--dbt-danger:#ff3b30;--dbt-success:#34c759;--dbt-warning:#ff9f0a;--dbt-dialog-bg:rgba(252,252,252,.9);--dbt-th-bg:rgba(255,255,255,.72);--dbt-seg-active:rgba(255,255,255,.9);--dbt-shadow:0 8px 32px rgba(0,0,0,.12);}}",
				// 弹窗根自持文字色：portal 挂 document.body 后不再依赖侧栏祖先的 color 继承（ocr medium）
				".dbt-browse-root{color:var(--dbt-text);}",
				"/* ===== 根容器 ===== */",
				".dbt-panel{font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:12px;padding:16px;height:100%;box-sizing:border-box;overflow-y:auto;}",
				"/* ===== iOS segmented control（顶部 tab） ===== */",
				".dbt-tabs{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;}",
				".dbt-tabs button{flex:1;border:none;background:transparent;color:inherit;border-radius:var(--dbt-radius-pill);padding:5px 8px;font-size:12px;font-weight:500;cursor:pointer;transition:all .18s var(--dbt-ease);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
				".dbt-tabs button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				"/* ===== inset grouped 卡片 ===== */",
				".dbt-card{background:var(--dbt-surface);border:none;border-radius:var(--dbt-radius-card);padding:12px;display:flex;flex-direction:column;gap:10px;}",
				".dbt-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
				"/* ===== 填充式无边框输入 ===== */",
				".dbt-row input,.dbt-row select,.dbt-card input,.dbt-card select,.dbt-card textarea,.dbt-group input,.dbt-group select{flex:1;min-width:60px;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:6px 10px;font-size:13px;font-family:inherit;transition:all .18s var(--dbt-ease);}",
				".dbt-row input:focus,.dbt-row select:focus,.dbt-card input:focus,.dbt-card select:focus,.dbt-card textarea:focus,.dbt-group input:focus,.dbt-group select:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
				".dbt-card textarea{font-family:var(--dbt-mono);min-height:96px;resize:vertical;}",
				"/* ===== 按钮 ===== */",
				".dbt-btn{border:none;background:var(--dbt-surface);color:inherit;border-radius:var(--dbt-radius-ctrl);padding:5px 12px;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all .18s var(--dbt-ease);}",
				".dbt-btn:hover{background:var(--dbt-surface-strong);}",
				".dbt-btn:active{transform:scale(.97);}",
				".dbt-btn.primary{background:var(--dbt-accent);color:#fff;}",
				".dbt-btn.primary:hover{filter:brightness(1.1);}",
				".dbt-btn.danger{color:var(--dbt-danger);background:transparent;border:1px solid var(--dbt-danger);}",
				".dbt-btn.danger:hover{background:rgba(255,69,58,.12);}",
				".dbt-btn:disabled{opacity:.4;cursor:default;transform:none;}",
				"/* ===== 文本反馈 ===== */",
				".dbt-muted{color:var(--dbt-text-secondary);font-size:11px;}",
				".dbt-err{color:var(--dbt-danger);font-size:12px;white-space:pre-wrap;}",
				".dbt-msg{color:var(--dbt-success);font-size:12px;white-space:pre-wrap;}",
				"/* ===== 行 hairline 表格 + 毛玻璃 sticky 表头 ===== */",
				".dbt-table{width:100%;border-collapse:collapse;font-size:12px;}",
				".dbt-table th,.dbt-table td{border:none;border-bottom:1px solid var(--dbt-separator);padding:6px 8px;text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".dbt-table th{position:sticky;top:0;z-index:1;background:var(--dbt-th-bg);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);font-weight:600;font-size:11px;}",
				".dbt-table td{font-family:var(--dbt-mono);}",
				".dbt-tablewrap{border:none;border-radius:var(--dbt-radius-card);overflow:auto;max-height:320px;background:var(--dbt-surface);}",
				"/* ===== 浏览弹窗表格：列分明（列间 hairline + 表头加深一档 + 行 hover） ===== */",
				".dbt-browse-root .dbt-table th + th,.dbt-browse-root .dbt-table td + td{border-left:1px solid var(--dbt-separator);}",
				".dbt-browse-root .dbt-table th{background:rgba(30,30,32,.85);font-size:12px;}",
				".dbt-browse-root .dbt-table td{font-size:13px;padding:7px 10px;}",
				".dbt-browse-root .dbt-table tbody tr:hover td{background:var(--dbt-surface-strong);}",
				"@media (prefers-color-scheme: light){.dbt-browse-root .dbt-table th{background:rgba(242,242,247,.9);}}",
				"/* ===== 对话框（macOS alert 材质） ===== */",
				".dbt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;}",
				".dbt-dialog{background:var(--dbt-dialog-bg);color:inherit;border:1px solid var(--dbt-separator);border-radius:14px;padding:16px;max-width:460px;width:90%;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;font-size:13px;-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:var(--dbt-shadow);}",
				".dbt-dialog pre{background:var(--dbt-surface-strong);border-radius:var(--dbt-radius-pill);padding:8px;font-family:var(--dbt-mono);font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;}",
				".dbt-dialog .dbt-row{justify-content:flex-end;}",
				"/* ===== 授权/连接列表：inset grouped（一张卡多行 hairline） ===== */",
				".dbt-group{background:var(--dbt-surface);border-radius:var(--dbt-radius-card);overflow:hidden;display:flex;flex-direction:column;}",
				".dbt-listrow{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--dbt-separator);transition:background .18s var(--dbt-ease);}",
				".dbt-listrow:last-child{border-bottom:none;}",
				".dbt-listrow:hover{background:var(--dbt-surface-strong);}",
				".dbt-tree{display:flex;flex-direction:column;}",
				"/* ===== Navicat 式对象树（数据浏览） ===== */",
				".dbt-treerow{display:flex;gap:6px;align-items:center;padding:8px 14px;font-size:14px;cursor:pointer;user-select:none;border-bottom:1px solid var(--dbt-separator);transition:background .15s var(--dbt-ease);}",
				".dbt-treerow:last-child{border-bottom:none;}",
				".dbt-treerow:hover{background:var(--dbt-surface-strong);}",
				".dbt-treerow.active{color:var(--dbt-accent);font-weight:600;}",
				".dbt-chev{flex:none;width:12px;text-align:center;color:var(--dbt-muted);font-size:10px;line-height:1;transition:transform .18s var(--dbt-ease);}",
				".dbt-chev.open{transform:rotate(90deg);}",
				".dbt-chev.leaf{visibility:hidden;}",
				".dbt-treename{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				/* ===== Navicat 式浏览弹窗 ===== */
				".dbt-browse-dialog{position:fixed;z-index:2147483000;width:min(1100px,calc(100vw - 48px));height:min(720px,calc(100vh - 48px));min-width:min(680px,calc(100vw - 16px));min-height:min(420px,calc(100vh - 16px));background:var(--dbt-dialog-bg);color:inherit;border:1px solid var(--dbt-separator);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.32),0 4px 16px rgba(0,0,0,.18);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;font-size:14px;animation:dbt-in .22s var(--dbt-ease);}",
				".dbt-browse-dialog.dragging{user-select:none;}",
				".dbt-browse-header{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dbt-separator);}",
				".dbt-browse-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:17px;}",
				".dbt-browse-close{flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--dbt-text-secondary);border-radius:var(--dbt-radius-pill);cursor:pointer;transition:all .18s var(--dbt-ease);}",
				".dbt-browse-close:hover{background:var(--dbt-surface-strong);color:inherit;}",
				".dbt-browse-close:active{transform:scale(.92);}",
				".dbt-browse-body{flex:1;min-height:0;display:flex;}",
				".dbt-browse-tree{flex:none;width:260px;overflow-y:auto;border-right:1px solid var(--dbt-separator);}",
				".dbt-browse-main{flex:1;min-width:0;display:flex;flex-direction:column;}",
				".dbt-browse-tabs{flex:none;padding:10px 14px 0;}",
				".dbt-browse-content{flex:1;min-height:0;position:relative;display:flex;flex-direction:column;gap:10px;padding:12px 14px;overflow:hidden;}",
				".dbt-browse-tablewrap{flex:1;min-height:0;overflow:auto;border:none;border-radius:var(--dbt-radius-card);background:var(--dbt-surface);}",
				".dbt-browse-footer{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--dbt-separator);}",
				".dbt-browse-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dbt-text-secondary);font-size:13px;}",
				".dbt-browse-errorbox{flex:1;display:flex;flex-direction:column;gap:10px;align-items:flex-start;justify-content:center;}",
				".dbt-browse-skel{display:flex;flex-direction:column;gap:8px;}",
				".dbt-browse-skelrow{display:flex;gap:8px;}",
				".dbt-browse-skelcell{flex:1;height:24px;background:var(--dbt-surface-strong);border-radius:var(--dbt-radius-pill);}",
				"/* ===== 浏览弹窗：单元格查看/编辑浮层（定位锚点为 .dbt-browse-content） ===== */",
				".dbt-cellbtn{border:none;background:transparent;color:inherit;font:inherit;padding:0;margin:0;cursor:pointer;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;width:100%;text-align:left;}",
				".dbt-cellbtn:focus-visible{outline:2px solid var(--dbt-accent);outline-offset:-1px;border-radius:2px;}",
				".dbt-cellpop{position:absolute;z-index:20;width:min(460px,100%);background:var(--dbt-dialog-bg);border:1px solid var(--dbt-separator);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);padding:12px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;font-size:13px;}",
				".dbt-cellpop-value{font-family:var(--dbt-mono);font-size:13px;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto;background:var(--dbt-surface-strong);border-radius:8px;padding:8px;}",
				".dbt-cellpop-actions{display:flex;gap:8px;align-items:center;}",
				".dbt-celledit{display:flex;flex-direction:column;gap:8px;}",
				".dbt-celledit textarea{font-family:var(--dbt-mono);font-size:13px;min-height:96px;resize:vertical;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:8px;padding:8px;}",
				".dbt-celledit textarea:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
				".dbt-nullchip{display:inline-flex;align-items:center;border:1px solid var(--dbt-warning);color:var(--dbt-warning);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;}",
				".dbt-readhint{color:var(--dbt-text-secondary);font-size:11px;}",
				"/* ===== 视图切换入场（仅 transform/opacity；reduced-motion 全局已禁） ===== */",
				"@keyframes dbt-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}",
				".dbt-view{display:flex;flex-direction:column;gap:10px;animation:dbt-in .22s var(--dbt-ease);}",
				"/* ===== mini segmented（ro/rw 等切换） ===== */",
				".dbt-seg{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;}",
				".dbt-seg button{flex:none;border:none;background:transparent;color:inherit;font-size:11px;padding:3px 10px;border-radius:var(--dbt-radius-pill);cursor:pointer;transition:all .18s var(--dbt-ease);}",
				".dbt-seg button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				".dbt-browse-root .dbt-seg button{font-size:12px;padding:4px 12px;}",
				"/* ===== 降级：透明度减弱 / 动效减弱 ===== */",
				"@media (prefers-reduced-transparency: reduce){.dbt-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(0,0,0,.55);}.dbt-dialog,.dbt-browse-dialog,.dbt-cellpop{backdrop-filter:none;-webkit-backdrop-filter:none;}.dbt-dialog,.dbt-browse-dialog{background:#2c2c2e;}.dbt-cellpop{background:#2c2c2e;}.dbt-table th{backdrop-filter:none;-webkit-backdrop-filter:none;background:#1e1e20;}.dbt-browse-root .dbt-table th{background:#1e1e20;}}",
				"@media (prefers-color-scheme: light) and (prefers-reduced-transparency: reduce){.dbt-dialog,.dbt-browse-dialog,.dbt-cellpop{background:#f5f5f7;}.dbt-table th,.dbt-browse-root .dbt-table th{background:#f2f2f7;}}",
				"@media (prefers-reduced-motion: reduce){.dbt-panel *,.dbt-browse-root *{transition:none!important;animation:none!important;}.dbt-btn:active{transform:none;}}",
			].join("\n");
			document.head.appendChild(styleEl);
		}

		function DangerDialog(props) {
			const ch = props.challenge; // {statement, danger, reason, resolve}
			function done(v) { props.onClose(); ch.resolve(v); }
			return React.createElement(
				"div",
				{ className: "dbt-overlay", onClick: () => done(false) },
				React.createElement(
					"div",
					{ className: "dbt-dialog", onClick: (e) => e.stopPropagation() },
					// macOS alert 风格：纯文字标题 + danger 色，不用 emoji
					React.createElement("strong", { style: { color: "var(--dbt-danger, #ff453a)" } }, t("needConfirmTitle")),
					React.createElement("pre", null, ch.statement || "(?)"),
					React.createElement(
						"div",
						{ className: "dbt-muted" },
						t("dangerLevel") + ": " + (ch.danger || "danger") + " · " + t("reason") + ": " + (ch.reason || "-"),
					),
					React.createElement("div", { className: "dbt-muted" }, t("confirmHint")),
					React.createElement(
						"div",
						{ className: "dbt-row", style: { justifyContent: "flex-end" } },
						React.createElement("button", { className: "dbt-btn danger", onClick: () => done(true) }, t("confirmRun")),
						React.createElement("button", { className: "dbt-btn", onClick: () => done(false) }, t("confirmCancel")),
					),
				),
			);
		}

		// --- 弹窗挂载：优先 createPortal 挂 document.body（避免侧栏容器裁剪）；宿主未提供 react-dom 时回退 Panel 内 fixed overlay（DangerDialog 同模式） ---
		// 三重降级解析（模块级缓存，全模块一次）：①模块加载时同步 require（dsh.client.inject 声明 react-dom 后应成功）
		// ②宿主模块系统异步 import（ctx.modules，宿主 rc.8+ 提供）③均不可用则保持 Panel 内回退渲染。
		let portalImpl = null;      // 解析成功的 createPortal（缓存，全模块一次）
		let portalTried = false;    // 是否已尝试解析（异步 import 只发起一次）
		let portalPending = null;   // 订阅解析成功的回调列表
		try {
			var rd = require("react-dom");
			if (rd && typeof rd.createPortal === "function") { portalImpl = rd.createPortal.bind(rd); portalTried = true; }
		} catch (e) { /* 留 null，等异步解析 */ }
		function resolvePortalAsync(ctx) {
			if (portalTried) return;
			portalTried = true;
			if (portalImpl) return;
			var mods = ctx && ctx.modules;
			var p = mods && typeof mods.import === "function" ? mods.import("react-dom") : null;
			if (p && typeof p.then === "function") {
				p.then(function (m) {
					if (m && typeof m.createPortal === "function") {
						portalImpl = m.createPortal.bind(m);
						var waiters = portalPending || []; portalPending = null;
						for (var i = 0; i < waiters.length; i++) waiters[i]();
					}
				}).catch(function () { /* 解析失败保持回退渲染 */ });
			}
		}
		function onPortalReady(cb) {
			if (portalImpl) { cb(); return; }
			(portalPending = portalPending || []).push(cb);
		}
		function mountDialog(children) {
			return (portalImpl && !portalDisabled) ? portalImpl(children, document.body) : children;
		}
		// PiP 独立窗口渲染时禁 portal：PiP root 本身就挂在 pipDoc.body 上，再 portal 回主 document 会把 DOM 拉出独立窗口
		let portalDisabled = false;
		// createRoot 多级探测（PiP 独立窗口需要独立 React root）：react-dom → react-dom/client
		let reactCreateRoot = null;
		try {
			var rd2 = require("react-dom");
			reactCreateRoot = rd2 && typeof rd2.createRoot === "function" ? rd2.createRoot.bind(rd2) : null;
			if (!reactCreateRoot) {
				try { var rdc = require("react-dom/client"); reactCreateRoot = rdc && typeof rdc.createRoot === "function" ? rdc.createRoot.bind(rdc) : null; } catch (e2) { /* 保持 null */ }
			}
		} catch (e) { /* 保持 null，PiP 不可用走 DOM 浮窗降级 */ }

		/* ---------------- 连接管理 ---------------- */
		const EMPTY_FORM = { id: "", kind: "mysql", name: "", mode: "url", url: "", urlUser: "", urlPassword: "", host: "", port: "", user: "", password: "", database: "", ssl: false };

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
					database: kind === "sqlite" ? undefined : dbRef,
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
	function ConnForm(props) {
			// 新建（无 initial）默认分字段模式并预填官方默认值；编辑保持用户数据原样
			const [form, setForm] = React.useState(() => props.initial || freshForm());
			const [dirty, setDirty] = React.useState(() => new Set()); // 用户手改过的字段（切 kind 时保留）
			const [draftTest, setDraftTest] = React.useState(null); // null | {ok, msg}
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
			return React.createElement(
				"div",
				{ className: "dbt-card" },
				React.createElement("strong", null, props.initial ? t("editConn") : t("newConn")),
				// 分组 1：基本属性（kind / name / id / ssl）
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("select", { value: form.kind, onChange: (e) => switchKind(e.target.value) },
						DB_KINDS.map((k) => React.createElement("option", { key: k, value: k }, k))),
					React.createElement("input", { placeholder: t("connName"), value: form.name, onChange: (e) => patch({ name: e.target.value }) }),
					React.createElement("input", { placeholder: t("connId") + "（" + t("idAutoHint") + "）", value: form.id, disabled: !!props.initial, onChange: (e) => patch({ id: e.target.value }) }),
					React.createElement("label", { className: "dbt-row", style: { flex: "none" } },
						React.createElement("input", { type: "checkbox", checked: !!form.ssl, onChange: (e) => patch({ ssl: e.target.checked }) }), t("ssl")),
				),
				// 分组 2：连接目标 —— 模式切换用 .dbt-seg mini segmented
				React.createElement(
					"div",
					{ className: "dbt-seg" },
					React.createElement("button", { className: form.mode === "url" ? "active" : "", onClick: () => patch({ mode: "url" }) }, t("urlMode")),
					React.createElement("button", { className: form.mode === "fields" ? "active" : "", onClick: reenterFields }, t("fieldsMode")),
				),
				form.mode === "url"
					? React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 6 } },
						React.createElement("input", { placeholder: t("url"), value: form.url, onChange: (e) => patch({ url: e.target.value }) }),
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("urlUser"), value: form.urlUser, onChange: (e) => patch({ urlUser: e.target.value }) }),
							React.createElement("input", { type: "password", placeholder: t("urlPassword"), value: form.urlPassword, onChange: (e) => patch({ urlPassword: e.target.value }) })),
					)
					: React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 6 } },
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("fieldsHost"), value: form.host, onChange: (e) => patch({ host: e.target.value }) }),
							React.createElement("input", { placeholder: t("fieldsPort"), value: form.port, onChange: (e) => patch({ port: e.target.value }) }),
							React.createElement("input", { placeholder: t("fieldsDatabase"), value: form.database, onChange: (e) => patch({ database: e.target.value }) })),
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("fieldsUser"), value: form.user, onChange: (e) => patch({ user: e.target.value }) }),
							React.createElement("input", { type: "password", placeholder: props.initial && props.initial.hasPassword ? t("passwordSaved") : t("fieldsPassword"), value: form.password, onChange: (e) => patch({ password: e.target.value }) })),
					),
				// 分组 3：操作
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn primary", disabled: props.busy, onClick: submit }, props.busy ? t("saving") : t("save")),
					React.createElement("button", { className: "dbt-btn", disabled: draftTest && draftTest.ok === null, onClick: testDraft },
						draftTest && draftTest.ok === null ? t("testing") : t("test")),
					React.createElement("button", { className: "dbt-btn", onClick: props.onCancel }, t("cancel")),
					draftTest && draftTest.ok !== null
						? React.createElement("span", { style: { color: draftTest.ok ? "var(--dbt-success, #30d158)" : "var(--dbt-danger, #ff453a)", fontSize: 12, alignSelf: "center" } }, draftTest.msg)
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
				if (!window.confirm(t("deleteConnConfirm", { name: c.name || c.id }))) return;
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
				// 顶部操作行：审计在左，「新建连接」主按钮置右侧
				React.createElement(
					"div",
					{ className: "dbt-row", style: { justifyContent: "space-between" } },
					React.createElement("button", { className: "dbt-btn", onClick: loadAudit }, t("auditTitle", { n: 50 }).split("（")[0].split(" (")[0]),
					React.createElement("button", { className: "dbt-btn primary", onClick: () => setEditing("new") }, t("newConn")),
				),
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) :
					// iOS inset grouped：一张卡装全部连接，行间 hairline 分隔
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
										React.createElement("span", { style: { background: "var(--dbt-surface-strong, rgba(120,120,128,.18))", borderRadius: "6px", padding: "2px 6px", fontFamily: MONO_FONT, fontSize: "11px", lineHeight: 1.45 } }, c.kind),
										React.createElement("strong", { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name || c.id),
									),
									(c.safeUrl || c.host) ? React.createElement(
										"div",
										{ className: "dbt-muted", style: { fontFamily: MONO_FONT, fontSize: 11, wordBreak: "break-all" } },
										c.safeUrl || (c.host + ":" + (c.port || "")),
									) : null,
									testInfo[c.id] ? React.createElement("div", { style: { fontSize: 12, color: testInfo[c.id].startsWith("✓") ? "var(--dbt-success, #30d158)" : "var(--dbt-danger, #ff453a)" } }, testInfo[c.id]) : null,
								),
								// 右列：动作按钮（次要语义，danger 仅删除）
								React.createElement(
									"div",
									{ className: "dbt-row", style: { flex: "none" } },
									React.createElement("button", { className: "dbt-btn", disabled: busy === "test", onClick: () => testConn(c.id) }, t("test")),
									React.createElement("button", { className: "dbt-btn", onClick: () => setEditing(c) }, t("edit")),
									React.createElement("button", { className: "dbt-btn danger", disabled: busy === "del", onClick: () => delConn(c) }, t("delete")),
								),
							),
						),
					),
				auditOpen
					? React.createElement(
						"div",
						{ className: "dbt-card" },
						React.createElement("strong", null, t("auditTitle", { n: 50 })),
						!props.projectPath ? React.createElement("div", { className: "dbt-muted" }, t("projectUnbound")) :
							!audit || audit.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("auditEmpty")) :
								auditTable(audit),
					)
					: null,
			);
		}

		/* ---------------- 项目授权 ---------------- */
		function GrantsView(props) {
			const { conns, grants, projectPath } = props;
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
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
				React.createElement("div", { className: "dbt-muted" }, t("grantsHint")),
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) :
					// iOS inset grouped：授权行装一张卡，行间 hairline（授权链路：seg 点击 → PUT/DELETE /grants）
					React.createElement(
						"div",
						{ className: "dbt-group" },
						conns.map((c) => {
							const m = modeOf(c.id);
							return React.createElement(
								"div",
								{ className: "dbt-listrow", key: c.id },
								// 列表行式：名称 13px semibold 主行 + kind muted 副行，右侧 mini segmented
								React.createElement(
									"div",
									{ style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } },
									React.createElement("span", { style: { fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.name || c.id),
									React.createElement("span", { className: "dbt-muted" }, c.kind),
								),
								React.createElement(
									"div",
									{ className: "dbt-seg", "aria-label": c.name || c.id },
									["", "ro", "rw"].map((mode) =>
										React.createElement("button", {
											key: mode || "none",
											className: mode === m ? "active" : "",
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
		// Navicat 式对象树：连接 ▸ 库/[schema] ▸ 表，懒加载展开（弹窗唯一实例，展开状态随弹窗生命周期）
		function BrowseTree(props) {
			const { conns, projectPath, sel, onSelect, autoExpand } = props;
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
				toggle("c:" + c.id, () =>
					api("databases" + qs({ project: projectPath, connId: c.id })).then((list) => {
						setDbs((m) => Object.assign({}, m, { [c.id]: list || [] }));
					}));
			}
			// autoExpand：挂载后自动展开第一层级（连接节点），复用 toggleConn 的展开+懒加载；
			// 加载失败仍走既有就地错误行机制。声明在清缓存 effect 之后：项目切换时先清 open 再重新展开
			React.useEffect(() => {
				if (!autoExpand) return;
				for (const c of conns) {
					if (!open["c:" + c.id]) toggleConn(c);
				}
			}, [conns, projectPath]); // eslint-disable-line
			// PG/GaussDB 官方层级为 数据库 → 模式(schema) → 表：库节点下先列 schema 再列表
			const HAS_SCHEMAS = { postgresql: true, gaussdb: true };
			function toggleDb(c, d) {
				if (!projectPath) return;
				const useSchemas = !!HAS_SCHEMAS[c.kind];
				const what = useSchemas ? "schemas" : "tables";
				toggle("d:" + c.id + "/" + d, () =>
					api(what + qs({ project: projectPath, connId: c.id, database: d })).then((list) => {
						const setter = useSchemas ? setSchemasMap : setTablesMap;
						setter((m) => Object.assign({}, m, { [c.id + "/" + d]: list || [] }));
					}));
			}
			function toggleSchema(c, d, s) {
				if (!projectPath) return;
				// PG 系跨库浏览：tables 的 database 传 "库名.schema"（Navicat 官方行为，服务端按库开连接）
				toggle("s:" + c.id + "/" + d + "/" + s, () =>
					api("tables" + qs({ project: projectPath, connId: c.id, database: d + "." + s })).then((list) => {
						setTablesMap((m) => Object.assign({}, m, { [c.id + "/" + d + "/" + s]: list || [] }));
					}));
			}
			// 树行：chevron（▸ 展开旋转 90°）+ 名称 + 可选右侧标注
			// ponytail: 交互行全量 tabIndex=0 使 Tab 循环较长，升级路径为 APG roving tabindex + 方向键导航
			function treerow(key, level, isOpen, leaf, label, onClick, active, extra) {
				return React.createElement(
					"div",
					{
						className: "dbt-treerow" + (active ? " active" : ""), key,
						role: onClick ? "treeitem" : undefined,
						tabIndex: onClick ? 0 : undefined,
						onClick: onClick || undefined,
						onKeyDown: onClick ? (e) => {
							if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick({ currentTarget: e.currentTarget }); }
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

			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
				// Navicat 式对象树：点击展开连接/库，点击表上报选中（由父组件决定打开弹窗）
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) :
					React.createElement("div", { className: "dbt-group" },
						React.createElement("div", { className: "dbt-tree" }, treeRows)),
			);
		}

		// Navicat 式浏览弹窗：左树选库-表，右看字段+数据（非模态可拖动浮动窗，由 Panel 层持有跨 tab 常驻）

		/* ---------------- PreviewGrid：数据预览网格（Navicat 式单元格查看/编辑） ---------------- */
		// props 契约：{ preview:{columns,rows,rowCount,truncated?}, schema:ColumnInfo[]（SQL/mongo；redis 为
		// type/encoding/ttl/length，无 PRI）, kind, editable:rw 授权布尔, tableType:sel.table.type（redis 键类型）,
		// tableName, dbRef, schemaName, connId, projectPath, onSaved:保存成功回调, askConfirm:runGuarded 确认回调 }
		// redis 各键类型可就地编辑的数据列（与 buildRedisOp 分支保持一致；键名/字段名等定位列只读）
		const REDIS_EDITABLE_COLS = {
			string: ["value"],
			hash: ["value"],
			zset: ["score", "member"],
			set: ["member"],
		};
		function PreviewGrid(props) {
			const { preview, schema, kind, editable, tableType, tableName, dbRef, schemaName, connId, projectPath, onSaved, askConfirm } = props;
			const [pop, setPop] = React.useState(null); // {rowIdx, colName, cell} 单元格浮层
			const [editing, setEditing] = React.useState(false);
			const [text, setText] = React.useState(""); // 编辑态 textarea 值（进入浮层时就位）
			const [editNull, setEditNull] = React.useState(false); // 「设为 NULL」勾选（null 单元格默认勾选）
			const [cellErr, setCellErr] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [copied, setCopied] = React.useState(false);
			const isMongo = kind === "mongodb";
			// SQL 系主键列名（schema 中 key==="PRI"）；mongo 由 _id 单列承担，redis 无主键概念
			const pkCols = (!isMongo && kind !== "redis" && Array.isArray(schema))
				? schema.filter((c) => c && c.key === "PRI").map((c) => c.name)
				: [];

			// 打开浮层（查看态）：编辑态初值一并就位——textarea 空 ↔ 勾选设为 NULL
			function openCell(rowIdx, colName, cell) {
				setPop({ rowIdx, colName, cell });
				setEditing(false);
				setCellErr("");
				setEditNull(cell === null);
				setText(cell === null ? "" : String(cell));
			}
			function copyCell() {
				if (!pop) return;
				navigator.clipboard.writeText(String(pop.cell)).then(() => {
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				}, () => { /* 剪贴板不可用（无权限等）：静默，按钮文案不变 */ });
			}

			// 单元格编辑资格：返回 null=可编辑，否则为原因 i18n key（浮层 .dbt-readhint 展示）
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

			// 保存：构造写回命令（按 kind 分派）→ 顺序执行（redis 两步）→ 全部成功关浮层并回调 onSaved
			async function saveCell() {
				if (!pop) return;
				setCellErr("");
				const { rowIdx, colName } = pop;
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
						await runGuarded(
							(challengeId) => api("execute", { method: "POST", body: { projectPath, connId, statement: op.statement, params: op.params, database: op.database, challengeId } }),
							askConfirm,
						);
					}
					setPop(null);
					if (onSaved) onSaved();
				} catch (e) {
					// 取消确认（e.cancelled）不算失败：浮层保持打开供重试
					if (!e.cancelled) setCellErr(t("error") + ": " + String(e && e.message ? e.message : e));
				} finally {
					setBusy(false);
				}
			}

			const popReason = pop ? cellReason(pop.colName, pop.cell === null ? "NULL" : String(pop.cell)) : null;
			return React.createElement(
				"div",
				{ className: "dbt-browse-root", style: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 } },
				// 顶层只读提示：授权为 ro 时整格只读，单元格仍可点击查看完整值
				!editable ? React.createElement("div", { className: "dbt-readhint" }, t("readOnlyRo")) : null,
				// relative 容器承载单元格浮层（简化定位：水平居中贴底）
				React.createElement(
					"div",
					{ style: { position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
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
									React.createElement("tr", { key: i },
										(preview.columns || []).map((colName, j) =>
											React.createElement("td", { key: j, title: row[j] === null ? "NULL" : String(row[j]) },
												React.createElement("button", {
													className: "dbt-cellbtn", type: "button",
													onClick: () => openCell(i, colName, row[j]),
												}, row[j] === null ? React.createElement("span", { className: "dbt-nullchip" }, "NULL") : String(row[j]))))),
							),
						),
					),
					pop ? React.createElement(
						"div",
						{ className: "dbt-cellpop", style: { position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 12 } },
						React.createElement("strong", null, t("cellValue") + " · " + pop.colName),
						React.createElement(
							"div",
							{ className: "dbt-cellpop-value" },
							pop.cell === null ? React.createElement("span", { className: "dbt-nullchip" }, "NULL") : String(pop.cell),
						),
						popReason ? React.createElement("div", { className: "dbt-readhint" }, t(popReason)) : null,
						cellErr ? React.createElement("div", { className: "dbt-err" }, cellErr) : null,
						editing
							? React.createElement(
								"div",
								{ className: "dbt-celledit" },
								React.createElement("textarea", { value: text, onChange: (e) => setText(e.target.value) }),
								React.createElement(
									"label",
									// 不用 .dbt-row：全局 input flex:1 会把 checkbox 拉伸占满、标签被推到远端（视觉审查命中）
									{ style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", width: "fit-content" } },
									React.createElement("input", { type: "checkbox", style: { flex: "none", minWidth: 0, width: "auto" }, checked: editNull, onChange: (e) => setEditNull(e.target.checked) }),
									t("setNull"),
								),
								React.createElement(
									"div",
									{ className: "dbt-row" },
									React.createElement("button", { className: "dbt-btn primary", disabled: busy, onClick: saveCell }, busy ? t("cellSaving") : t("save")),
									React.createElement("button", { className: "dbt-btn", disabled: busy, onClick: () => setEditing(false) }, t("cancel")),
								),
							)
							: React.createElement(
								"div",
								{ className: "dbt-cellpop-actions" },
								React.createElement("button", { className: "dbt-btn", onClick: copyCell }, copied ? t("copied") : t("copyBtn")),
								popReason === null ? React.createElement("button", { className: "dbt-btn primary", onClick: () => setEditing(true) }, t("editCell")) : null,
								React.createElement("button", { className: "dbt-btn", onClick: () => setPop(null) }, t("close")),
							),
						) : null,
					),
				),
			);
		}

		function BrowseDialog(props) {
			const { conns, projectPath, grants, askConfirm, onClose, ctx } = props;
			// grants / askConfirm：预留给后续单元格编辑的危险操作确认通道，本任务先接住不使用
			// portal 异步解析接入：portalReady 仅用于触发重渲染（mountDialog 内部读 portalImpl）。
			// createPortal 不换组件实例——portalReady 切换前后是同一 DOM 节点，pos state 保持，居中定位不受 portal 重挂影响。
			const [portalReady, setPortalReady] = React.useState(!!portalImpl);
			React.useEffect(() => {
				resolvePortalAsync(ctx);
				onPortalReady(function () { setPortalReady(true); });
				// 诊断：一次性输出（帮助真机排查 iframe 隔离与 portal 解析结果）
				if (!window.__dbtPortalDiag) {
					window.__dbtPortalDiag = true;
					console.info("[dbt] portal:", portalImpl ? "sync/async ok" : "unavailable", "sameDoc:", window.top === window.self);
				}
			}, []);
			const [sel, setSel] = React.useState(null); // 弹窗内当前选中（null=未选表，右栏显示引导空态）
			const [view, setView] = React.useState("structure"); // structure | preview（纯视图切换，不影响数据加载）
			const [schema, setSchema] = React.useState([]);
			const [preview, setPreview] = React.useState(null); // QueryResult
			const [page, setPage] = React.useState(1);
			const [busy, setBusy] = React.useState("");
			const [loadErr, setLoadErr] = React.useState(""); // 右栏加载失败（就地显示 + 重试）
			const openSeq = React.useRef(0); // 请求序号守卫
			const closeRef = React.useRef(null);

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
					// 弹窗内错误就地显示（不走面板顶部错误区）
					.catch((e) => { if (seq === openSeq.current) setLoadErr(String(e && e.message ? e.message : e)); })
					.finally(() => { if (seq === openSeq.current) setBusy(""); });
			}, [projectPath]);
			React.useEffect(() => { if (sel) openTable(sel, 1); }, [sel]); // eslint-disable-line

			// 非模态浮窗：无焦点陷阱（焦点可自由离开，主页交互不受阻）；Esc 仅在焦点位于弹窗内时
			// 经容器 onKeyDown 触发（stopPropagation 防止宿主级快捷键同时响应）。初始焦点=关闭按钮
			React.useEffect(() => {
				if (closeRef.current) closeRef.current.focus();
			}, []);

			// 拖动定位：首帧给个保守值，mount 后按浮窗实测尺寸居中（坐标基准取浮窗所在 document 的视口——DOM 浮窗为主视口，PiP 独立窗口为 PiP 视口）
			const dialogRef2 = React.useRef(null);
			const [pos, setPos] = React.useState(() => ({ top: 72, left: 12 }));
			React.useEffect(() => {
				const el = dialogRef2.current;
				if (!el) return;
				const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
				const w = view.innerWidth || 1200, h = view.innerHeight || 800;
				setPos({
					top: Math.max(0, Math.round((h - el.offsetHeight) / 2)),
					left: Math.max(0, Math.round((w - el.offsetWidth) / 2)),
				});
			}, []);
			const draggingRef = React.useRef(null); // {dx, dy}
			const [dragging, setDragging] = React.useState(false);
			function stopDrag() { draggingRef.current = null; setDragging(false); }
			function onHeaderPointerDown(e) {
				// header 内可点元素（关闭按钮）不启动拖动，否则 setPointerCapture 会把 click 重定向到 header 使按钮失效
				if (e.target.closest && e.target.closest("button")) return;
				draggingRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
				e.currentTarget.setPointerCapture(e.pointerId);
				setDragging(true);
			}
			function onHeaderPointerMove(e) {
				if (!draggingRef.current) return;
				const view = (e.currentTarget.ownerDocument && e.currentTarget.ownerDocument.defaultView) || window;
				const h = view.innerHeight || 800, w = view.innerWidth || 1200;
				// clamp 全部用浮窗实测尺寸：整体保持在视口内（窄视口下常量估宽会把窗拖丢）
				const dlg = e.currentTarget.parentElement;
				const dlgH = (dlg && dlg.offsetHeight) || 720;
				const dlgW = (dlg && dlg.offsetWidth) || 1100;
				setPos({
					top: Math.min(Math.max(e.clientY - draggingRef.current.dy, 0), Math.max(0, h - dlgH)),
					left: Math.min(Math.max(e.clientX - draggingRef.current.dx, 0), Math.max(0, w - dlgW)),
				});
			}

			// 右栏互斥状态：未选中引导 / 加载骨架 / 错误重试 / 空态 / 表格
			function rightPane() {
				if (!sel && busy !== "open" && !loadErr) {
					// 未选表：显示引导空态（浏览窗口可直接打开，不强制先选表）
					return React.createElement("div", { className: "dbt-browse-empty" }, t("selectTableHint"));
				}
				if (busy === "open") {
					// 表形状骨架：6 行 6 列静态色块（不引入新动画，reduced-motion 天然安全）
					return React.createElement("div", { className: "dbt-browse-skel", role: "status", "aria-busy": "true" },
						[0, 1, 2, 3, 4, 5].map((r) => React.createElement("div", { className: "dbt-browse-skelrow", key: r },
							[0, 1, 2, 3, 4, 5].map((c) => React.createElement("div", { className: "dbt-browse-skelcell", key: c })))));
				}
				if (loadErr) {
					// 错误就地显示 + 重试（弹窗遮罩下面板顶部错误区不可见，不走 props.onError）
					return React.createElement("div", { className: "dbt-browse-errorbox" },
						React.createElement("div", { className: "dbt-err" }, t("error") + ": " + loadErr),
						React.createElement("button", { className: "dbt-btn", onClick: () => openTable(sel, 1) }, t("retry")));
				}
				if (view === "structure") {
					if (!schema.length) return React.createElement("div", { className: "dbt-browse-empty" }, t("emptyStructure"));
					return resultTable(
						[t("column"), t("dataType"), t("nullable"), t("keyCol"), t("defaultVal"), t("comment")],
						schema.map((col) => [col.name, col.dataType, col.nullable ? "YES" : "NO", col.key || "", col.default === null || col.default === undefined ? "" : String(col.default), col.comment || ""]),
						undefined, "dbt-browse-tablewrap");
				}
				if (!preview || !preview.rows || preview.rows.length === 0) {
					return React.createElement("div", { className: "dbt-browse-empty" }, t("emptyData"));
				}
				// Navicat 式单元格网格：kind/可编辑性由当前连接与授权决定（rw=可编辑），保存后重拉当前页
				const conn = conns.find((c) => c.id === sel.connId);
				const grant = (grants || []).find((g) => g.connId === sel.connId);
				return React.createElement(PreviewGrid, {
					preview, schema,
					kind: conn ? conn.kind : undefined,
					editable: !!grant && grant.mode === "rw",
					tableType: sel.table.type,
					tableName: sel.table.name,
					dbRef: sel.schemaName ? sel.db + "." + sel.schemaName : sel.db,
					schemaName: sel.schemaName || null,
					connId: sel.connId, projectPath,
					onSaved: () => openTable(sel, page),
					askConfirm,
				});
			}

			// 非模态浮窗：无遮罩、fixed 定位、可拖动；portal 到 body 不受侧栏视图切换影响
			return mountDialog(React.createElement(
				"div",
				{
					className: "dbt-browse-root dbt-browse-dialog" + (dragging ? " dragging" : ""),
					ref: dialogRef2,
					style: { position: "fixed", top: pos.top, left: pos.left },
					role: "dialog", "aria-labelledby": "dbt-browse-title",
					onKeyDown: (e) => {
						if (e.key === "Escape") { e.stopPropagation(); onClose(); }
					},
				},
				// ---- header：面包屑 + 关闭（整条 header 可拖动）----
				React.createElement(
					"div",
					{
						className: "dbt-browse-header",
						style: { cursor: dragging ? "grabbing" : "grab" },
						onPointerDown: onHeaderPointerDown,
						onPointerMove: onHeaderPointerMove,
						onPointerUp: stopDrag,
						onPointerCancel: stopDrag,
					},
					React.createElement("div", { className: "dbt-browse-title", id: "dbt-browse-title" },
						!sel ? t("viewBrowse") : t("browseDialogTitle", {
							conn: (conns.find((c) => c.id === sel.connId) || {}).name || sel.connId,
							db: sel.schemaName ? sel.db + "." + sel.schemaName : sel.db,
							table: sel.table.name,
						})),
						React.createElement(
							"button",
							{ className: "dbt-browse-close", ref: closeRef, "aria-label": t("close"), onClick: onClose },
							React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true" },
								React.createElement("path", { d: "M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" })),
						),
					),
					// ---- body：左树 + 右主区 ----
					React.createElement(
						"div",
						{ className: "dbt-browse-body" },
						React.createElement(
							"div",
							{ className: "dbt-browse-tree" },
							React.createElement(BrowseTree, {
								conns, projectPath, sel, autoExpand: true, // 本任务后弹窗树是唯一树实例，挂载即展开第一层级
								onSelect: (s) => setSel(s), // 弹窗内树切表
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
									{ className: "dbt-seg" },
									["structure", "preview"].map((v) =>
										React.createElement("button", { key: v, className: view === v ? "active" : "", onClick: () => setView(v) },
											v === "structure" ? t("structure") : t("preview"))),
								),
							),
							React.createElement("div", { className: "dbt-browse-content" }, rightPane()),
						),
					),
					// ---- footer：分页条（仅已选表的数据预览视图；空选中态不显示） ----
					sel && view === "preview" && !loadErr ? React.createElement(
						"div",
						{ className: "dbt-browse-footer" },
						React.createElement("button", { className: "dbt-btn", disabled: page <= 1 || busy === "open", onClick: () => openTable(sel, page - 1) }, "‹ " + t("prevPage")),
						React.createElement("span", { className: "dbt-muted" }, t("pageInfo", { page })),
						React.createElement("span", { style: { flex: 1 } }),
						preview && preview.truncated ? React.createElement("span", { className: "dbt-muted" }, t("previewTruncated")) : null,
						React.createElement("button", { className: "dbt-btn", disabled: (preview && preview.truncated) === false || busy === "open", onClick: () => openTable(sel, page + 1) }, t("nextPage") + " ›"),
					) : null,
				),
			);
		}

		/* ---------------- PiP 独立窗口（Document Picture-in-Picture） ---------------- */
		// OS 级独立窗口：可拖出桌面端主窗口、系统级置顶。内容为完整数据浏览 UI（同 JS 环境复用
		// BrowseDialog/DangerDialog 与 mock 之外的宿主 fetch 同源）；DOM 浮窗作为不可用时的降级。
		// 打开成功返回 pipWindow，失败返回 null（调用方降级为 DOM 浮窗）。
		function PipBrowseApp(props) { // {ctx, conns, projectPath, grants, onClose}
			// 危险操作确认渲染在 PiP 窗口内（Panel 的确认对话框在主窗口，PiP 用户看不见）
			const [confirmReq, setConfirmReq] = React.useState(null);
			const askConfirm = React.useCallback((info) => new Promise((resolve) => {
				setConfirmReq(Object.assign({}, info, { resolve }));
			}), []);
			return React.createElement(
				React.Fragment,
				null,
				React.createElement(BrowseDialog, {
					ctx: props.ctx, conns: props.conns, projectPath: props.projectPath,
					grants: props.grants, askConfirm: askConfirm, onClose: props.onClose,
				}),
				confirmReq ? React.createElement(DangerDialog, { challenge: confirmReq, onClose: () => setConfirmReq(null) }) : null,
			);
		}
		function openBrowsePip(ctx, deps) { // deps: {conns, projectPath, grants, onClosed} → 返回 pipWindow | null
			try {
				const dpip = window.documentPictureInPicture;
				if (!dpip || typeof dpip.requestWindow !== "function" || !reactCreateRoot || !portalImpl) return null;
				// PiP 只能在用户手势内同步发起 requestWindow，Promise then 里再做 DOM 装配
				return dpip.requestWindow({ width: 1100, height: 720 }).then((w) => {
					const doc = w.document;
					// 相对地址基准：PiP 文档是 about:blank，fetch 的相对 API 路径须按主 origin 解析
					const base = doc.createElement("base");
					base.href = window.location.origin + "/";
					doc.head.appendChild(base);
					// 样式：整套 --dbt-* token 与规则注入 PiP 文档
					if (styleEl) doc.head.appendChild(doc.importNode(styleEl, true));
					doc.body.style.margin = "0";
					portalDisabled = true; // PiP root 已在 pipDoc.body 上，禁 portal 防 DOM 被拉回主窗口
					const root = reactCreateRoot(doc.body);
					const closePip = () => {
						try { root.unmount(); } catch (e) { /* 已卸载 */ }
						portalDisabled = false;
						try { w.close(); } catch (e2) { /* 已关闭 */ }
					};
					root.render(React.createElement(PipBrowseApp, {
						ctx, conns: deps.conns, projectPath: deps.projectPath, grants: deps.grants,
						onClose: () => { closePip(); deps.onClosed(); },
					}));
					w.addEventListener("pagehide", () => { // 用户点 PiP 窗口系统关闭钮
						portalDisabled = false;
						try { root.unmount(); } catch (e) { /* 已卸载 */ }
						deps.onClosed();
					});
					return w;
				}).catch(() => null);
			} catch (e) {
				return Promise.resolve(null);
			}
		}

		/* ---------------- SQL 控制台 ---------------- */
		// Apple 等宽字体栈（规范 §1）：优先样式层 --dbt-mono token，fallback 内联栈
		const MONO_FONT = "var(--dbt-mono, ui-monospace, \"SF Mono\", Menlo, Consolas, monospace)";
		function ConsoleView(props) {
			const { conns, projectPath, askConfirm } = props;
			const [connId, setConnId] = React.useState("");
			const [mode, setMode] = React.useState("query"); // query | execute | script
			const [sql, setSql] = React.useState("");
			const [params, setParams] = React.useState("");
			const [result, setResult] = React.useState(null); // {kind:'query',...}|{kind:'exec',...}
			const [busy, setBusy] = React.useState(false);
			// Navicat 式跨库操控：当前库下拉（""=连接默认库），查询/执行路由到所选库
			const [dbList, setDbList] = React.useState([]);
			const [db, setDb] = React.useState("");
			React.useEffect(() => {
				setDbList([]); setDb("");
				if (!connId || !projectPath) return;
				api("databases" + qs({ project: projectPath, connId })).then((l) => setDbList(l || []), () => setDbList([]));
			}, [connId, projectPath]);

			async function run() {
				setBusy(true);
				setResult(null);
				try {
					if (mode === "script") {
						const data = await runGuarded(
							(challengeId) => api("script", { method: "POST", body: { projectPath, connId, code: sql, challengeId } }),
							askConfirm,
						);
						setResult({ kind: "exec", message: (data && data.message) || "", affectedRows: data && data.affectedRows });
					} else if (mode === "execute") {
						let parsedParams;
						if (params.trim()) { try { parsedParams = JSON.parse(params); } catch (e) { throw new Error(t("paramsJson") + ": " + e.message); } }
						const data = await runGuarded(
							(challengeId) => api("execute", { method: "POST", body: { projectPath, connId, statement: sql, params: parsedParams, database: db || undefined, challengeId } }),
							askConfirm,
						);
						setResult({ kind: "exec", message: (data && data.message) || "", affectedRows: data && data.affectedRows });
					} else {
						let parsedParams;
						if (params.trim()) { try { parsedParams = JSON.parse(params); } catch (e) { throw new Error(t("paramsJson") + ": " + e.message); } }
						const data = await runGuarded(
							(challengeId) => api("query", { method: "POST", body: { projectPath, connId, sql, params: parsedParams, database: db || undefined, challengeId } }),
							askConfirm,
						);
						setResult({ kind: "query", data });
					}
				} catch (e) {
					if (!e.cancelled) props.onError(e);
				} finally {
					setBusy(false);
				}
			}
			function renderResult() {
				if (!result) return null;
				if (result.kind === "exec") {
					return React.createElement("div", { className: "dbt-msg" },
						result.message + (result.affectedRows !== undefined ? " · " + t("execResult", { n: result.affectedRows }) : ""));
				}
				const r = result.data;
				return React.createElement(
					React.Fragment,
					null,
					React.createElement("span", { className: "dbt-muted" }, t("rowsResult", { n: r.rowCount }) + (r.truncated ? " · " + t("previewTruncated") : "")),
					// 公共 resultTable：新 table 契约（hairline 行/sticky 表头/等宽数据列）由样式层承担
					resultTable(r.columns || [], r.rows || []),
				);
			}
			return React.createElement(
				"div",
				{ className: "dbt-card" },
				// 选择器：inset grouped 每行一个控件（连接 / 模式）
				React.createElement(
					"div",
					{ className: "dbt-group" },
					React.createElement(
						"div",
						{ className: "dbt-listrow" },
						React.createElement("select", { value: connId, onChange: (e) => setConnId(e.target.value) },
							React.createElement("option", { value: "" }, t("viewManage") + "…"),
							conns.map((c) => React.createElement("option", { key: c.id, value: c.id }, (c.name || c.id) + " (" + c.kind + ")"))),
						// 当前库（Navicat 式跨库：选中非默认库后 SQL 在该库执行，pg/gaussdb 按库路由）
						dbList.length > 1 ? React.createElement("select", { value: db, onChange: (e) => setDb(e.target.value) },
							React.createElement("option", { value: "" }, t("defaultDb")),
							dbList.map((d) => React.createElement("option", { key: d, value: d }, d))) : null,
					),
					React.createElement(
						"div",
						{ className: "dbt-listrow" },
						React.createElement("select", { value: mode, onChange: (e) => setMode(e.target.value) },
							React.createElement("option", { value: "query" }, t("modeQuery")),
							React.createElement("option", { value: "execute" }, t("modeExecute")),
							React.createElement("option", { value: "script" }, t("modeScript"))),
					),
				),
				// SQL 输入：等宽字体 + 填充式输入（背景/focus ring 由样式层承担），min-height 加大
				React.createElement("textarea", {
					placeholder: mode === "script" ? t("scriptPlaceholder") : t("sqlPlaceholder"),
					value: sql, onChange: (e) => setSql(e.target.value),
					style: { fontFamily: MONO_FONT, minHeight: mode === "script" ? 160 : 96 },
				}),
				mode !== "script"
					? React.createElement("input", { placeholder: t("paramsJson"), value: params, onChange: (e) => setParams(e.target.value), style: { fontFamily: MONO_FONT } })
					: null,
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn primary", disabled: busy || !connId || !sql.trim(), onClick: run }, busy ? t("running") : t("run")),
				),
				renderResult(),
			);
		}

		/* ---------------- 根面板 ---------------- */
		function Panel(props) {
			const visible = props.visible;
			const scope = props.scope || {};
			const [view, setView] = React.useState("manage");
			const [projectPath, setProjectPath] = React.useState(scope.cwd || scope.workspacePath || "");
			const [projectEdited, setProjectEdited] = React.useState(!(scope.cwd || scope.workspacePath));
			const [conns, setConns] = React.useState([]);
			const [grants, setGrants] = React.useState([]);
			const [busy, setBusy] = React.useState("");
			const [error, setError] = React.useState("");
			const [message, setMessage] = React.useState("");
			const [confirmReq, setConfirmReq] = React.useState(null); // {statement,danger,reason,resolve}
			// 数据浏览浮窗开关：由 Panel 层持有（不随 view 切换卸载），跨 tab 常驻
			const [browseOpen, setBrowseOpen] = React.useState(false);
			// PiP 独立窗口句柄：优先于 DOM 浮窗（OS 级窗口，可拖出桌面端主窗口）；存在时 DOM 浮窗不渲染
			const [pipWin, setPipWin] = React.useState(null);
			function openBrowse() {
				if (pipWin) { try { pipWin.focus(); } catch (e) { /* 已关闭 */ } return; }
				// requestWindow 必须在用户手势内同步发起（本函数仅由 onClick 直调）
				const p = openBrowsePip(props.ctx, {
					conns, projectPath, grants,
					onClosed: () => setPipWin(null),
				});
				if (p && typeof p.then === "function") {
					p.then((w) => { if (w) setPipWin(w); else setBrowseOpen(true); });
				} else {
					setBrowseOpen(true);
				}
			}

			const askConfirm = React.useCallback((info) => new Promise((resolve) => {
				setConfirmReq(Object.assign({}, info, { resolve }));
			}), []);

			// 项目路径权威解析（对齐 dsh-ssh-tunnel getProjectContext）：
			// host 端以会话 header.cwd 为准归一化出 projectPathKey，前端不自拼 key。
			// scope.cwd/sessionId 变化（切换会话）时自动重新解析；用户手填（projectEdited）时不覆盖。
			const sessionKey = scope.sessionId || "";
			const scopeCwd = scope.cwd || scope.workspacePath || "";
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

			const shared = { conns, grants, projectPath, busy, run, reload, onError };
			return React.createElement(
				"div",
				{ className: "dbt-panel" },
				React.createElement(
					"div",
					{ className: "dbt-tabs" },
					[["manage", t("viewManage")], ["grants", t("viewGrants")], ["browse", t("viewBrowse")], ["console", t("viewConsole")]].map(([v, label]) =>
						// browse tab：切视图的同时直接打开浮窗（单击即用，不必再进树点表）
						React.createElement("button", {
							key: v, className: view === v ? "active" : "",
							onClick: () => { setView(v); if (v === "browse") openBrowse(); },
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
							className: "dbt-btn", onClick: () => setProjectEdited(true), "aria-label": "edit",
						},
							React.createElement("svg", { width: 12, height: 12, viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true" },
								React.createElement("path", {
									d: "M8.6 1.4 L10.6 3.4 L4.2 9.8 L1.6 10.4 L2.2 7.8 Z",
									stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round",
								})),
						)),
				error ? React.createElement("div", { className: "dbt-err" }, t("error") + ": " + error) : null,
				message ? React.createElement("div", { className: "dbt-msg" }, message) : null,
				// 视图切换：key=view 触发 dbt-in 进入动画（opacity + 4px 上移，.22s）
				React.createElement("div", { className: "dbt-view", key: view },
					view === "manage" ? React.createElement(ManageView, shared) : null,
					view === "grants" ? React.createElement(GrantsView, shared) : null,
					// browse：提示卡（浮窗由 Panel 层在下方常驻渲染，不随视图切换卸载）
					view === "browse" ? React.createElement(
						"div",
						{ className: "dbt-card" },
						// 主提示用正常文字色（dbt-muted 11px 次要色压深底对比不足，视觉审查命中）
						React.createElement("div", { style: { fontSize: 13 } }, t("browsePanelHint")),
						React.createElement("div", { className: "dbt-row" },
							React.createElement("button", { className: "dbt-btn primary", onClick: openBrowse }, t("reopenBrowse"))),
					) : null,
					view === "console" ? React.createElement(ConsoleView, Object.assign({}, shared, { askConfirm })) : null,
				),
				React.createElement("div", { className: "dbt-muted" }, t("footerHint")),
				confirmReq ? React.createElement(DangerDialog, { challenge: confirmReq, onClose: () => setConfirmReq(null) }) : null,
				// 浮窗常驻：portal 到 body 且在 dbt-view 外，切 tab 时不消失
				browseOpen ? React.createElement(BrowseDialog, {
					conns, projectPath, grants, askConfirm,
					ctx: props.ctx, // 宿主 ctx 透传给浮窗，供 portal 异步解析（ctx.modules.import）
					onClose: () => setBrowseOpen(false),
				}) : null,
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
				ctx: ctx, // 宿主 ctx 下传，Panel 透传给 BrowseDialog 供 portal 解析
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
					icon: function (size) { return icon(size); },
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
		// 测试面：单元格写回纯函数（单测直接断言命令构造，无需起 React/HTTP）
		exports.__testables = {
			dialectOf, quoteIdent, parseCellText, isTruncatedCell, isBlobCell,
			buildUpdate, buildRedisOp, buildMongoOp,
		};
		return module.exports;
	},
});
// Stryker restore all
