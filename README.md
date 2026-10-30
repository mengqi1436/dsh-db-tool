# dsh-db-tool

[English](README_EN.md) | 简体中文

> **本仓库为修复 fork**：修复 ro（只读）授权下数据库浏览永久挂起（mysql2 连接钩子 error 监听致连接卡死）与 Windows 路径大小写授权错位（详见 [CHANGELOG](CHANGELOG.md) 1.7.3 / 1.7.4）。修复已向上游提 PR；在合并前，请从**本仓库**安装以获得修复版本。
> 上游仓库：[mengqi1436/dsh-db-tool](https://github.com/mengqi1436/dsh-db-tool)

DSH 社区插件：在聊天中安全操作数据库，配套侧边栏管理台与 `db-admin` skill。架构与交互模式对齐 [dsh-ssh-tunnel](https://github.com/thirsty5034/dsh-ssh-tunnel)。

## 功能

- **9 种数据库**：MySQL、PostgreSQL、GaussDB、SQLite、Redis、MongoDB、Oracle、达梦（DM）、SQL Server
- **DatabaseManager 单工具多 action**：`list_connections / query / execute / schema / preview / run_script`（`run_script` 在 node:vm 沙箱中执行，60s 超时，仅注入受限 `db.{query,execute}` 句柄）
- **分级权限**：连接级只读（ro）/读写（rw）+ 项目级授权（`grants.json`：projectPathKey → 连接 → 模式）；未授权项目一律拒绝
- **危险操作确认**：DDL / FLUSHALL / dropDatabase 等先返回 `NEEDS_CONFIRMATION`，对话内（模型经 ask）或 SQL 控制台（弹窗）确认后携一次性 `challengeId`（绑定语句 SHA256、5 分钟过期）重试
- **审计**：全部执行落 `audit.jsonl`（语句、危险级、是否确认、结果）
- **侧边栏 4 面板**（dsh-better-sidebar，zh/en）：连接管理、项目授权、数据浏览、SQL 控制台
- **db-admin skill**：随插件分发，覆盖 9 库方言速查、安全规范、确认流程

### SQL 控制台

侧边栏 SQL 控制台面板已升级为 Navicat 式多标签编辑器（CodeMirror 6）：

- **多标签**：新建/关闭/切换查询标签，每个标签独立保存 SQL、结果与历史（历史上限 50 条，可展开点击回填）
- **语法高亮与补全**：按方言切换——mysql→MySQL、postgresql/gaussdb→PostgreSQL、sqlite→SQLite、oracle/dmdb→PL/SQL、sqlserver→T-SQL（`@codemirror/lang-sql` 的 MSSQL 方言）；Redis/Mongo 为关键字/方法补全的纯文本编辑；表列元数据自动拉取注入补全（上限 50 表）。编辑器 bundle（`vendor/codemirror-sql.cjs`，`npm run build:codemirror` 生成，`npm run build` 自动串接）加载失败时静默降级 textarea
- **快捷键**：`Ctrl/Cmd+Enter` 执行全部，`Ctrl/Cmd+Shift+Enter` 执行选中
- **格式化**：sql-formatter 按方言格式化（sqlserver→`transactsql`），解析失败回退原文
- **逐条执行**：客户端预分类读/写语句分别路由 `/api/query` 与 `/api/execute`，只读授权下写语句自动跳过并标注；出错可一键定位到对应语句起始处
- **批分隔符 GO**：支持 `GO` 与 `GO n`——按 sqlcmd 语义把上一批重复执行 n 次（`GO 0` / `GO 1` 均等同 1 次），`GO` 行本身不产生语句；重复计数上限 **1000**，超出按 1000 截断，防止一次执行被放大成天量请求
- **事务**：rw 授权下可开始/提交/回滚（服务端粘性连接会话；空闲 5 分钟超时自动回滚并审计，授权回收/降级即时生效）
- **结果网格**：表头三态排序、50 行/页分页、单元格点击复制、CSV/JSON 导出

## SQL Server 支持范围与边界

覆盖 SQL Server 2008/2008R2 → 2022 与 Azure SQL Database；方言与元数据只使用 SQL Server 2005+ 的通用写法。

- **连接形态**：唯一形态为 `sqlserver://user:password@host:port/db`，支持 query 参数 `encrypt` / `trustServerCertificate` / `tdsVersion` / `instanceName` / `useUTC` / `tlsMinVersion`（参数名大小写不敏感；分字段表单同样支持这几个键）。`tdsVersion` 默认 `7_4`，可配 `7_3_A` / `7_3_B` / `7_2` / `7_1`；端口默认 1433，指定 `instanceName` 时按 tedious 语义忽略端口、走 SQL Browser（UDP 1434）；`tlsMinVersion` 可配 `TLSv1` / `TLSv1.1` / `TLSv1.2`（区分大小写，缺省不设置＝沿用 Node 默认下限 TLSv1.2），只写 `cryptoCredentialsDetails.minVersion`、不设 `ciphers`；**不含 `TLSv1.3`**——底层 tedious 在未指定上限时把 TLS 上限封顶在 `TLSv1.2`，设 `TLSv1.3` 会让最小版本大于最大版本，握手必然失败；`ssl=true` 等价于 `encrypt=true`。**不接受** ADO.NET 键值连接串（`Server=...;Database=...`）。
  默认 `encrypt=true` + `trustServerCertificate=false`（与 mssql 官方默认一致）。**连 SQL Server 2008/2008R2 前先分清两类 TLS 失败，它们的解法互不通用**：① **证书类**（`self signed certificate` / `unable to verify` / `CERT_`）——旧实例多为自签名证书，在 URL 追加 `?trustServerCertificate=true`；服务器未强制加密时也可用 `?encrypt=false`；② **协议版本类**（`UNSUPPORTED_PROTOCOL` / `no protocols available` / `alert protocol version`）——客户端与服务端没有共同的 TLS 协议版本，握手在版本协商阶段就失败、证书校验根本没执行，故 `trustServerCertificate=true` 对它**无效**。根治办法是在服务端启用 TLS 1.2（2008 R2 SP3 装 KB4057113、2008 SP4 装 KB4057114）；暂时动不了服务端时用 `?tlsMinVersion=TLSv1` 让客户端下探到 TLS 1.0（Electron 内置的 BoringSSL 仍保留 TLS 1.0 码，实测可握手；上限仍由 tedious 封顶在 TLS 1.2）。两类场景都建议显式写 `?tdsVersion=7_3_A`（2008）/ `7_3_B`（2008R2）。
- **认证边界**：仅 SQL 认证（`user` / `password`）。**不支持 Windows 集成认证**，**不支持 Azure AD 认证**。
- **方言**：参数占位符对外只写 `?`，适配器内部按顺序重写为 `@p1..@pN`；标识符用 `[x]`，名字中的 `]` 双写为 `]]`；库/表/列元数据只走 `sys.*` catalog views（`sys.databases` / `sys.schemas` / `sys.objects` / `sys.columns` / `sys.types` / `sys.indexes` / `sys.extended_properties`），只用 2005+ 通用写法。
- **分页按版本分流**：连接后查 `SERVERPROPERTY('ProductMajorVersion')`（取不到时回退解析 `ProductVersion` 前缀）并缓存；major ≥ 11（2012+，含 Azure SQL 的 12）用 `ORDER BY (SELECT NULL) OFFSET n ROWS FETCH NEXT m ROWS ONLY`，< 11（2008/2008R2）降级 `ROW_NUMBER() OVER (ORDER BY (SELECT NULL))` 子查询；探测失败同样走降级分支。
- **decimal 精度分侧口径**：浏览侧（`query` / `preview` / 数据浏览网格）**不保证 decimal/numeric 逐位保真**——tedious 在解析阶段已把 decimal 转成 JS number（>15 有效位即丢精度），适配器转字符串只能防后续数值化，且 >1e21 会出现科学计数法；需要逐位保真时请在 SQL 里显式 `CONVERT(nvarchar(...), col)`。数据传输（transfer）读端已内建该转换（`CONVERT(nvarchar(64), col)`），写入时按字符串绑定，精度不经过 JS 浮点。
- **类型搬运口径（传输侧）**：`hierarchyid` / `geometry` / `geography` 按二进制（bytes）保真搬运，目标端建 `VARBINARY(MAX)`——**UDT 类型语义不保留**（目标端没有 `ST_*` / `hierarchyid` 方法）；`sql_variant` 读端 `CONVERT(nvarchar(max), col)` 转文本，**原类型信息丢失**（驱动按值的实际类型返回标量，无法统一搬运）；`text` / `ntext` / `xml` → `NVARCHAR(MAX)`，源 `varchar` / `char` 长度 4001–8000 也映射为 `NVARCHAR(MAX)` 类（保容量，不做隐式收窄），`varbinary` / `image` / `rowversion` → `VARBINARY(MAX)`，`decimal` / `numeric` / `money` → `DECIMAL`；`datetime2` 读端 `CONVERT(nvarchar(33), col, 126)`、`time` 用 `CONVERT(nvarchar(16), col, 126)` 保真。
- **ro 只读强度弱于 MySQL/PG**：SQL Server 没有等价的会话级只读语句。ro 授权下适配器 query 闸门共五道：① 首词白名单（`select / with / show / describe / desc / explain / use / set / help / table`）；② 拒绝多语句（词法级：顶层分号之后出现任何内容即拒）；③ 拒绝 `SELECT ... INTO`（词法 token 级判定，字符串、方括号标识符与注释内的 `into` 不误伤）；④ 拒绝 `WITH ... (INSERT|UPDATE|DELETE|MERGE)`；⑤ 拒绝 `OPENQUERY` / `OPENROWSET` / `OPENDATASOURCE`（其字符串参数会在远端/外部数据源执行任意语句、不可审计，连合法的只读远端查询也一律拒）。服务层另拦 `execute`，guard 层对同样两类「读头写体」还会要求确认。**这仍是应用层拦截，不等同于数据库侧的只读会话**；需要强隔离时请给连接配数据库侧只读账号。
- **数据传输**：写入走参数化多行 `VALUES` INSERT（TDS 单语句参数上限 2100、`VALUES` 表值构造器单语句最多 1000 行，每语句行数取两者最小值；replace/ignore 走 `MERGE`）。传输分页同样按目标库版本分流：2012+ 用 `OFFSET/FETCH`，2008/2008R2 降级——有序游标（keyset/range）用 `SELECT TOP (n) ... ORDER BY key`，无分片键的 offset 全序与 `keyAt` 切块用 `ROW_NUMBER() OVER (...)` 子查询；版本探测失败时按 0 走保守降级，因此**传输在 SQL Server 2008/2008R2 同样可用**。已知限制：目标表已存在且该列为 IDENTITY 时，写入显式值会报错 544（当前不自动 `SET IDENTITY_INSERT ON`）；传输自动建表不生成 IDENTITY 列。建表 DDL 在显式事务中可回滚，不需要 Oracle/DM 那样的隐式提交处理。
- **验证状态**：本轮只交付离线单测（Fake 驱动），SQL Server 路径**未经真机验证**；真机冒烟开关 `DBT_TEST_SQLSERVER_URL`（形如 `sqlserver://sa:pw@host:1433/db`）。
- **驱动形态**：`mssql@12` 仅在 devDependencies，运行时加载 `npm run build:sqlserver` 生成的 `vendor/sqlserver-driver.cjs`；原因是 mssql → tedious → bl → readable-stream 会把 buffer/events/process/string_decoder 带进生产依赖树，触发宿主 `dsh-app-boot` 的 `require.resolve.paths` bug，导致插件整体加载失败。
- **错误消息脱敏**：连接 URL 解析失败时，错误文案里的 userinfo 已脱敏，不回显明文密码（错误会进 `audit.jsonl` 与模型上下文，故必须脱敏）。
- **不支持**：SQL Server 2005（9.x）及更早版本，未支持也未验证；`tdsVersion=8_0`（TDS 8.0）与 `encrypt='strict'`（严格加密）亦未支持——SQL Server 2022 用默认 `7_4` 即可正常连接，TDS 8.0 强加密属后续增强。

## 数据布局

`$DSH_HOME/db-tool/`（0700）：

| 文件 | 内容 |
|---|---|
| `connections.json` | 连接定义（`urlSafe` 中密码脱敏为 `***`） |
| `secrets.json` | 0600，密码/URL 凭据，永不返回给模型 |
| `grants.json` | 项目授权（归一化路径 → connId → ro/rw） |
| `audit.jsonl` | 追加式审计日志 |

## 安装

9 种数据库驱动随 npm 包分发（SQLite 优先用 Node 内置 `node:sqlite`，可选 `better-sqlite3`；GaussDB 驱动为华为云官方 npm 包 `gaussdb-node`），无需任何构建步骤。其中 SQL Server 驱动（`mssql@12`）只在 devDependencies，运行时加载发布包内置的 `vendor/sqlserver-driver.cjs`（`npm run build:sqlserver` 生成）——mssql 的生产依赖树会带入 buffer/events/process/string_decoder，触发宿主 resolve.paths bug。GaussDB 认证支持 sha256 与 md5，md5-sha256 混合与 SM3 暂不支持。

唯一的一次性交互来自 oracledb：其 install 脚本会被 pnpm 默认拦截并使首次安装报告失败——在 DSH 插件安装界面点 **"Allow these scripts and retry"** 即可完成安装（该脚本仅做 Node 版本检查与横幅打印，批准无风险；批准持久化到 profile，后续升级不再提示）。

```bash
# GitHub 源码（推荐：安装本 fork 的修复版）
dsh plugin --profile web add "dsh-db-tool@github:a19920714liou/dsh-db-tool"

# npm：安装的是上游官方包（未含本 fork 修复，修复合并上游前请用上面的 GitHub 方式）
dsh plugin --profile web add dsh-db-tool

# 本地开发
dsh plugin --profile web add "link:E:\path\to\dsh-db-tool"
```

### 桌面端安装

DSH 桌面端 0.2.0-rc.2+ 捆绑了 `dsh` 命令，全程无需另装 Node 或 pnpm：

1. **首次使用**：打开桌面端菜单栏，点 **"Manage dsh command"（管理 dsh 命令）**，安装捆绑的 CLI——该操作把 `dsh` 命令注册到系统 PATH。
2. **安装插件**（npm 方式安装的是上游官方包，未含本 fork 修复；修复版请用上文的 GitHub 源码方式。npm 安装必须钉精确版本：`@latest` 会因 release-age 校验回落到旧版）：

   ```bash
   dsh plugin --profile desktop add "dsh-db-tool@github:a19920714liou/dsh-db-tool"
   ```
3. **重启桌面端**生效。

mongodb 驱动已 bundle 进发布包（`vendor/mongodb-driver.cjs`），依赖树不含 mongodb/punycode——桌面端宿主打包在 `app.asar` 内、无法应用宿主补丁，本插件免补丁可直接安装加载。

## 测试

```bash
npm test        # 离线 mock 全量（含 e2e-mock 全链路与对抗用例）
npx tsc --noEmit
npx stryker run # 变异测试（范围 lib/guard + lib/manager + lib/store，报告 reports/mutation/）
```

真机冒烟（设了才跑）：`DBT_TEST_MYSQL_URL / DBT_TEST_PG_URL / DBT_TEST_REDIS_URL / DBT_TEST_DM_CONNECT / DBT_TEST_MONGO_URL / DBT_TEST_ORACLE_CONNECT / DBT_TEST_SQLSERVER_URL`（SQL Server 形如 `sqlserver://sa:pw@host:1433/db`）。GaussDB、Oracle/Mongo 与 SQL Server 的要求均按官方文档实现，未真机验证处以代码内标注为准；**本轮 SQL Server 只有离线单测（Fake 驱动），未经真机验证**。

## 目录结构

```
lib/        host 插件（store / adapters×9 / guard / manager / http / index）
client/     侧边栏单文件产物（client.js，即源码）
skills/     db-admin skill
scripts/    构建与工具脚本（mongodb / sqlserver 驱动、CodeMirror 编辑器 bundle、DSH 宿主热修复 patch:dsh 等）
patches/    DSH 宿主 dsh-app-boot 热修复补丁（patch:dsh 按宿主版本选用）
docs/       预留（当前为空）
tests/      vitest（离线 mock + DBT_TEST_* 门控真机）
vendor/     mongodb-driver.cjs、sqlserver-driver.cjs 与 codemirror-sql.cjs bundle（gitignore，发布经 files 白名单收录）
```

## 许可证

MIT
