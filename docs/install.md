# dsh-db-tool 安装指南

dsh-db-tool 是 DSH（DeepSeek Harness）插件：侧边栏管理数据库连接与授权，聊天内经 DatabaseManager 工具操作 8 种数据库（MySQL、PostgreSQL、GaussDB、SQLite、Redis、MongoDB、Oracle、达梦）。

## 一键安装（发布模式）

```powershell
dsh plugin --profile web add "dsh-db-tool@github:<user>/dsh-db-tool"
```

把 `<user>` 换成实际发布仓库的 GitHub 用户名/组织。安装后侧边栏出现「数据库」tab，即装即用。

> GaussDB 支持依赖 `vendor/gaussdb-pg` 产物（见下文）；不使用 GaussDB 时可不构建，其余 7 库开箱即用。

## 本地开发模式

在仓库根目录执行：

```powershell
pnpm dsh web --patch ./cordis.patch.yml
```

`cordis.patch.yml` 会向 DSH 的 cordis 配置注入 `id: db-tool` 的插件条目，指向本仓库入口；改动 `client/client.js` 后重启该命令生效。

## GaussDB vendor 构建

官方 [openGauss-connector-nodejs](https://gitcode.com/opengauss/openGauss-connector-nodejs) 未发布 npm，需从源码构建（详见 `scripts/build-gaussdb.sh` 头注释）：

```bash
bash scripts/build-gaussdb.sh            # 幂等：已有产物则跳过
bash scripts/build-gaussdb.sh --force    # 强制重新拉取并构建
npm run build:gaussdb                    # 等价入口
```

脚本失败（网络等）时可手动执行同样步骤：

```bash
git clone https://gitcode.com/opengauss/openGauss-connector-nodejs vendor/gaussdb-src
cd vendor/gaussdb-src && npm install && npm run build
rm -rf ../gaussdb-pg && cp -r packages/pg ../gaussdb-pg
# 保留 vendor/gaussdb-pg/package.json 与 dist/
```

产物为 `vendor/gaussdb-pg`（CJS，结构同 `pg`：`{ Pool, Client, ... }`）。

## oracledb approve-scripts

`oracledb` 安装时需要运行安装脚本编译/下载二进制。仓库 `package.json` 已配置白名单：

```jsonc
"allowScripts": { "oracledb@7.0.1": true }
```

若你的 npm/pnpm 版本提示 approve-scripts 拦截，按提示批准 `oracledb` 即可；已配置白名单的环境无需额外操作。

## 真机测试

单测（vitest）不依赖真实数据库；要跑真机冒烟，设置以下环境变量后执行 `npm test`（或对应集成脚本）：

| 环境变量 | 示例 |
|---|---|
| `DBT_TEST_MYSQL_URL` | `mysql://user:pass@127.0.0.1:3306/test` |
| `DBT_TEST_PG_URL` | `postgres://user:pass@127.0.0.1:5432/test` |
| `DBT_TEST_REDIS_URL` | `redis://127.0.0.1:6379/0` |
| `DBT_TEST_MONGO_URL` | `mongodb://127.0.0.1:27017/test` |
| `DBT_TEST_ORACLE_CONNECT` | Oracle 连接串/ezconnect 描述 |
| `DBT_TEST_DM_CONNECT` | 达梦连接串 |

未设置对应变量时该库的真机用例自动跳过。

## 常见问题

- **侧边栏没有「数据库」tab**：确认 dsh-better-sidebar >= 0.12 已随 DSH 加载；本地开发模式确认 `--patch ./cordis.patch.yml` 生效。
- **API 全部报错**：host 端 webServer 须注册前缀 `/dsh-db-tool/api`（loopback only）；前端与 host 前缀不一致是最常见的接错方式。
- **连接测试通过但查询报 UNAUTHORIZED_PROJECT**：当前项目路径未被授权，在「授权」面板为该项目路径授 ro 或 rw。
