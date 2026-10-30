# dsh-db-tool client（右侧栏前端）

## 形态：无构建、单文件产物

本目录**不需要任何构建步骤**。`client.js` 即最终发布产物，与 dsh-ssh-tunnel 的发布形态一致：一个 `window.__ModuleLoader__.load({ id, factory })` 包裹的单文件 IIFE 模块，`factory(require)` 内 `require("react")` 取 React，运行于 DSH **官方右侧栏**（`@deepseek-ai/dsh-client-ui-sidebar-right`）。

不存在第三方侧边栏依赖：页签走官方的两段式公开注册路径，与官方自带页签类型完全同一套接口。

这样做的好处：无打包器、无依赖漂移、产物可直接被插件安装流程原样打包，且随官方右侧栏升级自动适配（拆分窗格、浮动面板、全屏、布局持久化都由宿主提供）。

## 接入官方右侧栏

`exports.inject = ["slots", "sidebarRightTabs", "locale"]`，`apply(ctx)` 内三段注册，全部包在 `ctx.effect(...)` 里随插件卸载自动注销：

| 阶段 | 调用 | 作用 |
|---|---|---|
| 1. 页签类型 | `ctx.sidebarRightTabs.register({ id, kind, title, guide })` | 声明 `kind = "dsh-db-tool"` 的页签类型；`guide` 条目（order 45）让右侧栏空态页显示「数据库」入口卡片，点击即打开本页签 |
| 2. 页签正文 | `ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name, key: id }, DbToolBody))` | 按类型 `id` 挂载面板正文 |
| 3. 页签标题 | `ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({ name, key: id }, DbToolTitle))` | 页签胶囊上的图标 + 标题，随语言切换重渲染 |

正文组件的宿主标准 props：`sessionId`、`useTabInfo()`、`useSessions?()`。因此：

- `visible` 取自 `useTabInfo().tab.visible` —— 它已同时表达「页签激活」和「右侧栏展开 / 非后台会话」，折叠或切到后台会话时自动停轮询、停请求；
- 会话工作目录取自 `useSessions(s => s.byId[sessionId]?.cwd)`，与官方各页签类型同一来源；
- 席位 key 用类型 `id`（宿主以 `definition.id` 作为 slot 的 `entryKey`）。

## 文件

- `client.js` — 全部前端逻辑（单文件，约 1400 行），内含：
  - 4 个面板：管理（连接 CRUD + 测试 + 审计查看）、授权（项目路径 → 连接 ro/rw/撤销）、浏览（树选库/表 → 点表打开 Navicat 式弹窗：左树 + 结构/数据 Tabs + 分页；portal 挂 body，Esc/遮罩/✕ 关闭）、SQL 控制台（连接/库选择、query/execute/script、危险确认对话框 → challengeId 重发）
  - zh/en 双语词典（zh 默认），经 `ctx.locale.register(NS, ...)` 注册，`useSyncExternalStore` 订阅语言切换
  - 危险确认：`runGuarded()` 先发请求，收到 `code:"NEEDS_CONFIRMATION"` 且有 `challengeId` 时弹 `DangerDialog`，用户确认后携 challengeId 重发（challenge 一次性、绑语句、5 分钟有效）
  - REST API 调用走同源前缀 **`/dsh-db-tool/api`**（须与 host 端 `webServer.register` 的 prefix 一致）

## 验证（本地跑通的方式）

无构建器，验证即两项检查：

```powershell
node --check client/client.js        # 语法检查
```

再加一个最小冒烟：stub `window.__ModuleLoader__` / `require("react")`，eval 加载文件，调 `factory` 得到 `exports`，断言 `exports.inject` 含 `"sidebarRightTabs"` 与 `"slots"`、`exports.apply(ctx)` 能注册 `kind:"dsh-db-tool"` 的页签类型并在两个席位各注册一个 `key:"dsh-db-tool"` 的组件、根组件可创建（依赖仅 node 内置 fs）。

## 打包接入（发布形态，需根 package.json 配合）

npm 包需暴露 client 供 DSH 注入，并声明对官方右侧栏客户端的依赖（`dsh.client.inject` 里的包名会先于本插件加载）：

```jsonc
{
  "exports": { "./client": "./client/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-sidebar-right"],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1"
  }
}
```

## 本地开发

仓库根目录执行（Windows）：

```powershell
pnpm dsh web --patch ./cordis.patch.yml
```

右侧栏空态页出现「数据库」入口卡片（order 45），点开后即为面板，即加载成功；若右侧栏已有页签，用页签条上的「+」打开入口页再点「数据库」。projectPath 取自当前会话的 `cwd`，也可在面板顶部手动输入后点「加载」。
