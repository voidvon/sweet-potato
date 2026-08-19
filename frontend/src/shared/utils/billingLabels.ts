const sourceTypeMap: Record<string, string> = {
  admin_adjust: '人工调整',
  chat_completion: 'LLM 对话',
  confirmed_audio_preview: '确认音频预览',
  content_planning_analysis: '内容策划 · 素材识别',
  content_planning_generation: '内容策划 · 脚本生成',
  talking_video_prompt: '口播视频 · 提示词生成',
  content_planning_planner: '内容策划 · 需求规划',
  content_planning_repair: '内容策划 · 脚本修复',
  content_planning_strategy: '内容策划 · 创意策略',
  content_planning_timeline: '内容策划 · 时间轴设计',
  content_planning_validator: '内容策划 · 结果校验',
  content_planning_visual_director: '内容策划 · 分镜设计',
  marketing_video_storyboard: '营销视频 · 分镜生成',
  content_planning_writer: '内容策划 · 文案创作',
  finished_video: '成片',
  other: '其他',
  product: '商品',
  prompt: '提示词',
  real_person: '真人素材',
  scene: '场景',
  chat_image_generation: '图片创作',
  video_generation: '视频创作',
  video_upscale: '视频高清放大',
  url: '链接',
  virtual_portrait: '虚拟人像',
  vod_upload: '视频上传',
  voice: '音色',
  voice_clone_preview: '声音克隆预览',
  voice_clone_training: '声音克隆训练',
};

export function sourceTypeLabel(sourceType?: string | null) {
  if (!sourceType) {
    return '-';
  }
  return sourceTypeMap[sourceType] || sourceType;
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function billableUsageSourceLabel(input: {
  sourceType?: string | null;
  requestSnapshot?: Record<string, unknown> | null;
}) {
  const sourceType = toText(input.sourceType);
  if (!sourceType) {
    return '-';
  }
  return sourceTypeLabel(sourceType);
}
