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
				"/* ===== Apple-style Design Tokens（dark 基线，light 经 media query 反转；.dbt-browse-root 并入以承载内嵌浏览面板与单元格浮层） ===== */",
				".dbt-panel,.dbt-browse-root{--dbt-accent:var(--dsh-accent,#0a84ff);--dbt-bg:transparent;--dbt-surface:rgba(120,120,128,.12);--dbt-surface-strong:rgba(120,120,128,.18);--dbt-separator:rgba(120,120,128,.24);--dbt-text:rgba(235,235,245,.92);--dbt-text-secondary:rgba(235,235,245,.6);--dbt-danger:#ff453a;--dbt-success:#30d158;--dbt-warning:#ffd60a;--dbt-dialog-bg:rgba(40,40,44,.85);--dbt-th-bg:rgba(30,30,32,.72);--dbt-seg-active:rgba(255,255,255,.14);--dbt-shadow:0 8px 32px rgba(0,0,0,.28);--dbt-radius-card:12px;--dbt-radius-ctrl:8px;--dbt-radius-pill:6px;--dbt-ease:cubic-bezier(.25,.1,.25,1);--dbt-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif;}",
				"@media (prefers-color-scheme: light){.dbt-panel,.dbt-browse-root{--dbt-accent:var(--dsh-accent,#007aff);--dbt-surface:rgba(120,120,128,.08);--dbt-surface-strong:rgba(120,120,128,.14);--dbt-separator:rgba(60,60,67,.18);--dbt-text:rgba(30,30,32,.92);--dbt-text-secondary:rgba(60,60,67,.6);--dbt-danger:#ff3b30;--dbt-success:#34c759;--dbt-warning:#ff9f0a;--dbt-dialog-bg:rgba(252,252,252,.9);--dbt-th-bg:rgba(255,255,255,.72);--dbt-seg-active:rgba(255,255,255,.9);--dbt-shadow:0 8px 32px rgba(0,0,0,.12);}}",
				// 浏览面板根自持文字色：PiP 独立文档挂 body 后无侧栏祖先 color 可继承（内嵌/浮窗两态共用）
				".dbt-browse-root{color:var(--dbt-text);}",
				"/* ===== 根容器 ===== */",
				".dbt-panel{font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:10px;padding:16px;height:100%;box-sizing:border-box;overflow-y:auto;}",
				"/* ===== iOS segmented control（顶部 tab） ===== */",
				".dbt-tabs{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;}",
				".dbt-tabs button{flex:1;border:none;background:transparent;color:inherit;border-radius:var(--dbt-radius-pill);padding:5px 8px;font-size:12px;font-weight:500;cursor:pointer;transition:all .18s var(--dbt-ease);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
				".dbt-tabs button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				"/* ===== inset grouped 卡片 ===== */",
				".dbt-card{background:var(--dbt-surface);border:none;border-radius:var(--dbt-radius-card);padding:12px;display:flex;flex-direction:column;gap:8px;}",
				".dbt-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
				"/* ===== 共享列布局（T1 逐步替换各视图内联 flex-column） ===== */",
				".dbt-col{display:flex;flex-direction:column;gap:8px;}",
				".dbt-col.dbt-col-tight{gap:2px;}",
				"/* ===== 填充式无边框输入 ===== */",
				".dbt-row input,.dbt-row select,.dbt-card input,.dbt-card select,.dbt-card textarea,.dbt-group input,.dbt-group select{flex:1;min-width:60px;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:5px 12px;font-size:13px;font-family:inherit;transition:all .18s var(--dbt-ease);}",
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
				"/* ===== 浏览面板表格：列分明（列间 hairline + 表头加深一档 + 行 hover） ===== */",
				".dbt-browse-root .dbt-table th + th,.dbt-browse-root .dbt-table td + td{border-left:1px solid var(--dbt-separator);}",
				".dbt-browse-root .dbt-table th{background:rgba(30,30,32,.85);}",
				".dbt-browse-root .dbt-table td{font-size:12px;}",
				".dbt-browse-root .dbt-table tbody tr:hover td{background:var(--dbt-surface-strong);}",
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
				".dbt-listrow:hover{background:var(--dbt-surface-strong);}",
				".dbt-tree{display:flex;flex-direction:column;}",
				"/* ===== Navicat 式对象树（数据浏览） ===== */",
				".dbt-treerow{display:flex;gap:6px;align-items:center;padding:10px 12px;font-size:13px;cursor:pointer;user-select:none;border-bottom:1px solid var(--dbt-separator);transition:background .15s var(--dbt-ease);}",
				".dbt-treerow:last-child{border-bottom:none;}",
				".dbt-treerow:hover{background:var(--dbt-surface-strong);}",
				".dbt-treerow.active{color:var(--dbt-accent);font-weight:600;}",
				".dbt-chev{flex:none;width:12px;text-align:center;color:var(--dbt-muted);font-size:10px;line-height:1;transition:transform .18s var(--dbt-ease);}",
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
				".dbt-seg button{flex:none;border:none;background:transparent;color:inherit;font-size:12px;padding:5px 12px;border-radius:var(--dbt-radius-pill);cursor:pointer;transition:all .18s var(--dbt-ease);}",
				".dbt-seg button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				"/* ===== 降级：透明度减弱 / 动效减弱 ===== */",
				"@media (prefers-reduced-transparency: reduce){.dbt-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(0,0,0,.55);}.dbt-dialog{backdrop-filter:none;-webkit-backdrop-filter:none;background:#2c2c2e;}.dbt-celldetail{background:#2c2c2e;}.dbt-table th{backdrop-filter:none;-webkit-backdrop-filter:none;background:#1e1e20;}.dbt-browse-root .dbt-table th{background:#1e1e20;}}",
				"@media (prefers-color-scheme: light) and (prefers-reduced-transparency: reduce){.dbt-dialog{background:#f5f5f7;}.dbt-celldetail{background:#f2f2f7;}.dbt-table th,.dbt-browse-root .dbt-table th{background:#f2f2f7;}}",
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
						// 末对齐由样式层 .dbt-dialog .dbt-row 规则承担，无需内联 style
						{ className: "dbt-row" },
						React.createElement("button", { className: "dbt-btn danger", onClick: () => done(true) }, t("confirmRun")),
						React.createElement("button", { className: "dbt-btn", onClick: () => done(false) }, t("confirmCancel")),
					),
				),
			);
		}

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
						? React.createElement("span", { className: draftTest.ok ? "dbt-msg" : "dbt-err" }, draftTest.msg)
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
									testInfo[c.id] ? React.createElement("div", { className: testInfo[c.id].startsWith("✓") ? "dbt-msg" : "dbt-err" }, testInfo[c.id]) : null,
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
		// Navicat 式对象树：连接 ▸ 库/[schema] ▸ 表，懒加载展开（浏览面板唯一树实例，展开状态随面板生命周期）
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
				// Navicat 式对象树：点击展开连接/库，点击表上报选中（由父组件就地预览）
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
			const [sel, setSel] = React.useState(null); // {rowIdx, colName, cell} 底部详情栏当前单元格（null=收起底栏）
			const [text, setText] = React.useState(""); // 详情栏 textarea 值（选中即就位）
			const [editNull, setEditNull] = React.useState(false); // 「设为 NULL」勾选（null 单元格默认勾选）
			const [cellErr, setCellErr] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [copied, setCopied] = React.useState(false);
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
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				}, () => { /* 剪贴板不可用（无权限等）：静默，按钮文案不变 */ });
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
						await runGuarded(
							(challengeId) => api("execute", { method: "POST", body: { projectPath, connId, statement: op.statement, params: op.params, database: op.database, challengeId } }),
							askConfirm,
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
				// 顶层只读提示：授权为 ro 时整格只读，单元格仍可点开底栏查看完整值
				!editable ? React.createElement("div", { className: "dbt-readhint" }, t("readOnlyRo")) : null,
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
									React.createElement("tr", { key: i },
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
				// 分页条（BrowsePane 传入）在详情栏之上，详情栏钉在面板最底部
				props.children,
				// 底部详情栏（Navicat/检查器式）：预览表格下方一栏，textarea 直接可编辑，点保存写回
				sel ? React.createElement(
					"div",
					{ className: "dbt-celldetail" },
					// 标题行：完整值 · 列名；null 单元格带 NULL 芯片；只读原因随之展示
					React.createElement(
						"div",
						null,
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
						React.createElement("input", { type: "checkbox", style: { flex: "none", minWidth: 0, width: "auto" }, checked: editNull, onChange: (e) => setEditNull(e.target.checked) }),
						t("setNull"),
					) : null,
					truncHint && truncHint !== selReason ? React.createElement("span", { className: "dbt-readhint" }, t(truncHint)) : null,
					cellErr ? React.createElement("span", { className: "dbt-err" }, cellErr) : null,
					React.createElement(
						"div",
						{ className: "dbt-row" },
						React.createElement("button", { className: "dbt-btn", onClick: copyCell }, copied ? t("copied") : t("copyBtn")),
						selReason === null ? React.createElement("button", { className: "dbt-btn primary", disabled: busy, onClick: saveCell }, busy ? t("cellSaving") : t("save")) : null,
						React.createElement("button", { className: "dbt-btn", onClick: () => setSel(null) }, t("close")),
					),
				) : null,
			);
		}

		// Navicat 式浏览面板（内嵌侧边栏）：上半对象树选库-表，下半结构/数据预览，点表即看，不再弹窗
		function BrowsePane(props) {
			const { conns, projectPath, grants, askConfirm } = props;
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
					// 未选表：显示引导空态（内嵌面板可直接浏览，不强制先选表）
					return React.createElement("div", { className: "dbt-browse-empty" }, t("selectTableHint"));
				}
				if (busy === "open") {
					// 表形状骨架：6 行 6 列静态色块（不引入新动画，reduced-motion 天然安全）
					return React.createElement("div", { className: "dbt-browse-skel", role: "status", "aria-busy": "true" },
						[0, 1, 2, 3, 4, 5].map((r) => React.createElement("div", { className: "dbt-browse-skelrow", key: r },
							[0, 1, 2, 3, 4, 5].map((c) => React.createElement("div", { className: "dbt-browse-skelcell", key: c })))));
				}
				if (loadErr) {
					// 错误就地显示 + 重试（内嵌面板保持就地呈现，不走 props.onError）
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
					onSaved: () => openTable(sel, page),
					askConfirm,
				}, footer);
			}

			// 内嵌面板纵向布局：撑满面板高度（.dbt-panel 为 height:100% 的 flex column），
			// 树限高 / main flex:1 内滚 / 分页与详情栏依次钉底
			return React.createElement(
				"div",
				{ className: "dbt-view", style: { flex: "1 1 auto", minHeight: 0 } },
				React.createElement(
					"div",
					{ style: { maxHeight: 280, overflowY: "auto" } },
					React.createElement(BrowseTree, {
						conns, projectPath, sel, autoExpand: true, // 内嵌后此树是唯一树实例，挂载即展开第一层级
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
							{ className: "dbt-seg" },
							["structure", "preview"].map((v) =>
								React.createElement("button", { key: v, className: view === v ? "active" : "", onClick: () => setView(v) },
									v === "structure" ? t("structure") : t("preview"))),
						),
					),
					// 内容区由 flex 吃满 main 剩余高度（表格外滚），不再用固定 maxHeight 兜底
					React.createElement("div", { className: "dbt-browse-content" }, rightPane()),
				),
			);
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
						React.createElement("button", {
							key: v, className: view === v ? "active" : "",
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
				// browse 视图撑满面板剩余高度（BrowsePane 内详情栏才能钉在面板最底部）
				React.createElement("div", { className: "dbt-view", key: view, style: view === "browse" ? { flex: "1 1 auto", minHeight: 0 } : undefined },
					view === "manage" ? React.createElement(ManageView, shared) : null,
					view === "grants" ? React.createElement(GrantsView, shared) : null,
					// browse：内嵌浏览面板（对象树 + 结构/数据预览，点表即看）
					view === "browse" ? React.createElement(BrowsePane, {
						ctx: props.ctx, conns, projectPath, grants, askConfirm,
					}) : null,
					view === "console" ? React.createElement(ConsoleView, Object.assign({}, shared, { askConfirm })) : null,
				),
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
		// 测试面：单元格写回纯函数（单测直接断言命令构造，无需起 React/HTTP）
		exports.__testables = {
			dialectOf, quoteIdent, parseCellText, isTruncatedCell, isBlobCell,
			buildUpdate, buildRedisOp, buildMongoOp,
		};
		return module.exports;
	},
});
// Stryker restore all
