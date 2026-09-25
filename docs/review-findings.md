# 代码审查发现与处置记录

三路并行审查（lib 核心 / 8 适配器 / client+tests+scripts），共 38 条 findings，全部处置完毕。
处置分类：✅已修复 / 🧪已补测试 / ⏸有意保留（附理由）。

## 一、lib 核心（store / guard / manager / http / index）

| 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|
| critical | lib/manager.ts（原 vm 沙箱 run_script） | `console.log.constructor('return process')()` 逃逸 vm | ✅ runScript 改子进程隔离：lib/script/worker.cjs（vm.runInNewContext + Node permission model）+ lib/script/runner.ts（fork、SIGKILL 强超时 60s） |
| high | lib/manager.ts challenge | challenge 未绑定 connId/projectKey，可跨连接重放 | ✅ ChallengeScope{connId,projectKey}，create/consume 双向校验 |
| high | lib/store/connections.ts redactUrl | 正则 `[^/]*@` 密码含 `/` 时明文入库 | ✅ 重写为 authority 段 lastIndexOf('@')/lastIndexOf(':) 解析 |
| high | lib/manager.ts adapterCache | 缓存键不含 mode，ro→rw 升级后仍用旧连接 | ✅ 缓存键 `connId@mode=...`；grant/revoke/update/remove 均 dropAdapters |
| high | lib/guard MONGO_WRITE_OPS | 缺 deleteMany/findAndModify/mapReduce 等 | ✅ 补齐 + READ_OPS 改为 import 适配器导出白名单（单一事实来源） |
| high | lib/guard query 通道 | Redis/Mongo 写命令经 query 仅 warning 放行 | ✅ classifyRedis/classifyMongo 接收通道参数，query 命中写/未识别命令一律 danger（fail-closed） |
| high | lib/guard 语句分析 | `WITH ... DELETE` / `EXPLAIN DELETE` 免确认 | ✅ SQL_WRITE_BODY_RE 读头命中后补扫语句体；HIDDEN_DANGER_RE 改 `[\s\S]*` |
| medium | guard FOR UPDATE | 多行语句漏检 | ✅ 同上（全语句扫描） |
| medium | manager updateConnection | 更新后不清适配器缓存 | ✅ void this.dropAdapters(id) |
| medium | manager runScript 超时 | 超时后后台写继续执行 | ✅ 子进程 SIGKILL + 关会话适配器 |
| medium | manager runScript | 单 challenge 可确认多条语句 | ✅ 子进程化后每次 db.execute 独立走 guard（逐条 challenge） |
| medium | manager 审计时序 | 审计在执行前记 ok:true | ✅ 审计后置，成功/失败如实记录 |
| medium | store remove 级联 | 非原子，中途失败留脏数据 | ✅ 失败开放顺序 grants→secrets→connections |
| medium | manager params | 参数未校验类型 | ✅ 非数组抛 INVALID_ARGUMENT |
| medium | http parseSsl | `ssl="false"` 被 Boolean() 转为 true | ✅ 严格布尔解析，非法值 400 |
| medium | store normalize | 仅小写盘符不处理其他大小写语义 | ⏸ 保留：NTFS 大小写不敏感语义即此；已补 `..` 穿越用例 🧪 |
| medium | store audit tail | 全量读文件再截取 | ⏸ 保留：审计文件预期规模小（JSONL 追加），优化属 YAGNI |

## 二、8 适配器

| 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|
| high | mysql ro query | 无语句校验、无会话只读 | ✅ SET SESSION TRANSACTION READ ONLY + query 首词白名单 |
| high | mongodb aggregate | 未拒 $out/$merge（可写副作用） | ✅ 双清单递归：JS_INJECTION_KEYS + WRITE_STAGE_KEYS（含 $unionWith） |
| high | mongodb assertNoWhere | 缺 $function/$accumulator | ✅ 递归拦截 |
| medium | mongodb DANGEROUS_OPS | 缺复数/别名操作 | ✅ 8→11（createIndexes/dropIndexes/renameCollection） |
| medium | redis DANGEROUS_COMMANDS | 缺 ACL dangerous 类 | ✅ 13→19（SLAVEOF/SORT_RO/MODULE/FUNCTION/SCRIPT/RESET） |
| medium | pg-like ro SET | SET 失败静默 | ✅ fail-closed release(err) |
| medium | mysql defaultDb | URL pathname 未校验 | ✅ 过 assertIdent |
| medium | redis SCAN | 不透传 MATCH/COUNT | ✅ 透传（clamp 200） |
| medium | redis HGETALL 等 | 无截断 | ✅ 500 行 + truncated 标注 |
| medium | oracle/dmdb query | autoCommit:false 事务悬挂 | ✅ execOpts 默认 autoCommit:true，tx 内显式 false 覆盖 |

## 三、client / tests / scripts

| 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|
| high | client.js 分页 | 无 offset 翻页无效 | ✅ 后端补 previewRows 第 4 参 offset 全链路（types/manager/http/tool/schema + 8 适配器），client 带 offset |
| medium | client.js ConsoleView | database 输入框无效 | ✅ 移除 |
| medium | client.js BrowseView | useEffect 竞态 | ✅ cancelled 标志 |
| medium | gaussdb.test vendorReady | 探测路径错（旧布局） | ✅ 改 vendor/gaussdb-pg/packages/pg/package.json；顺带发现并修复 lib/adapters/gaussdb/index.ts VENDOR_PATH 三级相对路径真 bug（`../../` 只到 lib/） |
| medium | build 脚本 skip 检查 | 旧布局路径导致每次重建 | ✅ sh/ps1 均改 packages/pg/package.json |
| medium | audit.spec | 断言缺字段 | ✅ 补 danger/confirmed/projectPathKey/rowsAffected |
| medium | normalize.spec | 缺 `..` 穿越用例 | ✅ 已补（win32+posix 双分支） |
| medium | api.spec | query 通道 challenge 三步无用例 | ✅ 已补（首次确认→成功→篡改重放拒→原句重放拒，符合防探测语义） |
| medium | mysql/postgresql.test | beforeAll 在 describe.skip 外 | ✅ 移入 suite() 回调 |

## 变异测试

- Stryker（vitest runner，范围 lib/guard + lib/manager + lib/store）：初版 vitest@5 与 Stryker 兼容性缺陷（phantom survivors，假分 2%）→ 降级 vitest@4 后正常。
- 基线 57.29%（654 killed / 367 survived / 122 no-cov），高价值存活项已定向补测试（dispose 生命周期、normalize/io 边界、redactUrl 变体、grants 边界、guard 注释剥离、manager 构造默认值）。
