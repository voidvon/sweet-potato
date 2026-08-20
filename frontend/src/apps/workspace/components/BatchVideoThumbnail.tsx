
import { t } from '@shared/i18n';type BatchVideoThumbnailProps = {
  alt: string
  onPreview: () => void
  src: string
}

export function BatchVideoThumbnail({ alt, onPreview, src }: BatchVideoThumbnailProps) {
  return (
    <button
      aria-label={t("预览{{0}}", { "0": alt })}
      className="batch-generation-grid-asset__preview"
      onClick={(event) => {
        event.stopPropagation()
        onPreview()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      type="button"
    >
      <video
        aria-label={alt}
        className="batch-generation-grid-asset__image"
        muted
        playsInline
        preload="metadata"
        src={src}
      />
    </button>
  )
}
