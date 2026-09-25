/**
 * SQLite 适配器（better-sqlite3，同步 API 包装 Promise）。
 * fields.database / fields.path 为文件路径；ro 模式 readonly + fileMustExist 打开。
 */
// @ts-nocheck

import Database from 'better-sqlite3';
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

type SqliteDb = InstanceType<typeof Database>;

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
  let db: SqliteDb;
  try {
    db = readOnly
      ? new Database(file, { readonly: true, fileMustExist: true })
      : new Database(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`sqlite 打开失败 (${file}): ${msg}`);
  }

  return {
    kind: 'sqlite',
    connId: conn.meta.id,

    testConnect: () =>
      humanize('sqlite 连接测试', async () => {
        const row = db.prepare('SELECT sqlite_version() AS v').get() as
          | Record<string, unknown>
          | undefined;
        return { ok: true, serverInfo: `SQLite ${String(row?.v ?? '')}` };
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
