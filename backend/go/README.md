# Go 单文件服务

这是项目唯一的服务端运行时。HTTP API、SSE、WebSocket、SQLite、文件服务、视频模型
调用以及 Web/Admin 静态资源都由一个 Go 进程提供。静态资源已经放入
`internal/httpapi/static/`，构建时使用 `embed.FS` 打进可执行文件。

## 构建与运行

在仓库根目录执行：

```bash
make test
make vet
make build
./backend/go/bin/ai-marketing
```

也可以在本目录执行：

```bash
CGO_ENABLED=0 go test ./...
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o ./bin/ai-marketing ./cmd/aimarketing
./bin/ai-marketing
```

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

服务会从 `ENV_FILE`、`.env`、`config/.env` 和 `backend/go/.env` 依次加载配置；已经存在
的进程环境变量不会被覆盖。

迁移完成情况和兼容边界见 [`docs/go-migration-plan.md`](../../docs/go-migration-plan.md)。
