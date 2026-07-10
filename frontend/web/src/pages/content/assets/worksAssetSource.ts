import type { ContentAsset } from '../../../types';

export type VideoWorkSource = 'video_creation' | 'video_remake';

export function stringMetadataValue(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function getVideoWorkSource(asset: ContentAsset): VideoWorkSource | null {
  if (stringMetadataValue(asset, 'generatedBy') !== 'video_model') {
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
  return 'video_creation';
}

export function getVideoWorkSourceLabel(source: VideoWorkSource | null) {
  if (source === 'video_creation') {
    return '视频创作';
  }
  if (source === 'video_remake') {
    return '爆款复刻';
  }
  return '';
}
