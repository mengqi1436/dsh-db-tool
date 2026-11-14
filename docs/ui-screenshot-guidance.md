# UI 改动前后对照截图规范

> 起因：[PR #17](https://github.com/mengqi1436/dsh-db-tool/pull/17)（「数据浏览」对象树默认收起）的第一版前后对照图整图发黑、文字不可见，与宿主实机显示不符。根因不在被改动的代码，而在取证环境：取证页自造的画布底色与浏览器配色方案错位。本文档记录完整机制与必须遵守的做法，后续任何 UI 取证截图在提交前按第 3 节清单逐项过一遍。

---

## 1. 机制：两层主题都挂在浏览器配色方案上

### 1.1 插件层：文字颜色由 `prefers-color-scheme` 媒体查询决定

插件样式不自带不透明底色（`--dbt-bg: transparent`），画布是宿主（或取证页）给的；文字、表面等颜色分深浅两套，由媒体查询切换（`client/client.js`）：

```js
// client/client.js:622 —— 默认变体（深色文字不在此层，深色为基底）
".dbt-panel,.dbt-browse-root{...--dbt-text:rgba(235,235,245,.92);...}"
// client/client.js:623 —— 浅色配色方案时整体覆盖为浅色变体
"@media (prefers-color-scheme: light){.dbt-panel,.dbt-browse-root{...--dbt-text:rgba(30,30,32,.92);...}}"
```

即：**给页面涂什么底色决定不了文字颜色，浏览器的配色方案才决定**。无头浏览器默认浅色配色方案，因此不显式设置时插件永远按浅色变体渲染——深色文字 `rgba(30,30,32,.92)`。

### 1.2 宿主层：画布 token 同样按配色方案切换

宿主主题 token（`@deepseek-ai/dsh-client-ui-theme`，同样挂在 `@media (prefers-color-scheme: dark)` 上）：

| token | 亮色解析值 | 暗色解析值 |
|---|---|---|
| `--dsw-alias-bg-base` | `#ffffff`（`--dsw-static-neutral-bluish-00`） | `#151517`（`--dsw-static-neutral-bluish-950`） |
| `--dsw-alias-label-primary` | `#0f1115`（`--dsw-static-neutral-bluish-1000`） | `#f9fafb`（`--dsw-static-neutral-bluish-50`） |

### 1.3 PR #17 的错位是怎么发生的

| 层 | 第一版（发黑） | 重摄后（正确） |
|---|---|---|
| 画布底色 | 自造 `#0d0d0f`「模拟宿主深色」 | 宿主真实 token 解析值（1.2 表） |
| 浏览器配色方案 | 默认浅色，未设置 | 显式设置，与画布同侧 |
| 插件文字 | 媒体查询命中 light → 浅色变体的深字 | 随配色方案切换，与画布同侧 |

深底 + 深字 → 文字像素与底色对比度为 0 → 整图只剩深色块，观感「发黑」。在深色外观的查看器里翻图时第一眼甚至不易察觉异常，所以不能只靠肉眼，必须做机器校验（2.4 节）。

---

## 2. 正确做法

### 2.1 画布与文字一律用宿主真实主题值

取证页底色取 `--dsw-alias-bg-base` 的解析值、文字取 `--dsw-alias-label-primary` 的解析值；不自造「看起来像宿主」的底色。宿主亮暗各只有一对值（1.2 表），取证页照抄即可。

### 2.2 浏览器配色方案必须显式设置，且与画布同侧

无头浏览器默认浅色；拍暗色主题必须显式改方案，拍亮色也应显式声明、不依赖默认值：

```js
// Playwright：上下文级
const ctx = await browser.newContext({ colorScheme: "dark" });
// Playwright：页面级
await page.emulateMedia({ colorScheme: "dark" });
// CDP 等价写法
// Emulation.setEmulatedMedia { features: [{ name: "prefers-color-scheme", value: "dark" }] }
```

亮、暗各拍一组；每组内部「画布底色、文字、浏览器配色方案」三者同侧。

### 2.3 对照必须同条件、跑真实产物

- Before / After 用同一场景、同一 viewport、同一主题、同一缩放。PR #17 的基准：viewport 500×774、@2x 采集、场景「打开数据浏览页签、未选表」。
- 两版都跑真实产物：按各自提交真实构建 `dist/`（真实插件 API，含授权/审计链路），分别加载改动前（`<commit>^`）与改动后（`<commit>`）两版真实 `client.js`，连真实示例库（PR #17 用 12 表 sqlite），React 走真实渲染路径。mock 页面拼出来的「旧实现」不算 Before。
- 图片归档按 `assets/<变更主题>/{light,dark}/…` 分主题存放，命名写清场景与默认态。

### 2.4 推送前机器校验，不许只靠肉眼

- **像素校验**：统计每张图中与底色对比超过阈值的文字像素占比，为 0 即文字不可见，直接判废重拍。PR #17 发黑的旧暗图高亮文字像素为 0；重摄后各图为 0.38%–0.76%。
- **链路校验**：推送后按 raw URL 拉回比对 md5 与本地一致，确认审阅者看到的就是本地这张图。
- **作废旧图必须删除**：从 `assets/` 删掉、PR 描述移除引用，不要与新图并存误导审阅者。

---

## 3. 提交前检查清单

| # | 检查项 | 判废条件 |
|---|---|---|
| 1 | 画布底色 = `--dsw-alias-bg-base` 当前主题解析值 | 自造底色 |
| 2 | 浏览器配色方案已显式设置且与画布同侧 | 依赖默认浅色拍暗色 |
| 3 | 亮、暗两套主题各有一组对照 | 只拍一套 |
| 4 | Before / After 场景、viewport、主题、缩放一致 | 只有 After，或条件不齐 |
| 5 | 文字像素占比 > 0（每组每图） | 任一图为 0 |
| 6 | raw URL 可访问且 md5 与本地一致 | 拉回不一致 |
| 7 | 作废旧图已删除、PR 描述无残留引用 | 新旧图并存 |
