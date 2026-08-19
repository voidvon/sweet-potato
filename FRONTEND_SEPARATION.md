# 前后端分离 - 快速参考

## ✅ 改造完成

已成功将项目改造为前后端分离架构，支持 Web 和 Electron 两种使用方式。

## 📦 部署方式

### 1. Web 部署
```bash
cd frontend/web && pnpm run build
# 将 frontend/web/dist 部署到静态文件服务器
# 将 /api/ 和 /files/ 反向代理到 backend/base
```

### 2. Electron 客户端
```bash
# 配置服务器地址
vim frontend/web/.env.electron
# VITE_API_BASE_URL="http://your-server:7072"

# 打包
cd frontend
pnpm run build-electron-m-arm64  # macOS Apple Silicon
pnpm run build-electron-m        # macOS Intel
pnpm run build-electron-w        # Windows
pnpm run build-electron-l        # Linux
```

## 🔧 Electron 打包说明

由于 pnpm 符号链接与 electron-builder 不兼容，打包时自动切换到 npm：

1. `scripts/build-electron.sh` 自动完成所有步骤
2. 打包后自动恢复 pnpm 环境
3. 无需手动干预

详细说明：`frontend/ELECTRON_BUILD_GUIDE.md`

## 📁 关键文件

- `frontend/web/.env.electron` - Electron 服务器配置
- `frontend/scripts/build-electron.sh` - 自动化打包脚本
- `frontend/cmd/builder-*.json` - electron-builder 配置

## 📊 成果

- 安装包：117 MB（减少 60%）
- 架构：纯前后端分离
- 依赖：只保留 ee-core、electron-updater、playwright-core

## ⚠️ 注意事项

1. Electron 必须连接远程服务器（不支持离线）
2. 打包前必须配置 `.env.electron`
3. 生产环境建议使用 HTTPS
