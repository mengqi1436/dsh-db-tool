# 「字段搜索」改为「筛选」：改动前后对照取证

- 场景：数据浏览页签 → 展开对象树 → main 库 → orders 表（123 行，3 页）→ 数据预览分段；
  场景 1 = 第 1 页默认态（Before 分页条有「搜索字段内容」跨列搜索框；After 移除，仅保留「筛选」
  按钮 + 列头漏斗）；场景 2 = 筛选窗格编辑态（点「筛选」→ buyer「包含 ali」）；场景 3 = 筛选生效态
  （应用筛选 → 「匹配 15 行」+ 第 1/1 页）。两版的筛选窗格/生效态行为等价——本变更只移除跨列搜索框、
  把内容查找收敛到逐字段筛选。
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 colorScheme 由 Playwright 上下文
  显式设为同侧，画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）
- Before = `a516c08`（master 1.9.25，含字段筛选构建器与跨列搜索框）
- After = 本分支工作区（跨列搜索框移除，内容查找统一走列头漏斗/筛选窗格）
- 两版均为各自提交真实构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API（临时 home 建
  sqlite1 连接 + ro 授权），React 走真实渲染路径（react@18 UMD），数据源为真实 sqlite 示例库
  （node:sqlite，orders 123 行，buyer 含 alice 恰 15 行）
- DOM 机器校验（domcheck.txt）：Before scene1 `searchBox=1`；After scene1 `searchBox=0`、
  `filterBtn=1`、`colfilter=6`；两版应用筛选后均为「匹配 15 行」+「/ 1 页」
- 像素机器校验（pixel-checks.json）：12 图与底色亮度差 > 60 的文字像素占比 1.83%–3.48%（> 0 判有效）
