// @ts-nocheck
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 为测试创建临时 home 目录（DbToolStore 会在其下建 db-tool/） */
export function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-db-tool-test-'));
}

/** 递归清理临时目录 */
export function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 读取 store 数据目录下的文件内容 */
export function readStoreFile(home: string, name: string): string {
  return fs.readFileSync(path.join(home, 'db-tool', name), 'utf8');
}
