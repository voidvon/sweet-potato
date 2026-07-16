import { Play } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { getVideoWorkSourceLabel, type VideoWorkSource } from '../assets/worksAssetSource';
import './VideoAssetCover.scss';

type VideoAssetCoverProps = {
  fit?: 'cover' | 'contain';
  onLoadedMetadata?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  playIconSize?: number;
  poster?: string;
  source: VideoWorkSource | null;
  src: string;
};

export function VideoAssetCover({
  fit = 'cover',
  onLoadedMetadata,
  playIconSize = 30,
  poster,
  source,
  src,
}: VideoAssetCoverProps) {
  const sourceLabel = getVideoWorkSourceLabel(source);

  return (
    <>
      <video
        className={`video-asset-cover__media is-${fit}`}
        muted
        onLoadedMetadata={onLoadedMetadata}
        playsInline
        poster={poster || undefined}
        preload="metadata"
        src={src}
      />
      <span aria-hidden="true" className="video-asset-cover__play">
        <Play fill="currentColor" size={playIconSize} />
      </span>
      {sourceLabel ? (
        <span className={`video-asset-cover__type video-asset-cover__type--${source}`}>
          {sourceLabel}
        </span>
      ) : null}
    </>
  );
}
