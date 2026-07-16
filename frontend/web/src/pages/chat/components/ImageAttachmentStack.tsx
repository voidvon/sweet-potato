import { Image } from 'antd';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { ChatAttachment } from '../../../types';
import { resolveAssetUrl } from '../../../api/request';
import './ImageAttachmentStack.scss';

type ImageAttachmentStackProps = {
  attachments: ChatAttachment[];
  className?: string;
  layout?: 'stack' | 'grid';
  maxVisible?: number;
  onPreview?: (attachment: ChatAttachment, index: number) => void;
  renderTopAction?: (attachment: ChatAttachment) => ReactNode;
  startIndex?: number;
};

type ImageAttachmentStackStyle = CSSProperties & {
  '--image-stack-transform'?: string;
  '--image-stack-z-index'?: number;
  '--image-stack-width'?: string;
};

const defaultMaxVisible = 5;
const stackTransforms = [
  'translate(0px, 0px) rotate(-1deg)',
  'translate(7px, -3px) rotate(3deg)',
  'translate(14px, -6px) rotate(-3deg)',
  'translate(21px, -9px) rotate(3deg)',
  'translate(28px, -12px) rotate(-3deg)',
];

export function ImageAttachmentStack({
  attachments,
  className,
  layout = 'stack',
  maxVisible = defaultMaxVisible,
  onPreview,
  renderTopAction,
  startIndex = 1,
}: ImageAttachmentStackProps) {
  const [loadedImageUrls, setLoadedImageUrls] = useState<Set<string>>(() => new Set());
  const [unavailableImageUrls, setUnavailableImageUrls] = useState<Set<string>>(() => new Set());

  function imageUrl(attachment: ChatAttachment) {
    return attachment.previewUrl || attachment.url;
  }

  function markImageUnavailable(attachment: ChatAttachment) {
    const url = imageUrl(attachment);
    setUnavailableImageUrls((current) => {
      if (current.has(url)) {
        return current;
      }
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  function markImageLoaded(attachment: ChatAttachment) {
    const url = imageUrl(attachment);
    setLoadedImageUrls((current) => {
      if (current.has(url)) {
        return current;
      }
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  function imageClassName(baseClassName: string, attachment: ChatAttachment) {
    return [
      baseClassName,
      loadedImageUrls.has(imageUrl(attachment)) ? '' : 'image-attachment-image-pending',
    ].filter(Boolean).join(' ');
  }

  function unavailableImage() {
    return (
      <span className="image-attachment-unavailable">
        <ImageOff aria-hidden="true" size={18} strokeWidth={1.7} />
        <span>已清理或过期</span>
      </span>
    );
  }

  if (layout === 'grid') {
    const gridClassName = [
      'image-attachment-grid',
      `image-attachment-grid-${Math.min(attachments.length, 5)}`,
      className,
    ].filter(Boolean).join(' ');

    return (
      <div className={gridClassName}>
        {attachments.map((attachment, index) => {
          const unavailable = unavailableImageUrls.has(imageUrl(attachment));
          const image = unavailable ? unavailableImage() : (
            <Image
              alt={attachment.name}
              className={imageClassName('image-attachment-grid-image', attachment)}
              height="100%"
              onError={() => markImageUnavailable(attachment)}
              onLoad={() => markImageLoaded(attachment)}
              preview={false}
              src={resolveAssetUrl(imageUrl(attachment))}
              style={{ objectFit: 'contain' }}
              width="100%"
            />
          );

          if (onPreview && !unavailable) {
            return (
              <span
                aria-label={`预览图${index + 1}`}
                className="image-attachment-grid-item is-clickable"
                key={attachment.id}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPreview(attachment, index);
                  }
                }}
                onClick={() => onPreview(attachment, index)}
                role="button"
                tabIndex={0}
              >
                {image}
              </span>
            );
          }

          return (
            <span className="image-attachment-grid-item" key={attachment.id}>
              {image}
            </span>
          );
        })}
      </div>
    );
  }

  const visibleImages = attachments
    .map((attachment, index) => ({ attachment, number: startIndex + index, originalIndex: index }))
    .slice(-maxVisible);
  const stackClassName = ['image-attachment-stack', className].filter(Boolean).join(' ');
  const stackWidth = visibleImages.length
    ? `${80 + Math.max(0, visibleImages.length - 1) * 7}px`
    : '80px';

  return (
    <div className={stackClassName} style={{ '--image-stack-width': stackWidth } as ImageAttachmentStackStyle}>
      {visibleImages.map(({ attachment, number, originalIndex }, index) => {
        const isTopImage = index === visibleImages.length - 1;
        const unavailable = unavailableImageUrls.has(imageUrl(attachment));
        const content = (
          <>
            <span className="image-attachment-stack-shadow" />
            <span className="image-attachment-stack-frame">
              {isTopImage ? (
                <span className="image-attachment-stack-index">图{number}</span>
              ) : null}
              {isTopImage && renderTopAction ? renderTopAction(attachment) : null}
              {attachment.uploadStatus === 'uploading' ? (
                <span aria-label="图片上传中" className="image-attachment-uploading">
                  <LoaderCircle size={15} />
                </span>
              ) : null}
            </span>
            <span className="image-attachment-stack-mask">
              {unavailable ? unavailableImage() : (
                <Image
                  alt={attachment.name}
                  className={imageClassName('image-attachment-stack-image', attachment)}
                  height="100%"
                  onError={() => markImageUnavailable(attachment)}
                  onLoad={() => markImageLoaded(attachment)}
                  preview={false}
                  src={resolveAssetUrl(imageUrl(attachment))}
                  style={{ objectFit: 'cover' }}
                  width="100%"
                />
              )}
            </span>
          </>
        );
        const style = {
          '--image-stack-transform': stackTransforms[index],
          '--image-stack-z-index': index + 1,
        } as ImageAttachmentStackStyle;

        if (onPreview && !unavailable) {
          return (
            <span
              aria-label={`预览图${number}`}
              className="image-attachment-stack-item is-clickable"
              key={attachment.id}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPreview(attachment, originalIndex);
                }
              }}
              onClick={() => onPreview(attachment, originalIndex)}
              role="button"
              style={style}
              tabIndex={0}
            >
              {content}
            </span>
          );
        }

        return (
          <span
            className="image-attachment-stack-item"
            key={attachment.id}
            style={style}
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}
