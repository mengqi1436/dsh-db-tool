# 项目授权卡片三态着色：改动前后对照取证

- 需求：项目权限（授权）卡片按授权等级着色——未授权=灰、只读=绿、读写=红，一眼可辨各连接的授权等级。
- 场景：项目授权页签，4 条样本连接（生产 PG postgresql / 本地示例 SQLite sqlite / 订单 MySQL mysql / 缓存 Redis redis），授权态 2/4（PG=读写、SQLite=只读、MySQL/Redis 未授权），正好覆盖三种着色状态。全部走真实插件 HTTP API（真实 `dist/` 构建 + 各自版本真实 `client.js` + React 18 UMD（18.2.0，对齐宿主 peer `^18.2.0`）真实渲染，渲染前按宿主 `apply()` 同款先 `ensureStyles()` 注入完整样式表）；样本库真实：PG 为本机 Docker PostgreSQL 17（127.0.0.1:5433/dbt_shot，orders/products 两表 120/40 行），SQLite 为真实文件库；MySQL/Redis 指向无监听端口（授权页只列连接不做连通测试）。
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 `colorScheme` 由 Playwright 上下文显式设置且与画布同侧，画布底色/文字色用宿主主题 token 解析值（暗 `#151517`/`#f9fafb`、亮 `#ffffff`/`#0f1115`）。
- Before = `a516c08`（1.9.25：读写=绿徽标、只读=灰徽标、未授权无徽标，卡片描边统一灰），After = 本工单改动（未授权=灰、只读=绿、读写=红：徽标与整卡描边同色，未授权也渲染灰色「未授权」徽标）。两版均为各自提交干净构建、各自真实 `client.js`（Before 为改动前工作树快照）。

## DOM 机器校验（dom-checks.json）

- 每张授权卡（含 seg `role=radiogroup` 的 `dbt-conncard`，排除常驻 DOM 的管理页卡片）：徽标文字、徽标颜色、整卡描边色、seg `aria-checked` 当前段。
- Before（亮/暗一致语义）：PG 卡「读写」= `--dbt-success` 绿、SQLite 卡「只读」= `--dbt-text-secondary` 灰、MySQL/Redis 无徽标，四卡描边均为默认 `--dbt-separator` 灰。
- After：PG 卡「读写」= `--dbt-danger` 红（描边同色）、SQLite 卡「只读」= `--dbt-success` 绿（描边同色）、MySQL/Redis 卡「未授权」= `--dbt-text-secondary` 灰（描边同色）；seg `aria-checked` 契约不变。
- 交互态（`*-2-grants-interacted`）：点击「订单 MySQL」卡「只读」→ 摘要行变「已授权 3/4 个连接」，After 的 MySQL 卡徽标/描边变绿（Before 为灰徽标、描边不变）；随后点「未授权」还原 2/4（授权链路 PUT/DELETE `/grants` 不变），再行采集其余场景，避免状态串场。

## 像素机器校验（pixel-checks.json）

- 画布底色采样：暗组 `21,21,23`（= `#151517`）、亮组 `255,255,255`（= `#ffffff`），与宿主 token 解析值逐字节一致（cornerOk=true）。
- 与宿主画布亮度差 > 60 的前景像素占比 2.88%–3.96%（全部 > 0，无「整图发黑」）。
- After 暗图逐色扫描：`#ff453a` 红（读写卡描边）2989 像素、`#30d158` 绿（只读卡描边）2965 像素，三态着色在成图中真实可见。
