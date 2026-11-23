# 数据浏览 @表/字段引用：改动前后对照取证

两张场景，各亮/暗一组；机制一致：viewport 500×774、@2x 采集，浏览器 colorScheme 由 Playwright 上下文显式设为同侧，画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）、文字取 `--dsw-alias-label-primary` 解析值；两版均为各自提交干净构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API（连接/授权/审计链路全真实，sqlite 示例库 users/orders/products 五列三表含数据），React 18 走真实渲染路径；页签/席位/语言三个宿主服务以最小桩替代（与 tests/client 同语义）。

## 场景 1：表级引用（面包屑 @ 图标，行悬停浮现）

- 场景：数据浏览页签 → 展开树壳 → 连接「示例库」→ main → 选中 `orders` 表（默认视图，面包屑带表名）；截图时鼠标悬停在面包屑行上，@ 图标处于浮现态
- Before = `acb5094`（1.9.22，无任何 @ 入口），After = 本变更（面包屑行悬停浮现紧凑 @ 图标）
- 交互形态（对齐侧边栏行悬停操作范式）：按钮平时整组隐藏（`.dbt-rowactions` 默认 `display:none`），悬停所在行 / 键盘聚焦按钮时浮现（`@media (hover: hover)` 行悬停 + `:focus-within`），触屏（`hover: none`）恒显以免不可达；按钮为 24px 命中区 + 14px @ 字形的紧凑图标钮，静置 tertiary、悬停 primary，配色走宿主 alias token（`--dsw-alias-label-*`，缺失回退插件变量）。DOM 校验：静止态 `display:none`、悬停后 `inline-flex`、按钮实测 24×24px
- 像素机器校验：八图与底色亮度差 > 60 的文字像素占比 2.62%–2.86%（> 0 判有效）

| 主题 | Before（acb5094） | After（本变更，悬停态） |
|---|---|---|
| 亮色 | [light/before-1-browse-selected.png](light/before-1-browse-selected.png) | [light/after-1-browse-selected.png](light/after-1-browse-selected.png) |
| 暗色 | [dark/before-1-browse-selected.png](dark/before-1-browse-selected.png) | [dark/after-1-browse-selected.png](dark/after-1-browse-selected.png) |

## 场景 2：字段级引用（结构页字段行 @ 图标，行悬停浮现）

- 场景：与场景 1 同一选中态（结构页展示 `orders` 五列）；截图时鼠标悬停在首个字段行上，该行 @ 图标处于浮现态，其余行保持隐藏
- Before = `67af832`（字段行常驻大号「@添加到对话」文本按钮），After = 本变更（行悬停浮现的紧凑 @ 图标，仅悬停行出现）
- DOM 机器校验：Before 结构表内按钮常驻可见；After 五个字段行各有按钮但静止态 `display:none`，悬停行浮现，按钮 24×24px
- 像素机器校验：四图文字像素占比 2.62%–2.86%（> 0 判有效）

| 主题 | Before（67af832） | After（本变更，悬停态） |
|---|---|---|
| 亮色 | [light/before-2-structure-columns.png](light/before-2-structure-columns.png) | [light/after-2-structure-columns.png](light/after-2-structure-columns.png) |
| 暗色 | [dark/before-2-structure-columns.png](dark/before-2-structure-columns.png) | [dark/after-2-structure-columns.png](dark/after-2-structure-columns.png) |

## 操作演示（鼠标点击全流程，亮色）

同一真实产物，截图仅呈现数据浏览面板本体。四步全为鼠标点击/悬停，无键盘输入。@ 图标平时隐藏，悬停所在行才浮现（demo-1/demo-3 为静止态，demo-2/demo-4 为悬停浮现并点击后的结果态）：

1. **demo-1**：对象树点开树壳 → 点连接 → 点 main → 点 orders —— 面包屑就位（@ 图标静止隐藏，不显眼）
2. **demo-2**：鼠标悬停面包屑（@ 图标浮现）→ 点击 → 接收区插入 `@db:c1/main/orders`（发送后助手即可读该表）
3. **demo-3**：选中表后默认落在结构页 —— 每个字段行末列都有 @ 入口（静止隐藏）
4. **demo-4**：鼠标悬停 user_id 字段行（@ 图标浮现）→ 点击 → 接收区插入 `@col:c1/main/orders/user_id`（与 demo-2 的表引用可并存）

| 步骤 | 截图 |
|---|---|
| 1 树中点选表 | [demo/demo-1-table-mention.png](demo/demo-1-table-mention.png) |
| 2 点面包屑 @ 插入表引用 | [demo/demo-2-table-inserted.png](demo/demo-2-table-inserted.png) |
| 3 结构页字段行 @ 入口 | [demo/demo-3-column-mention.png](demo/demo-3-column-mention.png) |
| 4 点字段行 @ 插入列引用 | [demo/demo-4-column-inserted.png](demo/demo-4-column-inserted.png) |

## 限制

对话文本内的 `@db:` / `@col:` 引用 chip 由宿主会话管线（`conversation.user.text.node` 席位）渲染，需要运行中的 DSH 宿主对话才能成像，本离线取证环境无法真实呈现；该链路由 `tests/client/table-mention.spec.ts` 的规则/渲染/注册契约覆盖。
