# 连接管理卡片式自适应布局 + 一键测试：改动前后对照取证

- 需求：连接管理布局改为卡片式，随侧边栏宽度自适应卡片数量与大小（符合 design 规范），并增加一键测试数据库连通状态。
- 场景：连接管理页签，4 条样本连接（样本 PG 库 postgresql / 本地 SQLite sqlite / 订单 MySQL mysql / 缓存 Redis redis），全部走真实插件 HTTP API 建立与测试（`dist/` 真实构建 + 各自版本真实 `client.js` + React 18 真实渲染路径，React 版本对齐宿主 peer `^18.2.0`）。样本连接 2 通 2 断：PG 与 SQLite 真实连通（绿点 ✓），MySQL/Redis 指向无监听端口真实拒绝（红点 ✗）。
- viewport：宽 500px 与 760px 两档（宿主右侧栏可变宽），高 774px，@2x 采集（成图 1000×1548 / 1520×1548），亮/暗各一组；浏览器 `colorScheme` 由 Playwright 上下文显式设置且与画布同侧，画布底色/文字色用宿主主题 token 解析值（暗 `#151517`/`#f9fafb`、亮 `#ffffff`/`#0f1115`）。
- Before = `2d10971`（1.9.13，inset grouped 单卡行式列表 `dbt-group/dbt-listrow`），After = 本工单改动（卡片网格 `dbt-conncards/dbt-conncard` + 连通状态圆点 + 顶部「一键测试」）。两版均为各自提交干净构建、各自真实 `client.js`。

## 自适应证据（DOM 机器校验，dom-checks.json）

- 500px：`grid-template-columns` 解析为 **2 列 230px**（4 卡 2×2，x=16/254）；760px：**3 列 237.328px**（4 卡 3+1）。同一份 `repeat(auto-fill,minmax(200px,1fr))` 声明，列数与卡片宽度随容器宽度自适应。
- Before 在两档宽度下均为同一张整宽行式列表（468px/720px 单列），卡片列数概念不存在——对照即需求点本身。

## 卡片观感（第二轮，按反馈「不要横向表单式」调整）

- 卡片带 hairline 描边（`1px solid var(--dbt-separator)`）+ 独立表面 + 12px 圆角，每张连接读作一个离散卡片对象；
- kind 胶囊内嵌数据库图标（icon 12px），视觉标识卡片化；
- 地址副行单行省略 + `title` 悬停看全文（对齐表注释 `dbt-treecomment` 的展示语言），不再多行断词（多行断词会读作表单字段）；
- 状态圆点、动作行、一键测试行为不变。

## 一键测试证据

- `after-*-2-tested.png`：点击「一键测试」后全部连接测完的收敛态——每卡状态圆点落定（ok 绿 ×2 / fail 红 ×2，`dbt-statusdot ok|fail`），卡片内 ✓/✗ 文字反馈（含 `serverInfo`/拒绝原因），顶部绿色汇总行「一键测试完成：2 个成功，2 个失败」。
- 4 组 tested 态（亮/暗 × 500/760）均等待汇总行出现后采集，DOM 断言全部收敛（capture.mjs 内 `TESTED-STATE-ALL-CONVERGED` 门禁）。

## 像素机器校验（pixel-checks.json）

- 画布底色四角采样：暗组 `21,21,23`（= `#151517`）、亮组 `255,255,255`（= `#ffffff`），与宿主 token 解析值逐字节一致。
- 与底色亮度差 > 60 的文字像素占比 2.03%–4.78%（全部 > 0，无「整图发黑」）。

## 主题语言

样式全部走既有 `--dbt-*` token（表面/圆角/语义色/等宽字体），深浅主题由既有 `prefers-color-scheme` 媒体查询统一反转，未引入新配色源；状态圆点四态：灰=未测试、黄闪=测试中（`dbt-pulse`，`prefers-reduced-motion` 全局关闭）、绿=成功、红=失败。
