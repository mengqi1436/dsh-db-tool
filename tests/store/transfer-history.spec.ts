/** transfer-log.jsonl：逐行事件追加、tail 过滤（项目/类型）、全量清除 */
import { describe, expect, it, afterEach } from 'vitest';
import { TransferLog } from '../../lib/store/transfer-history.js';
import { makeTempHome, cleanupDir } from './helpers.js';
import * as path from 'node:path';

let dir: string | null = null;
const store = () => {
  dir = path.join(makeTempHome(), 'db-tool');
  return new TransferLog(dir);
};
afterEach(() => { if (dir) { cleanupDir(path.dirname(dir)); dir = null; } });

const base = { projectPathKey: 'proj-a', statement: 'stmt' };

describe('TransferLog', () => {
  it('逐行追加各类型事件；tail 按项目与类型过滤；损坏行跳过', async () => {
    const h = store();
    h.append({ type: 'start', taskId: 't1', ...base });
    h.append({ type: 'table', taskId: 't1', ...base, table: 'a', rows: 10, totalRows: 30, status: 'running' });
    h.append({ type: 'finish', taskId: 't1', ...base, status: 'done', tables: [], failures: [] });
    require('node:fs').appendFileSync(path.join(dir!, 'transfer-log.jsonl'), '{broken\n');
    const all = h.tail(10);
    expect(all.map((e) => e.type)).toEqual(['start', 'table', 'finish']);
    expect(h.tail(10, 'proj-a', 'finish').map((e) => e.type)).toEqual(['finish']);
    expect(h.tail(10, 'proj-x')).toEqual([]);
  });

  it('clear 全量清除（损坏行保留）', () => {
    const h = store();
    h.append({ type: 'start', taskId: 't1', ...base });
    h.append({ type: 'finish', taskId: 't1', ...base, status: 'done', tables: [], failures: [] });
    require('node:fs').appendFileSync(path.join(dir!, 'transfer-log.jsonl'), '{broken\n');
    expect(h.clear()).toBe(2);
    expect(h.tail(10)).toEqual([]);
    expect(h.clear()).toBe(0);
  });
});
