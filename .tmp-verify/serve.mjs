// 极简静态服务：仅用于视觉验收 harness（node 内置模块，零依赖）
// 用法：node serve.mjs [端口]（默认 8734；传 0 由系统分配随机端口，实际端口以 PORT=xxx 打印）
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const argPort = process.argv[2];
const port = argPort === undefined || argPort === "" ? 8734 : Number(argPort); // "0" = 随机端口（不能走 || 8734，0 是 falsy）
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };
createServer(async (req, res) => {
	try {
		const p = req.url.split("?")[0] === "/" ? "/harness.html" : req.url.split("?")[0];
		if (p === "/favicon.ico") { res.writeHead(204, { "cache-control": "no-store" }); return res.end(); } // 消除浏览器默认请求的 404 噪音
		const body = await readFile(join(root, p));
		res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
		res.end(body);
	} catch (e) {
		res.writeHead(404); res.end("not found");
	}
}).listen(port, "127.0.0.1", function () { console.log("PORT=" + this.address().port, "harness 服务: http://127.0.0.1:" + this.address().port + "/harness.html"); });
