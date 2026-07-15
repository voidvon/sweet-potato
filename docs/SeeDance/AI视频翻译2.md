本文面向开发者，详细介绍如何通过 API 调用 AI 视频翻译（声影智译）能力，将国际化视频的自动化生产流程无缝集成到您的业务系统中。您将了解到 API 的核心调用流程、参数配置，并通过丰富的代码示例快速上手。
:::tip
在开始之前，建议您先阅读 [AI 视频翻译快速开始](/docs/4/1417453)，了解其核心功能、应用场景和计费规则，并通过控制台操作体验 AI 视频翻译的实际效果。
:::
<span id="81b6b9c2"></span>
## 前提条件

* 已[开通视频点播服务](https://console.volcengine.com/vod/overview/)并[创建空间](https://www.volcengine.com/docs/4/65669)。
* 将待处理的音视频文件[上传](https://www.volcengine.com/docs/4/65670)至点播空间，并[获取对应的 Vid（视频 ID）](https://www.volcengine.com/docs/4/2887#91112691)。
* （可选）[添加并配置点播加速域名](https://www.volcengine.com/docs/4/1165108)。如果您需要通过视频点播的 CDN 分发加速功能来播放或分发翻译后的视频产物，则需完成此步骤。

<span id="f985e2e4"></span>
## 实现流程概览
视频点播提供以下两种工作流，以满足不同场景下的视频翻译需求： 

* **场景一：先一次性生成再局部微调**
   此流程下，您可以先获得一个完整的翻译视频，查看翻译效果，然后调用特定接口修改字幕、重生成单句音频或更换音色，最后重新导出视频。 
   ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b2985180b1654aaca0e3b39968a8e8da~tplv-goo7wpa0wc-image.image =800x)
* **场景二：分阶段处理**
   此流程下，您可以在任务执行到特定阶段（如识别源语言字幕后或翻译字幕后）自动暂停，进行字幕校对和调整，然后再恢复任务以完成后续的语音合成和视频生成。
   ![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ad38948cfb8c41f1b346beaf7acd50d3~tplv-goo7wpa0wc-image.image =800x)

<span id="a3973e4f"></span>
## 场景 1：先一次性生成再局部微调
<span id="5c1f293e"></span>
### 步骤 1：创建 AI 翻译任务
调用 [SubmitAITranslationWorkflow](https://www.volcengine.com/docs/4/1584290) 接口创建 AI 翻译任务。在此场景下，不要设置 `ProcessConfig.SuspensionStageList` 参数，让任务一次性执行到底。请求示例如下：
```JSON
POST https://vod.volcengineapi.com?Action=SubmitAITranslationWorkflow&Version=2025-01-01
{
  "SpaceName": "test_space",
  "Vid": "v0cctrans***onvideoid",
  "TranslationConfig": {
    "SourceLanguage": "zh",
    "TargetLanguage": "en",
    "TranslationTypeList": ["SubtitleTranslation","VoiceTranslation"]
  }
}
```

任务完成后，您可以通过以下两种方式获取 AI 翻译任务的产物信息：

* **主动查询**：调用 [ListAITranslationProject](https://www.volcengine.com/docs/4/1584292) 接口，传入项目 ID，查询任务的详细信息和处理结果。
* **事件通知**：通过配置 [AITranslationComplete](https://www.volcengine.com/docs/4/1584289) 事件，在任务完成后接收系统发送的事件通知，从中获取任务产物的相关信息。

<span id="4a05f068"></span>
### 步骤 2：按需修改翻译内容
调用 [UpdateAITranslationUtterances](https://www.volcengine.com/docs/4/1758811) 接口更新字幕。您可以根据修改规模选择任一方式：

* **通过文件更新**：上传校对后的源语言、目标语言或双语的字幕文件（SRT/WebVTT）。在字幕文件中，您可以使用特殊标记实现静音或使用原声等操作，详细说明和示例，请见[字幕文件中的特殊标记说明](/docs/4/1995603#b55b07c6)。请求示例：
   ```JSON
   POST https://vod.volcengineapi.com?Action=UpdateAITranslationUtterances&Version=2025-01-01
   {
     "SpaceName": "test_space",
     "UpdateType": "OutputSubtitleFile",
     "ProjectId": "684038d6b71***05b266fefe",
     "OutputSubtitleFileName": "your_target_subtitle_file.vtt"
   }
   ```

* **通过句段 ID 更新**：将 `UpdateType` 设置为 `Utterances`，并传入一个或多个包含句段 ID、新文本和说话人 ID 的字幕对象，精确修改特定句段。请求示例：
   ```JSON
   POST https://vod.volcengineapi.com?Action=UpdateAITranslationUtterances&Version=2025-01-01
   {
     "SpaceName": "test_space",
     "UpdateType": "Utterances",
     "ProjectId": "684038d6b71***05b266fefe",
     "Utterances": [
       {
         "Id": "68403b6***364cc4835c8141",
         "Text": "Welcome to this video. Today we will introduce how to use the VOD service.",
         "SpeakerId": "68403b6***364cc4835c80f4"
       }
     ]
   }
   ```


:::tip
如需通过以上方式替换音色，请参考[自定义说话人音色](/docs/4/1995603#6ea26744)。
:::
<span id="ece7feea"></span>
### 步骤 3：重新导出最终视频
完成所有修改后，调用 [RefreshAITranslationProject](https://www.volcengine.com/docs/4/1779205) 接口。系统会应用您所有的变更（包括修改的文本、新生成的单句音频等），重新导出一个全新的翻译视频。
<span id="eb093433"></span>
## 场景 2：分阶段处理 
<span id="7e515974"></span>
### 步骤 1：创建 AI 翻译任务并指定暂停阶段
调用 [SubmitAITranslationWorkflow](https://www.volcengine.com/docs/4/1584290) 接口创建 AI 翻译任务，并通过 `ProcessConfig.SuspensionStageList` 参数指定在特定阶段暂停。

* 在字幕识别后暂停（取值为 `SubtitleRecognition`）：任务将在生成源语言字幕后暂停。
* 在字幕翻译后暂停（取值为 `SubtitleTranslation`）：任务将在生成目标语言字幕后暂停。

```JSON
// 请求示例：在字幕翻译后暂停任务
POST https://vod.volcengineapi.com?Action=SubmitAITranslationWorkflow&Version=2025-01-01
{
  // ... 其他参数 ...
  "ProcessConfig": {
      "SuspensionStageList": ["SubtitleTranslation"]
  }
}
```

<span id="5d4615c2"></span>
### 步骤 2：获取字幕信息并按需修改

1. **获取待校对的字幕**：调用 [GetAITranslationProject](https://www.volcengine.com/docs/4/1584291) 接口获取项目详情。
   * 若在 `SubtitleRecognition` 阶段暂停，您可获取到 `SourceUtterances`（源语言字幕句段信息）和 `InputSubtitle`（源语言字幕文件）。 
   * 若在 `SubtitleTranslation` 阶段暂停，您可获取到 `SourceUtterances`（源语言字幕句段信息）、`InputSubtitle`（源语言字幕文件）、`TargetUtterances`（目标语言字幕句段信息）和 `OutputSubtitle`（目标语言字幕文件）。 
2. **更新字幕内容**：调用 [UpdateAITranslationUtterances](https://www.volcengine.com/docs/4/1758811) 接口提交您的修改。您可以根据修改范围，选择任一方式：
   * **通过文件更新**：上传校对后的源语言、目标语言或双语的字幕文件（SRT/WebVTT）。在字幕文件中，您可以使用特殊标记实现静音或使用原声等操作，详细说明和示例，请见[字幕文件中的特殊标记说明](/docs/4/1995603#b55b07c6)。请求示例：
      ```JSON
      POST https://vod.volcengineapi.com?Action=UpdateAITranslationUtterances&Version=2025-01-01
      {
        "SpaceName": "test_space",
        "UpdateType": "OutputSubtitleFile",
        "ProjectId": "684038d6b71***05b266fefe",
        "OutputSubtitleFileName": "your_target_subtitle_file.vtt"
      }
      ```

   * **通过句段 ID 更新**：将 `UpdateType` 设置为 `Utterances`，并传入一个或多个包含句段 ID、新文本和说话人 ID 的字幕对象，精确修改特定句段。请求示例：
      ```JSON
      POST https://vod.volcengineapi.com?Action=UpdateAITranslationUtterances&Version=2025-01-01
      {
        "SpaceName": "test_space",
        "UpdateType": "Utterances",
        "ProjectId": "684038d6b71***05b266fefe",
        "Utterances": [
          {
            "Id": "68403b6***364cc4835c8141",
            "Text": "Welcome to this video. Today we will introduce how to use the VOD service.",
            "SpeakerId": "68403b6***364cc4835c80f4"
          }
        ]
      }
      ```

   :::tip
   如需通过以上方式替换音色，请参考[自定义说话人音色](/docs/4/1995603#6ea26744)。
   :::

<span id="74c998d3"></span>
### 步骤 3：恢复 AI 翻译任务
完成字幕内容的更新和校对后，调用 [ContinueAITranslationWorkflow](https://www.volcengine.com/docs/4/1758812) 接口恢复任务，继续执行后续流程。
<span id="bc6bf0be"></span>
### **步骤 4：获取最终产物**
任务完成后，您可以通过以下两种方式获取 AI 翻译任务的产物信息：

* **主动查询**：调用 [ListAITranslationProject](https://www.volcengine.com/docs/4/1584292) 接口，传入项目 ID，查询任务的详细信息和处理结果。
* **事件通知**：
   1. 参考[事件通知概述](/docs/4/4656)文档，配置一个用于接收回调的服务地址。在订阅事件时，勾选 [AI 翻译任务执行完成事件](https://www.volcengine.com/docs/4/1584289)。
   2. 当任务完成时，您的服务将收到一个 `EventType` 为 `AITranslationComplete` 的 HTTP POST 请求。可从回调结果中 `OutputTaskHighlight` 获取高光分析结果。

:::tip
最终输出的字幕文件中将包含双语字幕。源语言和目标语言字幕文件中的 `<v>` 标签信息会被移除。
:::
<span id="d3708bba"></span>
## 进阶使用
<span id="6ea26744"></span>
### 自定义说话人音色
如果您对某个说话人的音色不满意，需要更换，可按以下流程操作：

1. **上传参考音频文件**：将用于音色复刻的参考音频文件[上传至 AI 翻译任务所在的点播空间](https://www.volcengine.com/docs/4/65670#%E4%B8%8A%E4%BC%A0%E9%9F%B3%E8%A7%86%E9%A2%91)，然后[获取该音频文件的 FileName](https://www.volcengine.com/docs/4/2887#%E8%8E%B7%E5%8F%96-filename)。
2. **创建新音色**：调用 [CreateAITranslationSpeech](https://www.volcengine.com/docs/4/1827264) 接口，传入您在上一步获取的 FileName，将音频文件转化为一个可用的音色。
3. **创建新说话人**：调用 [CreateAITranslationSpeaker](https://www.volcengine.com/docs/4/1827265) 接口，将上一步创建的音色与当前项目绑定，创建一个新的说话人并记录新说话人 `SpeakerId` 和 `Name`。
4. **分配新说话人**：
   * **方式一（通过句段 ID 更新）**：调用 [UpdateAITranslationUtterances](https://www.volcengine.com/docs/4/1779205) 接口，将 `UpdateType` 设置为 `Utterances`。在 `Utterances` 数组中，将需要更换音色的句段的 `SpeakerId` 更新为您在上一步中获取的 `SpeakerId`。
   * **方式二（通过字幕文件更新）**：
      1. 在您的字幕文件中，在所有需要更换音色的字幕文本行最前方，添加 `<v SpeakerName>` 标记。这里的 `SpeakerName` 就是您在上一步中获取的新说话人的 `Name`。
      2. 调用 [UpdateAITranslationUtterances](https://www.volcengine.com/docs/4/1779205) 接口，通过文件更新的方式上传此文件。

<span id="9e878533"></span>
### 自定义术语库
如果您需要在翻译过程中应用您自定义的术语表，以确保特定词汇（如品牌名、产品名、专有名词等）的翻译准确性和一致性，可按以下流程操作：

1. **创建术语库**：调用 [CreateAITermbase](https://www.volcengine.com/docs/4/1909463) 接口，在点播空间里创建新的术语库，获取术语库 `TermbaseId`。
2. **添加术语**：调用 [SetAITermItem](https://www.volcengine.com/docs/4/1909472) 接口，传入您在上一步获取的术语库 `TermbaseId`，向术语库添加若干术语条目。
3. **将术语库添加至 AI 翻译任务**：调用 [SubmitAITranslationWorkflow](https://www.volcengine.com/docs/4/1584290) 接口，在请求参数 `TranslationTermbaseIds` 中传入一个或多个要应用的术语库 ID。系统将按照您指定的术语进行翻译干预。

<span id="6b6bef5c"></span>
## 参考信息
<span id="b55b07c6"></span>
### 字幕文件中的特殊标记说明
您可以在字幕文件中使用以下特殊标记来增强控制能力。

* `<v {speaker}>`：为该句字幕指定一个说话人。可指定 Speaker 名称为一个不为空的字符串。需放置在字幕文本行的最前方。如不指定，系统会通过 ASR 自动识别并匹配说话人。 
* `<a {action}>`：对该句字幕的音频执行特殊操作。需放置在字幕文本行的最前方，可与 `<v>` 标签同时使用。支持以下 `action`：
      * `MuteSpeech`：静音。该句字幕将没有语音，实现静音效果。
      * `UseOriginal`：使用原声。该句字幕将直接使用原视频对应时间段的音频，不进行翻译和语音合成。

字幕文件示例：

* SRT 双语字幕文件：
   ```Plain Text
   1
   00:00:10,198 --> 00:00:11,118
   你干什么
   <v Speaker1><a MuteSpeech>What have you done?
   
   2
   00:00:17,039 --> 00:00:19,018
   我打台球比赛
   <v Speaker2>I was playing in a pool tournament.
   ```

* WebVTT 目标语言字幕文件：
   ```Plain Text
   00:00:00.160 --> 00:00:01.160
   <v Speaker1>Oh
   
   00:00:01.160 --> 00:00:02.660
   <v Speaker2><a UseOriginal>Stop messing around, Your Highness
   ```

