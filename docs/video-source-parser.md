# 公共视频链接解析模块

## 模块边界

`backend/base/src/modules/video-source/` 负责从平台分享内容中解析视频地址和元数据，不负责下载文件或视频生成业务。调用方可按需使用真实地址、发布者、标题、封面、音乐和互动数据。

调用链：

```text
POST /api/video-source/resolve
  → VideoSourceService（提取 URL、选择平台）
    → VideoSourceProvider（平台解析协议）
      → DouyinVideoSourceProvider / KuaishouVideoSourceProvider / XiaohongshuVideoSourceProvider

GET /api/video-source/preview?token=...
  → 校验短期 HMAC 令牌
    → 使用移动端 UA 与平台 Referer 请求真实地址
      → 流式转发视频和 Range 响应，不写入磁盘

POST /api/video-source/dance-remakes
  → 校验人物图和参考视频归属
    → 创建 dance_remake_preparing 任务并立即返回
      → 后台重新解析、下载并按选择区间裁剪远程视频
        → 创建临时参考视频素材并预扣积分
          → 复用同一任务提交 Seedance 并保留输入素材
```

## 扩展平台

每个平台实现 `VideoSourceProvider`：

- `supports(url)`：识别平台域名。
- `resolve(url)`：返回统一的 `ResolvedVideoSource`，包括真实下载地址、平台视频 ID、标题、作者与封面。

新增其他平台时，只需增加 provider 并注册到 `video-source.service.ts` 的 provider 列表；路由、统一返回结构和 SSRF 防护保持不变。

快手解析使用移动端分享页：短链逐跳解析到快手分享域名，再从页面 `window.INIT_STATE` 的视频记录中读取真实播放地址、封面、标题、作者、时长和互动数据。请求需保留通用的 `Accept: */*`；仅声明 HTML 类型时，快手会返回不含视频记录的精简状态。

小红书解析将 `xhslink.com` 短链解析到公开笔记页，再从 `window.__SETUP_SERVER_STATE__` 中读取笔记与 H.264 视频流信息；优先使用 H.264 MP4，缺失时回退到 H.265。

## 安全与资源控制

- 分享链接只允许 HTTP(S)，平台解析阶段限制到平台域名。
- 每次重定向都重新进行 DNS 与内网地址检查，防止 SSRF 和 DNS 重绑定到私网。
- 服务端只请求分享页与平台元数据接口，不请求或保存真实视频文件。
- 返回的真实地址通常带有平台时效性，长期任务应在使用前重新解析或自行做有效期管理。
- 浏览器预览使用服务端签发的 `previewUrl`，客户端不能把任意 URL 交给预览代理；签名可防止 URL、Referer、平台和过期时间被篡改。
- 预览代理支持单段字节范围请求，适配 HTML Video 的首帧加载、拖动和续播；视频数据只在上游与浏览器之间流转。
