# Changelog — dsh-db-tool

## 1.9.4

SQL Server 连接改为「开箱即连」：表单只留主机/端口/账号/密码，加密参数收进「高级选项」，新建连接默认 `encrypt=auto`——不加密优先，服务器强制加密时自动升级并信任其证书。

### 新增

- **前端「高级选项」折叠区**：`trustServerCertificate` / `serverName` / `caCert` / `tlsMinVersion` / `tdsVersion` 等参数从主表单移入默认收起的折叠区，主表单只留主机、端口、账号、密码与库名。这些控件本身及其校验、回填逻辑不变，只是换了入口——常规连接不再需要理解加密参数，排障时展开即可。
- **`encrypt=auto`（新建连接默认值）**：建连先不带加密；若服务器**强制加密**（如 `Force Encryption=Yes` 或 Azure SQL，表现为 `EENCRYPT` / 「服务器要求加密连接」），自动改用 `encrypt=true` + `trustServerCertificate=true` 重试一次。服务器未强制加密的实例（内网自建居多）因此不再被自签证书问题挡住，这是「像 Navicat 一样开箱即连」的核心。

### 修复

- **不再因为默认值而必须先读懂 TLS 才能连库**：此前默认 `encrypt=true` + `trustServerCertificate=false`，连自签证书实例必然失败并报证书错误，用户必须先展开并理解 `caCert` / `serverName` 才连得上。现在这条路径由默认策略自己消化，证书参数退化为纯排障工具。这是默认值调整带来的连带效果，并非独立缺陷修复。

### 行为变更（升级须知）

- **默认 `encrypt` 从 `true` 改为 `auto`**，新建连接的行为随之改变，详见上文。
- **自动重试的安全边界（有意收窄，不要当作无限兜底）**：
  - **仅重试一次**，不做重试链；失败即把原始错误抛给用户。
  - **仅针对「服务器强制加密」这一种原因**。证书校验失败（`self signed certificate` / `CERT_` 家族）、TLS 版本协商失败（`UNSUPPORTED_PROTOCOL`）、登录失败等其他原因**不触发重试**——盲目重试会覆盖真实错因，把排障引向错误方向。
  - **显式指定 `encrypt` 时不做任何重试**（`true` / `false` / `strict` 皆是）。显式值即最终策略，工具不替用户改主意，行为完全可预期。
- **`auto` 不是「自动加密」**：在未强制加密的服务器上，`auto` 的行为与 `encrypt=false` 相同，即**明文发送 LOGIN7（含账号密码）**。默认值的定位是「可信内网开箱即连」，跨公网或不可信网段请显式设 `encrypt=true`。README / README_EN 与两份 SKILL.md 均已同步这条风险说明。

## 1.9.3

SQL Server 支持范围扩到 2005（9.0）→ 2025（17.0），修复前端无法配置加密参数导致的「怎么改都连不上」，并在面板上加插件版本号标签。

### 新增

- **项目行最右侧显示插件版本号**：以 `v1.9.3` 胶囊标签钉在项目路径行行尾，只读态与编辑态共用同一枚标签（进入编辑不会消失）。版本号由新增的 `GET /api/version` 从 `package.json` 读取下发，而非前端写常量——发版时版本号已在三处同步，再维护一份前端常量必然漂移（最坏情况是界面显示 1.9.3 而实际装的是旧版，用户报障时给出错误版本）。读不到时返回 `unknown`、前端不渲染胶囊且不报错：版本展示属辅助信息，不能污染面板错误条，也不该变成后台反复失败请求。

### 修复

- **登录阶段错误分诊原本完全失效（代码审查发现，已修）**：8 个错误号（17819/17898/17802/17835/17836/17828/17832/47072）此前只按 `err.number` 查表，但这些错误**全部发生在建连/登录阶段**，而 tedious 的 `Login7TokenHandler.onErrorMessage` 构造的是 `new ConnectionError(token.message, 'ELOGIN')`——`token.number` 只用于判断临时错误，**没有赋给 error 对象**（只有查询阶段的 `RequestError` 才有 number）。真实链路上 `number` 恒为 `undefined`，于是诊断全部退化成「用户名或密码错误」：17819（服务器只接受 strict 加密）会被误报成密码错，17835（服务器强制加密）不会提示开加密，反而叠加无效的「装 CA」建议。现补 `hintByText()`：`number` 缺失时按服务器原文特征反查（特征取自官方 `sys.messages` 最独特片段，宁可漏匹配退回通用文案，也不错匹配给错药方），并让 `ELOGIN` 分支在命中特征时优先给针对性诊断而非「用户名或密码错误」。
- **`caCert` 曾把信任范围从 137 张缩到 37 张（代码审查发现，已修）**：`applyCaCert` 原先以 `systemCa()` 打底、不含内置 bundle。而 Node 一旦收到 `ca` 选项就不再使用默认信任库，于是「为连 A 实例装一张自签 CA」会导致**所有走公网 CA 的实例全部连不上**（`SELF_SIGNED_CERT_IN_CHAIN`）——恰是 `applySystemCaDefault` 注释里警告过的失败模式。现三处统一走 `mergedCaWith()`：内置 bundle + 系统信任库 + 用户 CA 去重合并，并加模块级缓存（避免每次建连重复读证书与重复构造 SecureContext）。
- **单行 PEM 会静默失效（代码审查发现，已修）**：前端 `caCert` 是单行 `<input>`，粘贴多行 PEM 时换行被压平；而 `tls.createSecureContext({ca:[单行PEM]})` **不报错**（实测静默接受），握手时才失败并报 `DEPTH_ZERO_SELF_SIGNED_CERT`——用户看到的是"填了 CA 还是同样的错"。现 `normalizePem()` 自动按 64 列折行还原（已验证折行结果与原 PEM 内容等价且可被 `createSecureContext` 接受），残缺 PEM（有 BEGIN 无 END）则 fail-closed 报错而非静默接受。
- **`serverName` 未 trim**：`?serverName=%20`（一个空格）会被当成有效值注入，现与其它参数同口径先 trim 再判空。


- **前端补齐加密参数入口（用户可见的核心修复）**：分字段表单此前只暴露 `tlsMinVersion`，没有任何 `encrypt` / `trustServerCertificate` 入口——而 `tlsMinVersion` 恰好对「证书类」错误无效。用户连自签证书实例时唯一能动的开关是错的那个，于是陷入「换个 TLS 版本再试、还是同一个错」的死循环。现补齐三项控件：`encrypt`（`默认`/`强制加密`/`不主动加密`/`严格加密 TDS 8.0`）、`trustServerCertificate` 复选框、`serverName` 与 `caCert` 输入框，并在表单内直接给出「证书类 vs 协议版本类」的分流提示。
- **`tdsVersion` 从表单移除**：TDS 版本在协议层本就自动降级（[MS-TDS](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/773a62b6-ee89-4c02-9e5e-344882630aac) 规定客户端声明高于服务器时服务器**必须**使用自身最高版本；微软官方 Go 驱动同样硬编码声明 7.4 且宣称支持 2005+）。把它摆在表单里等于把驱动已处理好的问题转嫁给用户。该参数仍保留为排障覆盖项。
- **编辑回填补全**：`ConnectionMeta` / `toMeta()` 增加 `encrypt` / `trustServerCertificate` / `serverName` / `caCert` 回填。此前这些字段即使存进 `connections.json` 也读不回来，编辑表单显示为空、保存即被静默清掉。`encrypt` 的三态（`true` / `false` / `'strict'`）按原语义透传，非法值不回填（fail-closed）。

### 安全

- **`tedious` 20.3.3 → 20.3.8（GHSA-wj7m-ffj3-574h，高危）**：旧版本在 `encrypt=true` 且服务器 PRELOGIN 回 `OFF`/`NOT_SUP` 或缺失 `ENCRYPTION` 选项时，**不报错、不告警，直接以明文发送 LOGIN7（含账号密码）**，而应用侧仍以为连接已加密。`trustServerCertificate=false` 对此无缓解作用——根本没有 TLS 握手，证书校验无从发生。已在源码层核实：旧逻辑只在 `ON`/`REQ` 时启动 TLS，其余分支静默落空；20.3.8 改为 `encrypt===true` 且非 `ON`/`REQ` 时抛 `EENCRYPT`。`mssql@12.7.4` 的依赖范围（`^19.2.2 || ^20.0.0`）本就允许该版本，故无需改 `mssql`；同时新增 `overrides.tedious` 钉住下限防止 lock 回退。注意 `npm audit` 当前**不报**此条，不能靠它兜底。
- **参数校验 fail-closed**：`encrypt` 只接受 `true`/`false`/`strict`，拼错（如 `stric`）直接抛中文错误，不静默回退到 `true`——加密强度是安全承诺。`caCert` 路径读不到时抛错而非忽略：静默忽略会退回系统信任库校验，把真正原因掩盖掉。

### 新增

- **`encrypt=strict`（TDS 8.0）**：支持 SQL Server 2022+ 的 Force Strict Encryption。此前该场景**必然连不上**且报错会被归到证书族，误导排查。需注意 strict 路径下驱动不传 `rejectUnauthorized`，**`trustServerCertificate` 完全失效**，证书强制校验——报错文案已明确这一点。
- **`serverName`**：证书签发给域名而实际用 IP / 转发地址连接时指定校验名，把该场景从「关掉证书校验」里分流出来。
- **`caCert`**：传 PEM 文件路径或证书文本，走官方推荐解法（保住加密与校验，只扩大信任根）。
- **系统信任库默认注入**：Node 默认只信任编译期内置的 bundle，**不读操作系统信任库**——这意味着「按官方推荐把自签证书导入 Windows 受信任根」这个最常见的正确做法，在不注入的情况下对连接毫无帮助（用户会以为"导入了却没用"）。现无论是否填 `caCert`，都把 `tls.getCACertificates('default')` 与 `('system')` 合并后注入校验（实测：内置 118 张、系统库去重后 36 张、两者重叠 17 张，合并去重后 137 张；系统库独有 19 张已确认包含）。三条降级边界：① 无该 API 的老环境（Node < 22.15）不注入，保持原生默认，公网证书照常可用；② 有 API 但系统库为空时只注入 bundle，绝不把 `ca` 设成空数组（那会让校验彻底失败）；③ 取证书异常全部吞掉，绝不用"取系统证书失败"打断建连。显式给了 `caCert` 时不覆盖用户选择。已在 DSH 实际运行环境（Electron 44.7 / Node 24.21）验证。
- **8 个服务器错误号的针对性分诊**：`17819`（只接受 strict → 改 `encrypt=strict`）、`17898`/`17802`（TDS 版本被拒 → 升级客户端库，**不**建议下调 `tdsVersion`）、`17835`（服务器强制加密 → 开 `encrypt`）、`17836`/`17828`/`17832`（包结构错配 → 查代理/中间层/端口，**不**归为版本问题）、`47072`（Azure 最低 TLS 门槛）。这些错误的服务器原文常含 `certificate`/`encryption` 字样，会被 TLS 族正则误命中并叠加「装 CA / 关校验」这类**无效**建议，故在命中已知错误号时抑制 TLS 族建议，保证每次只给出一个正确出口。
- **`EENCRYPT` 区分两种相反成因**：一是 `encrypt=false` 而服务器强制加密（药方是开），二是 `encrypt=true` 而服务器未协商加密（药方是关或修服务端），此前合并为一句必然把用户引反方向。

### 文档

- README / README_EN：覆盖范围改为 2005 → 2025；补充版本 → TLS 1.2 → 所需补丁对照；写明官方推荐顺序（装 CA 优先于关校验）；写明 `encrypt=false` 的真实行为——服务器未强制加密时**会跳过 TLS 握手并明文发送 LOGIN7**（已抓包实测），澄清「登录包始终加密」只适用于服务器强制加密或 `encrypt=true` 的场景；删除「不支持 TDS 8.0 / strict」的虚标；修正「连 2008 需显式 `tdsVersion=7_3_A`」这一无官方依据的经验说法。

### 行为变更（升级须知）

- **`encrypt=true` 连不支持加密的服务器现在会显式失败**（`EENCRYPT`），而不是静默明文传输。这是上述安全修复的本意：这类实例请显式设 `encrypt=false`。
- 若某实例确实只支持旧 TLS（如 2005 / 未打补丁的 2008），仍会失败——但报错现在指向「服务端补丁缺失」与「客户端下探 TLS 下限」两条正确路径。
- **`poolConfig` 现在总会写入 `cryptoCredentialsDetails.ca`**（内置 bundle + 系统信任库合并），不再「未配置 TLS 选项就保持 options 形状」。这是为了让「按官方推荐把自签证书导入系统受信任根」真正生效（Node 默认不读系统信任库）。老环境（无 `tls.getCACertificates`）仍不注入、保持原生默认，公网证书不受影响。

## 1.9.1

依赖安全与维护性升级（无代码改动，仅 `package-lock.json`）。

### 安全

- **`fast-uri` 3.1.8 → 3.1.9**：修复 4 个 URI 解析/规范化漏洞——URI scheme 伪造（百分号编码 scheme 不再被解码为活跃 scheme，CVE-2026-110306）、域名规范化时的 host 混淆（CVE-2026-110180）、相对引用规范化语义错误（CVE-2026-110095）、后缀引用中的 scheme 注入（CVE-2026-110725）。该包经 `ajv` ← `@stryker-mutator/core` 引入，仅用于变异测试，不在运行时代码路径中；项目自身的连接串解析使用原生 `new URL()`，不经过 fast-uri。实测确认修复生效：`%68ttp%3A%2F%2F...` 不再被解析出 scheme。

### 杂项

- **`vitest` 4.1.11 → 4.1.12**：mocker 加固手动与重定向 mock。
- **`vite` 8.3.1 → 8.3.5**：修复 build 阶段的 chunk import map 与 preload 依赖处理。
- **`@azure/msal-node` 6.0.1 → 7.1.2 / `@azure/identity` 4.13.3 → 4.14.1**：主版本跳跃，新增依赖 `is-in-ssh`、`powershell-utils`（均由 sindresorhus 维护）。该链路经 `tedious` → `@azure/identity` 引入；本项目仅支持 SQL 认证、不支持 Azure AD 认证，故运行时不会走到，升级属跟随上游维护。

## 1.9.0

前端挂载点迁移到 DSH 官方右侧栏，摆脱第三方 `dsh-better-sidebar` 依赖。

### 变更

- **改用 DSH 官方右侧栏**：前端挂载点从第三方 `dsh-better-sidebar` 换成 DSH 官方右侧栏 `@deepseek-ai/dsh-client-ui-sidebar-right`，不再调用 `ctx.betterSidebar.registerTab(...)`，改走两段式公开注册路径——
  1. `ctx.sidebarRightTabs.register({ id, kind, title, guide })` 声明页签类型 `dsh-db-tool`（`guide` 条目 order 45，右侧栏空态页显示「数据库」入口卡片）；
  2. `ctx.slots.inject("sidebar.right.pane.tab", …)` 按类型 `id` 注册面板正文；
  3. `ctx.slots.inject("sidebar.right.pane.tab.title", …)` 注册页签胶囊标题。
  正文的会话 `cwd` 改经宿主标准 props `useSessions(s => s.byId[sessionId]?.cwd)` 读取，`visible` 取自 `useTabInfo().tab.visible`（已同时表达「页签激活」与「右侧栏展开 / 非后台会话」，折叠时照旧停轮询）。
- **获得官方页签能力**：与官方页签同处一个页签系统，可并排、上下拆分、拖出为浮动面板、全屏，布局按会话持久化；这些都由宿主提供，无需本插件维护。
- **面板数修正为五个**：入口与文档此前按四个面板描述，补上「数据传输」后与实现一致。

### 修复

- **补 `keepMounted: true` 声明**：官方右侧栏默认按需卸载未激活页签的正文，而本插件面板状态（连接列表、项目路径、控制台多标签与结果、传输日志）全部存在 React 本地 state 中，不声明就会在切标签 / 切会话 / 收起右栏时全部归零。第三方 `dsh-better-sidebar` 是硬编码 `keepMounted: true` 全量保活的，迁移后该行为不再由宿主默认提供，必须在页签类型声明里显式补上。
- **删除绑定语言的 React `key`**：原先 `key` 随语言变化，切语言会重建整棵面板组件树，导致未提交的输入丢失。官方右侧栏的做法是文案走 thunk 在渲染时重新取词，不需要靠重挂载来换文案；`key` 因此只保留会话维度。
- **修 `t()` 读取链**：原先语言快照只在 `apply` 时读一次并闭包捕获，切语言后 `t()` 仍返回旧快照，文案实际不更新（页面看着语言变了、插件面板没变）。改为每次取词现读 locale 快照，语言切换即时生效。
- **显式声明 `priority: "extension"`**：本插件是页类型、不带 `patterns`，不参与宿主资源路由排序；声明只为让注册意图更可读，不改变行为。
- **右侧栏服务缺失时打印 warn**：原先服务取不到时静默 `return`，挂载失败无任何痕迹、排查只能靠猜；改为打印 `warn` 指明缺失的服务名。

### 清理

- 移除 `devDependencies` 与 `peerDependencies` 中的 `dsh-better-sidebar`，`package-lock.json` 一并移除该包及其独占的传递依赖（重新生成，未升级任何已有依赖）。
- 删除 Panel 中 `scope.repoRoot` / `scope.workspacePath` 的死兜底——`scope` 实际只有 `{ sessionId, cwd }` 两个字段，这些兜底分支永远不会命中。
- 清理全部沿用旧名词（side-bar / betterSidebar）的注释。
- `files` 白名单收录 `docs/sidebar-right-migration.md`（精确路径而非 `docs` 目录：npm 打包不看 `.gitignore`，目录级条目会把本地被忽略的草稿一并发布）。

### 兼容性

- `engines.dsh` 下限抬到 `0.1.7-rc.2`：`keepMounted` 字段自官方右侧栏 `0.1.7-rc.1` 起才存在，更早版本（含 `0.1.0-rc.6`、`0.1.5`/`0.1.6` 系）会静默忽略它，表现为切页签/切会话后面板状态归零且无报错，故不再宣称兼容。
- `apply` 增加能力探测：注册后读回该页签类型，若宿主未接受 `keepMounted` 则打印 warn 提示升级 DSH——收紧 `engines` 挡不住「旧 profile 已装好继续用」的情形。
- issue 模板的入口名与版本占位符同步为「右侧栏」与 `1.9.0`。

## 1.8.9

发布配置修正：`files` 白名单清理。

### 修复

- **`files` 白名单移除失效的 `docs` 条目**：该目录已不存在（原为预留目录，本次仓库整理时删除），白名单里的残留条目指向空路径，属无效配置。
- **`LICENSE` 显式加入 `files` 白名单**：此前能进入发布包，依赖的是 npm 强制收录 `LICENSE*` / `README*` / `package.json` 的默认行为，而非本仓库的声明。虽然结果正确，但把协议正文的收录建立在工具默认规则上不够稳妥（换用 `pnpm pack` 等工具时行为可能不同）；现显式声明，使发布内容完全由白名单决定。
- **`CHANGELOG.md` 一并加入白名单**：顺带发现版本变更记录此前从未进入发布包（同样只因不在白名单而被排除），安装包内看不到改动历史。现补齐，包内元数据文件为 LICENSE / README.md / README_EN.md / CHANGELOG.md 四份。

## 1.8.8

数据浏览「跨库表名模糊搜索」+ SQL Server TLS 协议版本误诊修复与 `?tlsMinVersion=` 客户端下探；许可证切换为 Apache-2.0。

### 新增

- **跨库表名模糊搜索**：每个连接展开后内嵌筛选行——库下拉（全部库/单库）+ 关键词输入框（回车或点「搜索」执行）。命中结果以平铺列表替代目录树展示（`库名.表名 · 注释`），点击直接打开该表的结构+数据预览，「×」返回目录树。
- **适配器原生搜索优先**：`DatabaseAdapter` 新增可选 `searchTables(keyword, database?, limit?)`（返回 `TableSearchHit[]`：`{database, schema?, name, type?, comment?}`）。
  - mysql：一条 `information_schema.TABLES` LIKE 查询跨库完成（转义符用 `|`，避开反斜杠在 SQL 字面量与 `NO_BACKSLASH_ESCAPES` 模式下的歧义；`% _ | \` 全转义，参数绑定无注入面；默认排除四系统库，给定库时精确限定）。
  - postgresql / gaussdb：按库池化逐库查 `information_schema.tables`（`ILIKE` 大小写不敏感，转义符 `~`；`database` 参数兼容三种形态——库名（UI 下拉传值，该库全部用户 schema）/ `库名.schema`（精确单 schema）/ schema（当前库）），命中带 `schema` 字段，前端点击按库+schema 精确打开；排除 `information_schema` 与 `pg_*` 系。
- **无原生实现的回退路径（按 kind 白名单）**：仅 `mysql/mongodb/sqlite`（`listTables(database)` 语义为库名）参与回退——给定库 `listTables` + 内存过滤；未给定逐库并发（批 8）拉取过滤，单库失败不拖垮整体。redis（listTables 忽略库名，逐库循环会重复返回同一批键）与 oracle/dmdb（database 语义为 owner，跨库回退会错标来源）不参与，直接返回空。过滤大小写不敏感，表名与注释均参与匹配。
- **上限与审计**：limit 钳 1..200（默认 100）；服务端审计落 `search_tables`（statement 记关键词与库，rowsAffected 记命中数）。
- HTTP 路由 `GET /api/search-tables`（project/connId/keyword 必填，database/limit 可选）。
- 测试：manager 原生/回退两路径 + cap 钳制 + 审计断言 + 非白名单 kind 不回退；HTTP 路由契约（回退过滤/限定库/参数校验/未授权）；mysql 真机（跨库命中、限定库、LIKE 转义——字面 `%` 不作通配符）；pg-like mock 驱动（库名限定/`db.schema` 精确/跨库逐池/ILIKE 转义）。
### 修复

- 前端搜索失败反馈：错误行渲染与结果视图解耦（首次搜索失败也显示错误行并可点击重试，不再静默回到目录树）；筛选行补 React key（避免列表 key 警告与输入框重挂载丢焦点）。
- **select 下拉弹出层白底白字**（第三方深色主题下）：option 弹层是原生控件，不继承面板背景——Windows Chromium 未声明 `color-scheme` 时固定白底，而 option 文字 `color:inherit` 在深色主题下是白字。现在 select 声明 `color-scheme:dark light`，option 显式配一套自带对比度的深/浅配色对（不透明——弹层是独立原生窗口，半透明会混入白底），随系统深浅切换，与外层主题解耦。
- **TLS 失败按根因分两族，解法不再混用**：`mssqlReason()` 原先把证书类与协议类错误塞进同一条 `tlsish` 正则，统一提示「追加 `?trustServerCertificate=true`」。但 `UNSUPPORTED_PROTOCOL`（`SSL_R_UNSUPPORTED_PROTOCOL`）表示客户端与服务端**没有共同的 TLS 协议版本**，发生在版本协商阶段，证书校验根本没执行——该参数对它完全无效，用户照做只会白跑一轮。现拆为 `tlsCertish`（自签/链不可验证/`CERT_`）与 `tlsProtoish`（`UNSUPPORTED_PROTOCOL` / `no protocols available` / `alert protocol version`）：协议族文案改为「TCP 已连通但 TLS 协议版本协商失败」并给出修复优先级（① 服务端启用 TLS 1.2，2008 R2 SP3 装 KB4057113、2008 SP4 装 KB4057114；② 客户端 `?tlsMinVersion=TLSv1` 下探；③ 明说跳过证书校验无效）；证书族保留原有 `trustServerCertificate=true` / `encrypt=false` / 2008 提示。两族互斥，证书族不再推销协议版本建议。`wrong version number`（对端根本不是 TLS，多为连错端口）刻意不进协议族——它既非证书问题也非版本协商问题，归通用 TLS 兜底只纠正「TCP 已连通」，不给具体药方。
- **新增 `tlsMinVersion` 连接参数**：URL query 与分字段表单均支持，取值 `TLSv1` / `TLSv1.1` / `TLSv1.2`（区分大小写），落地为 `options.cryptoCredentialsDetails = { minVersion }`，缺省不注入（沿用 Node 默认下限 TLSv1.2）。只设 `minVersion`、**不设 `maxVersion` 也不设 `ciphers`**：tedious 在未指定上限时会自己把 `maxVersion` 补成 `TLSv1.2`（上限天然封顶，显式写反而削弱安全性），而 Electron 内置的是 BoringSSL，OpenSSL 专有 cipher 串（如 `DEFAULT@SECLEVEL=0`）会直接抛 `INVALID_COMMAND`。白名单刻意不含 `TLSv1.3`——受上述 `maxVersion` 补全影响，`minVersion=TLSv1.3` 会变成 min>max 并 100% 抛 `ERR_SSL_NO_PROTOCOLS_AVAILABLE`（实测 `NO_SUPPORTED_VERSIONS_ENABLED`），错误文案直接把这条原因写给用户，避免反复试。非法值 fail-closed 抛中文错误，不静默回退。
- **分字段表单补齐 TLS 相关键**：`fields` 分支此前完全读不到 `encrypt` / `trustServerCertificate` / `tdsVersion` / `tlsMinVersion`，用户在表单里关掉加密、信任证书或下探 TLS 下限都不生效（连接仍按默认值走）。现与 URL 分支同口径补齐，默认值不变（`encrypt=true` / `trustServerCertificate=false` / `tdsVersion=7_4` / `useUTC=true`）。
- **文档纠偏**：README 中「最低 TLS 版本经 `cryptoCredentialsDetails.minVersion` 配置」是虚标（原实现根本没有该通路），改为说明新增的 `?tlsMinVersion=` 参数，并把「连 2008 就加 `?trustServerCertificate=true`」拆成证书类/协议类两种根因分别给解法。

### 杂项

- **许可证 MIT → Apache-2.0**：此前 package.json 与 README 都声明 MIT 但仓库没有 LICENSE 文件（只有声明、没有正文）。现补齐 Apache License 2.0 完整正文（与 apache.org 官方文本逐字比对一致），package.json 的 `license` 与 `author` 同步更新。
- **新增 CI 与贡献者分支保护**：GitHub Actions 在 Node 22/24 跑 `npm ci → build → typecheck → test`；ruleset 覆盖 master 与 `contributor/*`，强制 CI 通过。
- **README 重写为纯功能文档**：删除错误的「本仓库为 fork」声明（本仓库即上游），新增功能流程图、Issue 模板（Bug 报告 / 功能请求）。

## 1.8.7

修复 ro（只读）授权下一切数据库操作永久挂起——「设置数据源后表显示不出来」的直接根因（与 1.7.3 的授权键归一化为两个独立缺陷）。

### 修复

- **mysql ro 模式连接永久卡死**：ro 适配器在 `pool.on('connection')` 钩子里执行 `SET SESSION TRANSACTION READ ONLY` 时，经 `swallowSetError` 给返回的 Query 命令对象挂了 `.on('error')` 监听——该监听会打断 mysql2 池接管前的命令处理序列，连接状态机卡死，**该连接后续一切查询永挂**。由于 ro 适配器实例被服务层 `adapterCache` 缓存，ro 授权下列库/列表/表结构/预览全部永久 pending（侧边栏数据浏览树展开后只显示 …），DatabaseManager 工具同样挂起。
- **完整故障矩阵（真机四象限复现，mysql2 3.24.4 + MariaDB 10.6）**：非回调式 query（原形态）挂；回调式 query + error 监听（首次修复方向）**同样挂**；唯「回调式 query + 空回调、不挂监听」正常。`swallowSetError` 已删除，`openMysqlRaw` 的机制注释一并更正。
- 测试连接（`testConnection`/`testDraft`）不走 ro 钩子（`factory(rc)` 无 mode），故显示「连接成功」而数据浏览挂起——正是本缺陷的迷惑性所在。
- 回归测试：真机门控新增 ro 模式 `listDatabases` 不得挂起 + ro query 白名单两用例（挂死形态会在 vitest 5s 超时失败）。

## 1.8.6

修复「设置数据源后表显示不出来」组合缺陷：Windows 路径大小写授权错位（根因）+ projectPath 为空时数据浏览静默失败 + 未授权文案缺少下一步引导。

### 修复

- **Windows 路径大小写授权错位（「表显示不出来」根因）**：`normalizeProjectKey` 此前仅把盘符小写、路径段保留原大小写——NTFS 大小写不敏感，`E:\GitHub\MyApp` 与 `e:\github\myapp` 是同一目录却被记成两条授权键。会话 cwd 大小写与授权时不一致（重启/不同入口的常见现象）即 `UNAUTHORIZED_PROJECT`，数据浏览树展开后无库无表。现在 win32 下全路径归一小写（POSIX 文件系统大小写敏感，保持原样；platform 参数仅供测试注入）。
- **grants.json 存量键迁移**：读入时把「绝对路径形态」的大小写变体键统一归一并合并（同连接 rw 胜出、grantedAt 取较新，与 check 语义一致），下次 save 自然落盘为新键；非路径形态的键原样保留。修复后老授权不失效。
- **GrantStore 纵深防御**：`grant/revoke/check/grantsFor` 入口统一 `normalizeProjectKey`（幂等）。此前归一化责任全在调用方（manager 层），任何绕过 manager 的调用都会以原始写法落盘/查询。
- **数据浏览静默失败**：projectPath 为空时（scope.cwd 缺失且自动解析失败）`toggleConn/toggleDb/toggleSchema` 全部静默 no-op，点击展开零反馈。现在树顶显示醒目提示（zh/en，role=alert）指引用户填写项目路径。
- **scope 兜底字段修正**：`SessionScope` 契约为 `{ sessionId, cwd?, repoRoot? }`，客户端读取的 `workspacePath` 字段不存在。cwd 是工作区容器时补 `repoRoot`（选中的 git 仓库）兜底。
- **未授权错误文案引导**：`项目未授权该连接: x` → 追加「请切到『项目授权』面板……」；projectPath 为空文案追加「请先在面板顶部填写当前项目路径」。
- 回归测试：路径段大小写变体授权放行（e2e）、grants 大小写变体键迁移合并（store）、win32 归一矩阵（normalize）。

## 1.8.5

DSH 0.2.1-rc.3 适配确认（宿主契约逐项对照，客户端与打包零改动）+ 非 loopback 部署信任来源修复 + hotfix 支持 0.2.1-rc.3。

### 适配

- **DSH 0.2.1-rc.3 契约逐项对照（零客户端改动）**：`tools.register`（`output.schema`/`render`、`timeoutMs`）、`webServer.register({kind:'prefix'})`、`connection.requestRejection`（401|403|undefined）、`sessions.header.cwd`、`ctx.effect`、客户端 `dsh.client`（platform/inject）、`ctx.locale.register(ns,lang,dict)`/`subscribe`/`getSnapshot`、`betterSidebar.registerTab`、`window.__ModuleLoader__.load` 注册协议——rc.2→rc.3 均无实质变更（上游逐字节 diff + 本机 rc.3 `app.asar` 提取件交叉验证）。`client/client.js`、`cordis.patch.yml`、构建脚本无需改动；运行态实测工具端到端可用、client combo 产物按 rc.3 契约可执行。rc.3 新增的「更多菜单/入口定制」只作用于官方 `sidebar.panellist` slot，与本插件经 better-sidebar 注册的 tab 无冲突。
- **`engines.dsh` 补充 `>=0.2.1-rc.2 <0.3.0-0`**：严格 semver 下 prerelease 需显式元组，原范围对 `0.2.1-rc.x` 判为不匹配（宿主准入门用 `includePrerelease` 放行，npm 侧声明此前不准确）。
- **hotfix 支持 0.2.1-rc.3**：rc.3 的 `dsh-app-boot` 仍有两处未防护的 `createRequire(parent).resolve.paths(name)`（`nativePackageDir` / `routeScoped`），新增 `patches/dsh-app-boot-route-scoped-hotfix-0.2.1-rc.3.patch` 并加入 `TARGET_VERSIONS`/`PATCH_BY_VERSION`；`git apply` 与内建替换双路径逐字节一致，未加 `--force` 即可应用，幂等与 `--revert` 均实测通过。

### 修复

- **非 loopback 部署被插件兜底 403**：宿主 `@deepseek-ai/dsh-web-app` 自 0.2.x 起只 `provide` `webApp`/`webStartup`，从不注册 `webRuntime`（rc.2、rc.3 内均 0 命中）；旧实现读 `ctx.get('webRuntime', true)` 恒得 `undefined` → `trustedHosts` 恒空，`--trusted-host`/内网反向代理部署在宿主 Connection 放行后仍被插件自带 trust 校验判 403。现 `webStartup.trustedHosts` 优先、`webRuntime` 回退（兼容旧宿主），并在 `webStartup` 存在时补监听 bind 地址（仅接受具体单播 IP 字面量；`0.0.0.0`/`::`/`*`/loopback 一律跳过，不放宽 DNS rebinding 攻击面）。loopback 行为与既有部署不变。

### 验证

- `npx tsc --noEmit` 0 错误；`npx vitest run` 1043 通过 / 0 失败 / 33 跳过（新增 `tests/plugin/rc3-trust.spec.ts` 14 条 + hotfix rc.3 相关 10 条）；`npm run build` 成功，产物齐全。
- 运行态（本机 DSH 0.2.1-rc.3）：`DatabaseManager` 工具注册并端到端调用成功；`/dsh-db-tool/api` 前缀路由已挂载（无凭证 401、未知路径 404）；client combo 产物 200 且按 rc.3 契约执行通过。

> 1.8.3 的「`webRuntime.trustedHosts` 兼容已确认」结论作废：该服务在 0.2.x 内核中并不存在，应读 `webStartup.trustedHosts`。

## 1.8.4

修复插件在 DSH 0.2.1 宿主上永不激活、面板报「错误: HTTP 404」（`inject` 声明了宿主不存在的 `webRuntime`）。

### 修复

- **插件不激活导致 HTTP 404**：宿主 `@deepseek-ai/dsh-web-app` 提供的是 `webApp`，从不注册 `webRuntime`；而 cordis 的 `inject` 是硬依赖——任一服务取不到，fiber 永久 pending，`apply()` 不执行，`/dsh-db-tool/api` 前缀路由也就不会注册，前端同源 `fetch` 落到宿主兜底 404，启动期只有一条 warning、不报错。现从 `inject` 移除 `webRuntime`，`trustedHosts` 改为 `ctx.get('webRuntime', true)` 可选读取（对齐 dsh-ssh-tunnel 的既有写法），缺失时退化为空信任列表，loopback + Origin 同源校验照旧生效。1.8.3 中「`webRuntime.trustedHosts` 兼容已确认」的结论作废。
- **回归防护**：新增 `tests/plugin/apply.spec.ts`，锁住「`inject` 不含 `webRuntime`」与「无 `webRuntime` 时仍注册 `/dsh-db-tool/api` prefix 路由、handler 按 loopback 放行」。

## 1.8.3

DSH 0.2.1-rc.2 适配确认（宿主 API 契约逐项对照，零代码变更）+ 传输日志两处修复。

### 适配

- **DSH 0.2.1-rc.2 适配确认**：对照最新宿主源码逐项验证插件契约——`dsh.client`（platform/inject）、prefix 路由（`WebRouteKind`）、`connection.requestRejection`（401|403|undefined）、`tools.register`（output.schema/render/timeoutMs、`exec.agent.session`）、`window.__ModuleLoader__.load` 注册协议、`sessions.header.cwd`/`webRuntime.trustedHosts`——全部兼容；0.2.1 系列相对 0.2.0-rc.2 零代码变更，`engines.dsh` 范围已覆盖，无需代码改动。
- **依赖升级**：`dsh-better-sidebar` ^0.24.1 → ^0.28.0（0.25–0.28 为可选增量字段，本项目所用 `registerTab`/`TabDescriptor` 基础面无破坏性变更；peer 整套对齐 DSH 0.2.1-rc.1）；`@deepseek-ai/cordis` ^4.0.4 → ^4.0.5。

### 修复

- **传输历史「清除」按项目生效**：前端确认文案承诺「清除当前项目的全部传输历史」，实际 `transfer-history/clear` 无参全清——多项目共用一个 DSH 实例时，一个项目清历史会误删其他项目的记录。现 `TransferLog.clear(projectKey?)` 按项目过滤（`transferLogTail` 同款归一化），HTTP 路由读 body 的 `projectPath`，前端历史区带项目路径调用；日志区「清除全部传输日志」语义不变（无参全清）。审计语句区分按项目/全量。
- **传输日志重复 running 事件**：`lib/transfer.ts` 单表开始事件 emit 两次（编辑事故残留），日志与传输日志标签页每表出现两条「开始」；删除重复行，补「每任务单表至多一条 running 事件」回归断言。

## 1.8.2

SQL Server TLS 握手失败的错误分类修复（真实案例驱动：老实例仅 TLS 1.0 对客户端最低 TLS 1.2 的握手失败被误报为网络不可达）。

### 修复

- **TLS 协议版本不符不再误报「网络不可达」**：底层 BoringSSL/OpenSSL 握手错误（`UNSUPPORTED_PROTOCOL`、`SSL routines`、`OPENSSL_internal`、handshake alert、`no protocols available` 等）此前不被 TLS 特征正则命中，落进「网络不可达：请检查主机名、端口与网络」兜底，把用户引向错误排查方向；现补全特征族，正确报「TCP 已连通但 TLS 握手/证书校验失败」并附 `?encrypt=false` / `?trustServerCertificate=true` 指引。tedious 把 TCP 失败与 TLS 失败包成同一 ESOCKET/同一消息模板，按底层错误串区分是官方结构下的正确做法。
- **特征文本与「原始错误」追溯纳入 ES cause**：tedious 建连期把底层错误挂在 `err.cause`（`originalError` 是事务 abort 专用，建连场景恒 undefined），此前特征匹配读不到、追溯 trail 恒不生效；现纳入 cause，message 未含其全文时补出干净的底层错误。
- **「网络不可达」兜底文案补提示**：端口确认可达仍反复出现时，可能是服务器在 TLS 握手阶段主动断开（如老实例仅支持 TLS 1.0）——覆盖 `socket hang up` 这类无法按关键词识别的形态。

## 1.8.1

SQL Server 连接官方文档对照修复 + 全库端口 fail-open 治理。

### 修复

- **SQL Server 端口三层修复**：分字段表单移除 1433 端口预填（官方 port 可选、默认 1433，且与命名实例互斥）；host 输入对 sqlserver 提示命名实例官方形态 `主机\实例名`；URL 切分字段时从 safeUrl 反解真实 host/port/user/database（`urlToFieldsPatch`，原先一律补默认值导致真实端口静默丢失）。
- **端口校验 fail-closed（sqlserver）**：非法端口（越界/非数字）此前被 `validPort` 静默回退 1433，现抛中文错误含原值；前端端口改原样发字符串（此前 `Number(NaN)→JSON null` 会把非法值伪装成"未提供"架空校验）。
- **update 写 URL 时对称清理残留 fields**（lib/store/connections.ts）：此前 fields→URL 方向保存不清旧 fields，叠加 sqlserver 等适配器的 `fields.database` 覆盖 URL 库名口径，出现"safeUrl 显示新库、实际连旧库"的静默错库。
- **全库端口 fail-open 治理**：mysql / pg / gaussdb / redis / mongodb / oracle / dmdb 的端口处理均存在非法值静默回退默认端口（redis/mongodb/oracle/dmdb 的 `typeof port === 'number'` 门连合法字符串端口也吞掉——分字段模式下用户所填端口实际永不生效；mysql 的 NaN 被 mysql2 `|| 3306` 静默改写实连；pg 的 NaN/空串被驱动 truthy 检查回退 5432，gaussdb 兜底 8000 落不到）。统一修复为「未提供→官方默认；提供但非法→中文报错含原值」，各库补离线用例。sqlite 文件型无端口概念，实证无需修复。
- **文案与可观测性（sqlserver）**：EINSTLOOKUP 提示的「主机：端口」（冒号非法）改为官方逗号形态 `host,1433`；URL 解析失败补「命名实例请改用 `?instanceName=`」出口；instanceName 与 port 共存行为注释修正（实为 mssql 层删 port）；连接池错误从静默吞掉改为 `console.error` 留痕。

## 1.8.0

新增 SQL Server 数据库支持（适配器 + 传输 + 侧边栏方言接入）。

### 新增

- **SQL Server 适配器**：覆盖 SQL Server 2008/2008R2 → 2022 与 Azure SQL Database；对外占位符统一 `?`（适配器内部按顺序重写为 `@p1..@pN`），标识符 `[x]`（名中 `]` 双写为 `]]`），分页按 `SERVERPROPERTY('ProductMajorVersion')` 分流（2012+ 用 `OFFSET/FETCH`，2008/2008R2 降级 `ROW_NUMBER`），库/表/列元数据只走 `sys.*` catalog views 且仅用 2005+ 通用写法。
- **连接与认证**：连接串形态 `sqlserver://user:password@host:port/db`，支持 query 参数 `encrypt` / `trustServerCertificate` / `tdsVersion`（默认 `7_4`，可配 `7_3_A`/`7_3_B`/`7_2`/`7_1`）/ `instanceName` / `useUTC`；仅 SQL 认证。
- **数据传输**：参数化多行 `VALUES` INSERT（TDS 单语句 2100 参数上限、`VALUES` 单语句 1000 行上限，每语句行数取两者最小值）、`MERGE` 处理 replace/ignore、建表 DDL 在显式事务中可回滚；传输分页按目标库版本分流（2012+ `OFFSET/FETCH`，2008/2008R2 降级 `SELECT TOP (n)` / `ROW_NUMBER()` 子查询），**2008/2008R2 同样可传**。
- **危险语句分类**：新增 T-SQL 专属危险首词 `BACKUP` / `RESTORE` / `DBCC` / `RECONFIGURE` / `BULK INSERT` / `SHUTDOWN` / `xp_cmdshell` 与其他 `xp_*` / `sp_configure`；另新增 `SELECT ... INTO <表|#临时表>` 判危险（T-SQL 建表副作用；表变量/变量赋值 `SELECT 1 INTO @t` 放行，`INSERT INTO ...` 仍按 DML 口径）。
- **SQL 控制台**：sqlserver 方言接入 CodeMirror（`@codemirror/lang-sql` 的 MSSQL 方言）与 sql-formatter（`transactsql`），表列元数据补全同样生效（上限 50 表）。
- **驱动形态**：`mssql@12` 只在 devDependencies，运行时加载 `npm run build:sqlserver` 生成的 `vendor/sqlserver-driver.cjs`（mssql → tedious → bl → readable-stream 会把 buffer/events/process/string_decoder 带进生产依赖树，触发宿主 `dsh-app-boot` 的 `require.resolve.paths` bug）。

### 安全加固

- **ro 只读闸门加固为五道**：首词白名单 + 拒绝多语句（词法级：顶层分号后出现任何内容即拒）+ 拒绝 `SELECT ... INTO`（token 级，字符串/方括号标识符/注释内的 into 不误伤）+ 拒绝 `WITH ... (INSERT|UPDATE|DELETE|MERGE)` + 拒绝 `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE`（其字符串参数在远端/外部数据源执行任意语句、不可审计，连合法只读远端查询也一律拒）。
- **错误消息脱敏**：连接 URL 解析失败时错误文案里的 userinfo 先脱敏，不再回显明文密码（错误会进 `audit.jsonl` 与模型上下文）。
- **分页上界修复**：`preview` 的 `OFFSET/FETCH` 绑定值修正为上界 `offset + limit`（此前误传 `limit`，`offset > 0` 时第 2 页起恒为空）。

### 修复

- **mysql 跨库路由**：适配器此前在 `query` / `execute` 中丢弃 `database` 参数，控制台选库后 SQL 仍跑在连接默认库（`USE` 在池上因连接随机复用结果不确定）；现按库名建池缓存路由（与 pg/gaussdb/sqlserver 同构），`close` 级联关闭全部跨库池，事务仍粘主池（服务层已拒绝事务携带 database）。
- **列库失败静默**：SQL 控制台的跨库下拉在 `listDatabases` 失败时整体消失且无提示（呈现为"无法选择数据库"）；现改为可见错误 + 重试，加载中/失败不再静默。

### 边界（如实记录）

- **仅 SQL 认证**：不支持 Windows 集成认证，也不支持 Azure AD 认证；不接受 ADO.NET 键值连接串（`Server=...;Database=...`）。
- **ro 只读强度弱于 MySQL/PG**：SQL Server 无等价的会话级只读语句，ro 下适配器 query 闸门五道（首词白名单 + 拒绝多语句 + 拒绝 `SELECT ... INTO` + 拒绝 `WITH` 写体 + 拒绝 `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE`），另加服务层拦 `execute`；guard 层对 `SELECT ... INTO` 与 `WITH` 写体还会要求确认——不等同于数据库侧的只读会话。
- **类型搬运取舍**：`hierarchyid` / `geometry` / `geography` 按二进制搬运，目标端建 `VARBINARY(MAX)`，**UDT 类型语义不保留**；`sql_variant` 转文本（`CONVERT(nvarchar(max), col)`），**原类型信息丢失**；源 `varchar`/`char` 长度 4001–8000 映射为目标 `NVARCHAR(MAX)` 类（保容量、不收窄）；`datetime2` 读端 `CONVERT(nvarchar(33), col, 126)`、`time` 用 `CONVERT(nvarchar(16), col, 126)` 保真。
- **传输在 SQL Server 2008/2008R2 同样可用**：2012+ 走 `OFFSET/FETCH`，2008/2008R2 有序游标（keyset/range）走 `SELECT TOP (n) ... ORDER BY key`，无分片键的 offset 全序与 `keyAt` 切块走 `ROW_NUMBER() OVER (...)` 子查询，版本探测失败按 0 保守降级。
- **IDENTITY 写入限制**：目标表已存在且该列为 IDENTITY 时，写入显式值报 544（当前不自动 `SET IDENTITY_INSERT ON`）；传输自动建表不生成 IDENTITY 列。
- **decimal 精度分侧**：浏览侧（query/preview/数据浏览）不保证 decimal/numeric 逐位保真（驱动解析阶段已转 JS number，>15 有效位丢精度；转字符串只防后续数值化，>1e21 出现科学计数法）；传输读端用 `CONVERT(nvarchar(64), col)` 保真搬运。
- **2008/2008R2 连接通常需 `?trustServerCertificate=true`**：默认 `encrypt=true` + `trustServerCertificate=false`（同 mssql 官方默认），旧实例自签名证书 / 仅 TLS 1.0 会握手失败（Node 默认最低 TLSv1.2）；服务器未强制加密时也可 `?encrypt=false`，并建议显式 `?tdsVersion=7_3_A`（2008）/ `7_3_B`（2008R2）。
- **`GO n` 重复上限 1000**：SQL 控制台按 sqlcmd 语义把上一批重复执行 n 次（`GO` 行本身不产生语句），重复计数上限 1000，超出部分被截断，防止一次执行被放大成天量请求。
- **未经真机验证**：本版 SQL Server 只交付离线单测（Fake 驱动），真机冒烟开关为 `DBT_TEST_SQLSERVER_URL`（形如 `sqlserver://sa:pw@host:1433/db`）。
- **不支持 SQL Server 2005（9.x）及更早版本**；`tdsVersion=8_0`（TDS 8.0）与 `encrypt='strict'`（严格加密）也未支持——SQL Server 2022 用默认 `7_4` 即可正常连接（TDS 8.0 属后续增强），2005 及更早未验证。

## 1.6.0

新增连接管理「导出 / 导入」：一键导出全部连接（含密码）为口令加密文件，跨机器迁移；导入按口令解密，冲突连接跳过不覆盖。

### 新增

- **连接导出**：侧边栏「连接管理 → 导出」，输入口令后下载 `dsh-db-connections-YYYYMMDD.enc.json`。整个 payload（全部连接元数据 + 明文密码/完整 URL）经口令派生密钥整体加密，文件打开无明文。
- **连接导入**：选文件 + 输入同一口令即可恢复。已存在的连接 id 一律跳过（不覆盖），返回「已导入 n 条，跳过 m 条，失败 f 条」摘要；重复导入幂等。
- **加密方案**（Node stdlib `crypto`，零新增依赖）：scrypt 派生 AES-256 密钥 + AES-256-GCM。salt 随机 16 字节、IV 随机 12 字节、auth tag 默认 16 字节；scrypt 成本参数显式固定（N=16384, r=8, p=1），跨 Node 版本/运行时不会因默认值漂移而解密失败。
- **安全边界在服务端**：口令最短 8 位由 `DbToolService` 强制（UI 仅对齐提示）；口令错 / 密文篡改 / 结构非法统一报「口令错误或文件已损坏」，不泄露失败原因防探测。
- **冲突识别用哨兵类型**：新增 `DuplicateConnectionError`，`create()` 抛它、`importBundle` 用 `instanceof` 识别跳过，不再依赖中文错误文案匹配。

### 修复（OCR 审查 18 条处置）

- 清掉仓库根部的 `nul` Windows 保留名残留文件（会导致 Windows 用户 `git checkout` 失败）。
- 结构校验补 per-element：解密包元素必须是含非空 string `id`/`kind` 的对象，堵 `null` 元素 TypeError 与 `id:undefined` 幽灵落库。
- `importBundle` 机密写回改覆盖式（先 `secrets.delete(id)` 再写），防止旧 url 嫁接到 fields 模式连接被静默错连；写回失败 best-effort 回滚连接行，消除半导入态。
- 导入审计补「失败 N 个」；导出响应回传权威 `count`，前端不再用可能过期的本地列表计数。
- client：导入部分失败显示错误（不再渲染为全成功）；`revokeObjectURL` 延时 1s（对齐 MDN 防过早回收）；`pendingJson` 在弹窗关闭/完成后清除；`doExport/doImport` 去掉错误吞噬，消除「红错误 + 绿完成」矛盾反馈。

## 1.5.91

新增 Navicat 17 级 SQL 控制台：8 类数据库统一的多标签控制台，含 CodeMirror 6 编辑器、多语句分割执行、事务粘性会话与事务内查询、结果网格。

### 新增

- **SQL 控制台重构**：多标签（内存态）、CodeMirror 6 编辑器（esbuild 打包为 `vendor/codemirror-sql.cjs`，方言按连接类型映射 MySQL/PostgreSQL/SQLite/PLSQL，表列 schema 补全、SQL 格式化、Mod-Enter 全量执行 / Shift-Mod-Enter 选中执行、三途全败静默降级 textarea）。
- **多语句分割执行**：`splitSqlStatements` 方言感知切分（引号转义、`--`/`/* */` 注释、PG `$$` dollar-quoting、MySQL `DELIMITER`、Oracle/达梦 `BEGIN..END` 与存储块），逐条按读头预分类走 query/execute，每条自带 guard/challenge/审计。
- **事务粘性会话**：`POST /api/console/{begin,exec,commit,rollback}`——会话专用适配器 + 粘性连接（checkout 单一 client，对齐 oracledb/pg 官方单连接串行与事务随连接语义）、enqueue 串行化、空闲 TTL 5 分钟回收、TOCTOU 注册前复核、per-connId 会话上限、全链路审计；oracle/dmdb 事务通道按语句头分流，事务内 SELECT 返回结果集。
- **结果网格 ResultSetGrid**：客户端分页 50/页、表头三态排序（数值/字符串感知、稳定）、单元格点击复制、CSV/JSON 导出（Blob + a.download）。
- **执行历史**：每标签内存态历史面板（语句/耗时/成败），点击回填。

### 修复

- OCR 审查 17 条全部处置：事务 finish 并发竞态（enqueue 包裹 + 幂等结算）、`database` 入参显式拒绝（防静默写错库）、连接更新/删除即时清理事务会话、TOCTOU 授权复核、`@lezer/highlight` 幽灵依赖显式声明等；风格类两条按既有代码一致性反驳。

## 1.5.9

修复 PostgreSQL/GaussDB 跨 schema 单元格保存报「数据库不存在」。

### 修复

- **跨 schema 保存路由**：`buildUpdate` 给 execute 的 `database` 参数此前误传 `"库.schema"` 整串，后端会拿它当数据库名建连接池（PG 官方语义：三段名中的 database 必须等于当前连接的库，不能跨库引用）。现只传库名（`dbRef.split(".")[0]`），schema 由语句内 `"schema"."table"` 全限定——连接目标只能是库。依据：PostgreSQL 16《ddl-schemas》；经 context7 核验 MySQL（跨库语句官方支持，语句内 `db`.`tbl` 自足）、Oracle/DM（owner 全限定同形态）、SQLite（单库无路由）各族语义一致。

## 1.5.8

修复单元格详情底栏的叠压与透明问题。

### 修复

- **详情底栏不再叠压表格**：表格容器改为 flex 伸缩区（`flex:1;min-height:120px` 内滚），详情栏 `flex:none` 钉在下方——内容高度由两区在面板高度内分配，详情栏出现时不再溢出盖住表格与分页条。
- **详情栏背景实色化**：`--dbt-surface` 半透明 token 在 DSH 透明窗口上会透出底下文字，改为实色（dark `#2c2c2e` / light `#f5f5f7`），清晰遮挡。

## 1.5.7

数据浏览交互与布局按 Apple 设计语言重排：单元格查看编辑从「浮层 + 编辑中间态」收敛为底部详情栏直改直存。

### 交互

- **单元格底部详情栏直改直存**：单击单元格即在预览区下方展开详情栏——标题行含列名、NULL 徽标与只读原因，textarea 直接可编辑（NULL 时为空并勾选「设为 NULL」），栏内改值后点「保存」即写回（复用既有 buildXxx + runGuarded 执行链）；浮层与「编辑」中间态删除，复制/保存/关闭按钮集中于详情栏。

### 样式

- **三分区层级**：对象树卡 / 内容卡 / 详情底栏按 Apple 分组卡片 + hairline 分隔 + 10px 间距节奏重排，底栏详情栏获得新样式（与分组卡片规格统一）。

### 测试

- `.tmp-verify/verify.mjs` 内嵌断言更新：点单元格后断言 `.dbt-celldetail` 底栏出现且位于预览表格之后 → `.dbt-celldetail-input` textarea 改值（原生 setter + input 事件）→ 点「保存」断言 execute 恰好调用 1 次且底栏收起；浮层（`.dbt-cellpop`）与「编辑」中间态（`.dbt-celledit`）断言移除。

## 1.5.6

数据浏览内嵌侧边栏——对象树/结构/数据预览/单元格编辑全部在面板内完成，删除浮动窗与 PiP 死路径（DSH 主进程 deny 一切新窗口，PiP 在真机恒降级，属不可达路径）。

### 重构

- **内嵌化**：数据浏览不再弹窗——点击「数据浏览」tab 面板内直接呈现对象树，选表后结构/数据预览切换与 Navicat 式单元格查看编辑全部在面板内完成。
- **浮窗壳与 portal/PiP 链删除**：浮窗壳组件、`mountDialog` portal 工厂、createRoot 三重解析、`documentPictureInPicture` 开窗与降级链、noclient 兼容分支整体移除——数据浏览唯一形态即内嵌。
- **inject 收敛**：`dsh.client.inject` 移除 `react-dom` / `react-dom/client`（client.js 不再 require react-dom 系），仅保留 react 与宿主服务声明。

### 样式

- **全组件规格统一**：字号/控件/间距/圆角统一到 `--dbt-radius-*`（card/ctrl/pill）token 规格表，面板、树行、表格、卡片、对话框共用同一套控件规格。
- **浮窗大字号回收**：随浮窗删除，1.5.1 引入的浮窗专属大字号（标题 17px/600 等）回收，回到面板统一字号档位。

### 测试

- `.tmp-verify/verify.mjs` 重写为内嵌单态：删除 PiP/nopip/nord/noclient 四态矩阵，单场景断言内嵌对象树 → 选表 → 数据预览 → 单元格编辑保存 → 四视图切换冒烟；`gen.mjs` mockRequire 移除 react-dom 分支（保留 react）。

## 1.5.1–1.5.5

数据浏览的快速演进期：从侧栏弹窗到独立浮动窗、全局浮窗、再到 Document Picture-in-Picture 独立窗口逐版升级，最终因 DSH 主进程 deny 一切新窗口，PiP 在真机恒静默降级为浮窗——独立窗口路线止步于此，1.5.6 起收敛为面板内嵌形态。各版要点：

### 新增

- **1.5.1**：数据浏览升级为独立浮动窗口 + 全数据库 Navicat 式单元格查看/编辑——8 库写回路径（SQL 主键 UPDATE 走绑定参数、redis 按键类型映射白名单命令、mongo `updateOne` + `$set`），截断/BLOB/ro 授权拒就地编辑；Mongo Extended JSON 复活为唯一后端改动；左树挂载自动展开第一层级。
- **1.5.4**：浮窗升级为 Document Picture-in-Picture 独立窗口——OS 级单独窗口、系统级置顶、可拖出主窗口；PiP API 不可用/被拒时自动回落 DOM 浮窗；浮窗 z-index 提升不再被宿主 UI 压盖。

### 修复

- **1.5.2**：窄视口（桌面端侧栏 iframe，宽约 875px）下浮窗初始贴边铺满、可整只拖出视口——初始居中与拖动钳制全部改用浮窗实测尺寸。
- **1.5.3**：浮窗被侧栏容器裁剪、只能覆盖侧栏区域的根因修复——react-dom 三重降级解析后 portal 到 `document.body`，浮窗升级为覆盖整个应用窗口的全局弹窗。
- **1.5.5**：PiP 在真机从未发起的根因修复——宿主 inject 缺 `react-dom/client` 致 createRoot 探测恒空、PiP 恒静默降级；`dsh.client.inject` 追加该 specifier + 手势内开窗 3 秒超时降级 + portal/createRoot/PiP 诊断日志。

## 1.5.0

数据浏览面板升级为 Navicat 式近全屏弹窗（纯前端组件化重构，零新增依赖，后端与 HTTP API 零改动）。

### 新增

- **数据浏览 Navicat 式弹窗**：`client/client.js` 将数据浏览拆分为 `BrowseTree` / `BrowseView` / `BrowseDialog` 三组件（对象树逻辑单份，面板与弹窗各持实例、展开状态互不影响）；面板对象树点击表节点即打开近全屏弹窗（92vw×88vh，max 1400×940），左栏 260px 对象树独立滚动，右栏「结构 / 数据预览」Tabs + sticky 表头表格 + 底部分页条（边界沿用面板：第 1 页禁 ‹、`truncated === false` 禁 ›、busy 期间双禁）；请求序号守卫防快速切表旧响应闪现；右栏骨架 / 错误重试 / 空态 / 表格四态互斥（错误就地显示，不走被遮罩遮挡的面板顶部错误区）。
- **portal 挂载（mountDialog 工厂）**：模块级探测一次，`react-dom` 的 `createPortal` 可用时将弹窗整棵 overlay 树 portal 到 `document.body`（脱离侧栏容器 `overflow` 裁剪，react.dev 官方模态方案）；宿主未提供 `react-dom` 时回退 Panel 内 fixed overlay（与既有 DangerDialog 同模式）。两种挂载 DOM 结构完全一致，CSS 与焦点逻辑无需分支。overlay 根追加 `dbt-browse-root` 辅助类并入既有 `.dbt-panel` token 选择器（dark/light 两处，声明逐字节不变），`--dbt-*` token 与字体对 portal 子树照常生效；`prefers-reduced-transparency` / `prefers-reduced-motion` 三处降级选择器同步覆盖新弹窗。
- **APG Dialog Modal 可访问性**：对话框容器 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`（指向面包屑标题）；Esc 关闭走 window keydown 的 useEffect 订阅（cleanup 随卸载移除）；挂载瞬间初始焦点落关闭按钮（`aria-label` 本地化，✕ 为 `aria-hidden` SVG）；Tab / Shift+Tab 轻量焦点陷阱在弹窗内循环；关闭后焦点返回打开弹窗的树行（`document.contains` 防御性归属检查）。Esc / 遮罩点击 / ✕ 按钮三路关闭等效。
- i18n 新增 5 个 key（`browseDialogTitle` / `close` / `emptyStructure` / `emptyData` / `retry`），zh/en 两表同序追加，双语完整（t() 引用 90 = zh 90 = en 90）。

### 修复（双轨审查轮：人工交叉 + ocr/glm-5.3-flash）

- **遮罩误关**（双审查一致命中）：表格内拖选文本滑出弹窗释放时 click 派发在遮罩（mousedown/mouseup 公共祖先）导致误关——遮罩关闭增加 mousedown 归属判断（按下与释放均在遮罩自身才关闭）。
- **焦点陷阱逃逸**：点击无焦点的左树行后 activeElement 落 body，Tab 事件不经 dialog 冒泡、焦点逃出模态——Tab/Shift+Tab 并入 window keydown 订阅（与 Esc 同层），焦点在弹窗外时拉回弹窗内。
- **portal 路径文字色失去继承根**（ocr）：挂 `document.body` 后 `color:inherit` 继承 body 而非侧栏容器——新增 `--dbt-text` token（dark/light 两行，族系对齐 `--dbt-text-secondary`）并在 `.dbt-browse-root` 上 `color:var(--dbt-text)`，两条挂载路径渲染统一。
- **树行键盘可达**：交互树行补 `tabIndex=0` + `role="treeitem"` + Enter/Space 触发（键盘可在模态内切表、关闭后焦点返回真正生效）；已知取舍：全量 tabIndex 使 Tab 循环较长（升级路径 roving tabindex + 方向键）。
- 分页条常驻（去掉 busy 期间整体卸载，消除底边跳动，仅靠按钮禁用）；删除 CSS 冗余 `align-items:stretch` 与三处无效防御（`.focus` 存在性检查 ×2、`ownerDocument` 样板）。

## 1.4.1

修复 URL 方式连接的凭据输入与两处 MongoDB URL 正确性问题。

### 修复

- **URL 方式支持独立输入用户名/密码**：侧边栏 URL 模式此前只有单个 URL 输入框，凭据必须手工拼入 URL（含特殊字符时需自行 percent-encode，极易出错）。现新增可选的用户名/密码框，服务端 `mergeUrlCredentials`（`lib/store/connections.ts`）用 WHATWG URL 的 username/password setter 注入 userinfo——自动 percent-encode `@:/?# ` 等，与适配器侧 `decodeURIComponent` / 驱动 RFC 3986 解码严格互逆，8 库 URL 形态全兼容（含 redis 无用户名、oracle 必填用户名、`mongodb+srv://` 不动 host）。create / update / test-draft 三入口同口径；编辑时"url 未改 + 新密码"以已存 `secrets.url` 为基底仅覆盖密码；脱敏回填值（`:***@`）经基底替换绝不落库。
- **MongoDB URL 库名失效**：URL 模式下 `client.db()` 此前恒取 `'test'`，URL path 里的 `/dbname` 被忽略——现按 pg-like 同口径从 URL path 解析（percent 解码，无则 `'test'` 兜底，`mongodb+srv://` 同样支持），`meta.database`（分字段模式）仍优先。
- **MongoDB 分字段模式勾选 SSL 生成非法 URI**：`buildUri` 此前误用 `mongodb+srv://`（DNS seedlist 形态，禁止显式端口，与 TLS 无关），勾选即连接必失败——改为 `mongodb://` + `?tls=true` 查询参数（与 `authSource` 正确合并）。

### 测试

- 新增 `tests/store/url-credentials.spec.ts`（43 用例：`mergeUrlCredentials` 纯函数编码往返/单项覆盖/脱敏基底替换/错误路径 + 公开官方样例组（libpq percent-encoding/IPv6/query 保留、MongoDB Atlas `+srv`、Redis 6 ACL、Oracle easy connect、非 ASCII 凭据、大写 scheme 规范化）+ ConnectionStore 存储集成 + `DbToolService.testDraft` 拼回/注入/ssl 透传语义）。
- `tests/adapters-nosql-ent/mongodb.spec.ts` 补 URL 库名解析（4 用例）与 `buildUri` TLS/authSource 合并（4 用例）。
- 变异测试（stryker）达标：`lib/store/connections.ts` 83.09% → 87.31%、`lib/manager.ts` testDraft 区 58.54% → 87.18%——本次新增代码（`mergeUrlCredentials`、create/update 注入块、testDraft 注入与 secretsUrl 拼回）存活变异体全部清零（含 1 个等价变异经重构消除）；剩余存活均为存量代码或可证明等价变异（`rc.x = undefined` 与不设置对适配器 falsy 判断等价、`secrets.get(undefined)` 无副作用）。

## 1.4.0

GaussDB 驱动 npm 化，安装即用体验补全。

### 变更

- **GaussDB 驱动 npm 化**：驱动从 `vendor/gaussdb-pg`（openGauss-connector-nodejs 源码本地构建）改为 npm 依赖 `gaussdb-node@^0.2.2`（华为云官方组织 HuaweiCloudDeveloper 发布的 pg 兼容包族，导出结构同 pg），npm 安装即含 GaussDB 支持，无需本地构建。`lib/adapters/gaussdb/index.ts` 的 `loadGaussDriver()` 改为 `require('gaussdb-node')`，驱动缺失报错文案从「执行 build 脚本」改为「重新安装插件/依赖」。
- 移除 `scripts/build-gaussdb.{ps1,sh}` 与 `npm run build:gaussdb` / `build:gaussdb:sh` 脚本入口，删除 `vendor/gaussdb-pg` 与 `vendor/gaussdb-src` 构建路径（`vendor/` 仅保留 `mongodb-driver.cjs` bundle 产物）。
- GaussDB 相关 Node ≥ 22.12 特殊要求取消：gaussdb-node 依赖树（gaussdb-{connection-string,pool,protocol,cloudflare}、pg-types、pgpass）无 p-limit 等高版本约束，Node ≥ 20（engines 声明）即可。
- GaussDB 认证支持范围依包内实现如实标注（未真机验证）：sha256（RFC5802，`password_encryption_type=2` 默认）与标准 md5 已实现；md5-sha256 混合（type=1）与 SM3（type=3）包内未提供（rfc5802 仅支持 sha256 method、无 gm-crypto 依赖），服务端要求这两种认证方式时会握手失败。
- `files` 数组新增 `README_EN.md`（README 双语重写见 README）。
- 移除 `package.json` 的 `allowScripts` 字段：DSH 安装插件走 pnpm（`pnpm-workspace.yaml` 的 `allowBuilds` 白名单 + 安装失败界面 "Allow these scripts and retry" 一键批准重试），npm 的 `allowScripts`/`npm approve-scripts` 机制不参与；oracledb@7 的 install 脚本仅做 Node 版本检查与横幅打印，thin 模式（本项目使用）下无功能作用，批准无风险。

### 测试

- `tests/adapters-sql/gaussdb.test.ts` 重写：成功路径无条件断言 gaussdb-node 正常加载（Pool 构造不触发连接）；驱动缺失路径改为劫持 CJS 加载入口（`Module._load`）模拟包未安装，断言新报错文案（指向依赖安装并附原始错误，不再指向 build 脚本 / vendor 路径）。
- 依赖守卫 `tests/guard/deps-core-collision.spec.ts` 的 `DEPS_ALLOWLIST` 白名单同步加入 `gaussdb-node`；其 lockfile 实树断言（生产树不含 core-module 同名包）原样通过，无 p-limit/punycode。

## 1.3.0

适配 DeepSeek Harness `0.2.0-rc.1`（同时保持对 `0.1.7-rc.2` 的支持）。

### 安全

- **插件入口接入宿主 Connection 鉴权栅栏**：0.2.0-rc.1 起插件的 webServer 前缀路由不再经过宿主内置栅栏，`lib/index.ts` 现于 handler 顶层调用 `ctx.connection.requestRejection(req)`，返回 401/403 时直接兜底写 JSON 错误响应（`code: UNAUTHORIZED | FORBIDDEN`），不再进入业务 handler；返回 `undefined` 或宿主无 connection 服务时回退本地 trust 校验（loopback/Origin，防 DNS rebinding）。
- `DshContext` 类型新增 `connection` 可选成员；`inject` 清单新增 `'connection'`。

### 修复

- `scripts/apply-dsh-hotfix`（route-scoped 热修复）支持多目标版本：按实际安装的 `@deepseek-ai/dsh-app-boot` 版本自动选择补丁文件（`TARGET_VERSIONS` / `PATCH_BY_VERSION`）；已声明 `Target-Version` 与实际安装不符、或版本不受支持时以退出码 2 拒绝执行（`--force` 可越过）。
- 新增补丁 `patches/dsh-app-boot-route-scoped-hotfix-0.2.0-rc.1.patch`（锚点行相对 rc.2 整体偏移 +1，已验证 git apply 与内建替换结果逐字节一致）。

### 变更

- `engines.dsh` 扩为 `">=0.1.0-rc.6 <0.2.0-0 || 0.1.7-rc.2 || >=0.2.0-rc.1 <0.3.0-0"`（`0.1.7-rc.2` 必须显式列出：semver 的 prerelease 比较只在同一 `[主,次,补]` 元组描述符内生效，`>=0.1.0-rc.6` 不命中 `0.1.7-rc.2`）。
- `devDependencies` 补齐 peer 依赖（`@deepseek-ai/cordis ^4.0.4`、`dsh-better-sidebar ^0.24.1`），便于本地开发与类型检查；注意 `dsh-better-sidebar` 带 18 个宿主 peer（react 系 + 宿主子包），本地安装需 `--legacy-peer-deps`（与既有工作流一致）。

### 测试

- 新增 `tests/http/fence.spec.ts`（入口鉴权栅栏 6 用例：401/403 兜底与文案、prefix 挂载契约、无 connection 回退、`resolveProject` 会话反查链）。
- `tests/http/api.spec.ts` 补 trust 边界形态：跨站同默认端口（Host 无端口）、loopback 隐式 `:80`、非 http/https 无端口 Origin、IPv6 `[::1]`、OPTIONS 预检 204、2MB 上限拒绝。
- `tests/scripts/hotfix.spec.ts` 扩展至 18 用例：rc.1 补丁契约、按版本选择、不受支持版本拒绝、`--force` 越过、git apply 契约（rc.2 / rc.1）。
