import { useMemo, useRef } from 'react'
import type { ColDef, ICellRendererParams, ValueSetterParams } from 'ag-grid-community'
import type {
  BatchAttempt,
  BatchGenerationModelOption,
  BatchRow,
  CreativeCapability,
  CreativeCapabilityField,
} from '../../../api/batch-generation'
import type { ContentAsset } from '../../../types'
import {
  danceRemakeDefaults,
  danceRemakeModeOptions,
  qualityOptions as sharedVideoQualityOptions,
  subjectReplaceDefaults,
  subjectReplaceTypeOptions,
  videoModelDefinitions,
} from '../shared/videoGenerationOptions'
import {
  videoAspectRatioOptions,
  videoResolutionOptions,
  type VideoAspectRatio,
  type VideoResolution,
} from '../../../components/VideoOutputSizePicker'
import {
  getImageResolutionOptions,
  imageAspectRatioOptions,
  type ImageAspectRatio,
  type ImageResolution,
} from '../../../components/ImageOutputSizePicker'
import {
  GridActionsCell,
  GridAssetCell,
  GridBooleanCell,
  GridCanvasCell,
  GridCreditsCell,
  GridPromptCell,
  GridResultCell,
  GridSelectCell,
  GridStatusCell,
  GridVideoOutputSizeCell,
} from './BatchGenerationGridCells'
import type { ActiveGridCanvas, ActiveGridSelect, ActiveGridVideoCanvas } from './batchGenerationGrid.types'
import {
  aspectRatioOptions,
  durationOptions,
  estimatedImageCredits,
  imageResolutionOptions,
  outputCountOptions,
  promptMentionOptions,
  stringArray,
  valueAt,
  videoSourceEstimateInput,
} from './batchGenerationGrid.utils'

const MAX_ROWS = 200
const videoOverrideFields: CreativeCapabilityField[] = [
  { key: 'modelConfigId', label: '模型', overridable: true, valueType: 'string' },
  { key: 'aspectRatio', label: '画面比例', overridable: true, valueType: 'string' },
  { key: 'duration', label: '时长', overridable: true, valueType: 'string' },
  { key: 'generateAudio', label: '生成配音', overridable: true, valueType: 'boolean' },
]

const danceRemakeEnhancedFields: CreativeCapabilityField[] = [
  { key: 'videoModelId', label: '模型', valueType: 'string' },
  { key: 'quality', label: '清晰度', valueType: 'string' },
  { key: 'preserveAudio', label: '保留音乐和节奏', valueType: 'boolean' },
]

const danceRemakeModelOptions = videoModelDefinitions.map((option) => ({ label: option.label, value: option.id }))
const danceRemakeQualityOptions = sharedVideoQualityOptions.map((option) => ({ label: option.label, value: option.label }))
const subjectReplaceSelectOptions = subjectReplaceTypeOptions.map((option) => ({ label: option.label, value: option.value }))
const subjectAssetFieldsByType: Record<string, string[]> = {
  background: ['subjectBackgroundImageAssetId'],
  clothing: ['subjectClothingFrontAssetId', 'subjectClothingBackAssetId'],
  face: ['subjectFaceImageAssetId'],
  model: ['subjectModelImageAssetId'],
  product: ['subjectProductImageAssetId'],
}
const subjectAssetFieldKeys = new Set(Object.values(subjectAssetFieldsByType).flat())

type UseBatchGenerationColumnsOptions = {
  activeCapability?: CreativeCapability
  assets: Record<string, ContentAsset>
  getAttempt: (rowId: string) => BatchAttempt | undefined
  globalParams: Record<string, unknown>
  modelOptions: Array<BatchGenerationModelOption & { configId?: string; disabled?: boolean }>
  onAssetReady: (asset: ContentAsset) => void
  onCopyRow: (row: BatchRow) => void
  onHideTooltip: () => void
  onOpenCanvas: (canvas: ActiveGridCanvas | null | ((current: ActiveGridCanvas | null) => ActiveGridCanvas | null)) => void
  onOpenVideoCanvas: (canvas: ActiveGridVideoCanvas | null | ((current: ActiveGridVideoCanvas | null) => ActiveGridVideoCanvas | null)) => void
  onOpenAssetUpload: (row: BatchRow, field: CreativeCapabilityField, currentCount: number, maxCount: number) => void
  onOpenPrompt: (row: BatchRow, fieldKey: string, value: string, mode: 'inline' | 'fullscreen', anchor: HTMLElement) => void
  onOpenSelect: (select: ActiveGridSelect | null | ((current: ActiveGridSelect | null) => ActiveGridSelect | null)) => void
  onPreviewAssets: (current: number, items: Array<{ alt: string; src: string }>) => void
  onUpload: (row: BatchRow, field: CreativeCapabilityField, files: File[]) => Promise<ContentAsset[]>
  onRemoveRow: (row: BatchRow) => void
  onResetCanvas: (rowId: string) => void
  onResetModel: (rowId: string) => void
  onRunRow: (row: BatchRow) => void
  onShowTooltip: (target: HTMLElement, title: string) => void
  onUpdateRow: (rowId: string, fieldKey: string, value: unknown) => void
  rows: BatchRow[]
  rowsLength: number
  uploadingCell: string
  videoUpscaleEstimates: Record<string, number>
  videoSourceEstimates: Record<string, number>
}

export function useBatchGenerationColumns({
  activeCapability,
  assets,
  getAttempt,
  globalParams,
  modelOptions,
  onAssetReady,
  onCopyRow,
  onHideTooltip,
  onOpenCanvas,
  onOpenVideoCanvas,
  onOpenAssetUpload,
  onOpenPrompt,
  onOpenSelect,
  onPreviewAssets,
  onUpload,
  onRemoveRow,
  onResetCanvas,
  onResetModel,
  onRunRow,
  onShowTooltip,
  onUpdateRow,
  rows,
  rowsLength,
  uploadingCell,
  videoUpscaleEstimates,
  videoSourceEstimates,
}: UseBatchGenerationColumnsOptions) {
  const actionsRef = useRef({
    onAssetReady,
    onCopyRow,
    onHideTooltip,
    onOpenCanvas,
    onOpenVideoCanvas,
    onOpenAssetUpload,
    onOpenPrompt,
    onOpenSelect,
    onPreviewAssets,
    onRemoveRow,
    onResetCanvas,
    onResetModel,
    onRunRow,
    onShowTooltip,
    onUpdateRow,
    onUpload,
  })
  actionsRef.current = {
    onAssetReady,
    onCopyRow,
    onHideTooltip,
    onOpenCanvas,
    onOpenVideoCanvas,
    onOpenAssetUpload,
    onOpenPrompt,
    onOpenSelect,
    onPreviewAssets,
    onRemoveRow,
    onResetCanvas,
    onResetModel,
    onRunRow,
    onShowTooltip,
    onUpdateRow,
    onUpload,
  }

  return useMemo<ColDef<BatchRow>[]>(() => {
    const hasEnhancedDanceRows = activeCapability?.key === 'video.dance_remake'
      && (globalParams.danceRemakeMode === 'enhanced'
        || rows.some((row) => valueAt(row.params, 'danceRemakeMode') === 'enhanced'))
    const subjectTypeForRow = (row: BatchRow) => {
      const rowType = valueAt(row.params, 'subjectReplaceType')
      if (subjectReplaceTypeOptions.some((option) => option.value === rowType)) return String(rowType)
      return typeof globalParams.subjectReplaceType === 'string'
        ? globalParams.subjectReplaceType
        : subjectReplaceDefaults.subjectType
    }
    const visibleSubjectTypes = new Set([
      typeof globalParams.subjectReplaceType === 'string'
        ? globalParams.subjectReplaceType
        : subjectReplaceDefaults.subjectType,
      ...rows.map(subjectTypeForRow),
    ])
    const rowFields = activeCapability?.key === 'video.subject_replace'
      ? (activeCapability.rowFields || []).filter((field) => !subjectAssetFieldKeys.has(field.key)
        || [...visibleSubjectTypes].some((type) => subjectAssetFieldsByType[type]?.includes(field.key)))
      : activeCapability?.rowFields || []
    const rowFieldKeys = new Set(rowFields.map((field) => field.key))
    const exposeVideoOverrides = activeCapability?.mediaKind === 'video'
      && activeCapability.key !== 'video.upscale'
      && activeCapability.key !== 'video.dance_remake'
      && activeCapability.key !== 'video.subject_replace'
    const capabilityGlobalFields = activeCapability?.key === 'video.dance_remake'
      ? (activeCapability.globalFields || []).filter((field) => field.key === 'danceRemakeMode' || hasEnhancedDanceRows)
      : activeCapability?.globalFields || []
    const globalFields = exposeVideoOverrides
      ? Array.from(new Map(
        [...capabilityGlobalFields, ...videoOverrideFields].map((field) => [field.key, field]),
      ).values())
      : capabilityGlobalFields
    const allOverrideFields = globalFields
      .filter((field) => (field.overridable || exposeVideoOverrides) && !rowFieldKeys.has(field.key))
      .map((field) => ({ ...field, isGlobalOverride: true }))
    const hasImageCanvas = activeCapability?.mediaKind === 'image'
      && allOverrideFields.some((field) => field.key === 'aspectRatio' || field.key === 'resolution')
    const overrideFields = hasImageCanvas
      ? allOverrideFields.filter((field) => field.key !== 'aspectRatio' && field.key !== 'resolution')
      : allOverrideFields
    const businessFields = activeCapability?.key === 'video.subject_replace'
      ? [
        ...overrideFields.filter((field) => field.key === 'subjectReplaceType'),
        ...rowFields.filter((field) => subjectAssetFieldKeys.has(field.key)),
        ...rowFields.filter((field) => !subjectAssetFieldKeys.has(field.key)),
        ...overrideFields.filter((field) => field.key !== 'subjectReplaceType'),
      ]
      : [...rowFields, ...overrideFields]
    const businessColumns: ColDef<BatchRow>[] = businessFields.map((field) => {
      const isAsset = field.valueType === 'asset-list' || field.valueType === 'asset'
      const isPrompt = field.key === 'prompt'
      const isOutfitAsset = activeCapability?.key === 'image.outfit'
        && ['referenceGroups.model', 'referenceGroups.clothes'].includes(field.key)
      const isVideoAspectRatio = activeCapability?.mediaKind === 'video' && field.key === 'aspectRatio'
      const isDanceEnhancedField = activeCapability?.key === 'video.dance_remake'
        && danceRemakeEnhancedFields.some((item) => item.key === field.key)
      const isSubjectAssetField = activeCapability?.key === 'video.subject_replace'
        && subjectAssetFieldKeys.has(field.key)
      const danceModeForRow = (row: BatchRow) => {
        const rowMode = valueAt(row.params, 'danceRemakeMode')
        if (rowMode === 'standard' || rowMode === 'enhanced') return rowMode
        return globalParams.danceRemakeMode === 'enhanced' ? 'enhanced' : 'standard'
      }
      const isFieldDisabled = (row: BatchRow) => ['queued', 'running', 'completed'].includes(row.executionStatus)
        || (isDanceEnhancedField && danceModeForRow(row) !== 'enhanced')
      const isSubjectFieldApplicable = (row: BatchRow) => !isSubjectAssetField
        || Boolean(subjectAssetFieldsByType[subjectTypeForRow(row)]?.includes(field.key))
      const initialWidth = isPrompt
        ? 560
        : isAsset
          ? 202
          : field.key === 'modelConfigId' || field.key === 'videoModelId'
            ? 180
            : field.key === 'danceRemakeMode' || field.key === 'subjectReplaceType'
              ? 140
              : field.key === 'quality'
                ? 90
                : field.key === 'preserveAudio'
                  ? 90
            : field.key === 'aspectRatio'
              ? 130
              : field.key === 'outputCount'
                ? 80
                : 300
      const effectiveValue = (row: BatchRow) => {
        if (isDanceEnhancedField && danceModeForRow(row) !== 'enhanced') return undefined
        const rowValue = valueAt(row.params, field.key)
        if (rowValue === undefined && activeCapability?.key === 'video.dance_remake') {
          if (field.key === 'danceRemakeMode') {
            return globalParams.danceRemakeMode === 'enhanced' ? 'enhanced' : 'standard'
          }
          if (field.key === 'videoModelId') {
            return typeof globalParams.videoModelId === 'string'
              ? globalParams.videoModelId
              : danceRemakeDefaults.videoModelId
          }
          if (field.key === 'quality') {
            return globalParams.quality === '480P' || globalParams.quality === '普清 (480p)' ? '480P' : '720P'
          }
          if (field.key === 'preserveAudio') return globalParams.preserveAudio ?? danceRemakeDefaults.preserveAudio
        }
        if (rowValue === undefined && activeCapability?.key === 'video.subject_replace') {
          if (field.key === 'subjectReplaceType') return subjectTypeForRow(row)
          if (field.key === 'videoModelId') {
            return typeof globalParams.videoModelId === 'string'
              ? globalParams.videoModelId
              : subjectReplaceDefaults.videoModelId
          }
          if (field.key === 'quality') {
            return globalParams.quality === '480P' || globalParams.quality === '普清 (480p)' ? '480P' : '720P'
          }
          if (field.key === 'preserveAudio') return globalParams.preserveAudio ?? subjectReplaceDefaults.preserveAudio
        }
        const fallbackValue = rowValue === undefined && 'isGlobalOverride' in field
          ? valueAt(globalParams, field.key)
          : rowValue
        if (field.key !== 'modelConfigId' || activeCapability?.mediaKind !== 'video') return fallbackValue
        const modelConfigId = String(fallbackValue ?? '')
        const rowVideoModelId = valueAt(row.params, 'videoModelId')
        const videoModelId = String(
          rowVideoModelId ?? (rowValue === undefined ? valueAt(globalParams, 'videoModelId') : '') ?? '',
        )
        return modelOptions.find((model) => model.type === 'video'
          && (model.configId || model.id) === modelConfigId
          && (!videoModelId || model.model === videoModelId))?.id || fallbackValue
      }
      const isSpecialVideoCapability = ['video.dance_remake', 'video.subject_replace']
        .includes(activeCapability?.key || '')
      const selectOptions = field.key === 'danceRemakeMode' && activeCapability?.key === 'video.dance_remake'
        ? [...danceRemakeModeOptions]
        : field.key === 'subjectReplaceType' && activeCapability?.key === 'video.subject_replace'
          ? subjectReplaceSelectOptions
          : field.key === 'videoModelId' && isSpecialVideoCapability
            ? danceRemakeModelOptions
            : field.key === 'quality' && isSpecialVideoCapability
              ? danceRemakeQualityOptions
                : field.key === 'modelConfigId'
                ? modelOptions
                  .filter((model) => model.type === activeCapability?.mediaKind)
                  .map((model) => ({
                    disabled: model.disabled,
                    label: model.name,
                    value: model.id as string | number,
                  }))
                : field.key === 'resolution' ? imageResolutionOptions
                  : field.key === 'aspectRatio' ? aspectRatioOptions
                    : field.key === 'outputCount' ? outputCountOptions
                      : field.key === 'duration' ? durationOptions
                        : []
      const selectLabels = new Map<string | number, string>(selectOptions.map((option) => [option.value, option.label]))
      const valueSetter = (params: ValueSetterParams<BatchRow>) => {
        if (!params.data) return false
        const nextValue = params.newValue === '' || params.newValue === null
          ? undefined
          : field.valueType === 'number' ? Number(params.newValue) : params.newValue
        actionsRef.current.onUpdateRow(params.data.id, field.key, nextValue)
        return true
      }

      return {
        autoHeight: isAsset || (!selectOptions.length && field.valueType === 'string'),
        cellEditor: isPrompt ? undefined
          : field.valueType === 'number' ? 'agNumberCellEditor'
            : field.valueType === 'string' ? 'agLargeTextCellEditor'
              : undefined,
        cellEditorParams: field.valueType === 'string' && !isPrompt
          ? { cols: 50, maxLength: 10000, rows: 6 }
          : undefined,
        cellEditorPopup: !isPrompt && !selectOptions.length && field.valueType === 'string',
        cellRenderer: isPrompt
          ? (params: ICellRendererParams<BatchRow>) => params.data ? (
            <GridPromptCell
              disabled={['queued', 'running', 'completed'].includes(params.data.executionStatus)}
              onFullscreen={(anchor) => actionsRef.current.onOpenPrompt(
                params.data!,
                field.key,
                String(effectiveValue(params.data!) ?? ''),
                'fullscreen',
                anchor,
              )}
              onOpen={(anchor) => actionsRef.current.onOpenPrompt(
                params.data!,
                field.key,
                String(effectiveValue(params.data!) ?? ''),
                'inline',
                anchor,
              )}
              options={promptMentionOptions(params.data, activeCapability, assets)}
              value={String(effectiveValue(params.data) ?? '')}
            />
          ) : null
          : isAsset
            ? (params: ICellRendererParams<BatchRow>) => params.data
              ? isSubjectFieldApplicable(params.data)
                ? (
                  <GridAssetCell
                    assets={assets}
                    field={field}
                    isUploading={uploadingCell === `${params.data.id}:${field.key}`}
                    onAssetReady={(asset) => actionsRef.current.onAssetReady(asset)}
                    onOpenUpload={(...args) => actionsRef.current.onOpenAssetUpload(...args)}
                    onPreview={(...args) => actionsRef.current.onPreviewAssets(...args)}
                    onUpload={(row, field, files) => actionsRef.current.onUpload(row, field, files)}
                    onUpdate={(...args) => actionsRef.current.onUpdateRow(...args)}
                    row={params.data}
                  />
                )
                : <span>-</span>
              : null
            : field.valueType === 'boolean'
              ? (params: ICellRendererParams<BatchRow>) => params.data ? (
                <GridBooleanCell
                  checked={effectiveValue(params.data) === true}
                  disabled={isFieldDisabled(params.data)}
                  onChange={(checked) => actionsRef.current.onUpdateRow(params.data!.id, field.key, checked)}
                />
              ) : null
              : isVideoAspectRatio
                ? (params: ICellRendererParams<BatchRow>) => {
                  if (!params.data) return null
                  const rowAspectRatio = valueAt(params.data.params, 'aspectRatio')
                  const rowResolution = valueAt(params.data.params, 'resolution')
                  const aspectRatio = videoAspectRatioOptions.includes(effectiveValue(params.data) as VideoAspectRatio)
                    ? effectiveValue(params.data) as VideoAspectRatio
                    : '9:16'
                  const resolution = videoResolutionOptions.includes(
                    (valueAt(params.data.params, 'resolution') ?? valueAt(globalParams, 'resolution')) as VideoResolution,
                  )
                    ? (valueAt(params.data.params, 'resolution') ?? valueAt(globalParams, 'resolution')) as VideoResolution
                    : '720P'
                  return (
                    <GridVideoOutputSizeCell
                      aspectRatio={aspectRatio}
                      disabled={['queued', 'running', 'completed'].includes(params.data.executionStatus)}
                      isOverridden={rowAspectRatio !== undefined || rowResolution !== undefined}
                      onOpen={(anchor) => {
                        const cell = anchor.closest('.ag-cell') || anchor
                        const rect = cell.getBoundingClientRect()
                        actionsRef.current.onOpenVideoCanvas((current) => {
                          if (current?.rowId === params.data!.id) return null
                          return {
                            anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                            aspectRatio,
                            resolution,
                            rowId: params.data!.id,
                          }
                        })
                      }}
                      onReset={() => actionsRef.current.onResetCanvas(params.data!.id)}
                      resolution={resolution}
                    />
                  )
                }
              : selectOptions.length
                ? (params: ICellRendererParams<BatchRow>) => params.data ? (
                  <GridSelectCell
                    disabled={isFieldDisabled(params.data)}
                    isOverridden={field.key === 'modelConfigId'
                      && activeCapability?.mediaKind === 'video'
                      ? valueAt(params.data.params, 'modelConfigId') !== undefined
                        || valueAt(params.data.params, 'videoModelId') !== undefined
                      : field.key === 'duration'
                        && activeCapability?.mediaKind === 'video'
                        && valueAt(params.data.params, 'duration') !== undefined}
                    label={selectLabels.get(effectiveValue(params.data) as string | number)
                      || String(effectiveValue(params.data) ?? '-')}
                    onOpen={(anchor) => {
                      const rect = anchor.getBoundingClientRect()
                      actionsRef.current.onOpenSelect((current) => {
                        if (current?.rowId === params.data!.id && current.fieldKey === field.key) return null
                        const rowValue = valueAt(params.data!.params, field.key)
                        return {
                          anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                          fieldKey: field.key,
                          options: selectOptions,
                          rowId: params.data!.id,
                          value: (field.key === 'modelConfigId' && activeCapability?.mediaKind === 'video' && rowValue !== undefined
                            ? effectiveValue(params.data!)
                            : field.key === 'modelConfigId' && activeCapability?.mediaKind === 'video'
                              ? rowValue
                              : effectiveValue(params.data!)) as string | number | undefined,
                        }
                      })
                    }}
                    onReset={field.key === 'modelConfigId' && activeCapability?.mediaKind === 'video'
                      ? () => actionsRef.current.onResetModel(params.data!.id)
                      : field.key === 'duration' && activeCapability?.mediaKind === 'video'
                        ? () => actionsRef.current.onUpdateRow(params.data!.id, field.key, undefined)
                        : undefined}
                  />
                ) : null
                : undefined,
        colId: field.key,
        editable: (params) => Boolean(params.data)
          && !isPrompt
          && !isAsset
          && field.valueType !== 'boolean'
          && !selectOptions.length
          && !isFieldDisabled(params.data!),
        headerName: `${isVideoAspectRatio ? '画布' : field.label}${field.required ? ' *' : ''}`,
        minWidth: isOutfitAsset
          ? 202
          : field.key === 'aspectRatio' ? 130
            : field.key === 'outputCount' ? 80
              : field.key === 'quality' || field.key === 'preserveAudio' ? 90
                : isAsset ? 180 : 140,
        valueFormatter: selectOptions.length
          ? (params) => {
            const value = params.data ? effectiveValue(params.data) : params.value
            return selectLabels.get(value as string | number) || String(value ?? '-')
          }
          : undefined,
        valueGetter: (params) => params.data ? valueAt(params.data.params, field.key) : undefined,
        valueSetter,
        initialWidth,
        width: isOutfitAsset ? 202 : field.key === 'quality' || field.key === 'preserveAudio' ? 90 : undefined,
        wrapText: field.valueType === 'string',
      }
    })

    if (hasImageCanvas) {
      const canvasColumn: ColDef<BatchRow> = {
        cellRenderer: (params: ICellRendererParams<BatchRow>) => {
          if (!params.data) return null
          const rowAspectRatio = valueAt(params.data.params, 'aspectRatio')
          const rowResolution = valueAt(params.data.params, 'resolution')
          const modelConfigId = String(valueAt(params.data.params, 'modelConfigId') ?? globalParams.modelConfigId ?? '')
          const model = modelOptions.find((option) => option.type === 'image' && option.id === modelConfigId)
          const resolutions = getImageResolutionOptions(model)
          const aspectRatioValue = String(valueAt(params.data.params, 'aspectRatio') ?? globalParams.aspectRatio ?? 'auto')
          const aspectRatio = imageAspectRatioOptions.includes(aspectRatioValue as ImageAspectRatio)
            ? aspectRatioValue as ImageAspectRatio
            : 'auto'
          const resolutionValue = String(valueAt(params.data.params, 'resolution') ?? globalParams.resolution ?? '')
          const resolution = resolutions.includes(resolutionValue as ImageResolution)
            ? resolutionValue as ImageResolution
            : resolutions[0] || '2K'
          return (
            <GridCanvasCell
              disabled={['queued', 'running', 'completed'].includes(params.data.executionStatus)}
              isOverridden={rowAspectRatio !== undefined || rowResolution !== undefined}
              label={`${aspectRatio}${resolutions.length ? ` · ${resolution}` : ''}`}
              onOpen={(anchor) => {
                const cell = anchor.closest('.ag-cell') || anchor
                const rect = cell.getBoundingClientRect()
                actionsRef.current.onOpenCanvas((current) => {
                  if (current?.rowId === params.data!.id) return null
                  return {
                    anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                    aspectRatio,
                    model,
                    resolution,
                    rowId: params.data!.id,
                  }
                })
              }}
              onReset={() => actionsRef.current.onResetCanvas(params.data!.id)}
            />
          )
        },
        colId: 'canvas',
        editable: false,
        headerName: '画布',
        minWidth: 130,
        initialWidth: 130,
      }
      const modelColumnIndex = businessFields.findIndex((field) => field.key === 'modelConfigId')
      businessColumns.splice(modelColumnIndex >= 0 ? modelColumnIndex + 1 : businessColumns.length, 0, canvasColumn)
    }

    return [
      {
        cellClass: 'batch-generation-grid-index-cell',
        colId: 'index',
        editable: false,
        headerClass: 'batch-generation-grid-index-header',
        headerName: '#',
        maxWidth: 58,
        minWidth: 48,
        pinned: 'left',
        resizable: false,
        suppressMovable: true,
        valueGetter: (params) => (params.node?.rowIndex ?? 0) + 1,
        initialWidth: 48,
      },
      ...businessColumns,
      {
        cellClass: 'batch-generation-grid-status-cell',
        cellRenderer: (params: ICellRendererParams<BatchRow>) => {
          if (!params.data) return null
          const rowStatus = params.data.executionStatus
          const status = ['queued', 'running'].includes(rowStatus)
            ? rowStatus
            : getAttempt(params.data.id)?.status || rowStatus
          return <GridStatusCell status={status} />
        },
        colId: 'status',
        editable: false,
        headerName: '状态',
        minWidth: 90,
        initialWidth: 90,
      },
      {
        autoHeight: true,
        cellRenderer: (params: ICellRendererParams<BatchRow>) => params.data ? (
          <GridResultCell
            assets={assets}
            attempt={getAttempt(params.data.id)}
            onHideTooltip={() => actionsRef.current.onHideTooltip()}
            onPreview={(...args) => actionsRef.current.onPreviewAssets(...args)}
            onShowTooltip={(...args) => actionsRef.current.onShowTooltip(...args)}
          />
        ) : null,
        colId: 'result',
        editable: false,
        headerName: '结果',
        minWidth: 120,
        initialWidth: 120,
      },
      {
        cellClass: 'batch-generation-grid-credits-cell',
        cellRenderer: (params: ICellRendererParams<BatchRow, number>) => <GridCreditsCell value={params.value ?? 0} />,
        colId: 'credits',
        editable: false,
        headerName: '消耗积分',
        minWidth: 80,
        valueGetter: (params) => params.data
          ? (activeCapability?.key === 'video.upscale'
            ? videoUpscaleEstimates[stringArray(valueAt(params.data.params, 'referenceVideoIds'))[0] || '']
            : ['completed', 'partial_failed'].includes(getAttempt(params.data.id)?.status || '')
              ? getAttempt(params.data.id)?.actualCredits
              : videoSourceEstimates[videoSourceEstimateInput(params.data, activeCapability?.key, globalParams)?.cacheKey || ''])
            ?? estimatedImageCredits(params.data, activeCapability, globalParams, modelOptions)
            ?? getAttempt(params.data.id)?.estimatedCredits
            ?? 0
          : 0,
        initialWidth: 80,
      },
      {
        cellClass: 'batch-generation-grid-actions-cell',
        cellRenderer: (params: ICellRendererParams<BatchRow>) => params.data ? (
          <GridActionsCell
            canCopy={rowsLength < MAX_ROWS}
            onCopy={(row) => actionsRef.current.onCopyRow(row)}
            onDelete={(row) => actionsRef.current.onRemoveRow(row)}
            onHideTooltip={() => actionsRef.current.onHideTooltip()}
            onRun={(row) => actionsRef.current.onRunRow(row)}
            onShowTooltip={(...args) => actionsRef.current.onShowTooltip(...args)}
            row={params.data}
          />
        ) : null,
        colId: 'actions',
        editable: false,
        headerName: '操作',
        minWidth: 120,
        pinned: 'right',
        resizable: false,
        suppressMovable: true,
        initialWidth: 120,
      },
    ]
  }, [
    activeCapability,
    assets,
    getAttempt,
    globalParams,
    modelOptions,
    onAssetReady,
    onUpload,
    rows,
    rowsLength,
    uploadingCell,
    videoSourceEstimates,
    videoUpscaleEstimates,
  ])
}
