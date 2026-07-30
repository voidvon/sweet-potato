import {
  estimateImageGenerationCredits,
  resolveImageGenerationOutputCount,
} from '@shared/utils/imageGenerationCredits'
import type {
  BatchExecutionStatus,
  BatchGenerationModelOption,
  BatchRow,
  CreativeCapability,
  CreativeCapabilityField,
} from '../../../api/batch-generation'
import { resolveAssetUrl } from '../../../api/request'
import type { MentionRichTextareaOption } from '../../../components/MentionRichTextarea'
import type { ContentAsset } from '../../../types'
import {
  danceRemakeDefaults,
  subjectReplaceDefaults,
  videoModelDefinitions,
} from '../shared/videoGenerationOptions'

export const MAX_REFERENCE_IMAGE_COUNT = 8
export const imageResolutionOptions = [
  { label: '1K', value: '1K' },
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
]
export const videoResolutionOptions = imageResolutionOptions
export const aspectRatioOptions = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9'].map((value) => ({ label: value, value }))
export const outputCountOptions = [1, 2, 3, 4].map((value) => ({ label: `${value} 张`, value }))
export const durationOptions = [5, 10, 15].map((value) => ({ label: `${value}s`, value: `${value}秒` }))

export const statusMeta: Record<BatchExecutionStatus, { label: string; tone: 'done' | 'processing' | 'failed' | 'pending' }> = {
  idle: { label: '待提交', tone: 'pending' },
  queued: { label: '排队中', tone: 'processing' },
  running: { label: '处理中', tone: 'processing' },
  completed: { label: '已完成', tone: 'done' },
  partial_failed: { label: '部分失败', tone: 'failed' },
  failed: { label: '失败', tone: 'failed' },
  canceled: { label: '已取消', tone: 'pending' },
}

export function valueAt(params: Record<string, unknown>, key: string) {
  const parts = key.split('.')
  let current: unknown = params
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

export type VideoSourceEstimateInput = {
  assetId: string
  cacheKey: string
  quality: string
  videoModelId: string
}

export function videoSourceEstimateInput(
  row: BatchRow,
  capabilityKey: string | undefined,
  globalParams: Record<string, unknown>,
): VideoSourceEstimateInput | undefined {
  if (!['video.dance_remake', 'video.subject_replace'].includes(capabilityKey || '')) return undefined
  const assetId = stringArray(valueAt(row.params, 'referenceVideoIds') ?? globalParams.referenceVideoIds)[0]
  if (!assetId) return undefined

  let quality: string
  let videoModelId: string
  if (capabilityKey === 'video.dance_remake') {
    const mode = valueAt(row.params, 'danceRemakeMode') ?? globalParams.danceRemakeMode
    if (mode !== 'enhanced') {
      quality = '480P'
      videoModelId = videoModelDefinitions[2].id
    } else {
      quality = String(valueAt(row.params, 'quality') ?? globalParams.quality ?? danceRemakeDefaults.quality)
      videoModelId = String(valueAt(row.params, 'videoModelId') ?? globalParams.videoModelId ?? danceRemakeDefaults.videoModelId)
    }
  } else {
    quality = String(valueAt(row.params, 'quality') ?? globalParams.quality ?? subjectReplaceDefaults.quality)
    videoModelId = String(valueAt(row.params, 'videoModelId') ?? globalParams.videoModelId ?? subjectReplaceDefaults.videoModelId)
  }
  return {
    assetId,
    cacheKey: [assetId, videoModelId, quality].join('|'),
    quality,
    videoModelId,
  }
}

export function assetAccept(field: CreativeCapabilityField) {
  if (/Video/i.test(field.key)) return 'video/*'
  if (/Audio/i.test(field.key)) return 'audio/*'
  return 'image/*'
}

export function assetLabel(field: CreativeCapabilityField) {
  if (/Video/i.test(field.key)) return '视频'
  if (/Audio/i.test(field.key)) return '音频'
  return '图片'
}

export function estimatedImageCredits(
  row: BatchRow,
  capability: CreativeCapability | undefined,
  globalParams: Record<string, unknown>,
  modelOptions: BatchGenerationModelOption[],
) {
  if (!capability || capability.mediaKind !== 'image') return undefined
  const modelConfigId = String(valueAt(row.params, 'modelConfigId') ?? globalParams.modelConfigId ?? '')
  const model = modelOptions.find((option) => option.id === modelConfigId && option.type === 'image')
  if (!model) return undefined

  const configuredOutputCount = Number(valueAt(row.params, 'outputCount') ?? globalParams.outputCount ?? 1)
  const uploadedImageCount = capability.rowFields.reduce((count, field) => {
    if (field.valueType === 'asset-list') return count + stringArray(valueAt(row.params, field.key)).length
    if (field.valueType === 'asset') return count + (valueAt(row.params, field.key) ? 1 : 0)
    return count
  }, 0)
  const outputCount = resolveImageGenerationOutputCount({
    strategy: capability.outputCountStrategy,
    requestedCount: Number.isFinite(configuredOutputCount) ? configuredOutputCount : 1,
    uploadedImageCount,
    referenceGroupImageCount: capability.outputCountGroupKey
      ? stringArray(valueAt(row.params, `referenceGroups.${capability.outputCountGroupKey}`)).length
      : 0,
  })
  return estimateImageGenerationCredits(model.creditsPerRequest, outputCount)
}

export function promptMentionOptions(
  row: BatchRow,
  capability: CreativeCapability | undefined,
  assets: Record<string, ContentAsset>,
): MentionRichTextareaOption[] {
  let imageIndex = 1
  let videoIndex = 1
  let audioIndex = 1

  return (capability?.rowFields || []).flatMap((field) => {
    if (field.valueType !== 'asset' && field.valueType !== 'asset-list') return []
    const value = valueAt(row.params, field.key)
    const ids = field.valueType === 'asset-list'
      ? stringArray(value)
      : typeof value === 'string' && value ? [value] : []

    return ids.map((id) => {
      const asset = assets[id]
      const mimeType = asset?.mimeType || (assetAccept(field) === 'video/*'
        ? 'video/*'
        : assetAccept(field) === 'audio/*' ? 'audio/*' : 'image/*')
      const isVideo = mimeType.startsWith('video/')
      const isAudio = mimeType.startsWith('audio/')
      const label = isVideo
        ? `视频${videoIndex++}`
        : isAudio ? `音频${audioIndex++}` : `图${imageIndex++}`
      return {
        attachmentId: id,
        label,
        mimeType,
        name: asset?.name || asset?.originalFileName || label,
        previewUrl: isAudio ? '' : resolveAssetUrl(asset?.fileUrl),
        subtitle: field.label,
        token: `@${label}`,
      } satisfies MentionRichTextareaOption
    })
  })
}
