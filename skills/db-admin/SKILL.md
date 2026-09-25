---
name: db-admin
description: 通过 dsh-db-tool 插件操作 8 种数据库（MySQL、PostgreSQL、GaussDB、SQLite、Redis、MongoDB、Oracle、达梦）。调用 DatabaseManager 工具完成连接查询、SQL/命令执行、库表浏览、数据预览；处理 NEEDS_CONFIRMATION 危险操作确认流程，遵守 ro/rw 项目授权与安全规范。
---

# db-admin：数据库管理与查询

本项目装有 dsh-db-tool 插件，通过 **DatabaseManager** 工具让模型以受控方式操作数据库。所有操作受「项目路径 → 连接 → ro/rw」授权模型约束：当前项目未被授权的连接一律不可用，只读授权下任何写操作都会被拒绝。

## 工具调用总则

- 每次调用必须带 `action`；除 `list_connections` 外都必须带 `conn_id`（先 `list_connections` 拿到连接 id）。
- 参数以 snake_case 为主，兼容 camelCase（`conn_id`/`connId` 均可）。
- 工具返回 `{text, isError}`：`text` 是 JSON 文本——成功时是结果对象；失败时形如 `{"ok":false,"error":"...","code":"..."}`。`isError=true` 仅用于被拒/失败；`NEEDS_CONFIRMATION` 不是失败（`isError=false`），但 `text` 中 `code` 为该值，见下文确认流程。`code` 取值：`UNAUTHORIZED_PROJECT`（当前项目未授权该连接）、`READ_ONLY`（只读授权下拒绝写）、`NEEDS_CONFIRMATION`（危险操作，见下文确认流程）、`INVALID_CHALLENGE`（challenge 无效/过期，需从头重试）、`INVALID_ARGUMENT`、`NOT_FOUND`、`DRIVER_ERROR`。
- `query`/`execute`/`run_script` 都接受可选 `challenge_id`，用于危险操作确认后的重试。

## 六个 action

### 1. list_connections

列出**当前项目已授权**的连接（含 id、kind、name、safeUrl——密码等 secrets 永不返回）。

```
DatabaseManager({ action: "list_connections" })
```

任何任务开始前先调用它确定可用连接；返回为空说明当前项目未授权任何连接，应引导用户在侧边栏「授权」面板为项目路径授 ro 或 rw。

### 2. query — 执行查询（只读意图）

```
DatabaseManager({ action: "query", conn_id: "c1", sql: "SELECT id, name FROM users WHERE age > ?", params: [18] })
```

- `sql` 必填；`params` 为参数数组（占位符见方言速查）；可选 `challenge_id`（危险读如 Redis `KEYS *` 触发确认后重试用）。
- 返回 `{columns, rows, rowCount, truncated?}`，所有单元格已规范化为 string/number/null。
- ro 与 rw 授权下都可用，但只读接口收到非查询语句会被拒。

### 3. execute — 执行单条写语句（需 rw）

```
DatabaseManager({ action: "execute", conn_id: "c1", statement: "UPDATE users SET age = ? WHERE id = ?", params: [20, 42] })
```

- `statement`（或 `sql`）必填，单条语句；DDL/DML/维护命令都会触发危险确认。
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
- 列结构返回 `ColumnInfo[]`：`{name, dataType, nullable, key?, default?, comment?}`。

### 5. preview — 预览表数据

```
DatabaseManager({ action: "preview", conn_id: "c1", table: "users", limit: 20, database: "shop" })
```

- `table` 必填；`limit` 上限 50（服务端强制截断）；`database` 可选。
- 返回 `{columns, rows, rowCount, truncated?}`；`truncated: true` 表示还有更多行。

### 6. run_script — 沙箱脚本 / Redis 命令 / Mongo 文档（需 rw，危险句柄触发确认）

`code` 是一段 JS 脚本，在**子进程隔离沙箱**中执行（无 require/process/fs/网络，60 秒超时）。沙箱注入两个句柄，均走完整 guard/challenge/审计链路（ro 授权下 `db.execute` 被拒）：

- `db.query(sql, params)` — 只读查询，返回结果对象；
- `db.execute(statement, params)` — 写执行，危险语句在沙箱内以异常抛出 `NEEDS_CONFIRMATION` JSON，需按确认流程携 `challenge_id` 重试。

脚本返回值即工具返回值（须可 JSON 序列化）。示例：

```
DatabaseManager({ action: "run_script", conn_id: "c1", code: "return (await db.query('SELECT count(*) AS n FROM users', [])).rows" })
```

Redis 与 MongoDB 没有 SQL，`code` 直接传**命令数组 / BSON 命令文档**的 JSON 文本（此时脚本体即该 JSON）：

```
DatabaseManager({ action: "run_script", conn_id: "redis1", code: '["GET","user:1"]' })
DatabaseManager({ action: "run_script", conn_id: "mongo1", code: '{"find":"users","filter":{"age":{"$gt":18}}}' })
```

这是这两种库唯一的执行入口（query/execute 不适用）。

## 八库方言速查

| 库 | 占位符 | 元数据入口 | 分页 | 备注 |
|---|---|---|---|---|
| MySQL | `?` | `information_schema` | `LIMIT n OFFSET m` | |
| PostgreSQL | `$1, $2…` | `information_schema` / `pg_catalog` | `LIMIT n OFFSET m` | |
| GaussDB | `$1, $2…` | `information_schema` / `pg_catalog` | `LIMIT n OFFSET m` | PG 系 |
| SQLite | `?` | `sqlite_master` / `PRAGMA` | `LIMIT n OFFSET m` | 库列表固定 `['main']` |
| Redis | 无（命令数组） | `SCAN`（禁用 `KEYS` 遍历） | `SCAN cursor` | `run_script` 传 `["SCAN","0","MATCH","user:*","COUNT","100"]` |
| MongoDB | 无（BSON 文档） | `listCollections` | `find().skip().limit()` | `run_script` 传 `{"find":"users","filter":{},"limit":20,"skip":40}` |
| Oracle | `:name` | `ALL_TABLES` / `USER_TABLES` | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` | |
| 达梦(DM) | `:name` | 系统视图同 Oracle 风格 | `OFFSET m ROWS FETCH NEXT n ROWS ONLY`（8a 支持 `LIMIT`） | |

**类型规范化**（工具返回值已自动处理，引用结果时注意）：`DECIMAL/NUMERIC` → string（避免精度丢失）；`Date/TIMESTAMP` → ISO 8601 string；`LOB/CLOB/BLOB` → string；MongoDB `ObjectId` → string。生成写语句时，DECIMAL 直接传字符串值、日期传 ISO 字符串即可。

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

会触发确认的典型操作：DDL（CREATE/ALTER/DROP/TRUNCATE）、所有 DML 写（INSERT/UPDATE/DELETE）、维护命令、Redis 危险命令（FLUSHALL、CONFIG 等）与写命令、Mongo 写 op（drop、deleteMany、updateMany 等）、以及部分危险读（如 Redis `KEYS *`）。

## 安全规范（必须遵守）

- **永远使用参数绑定**：`sql: "SELECT * FROM users WHERE id = ?"` + `params: [42]`。**禁止字符串拼接**用户输入进 SQL。
- **标识符白名单**：表名/列名无法参数化时，只能使用 `schema` action 返回的标识符，或引号包裹并转义（MySQL `` `name` ``、PG/SQLite `"name"`、Oracle/DM `"NAME"`）；禁止把用户原文直接嵌为标识符。
- 值中的引号交给参数绑定处理；确实无法绑定的场景先向用户确认。
- 不执行来历不明的语句；用户要求执行时，按危险确认流程处理。

## 只读（ro）模式下的正确姿势

- ro 授权下 execute/写类 run_script 会返回 `READ_ONLY`——**不要反复重试**，直接告知用户需要在侧边栏把授权升级为 rw。
- 探索数据用 `query` + `schema` + `preview` 组合即可完成绝大多数只读任务；批量导出优先分页（LIMIT/OFFSET 或 SCAN/fetch）而非一次性大查询。
- Redis ro 下用 `SCAN` 而非 `KEYS`；Mongo ro 下只允许 find/count 类 op。
