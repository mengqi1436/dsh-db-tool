import { describe, expect, it } from 'vitest';
import { normalizeProjectKey } from '../../lib/store/normalize.js';

describe('normalizeProjectKey', () => {
  it('同一目录不同写法归一化为同一 key（分隔符/尾分隔符）', () => {
    if (process.platform === 'win32') {
      expect(normalizeProjectKey('C:\\Code\\Proj\\')).toBe('c:/Code/Proj');
      expect(normalizeProjectKey('C:/Code/Proj')).toBe(normalizeProjectKey('c:\\Code\\Proj\\'));
    } else {
      expect(normalizeProjectKey('/tmp/proj/')).toBe('/tmp/proj');
      expect(normalizeProjectKey('/tmp/./proj//')).toBe(normalizeProjectKey('/tmp/proj'));
    }
  });

  it('盘符大写归一为小写（路径段保留原大小写）', () => {
    if (process.platform === 'win32') {
      expect(normalizeProjectKey('D:\\Work\\App')).toBe('d:/Work/App');
      expect(normalizeProjectKey('d:\\Work\\App')).toBe('d:/Work/App');
    }
  });

  it('分隔符统一为 / 且去尾分隔符', () => {
    if (process.platform === 'win32') {
      expect(normalizeProjectKey('E:\\a\\b\\c\\')).toBe('e:/a/b/c');
    } else {
      expect(normalizeProjectKey('/a/b/c/')).toBe('/a/b/c');
    }
  });

  it('相对路径按 cwd 解析为绝对路径', () => {
    const key = normalizeProjectKey('sub/dir');
    if (process.platform === 'win32') {
      expect(key).toMatch(/^[a-z]:\//); // Windows 为 'x:/...' 形式
    } else {
      expect(key.startsWith('/')).toBe(true);
    }
    expect(key.endsWith('sub/dir')).toBe(true);
    expect(key.includes('\\')).toBe(false);
  });

  it('归一化是幂等的', () => {
    const once = normalizeProjectKey(process.platform === 'win32' ? 'C:\\A\\B' : '/a/b');
    expect(normalizeProjectKey(once)).toBe(once);
  });
});
