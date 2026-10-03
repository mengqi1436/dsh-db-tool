# dsh-db-tool

[简体中文](README.md) | English

A DSH community plugin for operating databases safely from chat, with a sidebar management console and the `db-admin` skill. Architecture and interaction patterns follow [dsh-ssh-tunnel](https://github.com/thirsty5034/dsh-ssh-tunnel).

## Features

- **8 databases**: MySQL, PostgreSQL, GaussDB, SQLite, Redis, MongoDB, Oracle, and DM (Dameng)
- **One tool, six actions**: `DatabaseManager` exposes `list_connections / query / execute / schema / preview / run_script` (`run_script` executes in a `node:vm` sandbox with a 60s timeout and only restricted `db.{query,execute}` handles)
- **Tiered permissions**: per-connection read-only (ro) / read-write (rw) plus project-scoped grants (`grants.json`: projectPathKey → connection → mode); unauthorized projects are always rejected
- **Dangerous-operation confirmation**: DDL / FLUSHALL / dropDatabase and the like first return `NEEDS_CONFIRMATION`; after confirmation in chat (model via ask) or in the SQL console (dialog), the retry carries a one-time `challengeId` (bound to the statement SHA256, 5-minute TTL)
- **Auditing**: every execution is appended to `audit.jsonl` (statement, danger level, confirmed or not, outcome)
- **Sidebar with 4 panels** (dsh-better-sidebar, zh/en): connections, project grants, data browser, SQL console
- **db-admin skill**: shipped with the plugin, covering dialect cheat sheets for all 8 databases, safety rules, and the confirmation flow

### SQL Console

The sidebar SQL console panel has been upgraded to a Navicat-style multi-tab editor (CodeMirror 6):

- **Multi-tab**: create/close/switch query tabs; each tab keeps its own SQL, result, and history (capped at 50 entries, expandable and click-to-refill)
- **Syntax highlighting & completion**: switches with the dialect — mysql→MySQL, postgresql/gaussdb→PostgreSQL, sqlite→SQLite, oracle/dmdb→PL/SQL; Redis/Mongo get keyword/method completion over plain text; table/column metadata is fetched to feed completion (up to 50 tables). If the editor bundle (`vendor/codemirror-sql.cjs`, built by `npm run build:codemirror`, chained after `npm run build`) fails to load, it silently falls back to a textarea
- **Shortcuts**: `Ctrl/Cmd+Enter` runs everything, `Ctrl/Cmd+Shift+Enter` runs the selection
- **Formatting**: dialect-aware formatting via sql-formatter, falling back to the original text on parse failure
- **Per-statement execution**: statements are pre-classified client-side as read/write and routed to `/api/query` vs `/api/execute`; write statements are skipped and flagged under read-only grants; errors can jump to the offending statement
- **Transactions**: begin/commit/rollback under rw grants (server-side sticky-connection session; idle sessions roll back after a 5-minute TTL and are audited; grant revocation takes effect immediately)
- **Result grid**: tri-state column sorting, pagination at 50 rows/page, click-to-copy cells, CSV/JSON export

## Data Layout

`$DSH_HOME/db-tool/` (0700):

| File | Contents |
|---|---|
| `connections.json` | connection definitions (passwords masked as `***` in `urlSafe`) |
| `secrets.json` | 0600; password/URL credentials, never returned to the model |
| `grants.json` | project grants (normalized path → connId → ro/rw) |
| `audit.jsonl` | append-only audit log |

## Installation

Drivers for all 8 databases ship with the npm package (SQLite prefers the built-in `node:sqlite`, optionally `better-sqlite3`; the GaussDB driver is the official Huawei Cloud npm package `gaussdb-node`) — no build steps of any kind. GaussDB authentication supports sha256 and md5; md5-sha256 hybrid and SM3 are not supported yet.

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

Live-database smoke tests (run only when set): `DBT_TEST_MYSQL_URL / DBT_TEST_PG_URL / DBT_TEST_REDIS_URL / DBT_TEST_DM_CONNECT / DBT_TEST_MONGO_URL / DBT_TEST_ORACLE_CONNECT`. GaussDB, Oracle, and Mongo official requirements are implemented per their official docs; anything not verified against live databases is annotated in code.

## Project Structure

```
lib/        host plugin (store / adapters×8 / guard / manager / http / index)
client/     sidebar single-file artifact (client.js — this is the source)
skills/     db-admin skill
scripts/    build & tooling scripts (MongoDB driver / CodeMirror editor bundles, DSH host hotfix patch:dsh, etc.)
patches/    DSH host dsh-app-boot hotfix patches (selected by host version for patch:dsh)
docs/       reserved (currently empty)
tests/      vitest (offline mocks + DBT_TEST_*-gated live runs)
vendor/     mongodb-driver.cjs and codemirror-sql.cjs bundles (gitignored; shipped via the files whitelist)
```

## License

MIT
