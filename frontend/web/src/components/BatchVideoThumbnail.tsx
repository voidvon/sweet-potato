type BatchVideoThumbnailProps = {
  alt: string
  onPreview: () => void
  src: string
}

export function BatchVideoThumbnail({ alt, onPreview, src }: BatchVideoThumbnailProps) {
  return (
    <button
      aria-label={`预览${alt}`}
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
