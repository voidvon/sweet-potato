import type { CSSProperties, ChangeEvent } from 'react';
import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { AudioMaterialStack } from './AudioMaterialStack';
import { ImageMaterialStack } from './ImageMaterialStack';
import { type MediaSlotItem } from './MediaSlotStack';
import { VideoMaterialSlot } from './VideoMaterialSlot';
import type { LocalMaterialFile, MaterialKind, SelectedMaterialValue, UploadAnchor } from '../types';

type MaterialSlotProps = {
  item: MaterialKind;
  onClear: (kind: MaterialKind) => void;
  onLocalFiles?: (kind: MaterialKind, files: FileList | File[]) => void;
  onLocalUpload?: (kind: MaterialKind) => void;
  onRemoveOne: (kind: MaterialKind, materialId?: string) => void;
  onOpen: (kind: MaterialKind, anchor: UploadAnchor) => void;
  onReplaceFiles?: (kind: MaterialKind, files: LocalMaterialFile[]) => void;
  openMode?: 'local' | 'popover';
  selected: SelectedMaterialValue;
};

const imageThumbs = [
  'linear-gradient(135deg, #38bdf8 0%, #0f766e 100%)',
  'linear-gradient(135deg, #e5e7eb 0%, #6b7280 100%)',
  'linear-gradient(135deg, #111827 0%, #fef3c7 100%)',
  'linear-gradient(135deg, #f7fee7 0%, #422006 100%)',
  'linear-gradient(135deg, #ecfeff 0%, #155e75 100%)',
  'linear-gradient(135deg, #1f2937 0%, #f9fafb 100%)',
  'linear-gradient(135deg, #064e3b 0%, #bbf7d0 100%)',
  'linear-gradient(135deg, #0f172a 0%, #fde68a 100%)',
  'linear-gradient(135deg, #f0abfc 0%, #22d3ee 50%, #fef08a 100%)',
];

export function MaterialSlot({
  item,
  onClear,
  onLocalFiles,
  onLocalUpload,
  onOpen,
  onRemoveOne,
  onReplaceFiles,
  openMode = 'popover',
  selected,
}: MaterialSlotProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedCount = getSelectedCount(item, selected);
  const slotClassName = `video-task-material-slot${selected ? ' is-selected' : ''} is-${item.key}`;
  const dynamicStyle = getSlotStyle(item, selectedCount, selected);
  const handleOpen = (target: HTMLElement) => {
    if (openMode === 'local') {
      if (onLocalFiles) {
        fileInputRef.current?.click();
        return;
      }
      onLocalUpload?.(item);
      return;
    }
    onOpen(item, getUploadAnchor(target));
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onLocalFiles?.(item, Array.from(event.target.files));
    }
    event.target.value = '';
  };

  return (
    <div className={slotClassName} style={dynamicStyle}>
      {openMode === 'local' && onLocalFiles && (
        <input
          accept={getFileAccept(item)}
          className="video-task-native-file-input"
          multiple={getLimit(item) > 1}
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
      )}
      <div className="video-task-material-slot-card">
        {selected ? (
          <>
            {item.key === 'image' && (
              <ImageMaterialStack
                items={getImageItems(selectedCount, selected)}
                onRemove={(material) => onRemoveOne(item, material.id)}
              />
            )}
            {item.key === 'audio' && (
              <AudioMaterialStack
                items={getAudioItems(selectedCount, selected)}
                onRemove={(material) => onRemoveOne(item, material.id)}
                renderAudioTitle={(_, index) => getAudioName(selected, index)}
              />
            )}
            {item.key === 'video' && (
              <VideoMaterialSlot
                onClear={() => onClear(item)}
                onTrimmed={(file) => onReplaceFiles?.(item, [file])}
                selected={selected}
              />
            )}
            {item.key !== 'video' && selectedCount < getLimit(item) && (
              <button
                aria-label={`添加${item.label}`}
                className="video-task-upload-tile is-compact-add"
                onClick={(event) => handleOpen(event.currentTarget)}
                title={`添加${item.label}`}
                type="button"
              >
                <Plus size={24} />
              </button>
            )}
          </>
        ) : (
          <button
            aria-label={`添加${item.label}`}
            className="video-task-upload-tile"
            onClick={(event) => handleOpen(event.currentTarget)}
            title={`添加${item.label}`}
            type="button"
          >
            <span className="video-task-upload-badge">{item.meta}</span>
            <Plus size={24} />
            <span className="video-task-upload-label">{item.label}</span>
          </button>
        )}
      </div>
      <span className={selected ? 'video-task-upload-hint is-selected' : 'video-task-upload-hint'}>
        {selected ? getSelectedHint(item, selectedCount, selected) : item.hint}
      </span>
    </div>
  );
}

function getSelectedCount(item: MaterialKind, selected: SelectedMaterialValue) {
  if (!selected) return 0;
  if (Array.isArray(selected)) return Math.min(selected.length, getLimit(item));
  if (item.key === 'image') {
    const parsed = selected.match(/(\d+)\s*张/);
    if (parsed) return Math.min(Number(parsed[1]), getLimit(item));
    const indexed = selected.match(/(\d+)/);
    if (indexed) return Math.min(Number(indexed[1]), getLimit(item));
    return 1;
  }
  if (item.key === 'audio') {
    const parsed = selected.match(/参考音频\s*(\d+)\s*个/);
    if (parsed) return Math.min(Number(parsed[1]), getLimit(item));
  }
  return 1;
}

function getSlotStyle(item: MaterialKind, count: number, selected: SelectedMaterialValue) {
  if (!selected) return undefined;

  if (item.key === 'image') {
    const addButtonWidth = count < getLimit(item) ? 42 : 0;
    return {
      '--image-slot-width': `${getImageStackWidth(count) + addButtonWidth}px`,
    } as CSSProperties;
  }

  if (item.key === 'audio') {
    const addButtonWidth = count < getLimit(item) ? 42 : 0;
    return {
      '--audio-slot-width': `${getStackWidth(count) + addButtonWidth}px`,
    } as CSSProperties;
  }

  return undefined;
}

function getImageStackWidth(count: number) {
  return getStackWidth(count);
}

function getStackWidth(count: number) {
  return 80 + Math.max(count - 1, 0) * 7;
}

function getImageItems(count: number, selected: SelectedMaterialValue): MediaSlotItem[] {
  if (Array.isArray(selected)) {
    return selected.slice(0, count).map((file, index) => ({
      background: `url("${file.url}") center / cover no-repeat`,
      caption: `图·${index + 1}`,
      id: file.id,
      title: file.name || `参考图 ${index + 1}`,
      type: 'image',
    }));
  }

  return imageThumbs.slice(0, count).map((background, index) => ({
    background,
    caption: `图·${index + 1}`,
    id: `image-${index + 1}`,
    title: `参考图 ${index + 1}`,
    type: 'image',
  }));
}

function getAudioItems(count: number, selected: SelectedMaterialValue): MediaSlotItem[] {
  if (Array.isArray(selected)) {
    return selected.slice(0, count).map((file, index) => ({
      background: '#fffbeb',
      caption: `音·${index + 1}`,
      detail: formatDuration(getAudioDuration(file)),
      id: file.id,
      src: file.url,
      title: file.name || `参考音频 ${index + 1}`,
      type: 'audio',
    }));
  }

  const name = selected ?? '';
  return Array.from({ length: count }, (_, index) => ({
    background: '#fffbeb',
    caption: `音·${index + 1}`,
    detail: '7s',
    id: `audio-${index + 1}`,
    title: getAudioName(name, index),
    type: 'audio',
  }));
}

function getLimit(item: MaterialKind) {
  if (item.maxCount !== undefined) return item.maxCount;
  if (item.key === 'image') return 9;
  if (item.key === 'audio') return 3;
  return 1;
}

function getSelectedHint(item: MaterialKind, count: number, selected: SelectedMaterialValue) {
  if (item.key === 'image') return `${count}/9 张`;
  if (item.key === 'audio') return `${count}/3 个 · ${formatDuration(getSelectedAudioDuration(selected, count))}`;
  return `${count}/1 个`;
}

function getAudioName(selected: SelectedMaterialValue, index: number) {
  if (Array.isArray(selected)) return selected[index]?.name ?? `参考音频 ${String(index + 1).padStart(2, '0')}`;
  const name = selected ?? '';
  if (name.match(/参考音频\s*\d+\s*个/)) return `参考音频 ${String(index + 1).padStart(2, '0')}`;
  return name;
}

function getUploadAnchor(target: HTMLElement): UploadAnchor {
  const card = target.closest('.video-task-material-card');
  const targetRect = target.getBoundingClientRect();
  const cardRect = card?.getBoundingClientRect();
  if (!cardRect) {
    return { left: targetRect.left, top: targetRect.bottom + 8 };
  }

  return {
    left: targetRect.left - cardRect.left,
    top: targetRect.bottom - cardRect.top + 8,
  };
}

function getFileAccept(item: MaterialKind) {
  if (item.key === 'image') return 'image/*';
  if (item.key === 'video') return 'video/*';
  return '.mp3,.wav,audio/mpeg,audio/wav,audio/x-wav';
}

function getSelectedAudioDuration(selected: SelectedMaterialValue, count: number) {
  if (Array.isArray(selected)) {
    return selected.reduce((total, file) => total + getAudioDuration(file), 0);
  }
  return count * 7;
}

function getAudioDuration(file: LocalMaterialFile) {
  const duration = file.audioDuration;
  return Number.isFinite(duration) && duration && duration > 0 ? duration : 7;
}

function formatDuration(duration: number) {
  const rounded = Math.max(1, Math.round(duration));
  return `${rounded}s`;
}
