# API Contracts

Canonical team contract: `.plans/video-expert-skill-flow/docs/api-contracts.md`.

## 2026-05-12 Backend Contract Update

- Viral remake now uses `/api/video-remake/*`; legacy `/api/content/video-tasks/*` remake endpoints have been removed.
- Direct video creation uses `/api/content/video-productions` and the configured default video model. Provider responses may contain either `videoUrl` or `jobId`.
- Missing or incomplete video model config returns `400` with `请先配置视频模型`. Provider failure marks the task `failed` with `failureReason`. No local mp4 fallback is created.
