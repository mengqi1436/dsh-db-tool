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
			fieldsHost: "主机地址",
			fieldsPort: "端口",
			fieldsUser: "用户名",
			fieldsPassword: "密码",
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
			noTables: "无表",
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
			ok: "确定",
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
			fieldsHost: "Host",
			fieldsPort: "Port",
			fieldsUser: "User",
			fieldsPassword: "Password",
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
			noTables: "No tables",
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
			ok: "OK",
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
				"/* ===== Apple-style Design Tokens（dark 基线，light 经 media query 反转） ===== */",
				".dbt-panel{--dbt-accent:var(--dsh-accent,#0a84ff);--dbt-bg:transparent;--dbt-surface:rgba(120,120,128,.12);--dbt-surface-strong:rgba(120,120,128,.18);--dbt-separator:rgba(120,120,128,.24);--dbt-text-secondary:rgba(235,235,245,.6);--dbt-danger:#ff453a;--dbt-success:#30d158;--dbt-warning:#ffd60a;--dbt-dialog-bg:rgba(40,40,44,.85);--dbt-th-bg:rgba(30,30,32,.72);--dbt-seg-active:rgba(255,255,255,.14);--dbt-shadow:0 8px 32px rgba(0,0,0,.28);--dbt-radius-card:12px;--dbt-radius-ctrl:8px;--dbt-radius-pill:6px;--dbt-ease:cubic-bezier(.25,.1,.25,1);--dbt-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif;}",
				"@media (prefers-color-scheme: light){.dbt-panel{--dbt-accent:var(--dsh-accent,#007aff);--dbt-surface:rgba(120,120,128,.08);--dbt-surface-strong:rgba(120,120,128,.14);--dbt-separator:rgba(60,60,67,.18);--dbt-text-secondary:rgba(60,60,67,.6);--dbt-danger:#ff3b30;--dbt-success:#34c759;--dbt-warning:#ff9f0a;--dbt-dialog-bg:rgba(252,252,252,.9);--dbt-th-bg:rgba(255,255,255,.72);--dbt-seg-active:rgba(255,255,255,.9);--dbt-shadow:0 8px 32px rgba(0,0,0,.12);}}",
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
				".dbt-row input,.dbt-row select,.dbt-card input,.dbt-card select,.dbt-card textarea{flex:1;min-width:60px;background:var(--dbt-surface-strong);border:none;color:inherit;border-radius:var(--dbt-radius-ctrl);padding:6px 10px;font-size:13px;font-family:inherit;transition:all .18s var(--dbt-ease);}",
				".dbt-row input:focus,.dbt-row select:focus,.dbt-card input:focus,.dbt-card select:focus,.dbt-card textarea:focus{outline:2px solid var(--dbt-accent);outline-offset:-1px;}",
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
				"/* ===== 对话框（macOS alert 材质） ===== */",
				".dbt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;}",
				".dbt-dialog{background:var(--dbt-dialog-bg);color:inherit;border:1px solid var(--dbt-separator);border-radius:14px;padding:16px;max-width:460px;width:90%;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;font-size:13px;-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:var(--dbt-shadow);}",
				".dbt-dialog pre{background:var(--dbt-surface-strong);border-radius:var(--dbt-radius-pill);padding:8px;font-family:var(--dbt-mono);font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;}",
				".dbt-dialog .dbt-row{justify-content:flex-end;}",
				"/* ===== 授权列表行（实 hairline） ===== */",
				".dbt-grant{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--dbt-separator);}",
				"/* ===== mini segmented（ro/rw 等切换） ===== */",
				".dbt-seg{display:flex;gap:2px;background:var(--dbt-surface);border-radius:var(--dbt-radius-ctrl);padding:2px;}",
				".dbt-seg button{flex:none;border:none;background:transparent;color:inherit;font-size:11px;padding:3px 10px;border-radius:var(--dbt-radius-pill);cursor:pointer;transition:all .18s var(--dbt-ease);}",
				".dbt-seg button.active{background:var(--dbt-seg-active);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);}",
				"/* ===== 降级：透明度减弱 / 动效减弱 ===== */",
				"@media (prefers-reduced-transparency: reduce){.dbt-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(0,0,0,.55);}.dbt-dialog{backdrop-filter:none;-webkit-backdrop-filter:none;background:#2c2c2e;}.dbt-table th{backdrop-filter:none;-webkit-backdrop-filter:none;background:#1e1e20;}}",
				"@media (prefers-color-scheme: light) and (prefers-reduced-transparency: reduce){.dbt-dialog{background:#f5f5f7;}.dbt-table th{background:#f2f2f7;}}",
				"@media (prefers-reduced-motion: reduce){.dbt-panel *{transition:none!important;animation:none!important;}.dbt-btn:active{transform:none;}}",
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

		/* ---------------- 连接管理 ---------------- */
		const EMPTY_FORM = { id: "", kind: "mysql", name: "", mode: "url", url: "", host: "", port: "", user: "", password: "", database: "", ssl: false };

		// 通用表格渲染：columns + rows（审计列表与查询结果共用）
		function resultTable(columns, rows, cellTitles) {
			return React.createElement(
				"div",
				{ className: "dbt-tablewrap" },
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

		function auditTable(audit) {
			return resultTable(
				[t("auditTime"), t("auditAction"), t("auditConn"), t("auditDetail")],
				audit.map((a) => [
					a.ts || "",
					(a.action || "") +
						(a.ok === false ? "（" + t("auditDenied") + (a.error ? "：" + a.error : "") + "）" : "") +
						(a.confirmed ? "（" + t("auditConfirmed") + "）" : ""),
					a.connId || "",
					(a.statement || "").slice(0, 80),
				]),
				(row, cell, j) => (j === 3 ? (row[3] || "") : cell === null ? "NULL" : String(cell)),
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
			/** 从 URL 模式切回分字段：按当前 kind 重新补全官方默认值（未手改字段） */
			function reenterFields() {
				setForm((prev) => withKindDefaults(Object.assign({}, prev, { mode: "fields" }), dirty));
				setDraftTest(null);
			}
			function draftBody() {
				const body = { kind: form.kind, ssl: !!form.ssl };
				if (form.mode === "url") body.url = form.url;
				else {
					body.fields = { host: form.host, user: form.user, database: form.database || undefined };
					if (form.port) body.fields.port = Number(form.port);
					if (form.password) body.fields.password = form.password;
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
					? React.createElement("input", { placeholder: t("url"), value: form.url, onChange: (e) => patch({ url: e.target.value }) })
					: React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 6 } },
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("fieldsHost"), value: form.host, onChange: (e) => patch({ host: e.target.value }) }),
							React.createElement("input", { placeholder: t("fieldsPort"), value: form.port, onChange: (e) => patch({ port: e.target.value }) }),
							React.createElement("input", { placeholder: t("fieldsDatabase"), value: form.database, onChange: (e) => patch({ database: e.target.value }) })),
						React.createElement("div", { className: "dbt-row" },
							React.createElement("input", { placeholder: t("fieldsUser"), value: form.user, onChange: (e) => patch({ user: e.target.value }) }),
							React.createElement("input", { type: "password", placeholder: t("fieldsPassword"), value: form.password, onChange: (e) => patch({ password: e.target.value }) })),
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
					initial: editing === "new" ? null : Object.assign({}, EMPTY_FORM, editing),
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
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) : null,
				conns.map((c) =>
					React.createElement(
						"div",
						{ className: "dbt-card", key: c.id },
						// 行 1：kind 徽标 pill（surface 底 / 6px 圆角 / 等宽 11px）+ 名称 13px semibold
						React.createElement(
							"div",
							{ className: "dbt-row" },
							React.createElement("span", { style: { background: "var(--dbt-surface-strong, rgba(120,120,128,.18))", borderRadius: "6px", padding: "2px 6px", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "11px", lineHeight: 1.45 } }, c.kind),
							React.createElement("strong", { style: { fontSize: 13, fontWeight: 600 } }, c.name || c.id),
						),
						// 行 2：safeUrl 等宽 11px muted（无 url 时回退 host:port）
						(c.safeUrl || c.host) ? React.createElement(
							"div",
							{ className: "dbt-muted", style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 11, wordBreak: "break-all" } },
							c.safeUrl || (c.host + ":" + (c.port || "")),
						) : null,
						testInfo[c.id] ? React.createElement("div", { className: "dbt-muted" }, testInfo[c.id]) : null,
						// 行 3：次要按钮 + 删除（danger 语义）
						React.createElement(
							"div",
							{ className: "dbt-row" },
							React.createElement("button", { className: "dbt-btn", disabled: busy === "test", onClick: () => testConn(c.id) }, t("test")),
							React.createElement("button", { className: "dbt-btn", onClick: () => setEditing(c) }, t("edit")),
							React.createElement("button", { className: "dbt-btn danger", disabled: busy === "del", onClick: () => delConn(c) }, t("delete")),
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
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) : null,
				conns.map((c) => {
					const m = modeOf(c.id);
					return React.createElement(
						"div",
						{ className: "dbt-grant", key: c.id },
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
			);
		}

		/* ---------------- 数据浏览 ---------------- */
		function BrowseView(props) {
			const { conns, projectPath } = props;
			const [connId, setConnId] = React.useState("");
			const [database, setDatabase] = React.useState("");
			const [databases, setDatabases] = React.useState([]);
			const [tables, setTables] = React.useState([]);
			const [table, setTable] = React.useState(null); // TableInfo
			const [schema, setSchema] = React.useState([]);
			const [preview, setPreview] = React.useState(null); // QueryResult
			const [page, setPage] = React.useState(1);
			const [busy, setBusy] = React.useState("");
			const [view, setView] = React.useState("structure"); // structure | preview（纯视图切换，不影响数据加载）

			React.useEffect(() => {
				if (!connId || !projectPath) { setDatabases([]); return; }
				let cancelled = false;
				api("databases" + qs({ project: projectPath, connId }))
					.then((list) => { if (cancelled) return; setDatabases(list || []); setDatabase((list || [])[0] || ""); })
					.catch((e) => { if (!cancelled) props.onError(e); });
				return () => { cancelled = true; };
			}, [connId, projectPath]);
			React.useEffect(() => {
				if (!connId || !projectPath) { setTables([]); return; }
				let cancelled = false;
				api("tables" + qs({ project: projectPath, connId, database }))
					.then((list) => { if (cancelled) return; setTables(list || []); setTable(null); setSchema([]); setPreview(null); })
					.catch((e) => { if (!cancelled) props.onError(e); });
				return () => { cancelled = true; };
			}, [connId, database, projectPath]);
			const openTable = React.useCallback((tb, pg) => {
				if (!tb || !connId || !projectPath) return;
				setBusy("open");
				Promise.all([
					api("schema" + qs({ project: projectPath, connId, database, table: tb.name })),
					api("preview" + qs({ project: projectPath, connId, database, table: tb.name, limit: PAGE_SIZE, offset: ((pg || 1) - 1) * PAGE_SIZE })),
				])
					.then(([sch, prev]) => { setSchema(sch || []); setPreview(prev); setPage(pg || 1); })
					.catch((e) => props.onError(e))
					.finally(() => setBusy(""));
			}, [connId, database, projectPath]);
			React.useEffect(() => { if (table) openTable(table, 1); }, [table]); // eslint-disable-line

			function cellTitle(_row, cell) { return cell === null ? "NULL" : String(cell); }

			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("select", { value: connId, onChange: (e) => setConnId(e.target.value) },
						React.createElement("option", { value: "" }, t("viewManage") + "…"),
						conns.map((c) => React.createElement("option", { key: c.id, value: c.id }, (c.name || c.id) + " (" + c.kind + ")"))),
					React.createElement("select", { value: database, disabled: !connId, onChange: (e) => setDatabase(e.target.value) },
						databases.length === 0 ? React.createElement("option", { value: "" }, t("noDatabases")) :
							databases.map((d) => React.createElement("option", { key: d, value: d }, d))),
				),
				// 表选择器：填充式 select（option 文案带 type 标注）
				tables.length === 0 ? React.createElement("div", { className: "dbt-muted" }, connId ? t("noTables") : "") :
					React.createElement("select",
						{
							value: table ? table.name : "",
							disabled: !connId || busy === "open",
							onChange: (e) => { const tb = tables.find((x) => x.name === e.target.value); if (tb) setTable(tb); },
						},
						React.createElement("option", { value: "" }, ""),
						tables.map((tb) => React.createElement("option", { key: tb.name, value: tb.name }, tb.name + (tb.type && tb.type !== "table" ? " · " + tb.type : ""))),
					),
				table
					? React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 8 } },
						// 结构/预览：mini segmented 切换（复用现有 i18n key，不新增）
						React.createElement(
							"div",
							{ className: "dbt-seg", style: { alignSelf: "flex-start" } },
							["structure", "preview"].map((v) =>
								React.createElement("button", { key: v, className: view === v ? "active" : "", onClick: () => setView(v) }, v === "structure" ? t("structure") : t("preview"))),
						),
						React.createElement("strong", null, (view === "structure" ? t("structure") : t("preview")) + " · " + table.name),
						view === "structure"
							? resultTable(
								[t("column"), t("dataType"), t("nullable"), t("keyCol"), t("defaultVal"), t("comment")],
								schema.map((col) => [col.name, col.dataType, col.nullable ? "YES" : "NO", col.key || "", col.default === null || col.default === undefined ? "" : String(col.default), col.comment || ""]),
								cellTitle,
							)
							: React.createElement(
								React.Fragment,
								null,
								preview ? resultTable(preview.columns, preview.rows, cellTitle) : null,
								React.createElement(
									"div",
									{ className: "dbt-row", style: { justifyContent: "space-between" } },
									React.createElement("button", { className: "dbt-btn", disabled: page <= 1 || busy === "open", onClick: () => openTable(table, page - 1) }, "‹ " + t("prevPage")),
									React.createElement("span", { className: "dbt-muted" }, t("pageInfo", { page })),
									React.createElement("button", { className: "dbt-btn", disabled: (preview && preview.truncated) === false || busy === "open", onClick: () => openTable(table, page + 1) }, t("nextPage") + " ›"),
								),
								preview && preview.truncated ? React.createElement("div", { className: "dbt-muted" }, t("previewTruncated")) : null,
							),
					)
					: null,
			);
		}

		/* ---------------- SQL 控制台 ---------------- */
		// Apple 等宽字体栈（规范 §1）：SQL 与参数输入共用
		const MONO_FONT = "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace";
		function ConsoleView(props) {
			const { conns, projectPath, askConfirm } = props;
			const [connId, setConnId] = React.useState("");
			const [mode, setMode] = React.useState("query"); // query | execute | script
			const [sql, setSql] = React.useState("");
			const [params, setParams] = React.useState("");
			const [result, setResult] = React.useState(null); // {kind:'query',...}|{kind:'exec',...}
			const [busy, setBusy] = React.useState(false);

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
							(challengeId) => api("execute", { method: "POST", body: { projectPath, connId, statement: sql, params: parsedParams, challengeId } }),
							askConfirm,
						);
						setResult({ kind: "exec", message: (data && data.message) || "", affectedRows: data && data.affectedRows });
					} else {
						let parsedParams;
						if (params.trim()) { try { parsedParams = JSON.parse(params); } catch (e) { throw new Error(t("paramsJson") + ": " + e.message); } }
						const data = await runGuarded(
							(challengeId) => api("query", { method: "POST", body: { projectPath, connId, sql, params: parsedParams, challengeId } }),
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
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("select", { value: connId, onChange: (e) => setConnId(e.target.value) },
						React.createElement("option", { value: "" }, t("viewManage") + "…"),
						conns.map((c) => React.createElement("option", { key: c.id, value: c.id }, (c.name || c.id) + " (" + c.kind + ")"))),
					React.createElement("select", { value: mode, onChange: (e) => setMode(e.target.value) },
						React.createElement("option", { value: "query" }, t("modeQuery")),
						React.createElement("option", { value: "execute" }, t("modeExecute")),
						React.createElement("option", { value: "script" }, t("modeScript"))),
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
						React.createElement("button", { key: v, className: view === v ? "active" : "", onClick: () => setView(v) }, label)),
				),
				(projectEdited || !projectPath)
					? React.createElement(
						"div",
						{ className: "dbt-row" },
						// 填充式输入：裸 input 命中样式层 .dbt-row input 契约（去掉旧 dbt-card + 内联 padding hack）
						React.createElement("input", {
							placeholder: t("projectPathPlaceholder"), value: projectPath,
							onChange: (e) => setProjectPath(e.target.value), onBlur: () => setProjectEdited(false),
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
				view === "manage" ? React.createElement(ManageView, shared) : null,
				view === "grants" ? React.createElement(GrantsView, shared) : null,
				view === "browse" ? React.createElement(BrowseView, shared) : null,
				view === "console" ? React.createElement(ConsoleView, Object.assign({}, shared, { askConfirm })) : null,
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
		return module.exports;
	},
});
