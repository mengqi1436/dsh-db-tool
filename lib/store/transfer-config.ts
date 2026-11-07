/**
 * transfer-config.json：项目级「数据传输」页连接/选项配置。
 *
 * 键是 normalizeProjectKey 归一化后的项目路径（与 grants.json 同构）：
 * 连接 id 只在该项目的授权上下文内有意义，全局共享会把 A 项目的选择
 * 泄露给未授权该连接的 B 项目。
 *
 * 只存 UI 上的 7 项用户配置；库/模式、任务快照、轮询、加载与错误态一律不落盘。
 */
import * as path from 'node:path';
import { normalizeProjectKey } from './normalize.js';
import { readJson, writeJsonAtomic } from './io.js';

export interface TransferConfig {
  sourceConnId: string;
  targetConnId: string;
  writeMode: 'insert' | 'ignore' | 'replace' | 'truncate';
  batchSize: number;
  tableConcurrency: number;
  shardConcurrency: number;
  overwriteStructure: boolean;
}

export const DEFAULT_TRANSFER_CONFIG: TransferConfig = {
  sourceConnId: '',
  targetConnId: '',
  writeMode: 'insert',
  batchSize: 1000,
  tableConcurrency: 4,
  shardConcurrency: 4,
  overwriteStructure: false,
};

interface TransferConfigFile {
  configs: Record<string, TransferConfig>;
}

export class TransferConfigStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'transfer-config.json');
  }

  private load(): TransferConfigFile {
    const raw = readJson<TransferConfigFile>(this.file, { configs: {} });
    return { configs: raw?.configs ?? {} };
  }

  /** 无存档返回完整默认值，前端无需逐字段判空 */
  get(projectPath: string): TransferConfig {
    const raw = this.load().configs[normalizeProjectKey(projectPath)];
    return raw ? { ...DEFAULT_TRANSFER_CONFIG, ...raw } : { ...DEFAULT_TRANSFER_CONFIG };
  }

  set(projectPath: string, config: TransferConfig): void {
    const data = this.load();
    data.configs[normalizeProjectKey(projectPath)] = config;
    // 0600 对齐 grants.json：项目↔连接映射本身也是敏感面
    writeJsonAtomic(this.file, data, 0o600);
  }
}
