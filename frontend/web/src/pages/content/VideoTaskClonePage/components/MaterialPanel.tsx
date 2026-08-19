import { ChevronLeft, Image, Music2, Package, Pause, Play, Trash2, UserRound, ZoomIn } from 'lucide-react';
import { Button } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MaterialSlot } from './MaterialSlot';
import { MaterialUploadPopover } from './MaterialUploadPopover';
import { AudioAssetLibraryPanel } from './AudioAssetLibraryList';
import { WorkspaceSection } from './WorkspaceSection';
import { resolveAssetUrl } from '../../../../api/request';
import type { ContentAsset } from '../../../../types';
import type { LocalMaterialFile, MaterialKind, MaterialMode, SelectedMaterials, ToolOption, UploadAnchor, WorksTab } from '../types';
import { getVideoWorkSource, getVideoWorkSourceLabel } from '../../assets/worksAssetSource';

type MaterialPanelProps = {
  activeUpload: MaterialKind | null;
  isLoadingLibraryAssets: boolean;
  materialMode: MaterialMode;
  materialSlots?: ReactNode;
  onClosePopovers: () => void;
  onLibraryAssetChoose: (kind: MaterialKind, asset: ContentAsset) => void;
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialRemoveOne: (kind: MaterialKind, materialId?: string) => void;
  onMaterialsClearAll: () => void;
  onMaterialFill: (kind: MaterialKind, value: string) => void;
  onMaterialLocalFiles: (kind: MaterialKind, files: FileList | File[]) => void;
  onMaterialReplaceFiles: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  onModelPickerOpen: (kind?: MaterialKind) => void;
  onTabChange: (mode: MaterialMode) => void;
  onUploadClose: () => void;
  onUploadOpen: (kind: MaterialKind, anchor: UploadAnchor) => void;
  onVoiceChange: (enabled: boolean) => void;
  onWorksTabChange: (tab: WorksTab) => void;
  selectedMaterials: SelectedMaterials;
  showVoiceToggle: boolean;
  tool: ToolOption;
  topSlot?: ReactNode;
  uploadAnchor: UploadAnchor | null;
  voiceEnabled: boolean;
  voiceAssets: ContentAsset[];
  voiceGroupNameById: Record<string, string>;
  visibleMaterialKeys?: MaterialKind['key'][];
  worksAssets: ContentAsset[];
  worksTab: WorksTab;
};

export type ReferenceMaterialPreviewAsset = Pick<
  ContentAsset,
  'id' | 'name' | 'originalFileName' | 'mimeType' | 'fileUrl' | 'metadata'
>;

type ReferenceMaterialPreviewListProps = {
  activeAudioAssetId: string | null;
  assets: ReferenceMaterialPreviewAsset[];
  isLoading?: boolean;
  onAudioPreview: (asset: ReferenceMaterialPreviewAsset) => void;
  onImagePreview: (asset: ReferenceMaterialPreviewAsset) => void;
  onVideoPreview: (asset: ReferenceMaterialPreviewAsset) => void;
};

export function ReferenceMaterialPreviewList({
  activeAudioAssetId,
  assets,
  isLoading = false,
  onAudioPreview,
  onImagePreview,
  onVideoPreview,
}: ReferenceMaterialPreviewListProps) {
  if (isLoading) {
    return (
      <div className="result-reference-materials is-loading" aria-label="正在加载参考素材">
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (assets.length === 0) {
    return <p className="result-reference-materials-empty">暂无参考素材</p>;
  }

  return (
    <div className="result-reference-materials">
      {assets.map((asset) => {
        const name = asset.name || asset.originalFileName || '参考素材';
        const isVideo = asset.mimeType.startsWith('video/');
        const isImage = asset.mimeType.startsWith('image/');
        const isAudio = asset.mimeType.startsWith('audio/');
        const isAudioPlaying = isAudio && activeAudioAssetId === asset.id;
        const content = isVideo ? (
          <>
            <video muted playsInline preload="metadata" src={resolveAssetUrl(asset.fileUrl)} />
            <i className="result-reference-materials__play" aria-hidden="true">
              <Play size={15} fill="currentColor" />
            </i>
          </>
        ) : isImage ? (
          <>
            <img alt={name} src={resolveAssetUrl(asset.fileUrl)} />
            <i className="result-reference-materials__zoom" aria-hidden="true">
              <ZoomIn size={14} />
            </i>
          </>
        ) : isAudio ? (
          <>
            <i className="result-reference-materials__audio" aria-hidden="true">
              <Music2 size={22} />
            </i>
            <i className="result-reference-materials__play is-audio" aria-hidden="true">
              {isAudioPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </i>
          </>
        ) : null;
        const onPreview = isVideo
          ? () => onVideoPreview(asset)
          : isImage
            ? () => onImagePreview(asset)
            : isAudio
              ? () => onAudioPreview(asset)
              : undefined;
        const actionLabel = isVideo || isImage
          ? `预览${name}`
          : isAudioPlaying
            ? `暂停${name}`
            : `试听${name}`;

        return onPreview ? (
          <button
            aria-label={actionLabel}
            aria-pressed={isAudio ? isAudioPlaying : undefined}
            className={`result-reference-materials__item${isAudioPlaying ? ' is-playing' : ''}`}
            key={asset.id}
            onClick={onPreview}
            title={actionLabel}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div className="result-reference-materials__item" key={asset.id} title={name}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function MaterialPanel({
  activeUpload,
  isLoadingLibraryAssets,
  materialMode,
  materialSlots,
  onClosePopovers,
  onLibraryAssetChoose,
  onMaterialClear,
  onMaterialRemoveOne,
  onMaterialsClearAll,
  onMaterialFill,
  onMaterialLocalFiles,
  onMaterialReplaceFiles,
  onModelPickerOpen,
  onTabChange,
  onUploadClose,
  onUploadOpen,
  onVoiceChange,
  onWorksTabChange,
  selectedMaterials,
  showVoiceToggle,
  tool,
  topSlot,
  uploadAnchor,
  voiceEnabled,
  voiceAssets,
  voiceGroupNameById,
  visibleMaterialKeys,
  worksAssets,
  worksTab,
}: MaterialPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const hasOpenPopover = Boolean(materialMode || activeUpload);
  const isVideoTranslation = tool.key === 'video-translation';
  const showAuxiliaryMaterialOptions = ![
    'video-upscale',
    'subtitle-removal',
    'video-translation',
  ].includes(tool.key);
  const isMaterialVisible = (item: MaterialKind) => !visibleMaterialKeys || visibleMaterialKeys.includes(item.key);
  const audioMaterial = tool.materials.find((item) => item.key === 'audio' && isMaterialVisible(item));
  const imageMaterial = tool.materials.find((item) => item.key === 'image' && isMaterialVisible(item));
  const videoMaterial = tool.materials.find((item) => item.key === 'video' && isMaterialVisible(item));
  const hasVisibleSelectedMaterials = tool.materials.some((item) => (
    isMaterialVisible(item) && Boolean(selectedMaterials[item.key])
  ));
  const hasSelectedAudio = Boolean(selectedMaterials.audio);
  const [videoDurationByAssetId, setVideoDurationByAssetId] = useState<Record<string, number>>({});
  const filteredWorksAssets = useMemo(() => worksAssets.filter((asset) => {
    const isImage = asset.mimeType.startsWith('image/');
    const isVideo = asset.mimeType.startsWith('video/');
    if ((isImage && !imageMaterial) || (isVideo && !videoMaterial)) {
      return false;
    }
    if (worksTab === 'image') return isImage;
    if (worksTab === 'video') return isVideo;
    return isImage || isVideo;
  }), [imageMaterial, videoMaterial, worksAssets, worksTab]);

  useEffect(() => {
    if (!hasOpenPopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (activeUpload && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.video-task-tabs')) return;
      onClosePopovers();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [hasOpenPopover, onClosePopovers]);

  return (
    <WorkspaceSection
      className="video-task-material-card"
      description={tool.materialHint}
      headerExtra={(
        <div className="video-task-tabs" aria-label="素材类型">
          {hasVisibleSelectedMaterials && (
            <button className="is-danger" onClick={onMaterialsClearAll} title="清空全部素材" type="button">
              <Trash2 size={12} />
              清空
            </button>
          )}
          <button
            aria-expanded={materialMode === 'works'}
            className={materialMode === 'works' ? 'is-active' : ''}
            onClick={() => onTabChange(materialMode === 'works' ? null : 'works')}
            type="button"
          >
            <Image size={12} />
            作品
          </button>
          {showAuxiliaryMaterialOptions && audioMaterial && (
            <button
              aria-expanded={materialMode === 'audio'}
              className={materialMode === 'audio' ? 'is-active' : ''}
              onClick={() => onTabChange(materialMode === 'audio' ? null : 'audio')}
              type="button"
            >
              <Music2 size={12} />
              音频
            </button>
          )}
          {showAuxiliaryMaterialOptions && (
            <button
              aria-expanded={false}
              onClick={() => onModelPickerOpen(imageMaterial)}
              type="button"
            >
              {isVideoTranslation ? <UserRound size={12} /> : <Package size={12} />}
              {isVideoTranslation ? '模特' : '素材'}
            </button>
          )}
          {showVoiceToggle && (
            <label
              className={`video-task-voice-toggle${hasSelectedAudio ? ' is-locked' : ''}`}
              title={hasSelectedAudio ? '已选择参考音频，声音必须开启' : '生成视频声音'}
            >
              <span>声音</span>
              <input
                checked={voiceEnabled || hasSelectedAudio}
                disabled={hasSelectedAudio}
                onChange={(event) => onVoiceChange(event.target.checked)}
                type="checkbox"
              />
              <i aria-hidden="true" />
            </label>
          )}
        </div>
      )}
      headerLayout="stacked"
      ref={panelRef}
      title="素材"
      topSlot={topSlot}
    >

      <div className="video-task-material-grid">
        {materialSlots ?? tool.materials.filter((item) => {
          if (!isMaterialVisible(item)) return false;
          if (isVideoTranslation) return item.key === 'video';
          if (tool.key === 'dance-remake') return item.key === 'image';
          return true;
        }).map((item) => {
          const selected = selectedMaterials[item.key];
          return (
            <MaterialSlot
              item={item}
              key={item.label}
              onClear={onMaterialClear}
              onLocalFiles={onMaterialLocalFiles}
              onOpen={onUploadOpen}
              onRemoveOne={onMaterialRemoveOne}
              onReplaceFiles={onMaterialReplaceFiles}
              openMode="local"
              selected={selected}
            />
          );
        })}
      </div>

      {isVideoTranslation && selectedMaterials.video && (
        <p className="video-task-translation-storage-note">视频同步存储中，任务提交后会自动处理</p>
      )}

      {materialMode === 'audio' && (
        <aside className="video-task-library-popover is-audio" ref={popoverRef}>
          <AudioAssetLibraryPanel
            assets={voiceAssets}
            disabled={!audioMaterial}
            groupNameById={voiceGroupNameById}
            isLoading={isLoadingLibraryAssets}
            onChoose={(asset) => audioMaterial && onLibraryAssetChoose(audioMaterial, asset)}
            onClose={onClosePopovers}
          />
        </aside>
      )}

      {materialMode === 'works' && (
        <aside className="video-task-library-popover is-works" ref={popoverRef}>
          <header>
            <span className="video-task-library-heading">
              <i aria-hidden="true"><Image size={15} /></i>
              <strong>我的作品</strong>
            </span>
            <Button
            aria-label="收起音频素材库"
            className="video-task-popover-collapse"
            icon={<ChevronLeft size={20} />}
            onClick={onClosePopovers}
            shape="circle"
            type="text"
          />
          </header>
          <p>点击卡片填入可用素材 ↙</p>
          <div className="video-task-assets-tabs">
            <button className={worksTab === 'all' ? 'is-active' : ''} onClick={() => onWorksTabChange('all')} type="button">全部</button>
            {imageMaterial && (
              <button className={worksTab === 'image' ? 'is-active' : ''} onClick={() => onWorksTabChange('image')} type="button">图片</button>
            )}
            {videoMaterial && (
              <button className={worksTab === 'video' ? 'is-active' : ''} onClick={() => onWorksTabChange('video')} type="button">视频</button>
            )}
          </div>
          <div className="video-task-works-scroll">
            {isLoadingLibraryAssets && <div className="video-task-assets-empty">正在加载作品</div>}
            {!isLoadingLibraryAssets && filteredWorksAssets.length === 0 && (
              <div className="video-task-assets-empty">暂无作品</div>
            )}
            {!isLoadingLibraryAssets && filteredWorksAssets.length > 0 && (
              <>
                <div className="video-task-works-grid">
                  {filteredWorksAssets.map((asset) => {
                    const isVideo = asset.mimeType.startsWith('video/');
                    const targetMaterial = isVideo ? videoMaterial : imageMaterial;
                    const name = getAssetName(asset, isVideo ? '视频作品' : '图片作品');
                    const videoDurationLabel = getAssetDuration(asset, videoDurationByAssetId[asset.id]);
                    const videoSourceLabel = getVideoWorkSourceLabel(getVideoWorkSource(asset)) || '视频作品';
                    const cardTitle = isVideo
                      ? [videoSourceLabel, videoDurationLabel === '--:--' ? '' : videoDurationLabel].filter(Boolean).join(' ')
                      : name;
                    return (
                      <button
                        className="video-task-works-card"
                        disabled={!targetMaterial}
                        key={asset.id}
                        onMouseEnter={(event) => {
                          if (isVideo) {
                            playMutedCardVideo(event.currentTarget);
                          }
                        }}
                        onMouseLeave={(event) => {
                          if (isVideo) {
                            resetCardVideo(event.currentTarget);
                          }
                        }}
                        onClick={() => targetMaterial && onLibraryAssetChoose(targetMaterial, asset)}
                        title={cardTitle}
                        type="button"
                      >
                        {isVideo ? (
                          <>
                            <video
                              muted
                              onLoadedMetadata={(event) => {
                                const nextDuration = event.currentTarget.duration;
                                if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
                                  return;
                                }
                                setVideoDurationByAssetId((current) => (
                                  current[asset.id] === nextDuration ? current : { ...current, [asset.id]: nextDuration }
                                ));
                              }}
                              playsInline
                              preload="metadata"
                              src={resolveAssetUrl(asset.fileUrl)}
                            />
                            <span className="video-task-works-video-badge">
                              {/* <Play size={10} fill="currentColor" /> */}
                              {videoDurationLabel}
                            </span>
                          </>
                        ) : (
                          <img alt={name} src={resolveAssetUrl(asset.fileUrl)} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <em>— 没有更多 —</em>
              </>
            )}
          </div>
        </aside>
      )}

      {activeUpload && (
        <MaterialUploadPopover
          anchor={uploadAnchor}
          item={activeUpload}
          onClose={onUploadClose}
          onLibraryChoose={(item) => onMaterialFill(item, getDemoMaterialValue(item))}
          onLocalUpload={(item) => onMaterialFill(item, `${item.label} 01`)}
        />
      )}
    </WorkspaceSection>
  );
}

function getDemoMaterialValue(item: MaterialKind) {
  if (item.key === 'audio') {
    return 'voice-clone-preview-04e614e6-89c7-4f03-a35f-32f29afc458b-1778754088555.wav';
  }
  if (item.key === 'image') return '参考图 8 张';
  return `素材库 ${item.label}`;
}

function getAssetName(asset: ContentAsset, fallback: string) {
  return asset.name || asset.originalFileName || asset.storedFileName || fallback;
}

function getAssetDuration(asset: ContentAsset, loadedDuration?: number) {
  const duration = loadedDuration ?? getAssetDurationSeconds(asset);
  if (Number.isFinite(duration) && duration > 0) {
    return formatVideoDuration(duration);
  }
  return '--:--';
}

function getAssetDurationSeconds(asset: ContentAsset) {
  const durationMs = numericDuration(asset.metadata?.durationMs);
  if (durationMs > 0) {
    return durationMs / 1000;
  }
  return numericDuration(asset.metadata?.durationSeconds)
    || numericDuration(asset.metadata?.durationSecond)
    || numericDuration(asset.metadata?.duration);
}

function numericDuration(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const matched = trimmed.match(/[\d.]+/);
  if (!matched) {
    return 0;
  }
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatVideoDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

function playMutedCardVideo(card: HTMLElement) {
  const video = card.querySelector('video');
  if (!video) {
    return;
  }
  video.muted = true;
  void video.play().catch(() => undefined);
}

function resetCardVideo(card: HTMLElement) {
  const video = card.querySelector('video');
  if (!video) {
    return;
  }
  video.pause();
  video.currentTime = 0;
}
