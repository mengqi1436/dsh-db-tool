/**
 * SQLite 适配器（同步 API 包装 Promise）。
 * fields.database / fields.path 为文件路径；ro 模式 readonly 打开。
 *
 * 驱动双路径（离线环境友好）：
 *  1. node:sqlite（Node ≥ 22.5 内置，零原生依赖，离线/无编译工具链环境直接可用）
 *  2. better-sqlite3（optionalDependency；预构建缺失或本地编译失败时 pnpm 会
 *     自动排除该包，不影响插件整体安装，动态加载失败时回退到明确报错）
 */
import type {
  AccessMode,
  AdapterFactory,
  ColumnInfo,
  DatabaseAdapter,
  ExecResult,
  QueryResult,
  ResolvedConnection,
  TableInfo,
} from '../types.js';
import { assertIdent, clampLimit, clampOffset, humanize, normalizeCell, quoteIdent } from '../sql-shared/common.js';

/** 两驱动的最小公共面（本适配器只用这些能力）。 */
interface SqliteStatement {
  columns(): { name: string }[];
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): { changes?: number | bigint };
}
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}
type SqliteCtor = new (
  file: string,
  opts?: { readOnly?: boolean; readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

interface DriverLoadResult {
  ctor: SqliteCtor;
  driver: 'node:sqlite' | 'better-sqlite3';
}

let cached: DriverLoadResult | null = null;
let cachedFor: string | undefined = '';

/**
 * 惰性加载驱动（缓存结果）；失败时抛带指引的错误。
 * 可用 DBT_SQLITE_DRIVER=node|better 强制单一路径（不回退），便于测试与显式选型。
 */
async function loadDriver(): Promise<DriverLoadResult> {
  const forced = process.env.DBT_SQLITE_DRIVER;
  if (cached && cachedFor === forced) return cached;
  const result = await (async (): Promise<DriverLoadResult> => {
    // 1) node:sqlite：Node 22.5+ 内置（22.5–23.3 需 --experimental-sqlite）。
    if (forced !== 'better') {
      try {
        const mod = await import('node:sqlite');
        const ctor = (mod as { DatabaseSync?: unknown }).DatabaseSync;
        if (typeof ctor === 'function') {
          return { ctor: ctor as SqliteCtor, driver: 'node:sqlite' };
        }
      } catch (e) {
        if (forced === 'node') throw new Error(`强制使用 node:sqlite 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // 2) better-sqlite3（optionalDependency，可能被离线环境排除或构建失败）。
    if (forced !== 'node') {
      try {
        const mod = (await import('better-sqlite3')) as { default?: unknown };
        if (mod && typeof mod.default === 'function') {
          return { ctor: mod.default as SqliteCtor, driver: 'better-sqlite3' };
        }
      } catch (e) {
        if (forced === 'better') throw new Error(`强制使用 better-sqlite3 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(
      'SQLite 驱动不可用：当前 Node 无内置 node:sqlite（需 Node ≥ 22.5），且可选依赖 better-sqlite3 未安装或构建失败。' +
        '请升级 Node 到 ≥ 22.5，或在具备编译工具链/预构建的环境执行 `npm install better-sqlite3`；' +
        '其他 7 种数据库不受影响。',
    );
  })();
  cached = result;
  cachedFor = forced;
  return result;
}

function resolveFile(conn: ResolvedConnection): string {
  if (conn.fields) {
    const f = conn.fields;
    const path = f.database ?? f.path ?? f.file;
    if (path != null && String(path) !== '') return String(path);
  }
  if (conn.url) {
    return conn.url.startsWith('file://') ? conn.url.slice('file://'.length) : conn.url;
  }
  throw new Error('sqlite 连接缺少文件路径（fields.database / fields.path 或 url）');
}

function toQueryResult(raw: Record<string, unknown>[], columns: string[]): QueryResult {
  return {
    columns,
    rows: raw.map((r) => columns.map((c) => normalizeCell(r[c]))),
    rowCount: raw.length,
  };
}

export async function createSqliteAdapter(
  conn: ResolvedConnection,
  opts?: { mode?: AccessMode },
): Promise<DatabaseAdapter> {
  const file = resolveFile(conn);
  const readOnly = opts?.mode === 'ro';
  const { ctor, driver } = await loadDriver();
  let db: SqliteDatabase;
  try {
    // 选项名按驱动区分：node:sqlite 用 readOnly（打开不存在文件即报错）；
    // better-sqlite3 用 readonly + fileMustExist。node:sqlite 不接受显式
    // undefined 作 options，rw 模式统一传空对象。
    db = driver === 'node:sqlite'
      ? new ctor(file, readOnly ? { readOnly: true } : {})
      : new ctor(file, readOnly ? { readonly: true, fileMustExist: true } : {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`sqlite 打开失败 (${file}, 驱动 ${driver}): ${msg}`);
  }

  return {
    kind: 'sqlite',
    connId: conn.meta.id,

    testConnect: () =>
      humanize('sqlite 连接测试', async () => {
        const row = db.prepare('SELECT sqlite_version() AS v').get() as
          | Record<string, unknown>
          | undefined;
        return { ok: true, serverInfo: `SQLite ${String(row?.v ?? '')} (${driver})` };
      }),

    query: (sql, params) =>
      humanize('sqlite 查询失败', async () => {
        const stmt = db.prepare(sql);
        const columns = stmt.columns().map((c) => c.name);
        const raw = stmt.all(...(params ?? [])) as Record<string, unknown>[];
        return toQueryResult(raw, columns);
      }),

    execute: (statement, params) =>
      humanize('sqlite 执行失败', async (): Promise<ExecResult> => {
        const stmt = db.prepare(statement);
        const info = stmt.run(...(params ?? []));
        const n = Number(info.changes);
        return {
          affectedRows: Number.isFinite(n) ? n : undefined,
          message: `执行成功，受影响 ${n} 行`,
        };
      }),

    listDatabases: () =>
      humanize('sqlite 列出数据库', async () => ['main']),

    listTables: () =>
      humanize('sqlite 列出表', async () => {
        const raw = db
          .prepare(
            `SELECT name, type FROM sqlite_master
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
          )
          .all() as Record<string, unknown>[];
        return raw.map((r): TableInfo => ({
          name: String(r.name),
          type: String(r.type).toUpperCase(),
        }));
      }),

    describeTable: (table) =>
      humanize('sqlite 查看表结构', async () => {
        const tbl = assertIdent(table, '表名');
        const raw = db
          .prepare(`PRAGMA table_info(${quoteIdent(tbl)})`)
          .all() as Record<string, unknown>[];
        if (raw.length === 0) throw new Error(`表不存在: ${tbl}`);
        return raw.map((r): ColumnInfo => {
          const dflt = r.dflt_value;
          const pk = Number(r.pk) > 0;
          return {
            name: String(r.name),
            dataType: String(r.type ?? ''),
            // 主键按非空展示（SQLite INTEGER PRIMARY KEY 即便 notnull=0 也不可存 NULL）
            nullable: Number(r.notnull) === 0 && !pk,
            key: pk ? 'PRI' : undefined,
            default: dflt == null ? null : String(dflt),
          };
        });
      }),

    previewRows: (table, limit, _database, offset) =>
      humanize('sqlite 预览行', async () => {
        const tbl = quoteIdent(assertIdent(table, '表名'));
        const lim = clampLimit(limit);
        const off = clampOffset(offset);
        const stmt = db.prepare(`SELECT * FROM ${tbl} LIMIT ? OFFSET ?`);
        const columns = stmt.columns().map((c) => c.name);
        const raw = stmt.all(lim, off) as Record<string, unknown>[];
        return toQueryResult(raw, columns);
      }),

    close: () =>
      humanize('sqlite 关闭连接', async () => {
        db.close();
      }),
  };
}

export const factory: AdapterFactory = (conn) => createSqliteAdapter(conn);
