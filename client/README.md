# dsh-db-tool client（侧边栏前端）

## 形态：无构建、单文件产物

本目录**不需要任何构建步骤**。`client.js` 即最终发布产物，与 dsh-ssh-tunnel 的发布形态一致：一个 `window.__ModuleLoader__.load({ id, factory })` 包裹的单文件 IIFE 模块，`factory(require)` 内 `require("react")` 取 React，运行于 DSH 侧边栏底座 dsh-better-sidebar（>=0.12）。

这样做的好处：无打包器、无依赖漂移、产物可直接被插件安装流程原样打包。

## 文件

- `client.js` — 全部前端逻辑（约 1000 行），内含：
  - 4 个面板：管理（连接 CRUD + 测试 + 审计查看）、授权（项目路径 → 连接 ro/rw/撤销）、浏览（库 → 表 → 结构 → 预览分页）、SQL 控制台（连接/库选择、query/execute/script、危险确认对话框 → challengeId 重发）
  - zh/en 双语词典（zh 默认），经 `ctx.locale.register(NS, ...)` 注册，`useSyncExternalStore` 订阅语言切换
  - 危险确认：`runGuarded()` 先发请求，收到 `code:"NEEDS_CONFIRMATION"` 且有 `challengeId` 时弹 `DangerDialog`，用户确认后携 challengeId 重发（challenge 一次性、绑语句、5 分钟有效）
  - REST API 调用走同源前缀 **`/dsh-db-tool/api`**（须与 host 端 `webServer.register` 的 prefix 一致）

## 验证（本地跑通的方式）

无构建器，验证即两项检查：

```powershell
node --check client/client.js        # 语法检查
```

再加一个最小冒烟：stub `window.__ModuleLoader__` / `require("react")`，eval 加载文件，调 `factory` 得到 `exports`，断言 `exports.inject` 含 `"betterSidebar"`、`exports.apply(ctx)` 能注册 `id:"dsh-db-tool"` 的 tab、根组件可创建（见本文件历史提交中的 smoke 脚本写法；依赖仅 node 内置 fs）。

## 打包接入（发布形态，需根 package.json 配合）

npm 包需暴露 client 供 DSH 注入（此字段属根 package.json，超出 client scope，需 lib/lead 侧补上）：

```jsonc
{
  "exports": { "./client": "./client/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": ["@deepseek-ai/dsh-client-locale"], "platform": "web" }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "dsh-better-sidebar": ">=0.12.0"
  }
}
```

## 本地开发

仓库根目录执行（Windows）：

```powershell
pnpm dsh web --patch ./cordis.patch.yml
```

侧边栏出现「数据库」tab（order 45）即加载成功。projectPath 取自 `scope.cwd || scope.workspacePath`，也可在面板顶部手动输入后点「加载」。
