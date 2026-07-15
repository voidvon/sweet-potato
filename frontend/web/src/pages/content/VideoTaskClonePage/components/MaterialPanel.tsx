import { ChevronLeft, Image, Music2, Package, Pause, Play, Plus, Trash2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialSlot } from './MaterialSlot';
import { MaterialUploadPopover } from './MaterialUploadPopover';
import { WorkspaceSection } from './WorkspaceSection';
import { resolveAssetUrl } from '../../../../api/request';
import type { ContentAsset } from '../../../../types';
import type { LocalMaterialFile, MaterialKind, MaterialMode, SelectedMaterials, ToolOption, UploadAnchor, WorksTab } from '../types';
import { getVideoWorkSource, getVideoWorkSourceLabel } from '../../assets/worksAssetSource';

type MaterialPanelProps = {
  activeUpload: MaterialKind | null;
  isLoadingLibraryAssets: boolean;
  materialMode: MaterialMode;
  onClosePopovers: () => void;
  onLibraryAssetChoose: (kind: MaterialKind, asset: ContentAsset) => void;
  onMaterialClear: (kind: MaterialKind) => void;
  onMaterialRemoveOne: (kind: MaterialKind) => void;
  onMaterialsClearAll: () => void;
  onMaterialFill: (kind: MaterialKind, value: string) => void;
  onMaterialLocalFiles: (kind: MaterialKind, files: FileList | File[]) => void;
  onMaterialReplaceFiles: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  onModelPickerOpen: () => void;
  onTabChange: (mode: MaterialMode) => void;
  onUploadClose: () => void;
  onUploadOpen: (kind: MaterialKind, anchor: UploadAnchor) => void;
  onVoiceChange: (enabled: boolean) => void;
  onWorksTabChange: (tab: WorksTab) => void;
  selectedMaterials: SelectedMaterials;
  showVoiceToggle: boolean;
  tool: ToolOption;
  uploadAnchor: UploadAnchor | null;
  voiceEnabled: boolean;
  voiceAssets: ContentAsset[];
  voiceGroupNameById: Record<string, string>;
  worksAssets: ContentAsset[];
  worksTab: WorksTab;
};

export type ReferenceMaterialPreviewAsset = Pick<
  ContentAsset,
  'id' | 'name' | 'originalFileName' | 'mimeType' | 'fileUrl' | 'metadata'
>;

type ReferenceMaterialPreviewListProps = {
  assets: ReferenceMaterialPreviewAsset[];
  isLoading?: boolean;
  onVideoPreview: (asset: ReferenceMaterialPreviewAsset) => void;
};

export function ReferenceMaterialPreviewList({
  assets,
  isLoading = false,
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
        const content = isVideo ? (
          <>
            <video muted playsInline preload="metadata" src={resolveAssetUrl(asset.fileUrl)} />
            <i className="result-reference-materials__play" aria-hidden="true">
              <Play size={15} fill="currentColor" />
            </i>
          </>
        ) : isImage ? (
          <img alt={name} src={resolveAssetUrl(asset.fileUrl)} />
        ) : (
          <i className="result-reference-materials__audio" aria-hidden="true">
            <Music2 size={22} />
          </i>
        );

        return isVideo ? (
          <button
            aria-label={`预览${name}`}
            className="result-reference-materials__item"
            key={asset.id}
            onClick={() => onVideoPreview(asset)}
            title={name}
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
  uploadAnchor,
  voiceEnabled,
  voiceAssets,
  voiceGroupNameById,
  worksAssets,
  worksTab,
}: MaterialPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioAssetIdRef = useRef<string | null>(null);
  const hasOpenPopover = Boolean(materialMode || activeUpload);
  const isVideoTranslation = tool.key === 'video-translation';
  const audioMaterial = tool.materials.find((item) => item.key === 'audio');
  const imageMaterial = tool.materials.find((item) => item.key === 'image');
  const videoMaterial = tool.materials.find((item) => item.key === 'video');
  const hasSelectedAudio = Boolean(selectedMaterials.audio);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const [activeAudioAssetId, setActiveAudioAssetId] = useState<string | null>(null);
  const [audioProgressByAssetId, setAudioProgressByAssetId] = useState<Record<string, number>>({});
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
  const voiceAssetUrls = useMemo(() => new Map(voiceAssets.map((asset) => [asset.id, resolveAssetUrl(asset.fileUrl)])), [voiceAssets]);

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

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      const assetId = currentAudioAssetIdRef.current;
      if (!assetId) {
        return;
      }
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const nextProgress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
      setAudioProgressByAssetId((current) => (
        current[assetId] === nextProgress ? current : { ...current, [assetId]: nextProgress }
      ));
    };
    const handleLoadedMetadata = handleTimeUpdate;
    const handlePause = () => setPlayingAssetId(null);
    const handleEnded = () => {
      const assetId = currentAudioAssetIdRef.current;
      setPlayingAssetId(null);
      setActiveAudioAssetId(null);
      currentAudioAssetIdRef.current = null;
      if (assetId) {
        setAudioProgressByAssetId((current) => {
          if (!(assetId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[assetId];
          return next;
        });
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!playingAssetId) {
      return;
    }
    if (!voiceAssetUrls.has(playingAssetId)) {
      audioRef.current?.pause();
      setPlayingAssetId(null);
      setActiveAudioAssetId(null);
      currentAudioAssetIdRef.current = null;
    }
  }, [playingAssetId, voiceAssetUrls]);

  const toggleAudioPlayback = async (asset: ContentAsset) => {
    const src = voiceAssetUrls.get(asset.id);
    if (!src) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playingAssetId === asset.id && !audio.paused) {
      audio.pause();
      return;
    }

    const previousAssetId = currentAudioAssetIdRef.current;
    const isSwitchingAsset = previousAssetId !== null && previousAssetId !== asset.id;
    if (isSwitchingAsset && previousAssetId) {
      setAudioProgressByAssetId((current) => {
        if (!(previousAssetId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[previousAssetId];
        return next;
      });
    }

    if (audio.src !== src) {
      audio.src = src;
      audio.currentTime = 0;
    } else if (previousAssetId !== asset.id) {
      audio.currentTime = 0;
    }

    currentAudioAssetIdRef.current = asset.id;
    setActiveAudioAssetId(asset.id);

    try {
      await audio.play();
      setPlayingAssetId(asset.id);
    } catch {
      setPlayingAssetId(null);
    }
  };

  return (
    <WorkspaceSection
      className="video-task-material-card"
      description={tool.materialHint}
      headerExtra={(
        <div className="video-task-tabs" aria-label="素材类型">
          {Object.keys(selectedMaterials).length > 0 && (
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
          {audioMaterial && (
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
          <button
            aria-expanded={false}
            onClick={onModelPickerOpen}
            type="button"
          >
            {isVideoTranslation ? <UserRound size={12} /> : <Package size={12} />}
            {isVideoTranslation ? '模特' : '素材'}
          </button>
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
    >

      <div className="video-task-material-grid">
        {tool.materials.filter((item) => !isVideoTranslation || item.key === 'video').map((item) => {
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
          <header>
            <span className="video-task-library-heading">
              <i aria-hidden="true"><Music2 size={15} /></i>
              <strong>素材库 · 音频</strong>
            </span>
            <button aria-label="收起音频素材库" className="video-task-popover-collapse" onClick={onClosePopovers} type="button">
              <ChevronLeft size={20} />
            </button>
          </header>
          <p>点击「填入」到左侧参考音频槽位 ↙</p>
          <div className="video-task-audio-scroll">
            {isLoadingLibraryAssets && <div className="video-task-assets-empty">正在加载人声素材</div>}
            {!isLoadingLibraryAssets && voiceAssets.length === 0 && (
              <div className="video-task-assets-empty">暂无人声素材</div>
            )}
            {!isLoadingLibraryAssets && voiceAssets.length > 0 && (
              <>
                <ul className="video-task-audio-list">
                  {voiceAssets.map((asset) => {
                    const name = getVoiceAssetName(asset, voiceGroupNameById);
                    const isPlaying = playingAssetId === asset.id;
                    const hasActiveProgress = activeAudioAssetId === asset.id && (audioProgressByAssetId[asset.id] ?? 0) > 0;
                    const progressPercent = Math.min(100, Math.max(0, (audioProgressByAssetId[asset.id] ?? 0) * 100));
                    return (
                      <li
                        className={`video-task-audio-card${isPlaying || hasActiveProgress ? ' is-active' : ''}${audioMaterial ? '' : ' is-disabled'}`}
                        key={asset.id}
                        onClick={() => audioMaterial && onLibraryAssetChoose(audioMaterial, asset)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          if (audioMaterial) {
                            onLibraryAssetChoose(audioMaterial, asset);
                          }
                        }}
                        role={audioMaterial ? 'button' : undefined}
                        tabIndex={audioMaterial ? 0 : -1}
                      >
                        <div className="video-task-audio-top">
                          <button
                            aria-label={isPlaying ? `暂停播放${name}` : `播放${name}`}
                            className={`video-task-audio-main${isPlaying ? ' is-playing' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleAudioPlayback(asset);
                            }}
                            type="button"
                          >
                            <i aria-hidden="true">{isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</i>
                          </button>
                          <span className="video-task-audio-title" title={name}>{name}</span>
                          <button
                            aria-label={`填入${name}`}
                            className="video-task-audio-add"
                            disabled={!audioMaterial}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (audioMaterial) {
                                onLibraryAssetChoose(audioMaterial, asset);
                              }
                            }}
                            type="button"
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                        {hasActiveProgress ? (
                          <div className="video-task-audio-progress" aria-hidden="true">
                            <div className="video-task-audio-progress-bar">
                              <span style={{ width: `${progressPercent}%` }} />
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <em>— 没有更多 —</em>
              </>
            )}
          </div>
        </aside>
      )}

      {materialMode === 'works' && (
        <aside className="video-task-library-popover is-works" ref={popoverRef}>
          <header>
            <span className="video-task-library-heading">
              <i aria-hidden="true"><Image size={15} /></i>
              <strong>我的作品</strong>
            </span>
            <button aria-label="收起作品素材库" className="video-task-popover-collapse" onClick={onClosePopovers} type="button">
              <ChevronLeft size={20} />
            </button>
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

function getVoiceAssetName(asset: ContentAsset, voiceGroupNameById: Record<string, string>) {
  return voiceGroupNameById[asset.groupId] || asset.name || '人声素材';
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
