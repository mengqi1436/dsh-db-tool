# 连接弹窗对齐 Navicat：改动前后对照取证

- 需求：连接的弹窗与样式（含连接状态入口与连接方式）与 Navicat 一致。改法：连接配置从「替换列表的内联表单卡」重构为「Navicat 连接窗口形态的覆盖层弹窗」——标题栏 + 左导航页签（常规 / SSL / 高级）+ 底部操作条（测试连接靠左，保存/取消靠右），弹窗浮在连接卡片列表之上。
- 场景：连接管理页签，4 条样本连接（订单 MySQL / 分析 PG / 缓存 Redis / 报表 MSSQL，各自真实字段写入真实 store），点「新建连接」（或对 MSSQL 卡点「编辑」）。
- viewport：760×774 主档（弹窗对比）+ 500×774（窄栏下弹窗降级），@2x 采集（成图 1520×1548 / 1000×1548），亮/暗各一组；浏览器 `colorScheme` 由 Playwright 上下文显式设置且与画布同侧。取证页画布色 = 宿主主题 token 解析值（暗 `#151517`、亮 `#ffffff`），用真实绘制元素承载（`backdrop-filter` 采样不到 body 传播的画布背景；宿主实机里弹窗背后正是宿主自己绘制的内容层，取证页等同复刻）。
- Before = `d4a0960`（1.9.18，点「新建连接」后整页替换为内联表单卡），After = 本工单改动（覆盖层弹窗 + 页签 + 底部操作条）。两版均为各自提交/工作区真实 `client.js`，走同一真实 `dist/` HTTP 链路（`handleDbToolRequest` 生产路由）与真实 React 18（UMD 18.2.0，宿主 peer `^18.2.0`）真实渲染。

## 场景清单（18 张）

| 文件（light/ dark 同名） | 场景 |
| --- | --- |
| `before-newconn-form-*-w760` | Before：点「新建连接」→ 旧版内联表单卡（类型/名称/ID/SSL 一行 + URL/分字段切换 + 底部保存/测试/取消） |
| `after-newconn-general-*-w{760,500}` | After：新建连接弹窗「常规」页（类型 + 连接名 + 连接方式切换 + 主机/端口/库名/用户名/密码，oracle 另有服务名/SID 下拉） |
| `after-newconn-ssl-*-w{760,500}` | After：「SSL」页（启用 SSL 开关 + 边界说明；仅 mysql/pg 系/mongo/redis 显示该页签） |
| `after-newconn-advanced-*-w{760,500}` | After：「高级」页（连接 ID + 按库高级项） |
| `after-edit-sqlserver-advanced-*-w{760,500}` | After：编辑「报表 MSSQL」→「高级」页 TLS 族（加密模式/最低 TLS 版本/信任证书/校验名/受信 CA），对齐 Navicat 把 Use encryption / Trust Server Certificate 放在高级页的习惯 |

## Navicat 侧依据（结构对照）

- Navicat Premium 18 官方手册 Chapter 4 Connection：连接窗口 General / SSL / Advanced 页签分区；SSL 页签仅 MySQL/PostgreSQL/MariaDB/MongoDB/Redis；SQL Server 的加密与信任证书开关在 Advanced 页；Oracle 服务名/SID 在 General 页。项目侧 `SSL_TAB_KINDS`（mysql/postgresql/gaussdb/mongodb/redis）与适配器真实消费 `conn.ssl` 的集合一致，也与 Navicat 的 SSL 页签集合一致。
- 本机无法完成 Navicat 实机截图：Navicat Premium Lite 18（免费版）与 Navicat Premium 17 试用版的 Linux AppImage 均在启动后强制 Navicat ID 登录（AT-SPI 无障碍树取证确认两版登录门），无法创建账号越过。改用官方手册结构文档 + 对两版安装包的静态取证（版本字符串 `Navicat Premium Lite 18.0.3 (Simplified Chinese)`、`Navicat Premium 17.3.10 (Simplified Chinese)`）。

## DOM 机器校验（dom-checks.json）

- 页签顺序：常规 / SSL / 高级（mysql）；底部操作条按钮序：测试连接 → 保存 → 取消；`role=dialog` + `aria-modal=true` + 覆盖层弹窗；**弹窗打开时 4 张连接卡片仍在弹窗背后**（`cardsStillThere: 4`，浮层惯用法与 DangerDialog/PassphraseDialog 一致）。

## 像素机器校验（pixel-checks.json）

- 画布四角采样：无遮罩场景（before-*）= 宿主 token 原值（暗 `21,21,23` / 亮 `255,255,255`）；有遮罩场景（after-*，`.dbt-overlay` rgba(0,0,0,.4)+blur 盖满全屏）= 画布 × 0.6（暗 `12,12,13` / 亮 `153,153,153`），逐字节核对。
- 与角值亮度差 > 60 的文字像素占比全部 > 0（0.68%–40.71%），无「整图发黑」。
