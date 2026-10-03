# dsh-db-tool

[English](README_EN.md) | 简体中文

DSH 社区插件：在聊天中安全操作数据库，配套侧边栏管理台与 `db-admin` skill。架构与交互模式对齐 [dsh-ssh-tunnel](https://github.com/thirsty5034/dsh-ssh-tunnel)。

## 功能

- **8 种数据库**：MySQL、PostgreSQL、GaussDB、SQLite、Redis、MongoDB、Oracle、达梦（DM）
- **DatabaseManager 单工具多 action**：`list_connections / query / execute / schema / preview / run_script`（`run_script` 在 node:vm 沙箱中执行，60s 超时，仅注入受限 `db.{query,execute}` 句柄）
- **分级权限**：连接级只读（ro）/读写（rw）+ 项目级授权（`grants.json`：projectPathKey → 连接 → 模式）；未授权项目一律拒绝
- **危险操作确认**：DDL / FLUSHALL / dropDatabase 等先返回 `NEEDS_CONFIRMATION`，对话内（模型经 ask）或 SQL 控制台（弹窗）确认后携一次性 `challengeId`（绑定语句 SHA256、5 分钟过期）重试
- **审计**：全部执行落 `audit.jsonl`（语句、危险级、是否确认、结果）
- **侧边栏 4 面板**（dsh-better-sidebar，zh/en）：连接管理、项目授权、数据浏览、SQL 控制台
- **db-admin skill**：随插件分发，覆盖 8 库方言速查、安全规范、确认流程

### SQL 控制台

侧边栏 SQL 控制台面板已升级为 Navicat 式多标签编辑器（CodeMirror 6）：

- **多标签**：新建/关闭/切换查询标签，每个标签独立保存 SQL、结果与历史（历史上限 50 条，可展开点击回填）
- **语法高亮与补全**：按方言切换——mysql→MySQL、postgresql/gaussdb→PostgreSQL、sqlite→SQLite、oracle/dmdb→PL/SQL；Redis/Mongo 为关键字/方法补全的纯文本编辑；表列元数据自动拉取注入补全（上限 50 表）。编辑器 bundle（`vendor/codemirror-sql.cjs`，`npm run build:codemirror` 生成，`npm run build` 自动串接）加载失败时静默降级 textarea
- **快捷键**：`Ctrl/Cmd+Enter` 执行全部，`Ctrl/Cmd+Shift+Enter` 执行选中
- **格式化**：sql-formatter 按方言格式化，解析失败回退原文
- **逐条执行**：客户端预分类读/写语句分别路由 `/api/query` 与 `/api/execute`，只读授权下写语句自动跳过并标注；出错可一键定位到对应语句起始处
- **事务**：rw 授权下可开始/提交/回滚（服务端粘性连接会话；空闲 5 分钟超时自动回滚并审计，授权回收/降级即时生效）
- **结果网格**：表头三态排序、50 行/页分页、单元格点击复制、CSV/JSON 导出

## 数据布局

`$DSH_HOME/db-tool/`（0700）：

| 文件 | 内容 |
|---|---|
| `connections.json` | 连接定义（`urlSafe` 中密码脱敏为 `***`） |
| `secrets.json` | 0600，密码/URL 凭据，永不返回给模型 |
| `grants.json` | 项目授权（归一化路径 → connId → ro/rw） |
| `audit.jsonl` | 追加式审计日志 |

## 安装

8 种数据库驱动全部随 npm 包分发（SQLite 优先用 Node 内置 `node:sqlite`，可选 `better-sqlite3`；GaussDB 驱动为华为云官方 npm 包 `gaussdb-node`），无需任何构建步骤。GaussDB 认证支持 sha256 与 md5，md5-sha256 混合与 SM3 暂不支持。

唯一的一次性交互来自 oracledb：其 install 脚本会被 pnpm 默认拦截并使首次安装报告失败——在 DSH 插件安装界面点 **"Allow these scripts and retry"** 即可完成安装（该脚本仅做 Node 版本检查与横幅打印，批准无风险；批准持久化到 profile，后续升级不再提示）。

```bash
# npm（推荐）
dsh plugin --profile web add dsh-db-tool

# GitHub 源码
dsh plugin --profile web add "dsh-db-tool@github:mengqi1436/dsh-db-tool"

# 本地开发
dsh plugin --profile web add "link:E:\path\to\dsh-db-tool"
```

### 桌面端安装

DSH 桌面端 0.2.0-rc.2+ 捆绑了 `dsh` 命令，全程无需另装 Node 或 pnpm：

1. **首次使用**：打开桌面端菜单栏，点 **"Manage dsh command"（管理 dsh 命令）**，安装捆绑的 CLI——该操作把 `dsh` 命令注册到系统 PATH。
2. **安装插件**（必须钉精确版本：`@latest` 会因 release-age 校验回落到旧版）：

   ```bash
   dsh plugin --profile desktop add dsh-db-tool@1.4.0 --registry=https://registry.npmjs.org/
   ```

   已有 npm 镜像源偏好的用户，可把 `--registry` 替换为自己的镜像地址。
3. **重启桌面端**生效。

mongodb 驱动已 bundle 进发布包（`vendor/mongodb-driver.cjs`），依赖树不含 mongodb/punycode——桌面端宿主打包在 `app.asar` 内、无法应用宿主补丁，本插件免补丁可直接安装加载。

## 测试

```bash
npm test        # 离线 mock 全量（含 e2e-mock 全链路与对抗用例）
npx tsc --noEmit
npx stryker run # 变异测试（范围 lib/guard + lib/manager + lib/store，报告 reports/mutation/）
```

真机冒烟（设了才跑）：`DBT_TEST_MYSQL_URL / DBT_TEST_PG_URL / DBT_TEST_REDIS_URL / DBT_TEST_DM_CONNECT / DBT_TEST_MONGO_URL / DBT_TEST_ORACLE_CONNECT`。GaussDB 与 Oracle/Mongo 官方要求均按官方文档实现，未真机验证处以代码内标注为准。

## 目录结构

```
lib/        host 插件（store / adapters×8 / guard / manager / http / index）
client/     侧边栏单文件产物（client.js，即源码）
skills/     db-admin skill
scripts/    构建与工具脚本（mongodb 驱动 / CodeMirror 编辑器 bundle、DSH 宿主热修复 patch:dsh 等）
patches/    DSH 宿主 dsh-app-boot 热修复补丁（patch:dsh 按宿主版本选用）
docs/       预留（当前为空）
tests/      vitest（离线 mock + DBT_TEST_* 门控真机）
vendor/     mongodb-driver.cjs 与 codemirror-sql.cjs bundle（gitignore，发布经 files 白名单收录）
```

## 许可证

MIT
