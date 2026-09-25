# dsh-db-tool

DSH 社区插件：在聊天中安全操作数据库，配套侧边栏管理台与 `db-admin` skill。架构与交互模式对齐 [dsh-ssh-tunnel](https://github.com/thirsty5034/dsh-ssh-tunnel)。

## 功能

- **8 种数据库**：MySQL、PostgreSQL、GaussDB（openGauss 官方驱动）、SQLite、Redis、MongoDB、Oracle、达梦（DM）
- **DatabaseManager 单工具多 action**：`list_connections / query / execute / schema / preview / run_script`
- **分级权限**：连接级只读（ro）/读写（rw）+ 项目级授权（`grants.json`：projectPathKey → 连接 → 模式）；未授权项目一律拒绝
- **危险操作确认**：DDL / FLUSHALL / dropDatabase 等先返回 `NEEDS_CONFIRMATION`，对话内（模型经 ask）或 SQL 控制台（弹窗）确认后携一次性 `challengeId`（绑定语句 SHA256、5 分钟过期）重试
- **审计**：全部执行落 `audit.jsonl`（语句、危险级、是否确认、结果）
- **侧边栏 4 面板**（dsh-better-sidebar，zh/en）：连接管理、项目授权、数据浏览、SQL 控制台
- **db-admin skill**：随插件分发，覆盖 8 库方言速查、安全规范、确认流程

## 数据布局

`$DSH_HOME/db-tool/`（0700）：

| 文件 | 内容 |
|---|---|
| `connections.json` | 连接定义（`urlSafe` 中密码脱敏为 `***`） |
| `secrets.json` | 0600，密码/URL 凭据，永不返回给模型 |
| `grants.json` | 项目授权（归一化路径 → connId → ro/rw） |
| `audit.jsonl` | 追加式审计日志 |

## 安装

```bash
# 发布模式
dsh plugin --profile web add "dsh-db-tool@github:<user>/dsh-db-tool"

# 本地开发
pnpm dsh web --patch ./cordis.patch.yml
```

GaussDB 官方驱动未发布 npm，需先构建 vendor：`npm run build:gaussdb`（PowerShell）或 `bash scripts/build-gaussdb.sh`；oracledb 安装脚本需 `npm approve-scripts oracledb`。详见 [docs/install.md](docs/install.md)。

## 安全模型

- HTTP API 仅同源（`ctx.webServer` prefix `/dsh-db-tool/api`）+ loopback/Origin trust 校验（等价 ssh-tunnel `http-trust`），body 限 2MB
- ro 双保险：服务层拦截 + 驱动会话级 `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`（pg/gaussdb）、readonly 打开（SQLite）
- SQL 参数绑定 + 标识符白名单（`[A-Za-z0-9_$]+` + 引用包裹）；MySQL `multipleStatements:false`；Redis 元数据走 `SCAN`（禁 `KEYS`）；Mongo 递归拒 `$where`
- `run_script`：node:vm 独立 context、60s 超时、无 require/process/网络/文件系统，仅注入受限 `db.{query,execute}` 句柄
- 已知边界：对话内确认为提示级强制 + 审计兜底；DSH 无硬中断通道前，恶意对话仍可能诱导用户确认，请配合最小权限数据库账号使用

## 测试

```bash
npm test        # 离线 mock 全量
npx tsc --noEmit
```

真机冒烟（设了才跑）：`DBT_TEST_MYSQL_URL / DBT_TEST_PG_URL / DBT_TEST_REDIS_URL / DBT_TEST_DM_CONNECT / DBT_TEST_MONGO_URL / DBT_TEST_ORACLE_CONNECT`。GaussDB 与 Oracle/Mongo 官方要求均按官方文档实现，未真机验证处以代码内标注为准。

## 目录

```
lib/        host 插件（store / adapters×8 / guard / manager / http / index）
client/     侧边栏单文件产物（client.js，即源码）
skills/     db-admin skill
scripts/    GaussDB vendor 构建（sh / ps1）
docs/       安装、HTTP 契约（api-contract.md）、skill 说明
tests/      vitest（离线 mock + DBT_TEST_* 门控真机）
vendor/     gaussdb-pg 构建产物（gitignore，不入库）
```
