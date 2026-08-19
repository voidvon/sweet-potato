import { useState } from 'react';
import { deleteReferenceVideo, trimReferenceVideo } from '../../../../api/content';
import { resolveAssetUrl } from '../../../../api/request';
import { MediaAttachmentStack } from '../../../../components/MediaAttachmentStack';
import type { ConfirmedReferenceVideo } from './ReferenceVideoCard';
import { ReferenceVideoPreviewModal } from './ReferenceVideoPreviewModal';
import { TrimReferenceVideoModal, type RemoteTrimSelection, type TrimSelection } from './TrimReferenceVideoModal';
import type { LocalMaterialFile, SelectedMaterialValue } from '../types';
import { MAX_REFERENCE_VIDEO_DURATION_SECONDS, shouldTrimReferenceVideo } from '../videoMetadata';

type VideoMaterialSlotProps = {
  onClear: () => void;
  onTrimmed: (file: LocalMaterialFile) => void;
  selected: SelectedMaterialValue;
};

export function VideoMaterialSlot({ onClear, onTrimmed, selected }: VideoMaterialSlotProps) {
  const [previewVideo, setPreviewVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const file = Array.isArray(selected) ? selected[0] : null;
  const pendingTrim = getPendingVideo(selected);
  const video = file ? toConfirmedReferenceVideo(file) : null;
  const name = file?.name ?? (typeof selected === 'string' ? selected : '参考视频 01');

  const confirmTrim = async (selection: TrimSelection) => {
    const previousVideo = video;
    const result = await trimReferenceVideo({
      end: Number(selection.end.toFixed(1)),
      file: selection.file,
      start: Number(selection.start.toFixed(1)),
    });
    const nextFile = {
      assetId: result.assetId,
      id: `video-${crypto.randomUUID()}`,
      name: result.originalFileName || result.name || selection.file.name || '参考视频 01',
      serverFileUrl: result.fileUrl,
      storedFileName: result.storedFileName,
      type: 'video',
      url: resolveAssetUrl(result.fileUrl),
      trimDuration: result.duration,
      trimEnd: result.end,
      trimStart: result.start,
    } satisfies LocalMaterialFile;

    onTrimmed(nextFile);
    if (previousVideo) {
      void deleteServerReferenceVideo(previousVideo);
    }
  };

  const confirmRemoteTrim = (selection: RemoteTrimSelection) => {
    if (!pendingTrim || pendingTrim.file) return;
    onTrimmed({
      ...pendingTrim,
      trimDuration: Number((selection.end - selection.start).toFixed(1)),
      trimEnd: Number(selection.end.toFixed(1)),
      trimStart: Number(selection.start.toFixed(1)),
    });
  };

  const clearVideo = () => {
    if (video) {
      void deleteServerReferenceVideo(video);
    }
    onClear();
  };

  return (
    <>
      <MediaAttachmentStack
        items={[{
          caption: name,
          id: file?.id ?? 'reference-video',
          name,
          src: file?.url,
          type: 'video',
        }]}
        layout="offset"
        onPreview={video ? () => setPreviewVideo(video) : undefined}
        onRemove={clearVideo}
      />

      {pendingTrim?.file ? (
        <TrimReferenceVideoModal
          file={pendingTrim.file}
          onCancel={clearVideo}
          onConfirm={confirmTrim}
        />
      ) : pendingTrim ? (
        <TrimReferenceVideoModal
          duration={pendingTrim.mediaDuration || 0}
          name={pendingTrim.name}
          onCancel={clearVideo}
          onConfirm={confirmRemoteTrim}
          videoUrl={pendingTrim.url}
        />
      ) : null}
      {previewVideo && (
        <ReferenceVideoPreviewModal
          onClose={() => setPreviewVideo(null)}
          video={previewVideo}
        />
      )}
    </>
  );
}

function getPendingVideo(selected: SelectedMaterialValue) {
  const file = Array.isArray(selected) ? selected[0] : null;
  if (!file) return null;
  if (file.trimDuration !== undefined) {
    return shouldTrimReferenceVideo(file.trimDuration) ? file : null;
  }
  if (file.file) {
    return shouldTrimReferenceVideo(file.trimDuration) ? file : null;
  }
  return (file.mediaDuration ?? 0) > MAX_REFERENCE_VIDEO_DURATION_SECONDS ? file : null;
}

function toConfirmedReferenceVideo(file: LocalMaterialFile): ConfirmedReferenceVideo {
  const duration = file.trimDuration ?? file.mediaDuration ?? 15;
  return {
    assetId: file.assetId,
    duration,
    end: file.trimEnd ?? duration,
    fileUrl: file.serverFileUrl ?? file.url,
    name: file.name,
    start: file.trimStart ?? 0,
    storedFileName: file.storedFileName ?? '',
    videoUrl: file.url,
  };
}

async function deleteServerReferenceVideo(video: ConfirmedReferenceVideo) {
  if (!video.assetId && !video.storedFileName) return;
  if (!video.storedFileName && (!video.fileUrl || video.fileUrl.startsWith('blob:'))) return;
  try {
    await deleteReferenceVideo({
      assetId: video.assetId,
      fileUrl: video.fileUrl,
      storedFileName: video.storedFileName,
    });
  } catch {
    // Best-effort cleanup: the visual state should not be blocked by stale temporary files.
  }
}
