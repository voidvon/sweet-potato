import { Modal } from 'antd';
import { CheckCircle2, FileVideo, Image as ImageIcon, Layers3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { AssetLibraryCard } from '../../../components/AssetLibraryCard';
import type { ContentAsset, ContentAssetGroup } from '../../../types';
import {
  characterAssetSourceLabel,
  formatDate,
  groupAssetCount,
  isSelectableCharacterAsset,
  mediaUrl,
  selectableProductAssets,
  selectableSceneAssets,
  selectableVisualAssets,
  selectableVoiceAssets,
} from './videoRemakeCardUtils';

export type AssetSelectorKind = 'character' | 'scene_group' | 'scene_asset' | 'product_group' | 'product_asset' | 'voice_group' | 'voice_asset' | 'visual_asset';

type AssetSelectorProps = {
  assets: ContentAsset[];
  groups: ContentAssetGroup[];
  kind: AssetSelectorKind;
  open: boolean;
  selectedAssetId?: string;
  selectedGroupId?: string;
  title: string;
  onCancel: () => void;
  onSelect: (selection: { assetId?: string; groupId?: string }) => void;
};

function pickAssets(kind: AssetSelectorKind, assets: ContentAsset[]) {
  if (kind === 'character') {
    return assets.filter(isSelectableCharacterAsset);
  }
  if (kind === 'scene_asset') {
    return selectableSceneAssets(assets);
  }
  if (kind === 'product_asset') {
    return selectableProductAssets(assets);
  }
  if (kind === 'voice_asset') {
    return selectableVoiceAssets(assets);
  }
  return selectableVisualAssets(assets);
}

function isInternalUploadGroup(group: ContentAssetGroup) {
  const name = group.name.trim().toLowerCase();
  const description = group.description.trim().toLowerCase();
  return name.includes('hot replica upload') || description.includes('爆款复刻 agent 上传素材');
}

function pickGroups(kind: AssetSelectorKind, groups: ContentAssetGroup[]) {
  const visibleGroups = groups.filter((group) => !isInternalUploadGroup(group));
  if (kind === 'scene_group') {
    return visibleGroups.filter((group) => group.resourceType === 'scene' || group.resourceType === 'other');
  }
  if (kind === 'product_group') {
    return visibleGroups.filter((group) => group.resourceType === 'product' || group.resourceType === 'other');
  }
  if (kind === 'voice_group') {
    return visibleGroups.filter((group) => group.resourceType === 'voice' || group.resourceType === 'other');
  }
  return visibleGroups;
}

function assetIcon(asset: ContentAsset) {
  if (asset.mimeType.startsWith('video/')) {
    return <FileVideo size={16} />;
  }
  return <ImageIcon size={16} />;
}

function groupPreviewAsset(group: ContentAssetGroup, assets: ContentAsset[]) {
  return group.coverAssets?.[0] || assets.find((asset) => asset.groupId === group.id);
}

function assetPreview(asset: ContentAsset, fallback?: ReactNode) {
  const preview = mediaUrl(asset.fileUrl);
  if (asset.mimeType.startsWith('image/') && preview) {
    return <img alt={asset.name || asset.originalFileName} src={preview} />;
  }
  if (asset.mimeType.startsWith('video/') && preview) {
    return <video muted preload="metadata" src={preview} />;
  }
  return <div className="remake-selector-audio">{fallback || <ImageIcon size={18} />}</div>;
}

function audioSource(asset?: ContentAsset) {
  if (!asset || !asset.mimeType.startsWith('audio/')) {
    return undefined;
  }
  const url = mediaUrl(asset.fileUrl);
  return url || undefined;
}

function groupStatus(kind: AssetSelectorKind, group: ContentAssetGroup, assets: ContentAsset[]) {
  const count = groupAssetCount(group, assets);
  if (kind === 'voice_group') {
    return count ? '已上传样本，待克隆音色' : '待上传音频样本';
  }
  if (kind === 'scene_group') {
    return count ? '图片可用于视频场景' : '待上传场景图片';
  }
  if (kind === 'product_group') {
    return count ? '素材可用' : '待上传素材';
  }
  return count ? '素材可用' : '暂无素材';
}

export function AssetSelector({
  assets,
  groups,
  kind,
  open,
  selectedAssetId,
  selectedGroupId,
  title,
  onCancel,
  onSelect,
}: AssetSelectorProps) {
  const availableAssets = pickAssets(kind, assets);
  const availableGroups = pickGroups(kind, groups);
  const useGroupMode = kind.endsWith('_group');

  return (
    <Modal
      footer={null}
      onCancel={onCancel}
      open={open}
      title={title}
      width={820}
    >
      <div className="remake-selector-grid">
        {useGroupMode ? availableGroups.map((group) => {
          const active = group.id === selectedGroupId;
          const previewAsset = groupPreviewAsset(group, assets);
          return (
            <AssetLibraryCard
              audioSrc={audioSource(previewAsset)}
              audioTitle={group.name}
              className={`remake-selector-library-card ${active ? 'active' : ''}`}
              displayMode="compact"
              key={group.id}
              meta={`${groupAssetCount(group, assets)} 个素材 · 更新于 ${formatDate(group.updatedAt)}`}
              onClick={() => onSelect({ groupId: group.id })}
              preview={audioSource(previewAsset) ? undefined : previewAsset ? assetPreview(previewAsset, <Layers3 size={18} />) : <div className="remake-selector-audio"><Layers3 size={18} /></div>}
              previewClassName="material-preview"
              status={active ? <span className="remake-selector-checkline"><CheckCircle2 size={14} />已选择</span> : groupStatus(kind, group, assets)}
              title={group.name}
              description={group.description || undefined}
            />
          );
        }) : availableAssets.map((asset) => {
          const active = asset.id === selectedAssetId;
          return (
            <AssetLibraryCard
              audioSrc={audioSource(asset)}
              audioTitle={asset.name || asset.originalFileName}
              className={`remake-selector-library-card ${active ? 'active' : ''}`}
              displayMode="compact"
              key={asset.id}
              meta={formatDate(asset.updatedAt)}
              onClick={() => onSelect({ assetId: asset.id, groupId: asset.groupId })}
              preview={audioSource(asset) ? undefined : assetPreview(asset)}
              previewClassName="material-preview"
              status={active ? <span className="remake-selector-checkline"><CheckCircle2 size={14} />已选择</span> : undefined}
              title={asset.name || asset.originalFileName}
              description={kind === 'character' ? characterAssetSourceLabel(asset) : asset.description || asset.originalFileName}
            />
          );
        })}
        {!availableGroups.length && !availableAssets.length ? (
          <div className="remake-selector-empty">暂无可选素材</div>
        ) : null}
      </div>
    </Modal>
  );
}
