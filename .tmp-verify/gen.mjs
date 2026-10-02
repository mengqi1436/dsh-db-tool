// 视觉验收 harness 生成器：把 client.js 内联进 mock 宿主 HTML（CDN React + mock API）。
// 用法：node .tmp-verify/gen.mjs <client.js 路径> [输出目录]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const clientPath = process.argv[2] || "client/client.js";
const outDir = process.argv[3] || dirname(fileURLToPath(import.meta.url));
const src = readFileSync(clientPath, "utf8");
mkdirSync(outDir, { recursive: true });

// ---- mock 数据（覆盖 SQL/redis/mongo 三族 + NULL/截断场景）----
const MOCK = {
  conns: [
    { id: "mysql-main", kind: "mysql", name: "本地MySQL", host: "127.0.0.1", port: 3306 },
    { id: "mongo-main", kind: "mongodb", name: "文档库", host: "127.0.0.1", port: 27017 },
    { id: "redis-main", kind: "redis", name: "缓存Redis", host: "127.0.0.1", port: 6379 },
  ],
  grants: [
    { connId: "mysql-main", mode: "rw" },
    { connId: "mongo-main", mode: "rw" },
    { connId: "redis-main", mode: "ro" },
  ],
  databases: {
    "mysql-main": ["shop", "blog"],
    "mongo-main": ["test"],
    "redis-main": ["db0"],
  },
  tables: {
    "mysql-main|shop": [
      { name: "users", type: "TABLE" },
      { name: "orders", type: "TABLE" },
    ],
    "mysql-main|blog": [{ name: "posts", type: "TABLE" }],
    "mongo-main|test": [{ name: "users", type: "collection" }],
    "redis-main|db0": [
      { name: "user:1", type: "string" },
      { name: "cfg", type: "hash" },
      { name: "rank", type: "zset" },
    ],
  },
  schemas: {
    "mysql-main|shop|users": [
      { name: "id", dataType: "int", nullable: false, key: "PRI" },
      { name: "name", dataType: "varchar(64)", nullable: false },
      { name: "email", dataType: "varchar(128)", nullable: true },
      { name: "created_at", dataType: "datetime", nullable: false },
      { name: "note", dataType: "json", nullable: true },
    ],
    "mongo-main|test|users": [
      { name: "_id", dataType: "ObjectId (inferred)", nullable: false, key: "PRI" },
      { name: "name", dataType: "string (inferred)", nullable: false },
      { name: "age", dataType: "number (inferred)", nullable: true },
      { name: "created", dataType: "date (inferred)", nullable: true },
    ],
    "redis-main|db0|cfg": [
      { name: "type", dataType: "hash", nullable: false },
      { name: "encoding", dataType: "OBJECT ENCODING", nullable: true },
      { name: "ttl", dataType: "seconds", nullable: true },
      { name: "length", dataType: "HLEN", nullable: true },
    ],
  },
  previews: {
    "mysql-main|shop|users": {
      columns: ["id", "name", "email", "created_at", "note"],
      rows: [
        [1, "张三", "zhang@example.com", "2026-01-02 10:00:00", '{"city":"北京","tags":["a","b"]}'],
        [2, "李四", null, "2026-02-11 08:30:00", '{"city":"上海","extra":"' + "x".repeat(600) + '…[已截断]"]'],
        [3, "王五", "wang@example.com", "2026-03-15 14:20:00", null],
      ],
      rowCount: 3,
    },
    "mongo-main|test|users": {
      columns: ["_id", "name", "age", "created"],
      rows: [
        ["652a1b2c3d4e5f6a7b8c9d0e", "Alice", 28, "2026-01-15T08:00:00.000Z"],
        ["652a1b2c3d4e5f6a7b8c9d0f", "Bob", null, "2026-02-20T12:30:00.000Z"],
      ],
      rowCount: 2,
    },
    "redis-main|db0|cfg": {
      columns: ["field", "value"],
      rows: [
        ["host", "127.0.0.1"],
        ["port", "6379"],
        ["pass", null],
      ],
      rowCount: 3,
    },
    "redis-main|db0|user:1": {
      columns: ["key", "value"],
      rows: [["user:1", "张三"]],
      rowCount: 1,
    },
    "redis-main|db0|rank": {
      columns: ["member", "score"],
      rows: [
        ["alice", "96.5"],
        ["bob", "88"],
      ],
      rowCount: 2,
    },
  },
};

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>dbt 视觉验收 harness</title>
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<style>
  html,body{margin:0;height:100%;background:#1c1c1e;}
  #host{width:380px;height:100%;border-right:1px solid rgba(120,120,128,.3);box-sizing:border-box;}
  #stage-note{position:fixed;left:400px;top:8px;color:#888;font:12px monospace;}
</style>
</head>
<body>
<div id="host"></div>
<div id="stage-note">主页面占位区（数据浏览内嵌于左侧面板，无浮窗）</div>
<script>
// ---- mock DSH 宿主 ----
// 页面级 JS 错误收集（verify.mjs 断言“无 JS 错误”用）
window.__JS_ERRORS__ = [];
window.addEventListener("error", function (e) { window.__JS_ERRORS__.push(String((e && e.message) || e)); });
// 1.5.6 起数据浏览内嵌侧边栏：client.js 不再 require react-dom 系（浮窗 portal/PiP 链已删），mock 仅提供 react
window.__DBT_DEF__ = null;
window.__ModuleLoader__ = {
  load(def) { window.__DBT_DEF__ = def; },
};
function mockRequire(name) {
  if (name === "react") return window.React;
  throw new Error("mock 宿主未提供模块: " + name);
}
// ---- mock API ----
const M = ${JSON.stringify(MOCK)};
window.__EXEC_LOG__ = [];
function q(url) { return Object.fromEntries(new URL(url, location.origin).searchParams); }
function key(a, b) { return a + "|" + b; }
async function mockFetch(url, init) {
  init = init || {};
  const u = new URL(url, location.origin);
  const p = u.pathname.replace("/dsh-db-tool/api/", "");
  const qp = q(url);
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch (e) {}
  const respond = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data }) });
  if (p === "connections") return respond(M.conns);
  if (p === "grants") return respond(M.grants);
  if (p === "project-context") return respond({ hasProject: true, projectPathKey: "E:\\\\Code\\\\demo" });
  if (p === "databases") return respond(M.databases[qp.connId] || []);
  if (p === "tables") return respond(M.tables[key(qp.connId, qp.database)] || []);
  if (p === "schemas") return respond([]);
  if (p === "schema") return respond(M.schemas[[qp.connId, qp.database, qp.table].join("|")] || []);
  if (p === "preview") return respond(M.previews[[qp.connId, qp.database, qp.table].join("|")] || { columns: ["x"], rows: [], rowCount: 0 });
  if (p === "execute") {
    window.__EXEC_LOG__.push({ statement: body.statement, params: body.params, database: body.database });
    return respond({ affectedRows: 1, message: "执行成功，受影响 1 行" });
  }
  if (p === "audit") return respond([]);
  return respond({});
}
window.fetch = (url, init) => mockFetch(String(url), init);
</script>
<script>${src.replace(/<\/script>/gi, "<\\/script>")}</script>
<script>
// client.js 已调用 __ModuleLoader__.load，现在装载模块并渲染
(function boot() {
  if (!window.__DBT_DEF__) return setTimeout(boot, 30);
  const ctx = {
    locale: {
      subscribe(cb) { return function () {}; },
      getSnapshot() { return { active: "zh" }; },
      register() { return function () {}; },
    },
    betterSidebar: {
      registerTab(tab) { window.__TAB__ = tab; },
    },
    effect(fn) { const off = fn(); return typeof off === "function" ? off : function () {}; },
  };
  const mod = window.__DBT_DEF__.factory(mockRequire);
  window.__MOD__ = mod;
  mod.apply(ctx);
  (function mount() {
    if (!window.__TAB__) return setTimeout(mount, 30);
    const el = window.__TAB__.component({ visible: true, scope: { cwd: "E:\\\\Code\\\\demo", sessionId: "s1" } });
    window.ReactDOM.createRoot(document.getElementById("host")).render(el);
    window.__READY__ = "rendered";
  })();
})();
</script>
</body>
</html>`;

const out = join(outDir, "harness.html");
writeFileSync(out, html);
console.log("harness 已生成:", out, "(", html.length, "bytes, client:", src.length, "bytes )");
