/**
 * node-oracledb 最小类型声明。
 *
 * 背景：npm 上的 oracledb 7.0.1 未附带 .d.ts，@types/oracledb 亦未在项目依赖中。
 * 仅声明本插件用到的 API 面；后续若引入 @types/oracledb，可删除本文件。
 * 与官方 API 的一致性以 node-oracledb 文档为准（thin 模式，DB 12.1+）。
 */
declare module 'oracledb' {
  namespace oracledb {
    interface PoolAttributes {
      user?: string;
      password?: string;
      connectString: string;
      /** 连接池别名：驱动按模块级 poolCache 登记，缺省 'default'，重名抛 NJS-046 */
      poolAlias?: string;
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
      // fetchInfo 不再声明：其键是【列名】而非类型名（官方 connection.rst
      // 「Each column is specified by name」），无法按类型统一转换，官方已
      // 标记 deprecated——按类型转换走全局 fetchAsString/fetchAsBuffer。
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

    /** 官方 Lob 类（lob.rst）：成员 getData()/read()/close()/destroy() 等，
     *  没有 toString()（实测 Lob.prototype.toString 即 Object.prototype.toString）。
     *  getData() 的 Promise API：CLOB/BFILE → string，BLOB 等 → Buffer。 */
    class Lob {
      getData(): Promise<string | Buffer>;
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
    /** BLOB 类型码（用于 fetchAsBuffer） */
    const BLOB: number;
    /** 全局 fetch 为字符串的类型列表（本插件会在加载时追加 CLOB） */
    let fetchAsString: number[];
    /** 全局 fetch 为 Buffer 的类型列表（本插件会在加载时追加 BLOB） */
    let fetchAsBuffer: number[];

    function createPool(poolAttributes: PoolAttributes): Promise<Pool>;
  }
  export = oracledb;
}
