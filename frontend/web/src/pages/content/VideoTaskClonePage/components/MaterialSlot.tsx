import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { materialIcon } from './materialIcon';
import { MediaPreviewDialog, MediaSlotStack, type MediaSlotItem } from './MediaSlotStack';
import type { MaterialKind, SelectedMaterialValue, UploadAnchor } from '../types';

type MaterialSlotProps = {
  item: MaterialKind;
  onClear: (kind: MaterialKind) => void;
  onLocalUpload?: (kind: MaterialKind) => void;
  onRemoveOne: (kind: MaterialKind) => void;
  onOpen: (kind: MaterialKind, anchor: UploadAnchor) => void;
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
  onLocalUpload,
  onOpen,
  onRemoveOne,
  openMode = 'popover',
  selected,
}: MaterialSlotProps) {
  const [previewItem, setPreviewItem] = useState<MediaSlotItem | null>(null);
  const selectedCount = getSelectedCount(item, selected);
  const slotClassName = `video-task-material-slot${selected ? ' is-selected' : ''} is-${item.key}`;
  const dynamicStyle = getSlotStyle(item, selectedCount, selected);
  const handleOpen = (target: HTMLElement) => {
    if (openMode === 'local') {
      onLocalUpload?.(item);
      return;
    }
    onOpen(item, getUploadAnchor(target));
  };

  return (
    <div className={slotClassName} style={dynamicStyle}>
      <div className="video-task-material-slot-card">
        {selected ? (
          <>
            {item.key === 'image' && (
              <MediaSlotStack items={getImageItems(selectedCount)} onPreview={setPreviewItem} onRemove={() => onRemoveOne(item)} />
            )}
            {item.key === 'audio' && (
              <MediaSlotStack
                items={getAudioItems(selectedCount, selected)}
                onPreview={setPreviewItem}
                onRemove={() => onRemoveOne(item)}
                renderAudioTitle={(_, index) => getAudioName(selected, index)}
              />
            )}
            {item.key === 'video' && <VideoPreview name={selected} onClear={() => onClear(item)} />}
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
        {selected ? getSelectedHint(item, selectedCount) : item.hint}
      </span>
      {previewItem && <MediaPreviewDialog item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}

function VideoPreview({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div className="video-task-stack-wrapper">
      <div aria-label="预览 参考视频" className="video-task-video-preview-card" role="button" tabIndex={0}>
        {materialIcon('video')}
        <span>{name}</span>
        <button
          aria-label="删除 参考视频"
          className="video-task-slot-delete"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function getSelectedCount(item: MaterialKind, selected: SelectedMaterialValue) {
  if (!selected) return 0;
  if (item.key === 'image') {
    const parsed = selected.match(/(\d+)\s*张/);
    if (parsed) return Math.min(Number(parsed[1]), 9);
    const indexed = selected.match(/(\d+)/);
    if (indexed) return Math.min(Number(indexed[1]), 9);
    return 1;
  }
  if (item.key === 'audio') {
    const parsed = selected.match(/参考音频\s*(\d+)\s*个/);
    if (parsed) return Math.min(Number(parsed[1]), 3);
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

function getImageItems(count: number): MediaSlotItem[] {
  return imageThumbs.slice(0, count).map((background, index) => ({
    background,
    caption: `图·${index + 1}`,
    id: `image-${index + 1}`,
    title: `参考图 ${index + 1}`,
    type: 'image',
  }));
}

function getAudioItems(count: number, name: string): MediaSlotItem[] {
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
  if (item.key === 'image') return 9;
  if (item.key === 'audio') return 3;
  return 1;
}

function getSelectedHint(item: MaterialKind, count: number) {
  if (item.key === 'image') return `${count}/9 张`;
  if (item.key === 'audio') return `${count}/3 个 · 7s`;
  return `${count}/1 个`;
}

function getAudioName(name: string, index: number) {
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
