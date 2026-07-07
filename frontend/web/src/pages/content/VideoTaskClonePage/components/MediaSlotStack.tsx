import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';
import { Modal } from 'antd';
import { Play, X } from 'lucide-react';

export type MediaSlotItem = {
  background?: string;
  caption: string;
  detail?: string;
  id: string;
  title: string;
  type: 'image' | 'audio';
};

type MediaSlotStackProps = {
  items: MediaSlotItem[];
  onPreview: (item: MediaSlotItem) => void;
  onRemove: () => void;
  renderAudioTitle?: (item: MediaSlotItem, index: number) => string;
};

export function MediaSlotStack({ items, onPreview, onRemove, renderAudioTitle }: MediaSlotStackProps) {
  const [isPopoverSuppressed, setIsPopoverSuppressed] = useState(false);
  const type = items[0]?.type ?? 'image';
  const style = {
    '--media-stack-width': `${80 + Math.max(items.length - 1, 0) * 7}px`,
  } as CSSProperties;
  const preview = (item: MediaSlotItem) => {
    setIsPopoverSuppressed(true);
    onPreview(item);
  };

  return (
    <div
      className={`video-task-stack-wrapper is-${type}-stack${isPopoverSuppressed ? ' is-popover-suppressed' : ''}`}
      onMouseLeave={() => setIsPopoverSuppressed(false)}
      style={style}
    >
      {items.map((item, index) => (
        <div
          aria-label={`预览${item.title}`}
          className={`video-task-stack-item is-${item.type}`}
          key={item.id}
          onClick={() => preview(item)}
          onKeyDown={(event) => handlePreviewKeyDown(event, () => preview(item))}
          role="button"
          style={{
            background: item.background,
            transform: `translate(${index * 7}px, 0)`,
            zIndex: 100 + index,
          }}
          tabIndex={0}
        >
          {item.type === 'image' ? <ImageContent caption={item.caption} /> : (
            <AudioContent detail={item.detail} title={renderAudioTitle?.(item, index) ?? item.title} />
          )}
          <button
            aria-label={`删除${item.title}`}
            className="video-task-slot-delete"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      <div className="media-slot-popover is-fanned">
        {items.length > 1 && <div className="media-slot-popover__hit-area" />}
        {items.map((item, index) => (
          <div
            aria-label={`预览${item.title}`}
            className="media-slot-popover__item group/thumb"
            key={`popover-${item.id}`}
            onClick={() => preview(item)}
            onKeyDown={(event) => handlePreviewKeyDown(event, () => preview(item))}
            role="button"
            style={{
              background: item.background,
              transform: getFannedTransform(index),
              zIndex: 100 + index,
            }}
            tabIndex={0}
          >
            {item.type === 'image' ? <ImageContent caption={item.caption} /> : (
              <AudioContent detail={item.detail} title={renderAudioTitle?.(item, index) ?? item.title} />
            )}
            <button
              aria-label={`删除${item.title}`}
              className="video-task-slot-delete"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              type="button"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MediaPreviewDialog({
  item,
  onClose,
}: {
  item: MediaSlotItem;
  onClose: () => void;
}) {
  return (
    <Modal
      centered
      className="video-task-media-preview-modal"
      footer={null}
      mask={{ closable: true }}
      onCancel={onClose}
      open
      title={null}
      width={280}
    >
      <div className={`video-task-media-preview__panel is-${item.type}`}>
        <div className="video-task-media-preview__stage" style={{ background: item.background }}>
          {item.type === 'audio' && <AudioPreviewLarge>{item.title}</AudioPreviewLarge>}
        </div>
        <strong>{item.title}</strong>
        {item.detail && <span>{item.detail}</span>}
      </div>
    </Modal>
  );
}

function ImageContent({ caption }: { caption: string }) {
  return (
    <>
      <div className="video-task-stack-shine" />
      <div className="video-task-stack-caption">{caption}</div>
    </>
  );
}

function AudioContent({ detail, title }: { detail?: string; title: string }) {
  return (
    <span className="video-task-audio-preview-inner">
      <span className="video-task-audio-play"><Play size={14} fill="currentColor" /></span>
      <span className="video-task-audio-name">{title}</span>
      <span className="video-task-audio-duration">{detail ?? '7s'}</span>
    </span>
  );
}

function AudioPreviewLarge({ children }: { children: ReactNode }) {
  return (
    <div className="video-task-media-preview__audio">
      <Play size={28} fill="currentColor" />
      <span>{children}</span>
    </div>
  );
}

function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>, onPreview: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onPreview();
}

function getFannedTransform(index: number) {
  const rotate = (index - 2) * 0.6;
  return `translate(${index * 70}px, -2px) rotate(${rotate}deg)`;
}
