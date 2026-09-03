<div align="center">

<img src="frontend/public/app-logo.png" alt="Sweet Potato AI" width="96" />

# 地瓜 AI / Sweet Potato AI

**自托管的 AI 内容生产工作台**

[English](README.md) | [中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/voidvon/sweet-potato?display_name=tag&sort=semver&color=brightgreen)](https://github.com/voidvon/sweet-potato/releases)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8.svg)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg)](https://vite.dev/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57.svg)](https://www.sqlite.org/)

</div>

## 项目简介

地瓜 AI（Sweet Potato AI）是一个面向个人创作者、内容团队和内部业务工具的自托管 AI 内容工作台，用于统一管理素材、生成内容和运行视频工作流。前端与后端最终会打包为一个 Go 可执行文件，React/Vite 网页资源会直接嵌入其中，生产环境不需要额外运行 Node.js 服务。

## 主要特性

- **统一工作台**：内容创作、素材管理、聊天、发现页和视频工作流集中在一个应用中。
- **管理后台**：支持用户、角色、路由权限、模型配置、计费规则、文件、系统设置和操作日志管理。
- **内容与素材库**：支持文件上传、内容分组、生成素材管理和作品查看。
- **AI 辅助创作**：支持聊天、图片生成、内容策划、分镜生成和视频任务流程。
- **视频处理能力**：支持视频理解、视频生成、口播视频、字幕擦除、画质增强和视频翻译流程。
- **异步任务持久化**：长时间运行的模型任务会保存到 SQLite，支持轮询和服务重启后的恢复。
- **单进程部署**：HTTP、SSE、WebSocket、API、文件服务、普通页面和 `/admin` 页面均由一个 Go 进程提供。
- **跨平台发布**：GitHub Release 提供 Linux、macOS 和 Windows 的预编译版本。
- **本地优先存储**：SQLite 数据、上传文件和生成文件保存在可配置的 `DATA_DIR` 下。

## 页面与工作流

项目包含两个相互连接的使用界面：

- **工作台**：内容生产、素材选择、聊天、内容策划、发现、批量生成和素材浏览。
- **管理后台**：用户和角色、模型配置、计费配置、路由资源、文件清理和访问日志。

## 快速开始

### 下载 Release

前往 [最新 Release](https://github.com/voidvon/sweet-potato/releases)，根据操作系统下载对应压缩包。

| 平台 | 文件 |
| --- | --- |
| Linux x86_64 | `sweet-potato-v0.1.59-linux-amd64.tar.gz` |
| Linux ARM64 | `sweet-potato-v0.1.59-linux-arm64.tar.gz` |
| macOS Intel | `sweet-potato-v0.1.59-darwin-amd64.tar.gz` |
| macOS Apple Silicon | `sweet-potato-v0.1.59-darwin-arm64.tar.gz` |
| Windows x86_64 | `sweet-potato-v0.1.59-windows-amd64.zip` |

可以使用 Release 中的 [`SHA256SUMS.txt`](https://github.com/voidvon/sweet-potato/releases/download/v0.1.59/SHA256SUMS.txt) 校验下载文件。以 Linux amd64 为例：

```bash
mkdir -p /opt/sweet-potato
tar -xzf sweet-potato-v0.1.59-linux-amd64.tar.gz -C /opt/sweet-potato
cd /opt/sweet-potato
./sweet-potato
```

浏览器访问 <http://127.0.0.1:7072>，管理后台地址为 `/admin/`。

生产环境请设置高强度鉴权密钥，并使用持久化数据目录：

```bash
DATA_DIR=/var/lib/sweet-potato \
AUTH_TOKEN_SECRET='请替换为足够长的随机密钥' \
GO_SERVER_ADDR=127.0.0.1:7072 \
./sweet-potato
```

> Release 压缩包只包含应用程序本身。外部模型服务和 VOD 服务需要单独配置。

## 从源码构建

### 环境要求

- Go 1.25 或更高版本
- Node.js 20 或更高版本，以及 npm
- 支持 Makefile 的 POSIX Shell 环境

### 构建并运行

详情图需要使用 PDF 产品资料时，请先安装 Poppler，并确保 `pdftocairo` 位于 `PATH` 中。macOS 可运行 `brew install poppler`；也可通过 `PDFTOCAIRO_PATH` 指定可执行文件的绝对路径。

```bash
git clone https://github.com/voidvon/sweet-potato.git
cd sweet-potato

npm --prefix frontend install
make test
make vet
make build
./backend/bin/sweet-potato
```

`make build` 会先构建 React 应用，再把生成的静态资源嵌入 Go 可执行文件，并在构建结束时删除临时目录。

### 开发模式

```bash
make dev
```

开发脚本会同时启动 Go 后端和 Vite 前端。后端默认端口为 `7072`，前端默认端口为 `9527`；如果端口被占用，脚本会自动选择其他端口。

## 配置说明

服务支持进程环境变量和 `.env` 文件。配置文件加载顺序为 `ENV_FILE`、`.env`、`config/.env` 和 `backend/.env`；已经存在的进程环境变量不会被覆盖。

| 变量 | 用途 |
| --- | --- |
| `GO_SERVER_ADDR` | 完整监听地址，例如 `127.0.0.1:7072` |
| `GO_SERVER_HOST` / `PORT` | 未设置 `GO_SERVER_ADDR` 时使用的主机和端口 |
| `DATA_DIR` | SQLite 数据库和本地文件目录 |
| `AUTH_TOKEN_SECRET` / `JWT_SECRET` | 鉴权 token 密钥 |
| `JWT_EXPIRES_IN_SECONDS` | 鉴权 token 有效期 |
| `VIDEO_MODEL_API_KEY` | 视频模型服务 API Key |
| `VIDEO_MODEL_PROVIDER` | 视频模型服务名称 |
| `VIDEO_MODEL_ID` | 默认视频模型 ID |
| `VIDEO_MODEL_BASE_URL` | 视频模型服务基础 URL |
| `PUBLIC_BASE_URL` | 外部服务下载本地素材时使用的公开地址 |
| `VOLCENGINE_ACCESS_KEY_ID` / `VOLCENGINE_SECRET_ACCESS_KEY` | 火山引擎凭证 |
| `VOLCENGINE_VOD_SPACE_NAME` | 火山引擎 VOD 空间 |
| `VOLCENGINE_VOD_REGION` | VOD 区域，默认 `cn-north-1` |
| `VOLCENGINE_VOD_PLAYBACK_BASE_URL` | VOD 产物播放或下载基础地址 |
| `VOD_POLL_INTERVAL_SECONDS` | VOD 任务轮询间隔 |
| `VOD_POLL_MAX_ATTEMPTS` | VOD 最大轮询次数 |
| `VOD_TASK_TIMEOUT_SECONDS` | VOD 任务超时时间 |

不要提交 `.env` 文件、访问密钥、运行日志、上传素材、生成视频或本地数据库。

## 系统架构

```text
浏览器
  |
  | HTTP / SSE / WebSocket
  v
地瓜 AI Go 服务
  |- HTTP API 与鉴权
  |- SQLite 存储与迁移
  |- 本地文件服务
  |- 视频、图片和模型客户端
  |- 嵌入式 React/Vite 网页应用
  `- 工作台与 /admin 路由
```

后端按职责组织在 `backend/internal/` 下；前端位于 `frontend/`，工作台和管理端共用 `frontend/src/shared/` 中的代码。

## 文档

- [API 契约](docs/api-contracts.md)
- [版本管理与发布检查](docs/versioning.md)
- [Go 重构与部署说明](docs/go-migration-plan.md)
- [视频源解析](docs/video-source-parser.md)
- [OpenAI Responses 能力要求](OPENAI-RESPONSES-CAPABILITIES-REQUIREMENTS.md)

## 安全与运维建议

- 生产环境请通过 HTTPS 访问服务。
- 使用唯一且高强度的鉴权密钥。
- 限制管理后台的访问范围，并保护 `DATA_DIR` 的文件系统权限。
- 外部模型、VOD 和公开回调地址属于部署依赖，不会被打进二进制。
- 启用任何第三方服务前，请先确认其服务条款和使用政策。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交 PR 前请运行：

```bash
git diff --check
make test
make vet
make build
```

请保持提交聚焦，并使用 Conventional Commits，例如 `feat:`、`fix:`、`refactor:`、`build:` 和 `docs:`。

## 许可证

具体许可证条款请以仓库和前端目录中的许可证文件为准。
