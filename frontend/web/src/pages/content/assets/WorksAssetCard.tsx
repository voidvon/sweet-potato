import { Button, Popconfirm } from 'antd';
import { useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { Clapperboard, LoaderCircle, Play, Trash2 } from 'lucide-react';
import { API_BASE_URL } from '../../../api/request';
import type { ContentAsset } from '../../../types';
import { formatRelativeCalendarDateTime } from '../../../utils/dateTime';

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

function fileUrl(asset: ContentAsset) {
  if (!asset.fileUrl) {
    return '';
  }
  if (/^https?:\/\//i.test(asset.fileUrl)) {
    return asset.fileUrl;
  }
  return `${API_BASE_URL}${asset.fileUrl}`;
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
  const timeText = formatRelativeCalendarDateTime(asset.updatedAt);
  const url = fileUrl(asset);
  const isCompleted = status === 'completed' && Boolean(url);
  const isVideo = asset.mimeType.startsWith('video/');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(() => durationSecondsFromMetadata(asset));
  const durationLabel = isVideo && videoDurationSeconds > 0 ? formatDurationLabel(videoDurationSeconds) : '';

  function handleVideoMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const nextDuration = event.currentTarget.duration;
    if (Number.isFinite(nextDuration) && nextDuration > 0) {
      setVideoDurationSeconds(nextDuration);
    }
  }

  function handleMouseEnter() {
    if (!isCompleted || !isVideo || !videoRef.current) {
      return;
    }
    videoRef.current.muted = true;
    void videoRef.current.play().catch(() => undefined);
  }

  function handleMouseLeave() {
    if (!isVideo || !videoRef.current) {
      return;
    }
    videoRef.current.pause();
    videoRef.current.currentTime = 0;
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
      className={`works-asset-card works-asset-card--${status}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={isCompleted ? onOpen : undefined}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={isCompleted ? 0 : -1}
    >
      {isCompleted ? (
        <>
          {asset.mimeType.startsWith('image/')
            ? <img alt={asset.name} src={url} />
            : <video muted onLoadedMetadata={handleVideoMetadata} playsInline preload="metadata" ref={videoRef} src={url} />}
        </>
      ) : (
        <span aria-hidden="true" className="works-asset-card__placeholder">
          {status === 'failed' ? <Clapperboard size={28} /> : <LoaderCircle size={28} />}
        </span>
      )}
      {isCompleted && isVideo && (
        <span aria-hidden="true" className="works-asset-card__play">
          <Play fill="currentColor" size={30} />
        </span>
      )}
      {durationLabel && <span className="works-asset-card__duration">{durationLabel}</span>}
      <div className="works-asset-card__overlay">
        <span className="works-asset-card__time">{timeText}</span>
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
              icon={<Trash2 color="#ffffff" size={14} />}
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
