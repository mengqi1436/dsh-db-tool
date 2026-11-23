# 数据浏览 @表/字段引用：改动前后对照取证

两张场景，各亮/暗一组；机制一致：viewport 500×774、@2x 采集，浏览器 colorScheme 由 Playwright 上下文显式设为同侧，画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）、文字取 `--dsw-alias-label-primary` 解析值；两版均为各自提交干净构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API（连接/授权/审计链路全真实，sqlite 示例库 users/orders/products 五列三表含数据），React 18 走真实渲染路径；页签/席位/语言三个宿主服务以最小桩替代（与 tests/client 同语义）。

## 场景 1：表级引用（面包屑「@添加到对话」）

- 场景：数据浏览页签 → 展开树壳 → 连接「示例库」→ main → 选中 `orders` 表（默认视图，面包屑带表名）
- Before = `acb5094`（1.9.22，无任何 @ 入口），After = `09365fd`（面包屑新增「@添加到对话」）
- DOM 机器校验：Before 面包屑内无任何 `.dbt-btn`（`示例库›main›orders`）；After 面包屑新增按钮文案 `@添加到对话`、aria-label/title 为「把当前表以 @db: 引用插入对话输入框，发送后助手可直接读取该表数据」
- 像素机器校验：四图与底色亮度差 > 60 的文字像素占比 2.61%–2.86%（> 0 判有效）；Before/After 像素差集中位于面包屑按钮区（x 320–497、y 744–799 @2x，即新增按钮所在带），其余区域逐像素一致

| 主题 | Before（acb5094） | After（09365fd） |
|---|---|---|
| 亮色 | [light/before-1-browse-selected.png](light/before-1-browse-selected.png) | [light/after-1-browse-selected.png](light/after-1-browse-selected.png) |
| 暗色 | [dark/before-1-browse-selected.png](dark/before-1-browse-selected.png) | [dark/after-1-browse-selected.png](dark/after-1-browse-selected.png) |

## 场景 2：字段级引用（结构页每字段行「@添加到对话」）

- 场景：与场景 1 同一选中态（结构页展示 `orders` 五列），字段行末列新增行内 @ 按钮
- Before = `09365fd`（结构页仅六列字典，无行内按钮），After = 本变更（第七列操作位，每字段行一个按钮）
- DOM 机器校验：Before 表头恰为 列名/类型/可空/键/默认值/注释 六列、表格内无按钮；After 表头多一列操作位，五个字段行各有按钮，aria-label = 「把该字段以 @col: 引用插入对话输入框，发送后助手可直接读取该列的结构与数据：<列名>」（id / user_id / product_id / amount / created_at 各一）
- 像素机器校验：四图与底色亮度差 > 60 的文字像素占比 2.61%–3.19%（> 0 判有效）；Before/After 像素差集中在结构表带（y 915–1369 @2x，新增按钮列所在区）

| 主题 | Before（09365fd） | After（本变更） |
|---|---|---|
| 亮色 | [light/before-2-structure-columns.png](light/before-2-structure-columns.png) | [light/after-2-structure-columns.png](light/after-2-structure-columns.png) |
| 暗色 | [dark/before-2-structure-columns.png](dark/before-2-structure-columns.png) | [dark/after-2-structure-columns.png](dark/after-2-structure-columns.png) |

## 操作演示（鼠标点击全流程，亮色）

同一真实产物，页面下方带「会话输入框 · 演示接收区」（明确标注：真实 DSH 中为宿主对话输入框，此处仅展示插件插入的记号）。四步全为鼠标点击，无键盘输入：

1. **demo-1**：对象树点开树壳 → 点连接 → 点 main → 点 orders —— 面包屑出现「@添加到对话」（表引用入口）
2. **demo-2**：鼠标点面包屑「@添加到对话」→ 接收区插入 `@db:c1/main/orders`（发送后助手即可读该表）
3. **demo-3**：选中表后默认落在结构页 —— 每个字段行末列各有一个「@添加到对话」（字段引用入口）
4. **demo-4**：鼠标点 user_id 字段行的 @ 按钮 → 接收区插入 `@col:c1/main/orders/user_id`（与 demo-2 的表引用可并存，发送后助手读表结构按列取数）

| 步骤 | 截图 |
|---|---|
| 1 树中点选表 | [demo/demo-1-table-mention.png](demo/demo-1-table-mention.png) |
| 2 点面包屑 @ 插入表引用 | [demo/demo-2-table-inserted.png](demo/demo-2-table-inserted.png) |
| 3 结构页字段行 @ 入口 | [demo/demo-3-column-mention.png](demo/demo-3-column-mention.png) |
| 4 点字段行 @ 插入列引用 | [demo/demo-4-column-inserted.png](demo/demo-4-column-inserted.png) |

## 限制

对话文本内的 `@db:` / `@col:` 引用 chip 由宿主会话管线（`conversation.user.text.node` 席位）渲染，需要运行中的 DSH 宿主对话才能成像，本离线取证环境无法真实呈现；该链路由 `tests/client/table-mention.spec.ts` 的规则/渲染/注册契约覆盖。
