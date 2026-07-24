import { Button, Popconfirm } from 'antd';
import { useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { Clapperboard, LoaderCircle, Trash2 } from 'lucide-react';
import { API_BASE_URL } from '../../../api/request';
import type { ContentAsset } from '../../../types';
import { VideoAssetCover } from '../shared/VideoAssetCover';
import { getVideoWorkSource } from './worksAssetSource';

type WorksAssetStatus = 'completed' | 'generating' | 'failed';

type WorksAssetCardProps = {
  asset: ContentAsset;
  onDelete: () => void;
  onOpen?: () => void;
};

type WorksAssetEmptyCardProps = {
  description: string;
  title: string;
};

function resolvedAssetUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${API_BASE_URL}${url}`;
}

function fileUrl(asset: ContentAsset) {
  return resolvedAssetUrl(asset.fileUrl);
}

function worksAssetStatus(asset: ContentAsset): WorksAssetStatus {
  if (asset.mimeType.startsWith('image/')) {
    return asset.fileUrl ? 'completed' : 'generating';
  }
  const status = typeof asset.metadata?.generationStatus === 'string' ? asset.metadata.generationStatus : '';
  if (status === 'generating' || status === 'queued' || !asset.fileUrl) {
    return 'generating';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'completed';
}

function numericDuration(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value !== 'string') {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(':')) {
    return 0;
  }
  const matched = trimmed.match(/[\d.]+/);
  if (!matched) {
    return 0;
  }
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function durationSecondsFromMetadata(asset: ContentAsset) {
  const durationMs = numericDuration(asset.metadata?.durationMs);
  if (durationMs > 0) {
    return durationMs / 1000;
  }
  return numericDuration(asset.metadata?.durationSeconds)
    || numericDuration(asset.metadata?.durationSecond)
    || numericDuration(asset.metadata?.duration);
}

function formatDurationLabel(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const restSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(restSeconds).padStart(2, '0')}`;
}

export function WorksAssetCard({ asset, onDelete, onOpen }: WorksAssetCardProps) {
  const status = worksAssetStatus(asset);
  const url = fileUrl(asset);
  const posterUrl = resolvedAssetUrl(asset.metadata?.coverUrl);
  const isCompleted = status === 'completed' && Boolean(url);
  const isVideo = asset.mimeType.startsWith('video/');
  const videoWorkSource = getVideoWorkSource(asset);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(() => durationSecondsFromMetadata(asset));
  const durationLabel = isVideo && videoDurationSeconds > 0 ? formatDurationLabel(videoDurationSeconds) : '';

  function handleVideoMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const nextDuration = event.currentTarget.duration;
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setVideoDurationSeconds(nextDuration);
    }
  }

  function handleMouseEnter() {
    const video = cardRef.current?.querySelector('video');
    if (!isCompleted || !isVideo || !video) {
      return;
    }
    video.muted = true;
    void video.play().catch(() => undefined);
  }

  function handleMouseLeave() {
    const video = cardRef.current?.querySelector('video');
    if (!isVideo || !video) {
      return;
    }
    video.pause();
    video.currentTime = 0;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isCompleted || !onOpen) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      aria-disabled={!isCompleted}
      aria-label={asset.name}
      className={`works-asset-card works-asset-card--${status}${isVideo ? ' video-asset-cover-host' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={isCompleted ? onOpen : undefined}
      onKeyDown={handleKeyDown}
      role="button"
      ref={cardRef}
      tabIndex={isCompleted ? 0 : -1}
    >
      {isCompleted ? (
        <>
          {asset.mimeType.startsWith('image/')
            ? <img alt={asset.name} src={url} />
            : (
              <VideoAssetCover
                fit="contain"
                onLoadedMetadata={handleVideoMetadata}
                poster={posterUrl}
                source={videoWorkSource}
                src={url}
              />
            )}
        </>
      ) : (
        <span aria-hidden="true" className="works-asset-card__placeholder">
          {status === 'failed' ? <Clapperboard size={28} /> : <LoaderCircle size={28} />}
        </span>
      )}
      {durationLabel && <span className="works-asset-card__duration">{durationLabel}</span>}
      <div className="works-asset-card__overlay">
        <span className="works-asset-card__delete" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <Popconfirm
            cancelText="取消"
            okText="删除"
            onConfirm={onDelete}
            title="确认删除这个作品吗？"
          >
            <Button
              aria-label={`删除 ${asset.name}`}
              className="works-asset-card__delete-button"
              icon={<Trash2 color="var(--color-white)" size={14} />}
              size="small"
              type="text"
            />
          </Popconfirm>
        </span>
      </div>
    </div>
  );
}

export function WorksAssetSkeletonCard() {
  return (
    <div aria-label="作品加载中" className="works-asset-card works-asset-card--skeleton">
      <span />
    </div>
  );
}

export function WorksAssetEmptyCard({ description, title }: WorksAssetEmptyCardProps) {
  return (
    <div className="works-asset-card works-asset-card--empty">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
