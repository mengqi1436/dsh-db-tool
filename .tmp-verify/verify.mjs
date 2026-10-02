// 内嵌单态视觉验证：数据浏览内嵌侧边栏——对象树/结构/数据预览/单元格编辑全部在面板内完成（无浮窗壳、无 PiP）。
// 用法：node .tmp-verify/verify.mjs [client.js 路径]   （默认 client/client.js，相对仓库根）
// 依赖：playwright-cli 在 PATH；harness 的 React 从 CDN 拉取（需联网）。
// 输出：逐条 [PASS]/[FAIL] + 汇总 PASS/FAIL；全过退出码 0，否则 1。
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(process.argv[2] || "client/client.js");
let BASE = "http://127.0.0.1:8734"; // 实际端口由自起 serve 的 PORT= 输出覆盖
const SESSION = "dbt-verify";
// 按钮文案统一 Unicode 转义，绕开 cmd.exe 命令行编码（eval 表达式经 /c 转发）
const BTN_BROWSE = "'\\u6570\\u636e\\u6d4f\\u89c8'"; // 数据浏览
const BTN_PREVIEW = "'\\u6570\\u636e\\u9884\\u89c8'"; // 数据预览
const BTN_EDIT = "'\\u7f16\\u8f91'"; // 编辑
const TAB_MANAGE = "'\\u8fde\\u63a5\\u7ba1\\u7406'"; // 连接管理
const TAB_GRANTS = "'\\u9879\\u76ee\\u6388\\u6743'"; // 项目授权
const TAB_CONSOLE = "'SQL \\u63a7\\u5236\\u53f0'"; // SQL 控制台
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? "  —— " + detail : ""}`);
}

// ---- 1. 生成 harness（gen.mjs 输出 harness.html；内嵌单态无查询参数分支）----
const gen = spawnSync(process.execPath, [join(here, "gen.mjs"), clientPath], { encoding: "utf8" });
step("生成 harness.html", gen.status === 0, (gen.stdout + gen.stderr).trim().replace(/\n/g, " "));

// ---- 2. 静态服务：总是自起随机端口 serve（不复用 8734：外部残留的旧 harness 服务会串台）----
const server = spawn(process.execPath, [join(here, "serve.mjs"), "0"], { stdio: ["ignore", "pipe", "pipe"] });
let up = false;
await new Promise((res) => {
  const t = setTimeout(res, 8000);
  server.stdout.on("data", (d) => {
    const m = /PORT=(\d+)/.exec(String(d));
    if (m) { BASE = "http://127.0.0.1:" + m[1]; clearTimeout(t); up = true; res(); }
  });
  server.on("exit", () => { clearTimeout(t); res(); });
});
try { if (up) up = (await fetch(BASE + "/harness.html")).ok; } catch {}
step("启动静态服务（随机端口）", up, up ? BASE : "serve.mjs 启动失败");
process.on("exit", () => server.kill());

// ---- 3. playwright-cli 包装（cmd.exe /s /c 转发；单步失败返回 ok:false，不崩，继续执行后续步骤）----
function pw(args, timeoutMs = 30000) {
  const r = spawnSync("cmd.exe",
    ["/d", "/s", "/c", "playwright-cli", `--s=${SESSION}`, ...args, "--json"],
    { encoding: "utf8", cwd: here, timeout: timeoutMs, windowsHide: true });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.error || r.status !== 0) return { ok: false, result: "", log: out.trim().slice(0, 300) };
  try {
    return { ok: true, result: JSON.parse(out).result, log: "" };
  } catch {
    return { ok: false, result: "", log: out.trim().slice(0, 300) };
  }
}

// eval 表达式并解析为 JS 值（playwright-cli --json 的 result 是 JSON.stringify 后的字符串）
function evalPage(expr) {
  const r = pw(["eval", expr]);
  if (!r.ok) return { ok: false, value: undefined };
  try { return { ok: true, value: JSON.parse(r.result) }; } catch { return { ok: true, value: r.result }; }
}

async function waitFor(expr, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const { ok, value } = evalPage(expr);
    if (ok && value) return true;
    await sleep(500);
  }
  return false;
}

function consoleErrors() {
  const r = pw(["console"]);
  const m = /Errors:\s*(\d+)/.exec(r.result || "");
  return m ? Number(m[1]) : -1;
}

// ---- 4. 内嵌单场景：树 → 选表 → 结构/数据预览 → 单元格编辑保存 → 四视图冒烟 ----
console.log(`\n===== 内嵌单态 ${BASE}/harness.html =====`);
pw(["close"]); // 清残留 session，失败忽略
const opened = pw(["open", BASE + "/harness.html"]);
step("打开页面", opened.ok, opened.log);
pw(["resize", "1280", "800"]);

const ready = await waitFor("window.__READY__ === 'rendered'");
step("harness 渲染完成（__READY__）", ready);

// 1) 点「数据浏览」tab → 对象树内嵌于面板（非浮窗）
const click = evalPage(`(() => { const b = [...document.querySelectorAll('.dbt-tabs button')].find(x => x.textContent.trim() === ${BTN_BROWSE}); if (!b) return 'NO_BTN'; b.click(); return 'CLICKED'; })()`);
step("点击「数据浏览」tab", click.ok && click.value === "CLICKED", String(click.value ?? click.ok));

const treeShown = await waitFor("document.querySelectorAll('.dbt-treerow').length > 0");
step("内嵌对象树 .dbt-treerow 出现", treeShown);
const noFloat = evalPage("!document.querySelector('.dbt-browse-dialog')");
step("无浮窗壳 .dbt-browse-dialog（内嵌于面板，非浮窗）", noFloat.ok && noFloat.value === true,
  `.dbt-browse-dialog 存在: ${noFloat.value === true ? false : "未知/存在"}`);

// 2) 展开 shop → 点 users 表 → 结构表格内嵌（parentElement 不是 body）
// 连接节点若未自动展开（autoExpand 缺失时）先点连接行兜底
let shopReady = await waitFor(`[...document.querySelectorAll('.dbt-treerow .dbt-treename')].some(x => x.textContent.trim() === 'shop')`);
if (!shopReady) {
  evalPage(`(() => { const r = [...document.querySelectorAll('.dbt-treerow')].find(x => x.querySelector('.dbt-treename')); if (r) r.click(); return 'ok'; })()`);
  shopReady = await waitFor(`[...document.querySelectorAll('.dbt-treerow .dbt-treename')].some(x => x.textContent.trim() === 'shop')`);
}
step("展开连接后 shop 库行出现", shopReady);
const clickShop = evalPage(`(() => { const n = [...document.querySelectorAll('.dbt-treerow .dbt-treename')].find(x => x.textContent.trim() === 'shop'); if (!n) return 'NO_SHOP'; n.parentElement.click(); return 'CLICKED'; })()`);
step("点击展开 shop", clickShop.ok && clickShop.value === "CLICKED", String(clickShop.value ?? clickShop.ok));

await waitFor(`[...document.querySelectorAll('.dbt-treerow .dbt-treename')].some(x => x.textContent.trim().indexOf('users') === 0)`);
const clickUsers = evalPage(`(() => { const n = [...document.querySelectorAll('.dbt-treerow .dbt-treename')].find(x => x.textContent.trim().indexOf('users') === 0); if (!n) return 'NO_USERS'; n.parentElement.click(); return 'CLICKED'; })()`);
step("点击 users 表", clickUsers.ok && clickUsers.value === "CLICKED", String(clickUsers.value ?? clickUsers.ok));

const tblShown = await waitFor("!!document.querySelector('.dbt-table')");
step("表格 .dbt-table 出现", tblShown);
const embed = evalPage(`(() => { const t = document.querySelector('.dbt-table'); return t ? t.parentElement !== document.body : null; })()`);
step(".dbt-table 内嵌于面板（parentElement 不是 body）", embed.ok && embed.value === true,
  `parentElement 判定: ${JSON.stringify(embed.value)}`);

// 3) 点数据预览 seg → 数据行出现（数据行单元格是 .dbt-cellbtn，与结构行区分）
const clickSeg = evalPage(`(() => { const b = [...document.querySelectorAll('.dbt-seg button')].find(x => x.textContent.trim() === ${BTN_PREVIEW}); if (!b) return 'NO_SEG'; b.click(); return 'CLICKED'; })()`);
step("点击「数据预览」seg", clickSeg.ok && clickSeg.value === "CLICKED", String(clickSeg.value ?? clickSeg.ok));
const dataRows = await waitFor(`[...document.querySelectorAll('.dbt-table tbody tr')].some(tr => tr.querySelector('.dbt-cellbtn'))`);
step("数据行出现（tbody 行内含 .dbt-cellbtn）", dataRows);

// 4) 第一个单元格 → 浮层 → 「编辑」→ .dbt-celledit textarea
const clickCell = evalPage(`(() => { const c = document.querySelector('.dbt-cellbtn'); if (!c) return 'NO_CELL'; c.click(); return 'CLICKED'; })()`);
step("点击第一个 .dbt-cellbtn", clickCell.ok && clickCell.value === "CLICKED", String(clickCell.value ?? clickCell.ok));
const popShown = await waitFor("!!document.querySelector('.dbt-cellpop')");
step("单元格浮层 .dbt-cellpop 出现", popShown);
const clickEdit = evalPage(`(() => { const b = [...document.querySelectorAll('.dbt-cellpop button')].find(x => x.textContent.trim() === ${BTN_EDIT}); if (!b) return 'NO_EDIT'; b.click(); return 'CLICKED'; })()`);
step("点击「编辑」", clickEdit.ok && clickEdit.value === "CLICKED", String(clickEdit.value ?? clickEdit.ok));
const editShown = await waitFor("!!document.querySelector('.dbt-celledit textarea')");
step("编辑态 .dbt-celledit textarea 出现", editShown);

// 5) 保存 → execute 恰好调用一次
const clickSave = evalPage(`(() => { const b = document.querySelector('.dbt-celledit .dbt-btn.primary'); if (!b) return 'NO_SAVE'; b.click(); return 'CLICKED'; })()`);
step("点击保存", clickSave.ok && clickSave.value === "CLICKED", String(clickSave.value ?? clickSave.ok));
const saved = await waitFor("window.__EXEC_LOG__.length === 1");
const execStmt = evalPage("JSON.stringify(window.__EXEC_LOG__[0] || null)");
step("保存后 execute 恰好调用 1 次（__EXEC_LOG__）", saved, execStmt.ok ? String(execStmt.value) : "无法读取");
const jsErr1 = evalPage("window.__JS_ERRORS__.length");
step("编辑保存流程无未捕获 JS 错误（__JS_ERRORS__）", jsErr1.ok && jsErr1.value === 0, `共 ${jsErr1.value} 条`);

// 6) 四视图切换冒烟：连接管理 / 项目授权 / SQL 控制台
const smoke = [
  ["连接管理", TAB_MANAGE, ".dbt-listrow"],
  ["项目授权", TAB_GRANTS, ".dbt-seg"],
  ["SQL 控制台", TAB_CONSOLE, "textarea"],
];
for (const [label, lit, sel] of smoke) {
  const c = evalPage(`(() => { const b = [...document.querySelectorAll('.dbt-tabs button')].find(x => x.textContent.trim() === ${lit}); if (!b) return 'NO_TAB'; b.click(); return 'CLICKED'; })()`);
  step(`切换到「${label}」`, c.ok && c.value === "CLICKED", String(c.value ?? c.ok));
  const shown = await waitFor(`!!document.querySelector('${sel}')`);
  step(`「${label}」视图控件 ${sel} 出现`, shown);
}

const jsErr = evalPage("window.__JS_ERRORS__.length");
step("全程无未捕获 JS 错误（__JS_ERRORS__）", jsErr.ok && jsErr.value === 0, `共 ${jsErr.value} 条`);
const ce = consoleErrors();
step("console 无 error", ce === 0, `Errors=${ce}`);
pw(["close"]);

// ---- 汇总 ----
const pass = results.filter((x) => x.ok).length;
const allOk = pass === results.length;
console.log(`\n==== 验证汇总: ${allOk ? "PASS" : "FAIL"}（${pass}/${results.length} 通过，client: ${clientPath}）====`);
for (const x of results.filter((x) => !x.ok)) console.log(`[FAIL] ${x.name}  —— ${x.detail}`);
server.stdout.destroy(); server.kill(); // 主动收尾：stdout pipe 会吊住事件循环，仅靠 exit 钩子不退出
process.exitCode = allOk ? 0 : 1;
