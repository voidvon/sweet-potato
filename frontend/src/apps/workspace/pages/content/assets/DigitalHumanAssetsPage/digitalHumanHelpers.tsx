import { Image, Spin, message } from 'antd'
import type { UploadFile } from 'antd'
import type { ContentAsset } from '../../../../types'
import { API_BASE_URL } from '../../../../api/request'
import { t } from '@shared/i18n';

export function fileUrl(asset: ContentAsset) {
  const localMirrorUrl = metadataUrl(asset, 'localMirrorUrl')
  if (asset.resourceType === 'virtual_portrait' && localMirrorUrl) {
    return `${API_BASE_URL}${localMirrorUrl.startsWith('/') ? localMirrorUrl : `/${localMirrorUrl}`}`
  }
  if (!asset.fileUrl) return ''
  if (/^(blob:|data:|https?:\/\/)/i.test(asset.fileUrl)) return asset.fileUrl
  return `${API_BASE_URL}${asset.fileUrl.startsWith('/') ? asset.fileUrl : `/${asset.fileUrl}`}`
}

function metadataUrl(asset: ContentAsset, key: string) {
  const value = asset.metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function previewUrl(asset: ContentAsset) {
  return fileUrl(asset) || metadataUrl(asset, 'remotePreviewUrl')
}

export function formatDate(value: string) {
  return value ? value.slice(0, 10) : ''
}

export function isThreeViewResult(asset: ContentAsset) {
  if (
    asset.metadata?.kind === 'three_view_failure' ||
    asset.metadata?.kind === 'three_view_running'
  )
    return false
  return (
    asset.metadata?.kind === 'three_view_result' ||
    /三视图|多视图|成品|结果|three[-_ ]?view/i.test(
      `${asset.name} ${asset.description}`,
    )
  )
}

export function isThreeViewFailure(asset: ContentAsset) {
  return asset.metadata?.kind === 'three_view_failure'
}

export function isThreeViewRunning(asset: ContentAsset) {
  return asset.metadata?.kind === 'three_view_running'
}

export function threeViewFailureReason(asset: ContentAsset | undefined) {
  const reason = asset?.metadata?.failureReason
  return typeof reason === 'string' && reason.trim()
    ? reason
    : asset?.description
}

export function photoPreview(asset?: ContentAsset) {
  return asset?.mimeType.startsWith('image/') ? (
    <img alt={asset.name} src={previewUrl(asset)} />
  ) : (
    <span>👤</span>
  )
}

export function localUploadFileList(files: File[]) {
  return files.map<UploadFile>((file) => ({
    uid: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    status: 'done',
    originFileObj: file as UploadFile['originFileObj'],
  }))
}

export function filesFromUploadList(fileList: UploadFile[]) {
  return fileList.reduce<File[]>((files, item) => {
    if (item.originFileObj) files.push(item.originFileObj as File)
    return files
  }, [])
}

export async function downloadAsset(
  asset: ContentAsset,
  groupName: string,
  label = t('数字人'),
) {
  const url = fileUrl(asset)
  const extension = asset.originalFileName.includes('.')
    ? asset.originalFileName.slice(asset.originalFileName.lastIndexOf('.'))
    : '.png'
  const time = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
  const fileName = t("{{0}}三视图-{{1}}-{{2}}{{3}}", { "0": label, "1": safeDownloadName(groupName), "2": time, "3": extension })
  browserDownload(url, fileName)
}

function browserDownload(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function safeDownloadName(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || t("未命名")
  )
}

export function DigitalHumanResultPreview({
  asset,
  failureReason,
  isGenerating,
}: {
  asset: ContentAsset | undefined
  failureReason: string | undefined
  isGenerating: boolean
}) {
  if (isGenerating) {
    return (
      <div className="digital-human-result-generating">
        <Spin size="large" />
        <strong>{t("图片生成中")}</strong>
        <span>
          {t("模型正在合成三视图，可能需要几十秒到数分钟，您可以关闭弹窗，稍后再查看。")}
        </span>
      </div>
    )
  }
  if (failureReason) {
    return (
      <div className="digital-human-result-failed">
        <strong>{t("三视图生成失败")}</strong>
        <span>{failureReason}</span>
      </div>
    )
  }
  return asset ? (
    <div className="digital-human-result-wrapper">
      <Image
        alt={asset.name}
        className="digital-human-result-image"
        preview={{
          mask: false,
          rootClassName: 'digital-human-preview-root',
          src: previewUrl(asset),
        }}
        src={previewUrl(asset)}
      />
    </div>
  ) : null
}
