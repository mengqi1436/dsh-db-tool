# dsh-db-tool HTTP API 契约（v1）

侧边栏 client 与 lib/http 实现共同遵守。API 仅监听 loopback（127.0.0.1），校验 `Origin`/`Referer` 必须来自 DSH 本地 web（同源 fenced）。所有请求/响应 JSON。

## 通用约定

- 成功：`200 { "ok": true, "data": ... }`
- 失败：`{ "ok": false, "error": string, "code": string }`，code ∈ `UNAUTHORIZED_PROJECT`（项目未授权该连接）/ `READ_ONLY`（ro 连接拒绝 execute）/ `NEEDS_CONFIRMATION`（危险操作待确认）/ `INVALID_CHALLENGE` / `NOT_FOUND` / `INVALID_ARGUMENT`（参数非法；插件 dispose 后的新请求同样返回此 code，error 为「服务已关闭」）/ `DRIVER_ERROR`
- `projectPath`：前端传入当前 workspace 绝对路径，服务端用 `normalizeProjectKey` 归一后校验 grants；**不传视为匿名项目**（仅连接管理可用，业务操作一律拒）
- 人工确认通道：SQL 控制台是人工操作，危险语句同样走 challenge 流程——前端展示确认对话框后携 `challengeId` 重发
- 除注明外，业务端点均需 projectPath 且该连接已授权

## 路由

### 连接管理（无需 projectPath）

| 方法/路径 | 说明 |
|---|---|
| `GET /api/connections` | 全量连接列表（脱敏 ConnectionMeta[]，含每库 kind） |
| `POST /api/connections` | 创建 `{ id, kind, name?, url?, fields?, ssl? }`；密码自动拆入 secrets |
| `PUT /api/connections/:id` | 更新（同上字段可选） |
| `DELETE /api/connections/:id` | 删除（级联 secrets + 全项目 grants） |
| `POST /api/connections/:id/test` | 测试连接 → `TestConnectResult` |

### 项目授权

| 方法/路径 | 说明 |
|---|---|
| `GET /api/grants?project=<path>` | 该项目授权列表 `{ connId, mode }[]` |
| `PUT /api/grants` | `{ projectPath, connId, mode: "ro"\|"rw" }` 授权/改模式 |
| `DELETE /api/grants` | `{ projectPath, connId }` 撤销 |

### 浏览（需授权，ro 即可）

| 方法/路径 | 说明 |
|---|---|
| `GET /api/databases?project=<path>&connId=` | 库/schema 清单 string[] |
| `GET /api/tables?project=<path>&connId=&database=` | TableInfo[] |
| `GET /api/schema?project=<path>&connId=&database=&table=` | ColumnInfo[] |
| `GET /api/preview?project=<path>&connId=&database=&table=&limit=&offset=` | QueryResult（limit≤50 强制；offset 为行偏移，翻页用，默认 0） |

### SQL 控制台 / 脚本（需授权，execute 需 rw）

| 方法/路径 | 说明 |
|---|---|
| `POST /api/query` | `{ projectPath, connId, sql, params?, challengeId? }` → QueryResult；危险读（如 KEYS）同样触发 NEEDS_CONFIRMATION |
| `POST /api/execute` | `{ projectPath, connId, statement, params?, challengeId? }` → ExecResult 或 `NEEDS_CONFIRMATION { challengeId, statement, danger, reason }` |
| `POST /api/script` | `{ projectPath, connId, code, challengeId? }` → 子进程沙箱执行（Node permission model 禁 fs + 新 vm realm 双层隔离），60s 强超时；db 句柄经 IPC 走完整 guard/审计链路 |

### 审计

| 方法/路径 | 说明 |
|---|---|
| `GET /api/audit?project=<path>&limit=` | AuditEntry[]（最近 n 条，默认 50） |

### 状态

| 方法/路径 | 说明 |
|---|---|
| `GET /api/state?project=<path>` | 面板初始化：`{ connections, grants, auditTail }` |

## NEEDS_CONFIRMATION 语义

```json
{
  "ok": false,
  "code": "NEEDS_CONFIRMATION",
  "challengeId": "c_9f3a…",
  "statement": "DROP TABLE users",
  "danger": "danger",
  "reason": "DDL 不可回滚（隐式提交）"
}
```

- `challengeId` 一次性、绑定语句 hash、5 分钟过期；重发请求带同 `challengeId` 且语句 hash 一致才放行
- 模型工具（对话内）用同一 guard/challenge 实现，确认经 ask_user 完成
