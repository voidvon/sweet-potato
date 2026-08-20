# Go 单文件服务

这是项目唯一的服务端运行时。HTTP API、SSE、WebSocket、SQLite、文件服务、视频模型
调用以及包含 `/admin` 的统一 Web 静态资源都由一个 Go 进程提供。静态资源在构建时
临时放入 `internal/httpapi/static/`，并使用 `embed.FS` 打进可执行文件。

## 构建与运行

在仓库根目录执行完整的单文件构建：

```bash
make test
make vet
make build
./backend/bin/sweet-potato
```

`make build` 会构建唯一的 `frontend` Web 项目，临时复制到 Go 的
`embed.FS` 目录并编译，构建退出时自动删除临时目录。前端产物不会提交到 Git，
也不会作为运行时文件分发。

## 开发环境

在仓库根目录启动 Go 和统一网页开发环境：

```bash
make dev
```

`make dev-web` 是相同模式的显式别名。

脚本默认使用后端端口 `7072` 和前端端口 `9527`，并将本地数据写入仓库根目录的
`data/`。前端端口冲突时会自动顺延；如果 `7072` 已运行健康的 Go 服务则会直接复用。

也可以在本目录执行：

```bash
CGO_ENABLED=0 go test ./...
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o ./bin/sweet-potato ./cmd/sweetpotato
./bin/sweet-potato
```

直接执行 `go build` 只适合后端开发或 API 检查；由于没有临时嵌入前端资源，
生成的二进制不会提供前端页面。交付时请使用仓库根目录的 `make build`。

运行时只需要这个可执行文件和可写数据目录，不需要额外的服务进程。默认监听
`127.0.0.1:7072`，根路径提供 Web 页面，`/admin/` 提供管理页面，`/api/` 提供 API，
`/files/` 提供本地素材。

## 配置

- `GO_SERVER_ADDR`：完整监听地址，优先级高于 `GO_SERVER_HOST` 和 `PORT`。
- `GO_SERVER_HOST`、`PORT`：监听主机和端口。
- `DATA_DIR`：SQLite 数据库和素材目录，默认是当前目录下的 `data`。
- `JWT_SECRET` 或 `AUTH_TOKEN_SECRET`：鉴权 token 密钥。
- `JWT_EXPIRES_IN_SECONDS`：token 有效期，默认 30 天。
- `VIDEO_MODEL_API_KEY`、`VIDEO_MODEL_PROVIDER`、`VIDEO_MODEL_ID`、`VIDEO_MODEL_BASE_URL`：
  默认视频模型配置，也可以在管理端配置模型。
- `PUBLIC_BASE_URL`：外部视频模型下载本地素材时使用的公开地址。
- `VOLCENGINE_ACCESS_KEY_ID`、`VOLCENGINE_SECRET_ACCESS_KEY`、`VOLCENGINE_VOD_SPACE_NAME`：
  VOD 视频高清放大、字幕擦除和视频翻译所需的火山引擎凭证与空间。
- `VOLCENGINE_VOD_REGION`：VOD 区域，默认 `cn-north-1`。
- `VOLCENGINE_VOD_PLAYBACK_BASE_URL`：VOD 产物播放/下载域名；当接口只返回
  `StoreUri` 或 `FileName` 时，Go 服务使用它拼接产物地址并下载到本地。
- `VOD_POLL_INTERVAL_SECONDS`、`VOD_POLL_MAX_ATTEMPTS`、`VOD_TASK_TIMEOUT_SECONDS`：
  VOD 任务轮询间隔、最大次数和超时，默认分别为 `10`、`90`、`900`。

服务会从 `ENV_FILE`、`.env`、`config/.env` 和 `backend/.env` 依次加载配置；已经存在
的进程环境变量不会被覆盖。

迁移完成情况和兼容边界见 [`docs/go-migration-plan.md`](../docs/go-migration-plan.md)。
