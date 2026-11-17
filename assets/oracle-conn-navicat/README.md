# Oracle 新建连接（服务名/SID + OCI 库路径）：改动前后对照取证

- 场景：连接管理 → 新建连接 → 数据库类型选 oracle、分字段模式，填 主机 `db.corp.example`、端口 `1521`、标识 `XE`（after 走「SID」类型）；after 第二图展开「高级选项」并填 OCI 库路径 `/opt/oracle/instantclient_19_19`
- viewport 560×774，@2x 采集（成图 1120×1548），亮/暗各一组；浏览器 colorScheme 由 Playwright 上下文显式设为同侧，画布底色用宿主主题 token 解析值（亮 `#ffffff` / 暗 `#151517`），文字取 `--dsw-alias-label-primary` 同侧值
- Before = `2d10971`（1.9.13，通用「数据库名」第三格、无高级选项入口），After = 本分支（「服务名 / SID」下拉 + 随动占位 + OCI 库路径高级折叠区）；两版均为各自提交干净构建 `dist/` + 各自真实 `client.js` + 真实插件 HTTP API，React 18 走真实渲染路径（取证挂载器沿用 PR #29 的 conn-card-shots 结构）
- DOM 机器校验（dom-checks.json）：before 无服务名/SID 下拉（`hasSvcTypeSelect=false`）、无「高级选项」入口、无 OCI 输入；after 下拉存在且含 `service`/`sid` 两项、切 sid 后占位变「SID」、高级入口存在、展开后 OCI 输入值 `/opt/oracle/instantclient_19_19`、页面出现 NJS-138 行动指引文案
- 像素机器校验：六图与底色亮度差 > 60 的文字像素占比 1.88%–3.49%（> 0 判有效），四角底色核对 暗 `#151517` / 亮 `#ffffff`
- 取证脚手架（不随 npm 包发布）：`/home/home/oracle-shots/`（harness-server.mjs + capture.mjs + pixel-check.mjs）
