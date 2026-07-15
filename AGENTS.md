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

TypeScript 代码启用 `strict`，使用 ES module 语法、2 空格缩进、单引号和无分号风格（仅在避免 ASI 语义歧义时保留必要的前置分号）。React 组件使用 `PascalCase.tsx`，API 封装按模块放在 `frontend/web/src/api/<module>/`。后端模块遵循 `*.routes.ts`、`*.service.ts`、`*.repository.ts`、`*.types.ts` 的分层命名。Python worker 使用清晰的领域分层：`domain/` 放纯业务逻辑，`services/` 放外部流程编排。

## Testing Guidelines

当前主应用没有统一测试脚本；提交前至少运行相关构建和类型检查。新增测试时，建议按功能就近放置，命名为 `*.test.ts`、`*.test.tsx` 或 `test_*.py`，并在对应 `package.json` 或 README 中补充运行命令。涉及 API 契约、视频生成流程或上传逻辑的改动，应补充最小可复现用例或手动验证步骤。

## Commit & Pull Request Guidelines

提交历史使用 Conventional Commits，例如 `feat: ...`、`fix(preload): ...`、`build(frontend): ...`、`chore: ...`。保持提交聚焦，scope 优先使用受影响区域，如 `backend`、`frontend`、`ai-worker`。PR 应包含变更摘要、验证命令、相关 issue/计划链接；前端 UI 改动附截图或录屏，接口变更同步更新 `docs/api-contracts.md` 或相关设计文档。

## Security & Configuration Tips

不要提交 `.env`、密钥、运行日志、上传文件和生成的视频数据。后端环境变量优先放在 `backend/base/.env`，AI worker 配置放在 `backend/ai-worker/.env`。涉及火山引擎、上传回调或公开资源 URL 的改动，确认本地、Docker 和 Electron 三种运行路径都能解析。

## Codex Execution Fast Path

- 简单任务（通常不超过 2 个文件、无接口/依赖/构建配置变化）只读取直接相关代码和最近邻样式；除非用户明确指定或触发规则强制要求，不启动重型 skill、多代理或全仓扫描。
- 同一轮已经读取过的大文件、截图目录和 `.workflow/` 产物不得重复读取；后续只读取新的行区间或复用已有结论。
- 验证按风险递进：纯文案/CSS/图标修改先运行 `git diff --check`；局部 TypeScript/React 修改批量完成后运行一次相关 `typecheck` 或就近测试；有针对性测试时优先运行对应测试文件。
- 仅在跨模块契约、依赖或锁文件、Vite/TypeScript/打包配置发生变化，或准备发布/用户明确要求时运行完整 build。发现局部检查无法覆盖风险时必须升级验证，不得为了速度跳过必要检查。
- 命令成功时只保留退出码和一行摘要；失败时只回传首个可执行错误及末尾必要上下文，避免把完整构建文件清单、重复警告或长日志写入会话。
- 优先复用已经运行的 `7072`/`7073`/`9527` 服务和当前页面；先确认端口状态，不为简单 UI 修改重复启动服务或新浏览器会话。
- 多个小修改合并后只做一次同级验证，避免每个单行修改都重复 typecheck/build；用户中途改变要求时，以最终状态统一验证。
- 长线程出现多个独立问题、重复上下文或显著 token 膨胀时，先生成不超过 15 行的 handoff，包含目标、已改文件、未提交状态、验证结果和下一步，再在新任务继续；不得让后续简单任务重复携带完整历史。
- 默认高能力模型与推理档不变。只有用户或调用方显式选择 `--profile fast` / `--profile balanced` 时，才使用对应低/中推理档；复杂架构、疑难调试、安全、数据迁移和高风险发布继续使用默认 high。
