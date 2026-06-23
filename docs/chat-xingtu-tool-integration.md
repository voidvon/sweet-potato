# AI 对话集成星图达人搜索能力设计

## 背景

当前仓库里已经有两套相关能力，但它们还没有连成完整链路：

- `backend/base/src/modules/chat/` 提供 AI 对话接口，当前模式是直接请求 OpenAI 兼容 `/chat/completions`，只消费文本结果，没有执行 `tool_calls`。
- `frontend/electron/service/browser-automation/` 已经实现星图登录、打开后台、达人搜索等自动化能力，当前只被 Electron 页面通过 IPC 调用。
- `backend/base/hermes_bridge/video_agent.py` 只是一个 Hermes 的轻量桥接，主要用于视频工作流意图判断，不是通用对话工具运行时。

本设计文档的目标，是给 AI 对话补上一层“工具调用运行时”，让模型在聊天中可以调用星图达人搜索能力，并且保留后续扩展到更多平台工具的空间。

## 目标

- 在 AI 对话中集成“星图达人”的核心搜索能力。
- 使用标准 `tool calling` 协议，而不是只靠 prompt 描述“你可以调用哪些工具”。
- 复用现有 Electron 星图自动化能力，避免重复实现一套浏览器自动化。
- 设计为可渐进演进：先满足星图搜索，再扩展到更多业务工具。

## 非目标

- 首期不把 Hermes 全量嵌入主聊天链路。
- 首期不把整套工具系统直接做成 MCP-first 架构。
- 首期不暴露页面点击、输入、翻页等低层浏览器动作给模型。
- 首期不支持无 Electron 环境下的星图自动化执行。

## 重新审视后的长期结论

如果后续不仅接星图，还要接：

- 视频生成
- 视频工作流编排
- 素材管理
- 数字人/音色/场景选择
- 更多外部平台能力

那么“在 `chat` 模块里加一套星图工具运行时”只能作为首期过渡方案，不应该成为最终架构。

更合理的长期目标应该是三层分离：

### 1. Conversation Plane

负责：

- 处理用户消息
- 维护会话上下文
- 调模型
- 执行工具调用循环
- 输出对用户可读的最终回复

这个平面只关心“如何对话”，不关心视频生成或星图搜索的业务细节。

### 2. Capability Plane

负责：

- 注册系统可用能力
- 定义能力 schema
- 做鉴权、参数校验、路由和能力发现
- 把对话请求映射到领域服务或外部执行器

这个平面才是长期核心。星图、视频生成、内容解析、素材检索都应注册到这里，而不是散落在多个聊天入口中。

### 3. Execution Plane

负责真正执行能力：

- 本地后端领域服务
- AI worker
- Electron automation
- 外部 HTTP API
- 将来可能接入的 MCP server

这一层只负责“把动作做完”，不直接承担对话编排。

## 对当前方案的修正判断

当前文档中的首期方案是合理的，但它只适合作为：

- Phase 1 的最小可用路径
- 验证星图工具调用链路
- 验证 Electron bridge 设计

它不适合作为最终形态，原因有三点：

### 1. 当前仓库已经出现第二套对话编排逻辑

视频生成已经有一套单独的 Hermes 编排入口：

- `backend/base/src/modules/content/content.service.ts` 中的 `handleHermesVideoMessage`

这说明系统已经开始出现：

- 通用聊天一套逻辑
- 视频工作流另一套逻辑

如果再给星图能力单独补一套“chat tools”实现，后面很容易演变成：

- 通用聊天 runtime
- 视频 runtime
- 星图 runtime
- 更多能力各自一套 runtime

这样会产生重复的：

- 会话状态处理
- tool call loop
- 错误包装
- 人工接管机制
- 权限与可见性判断

### 2. 视频能力不只是普通同步工具

星图搜索更像“查询型工具”，而视频生成不是。

视频相关能力至少包含四类：

- 快速同步能力：如解析标题、生成推荐文案
- 长任务能力：如视频生成、音频合成、理解任务轮询
- 引导式工作流能力：如脚本确认 -> 数字人 -> 场景 -> 音色 -> 生成
- 需要人工确认的能力：如确认脚本、选择素材、审阅分镜

这意味着长期架构不能只围绕普通 `tool_calls` 设计，还要能承载：

- `job`
- `workflow`
- `human_in_the_loop`

### 3. Electron 只是执行器之一，不应成为聊天架构中心

星图能力之所以复杂，是因为它当前依赖 Electron 自动化。  
但从系统视角看，Electron 只是执行层 provider 之一。

未来你还会有：

- `contentService` 内部同步能力
- `ai-worker` 异步能力
- `video model` 远程生成能力
- 桌面自动化能力
- 可能的 MCP 外部工具能力

所以桥接关系应该是：

`conversation runtime -> capability runtime -> executor/provider`

而不是：

`chat -> xingtu tools -> electron`

## 现状判断

### 1. 当前聊天链路没有真实工具执行循环

`backend/base/src/modules/chat/chat-completion.service.ts` 当前只会：

- 组装 `messages`
- 直接调用 `/chat/completions`
- 读取 `choices[0].message.content`

当前没有：

- `tools` 参数
- `tool_calls` 解析
- `role=tool` 消息回填
- 多轮 agent loop

这意味着，哪怕在 `agent.tools` 里写了“可用工具配置”，模型也只能把它当提示词理解，不能真正调用工具。

### 2. 星图能力已经存在，但运行在 Electron 侧

现有星图达人自动化入口位于：

- `frontend/electron/service/browser-automation/adapters/xingtu-search-creators.js`
- `frontend/electron/service/browser-automation/task-runner.js`

这套能力具备：

- 登录态校验
- 复用 profile/window
- 关键字搜索
- 按内容/昵称模式搜索
- 筛选项传入
- 分页抓取
- 结构化结果返回

但它当前只暴露给 Electron renderer，通过 IPC 使用，不在 `backend/base` 可直接调用范围内。

### 3. Hermes 值得借鉴的是结构，而不是直接照搬运行时

Hermes 的核心思路是：

1. 注册工具 schema
2. 把 `tools` 传给模型
3. 接收 `tool_calls`
4. 执行工具
5. 把结果以 `tool` 消息回填给模型
6. 继续下一轮，直到输出最终答案

这个结构是值得参考的。现阶段不建议把 Python Hermes runtime 直接作为主聊天运行时，因为：

- 主应用聊天主链路是 TypeScript
- 星图自动化能力在 Electron/Node，不在 Hermes/Python
- 直接混入 Hermes 会引入额外跨语言和进程复杂度

## 协议选择

### 结论

首期采用：

- 模型侧协议：OpenAI 兼容 `tool calling`
- 工具提供侧：先做本地 TypeScript 工具运行时
- Electron 自动化侧：单独做一层 bridge

暂不首期引入 MCP 作为必须前提。

## 为什么首期不做 MCP-first

MCP 解决的是“工具提供者如何标准化暴露给宿主”的问题。  
当前最核心的难点不是 schema，而是：

- `backend/base` 如何调用 Electron main 进程里的自动化能力
- 如何处理 profile、登录态、人工接管、任务轮询、窗口复用

这些问题即使用了 MCP，也仍然要解决。

因此首期更务实的做法是：

- 先在本项目内打通 `chat -> tool runtime -> electron automation`
- 待能力稳定后，再决定是否把工具层抽象成 MCP server

## 什么时候适合演进到 MCP

当满足以下任一条件时，可以考虑把星图能力抽成 MCP server：

- 同一套工具要被多个宿主复用
- 后续要接抖音、快手、小红书、公众号等多平台搜索器
- 需要把工具能力独立部署、独立鉴权、独立监控
- 未来希望 Hermes、桌面端、脚本任务、工作流系统共用同一工具服务

## 推荐架构

```text
Frontend Chat UI
    ->
conversation entry (chat / video / future assistants)
    ->
agent runtime / conversation runtime
    ->
capability registry
    ->
capability router
    ->
executor providers
    -> backend domain services
    -> ai worker
    -> electron automation bridge
    -> external APIs
    -> optional MCP adapters
```

## 当前接入策略

当前实现不把星图能力默认注入所有 AI 对话，而是采用显式激活：

- 用户输入包含 `@星图达人`
- 前端附带 `requestedCapabilities=['xingtu_creator_search']`
- 后端进入星图 capability 分支
- 先做 `自然语言解析 -> resolve`
- 再创建/更新服务端 `draft`
- 最后才执行 `runDraft`

这意味着模型不应该直接把整句用户输入当作自动化搜索关键词透传给 Electron。

例如：

- 输入：`@星图达人 帮我查询一下关于职场的达人，要求是短剧演员`
- 期望解析：
  - `keyword=职场`
  - `creator_type=短剧演员`
  - `short_drama_topic=职场`
- 然后再触发搜索

这个策略有两个直接收益：

- 默认聊天上下文不会被星图庞大的筛选 schema 污染
- 后续 `@视频生成`、`@素材库`、`@数据看板` 等能力可以沿用同一 capability 路由方式，而不是全部塞进默认聊天工具集

### 分层说明

#### 1. Agent Runtime

长期位置建议：

- `backend/base/src/modules/agent-runtime/`

如果先做过渡版，也至少不要把核心实现深绑在 `chat-completion.service.ts`。

职责：

- 接收统一的会话输入
- 管理 messages / tool results / iteration budget
- 调模型并处理 `tool_calls`
- 识别同步工具、异步任务、工作流推进、人机协同事件
- 输出统一的会话事件流

它应该同时服务：

- 通用聊天
- 视频工作流对话
- 将来的星图助手
- 未来更多垂类助手

#### 2. Conversation Entry

位置建议：

- `backend/base/src/modules/chat/`
- `backend/base/src/modules/content/`

职责：

- 暴露不同业务入口
- 把当前领域上下文映射到 agent runtime
- 处理各自的响应格式和 UI 需要的数据结构

例如：

- 通用聊天入口可以产出普通聊天消息
- 视频入口可以额外产出卡片、步骤、任务状态

#### 3. Capability Registry

长期位置建议：

- `backend/base/src/modules/capabilities/registry.ts`
- `backend/base/src/modules/capabilities/types.ts`

职责：

- 注册系统能力 schema
- 区分能力类型：`tool`、`job`、`workflow_step`、`user_action`
- 按 agent、运行环境、用户上下文决定哪些能力可见
- 统一执行入口、结果封装、错误语义

这里可以参考 Hermes 的 registry 思路，但范围要比普通 tool registry 更大。

#### 4. Capability Providers

位置建议：

- `backend/base/src/modules/capabilities/providers/`

建议按领域拆：

- `xingtu/`
- `video/`
- `content-assets/`
- `search/`
- `desktop/`

位置建议：

- `backend/base/src/modules/capabilities/providers/xingtu/`
- `backend/base/src/modules/capabilities/providers/video/`

职责：

- 定义高层业务能力
- 做参数校验
- 路由到实际执行器
- 对结果进行裁剪、清洗、结构化和统一包装

这一层不要暴露底层浏览器动作或 provider 细节，只暴露业务语义。

#### 5. Executor Providers

位置建议按执行方式拆分：

- `backend/base/src/modules/executors/local-service/`
- `backend/base/src/modules/executors/ai-worker/`
- `backend/base/src/modules/executors/desktop-automation/`
- `backend/base/src/modules/executors/http/`
- `backend/base/src/modules/executors/mcp/`

职责：

- 与具体执行目标打交道
- 统一超时、重试、轮询、取消、错误码
- 不感知对话上下文

## 工具设计原则

### 1. 只暴露高层业务工具

推荐暴露：

- `xingtu_get_login_status`
- `xingtu_request_login`
- `xingtu_resolve_filters_from_text`
- `xingtu_create_search_draft`
- `xingtu_update_search_draft`
- `xingtu_run_search_draft`
- `xingtu_get_current_results_page`
- `xingtu_open_creator_profile`

不推荐暴露：

- `browser_click`
- `browser_type`
- `browser_scroll`
- `browser_press`

原因：

- 星图页面复杂、易漂移，低层工具会让模型承担过多页面控制责任
- 业务工具更稳定，可控性更高
- 更容易做权限和风险控制

### 2. 工具返回结构化数据，而不是长文本

工具输出要偏向 JSON 结构，例如：

- 搜索参数摘要
- 当前页分页信息
- 达人列表
- 每个达人的关键字段
- 登录态
- profile 信息
- 是否需要用户接管

不要把整页 DOM、大段 HTML、过长日志原样返回给模型。

### 3. 工具可见性要受运行环境控制

当满足以下条件时才向模型暴露星图工具：

- 当前运行在 Electron 桌面环境
- Electron automation bridge 可用
- 存在可用星图 profile 或允许触发登录流程

否则不暴露，避免模型调用后必然失败。

### 4. 长期要把“能力”分类型，而不是都当普通 tool

建议至少区分四类：

- `tool`: 快速同步调用，如查询、解释、轻量检索
- `job`: 异步任务，如视频生成、长时间抓取、音频合成
- `workflow_step`: 有明确上下文推进的步骤能力
- `user_action`: 需要用户接管或确认的动作

如果不分型，后面会把所有东西都强塞进 `tool_calls`，对视频场景会越来越别扭。

### 5. 不要把完整筛选项字典放进 tool schema

这是星图能力接入里最重要的约束之一。

需要严格区分三层：

- `tool schema`: 模型一开始看到的工具定义
- `tool arguments`: 模型某次调用工具时实际传入的参数
- `filter catalog`: 星图完整筛选项字典、映射表、候选值集合

原则：

- `tool schema` 必须薄，只描述能力入口，不携带大枚举
- `tool arguments` 只包含本次实际需要的少量条件
- `filter catalog` 放在服务端，按需解析和查询，不进入主上下文

错误做法：

- 在 `xingtu_search_creators` 的 schema 里写几百个 enum
- 让模型直接维护一整棵星图筛选树
- 每一轮对话都把完整 filters 原样回传

正确做法：

- 让模型先表达“意图”
- 服务端负责把自然语言意图解析成内部过滤条件
- 过滤条件保存在服务端 `draft`
- 模型后续只操作 `draftId`

### 6. 星图搜索应采用 `resolve + draft` 模式

推荐把星图搜索拆成两段：

1. `resolve`
   - 把用户自然语言转成服务端内部的筛选条件
   - 按需查询筛选字典
   - 不要求模型自己拼完整条件树

2. `draft`
   - 服务端保存当前搜索草稿
   - 模型通过 `draftId` 做增量修改
   - 真正执行搜索时只提交 `draftId`

这样有三个好处：

- 上下文稳定，不会因为筛选项过多而膨胀
- 筛选逻辑收口在服务端，便于维护星图字段映射
- 用户连续修改搜索条件时，不需要模型反复重建完整 filters

## 首期工具草案

### `xingtu_get_login_status`

用途：

- 查询当前用户可用的星图 profile
- 告诉模型当前是否可执行搜索

输入：

```json
{}
```

输出：

```json
{
  "ok": true,
  "desktopAvailable": true,
  "profiles": [
    {
      "profileId": "profile_a",
      "name": "账号A",
      "site": "xingtu",
      "loggedIn": true,
      "selected": true
    }
  ],
  "canSearch": true
}
```

### `xingtu_request_login`

用途：

- 打开星图登录窗口
- 触发用户手动登录

输入：

```json
{}
```

输出：

```json
{
  "ok": true,
  "requiresUserAction": true,
  "message": "已打开星图登录窗口，请用户完成登录。"
}
```

### `xingtu_resolve_filters_from_text`

用途：

- 将用户自然语言需求解析为服务端内部筛选条件
- 按需查询筛选字典，不要求模型理解完整星图筛选树

输入：

```json
{
  "text": "帮我找上海地区、美妆护肤类、21-60 秒报价 1 万以内的短视频达人"
}
```

输出：

```json
{
  "ok": true,
  "keyword": "美妆护肤",
  "searchMode": "content",
  "criteria": [
    { "field": "region", "op": "eq", "value": "shanghai" },
    { "field": "industry", "op": "eq", "value": "beauty_personal_care" },
    { "field": "creator_type", "op": "in", "value": ["short_video"] },
    { "field": "quote_21_60s", "op": "lte", "value": "10000" }
  ],
  "unresolvedTerms": []
}
```

说明：

- 这里的 `criteria` 是本次解析结果，不是完整筛选字典
- 它可以作为后续 draft 的输入
- 长期不建议让模型直接长期维护这份 `criteria`

### `xingtu_create_search_draft`

用途：

- 创建一个服务端保存的星图搜索草稿
- 后续所有筛选调整都围绕 `draftId` 进行

输入：

```json
{
  "profileId": "profile_a",
  "keyword": "美妆护肤",
  "searchMode": "content",
  "criteria": [
    { "field": "region", "op": "eq", "value": "shanghai" },
    { "field": "industry", "op": "eq", "value": "beauty_personal_care" }
  ]
}
```

输出：

```json
{
  "ok": true,
  "draftId": "xingtu_draft_123",
  "summary": {
    "keyword": "美妆护肤",
    "searchMode": "content",
    "criteriaCount": 2
  }
}
```

### `xingtu_update_search_draft`

用途：

- 对现有草稿做增量修改
- 避免每轮传完整 filters

输入：

```json
{
  "draftId": "xingtu_draft_123",
  "instruction": "加上 21-60 秒报价 1 万以内，只保留短视频达人"
}
```

输出：

```json
{
  "ok": true,
  "draftId": "xingtu_draft_123",
  "summary": {
    "keyword": "美妆护肤",
    "searchMode": "content",
    "criteriaCount": 4
  },
  "appliedChanges": [
    "quote_21_60s <= 10000",
    "creator_type in [short_video]"
  ],
  "unresolvedTerms": []
}
```

### `xingtu_run_search_draft`

用途：

- 根据服务端保存的草稿执行达人搜索
- 模型不再需要传完整筛选条件

输入：

```json
{
  "page": 1,
  "draftId": "xingtu_draft_123"
}
```

输出：

```json
{
  "ok": true,
  "keyword": "美妆护肤",
  "searchMode": "content",
  "profileId": "profile_a",
  "pagination": {
    "currentPage": 1,
    "totalPages": 12,
    "pageSize": 20,
    "estimatedTotal": 240,
    "hasPrev": false,
    "hasNext": true
  },
  "results": [
    {
      "name": "达人A",
      "href": "https://www.xingtu.cn/...",
      "summary": "护肤测评，女性粉丝占比高",
      "creatorType": "短视频达人",
      "contentTopics": ["护肤", "美妆"],
      "quote21To60s": "8000",
      "connectedUsers": "25万",
      "location": "上海"
    }
  ]
}
```

说明：

- `draftId` 才是模型长期持有的主要搜索状态
- 真正复杂的星图 filters 只保存在服务端
- 如果以后筛选树变更，只需要调整服务端映射，不需要改 prompt 设计

### `xingtu_get_current_results_page`

用途：

- 在复用当前结果页时抓取指定页结果
- 减少重复搜索动作

输入：

```json
{
  "page": 2,
  "profileId": "profile_a"
}
```

输出结构与 `xingtu_run_search_draft` 一致。

这里的“一致”指与 `xingtu_run_search_draft` 的结果结构一致。

### `xingtu_open_creator_profile`

用途：

- 让 Electron 打开某个达人主页
- 便于用户接管或后续抓取更细信息

输入：

```json
{
  "profileId": "profile_a",
  "url": "https://www.xingtu.cn/..."
}
```

输出：

```json
{
  "ok": true,
  "opened": true,
  "message": "已在星图窗口打开达人主页。"
}
```

## 对话运行时设计

### 推荐循环

```text
1. 构造 messages + tools
2. 调用 /chat/completions
3. 若返回普通文本且无 tool_calls -> 结束
4. 若返回 tool_calls:
   - 逐个校验工具名和参数
   - 执行工具
   - 生成 role=tool 消息
   - 追加回 messages
   - 继续下一轮
5. 达到迭代上限则返回失败或兜底总结
```

长期还应扩展为事件流，而不仅是最终字符串：

- `assistant_delta`
- `tool_call_started`
- `tool_call_finished`
- `job_submitted`
- `job_progress`
- `user_action_required`
- `workflow_stage_changed`
- `done`

这样才能兼容视频工作流和更复杂能力，而不是只适配聊天文本。

### 建议参数

- `maxToolIterations`: 6
- `toolTimeoutMs`: 120000
- `parallelToolCalls`: 首期关闭

首期建议串行执行，理由：

- 星图搜索依赖单一 profile/window 状态
- 登录、打开页、搜索、翻页之间有强顺序依赖
- 并发执行价值低，复杂度高

## Electron Bridge 设计

### 推荐方案

推荐在 Electron main 进程暴露一个本地服务接口，由 `backend/base` 调用。

可选实现：

- 方案 A：Electron main 起本地 HTTP 服务
- 方案 B：Electron main 起本地 Unix socket / named pipe RPC

首期更推荐方案 A，因为：

- 调试成本最低
- Node/TS 两侧接入简单
- 便于健康检查

## 推荐接口

### `GET /internal/desktop-automation/health`

返回：

```json
{
  "ok": true,
  "desktopReady": true
}
```

### `GET /internal/desktop-automation/xingtu/profiles`

返回当前星图 profile、登录态、选中状态。

### `POST /internal/desktop-automation/tasks`

请求：

```json
{
  "adapter": "xingtu-search-creators",
  "profileId": "profile_a",
  "input": {
    "keyword": "美妆护肤",
    "searchMode": "content",
    "page": 1,
    "filters": {}
  }
}
```

### `GET /internal/desktop-automation/tasks/:taskId`

返回任务状态和结果。

### `POST /internal/desktop-automation/tasks/:taskId/cancel`

取消任务。

## 为什么不直接让 backend 调 Electron IPC

不推荐让 `backend/base` 直接依赖 Electron IPC 机制，原因：

- 进程边界不清晰
- 运行模式变复杂
- 后续服务化困难
- 本地接口比框架级 IPC 更易测试和扩展

## Agent 可见工具策略

建议新增 agent 级配置：

- `toolMode: 'none' | 'builtin' | 'desktop' | 'mixed'`
- `enabledToolIds: string[]`

长期建议升级为：

- `enabledCapabilityIds: string[]`
- `enabledCapabilityGroups: string[]`
- `conversationMode: 'chat' | 'workflow' | 'mixed'`
- `executorPolicies`
- `requiresDesktop`

首期可以简化为：

- 当 agent 开启 `webSearchEnabled` 仍然只代表网络搜索
- 新增 `desktopToolEnabled`
- 新增 `allowedDesktopTools`

默认“快速问答”建议不开启星图工具，避免一般聊天误触桌面自动化。

更合理的是单独提供一个 agent，例如：

- `星图达人助手`

其特征：

- 绑定桌面工具
- 强依赖 Electron
- 更适合营销、投放、达人筛选任务

## 错误与人工接管设计

星图场景天然存在人工接管需求，工具层必须显式表达，而不是简单抛异常。

推荐统一结果语义：

```json
{
  "ok": false,
  "errorCode": "LOGIN_REQUIRED",
  "message": "当前星图账号未登录，请先完成登录。",
  "requiresUserAction": true
}
```

常见错误码建议：

- `DESKTOP_UNAVAILABLE`
- `PROFILE_NOT_FOUND`
- `LOGIN_REQUIRED`
- `TASK_TIMEOUT`
- `TASK_CANCELED`
- `AUTOMATION_FAILED`
- `PAGE_STRUCTURE_CHANGED`
- `INVALID_ARGUMENT`

当 `requiresUserAction=true` 时，前端聊天 UI 后续可演进为：

- 显示“请登录星图后继续”
- 提供“打开登录窗口”按钮
- 登录完成后重试同一轮工具调用

首期即使 UI 不做专门按钮，也应把该语义保留在返回结构里。

## 安全与权限

星图工具属于高风险本地自动化能力，必须增加保护：

- 仅在桌面版开放
- 仅对白名单 agent 暴露
- 工具参数做严格 schema 校验
- 限制一次抓取结果条数
- 限制工具执行轮次
- 对原始日志、快照、DOM 做裁剪
- 不把 profile 敏感信息、cookie、底层页面状态暴露给模型

## 分阶段实施建议

### Phase 1：最小可用版本

目标：

- 聊天运行时支持标准 tool calling
- 能调用 `xingtu_get_login_status`
- 能调用 `xingtu_resolve_filters_from_text`
- 能调用 `xingtu_create_search_draft`
- 能调用 `xingtu_run_search_draft`

交付：

- `chat-agent.service.ts`
- `tool-registry.ts`
- `xingtu-tools.ts`
- `desktop-automation.client.ts`
- Electron 本地 bridge 最小接口

### Phase 2：补足人工接管与结果复用

目标：

- 支持 `xingtu_request_login`
- 支持 `xingtu_get_current_results_page`
- 支持 `xingtu_open_creator_profile`
- 前端识别 `requiresUserAction`

### Phase 3：抽象成通用桌面工具体系

目标：

- 不只接星图
- 将桌面工具能力抽象成统一 provider
- 根据需要评估是否升级为 MCP server

## 星图 `resolve + draft` 详细设计

### 核心思路

星图搜索不要设计成“模型一次性传完整 filters 执行搜索”，而要拆成三段服务端状态：

1. `resolve`
   - 自然语言转内部条件
2. `draft`
   - 服务端保存条件集合与当前 profile
3. `run`
   - 基于草稿执行实际搜索

这样模型侧长期只需要维护：

- `draftId`
- 少量增量指令
- 当前查询目标

### 内部条件模型

建议在后端定义统一条件结构，不直接复用前端页面上的原始 `filters` 形状。

推荐类型：

```ts
export type XingtuCriterionOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'between'
  | 'gte'
  | 'lte'
  | 'contains';

export type XingtuCriterion = {
  field: string;
  op: XingtuCriterionOp;
  value: string | string[] | [string, string];
};
```

说明：

- `field` 使用服务端内部稳定 ID，不直接暴露 UI 标签
- `value` 使用服务端归一化后的 canonical value
- 这层结构用于 runtime 和 repository，不直接等于 Electron adapter 的输入结构

### 条件字段注册表

建议新增一份服务端字段注册表，例如：

```ts
export type XingtuFilterFieldDef = {
  field: string;
  label: string;
  category: string;
  valueType: 'single' | 'multi' | 'range';
  supportedOps: XingtuCriterionOp[];
  aliases?: string[];
};
```

示例：

```ts
[
  {
    field: 'industry',
    label: '行业',
    category: 'base',
    valueType: 'single',
    supportedOps: ['eq'],
    aliases: ['美妆个护', '美妆护肤', '护肤']
  },
  {
    field: 'creator_type',
    label: '达人类型',
    category: 'base',
    valueType: 'multi',
    supportedOps: ['in']
  },
  {
    field: 'quote_21_60s',
    label: '21-60秒报价',
    category: 'price',
    valueType: 'range',
    supportedOps: ['between', 'gte', 'lte']
  }
]
```

这份注册表的作用：

- 为 `resolve` 提供解析目标
- 为 `draft` 提供校验依据
- 为 Electron adapter payload 转换提供映射基准

### 值映射表

字段和值要分离维护，不建议把值写死在 tool schema 里。

建议每个字段支持：

```ts
export type XingtuFilterValueDef = {
  field: string;
  value: string;
  label: string;
  aliases?: string[];
};
```

例如：

```ts
[
  {
    field: 'industry',
    value: 'beauty_personal_care',
    label: '美妆个护',
    aliases: ['美妆护肤', '护肤', '彩妆']
  },
  {
    field: 'creator_type',
    value: 'short_video',
    label: '短视频达人'
  }
]
```

这样未来星图筛选 UI 文案变化时，只需要更新映射层。

## Search Draft 数据模型

### Draft 实体

建议新增持久化实体：

```ts
export type XingtuSearchDraft = {
  id: string;
  userId: string;
  profileId: string;
  keyword: string;
  searchMode: 'content' | 'nickname';
  criteria: XingtuCriterion[];
  sourceText?: string;
  status: 'draft' | 'running' | 'completed' | 'failed';
  lastRunTaskId?: string | null;
  lastResultSummary?: {
    resultCount?: number;
    currentPage?: number;
    totalPages?: number;
  } | null;
  createdAt: string;
  updatedAt: string;
};
```

### Repository 建议

建议新增：

- `backend/base/src/modules/xingtu-search-drafts/xingtu-search-draft.types.ts`
- `backend/base/src/modules/xingtu-search-drafts/xingtu-search-draft.repository.ts`

至少支持：

- `createDraft`
- `findDraft`
- `listDraftsByUser`
- `updateDraft`
- `deleteDraft`
- `markDraftRunning`
- `saveDraftRunResult`

### 生命周期

```text
draft
  -> running
  -> completed
  -> draft        (用户继续修改)
  -> running
  -> failed
```

建议不要把 `completed` 当终态锁死，搜索草稿本质上是可继续编辑的工作状态。

## 能力接口定义

### 1. `xingtu_resolve_filters_from_text`

建议 tool schema：

```json
{
  "type": "function",
  "function": {
    "name": "xingtu_resolve_filters_from_text",
    "description": "将星图达人搜索需求解析为服务端内部筛选条件",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string" },
        "profileId": { "type": "string" }
      },
      "required": ["text"]
    }
  }
}
```

返回建议：

```json
{
  "ok": true,
  "keyword": "美妆护肤",
  "searchMode": "content",
  "criteria": [],
  "unresolvedTerms": [],
  "warnings": []
}
```

### 2. `xingtu_create_search_draft`

建议 tool schema：

```json
{
  "type": "function",
  "function": {
    "name": "xingtu_create_search_draft",
    "description": "创建星图搜索草稿",
    "parameters": {
      "type": "object",
      "properties": {
        "profileId": { "type": "string" },
        "keyword": { "type": "string" },
        "searchMode": { "type": "string", "enum": ["content", "nickname"] },
        "criteria": {
          "type": "array",
          "items": { "type": "object" }
        }
      },
      "required": ["profileId", "keyword", "searchMode"]
    }
  }
}
```

### 3. `xingtu_update_search_draft`

建议支持两种更新方式：

- `instruction`：自然语言增量修改
- `patch`：结构化条件补丁

推荐 schema：

```json
{
  "type": "function",
  "function": {
    "name": "xingtu_update_search_draft",
    "description": "增量更新星图搜索草稿",
    "parameters": {
      "type": "object",
      "properties": {
        "draftId": { "type": "string" },
        "instruction": { "type": "string" },
        "patch": {
          "type": "object",
          "properties": {
            "add": { "type": "array", "items": { "type": "object" } },
            "removeFields": { "type": "array", "items": { "type": "string" } },
            "replace": { "type": "array", "items": { "type": "object" } }
          }
        }
      },
      "required": ["draftId"]
    }
  }
}
```

建议优先支持 `instruction`，因为更适合自然对话。

### 4. `xingtu_run_search_draft`

建议 tool schema：

```json
{
  "type": "function",
  "function": {
    "name": "xingtu_run_search_draft",
    "description": "执行星图搜索草稿并返回达人搜索结果",
    "parameters": {
      "type": "object",
      "properties": {
        "draftId": { "type": "string" },
        "page": { "type": "integer", "minimum": 1 }
      },
      "required": ["draftId"]
    }
  }
}
```

### 5. `xingtu_get_search_draft`

建议补一个查询工具，便于模型在长会话中重新理解当前状态。

输入：

```json
{
  "draftId": "xingtu_draft_123"
}
```

返回：

```json
{
  "ok": true,
  "draft": {
    "draftId": "xingtu_draft_123",
    "profileId": "profile_a",
    "keyword": "美妆护肤",
    "searchMode": "content",
    "criteriaSummary": [
      "地区=上海",
      "行业=美妆个护",
      "达人类型=短视频达人",
      "21-60秒报价<=10000"
    ]
  }
}
```

这个工具对降低上下文重复非常有帮助。

## `resolve` 实现建议

### 方案选择

`resolve` 不建议完全依赖模型自己猜字段和值，建议服务端承担主要解析责任。

推荐链路：

1. 对用户文本做轻量规则抽取
2. 命中字段注册表和别名词典
3. 对未命中部分再调用小模型辅助解析
4. 最终统一输出 canonical `criteria`

这样做比纯 prompt 解析更稳。

### 解析结果要求

每次 `resolve` 或 `update instruction` 都应返回：

- `criteria`
- `unresolvedTerms`
- `warnings`
- `assumptions`

例如：

```json
{
  "ok": true,
  "criteria": [],
  "unresolvedTerms": ["高转化"],
  "warnings": ["“高转化”不是星图直接筛选项，已忽略"]
}
```

这样模型不会误以为所有自然语言都已被正确映射。

## Draft 到 Electron Filters 的转换

### 不要把 Draft 直接传给 Electron adapter

服务端 `draft.criteria` 是稳定抽象层。  
真正执行搜索前，需要有一层 mapper，把 Draft 转成当前 Electron adapter 所需 payload。

建议新增：

- `backend/base/src/modules/capabilities/providers/xingtu/xingtu-filter-mapper.ts`

职责：

- `criteria -> existing frontend/electron filter input`
- 做字段冲突检查
- 做范围值标准化
- 做默认值补全

### 转换输出建议

转换后再生成类似当前页面已使用的结构：

```ts
type XingtuAutomationSearchInput = {
  keyword: string;
  searchMode: 'content' | 'nickname';
  page?: number;
  filters: Record<string, unknown>;
};
```

这样可以最大化复用现有：

- `xingtu-search-creators`
- `creator-market.js`
- 前端当前的筛选结构

## API 设计建议

即使主要由 tool calling 使用，也建议保留普通后端 API，方便：

- 调试
- 前端非 AI 场景复用
- 手工排查
- 回归测试

### REST 接口建议

- `POST /api/xingtu/search-drafts/resolve`
- `POST /api/xingtu/search-drafts`
- `GET /api/xingtu/search-drafts/:id`
- `PATCH /api/xingtu/search-drafts/:id`
- `POST /api/xingtu/search-drafts/:id/run`
- `GET /api/xingtu/search-drafts/:id/results?page=1`

tool provider 可以直接调 service，也可以复用这些 service 层接口。

## 服务层拆分建议

建议新增模块：

- `backend/base/src/modules/xingtu-search-drafts/xingtu-search-draft.service.ts`
- `backend/base/src/modules/xingtu-search-drafts/xingtu-search-draft.repository.ts`
- `backend/base/src/modules/xingtu-search-drafts/xingtu-filter-catalog.ts`
- `backend/base/src/modules/xingtu-search-drafts/xingtu-filter-resolver.ts`
- `backend/base/src/modules/xingtu-search-drafts/xingtu-filter-mapper.ts`

职责分工：

- `service`: 草稿生命周期与执行编排
- `repository`: 持久化
- `catalog`: 字段和值定义
- `resolver`: 自然语言到条件解析
- `mapper`: Draft 到 Electron payload 转换

## 执行时序建议

### 初次搜索

```text
用户需求
  -> xingtu_resolve_filters_from_text
  -> xingtu_create_search_draft
  -> xingtu_run_search_draft
  -> 返回结果摘要
```

### 追加筛选条件

```text
用户补充条件
  -> xingtu_update_search_draft
  -> xingtu_run_search_draft
  -> 返回新结果摘要
```

### 翻页

```text
用户要求看下一页
  -> xingtu_run_search_draft(page=2)
  或 xingtu_get_current_results_page(page=2)
```

### 查看当前条件

```text
模型需要确认当前草稿
  -> xingtu_get_search_draft
```

## 上下文控制建议

为了进一步控制上下文大小，建议：

- `run_search_draft` 默认只返回前 5-10 条摘要结果
- 结果中默认不返回冗长 `summary`
- 达人列表只保留检索决策需要的字段
- 真正需要更细信息时，再增加 `xingtu_get_creator_details`

另外，tool result 应该支持服务端裁剪：

- `resultSummary`
- `fullResultStored=true`
- `resultRefId`

必要时模型只看到摘要，详细结果存在服务端，通过引用二次读取。

## 首期实现边界建议

首期不必一次做完整 catalog 系统，但至少要做到：

- tool schema 不含大枚举
- 引入 `draftId`
- 搜索条件长期保存在服务端
- 由服务端负责把自然语言解析成结构化条件

也就是说，哪怕首期 `resolve` 先只覆盖：

- 行业
- 地区
- 达人类型
- 报价区间

也比直接让模型拼整棵 filters 更正确。

## 推荐文件拆分

### 长期 Backend

建议新增：

- `backend/base/src/modules/agent-runtime/agent-runtime.service.ts`
- `backend/base/src/modules/agent-runtime/agent-runtime.types.ts`
- `backend/base/src/modules/capabilities/registry.ts`
- `backend/base/src/modules/capabilities/types.ts`
- `backend/base/src/modules/capabilities/providers/xingtu/`
- `backend/base/src/modules/capabilities/providers/video/`
- `backend/base/src/modules/executors/desktop-automation/desktop-automation.client.ts`
- `backend/base/src/modules/executors/ai-worker/ai-worker.client.ts`
- `backend/base/src/modules/executors/mcp/mcp.client.ts`

### 首期 Backend 过渡版

可以先落地为：

- `backend/base/src/modules/chat/chat-agent.service.ts`
- `backend/base/src/modules/chat/tool-runtime.types.ts`
- `backend/base/src/modules/chat/tools/tool-registry.ts`
- `backend/base/src/modules/chat/tools/providers/xingtu-tools.ts`
- `backend/base/src/modules/desktop-automation/desktop-automation.client.ts`

并在后续向长期结构迁移。

建议调整：

- `backend/base/src/modules/chat/chat.routes.ts`
- `backend/base/src/modules/chat/chat-completion.service.ts`

### Electron

建议新增：

- `frontend/electron/service/browser-automation/bridge-server.js`

建议复用：

- `frontend/electron/service/browser-automation/task-runner.js`
- `frontend/electron/service/browser-automation/adapters/xingtu-search-creators.js`

## 与 Hermes 的关系

建议借鉴 Hermes 的三个点：

- registry 模式
- tool schema + handler 分离
- 标准 agent loop

不建议首期直接复用 Hermes 作为聊天主运行时，原因：

- 语言栈不一致
- 星图能力在 Electron/Node
- 当前 Hermes bridge 只适合轻量单任务，不适合作为主工具编排层

后续若需要统一更多工具源，可考虑：

- 保持主聊天 runtime 在 TypeScript
- 再把外部工具源通过 MCP 或 Hermes 兼容方式接入

## 最终建议

如果目标只是首期打通星图搜索，对原方案没有问题。  
但如果目标是统一承接视频生成、星图能力和未来更多能力，原方案需要上移一层，变成：

- 统一 `agent runtime`
- 统一 `capability registry`
- 统一 `executor/provider` 抽象
- 对话入口只做上下文适配
- OpenAI `tool calling` 仍然作为模型协议
- MCP 作为未来外部能力接入方式，而不是首期核心

也就是说：

- `OpenAI tool calling` 这个判断仍然是对的
- 但“把实现放在 chat 模块里，以星图为中心设计”不够长期合理

更合理的路线是：

1. 首期用过渡版快速打通星图
2. 很快抽出通用 runtime/capability 层
3. 让视频对话和通用聊天都复用同一套编排内核

不要先做成“全量 Hermes 化”或“先 MCP 再说”，那会把真正的问题从“统一能力编排”转移成“维护额外协议与运行时”。

当首期跑通后，再决定是否将星图能力抽象成独立 MCP server，供更多宿主复用。
