import { Play, X } from 'lucide-react';
import { useState } from 'react';
import { deleteReferenceVideo, trimReferenceVideo } from '../../../../api/content';
import { resolveAssetUrl } from '../../../../api/request';
import { materialIcon } from './materialIcon';
import type { ConfirmedReferenceVideo } from './ReferenceVideoCard';
import { ReferenceVideoPreviewModal } from './ReferenceVideoPreviewModal';
import { TrimReferenceVideoModal, type TrimSelection } from './TrimReferenceVideoModal';
import type { LocalMaterialFile, SelectedMaterialValue } from '../types';

type VideoMaterialSlotProps = {
  onClear: () => void;
  onTrimmed: (file: LocalMaterialFile) => void;
  selected: SelectedMaterialValue;
};

export function VideoMaterialSlot({ onClear, onTrimmed, selected }: VideoMaterialSlotProps) {
  const [trimFile, setTrimFile] = useState<File | null>(getPendingVideoFile(selected));
  const [previewVideo, setPreviewVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const file = Array.isArray(selected) ? selected[0] : null;
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
      id: `video-${crypto.randomUUID()}`,
      name: result.originalFileName || result.name || selection.file.name || '参考视频 01',
      type: 'video',
      url: resolveAssetUrl(result.fileUrl),
      serverFileUrl: result.fileUrl,
      storedFileName: result.storedFileName,
      trimDuration: result.duration,
      trimEnd: result.end,
      trimStart: result.start,
    } satisfies LocalMaterialFile;

    onTrimmed(nextFile);
    setTrimFile(null);
    if (previousVideo) {
      void deleteServerReferenceVideo(previousVideo);
    }
  };

  const clearVideo = () => {
    if (video) {
      void deleteServerReferenceVideo(video);
    }
    onClear();
  };

  return (
    <>
      <div className="video-task-stack-wrapper">
        <div
          aria-label="预览 参考视频"
          className="video-task-video-preview-card"
          onClick={() => video && setPreviewVideo(video)}
          onKeyDown={(event) => {
            if (!video || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            setPreviewVideo(video);
          }}
          role="button"
          tabIndex={0}
        >
          {file ? <video muted playsInline preload="metadata" src={file.url} /> : materialIcon('video')}
          {file && (
            <span className="video-task-reference-play">
              <Play size={14} fill="currentColor" />
            </span>
          )}
          <span className="video-task-video-preview-name">{name}</span>
          <button
            aria-label="删除 参考视频"
            className="video-task-slot-delete"
            onClick={(event) => {
              event.stopPropagation();
              clearVideo();
            }}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {trimFile && (
        <TrimReferenceVideoModal
          file={trimFile}
          onCancel={() => {
            setTrimFile(null);
            clearVideo();
          }}
          onConfirm={confirmTrim}
        />
      )}
      {previewVideo && (
        <ReferenceVideoPreviewModal
          onClose={() => setPreviewVideo(null)}
          video={previewVideo}
        />
      )}
    </>
  );
}

function getPendingVideoFile(selected: SelectedMaterialValue) {
  const file = Array.isArray(selected) ? selected[0] : null;
  return file?.file ?? null;
}

function toConfirmedReferenceVideo(file: LocalMaterialFile): ConfirmedReferenceVideo {
  return {
    duration: file.trimDuration ?? 15,
    end: file.trimEnd ?? 15,
    fileUrl: file.serverFileUrl ?? file.url,
    name: file.name,
    start: file.trimStart ?? 0,
    storedFileName: file.storedFileName ?? '',
    videoUrl: file.url,
  };
}

async function deleteServerReferenceVideo(video: ConfirmedReferenceVideo) {
  if (!video.storedFileName && (!video.fileUrl || video.fileUrl.startsWith('blob:'))) return;
  try {
    await deleteReferenceVideo({
      fileUrl: video.fileUrl,
      storedFileName: video.storedFileName,
    });
  } catch {
    // Best-effort cleanup: the visual state should not be blocked by stale temporary files.
  }
}
