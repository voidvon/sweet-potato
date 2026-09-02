export type MotionOption<T extends string = string> = {
  id: T;
  label: string;
  aiDescription: string;
};

const option = <const T extends string>(id: T, label: string, aiDescription: string): MotionOption<T> => ({
  id,
  label,
  aiDescription,
});

export const motionRegistry = {
  textEntrance: [
    option("fade", "淡入", "克制、通用，适合副标题和信息型内容"),
    option("slide", "滑入", "从下方滑入并渐显，适合节奏明确的卖点"),
    option("scale", "缩放进入", "轻微放大并渐显，适合强调核心标题"),
    option("blur", "模糊渐显", "从模糊到清晰，适合科技和高级质感"),
    option("spring", "弹性进入", "柔和弹性缩放，适合轻快营销内容"),
    option("bounce", "弹跳进入", "带位移的弹跳，适合活泼内容"),
    option("typewriter", "打字机", "逐字显示，适合叙述和科技内容"),
    option("char-bounce", "逐字弹跳", "每个字符依次弹入，适合短标题"),
  ],
  textEmphasis: [
    option("none", "无强调", "保持文字稳定"),
    option("shine", "扫光", "光泽扫过文字，适合品牌或核心卖点"),
    option("pulse", "脉冲", "轻微呼吸缩放，适合行动号召"),
  ],
  imageMotion: [
    option("ken-burns", "缓慢推进", "全程缓慢放大，画面始终覆盖画布"),
    option("slow-zoom", "柔和缩放", "从轻微放大回落到原始比例，不暴露黑边"),
  ],
  imageTransition: [
    option("crossfade", "交叉淡化", "相邻图片重叠并平滑淡化"),
  ],
  sceneTransition: [
    option("fade", "淡化", "通用且自然的场景衔接"),
    option("slide", "滑动", "适合节奏感较强的营销视频"),
    option("wipe", "擦除", "适合科技和结构化内容"),
  ],
  captionAnimation: [
    option("none", "直接显示", "最稳定、最克制"),
    option("fade", "字幕淡入淡出", "逐句平滑出现和消失"),
    option("rise", "字幕上浮", "逐句轻微上浮并淡入"),
    option("word-highlight", "逐词高亮", "跟随旁白逐词突出显示"),
  ],
} as const;

export const textPositions = [
  "top_left",
  "top_right",
  "center",
  "bottom_left",
  "bottom_right",
] as const;

export const videoPresets = [
  {
    id: "clean-marketing",
    name: "简约营销",
    description: "克制的文字与平滑淡化，适合产品介绍和品牌宣传。",
    backgroundColor: "#0F172A",
    accentColor: "#FFFFFF",
    defaults: {
      titleEntrance: "fade",
      subtitleEntrance: "fade",
      textEmphasis: "none",
      imageMotion: "ken-burns",
      imageTransition: "crossfade",
      sceneTransition: "fade",
      captionAnimation: "fade",
    },
  },
  {
    id: "dynamic-promo",
    name: "动感促销",
    description: "弹性文字与滑动转场，适合活动、促销和快节奏内容。",
    backgroundColor: "#111827",
    accentColor: "#FBBF24",
    defaults: {
      titleEntrance: "spring",
      subtitleEntrance: "slide",
      textEmphasis: "pulse",
      imageMotion: "slow-zoom",
      imageTransition: "crossfade",
      sceneTransition: "slide",
      captionAnimation: "rise",
    },
  },
  {
    id: "tech-focus",
    name: "科技聚焦",
    description: "模糊渐显与平滑淡化，适合软件、科技和专业服务。",
    backgroundColor: "#020617",
    accentColor: "#67E8F9",
    defaults: {
      titleEntrance: "blur",
      subtitleEntrance: "fade",
      textEmphasis: "shine",
      imageMotion: "ken-burns",
      imageTransition: "crossfade",
      sceneTransition: "fade",
      captionAnimation: "word-highlight",
    },
  },
] as const;

export const remotionMotionCapabilities = {
  motion: motionRegistry,
  textPositions,
  presets: videoPresets,
  limits: {
    maxDurationInFrames: 18000,
    maxElementsPerTimeline: 100,
    maxScenes: 100,
    maxAnimationsPerElement: 12,
    maxCaptionItems: 5000,
  },
} as const;
