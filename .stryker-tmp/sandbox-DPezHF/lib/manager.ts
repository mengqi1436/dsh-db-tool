/**
 * DatabaseManager：dsh-db-tool 服务核心。
 *
 *  - DbToolService：授权（GrantStore.check + normalizeProjectKey）→ guard 分类 →
 *    challenge 确认 → 适配器调用 → 审计。HTTP 与模型工具共用同一套语义。
 *  - handleToolAction：模型工具（单工具多 action）的纯分发层，便于离线测试。
 *  - run_script：子进程隔离执行（permission model 禁 fs + 新 vm realm 双层），
 *    60s SIGKILL 强超时，仅注入受限 db 句柄（经 IPC 走完整 guard/审计链路；
 *    ro 连接拒绝写句柄）。
 */
// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import type { ColumnInfo, ConnectionMeta, DatabaseAdapter, DbKind, ExecResult, QueryResult, TableInfo, TestConnectResult } from './adapters/types.js';
import { getAdapter, type AdapterFactory } from './adapters/index.js';
import { ChallengeStore, classifyStatement, type ChallengeScope, type GuardVerdict } from './guard/index.js';
import { DbToolStore, normalizeProjectKey, type AuditEntry, type DangerLevel } from './store/index.js';
import { runScriptInChild } from './script/runner.js';

/* ---------------- 错误与结果类型 ---------------- */

/** 携带机器可读 code 的业务错误（HTTP 层直接映射 {ok:false,error,code}） */
export class DbToolError extends Error {
  constructor(readonly code: 'UNAUTHORIZED_PROJECT' | 'READ_ONLY' | 'NEEDS_CONFIRMATION' | 'INVALID_CHALLENGE' | 'NOT_FOUND' | 'INVALID_ARGUMENT' | 'DRIVER_ERROR' | 'SCRIPT_TIMEOUT', message: string) {
    super(message);
    this.name = stryMutAct_9fa48("332") ? "" : (stryCov_9fa48("332"), 'DbToolError');
  }
}

/** 危险操作待确认（HTTP → {ok:false, code:'NEEDS_CONFIRMATION', ...}） */
export interface NeedConfirm {
  needConfirmation: true;
  challengeId: string;
  statement: string;
  danger: 'danger';
  reason: string;
}
export interface DbToolServiceOptions {
  /** 覆盖适配器工厂来源（测试注入假适配器；缺省用注册表 getAdapter） */
  adapterResolver?: (kind: DbKind) => Promise<AdapterFactory>;
  challenges?: ChallengeStore;
}
function assertNonEmpty(v: string | undefined, label: string): string {
  if (stryMutAct_9fa48("333")) {
    {}
  } else {
    stryCov_9fa48("333");
    const s = (stryMutAct_9fa48("336") ? typeof v !== 'string' : stryMutAct_9fa48("335") ? false : stryMutAct_9fa48("334") ? true : (stryCov_9fa48("334", "335", "336"), typeof v === (stryMutAct_9fa48("337") ? "" : (stryCov_9fa48("337"), 'string')))) ? stryMutAct_9fa48("338") ? v : (stryCov_9fa48("338"), v.trim()) : stryMutAct_9fa48("339") ? "Stryker was here!" : (stryCov_9fa48("339"), '');
    if (stryMutAct_9fa48("342") ? s !== '' : stryMutAct_9fa48("341") ? false : stryMutAct_9fa48("340") ? true : (stryCov_9fa48("340", "341", "342"), s === (stryMutAct_9fa48("343") ? "Stryker was here!" : (stryCov_9fa48("343"), '')))) throw new DbToolError(stryMutAct_9fa48("345") ? "" : (stryCov_9fa48("345"), 'INVALID_ARGUMENT'), stryMutAct_9fa48("346") ? `` : (stryCov_9fa48("346"), `缺少必填参数: ${label}`));
    return s;
  }
}

/* ---------------- 服务核心 ---------------- */

export class DbToolService {
  private readonly adapterCache = new Map<string, Promise<DatabaseAdapter>>();
  readonly challenges: ChallengeStore;
  private readonly resolver: (kind: DbKind) => Promise<AdapterFactory>;
  private disposed = stryMutAct_9fa48("347") ? true : (stryCov_9fa48("347"), false);
  constructor(readonly store: DbToolStore, opts?: DbToolServiceOptions) {
    if (stryMutAct_9fa48("348")) {
      {}
    } else {
      stryCov_9fa48("348");
      this.resolver = stryMutAct_9fa48("349") ? opts?.adapterResolver && getAdapter : (stryCov_9fa48("349"), (stryMutAct_9fa48("350") ? opts.adapterResolver : (stryCov_9fa48("350"), opts?.adapterResolver)) ?? getAdapter);
      this.challenges = stryMutAct_9fa48("351") ? opts?.challenges && new ChallengeStore() : (stryCov_9fa48("351"), (stryMutAct_9fa48("352") ? opts.challenges : (stryCov_9fa48("352"), opts?.challenges)) ?? new ChallengeStore());
    }
  }

  /* -- 连接管理（无需授权） -- */

  listConnections(): ConnectionMeta[] {
    if (stryMutAct_9fa48("353")) {
      {}
    } else {
      stryCov_9fa48("353");
      return this.store.connections.list();
    }
  }
  createConnection(input: Parameters<DbToolStore['connections']['create']>[0]): ConnectionMeta {
    if (stryMutAct_9fa48("354")) {
      {}
    } else {
      stryCov_9fa48("354");
      const meta = this.store.connections.create(input);
      this.audit(stryMutAct_9fa48("356") ? "Stryker was here!" : (stryCov_9fa48("356"), ''), input.id, stryMutAct_9fa48("357") ? "" : (stryCov_9fa48("357"), 'create_connection'), input.id, stryMutAct_9fa48("358") ? "" : (stryCov_9fa48("358"), 'none'), stryMutAct_9fa48("359") ? true : (stryCov_9fa48("359"), false), stryMutAct_9fa48("360") ? false : (stryCov_9fa48("360"), true));
      return meta;
    }
  }
  updateConnection(id: string, patch: Parameters<DbToolStore['connections']['update']>[1]): ConnectionMeta {
    if (stryMutAct_9fa48("361")) {
      {}
    } else {
      stryCov_9fa48("361");
      const meta = this.store.connections.update(id, patch);
      if (stryMutAct_9fa48("364") ? false : stryMutAct_9fa48("363") ? true : stryMutAct_9fa48("362") ? meta : (stryCov_9fa48("362", "363", "364"), !meta)) throw new DbToolError(stryMutAct_9fa48("366") ? "" : (stryCov_9fa48("366"), 'NOT_FOUND'), stryMutAct_9fa48("367") ? `` : (stryCov_9fa48("367"), `连接不存在: ${id}`));
      // url/凭证/ssl 变更后旧适配器仍持旧连接串，必须作废重建
      void this.dropAdapters(id);
      this.audit(stryMutAct_9fa48("369") ? "Stryker was here!" : (stryCov_9fa48("369"), ''), id, stryMutAct_9fa48("370") ? "" : (stryCov_9fa48("370"), 'update_connection'), id, stryMutAct_9fa48("371") ? "" : (stryCov_9fa48("371"), 'none'), stryMutAct_9fa48("372") ? true : (stryCov_9fa48("372"), false), stryMutAct_9fa48("373") ? false : (stryCov_9fa48("373"), true));
      return meta;
    }
  }
  removeConnection(id: string): boolean {
    if (stryMutAct_9fa48("374")) {
      {}
    } else {
      stryCov_9fa48("374");
      const ok = this.store.connections.remove(id);
      if (stryMutAct_9fa48("377") ? false : stryMutAct_9fa48("376") ? true : stryMutAct_9fa48("375") ? ok : (stryCov_9fa48("375", "376", "377"), !ok)) throw new DbToolError(stryMutAct_9fa48("379") ? "" : (stryCov_9fa48("379"), 'NOT_FOUND'), stryMutAct_9fa48("380") ? `` : (stryCov_9fa48("380"), `连接不存在: ${id}`));
      void this.dropAdapters(id);
      this.audit(stryMutAct_9fa48("382") ? "Stryker was here!" : (stryCov_9fa48("382"), ''), id, stryMutAct_9fa48("383") ? "" : (stryCov_9fa48("383"), 'remove_connection'), id, stryMutAct_9fa48("384") ? "" : (stryCov_9fa48("384"), 'none'), stryMutAct_9fa48("385") ? true : (stryCov_9fa48("385"), false), stryMutAct_9fa48("386") ? false : (stryCov_9fa48("386"), true));
      return ok;
    }
  }
  async testConnection(id: string): Promise<TestConnectResult> {
    if (stryMutAct_9fa48("387")) {
      {}
    } else {
      stryCov_9fa48("387");
      const rc = this.requireConn(id);
      try {
        if (stryMutAct_9fa48("388")) {
          {}
        } else {
          stryCov_9fa48("388");
          const factory = await this.resolver(rc.meta.kind);
          const adapter = await factory(rc);
          try {
            if (stryMutAct_9fa48("389")) {
              {}
            } else {
              stryCov_9fa48("389");
              return await adapter.testConnect();
            }
          } finally {
            if (stryMutAct_9fa48("390")) {
              {}
            } else {
              stryCov_9fa48("390");
              await adapter.close().catch(() => {});
            }
          }
        }
      } catch (e) {
        if (stryMutAct_9fa48("391")) {
          {}
        } else {
          stryCov_9fa48("391");
          throw this.toDriverError(e);
        }
      }
    }
  }

  /* -- 授权管理 -- */

  grantsFor(projectPath: string): {
    connId: string;
    mode: 'ro' | 'rw';
  }[] {
    if (stryMutAct_9fa48("392")) {
      {}
    } else {
      stryCov_9fa48("392");
      return this.store.grants.grantsFor(normalizeProjectKey(projectPath));
    }
  }
  grant(projectPath: string, connId: string, mode: 'ro' | 'rw'): void {
    if (stryMutAct_9fa48("393")) {
      {}
    } else {
      stryCov_9fa48("393");
      const key = normalizeProjectKey(projectPath);
      if (stryMutAct_9fa48("394")) {
        ;
      } else {
        stryCov_9fa48("394");
        this.store.grants.grant(key, connId, mode);
      } // 授权模式变更（含 rw→ro 降级）必须作废旧会话适配器，否则降级不生效
      void this.dropAdapters(connId);
      this.audit(key, connId, stryMutAct_9fa48("396") ? "" : (stryCov_9fa48("396"), 'grant'), stryMutAct_9fa48("397") ? `` : (stryCov_9fa48("397"), `${connId} -> ${mode}`), stryMutAct_9fa48("398") ? "" : (stryCov_9fa48("398"), 'none'), stryMutAct_9fa48("399") ? true : (stryCov_9fa48("399"), false), stryMutAct_9fa48("400") ? false : (stryCov_9fa48("400"), true));
    }
  }
  revokeGrant(projectPath: string, connId: string): void {
    if (stryMutAct_9fa48("401")) {
      {}
    } else {
      stryCov_9fa48("401");
      const key = normalizeProjectKey(projectPath);
      if (stryMutAct_9fa48("402")) {
        ;
      } else {
        stryCov_9fa48("402");
        this.store.grants.revoke(key, connId);
      }
      void this.dropAdapters(connId);
      this.audit(key, connId, stryMutAct_9fa48("404") ? "" : (stryCov_9fa48("404"), 'revoke'), connId, stryMutAct_9fa48("405") ? "" : (stryCov_9fa48("405"), 'none'), stryMutAct_9fa48("406") ? true : (stryCov_9fa48("406"), false), stryMutAct_9fa48("407") ? false : (stryCov_9fa48("407"), true));
    }
  }

  /* -- 浏览（ro 即可） -- */

  async databases(projectPath: string | undefined, connId: string): Promise<string[]> {
    if (stryMutAct_9fa48("408")) {
      {}
    } else {
      stryCov_9fa48("408");
      const {
        key,
        adapter
      } = await this.authorize(projectPath, connId, stryMutAct_9fa48("409") ? true : (stryCov_9fa48("409"), false));
      try {
        if (stryMutAct_9fa48("410")) {
          {}
        } else {
          stryCov_9fa48("410");
          const result = await adapter.listDatabases();
          this.audit(key, connId, stryMutAct_9fa48("412") ? "" : (stryCov_9fa48("412"), 'databases'), stryMutAct_9fa48("413") ? "" : (stryCov_9fa48("413"), 'listDatabases'), stryMutAct_9fa48("414") ? "" : (stryCov_9fa48("414"), 'none'), stryMutAct_9fa48("415") ? true : (stryCov_9fa48("415"), false), stryMutAct_9fa48("416") ? false : (stryCov_9fa48("416"), true));
          return result;
        }
      } catch (e) {
        if (stryMutAct_9fa48("417")) {
          {}
        } else {
          stryCov_9fa48("417");
          this.audit(key, connId, stryMutAct_9fa48("419") ? "" : (stryCov_9fa48("419"), 'databases'), stryMutAct_9fa48("420") ? "" : (stryCov_9fa48("420"), 'listDatabases'), stryMutAct_9fa48("421") ? "" : (stryCov_9fa48("421"), 'none'), stryMutAct_9fa48("422") ? true : (stryCov_9fa48("422"), false), stryMutAct_9fa48("423") ? true : (stryCov_9fa48("423"), false), this.errText(e));
          throw this.toDriverError(e);
        }
      }
    }
  }
  async tables(projectPath: string | undefined, connId: string, database?: string): Promise<TableInfo[]> {
    if (stryMutAct_9fa48("424")) {
      {}
    } else {
      stryCov_9fa48("424");
      const {
        key,
        adapter
      } = await this.authorize(projectPath, connId, stryMutAct_9fa48("425") ? true : (stryCov_9fa48("425"), false));
      try {
        if (stryMutAct_9fa48("426")) {
          {}
        } else {
          stryCov_9fa48("426");
          const result = await adapter.listTables(database);
          this.audit(key, connId, stryMutAct_9fa48("428") ? "" : (stryCov_9fa48("428"), 'tables'), stryMutAct_9fa48("429") ? database && 'default' : (stryCov_9fa48("429"), database ?? (stryMutAct_9fa48("430") ? "" : (stryCov_9fa48("430"), 'default'))), stryMutAct_9fa48("431") ? "" : (stryCov_9fa48("431"), 'none'), stryMutAct_9fa48("432") ? true : (stryCov_9fa48("432"), false), stryMutAct_9fa48("433") ? false : (stryCov_9fa48("433"), true));
          return result;
        }
      } catch (e) {
        if (stryMutAct_9fa48("434")) {
          {}
        } else {
          stryCov_9fa48("434");
          this.audit(key, connId, stryMutAct_9fa48("436") ? "" : (stryCov_9fa48("436"), 'tables'), stryMutAct_9fa48("437") ? database && 'default' : (stryCov_9fa48("437"), database ?? (stryMutAct_9fa48("438") ? "" : (stryCov_9fa48("438"), 'default'))), stryMutAct_9fa48("439") ? "" : (stryCov_9fa48("439"), 'none'), stryMutAct_9fa48("440") ? true : (stryCov_9fa48("440"), false), stryMutAct_9fa48("441") ? true : (stryCov_9fa48("441"), false), this.errText(e));
          throw this.toDriverError(e);
        }
      }
    }
  }
  async schema(projectPath: string | undefined, connId: string, table: string, database?: string): Promise<ColumnInfo[]> {
    if (stryMutAct_9fa48("442")) {
      {}
    } else {
      stryCov_9fa48("442");
      const t = assertNonEmpty(table, stryMutAct_9fa48("443") ? "" : (stryCov_9fa48("443"), 'table'));
      const {
        key,
        adapter
      } = await this.authorize(projectPath, connId, stryMutAct_9fa48("444") ? true : (stryCov_9fa48("444"), false));
      try {
        if (stryMutAct_9fa48("445")) {
          {}
        } else {
          stryCov_9fa48("445");
          const result = await adapter.describeTable(t, database);
          this.audit(key, connId, stryMutAct_9fa48("447") ? "" : (stryCov_9fa48("447"), 'schema'), t, stryMutAct_9fa48("448") ? "" : (stryCov_9fa48("448"), 'none'), stryMutAct_9fa48("449") ? true : (stryCov_9fa48("449"), false), stryMutAct_9fa48("450") ? false : (stryCov_9fa48("450"), true));
          return result;
        }
      } catch (e) {
        if (stryMutAct_9fa48("451")) {
          {}
        } else {
          stryCov_9fa48("451");
          this.audit(key, connId, stryMutAct_9fa48("453") ? "" : (stryCov_9fa48("453"), 'schema'), t, stryMutAct_9fa48("454") ? "" : (stryCov_9fa48("454"), 'none'), stryMutAct_9fa48("455") ? true : (stryCov_9fa48("455"), false), stryMutAct_9fa48("456") ? true : (stryCov_9fa48("456"), false), this.errText(e));
          throw this.toDriverError(e);
        }
      }
    }
  }
  async preview(projectPath: string | undefined, connId: string, table: string, limit?: number, database?: string, offset?: number): Promise<QueryResult> {
    if (stryMutAct_9fa48("457")) {
      {}
    } else {
      stryCov_9fa48("457");
      const t = assertNonEmpty(table, stryMutAct_9fa48("458") ? "" : (stryCov_9fa48("458"), 'table'));
      const capped = stryMutAct_9fa48("459") ? Math.min(1, Math.min(50, Math.floor(Number(limit) || 10))) : (stryCov_9fa48("459"), Math.max(1, stryMutAct_9fa48("460") ? Math.max(50, Math.floor(Number(limit) || 10)) : (stryCov_9fa48("460"), Math.min(50, Math.floor(stryMutAct_9fa48("463") ? Number(limit) && 10 : stryMutAct_9fa48("462") ? false : stryMutAct_9fa48("461") ? true : (stryCov_9fa48("461", "462", "463"), Number(limit) || 10))))));
      const off = stryMutAct_9fa48("464") ? Math.min(0, Math.floor(Number(offset) || 0)) : (stryCov_9fa48("464"), Math.max(0, Math.floor(stryMutAct_9fa48("467") ? Number(offset) && 0 : stryMutAct_9fa48("466") ? false : stryMutAct_9fa48("465") ? true : (stryCov_9fa48("465", "466", "467"), Number(offset) || 0))));
      const {
        key,
        adapter
      } = await this.authorize(projectPath, connId, stryMutAct_9fa48("468") ? true : (stryCov_9fa48("468"), false));
      try {
        if (stryMutAct_9fa48("469")) {
          {}
        } else {
          stryCov_9fa48("469");
          const result = await adapter.previewRows(t, capped, database, off);
          this.audit(key, connId, stryMutAct_9fa48("471") ? "" : (stryCov_9fa48("471"), 'preview'), stryMutAct_9fa48("472") ? `` : (stryCov_9fa48("472"), `PREVIEW ${t} LIMIT ${capped} OFFSET ${off}`), stryMutAct_9fa48("473") ? "" : (stryCov_9fa48("473"), 'none'), stryMutAct_9fa48("474") ? true : (stryCov_9fa48("474"), false), stryMutAct_9fa48("475") ? false : (stryCov_9fa48("475"), true), undefined, result.rowCount);
          return result;
        }
      } catch (e) {
        if (stryMutAct_9fa48("476")) {
          {}
        } else {
          stryCov_9fa48("476");
          this.audit(key, connId, stryMutAct_9fa48("478") ? "" : (stryCov_9fa48("478"), 'preview'), stryMutAct_9fa48("479") ? `` : (stryCov_9fa48("479"), `PREVIEW ${t} LIMIT ${capped} OFFSET ${off}`), stryMutAct_9fa48("480") ? "" : (stryCov_9fa48("480"), 'none'), stryMutAct_9fa48("481") ? true : (stryCov_9fa48("481"), false), stryMutAct_9fa48("482") ? true : (stryCov_9fa48("482"), false), this.errText(e));
          throw this.toDriverError(e);
        }
      }
    }
  }

  /* -- SQL 控制台（guard + challenge） -- */

  async query(projectPath: string | undefined, connId: string, sql: string, params?: unknown[], challengeId?: string): Promise<QueryResult | NeedConfirm> {
    if (stryMutAct_9fa48("483")) {
      {}
    } else {
      stryCov_9fa48("483");
      const statement = assertNonEmpty(sql, stryMutAct_9fa48("484") ? "" : (stryCov_9fa48("484"), 'sql'));
      return this.runGuarded(stryMutAct_9fa48("485") ? {} : (stryCov_9fa48("485"), {
        projectPath,
        connId,
        op: stryMutAct_9fa48("486") ? "" : (stryCov_9fa48("486"), 'query'),
        statement,
        challengeId,
        run: stryMutAct_9fa48("487") ? () => undefined : (stryCov_9fa48("487"), adapter => adapter.query(statement, params)),
        rowsAffected: stryMutAct_9fa48("488") ? () => undefined : (stryCov_9fa48("488"), r => r.rowCount)
      }));
    }
  }
  async execute(projectPath: string | undefined, connId: string, statement: string, params?: unknown[], challengeId?: string): Promise<ExecResult | NeedConfirm> {
    if (stryMutAct_9fa48("489")) {
      {}
    } else {
      stryCov_9fa48("489");
      const stmt = assertNonEmpty(statement, stryMutAct_9fa48("490") ? "" : (stryCov_9fa48("490"), 'statement'));
      return this.runGuarded(stryMutAct_9fa48("491") ? {} : (stryCov_9fa48("491"), {
        projectPath,
        connId,
        op: stryMutAct_9fa48("492") ? "" : (stryCov_9fa48("492"), 'execute'),
        statement: stmt,
        challengeId,
        run: stryMutAct_9fa48("493") ? () => undefined : (stryCov_9fa48("493"), adapter => adapter.execute(stmt, params)),
        rowsAffected: stryMutAct_9fa48("494") ? () => undefined : (stryCov_9fa48("494"), r => r.affectedRows)
      }));
    }
  }

  /**
   * run_script：子进程隔离执行（lib/script/worker.cjs + permission model + 新 vm realm）。
   *  - 会话专用适配器（不走缓存，超时即 close 中断在途调用，不污染共享缓存）；
   *  - db 句柄经 IPC 回父进程，走完整 guard/challenge/审计链路；
   *  - 脚本内 NEEDS_CONFIRMATION 以 DbToolError 形式抛出（message 为 JSON），
   *    由入口层还原为 NEEDS_CONFIRMATION 响应；
   *  - 审计后置：仅在拿到真实执行结果（成功/失败）后落盘。
   */
  async runScript(projectPath: string | undefined, connId: string, code: string, challengeId?: string): Promise<unknown | NeedConfirm> {
    if (stryMutAct_9fa48("495")) {
      {}
    } else {
      stryCov_9fa48("495");
      const src = assertNonEmpty(code, stryMutAct_9fa48("496") ? "" : (stryCov_9fa48("496"), 'code'));
      // authorize(needWrite=true) 已拒绝 ro 授权；脚本内写句柄再经 runGuarded 双重校验
      const {
        key,
        mode
      } = await this.authorize(projectPath, connId, stryMutAct_9fa48("497") ? false : (stryCov_9fa48("497"), true));
      // 会话专用适配器：独立于缓存实例，脚本超时可立即 close（中断在途查询）
      const rc = this.requireConn(connId);
      const factory = await this.resolver(rc.meta.kind);
      const sessionAdapter = await factory(rc, stryMutAct_9fa48("498") ? {} : (stryCov_9fa48("498"), {
        mode
      })).catch((e: unknown) => {
        if (stryMutAct_9fa48("499")) {
          {}
        } else {
          stryCov_9fa48("499");
          throw e instanceof DbToolError ? e : this.toDriverError(e);
        }
      });
      const auditStmt = (stryMutAct_9fa48("503") ? src.length <= 200 : stryMutAct_9fa48("502") ? src.length >= 200 : stryMutAct_9fa48("501") ? false : stryMutAct_9fa48("500") ? true : (stryCov_9fa48("500", "501", "502", "503"), src.length > 200)) ? (stryMutAct_9fa48("504") ? src : (stryCov_9fa48("504"), src.slice(0, 200))) + (stryMutAct_9fa48("505") ? "" : (stryCov_9fa48("505"), '…')) : src;
      try {
        if (stryMutAct_9fa48("506")) {
          {}
        } else {
          stryCov_9fa48("506");
          const result = await runScriptInChild(stryMutAct_9fa48("507") ? {} : (stryCov_9fa48("507"), {
            code: src,
            dbQuery: stryMutAct_9fa48("508") ? () => undefined : (stryCov_9fa48("508"), async (sql, params) => this.unwrapForScript(await this.query(key, connId, sql, params))),
            dbExecute: stryMutAct_9fa48("509") ? () => undefined : (stryCov_9fa48("509"), async (statement, params) => this.unwrapForScript(await this.execute(key, connId, statement, params, challengeId))),
            onLog: stryMutAct_9fa48("510") ? () => undefined : (stryCov_9fa48("510"), (level, text) => (stryMutAct_9fa48("513") ? level !== 'error' : stryMutAct_9fa48("512") ? false : stryMutAct_9fa48("511") ? true : (stryCov_9fa48("511", "512", "513"), level === (stryMutAct_9fa48("514") ? "" : (stryCov_9fa48("514"), 'error')))) ? console.error(stryMutAct_9fa48("515") ? "" : (stryCov_9fa48("515"), '[db-script]'), text) : console.log(stryMutAct_9fa48("516") ? "" : (stryCov_9fa48("516"), '[db-script]'), text)),
            onTimeout: () => {
              if (stryMutAct_9fa48("517")) {
                {}
              } else {
                stryCov_9fa48("517");
                void sessionAdapter.close().catch(() => {});
              }
            }
          }));
          this.audit(key, connId, stryMutAct_9fa48("519") ? "" : (stryCov_9fa48("519"), 'script'), auditStmt, stryMutAct_9fa48("520") ? "" : (stryCov_9fa48("520"), 'none'), stryMutAct_9fa48("521") ? true : (stryCov_9fa48("521"), false), stryMutAct_9fa48("522") ? false : (stryCov_9fa48("522"), true));
          return result;
        }
      } catch (e) {
        if (stryMutAct_9fa48("523")) {
          {}
        } else {
          stryCov_9fa48("523");
          if (stryMutAct_9fa48("526") ? false : stryMutAct_9fa48("525") ? true : stryMutAct_9fa48("524") ? e instanceof DbToolError && e.code === 'NEEDS_CONFIRMATION' : (stryCov_9fa48("524", "525", "526"), !(stryMutAct_9fa48("529") ? e instanceof DbToolError || e.code === 'NEEDS_CONFIRMATION' : stryMutAct_9fa48("528") ? false : stryMutAct_9fa48("527") ? true : (stryCov_9fa48("527", "528", "529"), e instanceof DbToolError && (stryMutAct_9fa48("531") ? e.code !== 'NEEDS_CONFIRMATION' : stryMutAct_9fa48("530") ? true : (stryCov_9fa48("530", "531"), e.code === (stryMutAct_9fa48("532") ? "" : (stryCov_9fa48("532"), 'NEEDS_CONFIRMATION')))))))) {
            if (stryMutAct_9fa48("533")) {
              {}
            } else {
              stryCov_9fa48("533");
              this.audit(key, connId, stryMutAct_9fa48("535") ? "" : (stryCov_9fa48("535"), 'script'), auditStmt, stryMutAct_9fa48("536") ? "" : (stryCov_9fa48("536"), 'none'), stryMutAct_9fa48("537") ? true : (stryCov_9fa48("537"), false), stryMutAct_9fa48("538") ? true : (stryCov_9fa48("538"), false), this.errText(e));
            }
          }
          if (stryMutAct_9fa48("540") ? false : stryMutAct_9fa48("539") ? true : (stryCov_9fa48("539", "540"), e instanceof DbToolError)) throw e;
          throw this.toDriverError(e);
        }
      } finally {
        if (stryMutAct_9fa48("541")) {
          {}
        } else {
          stryCov_9fa48("541");
          await sessionAdapter.close().catch(() => {});
        }
      }
    }
  }

  /* -- 审计与状态 -- */

  auditTail(projectPath: string | undefined, limit?: number): AuditEntry[] {
    if (stryMutAct_9fa48("542")) {
      {}
    } else {
      stryCov_9fa48("542");
      const n = stryMutAct_9fa48("543") ? Math.min(1, Math.min(500, Math.floor(Number(limit) || 50))) : (stryCov_9fa48("543"), Math.max(1, stryMutAct_9fa48("544") ? Math.max(500, Math.floor(Number(limit) || 50)) : (stryCov_9fa48("544"), Math.min(500, Math.floor(stryMutAct_9fa48("547") ? Number(limit) && 50 : stryMutAct_9fa48("546") ? false : stryMutAct_9fa48("545") ? true : (stryCov_9fa48("545", "546", "547"), Number(limit) || 50))))));
      if (stryMutAct_9fa48("550") ? !projectPath && projectPath.trim() === '' : stryMutAct_9fa48("549") ? false : stryMutAct_9fa48("548") ? true : (stryCov_9fa48("548", "549", "550"), (stryMutAct_9fa48("551") ? projectPath : (stryCov_9fa48("551"), !projectPath)) || (stryMutAct_9fa48("553") ? projectPath.trim() !== '' : stryMutAct_9fa48("552") ? false : (stryCov_9fa48("552", "553"), (stryMutAct_9fa48("554") ? projectPath : (stryCov_9fa48("554"), projectPath.trim())) === (stryMutAct_9fa48("555") ? "Stryker was here!" : (stryCov_9fa48("555"), '')))))) return this.store.audit.tail(n);
      const key = normalizeProjectKey(projectPath);
      return stryMutAct_9fa48("556") ? this.store.audit.tail(n) : (stryCov_9fa48("556"), this.store.audit.tail(n).filter(stryMutAct_9fa48("557") ? () => undefined : (stryCov_9fa48("557"), e => stryMutAct_9fa48("560") ? e.projectPathKey !== key : stryMutAct_9fa48("559") ? false : stryMutAct_9fa48("558") ? true : (stryCov_9fa48("558", "559", "560"), e.projectPathKey === key))));
    }
  }
  state(projectPath: string | undefined): {
    connections: ConnectionMeta[];
    grants: {
      connId: string;
      mode: 'ro' | 'rw';
    }[];
    auditTail: AuditEntry[];
  } {
    if (stryMutAct_9fa48("561")) {
      {}
    } else {
      stryCov_9fa48("561");
      const grants = (stryMutAct_9fa48("564") ? projectPath || projectPath.trim() !== '' : stryMutAct_9fa48("563") ? false : stryMutAct_9fa48("562") ? true : (stryCov_9fa48("562", "563", "564"), projectPath && (stryMutAct_9fa48("566") ? projectPath.trim() === '' : stryMutAct_9fa48("565") ? true : (stryCov_9fa48("565", "566"), (stryMutAct_9fa48("567") ? projectPath : (stryCov_9fa48("567"), projectPath.trim())) !== (stryMutAct_9fa48("568") ? "Stryker was here!" : (stryCov_9fa48("568"), '')))))) ? this.grantsFor(projectPath) : stryMutAct_9fa48("569") ? ["Stryker was here"] : (stryCov_9fa48("569"), []);
      return stryMutAct_9fa48("570") ? {} : (stryCov_9fa48("570"), {
        connections: this.listConnections(),
        grants,
        auditTail: this.auditTail(projectPath, 50)
      });
    }
  }

  /** 关闭缓存的适配器并停止 challenge 清理 */
  async dispose(): Promise<void> {
    if (stryMutAct_9fa48("571")) {
      {}
    } else {
      stryCov_9fa48("571");
      this.disposed = stryMutAct_9fa48("572") ? false : (stryCov_9fa48("572"), true);
      if (stryMutAct_9fa48("573")) {
        ;
      } else {
        stryCov_9fa48("573");
        this.challenges.dispose();
      }
      const pending = stryMutAct_9fa48("574") ? [] : (stryCov_9fa48("574"), [...this.adapterCache.values()]);
      if (stryMutAct_9fa48("575")) {
        ;
      } else {
        stryCov_9fa48("575");
        this.adapterCache.clear();
      }
      for (const p of pending) {
        if (stryMutAct_9fa48("576")) {
          {}
        } else {
          stryCov_9fa48("576");
          try {
            if (stryMutAct_9fa48("577")) {
              {}
            } else {
              stryCov_9fa48("577");
              const a = await p;
              await a.close().catch(() => {});
            }
          } catch {
            // 缓存里的加载失败项直接忽略
          }
        }
      }
    }
  }

  /* ---------------- 内部 ---------------- */

  private requireConn(connId: string): ReturnType<DbToolStore['connections']['testTarget']> {
    if (stryMutAct_9fa48("578")) {
      {}
    } else {
      stryCov_9fa48("578");
      try {
        if (stryMutAct_9fa48("579")) {
          {}
        } else {
          stryCov_9fa48("579");
          return this.store.connections.testTarget(connId);
        }
      } catch {
        if (stryMutAct_9fa48("580")) {
          {}
        } else {
          stryCov_9fa48("580");
          throw new DbToolError(stryMutAct_9fa48("582") ? "" : (stryCov_9fa48("582"), 'NOT_FOUND'), stryMutAct_9fa48("583") ? `` : (stryCov_9fa48("583"), `连接不存在: ${connId}`));
        }
      }
    }
  }

  /** 授权校验 + 取（缓存的）适配器 */
  private async authorize(projectPath: string | undefined, connId: string, needWrite: boolean): Promise<{
    key: string;
    mode: 'ro' | 'rw';
    adapter: DatabaseAdapter;
  }> {
    if (stryMutAct_9fa48("584")) {
      {}
    } else {
      stryCov_9fa48("584");
      if (stryMutAct_9fa48("586") ? false : stryMutAct_9fa48("585") ? true : (stryCov_9fa48("585", "586"), this.disposed)) throw new DbToolError(stryMutAct_9fa48("588") ? "" : (stryCov_9fa48("588"), 'INVALID_ARGUMENT'), stryMutAct_9fa48("589") ? "" : (stryCov_9fa48("589"), '服务已关闭'));
      if (stryMutAct_9fa48("592") ? !projectPath && projectPath.trim() === '' : stryMutAct_9fa48("591") ? false : stryMutAct_9fa48("590") ? true : (stryCov_9fa48("590", "591", "592"), (stryMutAct_9fa48("593") ? projectPath : (stryCov_9fa48("593"), !projectPath)) || (stryMutAct_9fa48("595") ? projectPath.trim() !== '' : stryMutAct_9fa48("594") ? false : (stryCov_9fa48("594", "595"), (stryMutAct_9fa48("596") ? projectPath : (stryCov_9fa48("596"), projectPath.trim())) === (stryMutAct_9fa48("597") ? "Stryker was here!" : (stryCov_9fa48("597"), '')))))) {
        if (stryMutAct_9fa48("598")) {
          {}
        } else {
          stryCov_9fa48("598");
          throw new DbToolError(stryMutAct_9fa48("600") ? "" : (stryCov_9fa48("600"), 'UNAUTHORIZED_PROJECT'), stryMutAct_9fa48("601") ? "" : (stryCov_9fa48("601"), '业务操作需要 projectPath（匿名项目仅可管理连接）'));
        }
      }
      const key = normalizeProjectKey(projectPath);
      const mode = this.store.grants.check(key, connId);
      if (stryMutAct_9fa48("604") ? false : stryMutAct_9fa48("603") ? true : stryMutAct_9fa48("602") ? mode : (stryCov_9fa48("602", "603", "604"), !mode)) throw new DbToolError(stryMutAct_9fa48("606") ? "" : (stryCov_9fa48("606"), 'UNAUTHORIZED_PROJECT'), stryMutAct_9fa48("607") ? `` : (stryCov_9fa48("607"), `项目未授权该连接: ${connId}`));
      if (stryMutAct_9fa48("610") ? needWrite || mode === 'ro' : stryMutAct_9fa48("609") ? false : stryMutAct_9fa48("608") ? true : (stryCov_9fa48("608", "609", "610"), needWrite && (stryMutAct_9fa48("612") ? mode !== 'ro' : stryMutAct_9fa48("611") ? true : (stryCov_9fa48("611", "612"), mode === (stryMutAct_9fa48("613") ? "" : (stryCov_9fa48("613"), 'ro')))))) {
        if (stryMutAct_9fa48("614")) {
          {}
        } else {
          stryCov_9fa48("614");
          throw new DbToolError(stryMutAct_9fa48("616") ? "" : (stryCov_9fa48("616"), 'READ_ONLY'), stryMutAct_9fa48("617") ? "" : (stryCov_9fa48("617"), '该连接对本项目为只读授权（ro），拒绝写操作'));
        }
      }
      const adapter = await this.adapterFor(connId, mode);
      return stryMutAct_9fa48("618") ? {} : (stryCov_9fa48("618"), {
        key,
        mode,
        adapter
      });
    }
  }

  /** 关闭指定连接的全部缓存适配器（mode 变更/凭证变更/删除时） */
  private async dropAdapters(connId: string): Promise<void> {
    if (stryMutAct_9fa48("619")) {
      {}
    } else {
      stryCov_9fa48("619");
      const keys = stryMutAct_9fa48("620") ? [...this.adapterCache.keys()] : (stryCov_9fa48("620"), (stryMutAct_9fa48("621") ? [] : (stryCov_9fa48("621"), [...this.adapterCache.keys()])).filter(stryMutAct_9fa48("622") ? () => undefined : (stryCov_9fa48("622"), k => stryMutAct_9fa48("623") ? k.endsWith(`${connId}@mode=`) : (stryCov_9fa48("623"), k.startsWith(stryMutAct_9fa48("624") ? `` : (stryCov_9fa48("624"), `${connId}@mode=`))))));
      for (const k of keys) {
        if (stryMutAct_9fa48("625")) {
          {}
        } else {
          stryCov_9fa48("625");
          const p = this.adapterCache.get(k);
          if (stryMutAct_9fa48("626")) {
            ;
          } else {
            stryCov_9fa48("626");
            this.adapterCache.delete(k);
          }
          if (stryMutAct_9fa48("629") ? false : stryMutAct_9fa48("628") ? true : stryMutAct_9fa48("627") ? p : (stryCov_9fa48("627", "628", "629"), !p)) continue;
          try {
            if (stryMutAct_9fa48("630")) {
              {}
            } else {
              stryCov_9fa48("630");
              const a = await p;
              await a.close().catch(() => {});
            }
          } catch {
            // 加载失败或已断开的旧实例直接忽略
          }
        }
      }
    }
  }
  private adapterFor(connId: string, mode: 'ro' | 'rw'): Promise<DatabaseAdapter> {
    if (stryMutAct_9fa48("631")) {
      {}
    } else {
      stryCov_9fa48("631");
      const cacheKey = stryMutAct_9fa48("632") ? `` : (stryCov_9fa48("632"), `${connId}@mode=${mode}`);
      let p = this.adapterCache.get(cacheKey);
      if (stryMutAct_9fa48("635") ? false : stryMutAct_9fa48("634") ? true : stryMutAct_9fa48("633") ? p : (stryCov_9fa48("633", "634", "635"), !p)) {
        if (stryMutAct_9fa48("636")) {
          {}
        } else {
          stryCov_9fa48("636");
          p = (async () => {
            if (stryMutAct_9fa48("637")) {
              {}
            } else {
              stryCov_9fa48("637");
              const rc = this.requireConn(connId);
              const factory = await this.resolver(rc.meta.kind);
              return factory(rc, stryMutAct_9fa48("638") ? {} : (stryCov_9fa48("638"), {
                mode
              }));
            }
          })().catch(e => {
            if (stryMutAct_9fa48("639")) {
              {}
            } else {
              stryCov_9fa48("639");
              if (stryMutAct_9fa48("640")) {
                ;
              } else {
                stryCov_9fa48("640");
                this.adapterCache.delete(cacheKey);
              }
              throw e instanceof DbToolError ? e : this.toDriverError(e);
            }
          });
          if (stryMutAct_9fa48("641")) {
            ;
          } else {
            stryCov_9fa48("641");
            this.adapterCache.set(cacheKey, p);
          }
        }
      }
      return p;
    }
  }

  /** guard 主流程：分类 → challenge → 执行 → 审计 */
  private async runGuarded<T>(args: {
    projectPath: string | undefined;
    connId: string;
    op: 'query' | 'execute';
    statement: string;
    params?: unknown[];
    challengeId?: string;
    run: (adapter: DatabaseAdapter) => Promise<T>;
    rowsAffected?: (r: T) => number | undefined;
  }): Promise<T | NeedConfirm> {
    if (stryMutAct_9fa48("642")) {
      {}
    } else {
      stryCov_9fa48("642");
      const {
        projectPath,
        connId,
        op,
        statement,
        challengeId
      } = args;
      if (stryMutAct_9fa48("645") ? args.params !== undefined || !Array.isArray(args.params) : stryMutAct_9fa48("644") ? false : stryMutAct_9fa48("643") ? true : (stryCov_9fa48("643", "644", "645"), (stryMutAct_9fa48("647") ? args.params === undefined : stryMutAct_9fa48("646") ? true : (stryCov_9fa48("646", "647"), args.params !== undefined)) && (stryMutAct_9fa48("648") ? Array.isArray(args.params) : (stryCov_9fa48("648"), !Array.isArray(args.params))))) {
        if (stryMutAct_9fa48("649")) {
          {}
        } else {
          stryCov_9fa48("649");
          throw new DbToolError(stryMutAct_9fa48("651") ? "" : (stryCov_9fa48("651"), 'INVALID_ARGUMENT'), stryMutAct_9fa48("652") ? "" : (stryCov_9fa48("652"), 'params 必须是数组（绑定参数）'));
        }
      }
      const {
        key,
        adapter
      } = await this.authorize(projectPath, connId, stryMutAct_9fa48("655") ? op !== 'execute' : stryMutAct_9fa48("654") ? false : stryMutAct_9fa48("653") ? true : (stryCov_9fa48("653", "654", "655"), op === (stryMutAct_9fa48("656") ? "" : (stryCov_9fa48("656"), 'execute'))));
      const kind = adapter.kind;
      const verdict = classifyStatement(kind, statement, op);
      if (stryMutAct_9fa48("659") ? verdict.level !== 'danger' : stryMutAct_9fa48("658") ? false : stryMutAct_9fa48("657") ? true : (stryCov_9fa48("657", "658", "659"), verdict.level === (stryMutAct_9fa48("660") ? "" : (stryCov_9fa48("660"), 'danger')))) {
        if (stryMutAct_9fa48("661")) {
          {}
        } else {
          stryCov_9fa48("661");
          const scope: ChallengeScope = stryMutAct_9fa48("662") ? {} : (stryCov_9fa48("662"), {
            connId,
            projectKey: key
          });
          if (stryMutAct_9fa48("665") ? false : stryMutAct_9fa48("664") ? true : stryMutAct_9fa48("663") ? challengeId : (stryCov_9fa48("663", "664", "665"), !challengeId)) {
            if (stryMutAct_9fa48("666")) {
              {}
            } else {
              stryCov_9fa48("666");
              const {
                id: cid
              } = this.challenges.create(statement, scope);
              this.audit(key, connId, op, statement, stryMutAct_9fa48("668") ? "" : (stryCov_9fa48("668"), 'danger'), stryMutAct_9fa48("669") ? true : (stryCov_9fa48("669"), false), stryMutAct_9fa48("670") ? true : (stryCov_9fa48("670"), false), stryMutAct_9fa48("671") ? "" : (stryCov_9fa48("671"), 'NEEDS_CONFIRMATION'));
              return stryMutAct_9fa48("672") ? {} : (stryCov_9fa48("672"), {
                needConfirmation: stryMutAct_9fa48("673") ? false : (stryCov_9fa48("673"), true),
                challengeId: cid,
                statement,
                danger: stryMutAct_9fa48("674") ? "" : (stryCov_9fa48("674"), 'danger'),
                reason: stryMutAct_9fa48("675") ? verdict.reason && '危险操作，需要用户确认' : (stryCov_9fa48("675"), verdict.reason ?? (stryMutAct_9fa48("676") ? "" : (stryCov_9fa48("676"), '危险操作，需要用户确认')))
              });
            }
          }
          if (stryMutAct_9fa48("679") ? false : stryMutAct_9fa48("678") ? true : stryMutAct_9fa48("677") ? this.challenges.consume(challengeId, statement, scope) : (stryCov_9fa48("677", "678", "679"), !this.challenges.consume(challengeId, statement, scope))) {
            if (stryMutAct_9fa48("680")) {
              {}
            } else {
              stryCov_9fa48("680");
              this.audit(key, connId, op, statement, stryMutAct_9fa48("682") ? "" : (stryCov_9fa48("682"), 'danger'), stryMutAct_9fa48("683") ? true : (stryCov_9fa48("683"), false), stryMutAct_9fa48("684") ? true : (stryCov_9fa48("684"), false), stryMutAct_9fa48("685") ? "" : (stryCov_9fa48("685"), 'INVALID_CHALLENGE'));
              throw new DbToolError(stryMutAct_9fa48("687") ? "" : (stryCov_9fa48("687"), 'INVALID_CHALLENGE'), stryMutAct_9fa48("688") ? "" : (stryCov_9fa48("688"), '确认凭据无效（不存在、已使用、已过期或语句已变更），请重新发起'));
            }
          }
        }
      }
      try {
        if (stryMutAct_9fa48("689")) {
          {}
        } else {
          stryCov_9fa48("689");
          const result = await args.run(adapter);
          if (stryMutAct_9fa48("690")) {
            ;
          } else {
            stryCov_9fa48("690");
            this.audit(key, connId, op, statement, verdict.level as DangerLevel, stryMutAct_9fa48("693") ? verdict.level !== 'danger' : stryMutAct_9fa48("692") ? false : stryMutAct_9fa48("691") ? true : (stryCov_9fa48("691", "692", "693"), verdict.level === (stryMutAct_9fa48("694") ? "" : (stryCov_9fa48("694"), 'danger'))), stryMutAct_9fa48("695") ? false : (stryCov_9fa48("695"), true), undefined, stryMutAct_9fa48("696") ? args.rowsAffected(result) : (stryCov_9fa48("696"), args.rowsAffected?.(result)));
          }
          return result;
        }
      } catch (e) {
        if (stryMutAct_9fa48("697")) {
          {}
        } else {
          stryCov_9fa48("697");
          if (stryMutAct_9fa48("698")) {
            ;
          } else {
            stryCov_9fa48("698");
            this.audit(key, connId, op, statement, verdict.level as DangerLevel, stryMutAct_9fa48("701") ? verdict.level !== 'danger' : stryMutAct_9fa48("700") ? false : stryMutAct_9fa48("699") ? true : (stryCov_9fa48("699", "700", "701"), verdict.level === (stryMutAct_9fa48("702") ? "" : (stryCov_9fa48("702"), 'danger'))), stryMutAct_9fa48("703") ? true : (stryCov_9fa48("703"), false), this.errText(e));
          }
          throw this.toDriverError(e);
        }
      }
    }
  }

  /** 脚本内句柄：NeedConfirm 无法在脚本中交互，转为可还原的 DbToolError */
  private unwrapForScript(r: unknown): unknown {
    if (stryMutAct_9fa48("704")) {
      {}
    } else {
      stryCov_9fa48("704");
      if (stryMutAct_9fa48("707") ? r && typeof r === 'object' || (r as NeedConfirm).needConfirmation === true : stryMutAct_9fa48("706") ? false : stryMutAct_9fa48("705") ? true : (stryCov_9fa48("705", "706", "707"), (stryMutAct_9fa48("709") ? r || typeof r === 'object' : stryMutAct_9fa48("708") ? true : (stryCov_9fa48("708", "709"), r && (stryMutAct_9fa48("711") ? typeof r !== 'object' : stryMutAct_9fa48("710") ? true : (stryCov_9fa48("710", "711"), typeof r === (stryMutAct_9fa48("712") ? "" : (stryCov_9fa48("712"), 'object')))))) && (stryMutAct_9fa48("714") ? (r as NeedConfirm).needConfirmation !== true : stryMutAct_9fa48("713") ? true : (stryCov_9fa48("713", "714"), (r as NeedConfirm).needConfirmation === (stryMutAct_9fa48("715") ? false : (stryCov_9fa48("715"), true)))))) {
        if (stryMutAct_9fa48("716")) {
          {}
        } else {
          stryCov_9fa48("716");
          const nc = r as NeedConfirm;
          throw new DbToolError(stryMutAct_9fa48("718") ? "" : (stryCov_9fa48("718"), 'NEEDS_CONFIRMATION'), JSON.stringify(nc));
        }
      }
      return r;
    }
  }
  private audit(projectPathKey: string, connId: string, action: string, statement: string, danger: DangerLevel, confirmed: boolean, ok: boolean, error?: string, rowsAffected?: number): void {
    if (stryMutAct_9fa48("719")) {
      {}
    } else {
      stryCov_9fa48("719");
      try {
        if (stryMutAct_9fa48("720")) {
          {}
        } else {
          stryCov_9fa48("720");
          this.store.audit.append(stryMutAct_9fa48("722") ? {} : (stryCov_9fa48("722"), {
            projectPathKey,
            connId,
            action,
            statement,
            danger,
            confirmed,
            ok,
            ...((stryMutAct_9fa48("725") ? error === undefined : stryMutAct_9fa48("724") ? false : stryMutAct_9fa48("723") ? true : (stryCov_9fa48("723", "724", "725"), error !== undefined)) ? stryMutAct_9fa48("726") ? {} : (stryCov_9fa48("726"), {
              error
            }) : {}),
            ...((stryMutAct_9fa48("729") ? rowsAffected === undefined : stryMutAct_9fa48("728") ? false : stryMutAct_9fa48("727") ? true : (stryCov_9fa48("727", "728", "729"), rowsAffected !== undefined)) ? stryMutAct_9fa48("730") ? {} : (stryCov_9fa48("730"), {
              rowsAffected
            }) : {})
          }));
        }
      } catch {
        // 审计失败不阻塞业务（best-effort）
      }
    }
  }
  private errText(e: unknown): string {
    if (stryMutAct_9fa48("731")) {
      {}
    } else {
      stryCov_9fa48("731");
      return e instanceof Error ? e.message : String(e);
    }
  }
  private toDriverError(e: unknown): Error {
    if (stryMutAct_9fa48("732")) {
      {}
    } else {
      stryCov_9fa48("732");
      if (stryMutAct_9fa48("734") ? false : stryMutAct_9fa48("733") ? true : (stryCov_9fa48("733", "734"), e instanceof DbToolError)) return e;
      return new DbToolError(stryMutAct_9fa48("735") ? "" : (stryCov_9fa48("735"), 'DRIVER_ERROR'), this.errText(e));
    }
  }
}

/** guard 判定（导出供 HTTP 层/script 入口识别） */
export type { GuardVerdict };

/* ---------------- 模型工具分发层 ---------------- */

export interface ToolActionArgs {
  action: string;
  /** snake_case 为主（与 SSHManager 风格一致），兼容 camelCase */
  conn_id?: string;
  connId?: string;
  sql?: string;
  statement?: string;
  params?: unknown[];
  database?: string;
  table?: string;
  limit?: number;
  offset?: number;
  code?: string;
  challenge_id?: string;
  challengeId?: string;
}
function pick(args: ToolActionArgs, snake: 'conn_id' | 'challenge_id'): string | undefined {
  if (stryMutAct_9fa48("736")) {
    {}
  } else {
    stryCov_9fa48("736");
    return stryMutAct_9fa48("737") ? args[snake] && (snake === 'conn_id' ? args.connId : args.challengeId) : (stryCov_9fa48("737"), args[snake] ?? ((stryMutAct_9fa48("740") ? snake !== 'conn_id' : stryMutAct_9fa48("739") ? false : stryMutAct_9fa48("738") ? true : (stryCov_9fa48("738", "739", "740"), snake === (stryMutAct_9fa48("741") ? "" : (stryCov_9fa48("741"), 'conn_id')))) ? args.connId : args.challengeId));
  }
}

/**
 * 工具 action 分发（返回 JSON 文本）。危险待确认时文本内含确认指引，
 * 提示模型向用户 ask 确认后带 challenge_id 重试。
 */
export async function handleToolAction(service: DbToolService, args: ToolActionArgs, projectPath: string): Promise<string> {
  if (stryMutAct_9fa48("742")) {
    {}
  } else {
    stryCov_9fa48("742");
    const action = args.action;
    const connId = pick(args, stryMutAct_9fa48("743") ? "" : (stryCov_9fa48("743"), 'conn_id'));
    const challengeId = pick(args, stryMutAct_9fa48("744") ? "" : (stryCov_9fa48("744"), 'challenge_id'));
    const j = stryMutAct_9fa48("745") ? () => undefined : (stryCov_9fa48("745"), (() => {
      const j = (v: unknown) => JSON.stringify(v, null, 2);
      return j;
    })());
    try {
      if (stryMutAct_9fa48("746")) {
        {}
      } else {
        stryCov_9fa48("746");
        switch (action) {
          case stryMutAct_9fa48("748") ? "" : (stryCov_9fa48("748"), 'list_connections'):
            if (stryMutAct_9fa48("747")) {} else {
              stryCov_9fa48("747");
              return j(service.listConnections());
            }
          case stryMutAct_9fa48("750") ? "" : (stryCov_9fa48("750"), 'query'):
            if (stryMutAct_9fa48("749")) {} else {
              stryCov_9fa48("749");
              {
                if (stryMutAct_9fa48("751")) {
                  {}
                } else {
                  stryCov_9fa48("751");
                  const r = await service.query(projectPath, requireConn(connId), assertArg(args.sql, stryMutAct_9fa48("752") ? "" : (stryCov_9fa48("752"), 'sql')), args.params, challengeId);
                  return stryMutAct_9fa48("753") ? needConfirmText(r) && j(r) : (stryCov_9fa48("753"), needConfirmText(r) ?? j(r));
                }
              }
            }
          case stryMutAct_9fa48("755") ? "" : (stryCov_9fa48("755"), 'execute'):
            if (stryMutAct_9fa48("754")) {} else {
              stryCov_9fa48("754");
              {
                if (stryMutAct_9fa48("756")) {
                  {}
                } else {
                  stryCov_9fa48("756");
                  const r = await service.execute(projectPath, requireConn(connId), assertArg(stryMutAct_9fa48("757") ? args.statement && args.sql : (stryCov_9fa48("757"), args.statement ?? args.sql), stryMutAct_9fa48("758") ? "" : (stryCov_9fa48("758"), 'statement')), args.params, challengeId);
                  return stryMutAct_9fa48("759") ? needConfirmText(r) && j(r) : (stryCov_9fa48("759"), needConfirmText(r) ?? j(r));
                }
              }
            }
          case stryMutAct_9fa48("761") ? "" : (stryCov_9fa48("761"), 'schema'):
            if (stryMutAct_9fa48("760")) {} else {
              stryCov_9fa48("760");
              {
                if (stryMutAct_9fa48("762")) {
                  {}
                } else {
                  stryCov_9fa48("762");
                  const conn = requireConn(connId);
                  if (stryMutAct_9fa48("764") ? false : stryMutAct_9fa48("763") ? true : (stryCov_9fa48("763", "764"), args.table)) return j(await service.schema(projectPath, conn, args.table, args.database));
                  if (stryMutAct_9fa48("766") ? false : stryMutAct_9fa48("765") ? true : (stryCov_9fa48("765", "766"), args.database)) return j(await service.tables(projectPath, conn, args.database));
                  return j(await service.databases(projectPath, conn));
                }
              }
            }
          case stryMutAct_9fa48("768") ? "" : (stryCov_9fa48("768"), 'preview'):
            if (stryMutAct_9fa48("767")) {} else {
              stryCov_9fa48("767");
              {
                if (stryMutAct_9fa48("769")) {
                  {}
                } else {
                  stryCov_9fa48("769");
                  const r = await service.preview(projectPath, requireConn(connId), assertArg(args.table, stryMutAct_9fa48("770") ? "" : (stryCov_9fa48("770"), 'table')), args.limit, args.database, args.offset);
                  return j(r);
                }
              }
            }
          case stryMutAct_9fa48("772") ? "" : (stryCov_9fa48("772"), 'run_script'):
            if (stryMutAct_9fa48("771")) {} else {
              stryCov_9fa48("771");
              {
                if (stryMutAct_9fa48("773")) {
                  {}
                } else {
                  stryCov_9fa48("773");
                  const r = await service.runScript(projectPath, requireConn(connId), assertArg(args.code, stryMutAct_9fa48("774") ? "" : (stryCov_9fa48("774"), 'code')), challengeId);
                  return stryMutAct_9fa48("775") ? needConfirmText(r) && j(r) : (stryCov_9fa48("775"), needConfirmText(r) ?? j(r));
                }
              }
            }
          default:
            if (stryMutAct_9fa48("776")) {} else {
              stryCov_9fa48("776");
              throw new DbToolError(stryMutAct_9fa48("778") ? "" : (stryCov_9fa48("778"), 'INVALID_ARGUMENT'), stryMutAct_9fa48("779") ? `` : (stryCov_9fa48("779"), `未知 action: ${action}（可用: list_connections/query/execute/schema/preview/run_script）`));
            }
        }
      }
    } catch (e) {
      if (stryMutAct_9fa48("780")) {
        {}
      } else {
        stryCov_9fa48("780");
        const code = e instanceof DbToolError ? e.code : stryMutAct_9fa48("781") ? "" : (stryCov_9fa48("781"), 'DRIVER_ERROR');
        return j(stryMutAct_9fa48("782") ? {} : (stryCov_9fa48("782"), {
          ok: stryMutAct_9fa48("783") ? true : (stryCov_9fa48("783"), false),
          error: e instanceof Error ? e.message : String(e),
          code
        }));
      }
    }
  }
}
function requireConn(connId: string | undefined): string {
  if (stryMutAct_9fa48("784")) {
    {}
  } else {
    stryCov_9fa48("784");
    if (stryMutAct_9fa48("787") ? !connId && connId.trim() === '' : stryMutAct_9fa48("786") ? false : stryMutAct_9fa48("785") ? true : (stryCov_9fa48("785", "786", "787"), (stryMutAct_9fa48("788") ? connId : (stryCov_9fa48("788"), !connId)) || (stryMutAct_9fa48("790") ? connId.trim() !== '' : stryMutAct_9fa48("789") ? false : (stryCov_9fa48("789", "790"), (stryMutAct_9fa48("791") ? connId : (stryCov_9fa48("791"), connId.trim())) === (stryMutAct_9fa48("792") ? "Stryker was here!" : (stryCov_9fa48("792"), '')))))) throw new DbToolError(stryMutAct_9fa48("794") ? "" : (stryCov_9fa48("794"), 'INVALID_ARGUMENT'), stryMutAct_9fa48("795") ? "" : (stryCov_9fa48("795"), '缺少必填参数: conn_id'));
    return connId;
  }
}
function assertArg(v: string | undefined, label: string): string {
  if (stryMutAct_9fa48("796")) {
    {}
  } else {
    stryCov_9fa48("796");
    if (stryMutAct_9fa48("799") ? !v && v.trim() === '' : stryMutAct_9fa48("798") ? false : stryMutAct_9fa48("797") ? true : (stryCov_9fa48("797", "798", "799"), (stryMutAct_9fa48("800") ? v : (stryCov_9fa48("800"), !v)) || (stryMutAct_9fa48("802") ? v.trim() !== '' : stryMutAct_9fa48("801") ? false : (stryCov_9fa48("801", "802"), (stryMutAct_9fa48("803") ? v : (stryCov_9fa48("803"), v.trim())) === (stryMutAct_9fa48("804") ? "Stryker was here!" : (stryCov_9fa48("804"), '')))))) throw new DbToolError(stryMutAct_9fa48("806") ? "" : (stryCov_9fa48("806"), 'INVALID_ARGUMENT'), stryMutAct_9fa48("807") ? `` : (stryCov_9fa48("807"), `缺少必填参数: ${label}`));
    return v;
  }
}
function needConfirmText(r: unknown): string | null {
  if (stryMutAct_9fa48("808")) {
    {}
  } else {
    stryCov_9fa48("808");
    if (stryMutAct_9fa48("811") ? false : stryMutAct_9fa48("810") ? true : stryMutAct_9fa48("809") ? r && typeof r === 'object' && (r as NeedConfirm).needConfirmation === true : (stryCov_9fa48("809", "810", "811"), !(stryMutAct_9fa48("814") ? r && typeof r === 'object' || (r as NeedConfirm).needConfirmation === true : stryMutAct_9fa48("813") ? false : stryMutAct_9fa48("812") ? true : (stryCov_9fa48("812", "813", "814"), (stryMutAct_9fa48("816") ? r || typeof r === 'object' : stryMutAct_9fa48("815") ? true : (stryCov_9fa48("815", "816"), r && (stryMutAct_9fa48("818") ? typeof r !== 'object' : stryMutAct_9fa48("817") ? true : (stryCov_9fa48("817", "818"), typeof r === (stryMutAct_9fa48("819") ? "" : (stryCov_9fa48("819"), 'object')))))) && (stryMutAct_9fa48("821") ? (r as NeedConfirm).needConfirmation !== true : stryMutAct_9fa48("820") ? true : (stryCov_9fa48("820", "821"), (r as NeedConfirm).needConfirmation === (stryMutAct_9fa48("822") ? false : (stryCov_9fa48("822"), true)))))))) return null;
    const nc = r as NeedConfirm;
    return JSON.stringify(stryMutAct_9fa48("823") ? {} : (stryCov_9fa48("823"), {
      ok: stryMutAct_9fa48("824") ? true : (stryCov_9fa48("824"), false),
      code: stryMutAct_9fa48("825") ? "" : (stryCov_9fa48("825"), 'NEEDS_CONFIRMATION'),
      ...nc,
      hint: stryMutAct_9fa48("826") ? `` : (stryCov_9fa48("826"), `该操作危险（${nc.reason}）。请先向用户说明并征得确认，用户同意后携带 challenge_id=${nc.challengeId} 重试同一语句；challenge 一次性、5 分钟内有效、绑定本语句。`)
    }), null, 2);
  }
}