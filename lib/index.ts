/**
 * dsh-db-tool 插件入口（形态对齐 dsh-ssh-tunnel：apply(ctx) + inject + ctx.effect）。
 *
 *  - 注册 DatabaseManager 模型工具（单工具多 action），projectPath 取自
 *    session header.cwd（不信任模型自报），业务操作经 GrantStore 授权。
 *  - HTTP API 挂载在 DSH webServer（prefix /dsh-db-tool/api）：前端同源
 *    相对路径 fetch('/dsh-db-tool/api/...') 即可达；trust 校验移植
 *    http-trust 逻辑（Host loopback / trustedHosts + Origin 同源校验）。
 *  - ctx.effect 收尾：注销 HTTP 路由、关适配器、停 challenge 清理。
 */
import { DbToolStore } from './store/index.js';
import { normalizeProjectKey } from './store/index.js';
import { DbToolService, handleToolAction, type ToolActionArgs } from './manager.js';
import { handleDbToolRequest } from './http/index.js';

/* ---------- DSH 运行时最小结构类型（宿主为 JS，运行时按结构匹配） ---------- */

interface ToolExecContext {
  agent?: { session?: { id?: string } };
}

interface DshContext {
  tools?: {
    register(tool: {
      name: string;
      timeoutMs?: number;
      description: string;
      parameters: Record<string, unknown>;
      output?: { schema?: Record<string, unknown>; render?: (text: string) => string };
      execute: (args: Record<string, unknown>, exec: ToolExecContext) => Promise<string>;
    }): void;
  };
  sessions?: {
    get(id: string): { header?: { cwd?: string } } | undefined;
  };
  webServer?: {
    register(h: {
      kind: 'prefix';
      path: string;
      handler: (req: unknown, res: unknown) => Promise<void> | void;
    }): () => void;
  };
  webRuntime?: { trustedHosts?: string[] };
  effect?: (fn: () => () => void, name?: string) => void;
  logger?: { info?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void };
}

/** cordis 注入清单（服务名以 dsh-ssh-tunnel 为准） */
export const inject = ['webServer', 'sessions', 'tools', 'webRuntime'];

const TOOL_DESCRIPTION = `数据库管理工具（dsh-db-tool）：在已配置的数据库连接上执行查询/写操作/脚本。

权限模型（务必遵守）：
- 每个连接对当前项目有 ro（只读）或 rw（读写）授权；未授权连接的一切业务操作被拒绝。
- ro 连接上 execute / run_script 直接被拒（READ_ONLY）；适配器层另有会话级只读双保险。
- 危险操作（DDL、删库、FLUSHALL 等）不会直接执行：返回 NEEDS_CONFIRMATION 与 challengeId。
  此时你必须先向用户说明语句与风险并征得明确同意，然后带着同一 challengeId 与原语句重试；
  challenge 一次性、绑定语句、5 分钟内有效。绝不要在未获用户同意时重试。

action 说明：
- list_connections：列出连接（脱敏，含各连接的 kind 与授权信息需另经 HTTP 面板查看）。
- query：只读 SQL/命令（conn_id, sql, params?）。
- execute：写操作/DDL（conn_id, statement, params?）。
- schema：结构浏览（conn_id；给 table 查列、给 database 查表、都不给列库）。
- preview：预览行，limit≤50（conn_id, table, database?, limit?）。
- run_script：node:vm 沙箱脚本（conn_id, code），60s 超时，仅注入受限 db.query/db.execute
  句柄（无 require/process/fs/网络），rw 连接才有写能力。`;

export function apply(ctx: DshContext): void {
  const log = ctx.logger ?? { info: () => {}, error: () => {} };
  const store = new DbToolStore();
  const service = new DbToolService(store);

  // HTTP API：挂在 DSH webServer 的 /dsh-db-tool/api 前缀下（同源访问）
  const trustedHosts = (): string[] => {
    try {
      return ctx.webRuntime?.trustedHosts ?? [];
    } catch {
      return [];
    }
  };
  ctx.effect?.(
    () =>
      ctx.webServer?.register({
        kind: 'prefix',
        path: '/dsh-db-tool/api',
        handler: async (req, res) => {
          await handleDbToolRequest(
            req as import('node:http').IncomingMessage,
            res as import('node:http').ServerResponse,
            service,
            { trustedHosts: trustedHosts() },
          );
        },
      }) ?? (() => {}),
    'db-tool-api',
  );

  // 收尾：适配器连接与 challenge 清理定时器
  ctx.effect?.(() => () => service.dispose(), 'db-tool-dispose');

  // 模型工具
  ctx.tools?.register({
    name: 'DatabaseManager',
    timeoutMs: 90_000,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_connections', 'query', 'execute', 'schema', 'preview', 'run_script'],
          description: '要执行的操作',
        },
        conn_id: { type: 'string', description: '连接 id（query/execute/schema/preview/run_script 必填）' },
        sql: { type: 'string', description: 'query 的只读 SQL/命令' },
        statement: { type: 'string', description: 'execute 的语句' },
        params: { type: 'array', items: {}, description: '占位符参数' },
        database: { type: 'string', description: '库/schema（可选）' },
        table: { type: 'string', description: '表/集合/键（schema/preview 用）' },
        limit: { type: 'number', description: 'preview 行数上限（≤50）' },
        offset: { type: 'number', description: 'preview 行偏移（翻页用，默认 0）' },
        code: { type: 'string', description: 'run_script 的脚本源码' },
        challenge_id: {
          type: 'string',
          description: '危险操作确认凭据：向用户确认后原样带回重试',
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'string' },
      render: (text: string) => text,
    },
    execute: async (args, exec) => {
      // projectPath 从 session header.cwd 取，不信任模型自报
      let projectPath = '';
      try {
        const sid = exec.agent?.session?.id ?? '';
        const cwd = sid !== '' ? ctx.sessions?.get(sid)?.header?.cwd : undefined;
        if (cwd) projectPath = normalizeProjectKey(cwd);
      } catch {
        // 取不到 cwd 视为匿名项目（业务操作会被拒，连接管理仍可用）
      }
      return handleToolAction(service, args as unknown as ToolActionArgs, projectPath);
    },
  });

  log.info?.('[db-tool] 插件已加载（DatabaseManager 工具 + /dsh-db-tool/api 挂载）');
}

export default apply;
