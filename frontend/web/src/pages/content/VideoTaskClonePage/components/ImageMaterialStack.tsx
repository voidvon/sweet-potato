import { Image } from 'antd';
import { useState } from 'react';
import {
  MediaSlotStack,
  type MediaSlotItem,
  type MediaSlotLeadingAdd,
} from './MediaSlotStack';

type ImageMaterialStackProps = {
  items: MediaSlotItem[];
  leadingAdd?: MediaSlotLeadingAdd;
  onRemove: (item: MediaSlotItem) => void;
};

export function ImageMaterialStack({ items, leadingAdd, onRemove }: ImageMaterialStackProps) {
  const [previewItem, setPreviewItem] = useState<MediaSlotItem | null>(null);
  const previewSrc = previewItem ? getPreviewSrc(previewItem) : '';

  return (
    <>
      <MediaSlotStack
        items={items}
        leadingAdd={leadingAdd}
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
