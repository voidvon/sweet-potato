# API 接口契约

团队统一契约文档：`.plans/video-expert-skill-flow/docs/api-contracts.md`。

## 2026-07-15 视频制作任务超时契约

- `/app/content/create_video` 当前已接入的视频生成、视频高清放大、字幕擦除和视频翻译任务，默认处理超时统一为 15 分钟。
- 默认轮询次数会根据轮询间隔自动换算：10 秒间隔为 90 次，30 秒间隔为 30 次。
- `VIDEO_GENERATION_POLL_MAX_ATTEMPTS`、`VIDEO_ENHANCEMENT_POLL_MAX_ATTEMPTS`、`VIDEO_SUBTITLE_REMOVAL_POLL_MAX_ATTEMPTS` 和 `VIDEO_TRANSLATION_POLL_MAX_ATTEMPTS` 仍可覆盖各模块的默认上限。

## 2026-07-14 AI 视频翻译契约

- `POST /api/content/video-translations` 提交火山引擎 VOD AI 视频翻译任务；登录用户始终作为任务所有者。
- 请求体包含 `sourceAssetId`、`sourceLanguage`、`targetLanguage`、`translationTypes`、`subtitleSource` 和 `subtitleConfig`。
- `translationTypes` 使用 `subtitle | voice | face`，字幕翻译必选，面容翻译必须同时启用语音翻译；`subtitleSource` 支持 `ocr | asr`。
- 开启硬字幕时，`subtitleConfig` 必须包含 `fontSize`、`marginL`、`marginR`、`marginV`、`showLines`；三个边距都是相对视频宽高的 `0~1` 比例。
- 返回 `VideoGenerationTask`，其中 `expertContext.mode = "video_translation"`；任务状态、失败原因及产物继续通过 `GET /api/content/video-productions` 获取。
- Base 服务会先把源视频上传到配置的 VOD 空间，再通过 AI worker 调用 `SubmitAITranslationWorkflow` 并轮询 `ListAITranslationProject`。产物优先使用火山返回的 `OutputVideo.Url`；仅返回 `FileName` 时需要 `VOLCENGINE_VOD_PLAYBACK_BASE_URL`。

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

`POST /api/video-understanding/stream` 通过 `@volcengine/ark-runtime` 调用火山方舟 Responses API，并以 SSE 事件流返回结果。该接口要求调用方具备聊天权限。

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

Base 配置使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `ARK_VIDEO_MODEL`。`ARK_VIDEO_MODEL` 可以切换为任意支持对应图片、视频或音频输入的多模态方舟模型。Files API 默认开启，视频默认 `fps = 2`，这两个默认值不从环境变量读取，但可以在单次请求中覆盖。API Key 必须保存在 base 服务端配置中，不能由客户端传入。

## 一键策划实时事件

`GET /api/content-planning/events` 为一键策划提供用户级 SSE 事件流，要求具备视频创作权限。客户端使用 `sessionId` 过滤当前弹窗对应的事件。

事件名固定为 `planning`，数据类型包括：

- `reasoning_stream`：当前 Agent 阶段公开审计文本的实时快照。
- `stage_completed`：阶段结构化结果已完成，并附带不可变的 `reasoningLog`。
- `generation_failed`：生成失败，客户端应清除当前流式草稿并回退到会话错误状态。

`GET /api/content-planning/sessions/:id/updates` 同时返回 `reasoningStream`，用于 SSE 断线、关闭弹窗后重新打开以及后台继续生成时恢复最新文本。模型隐藏推理字段不会传给客户端；实时展示内容来自结构化输出中的公开 `auditText`，最终候选结果仍在完整 JSON 解析和 Schema 校验通过后提交。

策划会话可以保存 `referenceAudio`，但参考音色不会发送给策划分析模型。`POST /api/content-planning/sessions/:id/apply` 会在 `allowlist.referenceAudio` 中返回该素材，供视频创作表单回填；参考视频仍按原流程参与爆款结构分析。
