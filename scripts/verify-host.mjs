/**
 * 独立验证：模拟 DSH host 的插件加载路径（cordis + 四个注入服务 stub），
 * 验证 dist/index.js 的 apply 全链走通（register 收到 prefix 路由、工具注册、effect 挂载）。
 * DSH_HOME 指向临时目录，不触碰真实 ~/.dsh。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-verify-home-'));

const { Context } = await import(pathToFileUrl('E:/Tool/nvm/v24.19.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'));

function pathToFileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/');
}

const registered = { routes: [], tools: [], effects: [] };

const app = new Context();
app.provide('webServer', {
  register(h) {
    registered.routes.push(h);
    return () => registered.routes.splice(registered.routes.indexOf(h), 1);
  },
});
app.provide('sessions', { get: () => ({ header: { cwd: 'E:/Code/dsh/dsh-db-tool' } }) });
app.provide('tools', {
  register(tool) {
    registered.tools.push(tool);
  },
});
app.provide('webRuntime', { trustedHosts: [] });

const plugin = await import(pathToFileUrl('E:/Code/dsh/dsh-db-tool/dist/index.js'));
await app.plugin(plugin.default ?? plugin);
await new Promise((r) => setTimeout(r, 200));

console.log('routes:', registered.routes.map((h) => `${h.kind}:${h.path}`));
console.log('tools:', registered.tools.map((t) => t.name));

if (registered.routes.length === 0 || registered.tools.length === 0) {
  console.error('FAIL: apply 未完成注册');
  process.exit(1);
}

// 直呼工具 execute（模拟模型调用，走真实 guard/store 链路）
const tool = registered.tools[0];
const list = await tool.execute({ action: 'list_connections' }, { agent: { session: { id: 's1' } } });
console.log('tool execute list_connections →', list.slice(0, 120));

console.log('HOST APPLY OK');
process.exit(0);
