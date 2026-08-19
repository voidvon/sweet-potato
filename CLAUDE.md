# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> See `AGENTS.md` for the canonical repo guidelines (in Chinese). This file summarizes the big picture and adds Claude-specific notes. Respond in Simplified Chinese per the user's global instructions.

## Architecture

This is an AI marketing/video desktop app built as a three-tier system, all started together by one dev script:

```
Electron shell (frontend/)  ──wraps──▶  React+Vite SPA (frontend/web/)
                                              │ HTTP/WS
                                              ▼
                                  Node/Express API (backend/base/, :7072)
                                              │ HTTP RPC
                                              ▼
                                  Python AI worker (backend/ai-worker/, :7073)
```

- **frontend/** — Electron (electron-egg) shell. **frontend/web/** — the actual UI: React 19, Vite 7, Ant Design 6, react-router 7. Default dev port `9527`.
- **backend/base/** — TypeScript/Express API. Owns business logic, SQLite (better-sqlite3), and LangChain/LangGraph orchestration. Talks to the Python worker over HTTP.
- **backend/ai-worker/** — Python video/AI worker. Handles video understanding, Volcengine VOD upload, and FFmpeg media tools. Entry point `worker.py`.

The same code paths must resolve under local development and Electron. When changing anything involving Volcengine, upload callbacks, or asset URLs, verify both.

## Commands

Package manager is **pnpm only** — every `package.json` has a preinstall hook that aborts if run under npm.

```bash
pnpm install                          # install (run at repo root or per-package)
bash scripts/dev.sh                   # full stack incl. Electron (needs: pnpm, uv, lsof)
bash scripts/dev-web.sh               # full stack, web only (no Electron), auto-opens browser
# backend/base
cd backend/base && pnpm run dev       # tsx watch hot-reload
cd backend/base && pnpm run build     # tsc -> dist/
cd backend/base && pnpm test          # tsx --test tests/**/*.test.ts

# frontend/web
cd frontend/web && pnpm run build     # vite build
cd frontend/web && pnpm run typecheck # tsc --noEmit (use this as the frontend check)
```

The Python worker is launched by the dev scripts via `uv run --no-project --with-requirements requirements.txt python dev_reload.py` — it relies on `uv`, not a pre-created venv. Worker tests use pytest (`backend/ai-worker/tests/`).

There is no unified test runner across the three tiers. Before committing, at minimum run the build/typecheck and any tests for the tier you touched.

## Backend module conventions (backend/base/src/)

- Each feature is a module under `src/modules/<feature>/` using layered file naming: `*.routes.ts`, `*.service.ts`, `*.repository.ts`, `*.types.ts`, plus `*.events.ts` where modules emit events. Shared utilities live in `src/shared/`, DB in `src/db/`, config in `src/config/`.
- Routers are wired in `src/app.ts` via `create<Feature>Router()` factories. `requireAuth` middleware guards everything except `/api/health` and the static `/files/*` mounts.
- **ESM with explicit `.js` import specifiers**: source is `.ts` but imports reference the compiled output, e.g. `import { dataDir } from './db/database.js'`. Match this — do not drop the `.js` extension.
- `migrateDatabase()` runs on app creation; schema lives in `src/db/schema.ts`.

## AI worker conventions (backend/ai-worker/ai_worker/)

Domain-driven layering: `domain/` holds pure business logic, `services/` orchestrates external flows, `infra/` holds tooling (logger, media_tools, douyin/cookie helpers). App wiring in `app.py`, config in `config.py`.

## Code style

TypeScript `strict`, ES modules, 2-space indent, single quotes, trailing semicolons. React components are `PascalCase.tsx`; frontend API wrappers go under `frontend/web/src/api/<module>/`. Commits follow Conventional Commits with area scopes (`feat:`, `fix(billing):`, `build(frontend):`), written in Chinese.

## Don't commit

`.env` files, secrets, run logs, uploaded files, or generated video data. Backend env goes in `backend/base/.env`; worker env in `backend/ai-worker/.env`.
