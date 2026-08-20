# API 接口契约

团队统一契约文档：`.plans/video-expert-skill-flow/docs/api-contracts.md`。

## 2026-08-20 个人模型

- `GET /api/user-model-configs?type=llm|image`、`POST /api/user-model-configs`、`PUT/DELETE /api/user-model-configs/:id` 和 `PUT /api/user-model-configs/:id/default` 管理当前登录用户的个人 LLM 与图片模型。用户归属只从登录态获取，接口不接受代替其他用户操作的 `userId`。
- `GET /api/user-model-configs/image-providers` 返回普通端可配置的图片服务商目录。个人模型允许自定义 Base URL，但必须是合法的 HTTPS URL 且不能包含 URL 用户凭据。
- 个人模型响应包含 `scope = personal` 和 `isConfigured`，`apiKey` 始终为空；编辑时传空 Key 会保留原配置。
- 个人图片模型的 `settings.billing.creditsPerRequest` 和个人 LLM 的计费倍率均由服务端固定为 `0`。使用个人模型进行对话、图片创作或批量图片生成均不扣积分，客户端提交的个人模型计费字段会被忽略。
- 未显式指定 LLM 时优先使用当前用户的个人默认 LLM，再回退到 Agent 绑定模型和系统默认 LLM。个人默认 LLM 同时用于普通对话和图片创作的工具调用决策。
- 图片创作模型列表同时包含后台配置的 `scope = system` 模型和当前用户的个人模型。未指定模型时优先使用当前用户的个人默认模型，其次使用系统默认模型；传入其他用户的个人模型 ID 返回无权使用，不会静默回退。

## 2026-08-20 API 国际化与错误契约

- 客户端使用标准请求头 `Accept-Language` 声明首选语言；当前支持 `zh-CN` 和 `en-US`，未提供或不支持的语言回退为 `zh-CN`。不要新增自定义 `lang` Header，也不要在每个 JSON 请求体中重复传语言。
- HTTP 错误统一返回 `{ "code": string, "message": string }`。`code` 是稳定、与语言无关的机器标识；前端分支、日志聚合和自动化测试只能依赖 `code` 或 HTTP 状态，不得比较 `message`。
- `message` 是可直接展示的本地化文本。后端按 `Accept-Language` 选择语言，并在错误响应中返回 `Content-Language`；响应同时包含 `Vary: Accept-Language`，避免共享缓存混用语言。
- 当前通用错误码包括 `bad_request`、`unauthorized`、`forbidden`、`not_found`、`method_not_allowed`、`conflict`、`payload_too_large`、`unsupported_media_type`、`rate_limited` 和 `internal_error`。新增需要前端采取特定动作的领域错误时，应增加更具体的稳定错误码，不要复用中文错误句子作为标识。
- WebSocket 握手沿用浏览器发送的 `Accept-Language`，错误事件同样返回 `{ type: "error", code, message }`。SSE/EventSource 握手也使用浏览器语言；可由应用发起的 `fetch` 流会显式附带当前应用语言。

### 后端配置名称

- `route_resources` 与 `discover_categories` 保留 `name` 作为中文名称，并新增 `name_en` 作为可选英文名称。当前只有两个固定语言，因此直接在原表加列比建立翻译表更简单，也能保持现有查询、排序和管理接口清晰；扩展到较多语言或允许租户自定义语言时，再迁移为通用翻译表。
- `GET /api/route-resources/public-tree` 与 `GET /api/discover/categories` 按 `Accept-Language` 将匹配的展示文本写入既有 `name` 字段；英文为空时回退中文。公共响应不暴露 `nameEn`，并返回 `Content-Language` 与 `Vary: Accept-Language`。
- 路由资源管理接口与发现分类管理接口返回中文 `name` 和英文 `nameEn`，创建及更新接口接受相同字段。`resourceKey`、`permissionCode`、ID、slug、权限判断与路由匹配均不依赖展示语言。
- 历史默认数据启动时只对空英文值做兼容回填：`口播` 使用 `Talking Head`，`女装` 使用 `Women's Fashion`；已由管理员填写的英文名称保持不变。图片与视频创作菜单的旧默认英文 `Image Creation`、`Video Creation` 会分别更新为 `Image`、`Video`。

## 2026-07-28 批量生成表格与执行契约

- 所有接口要求 `web.module.content.batch_generation` 权限。
- `GET /api/batch-generation/capabilities`：返回可创建表格的图片/视频功能定义、参数字段和 Schema 版本。
- `video.upscale`（视频高清放大）不包含全局参数，行参数仅包含必填的单视频素材字段 `referenceVideoIds`；批量执行默认调用现有视频增强服务输出 `1080p` 视频。
- `video.dance_remake`（跳舞复刻）以 `danceRemakeMode` 作为全局生成模式，每行生成模式默认继承全局值且可覆盖；所有行包含必填的人物图与单参考视频。增强模式在全局参数中增加模型、清晰度和是否保留参考视频音乐，并允许每行继承或覆盖这些参数；标准模式固定使用 Seedance 2.0 Mini 与 480P。
- `video.subject_replace`（模特 / 商品替换）以 `subjectReplaceType` 作为全局图片类型，每行默认继承且可覆盖；模型、清晰度和保留音乐同样支持全局配置与逐行覆盖。模特、人脸、背景和商品类型各需要一张对应图片，服饰类型需要正面图并可选反面图，所有类型都需要单个参考视频。
- `GET /api/batch-generation/model-options`：返回批量页面可选的图片/视频模型，只包含 `id`、`type`、`name`、`isDefault`，不返回 API Key、服务地址或模型私有配置。
- `GET /api/batch-generation/sheets`：返回当前用户的顶部 Tab 摘要，包括行数与执行状态统计。
- `POST /api/batch-generation/sheets`：创建表格，请求体为 `{ name, capabilityKey, globalParams? }`。
- `GET /api/batch-generation/sheets/:sheetId`：返回表格、全局参数、全部行、统计数据及每一行最新的 `latestAttempts`；结果列应优先使用该集合中的输出和错误信息。
- `PATCH /api/batch-generation/sheets/:sheetId`：更新名称、全局参数或排序；支持传入 `revision` 做乐观并发控制。
- `DELETE /api/batch-generation/sheets/:sheetId`：删除表格及其从属数据。
- `POST /api/batch-generation/sheets/:sheetId/rows`：新增一行或多行。单行请求体为 `{ params }`，批量请求体为 `{ rows: Record<string, unknown>[] }`，每个表格最多 200 行。
- `PATCH /api/batch-generation/sheets/:sheetId/rows/:rowId`：更新 `{ params?, revision? }`。
- `DELETE /api/batch-generation/sheets/:sheetId/rows/:rowId`：删除一行并自动压紧后续位置。
- `GET /api/batch-generation/sheets/:sheetId/runs`：返回当前表格的历史批量运行摘要。
- `POST /api/batch-generation/sheets/:sheetId/runs`：创建运行，支持 `{ rowIds?: string[] }`；省略时运行当前表格全部行。接口在参数、资产归属和模型配置校验通过后返回 `202` 与 queued Run。
- `GET /api/batch-generation/runs/:runId`：返回 Run、Attempt 快照和每个 Attempt 的输出资产 ID。
- `POST /api/batch-generation/runs/:runId/retry`：将上次 Run 的失败或部分失败行作为新 Run 重试。
- `GET /api/batch-generation/events`：SSE；同一用户会收到 `run` 事件，payload 为最新 Run 详情，可用于行状态、统计和结果即时刷新。
- `POST /api/batch-generation/assets/upload`：上传当前表格的图片、视频或音频参考素材，使用 `multipart/form-data` 的 `file`、`sheetId` 和 `fieldKey` 字段。
- `GET /api/batch-generation/assets/:assetId`：读取当前用户拥有的批量参考素材或结果素材元数据。
- `GET /api/batch-generation/assets/:assetId/video-upscale-estimate`：按当前高清放大固定价格和该视频素材的 VOD 上传大小返回 `{ estimatedCredits }`；批量页在视频上传或回填后调用，用于即时刷新消耗积分。
- `revision` 不匹配时返回 `409`；资源不存在或不属于当前用户时返回 `404`。
- 图片能力现已接入异步执行：Attempt 会冻结合并后的行/全局参数和不含 API Key 的模型身份快照；图片结果写入 `content_assets` 后作为 Output 关联。图片计费来源标记为 `batch_generation`。
- 批量调度在单服务进程内最多并发执行 2 个 Attempt；服务启动时会恢复 queued/running Run。供应商调用按同一 Attempt ID 恢复，调用方仍应把执行视为至少一次语义。
- 通用“视频生成”、视频高清放大、跳舞复刻和模特 / 商品替换能力已接入同一执行队列。其内部 `video_task_id` 会持久化到 Attempt，在服务重启后继续等待和轮询同一个供应商任务。

## 2026-07-27 权限变更强制重新登录

- `POST /api/auth/login` 与 `POST /api/auth/register` 返回的 Bearer token 现在携带服务端 `auth_version`，后端会在鉴权时校验该版本；当账号权限发生有效变化后，旧 token 会立即失效并返回 `401`。
- `PATCH /api/users/:id/role-assignment` 只有在目标账号的业务角色集合实际发生变化时，才会 bump `auth_version` 并发送实时通知；重复保存相同角色集合不会触发强制退出。
- `PUT /api/roles/:id` 只有在角色授权资源集合发生变化时，才会对已分配该角色的账号 bump `auth_version` 并发送实时通知；仅修改角色名称、描述或默认角色标记不会触发强制退出。
- `GET /api/app/events` 的 `permission-updated` SSE payload 扩展为 `{ type, userId, changedAt, reason, requireRelogin }`，只会发给受影响账号的在线连接；`reason` 取值为 `role-assignment-updated` 或 `role-grants-updated`，当前 `requireRelogin` 恒为 `true`。

## 2026-07-24 视频成片封面

- 完成态 `VideoGenerationTask` 新增 `generatedCoverUrl`，指向后端在成片持久化后通过 ffmpeg 截取第一帧生成的 JPEG 封面。
- `editableParseResult.videoGenerationResult.coverUrl` 继续保留以兼容现有调用方；封面生成成功后与 `generatedCoverUrl` 指向同一持久化资源。
- 封面生成失败不改变视频任务的成功状态，调用方应允许 `generatedCoverUrl` 为空。
- 发现页 `DiscoverItem` 提供 `coverUrl`；发布时保存来源作品的封面快照，历史条目迁移回填，并用于视频卡片及全屏预览的 `poster`。
- `GET /api/admin/works` 与 `GET /api/file-management` 的视频条目提供 `coverUrl`；没有封面时返回空字符串，后台表格统一优先展示封面图。文件管理接口当前只返回本地素材。

## 2026-07-23 发现管理

- `GET /api/admin/discover/categories`、`GET /api/admin/discover/items` 及对应分类/条目的增删改接口仅管理员可访问。
- `POST /api/admin/discover/items` 使用 `sourceAssetId` 从全部作品候选池创建条目，并在发布时保存展示字段快照，同时写入 `content_asset_references(reference_type = 'discover_item')` 保留附件。
- `GET /api/discover/categories`、`GET /api/discover/items` 返回启用分类和已发布条目；前台只读取快照字段，不依赖源作品实时元数据。
- `POST /api/discover/items/:id/like` 与 `POST /api/discover/items/:id/view` 分别原子累加已发布条目的点赞量和浏览量，返回 `{ likeCount, viewCount }`；接口不负责用户级去重。

## 2026-07-23 后台全部作品

- 后台新增 `/works` 管理路由，仅管理员可访问，用表格展示全部用户已完成的图片和视频作品。
- `GET /api/admin/works` 仅管理员可访问，支持 `page`、`pageSize` 和 `username` 查询参数；`username` 对用户名进行不区分大小写的包含搜索。
- 响应为 `{ items, page, pageSize, total }`，默认每页 `20` 条，按作品更新时间倒序排列；无文件地址以及生成中、排队中或失败的记录不会作为作品返回。

## 2026-07-20 主体替换视频生成

- `POST /api/video-source/subject-replaces` 提交模特、服饰、人脸、背景或商品替换任务，要求 `web.module.content.create_video` 权限。
- 请求体包含 `subjectType`、`imageAssetIds`、本地 `referenceVideoAssetId` 或短视频 `remoteVideo`、`preserveAudio`、`quality` 和 `videoModelId`。
- 非服饰类型必须提供一张图片；服饰类型第一张为正面图、可选第二张为反面图，最多两张。所有素材必须属于当前登录用户。
- 接口立即返回 `VideoGenerationTask`。短视频链接的下载、裁剪和时长探测在后台执行，任务准备状态为 `expertContext.mode = "subject_replace"`。
- 生成与计费时长取参考视频实际时长并向上取整后限制为 `4-15` 秒，例如 `9.01` 秒按 `10` 秒；画面比例固定为 `9:16`，结果继续通过 `GET /api/content/video-productions` 查询。
- 主体替换调用现有 Seedance 视频生成链路，参考视频时长确定后按后台配置的模型、清晰度和实际生成秒数预留 `video_generation` 积分；成功时按预留金额结算，失败时释放，供应商 token usage 不覆盖该按秒价格。
- 主体替换任务上下文持久化图片资产 ID、已上传视频资产 ID 以及远程视频原始链接和裁剪区间。远程视频下载并裁剪到服务器后立即写入本地资产 ID；后续探测、计费或模型提交失败时复用该服务器资产，仅在尚未成功落盘时重新解析分享链接。

## 2026-07-17 公共视频链接解析

- `POST /api/video-source/resolve` 根据分享文案或视频链接解析公共视频信息，要求当前用户具备 `web.module.content.create_video` 权限；服务端不下载或保存视频文件。
- 请求体为 `{ "input": string }`；服务端会从分享文案中提取首个 HTTP(S) URL。当前支持抖音、快手和小红书视频链接。
- 成功响应为 `{ source }`。`source` 包含平台、视频 ID、标题、封面、真实无水印地址、带水印地址、时长、宽高、发布时间、发布者资料、音乐资料、互动统计和签名后的 `previewUrl`。
- 抖音解析全程使用移动端 User-Agent：短链逐跳解析为长链，提取视频 ID，优先请求 `iteminfo`，并以分享页 SSR 数据作为兼容兜底；真实地址通过将播放地址中的 `/playwm/` 替换为 `/play/` 获得。
- 快手解析使用移动端 User-Agent：短链逐跳解析到分享页，从 `window.INIT_STATE` 中提取真实播放地址、视频 ID、标题、封面、作者、时长和互动数据。
- 小红书解析使用移动端 User-Agent：短链逐跳解析到公开笔记页，从 `window.__SETUP_SERVER_STATE__` 中提取笔记信息和 H.264/H.265 视频流，优先返回兼容性更好的 H.264 MP4 地址。
- 所有解析重定向均校验协议、平台域名和目标 IP，拒绝本地及内网地址。接口只返回平台信息，不请求真实视频文件地址。
- `GET /api/video-source/preview?token=...` 是视频预览流代理，支持浏览器 `Range` 请求并转发 `Content-Range`、`Content-Length`、`Accept-Ranges`、`ETag` 等必要响应头，不把视频写入磁盘。
- `preview` 使用 `/resolve` 签发的 HMAC 令牌访问，不接受客户端直接传入目标 URL。令牌自身承担预览授权，因此该路径不要求额外 Bearer Header，默认有效期为 1 小时。
- `VIDEO_SOURCE_PREVIEW_SECRET` 可单独配置预览签名密钥，未设置时复用服务端认证密钥；`VIDEO_SOURCE_PREVIEW_TOKEN_TTL_SECONDS` 可调整有效期，最小为 60 秒。
- `POST /api/video-source/dance-remakes` 提交跳舞复刻。请求包含 `characterImageAssetId`、可选的 `referenceVideoAssetId` 或 `remoteVideo`、`mode`、`preserveAudio`、`quality`、`ratio` 和 `videoModelId`。
- 跳舞复刻接口先创建 `dance_remake_preparing` 任务并立即返回 `{ "ok": true }`；远程视频解析、下载、裁剪、计费预扣和 Seedance 提交在后台继续执行，任务详情和后续状态统一通过 `GET /api/content/video-productions` 获取。
- `remoteVideo` 包含原始分享内容 `input` 以及可选的 `trimStart`、`trimEnd`。服务端会重新解析真实地址，下载源视频，并使用 FFmpeg 截取 4-15 秒区间；超过 15 秒的视频必须显式提供截取区间。
- 远程裁剪结果以 `assetKind = dance_remake_reference_video` 的临时素材保存。人物图、本地参考视频也在提交时以临时素材上传；视频任务创建后统一写入素材引用并转为 `retained`。
- 跳舞复刻任务复用视频制作后台生成与计费链路，`expertContext.mode = dance_remake`。素材准备完成后按最终模型、清晰度和裁剪时长预扣积分，准备或生成失败释放预扣，生成成功结算且不会重复扣费。增强模式会强化动作、镜头和节奏复刻提示；`preserveAudio = false` 时向 Seedance 提交 `generate_audio = false`。

## 2026-07-16 视频制作临时素材生命周期

- 视频制作页面上传的图片、视频和音频以 `temporary` 状态写入 `content_assets`，默认过期时间为上传后 24 小时。
- `POST /api/content/reference-video/trim` 只在处理期间暂存原始视频，裁剪成功后立即删除原文件，数据库仅保存裁剪结果；浏览器不再下载裁剪结果后重新上传。响应新增 `assetId`（裁剪资产）。
- 资产类型、生命周期、过期和保留时间分别记录在 `asset_kind`、`lifecycle_status`、`expires_at` 和 `retained_at`。
- `POST /api/content/video-productions`、视频高清放大、字幕擦除和视频翻译任务正式引用素材时，会写入 `content_asset_references`，把临时素材转为 `retained` 并清空 `expires_at`。
- Base 服务启动时及之后每小时清理一次已过期且没有引用的临时素材，同时删除数据库记录和本地文件。
- `DELETE /api/content/reference-video` 传入 `assetId` 时只会删除当前用户的 `temporary` 素材；已有作品及已经被任务保留的素材不会被删除。
- 删除视频生成记录或其关联作品时会释放任务引用，并删除不再被其他任务使用的上传素材；作为输入的正式作品和素材库资源不会级联删除。

## 2026-07-16 临时素材清理后台

- 后台新增 `/system/temporary-assets`，仅管理员可访问。
- `GET /api/content/temporary-assets/cleanup-candidates` 分页返回带过期时间的临时素材，按计划清理时间升序排列。
- `GET /api/content/temporary-assets/disk-space` 返回临时素材存储目录所在磁盘的可用空间，格式为 `{ "availableBytes": number }`。
- `GET /api/content/temporary-assets/cleanup-logs` 返回最近 100 条成功清理记录。
- `GET /api/content/temporary-assets/orphan-files` 递归扫描 `data/files/`，对比内容素材、技能文件、视频任务、聊天附件及生成任务等数据库直接路径和 JSON 文件引用，返回疑似孤立文件数量、体积及最多 500 条明细；该接口只读，不删除文件，并忽略缩略图缓存、日志和符号链接。
- `POST /api/content/temporary-assets/orphan-files/delete` 接收 `{ "relativePaths": string[] }`，删除最多 500 个疑似孤立文件；删除前会再次校验路径位于 `data/files/`、不在忽略范围内且当前未被数据库文件记录引用。
- `POST /api/content/temporary-assets/cleanup-selected` 接收 `{ "assetIds": string[] }`，立即删除最多 100 条仍处于临时状态且未被引用的指定素材，返回 `{ "deleted": number }`。
- `POST /api/content/temporary-assets/cleanup` 立即清理当前已过期且无引用的临时素材，返回 `{ "deleted": number }`。
- `temporary_asset_cleanup_logs` 在每次写入后物理删除第 100 条以前的历史记录，数据库最多保留 100 条日志。

## 2026-07-16 图片创作上传素材生命周期

- `POST /api/chat/attachments/upload` 在保存附件文件时同步创建 `temporary` 的 `content_assets` 记录，响应附件新增可选字段 `assetId`。
- 图片输入资产使用 `asset_kind = image_input`，默认在上传后 24 小时过期；未发送、仅用于普通对话或图片生成全部失败时，不会取消过期时间。
- 每成功生成一张图片作品，该作品会通过 `content_asset_references` 引用本次使用的上传图片，并将输入图片转为 `retained`、清空 `expires_at`。
- 删除最后一张关联图片作品后，无其他作品或消息引用的上传图片会立即删除；仍被其他消息引用时会重新转为 24 小时临时资产。
- 图片输入与视频制作临时素材共用后台待清理列表、定时清理任务和最近 100 条清理日志。

## 2026-07-15 完成作品查询

- `GET /api/content/assets?resourceType=finished_video` 只返回已有文件地址的完成态作品。
- `generationStatus` 为 `pending`、`queued`、`running`、`generating` 或 `failed` 的素材不会出现在响应中。
- 过滤只作用于接口响应；数据库任务与素材记录仍保留，后台状态回写、失败排查和本地镜像流程不受影响。
- 分页请求会在完成态过滤后计算 `items` 与 `total`，避免空页或总数包含失败记录。

## 2026-07-15 视频制作记录分页

- `GET /api/content/video-productions` 传入 `page` 与 `pageSize` 时返回 `{ items, page, pageSize, total }`；`pageSize` 最大为 `100`。
- `GET /api/content/video-productions` 返回视频制作列表专用 DTO，不返回 `userId`、`prompt`、源地址、原始解析结果、素材引用、生成配置、技能/数字人选择或供应商原始字段；`expertContext` 仅包含列表展示需要的白名单参数。编辑、重试和参考素材预览按任务 ID 请求详情。
- 未传 `page` 时返回同一列表 DTO 的数组，兼容已有响应外层结构。
- 时间筛选使用 `createdAtFrom`（包含）和 `createdAtTo`（不包含）两个 ISO 时间边界，并按任务创建时间过滤。
- 比例筛选使用 `ratio`，直接匹配任务的 `aspectRatio` 字段；新任务会在生成开始时写入该值。
- 普通视频生成使用用户选择的比例；高清放大、字幕擦除和视频翻译根据源视频宽高归一为支持的比例。
- `status` 筛选先作用于查询结果，再进行分页。
- `/app/content/create_video` 的结果时间线固定以每页 `20` 条加载，滚动接近底部时自动请求下一页。

## 2026-07-15 视频站点价格配置

- 新增普通登录用户可读的 `GET /api/site-config`，用于前端统一获取站点公开的视频计费配置。
- 当前响应为 `{ "billing": BillingSettingsWithoutIdAndCreatedAt }`，只包含公开积分价格和更新时间，不包含模型 API Key 等敏感配置。
- `GET /api/billing/settings` 和 `PUT /api/billing/settings` 仍仅限管理员使用。
- 图片生成价格不属于站点视频计费配置，继续读取各图片模型的 `settings.billing.creditsPerRequest`。
- `/app/content/create_video` 页面加载时请求 `GET /api/site-config`；视频高清放大显示固定单次价格，字幕擦除和视频翻译仅在选择源视频并取得时长后显示预计扣费总积分，不展示每秒单价。
- 字幕擦除和视频翻译按秒计费时，视频时长先向上取整到整数秒再计算总积分，例如 `1.1` 秒按 `2` 秒计算。

## 2026-07-15 管理端视频处理计费配置

- `GET /api/billing/settings` 和 `PUT /api/billing/settings` 新增视频处理积分单价字段。
- `videoUpscaleCreditsPerRequest`：视频高清放大固定单次积分，默认为 `20`。
- `subtitleRemovalCreditsPerSecond`：字幕擦除每秒积分，默认为 `2`。
- `videoTranslationSubtitleCreditsPerSecond`：字幕翻译每秒积分，默认为 `1`。
- `videoTranslationVoiceCreditsPerSecond`：语音翻译每秒追加积分，默认为 `2`。
- `videoTranslationFaceCreditsPerSecond`：面容翻译每秒追加积分，默认为 `2`。
- `videoTranslationEraseSourceCreditsPerSecond`：擦除原字幕每秒追加积分，默认为 `2`。
- 所有新增单价必须是大于或等于 `0` 的有限数字。
- 视频高清放大任务在提交时按 `videoUpscaleCreditsPerRequest` 预扣固定积分；任务成功后结算，任务失败或超时则退回预扣积分。
- 提交高清放大任务前会同时检查高清放大固定积分和本次 VOD 上传预估积分。
- 高清放大成功后新增 `video_upscale` 业务消费记录，计价方式为 `per_request`，并以任务 ID 作为幂等键避免重复扣费。

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

- 直接创建视频使用 `/api/content/video-productions` 和已配置的默认视频模型。供应商响应可能包含 `videoUrl` 或 `jobId`。
- 视频模型配置缺失或不完整时返回 `400` 和 `请先配置视频模型`。供应商调用失败时，任务会标记为 `failed`，并记录 `failureReason`，不会创建本地 mp4 兜底文件。

## 视频理解 Agent

`POST /api/video-understanding/stream` 通过配置的 Responses API 模型调用视频理解能力，并以 SSE 事件流返回结果。该接口要求调用方具备聊天权限。

## 聊天 Responses API

聊天模型调用统一使用 OpenAI Responses API 的 `/v1/responses`，不再使用旧的
`/v1/chat/completions`。`/app/image` 请求会携带 `autoImageGeneration: true`，后端向
模型提供 `image_generation` function tool；模型返回 `function_call` 时才执行图片生成，
未返回工具调用时按普通聊天处理。图片模型本身仍通过现有的图片生成接口调用。

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

策划会话可以保存 `referenceAudio`，但参考音色不会发送给策划分析模型。`POST /api/content-planning/sessions/:id/apply` 会在 `allowlist.referenceVideo` 和 `allowlist.referenceAudio` 中返回参考视频与参考音色，供视频创作表单完整回填；参考视频同时参与短视频结构分析。

`POST /api/content-planning/sessions/:id/analyze` 按一次“开始识别”操作收取固定积分，额度由 Base 环境变量 `CONTENT_PLANNING_ANALYSIS_CREDITS` 配置。请求开始时预扣，商品图识别及可选参考视频拆解全部成功后结算；任一阶段失败会释放预扣积分。

`POST /api/content-planning/sessions/:id/generate` 按一次完整的脚本生成操作收取固定积分，额度由 Base 环境变量 `CONTENT_PLANNING_GENERATION_CREDITS` 配置。Planner、Strategy、Timeline、Copywriter、Visual Director 和 Validator 是同一次操作的内部阶段，不再分别写入 LLM 按量计费流水。请求开始时预扣，全部阶段成功后结算；任一阶段失败会释放预扣积分。

`GET /api/content-planning/config` 返回当前登录用户可见的策划客户端配置，其中 `analysisCredits` 和 `generationCredits` 与上述固定积分配置同源，供识别、生成和重新执行按钮展示本次操作的积分消耗。
