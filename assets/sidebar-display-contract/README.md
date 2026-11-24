# 右侧栏激活契约（uiConversation 可选服务）：改动前后对照取证

- 场景：真实宿主 DSH web（0.2.2-rc.5，127.0.0.1:3082，superagent profile）→ 选中会话 → 展开右侧栏 → 引导页（场景 1）→ 点「数据库」卡片打开页签（场景 2，仅 After 可达）。viewport 1600×900，亮/暗各一组，`colorScheme` 由 Playwright 上下文显式设为同侧。
- Before = 仓库 `client.js` 在修复前（1.9.23 原样，`apply()` 裸读 `ctx.uiConversation`）热载进真实宿主；After = 同一文件按本修复（`ctx.get("uiConversation")`）热载进同一宿主。两版均走真实模块加载管线（`plugins/??…` combo，内容寻址 rev 各自变化）、真实 cordis 激活、真实引导页；正文面板连真实宿主侧（安装中的 1.9.19 `dist/`，面板版本徽标因此显示 v1.9.19——本修复只动 client，宿主半区与取证无关）。
- DOM 机器校验：Before 亮/暗引导页均无「数据库」卡片（`hasDbCard:false`），页签不可达（`dbtPanel:0`）；After 亮/暗引导页均出现「数据库\n多库连接管理、项目授权、数据浏览与 SQL 控制台」卡片（`hasDbCard:true`），点开后 `.dbt-panel` 挂载（`dbtPanel:1`），面板五个分段与示例库连接列表渲染完整。
- 宿主启动日志机器校验：Before 亮/暗均报 `web boot: warning: 1 entry did not activate`（dark 细因 `dsh-db-tool: failed: Error: cannot get property "uiConversation" without inject`）；After 亮/暗该警告均为空。
- 像素机器校验：六图与底色亮度差 > 60 的文字像素占比 4.73%–4.94%（> 0 判有效，判废线为 0）。
