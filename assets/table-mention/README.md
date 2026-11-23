# 数据浏览 @表引用：改动前后对照取证

- 场景：数据浏览页签 → 展开树壳 → sqlite 示例库（连接「示例库」）→ main → 选中 `orders` 表（结构/数据分段与数据预览就位，面包屑带表名）
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 colorScheme 由 Playwright 上下文显式设为同侧，画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）、文字取 `--dsw-alias-label-primary` 解析值
- Before = `acb5094`（1.9.22），After = 本变更（面包屑新增「@添加到对话」按钮）；两版均为各自提交干净构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API（连接/授权/审计链路全真实，sqlite 示例库 users/orders/products 三表含数据），React 18 走真实渲染路径；页签/席位/语言三个宿主服务以最小桩替代（与 tests/client 同语义）
- DOM 机器校验：Before 面包屑内无任何 `.dbt-btn`（`示例库›main›orders`）；After 面包屑新增按钮文案 `@添加到对话`、aria-label/title 为「把当前表以 @db: 引用插入对话输入框，发送后助手可直接读取该表数据」
- 像素机器校验：四图与底色亮度差 > 60 的文字像素占比 2.61%–2.86%（> 0 判有效）；Before/After 像素差集中位于面包屑按钮区（x 320–497、y 744–799 @2x，即新增按钮所在带），其余区域逐像素一致
- 对话文本内的 `@db:` 引用 chip 由宿主会话管线（`conversation.user.text.node` 席位）渲染，需要运行中的 DSH 宿主对话才能成像，本离线取证环境无法真实呈现；该链路由 `tests/client/table-mention.spec.ts` 的规则/渲染/注册契约覆盖

## 图片

| 主题 | Before | After |
|---|---|---|
| 亮色 | [light/before-1-browse-selected.png](light/before-1-browse-selected.png) | [light/after-1-browse-selected.png](light/after-1-browse-selected.png) |
| 暗色 | [dark/before-1-browse-selected.png](dark/before-1-browse-selected.png) | [dark/after-1-browse-selected.png](dark/after-1-browse-selected.png) |
