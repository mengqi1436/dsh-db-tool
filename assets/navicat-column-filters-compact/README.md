# 筛选窗格紧凑化（对齐 Navicat 构建器密度）：改动前后对照取证

- 场景：数据浏览页签 → 展开对象树 → main 库 → orders 表（123 行）→ 数据预览分段；
  场景 1 = 第 1 页默认态（窗格收起，两版一致）；场景 2 = 窗格展开 3 条件行
  （buyer 包含 ali / qty >= 5 / note 包含 urgent）；场景 3 = 应用筛选生效态。
  本变更只改窗格密度与排布，筛选功能两版等价（场景 3 两版都走真实筛选请求并出「匹配 N 行」）。
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；colorScheme 显式同侧，
  画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）
- Before = `dc5f1e9`（master 1.9.26）：条件行控件换行堆叠（实测行高 58px），窗格展开 238px，
  数据表格被推到 y=720——774px 视口里几乎完全被挤出去（用户反馈「挡住实际所需内容」的量化呈现）
- After = 本分支工作区：条件行单行不换行（行高 28px），字段/操作符下拉定宽 140px、值输入占满剩余、
  行间 AND-OR 80px、多行各列对齐（Navicat 构建器同款排布）；条件行区限高 200px 内部滚动，
  窗格总高 138px，表格回到可视区（y=620）
- DOM 量化（dom3-before.log / dom3-after.log，Playwright boundingBox 实测）：
  `[before] rows=3 rowHeight=58 paneHeight=238 tableTop=720`；
  `[after] rows=3 rowHeight=28 paneHeight=138 tableTop=620`
- 两版均为各自提交真实构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API（临时 home 建
  sqlite1 连接 + ro 授权），React 真实渲染，数据源为真实 sqlite 示例库
- 像素机器校验（pixel-checks.json）：12 图与底色亮度差 > 60 的文字像素占比 1.41%–3.58%（> 0 判有效）


## 增补（应用后自动收起 + 数据区不透明化）

- 反馈「窗口展开后仍有透明弹窗遮挡数据」的两项根治：
  1. **应用筛选后窗格自动收起**：点「应用筛选」/值输入回车 → 窗格立即收起、草稿清空，数据区回到最大可视；生效条件数在「筛选 · N」按钮与列头漏斗高亮上体现，再点「筛选」自动带回已提交条件；
  2. **数据区与窗格不透明化**：数据表格区与筛选窗格底色改用宿主画布 token（`--dsw-alias-bg-base`，缺省随主题实色 `#151517` / `#ffffff`），任何底下的内容都不会透出。
- DOM 量化（probe-collapse-out.txt，Playwright boundingBox 实测，应用筛选后）：
  `[before] paneAfterApply=1 tableTop=556`（PR #56 首版：窗格仍开，数据区偏小）；
  `[after] paneAfterApply=0 tableTop=474`（本版：窗格收起，数据区再扩 82px 且不透明）。
- 场景 1/2 与首版一致；场景 3（筛选生效态）为本增补的核心对照：Before 窗格仍展开、After 已收起。
- 本组 Before = `d143644`（紧凑化首版）、After = 增补提交；其余取证口径同上。
