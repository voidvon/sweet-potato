# Repository Guidelines

## Project Structure & Module Organization

本仓库由一个 Go 服务组成：`backend/cmd/aimarketing/` 是可执行文件入口，`backend/internal/httpapi/` 提供 HTTP、SSE、WebSocket、静态资源和文件服务，`backend/internal/store/` 负责 SQLite 持久化，`backend/internal/auth/` 负责鉴权，`backend/internal/video/` 负责视频模型客户端。Web/Admin 浏览器产物位于 `backend/internal/httpapi/static/`，通过 `embed.FS` 编译进可执行文件；`docs/` 保存接口与迁移文档。

## Build, Test, and Development Commands

- `make dev` 或 `make dev-web`：统一启动 Go、Web 和 Admin 网页开发环境。
- `make dev-electron`：统一启动 Go、Web、Admin 和 Electron 开发环境。
- `make build`：构建无 CGO 的单个 Go 可执行文件到 `backend/bin/ai-marketing`。
- `make run`：启动 Go 服务，默认监听 `127.0.0.1:7072`。
- `make test`：运行全部 Go 单元测试和 HTTP 契约测试。
- `make vet`：运行 Go 静态检查。
- `cd backend && gofmt -w cmd internal`：格式化 Go 源码。

## Coding Style & Naming Conventions

Go 代码使用 `gofmt`，包按 `cmd/`、`internal/` 分层，领域逻辑放在内部包中，错误应保留上下文并在 HTTP 边界统一转换。标准库优先；仅使用纯 Go SQLite 驱动，保持跨平台无 CGO 构建能力。

## Testing Guidelines

测试按 Go 包就近放置，命名为 `*_test.go`。涉及 API 契约、视频生成流程或上传逻辑的改动，应补充 HTTP 契约测试、SQLite 回归测试或最小手动验证步骤。

## Commit & Pull Request Guidelines

提交历史使用 Conventional Commits，例如 `feat: ...`、`fix(httpapi): ...`、`build(go): ...`、`chore: ...`。保持提交聚焦，scope 优先使用受影响区域，如 `go`、`store`、`httpapi`。PR 应包含变更摘要、验证命令和相关接口文档。

## Security & Configuration Tips

不要提交 `.env`、密钥、运行日志、上传文件和生成的视频数据。环境变量可放在运行目录 `.env` 或通过进程环境传入。涉及火山引擎、上传回调或公开资源 URL 的改动，确认单进程服务和历史 SQLite 数据目录都能解析。

## Codex Execution Fast Path

- 简单任务（通常不超过 2 个文件、无接口/依赖/构建配置变化）只读取直接相关代码和最近邻样式；除非用户明确指定或触发规则强制要求，不启动重型 skill、多代理或全仓扫描。
- 同一轮已经读取过的大文件、截图目录和 `.workflow/` 产物不得重复读取；后续只读取新的行区间或复用已有结论。
- 验证按风险递进：文档或静态资源修改先运行 `git diff --check`；Go 代码批量完成后运行一次相关测试和 `vet`；有针对性测试时优先运行对应测试文件。
- 仅在跨模块契约、依赖或锁文件、Vite/TypeScript/打包配置发生变化，或准备发布/用户明确要求时运行完整 build。发现局部检查无法覆盖风险时必须升级验证，不得为了速度跳过必要检查。
- 命令成功时只保留退出码和一行摘要；失败时只回传首个可执行错误及末尾必要上下文，避免把完整构建文件清单、重复警告或长日志写入会话。
- 优先复用已经运行的 `7072` Go 服务和当前页面；先确认端口状态，不为简单修改重复启动服务或新浏览器会话。
- 多个小修改合并后只做一次同级验证，避免每个单行修改都重复 typecheck/build；用户中途改变要求时，以最终状态统一验证。
- 长线程出现多个独立问题、重复上下文或显著 token 膨胀时，先生成不超过 15 行的 handoff，包含目标、已改文件、未提交状态、验证结果和下一步，再在新任务继续；不得让后续简单任务重复携带完整历史。
- 默认高能力模型与推理档不变。只有用户或调用方显式选择 `--profile fast` / `--profile balanced` 时，才使用对应低/中推理档；复杂架构、疑难调试、安全、数据迁移和高风险发布继续使用默认 high。
