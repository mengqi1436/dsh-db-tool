// 两态视觉验证：默认态（浮窗 portal 挂 body、居中全视口、可拖动）+ ?nord=1（宿主无 react-dom 降级）。
// 用法：node .tmp-verify/verify.mjs [client.js 路径]   （默认 client/client.js，相对仓库根）
// 依赖：playwright-cli 在 PATH；harness 的 React 从 CDN 拉取（需联网）。
// 输出：逐条 [PASS]/[FAIL] + 汇总 PASS/FAIL 与关键数值；全过退出码 0，否则 1。
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(process.argv[2] || "client/client.js");
let BASE = "http://127.0.0.1:8734"; // 实际端口由自起 serve 的 PORT= 输出覆盖
const SESSION = "dbt-verify";
const BTN_BROWSE = "'\\u6570\\u636e\\u6d4f\\u89c8'"; // “数据浏览”，Unicode 转义绕开命令行编码
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? "  —— " + detail : ""}`);
}

// ---- 1. 生成 harness（gen.mjs 输出 harness.html；两态由 URL 查询参数 ?nord=1 区分，serve.mjs 剥离 query 同文件服务两态）----
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

const RECT_EXPR = `(() => { const el = document.querySelector('.dbt-browse-dialog'); if (!el) return null; const r = el.getBoundingClientRect(); const b = document.body; return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight, parentIsBody: el.parentElement === b, parentTag: el.parentElement && el.parentElement.tagName }; })()`;

async function scenario(nord, nopip) {
  const label = nord ? "nord 态（无 react-dom 降级）" : nopip ? "nopip 态（DOM 浮窗基线）" : "PiP 态（独立窗口优先）";
  const q = nord ? "?nord=1" : nopip ? "?nopip=1" : "";
  const url = BASE + "/harness.html" + q;
  console.log(`\n===== ${label} ${url} =====`);
  pw(["close"]); // 清残留 session，失败忽略
  const opened = pw(["open", url]);
  step(`${label}: 打开页面`, opened.ok, opened.log);
  pw(["resize", "1280", "800"]);

  const ready = await waitFor("window.__READY__ === 'rendered'");
  step(`${label}: harness 渲染完成（__READY__）`, ready);

  const click = evalPage(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${BTN_BROWSE}); if (!b) return 'NO_BTN'; b.click(); return 'CLICKED'; })()`);
  step(`${label}: 点击「数据浏览」`, click.ok && click.value === "CLICKED", String(click.value ?? click.ok));

  // PiP 态：浮窗应进入 Document PiP 独立窗口（主文档不再有 DOM 浮窗）
  if (!nord && !nopip) {
    const pipReady = await waitFor(`!!(window.documentPictureInPicture && window.documentPictureInPicture.window && window.documentPictureInPicture.window.document.querySelector('.dbt-browse-dialog'))`);
    step("PiP 态: 独立窗口打开且浮窗渲染于其中", pipReady);
    if (pipReady) {
      const info = evalPage(`(() => { const w = window.documentPictureInPicture.window; return { rows: w.document.querySelectorAll('.dbt-treerow').length, mainHas: !!document.querySelector('.dbt-browse-dialog'), w: w.innerWidth, h: w.innerHeight }; })()`);
      step("PiP 态: PiP 文档内对象树已渲染（mock API 经 base 生效）", info.ok && !!info.value && info.value.rows > 0,
        info.value ? `rows=${info.value.rows} pipViewport=${info.value.w}x${info.value.h}` : "无 info");
      step("PiP 态: 主文档不再有 DOM 浮窗（不嵌入主窗口）", info.ok && !!info.value && info.value.mainHas === false,
        info.value ? `mainHas=${info.value.mainHas}` : "无 info");
      // 关闭联动：PiP 内浮窗关闭钮 → 独立窗口关闭
      evalPage(`(() => { const w = window.documentPictureInPicture.window; const c = w.document.querySelector('.dbt-browse-close'); if (c) c.click(); return 'closed'; })()`);
      await sleep(800);
      const gone = evalPage(`(() => { const p = window.documentPictureInPicture; return !p.window || p.window.closed; })()`);
      step("PiP 态: 浮窗关闭按钮联动关闭独立窗口", gone.ok && gone.value, JSON.stringify(gone.value));
    }
    const jsErr = evalPage("window.__JS_ERRORS__.length");
    step("PiP 态: 页面无未捕获 JS 错误（__JS_ERRORS__）", jsErr.ok && jsErr.value === 0, `共 ${jsErr.value} 条`);
    const ce = consoleErrors();
    step("PiP 态: console 无 error", ce === 0, `Errors=${ce}`);
    pw(["close"]);
    return;
  }

  const shown = await waitFor("!!document.querySelector('.dbt-browse-dialog')");
  step(`${label}: 浮窗 .dbt-browse-dialog 出现`, shown);
  if (!shown) { pw(["close"]); return; }

  const rect = evalPage(RECT_EXPR);
  const r = rect.value;
  step(`${label}: 读取浮窗 rect`, rect.ok && !!r, r ? `left=${r.left} top=${r.top} ${r.w}x${r.h} 视口=${r.iw}x${r.ih} parent=${r.parentTag}` : "无 rect");

  if (!nord) {
    step("默认态: portal 挂载到 document.body", !!r && r.parentIsBody, `parentElement===body: ${!!r && r.parentIsBody}`);
    const centered = !!r && r.left > 0 && r.right < r.iw && r.top > 0 && r.bottom < r.ih;
    step("默认态: 居中覆盖视口（left>0 且 right<innerWidth，四边均在视口内）", centered,
      r ? `left=${r.left} right=${r.right} iw=${r.iw} / top=${r.top} bottom=${r.bottom} ih=${r.ih}` : "无 rect");

    // 拖动：真实鼠标事件（header 中心按下 → 左上移动 80/30 → 抬起），位置应变化且整体仍在视口内
    const hdr = evalPage(`(() => { const h = document.querySelector('.dbt-browse-header'); if (!h) return null; const b = h.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    step("默认态: 定位拖动柄 header 中心", hdr.ok && !!hdr.value, hdr.value ? `(${hdr.value.x}, ${hdr.value.y})` : "无 header");
    if (hdr.ok && hdr.value) {
      const { x, y } = hdr.value;
      const seq = [["mousemove", String(x), String(y)], ["mousedown"], ["mousemove", String(x - 80), String(y - 30)], ["mouseup"]];
      let dragOk = true;
      for (const a of seq) { const rr = pw(a); if (!rr.ok) { dragOk = false; step("默认态: 拖动事件序列", false, rr.log); break; } }
      if (dragOk) {
        await sleep(400); // 等 React 重渲染落位
        const r2 = evalPage(RECT_EXPR).value;
        const inViewport = !!r2 && r2.left >= 0 && r2.right <= r2.iw && r2.top >= 0 && r2.bottom <= r2.ih;
        const moved = !!r2 && !!r && (r2.left !== r.left || r2.top !== r.top);
        step("默认态: 拖动后位置变化", moved, r2 ? `left ${r.left}→${r2.left}, top ${r.top}→${r2.top}` : "无 rect");
        step("默认态: 拖动后整体仍在视口内（left>=0, right<=iw, top>=0, bottom<=ih）", inViewport,
          r2 ? `left=${r2.left} right=${r2.right} iw=${r2.iw} / top=${r2.top} bottom=${r2.bottom} ih=${r2.ih}` : "无 rect");
      }
    }
  } else {
    step("nord 态: 浮窗回退渲染（parentElement 不是 body）", !!r && !r.parentIsBody,
      r ? `parentTag=${r.parentTag} parentIsBody=${r.parentIsBody}` : "无 rect");
  }

  const jsErr = evalPage("window.__JS_ERRORS__.length");
  step(`${label}: 页面无未捕获 JS 错误（__JS_ERRORS__）`, jsErr.ok && jsErr.value === 0, `共 ${jsErr.value} 条`);
  const ce = consoleErrors();
  step(`${label}: console 无 error`, ce === 0, `Errors=${ce}`);
  pw(["close"]);
}

await scenario(false, false); // PiP 独立窗口优先
await scenario(false, true);  // nopip：DOM 浮窗基线（portal/居中/拖动）
await scenario(true, false);  // nord：无 react-dom 降级

// ---- 汇总 ----
const pass = results.filter((x) => x.ok).length;
const allOk = pass === results.length;
console.log(`\n==== 验证汇总: ${allOk ? "PASS" : "FAIL"}（${pass}/${results.length} 通过，client: ${clientPath}）====`);
for (const x of results.filter((x) => !x.ok)) console.log(`[FAIL] ${x.name}  —— ${x.detail}`);
server.stdout.destroy(); server.kill(); // 主动收尾：stdout pipe 会吊住事件循环，仅靠 exit 钩子不退出
process.exitCode = allOk ? 0 : 1;
