import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type VideoPreviewPlayerProps = {
  autoPlay?: boolean;
  duration?: number;
  initiallyMuted?: boolean;
  loopAtEnd?: boolean;
  name: string;
  onDurationChange?: (duration: number) => void;
  paused?: boolean;
  posterUrl?: string;
  playbackEnd?: number;
  playbackStart?: number;
  variant: 'reference' | 'result';
  videoUrl: string;
};

type PlayerSize = {
  height: number;
  width: number;
};

export function VideoPreviewPlayer({
  autoPlay = true,
  duration: initialDuration = 0,
  initiallyMuted = true,
  loopAtEnd = false,
  name,
  onDurationChange,
  paused = false,
  posterUrl,
  playbackEnd,
  playbackStart = 0,
  variant,
  videoUrl,
}: VideoPreviewPlayerProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isMuted, setIsMuted] = useState(initiallyMuted);
  const [volume, setVolume] = useState(0.72);
  const [duration, setDuration] = useState(initialDuration);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [videoSize, setVideoSize] = useState<PlayerSize>({ height: 9, width: 16 });
  const [availableSize, setAvailableSize] = useState<PlayerSize>({ height: 0, width: 0 });
  const isResult = variant === 'result';
  const playableDuration = useMemo(
    () => isResult ? Math.max(0, duration) : Math.max(0.1, duration),
    [duration, isResult],
  );
  const resultPlayerStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isResult) return undefined;
    const aspectRatio = videoSize.width / videoSize.height;
    if (availableSize.width <= 0 || availableSize.height <= 0 || !Number.isFinite(aspectRatio)) {
      return { aspectRatio: `${videoSize.width} / ${videoSize.height}` };
    }
    const maxWidth = Math.min(1080, availableSize.width);
    const maxHeight = aspectRatio < 1
      ? availableSize.height
      : Math.min(720, availableSize.height);
    const widthAtMaxHeight = maxHeight * aspectRatio;
    const width = Math.min(maxWidth, widthAtMaxHeight);
    const height = width / aspectRatio;
    return {
      aspectRatio: `${videoSize.width} / ${videoSize.height}`,
      height: `${height}px`,
      width: `${width}px`,
    };
  }, [availableSize, isResult, videoSize]);
  const progressValue = playableDuration > 0
    ? Math.min(1000, Math.max(0, Math.round((currentTime / playableDuration) * 1000)))
    : 0;
  const rangeStart = Math.min(Math.max(0, playbackStart), playableDuration);
  const rangeEnd = playbackEnd === undefined
    ? playableDuration
    : Math.min(playableDuration, Math.max(rangeStart, playbackEnd));

  useEffect(() => {
    if (!isResult) return undefined;
    const stage = frameRef.current?.parentElement;
    if (!stage) return undefined;
    const updateAvailableSize = () => {
      const styles = window.getComputedStyle(stage);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
      const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      setAvailableSize({
        height: Math.max(0, stage.clientHeight - verticalPadding),
        width: Math.max(0, stage.clientWidth - horizontalPadding),
      });
    };
    updateAvailableSize();
    const observer = new ResizeObserver(updateAvailableSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [isResult]);

  useEffect(() => {
    if (paused) videoRef.current?.pause();
  }, [paused]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || playbackEnd === undefined) return;
    element.currentTime = rangeStart;
    setCurrentTime(rangeStart);
  }, [playbackEnd, rangeStart]);

  const syncMetadata = () => {
    const element = videoRef.current;
    if (!element) return;
    if (Number.isFinite(element.duration) && element.duration > 0) {
      setDuration(element.duration);
      onDurationChange?.(element.duration);
    }
    if (element.videoWidth > 0 && element.videoHeight > 0) {
      setVideoSize({ height: element.videoHeight, width: element.videoWidth });
    }
    element.volume = volume;
    element.currentTime = rangeStart;
    if (autoPlay) {
      void element.play().catch(() => setIsPlaying(false));
    } else {
      element.pause();
      setIsPlaying(false);
    }
  };

  const syncTime = () => {
    const element = videoRef.current;
    if (!element) return;
    const nextTime = Math.min(element.currentTime, playableDuration);
    setCurrentTime(nextTime);
    setIsPlaying(!element.paused);
    if (loopAtEnd && !element.paused && (element.currentTime < rangeStart || element.currentTime >= rangeEnd)) {
      element.currentTime = rangeStart;
      setCurrentTime(rangeStart);
      if (!element.paused) void element.play();
    }
  };

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play().catch(() => setIsPlaying(false));
      return;
    }
    element.pause();
  };

  const seekToProgress = (value: number) => {
    const element = videoRef.current;
    if (!element || playableDuration <= 0) return;
    const requestedTime = (value / 1000) * playableDuration;
    const nextTime = playbackEnd === undefined
      ? requestedTime
      : Math.min(rangeEnd, Math.max(rangeStart, requestedTime));
    element.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const changeVolume = (value: number) => {
    const nextVolume = Math.min(1, Math.max(0, value));
    setVolume(nextVolume);
    if (videoRef.current) videoRef.current.volume = nextVolume;
    if (nextVolume > 0) setIsMuted(false);
  };

  const toggleFullscreen = () => {
    const target = frameRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void target.requestFullscreen();
  };

  const rootClassName = isResult ? 'result-video-preview-player' : 'video-task-asset-player';
  const videoClassName = isResult ? 'result-video-preview-player__video' : 'video-task-asset-player__video';
  const controlsClassName = isResult ? 'result-video-preview-player__controls' : 'video-task-asset-player__controls';
  const toolbarClassName = isResult ? 'result-video-preview-player__toolbar' : 'video-task-asset-player__toolbar';
  const rangeClassName = isResult ? 'result-video-preview-player__range' : 'asset-video-player-range';
  const progressClassName = isResult ? 'result-video-preview-player__progress' : 'asset-video-player-progress';
  const timeClassName = isResult ? 'result-video-preview-player__time' : 'video-task-asset-player__time';
  const toolsClassName = isResult ? 'result-video-preview-player__tools' : 'video-task-asset-player__right-tools';
  const buttonClassName = isResult ? undefined : 'video-task-asset-player__icon-btn';
  const volumeClassName = isResult ? 'result-video-preview-player__volume' : 'video-task-asset-player__volume';
  const iconSize = isResult ? 19 : 14;

  return (
    <div ref={frameRef} className={rootClassName} style={resultPlayerStyle}>
      <video
        ref={videoRef}
        aria-label={name}
        autoPlay={autoPlay}
        className={videoClassName}
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        draggable={false}
        muted={isMuted}
        onClick={togglePlay}
        onEnded={() => setIsPlaying(false)}
        onLoadedMetadata={syncMetadata}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={syncTime}
        playsInline
        poster={posterUrl}
        preload="auto"
        src={videoUrl}
      />

      <button
        aria-label={isMuted ? '解除静音' : '静音'}
        className={isResult ? 'result-video-preview-player__mute-pill' : 'video-task-asset-player__mute-pill'}
        onClick={() => setIsMuted((current) => !current)}
        type="button"
      >
        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        {isMuted ? '解除静音' : '静音'}
      </button>

      <div className={controlsClassName}>
        <div className={isResult ? undefined : 'video-task-asset-player__controls-inner'}>
          <input
            aria-label="播放进度"
            className={`${rangeClassName} ${progressClassName}`}
            max="1000"
            min="0"
            onChange={(event) => seekToProgress(Number(event.target.value))}
            step="1"
            type="range"
            value={progressValue}
          />
          <div className={toolbarClassName}>
            <button aria-label={isPlaying ? '暂停' : '播放'} className={buttonClassName} onClick={togglePlay} type="button">
              {isPlaying
                ? <Pause size={iconSize} fill="currentColor" />
                : <Play size={iconSize} fill="currentColor" />}
            </button>
            <span className={timeClassName}>
              {formatPreviewTime(currentTime)} / {formatPreviewTime(playableDuration)}
            </span>
            <div className={toolsClassName}>
              <button
                aria-label={isMuted ? '取消静音' : '静音'}
                className={buttonClassName}
                onClick={() => setIsMuted((current) => !current)}
                type="button"
              >
                {isMuted ? <VolumeX size={iconSize} /> : <Volume2 size={iconSize} />}
              </button>
              <input
                aria-label={`音量 ${Math.round(volume * 100)}%`}
                className={`${rangeClassName} ${volumeClassName}`}
                max="1"
                min="0"
                onChange={(event) => changeVolume(Number(event.target.value))}
                step="0.01"
                type="range"
                value={volume}
              />
              <button aria-label={isResult ? '浏览器全屏' : '全屏'} className={buttonClassName} onClick={toggleFullscreen} type="button">
                {isResult ? (
                  <Maximize2 size={iconSize} />
                ) : (
                  <svg className="video-task-asset-player__fullscreen-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 3H3v5m13-5h5v5M8 21H3v-5m18 0v5h-5" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatPreviewTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
