# 数据浏览对象树表行注释布局：改动前后对照取证

- 场景：数据浏览页签 → 展开树壳 → 展开示例库（postgresql）→ dbt_shot 库 → public schema → 表清单（未选表）
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 colorScheme 由 Playwright 上下文显式设为同侧，画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）
- Before = `52c4b9c`（1.9.12，PR #24 的拼接形态：表名与注释以「 · 」连在同一标签里），After = 本提交；两版均为各自提交干净构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API（授权/审计链路全真实），React 走真实渲染路径
- 数据源：本机专用 PostgreSQL 17 集群（127.0.0.1:5433，仅 dbt_shot/postgres 两库），orders/products/users 三表 + v_order_stats 视图，`COMMENT ON TABLE` 中文注释；连接/授权经真实插件 API 建立（ro 授权）
- DOM 机器校验（tree-rows.json）：before 表行为「orders · 订单主表」拼接单串、视图为「v_order_stats · VIEW · 订单状态统计视图」；after 名称列为纯表名/名称+类型，注释独立右列（orders 行名称=`orders`、注释块=订单主表，视图行名称=`v_order_stats · VIEW`、注释块=订单状态统计视图）
- 几何机器校验：orders 行隔断位于名称右缘（x≈415）之后、注释（x≈428–472）之前，宽 1px × 高 21px，颜色为 `--dbt-separator` 解析值（暗 rgba(120,120,128,.24) / 亮 rgba(60,60,67,.18)）；注释右缘 472 = 行右缘 484 − 12px 行内边距；注释 11px/400、`--dbt-text-secondary` 解析值
- 像素机器校验：四图与底色亮度差 > 60 的文字像素占比 0.98%–2.24%（> 0 判有效）；orders 行带内隔断列连续非底色段 after 42px（= 21px × 2 DPR）而 before 仅 2px，确认隔断已实际绘制且基线没有
