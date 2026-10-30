# 从第三方侧边栏迁移到 DSH 官方右侧栏

> **验证状态**：所有源码结论均带 `路径:行号` 证据（上游 = `.tmp-ah/upstream`，commit `ce7073d5`；本仓库 = 仓库根）。**本机未做真机加载验证** —— 已核对宿主 `app.asar` 内 `@deepseek-ai/dsh-client-ui-sidebar-right` 包存在且与上游源码一致，但未重启桌面端实测面板渲染。
>
> **路径简写**：`SR/` = `.tmp-ah/upstream/packages/client/ui-sidebar-right/src/client/`，`DK/` = `.tmp-ah/upstream/packages/client/ui-dockkit/src/components/`。

---

## 1. 为什么迁移

### 1.1 第三方 dsh-better-sidebar：全量渲染 + CSS 隐藏

旧链路把保活硬编码在实现里，插件无法选择：

```js
// node_modules/dsh-better-sidebar/lib/client.js:31080-31131  registerDescriptor 内部
const disposeType = tabs.register({
  id, kind: descriptor.id,
  keepMounted: true,        // :31085 —— 对所有 tab 无条件 true，调用方关不掉
  priority: "extension", ...
})
```

渲染层同样不做取舍，把每个 leaf 的所有 tab 全画出来只用 class 隐藏：

```js
// node_modules/dsh-better-sidebar/lib/client.js:28907-28909
children: leaf.tabs.map((tab) => jsx("div", {
  className: clsx(css.paneTab, tab.id !== activeTab?.id && css.paneTabHidden),
  children: renderTab(tab, tab.id === activeTab?.id, leaf.id)
}, tab.id))
```

```css
/* node_modules/dsh-better-sidebar/lib/client.js:4556 样式表 */
.nArs4W_paneTabHidden{display:none}
```

即**每个打开过的 tab 正文永远挂在 DOM 里**，切换只是 `display:none`；代价（内存、未访问 tab 也占实例）由插件承担且无从选择。

### 1.2 官方右侧栏：默认按需卸载，`keepMounted` 是显式许可

```ts
// SR/tab-registry.ts:107-108
/** Lazily keep a visited body mounted through hiding, Session changes and docking; default false. */
readonly keepMounted?: boolean
```

全仓库只有一个读取点（见第 4 章），缺省不传 → `retained = false` → 切 tab 即卸载。

### 1.3 迁移收益：以下能力改为宿主提供

| 能力 | 归属 | 证据 |
|---|---|---|
| 并排 / 分栏（上限 2 格，最小 20%） | dockkit | `DK/TabLayout.tsx:134-136`、`SR/shell/SidebarRight.tsx:355` |
| 浮出浮窗、拖放、跨格移动 | dockkit | `DK/TabLayout.tsx:44`（浮窗 `selected` 恒真）、`:145-149`（`key=tab.id` 稳定） |
| 全屏 | sidebar-right | `SR/shell/SidebarRight.tsx:398-399` |
| 布局按会话持久化 | sidebar-right | `README.zh.md:76`（`dsh.sidebar-right.v1.<sessionId>`） |
| 关闭确认、刷新命令、发光提示 | sidebar-right | `SR/contract/slots.ts:150-162`、`:156-182` |

旧实现一律没有。注意插件自己那层内部视图切换（`client/client.js:3768-3772`）**仍要保留**：它解决「同一 tab 内 5 个子视图切换」，与 dockkit 的 tab 级挂载是两个层次，不能互相替代。

---

## 2. 两阶段注册契约

### 2.1 阶段一：`ctx.sidebarRightTabs.register(definition)`

字段表来自 `SR/tab-registry.ts:94-139`：

| 字段 | 默认 | 约束与证据 |
|---|---|---|
| `id` | — （必填） | 全局唯一；二次注册抛错 `SR/tab-registry.ts:258` |
| `kind` | — （必填） | 类型判别式，**非全局唯一**（extension 可接管 builtin）；`:104` |
| `multiple` | `false` | 每次打开生成独立内容地址；`:105-106`、`SR/service.ts:482` |
| `keepMounted` | `false` | 见第 4 章；`:107-108` |
| `patterns` | 无 = 页类型 | 含 `:` 匹配整地址，否则匹配 URI path 任意深度；`:109-119` |
| `priority` | **`'extension'`** | `:59`（`DEFAULT_BAND`）、`:52-56`（秩 3/2/1） |
| `canOpen` | 接受全部 | 同步、每次路由都跑；`:122-130` |
| `title` | — （必填） | **打开时求值一次并捕获进记录**；`:131-136`、`:388`、`:394` |
| `guide` | 不上引导页 | 条目 id 在 provider 内唯一；`:137-138`、`:62-83` |

**`priority` 默认是最高的 `extension`**，这是最容易踩的默认值 —— 不写就压过所有内置查看器（`:41-43` 注释原文「the highest: a type that declares nothing outranks every viewer shipped here」）。

### 2.2 共存规则与三类抛错

```ts
// SR/tab-registry.ts:181-183
function coexists(slot: KindSlot, band: SidebarRightTabPriority): boolean {
  return band !== 'fallback' && slot.inForce.band !== 'fallback' && slot.inForce.band !== band && slot.shadowed === undefined
}
```

即**一个 kind 最多同时容纳 1 个 `extension` + 1 个 `builtin`**；`fallback` 与任何档都不共存。注册期三道门（`SR/tab-registry.ts:253-262`）：

| 场景 | 抛错 | 行号 |
|---|---|---|
| 同一 definition 内 guide 条目 id 重复 | `duplicate guide entry id in "<id>"` | `:255-256` |
| 同一 `id` 二次注册 | `tab type id "<id>" is already registered` | `:258` |
| kind 同档撞名 | `tab kind "<kind>" is already registered (<band>)` | `:259-262` |

`register()` 返回 disposer（`:280`），**但内部 effect 挂在注册表宿主的 ctx 上**（`:270`），所以调用方必须把 disposer 放进自己的 `ctx.effect`，否则插件卸载后注册不撤销（`:243-248` 注释：「The caller holds the returned disposer inside its own `ctx.effect`」）。

### 2.3 阶段二：两个席位，key 必须是 `definition.id`

```ts
// SR/contract/slots.ts:59-64（正文）与 :73-78（标题，可选）
'sidebar.right.pane.tab':       { kind: 'keyed'; scope: 'session'; hookContext: TabHookContext; inject: SidebarRightTabInjected }
'sidebar.right.pane.tab.title': { kind: 'keyed'; scope: 'session'; hookContext: TabHookContext; inject: SidebarRightTabInjected }
```

**为什么 key 是 `id` 不是 `kind`** —— `SR/tab-registry.ts:96-101` 原文：「*A kind is not unique — an extension may take a builtin's over — so the implementation carries its own name, and it is the key its body and title register under...*」

派发处：

```ts
// SR/shell/SidebarRight.tsx:221
const content = renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, fallback, hookContext })
```

无 registrant 时（记录里的 kind 来自已卸载的插件）退化为 `tab.kind` 并走 fallback：正文显示 `tab.unavailable`（`:243`），标题回落 `tab.title`（`:250`）。

> 本文档最易写错的一处：`key` 写成 `kind` 时**不报错**，但席位永远命中不了自己的条目 —— 表现为面板空白或「无法打开」。

---

## 3. 完整注册代码（对照 `client/client.js:3810-3906`）

### 3.1 inject 声明：包级声明管加载，slot inject 管时序

```js
// client/client.js:3813
const inject = ["slots", "sidebarRightTabs", "locale"];
```

```jsonc
// package.json:43-45  —— 决定官方包先到场
"inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-sidebar-right"]
```

`dsh.client.inject` 管**加载**而不是 `apply` 时序，两条路都要走。缺包级声明 → `ctx.sidebarRightTabs` 为 `undefined`，故有显式缺失告警（`client/client.js:3830-3833`）：

```js
if (!ctx.sidebarRightTabs || !ctx.slots) {
  console.warn("[dsh-db-tool] 宿主未提供 sidebarRightTabs / slots 服务，右侧栏面板不会挂载");
  return;
}
```

保留 `return`（不抛错）以免拖垮宿主启动，但**必须留一行 warn** —— 早期是静默 `return`，现象是「插件装好了、右侧栏什么都没有、控制台也干净」，无法自诊断。

### 3.2 类型注册（含 guide 卡片）

```js
// client/client.js:3872-3894
ctx.effect(function () {
  return ctx.sidebarRightTabs.register({
    id: TAB_ID, kind: TAB_ID,
    // Panel 的 view/projectPath/conns/grants 与 ConsoleView、TransferView 的状态全在 React 本地，
    // 默认的 keepMounted=false 会卸载正文，切回来就全丢。
    keepMounted: true,
    // 本插件无 patterns（是页类型），priority 不参与路由排序，省略即 extension；显式声明只为可读性。
    priority: "extension",
    title: function () { return t("tabTitle"); },
    guide: [{
      id: TAB_ID, order: 45,
      title: function () { return t("tabTitle"); },
      description: function () { return t("tabDesc"); },
      icon: DbIcon,
    }],
  });
}, "dsh-db-tool: register tab type");
```

三处「为什么」：

1. **`title` / `guide[].title` / `guide[].description` 必须是 thunk**。`SR/tab-registry.ts:24-25`：「*Thunked copy (title, guide[].title, guide[].description) is read again on every use, so a language change needs no re-registration.*」写成字符串等于把语言钉死在注册那一刻。
2. **`guide[].icon` 是 React 组件类型，不是返回节点的函数**。`:81-82` 声明为 `ComponentType<IconProps>`，宿主按 `<Icon size={...} />` 渲染（`SR/tabs/guide/GuideBody.tsx:71`、`:83`）；传 `() => <svg/>` 会渲染成空。
3. **`id` 与 `kind` 当前同值**（`client/client.js:508` 的 `TAB_ID`）。契约允许，但 `id` 变更会让席位 key 与类型脱钩、`kind` 变更会让用户的 guide Pin 失配（Pin 身份是 `kind:入口 id`，`README.zh.md:123`）—— 改动必须两处一起动。

### 3.3 正文与标题席位：必须用 `ctx.slots.inject` 包一层

```js
// client/client.js:3896-3906（标题席位同构，key 同样是 TAB_ID）
ctx.effect(function () {
  return ctx.slots.inject("sidebar.right.pane.tab", function () {
    return ctx.slots.register({ name: "sidebar.right.pane.tab", key: TAB_ID }, DbToolBody);
  });
}, "dsh-db-tool: register tab body");
```

`ctx.slots.inject(key, cb)` 的作用是**等目标席位被声明**：它监听 `declarationEpoch`（`ui-slots/src/index.ts:1474-1475`），目标声明后才执行 `cb` 并把结果作为嵌套 effect 管理。直接 `register` 在席位尚未声明时会失败或静默丢失 —— 而插件与官方包谁先 `apply`，不由 `dsh.client.inject` 保证。

正文组件取数据（`client/client.js:3837-3850`）：

```js
const info = props.useTabInfo();
const cwd = props.useSessions(snapshot => snapshot?.byId?.[props.sessionId]?.cwd);
return React.createElement(DbToolRoot, {
  ctx: ctx, visible: info.tab.visible,
  scope: { sessionId: props.sessionId, cwd: cwd },
});
```

`sessionId` 来自框架标准 props（席位声明 `scope: 'session'`，`SR/contract/slots.ts:61`），`useSessions` 是 root 级 hook。与官方同构：`ui-sidebar-files/src/client/FilesBody.tsx:52`。

### 3.4 语言字典

```js
// client/client.js:3819-3826
ctx.effect(function () {
  const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
  const offEn = ctx.locale.register(LOCALE_NS, "en", en);
  return function () { try { offZh(); } catch (e) {} try { offEn(); } catch (e) {} };
}, "dsh-db-tool: dictionaries");
```

字典只注册一次，**切语言不重新 apply**，因此 `t()` 必须每次现读 locale 快照（`client/client.js:481-497` 的 `localeService` / `currentLocale()`），不能缓存成渲染期常量。

---

## 4. keepMounted：本文档最重要的一节

### 4.1 唯一读取点在 dockkit

```ts
// DK/TabLayout.tsx:45-48
const visible = active && selected && (floating || state.expanded)
const retained = keepMounted?.(tab) ?? false
const [visited, setVisited] = useState(visible)
if (visible && !visited) setVisited(true)
```

```tsx
// DK/TabLayout.tsx:103
{visited && (retained || (active && selected)) ? <TabBody tab={tab} renderTab={callbacks.renderTab} /> : null}
```

`DK/TabLayout.tsx:46` 是全仓库唯一读取点（`SR/shell/SidebarRight.tsx` 只做透传）。挂载条件是 `visited && (retained || (active && selected))`：

- `retained === true` → 只要访问过就渲染，`selected` / `active` / `expanded` 全部不再参与 → 正文留在 DOM，切换只做 `hidden` + `inert`（`:82`、`:54`、`:86`）。
- `retained === false`（默认）→ 退化为 `visited && active && selected` → **切 tab 即卸载**。

### 4.2 它不是「提前挂载」

`visited` 初值是 `useState(visible)`，只有真正可见过一次才置真（`:47-48`）→ 未访问正文永不预挂载（与 `README.zh.md:112`「未访问的正文不会提前挂载」一致）。它也不延长 `signal` 寿命：`signal` 只在记录消失或插件卸载时 abort（`SR/contract/slots.ts:205-206`），收起、切 Session、切 tab 都不 abort。

### 4.3 sidebar-right 侧只做透传

```tsx
// SR/shell/SidebarRight.tsx:208-209
const retained = seat === 'sidebar.right.pane.tab' && definition?.keepMounted === true
useLayoutEffect(() => retained ? retainTab(tab.id, signal) : undefined, [retained, retainTab, tab.id, signal])
```

```tsx
// SR/shell/SidebarRight.tsx:365
keepMounted={tab => types.find(type => type.kind === tab.kind)?.keepMounted === true}
```

`:365` 判定用的是 **`tab.kind`** 而非 `id` —— extension 接管 builtin 的 kind 时，挂载策略跟接管者走。

### 4.4 后台 Session 保活的另一半：`retainTab`

```ts
// SR/session-view.ts:60-75  retainTab：计数 +1，signal abort 时释放
readonly retainTab = (tabId: TabId, signal: AbortSignal): (() => void) => {
  if (signal.aborted || this.disposed) return () => {}
  this.tabs.set(tabId, (this.tabs.get(tabId) ?? 0) + 1)
  ...
}
// SR/session-view.ts:38-40
get hasRetainedTabs(): boolean { return this.tabs.size > 0 }
// SR/session-views.ts:67-73  prune：非选中且无 retained tab 的 view 直接 retire
private prune(view: SidebarSessionView): void {
  if (view.sessionId === this.selected || view.hasRetainedTabs || this.views.get(view.sessionId) !== view) return
  this.views.delete(view.sessionId); ...
}
```

链路：`SidebarRight.tsx:208` 判定 `retained` → `:209` 调 `retainTab` 拿 hold → hold 期间 `hasRetainedTabs` 为真 → `session-views.ts:68` 不 prune → 后台 Session 整棵子树以 `display:none` 存活（`SR/shell/RightbarRoot.tsx:22`）。

**这才是 `keepMounted` 在 sidebar-right 侧的真实实现；缺它只在「同 Session 内切 tab」有效，切 Session 就失效。**

### 4.5 不声明的反面后果（本插件踩过的真实坑）

面板状态几乎全在 React 本地 state、无一处落盘：`ConsoleView` 的 14 个 `useState`（连接、模式、参数、库列表、**多标签 SQL 与结果**、活动标签、事务令牌、历史面板，`client/client.js:2647-2662`）、`Panel` 的分段与项目路径与连接授权列表与树刷新信号（`:3644-3658`）。缺 `keepMounted` 时以下任一动作都会让它们归零：

| 动作 | 后果 | 证据 |
|---|---|---|
| 同 pane 切到别的 tab 再切回 | `selected` 变假 → 挂载条件为假 → 卸载 | `DK/TabLayout.tsx:44`、`:103` |
| 切到别的 Session | `retainTab` 未注册 → view 被 prune → 整棵子树卸载 | `SR/shell/SidebarRight.tsx:208-209` → `SR/session-views.ts:67-73` |
| 主栏被全局面板替代 | `active=false` → 卸载 | `SR/shell/RightbarRoot.tsx:21`、`DK/TabLayout.tsx:103` |

**两个反直觉项**：

- **收起右栏（`expanded=false`）不会卸载正文**，无论是否声明 —— 挂载条件 `:103` 不含 `visible`，收起只影响 `inert`/`aria-hidden`，视觉平移由宿主 CSS 完成（`SR/shell/SidebarRight.module.css:52-67`）。别把「收起不丢」当成 `keepMounted` 生效的证据。
- **dock ↔ float 也不重挂载**：tab 渲染成扁平数组、`key=tab.id`（`DK/TabLayout.tsx:145-149`），浮窗只是同一 Grid 改属性与 `order`（`:82-95`），`selected` 恒真（`:44`）。

### 4.6 它不保什么 / 落地后必须配套

只保「插件仍在内存中的 React 实例」。以下仍会丢：**关闭页签**（记录销毁，重开是新 TabId → 新实例）、**插件重载 / 页面刷新**、以及限制 L4（保活 Session 从目录消失不会自动退休，`README.zh.md:154`）。

配套：正文在后台 Session 里也活着，**所有轮询/定时器都必须继续用 `visible` 门控**，否则「保活」会变成「后台持续查询数据库」。本插件已把 `tab.visible` 接到根组件（`client/client.js:3847`），各视图再用它门控刷新（`:3768-3772` 起的视图挂载表）。

---

## 5. `useTabInfo()` 与 `visible` 的精确语义

### 5.1 精确表达式

```ts
// SR/tab-info.ts:46
visible: active && (pane.host === 'float' || (layout.expanded && (title || pane.activeTabId === tabId))),
```

| 因子 | 含义 | 来源 |
|---|---|---|
| `active` | 该 Session 在前台，且主栏不是全局面板 | `SR/shell/RightbarRoot.tsx:21` |
| `pane.host === 'float'` | 浮窗恒可见，**不受整栏收起影响** | `SR/tab-info.ts:43` |
| `layout.expanded` | 停靠列展开 | `SR/tab-info.ts:42` |
| `title` | 该席位是**标题**席位 | `SR/shell/SidebarRight.tsx:213` |
| `pane.activeTabId === tabId` | 本 tab 是该 pane 的选中 tab | `SR/tab-info.ts:40` |

结论：**这一个布尔已同时表达「页签激活」「右侧栏展开」「非后台会话」三重语义**，业务方无需自己再 `&&` 一遍。类型注释（`SR/contract/slots.ts:199-203`）：「*Only the foreground Session is visible. Docked bodies require expansion and selection; expanded titles include inactive tabs. Floats survive collapse.*」

**标题席位 vs 正文席位**：`title === true` 时「选中」条件被短路 → 处在标题席位时**展开且前台即恒 visible**，不看是否选中。因此「用 `visible` 门控轮询」只适用于正文席位。

这里的 `visible` 与 dockkit 内部的 `TabHost.visible`（`DK/TabLayout.tsx:45`）**不是同一个值**：后者不区分标题/正文席位，两者不能互相替代。

### 5.2 返回结构

`SR/contract/slots.ts:185-215` 声明、`SR/tab-info.ts:41-52` 组装：

| 字段 | 含义 | 行号 |
|---|---|---|
| `sidebar.expanded` | 停靠列是否展开（dockkit `layout.expanded`） | `SR/tab-info.ts:42` |
| `sidebar.fullscreen` | `viewportWidth < 768 \|\| mode==='fullscreen'`，收起期间保持 | `SR/shell/SidebarRight.tsx:398-399` |
| `panel.id` | 所在 pane 的 id —— **每 pane 独立状态应以它为键** | `SR/tab-info.ts:43` |
| `panel.isFloating` | 是否浮窗；拖动时 `tab.id` 不变而它变 | `SR/tab-info.ts:43` |
| `tab.navigation` | `{ address, params, revision }`，每次导航 `revision` 递增 | `SR/contract/slots.ts:110-120` |
| `tab.signal` | abort 时机 = 记录消失或插件卸载，**收起与切 Session 不 abort** | `SR/contract/slots.ts:205-206` |
| `tab.actions` | `bindCommands` / `openResource` / `openTab` / `close` | `SR/contract/slots.ts:156-182` |
| `tab.refreshShortcut` | **全局 `page.refresh` 条目**，非本插件自己的刷新键位 | `SR/tab-info.ts:50` |

### 5.3 它会在记录未提交时 throw

```ts
// SR/tab-info.ts:37-39
if (layout === undefined || tab === undefined || navigation === undefined) {
  throw new Error(`sidebarRight: tab "${tabId}" is not committed in session "${sessionId}"`)
}
```

所以**不要在 render 期之外创建或探测记录**，也别把它当「安全读取器」在 effect / 事件回调里随意调 —— 它是 hook（内部 `useStore` / `useTabNavigation` / `useMemo`），只能在渲染期调用。

### 5.4 会话 `cwd` 的官方写法

`client/client.js:3839-3844` 的 `useSessions(snapshot => snapshot?.byId?.[sessionId]?.cwd)` 与官方 `ui-sidebar-files/src/client/FilesBody.tsx:52` 同构（另见 `FileNavigator.tsx:78`、`NavigatorToggle.tsx:45`）。`cwd` 为 `undefined` 时应渲染「无工作区」态 —— 本插件用 `client/client.js:1721` 的 `projectUnbound` 提示兜住。

---

## 6. 官方已知限制与影响判断

原文 `README.zh.md:151-157`，共 7 条。

| # | 官方限制（摘录） | 行号 | 是否影响本插件 | 判断依据 |
|---|---|---|---|---|
| L1 | 布局保存在当前浏览器，不跨设备同步 | `:151` | **间接** | 侧栏布局本不该跨设备；插件自己的「上次选中连接 / 树展开层 / SQL 草稿」既不在布局里也没持久化，属插件自身债务 |
| L2 | 没有会话就没有停靠面 | `:152` | **影响，用户可感知** | 未选会话时插件完全不可达 —— 没有 guide 卡片、没有 tab、没有展开按钮（`:59`）。**README 必须写明，否则用户当 bug 报** |
| L3 | 硬编码层叠，浮窗只在该层内重排 | `:153` | **影响，当前侥幸无害** | 见 6.1 |
| L4 | 保活 Session 的删除只靠 tab 生命周期与插件卸载 | `:154` | **影响（已声明 keepMounted）** | 正文会在后台 Session 存活；Session 归档/删除不会自动退休。插件无 `registerCloseHandler`、不在侧栏 pin 资源，泄漏面仅本地面板 state |
| L5 | 未暴露撤销，`_undo/_redo` 是 `@internal` | `:155` | **不影响** | 插件不驱动布局历史 |
| L6 | 标题在打开时固定 | `:156` | **已被对冲** | 插件注册了标题席位（`client/client.js:3902-3906`）做活标题，随语言切换重渲染 |
| L7 | 没有内容导航栈 | `:157` | **不影响** | 插件的内容导航（连接树 / 表预览）是自绘的 |

### 6.1 L3 层叠：当前为何不触发，何时会

宿主层叠层（`SR/shell/SidebarRight.module.css:31-33`、`:83`）：正常面板 `--dsh-dockkit-dock-layer: 10`、浮窗 `--dsh-dockkit-float-layer: 60`、全屏 `dock-layer: 40`，配合 `DK/dockkit.module.css:149`、`:161`，正常面板 ≤ 60。

本插件确认对话框是 `position:fixed; z-index:9999`（`client/client.js:649` 的 `.dbt-overlay`），且展开态 dock host 为 `transform: none`（`SR/shell/SidebarRight.module.css:65`）→ `fixed` 后代仍以视口为包含块；`.panel { overflow: clip }`（`:46`）按注释不裁剪 fixed 后代。

**所以展开态位置正确。但滑入/滑出动画期间 `transform` 有值，`fixed` 的包含块会临时变成那个被 transform 的祖先 → 此时打开对话框会错位。** 稳妥改法是 portal 到 `body`；若要做成「收起态也能弹」则必须改。

---

## 7. 旧冗余清理清单

### 7.1 代码：`client/client.js`

| 类别 | 位置 | 处理 |
|---|---|---|
| 旧名词注释（「侧边栏」≠ 右侧栏） | `:1872`、`:2326`、`:2432`、`:3658`、`:3885` | 指的是插件自己的 Navicat 式内嵌侧栏或历史排序参照，可保留；但 `:3885` 的「与旧侧边栏排序一致」在新上下文已无指代对象，建议改写 |
| `scope.repoRoot` / `workspacePath` 死兜底 | 原 `:3636`、`:3637`、`:3658` | **已删除**。两字段在本仓库无写入方（`scope` 只由 `:3848` 构造为 `{ sessionId, cwd }`），恒为 `undefined`；上游 `SessionStandardProps` 也只给 `sessionId`。现为 `scope.cwd \|\| ""`（`:3648-3649`） |
| 语言绑定 key（强制重挂载） | 原 `:3790`、`:3851` | **已删除**。原 `key: "db-tool-" + localeKey` 会在切语言时重建整棵面板、清空所有本地 state；现只用 `useSyncExternalStore` 触发重渲染，文案走 thunk（`:3853` 注释） |
| better-sidebar 残留 | 全文 | 计数为 0（已 grep 确认） |

### 7.2 依赖：`package.json` 与 `package-lock.json`

| 位置 | 变更 |
|---|---|
| `devDependencies`（`:62` 起） | 移除 `dsh-better-sidebar` |
| `peerDependencies`（`:84` 起） | 移除 `dsh-better-sidebar`，只留 `@deepseek-ai/cordis`（与官方四个 client 包一致） |
| `dsh.client.inject`（`:43-45`） | 新增 `@deepseek-ai/dsh-client-ui-sidebar-right` |

`package-lock.json`（commit `7a2859b`，净删 4084 行）连带移除该包及其独占传递依赖：按 `node_modules/` 顶层名去重为 **147 个包**，比重最大的是 `@types`（43）、`@deepseek-ai`（42）、`@esbuild`（26）、`@codemirror`（17）、`@inquirer`（17）、`@rolldown`（16）、`@lezer`（16），另有 `mermaid`/`d3` 系的 `d3-sankey`、`d3-dsv`、`cytoscape-fcose`、`katex`、`@xterm` —— 都是 better-sidebar 内置编辑器/图表功能带的，本插件一个都不用。

> 口径提醒：lock 里 `"node_modules/xxx"` 条目共删 347 条，同一包在不同父路径下重复出现，去重后是 147 个**唯一包名**。引用时用 147。

### 7.3 文档

`README.md:110-113` 已改「通过 DSH 官方右侧栏注册一个页签，不依赖任何第三方侧边栏」；`README_EN.md:110-112` 已同步；`client/README.md:5-9`、`:17`、`:34-38` 已写明两段式注册、`priority`、`keepMounted` 及原因。三处仍需人工确认没有残留旧截图/旧动图（本次未逐图核对）。

### 7.4 目录残留

| 项 | 状态 |
|---|---|
| `pnpm-lock.yaml` | 存在于仓库根、被 `.gitignore:6` 忽略，注释写「pnpm 的 lock 属误产生，不入库」→ 属残留，可删本地文件（不影响仓库） |
| `docs/` | 原先 `.gitignore` 把 `docs/` 整目录忽略，而 `package.json` 的 `files` 需要 `"docs"`，本文件会既不进仓库也不进包。已改为 `docs/*` + `!docs/sidebar-right-migration.md`（父目录被忽略时 `!` 例外不生效，必须用通配符形式），本文件因此可入库，与 `files` 白名单一致 |

### 7.5 CHANGELOG 历史段落

`CHANGELOG.md:85`、`:116`、`:355` 仍提到 `betterSidebar.registerTab`、`dsh-better-sidebar ^0.24.1 → ^0.28.0`。**保留不改**：那是当次版本的真实记录，改写历史即伪造记录。新版本（`:7`、`:13`）已写明移除。

---

## 8. 排障

### 8.1 右侧栏里完全没有「数据库」入口

按序查四项：

1. **`dsh.client.inject` 是否含官方包** —— `package.json:43-45` 必须有它。缺 → `ctx.sidebarRightTabs` 为 `undefined`。
2. **控制台是否有本插件的 warn** —— 服务缺失时打印 `[dsh-db-tool] 宿主未提供 sidebarRightTabs / slots 服务`（`client/client.js:3831`）。看到这行就是加载顺序问题，不是注册问题。
3. **是否选中了会话** —— 没有会话就没有停靠面（L2，`README.zh.md:152`），此时右侧栏整块不存在，不是插件问题。
4. **`id` 是否与别的插件冲突** —— 同 `id` 二次注册抛 `tab type id "<id>" is already registered`（`SR/tab-registry.ts:258`）。`id` 是**注册表进程内全局**唯一。

### 8.2 注册直接抛错，插件没起来

| 错误信息 | 原因 | 证据 |
|---|---|---|
| `tab type id "X" is already registered` | 同 id 二次注册（常见于热重载时忘了 `ctx.effect` 包裹，旧注册未撤销） | `SR/tab-registry.ts:258` |
| `tab kind "K" is already registered (<band>)` | 同 kind 同档撞名；一个 kind 最多 1 extension + 1 builtin | `:259-262`、`:181-183` |
| `duplicate guide entry id in "ID"` | 同一 definition 内两条 guide 条目共用 id | `:255-256` |
| `no tab type is registered as "kind"` | `openTab` 的 kind 没人注册 | `SR/service.ts:480-481` |

前三条都会**打断插件加载**，所以三处注册必须各自套 `ctx.effect`（`client/client.js:3872`、`:3896`、`:3902`）。

### 8.3 切语言不生效

- **根因一**：thunk 写成字符串。`title: "数据库"` 在注册那刻固定；必须 `title: function () { return t("tabTitle"); }`（`SR/tab-registry.ts:24-25`）。
- **根因二**：`t()` 缓存了渲染期语言常量。`apply` 不因切语言重跑，`t()` 必须每次现读快照（`client/client.js:481-497`）。
- **反模式**：用 `key={localeKey}` 触发重挂载。注册表明确语言切换不需重注册（`SR/tab-registry.ts:24-25`），而重挂载会清空所有本地 state —— 正是本插件曾有过的缺陷（7.1）。

### 8.4 切走再切回来状态全没了

1. **类型是否声明 `keepMounted: true`** —— 缺省 `false` 会卸载正文（`client/client.js:3879` 已声明；契约 `SR/tab-registry.ts:107-108`）。
2. **若只在「切 Session」丢、同 Session 内切 tab 不丢** —— 是 `retainTab` 链路问题，检查 `SidebarRight.tsx:208-209` 的 `retained` 是否为真（要求 `seat === 'sidebar.right.pane.tab'`，标题席位不算）。
3. **若收起右栏也丢** —— 收起**不应该**丢（`DK/TabLayout.tsx:103` 条件不含 `visible`）。真丢了说明正文被卸载两次，查是否自己在上层用 `key` 或条件渲染重建了整棵树。
4. **别混淆「关页签」与「切页签」** —— 关闭是记录级销毁，`keepMounted` 保不住，重开必然是新实例。

### 8.5 新建格直接进了数据库页而不是入口页

这是**官方默认页规则**，不是 bug：

```ts
// SR/contract/seed.ts:26-33
const [only, ...others] = tabs.guide()
const single = only !== undefined && others.length === 0
const kind = single ? only.kind : GUIDE_KIND
```

默认页取决于**全局 guide 条目总数**：恰好 1 条 → 直接打开那一条；0 条或多条 → 打开引导页（`GUIDE_KIND`，`:36`）。产品内置已有一个 `files` 条目，常规发行里是 2 条、默认页仍是引导页；但**若发行形态里没有 `ui-sidebar-files`**，本插件的 guide 条目会成为唯一 → 所有新会话的右侧栏默认直接打开数据库面板。接入前应确认宿主组合。

### 8.6 面板显示「无法打开」

说明席位派发走到了 fallback（`SR/shell/SidebarRight.tsx:243`），即 `entryKey` 找不到对应注册条目。最常见原因是**席位 `key` 写成了 `kind`**，与 `definition.id` 不一致 —— 确认 `client/client.js:3898`、`:3904` 的 `key` 与 `:3874` 的 `id` 同值。
