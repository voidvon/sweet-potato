import { logger } from '../../../shared/logger.js';

export function renderPromptTemplate(template: string, values: Record<string, string | number | boolean | null | undefined>) {
  const missingKeys = new Set<string>();
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) {
      missingKeys.add(key);
      return '';
    }
    return String(value);
  });
  if (missingKeys.size && process.env.NODE_ENV !== 'production') {
    logger.warn('viral director prompt template missing values', {
      keys: [...missingKeys],
    });
  }
  return rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const viralSeedanceGlobalPromptTemplate = `
# 画面文字规则（最高优先级）
生成纯画面视频。画面必须保持干净，不添加任何可读文字、文字浮层、字幕、标识、来源标记或界面元素。
人声只走音轨，不进入画面。允许的新增画面文字：无。

# 人物
{{CHARACTER_ASSET_RULE}}
{{CHARACTER_PROMPT}}

# 场景
{{SCENE_ASSET_RULE}}
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

export const viralSeedanceFullPromptTemplate = `
{{GLOBAL_PROMPT}}

# 口播/人声内容
{{SPOKEN_CONTENT}}
口播内容只作为音轨参考，画面保持无新增可读文字。

# 镜头脚本
镜头脚本只用于动作、台词和节奏参考；其中的场景描述如果与上方“场景”设定冲突，必须以上方已确认场景为准。
{{STORYBOARD}}

# 负面提示词，用于避免生成不希望的内容
{{NEGATIVE_PROMPT}}
`;

export const viralSeedanceSegmentPromptTemplate = `
{{GLOBAL_PROMPT}}

{{CURRENT_STORYBOARD_SECTION}}

# 分段边界
{{SEGMENT_SUMMARY}}
{{SEGMENT_BASIS}}
只生成本段内容；不要生成 {{SEGMENT_START}} 秒之前或 {{SEGMENT_END}} 秒之后的任何镜头、动作或声音内容。
不要从头重拍整条视频，不复述上一段，不提前生成下一段。
{{SEGMENT_OPENING_RULE}}
{{SEGMENT_ENDING_RULE}}
每段生成后会按顺序直接拼接，请保证边界连续、动作递进、内容不重叠。
`;
