import { Image } from 'antd';
import { useState } from 'react';
import {
  MediaAttachmentStack,
  type MediaAttachmentItem,
  type MediaAttachmentLeadingAdd,
} from '../../../../components/MediaAttachmentStack';

type ImageMaterialStackProps = {
  items: MediaAttachmentItem[];
  leadingAdd?: MediaAttachmentLeadingAdd;
  onRemove: (item: MediaAttachmentItem) => void;
};

export function ImageMaterialStack({ items, leadingAdd, onRemove }: ImageMaterialStackProps) {
  const [previewItem, setPreviewItem] = useState<MediaAttachmentItem | null>(null);
  const previewSrc = previewItem ? getPreviewSrc(previewItem) : '';

  return (
    <>
      <MediaAttachmentStack
        items={items}
        layout="offset"
        leadingAdd={leadingAdd}
        onPreview={setPreviewItem}
        onRemove={onRemove}
      />
      {previewSrc && (
        <span className="media-attachment-preview-host">
          <Image
            preview={{
              open: true,
              src: previewSrc,
              onOpenChange: (open) => {
                if (!open) setPreviewItem(null);
              },
            }}
            src={previewSrc}
          />
        </span>
      )}
    </>
  );
}

function getPreviewSrc(item: MediaAttachmentItem) {
  if (item.previewSrc || item.src) return item.previewSrc || item.src || '';
  const matched = item.background?.match(/url\(["']?(.+?)["']?\)/);
  return matched?.[1] ?? '';
}
