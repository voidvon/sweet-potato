import type { ContentAsset } from '../../../types';

export type VideoWorkSource = 'video_creation' | 'video_remake' | 'video_upscale' | 'subtitle_removal';

export function stringMetadataValue(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function getVideoWorkSource(asset: ContentAsset): VideoWorkSource | null {
  const generatedBy = stringMetadataValue(asset, 'generatedBy');
  if (generatedBy !== 'video_model' && generatedBy !== 'video_enhancement' && generatedBy !== 'video_subtitle_removal') {
    return null;
  }
  const mode = stringMetadataValue(asset, 'mode');
  const modeTitle = stringMetadataValue(asset, 'modeTitle');
  if (
    mode.startsWith('viral_replication_')
    || mode.startsWith('video_remake_')
    || modeTitle.includes('爆款复刻')
  ) {
    return 'video_remake';
  }
  if (generatedBy === 'video_enhancement' || mode === 'video_upscale') {
    return 'video_upscale';
  }
  if (generatedBy === 'video_subtitle_removal' || mode === 'subtitle_removal') {
    return 'subtitle_removal';
  }
  return 'video_creation';
}

export function getVideoWorkSourceLabel(source: VideoWorkSource | null) {
  if (source === 'video_creation') {
    return '视频创作';
  }
  if (source === 'video_remake') {
    return '爆款复刻';
  }
  if (source === 'video_upscale') {
    return '高清放大';
  }
  if (source === 'subtitle_removal') {
    return '字幕擦除';
  }
  return '';
}
