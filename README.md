<div align="center">

<img src="frontend/public/app-logo.png" alt="Sweet Potato AI" width="96" />

# Sweet Potato AI

**A self-hosted AI content production workspace**

[English](README.md) | [中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/voidvon/sweet-potato?display_name=tag&sort=semver&color=brightgreen)](https://github.com/voidvon/sweet-potato/releases)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8.svg)](https://go.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg)](https://vite.dev/)
[![SQLite](https://img.shields.io/badge/Database-SQLite-003B57.svg)](https://www.sqlite.org/)

</div>

## Overview

Sweet Potato AI is a self-hosted AI content workspace for organizing media, generating and managing content, and operating video workflows from one web application. The frontend and backend are shipped together as a single Go executable with an embedded React/Vite web application.

It is designed for individual creators, content teams, and internal tools that need a practical workspace around text, images, videos, assets, and model integrations without a separate Node.js process in production.

## Features

- **Unified workspace** - Content creation, asset management, chat, discovery, and video workflows share one application.
- **Admin console** - Manage users, roles, route permissions, model settings, billing rules, files, and system settings.
- **Content and asset library** - Upload files, organize content groups, manage generated assets, and inspect works.
- **AI-assisted creation** - Chat, image generation, content planning, storyboard generation, and video task flows.
- **Video processing** - Video understanding, video generation, talking-video workflows, subtitle removal, enhancement, and translation.
- **Async task handling** - Long-running provider jobs are persisted in SQLite and can be polled or recovered after a restart.
- **Single-process deployment** - HTTP, SSE, WebSocket, API, file serving, and the `/admin` web app are served by one Go process.
- **Cross-platform releases** - Prebuilt binaries are published for Linux, macOS, and Windows on GitHub Releases.
- **Local-first storage** - SQLite data and uploaded/generated files are kept under the configurable `DATA_DIR`.

## Screens and workflows

The application includes two connected surfaces:

- **Workspace** - Content production, media selection, chat, planning, discovery, batch generation, and asset browsing.
- **Admin** - User and role management, model configuration, billing configuration, route resources, file cleanup, and operational logs.

## Quick Start

### Download a release

Open the [latest release](https://github.com/voidvon/sweet-potato/releases) and download the archive for your platform.

| Platform | Asset |
| --- | --- |
| Linux x86_64 | `sweet-potato-v0.1.56-linux-amd64.tar.gz` |
| Linux ARM64 | `sweet-potato-v0.1.56-linux-arm64.tar.gz` |
| macOS Intel | `sweet-potato-v0.1.56-darwin-amd64.tar.gz` |
| macOS Apple Silicon | `sweet-potato-v0.1.56-darwin-arm64.tar.gz` |
| Windows x86_64 | `sweet-potato-v0.1.56-windows-amd64.zip` |

Verify downloads with [`SHA256SUMS.txt`](https://github.com/voidvon/sweet-potato/releases/download/v0.1.56/SHA256SUMS.txt), then extract the archive and run the binary:

```bash
mkdir -p /opt/sweet-potato
tar -xzf sweet-potato-v0.1.56-linux-amd64.tar.gz -C /opt/sweet-potato
cd /opt/sweet-potato
./sweet-potato
```

Open <http://127.0.0.1:7072> in a browser. The admin surface is available at `/admin/`.

For production, set a strong authentication secret and use a persistent data directory:

```bash
DATA_DIR=/var/lib/sweet-potato \
AUTH_TOKEN_SECRET='replace-with-a-long-random-secret' \
GO_SERVER_ADDR=127.0.0.1:7072 \
./sweet-potato
```

> Release archives contain the application binary only. External model providers and VOD services must be configured separately.

## Build From Source

### Requirements

- Go 1.25 or newer
- Node.js 20 or newer and npm
- A POSIX shell for the Makefile targets
- Poppler (`pdftocairo`) for converting PDF product pages into 200 DPI image references

Install Poppler with `brew install poppler` on macOS, or set `PDFTOCAIRO_PATH` to the absolute `pdftocairo` executable path.

### Build and run

```bash
git clone https://github.com/voidvon/sweet-potato.git
cd sweet-potato

npm --prefix frontend install
make test
make vet
make build
./backend/bin/sweet-potato
```

`make build` builds the React application, embeds the generated static files into the Go binary, and removes the temporary build directories when it finishes.

### Development mode

```bash
make dev
```

The development script runs the Go backend and the Vite frontend together. The default backend port is `7072`; the frontend uses `9527` and automatically moves to another port if necessary.

## Configuration

Configuration can be provided through the process environment or `.env` files. The service checks `ENV_FILE`, `.env`, `config/.env`, and `backend/.env`; existing process environment variables are not overwritten.

| Variable | Purpose |
| --- | --- |
| `GO_SERVER_ADDR` | Complete listen address, for example `127.0.0.1:7072` |
| `GO_SERVER_HOST` / `PORT` | Host and port when `GO_SERVER_ADDR` is not set |
| `DATA_DIR` | SQLite database and local file directory |
| `AUTH_TOKEN_SECRET` / `JWT_SECRET` | Authentication token secret |
| `JWT_EXPIRES_IN_SECONDS` | Authentication token lifetime |
| `VIDEO_MODEL_API_KEY` | API key for the configured video model provider |
| `VIDEO_MODEL_PROVIDER` | Video provider name |
| `VIDEO_MODEL_ID` | Default video model identifier |
| `VIDEO_MODEL_BASE_URL` | Video provider base URL |
| `PUBLIC_BASE_URL` | Public URL used when providers need to download local assets |
| `VOLCENGINE_ACCESS_KEY_ID` / `VOLCENGINE_SECRET_ACCESS_KEY` | Volcengine credentials for VOD workflows |
| `VOLCENGINE_VOD_SPACE_NAME` | Volcengine VOD space |
| `VOLCENGINE_VOD_REGION` | VOD region, default `cn-north-1` |
| `VOLCENGINE_VOD_PLAYBACK_BASE_URL` | Playback/download base URL for VOD outputs |
| `VOD_POLL_INTERVAL_SECONDS` | VOD polling interval |
| `VOD_POLL_MAX_ATTEMPTS` | Maximum VOD polling attempts |
| `VOD_TASK_TIMEOUT_SECONDS` | VOD task timeout |

Never commit `.env` files, access keys, runtime logs, uploaded assets, generated videos, or local databases.

## Architecture

```text
Browser
  |
  | HTTP / SSE / WebSocket
  v
Sweet Potato AI Go server
  |- HTTP API and authentication
  |- SQLite stores and migrations
  |- Local file service
  |- Video/image/model clients
  |- Embedded React/Vite web app
  `- Workspace and /admin routes
```

The backend is organized under `backend/internal/` by responsibility. The frontend is under `frontend/`, with workspace and admin applications sharing code from `frontend/src/shared/`.

## Documentation

- [API contracts](docs/api-contracts.md)
- [Versioning and release checks](docs/versioning.md)
- [Go migration and deployment notes](docs/go-migration-plan.md)
- [Video source parsing](docs/video-source-parser.md)
- [OpenAI Responses capability requirements](OPENAI-RESPONSES-CAPABILITIES-REQUIREMENTS.md)

## Security and operational notes

- Run the service behind HTTPS in production.
- Use a unique, high-entropy authentication secret.
- Restrict access to the admin surface and protect the `DATA_DIR` filesystem permissions.
- External model, VOD, and public callback URLs are deployment dependencies and are not bundled into the binary.
- Review the terms and policies of every upstream provider before enabling an integration.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run:

```bash
git diff --check
make test
make vet
make build
```

Keep commits focused and use Conventional Commit messages such as `feat:`, `fix:`, `refactor:`, `build:`, and `docs:`.

## License

See the repository and frontend license files for the applicable license terms.
