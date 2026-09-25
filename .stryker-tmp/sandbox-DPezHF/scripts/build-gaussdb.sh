#!/usr/bin/env bash
# 构建 GaussDB（openGauss）官方 Node 驱动 vendor 产物。
#
# 官方 openGauss-connector-nodejs 未发布 npm，需从源码构建：
#   bash scripts/build-gaussdb.sh            # 已有产物则跳过（幂等）
#   bash scripts/build-gaussdb.sh --force    # 强制重新拉取并构建
#   npm run build:gaussdb                    # 等价入口
#
# 手动步骤（脚本因网络等失败时可手动执行）：
#   git clone https://gitcode.com/opengauss/openGauss-connector-nodejs vendor/gaussdb-src
#   cd vendor/gaussdb-src && npm install && npm run build
#   rm -rf vendor/gaussdb-pg && cp -r packages/pg vendor/gaussdb-pg
#   # 注意保留 vendor/gaussdb-pg/package.json 与 dist/
#
# 产物：vendor/gaussdb-pg/packages/pg（CJS，结构同 pg：{ Pool, Client, ... }；
# pg lib 内 require('../../pg-protocol'/'../../pg-pool') 需 packages/ 布局）
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=vendor/gaussdb-src
DST=vendor/gaussdb-pg
FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; fi

if [ "$FORCE" != "1" ] && [ -f "$DST/packages/pg/package.json" ]; then
  echo "[build-gaussdb] 已存在 $DST/packages/pg/package.json，跳过（--force 可强制重建）"
  exit 0
fi

if [ -d "$SRC/.git" ]; then
  echo "[build-gaussdb] 源码已存在，更新..."
  git -C "$SRC" pull --ff-only
else
  echo "[build-gaussdb] 克隆 openGauss-connector-nodejs..."
  rm -rf "$SRC"
  mkdir -p vendor
  git clone https://gitcode.com/opengauss/openGauss-connector-nodejs "$SRC"
fi

echo "[build-gaussdb] 安装依赖并构建..."
(cd "$SRC" && npm install && npm run build)

echo "[build-gaussdb] 拷贝 packages 布局 -> $DST"
rm -rf "$DST"
mkdir -p "$DST/packages"
cp -r "$SRC/packages/pg" "$DST/packages/pg"
# pg lib 内 require('../../pg-protocol'/'../../pg-pool') 按 monorepo packages/ 布局解析
cp -r "$SRC/packages/pg-protocol" "$DST/packages/pg-protocol"
cp -r "$SRC/packages/pg-pool" "$DST/packages/pg-pool"
# 运行依赖（含 fork 源码已用但 package.json 未声明的 p-limit）
(cd "$DST/packages/pg" && npm install --omit=dev --no-audit --no-fund && npm install p-limit --omit=dev --no-audit --no-fund)

echo "[build-gaussdb] 构建完成 -> $DST/packages/pg"
