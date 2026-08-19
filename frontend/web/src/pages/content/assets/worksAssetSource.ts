import type { ContentAsset } from '../../../types';

export type VideoWorkSource = 'video_creation' | 'talking_video' | 'video_upscale' | 'subtitle_removal' | 'video_translation';

export function getVideoWorkSourceFromMode(value: unknown): VideoWorkSource {
  const mode = typeof value === 'string' ? value.trim().replaceAll('-', '_') : '';
  if (mode === 'video_translation') {
    return 'video_translation';
  }
  if (mode === 'talking_video') {
    return 'talking_video';
  }
  if (mode === 'video_upscale') {
    return 'video_upscale';
  }
  if (mode === 'subtitle_removal') {
    return 'subtitle_removal';
  }
  return 'video_creation';
}

export function stringMetadataValue(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function getVideoWorkSource(asset: ContentAsset): VideoWorkSource | null {
  const generatedBy = stringMetadataValue(asset, 'generatedBy');
  const mode = stringMetadataValue(asset, 'mode');
  const model = stringMetadataValue(asset, 'model');
  const isVideoTranslation = generatedBy === 'video_translation'
    || mode === 'video_translation'
    || model === 'ai-video-translation';
  if (isVideoTranslation) {
    return 'video_translation';
  }
  if (generatedBy !== 'video_model' && generatedBy !== 'video_enhancement' && generatedBy !== 'video_subtitle_removal') {
    return null;
  }
  return getVideoWorkSourceFromMode(
    generatedBy === 'video_enhancement'
      ? 'video_upscale'
      : generatedBy === 'video_subtitle_removal'
        ? 'subtitle_removal'
        : mode,
  );
}

export function getVideoWorkSourceLabel(source: VideoWorkSource | null) {
  if (source === 'video_creation') {
    return '视频创作';
  }
  if (source === 'talking_video') {
    return '口播视频生成';
  }
  if (source === 'video_upscale') {
    return '高清放大';
  }
  if (source === 'subtitle_removal') {
    return '字幕擦除';
  }
  if (source === 'video_translation') {
    return '视频翻译';
  }
  return '';
}
