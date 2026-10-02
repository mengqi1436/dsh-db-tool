# Changelog — dsh-db-tool

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
