import { FilePdfOutlined } from '@ant-design/icons';
import { ImageOff, LoaderCircle, Pause, Play, Plus, X } from 'lucide-react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import './MediaAttachmentStack.scss';

export type MediaAttachmentItem = {
  background?: string;
  caption?: string;
  detail?: string;
  id: string;
  name: string;
  previewSrc?: string;
  src?: string;
  status?: 'uploading';
  type: 'image' | 'video' | 'audio' | 'file';
  previewable?: boolean;
};

export type MediaAttachmentLeadingAdd = {
  ariaLabel: string;
  onClick: () => void;
};

export type MediaAttachmentLayout = 'rotated' | 'offset';

export type MediaAttachmentStackProps = {
  activeItemId?: string | null;
  className?: string;
  collapsedActionVisibility?: 'all' | 'top';
  collapsedCaptionVisibility?: 'all' | 'top';
  expandOnHover?: boolean;
  items: MediaAttachmentItem[];
  keepExpandedOnPreview?: boolean;
  layout?: MediaAttachmentLayout;
  leadingAdd?: MediaAttachmentLeadingAdd;
  maxCollapsedVisible?: number;
  onPreview?: (item: MediaAttachmentItem, index: number) => void;
  onRemove?: (item: MediaAttachmentItem, index: number) => void;
  renderAction?: (item: MediaAttachmentItem, index: number) => ReactNode;
  renderAudioTitle?: (item: MediaAttachmentItem, index: number) => string;
};

type StackStyle = CSSProperties & {
  '--media-attachment-expanded-width': string;
  '--media-attachment-left'?: string;
  '--media-attachment-stack-width': string;
  '--media-attachment-top'?: string;
};

const rotatedTransforms = [
  'translate(0px, 0px) rotate(-1deg)',
  'translate(7px, -3px) rotate(3deg)',
  'translate(14px, -6px) rotate(-3deg)',
  'translate(21px, -9px) rotate(3deg)',
  'translate(28px, -12px) rotate(-3deg)',
];

export function MediaAttachmentStack({
  activeItemId,
  className,
  collapsedActionVisibility = 'all',
  collapsedCaptionVisibility = 'all',
  expandOnHover = true,
  items,
  keepExpandedOnPreview = false,
  layout = 'offset',
  leadingAdd,
  maxCollapsedVisible,
  onPreview,
  onRemove,
  renderAction,
  renderAudioTitle,
}: MediaAttachmentStackProps) {
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const [isCollapsing, setIsCollapsing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPreviewResetting, setIsPreviewResetting] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const layerTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const collapsedItemCount = maxCollapsedVisible
    ? Math.min(items.length, maxCollapsedVisible)
    : items.length;
  const collapsedStartIndex = items.length - collapsedItemCount;
  const stackEntries = items.map((item, originalIndex) => ({
    collapsedIndex: originalIndex - collapsedStartIndex,
    item,
    originalIndex,
  }));
  const leadingOffset = leadingAdd ? 1 : 0;
  const stackWidth = 80 + Math.max(collapsedItemCount - 1, 0) * 7;
  const expandedWidth = 80 + Math.max(stackEntries.length + leadingOffset - 1, 0) * 70;
  const style = {
    '--media-attachment-expanded-width': `${expandedWidth}px`,
    '--media-attachment-stack-width': `${stackWidth}px`,
  } as StackStyle;

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const clearLayerTimer = () => {
    if (layerTimerRef.current === null) return;
    window.clearTimeout(layerTimerRef.current);
    layerTimerRef.current = null;
  };

  const clearOpenFrame = () => {
    if (openFrameRef.current === null) return;
    window.cancelAnimationFrame(openFrameRef.current);
    openFrameRef.current = null;
  };

  const clearPreviewFrame = () => {
    if (previewFrameRef.current === null) return;
    window.cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
  };

  const syncTopLayerPosition = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper || wrapper.matches(':popover-open')) return;
    const rect = wrapper.getBoundingClientRect();
    wrapper.style.setProperty('--media-attachment-left', `${rect.left}px`);
    wrapper.style.setProperty('--media-attachment-top', `${rect.top}px`);
  };

  const enterTopLayer = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper || wrapper.matches(':popover-open')) return;
    syncTopLayerPosition();
    wrapper.setAttribute('popover', 'manual');
    wrapper.showPopover();
  };

  const leaveTopLayer = () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (wrapper.matches(':popover-open')) wrapper.hidePopover();
    wrapper.removeAttribute('popover');
    wrapper.style.removeProperty('--media-attachment-left');
    wrapper.style.removeProperty('--media-attachment-top');
  };

  const openStack = () => {
    if (!expandOnHover) return;
    clearCloseTimer();
    clearLayerTimer();
    clearOpenFrame();
    clearPreviewFrame();
    wrapperRef.current?.classList.remove('is-preview-hidden');
    setIsCollapsing(false);
    setIsPreviewResetting(false);
    enterTopLayer();
    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsExpanded(true);
      openFrameRef.current = null;
    });
  };

  const closeStack = () => {
    if (!expandOnHover) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      const wrapper = wrapperRef.current;
      if (wrapper?.matches(':hover') || wrapper?.matches(':focus-within')) {
        setIsCollapsing(false);
        setIsExpanded(true);
        closeTimerRef.current = null;
        return;
      }
      setIsCollapsing(true);
      setIsExpanded(false);
      closeTimerRef.current = null;
      layerTimerRef.current = window.setTimeout(() => {
        setIsCollapsing(false);
        leaveTopLayer();
        layerTimerRef.current = null;
      }, 420);
    }, 140);
  };

  const preview = (item: MediaAttachmentItem, index: number) => {
    if (!keepExpandedOnPreview) {
      const wrapper = wrapperRef.current;
      clearCloseTimer();
      clearLayerTimer();
      clearOpenFrame();
      clearPreviewFrame();
      wrapper?.classList.add('is-preview-hidden');
      setIsCollapsing(false);
      setIsExpanded(false);
      setIsPreviewResetting(true);
      leaveTopLayer();
      previewFrameRef.current = window.requestAnimationFrame(() => {
        previewFrameRef.current = window.requestAnimationFrame(() => {
          setIsPreviewResetting(false);
          wrapper?.classList.remove('is-preview-hidden');
          previewFrameRef.current = null;
        });
      });
    }
    onPreview?.(item, index);
  };

  const markUnavailable = (source: string) => {
    setFailedSources((current) => {
      if (current.has(source)) return current;
      const next = new Set(current);
      next.add(source);
      return next;
    });
  };

  const showExpandedLayout = expandOnHover && isExpanded;

  const renderItem = (
    item: MediaAttachmentItem,
    visibleIndex: number,
    collapsedHidden: boolean,
    expanded: boolean,
    keepVisibleWhileCollapsing: boolean,
    itemStyle: CSSProperties,
    originalIndex: number,
  ) => {
    const sourceKey = item.src || item.id;
    const canPreview = Boolean(onPreview && item.previewable !== false);
    const unavailable = failedSources.has(sourceKey);
    const showAction = expanded
      || collapsedActionVisibility === 'all'
      || visibleIndex === stackEntries.length - 1;
    const showCaption = expanded
      || collapsedCaptionVisibility === 'all'
      || visibleIndex === stackEntries.length - 1;
    const action = showAction
      ? renderAction?.(item, originalIndex) ?? (onRemove ? (
        <button
          aria-label={`删除${item.name}`}
          className="media-attachment-stack__delete"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item, originalIndex);
          }}
          type="button"
        >
          <X size={14} />
        </button>
        ) : null)
      : null;

    return (
      <div
        aria-label={canPreview ? `预览${item.name}` : undefined}
        className={`media-attachment-stack__item is-${item.type}${expanded ? ' is-expanded' : ''}${collapsedHidden && !expanded && !keepVisibleWhileCollapsing ? ' is-collapsed-hidden' : ''}${canPreview ? ' is-clickable' : ''}`}
        key={item.id}
        onClick={canPreview ? () => preview(item, originalIndex) : undefined}
        onKeyDown={canPreview
          ? (event) => handlePreviewKeyDown(event, () => preview(item, originalIndex))
          : undefined}
        role={canPreview ? 'button' : undefined}
        style={{ background: item.background, ...itemStyle }}
        tabIndex={canPreview ? 0 : undefined}
      >
        {item.type === 'image' ? (
          unavailable ? <UnavailableContent /> : (
            <>
              {item.src ? (
                <img
                  alt={item.name}
                  onError={() => markUnavailable(sourceKey)}
                  src={item.src}
                />
              ) : null}
              {showCaption && item.caption ? <span className="media-attachment-stack__caption">{item.caption}</span> : null}
              {item.status === 'uploading' ? (
                <span aria-label="图片上传中" className="media-attachment-stack__uploading">
                  <LoaderCircle size={15} />
                </span>
              ) : null}
            </>
          )
        ) : item.type === 'video' ? (
          <>
            {item.src ? <video muted playsInline preload="metadata" src={item.src} /> : null}
            <span className="media-attachment-stack__video-play"><Play fill="currentColor" size={14} /></span>
            {showCaption && item.caption ? <span className="media-attachment-stack__caption">{item.caption}</span> : null}
          </>
        ) : item.type === 'file' ? (
          <span className="media-attachment-stack__file">
            <FilePdfOutlined aria-hidden="true" />
            {showCaption && item.caption ? <span className="media-attachment-stack__caption">{item.caption}</span> : null}
          </span>
        ) : (
          <span className="media-attachment-stack__audio">
            <span className={`media-attachment-stack__audio-play${item.id === activeItemId ? ' is-playing' : ''}`}>
              {item.id === activeItemId
                ? <Pause fill="currentColor" size={14} />
                : <Play fill="currentColor" size={14} />}
            </span>
            <span className="media-attachment-stack__audio-name">
              {renderAudioTitle?.(item, originalIndex) ?? item.name}
            </span>
            <span className="media-attachment-stack__audio-duration">{item.detail ?? '7s'}</span>
          </span>
        )}
        {action}
      </div>
    );
  };

  useEffect(() => () => {
    clearCloseTimer();
    clearLayerTimer();
    clearOpenFrame();
    clearPreviewFrame();
    leaveTopLayer();
  }, []);

  const expandedOffsetY = layout === 'rotated' ? 0 : -2;
  const rotateExpandedItems = layout !== 'rotated' || stackEntries.length > 1;

  return (
    <div className="media-attachment-stack-anchor" style={style}>
      <div
        className={[
          'media-attachment-stack',
          `is-${layout}`,
          showExpandedLayout ? 'is-expanded' : '',
          isPreviewResetting ? 'is-preview-hidden' : '',
          className,
        ].filter(Boolean).join(' ')}
        onBlur={expandOnHover ? (event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          closeStack();
        } : undefined}
        onFocus={expandOnHover ? openStack : undefined}
        onMouseEnter={expandOnHover ? openStack : undefined}
        onMouseLeave={expandOnHover ? closeStack : undefined}
        ref={wrapperRef}
        style={style}
      >
        {showExpandedLayout && stackEntries.length + leadingOffset > 1
          ? <span aria-hidden="true" className="media-attachment-stack__hit-area" />
          : null}
        {leadingAdd ? (
          <button
            aria-label={leadingAdd.ariaLabel}
            className={`media-attachment-stack__item is-leading-add${showExpandedLayout ? ' is-expanded' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              leadingAdd.onClick();
            }}
            style={{
              transform: showExpandedLayout
                ? expandedTransform(0, expandedOffsetY, rotateExpandedItems)
                : collapsedTransform(layout, 0, collapsedItemCount),
              zIndex: showExpandedLayout ? 100 : 0,
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={26} strokeWidth={1.6} />
          </button>
        ) : null}
        {stackEntries.map(({ collapsedIndex, item, originalIndex }, index) => renderItem(
          item,
          index,
          collapsedIndex < 0,
          showExpandedLayout,
          isCollapsing,
          {
            transform: showExpandedLayout
              ? expandedTransform(index + leadingOffset, expandedOffsetY, rotateExpandedItems)
              : collapsedTransform(layout, Math.max(collapsedIndex, 0), collapsedItemCount),
            zIndex: showExpandedLayout ? 100 + index + leadingOffset : Math.max(collapsedIndex, 0) + 1,
          },
          originalIndex,
        ))}
      </div>
    </div>
  );
}

function collapsedTransform(layout: MediaAttachmentLayout, index: number, itemCount: number) {
  if (layout === 'rotated') {
    if (itemCount === 1) return 'translate(0px, 0px) rotate(0deg)';
    return rotatedTransforms[index] ?? `translate(${index * 7}px, ${index * -3}px) rotate(${index % 2 ? 3 : -3}deg)`;
  }
  return `translate(${index * 7}px, 0)`;
}

function expandedTransform(index: number, offsetY: number, rotateItems: boolean) {
  const rotate = rotateItems ? (index - 2) * 0.6 : 0;
  return `translate(${index * 70}px, ${offsetY}px) rotate(${rotate}deg)`;
}

function handlePreviewKeyDown(event: KeyboardEvent<HTMLDivElement>, onPreview: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  onPreview();
}

function UnavailableContent() {
  return (
    <span className="media-attachment-stack__unavailable">
      <ImageOff aria-hidden="true" size={18} strokeWidth={1.7} />
      <span>已清理或过期</span>
    </span>
  );
}
