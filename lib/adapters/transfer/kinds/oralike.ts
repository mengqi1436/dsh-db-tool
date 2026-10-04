/**
 * Oracle / 达梦 DM 共用传输读写端（两库数据字典 ALL_* 与分页方言
 * `OFFSET n ROWS FETCH FIRST m ROWS ONLY` 一致，池来源与错误包装按 kind 注入）。
 *
 * 会话前置（专用连接上一次设置）：
 *  - TIME_ZONE = '+00:00'：TIMESTAMP WITH [LOCAL] TIME ZONE 读出统一 UTC 时刻语义；
 *  - NLS_NUMERIC_CHARACTERS = '. '：decimal 以字符串绑定经隐式 TO_NUMBER 时不随
 *    会话 NLS 逗号小数点整批 ORA-01722（评审已证伪默认安全）。
 *
 * ponytail: 目标建表不生成自增（IDENTITY/序列），显式插原值规避 DM IDENTITY_INSERT
 * 语义差异；oracle BOOLEAN（23c 前）落 NUMBER(1)，写端 boolean→1/0。
 */
import type { ResolvedConnection } from '../../types.js';
import { sanitizeIdentifier as oraSanitize } from '../../oracle/index.js';
import type {
  MidType,
  ShardKeyType,
  TransferCell,
  TransferColumn,
  TransferCursor,
  TransferReader,
  TransferRow,
  TransferTable,
  TransferWriter,
  WriteMode,
} from '../model.js';
import { safeDefaultExpr } from '../model.js';

/** 驱动无关的最小连接面（oracledb.Connection 与 dmdb DmConnLike 同构） */
export interface OraLikeConn {
  execute(sql: string, binds?: unknown[], opts?: Record<string, unknown>): Promise<{
    metaData?: Array<{ name: string }>;
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
  }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

export type OraLikePool = {
  getConnection(): Promise<OraLikeConn>;
  close(): Promise<void>;
};

/** DATA_TYPE → 中间类型（NUMBER 按 scale/precision 分档防窄列；TSLTZ 归 timestamptz） */
export function oraTypeToMid(dataType: string, precision?: number | null, scale?: number | null): MidType {
  const t = dataType.toUpperCase();
  if (t === 'NUMBER' || t === 'DECIMAL' || t === 'NUMERIC' || t === 'DEC') {
    const s = scale ?? 0;
    if (s === 0 && precision != null) {
      if (precision <= 9) return 'int';
      if (precision <= 18) return 'bigint';
    }
    return 'decimal';
  }
  if (t === 'FLOAT' || t === 'BINARY_FLOAT') return 'float';
  if (t === 'BINARY_DOUBLE' || t === 'DOUBLE' || t === 'REAL') return 'double';
  if (t === 'BIT' || t === 'BOOLEAN') return 'boolean';
  if (t === 'CLOB' || t === 'NCLOB' || t === 'LONG' || t === 'TEXT') return 'text';
  if (t === 'BLOB' || t === 'RAW' || t === 'LONG RAW' || t === 'BFILE' || t === 'BINARY' || t === 'VARBINARY' || t === 'IMAGE') return 'bytes';
  if (t === 'DATE') return 'datetime'; // Oracle DATE 含时间部分
  if (t.startsWith('TIMESTAMP')) return t.includes('TIME ZONE') ? 'timestamptz' : 'datetime';
  if (t === 'TIME') return 'time';
  return 'string'; // VARCHAR2/NVARCHAR2/CHAR/NCHAR/INTERVAL/其他
}

/** 中间类型 → Oracle 系目标列类型（DM 与 Oracle 同族；oracle 无原生 TIME/BOOLEAN 的降级在此） */
export function midToOraType(c: TransferColumn, isDm: boolean): string {
  switch (c.midType) {
    case 'int': return isDm ? 'INT' : 'NUMBER(10)';
    case 'bigint': return isDm ? 'BIGINT' : 'NUMBER(19)';
    case 'decimal': return isDm ? `DECIMAL(${c.precision ?? 38},${c.scale ?? 10})` : `NUMBER(${c.precision ?? 38},${c.scale ?? 10})`;
    case 'float': return isDm ? 'FLOAT' : 'BINARY_FLOAT';
    case 'double': return isDm ? 'DOUBLE' : 'BINARY_DOUBLE';
    case 'boolean': return isDm ? 'BIT' : 'NUMBER(1)';
    case 'string': return `VARCHAR2(${Math.min(Math.max(c.length ?? 255, 1), 4000)})`;
    case 'text': return isDm ? 'CLOB' : 'CLOB';
    case 'bytes': return 'BLOB';
    case 'json': return 'CLOB';
    case 'date': return 'DATE';
    case 'time': return isDm ? 'TIME' : 'VARCHAR2(64)'; // oracle 无原生 TIME：墙钟字符串保真
    case 'datetime': return 'TIMESTAMP';
    case 'timestamptz': return 'TIMESTAMP WITH TIME ZONE';
  }
}

/** 绑定值形态：bigint→字符串（整数串无 NLS 分隔符风险）、boolean→1/0（NUMBER(1)/BIT）、
 *  日期列统一 'YYYY-MM-DD HH:MM:SS' UTC 墙钟（col 缺省时不做日期归一） */
export function toOraBind(c: TransferCell, col?: TransferColumn): string | number | null | Uint8Array {
  if (c === null) return null;
  if (typeof c === 'bigint') return c.toString();
  if (typeof c === 'boolean') return c ? 1 : 0;
  if (
    typeof c === 'string' && col != null &&
    (col.midType === 'date' || col.midType === 'datetime' || col.midType === 'timestamptz')
  ) {
    return toOraDateTime(c);
  }
  return c;
}

/** 中间格式日期值（ISO 带 'Z' / 裸墙钟两种形态）→ 单一 UTC 墙钟串。
 *  Oracle/DM 隐式字符串→日期转换按会话 NLS_DATE_FORMAT（默认 'DD-MON-RR' 系）
 *  解析，ISO 'T'/'Z' 必抛 ORA-01861/01858——写端会话格式已对齐本形态（ensureSession） */
export function toOraDateTime(s: string): string {
  return s.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/i, '$1 $2');
}

function isOraDateMid(t: MidType): boolean {
  return t === 'date' || t === 'datetime' || t === 'timestamptz';
}

/** 会话前置语句（读端 ensureConn / 写端 ensureSession 共用），按 kind 分流：
 *  - 时区：Oracle 官方语法为 ALTER SESSION SET TIME_ZONE（Oracle SQL 手册）；
 *    DM 官方语法为 SET TIME ZONE '<值>'（《DM8 SQL 语言使用手册》3.14.1），
 *    Oracle 风格「ALTER SESSION SET TIME_ZONE」在 DM 手册查无出处，不得混用。
 *  - NLS_NUMERIC_CHARACTERS：Oracle 官方支持经 ALTER SESSION 设置；《DM8 SQL 语言
 *    使用手册》3.14 可经 ALTER SESSION 设置的 NLS 参数清单（NLS_DATE_LANGUAGE/
 *    NLS_DATE_FORMAT/NLS_TIMESTAMP_FORMAT/NLS_TIMESTAMP_TZ_FORMAT/NLS_SORT/
 *    CASE_SENSITIVE）不含该参数 → DM 不下发（发了被拒即静默失效；decimal 绑定
 *    的 NLS 保护仅 Oracle 会话适用）。
 *  - NLS 日期/时间戳格式：两库官方清单均含，统一 'YYYY-MM-DD HH24:MI:SS'，
 *    与 toOraDateTime 归一形态对齐（keyset/range 分片键以字符串绑定做 k > lo
 *    比较，否则 ISO 串按默认 DD-MON-RR 隐式转换整批 ORA-01861）。
 *  调用方对单条失败吞错（兼容差异不影响主路径）。 */
export function oralikeSessionStmts(kind: 'oracle' | 'dmdb'): string[] {
  const nlsFormats = [
    "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'",
    "ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS'",
    "ALTER SESSION SET NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD HH24:MI:SS'",
  ];
  return kind === 'dmdb'
    ? ["SET TIME ZONE '+00:00'", ...nlsFormats]
    : ["ALTER SESSION SET TIME_ZONE = '+00:00'", "ALTER SESSION SET NLS_NUMERIC_CHARACTERS = '. '", ...nlsFormats];
}

/** 写端会话前置：日期统一按 'YYYY-MM-DD HH24:MI:SS'（+会话 UTC）隐式转换 */
async function ensureSession(conn: OraLikeConn, kind: 'oracle' | 'dmdb'): Promise<void> {
  for (const stmt of oralikeSessionStmts(kind)) {
    await conn.execute(stmt).catch(() => { /* 兼容差异：失败不影响主路径 */ });
  }
}

/** 行值保真：Date→ISO；Lob（CLOB 残留对象）→ getData 拉全量 */
async function materialize(v: unknown): Promise<TransferCell> {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return v;
  const lob = v as { getData?: () => Promise<string | Uint8Array>; close?: () => Promise<void> };
  if (typeof lob.getData === 'function') {
    const data = await lob.getData();
    // Lob 用毕防御性 close：dmdb 官方仅声明「ResultSet和Lob对象不支持并发操作」，
    // 未说明 getData 后是否必须 close（oracledb 官方要求 Lob 用毕 close）——
    // 驱动有 close 声明（index.d.ts Lob 接口）即调用，失败忽略
    try {
      await lob.close?.();
    } catch { /* 释放失败忽略 */ }
    return data === undefined ? null : (data as TransferCell);
  }
  return String(v);
}

function escIdent(name: string): string {
  return name.replaceAll('"', '""');
}

function sanitize(name: string, label: string): string {
  // oracle/dmdb 各自导出的 sanitizeIdentifier 语义一致（非空、≤128、无 NUL/换行）
  return oraSanitize(name, label);
}

export function createOraLikeTransferReader(
  kind: 'oracle' | 'dmdb',
  pool: OraLikePool,
  owner: string,
): TransferReader {
  // 专用连接：会话前置一次（时区/NLS，按 kind 分流见 oralikeSessionStmts），
  // 所有批读同连接保证游标一致性
  let conn: OraLikeConn | null = null;
  const ensureConn = async (): Promise<OraLikeConn> => {
    if (conn) return conn;
    conn = await pool.getConnection();
    for (const stmt of oralikeSessionStmts(kind)) {
      await conn.execute(stmt).catch(() => { /* 兼容差异：失败不影响主路径 */ });
    }
    return conn;
  };
  const exec = async (sql: string, binds?: unknown[]) =>
    (await (await ensureConn()).execute(sql, binds, { outFormat: 4002 /* OBJECT */, maxRows: 0, autoCommit: true })).rows ?? [];

  const describe = async (table: string): Promise<TransferTable> => {
    const own = sanitize(owner, 'owner');
    const tab = sanitize(table, '表名');
    const rows = await exec(
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_PRECISION, DATA_SCALE, CHAR_LENGTH, NULLABLE, DATA_DEFAULT
       FROM ALL_TAB_COLUMNS WHERE OWNER = :o AND (TABLE_NAME = :t OR TABLE_NAME = UPPER(:t))
       ORDER BY COLUMN_ID`,
      [own, tab],
    );
    if (rows.length === 0) throw new Error(`表不存在: ${own}.${tab}`);
    const pks = await exec(
      `SELECT COLS.COLUMN_NAME FROM ALL_CONSTRAINTS CONS
       JOIN ALL_CONS_COLUMNS COLS ON CONS.OWNER = COLS.OWNER AND CONS.CONSTRAINT_NAME = COLS.CONSTRAINT_NAME
       WHERE CONS.CONSTRAINT_TYPE = 'P' AND CONS.OWNER = :o AND (CONS.TABLE_NAME = :t OR CONS.TABLE_NAME = UPPER(:t))`,
      [own, tab],
    );
    const pkSet = new Set(pks.map((r) => String(Object.values(r)[0] ?? '')));
    const columns: TransferColumn[] = [];
    for (const r of rows) {
      const dataType = String(r.DATA_TYPE ?? '');
      const precision = r.DATA_PRECISION == null ? null : Number(r.DATA_PRECISION);
      const scale = r.DATA_SCALE == null ? null : Number(r.DATA_SCALE);
      const def = r.DATA_DEFAULT;
      columns.push({
        name: String(r.COLUMN_NAME ?? ''),
        midType: oraTypeToMid(dataType, precision, scale),
        sourceType: dataType,
        nullable: String(r.NULLABLE ?? 'Y') === 'Y',
        primaryKey: pkSet.has(String(r.COLUMN_NAME ?? '')),
        length: r.CHAR_LENGTH == null ? undefined : Number(r.CHAR_LENGTH),
        precision: precision ?? undefined,
        scale: scale ?? undefined,
        // DATA_DEFAULT 是 LONG 列：驱动可能返回字符串（thin 模式）或截断——白名单兜底
        default: def == null ? null : String(def).trim(),
      });
    }
    return { name: tab, columns };
  };

  return {
    kind,

    listTables: async () => {
      const own = sanitize(owner, 'owner');
      const rows = await exec(
        `SELECT TABLE_NAME FROM ALL_TABLES WHERE OWNER = :o ORDER BY TABLE_NAME`,
        [own],
      );
      return rows.map((r) => String(Object.values(r)[0] ?? ''));
    },

    describe,

    count: async (table) => {
      const own = escIdent(sanitize(owner, 'owner'));
      const tab = escIdent(sanitize(table, '表名'));
      const rows = await exec(`SELECT COUNT(*) AS N FROM "${own}"."${tab}"`);
      return Number(Object.values(rows[0] ?? {})[0] ?? 0);
    },

    shardKey: async (table) => {
      const t = await describe(table);
      const pks = t.columns.filter((c) => c.primaryKey);
      const pk = pks.length === 1 ? pks[0] : undefined;
      const sharable: ShardKeyType[] = ['int', 'bigint', 'decimal', 'string', 'datetime', 'timestamptz'];
      return pk && sharable.includes(pk.midType as ShardKeyType) ? (pk.midType as ShardKeyType) : null;
    },

    readBatch: async (table, cursor: TransferCursor, limit: number) => {
      const t = await describe(table);
      // 表/分片键与同文件 count/keyAt 同走 sanitize（防 NUL/换行/超长的统一防线）
      const tbl = `"${escIdent(sanitize(t.name, '表名'))}"`;
      const cols = t.columns.map((c) => `"${escIdent(c.name)}"`).join(', ');
      // 分片键（date 系列时为 materialize 产出的 ISO 串）先归一 UTC 墙钟再绑定
      const keyCol = cursor.mode === 'offset' ? undefined : t.columns.find((c) => c.name === cursor.column);
      const bindKey = (v: TransferCell): unknown =>
        typeof v === 'string' && keyCol != null && isOraDateMid(keyCol.midType) ? toOraDateTime(v) : toOraBind(v);
      let sql: string;
      let binds: unknown[];
      // ROW_LIMIT 子句语法图的 <offset>/<大小> 均为字面 <整数>（DM8 SQL 手册
      // 数据查询语句章），绑定占位符能否用于该位置无官方佐证 → 内联经 clamp 的
      // 整数（值源自编排层内部 offset/limit，非用户拼串，无注入面）
      const n = Math.max(1, Math.floor(limit) || 1);
      if (cursor.mode === 'keyset') {
        const key = `"${escIdent(sanitize(cursor.column, '分片键'))}"`;
        if (cursor.after === null) {
          sql = `SELECT ${cols} FROM ${tbl} ORDER BY ${key} OFFSET 0 ROWS FETCH FIRST ${n} ROWS ONLY`;
          binds = [];
        } else {
          sql = `SELECT ${cols} FROM ${tbl} WHERE ${key} > :after ORDER BY ${key} OFFSET 0 ROWS FETCH FIRST ${n} ROWS ONLY`;
          binds = [bindKey(cursor.after)];
        }
      } else if (cursor.mode === 'range') {
        const key = `"${escIdent(sanitize(cursor.column, '分片键'))}"`;
        const conds: string[] = [];
        const bindsArr: unknown[] = [];
        if (cursor.lo !== null) {
          conds.push(`${key} ${cursor.loInclusive ? '>=' : '>'} :lo`);
          bindsArr.push(bindKey(cursor.lo));
        }
        if (cursor.hi !== null) {
          conds.push(`${key} < :hi`);
          bindsArr.push(bindKey(cursor.hi));
        }
        const where = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
        sql = `SELECT ${cols} FROM ${tbl}${where} ORDER BY ${key} OFFSET 0 ROWS FETCH FIRST ${n} ROWS ONLY`;
        binds = bindsArr;
      } else {
        sql = `SELECT ${cols} FROM ${tbl} OFFSET ${Math.max(0, Math.floor(cursor.offset) || 0)} ROWS FETCH FIRST ${n} ROWS ONLY`;
        binds = [];
      }
      const rows = await exec(sql, binds);
      const out: TransferRow[] = [];
      for (const r of rows) {
        const row: TransferRow = [];
        for (const c of t.columns) {
          row.push(await materialize(r[c.name]));
        }
        out.push(row);
      }
      return out;
    },

    keyAt: async (table, column, offset) => {
      const own = escIdent(sanitize(owner, 'owner'));
      const key = `"${escIdent(sanitize(column, '分片键'))}"`;
      const rows = await exec(
        `SELECT ${key} AS K FROM "${own}"."${escIdent(sanitize(table, '表名'))}" ORDER BY ${key} OFFSET ${Math.max(0, Math.floor(offset) || 0)} ROWS FETCH FIRST 1 ROWS ONLY`,
      );
      return rows.length === 0 ? null : await materialize(Object.values(rows[0] ?? {})[0]);
    },

    close: async () => {
      if (conn) {
        await conn.close().catch(() => {});
        conn = null;
      }
      await pool.close().catch(() => {});
    },
  };
}

/** 写端：owner = 目标 schema（定位第一层，缺省连接用户默认 schema——调用方传
 *  ownerOfFromConn(rc)），表名以 owner 限定（reader 内 describe/listTables 同款样板） */
export function createOraLikeTransferWriter(
  kind: 'oracle' | 'dmdb',
  pool: OraLikePool,
  writeMode: WriteMode = 'insert',
  owner: string,
): TransferWriter {
  const ownerQ = escIdent(sanitize(owner, 'owner'));
  const qual = (name: string): string => `"${ownerQ}"."${escIdent(name)}"`;

  return {
    kind,

    tableExists: async (name) => {
      const conn = await pool.getConnection();
      try {
        const r = await conn.execute(
          `SELECT COUNT(*) AS N FROM ALL_TABLES WHERE OWNER = :o AND TABLE_NAME = :t`,
          [sanitize(owner, 'owner'), sanitize(name, '表名')],
          { maxRows: 1 },
        );
        const rows = r.rows ?? [];
        return Number(Object.values(rows[0] ?? {})[0] ?? 0) > 0;
      } finally {
        await conn.close().catch(() => {});
      }
    },
    dropTable: async (name) => {
      const conn = await pool.getConnection();
      try {
        await conn.execute(`DROP TABLE "${escIdent(sanitize(name, '表名'))}"`, [], { autoCommit: true });
      } finally {
        await conn.close().catch(() => {});
      }
    },
    // truncate 模式前置清空：TRUNCATE TABLE 重置高水位（Oracle/DM 官方手册；DDL 隐式提交，此处独占前置时机无影响）
    beforeLoad: async (table) => {
      const conn = await pool.getConnection();
      try {
        // 同连接先设 DDL 锁等待：TRUNCATE 被活跃事务持有时默认无限等（oracle ddl_lock_timeout，DM 兼容）；
        // TRUNCATE 拿不到锁/遇外键（ORA-02266）降级 DELETE（行级锁有限等待）
        await conn.execute('ALTER SESSION SET DDL_LOCK_TIMEOUT = 15', [], { autoCommit: true }).catch(() => {});
        try {
          await conn.execute(`TRUNCATE TABLE ${qual(table.name)}`, [], { autoCommit: true });
        } catch {
          await conn.execute(`DELETE FROM ${qual(table.name)}`, [], { autoCommit: true });
        }
      } finally {
        await conn.close().catch(() => {});
      }
    },

    createTable: async (table) => {
      const isDm = kind === 'dmdb';
      const defs = table.columns.map((c) => {
        let d = `"${escIdent(c.name)}" ${midToOraType(c, isDm)}`;
        if (!c.nullable) d += ' NOT NULL';
        if (c.default != null) {
          const expr = safeDefaultExpr(c.default);
          if (expr != null) d += ` DEFAULT ${expr}`;
        }
        return d;
      });
      const conn = await pool.getConnection();
      try {
        // DDL 隐式提交（oracle/dm 同族语义）
        const pkCols = table.columns.filter((c) => c.primaryKey).map((c) => `"${escIdent(c.name)}"`);
        const pk = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : '';
        await conn.execute(`CREATE TABLE ${qual(table.name)} (${defs.join(', ')}${pk})`, [], { autoCommit: true });
      } finally {
        await conn.close().catch(() => {});
      }
    },

    writeBatch: async (table, rows: TransferRow[]) => {
      if (rows.length === 0) return 0;
      const cols = table.columns;
      const width = cols.length;
      for (const r of rows) {
        if (r.length !== width) {
          throw new Error(`行宽不匹配：期望 ${width} 列，实际 ${r.length} 列（表 ${table.name}）`);
        }
      }
      const colList = cols.map((c) => `"${escIdent(c.name)}"`).join(', ');
      const holders = cols.map((_, i) => `:b${i + 1}`).join(', ');
      const sql = `INSERT INTO ${qual(table.name)} (${colList}) VALUES (${holders})`;
      const conn = await pool.getConnection();
      try {
        await ensureSession(conn, kind);
        let written = 0;
        if (writeMode === 'ignore') {
          // 逐条 try：冲突行跳过（错误码 ORA-00001 / DM -6602 均含 "1" 唯一约束语义，
          // 以消息匹配唯一冲突而非精确码，兼容 DM 差异）
          for (const r of rows) {
            try {
              const res = await conn.execute(sql, r.map((v, i) => toOraBind(v, cols[i])), { autoCommit: false });
              written += res.rowsAffected ?? 0;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (/ORA-00001|唯一|unique|UNIQUE|[-\[]6602/.test(msg)) continue;
              throw e;
            }
          }
        } else if (writeMode === 'replace') {
          const pkCols = cols.filter((c) => c.primaryKey);
          if (pkCols.length === 0) throw new Error(`replace 模式需要主键：表 ${table.name} 无主键`);
          const delSql = `DELETE FROM ${qual(table.name)} WHERE ${pkCols
            .map((c, i) => `"${escIdent(c.name)}" = :d${i + 1}`)
            .join(' AND ')}`;
          for (const r of rows) {
            const keyBind = cols
              .map((c, i) => ({ c, v: r[i] }))
              .filter((x) => x.c.primaryKey)
              .map((x) => toOraBind(x.v ?? null, x.c));
            await conn.execute(delSql, keyBind, { autoCommit: false });
            const res = await conn.execute(sql, r.map((v, i) => toOraBind(v, cols[i])), { autoCommit: false });
            written += res.rowsAffected ?? 0;
          }
        } else {
          for (const r of rows) {
            const res = await conn.execute(sql, r.map((v, i) => toOraBind(v, cols[i])), { autoCommit: false });
            written += res.rowsAffected ?? 0;
          }
        }
        await conn.commit();
        return written;
      } catch (e) {
        try {
          await conn.rollback();
        } catch { /* 已断开忽略 */ }
        throw e;
      } finally {
        await conn.close().catch(() => {});
      }
    },

    close: async () => {
      await pool.close().catch(() => {});
    },
  };
}

/** 默认 owner：fields.user / URL userinfo（oracle/dm 单库多 schema 模型） */
export function ownerOfFromConn(rc: ResolvedConnection): string {
  if (rc.fields && typeof rc.fields.user === 'string' && rc.fields.user !== '') return rc.fields.user;
  if (rc.url) {
    try {
      const u = new URL(rc.url);
      if (u.username) return decodeURIComponent(u.username);
    } catch {
      // 解析失败交给上层错误
    }
  }
  throw new Error(`${rc.meta.kind} 连接缺少用户名（owner）`);
}
