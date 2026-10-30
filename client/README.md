# dsh-db-tool client（右侧栏前端）

## 形态：无构建、单文件产物

本目录**不需要任何构建步骤**。`client.js` 即最终发布产物，与 dsh-ssh-tunnel 的发布形态一致：一个 `window.__ModuleLoader__.load({ id, factory })` 包裹的单文件 IIFE 模块，`factory(require)` 内 `require("react")` 取 React，运行于 DSH **官方右侧栏**（`@deepseek-ai/dsh-client-ui-sidebar-right`）。

不存在第三方侧边栏依赖：页签走官方的两段式公开注册路径，与官方自带页签类型完全同一套接口。

这样做的好处：无打包器、无依赖漂移、产物可直接被插件安装流程原样打包，且随官方右侧栏升级自动适配——拆分窗格、浮动面板、全屏、布局持久化都由宿主提供，本插件不必自维护。

## 接入官方右侧栏

`exports.inject = ["slots", "sidebarRightTabs", "locale"]`，`apply(ctx)` 内三段注册：

| 阶段 | 调用 | 作用 |
|---|---|---|
| 1. 页签类型 | `ctx.sidebarRightTabs.register({ id, kind, title, guide, priority, keepMounted })` | 声明 `id = kind = "dsh-db-tool"` 的页签类型；`guide` 条目（order 45）让右侧栏空态页显示「数据库」入口卡片，点击即打开本页签；`priority: "extension"` 显式写明第三方档位；`keepMounted: true` 见下节 |
| 2. 页签正文 | `ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name, key: id }, DbToolBody))` | 按类型 `id` 挂载面板正文 |
| 3. 页签标题 | `ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({ name, key: id }, DbToolTitle))` | 页签胶囊上的图标 + 标题，随语言切换重渲染 |

两个必须记住的易错点：

- **席位 `key` 必须是类型的 `id`，不是 `kind`。** 宿主按 `definition.id` 派发席位；官方允许 extension 接管 builtin 的 `kind`，若按 `kind` 挂席位，同 kind 的两份实现会互相串位。本插件 `id` 与 `kind` 取值恰好相同，但这是两条独立的身份，改 `kind` 时不能顺手改席位 `key`。
- **每一处注册都要包在 `ctx.effect(...)` 里。** 类型注册与两个席位注册各自一个 effect，插件卸载时宿主据此自动注销；漏掉 effect 的注册会残留到下次加载，表现为同 id 二次注册报错。席位侧还必须用 `ctx.slots.inject` 包一层，让注册表按声明时序等待。

## 正文拿到的宿主标准 props

正文组件由宿主渲染，携带框架标准 props：

- `sessionId` —— 当前会话 id；
- `useTabInfo()` —— 返回 `{ sidebar, panel, tab }`，其中 `tab.visible` 已同时表达「页签激活」「右侧栏展开」「非后台会话」三重语义，直接当可见性用即可，业务侧不必再自判前后台；折叠或切到后台会话时面板应停止轮询与请求；
- `useSessions(selector)` —— 会话 store 的订阅钩子，会话工作目录取自 `useSessions(s => s.byId[sessionId]?.cwd)`，与官方各页签类型同一来源。

## 为什么声明 keepMounted

官方右侧栏**默认按需卸载正文**（`keepMounted` 缺省 `false`）：切页签、切会话、收起右栏都会把正文卸载。而本插件的面板状态几乎全在 React 本地 state ——面板分段、项目路径、连接与授权列表、树刷新信号、SQL 控制台的多标签与结果、传输视图的选择项 —— 不声明 `keepMounted` 就会在上面的任一动作后全部归零。

因此类型声明里写 `keepMounted: true`：已访问过的正文在切页签、切会话、收起与停靠切换期间保留。注意它**不会提前挂载**正文（首次可见才挂载），也不保「插件卸载 / 页面刷新 / 关闭页签」之后的实例——那属于持久化范畴，本插件不做。

## 文件

- `client.js` — 全部前端逻辑（单文件，约 3900 行），内含：
  - 5 个面板视图：管理（连接 CRUD + 测试 + 审计查看）、授权（项目路径 → 连接 ro/rw/撤销）、浏览（树选库/表 → 点表打开 Navicat 式弹窗：左树 + 结构/数据 Tabs + 分页；portal 挂 body，Esc/遮罩/✕ 关闭）、SQL 控制台（连接/库选择、query/execute/script、危险确认对话框 → challengeId 重发）、传输（库表级数据迁移、写入模式、进度与传输日志）
  - zh/en 双语词典（zh 默认），经 `ctx.locale.register(NS, ...)` 注册，`useSyncExternalStore` 订阅语言切换；文案一律走 thunk（`title()` / `description()` 每次调用现读），语言变化不需要重注册
  - 危险确认：`runGuarded()` 先发请求，收到 `code:"NEEDS_CONFIRMATION"` 且有 `challengeId` 时弹 `DangerDialog`，用户确认后携 challengeId 重发（challenge 一次性、绑语句、5 分钟有效）
  - REST API 调用走同源前缀 **`/dsh-db-tool/api`**（须与 host 端 `webServer.register` 的 prefix 一致）

## 验证（本地跑通的方式）

无构建器，验证分三项：

```powershell
node --check client/client.js        # 语法检查
npx vitest run tests/client          # 前端单测
```

再加一条注册契约冒烟（`tests/client/sidebar-registration.spec.ts`）：stub `window.__ModuleLoader__` / `require("react")` 与最小 `document`，eval 加载文件，调 `factory` 得到 `exports`，断言 `exports.inject` 含 `"sidebarRightTabs"` 与 `"slots"`、`exports.apply(ctx)` 能注册 `kind:"dsh-db-tool"` 的页签类型并在两个席位各注册一个 `key:"dsh-db-tool"` 的组件（`key` 与类型 `id` 必须相等），并断言卸载后注册项全部撤销。桩 ctx 只需记录 `locale` / `effect` / `sidebarRightTabs` / `slots` 四项服务，依赖仅 node 内置模块。

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

`dsh.client.inject` 负责「谁先加载」，`peerDependencies` 只声明框架本体——右侧栏包属于宿主提供的运行时，不放 peerDependencies。

## 本地开发

仓库根目录执行（Windows）：

```powershell
pnpm dsh web --patch ./cordis.patch.yml
```

右侧栏空态页出现「数据库」入口卡片（order 45），点开后即为面板，即加载成功；若右侧栏已有页签，用页签条上的「+」打开入口页再点「数据库」。projectPath 取自当前会话的 `cwd`，也可在面板顶部手动输入后点「加载」。
