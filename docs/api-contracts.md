# API 接口契约

团队统一契约文档：`.plans/video-expert-skill-flow/docs/api-contracts.md`。

## 2026-07-13 字幕擦除契约

- `POST /api/content/subtitle-removals` 提交火山引擎 VOD 精细化字幕擦除任务；登录用户始终作为任务所有者。
- 请求体包含 `sourceAssetId`、`mode`（`auto | auto_region | manual`）、`contentType`（`subtitle | text`）、`locations` 和 `clipFilter`。
- `locations` 使用相对于视频宽高的 `0~1` 比例坐标；`auto_region` 和 `manual` 至少需要一个有效矩形区域。
- `clipFilter.mode` 支持 `all | selected | skip`。非 `all` 模式必须提供非空的 `clips` 数组，每项包含合法的 `start`、`end` 秒数；服务端仍兼容历史单段 `start`、`end` 请求。
- 返回 `VideoGenerationTask`，其中 `expertContext.mode = "subtitle_removal"`；任务状态及产物继续通过 `GET /api/content/video-productions` 获取。
- Base 服务需要配置 `VOLCENGINE_VOD_PLAYBACK_BASE_URL`，用于将 VOD 返回的 `FileName` 解析为可播放地址并镜像到本地。

## 2026-05-12 后端契约更新

- `POST /api/content/video-enhancements` submits a Volcengine VOD AIGC enhancement task.
- Request body: `{ "sourceAssetId": string, "resolution"?: "1080p" | "2k" | "4k" }`; the authenticated user is always used as the task owner.
- The source asset must be a locally available video owned by the authenticated user.
- The response is a `VideoGenerationTask` with `expertContext.mode = "video_upscale"`; progress and results are returned by the existing `GET /api/content/video-productions` endpoint.
- `VOLCENGINE_VOD_PLAYBACK_BASE_URL` must be configured on the base service before submission so the returned VOD `StoreUri` can be resolved and mirrored locally.

## 2026-05-12 Backend Contract Update

- 爆款复刻现在使用 `/api/video-remake/*`，旧版 `/api/content/video-tasks/*` 复刻接口已移除。
- 直接创建视频使用 `/api/content/video-productions` 和已配置的默认视频模型。供应商响应可能包含 `videoUrl` 或 `jobId`。
- 视频模型配置缺失或不完整时返回 `400` 和 `请先配置视频模型`。供应商调用失败时，任务会标记为 `failed`，并记录 `failureReason`，不会创建本地 mp4 兜底文件。

## 视频理解 Agent

`POST /api/video-understanding/stream` 通过 `@volcengine/ark-runtime` 调用火山方舟 Chat API，并以 SSE 事件流返回结果。该接口要求调用方具备聊天权限。

请求默认使用 Files API 上传，视频 `fps = 2`；两项参数都可以在请求中覆盖：

```json
{
  "prompt": "请描述视频中的人物动作，并按时间顺序输出。",
  "inputs": [
    {
      "type": "video_url",
      "video_url": {
        "filePath": "/absolute/path/video.mp4",
        "fps": 2
      }
    }
  ],
  "useFilesApi": true,
  "fps": 2
}
```

`inputs` 还支持 `image_url` 和 `input_audio`。每个媒体输入支持 `fileId`、`url`、`data` 或 `filePath`，且只能选择其中一种来源。流式响应会发送 `start`、`delta`、`reasoning_delta`、`usage`、`done` 和 `error` 事件。

Base 配置使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `ARK_VIDEO_MODEL`。Files API 默认开启，视频默认 `fps = 2`，这两个默认值不从环境变量读取，但可以在单次请求中覆盖。API Key 必须保存在 base 服务端配置中，不能由客户端传入。
