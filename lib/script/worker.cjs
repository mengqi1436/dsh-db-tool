/**
 * run_script 子进程 worker（纯 JS，CommonJS，父进程 fork 直接加载）。
 *
 * 安全模型：
 *  - 脚本运行在 worker 进程的 vm.runInNewContext 新 realm 中，仅注入 db/console；
 *  - worker 进程以 Node permission model 启动（无文件系统权限），即使脚本逃逸
 *    vm realm，也读不到 secrets.json 等宿主文件；
 *  - db 调用经 IPC 回父进程，走完整 guard/challenge/审计链路；
 *  - 超时由父进程 SIGKILL 强杀（vm timeout 管不到异步，进程级才是真强杀）。
 *
 * IPC 协议：
 *  父→worker {type:'run', code}
 *  worker→父 {type:'db', reqId, method, args}
 *  父→worker {type:'dbResult', reqId, ok, result, error}
 *  worker→父 {type:'done', ok, result, error}
 */
'use strict';

const vm = require('node:vm');

process.on('message', (msg) => {
  if (!msg || msg.type !== 'run') return;
  runScript(String(msg.code ?? ''));
});

async function runScript(code) {
  /** db 请求队列：reqId → resolve */
  const pending = new Map();
  let reqSeq = 0;

  const dbCall = (method) => (statement, params) =>
    new Promise((resolve, reject) => {
      const reqId = ++reqSeq;
      pending.set(reqId, { resolve, reject });
      process.send({ type: 'db', reqId, method, args: [statement, params] });
    });

  const db = {
    query: dbCall('query'),
    execute: dbCall('execute'),
  };

  const consoleBridge = {
    log: (...a) => process.send({ type: 'log', level: 'log', text: a.map(fmt).join(' ') }),
    error: (...a) => process.send({ type: 'log', level: 'error', text: a.map(fmt).join(' ') }),
  };

  function fmt(v) {
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  // 父进程回包分发
  const onMessage = (msg) => {
    if (!msg) return;
    if (msg.type === 'dbResult') {
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      if (msg.ok) p.resolve(msg.result);
      else {
        const e = new Error(msg.error?.message ?? 'db 调用失败');
        if (msg.error?.code) e.code = msg.error.code;
        if (msg.error?.payload !== undefined) e.payload = msg.error.payload;
        p.reject(e);
      }
    }
  };
  process.on('message', onMessage);

  let sandbox;
  try {
    sandbox = vm.createContext({ db, console: consoleBridge });
    const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'db-script.js' });
    const result = await script.runInContext(sandbox, { timeout: 60000 });
    process.send({ type: 'done', ok: true, result: safeClone(result) });
  } catch (e) {
    process.send({
      type: 'done',
      ok: false,
      error: {
        name: e instanceof Error ? e.name : 'Error',
        message: e instanceof Error ? e.message : String(e),
        code: e && typeof e === 'object' && e.code !== undefined ? String(e.code) : undefined,
        payload: e && typeof e === 'object' && e.payload !== undefined ? safeClone(e.payload) : undefined,
      },
    });
  } finally {
    process.off('message', onMessage);
  }
}

function safeClone(v) {
  if (v === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}
