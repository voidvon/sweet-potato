import { Pause, Play, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AssetLibraryAudioWave } from '../../../../components/AssetLibraryCard';
import type { ContentAsset, ContentAssetGroup } from '../../../../types';
import { AssetSelector, type AssetSelectorKind } from '../AssetSelector';
import { assetPreviewUrl, fieldText } from '../videoRemakeCardUtils';

export function findSelectedAsset(assets: ContentAsset[], id: unknown) {
  const assetId = fieldText(id);
  return assetId ? assets.find((asset) => asset.id === assetId) : undefined;
}

export function findSelectedAssets(assets: ContentAsset[], ids: unknown) {
  const values = Array.isArray(ids) ? ids.map((item) => fieldText(item)).filter(Boolean) : [];
  return values
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is ContentAsset => Boolean(asset));
}

export function selectedAssetIdsFromItem(item: Record<string, unknown>) {
  const values = Array.isArray(item.assetIds)
    ? item.assetIds.map((entry) => fieldText(entry)).filter(Boolean)
    : [];
  if (values.length) {
    return Array.from(new Set(values)).slice(0, 9);
  }
  const fallback = fieldText(item.assetId).trim();
  return fallback ? [fallback] : [];
}

export function findSelectedGroup(groups: ContentAssetGroup[], id: unknown) {
  const groupId = fieldText(id);
  return groupId ? groups.find((group) => group.id === groupId) : undefined;
}

export function SelectedReference({
  asset,
  group,
  emptyText,
}: {
  asset?: ContentAsset;
  group?: ContentAssetGroup;
  emptyText: string;
}) {
  if (!asset && !group) {
    return <span className="remake-selected-empty">{emptyText}</span>;
  }
  const title = asset?.name || asset?.originalFileName || group?.name || '已选择素材';
  const description = asset?.description || asset?.originalFileName || group?.description || (group?.assetCount !== undefined ? `${group.assetCount} 个素材` : '');
  const preview = asset ? assetPreviewUrl(asset) : assetPreviewUrl(group?.coverAssets?.[0]);
  const mimeType = asset?.mimeType || group?.coverAssets?.[0]?.mimeType || '';

  return (
    <div className="remake-selected-reference">
      <div className="remake-selected-thumb">
        {mimeType.startsWith('image/') && preview ? <img alt={title} src={preview} /> : null}
        {mimeType.startsWith('video/') && preview ? <video muted preload="metadata" src={preview} /> : null}
        {!preview || mimeType.startsWith('audio/') ? <span>{asset?.resourceType === 'voice' || group?.resourceType === 'voice' ? '声' : group ? '组' : '素'}</span> : null}
      </div>
      <div className="remake-selected-info">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </div>
    </div>
  );
}

export function resolveGroupPreviewAsset(group: ContentAssetGroup | undefined, assets: ContentAsset[], mimePrefix?: string) {
  if (!group) {
    return undefined;
  }
  const coverMatch = group.coverAssets?.find((item) => !mimePrefix || item.mimeType.startsWith(mimePrefix));
  if (coverMatch) {
    return coverMatch;
  }
  return assets.find((item) => item.groupId === group.id && (!mimePrefix || item.mimeType.startsWith(mimePrefix)));
}
export function SquareReferencePicker({
  asset,
  assets,
  group,
  groups,
  onClear,
  onEnsureAssets,
  onSelect,
  onUpload,
  pickText,
  preferAudioPreview = false,
  selectorKind,
  selectorTitle,
}: {
  asset?: ContentAsset;
  assets: ContentAsset[];
  emptyText: string;
  group?: ContentAssetGroup;
  groups: ContentAssetGroup[];
  onClear?: () => void;
  onEnsureAssets?: () => Promise<void>;
  onSelect: (selection: { assetId?: string; groupId?: string }) => void;
  onUpload?: (file: File) => Promise<void>;
  pickText: string;
  preferAudioPreview?: boolean;
  selectorKind: AssetSelectorKind;
  selectorTitle: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const previewAsset = asset || resolveGroupPreviewAsset(group, assets, preferAudioPreview ? 'audio/' : undefined) || resolveGroupPreviewAsset(group, assets);
  const previewUrl = assetPreviewUrl(previewAsset);
  const mimeType = previewAsset?.mimeType || '';
  const title = asset?.name || asset?.originalFileName || group?.name || pickText;
  const hasSelection = Boolean(asset || group);
  const isAudio = mimeType.startsWith('audio/');

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }
    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
    };
  }, [previewUrl]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const toggleAudio = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
      return;
    }
    audio.pause();
    setIsPlaying(false);
  };

  const handlePick = () => {
    if (!hasSelection) {
      void onEnsureAssets?.().finally(() => setSelectorOpen(true));
    }
  };

  return (
    <>
      <div
        className={`remake-picker-card ${hasSelection ? 'selected' : 'empty'} ${isAudio ? 'audio' : ''}`}
        onClick={handlePick}
        onKeyDown={(event) => {
          if (!hasSelection && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            handlePick();
          }
        }}
        role={!hasSelection ? 'button' : undefined}
        tabIndex={!hasSelection ? 0 : undefined}
      >
        {hasSelection ? (
          <>
            {mimeType.startsWith('image/') && previewUrl ? <img alt={title} className="remake-picker-card-media" src={previewUrl} /> : null}
            {mimeType.startsWith('video/') && previewUrl ? <video className="remake-picker-card-media" muted preload="metadata" src={previewUrl} /> : null}
            {isAudio ? <AssetLibraryAudioWave className="remake-picker-card-audio-wave" /> : null}
            <div className="remake-picker-card-overlay">
              <span>{title}</span>
            </div>
            {isAudio && previewUrl ? (
              <>
                <button
                  aria-label={isPlaying ? '暂停播放' : '播放声音'}
                  className="remake-picker-card-audio-button"
                  onClick={(event) => { void toggleAudio(event); }}
                  type="button"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <audio ref={audioRef} preload="none" src={previewUrl} />
              </>
            ) : null}
            {onClear ? (
              <button
                aria-label="清除已选素材"
                className="remake-picker-card-clear"
                onClick={(event) => {
                  event.stopPropagation();
                  onClear();
                }}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
          </>
        ) : (
          <div className="remake-picker-card-placeholder">
            <Plus size={18} />
            <strong>选择素材</strong>
          </div>
        )}
      </div>
      <AssetSelector
        assets={assets}
        groups={groups}
        kind={selectorKind}
        onCancel={() => setSelectorOpen(false)}
        onSelect={(selection) => {
          onSelect(selection);
          setSelectorOpen(false);
        }}
        onUpload={onUpload}
        open={selectorOpen}
        selectedAssetId={asset?.id}
        selectedGroupId={group?.id}
        title={selectorTitle}
      />
    </>
  );
}
