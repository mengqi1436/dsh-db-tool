# 项目授权卡片化：改动前后对照取证

- 需求：项目授权视图改为连接管理同款卡片样式（按数据库类型分组 + 每张连接一张授权卡），方便选择授权模式。
- 场景：项目授权页签，4 条样本连接（生产 PG postgresql / 本地示例 SQLite sqlite / 订单 MySQL mysql / 缓存 Redis redis），授权态 2/4（PG=读写、SQLite=只读、MySQL/Redis 未授权）。全部走真实插件 HTTP API（`dist/` 真实构建 + 各自版本真实 `client.js` + React 18 UMD（18.2.0，对齐宿主 peer `^18.2.0`）真实渲染）；样本库真实：PG 为本机 Docker PostgreSQL 17（127.0.0.1:5433/dbt_shot，orders/products 两表），SQLite 为真实文件库；MySQL/Redis 指向无监听端口（授权页只列连接不做连通测试，地址副行用于区分连接）。
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 `colorScheme` 由 Playwright 上下文显式设置且与画布同侧，画布底色/文字色用宿主主题 token 解析值（暗 `#151517`/`#f9fafb`、亮 `#ffffff`/`#0f1115`）。
- Before = `8f9d30f`（1.9.24，inset grouped 单卡行式列表 `dbt-group/dbt-listrow`，行内紧凑 seg 164px），After = 本工单改动（`dbt-kindgroup` 分组小节 + `dbt-conncards/dbt-conncard` 卡片网格，seg 拉通整卡宽三段均分 204px）。两版均为各自提交干净构建、各自真实 `client.js`。

## DOM 机器校验（dom-checks.json）

- After：4 个 `dbt-kindgroup` 分组小节（节头 mysql/PG/sqlite/redis 各 1，组序按 DB_KINDS）、4 张授权卡（`dbt-conncard`），每卡头行 kind 胶囊（带数据库图标 svg）+ 名称 + 模式徽标（PG 卡「读写」徽标 aria-hidden）+ 地址副行（`dbt-conncard-sub` 单行 nowrap + ellipsis）+ seg（`role=radiogroup`，三段均分各 65px，`aria-checked` 唯一：PG=读写，其余=未授权）。
- seg 整卡宽：segWidth 204 = 卡片内容宽 204（500px 下卡片 230 − 2×12 padding − 2×1 border），`segStretchesCard=true`；Before 行内 seg 仅 164px 自然宽。
- Before：1 张 `dbt-group` 卡 4 行 `dbt-listrow`，无分组小节；两版 radiogroup/aria-checked 契约一致（12 个 radio）。
- 交互态（`after-2-grants-interacted`）：点击「订单 MySQL」卡「只读」→ 摘要行变「已授权 3/4 个连接」，卡内 `aria-checked` 移至「只读」、灰「只读」徽标出现；再点「未授权」还原 2/4（授权链路 PUT/DELETE `/grants` 不变）。

## 像素机器校验（pixel-checks.json）

- 画布底色四角采样：暗组 `21,21,23`（= `#151517`）、亮组 `255,255,255`（= `#ffffff`），与宿主 token 解析值逐字节一致（cornerOk=true）。
- 与底色亮度差 > 60 的文字像素占比 2.51%–3.23%（全部 > 0，无「整图发黑」）。

## 主题语言

样式全部复用既有 `--dbt-*` token 与连接管理卡片类（`dbt-kindgroup/dbt-conncards/dbt-conncard/dbt-conncard-head/-name/-sub`、`dbt-seg`），未新增配色源与新的 CSS 规则；seg 三段均分与整卡拉伸走内联样式（`flex:1 1 0` + `width:100%` + `box-sizing:border-box`），不影响其他视图的 `dbt-seg` 使用。
