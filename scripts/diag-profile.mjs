/** 诊断：完整复现 DSH 的 profile bundle 组合，输出每层与被跳过的 bundle 及原因。 */
import { loadProfile } from 'file:///E:/Tool/nvm/v24.19.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js';

const installAnchor = 'E:/Tool/nvm/v24.19.0/node_modules/@deepseek-ai/dsh';
const profile = loadProfile('dsh', 'web', installAnchor);
console.log('keys:', Object.keys(profile));
const composed = profile.profile ?? profile;

console.log('=== layers（包名 + patch 条目数）===');
for (const layer of composed.layers) {
  console.log(`- ${layer.packageName}  patches=${layer.patches?.length ?? 0}  dir=${layer.packageDir}`);
}
console.log('=== skippedBundles ===');
for (const s of (composed.skippedBundles ?? []) ?? []) {
  console.log(`- ${s.packageName}: ${s.reason}`);
}
console.log('=== db-tool patch 条目 ===');
for (const layer of composed.layers) {
  if (layer.packageName === 'dsh-db-tool') console.log(JSON.stringify(layer.patches, null, 1));
}

