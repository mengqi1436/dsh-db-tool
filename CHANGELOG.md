# Changelog — dsh-db-tool

## 1.3.0

适配 DeepSeek Harness `0.2.0-rc.1`（同时保持对 `0.1.7-rc.2` 的支持）。

### 安全

- **插件入口接入宿主 Connection 鉴权栅栏**：0.2.0-rc.1 起插件的 webServer 前缀路由不再经过宿主内置栅栏，`lib/index.ts` 现于 handler 顶层调用 `ctx.connection.requestRejection(req)`，返回 401/403 时直接兜底写 JSON 错误响应（`code: UNAUTHORIZED | FORBIDDEN`），不再进入业务 handler；返回 `undefined` 或宿主无 connection 服务时回退本地 trust 校验（loopback/Origin，防 DNS rebinding）。
- `DshContext` 类型新增 `connection` 可选成员；`inject` 清单新增 `'connection'`。

### 修复

- `scripts/apply-dsh-hotfix`（route-scoped 热修复）支持多目标版本：按实际安装的 `@deepseek-ai/dsh-app-boot` 版本自动选择补丁文件（`TARGET_VERSIONS` / `PATCH_BY_VERSION`）；已声明 `Target-Version` 与实际安装不符、或版本不受支持时以退出码 2 拒绝执行（`--force` 可越过）。
- 新增补丁 `patches/dsh-app-boot-route-scoped-hotfix-0.2.0-rc.1.patch`（锚点行相对 rc.2 整体偏移 +1，已验证 git apply 与内建替换结果逐字节一致）。

### 变更

- `engines.dsh` 扩为 `">=0.1.0-rc.6 <0.2.0-0 || 0.1.7-rc.2 || >=0.2.0-rc.1 <0.3.0-0"`（`0.1.7-rc.2` 必须显式列出：semver 的 prerelease 比较只在同一 `[主,次,补]` 元组描述符内生效，`>=0.1.0-rc.6` 不命中 `0.1.7-rc.2`）。
- `devDependencies` 补齐 peer 依赖（`@deepseek-ai/cordis ^4.0.4`、`dsh-better-sidebar ^0.24.1`），便于本地开发与类型检查；注意 `dsh-better-sidebar` 带 18 个宿主 peer（react 系 + 宿主子包），本地安装需 `--legacy-peer-deps`（与既有工作流一致）。

### 测试

- 新增 `tests/http/fence.spec.ts`（入口鉴权栅栏 6 用例：401/403 兜底与文案、prefix 挂载契约、无 connection 回退、`resolveProject` 会话反查链）。
- `tests/http/api.spec.ts` 补 trust 边界形态：跨站同默认端口（Host 无端口）、loopback 隐式 `:80`、非 http/https 无端口 Origin、IPv6 `[::1]`、OPTIONS 预检 204、2MB 上限拒绝。
- `tests/scripts/hotfix.spec.ts` 扩展至 18 用例：rc.1 补丁契约、按版本选择、不受支持版本拒绝、`--force` 越过、git apply 契约（rc.2 / rc.1）。
