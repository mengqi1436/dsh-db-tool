/**
 * node-oracledb 最小类型声明。
 *
 * 背景：npm 上的 oracledb 7.0.1 未附带 .d.ts，@types/oracledb 亦未在项目依赖中。
 * 仅声明本插件用到的 API 面；后续若引入 @types/oracledb，可删除本文件。
 * 与官方 API 的一致性以 node-oracledb 文档为准（thin 模式，DB 12.1+）。
 */
// @ts-nocheck

declare module 'oracledb' {
  namespace oracledb {
    interface PoolAttributes {
      user?: string;
      password?: string;
      connectString: string;
      poolMin?: number;
      poolMax?: number;
      poolTimeout?: number;
      /** 禁止使用：本插件不允许 SYSDBA 等特权连接 */
      privilege?: number;
    }

    interface ExecuteOptions {
      outFormat?: number;
      maxRows?: number;
      autoCommit?: boolean;
      /** 键为列名大写（如 'BLOB'），值为 { type: oracledb.STRING } 等 */
      fetchInfo?: Record<string, { type: number }>;
    }

    interface ColumnMetaData {
      name: string;
      dbTypeName?: string;
    }

    interface ExecuteResult {
      rows?: Record<string, unknown>[] | unknown[][];
      metaData?: ColumnMetaData[];
      rowsAffected?: number;
    }

    interface Lob {
      toString(): Promise<string>;
      close(): Promise<void>;
    }

    interface Connection {
      execute(sql: string, binds?: unknown, options?: ExecuteOptions): Promise<ExecuteResult>;
      commit(): Promise<void>;
      rollback(): Promise<void>;
      close(): Promise<void>;
    }

    interface Pool {
      getConnection(): Promise<Connection>;
      execute(sql: string, binds?: unknown, options?: ExecuteOptions): Promise<ExecuteResult>;
      close(): Promise<void>;
    }

    /** 查询结果按对象（{ columnName: value }）返回 */
    const OBJECT: number;
    /** CLOB 类型码（用于 fetchAsString） */
    const CLOB: number;
    /** STRING 类型码（用于 fetchInfo 将 BLOB 转 string） */
    const STRING: number;
    /** 全局 fetch 为字符串的类型列表（本插件会在加载时追加 CLOB） */
    let fetchAsString: number[];

    function createPool(poolAttributes: PoolAttributes): Promise<Pool>;
  }
  export = oracledb;
}
