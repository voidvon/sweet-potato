import type { CSSProperties, KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, X } from 'lucide-react';
import './MediaSlotStack.scss';

export type MediaSlotItem = {
  background?: string;
  caption: string;
  detail?: string;
  id: string;
  src?: string;
  title: string;
  type: 'image' | 'audio';
};

type MediaSlotStackProps = {
  activeItemId?: string | null;
  items: MediaSlotItem[];
  keepPopoverOnPreview?: boolean;
  onPreview: (item: MediaSlotItem) => void;
  onRemove: () => void;
  popoverPortal?: boolean;
  renderAudioTitle?: (item: MediaSlotItem, index: number) => string;
};

export function MediaSlotStack({
  activeItemId,
  items,
  keepPopoverOnPreview = false,
  onPreview,
  onRemove,
  popoverPortal = false,
  renderAudioTitle,
}: MediaSlotStackProps) {
  const [isPopoverSuppressed, setIsPopoverSuppressed] = useState(false);
  const [isPortalEntered, setIsPortalEntered] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [portalRect, setPortalRect] = useState({ left: 0, top: 0 });
  const closeTimerRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const type = items[0]?.type ?? 'image';
  const style = {
    '--media-stack-width': `${80 + Math.max(items.length - 1, 0) * 7}px`,
  } as CSSProperties;
  const popoverStyle = {
    left: portalRect.left,
    top: portalRect.top,
  } as CSSProperties;

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const clearEnterFrame = () => {
    if (enterFrameRef.current === null) return;
    window.cancelAnimationFrame(enterFrameRef.current);
    enterFrameRef.current = null;
  };

  const updatePortalRect = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPortalRect({ left: rect.left, top: rect.top });
  };

  const openPopover = () => {
    clearCloseTimer();
    clearEnterFrame();
    updatePortalRect();
    if (popoverPortal) {
      setIsPortalEntered(false);
      enterFrameRef.current = window.requestAnimationFrame(() => {
        enterFrameRef.current = window.requestAnimationFrame(() => {
          setIsPortalEntered(true);
          enterFrameRef.current = null;
        });
      });
    }
    setIsPopoverOpen(true);
  };

  const closePopover = () => {
    clearCloseTimer();
    clearEnterFrame();
    if (popoverPortal) {
      setIsPortalEntered(false);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setIsPopoverOpen(false);
      closeTimerRef.current = null;
    }, 140);
  };

  const preview = (item: MediaSlotItem) => {
    if (!keepPopoverOnPreview) {
      setIsPopoverSuppressed(true);
      setIsPopoverOpen(false);
    }
    onPreview(item);
  };
  const shouldRenderPortal = popoverPortal && isPopoverOpen && !isPopoverSuppressed;
  const renderPopover = (className = 'media-slot-popover is-fanned', popoverStyleValue?: CSSProperties) => (
    (() => {
      const isPortalPopover = className.includes('is-portal');
      const isCollapsed = isPortalPopover ? !isPortalEntered : !isPopoverOpen;

      return (
        <div
          className={className}
          onMouseEnter={popoverPortal ? openPopover : undefined}
          onMouseLeave={popoverPortal ? closePopover : undefined}
          style={popoverStyleValue}
        >
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
                transform: getFannedTransform(index, isCollapsed),
                zIndex: 100 + index,
              }}
              tabIndex={0}
            >
              {item.type === 'image' ? <ImageContent caption={item.caption} /> : (
                <AudioContent
                  detail={item.detail}
                  isActive={item.id === activeItemId}
                  title={renderAudioTitle?.(item, index) ?? item.title}
                />
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
      );
    })()
  );

  useEffect(() => {
    if (!shouldRenderPortal) return undefined;

    const syncPosition = () => updatePortalRect();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);

    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [shouldRenderPortal]);

  useEffect(() => () => {
    clearCloseTimer();
    clearEnterFrame();
  }, []);

  return (
    <div
      className={`video-task-stack-wrapper is-${type}-stack${isPopoverSuppressed ? ' is-popover-suppressed' : ''}`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        closePopover();
      }}
      onFocus={openPopover}
      onMouseEnter={openPopover}
      onMouseLeave={() => {
        setIsPopoverSuppressed(false);
        closePopover();
      }}
      ref={wrapperRef}
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
            <AudioContent
              detail={item.detail}
              isActive={item.id === activeItemId}
              title={renderAudioTitle?.(item, index) ?? item.title}
            />
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

      {!popoverPortal && renderPopover()}

      {shouldRenderPortal && createPortal(
        renderPopover(`media-slot-popover is-fanned is-portal${isPortalEntered ? ' is-entered' : ''}`, popoverStyle),
        document.body,
      )}
    </div>
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

function AudioContent({ detail, isActive, title }: { detail?: string; isActive?: boolean; title: string }) {
  return (
    <span className="video-task-audio-preview-inner">
      <span className={`video-task-audio-play${isActive ? ' is-playing' : ''}`}>
        {isActive ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </span>
      <span className="video-task-audio-name">{title}</span>
      <span className="video-task-audio-duration">{detail ?? '7s'}</span>
    </span>
  );
}

function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>, onPreview: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onPreview();
}

function getFannedTransform(index: number, collapsed = false) {
  if (collapsed) return `translate(${index * 7}px, 0) rotate(0deg)`;
  const rotate = (index - 2) * 0.6;
  return `translate(${index * 70}px, -2px) rotate(${rotate}deg)`;
}
