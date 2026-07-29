import { Plus, UploadCloud, X } from 'lucide-react';
import { message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { trimReferenceVideo, type TrimReferenceVideoResult } from '../api/content';
import { resolveAssetUrl } from '../api/request';
import type { ContentAsset } from '../types';
import { TrimReferenceVideoModal, type TrimSelection } from '../pages/content/VideoTaskClonePage/components/TrimReferenceVideoModal';
import { ReferenceVideoPreviewModal } from '../pages/content/VideoTaskClonePage/components/ReferenceVideoPreviewModal';
import type { ConfirmedReferenceVideo } from '../pages/content/VideoTaskClonePage/components/ReferenceVideoCard';
import { MAX_REFERENCE_VIDEO_DURATION_SECONDS, readVideoDuration, readVideoUrlDuration } from '../pages/content/VideoTaskClonePage/videoMetadata';
import './BatchVideoReferencePicker.scss';

const MAX_VIDEO_COUNT = 1;

type BatchVideoReferencePickerProps = {
  assets: ContentAsset[];
  disabled?: boolean;
  ids: string[];
  onChange: (ids: string[]) => void;
  onAssetReady: (asset: ContentAsset) => void;
  onUpload: (file: File) => Promise<ContentAsset[]>;
};

function assetDuration(asset: ContentAsset) {
  const value = asset.metadata?.duration;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function formatDuration(value: number) {
  return `${Math.round(value)}s`;
}

function assetFromTrimResult(result: TrimReferenceVideoResult): ContentAsset {
  return {
    assetKind: 'video_trimmed',
    createdAt: new Date().toISOString(),
    description: '批量生成参考视频',
    expiresAt: null,
    filePath: '',
    fileSize: 0,
    fileUrl: result.fileUrl,
    groupId: '',
    id: result.assetId,
    lifecycleStatus: 'temporary',
    metadata: {
      duration: result.duration,
      kind: 'video_create_reference_upload',
      trimEnd: result.end,
      trimStart: result.start,
    },
    mimeType: 'video/mp4',
    name: result.originalFileName || result.name || '参考视频',
    originalFileName: result.originalFileName || result.name || '参考视频.mp4',
    parentAssetId: null,
    resourceType: 'other',
    retainedAt: null,
    storedFileName: result.name || '',
    updatedAt: new Date().toISOString(),
    userId: '',
  };
}

export function BatchVideoReferencePicker({
  assets,
  disabled = false,
  ids,
  onChange,
  onAssetReady,
  onUpload,
}: BatchVideoReferencePickerProps) {
  const [draftIds, setDraftIds] = useState(ids);
  const [draftAssets, setDraftAssets] = useState<Record<string, ContentAsset>>({});
  const [durationById, setDurationById] = useState<Record<string, number | undefined>>({});
  const [uploading, setUploading] = useState(false);
  const [trimmingFile, setTrimmingFile] = useState<File | null>(null);
  const [previewVideo, setPreviewVideo] = useState<ConfirmedReferenceVideo | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draftIdsRef = useRef(ids);

  const assetById = useMemo(
    () => new Map([...assets, ...Object.values(draftAssets)].map((asset) => [asset.id, asset])),
    [assets, draftAssets],
  );
  const selectedAssets = useMemo(
    () => draftIds.map((id) => assetById.get(id)).filter((asset): asset is ContentAsset => Boolean(asset)),
    [assetById, draftIds],
  );

  useEffect(() => {
    draftIdsRef.current = ids;
    setDraftIds(ids);
  }, [ids]);

  useEffect(() => {
    let active = true;
    const missingAssets = selectedAssets.filter((asset) => (
      !Object.prototype.hasOwnProperty.call(durationById, asset.id) && assetDuration(asset) === undefined
    ));
    if (!missingAssets.length) return undefined;
    void Promise.all(missingAssets.map(async (asset) => [
      asset.id,
      await readVideoUrlDuration(resolveAssetUrl(asset.fileUrl)),
    ] as const)).then((entries) => {
      if (active) setDurationById((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => { active = false; };
  }, [durationById, selectedAssets]);

  const addAsset = (asset: ContentAsset, duration?: number) => {
    if (draftIdsRef.current.length >= MAX_VIDEO_COUNT) return;
    const nextIds = [...draftIdsRef.current, asset.id];
    draftIdsRef.current = nextIds;
    onAssetReady(asset);
    setDraftAssets((current) => ({ ...current, [asset.id]: asset }));
    if (duration !== undefined) setDurationById((current) => ({ ...current, [asset.id]: duration }));
    setDraftIds(nextIds);
    onChange(nextIds);
  };

  const uploadFile = async (file: File, duration: number) => {
    setUploading(true);
    try {
      const uploaded = await onUpload(file);
      if (uploaded[0]) addAsset(uploaded[0], duration);
    } finally {
      setUploading(false);
    }
  };

  const handleTrimmedVideo = async (selection: TrimSelection) => {
    const result = await trimReferenceVideo({
      end: Number(selection.end.toFixed(1)),
      file: selection.file,
      start: Number(selection.start.toFixed(1)),
    });
    const asset = assetFromTrimResult(result);
    addAsset(asset, result.duration);
    setTrimmingFile(null);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || uploading || draftIdsRef.current.length >= MAX_VIDEO_COUNT) return;
    const duration = await readVideoDuration(file);
    if (!duration) {
      message.error('无法读取视频时长，请选择有效的视频文件');
      return;
    }
    if (duration > MAX_REFERENCE_VIDEO_DURATION_SECONDS) {
      setTrimmingFile(file);
      return;
    }
    await uploadFile(file, duration);
  };

  const removeAsset = (id: string) => {
    const nextIds = draftIdsRef.current.filter((assetId) => assetId !== id);
    draftIdsRef.current = nextIds;
    setDraftIds(nextIds);
    onChange(nextIds);
  };

  return (
    <>
      <div className="batch-generation-grid-assets batch-video-reference-assets">
        {selectedAssets.map((asset) => {
          const duration = durationById[asset.id] ?? assetDuration(asset);
          const src = resolveAssetUrl(asset.fileUrl);
          const alt = asset.name || asset.originalFileName || '参考视频';
          const preview = src ? {
            assetId: asset.id,
            duration: duration ?? 15,
            end: duration ?? 15,
            fileUrl: asset.fileUrl,
            name: alt,
            start: 0,
            storedFileName: asset.storedFileName || asset.originalFileName || alt,
            videoUrl: src,
          } satisfies ConfirmedReferenceVideo : null;
          return (
            <div className="batch-generation-grid-asset" key={asset.id}>
              {preview ? (
                <button
                  aria-label={`预览${alt}`}
                  className="batch-generation-grid-asset__preview"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPreviewVideo(preview);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <video aria-label={alt} className="batch-generation-grid-asset__image" muted playsInline preload="metadata" src={src} />
                </button>
              ) : <span className="batch-generation-grid-asset__placeholder"><UploadCloud size={15} /></span>}
              {duration ? <span className="batch-generation-grid-asset__duration">{formatDuration(duration)}</span> : null}
              <button aria-label={`移除${alt}`} className="batch-generation-grid-asset__remove" onClick={(event) => { event.stopPropagation(); removeAsset(asset.id); }} onPointerDown={(event) => event.stopPropagation()} type="button"><X size={10} strokeWidth={2.4} /></button>
            </div>
          );
        })}
        {draftIds.length < MAX_VIDEO_COUNT ? (
          <div className="batch-generation-grid-asset-upload">
            <button aria-label="添加参考视频" className="batch-generation-grid-asset-add" disabled={disabled || uploading} onClick={() => inputRef.current?.click()} onPointerDown={(event) => event.stopPropagation()} type="button">
              {uploading ? <span className="batch-generation-grid-asset-add__spinner" /> : <Plus size={18} />}
            </button>
          </div>
        ) : null}
      </div>
      <input accept="video/*" className="batch-video-reference-picker__input" onChange={handleFileChange} ref={inputRef} type="file" />
      {trimmingFile ? <TrimReferenceVideoModal file={trimmingFile} onCancel={() => setTrimmingFile(null)} onConfirm={handleTrimmedVideo} /> : null}
      {previewVideo ? <ReferenceVideoPreviewModal onClose={() => setPreviewVideo(null)} video={previewVideo} /> : null}
    </>
  );
}
