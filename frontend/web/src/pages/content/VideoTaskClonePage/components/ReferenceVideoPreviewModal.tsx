import { Modal } from 'antd';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { ConfirmedReferenceVideo } from './ReferenceVideoCard';
import './ReferenceVideoPreviewModal.scss';

type ReferenceVideoPreviewModalProps = {
  onClose: () => void;
  video: ConfirmedReferenceVideo;
};

export function ReferenceVideoPreviewModal({ onClose, video }: ReferenceVideoPreviewModalProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [open, setOpen] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.72);
  const [duration, setDuration] = useState(video.duration || Math.max(0, video.end - video.start) || 15);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const playableDuration = useMemo(() => Math.max(0.1, duration), [duration]);
  const progressValue = Math.min(1000, Math.max(0, Math.round((currentTime / playableDuration) * 1000)));

  const syncMetadata = () => {
    const element = videoRef.current;
    if (!element) return;
    const nextDuration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
    setDuration(nextDuration);
    element.volume = volume;
    element.currentTime = 0;
    void element.play();
  };

  const syncTime = () => {
    const element = videoRef.current;
    if (!element) return;
    const nextTime = Math.min(element.currentTime, playableDuration);
    setCurrentTime(nextTime);
    setIsPlaying(!element.paused);
    if (element.currentTime >= playableDuration) {
      element.currentTime = 0;
      if (!element.paused) void element.play();
    }
  };

  const togglePlay = () => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play();
      setIsPlaying(true);
      return;
    }
    element.pause();
    setIsPlaying(false);
  };

  const seekToProgress = (value: number) => {
    const element = videoRef.current;
    if (!element) return;
    const nextTime = (value / 1000) * playableDuration;
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

  return (
    <Modal
      centered
      className="vc-create__preview-modal"
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      footer={null}
      mask={{ closable: true }}
      onCancel={() => setOpen(false)}
      open={open}
      title={null}
      width={1500}
      zIndex={13000}
    >
      <div className="vc-create__preview-shell">
        <div className="vc-create__preview-video-frame">
          <div ref={frameRef} className="video-task-asset-player">
            <video
              ref={videoRef}
              src={video.videoUrl}
              aria-label={video.name}
              autoPlay
              playsInline
              preload="auto"
              className="video-task-asset-player__video"
              draggable={false}
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noremoteplayback"
              muted={isMuted}
              onLoadedMetadata={syncMetadata}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onTimeUpdate={syncTime}
            />
            <button
              type="button"
              className="video-task-asset-player__mute-pill"
              aria-label={isMuted ? '解除静音' : '静音'}
              onClick={() => setIsMuted((current) => !current)}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              {isMuted ? '解除静音' : '静音'}
            </button>
            <div className="video-task-asset-player__controls">
              <div className="video-task-asset-player__controls-inner">
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  className="asset-video-player-range asset-video-player-progress"
                  aria-label="播放进度"
                  value={progressValue}
                  onChange={(event) => seekToProgress(Number(event.target.value))}
                />
                <div className="video-task-asset-player__toolbar">
                  <button type="button" className="video-task-asset-player__icon-btn" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlay}>
                    {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  </button>
                  <div className="video-task-asset-player__time">
                    {formatPreviewTime(currentTime)} / {formatPreviewTime(playableDuration)}
                  </div>
                  <div className="video-task-asset-player__right-tools">
                    <button
                      type="button"
                      className="video-task-asset-player__icon-btn"
                      aria-label={isMuted ? '取消静音' : '静音'}
                      onClick={() => setIsMuted((current) => !current)}
                    >
                      {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      className="asset-video-player-range video-task-asset-player__volume"
                      aria-label={`音量 ${Math.round(volume * 100)}%`}
                      value={volume}
                      onChange={(event) => changeVolume(Number(event.target.value))}
                    />
                    <button type="button" className="video-task-asset-player__icon-btn" aria-label="全屏" onClick={toggleFullscreen}>
                      <svg className="video-task-asset-player__fullscreen-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 3H3v5m13-5h5v5M8 21H3v-5m18 0v5h-5" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function formatPreviewTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
