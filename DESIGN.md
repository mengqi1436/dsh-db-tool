---
name: dsh-db-tool
description: DSH 聊天数据库工具——安静原生的 Apple 风格侧边栏管理台
colors:
  accent: "#0a84ff"
  surface: "rgba(120,120,128,0.12)"
  surface-strong: "rgba(120,120,128,0.18)"
  separator: "rgba(120,120,128,0.24)"
  text: "rgba(235,235,245,0.92)"
  text-secondary: "rgba(235,235,245,0.6)"
  danger: "#ff453a"
  success: "#30d158"
  warning: "#ffd60a"
  dialog-bg: "rgba(40,40,44,0.85)"
  th-bg: "rgba(30,30,32,0.72)"
  seg-active: "rgba(255,255,255,0.14)"
  overlay: "rgba(0,0,0,0.4)"
  th-bg-light: "rgba(242,242,247,0.9)"
  celldetail: "#2c2c2e"
  celldetail-light: "#f5f5f7"
  degraded-solid: "#f2f2f7"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
rounded:
  card: "12px"
  ctrl: "8px"
  pill: "6px"
  focus: "2px"
spacing:
  panel: "16px"
  card: "12px"
  row: "10px"
  gap: "8px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.ctrl}"
    padding: "5px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.ctrl}"
    padding: "5px 12px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.ctrl}"
    padding: "5px 12px"
  input:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.text}"
    rounded: "{rounded.ctrl}"
    padding: "5px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "12px"
  segmented-active:
    backgroundColor: "{colors.seg-active}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "5px 8px"
---

# Design System: dsh-db-tool

## Overview

**Creative North Star: "库比蒂诺控制台（The Cupertino Console）"**

这是一套寄生在 DSH 宿主里的 Apple 原生风格管理台。它的第一目标不是被看见，而是不被认出来是第三方：分段控件、inset grouped 卡片、毛玻璃铬层、SF 字体栈——所有语言都向 macOS/iOS 系统面板看齐，让用户觉得这是宿主自带的功能。氛围安静克制，不抢宿主风头。

系统以暗色为基线（`prefers-color-scheme: light` 时经 media query 整体反转），强调色继承宿主 `--dsh-accent`，插件不自造品牌色。表面几乎全部使用半透明灰阶分离材质（rgba 灰），叠在宿主背景上自然融合。密度是工具级的：13px 正文、12px 数据、11px 辅助文字，单列流式布局撑满侧边栏面板。

数据展示是核心场景：表格数据、SQL、单元格值一律等宽字体 + hairline 行分隔，表头毛玻璃 sticky，浏览面板另加列间分隔线构成"列分明"的数据网格。

**Key Characteristics:**
- 安静原生：像 DSH 自带面板，不像第三方插件
- 暗色基线 + light media query 反转，accent 继承宿主
- 静止平面：内容表面无阴影无边框，材质与投影只出现在浮于内容之上的铬层
- inset grouped + hairline：结构靠底色分区和 1px 分隔线，不靠边框盒子
- 数据等宽：表格、SQL、单元格一律 mono
- 三重降级：`prefers-color-scheme` / `prefers-reduced-transparency` / `prefers-reduced-motion` 全部响应

## Colors

调色板即 iOS 系统色板：一套半透明灰阶分离材质承担所有表面，五个语义色（accent/danger/success/warning + 文字两级）承担全部彩色。以下为暗色基线值；light 模式在 media query 中整体反转（surface 透明度降档、separator 换暖灰、系统色换成 iOS light 变体，如 danger `#ff3b30`、warning `#ff9f0a`）。

### Primary
- **系统蓝 · 宿主继承**（`var(--dsh-accent, #0a84ff)`，light `#007aff`）：唯一强调色。primary 按钮、focus 描边、对象树选中态、ro/rw 分段高亮。永远继承宿主，永不写死品牌色。

### Neutral
- **分离材质灰 · 一级**（`rgba(120,120,128,.12)`，light `.08`）：卡片、分段控件轨道、列表组、表格容器的底色。
- **分离材质灰 · 二级**（`rgba(120,120,128,.18)`，light `.14`）：输入框填充、按钮 hover、行 hover、骨架屏。
- **分隔线**（`rgba(120,120,128,.24)`，light `rgba(60,60,67,.18)`）：所有 hairline 分隔。
- **主文字 · 标签色**（`rgba(235,235,245,.92)`，light `rgba(30,30,32,.92)`）：正文与控件文字。
- **次级文字**（`rgba(235,235,245,.6)`，light `rgba(60,60,67,.6)`）：提示、说明、muted。
- **分段激活白**（`rgba(255,255,255,.14)`，light `.9`）：分段控件选中滑块。

### 浮层材质
- **警报材质**（`rgba(40,40,44,.85)`，light `rgba(252,252,252,.9)`）：对话框底，配 `blur(20px) saturate(180%)` 即 macOS alert 材质。
- **表头铬材质**（`rgba(30,30,32,.72)`，light `rgba(255,255,255,.72)`；浏览面板加深为 `.85`/`rgba(242,242,247,.9)`）：sticky 表头，配毛玻璃。

### Semantic
- **系统红**（`#ff453a`，light `#ff3b30`）：危险操作、错误信息、danger 按钮描边。
- **系统绿**（`#30d158`，light `#34c759`）：成功反馈。
- **系统黄**（`#ffd60a`，light `#ff9f0a`）：NULL chip 与警告。

### Named Rules
**宿主强调色规则。** accent 一律 `var(--dsh-accent, …)` 继承宿主并给回退值；任何新彩色组件先问"iOS 会用哪个系统色"，而不是发明新色。

## Typography

**Display/Body Font:** -apple-system → BlinkMacSystemFont → 'SF Pro Text' → 'Segoe UI' → system-ui（跟随宿主，不引入 webfont）
**Data/Mono Font:** ui-monospace → 'SF Mono' → Menlo → Consolas

**Character:** 系统字体栈保持宿主原生感；mono 只服务数据与代码，让列对齐成为主要的视觉秩序来源。

### Hierarchy
- **Strong**（600，13px）：字段名与小节标题（`strong` 元素）。
- **Body**（400，13px，line-height 1.45）：面板正文与控件文字。
- **Label**（500，12px）：分段控件未选中项、按钮次级文字。
- **Table/Mono**（400，12px）：表格数据、SQL、单元格值、对话框 `pre`。
- **Caption**（400，11px）：muted 提示与阅读提示（`.dbt-muted`）。
- **Micro**（400，10px）：对象树旋转箭头等装饰字形（`--dbt-caption-xs`）。

### Named Rules
**数据等宽规则。** 任何展示数据库值的文字一律 mono；界面文案一律系统栈。两类文字不混排同一行。

## Layout

单列纵向流，`display:flex; flex-direction:column` 贯穿全部层级。面板根 16px 内边距、10px 纵向 gap；卡片内部 12px padding、8px gap；紧凑变体（`.dbt-col-tight`）2px gap。没有网格系统——表单行是 `flex-wrap` 的 8px gap 行（`.dbt-row`）。

数据浏览面板为纵向三分区：对象树（上，max-height 280px 可滚动）→ 主区（下，flex:1）内再分浏览 tabs → 表格（flex:1 撑满，min-height 120px）→ 详情底栏（flex:none 钉底）。侧边栏面板高度即视口，容器内部滚动，不做页面级滚动。

间距阶：16（面板）/ 12（卡）/ 10（行内边距与分区 gap）/ 8（控件 gap）/ 2（紧凑与分段控件内 gap）。无自定义断点——侧边栏宽度由宿主决定，所有行均可换行（flex-wrap）兜底。

## Elevation & Depth

静止平面、铬层材质的混合体系。内容表面（卡片、列表组、表格容器）在静止状态是纯色分离材质，无阴影无边框；深度只通过材质透明度（一级/二级灰）与 hairline 表达。毛玻璃与投影保留给浮在内容之上的"铬层"：sticky 表头（`blur(20px) saturate(180%)`）、对话框（同款毛玻璃 + 浮层阴影）、遮罩层（`rgba(0,0,0,.4)` + `blur(8px)`）。透明度减弱时三类铬层整体换实色：对话框与单元格详情底 `#2c2c2e`/`#f2f2f7`（暗/light），sticky 表头 `#1e1e20`/`#f2f2f7`，遮罩加深为 `rgba(0,0,0,.55)` 并置空 blur。

### Shadow Vocabulary
- **浮层阴影**（`0 8px 32px rgba(0,0,0,.28)`，light `.12`）：对话框专用，随 `--dbt-shadow`。
- **激活微影**（`0 1px 3px rgba(0,0,0,.12)`）：分段控件选中滑块，制造"抬起一格"的实体感。

### Named Rules
**铬层材质规则。** 毛玻璃与投影只允许出现在 sticky 表头、对话框、遮罩三类铬层元素上；内容表面静止时保持平面，hover 加深一档（一级灰 → 二级灰）即是全部状态反馈。

## Shapes

三阶圆角：容器 12px（卡片、列表组、表格容器）、控件 8px（按钮、输入、分段轨道、底栏）、滑块与小代码块 6px（分段滑块、`pre`）；唯一的整圆是 NULL chip 的 999px 胶囊。边框语言是"无边框"：控件一律 `border:none`，分区靠底色与 hairline（1px separator，横向行分隔 + 浏览面板的纵向列分隔）。描边只有两处例外：danger 按钮的 1px 红描边（透明底、hover 补 12% 红底），NULL chip 的 1px 黄描边。

focus 统一为 `outline: 2px solid accent; outline-offset: -1px`（输入类）或 `-1px + 2px 圆角`（单元格按钮 focus-visible），不做发光。

## Components

### 分段控件（Tabs / Segmented）
- **形态**：容器一级灰底 8px 圆角、2px 内边距；滑块 6px 圆角，选中态激活白底 + 600 字重 + 激活微影；未选中 12px/500。
- **变体**：顶部 tab（flex:1 均分，`.dbt-tabs`）与行内 mini seg（flex:none，ro/rw 切换，`.dbt-seg`）。
- **动效**：全属性 .18s 标准缓动过渡。

### 按钮
- **形态**：8px 圆角、`5px 12px` padding、13px/500、无边框；active `scale(.97)`。
- **Secondary**（默认）：一级灰底，hover 升二级灰。
- **Primary**：accent 底白字，hover `brightness(1.1)`。
- **Danger**：透明底 1px 红描边红字，hover 补 `rgba(255,69,58,.12)` 底。
- **Disabled**：`opacity:.4`、无 transform。

### 输入 / 文本域
- **形态**：填充式无边框——二级灰底、8px 圆角、`5px 12px` padding、13px 继承字体；focus 为 accent 内缩描边。
- **代码域**：SQL/单元格值 textarea 换 mono，min-height 96px（72px 单元格详情），可纵向拉伸。

### 卡片 / 列表组（inset grouped）
- **形态**：一级灰底 12px 圆角，无 border 无阴影，12px padding。
- **列表组**（`.dbt-group`）：一卡多行，行间 hairline，行 `10px 12px` padding，hover 升二级灰，末行无线。
- **对象树**（`.dbt-treerow`）：同 listrow 语言，附 12px 旋转箭头（open 时 rotate 90°），选中行 accent 色 + 600 字重。

### 表格
- **形态**：12px 字号、行 hairline、`7px 10px` 单元格 padding、数据 mono；单元格 max-width 260px 省略。
- **表头**：sticky + 铬材质毛玻璃 + 600 字重；浏览面板加列间 hairline 与行 hover。
- **容器**：一级灰底 12px 圆角、内部滚动（常规 max-height 320px；浏览面板 flex 撑满）。

### 对话框（危险操作确认）
- **形态**：遮罩 `rgba(0,0,0,.4)` + blur(8px) 全屏居中；对话框体为警报材质毛玻璃、1px 分隔线描边、12px 圆角、浮层阴影、max-width 460px。
- **行为**：点击遮罩 = 取消；语句预览用 mono `pre`（6px 圆角、max-height 160px）；按钮行右对齐。

### 单元格详情底栏（签名组件）
- **形态**：实色分区底（暗 `#2c2c2e` / light `#f5f5f7`；透明度减弱时取降级实色 `#2c2c2e`/`#f2f2f7`）、12px 圆角、`margin-top:10px` 钉在表格之下，mono 输入域 + 操作行。
- **NULL chip**：黄描边黄字胶囊（999px、11px/600、`1px 8px` padding）。

### SQL 控制台编辑器（CodeMirror）与结果网格
- **编辑器**：第三方渲染区（CM6 bundle）挂 `dbt-cm-` 前缀外壳 class（`dbt-cm-root`/`dbt-cm-tabbar`/`dbt-cm-tab`/`dbt-editor-host`），CM6 默认 `cm-editor`/`cm-line` 类保留不动；bundle 内主题与 HighlightStyle 颜色一律 `var(--dbt-*, 字面回退)`，回退值对齐本 token 表——token 作用域覆盖不到的地方用回退兜底，不写裸色。多标签条复用分段控件语言：激活态 `seg-active` 底 + 600 字重 + 激活微影，路由徽标为二级灰底 caption chip。
- **结果网格**：完全复用表格语言——mono 数据、hairline 行分隔、sticky 毛玻璃表头（复用 `.dbt-table th` 不另设材质）；排序表头是无边框透明按钮（`.dbt-grid-sort`，继承文字色、focus accent 描边），三态轮换；分页条复用 BrowsePane footer 模式与 `dbt-browse-footer` 样式，50 行/页对齐 preview 上限。

### Named Rules
**原生但可触规则。** 静止平面，hover/active 才有反馈：hover 加深一档底色、active `scale(.97)`；无 transition 的状态变化视为缺陷。hover 反馈一律包进 `@media (hover:hover) and (pointer:fine)`，触屏 tap 不触发 hover 底色；过渡属性逐项列明，禁用 `transition:all`。浏览器面板入场用 `dbt-in`（4px 上移 + 淡入，.22s），仅 transform/opacity。

## Do's and Don'ts

### Do:
- **Do** 新样式全部走 `--dbt-*` token；新表面挂 `.dbt-panel` 或 `.dbt-browse-root` 以继承 token 作用域。
- **Do** 每个视觉决定过三重降级：`prefers-color-scheme`（明暗反转）、`prefers-reduced-transparency`（毛玻璃换实色 `#2c2c2e`/`#f2f2f7`）、`prefers-reduced-motion`（动效全关）。
- **Do** 数据与代码用 `--dbt-mono`，界面文案用继承字体。
- **Do** 分区用底色 + hairline（1px `--dbt-separator`）；focus 用 accent 内缩描边。

### Don't:
- **Don't** 写死品牌色或引入新彩色——accent 继承宿主，语义色用 iOS 系统色值。
- **Don't** 用 Material 式常驻阴影卡、渐变或网页感装饰；阴影只属于对话框与激活滑块。
- **Don't** 在内容表面用毛玻璃；材质只属于 sticky 表头、对话框、遮罩。
- **Don't** 绕过 token 写裸色值/裸圆角/裸时长；新增交互动效用 .18s/.22s + `--dbt-ease`，仅 transform/opacity。
- **Don't** 写裸 `:hover` 或 `transition:all`——hover 态包进 `@media (hover:hover) and (pointer:fine)`，过渡属性逐项列明。
