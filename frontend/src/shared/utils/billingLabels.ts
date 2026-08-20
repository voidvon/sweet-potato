
import { t } from '@shared/i18n';const sourceTypeMap: Record<string, string> = {
  admin_adjust: t("人工调整"),
  chat_completion: t("LLM 对话"),
  confirmed_audio_preview: t("确认音频预览"),
  content_planning_analysis: t("内容策划 · 素材识别"),
  content_planning_generation: t("内容策划 · 脚本生成"),
  talking_video_prompt: t("口播视频 · 提示词生成"),
  content_planning_planner: t("内容策划 · 需求规划"),
  content_planning_repair: t("内容策划 · 脚本修复"),
  content_planning_strategy: t("内容策划 · 创意策略"),
  content_planning_timeline: t("内容策划 · 时间轴设计"),
  content_planning_validator: t("内容策划 · 结果校验"),
  content_planning_visual_director: t("内容策划 · 分镜设计"),
  marketing_video_storyboard: t("营销视频 · 分镜生成"),
  content_planning_writer: t("内容策划 · 文案创作"),
  finished_video: t("成片"),
  other: t("其他"),
  product: t("商品"),
  prompt: t("提示词"),
  real_person: t("真人素材"),
  scene: t("场景"),
  chat_image_generation: t("图片创作"),
  video_generation: t("视频创作"),
  video_upscale: t("视频高清放大"),
  url: '链接',
  virtual_portrait: t("虚拟人像"),
  vod_upload: t("视频上传"),
  voice: t("音色"),
  voice_clone_preview: t("声音克隆预览"),
  voice_clone_training: t("声音克隆训练"),
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
