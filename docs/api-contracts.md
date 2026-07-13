# API Contracts

Canonical team contract: `.plans/video-expert-skill-flow/docs/api-contracts.md`.

## 2026-07-13 Video Enhancement Contract

- `POST /api/content/video-enhancements` submits a Volcengine VOD AIGC enhancement task.
- Request body: `{ "sourceAssetId": string, "resolution"?: "1080p" | "2k" | "4k" }`; the authenticated user is always used as the task owner.
- The source asset must be a locally available video owned by the authenticated user.
- The response is a `VideoGenerationTask` with `expertContext.mode = "video_upscale"`; progress and results are returned by the existing `GET /api/content/video-productions` endpoint.
- `VOLCENGINE_VOD_PLAYBACK_BASE_URL` must be configured on the base service before submission so the returned VOD `StoreUri` can be resolved and mirrored locally.

## 2026-05-12 Backend Contract Update

- Viral remake now uses `/api/video-remake/*`; legacy `/api/content/video-tasks/*` remake endpoints have been removed.
- Direct video creation uses `/api/content/video-productions` and the configured default video model. Provider responses may contain either `videoUrl` or `jobId`.
- Missing or incomplete video model config returns `400` with `请先配置视频模型`. Provider failure marks the task `failed` with `failureReason`. No local mp4 fallback is created.
