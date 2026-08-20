import { Music2, Pause, Play, Plus, X } from 'lucide-react';
import { Popover, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAssetUrl } from '../api/request';
import type { ContentAsset } from '../types';
import './BatchAudioReferencePicker.scss';
import { t } from '@shared/i18n';

const MAX_SEGMENTS = 3;
const MIN_SEGMENT_SECONDS = 2;
const MAX_SEGMENT_SECONDS = 15;
const MAX_TOTAL_SECONDS = 15;

type BatchAudioReferencePickerProps = {
  assets: ContentAsset[];
  disabled?: boolean;
  ids: string[];
  onChange: (ids: string[]) => void;
  onUpload: (file: File) => Promise<ContentAsset[]>;
};

function durationFromMetadata(asset: ContentAsset) {
  const metadata = asset.metadata || {};
  const durationMs = Number(metadata.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) return durationMs / 1000;
  const value = metadata.durationSeconds ?? metadata.durationSecond ?? metadata.duration;
  const duration = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function readAudioDuration(source: string | File) {
  const sourceUrl = source instanceof File ? URL.createObjectURL(source) : source;
  const objectUrl = source instanceof File ? sourceUrl : '';
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.src = sourceUrl;
  return new Promise<number | undefined>((resolve) => {
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(duration && duration > 0 ? duration : undefined);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
  });
}

function formatSeconds(value: number) {
  return value.toFixed(1);
}

export function BatchAudioReferencePicker({
  assets,
  disabled = false,
  ids,
  onChange,
  onUpload,
}: BatchAudioReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState(ids);
  const [draftAssets, setDraftAssets] = useState<Record<string, ContentAsset>>({});
  const [durationById, setDurationById] = useState<Record<string, number | undefined>>({});
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filePickerActiveRef = useRef(false);
  const filePickerFocusHandlerRef = useRef<(() => void) | null>(null);

  const assetById = useMemo(
    () => new Map([...assets, ...Object.values(draftAssets)].map((asset) => [asset.id, asset])),
    [assets, draftAssets],
  );
  const draftAssetList = useMemo(
    () => draftIds.map((id) => assetById.get(id)).filter((asset): asset is ContentAsset => Boolean(asset)),
    [assetById, draftIds],
  );
  const durations = draftAssetList.map((asset) => durationById[asset.id] ?? durationFromMetadata(asset));
  const totalSeconds = durations.reduce((total: number, duration) => total + (duration ?? 0), 0);
  const hasUnknownDuration = durations.some((duration) => duration === undefined);
  const exceedsLimit = totalSeconds > MAX_TOTAL_SECONDS + 0.01;
  const hasInvalidSegment = durations.some((duration) => (
    duration !== undefined && (duration < MIN_SEGMENT_SECONDS || duration > MAX_SEGMENT_SECONDS)
  ));
  const triggerLabel = draftIds.length
    ? t("{{0}} 段 · {{1}}s", { "0": draftIds.length, "1": formatSeconds(totalSeconds) })
    : t("音频");

  useEffect(() => {
    if (!open) setDraftIds(ids);
  }, [ids, open]);

  useEffect(() => {
    let active = true;
    const missingAssets = draftAssetList.filter((asset) => (
      !Object.prototype.hasOwnProperty.call(durationById, asset.id) && durationFromMetadata(asset) === undefined
    ));
    if (!missingAssets.length) return undefined;
    void Promise.all(missingAssets.map(async (asset) => [asset.id, await readAudioDuration(resolveAssetUrl(asset.fileUrl))] as const))
      .then((entries) => {
        if (!active) return;
        setDurationById((current) => ({ ...current, ...Object.fromEntries(entries) }));
      });
    return () => { active = false; };
  }, [draftAssetList, durationById]);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const togglePlayback = (asset: ContentAsset) => {
    const source = resolveAssetUrl(asset.fileUrl);
    if (!source) return;
    if (playingId === asset.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(source);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    audioRef.current = audio;
    void audio.play().then(() => setPlayingId(asset.id)).catch(() => setPlayingId(null));
  };

  const releaseFilePicker = () => {
    filePickerActiveRef.current = false;
    if (filePickerFocusHandlerRef.current) {
      window.removeEventListener('focus', filePickerFocusHandlerRef.current);
      filePickerFocusHandlerRef.current = null;
    }
  };

  const openFilePicker = () => {
    filePickerActiveRef.current = true;
    inputRef.current?.click();
    window.setTimeout(() => {
      const handleWindowFocus = () => { window.setTimeout(releaseFilePicker, 300); };
      filePickerFocusHandlerRef.current = handleWindowFocus;
      window.addEventListener('focus', handleWindowFocus, { once: true });
    }, 0);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    releaseFilePicker();
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || uploading) return;
    const duration = await readAudioDuration(file);
    if (!duration) {
      message.error(t("无法读取音频时长，请选择有效的 wav 或 mp3 文件"));
      return;
    }
    if (duration < MIN_SEGMENT_SECONDS || duration > MAX_SEGMENT_SECONDS) {
      message.warning(t("单段音频时长需为 2-15s"));
      return;
    }
    if (totalSeconds + duration > MAX_TOTAL_SECONDS + 0.01) {
      message.warning(t("音频总时长不能超过 15s"));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await onUpload(file);
      if (!uploaded.length) return;
      const nextAsset = uploaded[0];
      setDraftAssets((current) => ({ ...current, [nextAsset.id]: nextAsset }));
      setDurationById((current) => ({ ...current, [nextAsset.id]: duration }));
      const nextIds = [...draftIds, nextAsset.id];
      setDraftIds(nextIds);
      onChange(nextIds);
    } finally {
      setUploading(false);
    }
  };

  const finish = () => {
    if (hasUnknownDuration) {
      message.info(t("正在读取音频时长，请稍候"));
      return;
    }
    if (hasInvalidSegment || exceedsLimit) {
      message.warning(t("音频总时长不能超过 15s，单段需为 2-15s"));
      return;
    }
    onChange(draftIds);
    setOpen(false);
  };

  return (
    <>
      <Popover
        arrow={false}
        classNames={{ root: 'batch-audio-picker-popover' }}
        content={(
          <div className="batch-audio-picker">
            <div className="batch-audio-picker__header">
              <strong>{t("总时长")}</strong>
              <span>{formatSeconds(totalSeconds)} / 15s</span>
              <button aria-label={t("关闭音频选择")} className="batch-audio-picker__close" onClick={() => setOpen(false)} type="button"><X size={18} /></button>
            </div>
            <div className="batch-audio-picker__progress"><span style={{ width: `${Math.min(100, (totalSeconds / MAX_TOTAL_SECONDS) * 100)}%` }} /></div>
            <div className="batch-audio-picker__slots">
              {draftAssetList.map((asset, index) => {
                const duration = durations[index] ?? 0;
                const title = asset.name || asset.originalFileName || t("音频段 {{0}}", { "0": index + 1 });
                return (
                  <div className="batch-audio-picker__item" key={asset.id}>
                    <span className="batch-audio-picker__item-name" title={title}>{title}</span>
                    <span className="batch-audio-picker__item-duration">{duration ? `${formatSeconds(duration)}s` : t("读取中")}</span>
                    <button aria-label={playingId === asset.id ? t("暂停{{0}}", { "0": title }) : t("播放{{0}}", { "0": title })} className="batch-audio-picker__item-play" onClick={() => togglePlayback(asset)} type="button">
                      {playingId === asset.id ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button aria-label={t("移除{{0}}", { "0": title })} className="batch-audio-picker__item-remove" onClick={() => setDraftIds((current) => current.filter((id) => id !== asset.id))} type="button"><X size={16} /></button>
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, MAX_SEGMENTS - draftIds.length) }).map((_, index) => (
                <button className="batch-audio-picker__add" disabled={disabled || uploading} key={`empty-${index}`} onClick={openFilePicker} type="button">
                  <Plus size={18} /> {t("添加音频段（2-15s）")}
                </button>
              ))}
            </div>
            <div className="batch-audio-picker__footer">
              <span>{hasInvalidSegment || exceedsLimit ? t("已超过时长限制") : ''}</span>
              <button className="batch-audio-picker__done" disabled={disabled || uploading || hasUnknownDuration} onClick={finish} type="button">{t("完成")}</button>
            </div>
          </div>
        )}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          if (!nextOpen && filePickerActiveRef.current) return;
          if (nextOpen) setDraftIds(ids);
          setOpen(nextOpen);
        }}
        open={open}
        placement="bottomLeft"
        trigger="click"
      >
        <div
          aria-disabled={disabled}
          aria-label={t("选择参考音频")}
          className={`batch-audio-reference-trigger${draftIds.length ? ' is-filled' : ''}`}
          onKeyDown={(event) => {
            if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              setOpen((current) => !current);
            }
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          <Music2 size={15} />
          <span>{triggerLabel}</span>
          {draftIds.length ? (
            <button
              aria-label={t("清除全部参考音频")}
              className="batch-audio-reference-trigger__clear"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDraftIds([]);
                onChange([]);
                setOpen(false);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </Popover>
      <input accept="audio/wav,audio/mpeg,audio/mp3" className="batch-audio-reference-picker__input" onChange={handleFileChange} ref={inputRef} type="file" />
    </>
  );
}
