import { Slider } from 'antd';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { VideoPreviewPlayer } from './VideoPreviewPlayer';

const MIN_SELECTION_SECONDS = 4;
const MAX_SELECTION_SECONDS = 15;
const DEFAULT_DURATION_SECONDS = 33.1;
const sliderBehaviorProps = { allowCross: false };

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
  const activeRangeHandleRef = useRef<'end' | 'start' | null>(null);
  const lastRangeHandleValueRef = useRef<number | null>(null);
  const processingTimerRef = useRef<number | null>(null);
  const [duration, setDuration] = useState(DEFAULT_DURATION_SECONDS);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(MAX_SELECTION_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const rangeValueRef = useRef({ end: MAX_SELECTION_SECONDS, start: 0 });
  const videoUrl = useObjectUrl(file);

  const safeDuration = Math.max(duration, MIN_SELECTION_SECONDS);
  const selectionLength = Math.max(end - start, 0);
  const isSelectionInvalid = selectionLength < MIN_SELECTION_SECONDS || selectionLength > MAX_SELECTION_SECONDS;

  const updateRange = (nextStart: number, nextEnd: number) => {
    rangeValueRef.current = { end: nextEnd, start: nextStart };
    setStart(nextStart);
    setEnd(nextEnd);
  };

  const handleDurationChange = (nextDuration: number) => {
    const normalizedDuration = Math.max(nextDuration, MIN_SELECTION_SECONDS);
    const nextEnd = Math.min(MAX_SELECTION_SECONDS, normalizedDuration);
    setDuration(normalizedDuration);
    updateRange(0, nextEnd);
  };

  const handleRangeChange = (value: number[]) => {
    const currentRange = rangeValueRef.current;
    const activeHandle = activeRangeHandleRef.current;
    const lastHandleValue = lastRangeHandleValueRef.current;
    if (activeHandle && lastHandleValue !== null) {
      const rawHandleValue = activeHandle === 'start'
        ? value[0] ?? lastHandleValue
        : value[1] ?? lastHandleValue;
      const delta = rawHandleValue - lastHandleValue;
      lastRangeHandleValueRef.current = rawHandleValue;

      if (activeHandle === 'start') {
        const nextStart = clamp(currentRange.start + delta, 0, currentRange.end - MIN_SELECTION_SECONDS);
        const nextEnd = currentRange.end - nextStart > MAX_SELECTION_SECONDS
          ? nextStart + MAX_SELECTION_SECONDS
          : currentRange.end;
        updateRange(nextStart, nextEnd);
      } else {
        const nextEnd = clamp(currentRange.end + delta, currentRange.start + MIN_SELECTION_SECONDS, safeDuration);
        const nextStart = nextEnd - currentRange.start > MAX_SELECTION_SECONDS
          ? nextEnd - MAX_SELECTION_SECONDS
          : currentRange.start;
        updateRange(nextStart, nextEnd);
      }
      return;
    }

    let nextStart = clamp(value[0] ?? currentRange.start, 0, safeDuration);
    let nextEnd = clamp(value[1] ?? currentRange.end, 0, safeDuration);
    const startMoved = Math.abs(nextStart - currentRange.start) >= Math.abs(nextEnd - currentRange.end);
    const nextLength = nextEnd - nextStart;

    if (nextLength > MAX_SELECTION_SECONDS) {
      if (startMoved) nextEnd = nextStart + MAX_SELECTION_SECONDS;
      else nextStart = nextEnd - MAX_SELECTION_SECONDS;
    } else if (nextLength < MIN_SELECTION_SECONDS) {
      if (startMoved) nextStart = Math.max(0, nextEnd - MIN_SELECTION_SECONDS);
      else nextEnd = Math.min(safeDuration, nextStart + MIN_SELECTION_SECONDS);
    }

    updateRange(nextStart, nextEnd);
  };

  const captureActiveRangeHandle = (event: FocusEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const label = event.target.closest('[role="slider"]')?.getAttribute('aria-label');
    if (label === '剪辑起点') {
      activeRangeHandleRef.current = 'start';
      lastRangeHandleValueRef.current = rangeValueRef.current.start;
    } else if (label === '剪辑终点') {
      activeRangeHandleRef.current = 'end';
      lastRangeHandleValueRef.current = rangeValueRef.current.end;
    } else {
      activeRangeHandleRef.current = null;
      lastRangeHandleValueRef.current = null;
    }
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
          <VideoPreviewPlayer
            duration={duration}
            loopAtEnd
            name={file.name || '参考视频'}
            onDurationChange={handleDurationChange}
            playbackEnd={end}
            playbackStart={start}
            variant="reference"
            videoUrl={videoUrl}
          />
        </div>

        <div className="trim-modal__timeline">
          <div
            className="trim-modal__track"
            onFocusCapture={captureActiveRangeHandle}
            onPointerDownCapture={captureActiveRangeHandle}
          >
            <Slider
              {...sliderBehaviorProps}
              ariaLabelForHandle={['剪辑起点', '剪辑终点']}
              max={safeDuration}
              min={0}
              onChange={handleRangeChange}
              onChangeComplete={() => {
                activeRangeHandleRef.current = null;
                lastRangeHandleValueRef.current = null;
              }}
              range
              step={0.1}
              tooltip={{ formatter: (value) => formatTime(value ?? 0) }}
              value={[start, end]}
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
