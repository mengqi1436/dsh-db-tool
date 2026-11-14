# 数据浏览对象树表注释：改动前后对照取证

- 场景：数据浏览页签 → 展开示例库（postgresql）→ dbt_shot 库 → public schema → 表清单
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 colorScheme 与画布底色同侧（亮 #ffffff / 暗 #151517，宿主主题 token 解析值）
- Before = 65acbc3（改动前 master），After = 277fcbd（本提交）；两版均为干净 worktree 真实构建 dist 后加载真实 client.js，React 走真实渲染路径
- 数据源：本机专用 PostgreSQL 17 集群（127.0.0.1:5433，仅 dbt_shot/postgres 两库），orders/products/users 三表 + v_order_stats 视图，COMMENT ON TABLE 中文注释；连接/授权经真实插件 API 建立（ro 授权，授权/审计链路全真实）
- DOM 机器校验：before 表行「orders · TABLE」（无注释、类型后缀误挂），after「orders · 订单主表」（注释可见、普通表不再挂 TABLE）——逐行文本见 tree-rows.json
- 像素机器校验：四图与底色亮度差 > 60 的文字像素占比 0.98%–2.24%（> 0 判有效）
