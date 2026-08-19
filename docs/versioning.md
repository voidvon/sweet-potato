# 统一版本管理

项目使用根目录 `VERSION` 作为唯一版本源。根应用、Electron、Web、Admin 和 Node 后端的
`package.json` 版本必须与它一致，禁止单独维护子项目版本。

版本格式为 `MAJOR.MINOR.PATCH`：

- 初始版本为 `0.1.0`。
- `MINOR` 和 `PATCH` 的取值范围都是 `0` 到 `99`。
- 每次发布构建递增 `PATCH`。
- `0.1.99` 的下一个版本是 `0.2.0`。
- `0.99.99` 的下一个版本是 `1.0.0`。
- 同一产物部署到多台机器、重启或回滚时不重复递增。

仓库当前基线是 `0.1.0`，所以下一次 Electron 发布构建会生成 `0.1.1`。

## 常用命令

```bash
pnpm version:current
pnpm version:check
pnpm version:sync
pnpm version:bump
```

`pnpm version:sync` 用于把 `VERSION` 同步到所有包清单。Electron 发布脚本会在构建前自动递增
版本，构建失败时恢复旧版本。普通开发和 Vite 构建只读取当前版本，不会递增。

发布期间会创建 `.version-release.lock/`，防止两个本地发布任务分配到冲突版本。若发布进程被
强制终止且确认没有其他发布任务运行，可以手动删除该目录。

## Web 运行时版本

Web 和 Admin 构建都会生成 `version.js`，并由生成的 `index.html` 在应用入口前加载：

```js
window.version = '0.1.0'
```

构建时还会把版本追加到原网页标题后，例如 `萌猫 AI v0.1.0` 和
`萌猫 AI 后台 v0.1.0`。源码中的 `<title>` 不需要手动维护版本。

使用外部同源脚本是为了兼容页面现有的 `script-src 'self'` CSP。生产环境中的 `version.js` 禁止
缓存，确保部署完成后读取到当前产物版本。
