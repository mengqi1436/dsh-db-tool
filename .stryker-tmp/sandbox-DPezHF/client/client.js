// @ts-nocheck
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
			projectUnbound: "未识别当前项目路径，请在下方填写 workspace 绝对路径",
			projectPathPlaceholder: "workspace 绝对路径（如 E:\\Code\\my-app）",
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
			url: "连接 URL（密码将自动拆入 secrets）",
			fieldsHost: "Host",
			fieldsPort: "Port",
			fieldsUser: "User",
			fieldsPassword: "Password",
			fieldsDatabase: "Database",
			ssl: "启用 SSL",
			test: "测试",
			testing: "测试中…",
			testOk: "连接成功",
			testFail: "连接失败",
			edit: "编辑",
			delete: "删除",
			deleteConnConfirm: "确定删除连接「{name}」？将级联删除其 secrets 与所有项目的授权。",
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
			grantsHint: "为当前项目授权连接。ro=只读（仅查询/浏览），rw=读写（允许 execute/script）。未授权的连接在业务操作中一律拒绝。",
			modeNone: "未授权",
			modeRo: "只读 ro",
			modeRw: "读写 rw",
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
			modeQuery: "只读查询 query",
			modeExecute: "写入执行 execute",
			modeScript: "脚本 script",
			run: "执行",
			running: "执行中…",
			sqlPlaceholder: "输入 SQL / 命令…（Redis: [\"GET\",\"key\"]；Mongo: {\"find\":\"users\",\"filter\":{}}）",
			scriptPlaceholder: "输入 JS 脚本（vm 沙箱，含 db 助手对象）…",
			paramsJson: "params（JSON 数组，可选）",
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
				".dbt-panel{font-size:13px;display:flex;flex-direction:column;gap:8px;padding:10px;height:100%;box-sizing:border-box;overflow-y:auto;}",
				".dbt-tabs{display:flex;gap:4px;flex-wrap:wrap;}",
				".dbt-tabs button{border:1px solid var(--dsh-border,rgba(128,128,128,.35));background:transparent;color:inherit;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:12px;}",
				".dbt-tabs button.active{background:var(--dsh-accent,#3b82f6);color:#fff;border-color:transparent;}",
				".dbt-card{border:1px solid var(--dsh-border,rgba(128,128,128,.35));border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px;}",
				".dbt-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}",
				".dbt-row input,.dbt-row select,.dbt-card input,.dbt-card select,.dbt-card textarea{flex:1;min-width:60px;background:transparent;border:1px solid var(--dsh-border,rgba(128,128,128,.35));color:inherit;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;}",
				".dbt-card textarea{font-family:ui-monospace,Menlo,Consolas,monospace;min-height:72px;resize:vertical;}",
				".dbt-btn{border:1px solid var(--dsh-border,rgba(128,128,128,.35));background:transparent;color:inherit;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;white-space:nowrap;}",
				".dbt-btn.primary{background:var(--dsh-accent,#3b82f6);color:#fff;border-color:transparent;}",
				".dbt-btn.danger{color:#ef4444;border-color:#ef4444;}",
				".dbt-btn:disabled{opacity:.5;cursor:default;}",
				".dbt-muted{opacity:.6;font-size:11px;}",
				".dbt-err{color:#ef4444;font-size:12px;white-space:pre-wrap;}",
				".dbt-msg{color:#22c55e;font-size:12px;white-space:pre-wrap;}",
				".dbt-table{width:100%;border-collapse:collapse;font-size:12px;}",
				".dbt-table th,.dbt-table td{border:1px solid var(--dsh-border,rgba(128,128,128,.35));padding:3px 6px;text-align:left;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
				".dbt-table th{position:sticky;top:0;background:var(--dsh-bg,inherit);font-weight:600;}",
				".dbt-tablewrap{overflow:auto;max-height:320px;border:1px solid var(--dsh-border,rgba(128,128,128,.35));border-radius:6px;}",
				".dbt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;}",
				".dbt-dialog{background:var(--dsh-bg,#1e1e1e);color:inherit;border:1px solid var(--dsh-border,rgba(128,128,128,.35));border-radius:10px;padding:14px;max-width:460px;width:90%;display:flex;flex-direction:column;gap:8px;font-size:13px;}",
				".dbt-dialog pre{background:rgba(128,128,128,.12);border-radius:6px;padding:8px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;}",
				".dbt-grant{display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px dashed var(--dsh-border,rgba(128,128,128,.25));}",
				".dbt-seg{display:flex;gap:0;}",
				".dbt-seg button{border:1px solid var(--dsh-border,rgba(128,128,128,.35));background:transparent;color:inherit;font-size:11px;padding:2px 8px;cursor:pointer;}",
				".dbt-seg button:first-child{border-radius:6px 0 0 6px;}",
				".dbt-seg button:last-child{border-radius:0 6px 6px 0;border-left:none;}",
				".dbt-seg button.active{background:var(--dsh-accent,#3b82f6);color:#fff;}",
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
					React.createElement("strong", null, "⚠️ " + t("needConfirmTitle")),
					React.createElement("pre", null, ch.statement || "(?)"),
					React.createElement(
						"div",
						{ className: "dbt-muted" },
						t("dangerLevel") + ": " + (ch.danger || "danger") + " · " + t("reason") + ": " + (ch.reason || "-"),
					),
					React.createElement("div", { className: "dbt-muted" }, t("confirmHint")),
					React.createElement(
						"div",
						{ className: "dbt-row" },
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
										cell === null ? "NULL" : String(cell)))),
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

		function ConnForm(props) {
			const [form, setForm] = React.useState(props.initial || EMPTY_FORM);
			function patch(p) { setForm((prev) => Object.assign({}, prev, p)); }
			function submit() {
				const body = { id: form.id || undefined, kind: form.kind, name: form.name || undefined, ssl: !!form.ssl };
				if (form.mode === "url") body.url = form.url;
				else {
					body.fields = { host: form.host, user: form.user, database: form.database || undefined };
					if (form.port) body.fields.port = Number(form.port);
					if (form.password) body.fields.password = form.password;
				}
				props.onSubmit(body, () => setForm(EMPTY_FORM));
			}
			return React.createElement(
				"div",
				{ className: "dbt-card" },
				React.createElement("strong", null, props.initial ? t("editConn") : t("newConn")),
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("select", { value: form.kind, onChange: (e) => patch({ kind: e.target.value }) },
						DB_KINDS.map((k) => React.createElement("option", { key: k, value: k }, k))),
					React.createElement("input", { placeholder: t("connName"), value: form.name, onChange: (e) => patch({ name: e.target.value }) }),
					React.createElement("input", { placeholder: t("connId") + "（" + t("idAutoHint") + "）", value: form.id, disabled: !!props.initial, onChange: (e) => patch({ id: e.target.value }) }),
				),
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("label", { className: "dbt-row", style: { flex: "none" } },
						React.createElement("input", { type: "checkbox", checked: !!form.ssl, onChange: (e) => patch({ ssl: e.target.checked }) }), t("ssl")),
				),
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn" + (form.mode === "url" ? " primary" : ""), onClick: () => patch({ mode: "url" }) }, t("urlMode")),
					React.createElement("button", { className: "dbt-btn" + (form.mode === "fields" ? " primary" : ""), onClick: () => patch({ mode: "fields" }) }, t("fieldsMode")),
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
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn primary", disabled: props.busy, onClick: submit }, props.busy ? t("saving") : t("save")),
					React.createElement("button", { className: "dbt-btn", onClick: props.onCancel }, t("cancel")),
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
				React.createElement(
					"div",
					{ className: "dbt-row" },
					React.createElement("button", { className: "dbt-btn primary", onClick: () => setEditing("new") }, t("newConn")),
					React.createElement("button", { className: "dbt-btn", onClick: loadAudit }, t("auditTitle", { n: 50 }).split("（")[0].split(" (")[0]),
				),
				conns.length === 0 ? React.createElement("div", { className: "dbt-muted" }, t("noConns")) : null,
				conns.map((c) =>
					React.createElement(
						"div",
						{ className: "dbt-card", key: c.id },
						React.createElement(
							"div",
							{ className: "dbt-row" },
							React.createElement("strong", null, c.name || c.id),
							React.createElement("span", { className: "dbt-muted" }, c.kind + (c.safeUrl ? " · " + c.safeUrl : c.host ? " · " + c.host + ":" + (c.port || "") : "")),
						),
						testInfo[c.id] ? React.createElement("div", { className: "dbt-muted" }, testInfo[c.id]) : null,
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
						React.createElement("span", { style: { flex: 1 } }, (c.name || c.id) + " "), 
						React.createElement("span", { className: "dbt-muted" }, c.kind),
						React.createElement(
							"div",
							{ className: "dbt-seg" },
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

			function renderResult(r) {
				if (!r) return null;
				return React.createElement(
					"div",
					{ className: "dbt-tablewrap" },
					React.createElement(
						"table",
						{ className: "dbt-table" },
						React.createElement("thead", null, React.createElement("tr", null, (r.columns || []).map((c, i) => React.createElement("th", { key: i }, c)))),
						React.createElement("tbody", null, (r.rows || []).map((row, i) =>
							React.createElement("tr", { key: i }, row.map((cell, j) =>
								React.createElement("td", { key: j, title: cell === null ? "NULL" : String(cell) }, cell === null ? "NULL" : String(cell)))))),
					),
				);
			}

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
				tables.length === 0 ? React.createElement("div", { className: "dbt-muted" }, connId ? t("noTables") : "") :
					React.createElement(
						"div",
						{ className: "dbt-tablewrap", style: { maxHeight: 160 } },
						React.createElement(
							"table",
							{ className: "dbt-table" },
							React.createElement("tbody", null, tables.map((tb) =>
								React.createElement("tr", { key: tb.name, style: { cursor: "pointer", background: table && table.name === tb.name ? "rgba(59,130,246,.18)" : "transparent" }, onClick: () => setTable(tb) },
									React.createElement("td", null, tb.name),
									React.createElement("td", { className: "dbt-muted" }, tb.type || ""),
								))),
						),
					),
				table
					? React.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 8 } },
						React.createElement("strong", null, t("structure") + " · " + table.name),
						React.createElement(
							"div",
							{ className: "dbt-tablewrap", style: { maxHeight: 180 } },
							React.createElement(
								"table",
								{ className: "dbt-table" },
								React.createElement("thead", null, React.createElement("tr", null,
									React.createElement("th", null, t("column")),
									React.createElement("th", null, t("dataType")),
									React.createElement("th", null, t("nullable")),
									React.createElement("th", null, t("keyCol")),
									React.createElement("th", null, t("defaultVal")),
									React.createElement("th", null, t("comment")))),
								React.createElement("tbody", null, schema.map((col, i) =>
									React.createElement("tr", { key: i },
										React.createElement("td", null, col.name),
										React.createElement("td", null, col.dataType),
										React.createElement("td", null, col.nullable ? "YES" : "NO"),
										React.createElement("td", null, col.key || ""),
										React.createElement("td", null, col.default === null || col.default === undefined ? "" : String(col.default)),
										React.createElement("td", null, col.comment || "")))),
							),
						),
						React.createElement("strong", null, t("preview") + " · " + table.name),
						preview ? renderResult(preview) : null,
						React.createElement(
							"div",
							{ className: "dbt-row" },
							React.createElement("button", { className: "dbt-btn", disabled: page <= 1 || busy === "open", onClick: () => openTable(table, page - 1) }, "← " + t("prevPage")),
							React.createElement("span", { className: "dbt-muted" }, t("pageInfo", { page })),
							React.createElement("button", { className: "dbt-btn", disabled: (preview && preview.truncated) === false || busy === "open", onClick: () => openTable(table, page + 1) }, t("nextPage") + " →"),
							preview && preview.truncated ? React.createElement("span", { className: "dbt-muted" }, t("previewTruncated")) : null,
						),
					)
					: null,
			);
		}

		/* ---------------- SQL 控制台 ---------------- */
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
					"div",
					{ style: { display: "flex", flexDirection: "column", gap: 4 } },
					React.createElement("span", { className: "dbt-muted" }, t("rowsResult", { n: r.rowCount }) + (r.truncated ? " · " + t("previewTruncated") : "")),
					React.createElement(
						"div",
						{ className: "dbt-tablewrap" },
						React.createElement(
							"table",
							{ className: "dbt-table" },
							React.createElement("thead", null, React.createElement("tr", null, (r.columns || []).map((c, i) => React.createElement("th", { key: i }, c)))),
							React.createElement("tbody", null, (r.rows || []).map((row, i) =>
								React.createElement("tr", { key: i }, row.map((cell, j) =>
									React.createElement("td", { key: j, title: cell === null ? "NULL" : String(cell) }, cell === null ? "NULL" : String(cell)))))),
						),
					),
				);
			}
			return React.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 8 } },
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
				React.createElement("textarea", {
					placeholder: mode === "script" ? t("scriptPlaceholder") : t("sqlPlaceholder"),
					value: sql, onChange: (e) => setSql(e.target.value),
					style: mode === "script" ? { minHeight: 120 } : undefined,
				}),
				mode !== "script"
					? React.createElement("input", { placeholder: t("paramsJson"), value: params, onChange: (e) => setParams(e.target.value), style: { fontFamily: "ui-monospace,Menlo,Consolas,monospace" } })
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
					? React.createElement("input", {
						className: "dbt-card", style: { padding: "4px 6px" },
						placeholder: t("projectPathPlaceholder"), value: projectPath,
						onChange: (e) => setProjectPath(e.target.value), onBlur: () => setProjectEdited(false),
					})
					: React.createElement("div", { className: "dbt-row" },
						React.createElement("span", { className: "dbt-muted" }, t("projectLabel", { path: projectPath })),
						React.createElement("button", { className: "dbt-btn", onClick: () => setProjectEdited(true) }, "✎")),
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
