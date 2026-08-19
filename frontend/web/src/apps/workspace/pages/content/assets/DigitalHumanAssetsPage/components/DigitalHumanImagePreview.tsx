import { Image } from 'antd'
import type { DigitalHumanAssetsController } from '../useDigitalHumanAssetsController'

export function DigitalHumanImagePreview({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <Image
      alt={controller.previewImage?.name || '照片预览'}
      preview={{
        visible: Boolean(controller.previewImage),
        onVisibleChange: (visible) => {
          if (!visible) controller.setPreviewImage(null)
        },
      }}
      src={controller.previewImage?.src}
      style={{ display: 'none' }}
    />
  )
}
