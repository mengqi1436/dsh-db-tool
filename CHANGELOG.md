# Changelog — dsh-db-tool

## 未发布

本版继续收敛筛选窗格对数据区的遮挡：应用筛选后窗格自动收起，数据区与窗格表面改为宿主画布同源的不透明底色，透明透底不再出现。

### 变更(数据浏览)

- **应用筛选后窗格自动收起**：点「应用筛选」（或值输入回车）后条件窗格立即收起、草稿清空，数据区回到最大可视；生效条件数在「筛选 · N」按钮与列头漏斗高亮上体现，再点「筛选」自动带回已提交条件继续编辑。
- **数据区不透明化**：数据表格区与筛选窗格底色改用宿主画布 token（`--dsw-alias-bg-base`，缺省回退随主题的实色 `#151517` / `#ffffff`），不再使用半透明表面——任何宿主画布内容都不会透过数据区显示，杜绝「透明弹窗」观感。
- 条件行区限高 150px 内部滚动（3 条件行场景下窗格总高约 110px），配合自动收起，数据表格在窗格任何状态下都保持主要可视面积。
- 前后对照取证：`assets/navicat-column-filters-compact/`（亮/暗 × Before/After × 500px@2x；DOM 量化条件行高 58→28px、窗格 238→138px、数据表格顶边 720→620；像素机器校验文字像素占比 > 0）。


- **筛选窗格紧凑化（对齐 Navicat 构建器布局密度）**：条件行区限高 200px 内部滚动——窗格展开不再把数据表格挤出可视区；条件行改单行不换行，字段 / 操作符下拉定宽 140px、值输入占满剩余宽度、行间 AND-OR 下拉 80px，多行条件下各列对齐（Navicat 构建器同款排布）；工具条（添加条件 / 应用筛选 / 清除筛选）固定在条件行区上方。
- 前后对照取证：`assets/navicat-column-filters-compact/`（亮/暗 × Before/After × 500px@2x，真实 `dist/` + 双版本真实 `client.js` + 真实 sqlite 示例库；DOM 机器校验窗格结构契约，像素机器校验文字像素占比 > 0）。

## 1.9.26

本版把项目授权卡片的视觉与授权等级一一绑定：未授权=灰、只读=绿、读写=红，扫一眼即可分辨每个连接的授权状态，无需逐卡读字。

### 变更(项目授权)

- **授权卡片三态着色**：模式徽标语义由「读写=绿、只读=灰、未授权无徽标」改为「未授权=灰、只读=绿、读写=红」——只读=安全绿、读写=高风险红（与语句确认弹窗目标条 rw=danger 同语义）、未授权=中性灰（复用 `--dbt-text-secondary`/`--dbt-success`/`--dbt-danger` 既有 token，亮暗主题自动反转）；未授权也渲染灰色「未授权」徽标（不再留空）；整卡描边与徽标同色，卡片群中三态一眼可辨。文案、seg 选择器与授权链路（seg 点击 → PUT/DELETE `/grants`）完全不变。
- 前后对照取证：`assets/grant-card-colors/`（亮/暗 × Before/After × 默认/交互态 × 500px@2x，真实 `dist/` + 双版本真实 `client.js` + 真实 PG/SQLite 示例库；DOM 机器校验徽标/描边颜色与 seg 契约，像素机器校验画布 token 值、前景像素占比与三态描边逐色计数）。

### 测试

- `tests/client/grant-cards.spec.ts`：模式徽标契约改为三态（未授权灰「未授权」/只读绿「只读」/读写红「读写」，均 aria-hidden），新增徽标颜色+描边同色逐卡断言；分组网格、地址副行、seg 整卡宽与授权链路等其余用例不变。

本版把数据预览的内容查找统一到 Navicat 式逐字段筛选：跨列「搜索字段内容」搜索框从浏览界面移除。

### 变更(数据浏览)

- **「字段搜索」改为「筛选」**：数据预览分页条不再提供跨列关键字搜索框；对某列内容做包含匹配改由列头漏斗一键完成（点列头漏斗 → 该字段「包含」条件行 → 输入值 → 应用/回车），多字段联合继续走筛选窗格（复选框启停 / 行间 AND-OR / 混合连接符左结合括号）。服务端 `/api/preview` 的 `search` 参数与适配器 `searchRows`/`countRows` 搜索契约原样保留（审计、脚本与 API 调用方不受影响），仅浏览界面收敛为单一筛选入口；Redis 仍按连接类型隐藏筛选入口。
- `tests/client/preview-pager.spec.ts`：跨列搜索框移除契约（分页条无搜索输入、样式类改为筛选窗格）、快跳翻页不重拉计数、筛选零匹配空态；`tests/client/browse-filters.spec.ts`：状态槽位随搜索态移除同步更新。

## 1.9.25

本版把项目授权视图改为连接管理同款的卡片样式：按数据库类型分组、每张连接一张授权卡，授权模式选择更大更直观；授权链路（seg 点击 → PUT/DELETE `/grants`）与 ro/rw 语义完全不变。

### 变更(项目授权)

- **授权视图卡片化（对齐连接管理）**：连接行式列表（`dbt-group/dbt-listrow` 一张 inset grouped 卡）改为按数据库类型分组小节（`dbt-kindgroup`，节头 = 类型简称 + 数量，组序按 DB_KINDS）+ 自适应卡片网格（`dbt-conncards/dbt-conncard`，auto-fill + minmax 随侧栏宽度自适应列数与卡片大小）。每张连接一张授权卡：头行为 kind 胶囊（带数据库图标）+ 连接名 + 模式徽标（读写=绿描边胶囊、只读=灰描边胶囊，`aria-hidden`，seg 仍是权威状态源），地址副行展示 safeUrl / host:port（单行省略 + title 全文，帮助区分同名连接），底部为整卡宽三段均分的授权 seg（未授权/只读/读写；`flex:1 1 0` + `width:100%` + `box-sizing:border-box` 内联覆盖，目标更大更易点选，窄卡长英文文案单行省略优雅降级）。样式全部复用既有 `--dbt-*` token 与连接管理卡片类，无新增 CSS 规则与配色源；空授权引导文案「每行」改「每张卡片」（中英同步），状态摘要行、`busy=grant` 禁用与空连接引导不变。
- 前后对照取证：`assets/grant-cards/`（亮/暗 × Before/After × 500px@2x，真实 `dist/` + 双版本真实 `client.js` + 真实 PG/SQLite 示例库；DOM 机器校验卡片分组/seg 整卡宽/aria 契约，像素机器校验画布 token 值与文字像素占比 > 0）。

### 测试

- `tests/client/grant-cards.spec.ts` 新增 8 条：授权视图不再渲染 `dbt-group/dbt-listrow`、分组小节 + 卡片网格结构（组序/节头/数量）、卡片头行（kind 胶囊带 svg 图标、PG 简称、ro/rw 徽标 aria-hidden 且未授权无徽标）、地址副行（safeUrl / host:port 回退 + title 全文）、seg 整卡宽三段均分与 radiogroup/aria-checked 契约、状态行（空授权引导文案 / 计数摘要 / 无连接空态无网格）、授权链路（PUT 带 projectPath+connId+mode、DELETE 仅 projectPath+connId、成功后 reload、busy=grant 全量禁用）。
- `tests/client/conn-cards.spec.ts` 契约同步：连接管理与项目授权各有一处 `dbt-conncards/dbt-conncard`（计数 1→2），`dbt-kindchip` 全仓仍两处（连接卡片头行 + 授权卡片头行）；`dbt-group/listrow` 留给控制台/传输等视图。

本版修复连接保存链路的两处「配置测试成功、保存后不生效」：Redis 分字段库号被静默丢弃（保存后永远连 db0），以及字符串端口保存后编辑回填/卡片端口消失（前端 v1.8.1 起端口原样发字符串的遗留回归）。

### 修复(Redis)

- **分字段保存的库号（database）静默丢弃，保存后永远连 db0**：`buildUrl` 只认 `typeof database === 'number'`，而前端所有字段原样发字符串（v1.8.1 起），填 `2` 存的是字符串 `'2'` → URL 不拼 `/2` → 连接静默落在 db0。测试连接测不出（PING 不分库），保存后浏览/操作的是错误逻辑库。现与端口同口径：合法数字串转 number 拼入 URL，`0`/留空=默认 db0 不拼路径段，非负整数以外的值 fail-closed 抛中文错误（不再静默回退）。数据传输的 Redis 读/写连接同样经 `buildUrl`，一并修复。

### 修复(连接管理)

- **字符串端口保存后编辑回填与卡片端口消失**：前端 v1.8.1 起端口原样发字符串（fail-closed 校验移到适配器侧 `validPort`），但 `toMeta` 只回显 `typeof port === 'number'` 的端口——分字段保存的连接 `meta.port` 缺失，编辑弹窗端口空白、连接卡片丢端口、传输页端口显示「—」，被误读为「保存没保存上」。现把合法数字串（1-65535 整数）投影为 number 回显，已存老记录同样修复；非法值仍省略不回显假值（连接时由适配器报错）。

### 测试

- `tests/adapters-nosql-ent/redis.spec.ts` 新增 4 条：`buildUrl` 字符串库号 `'2'`/`'15'` 拼入 URL 且与数字等效、留空/`0` 不拼路径段、非法库号（`'abc'`/`-1`/`1.5`/`true`）抛中文错误、`createRedisAdapter` 非法库号在 connect 前抛错（不触网）。
- `tests/store/connections.spec.ts` 新增 1 条：字符串端口 `'14330'`/`'6379'` 经 create/update/list/get 回显为 number，非法端口 `'abc'` 不回显假值。

## 1.9.24

本版修复 1.9.23 在真机宿主上右侧栏完全不显示的回归：apply() 改用官方文档指定的可选服务查询写法（ctx.get("uiConversation")，缺失即整体跳过、记号退化为普通文本），不再声明进 inject；同时把 skills/db-admin/SKILL.md frontmatter description 中破坏 YAML 解析的 @db:/@col: 记号改写为无冒号表述。


### 修复(右侧栏)

- **修复 1.9.23 在真机宿主上右侧栏完全不显示的回归**：`apply()` 里裸读 `ctx.uiConversation`（可选服务，未声明进 `inject`），而 vendored cordis 的 Context 代理对未声明 inject、也未 provide 的服务属性是「读取即抛」（`cannot get property "uiConversation" without inject`）——异常冒出 `apply` 后插件 fiber 直接 failed，页签类型、正文/标题席位、引导卡片全部注册不上，引导页没有「数据库」入口，真机宿主启动日志报 `web boot: warning: 1 entry did not activate`。改回官方文档指定的可选服务查询写法（`framework/service`：「Optional: omit inject and query with ctx.get() at the use site」）：`ctx.get("uiConversation")` 缺失返回 `undefined` 时整体跳过，记号退化为普通文本，语义与原注释一致；极旧宿主连 `ctx.get` 都没有时同样跳过。`inject` 仍不声明 `uiConversation`——声明会把不提供该服务的旧宿主变成整插件永久 pending，比跳过引用功能严重得多。本地普通对象桩读未声明属性只是 `undefined`，此前永远复现不了该故障；`tests/client/sidebar-registration.spec.ts` 新增「严格 ctx」契约组（Proxy 桩按 vendored cordis 同语义对未声明服务属性抛错），锁定：`apply` 在严格 ctx 下注册完整、宿主缺 `uiConversation` 时零 mention 注册不抛错、`exports.inject` 不含 `uiConversation`；`tests/client/table-mention.spec.ts` 的 `makeApplyCtx` 改为按 `ctx.get()` 契约供数（桩不再挂 `uiConversation` 属性，回退到属性读取的写法会直接拿不到服务）。
### 修复(技能)

- `skills/db-admin/SKILL.md` frontmatter description 中的 `@db:/@col:` 记号含 ASCII 冒号+空格，破坏 YAML 纯量解析（任何标准 YAML 解析器报 mapping values are not allowed here，技能加载时 frontmatter 读不出），改写为无冒号的 `@db 与 @col 表/字段引用记号`；正文不受影响。

### 文档(技能)

- `skills/db-admin/SKILL.md` 补齐 1.9.22 / 1.9.23 的模型侧行为：新增「表/字段引用（@db: / @col:）」一节（记号来自数据浏览面板的面包屑/结构页行入口，不是文件路径；`@db:` 段位解析为 conn_id + database（第 3 段存在时传 "库名.模式"）+ 表名、`@col:` 末段为列名；段内 %XX 先解码；结构不确定先 `schema`，取值用 `query` / `preview`；引用不绕过授权与确认）；`schema` 说明补「表与视图一起列出」（SQL 系视图 type `VIEW`、PG 系物化视图等原样标注、MongoDB `collection`/`view`、MongoDB 视图结构页不含索引）与「清单按账号权限过滤」（PG/GaussDB CONNECT/USAGE+SELECT、SQL Server HAS_DBACCESS/SELECT，清单里没有 ≠ 不存在）；九库方言速查 Oracle / 达梦元数据入口改为表+视图一次取全；侧边栏数据浏览面板行补视图、权限过滤、总行数、分页快跳、跨列内容搜索与 @ 引用入口（`/api/preview` 支持 `search` / `total` 参数）。

## 1.9.23

本版新增数据浏览的表/字段 @ 引用：面包屑与结构页每字段行各有一个行悬停浮现的 @ 入口，把表以 `@db:`、列以 `@col:` 记号插入对话输入框，对话中渲染为独立引用 chip，模型侧据约定用 query / preview / schema 实时读取该表或该列。

### 新增(数据浏览)

- **@表/字段引用（数据浏览 → 对话）**：面包屑行与结构页每个字段行各有一个 @ 引用入口，把当前表以 `@db:<连接id>/<库名>[/<模式>]/<表名>`、该列以 `@col:<连接id>/<库名>[/<模式>]/<表名>/<列名>` 记号插入当前会话输入框。入口为侧边栏同款「行悬停浮现」的紧凑图标钮：平时整组隐藏（`display:none`），悬停所在行 / 键盘聚焦按钮时浮现（`@media (hover: hover)` + `:focus-within`），触屏（`hover: none`）恒显；按钮 24px 命中区 + 14px @ 字形，静置 tertiary / 悬停 primary，配色走宿主 alias token（`--dsw-alias-label-*`，缺失回退插件变量）。插入均经宿主 conversation.input 通道进光标处并聚焦；宿主链路缺失或输入框提交中拒插时退化为剪贴板复制并就地提示。对话文本中的两类记号经宿主 UserText 管线渲染为独立引用 chip——本插件注册 `db-mention` 识别规则（order 25 早于宿主文件/目录引用规则 30，同起点命中时低序胜出，`@db:` / `@col:` 不再被误认成指向不存在文件的文件引用）并按命名空间分流到 `db-table` / `db-column` 两个 `conversation.user.text.node` 渲染席位（chip 只展示，不挂点击行为）。段内空白与 `/` 以 URL 转义（%XX）保持单 token；旧宿主缺 `uiConversation` 服务时记号退化为普通文本，不影响插入。
- **`DatabaseManager` 工具说明新增表/字段引用解读约定**：`@db:` 与 `@col:` 记号的段位语义（3/4 段为表、4/5 段为列，database 传 "库.模式"）、「不是文件路径、不要用文件读取工具」与 %XX 解码要求，使对话收到引用后可直接用 query / preview / schema 实时读取该表或该列。

### 测试

- `tests/client/table-mention.spec.ts` 新增 31 条：记号编解码 round-trip（@db: 三段/四段、@col: 四段/五段、%XX 转义与非法序列）、`DB_MENTION_RULE` 识别契约（词法边界、from 偏移、尾标点、裸 `@db:`/`@col:` 与非 `@db:` token 不捕获、order 25 早于宿主文件规则的同起点胜出、@db:/@col: 混合文本分流）、chip 渲染（表名/表.列 + 原文 title、无点击行为）、`insertDbMention` 宿主链路（插入 "token + 空格" 并聚焦 / scope 不匹配与链路缺失 unsupported / 输入框拒插 busy 不聚焦 / 链路抛错降级）、BrowsePane 集成（mysql 两层与 PG 三层选中表后面包屑按钮插入正确表记号、结构页每字段行按钮插入正确列记号、未选中不渲染按钮）、apply() 注册契约（有 `uiConversation` 注册规则与两个 chip 席位且随 disposer 撤销、无则不注册）。

本版给数据预览加上对齐 Navicat「Filter & Sort」的字段筛选：逐字段条件 + 多字段 AND/OR 联合。

### 新增(数据浏览)

- **字段筛选（对齐 Navicat「Filter & Sort」，逐字段 + 多字段联合）**：数据预览新增按字段筛选——对每个字段分别设置条件后多字段联合生效，条件间支持 AND / OR（Navicat 构建器的行间连接语义）。操作符对齐 Navicat 构建器全集（PG 专属大小写变体并入 contains，MongoDB 专属 exists/字段类型不提供）：`=` `!=` `<` `<=` `>` `>=`、包含 / 不包含、开头为 / 开头不是、结尾为 / 结尾不是、为 NULL / 不为 NULL、为空字符串 / 不为空字符串、介于 / 不介于、在列表中 / 不在列表中（列表以英文逗号分隔）。窗格对齐 Navicat 构建器布局：工具条（添加条件 / 应用筛选 / 清除筛选）+ 条件行「复选框（启停，未勾选行不参与提交）+ 字段下拉 + 操作符下拉 + 值输入 + 行间 AND/OR 下拉 + 删除」，行间连接符逐行指定、混合 AND/OR 服务端按左结合括号求值（`(c1 AND c2) OR c3`，`logics` 参数逐行上报，缺省回退全局 `logic`）；分页条「筛选」按钮展开/收起窗格，列头漏斗对当前列快速添加包含条件（已生效列高亮）。筛选与内容搜索互斥提交（服务端两种谓词不叠加），筛选态下分页与「匹配 N 行」计数走同一谓词；切表自动复位筛选。
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
