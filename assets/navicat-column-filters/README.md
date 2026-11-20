# 数据预览字段筛选（Navicat「Filter & Sort」对齐）：改动前后对照取证

- 场景：数据浏览页签 → 展开对象树 → main 库 → orders 表（123 行，3 页）→ 数据预览分段；
  场景 1 = 第 1 页默认态（Before/After 同态）；场景 2 = 筛选窗格编辑态（仅 After：点「筛选」展开
  Navicat 构建器布局窗格——工具条「＋ 添加条件 / 应用筛选 / 清除筛选」+ 条件行「复选框 / 字段 /
  操作符 / 值」→ buyer 字段「包含 ali」）；场景 3 = 筛选生效态（仅 After：应用筛选 → 「匹配 15 行」+
  第 1/1 页 + buyer 列头漏斗高亮）。Before 为改动前基线，无筛选能力，故只有场景 1。
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 colorScheme 由 Playwright 上下文
  显式设为同侧（`colorScheme: 'light' | 'dark'`），画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）
- Before = `aead207`（当前分支基线，改动前）：分页条有搜索框、无筛选入口，列头无漏斗
- After = 本分支工作区：分页条新增「筛选」按钮（展开条件窗格：字段下拉 + 操作符下拉 +
  值输入 + 且（AND）/或（OR）+ 添加条件 + 应用/清除），列头每列新增漏斗（▽，已生效列高亮）；
  应用后分页与计数切到筛选匹配口径（orders.buyer 包含 'ali' 恰 15 行）
- 两版均为各自提交/工作区真实构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API
  （授权/审计链路全真实：临时 home 建 sqlite1 连接 + ro 授权），React 走真实渲染路径（react@18 UMD），
  数据源为真实 sqlite 示例库（node:sqlite，12 表 + 1 视图，orders 123 行）
- DOM 机器校验（domcheck.txt）：After scene1 分页条含「筛选」、列头漏斗 ×6、无窗格；展开后窗格
  三段（头/条件行/动作行）含全部 20 个操作符与 6 个字段；应用后「匹配 15 行」+「/ 1 页」+
  `.dbt-colfilter.active` 高亮 1 个，真实 preview 请求携带
  `filters=[{"column":"buyer","op":"contains","value":"ali"}]&logic=and&total=1`；
  Before scene1 无「筛选」按钮、无漏斗（colfilter=0）
- 像素机器校验（pixel-checks.json）：8 图与底色亮度差 > 60 的文字像素占比 1.70%–3.50%（> 0 判有效，
  发黑旧图该值为 0）
