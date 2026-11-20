# 数据预览分页快跳 + 内容搜索：改动前后对照取证

- 场景：数据浏览页签 → 展开对象树 → main 库 → orders 表（123 行，3 页）→ 数据预览分段；
  场景 1 = 第 1 页默认态；场景 2 = 末页态（After 点「末页」一键直达，Before 连点「下一页」两次到达同一状态）；
  场景 3 = 搜索生效态（仅 After：搜索 `alice` → 「匹配 15 行」+ 第 1/1 页）
- viewport 500×774，@2x 采集（成图 1000×1548），亮/暗各一组；浏览器 colorScheme 由 Playwright 上下文
  显式设为同侧（`colorScheme: 'light' | 'dark'`），画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`）
- Before = `d74a2c3`（1.9.21，改动前 HEAD）：分页条只有「上一页 / 第 N 页（每页 50 行）/ 下一页」，
  无总页数、无末页、无搜索
- After = 本分支工作区：分页条为「首页 / 上一页 / 第 [输入框] / 3 页 / 下一页 / 末页 / 共 123 行 / 搜索框」；
  末页一键直达第 3 页（Before 需逐页点击且第 3 次点击被 busy 守卫节流吞掉）；搜索框回车提交，
  分页与计数切到匹配口径（orders.buyer='alice' 恰 15 行）
- 两版均为各自提交/工作区真实构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API
  （授权/审计链路全真实：临时 home 建 sqlite1 连接 + ro 授权），React 走真实渲染路径（react@18 UMD），
  数据源为真实 sqlite 示例库（node:sqlite，12 表 + 1 视图，orders 123 行）
- DOM 机器校验（dom-checks.log，10 条断言全过）：After scene1 含「首页/末页/共 123 行」、有页码快跳输入
  （`.dbt-browse-jump`）与搜索框（`.dbt-browse-search`），Before 均无且保留旧文案；After scene2 页码 3/3；
  scene3 搜索态「匹配 15 行」+「/ 1 页」
- 像素机器校验（pixel-checks.json）：10 图与底色亮度差 > 60 的文字像素占比 1.52%–2.58%（> 0 判有效，
  发黑旧图该值为 0）
