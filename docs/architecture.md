# dsh-db-tool 项目架构图

> 由 cbm（codebase-memory）索引数据绘制：843 节点 / 2702 边，模块分层见各图。
> 索引项目名：`E-Code-dsh-dsh-db-tool`。

## 1. 总体分层架构

```mermaid
flowchart TB
    subgraph UI["客户端层（DSH 侧边栏）"]
        CLIENT["client/client.js<br/>连接管理 · 对象树浏览 · SQL 控制台 · 授权面板"]
    end

    subgraph API["接入层"]
        HTTP["lib/http<br/>HTTP API（13 条路由）"]
        TOOL["lib/index.ts<br/>DatabaseManager 工具定义<br/>list_connections / query / execute /<br/>schema / preview / run_script"]
    end

    subgraph SVC["服务编排层"]
        MGR["lib/manager.ts<br/>ro/rw 项目授权校验 · 适配器生命周期 · 事务编排"]
    end

    subgraph SEC["安全层"]
        GUARD["lib/guard<br/>SQL/命令分类 · 危险操作识别 ·<br/>一次性 challenge 确认（5 分钟有效）"]
        STORE["lib/store<br/>connections · grants · secrets（脱敏）·<br/>audit 审计 · normalize · io"]
        SCRIPT["lib/script<br/>runner.ts + worker.cjs<br/>子进程沙箱（vm realm · 禁文件 · 60s 超时）"]
    end

    subgraph ADPT["适配器层 lib/adapters（8 库）"]
        REG["index.ts<br/>kind → 工厂注册表 + driverMissingError"]
        SQLSHARED["sql-shared/<br/>common.ts（标识符/分页/规范化）<br/>pg-like.ts（PostgreSQL + GaussDB 共享）"]
        A1["mysql"]
        A2["postgresql"]
        A3["gaussdb<br/>vendor/gaussdb-pg 驱动加载"]
        A4["sqlite"]
        A5["redis"]
        A6["mongodb"]
        A7["oracle"]
        A8["dmdb"]
        TYPES["types.ts<br/>DatabaseAdapter 契约"]
    end

    subgraph DRV["驱动层"]
        D1["pg / mysql2 / sqlite3 / redis<br/>mongodb / oracledb / dmdb"]
        D2["vendor/gaussdb-pg<br/>openGauss-connector-nodejs 构建产物"]
    end

    CLIENT -->|HTTP| HTTP
    CLIENT -.->|注入| TOOL
    TOOL --> MGR
    MGR --> GUARD
    MGR --> STORE
    MGR --> SCRIPT
    MGR --> REG
    REG --> SQLSHARED
    REG --> A1 & A4 & A5 & A6 & A7 & A8
    A2 --> SQLSHARED
    A3 --> SQLSHARED
    SQLSHARED --> TYPES
    A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8 -.-> DRV
    SCRIPT -.->|db.query / db.execute 经完整 guard 链路| MGR
```

## 2. 请求时序（query 与危险操作确认流）

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户（聊天）
    participant T as DatabaseManager 工具
    participant M as lib/manager.ts
    participant G as lib/guard
    participant S as lib/store
    participant A as 适配器（8 库）
    participant DB as 数据库

    U->>T: query/execute（conn_id, sql）
    T->>S: 授权校验（项目路径 → 连接 → ro/rw）
    alt 未授权
        S-->>T: UNAUTHORIZED_PROJECT
    else ro 授权 + 写操作
        S-->>T: READ_ONLY（拒绝）
    else 通过
        T->>G: 语句分类
        alt 危险操作（DDL/DML/维护命令）
            G-->>T: NEEDS_CONFIRMATION + challengeId（一次性，5 分钟）
            T-->>U: 说明语句与风险，等待明确同意
            U->>T: 携同一 challengeId 重试
            T->>G: 校验 challenge（绑定语句 hash）
        end
        T->>M: 执行
        M->>A: query/execute（可选 database 跨库路由，pg/gaussdb）
        A->>DB: 参数化 SQL（ro 会话级 READ ONLY 双保险）
        DB-->>A: 结果
        A-->>T: 规范化结果（DECIMAL→string 等）
        T->>S: 审计记录
        T-->>U: {columns, rows, rowCount} / {affectedRows, message}
    end
```

## 3. 适配器体系（8 库 × 共享实现）

```mermaid
flowchart LR
    subgraph 契约
        T["types.ts<br/>DatabaseAdapter / TableInfo / ColumnInfo<br/>DbKind = 8 种"]
    end
    subgraph 工厂注册
        R["adapters/index.ts<br/>kind → lazy import 工厂<br/>缺失驱动 → driverMissingError（附构建提示）"]
    end
    subgraph SQL系共享
        PG["pg-like.ts<br/>PostgreSQL + GaussDB<br/>pool · ro 会话 · 跨库路由 ·<br/>库→schema→表 三层浏览"]
        CM["common.ts<br/>assertIdent · quoteIdent<br/>clampLimit/Offset · normalizeCell"]
    end
    subgraph 独立实现
        MY["mysql"]
        SQ["sqlite"]
        RD["redis（SCAN 禁 KEYS）"]
        MG["mongodb（强制显式 filter）"]
        OR["oracle"]
        DM["dmdb"]
    end
    PG --> CM
    MY & SQ & RD & MG & OR & DM -.-> CM
    R --> PG & MY & SQ & RD & MG & OR & DM
    PG -.->|"gaussdb 差异仅驱动加载<br/>createRequire vendor/gaussdb-pg"| G["gaussdb/index.ts"]
    T --- R
```

## 4. 模块分层职责（cbm layers 数据）

| 层 | 模块 | 特征 |
|---|---|---|
| entry | lib、script、e2e-mock | 仅出边（调用下游） |
| api | http | 含 13 条 HTTP 路由定义 |
| core | adapters（4 入 0 出）、store（12 入 0 出） | 高扇入核心，不依赖上层 |
| internal | manager（7 入 12 出）、tool、http | 编排枢纽 |
| leaf | guard | 仅入边，纯分类/判定 |

## 5. GaussDB 专项链路

```mermaid
flowchart TB
    T["DatabaseManager(query/execute/schema/preview, database=...)"] --> M["manager"]
    M --> A3["gaussdb/index.ts<br/>loadGaussDriver()：createRequire<br/>vendor/gaussdb-pg/packages/pg（CJS）"]
    A3 --> PL["sql-shared/pg-like.ts<br/>kind='gaussdb'"]
    PL -->|poolConfig：host/port 8000/user/password/database/ssl| P["PgLikePool"]
    PL -->|database 参数| PF["poolFor(db)：按库缓存池（Navicat 式跨库）"]
    PL -->|ro 模式| SRO["每个新连接 SET SESSION CHARACTERISTICS<br/>AS TRANSACTION READ ONLY（fail-closed）"]
    P --> DB[("GaussDB 服务端<br/>openGauss 协议")]
```

- 驱动构建：`scripts/build-gaussdb.sh` / `.ps1` → 克隆 openGauss-connector-nodejs → `vendor/gaussdb-pg/packages/pg`（gitignore）。
- 测试：`tests/adapters-sql/gaussdb.test.ts`（驱动加载/工厂，mock 离线）+ `pg-like.test.ts`（pg/gaussdb 共享行为）。
