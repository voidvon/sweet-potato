# Repository Guidelines

## Project Structure & Module Organization

本仓库的主应用由三部分组成：`frontend/` 是 Electron 外壳，`frontend/web/` 是 React + Vite 页面；`backend/base/` 是 TypeScript/Express API，核心代码在 `src/modules/`、数据库在 `src/db/`、通用工具在 `src/shared/`；`backend/ai-worker/` 是 Python 视频/AI worker，入口为 `worker.py`，业务代码在 `ai_worker/`。`docs/` 保存接口与设计文档，`build/` 与 `package-docker.sh` 用于交付包。

## Build, Test, and Development Commands

- `pnpm install`：安装所有依赖。
- Node 依赖统一使用 `pnpm`；仓库已禁止 `npm install`，避免锁文件和 `node_modules` 状态混用。
- `bash scripts/dev.sh`：同时启动 Python worker、Node 后端和前端/Electron 开发环境，默认端口为 `7073`、`7072`、`9527`。
- `bash scripts/dev-web.sh`：启动 Python worker、Node 后端和网页前端开发环境，不启动 Electron，并在前端就绪后自动打开浏览器，默认端口为 `7073`、`7072`、`9527`。
- `cd backend/base && pnpm run dev`：仅启动后端热更新服务。
- `cd backend/base && pnpm run build`：编译 TypeScript 到 `dist/`。
- `cd frontend/web && pnpm run build`：构建 Vite 前端产物。
- `cd frontend/web && pnpm run typecheck`：运行前端 TypeScript 类型检查。
- `bash package-docker.sh`：构建 Docker 运行目录与 compose 文件；需要可用的 Docker/网络环境。

## Coding Style & Naming Conventions

TypeScript 代码启用 `strict`，使用 ES module 语法、2 空格缩进、单引号和尾随分号。React 组件使用 `PascalCase.tsx`，API 封装按模块放在 `frontend/web/src/api/<module>/`。后端模块遵循 `*.routes.ts`、`*.service.ts`、`*.repository.ts`、`*.types.ts` 的分层命名。Python worker 使用清晰的领域分层：`domain/` 放纯业务逻辑，`services/` 放外部流程编排。

## Testing Guidelines

当前主应用没有统一测试脚本；提交前至少运行相关构建和类型检查。新增测试时，建议按功能就近放置，命名为 `*.test.ts`、`*.test.tsx` 或 `test_*.py`，并在对应 `package.json` 或 README 中补充运行命令。涉及 API 契约、视频生成流程或上传逻辑的改动，应补充最小可复现用例或手动验证步骤。

## Commit & Pull Request Guidelines

提交历史使用 Conventional Commits，例如 `feat: ...`、`fix(preload): ...`、`build(frontend): ...`、`chore: ...`。保持提交聚焦，scope 优先使用受影响区域，如 `backend`、`frontend`、`ai-worker`。PR 应包含变更摘要、验证命令、相关 issue/计划链接；前端 UI 改动附截图或录屏，接口变更同步更新 `docs/api-contracts.md` 或相关设计文档。

## Security & Configuration Tips

不要提交 `.env`、密钥、运行日志、上传文件和生成的视频数据。后端环境变量优先放在 `backend/base/.env`，AI worker 配置放在 `backend/ai-worker/.env`。涉及火山引擎、上传回调或公开资源 URL 的改动，确认本地、Docker 和 Electron 三种运行路径都能解析。
