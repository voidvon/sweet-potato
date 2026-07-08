import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';

const MIN_SELECTION_SECONDS = 4;
const MAX_SELECTION_SECONDS = 15;
const DEFAULT_DURATION_SECONDS = 33.1;

export type TrimSelection = {
  duration: number;
  end: number;
  file: File;
  start: number;
};

type TrimReferenceVideoModalProps = {
  file: File;
  onCancel: () => void;
  onConfirm: (selection: TrimSelection) => Promise<void> | void;
};

export function TrimReferenceVideoModal({ file, onCancel, onConfirm }: TrimReferenceVideoModalProps) {
  const processingTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState(DEFAULT_DURATION_SECONDS);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(MAX_SELECTION_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoUrl = useObjectUrl(file);

  const safeDuration = Math.max(duration, MIN_SELECTION_SECONDS);
  const selectionLength = Math.max(end - start, 0);
  const selectionLeft = (start / safeDuration) * 100;
  const selectionRight = Math.max(0, 100 - (end / safeDuration) * 100);
  const isSelectionInvalid = selectionLength < MIN_SELECTION_SECONDS || selectionLength > MAX_SELECTION_SECONDS;

  const handleLoadedMetadata = () => {
    const nextDuration = videoRef.current?.duration;
    if (!Number.isFinite(nextDuration) || !nextDuration) return;

    const normalizedDuration = Math.max(nextDuration, MIN_SELECTION_SECONDS);
    const nextEnd = Math.min(MAX_SELECTION_SECONDS, normalizedDuration);
    setDuration(normalizedDuration);
    setStart(0);
    setEnd(nextEnd);
    if (videoRef.current) videoRef.current.currentTime = 0;
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.currentTime < start || video.currentTime >= end) {
      video.currentTime = start;
      if (!video.paused) {
        void video.play();
      }
    }
  };

  const handleStartChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    const maxStart = Math.max(0, end - MIN_SELECTION_SECONDS);
    const nextStart = clamp(value, 0, maxStart);
    const nextEnd = end - nextStart > MAX_SELECTION_SECONDS ? nextStart + MAX_SELECTION_SECONDS : end;
    setStart(nextStart);
    setEnd(Math.min(nextEnd, safeDuration));
    seekTo(nextStart);
  };

  const handleEndChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    const minEnd = Math.min(safeDuration, start + MIN_SELECTION_SECONDS);
    const nextEnd = clamp(value, minEnd, safeDuration);
    const nextStart = nextEnd - start > MAX_SELECTION_SECONDS ? nextEnd - MAX_SELECTION_SECONDS : start;
    setStart(Math.max(0, nextStart));
    setEnd(nextEnd);
    seekTo(Math.max(0, nextStart));
  };

  const seekTo = (time: number) => {
    if (videoRef.current) videoRef.current.currentTime = time;
  };

  const confirmTrim = async () => {
    if (isSelectionInvalid || isProcessing) return;
    setErrorMessage('');
    setIsProcessing(true);
    setProgress(25);
    let nextProgress = 25;
    processingTimerRef.current = window.setInterval(() => {
      nextProgress = Math.min(nextProgress + 12, 92);
      setProgress(nextProgress);
    }, 360);

    try {
      await onConfirm({ duration: safeDuration, end, file, start });
      setProgress(100);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '参考视频剪辑失败');
      setIsProcessing(false);
      setProgress(0);
    } finally {
      if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (processingTimerRef.current) window.clearInterval(processingTimerRef.current);
    };
  }, []);

  const timelineStyle = useMemo(
    () => ({
      '--trim-selection-left': `${selectionLeft}%`,
      '--trim-selection-right': `${selectionRight}%`,
    }) as CSSProperties,
    [selectionLeft, selectionRight],
  );

  const modal = (
    <div aria-label="剪辑参考视频" aria-modal="true" className="trim-modal" role="dialog">
      <div className="trim-modal__backdrop" />
      <div className="trim-modal__panel">
        <header className="trim-modal__header">
          <div>
            <p className="trim-modal__eyebrow">Trim reference video</p>
            <h3>剪辑参考视频</h3>
          </div>
          <button aria-label="关闭" className="trim-modal__close" onClick={onCancel} type="button">
            <X size={18} />
          </button>
        </header>

        <p className="trim-modal__hint">
          原视频 {formatTime(duration)}，请选择 {MIN_SELECTION_SECONDS}-{MAX_SELECTION_SECONDS} 秒区间。
        </p>

        <div className="trim-modal__video">
          <video
            ref={videoRef}
            autoPlay
            controls
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            draggable={false}
            loop
            muted
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            playsInline
            src={videoUrl}
          />
        </div>

        <div className="trim-modal__timeline" style={timelineStyle}>
          <div className="trim-modal__track">
            <div className="trim-modal__selection" />
            <input
              aria-label="剪辑起点"
              className="trim-modal__range trim-modal__range--start"
              max={safeDuration}
              min={0}
              onChange={handleStartChange}
              step={0.1}
              type="range"
              value={start}
            />
            <input
              aria-label="剪辑终点"
              className="trim-modal__range trim-modal__range--end"
              max={safeDuration}
              min={0}
              onChange={handleEndChange}
              step={0.1}
              type="range"
              value={end}
            />
          </div>
          <div className="trim-modal__codes">
            <span>起点 <strong>{formatTime(start)}</strong></span>
            <span>终点 <strong>{formatTime(end)}</strong></span>
            <span>选区 <strong className={isSelectionInvalid ? 'is-invalid' : ''}>{formatTime(selectionLength)}</strong></span>
          </div>
        </div>

        {isProcessing && (
          <>
            <div className="trim-modal__processing-note">视频正在剪辑处理中，请保持窗口打开。</div>
            <div className="trim-modal__processing">
              <strong>剪辑中 {progress}%</strong>
              <span>
                <i style={{ width: `${progress}%` }} />
              </span>
            </div>
          </>
        )}

        {errorMessage && <div className="trim-modal__error">{errorMessage}</div>}

        <footer className="trim-modal__footer">
          <button className="trim-modal__btn trim-modal__btn--ghost" onClick={onCancel} type="button">取消</button>
          <button className="trim-modal__btn trim-modal__btn--primary" disabled={isSelectionInvalid || isProcessing} onClick={confirmTrim} type="button">
            {isProcessing ? `剪辑中 ${progress}%` : '剪辑并使用'}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function useObjectUrl(file: File) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(value: number) {
  const normalized = Math.max(value, 0);
  const minutes = Math.floor(normalized / 60);
  const seconds = normalized - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}
