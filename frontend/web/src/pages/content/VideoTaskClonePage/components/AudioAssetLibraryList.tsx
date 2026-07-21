import { Check, ChevronLeft, Music2, Pause, Play, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAssetUrl } from '../../../../api/request';
import type { ContentAsset } from '../../../../types';

type AudioAssetLibraryListProps = {
  assets: ContentAsset[];
  disabled?: boolean;
  groupNameById: Record<string, string>;
  isLoading: boolean;
  onChoose: (asset: ContentAsset) => void | Promise<void>;
  selectedAssetId?: string;
};

type AudioAssetLibraryPanelProps = AudioAssetLibraryListProps & {
  onClose?: () => void;
};

export function AudioAssetLibraryPanel({ onClose, ...listProps }: AudioAssetLibraryPanelProps) {
  return (
    <>
      <header>
        <span className="video-task-library-heading">
          <i aria-hidden="true"><Music2 size={15} /></i>
          <strong>素材库 · 音频</strong>
        </span>
        {onClose ? (
          <button aria-label="收起音频素材库" className="video-task-popover-collapse" onClick={onClose} type="button">
            <ChevronLeft size={20} />
          </button>
        ) : null}
      </header>
      <p>点击「填入」选择一段口播声音</p>
      <div className="video-task-audio-scroll">
        <AudioAssetLibraryList {...listProps} />
      </div>
    </>
  );
}

export function AudioAssetLibraryList({
  assets,
  disabled = false,
  groupNameById,
  isLoading,
  onChoose,
  selectedAssetId,
}: AudioAssetLibraryListProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeAssetIdRef = useRef<string | null>(null);
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  const [progressByAssetId, setProgressByAssetId] = useState<Record<string, number>>({});
  const assetUrls = useMemo(
    () => new Map(assets.map((asset) => [asset.id, resolveAssetUrl(asset.fileUrl)])),
    [assets],
  );

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const updateProgress = () => {
      const assetId = activeAssetIdRef.current;
      if (!assetId) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
      setProgressByAssetId((current) => ({ ...current, [assetId]: progress }));
    };
    const stopPlaying = () => setPlayingAssetId(null);
    const finishPlaying = () => {
      const assetId = activeAssetIdRef.current;
      setPlayingAssetId(null);
      activeAssetIdRef.current = null;
      if (assetId) {
        setProgressByAssetId((current) => {
          const next = { ...current };
          delete next[assetId];
          return next;
        });
      }
    };

    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('pause', stopPlaying);
    audio.addEventListener('ended', finishPlaying);
    return () => {
      audio.removeEventListener('loadedmetadata', updateProgress);
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('pause', stopPlaying);
      audio.removeEventListener('ended', finishPlaying);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!playingAssetId || assetUrls.has(playingAssetId)) return;
    audioRef.current?.pause();
    activeAssetIdRef.current = null;
    setPlayingAssetId(null);
  }, [assetUrls, playingAssetId]);

  const togglePlayback = async (asset: ContentAsset) => {
    const audio = audioRef.current;
    const src = assetUrls.get(asset.id);
    if (!audio || !src) return;
    if (playingAssetId === asset.id && !audio.paused) {
      audio.pause();
      return;
    }
    audio.pause();
    if (audio.src !== src) {
      audio.src = src;
      audio.currentTime = 0;
    }
    activeAssetIdRef.current = asset.id;
    try {
      await audio.play();
      setPlayingAssetId(asset.id);
    } catch {
      setPlayingAssetId(null);
    }
  };

  if (isLoading) {
    return <div className="video-task-assets-empty">正在加载人声素材</div>;
  }
  if (!assets.length) {
    return <div className="video-task-assets-empty">暂无人声素材</div>;
  }

  return (
    <>
      <ul className="video-task-audio-list">
        {assets.map((asset) => {
          const name = groupNameById[asset.groupId] || asset.name || '人声素材';
          const isPlaying = playingAssetId === asset.id;
          const progress = progressByAssetId[asset.id] || 0;
          const selected = selectedAssetId === asset.id;
          return (
            <li className={`video-task-audio-card${isPlaying || progress > 0 ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`} key={asset.id}>
              <div className="video-task-audio-top">
                <button
                  aria-label={isPlaying ? `暂停播放${name}` : `播放${name}`}
                  className={`video-task-audio-main${isPlaying ? ' is-playing' : ''}`}
                  onClick={() => void togglePlayback(asset)}
                  type="button"
                >
                  <i aria-hidden="true">{isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</i>
                </button>
                <span className="video-task-audio-title" title={name}>{name}</span>
                <button
                  aria-label={selected ? `已选择${name}` : `填入${name}`}
                  className="video-task-audio-add"
                  disabled={disabled || selected}
                  onClick={() => void onChoose(asset)}
                  type="button"
                >
                  {selected ? <Check size={15} /> : <Plus size={15} />}
                </button>
              </div>
              {progress > 0 ? (
                <div className="video-task-audio-progress" aria-hidden="true">
                  <div className="video-task-audio-progress-bar">
                    <span style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <em>— 没有更多 —</em>
    </>
  );
}
