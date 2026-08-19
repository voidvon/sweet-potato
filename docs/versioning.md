# 统一版本管理

项目使用根目录 `VERSION` 作为唯一版本源。Go 服务和已嵌入的 Web/Admin 静态资源使用同一
版本号，发布时应同步更新 `VERSION` 和静态资源中的 `version.js`。

版本格式为 `MAJOR.MINOR.PATCH`：

- 初始版本为 `0.1.0`。
- `MINOR` 和 `PATCH` 的取值范围都是 `0` 到 `99`。
- 每次发布构建递增 `PATCH`。
- `0.1.99` 的下一个版本是 `0.2.0`。
- `0.99.99` 的下一个版本是 `1.0.0`。
- 同一产物部署到多台机器、重启或回滚时不重复递增。

## 发布检查

```bash
make check
make build
```

发布产物是 `backend/bin/ai-marketing`。版本号不通过包管理器同步，也不需要额外的
前端、桌面或服务进程参与构建。

Web/Admin 页面会在入口加载各自的 `version.js`，用于显示构建版本。发布前应确认两个
文件中的版本与根目录 `VERSION` 一致，并使用 `make build` 重新生成最终可执行文件。
