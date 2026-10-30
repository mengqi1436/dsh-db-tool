---
name: db-admin
description: 通过 dsh-db-tool 插件操作 9 种数据库（MySQL、PostgreSQL、GaussDB、SQLite、Redis、MongoDB、Oracle、达梦、SQL Server）。调用 DatabaseManager 工具完成连接查询、SQL/命令执行、库表浏览、数据预览；处理 NEEDS_CONFIRMATION 危险操作确认流程，遵守 ro/rw 项目授权与安全规范。
---

# db-admin：数据库管理与查询

本项目装有 dsh-db-tool 插件，通过 **DatabaseManager** 工具让模型以受控方式操作数据库。所有操作受「项目路径 → 连接 → ro/rw」授权模型约束：当前项目未被授权的连接一律不可用，只读授权下任何写操作都会被拒绝。

## 工具调用总则

- 每次调用必须带 `action`；除 `list_connections` 外都必须带 `conn_id`（先 `list_connections` 拿到连接 id）。
- 参数以 snake_case 为主，兼容 camelCase（`conn_id`/`connId` 均可）。
- 工具整体超时 **90 秒**；慢查询/大脚本超时按失败处理，需拆小重试。
- 工具返回 `{text, isError}`：`text` 是 JSON 文本——成功时是结果对象；失败时形如 `{"ok":false,"error":"...","code":"..."}`。`isError=true` 仅用于被拒/失败；`NEEDS_CONFIRMATION` 不是失败（`isError=false`），但 `text` 中 `code` 为该值，见下文确认流程。
- `query`/`execute`/`run_script` 都接受可选 `challenge_id`，用于危险操作确认后的重试。
- 工具只有 6 个 action。**表名搜索、连接导出/导入、数据传输、事务控制都没有对应 action**，它们是侧边栏（HTTP API）能力，见「侧边栏五个面板与辅助能力」。

### 错误码与处置（共 8 个）

| code | 含义 | 正确处置 |
|---|---|---|
| `UNAUTHORIZED_PROJECT` | 项目路径为空，或当前项目未授权该连接 | 引导用户在侧边栏「项目授权」面板为当前项目勾选 ro/rw；不要重试原调用 |
| `READ_ONLY` | ro 授权下收到写操作（含 `run_script`、控制台事务） | 告知需升级为 rw；**不要反复重试** |
| `NEEDS_CONFIRMATION` | 危险操作待确认，返回含 `challengeId` | 向用户说明后带同一 `challenge_id` 重试该语句 |
| `INVALID_CHALLENGE` | challenge 不存在、已用过、已过期（5 分钟）或语句已变更 | 重新原样发起调用取得新 challenge，再走完整确认流程 |
| `NOT_FOUND` | 连接不存在、事务会话已失效、传输任务不存在 | 重新 `list_connections` / 重新 `begin` / 查历史 |
| `INVALID_ARGUMENT` | 参数缺失或非法：超上限、`writeMode` 非法、口令不足 8 位、sqlite 开事务、事务指定库等 | 按错误消息改参数后重试；原样重试无意义 |
| `DRIVER_ERROR` | 数据库/驱动侧失败；ro 模式 query 闸门拒绝也用它（消息以 `DRIVER_ERROR:` 开头） | 按消息修 SQL、连接串或权限；**这不是需要确认的操作** |
| `SCRIPT_TIMEOUT` | `run_script` 超时被强杀（脚本 60s / 工具 90s 两层） | 缩小脚本工作量或分批；同样脚本重试必然再超时 |

### 硬性上限与配额

| 项 | 值 | 说明 |
|---|---|---|
| `preview` limit | 1..50，默认 10 | 超出服务端钳制 |
| `preview` offset | ≥0，默认 0 | 翻页 |
| 表名搜索 limit（侧边栏） | 1..200，默认 100 | 工具无此 action |
| 审计 limit | 1..500，默认 50 | |
| 传输历史 limit | 1..200，默认 50 | |
| 传输日志 limit | 1..2000，默认 200 | |
| Redis 单次 `SCAN` 最多键 | 200 | 达上限返回 `truncated` |
| Redis 集合类读取（hgetall/lrange/smembers/zrange） | 500 行 | |
| Redis 键清单（表列表） | 500 | |
| Redis `preview` | ≤50 | |
| MongoDB `find` | limit ≤50，默认 20 | 超出自动钳制 |
| MongoDB `aggregate` 读结果 | 500 行 | |
| Oracle / 达梦 结果集 | 500 行 | 超限 `truncated` |
| 脚本执行 | 60s | worker 与 vm 两层同值 |
| 工具整体 | 90s | |
| HTTP 请求体 | 2MB | 超限 `INVALID_ARGUMENT` |
| 导出口令 | ≥8 位 | 服务端强制 |
| 单连接并发事务会话 | 4 | 超限 `INVALID_ARGUMENT` |
| 全局并发传输任务 | 8 | |
| 单任务表数 | 1000 | 且表名不可重复 |
| 传输 `batchSize` | ≤5000，默认 1000 | |
| 传输 `tableConcurrency` | ≤16，默认 4 | |
| 传输 `shardConcurrency` | ≤32，默认 4 | 单表单片数 ≤32 |
| 事务空闲回收 | 5 分钟 | 扫描周期 30s，回收即回滚并审计 |

## 六个 action

### 1. list_connections

列出**当前项目已授权**的连接（含 id、kind、name、safeUrl——密码等 secrets 永不返回）。

```
DatabaseManager({ action: "list_connections" })
```

任何任务开始前先调用它确定可用连接；返回为空说明当前项目未授权任何连接，应引导用户在侧边栏「项目授权」面板为项目路径授 ro 或 rw。

### 2. query — 执行查询（只读意图）

```
DatabaseManager({ action: "query", conn_id: "c1", sql: "SELECT id, name FROM users WHERE age > ?", params: [18] })
```

- `sql` 必填；`params` 为参数数组（占位符见方言速查）；可选 `challenge_id`（危险读如 Redis `KEYS *` 触发确认后重试用）。
- 可选 `database`：跨库执行目标（Navicat 式）。pg/gaussdb 传库名（如 `gycwd`）即在该库上执行（同一凭据开独立连接，ro 授权下同样强制只读）；其余库种优先用语句内全限定名（MySQL `库名.表`、SQL Server `库名.schema.表`）。
- 返回 `{columns, rows, rowCount, truncated?}`，所有单元格已规范化为 string/number/null。
- ro 与 rw 授权下都可用，但只读接口收到非查询语句会被拒。

### 3. execute — 执行单条写语句（需 rw）

```
DatabaseManager({ action: "execute", conn_id: "c1", statement: "UPDATE users SET age = ? WHERE id = ?", params: [20, 42] })
```

- `statement`（或 `sql`）必填，单条语句；DDL/DML/维护命令都会触发危险确认。
- 可选 `database`：跨库执行目标，语义同 query（pg/gaussdb 支持按库路由，目标库权限由数据库侧用户权限控制）。
- 返回 `{affectedRows?, message}`，`message` 为中文结果描述。
- ro 授权下直接返回 `READ_ONLY` 错误。

### 4. schema — 浏览库/表/结构（三级递进）

一个 action 三种用途，按参数自动降级：

```
DatabaseManager({ action: "schema", conn_id: "c1" })                                            // → 数据库列表
DatabaseManager({ action: "schema", conn_id: "c1", database: "shop" })                          // → 表列表
DatabaseManager({ action: "schema", conn_id: "c1", database: "shop", table: "users" })          // → 列结构
```

- 表列表返回 `TableInfo[]`：`{name, type?, comment?, database?}`（Redis 的 type 为 hash|list|set|zset|string|stream）。
- PostgreSQL/GaussDB 为「数据库 → 模式(schema) → 表」三层语义，支持跨库浏览（Navicat 行为）：`database` 参数传 `"库名.schema"` 即可浏览连接库之外的库（如 `gycwd.public`，服务端自动用同一凭据开指向该库的连接）；只传 schema 名（如 `public`）则查连接自身库。`listSchemas(database)` 的参数是**纯库名**。不确定 schema 时先执行 `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'`。
- 列结构返回 `ColumnInfo[]`：`{name, dataType, nullable, key?, default?, comment?}`。
- 找不到表名时不要盲目逐库遍历：已知表名问「在哪张表」时先 `database` 逐个试，或引导用户用侧边栏的跨库表名搜索（见下文），模型侧没有等价 action。

### 5. preview — 预览表数据

```
DatabaseManager({ action: "preview", conn_id: "c1", table: "users", limit: 20, offset: 0, database: "shop" })
```

- `table` 必填；`limit` 1..50（默认 10，服务端强制截断）；`offset` ≥0（翻页）；`database` 可选。
- 返回 `{columns, rows, rowCount, truncated?}`；`truncated: true` 表示还有更多行，翻下一页请递增 `offset`。

### 6. run_script — 沙箱脚本 / Redis 命令 / Mongo 文档（需 rw，危险句柄触发确认）

`code` 是一段 JS 脚本，在**子进程隔离沙箱**中执行（无 require/process/fs/网络，60 秒超时）。沙箱注入两个句柄，均走完整 guard/challenge/审计链路：

- `db.query(sql, params)` — 只读查询，返回结果对象；
- `db.execute(statement, params)` — 写执行，危险语句在沙箱内以异常抛出 `NEEDS_CONFIRMATION` JSON，需按确认流程携 `challenge_id` 重试。

脚本返回值即工具返回值（须可 JSON 序列化）。示例：

```
DatabaseManager({ action: "run_script", conn_id: "c1", code: "return (await db.query('SELECT count(*) AS n FROM users', [])).rows" })
```

两条硬约束：

- **恒需 rw**：`run_script` 在授权校验处就要求 rw，连纯只读的 Redis/Mongo 脚本也一样——没有「只读脚本通道」。ro 连接只能用 `query`（Redis/Mongo 的 `query` 可直接传命令 JSON）。
- **一个脚本里最多只有第一条危险语句能被确认执行**：脚本内所有 `db.query`/`db.execute` 共用同一份 `challenge_id` 入参，而 challenge 一次性——第一条危险语句消费掉它，后续危险语句必然 `INVALID_CHALLENGE`。不要把多条需要确认的写语句塞进同一个脚本；多步确认请逐条 `execute`（每条各自确认），或用侧边栏控制台事务。

Redis 与 MongoDB 没有 SQL，`code` 直接传**命令数组 / BSON 命令文档**的 JSON 文本（此时脚本体即该 JSON）：

```
DatabaseManager({ action: "run_script", conn_id: "redis1", code: '["GET","user:1"]' })
DatabaseManager({ action: "run_script", conn_id: "mongo1", code: '{"find":"users","filter":{"age":{"$gt":18}}}' })
```

这两种库的 `query` 与 `execute` 也直接接受命令 JSON（读命令走 `query`、写命令走 `execute`），是按语言区分的两条通道；`run_script` 则是唯一能做「多步组合」的入口。

## 九库方言速查

| 库 | 占位符 | 元数据入口 | 分页 | 备注 |
|---|---|---|---|---|
| MySQL | `?` | `information_schema` | `LIMIT n OFFSET m` | |
| PostgreSQL | `$1, $2…` | `information_schema` / `pg_catalog` | `LIMIT n OFFSET m` | |
| GaussDB | `$1, $2…` | `information_schema` / `pg_catalog` | `LIMIT n OFFSET m` | PG 系（默认端口 8000，见下方注记） |
| SQLite | `?` | `sqlite_master` / `PRAGMA` | `LIMIT n OFFSET m` | 库列表固定 `['main']` |
| Redis | 无（命令数组） | `SCAN`（禁用 `KEYS` 遍历） | `SCAN cursor` | `run_script` 传 `["SCAN","0","MATCH","user:*","COUNT","100"]` |
| MongoDB | 无（BSON 文档） | `listCollections` | `find().skip().limit()` | `run_script` 传 `{"find":"users","filter":{},"limit":20,"skip":40}` |
| Oracle | `:name` | `ALL_TABLES` / `USER_TABLES` | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` | |
| 达梦(DM) | `:name` | 系统视图同 Oracle 风格 | `OFFSET m ROWS FETCH NEXT n ROWS ONLY`（8a 支持 `LIMIT`） | |
| SQL Server | `?`（适配器内部重写为 `@p1`） | `sys.*` catalog views | 2012+ `OFFSET m ROWS FETCH NEXT n ROWS ONLY`；2008/2008R2 降级 `ROW_NUMBER` | 标识符 `[x]`，名中含 `]` 双写为 `]]`；**仅 SQL 认证**（不支持 Windows 集成认证 / Azure AD）；其余边界见下方「SQL Server 覆盖范围与边界」 |

**类型规范化**（工具返回值已自动处理，引用结果时注意）：`DECIMAL/NUMERIC` → string（避免精度丢失）；`Date/TIMESTAMP` → ISO 8601 string；`LOB/CLOB/BLOB` → string；MongoDB `ObjectId` → string。生成写语句时，DECIMAL 直接传字符串值、日期传 ISO 字符串即可。

**SQL Server 类型例外（分侧口径）**：
- **decimal/numeric**：浏览侧（`query` / `preview` / 数据浏览网格）**不保证逐位保真**——驱动在解析阶段已把它转成 JS number（>15 有效位即丢精度），转成字符串只能防后续数值化，且 >1e21 会显示为科学计数法；需要逐位保真时请在 SQL 里显式 `CONVERT(nvarchar(...), col)`。数据传输（transfer）读端已内建 `CONVERT(nvarchar(64), col)`，写端按字符串绑定，精度不经过 JS 浮点。
- **空间/层次 UDT**：`hierarchyid` / `geometry` / `geography` 在传输中按二进制（bytes）搬运，目标端建 `VARBINARY(MAX)`——值保真但 **UDT 类型语义不保留**（目标端没有 `ST_*` / `hierarchyid` 方法），需要空间语义时目标端要自行改造列类型。
- **sql_variant**：传输读端 `CONVERT(nvarchar(max), col)` 转文本，**原类型信息丢失**（驱动按值的实际类型返回标量，无法统一搬运）。
- **字符列保容量**：源 `varchar` / `char` 长度 4001–8000 会映射为目标 `NVARCHAR(MAX)` 类，不做隐式收窄。
- **日期时间保真**：`datetime2` 读端 `CONVERT(nvarchar(33), col, 126)`、`time` 用 `CONVERT(nvarchar(16), col, 126)`。

## GaussDB 官方对齐注记（HCS 26.861.0，集中式/分布式）

依据华为云 GaussDB 官方文档（doc.hcs.huawei.com/db/zh-cn，26.861.0 双形态）与 openGauss 官方文档源仓库对齐；未真机验证处以代码内标注为准。

- **认证**：驱动实现 openGauss SHA256 / MD5-SHA256 / SM3 握手，匹配服务端默认 `password_encryption_type = 2`（sha256）。连接报 `Invalid username/password, login denied` 时依次排查：① 认证配置（gs_hba.conf）需含 `host all all 0.0.0.0/0 sha256`；② 服务端密码加密方式变更后必须重设密码或新建用户（旧口令仍是旧加密）；③ 账号锁定用 `ALTER USER ... ACCOUNT UNLOCK`。
- **默认端口 8000**（集中式 DN / 分布式 CN，官方 gsql 示例 `-p 8000`）；SSL 默认不强制（服务端可 require_ssl 强制）。本工具 SSL 仅开/关，**不支持** sslmode（require/verify-ca/verify-full）证书校验细分。
- **ro 只读会话**：`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` 为官方语法（集中式/分布式均支持，rf-dist/gaussdb-08-0400、rf-cent/gaussdb-38-0416），连接建立时执行一次即对该连接所有后续事务生效。
- **隔离级别差异**：READ UNCOMMITTED 等价 READ COMMITTED；**SERIALIZABLE 功能不支持，等价 REPEATABLE READ**——与 PG 真 SSI 行为不同，依赖 PG 串行化语义的脚本注意。
- **元数据**：`pg_database` / `pg_catalog.pg_namespace` 为官方系统表；`information_schema.tables/columns` 集中式有官方视图文档，分布式参考无原生视图（仅 M-Compatibility 模式有），分布式实例上浏览以真机行为为准。
- **兼容模式**：openGauss 有 sql_compatibility（A/B/C/PG）兼容模式，部分语法语义随模式变化（如 B 模式 SET SESSION TRANSACTION 需 `b_format_behavior_compat_options` 含 set_session_transaction 才生效），本工具按 PG 语义使用。
- 驱动/默认值差异的代码内证据与证据 URL 见 `lib/adapters/gaussdb/index.ts` 头注释与 `lib/adapters/sql-shared/pg-like.ts`。

## SQL Server 覆盖范围与边界

- 覆盖 SQL Server 2008/2008R2 → 2022 与 Azure SQL Database；SQL Server 2005（9.x）及更早版本不支持、未验证；`tdsVersion=8_0`（TDS 8.0）与 `encrypt='strict'`（严格加密）也不支持——SQL Server 2022 用默认 `7_4` 即可正常连接。方言与元数据只使用 2005+ 通用写法（元数据走 `sys.*` catalog views）。
- **认证**：仅 SQL 认证（user/password）；**不支持 Windows 集成认证，也不支持 Azure AD 认证**——需要这两类认证时本工具不可用。
- **连接形态**：`sqlserver://user:password@host:port/db`，支持 query 参数 `encrypt` / `trustServerCertificate` / `tdsVersion` / `tlsMinVersion` / `instanceName` / `useUTC`（参数名大小写不敏感）；`tdsVersion` 默认 `7_4`，可配 `7_3_A` / `7_3_B` / `7_2` / `7_1`；`instanceName` 与端口互斥（命名实例改由 SQL Server Browser 解析）。**不接受** ADO.NET 键值连接串（`Server=...;Database=...`）。
- **默认与覆盖**：`encrypt=true` + `trustServerCertificate=false` + `tdsVersion=7_4` + `useUTC=true`（同 mssql 官方默认）。URL query 与分字段表单**同口径**，两处都能覆盖上述四项（含 `tlsMinVersion`）；非法布尔值直接报错，不静默回退。

### TLS 握手失败：两类根因，解法互不通用

| 报错特征 | 根因 | 处置（按优先级） |
|---|---|---|
| `self signed certificate` / `unable to verify` / `CERT_` 家族 | 证书校验阶段失败（自签、链断、主机名不符、已过期） | ① `?trustServerCertificate=true`；② 服务器未强制加密时 `?encrypt=false`（强制加密时反而报「服务器要求加密」） |
| `UNSUPPORTED_PROTOCOL` / `no protocols available` / `alert protocol version`（含 `SSL routines ... UNSUPPORTED`） | 协议版本协商阶段失败：客户端与服务端无共同 TLS 版本，**证书校验根本没执行** | ① 服务端启用 TLS 1.2（2008 R2 SP3 装 KB4057113、2008 SP4 装 KB4057114，重启实例）；② 暂时不能动服务端时，客户端下探 `?tlsMinVersion=TLSv1` |

**不要拿证书类参数治协议版本类**：`trustServerCertificate=true` / `encrypt=false` 只影响证书校验，对 `UNSUPPORTED_PROTOCOL` 没有任何作用，试错只会白跑一轮。两类判据互斥，报错消息里已按族给出中文根因；看到 `TCP 已连通但 TLS ...` 说明网络与端口都没问题，不要再查主机/防火墙。

### `tlsMinVersion` 参数

| 取值 | 含义 |
|---|---|
| `TLSv1` | 最低 TLS 1.0（2008/2008R2 只支持 1.0 时用） |
| `TLSv1.1` | 最低 TLS 1.1 |
| `TLSv1.2` | 最低 TLS 1.2（等同不设置时的 Node 默认下限） |

- 不设置即沿用 Node 默认下限 TLSv1.2；取值**区分大小写、不做归一化**，非法值直接报中文错误（不静默回退，避免用户以为已下探）。
- **不支持 `TLSv1.3`**：底层 tedious 在未指定上限时把 `maxVersion` 封顶为 TLSv1.2，设 1.3 会变成 min > max，握手必然失败（`ERR_SSL_NO_PROTOCOLS_AVAILABLE`）。
- 只开下限、不提供 ciphers / maxVersion 开关；不要填 OpenSSL 专有 cipher 串（BoringSSL 下会抛 `INVALID_COMMAND`）。
- 例：`sqlserver://sa:pwd@10.0.0.5:1433/shop?tlsMinVersion=TLSv1`
- **分页自动分流**：适配器探测 `SERVERPROPERTY('ProductMajorVersion')`，2012+ 用 `OFFSET/FETCH`，2008/2008R2 降级 `ROW_NUMBER() OVER (ORDER BY (SELECT NULL))` 子查询——生成 SQL 时不需要自己补 `TOP`/`ROW_NUMBER`。
- **传输边界**：写入为参数化多行 `VALUES` INSERT（TDS 单语句 2100 参数上限、`VALUES` 单语句 1000 行上限，每语句行数取两者最小值）。传输分页按目标库版本分流：2012+ 用 `OFFSET/FETCH`，**2008/2008R2 降级可用**——有序游标（keyset/range）用 `SELECT TOP (n) ... ORDER BY key`，无分片键的 offset 全序与 `keyAt` 切块用 `ROW_NUMBER() OVER (...)` 子查询；版本探测失败按 0 走保守降级。已知限制：目标表已存在且该列是 IDENTITY 时，写入显式值会报错 544（当前不自动 `SET IDENTITY_INSERT ON`）；传输自动建表不生成 IDENTITY 列。
- **真机验证**：真机用例组由环境变量 `DBT_TEST_SQLSERVER_URL` 门控（`tests/adapters-sql/sqlserver.test.ts`，未设置则整体 skip）；错误中文映射、参数默认值与 TLS 分族诊断由 Fake 驱动离线用例覆盖。
- 只读（ro）强度弱于 MySQL/PG，原因见下文「只读（ro）模式下的正确姿势」。

## 危险操作确认流程（NEEDS_CONFIRMATION）

收到形如以下的返回时：

```json
{"ok":false,"code":"NEEDS_CONFIRMATION","challengeId":"c_9f8e7d6c5b4a3210fedcba98","statement":"DROP TABLE users","danger":"danger","reason":"DDL 不可回滚（隐式提交）","hint":"..."}
```

必须按顺序执行：

1. **停下**，向用户原文说明：语句内容、危险原因（`reason`）。
2. 用户**明确同意**后，携带**同一个 `challenge_id`** 重试同一语句：
   `DatabaseManager({ action: "execute", conn_id: "c1", statement: "DROP TABLE users", challenge_id: "c_9f8e7d6c5b4a3210fedcba98" })`
3. 用户拒绝则放弃，不重试。

Challenge 属性：**一次性**（用过即失效）、绑定语句 hash（改语句后失效）、5 分钟过期。过期或无效会返回 `INVALID_CHALLENGE`，此时重新发起调用、走完整确认流程。**严禁**未经用户确认就重试；也**不要**为绕过确认而改写语句。

一次 challenge 只能覆盖一条语句——`run_script` 里多条危险语句必然在第二条起报 `INVALID_CHALLENGE`，多步写请逐条 `execute`。

会触发确认的典型操作：DDL（CREATE/ALTER/DROP/TRUNCATE）、所有 DML 写（INSERT/UPDATE/DELETE）、维护命令、Redis 危险命令（FLUSHALL、CONFIG 等）与写命令、Mongo 写 op（drop、deleteMany、updateMany 等）、以及部分危险读（如 Redis `KEYS *`）。SQL Server 另有：专属危险首词 `BACKUP`（DATABASE/LOG）、`RESTORE`、`DBCC`、`RECONFIGURE`、`BULK INSERT`、`SHUTDOWN`、`xp_cmdshell` 与其他 `xp_*`、`sp_configure`；`SELECT ... INTO <表|#临时表>`（T-SQL 建表副作用）与 `WITH ... (DELETE|UPDATE|INSERT)` 也判危险需确认；其中 `SELECT 1 INTO @t`（表变量/变量赋值）放行、`INSERT INTO ...` 仍按 DML 口径。注意一般 `EXEC sp_*`（非 `sp_configure`/`xp_*`）**未**单列危险，不会因此触发确认。另外这一层是「确认」语义；**ro 授权下** `SELECT ... INTO`、`WITH` 写体与 `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE` 会被适配器闸门**直接拒绝**（返回错误，无确认可走）。

## 侧边栏五个面板与辅助能力

侧边栏 tab 共 **5 个面板**（中英双语），用户问「在哪儿操作」时按下表指路；这些能力多数没有对应的工具 action。

| 面板 | 能力 | 底层 HTTP API（模型不可直接调用） |
|---|---|---|
| 连接管理 | 新增/编辑/删除连接、保存前测试草稿、连通性测试、导出/导入 | `/api/connections*`、`/api/test-draft` |
| 项目授权 | 为当前项目路径逐连接勾选 ro/rw、撤销 | `/api/grants` |
| 数据浏览 | 库/模式/表三级树、跨库表名搜索、数据预览网格 | `/api/databases`、`/api/schemas`、`/api/schema`、`/api/tables`、`/api/search-tables`、`/api/preview` |
| SQL 控制台 | 多标签编辑器、逐条执行、`GO`/`GO n` 批分隔、事务、结果网格（50 行/页，CSV/JSON 导出） | `/api/query`、`/api/execute`、`/api/console/*`、`/api/audit` |
| 数据传输 | 表数据搬运、实时进度；含「传输历史」「传输日志」两个子标签 | `/api/transfer/start`、`/api/transfer/{id}`、`/api/transfer/live`、`/api/transfer-history`、`/api/transfer-log` |

### 跨库表名搜索（仅在数据浏览面板）

按关键字模糊搜表名，ro 即可，命中项带 `database` 便于定位跳转。它**不是工具 action**，模型侧没有等价入口，只能引导用户去面板搜索，或自己逐库调 `schema`。

真实分流（不存在的实现不会「尽力而为」，直接返回空）：

| 库 | 实现方式 |
|---|---|
| MySQL / PostgreSQL / GaussDB | 适配器原生实现（一条 `information_schema` 模糊查询；pg 系可跨库） |
| SQLite / MongoDB | 回退「逐库 `listTables` + 内存过滤」（并发 8，个别库无权限不影响整体） |
| **Redis / Oracle / 达梦 / SQL Server** | **恒返回空**（无实现且语义不兼容：Redis 忽略库名会重复返回同一批键，Oracle/达梦 的库层语义是 owner） |

limit 1..200（默认 100）。搜不到时不要断言「表不存在」，换 `schema` 逐库确认。

### 连接导出 / 导入

| 操作 | 请求体 | 返回 |
|---|---|---|
| 导出 | `{passphrase}` | `{json, count}` |
| 导入 | `{json, passphrase}` | `{imported, skipped, errors}` |

- 整包加密：scrypt（N=16384, r=8, p=1）派生密钥 + AES-256-GCM，文件打开无明文；口令**服务端强制 ≥8 位**。
- 导入时 **id 冲突一律进 `skipped`、不覆盖已有连接**，可重复导入（幂等）。
- 口令错误与密文损坏统一报 `INVALID_ARGUMENT`（不区分原因，防口令探测）。
- 导出/导入**不需要项目授权**（属连接管理范围）；审计只记条数，不落口令与密文内容。

### 数据传输（侧边栏「数据传输」面板）

| 写入模式 | 语义 |
|---|---|
| `insert`（默认） | 追加；目标表已存在则整表失败（不覆盖已有数据） |
| `ignore` | 冲突行跳过 |
| `replace` | 冲突行覆盖（依赖主键） |
| `truncate` | 先清空目标表再全量写入，**清空不可恢复** |

- 授权要求：源端 ro 即可，目标端需 rw。
- 目标表不存在时按源表结构自动建表；`overwriteStructure` 可覆盖结构。
- **Redis 不支持传输**：读端与写端都返回「数据传输暂不支持」，源或目标任一端是 Redis 都无法搬运。
- 并行降级：目标 SQLite 单写者 → 表级并发钳 1、分片共享同一 writer（写入天然串行）；源 Oracle/达梦 走专用单连接读 → 表内不分片（表级并行仍生效）。
- 并发与批量：`tableConcurrency` ≤16 默认 4、`shardConcurrency` ≤32 默认 4、`batchSize` ≤5000 默认 1000、单表分片 ≤32；失败分片重试 1 次——重试的幂等性依赖 `ignore`/`replace`，`insert` 模式重试可能产生重复行。
- 上限：全局并发任务 8、单任务表数 1000、表名不可重复（重复即 `INVALID_ARGUMENT`）。
- 启动需危险确认（challenge 绑定「源→目标 + 表清单 + 模式 + 定位」，改任一字段即失效）。
- 结果查看：运行中看「实时进度」，终态进「传输历史」（limit ≤200，可按项目清除），全过程事件进「传输日志」（limit ≤2000）。
- 模型侧没有 transfer action，**不要伪造传输进度或结果**；只能引导用户在面板操作并读取其反馈。

### 控制台事务

| 步骤 | 行为 |
|---|---|
| 开始 | 需 rw 且**未选库**；返回 `sessionToken`，绑定一条粘性连接 |
| 执行 | 语义等同 `execute`：危险语句逐条走确认（一个 challenge 一条语句） |
| 提交/回滚 | 销毁会话并 close 适配器；token 随即失效 |

- **只有 rw 且未选库才能 begin**：ro 直接 `READ_ONLY`；带 `database` 入参被显式拒绝（粘性事务绑定连接默认库，跨库会静默跑错库）。
- **SQLite 无事务通道**：`begin` 报 `INVALID_ARGUMENT`（连接类型不支持控制台事务会话）。
- 单连接并发事务会话 ≤4；空闲 5 分钟自动回滚并审计（扫描周期 30s）；token 失效后再 `exec` 报 `NOT_FOUND`（已提交/回滚或空闲回收）。
- 撤销授权或 rw→ro 降级会立即回收该连接的全部事务会话并回滚未提交事务。

## 安全规范（必须遵守）

- **永远使用参数绑定**：`sql: "SELECT * FROM users WHERE id = ?"` + `params: [42]`。**禁止字符串拼接**用户输入进 SQL。
- **标识符白名单**：表名/列名无法参数化时，只能使用 `schema` action 返回的标识符，或引号包裹并转义（MySQL `` `name` ``、PG/SQLite `"name"`、Oracle/DM `"NAME"`、SQL Server `[name]` 且名字中的 `]` 双写为 `]]`）；禁止把用户原文直接嵌为标识符。
- 值中的引号交给参数绑定处理；确实无法绑定的场景先向用户确认。
- 不执行来历不明的语句；用户要求执行时，按危险确认流程处理。

## 只读（ro）模式下的正确姿势

- ro 授权下 execute/写类 run_script 会返回 `READ_ONLY`——**不要反复重试**，直接告知用户需要在侧边栏把授权升级为 rw。
- 探索数据用 `query` + `schema` + `preview` 组合即可完成绝大多数只读任务；批量导出优先分页（LIMIT/OFFSET 或 SCAN/fetch）而非一次性大查询。
- Redis ro 下用 `SCAN` 而非 `KEYS`；Mongo ro 下只允许 find/count 类 op。
- 结果集有行数上限（Oracle/达梦 500、Mongo aggregate 500、Redis 集合读 500、preview 50），要完整数据请分页推进并检查 `truncated`。
- **SQL Server 的 ro 强度弱于 MySQL/PG**：SQL Server 没有等价的会话级只读语句。ro 下适配器 query 闸门有五道：① 首词白名单（select/with/show/describe/desc/explain/use/set/help/table）；② 拒绝多语句（词法级：顶层分号之后出现任何内容即拒）；③ 拒绝 `SELECT ... INTO`（token 级，字符串/方括号标识符/注释内的 into 不误伤）；④ 拒绝 `WITH ... (INSERT|UPDATE|DELETE|MERGE)`；⑤ 拒绝 `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE`（远端/外部数据源执行任意语句、无法审计，连合法只读远端查询也一律拒）。服务层另拦 execute，guard 层对同样两类「读头写体」还会要求确认。**不要把 ro 连接当成数据库侧的只读隔离**；需要强隔离请换数据库侧只读账号。
