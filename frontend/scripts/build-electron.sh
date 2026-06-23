#!/bin/bash
# Electron 完整打包脚本（解决 pnpm 兼容性问题）

set -e

# 确保在 frontend 目录
cd "$(dirname "$0")/.."

PLATFORM="${1:-mac_arm64}"

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

# 2. 清理并备份 pnpm node_modules
echo "[2/6] 备份 pnpm 环境..."
rm -rf node_modules.pnpm.backup
if [ -d "node_modules" ]; then
  mv node_modules node_modules.pnpm.backup
fi

# 3. 使用 npm 安装 ALL 依赖（扁平化）
echo "[3/6] 使用 npm 安装依赖（扁平化结构）..."
# 保存原 package.json
cp package.json package.json.backup
# 删除 preinstall 钩子
node -e "const pkg=require('./package.json'); delete pkg.scripts.preinstall; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2))"
# 使用 npm 安装所有依赖
npm install --legacy-peer-deps --no-audit --no-fund --silent
# 恢复 package.json
mv package.json.backup package.json

echo "[3/6] 验证关键依赖..."
ls node_modules/copy-to >/dev/null 2>&1 && echo "  ✓ copy-to" || echo "  ✗ copy-to 缺失"
ls node_modules/unescape >/dev/null 2>&1 && echo "  ✓ unescape" || echo "  ✗ unescape 缺失"
ls node_modules/extend-shallow >/dev/null 2>&1 && echo "  ✓ extend-shallow" || echo "  ✗ extend-shallow 缺失"

# 4. 打包 Electron
echo "[4/6] 打包 Electron..."
npx ee-bin build --cmds="$PLATFORM"

# 5. 验证打包结果
echo "[5/6] 验证打包结果..."
if [ -f "out/萌猫-mac-4.2.0-arm64.dmg" ]; then
  echo "  ✓ 打包成功"
  APP_PATH="out/mac-arm64/萌猫.app/Contents/Resources/app"
  ls "$APP_PATH/node_modules/copy-to" >/dev/null 2>&1 && echo "  ✓ copy-to 已打包" || echo "  ✗ copy-to 未打包"
  ls "$APP_PATH/node_modules/unescape" >/dev/null 2>&1 && echo "  ✓ unescape 已打包" || echo "  ✗ unescape 未打包"
  echo "  node_modules 数量: $(ls "$APP_PATH/node_modules" | wc -l | tr -d ' ')"
else
  echo "  ✗ 打包失败"
fi

# 6. 恢复 pnpm 环境
echo "[6/6] 恢复 pnpm 环境..."
rm -rf node_modules package-lock.json
if [ -d "node_modules.pnpm.backup" ]; then
  mv node_modules.pnpm.backup node_modules
  echo "  ✓ pnpm 环境已恢复"
fi

echo ""
echo "✓ 流程完成！"
ls -lh out/*.dmg out/*.zip 2>/dev/null | awk '{print $9, $5}'
