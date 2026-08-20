import { CaretRightFilled } from '@ant-design/icons'
import { Image, Modal } from 'antd'
import { useState } from 'react'
import { resolveAssetUrl } from '@shared/api/core/request'
import './WorkPreviewThumbnail.scss'
import { t } from '@shared/i18n';

export type WorkPreviewMedia = {
  fileUrl: string
  coverUrl?: string
  mediaType: 'image' | 'video'
  title: string
}

type WorkPreviewThumbnailProps = WorkPreviewMedia

export function WorkPreviewThumbnail({ coverUrl, fileUrl, mediaType, title }: WorkPreviewThumbnailProps) {
  const [open, setOpen] = useState(false)
  const url = resolveAssetUrl(fileUrl)
  const posterUrl = coverUrl ? resolveAssetUrl(coverUrl) : ''

  return (
    <>
      <button
        aria-label={t("预览作品：{{0}}", { "0": title })}
        className="work-preview-thumbnail"
        onClick={() => setOpen(true)}
        type="button"
      >
        {mediaType === 'image'
          ? <img alt={title} loading="lazy" src={url} />
          : posterUrl
            ? <img alt="" aria-hidden="true" loading="lazy" src={posterUrl} />
            : <video aria-label={title} muted preload="metadata" src={url} />}
        {mediaType === 'video' ? (
          <span aria-hidden="true" className="work-preview-thumbnail__play">
            <CaretRightFilled />
          </span>
        ) : null}
      </button>
      <Modal
        centered
        destroyOnHidden
        footer={null}
        onCancel={() => setOpen(false)}
        open={open}
        title={title || t("作品预览")}
        width={820}
      >
        <div className="work-preview-modal__content">
          {mediaType === 'image'
            ? <Image alt={title} src={url} />
            : <video autoPlay controls playsInline poster={posterUrl || undefined} src={url} />}
        </div>
      </Modal>
    </>
  )
}
