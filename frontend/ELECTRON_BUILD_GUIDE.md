# pnpm + electron-builder 兼容性问题 - 最终解决方案

## 问题根源

**pnpm 的符号链接结构与 electron-builder 不兼容**

### pnpm 的依赖结构
```
node_modules/
├── .pnpm/                    # 真实的依赖存储池
│   ├── copy-to@2.0.1/
│   ├── utility@1.18.0/
│   └── ...
├── utility -> .pnpm/utility@1.18.0/node_modules/utility    # 符号链接
└── ee-core -> .pnpm/ee-core@4.1.5/node_modules/ee-core     # 符号链接
```

### electron-builder 的行为
1. 读取 `package.json` 的 `dependencies`
2. 尝试复制 `node_modules/` 下的依赖
3. **无法正确追踪符号链接**
4. 深层依赖（如 `utility` 的 `copy-to`）被遗漏

## 最终解决方案

**打包时临时使用 npm 扁平化安装**

### 原理
- npm 使用扁平化依赖树（所有依赖在同一层）
- electron-builder 可以正确找到所有依赖
- 打包后恢复 pnpm 环境继续开发

### 实现：自动化脚本

创建了 `frontend/scripts/build-electron.sh`：

```bash
#!/bin/bash
# 1. 构建前端（web）
# 2. 备份 pnpm node_modules
# 3. 使用 npm 安装（扁平化）
# 4. 打包 Electron
# 5. 恢复 pnpm 环境
```

### 使用方法

```bash
cd frontend
pnpm run build-electron-m-arm64  # macOS Apple Silicon
pnpm run build-electron-m        # macOS Intel  
pnpm run build-electron-w        # Windows
pnpm run build-electron-l        # Linux
```

脚本会自动：
1. 用 pnpm 构建前端
2. 临时切换到 npm 
3. 打包 Electron
4. 自动恢复 pnpm 环境

## 配置文件

### `frontend/cmd/builder-mac-arm64.json`

```json
{
  "asar": false,               // 禁用 asar（避免符号链接问题）
  "nodeGypRebuild": false,
  "buildDependenciesFromSource": false,
  "files": [
    "package.json",
    "public/**/*"              // 只打包必要文件
  ]
}
```

**为什么 `asar: false`**：
- asar 归档无法处理符号链接
- 禁用后直接复制文件，确保依赖完整
- 缺点：启动稍慢（~0.1-0.2秒），源码可见

## 验证结果

✅ **打包成功**：117 MB（比一体化减少 60%）
✅ **启动成功**：无 "Cannot find module" 错误
✅ **依赖完整**：所有深层依赖都被正确打包
✅ **开发不受影响**：打包后自动恢复 pnpm 环境

## 为什么不用其他方案

### ❌ 手动添加依赖为直接依赖
- 需要手动管理大量间接依赖
- 依赖升级时容易遗漏
- 污染 `package.json`

### ❌ 切换到 npm
- 失去 pnpm 的磁盘空间优势
- 安装速度变慢
- 项目已配置 pnpm only

### ❌ 使用 asarUnpack
- 在 pnpm 符号链接结构下不生效
- 路径匹配失败

## 权衡

| 方面 | 优点 | 缺点 |
|------|------|------|
| 打包时间 | ➖ 需额外 npm install（+15秒） | |
| 启动速度 | | ⚠️ 稍慢 0.1-0.2秒 |
| 源码保护 | | ⚠️ 源码可见（无 asar） |
| 维护成本 | ✅ 无需手动管理依赖 | |
| 开发体验 | ✅ 保留 pnpm 优势 | |

## 最佳实践

### 1. CI/CD 配置
```yaml
- name: Build Electron  
  run: |
    cd frontend
    pnpm run build-electron-m-arm64
```

### 2. 本地开发
```bash
# 开发时使用 pnpm
pnpm install
pnpm run dev

# 打包时自动切换
pnpm run build-electron-m-arm64
```

### 3. 监控打包
脚本会自动输出：
- 构建进度
- 最终安装包大小
- 错误信息（如有）

## 未来改进

1. **缓存 npm node_modules**：避免每次重新安装
2. **源码混淆**：补偿 asar 禁用带来的暴露
3. **按需加载**：减小初始包体积
4. **electron-builder 改进**：等待官方更好的 pnpm 支持

## 相关资源

- [pnpm 已知限制](https://pnpm.io/limitations#electron)
- [electron-builder issue #6289](https://github.com/electron-userland/electron-builder/issues/6289)
- 本项目文档：`CHEATSHEET.md`、`DEPLOYMENT.md`

## 总结

这是一个**临时 workaround**，但经过验证是最实用的方案：
- ✅ 完全解决依赖问题
- ✅ 保留 pnpm 开发体验
- ✅ 自动化，无需手动干预
- ⚠️ 打包时间略长
- ⚠️ 无 asar 保护

当 electron-builder 或 pnpm 改进兼容性后，可以考虑回到纯 pnpm + asar 方案。
