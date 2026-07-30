import type { CreativeCapabilityField, BatchRow } from '../../../api/batch-generation'
import type {
  ImageAspectRatio,
  ImageOutputModel,
  ImageResolution,
} from '../../../components/ImageOutputSizePicker'
import type {
  VideoAspectRatio,
  VideoResolution,
} from '../../../components/VideoOutputSizePicker'

export type GridAnchor = {
  height: number
  left: number
  top: number
  width: number
}

export type GridSelectOption = {
  label: string
  value: string | number
}

export type ActiveGridSelect = {
  anchor: GridAnchor
  fieldKey: string
  options: GridSelectOption[]
  rowId: string
  value?: string | number
}

export type ActiveGridCanvas = {
  anchor: GridAnchor
  aspectRatio: ImageAspectRatio
  model?: ImageOutputModel
  resolution: ImageResolution
  rowId: string
}

export type ActiveGridVideoCanvas = {
  anchor: GridAnchor
  aspectRatio: VideoAspectRatio
  resolution: VideoResolution
  rowId: string
}

export type ActiveGridTooltip = {
  anchor: GridAnchor
  title: string
}

export type ActivePromptEditor = {
  anchor: GridAnchor
  fieldKey: string
  initialValue: string
  mode: 'inline' | 'fullscreen'
  rowId: string
}

export type PendingAssetUpload = {
  field: CreativeCapabilityField
  maxCount: number
  remainingCount: number
  row: BatchRow
}

export type ActiveAssetPreview = {
  current: number
  items: Array<{ alt: string; src: string }>
}
