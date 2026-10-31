---
name: dsh-db-tool
description: dsh-db-tool（DSH 宿主数据库工具模块，TypeScript）开发技能。在本仓库开发、新增或修改九库适配器（mysql/postgresql/oracle/sqlite/dmdb/gaussdb/mongodb/redis/sqlserver）、编写 SQL 方言相关代码、实现或调试数据传输（transfer）、处理九库差异（标识符引用、批量写入、错误人性化）、调整 API 路由或 store 配置时使用。
---

# dsh-db-tool 开发技能

## 模块地图

| 路径 | 职责 |
| --- | --- |
| `lib/index.ts` | 插件入口。`export const inject = ['webServer', 'sessions', 'tools', 'connection']`；`ctx.webServer.register({kind:'prefix', path:'/dsh-db-tool/api'})` 挂 HTTP；`ctx.tools.register` 注册 `DatabaseManager` 工具（`timeoutMs: 90_000`，六 action：`list_connections`/`query`/`execute`/`schema`/`preview`/`run_script`）；`ctx.effect` 收尾 `service.dispose()`。`projectPath` 只从 `session.header.cwd` 取，不信任模型自报。**禁止 default export**——cordis 的 `unwrapExports()` 优先取 `exports.default`，裸函数形态会丢 named export 的 `inject`，报 `cannot get property "webServer" without inject` 且插件永不激活 |
| `lib/http/index.ts` | API 路由分发层（只做路由与参数，业务下沉 manager）；`isTrustedRequest` 做 Host/Origin 校验，`MAX_JSON_BODY_BYTES` 2MB |
| `lib/manager.ts` | `DbToolService`：审计（`audit`）、授权（`authorize`）、错误转换（`toDriverError`）、`DbToolError`；`handleToolAction` 为模型工具 action 派发入口 |
| `lib/guard/index.ts` | 语句风险分级 + 一次性挑战凭据（见下节） |
| `lib/script/runner.ts` | `run_script` 子进程执行器（父侧）：`fork` + permission model flag + 环境变量白名单 + 超时 SIGKILL |
| `lib/script/worker.cjs` | `run_script` worker（子侧）：`vm.runInNewContext` 新 realm，仅注入 `db`/`console`；`db` 调用经 IPC 回父进程走完整 guard/审计链路 |
| `lib/adapters/index.ts` | `getAdapter(kind)` 统一入口；驱动缺失统一抛 `driverMissingError(kind, cause?)` |
| `lib/adapters/<kind>/index.ts` | 方言适配器：mysql、postgresql、oracle、sqlite、dmdb、gaussdb、mongodb、redis、sqlserver（九库，注册表见 `lib/adapters/index.ts` 的 `LOADERS`） |
| `lib/adapters/types.ts` | 适配器统一契约 `DatabaseAdapter`：`query`/`execute`/`listDatabases`/`listTables`/`describeTable`/`previewRows`/`testConnect`/`close`，可选 `listSchemas?`/`searchTables?`/`tx?` |
| `lib/adapters/sql-shared/common.ts` | 共享 SQL 工具：`assertIdent`、`quoteIdent`、`clampLimit`、`clampOffset`、`normalizeCell`、`humanize`（高扇入热点，改前查全部调用方） |
| `lib/adapters/sql-shared/pg-like.ts` | PostgreSQL/GaussDB 共享实现：`normalizeUrl`（多主机 URL 解析/重组）、`pickHost`（探活选主机）、`createPgLikeAdapter`、`TxHandle` |
| `lib/adapters/transfer/` | 传输模型 `model.ts`（`TransferCursor`/`TransferRow`/`readBatch`）+ `kinds/`（mongo、mysql、oralike、pg、sqlite、sqlserver 六类方言实现，覆盖除 redis 外的八个 kind） |
| `lib/transfer.ts` | 传输编排器 `startTransferTask`：表级并行 + 大表按 `keyAt` 分片并行；并发上限 `MAX_TRANSFER_TASKS = 8` |
| `lib/store/index.ts` | `DbToolStore` 聚合：数据根 `$DSH_HOME/db-tool`（缺省 `~/.dsh`，目录 `0700`）；`DSH_HOME=""` 按未设置处理 |
| `lib/store/io.ts` | `writeJsonAtomic`（临时文件 + rename 原子写）、`readJson`、`chmodBestEffort` |
| `lib/store/connections.ts` | 连接元数据（不含密码）+ `redactUrl`、`mergeUrlCredentials`、`DuplicateConnectionError` |
| `lib/store/secrets.ts` | `SecretsBox`：密码/完整 URL，落 `secrets.json`（`0600`），明文绝不出库 |
| `lib/store/grants.ts` | 项目级连接授权 `grants.json` |
| `lib/store/audit.ts` | `AuditLog` 追加式 `audit.jsonl` |
| `lib/store/transfer-history.ts` | `TransferLog` → `transfer-log.jsonl`；目录为 `<我的文档>/DSH/`，`DSH_TRANSFER_DIR` 可覆盖；vitest 下（`VITEST=true`）写到临时数据根，避免污染真实文档目录 |
| `lib/store/normalize.ts` | `normalizeProjectKey`（高扇入：跨平台路径归一） |
| `lib/store/export-crypto.ts` | `encryptPayload`/`decryptPayload`，连接导出/导入的跨机口令加密 |
| `scripts/` | `build-mongodb.mjs`/`build-sqlserver.mjs`/`build-codemirror.mjs`（esbuild 产物）、`hotfix-core.mjs`（宿主热修复核心）、`apply-dsh-hotfix.ps1`/`.sh`、`diag-profile.mjs`、`verify-host.mjs`、`fix-dsh-install.ps1` |
| `patches/` | DSH 宿主 `dsh-app-boot` 热修复补丁，按宿主版本一对一选择（见下节） |
| `assets/` | `feature-flow.png`/`.html`，README 用功能流程图 |
| `.github/workflows/` | `ci.yml`（Node 22/24 矩阵：`npm ci` → `npm run build` → typecheck → test）、`publish.yml`（版本变更才发版） |
| `client/client.js` | 侧边栏前端（单文件），运行时 `require("../vendor/codemirror-sql.cjs")` 加载编辑器；加载失败即降级纯 textarea（单例 promise 失败后置空允许重试），不做同源 fetch（防 `Function` 动态执行投毒） |
| `tests/` | vitest，61 个测试文件：`adapters-sql`(21)、`store`(10)、`adapters-nosql-ent`(7)、`tool`(7)、`client`(6)、`guard`(3)、`http`(3)、`e2e-mock`(3)、`plugin`(2)、`scripts`(1)；仓库根 `stryker.config.json` 变异测试（只 mutate `lib/index.ts` 与 `lib/http/index.ts`） |

API 面（`lib/http/index.ts`，真实路径带 `/dsh-db-tool` 前缀）：`/api/state`、`/api/project-context`、`/api/connections`（CRUD + `/export`、`/import` 口令加密跨机迁移）、`/api/test-draft`、`/api/grants`、`/api/databases`、`/api/tables`、`/api/schemas`、`/api/schema`、`/api/search-tables`、`/api/preview`、`/api/query`、`/api/execute`、`/api/script`、`/api/transfer/start`、`/api/transfer/live`、`/api/transfer-log`、`/api/transfer-history`、`/api/transfer-history/clear`、`/api/console/begin|exec|commit|rollback`（粘性连接，begin 发 token，事务内必须走同一连接读）、`/api/audit`。新增路由要同步 `tests/http/api.spec.ts` 的契约断言。

### guard：风险分级与确认凭据

`classifyStatement(kind, statement, op)` 是唯一分级入口，返回 `{ level: 'danger'|'warning'|'none', reason?: string }`，按 kind 分派到 `classifySql`/`classifyRedis`/`classifyMongo`。

| 判定维度 | 规则 | 级别 |
| --- | --- | --- |
| 读白名单 | `SQL_READ_HEADS`（`select/with/show/describe/desc/explain/use/set/help/table`）首词命中 | 继续细分，否则按未知处理 |
| 读体内藏危险 | `SQL_HIDDEN_DANGER_RE`：多语句、`INTO OUTFILE/DUMPFILE`、`LOAD_FILE(`、`SET GLOBAL/PERSIST`、`FOR UPDATE` | danger |
| 读体内藏写 | `SQL_WRITE_BODY_RE`：`insert/update/delete/merge/drop/alter/truncate`（`WITH...DELETE` 类） | danger |
| DDL | `SQL_DDL_RE`：`drop/truncate/alter/create/rename/comment/grant/revoke/flashback/purge` | danger（隐式提交不可回滚） |
| DML | `SQL_DML_RE`：`insert/update/delete/merge/replace/upsert/call/do` | 走 `query` 通道 danger；`execute` 通道 warning |
| 维护命令 | `SQL_MAINT_RE`：`shutdown/startup/archive log/recover/analyze/optimize/check table/repair/lock/unlock/kill/flush` | danger |
| 未知首词 | 未命中任何清单 | `query` 通道 danger；`execute` 通道 warning |
| T-SQL 专属首词 | `SQLSERVER_DANGER_HEADS`：`backup/restore/dbcc/reconfigure/bulk/shutdown/sp_configure/xp_cmdshell`，**仅 kind=sqlserver 启用** | danger |
| T-SQL 动态执行 | `EXEC/EXECUTE` 后接 `xp_*`/`sp_configure`/`sp_executesql`（200 字符内）、`EXEC('…')`/`EXEC N'…'`/`EXEC @sql` | danger |
| T-SQL `SELECT ... INTO` | 会建对象；`AS into` 别名与 `INTO @变量` 放行 | danger |
| Redis | `DANGEROUS_COMMANDS`（适配器导出）danger；`WRITE_COMMANDS` 按通道；`READ_COMMANDS` none；无法解析/未识别 fail-closed | 见左 |
| MongoDB | `DANGEROUS_OPS`（`READ_OPS`/`DANGEROUS_OPS` 均从适配器导出，单一事实来源）+ `drop` 补位 danger；`MONGO_WRITE_OPS` 按通道；未识别 fail-closed | 见左 |

注意 `SQL_READ_HEADS` 与 `SQLSERVER_DANGER_HEADS` 都是 `ReadonlySet`——安全原语不允许调用方增删，改清单就是改这里。

`ChallengeStore`：`ttlMs` 默认 5min、`sweepIntervalMs` 默认 60s（`0` 关闭定时器供测试）、注入时钟 `now` 供测过期；id = `c_` + 12 字节 hex；`statementHash` 为语句 SHA256；`consume(id, statement, scope)` **先 `delete` 再校验**（无论成败都取走，防重放探测），且作用域 `connId + projectKey` 必须与创建时完全一致，防同语句跨库/跨项目重放。

### run_script 隔离模型

两层：独立子进程 + Node permission model（**禁 fs**，Node ≥22 用 `--permission`，20/21 用 `--experimental-permission`），脚本本身跑在 worker 的**新 vm realm**（`vm.runInNewContext`，`vm timeout 60s`），仅注入 `db.query`/`db.execute`/`console`。`vm` 不是安全边界（`Function` constructor 可逃逸），所以真正兜底的是子进程无文件权限。

| 参数 | 值 | 位置 |
| --- | --- | --- |
| 环境变量 | 白名单 11 项：`PATH/SYSTEMROOT/SYSTEMDRIVE/TEMP/TMP/COMSPEC/PATHEXT/USERPROFILE/HOME/LANG/TZ` | `runner.ts` 的 `ENV_ALLOWLIST`、`minimalEnv()` |
| 默认超时 | 60s，靠**父进程 `SIGKILL`**（`vm timeout` 只约束同步执行，管不到异步） | `runner.ts` `runScriptInChild` |
| 超时副作用 | 触发 `onTimeout` → 关闭会话专用适配器，中断在途 db 调用 | 同上 |
| db 调用 | 经 IPC 回父进程，走完整 guard/challenge/审计链路 | `worker.cjs` |

## 适配器能力矩阵

`✅` = 实现了该可选方法；`—` = 未实现（契约可选）；`原生` / `回退` / `空` 见 `searchTables` 列注。

| kind | testConnect | query | execute | listDatabases | listSchemas | listTables | describeTable | previewRows | searchTables |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mysql | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 原生 |
| postgresql | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 原生 |
| gaussdb | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 原生 |
| sqlserver | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 空 |
| oracle | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 空 |
| dmdb | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 空 |
| sqlite | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 回退 |
| mongodb | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 回退 |
| redis | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | 空 |

`searchTables` 三档：**原生**（mysql 一条 `information_schema` LIKE；pg/gaussdb 按库池化 `ILIKE`，`database` 兼容「库名 / `库名.schema` / schema」三形态）；**回退**（`SEARCH_FALLBACK_KINDS = mysql/mongodb/sqlite`，逐库 `listTables` + 内存过滤——mysql 有原生实现故实际只有 sqlite/mongodb 走回退）；**空**（redis `listTables` 忽略库名，逐库循环会重复返回同一批键；oracle/dmdb 的 `database` 语义是 owner，跨库回退会错标来源；sqlserver 不在白名单）。回退白名单是安全边界，扩列前先确认目标 kind 的 `listTables(database)` 语义就是「库名」。

事务能力分三档：

| 形态 | kind | 用法 |
| --- | --- | --- |
| 对象式 `tx: { begin, commit, rollback }` | mysql、postgresql、gaussdb、sqlserver | 显式三步 |
| 函数式 `tx(fn)` | oracle、dmdb | `fn(exec)` 内语句走事务连接，`exec` 按语句头分流回 `QueryResult`/`ExecResult` |
| 无 `tx` | sqlite、redis、mongodb | mongodb 跨文档事务需副本集，不在本工具承诺内 |

`query`/`execute` 入参语义按 kind 分流，写适配器时不要照抄 SQL 系：

| kind | `query` 入参 | `execute` 入参 | `database` 参数 |
| --- | --- | --- | --- |
| mysql | SQL + `?` 占位 | 同左 | 跨库路由到独立池（ro 池同样只读） |
| postgresql/gaussdb | SQL + `$1` | 同左 | 同上，支持按库路由 |
| sqlserver | SQL + `?`（内部重写 `@p1`） | 同左 | 同上 |
| oracle/dmdb | SQL + `:name` | 同左 | 忽略（`database` 语义为 owner 的场景由 `listTables` 承载） |
| sqlite | SQL + `?` | 同左 | 忽略（单库 `main`） |
| redis | **命令数组 JSON**（`["GET","key"]` 或 `GET key`） | 同左 | 忽略（`db0`） |
| mongodb | **BSON 命令文档 JSON**（`{"find":"users","filter":{}}`） | 同左 | 目标库 |

## 适配器开发规范

1. 新增/修改方言前先对照最接近的既有适配器：PG 系看 `sql-shared/pg-like.ts` 复用；Oracle/达梦同族看 `transfer/kinds/oralike.ts`。
2. 导出模式（对照 `lib/adapters/mysql/index.ts`）：`export async function createXxxAdapter(conn)` + `export const factory: AdapterFactory = (conn) => createXxxAdapter(conn)`；不要绕过 factory 直接 new。
3. 驱动包缺失一律经 `lib/adapters/index.ts` 的 `driverMissingError` 抛出（`getAdapter` 内已统一处理），适配器内不要自造错误文案。
4. 标识符只用 `quoteIdent`/`assertIdent`，禁止字符串拼接表名列名；查询侧复用 `clampLimit`/`clampOffset`、`normalizeCell`，错误包装复用 `humanize`。
5. SQL 共享工具（common.ts、pg-like.ts、normalizeProjectKey）是高扇入热点：修改前 grep 全部调用方，在共享函数一处修，禁止在各调用点打补丁。
6. 单元格统一 `NormalizedCell`（`string | number | null`）：DECIMAL/NUMERIC 保 string 防精度丢失，日期出 ISO，Lob 转字符串并标注截断，Mongo `ObjectId`/`Decimal128`/`Long` 统一 `toString()`。

## 九库差异速查

| 场景 | 坑 |
| --- | --- |
| 批量写入 | Oracle 族绑定占位 `:b1..`，单批绑定参数总量有上限（DPI-1015），宽表需减小批次；DM 兼容靠消息匹配唯一冲突（ORA-00001 / `-6602`），勿精确匹配错误码；MongoDB `bulkWrite` 用 `ordered: false`，必须先全量转换再写（转换抛错→一条不写），无跨批次事务（需副本集）；SQLite 单写者，写入用 `BEGIN IMMEDIATE` 包裹；PG 族传输写入走参数化 INSERT 批量（无 COPY） |
| 标识符引用 | `quoteIdent(name, quote)` 默认双引号，MySQL 传 `` ` ``；内部先过 `assertIdent` 防注入，转义为引号翻倍 |
| 错误人性化 | 适配器内用 `humanize(label, fn)` 包装，manager 层再过 `toDriverError`；不要在路由层裸抛驱动原始错误 |
| GaussDB | URL 经 `normalizeUrl`+`pickHost` 支持多主机探活；运行时 failover 与 IPv6 是已知天花板，勿承诺修复 |
| SQL Server | 只按 2005+ 通用写法：元数据只走 `sys.*` catalog views；分页按版本分流（2012+ 用 `OFFSET/FETCH`，2008/2008R2 降级 `ROW_NUMBER`；传输同规则，有序游标用 `SELECT TOP (n)`，版本探测失败按 0 保守降级）；标识符 `[x]` 且 `]` 双写为 `]]`；对外占位符 `?`，适配器内部重写为 `@p1`；**TDS 版本自动协商**（固定声明 `7_4`，服务器按自身能力降级：2005→`7_2`、2008→`7_3_A`、2008R2→`7_3_B`、2012+→`7_4`；[MS-TDS](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/773a62b6-ee89-4c02-9e5e-344882630aac) MUST 级规定，勿手动下调）；`encrypt` 支持 `auto`/`true`/`false`/`strict`，**新建连接默认 `auto`**（先不加密；仅当服务器**强制加密**时报 `EENCRYPT`/「服务器要求加密连接」，才以 `encrypt=true`+`trustServerCertificate=true` **重试一次**；仅重试一次、仅此一种原因，**显式写 `encrypt` 时完全不重试**）；`auto` 在未强制加密的服务器上等价于 `encrypt=false`，即明文传 LOGIN7（含账号密码），故跨公网/不可信网段应显式 `encrypt=true`；`strict`=TDS 8.0，仅 2022+ Force Strict Encryption；该模式下 `trustServerCertificate` 完全失效；加密与证书参数在界面里收在「高级选项」折叠区，常规连接只需主机/端口/账号/密码；仅 SQL 认证，无 Windows 集成认证 / Azure AD；**证书类错误优先 `?caCert=` 装 CA（官方推荐）或 `?serverName=`，不得已才 `?trustServerCertificate=true`**；协议版本类错误（`UNSUPPORTED_PROTOCOL`）改证书参数无效，需服务端打补丁（2008R2 SP3 KB4057113 / 2008 SP4 KB4057114 / 2012·2014 对应 CU+GDR 与 KB3052404）或下探 `?tlsMinVersion=TLSv1`；**2005 无任何补丁可支持 TLS 1.2**；**`encrypt=false` 会完全跳过 TLS 握手并明文发送 LOGIN7**（已用假 TDS 服务器抓包实测，客户端下一个包即 `0x10`；「登录包始终加密」只适用于服务器强制加密或客户端 `encrypt=true`）；传输批量写入每语句行数 = `min(floor(2100 / 列数), 1000)`；类型搬运：`hierarchyid`/`geometry`/`geography` → bytes（目标 `VARBINARY(MAX)`，UDT 语义不保留）、`sql_variant` → 文本（原类型丢失）、`varchar/char(4001–8000)` → `NVARCHAR(MAX)` 类、`datetime2`/`time` 读端 `CONVERT(..., 126)` 保真、decimal 只在传输读端经 `CONVERT(nvarchar(64), col)` 保真（浏览侧不保真）；**ro 闸门五道**（首词白名单 + 多语句 + `SELECT ... INTO` + `WITH` 写体 + `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE` 全拒）；控制台 `GO n` 重复计数上限 1000（超出截断） |

## 传输工作流要点

- 入口：`POST /api/transfer/start` → `lib/transfer.ts` 的 `startTransferTask` → `lib/adapters/transfer/` 按 source/target kind 取 `kinds/*` 实现。
- 结构随迁：目标端建表在 `kinds/*` 的 `createTable`（Oracle/DM 族 DDL 隐式提交，需 `autoCommit: true`）。
- 游标：`TransferCursor` 支持 `keyset` 与 `range`（分片并行，hi 端恒开区间）；源未实现 `keyAt` 切块时编排层回退 keyset 链。
- 并行：表级每表独立 reader/writer 连接；表内分片并行依赖源 `keyAt`；全局任务上限 `MAX_TRANSFER_TASKS = 8`。
- 行宽校验：写入前逐行校验列数（`行宽不匹配` 报错），勿跳过。
- 历史：`TransferLog` 写 `<我的文档>/DSH/transfer-log.jsonl`，`GET /api/transfer-history` 读；清空走 `/api/transfer-history/clear`。
- 相关测试：`tests/adapters-sql/transfer-*.test.ts`（locate/mapping/oralike/sqlite/sqlserver/stress/task）。
- 跑一次传输：从 `/api/connections` 取源/目标连接（口令加密存储，跨机迁移走导出/导入接口，不要手拼连接串）→ `POST /api/transfer/start`；发起前向用户复述源库、目标库、涉及表、是否并行。
- 传输校验（全部通过才算完成）：① 源表与目标表 count 一致；② 按主键抽样逐字段比对（注意精度、时区、二进制映射差异）；③ 用 `describeTable` 对照列名/类型/可空性/默认值是否随迁一致。不通过时报告差异明细（表、行、字段、期望值与实际值），不要静默重传。

## 改动前规划

1. 判类型：新功能（确定扩展哪层 http → manager → adapters/store）/ 修复（先要复现现象，给根因假设与验证方式）/ 重构（承诺行为不变，列等价性验证）/ 传输相关（追加核对源库读取与目标库写入两侧边界）。
2. 定位：仓库根若有 `.codegraph/`，用 `codegraph explore "<符号或问题>"` 及 `node`/`callers`/`callees`/`impact`，不做全量 grep；否则按模块路径定位，找到符号后枚举**全部调用方**。
3. 输出：根因或改动点 → 影响面清单（具体文件、哪些行为变/哪些承诺不变）→ 测试策略（先写复现失败用例，覆盖 happy path + 边界/空值/异常，指明要跑的 vitest 文件）→ 风险与最小回滚方式。
4. 规划经用户确认后才动手改代码。

## 构建与发版

### 构建：不做这一步，测试会以「环境问题」的形式红

```bash
npm ci
npm run build      # 必须先生成 vendor/*.cjs
npm run typecheck
npm test
```

`npm run build` = `tsc -p tsconfig.build.json`（出 `dist/`）→ 复制 `lib/script/worker.cjs` 到 `dist/script/` → `build-mongodb.mjs` → `build-sqlserver.mjs` → `build-codemirror.mjs`（esbuild，秒级，每次都全量重建，不做幂等跳过，避免「源升级产物旧」）。

`vendor/` 被 `.gitignore` 忽略，但多组测试直接依赖产物，缺了会以「格式不对 / 模块缺失」失败，**掩盖真实回归**：

| 产物 | 谁依赖 | 缺失时的表现 |
| --- | --- | --- |
| `vendor/mongodb-driver.cjs` | mongodb 适配器 `vendorOrNull()` 容错加载（缺了降级，不抛错），但 bundle 内的 `bson` 是 `instanceof` 判定来源 | `ObjectId`/`Decimal128`/`Binary`/`Long`/`Timestamp` 落进普通对象分支被 JSON 序列化，`normalizeMongoCell` 与 Extended JSON 复活共 5 条断言「格式不对」 |
| `vendor/sqlserver-driver.cjs` | 适配器与 `tests/adapters-sql/sqlserver*.test.ts` 均走 `require('../../vendor/sqlserver-driver.cjs')` | 整个 `sqlserver-driver-real.test.ts` 文件加载失败；`multi-instance-contract` 3 条 + `sqlserver-offline` 1 条失败 |
| `vendor/codemirror-sql.cjs` | client 运行时 `require("../vendor/codemirror-sql.cjs")`；`tests/client/console-tools.spec.ts` 校验产物含 sqlserver 接线 | 前端方言接线断言失败（client 侧自身会降级 textarea，但测试断言红） |

实测对照（同一台机器，同一 commit）：

| 状态 | 结果 |
| --- | --- |
| 不构建 vendor | 6 个文件失败、**13 failed** / 1029 passed |
| `npm run build` 后 | 2 个文件失败、**4 failed** / 1061 passed |
| 构建后 + `core.autocrlf=false` | 1 个文件失败、**1 failed** / 1064 passed（只剩 DNS 劫持那条） |

差的那 10 条全是产物缺失造成的假失败。注意不构建时那 1 条 DNS 用例反倒「消失」——它所在的文件整体加载失败，压根没跑；所以「失败数变少」可能是更坏的信号。

两个 bundle 的存在理由（改 build 脚本前必读）：DSH 宿主 `@deepseek-ai/dsh-app-boot`（≤ 0.1.7-rc.2）加载插件时对依赖树逐包调 `require.resolve.paths(name)` 且不防护 `null` 返回，核心模块同名包（`punycode`/`buffer`/`events`/`process`/`string_decoder`）会让整个插件无法加载。bundle 后这些包全部内联，生产依赖树里不出现。因此 **`mssql` 只能是 devDependency**、`mongodb` 同理。`build-mongodb.mjs` 里 `bson` 刻意 external：保持与运行时 `require('bson')` 同一模块实例（`instanceof` 兼容）；`build-sqlserver.mjs` 里 `@azure/*` **不能** external（`tedious/lib/connection.js` 顶部是静态 require，缺失直接 `MODULE_NOT_FOUND`）。

### 发版：三处版本号必须一致

```bash
# 改版本：三处同步
#   package.json                                   "version"
#   package-lock.json                              "version"
#   package-lock.json  packages[""].version
npm ci          # 不一致时直接 EUSAGE 失败，CI 第一步就挂
```

`publish.yml` 的机制：push 到 `master` → 比对 `package.json` 版本与 `npm view dsh-db-tool version` → **相同则整体跳过**，不同才 `npm install` → `npm run build` → `npm test` → `npm publish --provenance` → 自动打 `v<版本>` 标签（远端已有同名 tag 则跳过打 tag）。所以「发版」这件事就是改版本号 + 合入 `master`，不需要手动 publish。

发布内容由 `package.json` 的 `files` 白名单决定：`dist`、`client`、`skills`、`patches`、`scripts`、**三个 vendor 产物逐条列出**、`cordis.patch.yml`，外加 `LICENSE`/`README.md`/`README_EN.md`/`CHANGELOG.md`。`prepack` 会自动 `npm run build`，本地核对发布内容用：

```bash
npm pack --dry-run
```

### Node 版本

`engines.node` 是 `>=22`，CI 矩阵 `[22, 24]`。**Node 20 跑不了**：`tedious` 20.x 及其 `@azure/*` 传递依赖的 engines 要求 `>=22`，Node 20 下建连报 `Promise.withResolvers is not a function`——而且这个 TypeError 会**覆盖真实 TLS/网络错误**，让排障方向完全跑偏。不要试图在 20 上兼容。

### 宿主热修复补丁

`patches/` 修的是 `dsh-app-boot` 的 `resolve.paths` 空返回缺陷，两处同型：`routeScoped()` 与 `nativePackageDir()`。`scripts/hotfix-core.mjs` 同时持有内建替换块与补丁文件选择表：

| 宿主版本 | 补丁文件 |
| --- | --- |
| `0.1.7-rc.2` | `dsh-app-boot-route-scoped-hotfix.patch` |
| `0.2.0-rc.1` | `...-0.2.0-rc.1.patch` |
| `0.2.0-rc.2` | `...-0.2.0-rc.2.patch` |
| `0.2.1-rc.3` | `...-0.2.1-rc.3.patch` |

四个版本的锚点行**逐字节一致**，只有整体行号偏移（npd 与 routeScoped 各偏移不同），所以内建替换路径与版本无关，`git apply` 路径才需要按版本选文件。改补丁时同步改三处：`.patch` 的 hunk 头、`hotfix-core.mjs` 的 `ORIGINAL_LINE`/`ORIGINAL_NPD_BLOCK`/`PATCH_BY_VERSION`、`tests/scripts/hotfix.spec.ts` 的对应契约块。未列版本默认退出码 2，`--force` 可强制。用法：

```bash
npm run patch:dsh          # Windows（PowerShell）
npm run patch:dsh:sh       # bash
node scripts/hotfix-core.mjs --dry-run   # 只看会改什么
```

## 开发陷阱

### 行尾必须 LF（否则 3 条契约用例必红）

`.gitattributes` 强制 `* text=auto eol=lf`。原因：`tests/scripts/hotfix.spec.ts` 把 `patches/*.patch` 的 `+` 行与 `scripts/hotfix-core.mjs` 的内置块**逐字节**比对，且要求 `git apply` 的结果与内置替换结果逐字节一致。Windows 默认 `core.autocrlf=true` 时，`git apply` 产出 CRLF 而内置块是 LF → 三条 `patch applies cleanly to the pristine upstream ... via git apply` 用例必红（`hotfix.spec.ts` 的 `gitApplyContract`，约 383 行）。补丁文件本身也必须 LF，否则在 Linux/CI 上 apply 会把 CR 带进目标文件。

本机验证与临时规避：

```bash
git config --get core.autocrlf                       # true 就是踩坑前提
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf \
  GIT_CONFIG_VALUE_0=false npx vitest run tests/scripts/hotfix.spec.ts
# 实测：autocrlf=true → 3 红；上面这条 → 32 全过
```

根治是按 `.gitattributes` 重新 checkout，而不是长期靠环境变量绕过。

### pnpm 布局 ≠ CI 的 npm 扁平布局

本仓库用 npm（`package-lock.json`，`pnpm-lock.yaml` 已 gitignore）。本机若是 pnpm 装出来的 `node_modules`，严格隔离会让**测试直接 `require` 却未声明为直接依赖**的传递包顶层不可解析。已知会踩的三个：`tedious`、`pg-connection-string`、`semver`（`semver` 已进 devDependencies，但旧的 pnpm 安装里可能还没链接过来）。

```bash
node -e "for (const p of ['tedious','pg-connection-string','semver']) { try { require.resolve(p); console.log(p,'OK') } catch { console.log(p,'MISSING') } }"
```

探测到 `MISSING` 先按 npm 布局重装再判定；这类失败在 CI 上不复现，**不要据此改代码**。

### 本机 DNS 劫持

`tests/adapters-sql/sqlserver-driver-real.test.ts` 的「主机名解析失败」用例（约 612 行）连 `no-such-host.invalid`，期望 `ENOTFOUND`。本机若把 `.invalid` 劫持成真实 IP（实测解析到 `198.18.0.x` 并真的建连），该用例必红，CI 正常。判定方法：

```bash
node -e "require('node:dns').lookup('host.invalid',(e,a)=>console.log(e?e.code:a))"
# 返回 IP = 劫持；返回 ENOTFOUND = 环境正常
```

## 验证纪律

- bug 修复先写复现失败的测试，再定位根因、在共享函数一处修；禁止顺手重构无关代码。
- 只跑相关测试：`npx vitest run tests/adapters-sql/<相关>.test.ts`；改 HTTP 路由配 `tests/http/api.spec.ts`，改 guard 配 `tests/guard/classify.spec.ts` + `challenge.spec.ts`，改 store 配 `tests/store/<相关>.spec.ts`，改前端配 `tests/client/<相关>.spec.ts`。
- 全量基线（`npm run build` 之后，本机 pnpm + Windows）：61 个文件、1101 条，**1061 passed / 4 failed / 36 skipped**。4 条已知失败 = 3 条行尾（`.gitattributes` 未生效）+ 1 条 DNS 劫持，都不属于回归。加 `core.autocrlf=false` 后应为 **1064 passed / 1 failed**。
- 变异测试：`npx stryker run`，只覆盖 `lib/index.ts` 与 `lib/http/index.ts`；存活变异体要补强用例。
- 注释与提交信息用简体中文；提交格式 `类型(范围): 描述`，类型取：新增/修复/文档/重构/测试/性能/杂项。
- Windows 环境：无 shell 时 spawn npm 需写 `npm.cmd`。
