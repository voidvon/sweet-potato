import { Button, Image, Modal, Popconfirm, message } from 'antd';
import { Download, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getContentAsset, getVideoTask } from '../../../../api/content';
import { resolveAssetUrl } from '../../../../api/request';
import type { VideoGenerationResult, VideoGenerationTask } from '../../../../types';
import { formatRelativeCalendarDateTime } from '../../../../utils/dateTime';
import { downloadUrlAsFile } from '@shared/utils/download';
import {
  ReferenceMaterialPreviewList,
  type ReferenceMaterialPreviewAsset,
} from './MaterialPanel';
import type { ConfirmedReferenceVideo } from './ReferenceVideoCard';
import { ReferenceVideoPreviewModal } from './ReferenceVideoPreviewModal';
import { VideoPreviewPlayer } from './VideoPreviewPlayer';
import './ResultVideoPreviewModal.scss';

export type ResultVideoPreview = {
  completedAt?: string;
  createdAt?: string;
  duration?: number;
  name: string;
  referenceAssetIds?: string[];
  referenceAssets?: ReferenceMaterialPreviewAsset[];
  task?: VideoGenerationTask;
  taskId?: string;
  videoUrl: string;
};

type ResultVideoPreviewModalProps = {
  onClose: () => void;
  onDelete?: () => Promise<boolean>;
  video: ResultVideoPreview;
};

export function ResultVideoPreviewModal({ onClose, onDelete, video }: ResultVideoPreviewModalProps) {
  const [open, setOpen] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [resolvedTask, setResolvedTask] = useState<VideoGenerationTask | null>(null);
  const [referenceAssets, setReferenceAssets] = useState<ReferenceMaterialPreviewAsset[]>(video.referenceAssets || []);
  const [isLoadingReferences, setIsLoadingReferences] = useState(Boolean(video.taskId || video.task));
  const [referenceImage, setReferenceImage] = useState<ReferenceMaterialPreviewAsset | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const [playingAudioAssetId, setPlayingAudioAssetId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const task = resolvedTask || video.task;
  const completedAt = taskCompletionTime(task ?? null) || video.completedAt;
  const elapsedTime = useMemo(() => formatElapsedTime(
    task?.createdAt || video.createdAt,
    completedAt,
  ), [completedAt, task?.createdAt, video.createdAt]);
  const generatedTime = formatRelativeCalendarDateTime(completedAt);

  useEffect(() => () => {
    audioPlayerRef.current?.pause();
    audioPlayerRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      setIsLoadingReferences(true);
      let nextTask: VideoGenerationTask | null = null;
      if (video.taskId) {
        try {
          nextTask = await getVideoTask(video.taskId);
          if (!cancelled) setResolvedTask(nextTask);
        } catch {
          nextTask = null;
        }
      } else nextTask = video.task || null;

      const assetIds = Array.from(new Set([
        ...(video.referenceAssetIds || []),
        ...taskReferenceAssetIds(nextTask),
      ]));
      const loadedAssets = await Promise.all(assetIds.map(async (assetId) => {
        try {
          return await getContentAsset(assetId);
        } catch (error) {
          console.warn('[result-video-preview:reference-load-failed]', {
            assetId,
            taskId: nextTask?.id || video.taskId || '',
            error: error instanceof Error ? error.message : String(error || ''),
          });
          return null;
        }
      }));
      if (cancelled) return;

      const mergedAssets = new Map<string, ReferenceMaterialPreviewAsset>();
      (video.referenceAssets || []).forEach((asset) => mergedAssets.set(asset.id, asset));
      loadedAssets.forEach((asset) => {
        if (asset) mergedAssets.set(asset.id, asset);
      });
      setReferenceAssets(Array.from(mergedAssets.values()));
      setIsLoadingReferences(false);
    }

    void loadReferences();
    return () => {
      cancelled = true;
    };
  }, [video.referenceAssetIds, video.referenceAssets, video.task, video.taskId]);

  const openReferenceVideo = (asset: ReferenceMaterialPreviewAsset) => {
    stopReferenceAudio();
    setReferenceImage(null);
    const videoUrl = resolveAssetUrl(asset.fileUrl);
    const duration = assetDurationSeconds(asset.metadata);
    setReferenceVideo({
      duration,
      end: duration,
      fileUrl: videoUrl,
      name: asset.name || asset.originalFileName || '参考视频',
      start: 0,
      storedFileName: '',
      videoUrl,
    });
  };

  const openReferenceImage = (asset: ReferenceMaterialPreviewAsset) => {
    stopReferenceAudio();
    setReferenceVideo(null);
    setReferenceImage(asset);
  };

  const toggleReferenceAudio = (asset: ReferenceMaterialPreviewAsset) => {
    const audioUrl = resolveAssetUrl(asset.fileUrl);
    if (!audioUrl) return;
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
      audioPlayerRef.current.preload = 'metadata';
    }
    const audio = audioPlayerRef.current;
    if (playingAudioAssetId === asset.id && !audio.paused) {
      stopReferenceAudio();
      return;
    }
    setReferenceImage(null);
    setReferenceVideo(null);
    audio.pause();
    audio.src = audioUrl;
    audio.currentTime = 0;
    audio.onended = () => setPlayingAudioAssetId(null);
    void audio.play()
      .then(() => setPlayingAudioAssetId(asset.id))
      .catch(() => {
        setPlayingAudioAssetId(null);
        message.error('音频播放失败');
      });
  };

  function stopReferenceAudio() {
    audioPlayerRef.current?.pause();
    setPlayingAudioAssetId(null);
  }

  const closeModal = () => {
    stopReferenceAudio();
    setOpen(false);
  };

  const downloadVideo = async () => {
    const url = String(video.videoUrl || '').trim();
    if (!url) {
      message.warning('暂无可下载的视频');
      return;
    }
    const fileName = downloadFileName(video.name);
    setIsDownloading(true);
    try {
      await downloadUrlAsFile(url, fileName);
      message.success('已开始下载');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频下载失败');
    } finally {
      setIsDownloading(false);
    }
  };

  const deleteVideo = async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      if (await onDelete()) closeModal();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Modal
        className="result-video-preview-modal"
        rootClassName="result-video-preview-modal-root"
        afterOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
        closable={false}
        footer={null}
        mask={{ closable: true }}
        onCancel={closeModal}
        open={open}
        title={null}
        width="100vw"
        zIndex={13000}
      >
        <div className="result-video-preview-layout">
          <main className="result-video-preview-stage">
            <Button
              aria-label="关闭视频预览"
              className="result-video-preview-stage__close"
              icon={<X size={20} />}
              onClick={closeModal}
              shape="circle"
            />
            <VideoPreviewPlayer
              duration={video.duration}
              name={video.name}
              paused={Boolean(referenceImage || referenceVideo || playingAudioAssetId)}
              variant="result"
              videoUrl={video.videoUrl}
            />
          </main>
          <aside className="result-video-preview-sidebar">
            <div className="result-video-preview-sidebar__header">
              <div className="result-video-preview-sidebar__header-copy">
                <h2 title={video.name}>{video.name}</h2>
                {generatedTime ? <p className="result-video-preview-sidebar__generated-time">{generatedTime}</p> : null}
                {video.duration ? <p className="result-video-preview-sidebar__duration">{formatDuration(video.duration)}</p> : null}
              </div>
              <div className="result-video-preview-sidebar__actions">
                <Button
                  aria-label="下载视频"
                  disabled={isDeleting}
                  icon={<Download size={17} />}
                  loading={isDownloading}
                  onClick={() => void downloadVideo()}
                  title="下载"
                  type="text"
                />
                {onDelete ? (
                  <Popconfirm
                    cancelText="取消"
                    description="删除后无法恢复"
                    disabled={isDeleting}
                    okButtonProps={{ danger: true, loading: isDeleting }}
                    okText="删除"
                    onConfirm={deleteVideo}
                    title="确认删除这个视频吗？"
                    zIndex={14000}
                  >
                    <Button
                      aria-label="删除视频"
                      danger
                      disabled={isDownloading}
                      icon={<Trash2 size={17} />}
                      loading={isDeleting}
                      title="删除"
                      type="text"
                    />
                  </Popconfirm>
                ) : null}
              </div>
            </div>

            <dl className="result-video-preview-sidebar__metrics">
              <div>
                <dt>总耗时</dt>
                <dd>{elapsedTime}</dd>
              </div>
            </dl>

            <section className="result-video-preview-sidebar__references">
              <h3>参考素材</h3>
              <ReferenceMaterialPreviewList
                activeAudioAssetId={playingAudioAssetId}
                assets={referenceAssets}
                isLoading={isLoadingReferences}
                onAudioPreview={toggleReferenceAudio}
                onImagePreview={openReferenceImage}
                onVideoPreview={openReferenceVideo}
              />
            </section>
          </aside>
        </div>
      </Modal>

      {referenceVideo ? (
        <ReferenceVideoPreviewModal
          onClose={() => setReferenceVideo(null)}
          video={referenceVideo}
        />
      ) : null}

      {referenceImage ? (
        <Image
          alt={referenceImage.name || referenceImage.originalFileName || '参考图片预览'}
          preview={{
            open: true,
            src: resolveAssetUrl(referenceImage.fileUrl),
            zIndex: 14000,
            onOpenChange: (nextOpen) => {
              if (!nextOpen) setReferenceImage(null);
            },
          }}
          src={resolveAssetUrl(referenceImage.fileUrl)}
          style={{ display: 'none' }}
        />
      ) : null}
    </>
  );
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `时长 ${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function taskReferenceAssetIds(task: VideoGenerationTask | null) {
  if (!task) return [];
  const context = task.expertContext || {};
  const originalReferenceImageIds = stringList(context.originalReferenceImageIds);
  return Array.from(new Set([
    ...(originalReferenceImageIds.length
      ? originalReferenceImageIds
      : stringList(context.referenceImageIds)),
    ...stringList(context.referenceVideoIds),
    ...stringList(context.referenceAudioIds),
    ...stringList(context.sourceAssetId),
  ]));
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function taskCompletionTime(task: VideoGenerationTask | null) {
  if (!task) return '';
  const result = task.editableParseResult.videoGenerationResult
    || task.expertContext?.videoGenerationResult as VideoGenerationResult | undefined;
  return result?.generatedAt || task.updatedAt;
}

function formatElapsedTime(startValue?: string, endValue?: string) {
  const start = Date.parse(startValue || '');
  const end = Date.parse(endValue || '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '--';
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时 ${minutes}分 ${seconds}秒`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
}

function assetDurationSeconds(metadata: Record<string, unknown>) {
  const durationMs = numericDuration(metadata.durationMs);
  if (durationMs > 0) return durationMs / 1000;
  return numericDuration(metadata.durationSeconds)
    || numericDuration(metadata.durationSecond)
    || numericDuration(metadata.duration);
}

function numericDuration(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const matched = String(value || '').match(/[\d.]+/);
  const parsed = matched ? Number(matched[0]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function downloadFileName(name: string) {
  const normalized = String(name || '生成视频')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/\.mp4$/i, '')
    .slice(0, 80);
  return `${normalized || '生成视频'}.mp4`;
}
