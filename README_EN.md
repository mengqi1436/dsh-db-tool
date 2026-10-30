# dsh-db-tool

[简体中文](README.md) | English

Operate databases safely from DSH chat: 9 database engines, project-scoped grants, dangerous-operation confirmation, full audit logging, plus a right-sidebar console and SQL editor.

## Feature flow

The complete path of one database operation, from entry point to audit trail — both entry points share the same semantics, and every call must pass through two gates: project-level grants and statement-level risk classification.

![dsh-db-tool feature flow](assets/feature-flow.png)

[**Open the interactive version**](assets/feature-flow.html) — zoom, pan, path highlighting, and click any node to see its source evidence.

> Questions or suggestions? [Open an issue](https://github.com/mengqi1436/dsh-db-tool/issues/new/choose) (bug report and feature request templates provided).

---

## Supported databases

| Category | Databases |
|---|---|
| Relational | MySQL, PostgreSQL, GaussDB, SQLite, Oracle, Dameng DM, SQL Server |
| NoSQL | Redis, MongoDB |

Every engine supports connection, metadata browsing, query, preview and data transfer. Dialect differences are handled inside the adapters — callers only ever see `?` placeholders and a uniform result set.

---

## Core capabilities

### Model tool `DatabaseManager`

One tool, multiple actions — fewer ambiguities for the model to resolve:

| action | Purpose |
|---|---|
| `list_connections` | List available connections (credentials never included) |
| `query` | Run a read-only query, return columns and rows |
| `execute` | Run a write statement; dangerous operations require confirmation |
| `schema` | Inspect database/table/column structure |
| `preview` | Preview table data (paged, ≤50 rows per page) |
| `run_script` | Run a script in a sandbox that can call `db.query` / `db.execute` repeatedly |

`run_script` isolation: separate child process plus a `node:vm` sandbox, hard-killed 60 seconds after start, with only a restricted `db.{query,execute}` handle injected — no filesystem, network, or `require`.

### Project-scoped grants (ro / rw)

Grants are stored as project path → connection → mode (`grants.json`):

- **ro (read-only)**: query and browse allowed, every write rejected
- **rw (read-write)**: statements, scripts and transactions allowed

Connections are always rejected for projects without a grant. Changing the mode (including an rw→ro downgrade) invalidates existing sessions immediately — no reconnect needed.

On Windows, paths are normalized with NTFS case semantics, so `E:\GitHub\MyApp` and `e:\github\myapp` resolve to the same project.

### Dangerous-operation confirmation

DDL, `FLUSHALL`, `dropDatabase` and similar statements return `NEEDS_CONFIRMATION` instead of executing:

1. The first call returns a pending state and a one-time `challengeId`
2. The `challengeId` is bound to the statement's SHA256, valid for 5 minutes and single-use
3. Execution happens only when retried with the same `challengeId` after user confirmation

Confirmation comes through chat for model calls and through a dialog in the SQL console — both share the same semantics, so neither can bypass the gate.

### Full audit logging

Every execution — including rejected requests — appends one line to `audit.jsonl`: statement, danger level, whether it was confirmed, result and duration. The right sidebar tails it live.

### Data browsing

- Four-level tree: connection → database → schema → table
- Database filter plus cross-database fuzzy table search (MySQL / PostgreSQL / GaussDB use native `information_schema` queries; other engines fall back to in-memory filtering)
- Table structure and data preview, with sortable/paged grids and cell copy

### SQL console

A Navicat-style multi-tab editor in the right sidebar (CodeMirror 6):

- **Multiple tabs**: each keeps its own SQL, results and history (50 entries, click to refill)
- **Highlighting and completion**: dialect switches automatically (MySQL / PostgreSQL / SQLite / PL/SQL / T-SQL), with table/column metadata injected into completion
- **Shortcuts**: `Ctrl/Cmd+Enter` runs everything, `Ctrl/Cmd+Shift+Enter` runs the selection
- **Formatting**: sql-formatter per dialect, falling back to the original text when parsing fails
- **Per-statement execution**: statements are pre-classified client-side and routed to the query or execute channel separately; writes are skipped and marked under an ro grant
- **`GO` batch separator**: `GO` and `GO n` follow sqlcmd semantics (`GO 0` / `GO 1` both mean one pass), with a repeat cap of 1000 to prevent amplification
- **Transactions**: begin/commit/rollback under an rw grant on a sticky server-side connection; idle sessions roll back automatically after 5 minutes and are audited
- **Result grid**: three-state sorting, 50 rows per page, CSV/JSON export

### Data transfer

Move table data between databases of the same or different engines:

- **Write modes**: `insert` (append), `ignore` (skip conflicts), `replace` (overwrite), `truncate` (clear first)
- **Automatic DDL**: the target table is created from the source structure when missing
- **Paged reads**: keyset, range and offset strategies, selected automatically per target version
- **Progress and history**: live progress plus per-project transfer history

### Connection export / import

Export all connections (including passwords) to a passphrase-encrypted file for cross-machine migration:

- scrypt-derived key with AES-256-GCM over the whole payload — the file contains no plaintext
- Minimum passphrase length of 8 characters, enforced server-side
- Imports skip any connection id that already exists and report an "imported / skipped / failed" summary

---

## Right sidebar

One tab registered through the official DSH right sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`) — no third-party sidebar required. When the panel is expanded, **Databases** appears as a card on the sidebar's guide (empty-state) page and can sit next to, split with, or float out as a floating window alongside any other official tab. The tab holds five panels (bilingual):

| Panel | Purpose |
|---|---|
| Connections | Add, edit, delete connections; test connectivity; export/import |
| Grants | Tick ro/rw per connection for the current project |
| Browse | Tree navigation, search and data preview |
| SQL Console | Multi-tab editor, transactions, history, result grid |
| Transfer | Table-level data migration with batch/parallelism and write modes, plus a transfer log |

### Notes

Both are contract behaviours of the official right sidebar and are easy to mistake for plugin defects:

- **Without a selected session the right sidebar shows no database panel.** The official right sidebar keys its layout state by session id, so with no session there is no docking surface — hence no guide card and no tab. Select a session first, then expand the right sidebar.
- **If the only ready entry card is the database one, the "+" new-pane button opens the database tab directly instead of the guide page.** This is the official default-page rule (exactly one entry opens that page; zero or several entries open the guide), not a failure to show the guide.

---

## Security model

| Layer | Mechanism |
|---|---|
| Storage | Passwords and full URLs live in `secrets.json` (0600) and are never returned to the model; credentials in data returned to the UI are redacted to `***` |
| Authorization | Project-scoped ro/rw allowlist — no grant means rejection |
| Statement level | Risk classification (danger / warning / none) plus one-time confirmation |
| Read-only enforcement | MySQL/PG use session-level `SET TRANSACTION READ ONLY`; SQL Server has no equivalent, so it degrades to five application-level gates (below) |
| Error redaction | When URL parsing fails, userinfo is redacted from the error text so plaintext passwords never appear |
| Script isolation | Separate child process, vm sandbox, 60s hard kill, only the `db` handle injected |

**SQL Server's ro enforcement is weaker than MySQL/PG**: SQL Server has no equivalent session-level read-only statement, so under an ro grant five application-level gates apply — first-word allowlist, multi-statement rejection, `SELECT ... INTO` rejection, `WITH ... (INSERT|UPDATE|DELETE|MERGE)` rejection, and `OPENQUERY`/`OPENROWSET`/`OPENDATASOURCE` rejection. This remains application-level interception; for hard isolation, configure a database-side read-only account for the connection.

---

## SQL Server connection notes

Covers SQL Server 2005 (9.0) through 2025 (17.0) and Azure SQL Database.

**For normal use you only fill in host, port, user and password** (plus the database). Encryption and certificate parameters are not your problem. The form shows only those four required fields; everything else lives in a collapsed **Advanced options** section you open only when troubleshooting.

### Default encryption policy: prefer plaintext, upgrade automatically when the server insists

New connections default to `encrypt=auto` (the default option in the form's encryption field):

1. Connect **without encryption** first — instances that do not force encryption (typically self-hosted, on an intranet) connect right away, no longer blocked by a self-signed certificate or an extra TLS layer.
2. If the server **forces encryption** (`EENCRYPT` / "server requires encryption", e.g. `Force Encryption=Yes` or Azure SQL), retry **once** with `encrypt=true` + `trustServerCertificate=true`. The user does not see this.

**Boundaries of the automatic retry (deliberately narrow — not an unlimited safety net)**:

- **Exactly one retry.** No retry chains; on failure the original error is surfaced.
- **Only for the "server forces encryption" cause.** Certificate-validation failures, TLS-version negotiation failures, bad credentials and everything else do **not** trigger a retry — blind retrying would bury the real cause and send troubleshooting in the wrong direction.
- **No retry at all when `encrypt` is set explicitly** to `true` / `false` / `strict`. The policy you specify is final; the tool does not second-guess it.

**On a server that does not force encryption, `auto` behaves exactly like `encrypt=false`, i.e. cleartext transmission** — that is the cost of this default; see "What `encrypt=false` really does" below. Do not skip it.

**Connection URL parameters** (for advanced users and troubleshooting — **not needed** for everyday connections; the field-by-field form supports the same set):

| Parameter | Values | Default |
|---|---|---|
| `encrypt` | `auto` / `true` / `false` / `strict` | `auto` (unencrypted first; upgrade with certificate trust when the server forces encryption — one retry only) |
| `trustServerCertificate` | `true` / `false` | `false` |
| `tdsVersion` | `7_4` / `7_3_A` / `7_3_B` / `7_2` / `7_1` | `7_4` (negotiated down automatically; normally leave unset) |
| `tlsMinVersion` | `TLSv1` / `TLSv1.1` / `TLSv1.2` | unset (Node default TLSv1.2) |
| `serverName` | Name to validate against the server certificate | unset (validate against the connected host) |
| `caCert` | PEM file path or certificate text | unset (use the system trust store) |
| `instanceName` | Named instance (mutually exclusive with port) | — |
| `useUTC` | `true` / `false` | `true` |

`caCert` / `serverName` / `trustServerCertificate` / `tlsMinVersion` / `tdsVersion` all live in the **Advanced options** section of the form (collapsed by default); they exist for certificate and legacy-instance troubleshooting and are not needed for normal connections.

**You do not need to pick a TDS version**: the client always declares `7.4` and the server negotiates down to what it supports (2005→7.2, 2008→7.3.A, 2008 R2→7.3.B). This is mandated by [MS-TDS](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/773a62b6-ee89-4c02-9e5e-344882630aac) (when the client declares a higher version, the server **must** use the highest version it supports). `tdsVersion` remains only as a troubleshooting override.

**When connecting to older instances, tell the two TLS failure families apart — their remedies are orthogonal and not interchangeable**:

- **Certificate family** (`self signed certificate` / `unable to verify` / `CERT_`) → fails during certificate validation. ① Prefer installing the trusted CA via `?caCert=` (validation still applies); if the certificate names a host but you connect by IP, also set `?serverName=`. ② Only as a last resort use `?trustServerCertificate=true` to skip validation, or `?encrypt=false` when the server does not force encryption.
- **Protocol-version family** (`UNSUPPORTED_PROTOCOL` / `no protocols available` / `alert protocol version`) → client and server share no common TLS version, so the handshake fails during negotiation and **certificate validation never runs**; `trustServerCertificate` is useless here. The real fix is enabling TLS 1.2 on the server (KB4057113 for 2008 R2 SP3, KB4057114 for 2008 SP4, corresponding CU/GDR plus KB3052404 for 2012/2014); when the server cannot be touched, lower the client floor with `?tlsMinVersion=TLSv1`.

TLS 1.2 support by version: 2016+ has it natively; 2012 SP4 / 2014 SP2 and later have it natively, earlier service packs need patches; 2008 / 2008 R2 need the updates above; **SQL Server 2005 has no patch that adds TLS 1.2** (officially "TLS 1.2 support is offered only for SQL Server 2008 and later"), so lowering the client TLS floor is the only option. See [KB3135244](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/connect/tls-1-2-support-microsoft-sql-server).

**What `encrypt=false` really does (verified by packet capture — do not read it as "just unencrypted data")**:

- When the server does **not** force encryption (PRELOGIN replies `OFF`/`NOT_SUP`), `encrypt=false` **skips the TLS handshake entirely and sends LOGIN7 — including the credentials — in cleartext**. Measured against a fake TDS server: the client's next packet is `0x10` (LOGIN7) with no handshake at all. **This is plaintext transmission; never use it outside a trusted network.**
- When the server **does** force encryption (`Force Encryption=Yes`, Azure SQL), `encrypt=false` is rejected ("server requires encryption"), so encryption is still mandatory there.
- Microsoft's "the login packet is always encrypted" statement applies **only when the server forces encryption or the client sets `encrypt=true`**; it must not be generalised into "`encrypt=false` still performs a TLS handshake".

Setting `encrypt=true` explicitly is therefore the secure setting; treat `encrypt=false` as an explicit downgrade.

**The same paragraph defines what the default `encrypt=auto` means for security**: the first step of `auto` is an unencrypted connection, so against a server that does not force encryption it behaves **exactly** like `encrypt=false` — credentials in cleartext. `auto` only upgrades to TLS when the server refuses plaintext; it is not "automatically encrypt for you", it is "try unencrypted first, encrypt only when rejected". Therefore:

- The default is fine on a **trusted intranet**; when the SQL Server is reached over the public internet or an untrusted segment, set `encrypt=true` explicitly (and use `caCert` / `serverName` for certificate issues) instead of relying on `auto`.
- Set `encrypt=true` explicitly when you need a guaranteed secure setting: explicit values never retry, so behaviour is fully predictable.
- Treat both `encrypt=false` and `encrypt=auto` as an **explicit downgrade**, not as "just left the advanced options closed".

**`encrypt=strict` (TDS 8.0)**: only supported by SQL Server 2022+ instances with Force Strict Encryption enabled. In this mode TLS completes before the login packet, so **`trustServerCertificate` has no effect at all** (the driver omits `rejectUnauthorized` and validation is mandatory); use `caCert` or `serverName` instead.

`tlsMinVersion` does not include `TLSv1.3`: the underlying tedious driver caps the TLS ceiling at 1.2, so setting 1.3 makes the minimum exceed the maximum and the handshake always fails.

**System trust store**: the plugin merges the OS trust store into certificate validation (`tls.getCACertificates('system')`, requires Node ≥ 22.15; the DSH desktop ships Node 24.21). Importing a self-signed certificate into the Windows "Trusted Root Certification Authorities" store is therefore enough — **no `caCert` needed**. The injected list is bundled + system merged (measured 118 + 72 = 190); merging rather than replacing avoids breaking public-CA connections. On older runtimes without that API nothing is injected and Node's native default applies.

**Other boundaries**: SQL authentication only (Windows integrated authentication and Azure AD are not supported); SQL Server 2000 and earlier are not supported; `tdsVersion=8_0` is not supported (TDS 8.0 is enabled via `encrypt=strict`).

---

## Installation

```bash
# npm (recommended)
dsh plugin --profile web add dsh-db-tool

# From GitHub source
dsh plugin --profile web add "dsh-db-tool@github:mengqi1436/dsh-db-tool"

# Local development
dsh plugin --profile web add "link:/path/to/dsh-db-tool"
```

### Desktop app

DSH desktop 0.2.0-rc.2+ bundles the `dsh` command:

1. Open the desktop menu bar and click **"Manage dsh command"** to register `dsh` on your PATH
2. Install the plugin (npm installs must pin an exact version — `@latest` falls back to an older release due to release-age checks):

   ```bash
   dsh plugin --profile desktop add dsh-db-tool@1.9.4 --registry=https://registry.npmjs.org/
   ```

3. **Restart the desktop app** to load it

**About oracledb**: its install script is blocked by pnpm by default, so the first install reports a failure. Click **"Allow these scripts and retry"** in the DSH plugin installer — the script only performs a Node version check and prints a banner, approving it is safe, and the approval persists to your profile so later upgrades do not prompt again.

**Runtime requirement**: Node.js ≥ 22. Some database drivers (tedious and its Azure dependencies) require Node 22+; on Node 20 connections fail with `Promise.withResolvers is not a function`.

**Where the UI is mounted**: the database panel docks into DSH's built-in right sidebar — no extra sidebar plugin needs installing. `dsh.client.inject` already declares `@deepseek-ai/dsh-client-ui-sidebar-right` as a load prerequisite.

---

## Data layout

`$DSH_HOME/db-tool/` (directory mode 0700):

| File | Contents |
|---|---|
| `connections.json` | Connection definitions (passwords redacted to `***` in `urlSafe`) |
| `secrets.json` | Mode 0600; passwords and full URLs, never returned to the model |
| `grants.json` | Project grants (normalized path → connId → ro/rw) |
| `audit.jsonl` | Append-only audit log, one JSON object per line |

---

## Development

```bash
npm install
npm run build        # compile + build vendor bundles (mongodb / sqlserver / codemirror)
npm test             # full vitest suite
npm run typecheck    # tsc --noEmit
```

Integration smoke tests are gated by environment variables and only run when set:

```
DBT_TEST_MYSQL_URL / DBT_TEST_PG_URL / DBT_TEST_REDIS_URL / DBT_TEST_DM_CONNECT
DBT_TEST_MONGO_URL / DBT_TEST_ORACLE_CONNECT / DBT_TEST_SQLSERVER_URL
```

CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml): Node 22 and 24, running `npm ci → build → typecheck → test`.

### Repository layout

```
lib/          plugin core
  adapters/   nine database adapters plus transfer implementations
  store/      connection / grant / audit / secret storage
  guard/      statement risk classification
  manager.ts  business orchestration (auth, dispatch, confirm, audit)
  http/       right-sidebar HTTP routes
  script/     run_script sandbox and child process
client/       right-sidebar single-file bundle
skills/       db-admin skill
scripts/      build and tooling scripts
patches/      DSH host hotfix patches
tests/        vitest (offline mocks plus gated integration tests)
assets/       feature flow diagram
vendor/       driver and editor bundles (build artifacts, included on publish)
```

---

## License

[Apache License 2.0](LICENSE) © 2026 mengqi1436

Free to use commercially, modify, distribute and sublicense, provided copyright and license notices are retained and modified files are marked. The included patent grant is irrevocable, but terminates if you bring a patent suit over this work.
