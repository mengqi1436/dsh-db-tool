# 贡献者

本项目由 [mengqi1436](https://github.com/mengqi1436) 发起并维护。感谢以下外部贡献者的具体投入——每一条都对应已合并到 `master` 的代码，不是署名式的感谢名单。

---

## 外部贡献者

### [a19920714liou](https://github.com/a19920714liou)

| 项 | 内容 |
| --- | --- |
| PR | [#1](https://github.com/mengqi1436/dsh-db-tool/pull/1) — 修复(mysql+授权): ro 连接钩子卡死与 Windows 路径大小写授权错位 |
| 合并 | 2026-10-30，21 个文件，`+682 / −118` |
| 修复的用户故障 | 「设置数据源后表显示不出来」——用户配完连接却看不到表，是接入阶段最容易被劝退的一类问题 |

**双根因与改动范围**：

1. **ro 连接钩子卡死**：只读连接的建连钩子在异常路径上吞掉了错误（swallow），导致数据浏览树停在加载态。修在 `lib/adapters/mysql/index.ts`，并在 `lib/adapters/sql-shared/pg-like.ts` 同步了同型问题。
2. **Windows 路径大小写授权错位**：`grants.json` 的授权 key 与项目路径比较时大小写敏感，而 Windows 文件系统不敏感，导致授权明明给了却被判未授权。修在 `lib/store/normalize.ts` 与 `lib/store/grants.ts`。

**配套**：`lib/types.ts`、`lib/http/index.ts`、`lib/manager.ts`、`client/client.js` 的连带调整，以及 `tests/store/normalize.spec.ts`、`tests/store/grants.spec.ts`、`tests/tool/manager.spec.ts`、`tests/adapters-sql/mysql.test.ts` 等 8 个测试文件的回归用例。

---

### [weicy98](https://github.com/weicy98)

| 项 | 内容 |
| --- | --- |
| PR | [#12](https://github.com/mengqi1436/dsh-db-tool/pull/12) — 修复(适配器): 达梦通信加密为 DES-CFB 时自动降级 loginEncrypt=false |
| 合并 | 2026-11-11（随 1.9.11 发布），6 个文件 |
| 作者原始提交 | `9063c45`，`+257 / −18`（其余部分由维护者在同一分支追加，见下） |
| 修复的用户故障 | 达梦 DM8 服务器 `COMM_ENCRYPT_NAME=DES_CFB` 时，Node.js 22+ / OpenSSL 3 已移除 DES，连接在握手阶段必报 `[6071] 消息加密失败 / Unknown cipher`，**完全无法连接** |

**根因调查（本贡献最核心的部分）**：作者自行反查出了完整链路——`dmdb` 的 `src/net/access.js` 在 `msgVersion >= VERSION_DETERMINE_ENCRYPT` 且协商结果为算法 0 时选择 `DES_CFB` → `src/security/symmCipher.js` 拼出 `DES-CFB` → `crypto.createCipheriv` 抛 `digital envelope routines::unsupported` → 被驱动包成 `[6071]`。这条链路不是猜的，是逐层读源码定位出来的。

**主实现**：`lib/adapters/dmdb/index.ts` 的定向降级——只对 `[6071]` + 特征错误串双条件触发，只重试一次，显式 `loginEncrypt` 不干预；把池参数与池别名收敛到 `createDmPoolOnce` 单点维护；主连接、测试连接、数据传输独立池三处共用同一路径。配套 117 行新测试 `tests/adapters-nosql-ent/dmdb-login-encrypt.spec.ts`，锁死「只定向降级一次」的契约。

**维护者追加**（同一分支上，为修掉审查发现的问题）：`e3e7078` 与 `6af1e9b` —— 显式参数按驱动 `toLowerCase` 语义判定（原实现大小写敏感，会把用户的显式加密要求静默降级成明文）、降级只改写 query 段不重组 authority、降级失败专用提示、同目标降级结果记忆。

**此前一次未合并的提交**：[#2](https://github.com/mengqi1436/dsh-db-tool/pull/2)（减少第三方插件依赖，直接依赖原生侧栏运行）——该方案与 1.9.0 已落地的官方右侧栏方案是两条独立实现，必然冲突，故关闭。此项不计入已合并贡献，记录在此仅为完整。

---

## 贡献方式

- 缺陷修复、适配器支持、文档改进都欢迎。新适配器请先对照 `lib/adapters/<最接近的既有适配器>/`，共享逻辑不要在各调用点打补丁。
- 提交前请确认 `npm run build && npm run typecheck && npm test` 通过；只跑相关测试也可以，但请在 PR 描述里说明跑了哪些。
- 提交信息用简体中文，格式 `类型(范围): 简略描述`。
- 首次贡献者的 PR 工作流需要维护者人工批准 CI（仓库设置了 `first_time_contributors` 审批策略），这是 GitHub 的安全默认行为，不是对你的判断。
