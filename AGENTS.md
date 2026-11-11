# AGENTS.md — dsh-db-tool 仓库约定

面向在此仓库工作的 AI 代理与协作者。**只写长期有效的规则，不写版本号、发版记录、任务进度或验证状态**——那些属于 CHANGELOG 与 PR 描述。

---

## 项目定位

DSH 宿主插件，让用户在聊天中安全操作数据库。核心不是「连得多」，而是**九种数据库共用一套授权、确认、审计语义**：任何一次操作都必须穿过项目级授权与语句级风险分级两道闸门。

技术栈：TypeScript + vitest，Node.js ≥ 22，ESM（`"type": "module"`）。

---

## README 写作规范（重要）

本仓库的 README 是**产品文档，不是开发日志**。2026-11-11 做过一次全量重写，确立了以下规则，后续修改必须遵守。

### 必须写

| 内容 | 说明 |
| --- | --- |
| 项目是什么 | 一句话定位 + 它解决什么问题 |
| 支持的数据库与能力边界 | 明确排除项要写出来，不能只列支持的 |
| 各功能的行为与参数 | action 清单、授权模式、确认流程、传输写入模式等 |
| 安全模型 | 存储、授权、语句级、只读强制、传输加密、脚本隔离逐层说明 |
| 安装与运行环境 | Node 版本、宿主要求、必要的前置 |
| 数据存放位置 | 文件清单与权限 |
| 开发命令 | build / test / typecheck、真机门控的环境变量 |
| 目录结构 | 便于定位代码 |

### 禁止写

| 禁止项 | 原因 |
| --- | --- |
| **版本号硬编码** | README 里不出现 `dsh-db-tool@1.9.x`。安装命令统一写 `dsh-db-tool@<版本号>`，由用户自己查 npm latest。版本号只存在于 `package.json` / `package-lock.json` / `CHANGELOG.md` |
| **更新 / 发版叙事** | 「本次修复了…」「相比上一版…」「新增支持…」一律不进 README，进 CHANGELOG |
| **验证状态标记** | 不写「实测确认」「已验证」「推断」「官方文档已确认」这类内部取证标记。结论直接陈述；确实仍有不确定的，写成用户能理解的边界描述（如「该模式下 X 不生效」），而不是给自己留证据备注 |
| **单库连接排障说明** | 不在 README 写某个数据库的连接细节——URL 参数表、`caCert` / `serverName` / `tlsMinVersion` / `tdsVersion` 的取值、TLS 版本与补丁对照、认证方式限制、端口默认值、分字段与 URL 模式取长补短等，一律归该适配器的代码注释与「传输加密」一节的通用策略。README 只保留跨库共用的加密取舍与明文风险 |
| **内部实现细节** | 具体到函数名、内部变量、驱动源码行号的描述属于代码注释，不属于 README |
| **宿主版本核对清单** | 不写「已在 0.2.2-rc.1 上逐项核对…」这类宿主兼容性记录 |
| **测试通过数** | 测试统计属于 CHANGELOG 的当次记录，不是 README 内容 |
| **外部产品对照与文献引用** | 不为了让某个设计显得有依据而引用 DBeaver / Airbyte / AWS DMS 的文档链接；产品行为自解释即可 |
| **贡献者 PR 细节** | README 只留姓名 + PR 链接 + 一句话；完整贡献记录在 `CONTRIBUTORS.md` |

### 中英双版

`README.md`（简体中文）与 `README_EN.md`（英文）**结构必须逐节对齐**，章节顺序、表格列数、边界说明一一对应。改一版必须同步另一版。

语言规则：正文用目标语言；代码标识符、参数名、SQL 关键字、文件名、命令一律保留原文不翻译。

### 结构模板

```
# dsh-db-tool
（语言切换 + 一句话定位）
## 功能流程          流程图 + 两入口共用语义说明
## 支持的数据库      表格 + 传输能力分层 + 明确排除项
## 核心能力          逐功能小节（工具 action / 授权 / 确认 / 审计 / 浏览 / 控制台 / 传输 / 导出导入）
## 右侧栏            五个面板表格 + 官方契约的易误判行为
## 安全模型          分层表格 + ro 强度差异 + 传输加密取舍（含明文风险）
## 安装              运行环境 + 三种安装方式 + 驱动注意事项
## 数据存放          文件表格 + 路径解析优先级 + 迁移行为
## 开发              命令 + 真机门控变量 + CI 位置 + 目录结构
## 贡献者            姓名 + PR 链接，细节指向 CONTRIBUTORS.md
## 许可证            Apache 2.0 + 权利与限制摘要
```

共 10 个二级章节。传输加密作为「安全模型」下的三级小节存在，不再是独立的「连接说明」章。

新增数据库或功能时，插入到对应章节内，不要打乱这个骨架。

---

## 代码改动纪律

- **只改与问题直接相关的代码**：先定位根因（root cause, not symptom），单点修复；禁止顺手优化、捆绑重构、格式化无关文件。
- **共享函数一处修**：`lib/adapters/sql-shared/common.ts`、`pg-like.ts`、`lib/store/normalize.ts` 是高扇入热点，改前 grep 全部调用方，在共享函数修，不在各调用点打补丁。
- **安全原语不可散落**：`SQL_READ_HEADS`、`SQLSERVER_DANGER_HEADS`、`DANGEROUS_COMMANDS` / `READ_OPS` 等都是 `ReadonlySet`，改清单就是改安全边界，必须同步测试。
- **越界需先说明**：涉及公共 API、跨模块契约、依赖升级、架构调整时，先说清改什么 / 为什么 / 影响范围。

---

## 测试与验证

**未经验证不得视为完成。**

```bash
npm ci               # 依赖必须与 lock 对齐，否则 npm ci 直接 EUSAGE
npm run build        # 必须先跑：vendor/*.cjs 是构建产物，缺失会让多组测试以「环境问题」形式假失败
npm run typecheck
npm test
```

- 修 bug 先写复现失败的测试，再改实现。
- 用项目既有框架（vitest），优先只跑相关文件：`npx vitest run tests/adapters-nosql-ent/<相关>.spec.ts`。
- 覆盖 happy path + 边界 / 空值 / 异常。
- 新增 HTTP 路由要同步 `tests/http/api.spec.ts` 的契约断言；改 guard 配 `tests/guard/`；改 store 配 `tests/store/`；改前端配 `tests/client/`。
- 断言要按**契约**写，不要为了让实现通过而放宽——测试是裁判。

### 已知本机环境差异（不是代码问题）

| 现象 | 判定方式 |
| --- | --- |
| `sqlserver-driver-real` 的 `host.invalid` 用例失败 | 本机 DNS 把 `.invalid` 劫持成真实 IP：`node -e "require('node:dns').lookup('host.invalid',(e,a)=>console.log(e?e.code:a))"` 返回 IP 即劫持，返回 `ENOTFOUND` 即正常。CI 不复现 |
| `hotfix.spec.ts` 的 `git apply` 契约用例失败 | `core.autocrlf=true` 导致 CRLF：`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false npx vitest run tests/scripts/hotfix.spec.ts` |
| 测试报驱动模块缺失 | 本机若是 pnpm 布局，传递依赖顶层不可解析；按 npm 布局重装再判定，**不要据此改代码** |

---

## 提交与发版

### 提交信息

简体中文，格式 `类型(范围): 简略描述`。

| 类型 | 对应 conventional commit |
| --- | --- |
| 新增 | feat |
| 修复 | fix |
| 文档 | docs |
| 重构 | refactor |
| 测试 | test |
| 性能 | perf |
| 杂项 | chore |
| 回滚 | revert |

### 发版：三处版本号必须同步

```
package.json                          "version"
package-lock.json                     "version"
package-lock.json  packages[""].version
```

任一不一致，`npm ci` 直接 EUSAGE，CI 第一步就挂。

**发版流程**：改三处版本号 → `CHANGELOG.md` 的「未发布」改成版本号（不保留「未发布」层级，版本序列保持连续）→ 推送 `master`。`publish.yml` 会比对 `package.json` 版本与 npm 上现有版本：相同则跳过，不同才 `npm install → build → test → npm publish --provenance` 并自动打 `v<版本>` 标签。

**发版后必须核实 npm 真实可用**，不能只看工作流 success：

```bash
npm view dsh-db-tool version                    # dist-tags.latest 是否为新版本
curl -s -o /dev/null -w "%{http_code}" "$(npm view dsh-db-tool@<版本> dist.tarball)"
git ls-remote --tags origin | grep "v<版本>"     # 标签是否推送
```

CDN 同步有延迟，「元数据有、tarball 404」时先等待，**不要重发同版本号**。

### 发布内容

`package.json` 的 `files` 白名单决定发布内容。**元数据文件必须逐条显式列出**（`LICENSE`、`README.md`、`README_EN.md`、`CHANGELOG.md`、`CONTRIBUTORS.md`、`docs/...`），不依赖 npm 默认收录；目录会连 `.gitignore` 的草稿一起发布，所以路由类路径写精确文件而非目录。

本地核对：

```bash
npm pack --dry-run
```

---

## 行尾必须 LF

`.gitattributes` 强制 `* text=auto eol=lf`。`patches/*.patch` 与 `scripts/hotfix-core.mjs` 的内置替换块是**逐字节**比对的，CRLF 会让三条 `git apply` 契约用例必红。

改补丁时三处同步：`.patch` 的 hunk 头、`hotfix-core.mjs` 的 `ORIGINAL_LINE` / `ORIGINAL_NPD_BLOCK` / `PATCH_BY_VERSION`、`tests/scripts/hotfix.spec.ts` 的对应契约块。

---

## 安全敏感代码的注意点

- **ro 模式不是空转检查**：MySQL / PG 有会话级 `SET TRANSACTION READ ONLY` 兜底；SQL Server 没有，只能应用层五道闸门。看到「应用层拦截」时不要误以为等价于会话级只读。
- **明文传输是明确的设计取舍，不是缺陷**：SQL Server 的 `encrypt=auto` / `encrypt=false`、达梦的 `loginEncrypt=false` 都是明文。改这些默认值时要把安全含义一起改到 README 与 CHANGELOG。
- **自动重试必须收窄条件**：现有两处（SQL Server 强制加密、达梦 DES_CFB）都是「只重试一次 + 只针对一种特征原因 + 显式参数不干预」。新增自动重试要遵循同样边界，否则会把真实错误盖掉。
- **凭据永不出库**：`secrets.json` 的内容不得出现在返回给模型的结构里；对外暴露的连接信息密码一律 `***`。
