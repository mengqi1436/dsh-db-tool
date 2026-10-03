# 连接管理「导出 / 导入」方案

> 状态：已实现并验收（全仓 `tsc --noEmit` 0 报错；全量 `npm test` 564/564 通过；`npm run build` 成功）
> 版本：dsh-db-tool ≥ 1.5.91
> 范围：仅侧边栏「连接管理」面板；模型工具（LLM）不暴露。
> 技术依据：Node.js crypto 官方文档 + MDN Web Docs（经 context7 检索），逐条对照见 §3、§4.4。

## 1. 背景与目标

dsh-db-tool 把连接配置拆两处持久化：

- `connections.json` — 连接元数据（绝不含密码；密码段在 URL 中被替换为 `***`）
- `secrets.json` — 连接级机密（完整 URL / 明文密码，权限 0600）

用户需要跨机器迁移连接：一键导出为**单个加密文件**，在另一台机器（或另一个 DSH 实例）用口令解密导入。

### 成功标准（验收已满足）

- 导出文件用任意文本编辑器打开**无明文密码**（整个 payload 加密）。
- 导出 → 删除全部连接 → 导入，round-trip 后 `testTarget` 可拼回真实 URL/密码，连接可 test 连通。
- 重复导入幂等：已存在 id 全部计入 `skipped`，不覆盖。
- 零新增 npm 依赖（全部走 Node stdlib + 各库官方驱动）。

### 明确不做（YAGNI）

- 不含 `grants.json` / `audit.jsonl`：授权是「项目路径 ↔ 连接」的机器绑定关系，跨机迁移无意义；审计不可移植。
- 不做选择性导出（勾选部分连接）：需要时后续给 export API 加 `ids?: string[]` 即可，不预留抽象。
- 不在 `handleToolAction`（模型工具）暴露导出：机密不应进入 LLM 上下文，仅 HTTP 面板可用。

## 2. 关键设计决策

| 决策点 | 结论 | 依据 |
|---|---|---|
| 导出内容 | 含密码 | 目标是跨机器迁移，无密码无法做到导入即可用 |
| 加密算法 | 用户口令 + scrypt 派生密钥 + AES-256-GCM | Node stdlib `crypto` 足够，不引第三方加密库（ponytail 阶梯：stdlib 优先） |
| 冲突策略 | **skip**（不覆盖） | 用户明确选择；幂等可重入，重复导入安全 |
| 错误反馈 | 口令错 / 密文篡改 / 格式坏**统一**报「口令错误或文件已损坏」 | 不向外泄露失败原因，防侧信道探测 |
| AAD | 不使用 | 见 §3「AAD 裁决」 |

## 3. 加密格式（按 Node 官方文档校准）

信封结构（JSON，二进制段全 base64）：

```json
{
  "v": 1,
  "kdf": "scrypt",
  "salt": "<base64, 16 字节>",
  "iv":   "<base64, 12 字节>",
  "tag":  "<base64, 16 字节>",
  "data": "<base64 密文>"
}
```

### 官方文档逐条对照

| 参数 | 取值 | 官方依据（context7 → nodejs/node） |
|---|---|---|
| KDF | `scryptSync(passphrase, salt, 32)` | `crypto.scryptSync` 官方定位为 password-based KDF，"designed to be expensive computationally and memory-wise in order to make brute-force attacks unrewarding" |
| scrypt cost/blockSize/parallelization | **默认值**（N=16384, r=8, p=1），maxmem 默认 32MB | 官方默认值即推荐值，不显式覆盖 |
| salt | 随机 **16 字节**（`randomBytes(16)`） | 官方："It is recommended that a salt is random and at least 16 bytes long"（NIST SP 800-132） |
| 算法 | `aes-256-gcm` | GCM 同时提供机密性与完整性（auth tag 防篡改） |
| IV | 随机 **12 字节**（`randomBytes(12)`） | OpenSSL 官方变更说明："The IV length is by default 12 bytes (96 bits)"，GCM 推荐 96-bit |
| auth tag | **默认 16 字节**，不显式传 `authTagLength` | Node DEP0182 已废止短 tag（<16B）以对齐 NIST SP 800-38D；`createCipheriv` 文档明确 GCM 默认 16 字节 |
| 解密顺序 | `setAuthTag(tag)` 必须在 `final()` 前 | 官方示例代码（`test-crypto-authenticated.js`）：`decrypt.setAuthTag(...)` → `update` → `final` |

### AAD 裁决（不使用，理由记录）

官方示例用 `setAAD` 把密文绑定到外部上下文（用户 id、文件名等），防信封被整体搬到别的上下文冒充。本方案不加，理由：

1. 信封自含 `v/kdf/salt/iv/tag`，且**口令本身就是解密前提**——信封整体替换后在任何机器上都需要同一口令才能解，AAD 不增加实际安全边界。
2. 引入 AAD 需要持久化一个额外的上下文字段并保持两端同步，是真实复杂度（ponytail 阶梯：两个同级方案取边界更简单的）。
3. 文件本身就是交付物，不存在「信封被混进别的数据流」的攻击面。

解密任一环节失败（JSON 解析、结构校验、base64 长度校验、GCM tag 验证、明文 JSON 解析）统一抛 `Error('口令错误或文件已损坏')`（常量 `DECRYPT_FAIL_MESSAGE`）。

明文 payload 结构：

```json
{
  "connections": [{ "id", "kind", "name?", "urlSafe?", "fields?", "ssl?" }],
  "secrets": { "<connId>": { "url?", "password?", "...其他机密键" } }
}
```

`secrets` 保留 `SecretEntry` 的扩展键（如 MongoDB 的额外凭证），不只挑 `url/password`。

## 4. 实现分层

### 4.1 存储层 — `lib/store/`

**`export-crypto.ts`（新建，纯函数）**

- `encryptPayload(plain: unknown, passphrase: string): string` — 非空口令断言 → scryptSync(pass, salt, 32) → AES-256-GCM → 信封 JSON。
- `decryptPayload(encryptedJson: string, passphrase: string): unknown` — 结构校验 + iv/tag/salt 长度校验 + tag 验证 → 原始 payload；任一失败统一抛 `DECRYPT_FAIL_MESSAGE`。
- `DECRYPT_FAIL_MESSAGE` 导出供 service 层复用。

**`connections.ts`（修改）**

- `exportBundle(): { connections: ConnRecord[]; secrets: Record<string, SecretEntry> }`
  从 `load()` 取全部连接记录，逐条 `this.secrets.get(id)` 合并；无机密的连接不出现在 `secrets` 中。
- `importBundle(bundle): { imported: number; skipped: string[]; errors: {id, message}[] }`
  逐条走**既有** `this.create()`（机密拆分 / URL 脱敏逻辑全复用，不新造写入路径）：`sec.url` 作完整 URL 传入、`sec.password` 经 `fields.password` 自动拆分。冲突（`连接已存在`）→ `skipped`；其他异常 → `errors` 续跑。create 后 `this.secrets.set(rec.id, sec)` 幂等合并写回，保留扩展机密键。

**`index.ts`（修改）**：补导出 `encryptPayload / decryptPayload / DECRYPT_FAIL_MESSAGE` 及 `ConnRecord` 类型。

### 4.2 服务层 — `lib/manager.ts`（DbToolService）

- `exportConnections(passphrase: string): string`
  非空校验 → `store.exportBundle()` → `encryptPayload` → 审计 `export_connections`（statement 仅记「导出 N 个连接」，不落口令/密文）。
- `importConnections(encryptedJson: string, passphrase: string)`
  解密失败 + 结构校验失败（缺 `connections` 数组）统一转 `DbToolError('INVALID_ARGUMENT', DECRYPT_FAIL_MESSAGE)` → `store.importBundle` → 审计 `import_connections`（记 imported/skipped 数）。

### 4.3 HTTP 层 — `lib/http/index.ts`

两条新路由，**插在 `connMatch` 之前**（`/api/connections/export` 与 `/api/connections/import` 都是单层路径，放后面会被正则 `^/api/connections/([^/]+)` 当作连接 id 静默吞掉）：

| 路由 | Body | 成功 | 失败 |
|---|---|---|---|
| `POST /api/connections/export` | `{passphrase}` | `{ok:true, data:{json}}` | 缺/空 passphrase → 400 INVALID_ARGUMENT |
| `POST /api/connections/import` | `{json, passphrase}` | `{ok:true, data:{imported, skipped[], errors[]}}` | 缺参 400；口令错走 `sendError` → 200 + `{ok:false, code:'INVALID_ARGUMENT'}`（与既有契约一致） |

trust 校验（Host/Origin loopback）、2MB body 上限、`{ok,error,code}` 响应契约全部复用既有链路。

### 4.4 客户端 — `client/client.js`（ManageView）

**i18n**：zh/en 各加 8 键（exportConns / importConns / passphrase / passphraseHint / exportDone / importResult / importDecryptFail / pickFile）。

**`PassphraseDialog`**（局部组件，紧邻 `EMPTY_FORM`）：复用 `dbt-overlay/dbt-dialog` 样式；键盘契约对齐 `DangerDialog`（Escape=取消、Tab 循环锁定），差异——初始焦点在口令输入框、确认按钮主色、Enter 提交、前端预校验 ≥6 位。ponytail：仅两处使用，未抽通用模块。

**导出 / 导入文件 IO（按 MDN 官方文档校准）**：

| 操作 | MDN 最佳实践 | 实现 |
|---|---|---|
| 下载 | `Blob` → `URL.createObjectURL` → `a.download` → click | `dsh-db-connections-YYYYMMDD.enc.json` |
| 释放 object URL | 必须 `revokeObjectURL`，但**不能过早**（官方明示：立即 revoke 会让用户无法保存/打开） | `a.click()` 后 `setTimeout(revoke, 1000)`，与仓库内结果导出下载同一模式 |
| 读取本地文件 | `FileReader.readAsText` + `onload/onerror` 双通道，先校验文件存在 | 读失败走通用错误通道 |

**流程**：
- 导出：点导出 → 口令窗 → `POST connections/export` → Blob 下载 → `dbt-msg` 显示 `exportDone`。
- 导入：点导入 → 隐藏 `input[type=file accept=".json"]` 选文件 → FileReader 读文本 → 口令窗 → `POST connections/import` → `reload()` → `dbt-msg` 显示 `importResult`；`err.code === 'INVALID_ARGUMENT'` 时 `dbt-err` 显示 `importDecryptFail`。

## 5. 边界与失败模式

| 场景 | 行为 |
|---|---|
| 口令为空 / 非字符串 | store 层抛 `Error('口令必须为非空字符串')`；HTTP 层 400 |
| 密文被篡改 | GCM tag 校验失败 → 统一「口令错误或文件已损坏」（不泄露是哪一环） |
| 导入文件非信封结构 / 明文缺 `connections` 数组 | 同上统一错误 |
| 单条导入失败（kind 非法、secrets 写入 I/O 故障等） | 记入 `errors` 续跑，不整批回滚（与 skip 语义一致，幂等可重入） |
| 连接无密码 | 不出现在 `secrets` 段；导入后无 `hasPassword` 指示 |

## 6. 测试

- `tests/store/export-crypto.spec.ts`（5 例）：round-trip（密文不含明文）、随机 salt/iv 同文异密、错口令统一错误、篡改 data/tag/结构统一错误、空/非字符串口令拒绝。
- `tests/store/connections.spec.ts`（追加 4 例）：exportBundle 含密码、importBundle skip 冲突不覆盖 + 重复导入幂等、单条异常入 errors 续跑、round-trip 后 testTarget 密码/URL 一致且 connections.json 无明文。
- `tests/tool/manager.spec.ts`（追加 4 例）：round-trip（导出→删除→导入恢复）、错口令 INVALID_ARGUMENT、空参数 INVALID_ARGUMENT、导出/导入审计断言（记条数、不落口令）。
- `tests/http/api.spec.ts`（追加 3 例）：happy path（HTTP 建连接→导出→全删→导入恢复，断言密文不含明文连接串）、缺/空 passphrase 400、坏密文导入 INVALID_ARGUMENT。

验收命令：`npm run typecheck && npm test && npm run build`，全部通过。

## 7. 实施过程（Agent Teams 并行）

任务拆为 3 个 teammate 并行，写范围互斥：

| Teammate | 写范围 | 产出 |
|---|---|---|
| store-crypto | `lib/store/connections.ts`、`lib/store/export-crypto.ts` + 配套测试 | 存储层 + 加解密，21 测试绿 |
| service-http | `lib/manager.ts`、`lib/http/index.ts` + 配套测试 | service + HTTP 路由，46 测试绿 |
| client-ui | `client/client.js` | UI + i18n，98 client 测试无回归 |

契约先行冻结（store 方法签名、HTTP 端点、错误 code），三路按契约并行开发；store-crypto 完成后 service-http 的真实 store 联跑自然转绿。Lead 负责收尾 integrator（`lib/store/index.ts` 导出面）+ 全仓验收。
