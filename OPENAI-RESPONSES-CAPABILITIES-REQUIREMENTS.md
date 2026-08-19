# OpenAI Responses 能力需求文档

状态：Draft  
更新时间：2026-08-19

## 1. 背景与目标

项目需要通过 OpenAI Responses API 提供以下三项服务端能力：

1. 使用托管的 `web_search` 工具搜索公开网页并返回可追溯引用。
2. 使用 `input_file.file_url` 让模型服务端直接下载并解析公开文件。
3. 将用户上传文件编码为 Base64，通过 `input_file.file_data` 直接交给模型解析。

这些能力必须由 Go 后端统一调用，浏览器不得直接持有供应商 API Key。实现应同时兼容 OpenAI 官方接口及遵循 Responses API 契约的第三方服务，但不得假设第三方服务完整实现了所有 OpenAI 端点。

## 2. 范围

### 2.1 本期范围

- Responses API：`POST /v1/responses`。
- 托管网页搜索：`tools: [{ "type": "web_search" }]`。
- 公网文件 URL：`input_file.file_url`。
- Base64 文件：`input_file.file_data`。
- PDF 文本和页面图像理解。
- 搜索引用、完整来源、供应商请求 ID 和 usage 的结构化返回。
- 超时、限流、上游错误和不兼容能力的明确错误处理。

### 2.2 非本期范围

- 本地网页爬虫或以 Codex 本机 `web_search` 代替托管搜索。
- 本地 PDF OCR、文本提取、页面渲染或图片提取。
- File Search、Vector Store、知识库和长期索引。
- 图片生成和图片编辑。
- 将 `/v1/files` 作为必要依赖。部分兼容服务可能没有实现该端点。

## 3. 核心原则

### 3.1 服务端调用

- React 前端只能调用本项目 Go API。
- Go 后端负责鉴权、参数校验、调用 Responses API 和规范化响应。
- `OPENAI_API_KEY` 只能存在于服务端环境变量或受保护的配置存储中。
- 不得在日志、数据库、错误响应、SSE 或浏览器网络响应中暴露 API Key。

### 3.2 不做本地内容提取

- URL 模式：后端将 URL 原样放入 `file_url`，不得预先下载或解析文件。
- Base64 模式：后端只读取原始文件字节并编码为 Base64，不执行 OCR、文本提取、页面渲染或内容分析。
- Web Search 模式：必须使用 Responses API 托管的 `web_search`，不得静默回退到本地搜索或爬虫。
- 如未来需要本地处理，必须作为独立能力显式设计并取得用户授权。

### 3.3 不信任外部内容

网页和文件内容均视为不可信输入。模型指令必须要求忽略网页或文件中试图修改系统规则、索取密钥、调用工具或执行代码的提示注入内容。

## 4. 总体流程

```text
React Web
   |
   | authenticated project API
   v
Go HTTP API
   |- web query ---------> Responses API + web_search
   |- public file URL ---> Responses API + input_file.file_url
   `- uploaded bytes ----> Base64 data URL -> Responses API + input_file.file_data
                                      |
                                      v
                         normalized answer + citations + usage
```

## 5. 功能需求：托管网页搜索

### 5.1 请求要求

- 使用 Responses API 的 `web_search`，不得使用旧的 `web_search_preview` 开发新功能。
- 默认 `search_context_size` 为 `medium`，允许调用方在 `low | medium | high` 中选择。
- 默认 `tool_choice` 为 `auto`；当用户明确要求搜索时，后端应使用 `required` 或通过提示词强制实际搜索。
- 需要完整来源时，请求必须包含：

```json
{
  "include": ["web_search_call.action.sources"]
}
```

- 可选支持 `filters.allowed_domains`，用于限制官方域名或可信来源。
- 后端必须设置合理的请求超时。Agentic Search 可能执行多次搜索和打开页面，超时应明显长于普通文本请求。

### 5.2 上游请求示例

```json
{
  "model": "gpt-5.6",
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "medium"
    }
  ],
  "tool_choice": "required",
  "include": ["web_search_call.action.sources"],
  "input": "搜索 Spirax Sarco FT14 产品信息，优先使用制造商官方资料，并提供引用。"
}
```

模型名称必须来自服务端配置，示例值不得硬编码到业务逻辑。

### 5.3 响应处理

后端必须解析并保留：

- `web_search_call` 的数量、状态和 action 类型。
- `action.queries` 或 `action.query`。
- `action.sources` 中的 URL 和标题。
- `message.content[].annotations` 中的 `url_citation`。
- 最终文本、usage 和供应商 request ID。

只有回答文字而没有 `web_search_call` 时，不得宣称已经执行网页搜索。前端展示网页搜索结果时，引用链接必须清晰、可点击。

### 5.4 项目 API 建议

```http
POST /api/ai/research/web
Content-Type: application/json

{
  "query": "Spirax Sarco FT14 product information",
  "searchContextSize": "medium",
  "allowedDomains": ["spiraxsarco.com"]
}
```

建议响应：

```json
{
  "answer": "...",
  "searchPerformed": true,
  "searchCallCount": 3,
  "citations": [
    {
      "title": "FT14 Ball Float Steam Trap",
      "url": "https://example.com/document"
    }
  ],
  "sources": [],
  "usage": {},
  "providerRequestId": "..."
}
```

## 6. 功能需求：使用文件 URL 分析

### 6.1 行为要求

- 接收公开的 HTTP 或 HTTPS 文件 URL。
- 后端校验协议、URL 长度和格式，但不得为了分析而下载文件。
- URL 必须能被模型服务端直接访问，不能依赖登录态、Cookie、本地网络或短时失效的浏览器会话。
- PDF 使用支持视觉输入的模型时，上游会同时向模型提供提取文字和页面图像。
- PDF 的 `detail` 支持 `auto | low | high`，默认使用 `auto`；小字、图表和工程图纸场景可使用 `high`。
- 单文件必须小于上游限制。OpenAI 官方当前要求单文件小于 50 MB，单次请求内全部文件合计不超过 50 MB。
- 对第三方兼容服务，必须通过集成测试确认其确实实现 `file_url`，不能只检查 `/v1/models`。

### 6.2 上游请求示例

```json
{
  "model": "gpt-5.6",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_file",
          "file_url": "https://example.com/document.pdf",
          "detail": "high"
        },
        {
          "type": "input_text",
          "text": "请总结文档用途、关键参数和安全注意事项。"
        }
      ]
    }
  ]
}
```

### 6.3 项目 API 建议

```http
POST /api/ai/documents/analyze-url
Content-Type: application/json

{
  "url": "https://example.com/document.pdf",
  "prompt": "总结关键技术参数",
  "detail": "high"
}
```

响应至少包含 `answer`、`sourceUrl`、`usage` 和 `providerRequestId`。

## 7. 功能需求：使用 Base64 文件分析

### 7.1 行为要求

- 前端通过 `multipart/form-data` 上传文件到 Go 后端。
- 后端校验文件大小、允许的 MIME 类型和文件名。
- 后端读取原始字节并生成 Data URL：

```text
data:<mime-type>;base64,<base64-data>
```

- Base64 内容通过 `input_file.file_data` 提交，不需要先调用 `/v1/files`。
- 必须同时传递 `filename`。对于 PDF，可按需传递 `detail`。
- Base64 编码会增加约三分之一的数据体积。实现必须限制请求体大小，并避免在日志或错误中打印请求体。
- 初始项目上限应通过 `AI_FILE_MAX_BYTES` 配置，且不得超过上游的 50 MB 合计限制。
- 请求完成后立即释放内存，不在磁盘或数据库中额外保存 Base64 文本。

### 7.2 上游请求示例

```json
{
  "model": "gpt-5.6",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_file",
          "filename": "document.pdf",
          "file_data": "data:application/pdf;base64,JVBERi0xLjQK...",
          "detail": "high"
        },
        {
          "type": "input_text",
          "text": "请总结这份文件。"
        }
      ]
    }
  ]
}
```

### 7.3 项目 API 建议

```http
POST /api/ai/documents/analyze-upload
Content-Type: multipart/form-data

file=<binary>
prompt=总结关键技术参数
detail=high
```

响应至少包含 `answer`、`filename`、`mimeType`、`sizeBytes`、`usage` 和 `providerRequestId`，不得返回 Base64 原文。

## 8. 输入方式选择

| 场景 | 首选方式 | 原因 |
| --- | --- | --- |
| 稳定、公开、无需鉴权的文件链接 | `file_url` | 不经过项目服务器传输文件，内存和带宽开销较低 |
| 本地文件或受保护文件 | `file_data` | 无需让供应商访问原始下载地址 |
| 兼容服务没有 `/v1/files` | `file_url` 或 `file_data` | 两者均可直接通过 `/v1/responses` 提交 |
| 大量长期文档检索 | File Search | 不属于本期直接文件分析范围 |

不得在 `file_url` 失败后静默由本机下载并改成 Base64。是否切换传输方式必须由用户明确选择，或由产品设计提前告知。

## 9. 配置要求

建议使用以下服务端环境变量：

```text
OPENAI_BASE_URL=https://api.openai.com
OPENAI_API_KEY=<secret>
OPENAI_RESPONSES_MODEL=<configured-model>
OPENAI_REQUEST_TIMEOUT_SECONDS=180
AI_FILE_MAX_BYTES=<project-limit>
```

- `OPENAI_BASE_URL` 必须允许配置，以支持兼容服务。
- API Key 不得写入代码、Markdown、前端构建产物或 Git 历史。
- 管理端若提供模型配置，只能返回脱敏后的模型身份和能力状态。
- 更换 Base URL 后，应分别验证 `/v1/responses`、`web_search`、`file_url` 和 `file_data`；一个能力成功不代表其他能力可用。

## 10. 错误处理

后端应使用稳定错误码区分以下情况：

| 错误码 | 场景 |
| --- | --- |
| `ai_provider_unauthorized` | API Key 无效或无权限 |
| `ai_capability_unsupported` | 兼容服务不支持工具或输入类型 |
| `ai_file_too_large` | 文件超过项目或上游限制 |
| `ai_file_url_unreachable` | 服务端无法下载公开 URL |
| `ai_file_type_unsupported` | MIME 类型不受支持 |
| `ai_search_not_performed` | 要求搜索但响应没有 `web_search_call` |
| `ai_rate_limited` | 上游返回 429 |
| `ai_request_timeout` | 上游处理超时 |
| `ai_provider_error` | 其他上游错误 |

- 仅对 429 和明确的 5xx 瞬时错误执行有限次数退避重试。
- 参数、文件类型、安全策略和能力不支持等 4xx 错误不得原样重试。
- 日志可以记录 request ID、状态码、耗时、模型、文件大小和错误码，但不能记录 API Key、完整提示词、Base64 数据或敏感文件内容。

## 11. 安全与隐私要求

- 用户提交文件或 URL 前，应明确其内容会发送给所配置的模型供应商。
- 使用第三方兼容服务时，应在产品和运维配置中明确数据接收方，而不是将其描述为 OpenAI 官方服务。
- 对上传文件进行请求体大小限制和 MIME 检查，不信任扩展名。
- 对 URL 仅允许 HTTP/HTTPS；可根据业务需要增加域名允许列表。
- 禁止将 `Authorization` Header、Data URL 或供应商原始响应完整写入日志。
- 网页引用必须保留原始 URL，不得伪造或把模型生成的普通链接标记为已验证引用。
- 已在聊天、日志或版本库中暴露的密钥必须立即轮换。

## 12. 验收标准

### 12.1 Web Search

- 使用指定查询可以获得非空回答。
- 原始响应至少包含一个成功的 `web_search_call`。
- 返回至少一个可点击的 `url_citation` 或 source。
- 前端可以区分搜索答案、引用和普通模型文本。
- 禁用上游 Web Search 后，接口返回 `ai_capability_unsupported` 或 `ai_search_not_performed`，不得伪装为搜索成功。

### 12.2 File URL

- 使用公开 PDF URL 可以获得与文件内容一致的摘要。
- 项目服务器不产生该 PDF 的下载文件、文本提取文件或页面图片。
- 无效 URL、私有 URL、超限文件和不支持类型返回可识别错误。
- `detail=high` 可以成功传递到上游。

### 12.3 Base64 文件

- 上传 PDF 后，无需 `/v1/files` 即可获得摘要。
- 本机只进行字节读取和 Base64 编码，不进行内容提取。
- 响应和日志均不包含 Base64 原文。
- 超限文件在调用上游前被拒绝。

### 12.4 兼容性与回归

- 对 OpenAI 官方地址和每个配置的兼容服务分别记录能力测试结果。
- 单元测试覆盖请求构造、响应解析、引用映射、大小限制和错误映射。
- HTTP 契约测试覆盖三个项目 API、鉴权和敏感字段不泄漏。
- 集成测试通过显式环境开关运行，避免默认测试产生外部费用。

## 13. 官方参考

- [OpenAI Web search](https://developers.openai.com/api/docs/guides/tools-web-search/)
- [OpenAI File inputs](https://developers.openai.com/api/docs/guides/file-inputs/)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/)

