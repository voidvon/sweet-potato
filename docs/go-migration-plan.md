# Go 重构交付说明

## 目标状态

项目服务端已经收敛为 `backend` 下的单个 Go 进程：

```text
浏览器
  │ HTTP / SSE / WebSocket
  ▼
Go HTTP server
  ├── internal/httpapi   API、鉴权边界、文件和静态资源
  ├── internal/store     SQLite schema、迁移、repository
  ├── internal/auth      token 和密码校验
  ├── internal/video     视频模型 HTTP 客户端和异步任务轮询
  ├── internal/vod       VOD SDK、V4 签名、TOS 上传和视频处理任务
  └── embed.FS           Web/Admin 预构建资源
```

通过 `CGO_ENABLED=0 go build` 可以生成不依赖动态运行库的单一可执行文件。运行时只需
该文件、可写的数据目录和业务所需的外部模型/VOD 服务。应用上传和生成文件统一保存
在 `DATA_DIR/files`，当前不启用 TOS 对象存储。

## 已完成模块

- 用户注册、登录、token 校验、角色和权限。
- 用户、角色、路由资源、模型配置、计费和系统设置管理接口。
- SQLite 初始化、历史字段兼容、种子数据和本地文件存储。
- 内容分组、素材库、普通上传、直传、临时素材清理和作品管理。
- 视频任务、视频生产记录、批量生成、视频源解析、视频理解和口播视频工作流。
- 内容策划会话、发现页、聊天、SSE 事件和聊天 WebSocket 协议。
- Seedance/火山方舟异步视频接口和 OpenAI 风格视频接口，包含任务轮询、结果下载和
  本地产物落库。
- 火山引擎 VOD 视频高清放大、字幕擦除和 AI 视频翻译，包含本地源视频上传、任务恢复、
  结果下载、本地产物落库以及临时素材引用保护。
- Web 页面、Admin 页面、`/api/`、`/files/` 由同一进程提供。

旧数据库中的已删除业务表仍按历史 schema 保留，以便升级时不破坏已有数据；已经移除的
达人自动化和爆款复刻接口不会重新注册。

## 构建验收

```bash
make test
make vet
make build
```

构建产物默认是 `backend/bin/ai-marketing`。可以用环境变量指定地址和数据目录：

```bash
DATA_DIR=/var/lib/ai-marketing PORT=7072 ./backend/bin/ai-marketing
```

## 运行边界

视频模型、VOD 和外部平台仍然是网络依赖；Go 单文件不代表这些第三方服务被打进
二进制。未配置视频模型时，任务会使用本地 passthrough provider，保留任务和素材契约，
不会伪造外部模型结果。

VOD 处理需要配置火山引擎 AK/SK、VOD 空间和播放地址；未配置时，VOD 请求会在创建任务前
返回明确错误，不会生成无法执行的后台任务。

浏览器静态文件包含编译后的 JavaScript，这是浏览器运行所需的资源，不需要服务端运行
时安装 JavaScript 包管理器或启动额外的 JavaScript 进程。
