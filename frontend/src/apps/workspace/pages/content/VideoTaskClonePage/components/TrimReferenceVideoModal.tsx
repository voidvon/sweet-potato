import { Alert, Descriptions, Flex, Modal, Progress, Slider, Typography } from 'antd';
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { VideoPreviewPlayer } from './VideoPreviewPlayer';
import { MAX_REFERENCE_VIDEO_DURATION_SECONDS } from '../videoMetadata';
import './ReferenceVideoPreviewModal.scss';
import { t } from '@shared/i18n';

const MIN_SELECTION_SECONDS = 4;
const MAX_SELECTION_SECONDS = MAX_REFERENCE_VIDEO_DURATION_SECONDS;
const DEFAULT_DURATION_SECONDS = 33.1;
const sliderBehaviorProps = { allowCross: false };

type TrimRange = {
  duration: number;
  end: number;
  start: number;
};

export type TrimSelection = TrimRange & {
  file: File;
};

export type RemoteTrimSelection = TrimRange;

type LocalTrimProps = {
  file: File;
  onCancel: () => void;
  onConfirm: (selection: TrimSelection) => Promise<void> | void;
  duration?: number;
  name?: string;
  videoUrl?: never;
};

type RemoteTrimProps = {
  duration: number;
  file?: never;
  name: string;
  onCancel: () => void;
  onConfirm: (selection: RemoteTrimSelection) => Promise<void> | void;
  videoUrl: string;
};

type TrimReferenceVideoModalProps = LocalTrimProps | RemoteTrimProps;

export function TrimReferenceVideoModal(props: TrimReferenceVideoModalProps) {
  const isRemote = !props.file;
  const activeRangeHandleRef = useRef<'end' | 'start' | null>(null);
  const lastRangeHandleValueRef = useRef<number | null>(null);
  const processingTimerRef = useRef<number | null>(null);
  const [duration, setDuration] = useState(props.duration ?? DEFAULT_DURATION_SECONDS);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(MAX_SELECTION_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [open, setOpen] = useState(true);
  const [progress, setProgress] = useState(0);
  const rangeValueRef = useRef({ end: MAX_SELECTION_SECONDS, start: 0 });
  const videoUrl = useVideoUrl(props.file, props.videoUrl);

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
      if (props.file) {
        await props.onConfirm({ duration: safeDuration, end, file: props.file, start });
      } else {
        await props.onConfirm({ duration: safeDuration, end, start });
      }
      setProgress(100);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("参考视频剪辑失败"));
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

  return (
    <Modal
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) props.onCancel();
      }}
      cancelButtonProps={{ disabled: isProcessing }}
      cancelText={t("取消")}
      centered
      closable={!isProcessing}
      confirmLoading={isProcessing}
      keyboard={!isProcessing}
      mask={{ closable: !isProcessing }}
      okButtonProps={{ disabled: isSelectionInvalid }}
      okText={isProcessing ? t("{{0}} {{1}}%", { "0": isRemote ? t("保存中") : t("剪辑中"), "1": progress }) : isRemote ? t("使用此片段") : t("剪辑并使用")}
      onCancel={() => setOpen(false)}
      onOk={() => void confirmTrim()}
      open={open}
      title={t("剪辑参考视频")}
      width={780}
      zIndex={12000}
    >
      <Flex gap="middle" vertical>
        <Typography.Text type="secondary">
          {t("原视频")} {formatTime(duration)}{t("，请选择")} {MIN_SELECTION_SECONDS}-{MAX_SELECTION_SECONDS} {t("秒区间。")}
        </Typography.Text>

        <div style={{ height: 420, overflow: 'hidden' }}>
          <VideoPreviewPlayer
            duration={duration}
            loopAtEnd
            name={props.name || props.file?.name || t("参考视频")}
            onDurationChange={handleDurationChange}
            playbackEnd={end}
            playbackStart={start}
            variant="reference"
            videoUrl={videoUrl}
          />
        </div>

        <div
          onFocusCapture={captureActiveRangeHandle}
          onPointerDownCapture={captureActiveRangeHandle}
        >
          <Slider
            {...sliderBehaviorProps}
            ariaLabelForHandle={[t("剪辑起点"), t("剪辑终点")]}
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

        <Descriptions
          column={3}
          items={[
            { children: formatTime(start), key: 'start', label: t("起点") },
            { children: formatTime(end), key: 'end', label: t("终点") },
            { children: formatTime(selectionLength), key: 'selection', label: t("选区") },
          ]}
          size="small"
        />

        {isProcessing && (
          <Flex gap="small" vertical>
            <Alert message={isRemote ? t("正在保存视频片段，请保持窗口打开。") : t("视频正在剪辑处理中，请保持窗口打开。")} showIcon type="info" />
            <Progress percent={progress} status="active" />
          </Flex>
        )}

        {errorMessage && <Alert message={errorMessage} showIcon type="error" />}
      </Flex>
    </Modal>
  );
}

function useVideoUrl(file?: File, remoteUrl?: string) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file) {
      setUrl(remoteUrl || '');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, remoteUrl]);

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
