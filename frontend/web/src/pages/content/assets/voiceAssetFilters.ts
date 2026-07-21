import type { ContentAsset, ContentAssetGroup } from '../../../types';

export function isVoiceSampleAsset(asset: ContentAsset) {
  return asset.mimeType.startsWith('audio/') && asset.metadata?.kind !== 'voice_clone_preview';
}

export function voiceSampleAssetsFromGroups(groups: ContentAssetGroup[]) {
  return groups.flatMap((group) => (
    (group.coverAssets || []).filter(isVoiceSampleAsset).slice(0, 1)
  ));
}
