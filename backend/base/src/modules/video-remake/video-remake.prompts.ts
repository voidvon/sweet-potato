export function renderVideoRemakePromptTemplate(template: string, values: Record<string, string | number | boolean | null | undefined>) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const videoRemakeDirectorNormalizeSystemPrompt = [
  '你是“视频生成导演”，负责把爆款视频拆解结果整理成可供用户逐步确认的生成素材表。',
  '只输出 JSON，不要 Markdown，不要解释。',
  '目标：生成“素材确认表”，不是分镜脚本。只保留视频生成需要的结构化信息，去掉字幕样式、标题文案、平台分析话术、无关营销解释。',
  'part 字段只根据“音频理解专家结果”和导演 hints.spokenContent 整理；保留多人对话的说话主体前缀，不要改写成单人口播。',
  'character.items 必须覆盖所有可见说话人物；旁白主体如果不出镜，不要放进 character.items，而应放进 audio.items。',
  '如果视频理解中出现“人物1、人物2、人物3”或多个具名人物，严禁合并成一个 character.items；必须拆成多个 item，每个 item 的 label 对应一个人物。',
  '人物优先从人物描述/description提炼 characterPrompt：保留服饰、配件、动作、表情、气质；去掉时间、声线、口播和分析话术。',
  '如果视频理解中出现“场景1、场景2”或多个独立地点/空间/时段，严禁合并成一个 scene.items；必须拆成多个 item，每个 item 的 label 对应一个场景。',
  '场景优先从场景描述/description提炼 description：保留拍摄地点、背景元素、空间层次、光线氛围；不要泛化为空泛场景标签，去掉时间和分析话术。',
  'character.items、scene.items、product.items 必须尽量保留视频理解里的详细描述，输出给用户确认的可编辑描述不得把英文 key 写入参考提示词。',
  '时间与语境如需保留在结构字段中，统一使用 startSecond、endSecond、spokenCue 供程序内部读取；面向用户的文本里必须写“口播”，不能写 spokenCue/speckCue，也不要写“不详/未知”。',
  '场景和产品不能把所有候选都合并进每个 item；必须按口播语境和出现时间拆成独立 item，例如肯德基、麦当劳、总结讲解分别对应自己的时间线索。',
  '如果 hints.pictureInPicture.appeared=true，必须输出 pip.items：保留出现时间、类型、大致位置和内容作用；referenceMode 默认 prompt；replacementPrompt 写清替换画中画内部内容的提示词。',
].join('\n');

export const videoRemakeStoryboardSystemPrompt = [
  '你是爆款复刻的分镜脚本分析专家。你需要在用户确认口播内容后，重新生成可执行的分镜脚本。',
  '每个镜头必须包含明确时间段，时间段必须连续、不重叠，从 0 秒开始。',
  '台词切分必须保持语义完整；不要把“不要 X，要 Y”这类对比项拆到不同镜头。',
  '每句已确认口播只能分配到一个镜头，不得在后续镜头重复摘录；除非已确认口播原文中该句本身重复出现多次。',
  '不要生成任何字幕、口播字幕、对白字幕、旁白字幕、逐字稿、屏幕文字、标题条、水印或无关 Logo。',
  '严禁新增已确认口播之外的结束语、寒暄或行动号召，包括拜拜、再见、下期见、关注我、点赞关注、记得收藏。',
  '复刻建议必须是本镜头自包含的具体执行要求，不得写“保持机位、光线参数和上一镜头一致”“保持拍摄参数统一”“人物不要出现大幅度位移”“不要切换景别”等依赖上一镜头或过于空泛的句子，不能出现禁用xx产品/场景/人物的句子。',
  '如果已确认人物设定里包含需要持续可见的配件、道具、服饰细节或其他标识性细节，每个有人物的镜头都必须在“人物/动作”字段保留这些可见约束。',
  '如果已确认人物设定包含多个人物，人物/动作必须按当前镜头实际涉及的人物写对应人物标签；涉及多人时必须列出多个人物，不得默认只写人物1；复刻建议不要重复人物设定。',
  '人物/动作和复刻建议不得输出适用时间、时间范围、口播线索、对应口播、语境线索、关键词等设定元信息。',
  '复刻建议只写拍摄执行建议，不得重复人物外观、场景环境、产品信息，也不得另起人物、场景、产品、环境、道具、灯光、构图、机位、氛围等设定明细块，除非需要特殊补充。',
].join('\n');

export const videoRemakeSeedanceGlobalPromptTemplate = `
# 画面文字规则（最高优先级）
生成纯画面视频。画面必须保持干净，不添加任何可读文字、文字浮层、字幕、标识、来源标记或界面元素。
人声只走音轨，不进入画面。允许的新增画面文字：无。

# 人物
{{CHARACTER_PROMPT}}

# 场景
{{SCENE_PROMPT}}

# 产品
{{PRODUCT_PROMPT}}

# 画中画
{{PIP_PROMPT}}

# 音频
{{AUDIO_PROMPT}}
语速硬性要求：中等自然语速，咬字清晰，不要为了适配时长而加速；每秒中文约 4 个字以内。
人声硬性要求：只能朗读已确认的音频白名单内容；严禁新增拜拜、再见、下期见、关注我、点赞关注、记得收藏等结束语或行动号召。
BGM：{{BGM_PROMPT}}
音效：{{SOUND_EFFECTS_PROMPT}}
`;

export const videoRemakeSeedanceSegmentPromptTemplate = `
{{GLOBAL_PROMPT}}

# 口播/人声内容
{{SPOKEN_CONTENT}}
口播内容只作为音轨参考，画面保持无新增可读文字。

# 当前分镜
{{CURRENT_STORYBOARD_SECTION}}

# 分段边界
只生成本段内容；不要从头重拍整条视频，不复述上一段，不提前生成下一段。
每段生成后会按顺序直接拼接，请保证边界连续、动作递进、内容不重叠。

# 负面提示词
{{NEGATIVE_PROMPT}}
`;

export const videoRemakeDefaultNegativePrompt = [
  '避免画面畸变',
  '人物手部异常',
  '产品变形',
  '低清晰度',
  '过曝',
  '跑题',
  '口播字幕',
  '自动字幕',
  '歌词字幕',
  '人物字幕',
  '对白字幕',
  '旁白字幕',
  '台词字幕',
  '中文字幕',
  '英文字幕',
  'caption',
  'captions',
  'subtitle',
  'subtitles',
  'closed captions',
  'burned-in captions',
  'hardcoded subtitles',
  'transcript overlay',
  'speech-to-text overlay',
  '屏幕文字',
  '标题条',
  '贴纸文字',
  '角标说明',
  '文字浮层',
  '逐字稿',
  '弹幕',
  '水印',
  '无关 Logo',
  '新增 Logo',
  '拜拜',
  '再见',
  '下期见',
  '关注我',
  '点赞关注',
  '转场音',
  '转场提示音',
  '点击音',
  '提示音',
  '尾音',
  '爆音',
  '杂音',
  '风噪突增',
  '句尾噪声',
  '段尾噪声',
  '分段内容重叠',
].join('，');
