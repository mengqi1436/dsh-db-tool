---
target: 全部 4 面板（client/client.js）
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:E:\\Code\\dsh\\dsh-db-tool\\client\\client.js"
target_fingerprint: "sha256:20adb7b0c158b7147552293f335dd618bbf6226f02ad11511d006c05e08508b1"
target_path: "E:\\Code\\dsh\\dsh-db-tool\\client\\client.js"
timestamp: 2026-10-02T16-58-44Z
slug: client-client-js
---
# Critique: 全部 4 面板（client/client.js）

Method: dual-agent (A: agent_a97bc3ee-d9db-4f5f-bbb6-26c585fcef16 · B: agent_cb7096da-7253-4096-adf2-192d280ff654)

## Design Health Score

| # | 启发式 | 分数/4 | 关键问题 |
|---|---|---|---|
| 1 | 系统状态可见性 | 3 | 异步结果无 aria-live 播报；执行中不可取消；剪贴板失败静默 |
| 2 | 贴合真实世界 | 3 | 写库动作无"重量"；kind 显示原始值 "dmdb" 而非"达梦" |
| 3 | 用户控制与自由 | 2 | 危险对话框无 Esc；tab 切换销毁 SQL 草稿与浏览状态 |
| 4 | 一致性与标准 | 2 | window.confirm 与自研 alert 材质双轨；tabs/树/seg 的 ARIA 角色缺失 |
| 5 | 错误预防 | 3 | 最强项：截断/BLOB 禁编辑、请求序号守卫；扣分：参数化语句盲确认 |
| 6 | 识别而非回忆 | 3 | 表单 placeholder 当 label；SQL 控制台不可见 ro/rw 授权态 |
| 7 | 灵活与效率 | 1 | 零键盘加速：无 Ctrl+Enter、无 Esc、树无方向键、无历史 |
| 8 | 美学与极简 | 4 | token 纪律严明真实落地，DESIGN.md 与代码几乎零偏差 |
| 9 | 错误恢复 | 3 | 就地错误 + 可重试；扣分：裸抛原始驱动异常 |
| 10 | 帮助与文档 | 2 | 内嵌提示质量高但无帮助入口（window.open 被 deny 是客观约束） |
| **Total** | | **26/40** | **Acceptable（距 Good 差 2 分，主要失分在键盘效率与一致性）** |

认知负荷：8 项清单 2 项失败——「最少选择」（SQL 控制台首屏 5 个决策点，且恰是风险最高一屏）与「工作记忆」（跨 tab 丢全部草稿与浏览状态）。中等负荷，需尽快处理。

## Design Specificity Verdict

**LLM 评估：中高专属性。** 数据浏览与安全链路是为这个产品量身定制的（单元格写回底栏 + 截断防覆盖门禁、NULL 黄胶囊、切库型自动填官方端口、确认框 5 分钟有效期提示——换任何工具都不成立）；但连接管理与表单层仍是"任何 DB 工具都成立"的 iOS 通用模板。最大错失：产品最锋利的性格「分级安全链路」在 UI 上没有签名时刻——当前项目、已授权连接、rw 状态分散在四个面板，用户全靠回忆拼图；危险确认对话框本应是"安全人格特写"，现在是全 UI 信息最贫瘠的一屏。

**确定性扫描：** 11 条 advisory（0 error/blocker）：design-system-color ×6、design-system-font-size ×4、design-system-radius ×1。逐条核实后 **7 条为误报**——根因是 DESIGN.md frontmatter 与正文割裂（正文已文档化的 Caption 11px、遮罩 .4、focus 2px 圆角、light 表头 rgba(242,242,247,.9)、celldetail #f5f5f7、降级 #f2f2f7 均未进 frontmatter），补全 frontmatter 可一次性消除。**真实命中 4 条低危漂移**：`.dbt-chev` 10px 孤立字号（382 行）、降级遮罩 rgba(0,0,0,.55) 未回写文档（418 行）、light 降级 dialog 用 #f5f5f7 与文档 #f2f2f7 不一致（419 行）、kind 徽标内联 fontSize 11px 绕过 token（872 行）。检测器视角：实现质量良好，问题在设计文档的 frontmatter 完整性而非实现本身。

**浏览器可视化：** 合法 fallback——目标无 dev server、无静态页面，面板由 DSH 宿主注入渲染，临时 HTML 副本缺宿主环境必然执行失败，未注入页面内 overlay。

## Overall Impression

这是一套工程纪律罕见地好的插件 UI：三重降级、请求守卫、防覆盖门禁都做进了代码本能。最大的机会不在视觉——视觉已经到位——而在把产品最硬的承诺（分级安全）从服务端机制翻译成可见的界面语言。失分集中在两处：高危时刻的控制感（键盘、上下文、参数可见性）与跨面板的工作记忆。

## What's Working

1. **截断/BLOB 防覆盖门禁**（517-526、1159-1170 行）：把毁灭性数据事故翻译成一句人话并直接禁用编辑入口——安全不是弹窗，是"这条路本来走不通"。产品承诺做进交互语法的样板。
2. **三重降级工程纪律**（417-420 行）：color-scheme / reduced-transparency / reduced-motion 逐条落实，DESIGN.md 的规则是可验证的代码事实而非装饰文档。
3. **请求序号守卫 + 行号错位防护**（1306-1326、1213 行）：快速切表丢弃晚到响应、preview 引用变化即收详情栏——用户永远看不到、但缺失即事故的防御。

## Priority Issues

**① [P0] 危险确认是盲确认：无目标上下文、参数化语句只见问号**
- 为什么：确认框里 `UPDATE ... SET value = ? WHERE id = ?`（557-565 行，params 不进 statement），且看不到目标连接/库/项目与当前 ro/rw——要求用户在零上下文下为看不见实际值的语句签字，直接违背"敢接生产库"。
- 修法：DangerDialog 头部加"目标条"（连接名 + kind + 库/表 + ro/rw 徽标）；确认框 pre 中把 params 代入占位符渲染完整语句，参数值 mono 高亮。
- 建议：`/impeccable harden`

**② [P0] 对话框无键盘与焦点契约：无 Esc、无 focus trap、无 ARIA**
- 为什么：打开时焦点留在遮罩背后、Tab 穿透底层内容、Esc 无效、无 role="dialog"——Sam 类纯键盘用户在最需要掌控感的高危时刻失控，读屏用户不知道对话框出现。
- 修法：挂载即 focus「取消」（Enter 误触也安全）、Esc=取消、Tab 锁定两按钮、补 dialog/modal/labelledby。
- 建议：`/impeccable harden`

**③ [P1] tab 切换销毁全部工作状态**
- 为什么：Panel 按 view 条件挂载（1634-1641 行），写一半的 SQL、选好的连接、展开的树、页码切走即蒸发；Alex 的控制台↔浏览对照动线被系统性惩罚。
- 修法：四视图常驻挂载 + hidden 切换，或状态上提 Panel。
- 建议：`/impeccable adapt`

**④ [P1] 写模式零风险语义 + SQL 控制台不可见授权态**
- 为什么：execute/script 与 query 共用无差别下拉（1507-1510 行），选中"写入执行"后界面毫无变化；连接下拉不显示 ro/rw，ro 连接点了执行要等服务端拒绝才知情。
- 修法：模式改 mini seg；execute 激活时 textarea 加 danger 描边、按钮降 danger 样式；下拉选项带 ro/rw 后缀（数据已在 grants）。
- 建议：`/impeccable clarify`

**⑤ [P2] 双确认体系断裂：window.confirm 与自研 alert 材质并存**
- 为什么：删连接走浏览器原生框（823 行），与产品签名交互分属两宇宙，且无法展示级联影响（grants 里有 N 个项目授权的数字）。
- 修法：复用 askConfirm 通道，对话框展示 kind + safeUrl + "将级联删除密钥与 N 个项目的授权"。
- 建议：`/impeccable polish`

## Persona Red Flags

**Alex（急性子高手）**：执行 SQL 必须鼠标——无 Ctrl+Enter（最高频动作键盘缺席）；危险框 Esc 关不掉；PG 三层树要按几十次 Tab（无方向键导航，1028 行注释自认未做）；切 tab 丢草稿。做得好：autoExpand、placeholder 内嵌方言示例、连接 ID 自动生成。

**Sam（无障碍依赖用户）**：全部输入无 `<label>`（placeholder 即标签，聚焦即消失）；tabs 无 tablist/aria-selected；树无 role="tree" 容器与 aria-expanded；授权 seg 无 radiogroup/aria-checked；异步结果无 aria-live；`aria-label="edit"` 硬编码英文未走 t()；11px muted 叠 12% 半透明底对比约 3.5:1、light NULL chip 黄字约 2.9:1，双双重灾。做得好：骨架屏 role="status"、树行 Enter/Space 可激活。

**接生产库的个人开发者**：服务端安全链路（SHA256 绑定、5 分钟过期、审计）极硬，UI 一半却让用户裸签——盲确认、不可见授权态、删连接看不到级联面；审计入口藏在折叠卡且文案靠 `.split("（")[0]` 硬截（853 行）。单元格写回链路是反例亮点：给了他真正的安全感。

## Minor Observations

- 853 行 `split("（")[0]` 从 i18n 字符串硬截短文案，文案一改即碎，应加独立 key。
- 检测器 4 条真实漂移：`.dbt-chev` 10px 孤立字号；降级遮罩 .55 与 light 降级 dialog #f5f5f7 未回写文档（后者与 #f2f2f7 同查询双灰并存）；kind 徽标内联 11px 绕过 token。
- DESIGN.md frontmatter 缺正文已文档化的值 → 检测器 7 条假阳性噪音，补全即消。
- 连接下拉第一项复用 t("viewManage")+"…"（"连接管理…"）语义误导，实为"选择连接"占位。
- DB_KINDS 显示原始值 "dmdb"/"gaussdb"，zh 界面无解释英文缩写。
- DangerDialog 直接显示服务端 danger 原始枚举值，zh 界面可能破功。
- 剪贴板失败静默（1155 行空 catch），至少应短暂变文案"复制失败"。
- 树箭头用文本字符 "▶"（1042 行）与仅有的两处 SVG 并存，跨平台字形有差异风险。
- 11px caption 对 en 文案偏小（truncatedNoEdit 全句）。

## Questions to Consider

1. 如果去掉所有彩色只剩灰阶，用户靠什么分辨"这条 SQL 会写库"？当"写"在视觉上无重量，确认框就从最后一道闸退化成唯一的闸。
2. 聊天、单元格写回、SQL 控制台共享一套 audit 与 grants——用户在同一屏能看到这份统一吗？面板的差异化价值也许恰是聊天给不了的：可见的授权状态与审计轨迹。
3. 危险确认应该设计成"读一遍条款"还是"核对一张清单"？5 分钟 challengeId 窗口同时是一个未被利用的信任展示窗口——现在的 DangerDialog 离签名时刻只差一行业务数据。
