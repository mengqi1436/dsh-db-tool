/**
 * guard/tool/http 测试共用 fixture：临时 home + 假适配器 + DbToolService。
 * 全部离线：adapterResolver 注入内存假适配器，不装任何驱动。
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { DbToolStore } from '../../lib/store/index.js';
import { normalizeProjectKey } from '../../lib/store/index.js';
import { DbToolService } from '../../lib/manager.js';
import { ChallengeStore } from '../../lib/guard/index.js';
import type {
  ColumnInfo,
  DatabaseAdapter,
  DbKind,
  ExecResult,
  QueryResult,
  TableInfo,
  TestConnectResult,
} from '../../lib/adapters/types.js';
import { makeTempHome, cleanupDir } from '../store/helpers.js';

export const CONN_ID = 'c1';
export const CONN_URL = 'mysql://root:s3cret@127.0.0.1:3306/app';

export interface FakeAdapterOptions {
  kind?: DbKind;
  connId?: string;
  query?: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  execute?: (statement: string, params?: unknown[]) => Promise<ExecResult>;
  previewRows?: (table: string, limit: number, database?: string) => Promise<QueryResult>;
}

/** 内存假适配器（mysql 语义） */
export function fakeAdapter(opts?: FakeAdapterOptions): DatabaseAdapter {
  const kind: DbKind = opts?.kind ?? 'mysql';
  const okQuery = async (sql: string): Promise<QueryResult> => ({
    columns: ['answer'],
    rows: [[sql]],
    rowCount: 1,
  });
  return {
    kind,
    connId: opts?.connId ?? CONN_ID,
    testConnect: async (): Promise<TestConnectResult> => ({ ok: true, serverInfo: 'fake-8.0' }),
    query: opts?.query ?? okQuery,
    execute:
      opts?.execute ??
      (async (statement): Promise<ExecResult> => ({ affectedRows: 1, message: `已执行: ${statement}` })),
    listDatabases: async () => ['app', 'test'],
    listSchemas: async () => ['public', 'app'],
    listTables: async (): Promise<TableInfo[]> => [{ name: 'users', type: 'TABLE' }],
    describeTable: async (): Promise<ColumnInfo[]> => [
      { name: 'id', dataType: 'int', nullable: false, key: 'PRI' },
    ],
    previewRows: opts?.previewRows ?? (async () => ({ columns: ['id'], rows: [[1]], rowCount: 1 })),
    close: async () => {},
  };
}

export interface Fixture {
  home: string;
  /** 已授权项目（默认按 mode 授权 c1） */
  projectA: string;
  /** 未授权项目 */
  projectB: string;
  store: DbToolStore;
  service: DbToolService;
  /** 记录工厂收到的 mode（验证会话级只读双保险透传） */
  seenMode: { mode?: 'ro' | 'rw' };
  dispose: () => Promise<void>;
}

export async function makeFixture(mode: 'ro' | 'rw', adapterOpts?: FakeAdapterOptions): Promise<Fixture> {
  const home = makeTempHome();
  const store = new DbToolStore(home);
  store.connections.create({ id: CONN_ID, kind: 'mysql', url: CONN_URL });
  const projectA = path.join(os.tmpdir(), 'dbt-test-proj-a');
  const projectB = path.join(os.tmpdir(), 'dbt-test-proj-b');
  // grant 必须用归一化 key（service 校验时归一化）
  store.grants.grant(normalizeProjectKey(projectA), CONN_ID, mode);

  const seenMode: { mode?: 'ro' | 'rw' } = {};
  const service = new DbToolService(store, {
    adapterResolver: async () => (conn, opts) => {
      seenMode.mode = opts?.mode;
      return Promise.resolve(fakeAdapter({ ...adapterOpts, connId: conn.meta.id }));
    },
    challenges: new ChallengeStore({ sweepIntervalMs: 0 }),
  });
  return {
    home,
    projectA,
    projectB,
    store,
    service,
    seenMode,
    dispose: async () => {
      await service.dispose();
      cleanupDir(home);
    },
  };
}
