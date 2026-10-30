# dsh-db-tool

[简体中文](README.md) | English

A DSH community plugin for operating databases safely from chat, with a sidebar management console and the `db-admin` skill. Architecture and interaction patterns follow [dsh-ssh-tunnel](https://github.com/thirsty5034/dsh-ssh-tunnel).

## Features

- **9 databases**: MySQL, PostgreSQL, GaussDB, SQLite, Redis, MongoDB, Oracle, DM (Dameng), and SQL Server
- **One tool, six actions**: `DatabaseManager` exposes `list_connections / query / execute / schema / preview / run_script` (`run_script` executes in a `node:vm` sandbox with a 60s timeout and only restricted `db.{query,execute}` handles)
- **Tiered permissions**: per-connection read-only (ro) / read-write (rw) plus project-scoped grants (`grants.json`: projectPathKey → connection → mode); unauthorized projects are always rejected
- **Dangerous-operation confirmation**: DDL / FLUSHALL / dropDatabase and the like first return `NEEDS_CONFIRMATION`; after confirmation in chat (model via ask) or in the SQL console (dialog), the retry carries a one-time `challengeId` (bound to the statement SHA256, 5-minute TTL)
- **Auditing**: every execution is appended to `audit.jsonl` (statement, danger level, confirmed or not, outcome)
- **Sidebar with 4 panels** (dsh-better-sidebar, zh/en): connections, project grants, data browser, SQL console
- **db-admin skill**: shipped with the plugin, covering dialect cheat sheets for all 9 databases, safety rules, and the confirmation flow

### SQL Console

The sidebar SQL console panel has been upgraded to a Navicat-style multi-tab editor (CodeMirror 6):

- **Multi-tab**: create/close/switch query tabs; each tab keeps its own SQL, result, and history (capped at 50 entries, expandable and click-to-refill)
- **Syntax highlighting & completion**: switches with the dialect — mysql→MySQL, postgresql/gaussdb→PostgreSQL, sqlite→SQLite, oracle/dmdb→PL/SQL, sqlserver→T-SQL (the MSSQL dialect from `@codemirror/lang-sql`); Redis/Mongo get keyword/method completion over plain text; table/column metadata is fetched to feed completion (up to 50 tables). If the editor bundle (`vendor/codemirror-sql.cjs`, built by `npm run build:codemirror`, chained after `npm run build`) fails to load, it silently falls back to a textarea
- **Shortcuts**: `Ctrl/Cmd+Enter` runs everything, `Ctrl/Cmd+Shift+Enter` runs the selection
- **Formatting**: dialect-aware formatting via sql-formatter (sqlserver→`transactsql`), falling back to the original text on parse failure
- **Per-statement execution**: statements are pre-classified client-side as read/write and routed to `/api/query` vs `/api/execute`; write statements are skipped and flagged under read-only grants; errors can jump to the offending statement
- **`GO` batch separator**: `GO` and `GO n` follow sqlcmd semantics — the preceding batch is repeated n times (`GO 0` / `GO 1` both mean once) and the `GO` line itself produces no statement; the repeat count is capped at **1000** (values above it are truncated) so one run cannot be amplified into an unbounded number of requests
- **Transactions**: begin/commit/rollback under rw grants (server-side sticky-connection session; idle sessions roll back after a 5-minute TTL and are audited; grant revocation takes effect immediately)
- **Result grid**: tri-state column sorting, pagination at 50 rows/page, click-to-copy cells, CSV/JSON export

## SQL Server Support Scope and Boundaries

Coverage: SQL Server 2008/2008R2 → 2022 and Azure SQL Database; the dialect and metadata queries only use SQL Server 2005+ constructs.

- **Connection form**: exclusively `sqlserver://user:password@host:port/db`, with query parameters `encrypt` / `trustServerCertificate` / `tdsVersion` / `instanceName` / `useUTC` / `tlsMinVersion` (names are case-insensitive; the field-by-field form accepts the same keys). `tdsVersion` defaults to `7_4` and accepts `7_3_A` / `7_3_B` / `7_2` / `7_1`; the port defaults to 1433, and when `instanceName` is set the port is ignored per tedious semantics (SQL Browser over UDP 1434); `tlsMinVersion` accepts `TLSv1` / `TLSv1.1` / `TLSv1.2` (case-sensitive; when omitted the Node default floor of TLSv1.2 applies) and only writes `cryptoCredentialsDetails.minVersion`, never `ciphers`; **`TLSv1.3` is not accepted** — tedious caps the TLS ceiling at `TLSv1.2` when no maximum is given, so setting `TLSv1.3` makes the minimum exceed the maximum and the handshake always fails; `ssl=true` is equivalent to `encrypt=true`. ADO.NET key/value connection strings (`Server=...;Database=...`) are **not** accepted.
  The defaults are `encrypt=true` + `trustServerCertificate=false` (the same as mssql's own defaults). **Before connecting to SQL Server 2008/2008R2, tell the two TLS failure families apart — their remedies are not interchangeable**: ① **certificate family** (`self signed certificate` / `unable to verify` / `CERT_`) — those instances typically use self-signed certificates, so append `?trustServerCertificate=true`; use `?encrypt=false` when the server does not force encryption; ② **protocol-version family** (`UNSUPPORTED_PROTOCOL` / `no protocols available` / `alert protocol version`) — client and server share no common TLS protocol version, so the handshake fails during version negotiation and certificate validation never runs; `trustServerCertificate=true` is therefore **useless** here. The real fix is enabling TLS 1.2 on the server (KB4057113 for 2008 R2 SP3, KB4057114 for 2008 SP4); when the server cannot be touched, `?tlsMinVersion=TLSv1` lowers the client floor to TLS 1.0 (the BoringSSL inside Electron still ships TLS 1.0 and was verified to handshake; tedious still caps the ceiling at TLS 1.2). For either family, setting `?tdsVersion=7_3_A` (2008) / `7_3_B` (2008R2) explicitly is recommended.
- **Authentication**: SQL authentication only (`user` / `password`). **Windows integrated authentication is not supported**, and neither is **Azure AD authentication**.
- **Dialect**: write `?` as the parameter placeholder — the adapter rewrites them in order to `@p1..@pN`; identifiers use `[x]` with `]` doubled as `]]`; database/table/column metadata goes through `sys.*` catalog views only (`sys.databases` / `sys.schemas` / `sys.objects` / `sys.columns` / `sys.types` / `sys.indexes` / `sys.extended_properties`), using 2005+ constructs only.
- **Paging is version-split**: after connecting it reads `SERVERPROPERTY('ProductMajorVersion')` (falling back to parsing the `ProductVersion` prefix) and caches the result; major ≥ 11 (2012+, including Azure SQL's 12) uses `ORDER BY (SELECT NULL) OFFSET n ROWS FETCH NEXT m ROWS ONLY`, while < 11 (2008/2008R2) degrades to a `ROW_NUMBER() OVER (ORDER BY (SELECT NULL))` subquery; a failed probe also takes the degraded branch.
- **decimal precision is side-dependent**: on the browsing side (`query` / `preview` / data-browser grid) **decimal/numeric is not guaranteed digit-exact** — tedious has already turned decimal into a JS number during parsing (>15 significant digits lose precision), and converting it to a string afterwards only prevents later numeric coercion (>1e21 also renders in scientific notation); ask for `CONVERT(nvarchar(...), col)` in SQL when you need digit-exact values. The transfer reader already does that conversion (`CONVERT(nvarchar(64), col)`) and binds strings on write, so precision never passes through JS floats.
- **Type mapping on the transfer side**: `hierarchyid` / `geometry` / `geography` move as binary (bytes) into `VARBINARY(MAX)` on the target — the values are preserved but **UDT type semantics are not** (no `ST_*` / `hierarchyid` methods on the target); `sql_variant` is read as `CONVERT(nvarchar(max), col)` text, so **the original type information is lost** (the driver returns scalars of the value's actual type, which cannot be moved uniformly); `text` / `ntext` / `xml` → `NVARCHAR(MAX)`, source `varchar` / `char` of length 4001–8000 also maps to `NVARCHAR(MAX)` class (capacity preserved, never silently narrowed), `varbinary` / `image` / `rowversion` → `VARBINARY(MAX)`, `decimal` / `numeric` / `money` → `DECIMAL`; `datetime2` is read via `CONVERT(nvarchar(33), col, 126)` and `time` via `CONVERT(nvarchar(16), col, 126)` for exactness.
- **ro read-only is weaker than MySQL/PG**: SQL Server has no equivalent session-level read-only statement. Under an ro grant the adapter's query gate has five checks: ① a first-word allowlist (`select / with / show / describe / desc / explain / use / set / help / table`); ② rejection of multiple statements (lexical: the moment anything follows a top-level semicolon); ③ rejection of `SELECT ... INTO` (token-level, so `into` inside strings, bracket identifiers, or comments is not a false positive); ④ rejection of `WITH ... (INSERT|UPDATE|DELETE|MERGE)`; ⑤ rejection of `OPENQUERY` / `OPENROWSET` / `OPENDATASOURCE` (their string arguments execute arbitrary statements remotely/unattended and cannot be audited, so even legitimate read-only remote queries are refused). The service layer also blocks `execute`, and the guard layer still requires confirmation for the same two "read head, write body" forms. **This is still application-level interception, not the same as a database-side read-only session**; use a database-side read-only account when you need strong isolation.
- **Data transfer**: writes use parameterized multi-row `VALUES` INSERTs (TDS caps a statement at 2100 parameters and a `VALUES` table constructor at 1000 rows, so rows per statement is the smaller of the two; replace/ignore go through `MERGE`). Transfer paging is version-split as well: 2012+ uses `OFFSET/FETCH`, while 2008/2008R2 degrades — ordered cursors (keyset/range) use `SELECT TOP (n) ... ORDER BY key`, and the offset full ordering plus `keyAt` chunking use `ROW_NUMBER() OVER (...)` subqueries; a failed version probe falls back to 0 and takes the conservative branch, so **transfer works on SQL Server 2008/2008R2 too**. Known limits: when the target table already exists and a column is IDENTITY, writing explicit values fails with error 544 (the plugin does not issue `SET IDENTITY_INSERT ON`); tables created by transfer do not generate IDENTITY columns. CREATE TABLE DDL can be rolled back inside an explicit transaction, so no Oracle/DM-style implicit-commit handling is needed.
- **Verification status**: this round ships offline unit tests only (Fake driver); the SQL Server path is **not verified against a live database**. The live smoke switch is `DBT_TEST_SQLSERVER_URL` (e.g. `sqlserver://sa:pw@host:1433/db`).
- **Driver packaging**: `mssql@12` lives in devDependencies only; at runtime the plugin loads `vendor/sqlserver-driver.cjs` built by `npm run build:sqlserver`. Reason: mssql → tedious → bl → readable-stream drags buffer/events/process/string_decoder into the production dependency tree, tripping the host's `dsh-app-boot` `require.resolve.paths` bug and failing the whole plugin load.
- **Error-message redaction**: when a connection URL fails to parse, the error text has the userinfo redacted and never echoes the plaintext password (errors reach `audit.jsonl` and the model context, so redaction is mandatory).
- **Not supported**: SQL Server 2005 (9.x) and earlier — neither supported nor verified; `tdsVersion=8_0` (TDS 8.0) and `encrypt='strict'` are also unsupported — SQL Server 2022 connects fine with the default `7_4`, and TDS 8.0 strict encryption is a later enhancement.

## Data Layout

`$DSH_HOME/db-tool/` (0700):

| File | Contents |
|---|---|
| `connections.json` | connection definitions (passwords masked as `***` in `urlSafe`) |
| `secrets.json` | 0600; password/URL credentials, never returned to the model |
| `grants.json` | project grants (normalized path → connId → ro/rw) |
| `audit.jsonl` | append-only audit log |

## Installation

Drivers for all 9 databases ship with the npm package (SQLite prefers the built-in `node:sqlite`, optionally `better-sqlite3`; the GaussDB driver is the official Huawei Cloud npm package `gaussdb-node`) — no build steps of any kind. The SQL Server driver is the exception in form: `mssql@12` lives in devDependencies only, and the runtime loads the bundled `vendor/sqlserver-driver.cjs` built by `npm run build:sqlserver` — mssql's production dependency tree pulls in buffer/events/process/string_decoder, which trips the host's resolve.paths bug. GaussDB authentication supports sha256 and md5; md5-sha256 hybrid and SM3 are not supported yet.

The only one-time interaction comes from oracledb: pnpm blocks its install script by default, which makes the first install report a failure — click **"Allow these scripts and retry"** in the DSH plugin installation UI to finish (the script only checks the Node version and prints a banner, so approving is risk-free; the approval is persisted to the profile and upgrades won't prompt again).

```bash
# npm (recommended)
dsh plugin --profile web add dsh-db-tool

# From GitHub source
dsh plugin --profile web add "dsh-db-tool@github:mengqi1436/dsh-db-tool"

# Local development
dsh plugin --profile web add "link:E:\path\to\dsh-db-tool"
```

### Desktop installation

DSH Desktop 0.2.0-rc.2+ bundles the `dsh` command — no separate Node or pnpm required:

1. **First use**: open the desktop menu bar, click **"Manage dsh command"**, and install the bundled CLI, which registers `dsh` on the system PATH.
2. **Install the plugin** (always pin an exact version: `@latest` falls back to an older release due to release-age checks):

   ```bash
   dsh plugin --profile desktop add dsh-db-tool@1.4.0 --registry=https://registry.npmjs.org/
   ```

   If you prefer an npm mirror, replace `--registry` with your mirror URL.
3. **Restart** the desktop app.

The MongoDB driver is bundled into the published package (`vendor/mongodb-driver.cjs`), so the dependency tree contains no mongodb/punycode — the desktop host is packed inside `app.asar` and cannot be host-patched, yet this plugin installs and loads there without any patch.

## Testing

```bash
npm test        # full offline mock suite (incl. e2e-mock end-to-end and adversarial cases)
npx tsc --noEmit
npx stryker run # mutation testing (lib/guard + lib/manager + lib/store, reports in reports/mutation/)
```

Live-database smoke tests (run only when set): `DBT_TEST_MYSQL_URL / DBT_TEST_PG_URL / DBT_TEST_REDIS_URL / DBT_TEST_DM_CONNECT / DBT_TEST_MONGO_URL / DBT_TEST_ORACLE_CONNECT / DBT_TEST_SQLSERVER_URL` (SQL Server in the form `sqlserver://sa:pw@host:1433/db`). The GaussDB, Oracle/Mongo, and SQL Server requirements are implemented per their official docs; anything not verified against live databases is annotated in code. **This round ships offline unit tests only (Fake driver) for SQL Server — no live-database verification.**

## Project Structure

```
lib/        host plugin (store / adapters×9 / guard / manager / http / index)
client/     sidebar single-file artifact (client.js — this is the source)
skills/     db-admin skill
scripts/    build & tooling scripts (MongoDB / SQL Server driver and CodeMirror editor bundles, DSH host hotfix patch:dsh, etc.)
patches/    DSH host dsh-app-boot hotfix patches (selected by host version for patch:dsh)
docs/       reserved (currently empty)
tests/      vitest (offline mocks + DBT_TEST_*-gated live runs)
vendor/     mongodb-driver.cjs, sqlserver-driver.cjs and codemirror-sql.cjs bundles (gitignored; shipped via the files whitelist)
```

## License

MIT
