import { CaretRightFilled } from '@ant-design/icons'
import { resolveAssetUrl } from '@shared/api/core/request'
import './WorkPreviewThumbnail.scss'

export type WorkPreviewMedia = {
  fileUrl: string
  mediaType: 'image' | 'video'
  title: string
}

type WorkPreviewThumbnailProps = WorkPreviewMedia & {
  onPreview: () => void
}

export function WorkPreviewThumbnail({ fileUrl, mediaType, onPreview, title }: WorkPreviewThumbnailProps) {
  const url = resolveAssetUrl(fileUrl)

  return (
    <button
      aria-label={`预览作品：${title}`}
      className="work-preview-thumbnail"
      onClick={onPreview}
      type="button"
    >
      {mediaType === 'image'
        ? <img alt={title} loading="lazy" src={url} />
        : <video aria-label={title} muted preload="metadata" src={url} />}
      {mediaType === 'video' ? (
        <span aria-hidden="true" className="work-preview-thumbnail__play">
          <CaretRightFilled />
        </span>
      ) : null}
    </button>
  )
}
