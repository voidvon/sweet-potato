import { Image } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
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
};

type ImageAttachmentStackStyle = CSSProperties & {
  '--image-stack-transform'?: string;
  '--image-stack-z-index'?: number;
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
}: ImageAttachmentStackProps) {
  if (layout === 'grid') {
    const gridClassName = [
      'image-attachment-grid',
      `image-attachment-grid-${Math.min(attachments.length, 5)}`,
      className,
    ].filter(Boolean).join(' ');

    return (
      <div className={gridClassName}>
        {attachments.map((attachment, index) => {
          const image = (
            <Image
              alt={attachment.name}
              className="image-attachment-grid-image"
              height="100%"
              preview={false}
              src={resolveAssetUrl(attachment.url)}
              style={{ objectFit: 'contain' }}
              width="100%"
            />
          );

          if (onPreview) {
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
    .map((attachment, index) => ({ attachment, number: index + 1, originalIndex: index }))
    .slice(-maxVisible);
  const stackClassName = ['image-attachment-stack', className].filter(Boolean).join(' ');

  return (
    <div className={stackClassName}>
      {visibleImages.map(({ attachment, number, originalIndex }, index) => {
        const isTopImage = index === visibleImages.length - 1;
        const content = (
          <>
            <span className="image-attachment-stack-shadow" />
            <span className="image-attachment-stack-frame">
              {isTopImage ? (
                <span className="image-attachment-stack-index">图{number}</span>
              ) : null}
              {isTopImage && renderTopAction ? renderTopAction(attachment) : null}
            </span>
            <span className="image-attachment-stack-mask">
              <Image
                alt={attachment.name}
                className="image-attachment-stack-image"
                height="100%"
                preview={false}
                src={resolveAssetUrl(attachment.url)}
                style={{ objectFit: 'cover' }}
                width="100%"
              />
            </span>
          </>
        );
        const style = {
          '--image-stack-transform': stackTransforms[index],
          '--image-stack-z-index': index + 1,
        } as ImageAttachmentStackStyle;

        if (onPreview) {
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
