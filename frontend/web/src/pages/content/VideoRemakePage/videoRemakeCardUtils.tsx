import { API_BASE_URL } from '../../../api/request';
import type { ContentAsset, ContentAssetGroup } from '../../../types';
import type { VideoRemakeCardMessage, VideoRemakeCardStatus, VideoRemakeCardType, VideoRemakeChatMessage } from '../../../api/video-remake';

export const cardTypeLabels: Record<VideoRemakeCardType, string> = {
  uploading: '状态卡',
  video_basic_info: '视频基础信息',
  basic_info: '基础信息',
  expert_analysis: '专家分析',
  character_setting: '人物设定',
  scene_setting: '场景设定',
  product_setting: '产品设定',
  pip_setting: '画中画',
  voice_audio_setting: '人声/音频',
  script_content: '口播内容',
  storyboard_script: '分镜脚本',
  seedance_prompt: 'Seedance 提示词',
  generation_progress: '视频解析',
  director_normalize: '视频导演',
  llm_thinking: '大模型思考',
  final_video: '最终视频',
};

export const cardStatusLabels: Record<VideoRemakeCardStatus, string> = {
  pending: '待确认',
  editing: '修改中',
  confirmed: '已确认',
  expired: '已失效',
  failed: '失败',
};

export const downstreamCardTypesByUpstream: Partial<Record<VideoRemakeCardType, VideoRemakeCardType[]>> = {
  basic_info: ['storyboard_script', 'seedance_prompt'],
  character_setting: ['storyboard_script', 'seedance_prompt'],
  scene_setting: ['storyboard_script', 'seedance_prompt'],
  product_setting: ['storyboard_script', 'seedance_prompt'],
  pip_setting: ['storyboard_script', 'seedance_prompt'],
  voice_audio_setting: ['storyboard_script', 'seedance_prompt'],
  script_content: ['storyboard_script', 'seedance_prompt'],
  storyboard_script: ['seedance_prompt'],
};

export function formatDate(value?: string) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function asItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function updateAt(items: Record<string, unknown>[], index: number, patch: Record<string, unknown>) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

export function fieldText(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

export function fieldBool(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function fieldNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function mediaUrl(url: string) {
  if (!url) {
    return '';
  }
  if (/^(blob:|data:|https?:\/\/)/i.test(url)) {
    return url;
  }
  return `${API_BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

function isThreeViewResultAsset(asset: ContentAsset) {
  if (asset.metadata?.kind === 'three_view_failure' || asset.metadata?.kind === 'three_view_running') {
    return false;
  }
  return asset.metadata?.kind === 'three_view_result'
    || /三视图|多视图|成品|结果|three[-_ ]?view/i.test(`${asset.name} ${asset.description}`);
}

export function isSelectableCharacterAsset(asset: ContentAsset) {
  if (asset.resourceType !== 'virtual_portrait' && asset.resourceType !== 'real_person') {
    return false;
  }
  if (!asset.mimeType.startsWith('image/') && !asset.mimeType.startsWith('video/')) {
    return false;
  }
  if (asset.metadata?.kind === 'training_photo' || asset.metadata?.kind === 'three_view_running' || asset.metadata?.kind === 'three_view_failure') {
    return false;
  }
  if (asset.resourceType === 'virtual_portrait') {
    return String(asset.metadata?.volcStatus || '') === 'Active'
      && Boolean(asset.metadata?.assetUri || asset.metadata?.volcAssetId)
      && (isThreeViewResultAsset(asset) || asset.metadata?.source === 'local_upload');
  }
  if (asset.resourceType === 'real_person') {
    return String(asset.metadata?.volcStatus || '') === 'Active';
  }
  return false;
}

export function characterAssetSourceLabel(asset: ContentAsset) {
  if (asset.resourceType === 'real_person') {
    return asset.metadata?.source === 'local_upload' ? '真人素材 · 本地上传' : '真人素材 · 已认证';
  }
  if (asset.resourceType === 'virtual_portrait') {
    return asset.metadata?.source === 'local_upload' ? '虚拟人像 · 本地上传' : '虚拟人像 · AI训练';
  }
  return '';
}

export function selectableSceneAssets(assets: ContentAsset[]) {
  return assets.filter((asset) => (asset.resourceType === 'scene' || asset.resourceType === 'other') && (asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/')));
}

export function selectableProductAssets(assets: ContentAsset[]) {
  return assets.filter((asset) => (asset.resourceType === 'product' || asset.resourceType === 'other') && (asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/')));
}

export function selectableVoiceAssets(assets: ContentAsset[]) {
  return assets.filter((asset) => (asset.resourceType === 'voice' || asset.resourceType === 'other') && asset.mimeType.startsWith('audio/'));
}

export function selectableVisualAssets(assets: ContentAsset[]) {
  return assets.filter((asset) => asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'));
}

export function groupAssetCount(group: ContentAssetGroup, assets: ContentAsset[]) {
  const fallbackCount = assets.filter((asset) => asset.groupId === group.id).length;
  return group.assetCount || group.coverAssets?.length || fallbackCount;
}

export function latestCardByType(messages: VideoRemakeChatMessage[], cardType: VideoRemakeCardType) {
  const cards = messages.filter((item): item is VideoRemakeCardMessage => item.type === 'card' && item.cardType === cardType);
  return cards[cards.length - 1] || null;
}

export function isEditableCardType(cardType: VideoRemakeCardType) {
  return !['uploading', 'video_basic_info', 'expert_analysis', 'generation_progress', 'director_normalize', 'llm_thinking'].includes(cardType);
}

const cardIntentKeywords: Record<VideoRemakeCardType, string> = {
  uploading: '状态',
  video_basic_info: '视频基础信息',
  basic_info: '基础信息',
  expert_analysis: '专家分析',
  character_setting: '人物',
  scene_setting: '场景',
  product_setting: '产品',
  pip_setting: '画中画',
  voice_audio_setting: '声音',
  script_content: '口播',
  storyboard_script: '分镜',
  seedance_prompt: '提示词',
  generation_progress: '视频解析',
  director_normalize: '视频导演',
  llm_thinking: '大模型思考',
  final_video: '最终视频',
};

export function editPromptForCard(cardType: VideoRemakeCardType) {
  const keyword = cardIntentKeywords[cardType] || cardTypeLabels[cardType];
  return `我要改${keyword}`;
}
