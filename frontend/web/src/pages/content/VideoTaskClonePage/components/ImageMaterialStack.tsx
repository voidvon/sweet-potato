import { Image } from 'antd';
import { useState } from 'react';
import { MediaSlotStack, type MediaSlotItem } from './MediaSlotStack';

type ImageMaterialStackProps = {
  items: MediaSlotItem[];
  onRemove: (item: MediaSlotItem) => void;
};

export function ImageMaterialStack({ items, onRemove }: ImageMaterialStackProps) {
  const [previewItem, setPreviewItem] = useState<MediaSlotItem | null>(null);
  const previewSrc = previewItem ? getPreviewSrc(previewItem) : '';

  return (
    <>
      <MediaSlotStack
        items={items}
        onPreview={setPreviewItem}
        onRemove={onRemove}
        popoverPortal
      />
      {previewSrc && (
        <Image
          preview={{
            open: true,
            src: previewSrc,
            onOpenChange: (open) => {
              if (!open) setPreviewItem(null);
            },
          }}
          src={previewSrc}
          style={{ display: 'none' }}
        />
      )}
    </>
  );
}

function getPreviewSrc(item: MediaSlotItem) {
  const matched = item.background?.match(/url\(["']?(.+?)["']?\)/);
  return matched?.[1] ?? '';
}
