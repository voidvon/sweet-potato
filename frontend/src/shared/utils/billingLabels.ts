const sourceTypeMap: Record<string, string> = {
  admin_adjust: '人工调整',
  chat_completion: 'LLM 对话',
  confirmed_audio_preview: '确认音频预览',
  content_planning_analysis: '爆款策划 · 素材识别',
  content_planning_generation: '爆款策划 · 脚本生成',
  content_planning_planner: '爆款策划 · 需求规划',
  content_planning_repair: '爆款策划 · 脚本修复',
  content_planning_strategy: '爆款策划 · 创意策略',
  content_planning_timeline: '爆款策划 · 时间轴设计',
  content_planning_validator: '爆款策划 · 结果校验',
  content_planning_visual_director: '爆款策划 · 分镜导演',
  content_planning_writer: '爆款策划 · 文案创作',
  director_material_table: '导演素材表',
  finished_video: '成片',
  one_click_clone_parse: '一键克隆解析',
  other: '其他',
  product: '商品',
  prompt: '提示词',
  real_person: '真人素材',
  replication_plan: '复刻方案',
  scene: '场景',
  storyboard_message: '分镜消息',
  timed_storyboard: '定时分镜',
  chat_image_generation: '图片创作',
  video_generation: '视频创作',
  video_upscale: '视频高清放大',
  video_remake_generation: '视频重制 · 成片生成',
  video_remake_segment_regeneration: '视频重制 · 分段重生成',
  viral_director_confirm_generate: '爆款复刻 · 最终生成',
  viral_director_segment_generation: '爆款复刻 · 分段生成',
  video_remake_scene_aware_segment_generation: '爆款复刻 · 分段生成',
  video_remake_reference_primer: '爆款复刻 · 分段预生成',
  viral_director_segment_generation_copyright_retry: '爆款复刻 · 分段重试生成',
  viral_director_segment_regeneration: '爆款复刻 · 分段重生成',
  url: '链接',
  video_remake_understanding: '视频重制理解',
  video_remake_storyboard: '视频重制 · 分镜生成',
  viral_parse: '视频解析',
  viral_parse_fallback: '视频解析（兜底）',
  viral_parse_multimodal: '视频解析（多模态）',
  viral_understanding_retry: '视频理解重试',
  viral_upload_parse_understanding: '视频上传解析理解',
  virtual_portrait: '虚拟人像',
  vod_upload: '视频上传',
  voice: '音色',
  voice_clone_preview: '声音克隆预览',
  voice_clone_training: '声音克隆训练',
  video_remake_director_normalize: '视频生成导演',
  video_remake_chat_intent_clarification: '会话助手',
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

function understandingRoleLabel(sourceType: string, requestSnapshot?: Record<string, unknown>) {
  const role = toText(requestSnapshot?.role);
  const roleName = toText(requestSnapshot?.roleName);
  const baseLabel = sourceTypeLabel(sourceType);
  const label = roleName || role;
  if (!label) {
    return baseLabel;
  }

  if (role.includes('audio') || roleName.includes('音频')) {
    return `${baseLabel} · 音频理解`;
  }
  if (role.includes('video') || roleName.includes('视频')) {
    return `${baseLabel} · 视频理解`;
  }
  if (role.includes('picture_in_picture') || role.includes('pip') || roleName.includes('画中画')) {
    return `${baseLabel} · 画中画理解`;
  }
  if (role.includes('editing') || roleName.includes('编辑')) {
    return `${baseLabel} · 编辑理解`;
  }

  return `${baseLabel} · ${label}`;
}

export function billableUsageSourceLabel(input: {
  sourceType?: string | null;
  requestSnapshot?: Record<string, unknown> | null;
}) {
  const sourceType = toText(input.sourceType);
  if (!sourceType) {
    return '-';
  }
  if (sourceType === 'video_remake_understanding' || sourceType === 'viral_upload_parse_understanding') {
    return understandingRoleLabel(sourceType, input.requestSnapshot || undefined);
  }
  return sourceTypeLabel(sourceType);
}
