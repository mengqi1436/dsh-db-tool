/**
 * 数据根解析与旧位置迁移（lib/store/index.ts）：
 *  - 生产路径（不注入 homeDir）：数据根 = <我的文档>/DSH/db-tool，DSH_DB_TOOL_DIR 可覆盖；
 *  - 传输日志与 db-tool 同根（<我的文档>/DSH/transfer-log.jsonl）；
 *  - 旧位置 $DSH_HOME/db-tool 的数据按文件粒度迁移，绝不覆盖新位置已有文件；
 *  - 测试注入 homeDir 时完全跳过迁移，避免读写真实用户目录。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbToolStore } from '../../lib/store/index.js';
import { cleanupDir } from './helpers.js';

const LEGACY_FILES = ['connections.json', 'secrets.json', 'grants.json', 'transfer-config.json', 'audit.jsonl'];

describe('数据根解析与旧位置迁移', () => {
  let root: string;
  let legacyHome: string;
  const savedEnv = {
    DSH_HOME: process.env['DSH_HOME'],
    DSH_DB_TOOL_DIR: process.env['DSH_DB_TOOL_DIR'],
    VITEST: process.env['VITEST'],
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-root-'));
    legacyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-legacy-'));
  });

  afterEach(() => {
    cleanupDir(root);
    cleanupDir(legacyHome);
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('DSH_DB_TOOL_DIR 覆盖数据根，数据落在 <root>/db-tool/', () => {
    process.env['DSH_DB_TOOL_DIR'] = root;
    process.env['DSH_HOME'] = legacyHome; // 旧位置为空，迁移无事可做
    const store = new DbToolStore();
    expect(store.dir).toBe(path.join(root, 'db-tool'));
    expect(fs.existsSync(store.dir)).toBe(true);
  });

  it('传输日志与 db-tool 同根（<root>/transfer-log.jsonl），不再散落到别处', () => {
    process.env['DSH_DB_TOOL_DIR'] = root;
    process.env['DSH_HOME'] = legacyHome;
    delete process.env['VITEST']; // 生产分支：日志走 path.dirname(dir)
    const store = new DbToolStore();
    expect(store.transferLog.file).toBe(path.join(root, 'transfer-log.jsonl'));
  });

  it('旧位置 $DSH_HOME/db-tool 的文件被迁移到新根，且保留旧文件不删', () => {
    const legacyDir = path.join(legacyHome, 'db-tool');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyConn = JSON.stringify({ connections: [{ id: 'legacy-1' }] });
    for (const name of LEGACY_FILES) {
      fs.writeFileSync(path.join(legacyDir, name), name === 'connections.json' ? legacyConn : 'x');
    }
    process.env['DSH_DB_TOOL_DIR'] = root;
    process.env['DSH_HOME'] = legacyHome;
    const store = new DbToolStore();
    expect(fs.readFileSync(path.join(store.dir, 'connections.json'), 'utf8')).toBe(legacyConn);
    for (const name of LEGACY_FILES) {
      expect(fs.existsSync(path.join(store.dir, name)), name).toBe(true);
      expect(fs.existsSync(path.join(legacyDir, name)), name + ' 旧文件应保留').toBe(true);
    }
  });

  it('新位置已有同名文件时不被旧数据覆盖（目标优先）', () => {
    const legacyDir = path.join(legacyHome, 'db-tool');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'connections.json'), 'LEGACY');
    const newDir = path.join(root, 'db-tool');
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'connections.json'), 'NEW');
    process.env['DSH_DB_TOOL_DIR'] = root;
    process.env['DSH_HOME'] = legacyHome;
    new DbToolStore();
    expect(fs.readFileSync(path.join(newDir, 'connections.json'), 'utf8')).toBe('NEW');
  });

  it('注入 homeDir 时完全跳过迁移（测试隔离，不碰真实数据根）', () => {
    const legacyDir = path.join(legacyHome, 'db-tool');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'connections.json'), 'LEGACY');
    process.env['DSH_HOME'] = legacyHome;
    const store = new DbToolStore(root);
    expect(store.dir).toBe(path.join(root, 'db-tool'));
    expect(fs.existsSync(path.join(store.dir, 'connections.json'))).toBe(false);
  });

  it('旧位置不存在时不报错、不创建多余文件', () => {
    process.env['DSH_DB_TOOL_DIR'] = root;
    process.env['DSH_HOME'] = path.join(legacyHome, 'no-such-home');
    const store = new DbToolStore();
    expect(fs.existsSync(store.dir)).toBe(true);
    expect(fs.readdirSync(store.dir)).toEqual([]);
  });
});
