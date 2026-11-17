# 连接管理按数据库分类 + PostgreSQL 简称 + 版本徽标刷新：改动前后对照取证

- 需求：连接管理按数据库类型分组展示；PostgreSQL 界面展示统一使用简称 PG；插件更新后版本徽标能正确刷新。
- 场景：连接管理页签，6 条样本连接（生产 PG / 分析 PG postgresql ×2、订单 MySQL mysql、演示库 A / 演示库 B sqlite ×2、缓存 Redis redis），全部走真实插件 HTTP API 建立（`dist/` 真实构建 + 各自提交真实 `client.js` + React 18 真实渲染路径，React 版本对齐宿主 peer `^18.2.0`）。sqlite 两库为真实 sqlite 文件（各 2 表 2 行），PG/MySQL/Redis 指向无监听地址（取证只看列表分组，不触发连通测试）。
- viewport：宽 500px 与 760px 两档（宿主右侧栏可变宽），高 774px，@2x 采集（成图 1000×1548 / 1520×1548），亮/暗各一组；浏览器 `colorScheme` 由 Playwright 上下文显式设置且与画布同侧，画布底色/文字色用宿主主题 token 解析值（暗 `#151517`/`#f9fafb`、亮 `#ffffff`/`#0f1115`，截图内四角采样逐字节核对，见 pixel-checks.json）。
- Before = `c3b19f2`（1.9.15，单一平铺卡片网格，kind 胶囊显示全称 `postgresql`，版本徽标 v1.9.15），After = 本工单改动（按类型分组小节 + PG 简称 + 版本徽标随面板可见重新拉取，版本徽标 v1.9.16）。两版均为各自提交干净构建、各自真实 `client.js`。

## DOM 机器校验（shot.mjs 内联门禁，全部收敛后才允许采集）

- Before（两档宽度一致）：`dbt-kindgroup` 0 个、`dbt-conncards` 1 个、卡片 6 张；卡片 kind 胶囊依次为 `postgresql, postgresql, mysql, sqlite, sqlite, redis`。
- After：`dbt-kindgroup` 4 个、`dbt-conncards` 4 个、卡片 6 张；节头依次为 `mysql1 → PG2 → sqlite2 → redis1`（内置类型清单序：mysql → postgresql → gaussdb → sqlite → redis → mongodb → oracle → dmdb → sqlserver，空组不渲染）；分组后卡片胶囊依次为 `mysql, PG, PG, sqlite, sqlite, redis`（不再出现 `postgresql` 全称）。
- 版本徽标：Before 页 `v1.9.15`、After 页 `v1.9.16`（各自 dist 真实 `/api/version` 下发）。

## 像素机器校验（pixel-checks.json）

- 画布底色四角采样：暗组 `21,21,23`（= `#151517`）、亮组 `255,255,255`（= `#ffffff`），与宿主 token 解析值逐字节一致。
- 与底色亮度差 > 60 的文字像素占比 2.38%–3.86%（全部 > 0，无「整图发黑」）。

## 主题语言

样式全部走既有 `--dbt-*` token（表面/圆角/等宽字体/次级文字色），节头为「数据库图标 + 类型名（mono semibold）+ 数量胶囊」，深浅主题由既有 `prefers-color-scheme` 媒体查询统一反转，未引入新配色源。
