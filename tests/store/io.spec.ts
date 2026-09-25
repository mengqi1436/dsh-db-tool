import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJson, writeJsonAtomic } from '../../lib/store/io.js';
import { DbToolStore } from '../../lib/store/index.js';
import { cleanupDir, makeTempHome, readStoreFile } from './helpers.js';

describe('io：原子写与损坏容错', () => {
  let home: string;

  beforeEach(() => {
    home = makeTempHome();
  });

  afterEach(() => cleanupDir(home));

  it('writeJsonAtomic 落盘内容正确且无临时文件残留', () => {
    const file = path.join(home, 'data.json');
    writeJsonAtomic(file, { a: 1 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 1 });
    expect(fs.readdirSync(home).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('覆盖写不残留旧版本内容', () => {
    const file = path.join(home, 'data.json');
    writeJsonAtomic(file, { v: 1 });
    writeJsonAtomic(file, { v: 2 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ v: 2 });
  });

  it('readJson：文件不存在返回 fallback', () => {
    expect(readJson(path.join(home, 'nope.json'), { fallback: true })).toEqual({ fallback: true });
  });

  it('损坏 JSON 备份为 .bak 并返回 fallback（store 级验证）', () => {
    const store = new DbToolStore(home);
    store.connections.create({ id: 'a', kind: 'mysql' });
    expect(store.connections.list()).toHaveLength(1);

    // 模拟进程崩溃导致的半截 JSON
    const connsFile = path.join(home, 'db-tool', 'connections.json');
    fs.writeFileSync(connsFile, '{"connections": [{"id": "half"', 'utf8');

    const again = new DbToolStore(home);
    expect(again.connections.list()).toEqual([]); // 容错重建为空
    expect(fs.existsSync(`${connsFile}.bak`)).toBe(true); // 损坏现场保留
    expect(fs.readFileSync(`${connsFile}.bak`, 'utf8')).toContain('half');

    // 且 store 可继续正常工作
    again.connections.create({ id: 'b', kind: 'redis' });
    expect(again.connections.list().map((m) => m.id)).toEqual(['b']);
  });

  it('secrets.json 损坏同样容错且重建后权限仍为 0600（POSIX）', () => {
    const store = new DbToolStore(home);
    store.secrets.set('c1', { password: 'p' });
    const secretsFile = path.join(home, 'db-tool', 'secrets.json');
    fs.writeFileSync(secretsFile, 'not json at all', 'utf8');

    const again = new DbToolStore(home);
    expect(again.secrets.get('c1')).toBeUndefined();
    expect(again.secrets.get('c1')).toBeUndefined(); // 二次读同样安全
    again.secrets.set('c2', { password: 'q' });
    expect(again.secrets.get('c2')).toEqual({ password: 'q' });
    expect(readStoreFile(home, 'secrets.json')).toContain('q');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(secretsFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('目录权限尽力设为 0700（POSIX）', () => {
    new DbToolStore(home);
    if (process.platform === 'win32') return;
    const mode = fs.statSync(path.join(home, 'db-tool')).mode & 0o777;
    expect(mode).toBe(0o700);
  });
});
