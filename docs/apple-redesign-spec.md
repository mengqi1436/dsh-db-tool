# dsh-db-tool 侧边栏 Apple 风格重设计规范（单一真相）

所有参与者必须遵守本规范。目标：贴合 Apple 官方视觉语言（macOS/iOS 系统 UI、HIG），在 DSH 侧边栏窄容器（约 380-420px）内呈现。

## 硬性约束（所有 teammate）
- **只改自己分配的行区段**，区段外一律不动（edit 基于 old_string 精确匹配）。
- **i18n key 冻结**（client/client.js L18-264）：不得新增/删除/改名 key；如确需新文案，在汇报中列出由 Lead 决定。
- **不新增任何 npm 依赖**（单文件 bundle 无构建步骤）。图标只用极简内联 SVG 几何图形（chevron/加号/三角等 primitives）或纯排版。
- 保持 `React.createElement` 形态、保持组件对外 props/签名不变、保持 `dbt-` 类名前缀。
- 保留对宿主变量的 fallback：`var(--dsh-accent, <apple值>)` 形式可保留，但视觉基线以本规范的 Apple token 为准。
- 尊重 `prefers-color-scheme`（light/dark 双模式）与 `prefers-reduced-motion`。
- 完成后 `node --check client/client.js` 必须通过。

## 1. Design Tokens（CSS 变量，定义在 .dbt-panel 根）

字体：
- UI 字体：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`
- 等宽（SQL/数据）：`ui-monospace, "SF Mono", Menlo, Consolas, monospace`
- 字号阶梯：caption 11px / 正文 13px / 小标题 13px semibold / 标题 15px semibold。行高 1.45。

颜色（dark 模式为基线，light 模式对应反转）：
| token | dark | light |
|---|---|---|
| --dbt-accent | #0A84FF（系统蓝） | #007AFF |
| --dbt-bg | 透明（继承宿主） | 同 |
| --dbt-surface | rgba(120,120,128,.12) | rgba(120,120,128,.08) |
| --dbt-surface-strong | rgba(120,120,128,.18) | rgba(120,120,128,.14) |
| --dbt-separator | rgba(120,120,128,.24) | rgba(60,60,67,.18) |
| --dbt-text-secondary | rgba(235,235,245,.6) | rgba(60,60,67,.6) |
| --dbt-danger | #FF453A | #FF3B30 |
| --dbt-success | #30D158 | #34C759 |
| --dbt-warning | #FFD60A | #FF9F0A |

材质（Apple 毛玻璃近似，非官方 Liquid Glass）：
- 对话框/粘性表头可用 `backdrop-filter: blur(20px) saturate(180%)` + 半透明背景；提供 `@media (prefers-reduced-transparency: reduce)` 下降级为实色。
- 阴影一律带色调（不用纯黑）：`0 8px 32px rgba(0,0,0,.28)`（dark）。

圆角系统（Shape Consistency Lock）：
- 卡片/对话框 12px；按钮/输入/segmented 容器 8px；小 pill 6px。全站只用这三档。

间距：8pt 网格。面板 padding 16px；卡片内 12px；元素间 gap 8px（紧凑 4px）。

动效：`transition: all .18s cubic-bezier(0.25, 0.1, 0.25, 1)`；仅 transform/opacity；`:active` 时 `transform: scale(.97)`；MOTION 强度低（侧边栏工具，动效仅为反馈）。

## 2. 组件契约（类名 → Apple 形态）

类名全部保留，视觉重定义：

- `.dbt-panel`：根容器。font 13px，padding 16px，gap 12px，flex column，overflow-y auto。
- `.dbt-tabs`：**iOS segmented control**。容器 `background: var(--dbt-surface); border-radius: 8px; padding: 2px; gap: 2px; display: flex;` 内 button `flex: 1; border: none; background: transparent; border-radius: 6px; padding: 5px 8px; font-size: 12px;` active：`background: rgba(255,255,255,.14)`（light 模式 rgba(255,255,255,.9)+细阴影）+ `font-weight: 600`，不用蓝色填充。
- `.dbt-card`：**inset grouped 卡片**。`background: var(--dbt-surface); border: none; border-radius: 12px; padding: 12px; gap: 10px;`
- `.dbt-row`：flex row，gap 8px，wrap。
- 输入（`.dbt-row input/select/textarea`、`.dbt-card` 同类）：**填充式无边框**。`background: var(--dbt-surface-strong); border: none; border-radius: 8px; padding: 6px 10px; font-size: 13px;` focus：`outline: 2px solid var(--dbt-accent); outline-offset: -1px;`（或 box-shadow ring）。
- `.dbt-btn`：普通= `background: var(--dbt-surface); border: none; border-radius: 8px; padding: 5px 12px; font-size: 13px; font-weight: 500;` hover 提亮（surface-strong）；active scale(.97)。
- `.dbt-btn.primary`：`background: var(--dbt-accent); color: #fff; border: none;` 无渐变无发光。
- `.dbt-btn.danger`：`color: var(--dbt-danger); background: transparent; border: 1px solid var(--dbt-danger);`（或 `background: rgba(255,69,58,.12); border: none`，二选一全站统一）。
- `.dbt-btn:disabled`：opacity .4。
- `.dbt-muted`：`color: var(--dbt-text-secondary); font-size: 11px;`
- `.dbt-err`：`color: var(--dbt-danger); font-size: 12px;`（白底黑字对比达标）。
- `.dbt-msg`：`color: var(--dbt-success); font-size: 12px;`
- `.dbt-table`：**去全边框，行 hairline 式**。`th, td: border: none; border-bottom: 1px solid var(--dbt-separator); padding: 6px 8px; font-size: 12px;` th `position: sticky; top: 0; backdrop-filter: blur(20px); background: <半透明宿主底色>; font-weight: 600; font-size: 11px; text-transform: uppercase 可选（不强制）`。td 数字/数据列用等宽字体。
- `.dbt-tablewrap`：`border: none; border-radius: 12px; overflow: auto; max-height: 320px; background: var(--dbt-surface);`
- `.dbt-overlay`：`background: rgba(0,0,0,.4); backdrop-filter: blur(8px);`
- `.dbt-dialog`：**macOS alert 风格**。`background: rgba(40,40,44,.85)（light: rgba(252,252,252,.9)）; backdrop-filter: blur(20px) saturate(180%); border: 1px solid var(--dbt-separator); border-radius: 14px; padding: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.28);` 标题 13px semibold 居中可选；按钮区 `.dbt-row` 改为右对齐。
- `.dbt-grant`：列表行式。`padding: 8px 0; border-bottom: 1px solid var(--dbt-separator);`（去 dashed，实 hairline）。
- `.dbt-seg`：与 `.dbt-tabs` 同构的 mini segmented（ro/rw/未授权切换）。

## 3. 各面板布局指引（结构重排方向）

- **ManageView**：连接列表改为列表行卡（每连接一张 inset card：kind 徽标（小 pill 6px、surface 底）、名称 13px semibold、safeUrl 等宽 11px muted、右侧「编辑/删除」为图标化次要按钮）；「新建连接」为 accent 主按钮置顶右侧；表单字段分组；审计表保持 resultTable。
- **GrantsView**：每连接一行（列表行式），ro/rw/未授权用 `.dbt-seg` mini segmented；说明文字 muted。
- **BrowseView**：库/表选择器用填充式 select；结构/预览切换可用 mini segmented；表格遵循新 table 契约。
- **ConsoleView**：SQL 输入区用等宽字体 + 填充式输入（min-height 加大、focus ring）；执行按钮 accent 主按钮；结果表新契约；challenge 流程与 DangerDialog 样式统一。
- DangerDialog：标题不再用 emoji ⚠️，改为纯文字 + danger 色 accent（左侧 3px 色条或标题色）。

## 4. 验收
- `node --check client/client.js` 通过；
- 全站只有一个 accent（系统蓝）、一套圆角、一套材质；
- dark/light 均可读（WCAG AA）；
- 无 emoji 图标、无渐变、无发光、无多余装饰 pill。
