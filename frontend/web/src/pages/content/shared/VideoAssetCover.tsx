import { Play } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
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
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRequestIdRef = useRef<number | null>(null);

  function cancelFrameRequest() {
    if (frameRequestIdRef.current !== null && videoRef.current?.cancelVideoFrameCallback) {
      videoRef.current.cancelVideoFrameCallback(frameRequestIdRef.current);
    }
    frameRequestIdRef.current = null;
  }

  function handlePlaying(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    cancelFrameRequest();
    if (!video.requestVideoFrameCallback) return;
    frameRequestIdRef.current = video.requestVideoFrameCallback(() => {
      frameRequestIdRef.current = null;
      if (!video.paused) setHasRenderedFrame(true);
    });
  }

  function handlePause() {
    cancelFrameRequest();
    setHasRenderedFrame(false);
  }

  useEffect(() => () => cancelFrameRequest(), []);

  return (
    <>
      <video
        className={`video-asset-cover__media is-${fit}`}
        muted
        onLoadedMetadata={onLoadedMetadata}
        onPause={handlePause}
        onPlaying={handlePlaying}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime > 0) setHasRenderedFrame(true);
        }}
        playsInline
        poster={poster || undefined}
        preload="metadata"
        ref={videoRef}
        src={src}
      />
      {poster ? (
        <img
          aria-hidden="true"
          alt=""
          className={`video-asset-cover__poster is-${fit}${hasRenderedFrame ? ' is-hidden' : ''}`}
          src={poster}
        />
      ) : null}
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
