import type { CreativeCapabilityField, BatchRow } from '../../../api/batch-generation'

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
