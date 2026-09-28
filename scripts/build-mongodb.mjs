#!/usr/bin/env node
/**
 * 构建 vendor/mongodb-driver.cjs：把 mongodb 驱动 bundle 成单文件（esbuild JS API）。
 *
 * 背景：DSH 宿主 @deepseek-ai/dsh-app-boot（<= 0.1.7-rc.2）在插件安装/加载时对依赖树
 * 逐包调 `require.resolve.paths(name)` 且未防护 null 返回值（for..of null → TypeError）。
 * mongodb → mongodb-connection-string-url → whatwg-url → tr46 → punycode 链会让生产依赖树
 * 出现核心模块同名包 punycode，在未修复宿主上直接炸掉整个插件。bundle 后 punycode/
 * whatwg-url/tr46/@mongodb-js/saslprep 全部内联进产物，不再出现在依赖树。
 *
 * --external:bson 是刻意设计：bson 保留在 dependencies，bundle 内 mongodb re-export 的
 * ObjectId/Binary 等来自运行时 require('bson')，与测试/插件其他代码 require 的 bson 是
 * 同一模块实例（instanceof 兼容，避免双份 BSON 类）。其余 externals 为 mongodb 全部
 * optional peer 依赖（驱动对其本就 try/catch 降级，缺失不影响功能）。
 *
 * 每次执行全量重建（esbuild 亚秒级），不做幂等跳过，避免"源升级产物旧"。
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'vendor', 'mongodb-driver.cjs');

/** bson 必须 external（实例一致性，见文件头注释）；其余为 mongodb optional peers */
const externals = [
  'bson',
  'bson-ext',
  'kerberos',
  'snappy',
  'socks',
  'gcp-metadata',
  '@aws-sdk/credential-providers',
  '@mongodb-js/zstd',
  'mongodb-client-encryption',
];

const entry = path.join(root, 'node_modules', 'mongodb', 'lib', 'index.js');
if (!statSync(entry, { throwIfNoEntry: false })) {
  console.error('[build-mongodb] 未找到 node_modules/mongodb/lib/index.js —— 请先 npm install（mongodb 在 devDependencies，提供 bundle 源）');
  process.exit(1);
}

mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: externals,
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  logLevel: 'warning',
});

const size = statSync(outfile).size;
console.log(`[build-mongodb] wrote vendor/mongodb-driver.cjs (${(size / 1024 / 1024).toFixed(2)} MB)`);
console.log('[build-mongodb] done');
