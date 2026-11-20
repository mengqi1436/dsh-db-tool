# Changelog — dsh-db-tool

## 未发布

本版给数据预览加上对齐 Navicat「Filter & Sort」的字段筛选：逐字段条件 + 多字段 AND/OR 联合。

### 新增(数据浏览)

- **字段筛选（对齐 Navicat「Filter & Sort」，逐字段 + 多字段联合）**：数据预览新增按字段筛选——对每个字段分别设置条件后多字段联合生效，条件间支持 AND / OR（Navicat 构建器的行间连接语义）。操作符对齐 Navicat 构建器全集（PG 专属大小写变体并入 contains，MongoDB 专属 exists/字段类型不提供）：`=` `!=` `<` `<=` `>` `>=`、包含 / 不包含、开头为 / 开头不是、结尾为 / 结尾不是、为 NULL / 不为 NULL、为空字符串 / 不为空字符串、介于 / 不介于、在列表中 / 不在列表中（列表以英文逗号分隔）。入口两处：分页条「筛选」按钮展开条件窗格（字段下拉 + 操作符下拉 + 值输入 + AND/OR 切换 + 添加/删除条件），列头漏斗对当前列快速添加包含条件（已生效列高亮）。筛选与内容搜索互斥提交（服务端两种谓词不叠加），筛选态下分页与「匹配 N 行」计数走同一谓词；切表自动复位筛选。
  - 服务端：`GET /api/preview` 新增 `filters`（JSON 数组）与 `logic`（`and`/`or`，缺省 and）参数，走新增服务方法 `previewFilters`，审计语句携带 `FILTER` 与条件摘要；适配器契约新增可选 `filterRows`，`countRows` 扩展筛选计数参数；SQL 系谓词由 `lib/adapters/sql-shared/filters.ts` 统一构造（mysql/sqlite/mssql 裸列或 CAST 文本 LIKE、PG `::text ILIKE`、Oracle/达梦 `UPPER(TO_CHAR(col))`，值一律绑定参数、列名过标识符校验 + 方言转义），MongoDB 构造 `$and`/`$or` 文档（`$regex` 转义，锚点在转义后拼接）；Redis 为 KV 型无行级语义，筛选入口与搜索框一样按连接类型隐藏（服务层对未实现适配器报 `INVALID_ARGUMENT`）。
  - 已知边界：MongoDB 比较类操作符按绑定字符串匹配（BSON 类型敏感），数值/日期列请用包含或同型字面值；SQL 系比较类依赖各库隐式类型转换（与 Navicat 手输值的语义一致）。

### 测试

- `tests/adapters-sql/filters.test.ts`（新增）：筛选条件解析边界（非数组/未知操作符/缺值/上限）、各方言 WHERE 与参数契约（mysql/pg/sqlite/mssql/oracle、AND/OR、in 列表去空白、通配符字面化）、sqlite 真机 filterRows/countRows 筛选语义（单字段、多字段 AND/OR 联合、between/in/is_null/is_empty、not 取反、通配符字面匹配、分页、适配器侧二次校验）。
- `tests/adapters-nosql-ent/mongodb.spec.ts`：`browseFilterDoc` 操作符形状契约（$regex 转义、锚点后拼、列表去空白、单条件不包 $and）与 `filterRows`/`countRows` mock 链路、非法条件二次校验。
- `tests/http/api.spec.ts`：`GET /api/preview filters=` 路由契约（未实现适配器报 INVALID_ARGUMENT、非法 JSON、空条件、未知操作符、filterRows/countRows 透传 filters+logic+limit+offset 与 total）。
- `tests/client/browse-filters.spec.ts`（新增）：筛选窗格结构（字段/操作符下拉、between 双值输入、is_null 无值输入）、表头漏斗入口与已生效列高亮、应用/清除/翻页请求契约（filters/logic/total 互斥提交）、Redis 能力面隐藏。
- `tests/tool/fixture.ts`：FakeAdapterOptions 新增 `filterRows` 注入口。

## 1.9.22

本版把数据浏览的三块补齐：目录树支持视图（Oracle / 达梦表 + 视图一次取全，MongoDB 视图结构页跳过索引）、目录树按当前账号的操作权限过滤，以及数据预览的分页快跳 / 总行数与 Navicat 式字段内容搜索。

### 新增(数据浏览)

- **数据浏览支持视图**：目录树在表之外同时列出视图，点开即可查看视图结构与预览视图数据（视图与表共用同一 describeTable / previewRows 路径）。此前 MySQL / PostgreSQL / GaussDB / SQLite / SQL Server 的视图已在树中（含 `· VIEW` 标注），本次补齐缺口：
  - **Oracle / 达梦**：`listTables` 由只查 `all_tables` / `ALL_TABLES` 改为表 + 视图一次取全（UNION ALL 派生表统一排序与 500 行截断），视图标 `VIEW` 类型并带注释（`all_tab_comments` / `ALL_TAB_COMMENTS` 同源）；`listDatabases` 的 schema 清单改为 `all_tables` ∪ `all_views`，只有视图没有表的 schema 此前整层不可见。
  - **MongoDB**：`describeTable` 对视图跳过 `listIndexes`（视图无索引，此前点开视图结构页整体报 CommandNotSupportedOnView 错误），字段抽样推断照常。

- **目录树按操作权限过滤**：数据预览（目录树）只列出当前数据库账号实际可读的对象——对模式有操作权限（含仅查看/只读权限）才可见，无权限的直接隐藏：
  - **PostgreSQL / GaussDB**：库名清单按 CONNECT 权限过滤（`has_database_privilege`）；schema 清单要求对模式有 USAGE 且其中至少一张关系（表/视图/物化视图/分区表/外部表）可 SELECT（`has_table_privilege`）。
  - **SQL Server**：库名清单按 `HAS_DBACCESS` 过滤；schema 清单要求 schema 级 SELECT 授权或其中至少一张表/视图可对象级 SELECT；表/视图清单只列出可 SELECT 的对象（列级授权不含在内，与不可预览即隐藏的原则一致）。
  - MySQL / Oracle / 达梦 / MongoDB / Redis / SQLite 的服务端清单已按各自模型天然收敛到可读范围，不改动。

- **分页快跳与总行数**：数据预览分页条新增「首页 / 末页」直达按钮与页码输入快跳（回车提交，越界钳制到 [1, 总页数]），并展示表格总行数。总行数走服务端新增的 `countRows` 适配器方法（`SELECT COUNT(*)` / `countDocuments`），仅在打开表或变更搜索时请求一次，翻页沿用已存值不再重复计数；计数失败不拖垮预览主路径（退化为无总页数模式，仅保留上一页/下一页）。
- **字段内容搜索（Navicat 式跨列包含匹配）**：数据预览分页条新增搜索框，关键字对表格全部列做大小写不敏感包含匹配：SQL 系走 `LIKE`/`ILIKE` + 显式 `ESCAPE '#'`（`%`/`_`/`#` 字面化，关键字本体一律绑定参数），列名清单由 `SELECT * … LIMIT 0` / `WHERE 1=0` 的元数据一次往返取得；Oracle/达梦用 `UPPER(TO_CHAR(col)) LIKE` 统一转文本；MongoDB 抽样字段集逐字段 `$regex`（非字符串值天然不匹配）；搜索态下分页与「匹配 N 行」计数走同一谓词。Redis 为 KV 型无行级语义，搜索框与总页数按连接类型隐藏（服务层同样对未实现的适配器报 `INVALID_ARGUMENT` 防御）。
- **`GET /api/preview` 契约扩展**：新增 `search` 参数（有值走内容搜索路径，新增服务方法 `previewSearch`，审计语句携带 `SEARCH` 与关键字）与 `total=1` 参数（响应附带 `total` 全量行数）；`QueryResult` 契约新增可选 `total` 字段。

### 测试

- `tests/adapters-nosql-ent/oracle-dmdb.spec.ts`：Oracle / 达梦 `listTables`、`listDatabases` 契约改为表 + 视图取全断言（SQL 含 `all_views` / `ALL_VIEWS`、视图行类型 `VIEW`、UNION 双分支绑定 owner 两次）。
- `tests/adapters-nosql-ent/mongodb.spec.ts` 新增 2 条：视图 describeTable 不调 `indexes`、集合 describeTable 索引注入行为不变。
- `tests/adapters-sql/pg-like.test.ts`：`listDatabases` 增加 CONNECT 权限谓词契约，`listSchemas` 增加 USAGE + 任一关系可 SELECT 谓词契约。
- `tests/adapters-sql/sqlserver-offline.test.ts`：`listDatabases` 增加 `HAS_DBACCESS` 契约，`listSchemas` 增加 schema 级/对象级 SELECT 权限谓词契约，`listTables` 增加对象级 SELECT 过滤断言。
- `tests/e2e-mock/sqlserver.spec.ts`：Fake 按分支判别顺序适配（`listSchemas` SQL 现含 `sys.objects` 权限子查询，先判 schema 级权限谓词再判 `sys.objects`）。

## 1.9.21
