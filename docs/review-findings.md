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
| **security** | guard classifySql（变异测试增补发现） | ① body 正则作用于未剥注释原文 → 注释内写词误报 danger；② SQL_DDL/DML/MAINT 锚定原文 → 前导块注释 `/* x */ DROP` 使 DDL 漏判、execute 通道仅 warning **绕过确认** | ✅ 提取 stripSqlComments，语句体分析与 DDL/DML 锚定一律基于剥注释文本（误报与绕过同修） |

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

## 第二轮：全库审查+优化（5 teammate 按模块并行）

35 项修复 + 13 项报告保留，全量 277 passed / 18 skipped，tsc 0。

### 已修复（按模块）

| 模块 | 修复 |
|---|---|
| lib 核心（guard-tool） | ① runScript 脚本内 dbQuery 句柄补传顶层 challengeId（原仅 dbExecute 传，行为不一致）；② runner.ts IPC `msg:any` → unknown+结构类型，msg.args 加 Array.isArray 守卫；③ lib/index.ts 重复 import 合并；④ TOOL_DESCRIPTION run_script 描述与子进程实现同步；⑤ **[high] Mongo execute 通道未识别 op fail-open（none）→ warning（fail-closed，与 SQL/Redis 对齐）**；⑥ MONGO_WRITE_OPS 补命令文档形式 delete/deleteMany/update/create，`{drop:...}` 归 danger（等同 dropCollection，MONGO_DANGEROUS_EXTRA）；⑦ **fork env 白名单 minimalEnv()（11 项），宿主敏感环境变量不再透传脚本子进程**；+5 测试用例（tests/tool/runner-env.spec.ts 新建） |
| store（store-adapters-core） | ① **[high] writeJsonAtomic 临时文件以目标 fileMode 创建**（原 0644 出生，rename 前窗口期明文机密宽权限暴露）；② DSH_HOME 空串产出相对路径 → `?? (…\|\|…)`；③ 删死类型 AdapterRegistry；④ driverMissingError cause 空时文案去多余冒号；⑤ io.spec 补 .bak 现场保留断言 |
| SQL 适配器（sql-adapters） | ① **mysql-offline 假绿断言实锤**：`.catch()` 吞外层断言失败且 label 拼错（「列出数据库」vs 实际「列出表」），旧白名单回归完全逃逸测试 → 改先捕获再双断言；② mysql URL decodeURIComponent 非法编码裸 URIError → 人类可读提示；③ gaussdb 驱动加载失败附原始错误（区分未构建 vs 产物损坏）；④ gaussdb 条件用例 if-return 假 pass → it.skipIf；⑤ MysqlTx/测试 inline 类型统一复用共享 TxHandle |
| NoSQL/企业适配器（nosql-ent-adapters） | ① oracle resolveOracleConn url/fields 两分支 user 空串校验；② oracle/dmdb testConnect 在 v$version/V$VERSION 不可读（ORA-00942 受限环境）时兜底 `SELECT 1 FROM dual` 判活，不再误报连接失败；③ oracle 声明 TDZ 隐式依赖消除（上移到使用点前）；④ dmdb DmPoolLike 删未使用的 execute 成员（与「Pool 无 execute」注释矛盾）；⑤ redis buildUrl user 加 encodeURIComponent 且空串跳过（含 @/: 用户名坏 URL）；⑥ redis OBJECT/MEMORY 缺 key 参数拦截；⑦ mongodb insertOne 删 cmd.insert 误导性别名；+4 测试用例 |
| client/skill/docs（client-skill） | ① openTable 竞态：openSeq 序号守卫，旧翻页/切表响应晚到不再覆盖新数据；② auditTable 先截断 80 字符致 title 也是截断版 → 全文进 td+ellipsis，title 显示全文；③ CSS .dbt-tree* 双份定义去重、mono 字体 3 处硬编码统一 var(--dbt-mono)；④ i18n ok 文案「确定」→「操作完成」（语义修正，key 冻结）；⑤ SKILL.md run_script 段按子进程+permission model 重写、challengeId 示例改真实格式 c_[0-9a-f]{24}、补 {text,isError} 返回契约说明 |

### 报告保留（附理由）

| 级别 | 项 | 理由 |
|---|---|---|
| medium | pg/gaussdb ro query 无应用层写白名单（仅服务器级只读会话） | CTE（WITH...INSERT）使首词白名单在 PG 语义下不可行；服务层 guard query 通道已拦写语句（SQL_WRITE_BODY_RE 覆盖 CTE 写），双防线已足够 |
| medium | mysql ro 会话 SET 失败静默 catch | mysql2 无 release(err) 语义；destroy 有重连风暴风险，权衡后保留 |
| medium | connections update url↔fields 互切残留旧机密 | 与客户端「留空=保留旧密码」语义自洽，url 优先约定由适配器工厂执行；将来可文档固化 |
| medium | connections create 两阶段写无回滚（孤儿 secrets） | 失败开放方向正确（残留机密好过残留授权）；将来可加启动期清扫 |
| low | guard 字符串字面量内写词误报（SELECT 'delete me'） | 方向安全（误报优于漏报），精确化需字符串感知剥离，成本大于收益 |
| low | ro 连接 query+challenge 确认后由适配器只读兜底拒绝 | 语义无洞（ro 写不可能成功），仅体验 |
| low | /api/grants PUT 不校验 connId 存在性 | 授权到不存在连接无实害 |
| low | oracle/dmdb toExecResult 双份同构实现 | 合并需跨模块共享工具层，架构决策，收益低 |
| low | mongodb aggregate/distinct truncated 用 rows.length>=500 近似 | 恰 500 行误标，精确判定需额外查询，代价大于收益 |
| low | dm 免密（trust 登录）场景 user 空串未强制校验 | 保留免密可能性，不武断加校验 |
| low | 事务悬挂时适配器 close 挂起 | 服务层 tx 已 finally rollback 覆盖正常路径；跨适配器行为变更留待需要时 |
| low | ManageView testConn/loadAudit 无 busy 保护 | 幂等读，testInfo 按 id 分 key 不互踩 |
| low | 翻页按钮 disabled 在 truncated undefined 时可点 | 可能翻到空页，无数据损害；后端已恒返回 truncated 后可收紧 |

> 注：文档早前「DANGEROUS_OPS 8 项」实为 11 项（createIndexes/dropIndexes/renameCollection），以代码为准。
