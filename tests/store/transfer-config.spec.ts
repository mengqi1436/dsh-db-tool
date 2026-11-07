import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeProjectKey } from '../../lib/store/normalize.js';
import { DbToolStore, DEFAULT_TRANSFER_CONFIG } from '../../lib/store/index.js';
import { cleanupDir, makeTempHome, readStoreFile } from './helpers.js';

const CFG = {
  sourceConnId: 'src-1',
  targetConnId: 'dst-1',
  writeMode: 'truncate' as const,
  batchSize: 250,
  tableConcurrency: 8,
  shardConcurrency: 12,
  overwriteStructure: true,
};

describe('TransferConfigStore', () => {
  let home: string;
  let store: DbToolStore;
  const p1 = normalizeProjectKey('/work/app1');
  const p2 = normalizeProjectKey('/work/app2');

  beforeEach(() => {
    home = makeTempHome();
    store = new DbToolStore(home);
  });

  afterEach(() => cleanupDir(home));

  it('无存档返回完整默认值（不创建文件）', () => {
    expect(store.transferConfig.get(p1)).toEqual(DEFAULT_TRANSFER_CONFIG);
    expect(fs.existsSync(path.join(home, 'db-tool', 'transfer-config.json'))).toBe(false);
  });

  it('set 后按项目读回，且另一项目不受影响', () => {
    store.transferConfig.set(p1, CFG);
    expect(store.transferConfig.get(p1)).toEqual(CFG);
    expect(store.transferConfig.get(p2)).toEqual(DEFAULT_TRANSFER_CONFIG);
  });

  it('set 覆盖写不残留旧版本内容', () => {
    store.transferConfig.set(p1, CFG);
    store.transferConfig.set(p1, { ...CFG, batchSize: 10, overwriteStructure: false });
    expect(store.transferConfig.get(p1).batchSize).toBe(10);
    expect(store.transferConfig.get(p1).overwriteStructure).toBe(false);
    const raw = JSON.parse(readStoreFile(home, 'transfer-config.json')) as { configs: Record<string, unknown> };
    expect(Object.keys(raw.configs)).toEqual([p1]);
  });

  it('键按 normalizeProjectKey 归一（Windows 大小写/分隔符变体命中同一条）', () => {
    const legacy = 'E:\\GitHub\\MyApp\\';
    const variant = normalizeProjectKey('e:/github/myapp');
    store.transferConfig.set(legacy, CFG);
    expect(store.transferConfig.get(variant)).toEqual(CFG);
  });

  it('transfer-config.json 以 0600 落盘（POSIX 断言）', () => {
    store.transferConfig.set(p1, CFG);
    const file = path.join(home, 'db-tool', 'transfer-config.json');
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== 'win32') {
      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('损坏 JSON 备份为 .bak 并回退默认值，且可继续写入', () => {
    const file = path.join(home, 'db-tool', 'transfer-config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"configs": {"half"', 'utf8');
    const again = new DbToolStore(home);
    expect(again.transferConfig.get(p1)).toEqual(DEFAULT_TRANSFER_CONFIG);
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toContain('half');
    again.transferConfig.set(p1, CFG);
    expect(again.transferConfig.get(p1)).toEqual(CFG);
  });

  it('畸形文件（configs 缺失）按空存档处理', () => {
    const file = path.join(home, 'db-tool', 'transfer-config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}', 'utf8');
    const again = new DbToolStore(home);
    expect(again.transferConfig.get(p1)).toEqual(DEFAULT_TRANSFER_CONFIG);
    again.transferConfig.set(p1, CFG);
    expect(again.transferConfig.get(p1)).toEqual(CFG);
  });
});
