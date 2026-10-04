/**
 * transfer-log.jsonl：传输过程日志（追加式，逐行一条事件）。
 * 事件类型：
 *  - start    任务开始（statement 含源→目标/定位/模式）
 *  - table    单表状态变化（开始传输 / 完成 / 失败，含已写入行数）
 *  - progress 任务进度节流行（运行中各表实时行数，默认 5s 一条）
 *  - finish   任务终态（全量表明细 + 失败清单；「传输历史」弹窗即取此类型）
 * 追加写天然原子；损坏行跳过不影响其余。文件位于 <我的文档>/DSH/，用户可直接打开查看。
 */
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type TransferLogType = 'start' | 'table' | 'progress' | 'finish';

export interface TransferLogEntry {
  ts: string;
  type: TransferLogType;
  taskId: string;
  projectPathKey: string;
  /** 任务描述（与审计同款：源→目标、表清单、模式、定位） */
  statement: string;
  status?: string;
  /** table/progress 事件：涉及的单表 */
  table?: string;
  /** table/progress/finish 事件：已写入行数 */
  rows?: number;
  totalRows?: number | null;
  /** finish 事件：全量表明细与失败清单 */
  tables?: Array<{
    name: string;
    status: string;
    rows: number;
    totalRows: number | null;
    shardsTotal: number;
    shardsDone: number;
    shardsFailed: number;
    error?: string;
  }>;
  failures?: Array<{ table: string; shard: number; error: string; lastKey?: string }>;
}

export type TransferLogInput = Omit<TransferLogEntry, 'ts'> & { ts?: string };

let cachedDocsDir: string | undefined;

/** 检测「我的文档」真实位置（每台机器可能重定向到任意盘/目录） */
function detectDocumentsDir(): string {
  if (cachedDocsDir) return cachedDocsDir;
  let dir = '';
  // Windows 官方途径：Shell API GetFolderPath('MyDocuments')——自动处理文档重定向。
  // 不用 reg.exe：其中文系统输出为 GBK，utf8 解码会把重定向目录名变成乱码（实测踩坑）
  if (process.platform === 'win32') {
    try {
      const out = childProcess.execFileSync(
        'powershell',
        ['-NoProfile', '-Command', "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"],
        { timeout: 15000, encoding: 'utf8' },
      );
      dir = out.trim();
    } catch {
      // PowerShell 不可用：走候选路径回退
    }
  }
  if (dir === '') {
    const home = os.homedir();
    const candidates =
      process.platform === 'win32'
        ? [process.env.OneDrive ? path.join(process.env.OneDrive, 'Documents') : '', path.join(home, 'Documents')]
        : [process.env.XDG_DOCUMENTS_DIR ?? '', path.join(home, 'Documents')];
    dir = candidates.find((c) => c !== '' && fs.existsSync(c)) ?? path.join(home, 'Documents');
  }
  cachedDocsDir = dir;
  return dir;
}

/** 传输日志存储目录：<我的文档>/DSH/；DSH_TRANSFER_DIR 环境变量可覆盖 */
export function transferLogDir(): string {
  const override = process.env.DSH_TRANSFER_DIR;
  if (override && override !== '') {
    fs.mkdirSync(override, { recursive: true });
    return override;
  }
  const dir = path.join(detectDocumentsDir(), 'DSH');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export class TransferLog {
  private readonly filePath: string;

  /** JSONL 文件绝对路径（供「在本机查看」） */
  get file(): string {
    return this.filePath;
  }

  constructor(dir: string) {
    this.filePath = path.join(dir, 'transfer-log.jsonl');
    fs.mkdirSync(dir, { recursive: true }); // 目录不存在时 appendFileSync 会 ENOENT
  }

  /** 追加一条日志；ts 省略时自动填充当前 UTC 时间 */
  append(entry: TransferLogInput): TransferLogEntry {
    const full: TransferLogEntry = { ...entry, ts: entry.ts ?? new Date().toISOString() };
    fs.appendFileSync(this.filePath, JSON.stringify(full) + '\n', 'utf8');
    return full;
  }

  /** 最近 n 条（时间正序）；projectKey/type 给定时过滤。损坏行跳过 */
  tail(n: number, projectKey?: string, type?: TransferLogType): TransferLogEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
    const out: TransferLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const e = JSON.parse(line) as TransferLogEntry;
        if (projectKey && e.projectPathKey !== projectKey) continue;
        if (type && e.type !== type) continue;
        out.push(e);
      } catch {
        // 跳过损坏行
      }
    }
    return out.reverse();
  }

  /** 清除全部日志。返回删除条数 */
  clear(): number {
    if (!fs.existsSync(this.filePath)) return 0;
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
    const kept: string[] = [];
    let removed = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        JSON.parse(t) as TransferLogEntry;
        removed += 1;
      } catch {
        kept.push(t); // 损坏行原样保留
      }
    }
    fs.writeFileSync(this.filePath, kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf8');
    return removed;
  }
}
