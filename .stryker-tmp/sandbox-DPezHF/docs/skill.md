# dsh-db-tool Skill：db-admin

本插件随附一个 DSH skill：`skills/db-admin/SKILL.md`。安装插件后，模型在涉及数据库操作的任务中会自动按该 skill 的指引调用 **DatabaseManager** 工具；用户也可显式唤起（如"帮我看看 xxx 库里有哪些表"）。

## 定位与分工

| 入口 | 面向 | 能力 |
|---|---|---|
| DatabaseManager 工具（skill 驱动） | 模型 | 6 个 action：查询、执行、浏览、预览等，详见下文 |
| 侧边栏「数据库」tab（client/） | 用户 | 连接 CRUD、项目授权（ro/rw）、浏览预览、SQL 控制台、审计 |

授权关系只在侧边栏维护：**项目路径 → 连接 → ro/rw**。工具侧只消费授权结果，不能自我提权。

## 六个 action 速览

完整用法、方言差异与示例见 `skills/db-admin/SKILL.md`（模型实际读取的就是它），此处仅列签名：

```
list_connections                              # 当前项目已授权的连接
query        { conn_id, sql, params? }        # 只读查询
execute      { conn_id, statement, params? }  # 单条写语句（rw；DDL/DML 触发确认）
schema       { conn_id, database?, table? }   # 库列表 / 表列表 / 列结构（三级递进）
preview      { conn_id, table, limit?, database? }  # 预览，limit 上限 50
run_script   { conn_id, code }                # Redis 命令数组 JSON / Mongo BSON 文档 JSON
```

可选 `challenge_id` 用于危险操作确认后的重试。

## 危险确认通道

模型侧与侧边栏控制台共用同一套确认语义：

1. 首次执行危险语句返回 `{"ok":false,"code":"NEEDS_CONFIRMATION","challengeId","statement","danger","reason"}`。
2. 模型向用户说明并征得同意（侧边栏则弹 DangerDialog）。
3. 携同一 `challengeId` 重发；challenge 一次性、绑定语句 hash、5 分钟过期，失效返回 `INVALID_CHALLENGE` 需从头再来。

## SKILL.md 规范要点（维护者参考）

- 目录形态：`skills/db-admin/SKILL.md`，frontmatter 的 `name` 必须是 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)*$`），`description` 供模型路由、渲染上限 500 字符、单行。
- 发现根：`<projectRoot>/.dsh/skills` 等（随插件安装的 skill 由插件分发）。
- 可选 frontmatter：`whenToUse`、`disable-model-invocation`、`user-invocable`——本 skill 均用默认值（允许模型自动调用）。
- 修改方言速查/确认流程时，保持 SKILL.md 与 `lib/adapters/types.ts`、`lib/guard/index.ts`、`docs/api-contract.md` 三处一致。

## 排错

- 工具返回 `UNAUTHORIZED_PROJECT`：项目路径未授权 → 侧边栏「授权」面板授权。
- 返回 `READ_ONLY`：ro 授权下执行写 → 需用户升级为 rw。
- `INVALID_ARGUMENT: 未知 action`：只接受上文 6 个 action 名。
