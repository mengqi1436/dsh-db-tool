# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

个人开发者，在 DSH（DeepSeek 聊天助手，web profile 与桌面端）环境里通过聊天管理自己或项目的数据库。界面文案 zh/en 双语，两类用户都要覆盖。

## Product Purpose

在聊天中安全操作数据库：支持 8 种数据库（MySQL、PostgreSQL、GaussDB、SQLite、Redis、MongoDB、Oracle、达梦 DM），配套侧边栏管理台（连接管理、项目授权、数据浏览、SQL 控制台 4 面板）与随插件分发的 db-admin skill。成功 = 权限、确认、审计完备到敢接入生产库。

## Positioning

聊天操作 + 分级安全链路：连接级 ro/rw 与项目级授权（grants.json，未授权项目一律拒绝）、危险操作先返回 NEEDS_CONFIRMATION 并以一次性 challengeId（绑定语句 SHA256、5 分钟过期）确认、全部执行落 audit.jsonl、凭据永不返回给模型。交互模式对齐 dsh-ssh-tunnel。

## Operating Context

- 宿主为 DSH 插件体系：client 单文件 `client/client.js`（即源码），注入 `@deepseek-ai/dsh-client-locale`；侧边栏宿主为 dsh-better-sidebar（>=0.12.0）。
- 宿主能力硬边界：`window.open` 与 Document PiP 被 deny，UI 方案不得依赖。
- 数据落 `$DSH_HOME/db-tool/`（0700）：connections.json / secrets.json（0600）/ grants.json / audit.jsonl。
- 8 库驱动全部随 npm 包分发，安装零构建步骤；mongodb 驱动 bundle 进发布包以绕过桌面端 app.asar 无法打补丁的限制。
- 近期开发重心：数据浏览面板的内嵌化与布局重排（1.5.6 起的事实记录，非视觉规范）、SQL 控制台多标签升级（CodeMirror 6 编辑器 bundle、服务端事务会话、结果网格，1.5.9 后的工作区改动，尚未发布）。

## Capabilities and Constraints

- DatabaseManager 单工具多 action：list_connections / query / execute / schema / preview / run_script；run_script 在 node:vm 沙箱执行，60s 超时，仅注入受限 `db.{query,execute}`。
- SQL 控制台面板：多标签 CodeMirror 6 编辑器（按方言高亮/补全/格式化，`vendor/codemirror-sql.cjs` bundle，加载失败降级 textarea）、逐条预分类执行（读语句走 /api/query、写语句走 /api/execute，ro 授权跳过写语句）、事务会话（rw 授权，服务端粘性连接，空闲 5 分钟自动回滚并审计）、结果网格（排序/分页/复制/CSV/JSON 导出）。
- GaussDB 认证支持 sha256 与 md5；md5-sha256 混合与 SM3 暂不支持。
- zh/en 双语界面文案；MIT 许可。
- 用户确认的未来方向：打磨现有 4 面板体验 + 扩展能力（更多数据库类型等）；其中数据导出已落地（结果网格 CSV/JSON 导出），面板打磨已落地浏览面板重排与 SQL 控制台升级。

## Brand Commitments

- 名称：dsh-db-tool。无 logo 或既有视觉资产记录。

## Evidence on Hand

- README.md / README_EN.md / CHANGELOG.md 记录完整功能与安装路径。
- 测试体系：vitest 离线 mock 全量（含 e2e-mock 全链路与对抗用例）+ Stryker 变异测试（lib/guard、lib/manager、lib/store）+ DBT_TEST_* 环境变量门控的真机冒烟。
- 无用户证言、案例或基准数据；后续工作不得虚构。

## Product Principles

1. 安全默认：未授权一律拒绝，危险操作必须确认，密码永不回传模型。
2. 聊天优先：库操作主入口是对话，侧边栏面板是配套管理台，不与之竞争。
3. 少而稳：单工具多 action、单文件 client、零构建安装——复杂度压在插件内部。
4. 个人开发者的日常工具：双语、低门槛，同时完备到敢接生产库。
