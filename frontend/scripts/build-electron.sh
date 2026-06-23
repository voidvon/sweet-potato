#!/usr/bin/env bash
# Electron 完整打包脚本（解决 pnpm 兼容性问题）

set -Eeuo pipefail

# 确保在 frontend 目录
cd "$(dirname "$0")/.."

PLATFORM="${1:-mac_arm64}"
NODE_MODULES_BACKUP="node_modules.pnpm.backup"
PACKAGE_JSON_BACKUP="package.json.backup"
PACKAGE_LOCK_BACKUP="package-lock.json.backup"

cleanup() {
  local exit_code=$?

  echo "[6/6] 恢复 pnpm 环境..."
  if [ -f "$PACKAGE_JSON_BACKUP" ]; then
    mv "$PACKAGE_JSON_BACKUP" package.json
  fi

  rm -rf node_modules package-lock.json
  if [ -f "$PACKAGE_LOCK_BACKUP" ]; then
    mv "$PACKAGE_LOCK_BACKUP" package-lock.json
  fi

  if [ -d "$NODE_MODULES_BACKUP" ]; then
    mv "$NODE_MODULES_BACKUP" node_modules
    echo "  ✓ pnpm 环境已恢复"
  fi

  exit "$exit_code"
}

trap cleanup EXIT

app_bundle_path() {
  case "$PLATFORM" in
    mac_arm64)
      echo "out/mac-arm64/萌猫.app"
      ;;
    mac)
      echo "out/mac/萌猫.app"
      ;;
    *)
      echo ""
      ;;
  esac
}

electron_builder_repack_args() {
  case "$PLATFORM" in
    mac_arm64)
      echo "--config=./cmd/builder-mac-arm64.json -m --arm64"
      ;;
    mac)
      echo "--config=./cmd/builder-mac.json -m"
      ;;
    *)
      echo ""
      ;;
  esac
}

repair_and_verify_app_dependencies() {
  local app_root="$1"

  APP_ROOT="$app_root" SOURCE_NODE_MODULES="$(pwd)/node_modules" node <<'NODE'
const fs = require('fs');
const path = require('path');

const appRoot = process.env.APP_ROOT;
const appNodeModules = path.join(appRoot, 'node_modules');
const sourceNodeModules = process.env.SOURCE_NODE_MODULES;
const maxIterations = 10;

function packagePath(root, packageName) {
  return path.join(root, ...packageName.split('/'));
}

function packageDirs(root) {
  if (!fs.existsSync(root)) return [];

  const dirs = [];
  for (const entry of fs.readdirSync(root)) {
    if (entry === '.bin') continue;
    const fullPath = path.join(root, entry);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    if (entry.startsWith('@')) {
      for (const scopedEntry of fs.readdirSync(fullPath)) {
        const scopedPath = path.join(fullPath, scopedEntry);
        if (fs.statSync(scopedPath).isDirectory() && fs.existsSync(path.join(scopedPath, 'package.json'))) {
          dirs.push(scopedPath);
        }
      }
      continue;
    }

    if (fs.existsSync(path.join(fullPath, 'package.json'))) {
      dirs.push(fullPath);
    }
  }

  return dirs;
}

function hasPackage(packageName) {
  return fs.existsSync(path.join(packagePath(appNodeModules, packageName), 'package.json'));
}

function scanMissingDependencies() {
  const missing = new Map();

  for (const dir of packageDirs(appNodeModules)) {
    const pkgPath = path.join(dir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = pkg.dependencies || {};

    for (const depName of Object.keys(deps)) {
      if (!hasPackage(depName)) {
        const users = missing.get(depName) || [];
        users.push(`${pkg.name || path.basename(dir)}@${pkg.version || 'unknown'}`);
        missing.set(depName, users);
      }
    }
  }

  return missing;
}

let copied = 0;
for (let i = 0; i < maxIterations; i += 1) {
  const missing = scanMissingDependencies();
  if (missing.size === 0) break;

  for (const depName of missing.keys()) {
    if (hasPackage(depName)) continue;

    const sourcePath = packagePath(sourceNodeModules, depName);
    const targetPath = packagePath(appNodeModules, depName);
    if (!fs.existsSync(path.join(sourcePath, 'package.json'))) {
      console.error(`  ✗ ${depName} 缺失，且临时 npm node_modules 中也不存在`);
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.rmSync(targetPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    copied += 1;
    console.log(`  ✓ 补齐依赖 ${depName}`);
  }
}

const finalMissing = scanMissingDependencies();
if (finalMissing.size > 0) {
  console.error('  ✗ 打包产物仍存在缺失依赖:');
  for (const [depName, users] of finalMissing.entries()) {
    console.error(`    - ${depName}: required by ${users.join(', ')}`);
  }
  process.exit(1);
}

const checks = [
  'ee-core',
  'axios',
  'form-data',
  'es-set-tostringtag',
  'get-intrinsic',
  'math-intrinsics/abs',
  'has-symbols',
  'es-define-property',
  'function-bind',
];

for (const moduleName of checks) {
  require.resolve(moduleName, { paths: [appRoot] });
}

console.log(`  ✓ 运行时依赖闭包验证通过（补齐 ${copied} 个包）`);
if (copied > 0) {
  fs.writeFileSync(path.join(appRoot, '.dependencies-repaired'), String(copied));
}
NODE
}

sync_electron_runtime_assets() {
  local source_schema="../backend/base/src/shared/xingtu-creator-filter-schema.json"
  local target_dir="public/electron/service/browser-automation/adapters/xingtu"
  local target_schema="$target_dir/xingtu-creator-filter-schema.json"

  if [ ! -f "$source_schema" ]; then
    echo "  ✗ 星图筛选 schema 不存在: $source_schema" >&2
    exit 1
  fi

  mkdir -p "$target_dir"
  cp "$source_schema" "$target_schema"
  node -e "const schema=require('./$target_schema'); if (!Array.isArray(schema) || schema.length === 0) { throw new Error('Invalid xingtu creator filter schema'); }"
  echo "  ✓ 星图筛选 schema 已复制到 Electron 运行时资源"
}

echo "==== Electron 打包流程 ===="
echo "平台: $PLATFORM"
echo "工作目录: $(pwd)"
echo ""

# 1. 构建前端
echo "[1/6] 构建前端..."
cd web && pnpm run build --mode electron && cd ..

# 1.5. 复制前端产物到 public/dist
echo "[1.5/6] 复制前端产物到 public/dist..."
rm -rf public/dist
cp -r web/dist public/dist
echo "  ✓ 前端产物已复制"

echo "[1.6/6] 同步 Electron 主进程代码..."
pnpm exec ee-bin build --cmds=electron
sync_electron_runtime_assets

# 2. 清理并备份 pnpm node_modules
echo "[2/6] 备份 pnpm 环境..."
rm -rf "$NODE_MODULES_BACKUP" "$PACKAGE_JSON_BACKUP" "$PACKAGE_LOCK_BACKUP"
if [ -d node_modules ]; then
  mv node_modules "$NODE_MODULES_BACKUP"
fi
if [ -f package-lock.json ]; then
  mv package-lock.json "$PACKAGE_LOCK_BACKUP"
fi

# 3. 使用 npm 安装 ALL 依赖（扁平化）
echo "[3/6] 使用 npm 安装依赖（扁平化结构）..."
# 保存原 package.json
cp package.json "$PACKAGE_JSON_BACKUP"
# 删除 preinstall 钩子
node -e "const pkg=require('./package.json'); delete pkg.scripts.preinstall; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"
# 使用 npm 安装所有依赖
npm install --legacy-peer-deps --no-audit --no-fund --silent
# 恢复 package.json
mv "$PACKAGE_JSON_BACKUP" package.json

echo "[3/6] 验证关键依赖..."
node -e "for (const m of ['copy-to','unescape','extend-shallow','get-intrinsic','math-intrinsics/abs','has-symbols']) { require.resolve(m); console.log('  ✓ ' + m); }"

# 4. 打包 Electron
echo "[4/6] 打包 Electron..."
rm -rf out
npx ee-bin build --cmds="$PLATFORM"

# 5. 验证打包结果
echo "[5/6] 验证打包结果..."
APP_BUNDLE="$(app_bundle_path)"
if [ -n "$APP_BUNDLE" ] && [ -d "$APP_BUNDLE" ]; then
  APP_PATH="$APP_BUNDLE/Contents/Resources/app"
  repair_and_verify_app_dependencies "$APP_PATH"
  node -e "const path=require('node:path'); const appPath=path.resolve('$APP_PATH'); require(path.join(appPath, 'public/electron/service/browser-automation/adapters/xingtu/creator-market.js')); console.log('  ✓ 星图达人市场 adapter 可从打包产物加载');"
  if [ -f "$APP_PATH/.dependencies-repaired" ]; then
    REPACK_ARGS="$(electron_builder_repack_args)"
    if [ -n "$REPACK_ARGS" ]; then
      echo "  重新生成安装包以包含补齐后的依赖..."
      # shellcheck disable=SC2086
      npx electron-builder $REPACK_ARGS --prepackaged "$APP_BUNDLE"
      rm -f "$APP_PATH/.dependencies-repaired"
    fi
  fi
  echo "  node_modules 数量: $(find "$APP_PATH/node_modules" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
else
  echo "  未找到可验证的 macOS app bundle，跳过运行时依赖闭包验证"
fi

echo ""
echo "✓ 流程完成！"
ls -lh out/*.dmg out/*.zip 2>/dev/null | awk '{print $9, $5}'
