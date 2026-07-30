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
import type { ActiveGridCanvas, ActiveGridSelect } from './batchGenerationGrid.types'
import {
  aspectRatioOptions,
  durationOptions,
  estimatedImageCredits,
  imageResolutionOptions,
  outputCountOptions,
  promptMentionOptions,
  valueAt,
} from './batchGenerationGrid.utils'

const MAX_ROWS = 200
const videoOverrideFields: CreativeCapabilityField[] = [
  { key: 'modelConfigId', label: '模型', overridable: true, valueType: 'string' },
  { key: 'aspectRatio', label: '画面比例', overridable: true, valueType: 'string' },
  { key: 'duration', label: '时长', overridable: true, valueType: 'string' },
  { key: 'generateAudio', label: '生成配音', overridable: true, valueType: 'boolean' },
]

type UseBatchGenerationColumnsOptions = {
  activeCapability?: CreativeCapability
  assets: Record<string, ContentAsset>
  getAttempt: (rowId: string) => BatchAttempt | undefined
  globalParams: Record<string, unknown>
  modelOptions: BatchGenerationModelOption[]
  onAssetReady: (asset: ContentAsset) => void
  onCopyRow: (row: BatchRow) => void
  onHideTooltip: () => void
  onOpenCanvas: (canvas: ActiveGridCanvas | null | ((current: ActiveGridCanvas | null) => ActiveGridCanvas | null)) => void
  onOpenAssetUpload: (row: BatchRow, field: CreativeCapabilityField, currentCount: number, maxCount: number) => void
  onOpenPrompt: (row: BatchRow, fieldKey: string, value: string, mode: 'inline' | 'fullscreen', anchor: HTMLElement) => void
  onOpenSelect: (select: ActiveGridSelect | null | ((current: ActiveGridSelect | null) => ActiveGridSelect | null)) => void
  onPreviewAssets: (current: number, items: Array<{ alt: string; src: string }>) => void
  onUpload: (row: BatchRow, field: CreativeCapabilityField, files: File[]) => Promise<ContentAsset[]>
  onRemoveRow: (row: BatchRow) => void
  onRunRow: (row: BatchRow) => void
  onShowTooltip: (target: HTMLElement, title: string) => void
  onUpdateRow: (rowId: string, fieldKey: string, value: unknown) => void
  rowsLength: number
  uploadingCell: string
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
  onOpenAssetUpload,
  onOpenPrompt,
  onOpenSelect,
  onPreviewAssets,
  onUpload,
  onRemoveRow,
  onRunRow,
  onShowTooltip,
  onUpdateRow,
  rowsLength,
  uploadingCell,
}: UseBatchGenerationColumnsOptions) {
  const actionsRef = useRef({
    onCopyRow,
    onHideTooltip,
    onOpenCanvas,
    onOpenAssetUpload,
    onOpenPrompt,
    onOpenSelect,
    onPreviewAssets,
    onRemoveRow,
    onRunRow,
    onShowTooltip,
    onUpdateRow,
  })
  actionsRef.current = {
    onCopyRow,
    onHideTooltip,
    onOpenCanvas,
    onOpenAssetUpload,
    onOpenPrompt,
    onOpenSelect,
    onPreviewAssets,
    onRemoveRow,
    onRunRow,
    onShowTooltip,
    onUpdateRow,
  }

  return useMemo<ColDef<BatchRow>[]>(() => {
    const rowFields = activeCapability?.rowFields || []
    const rowFieldKeys = new Set(rowFields.map((field) => field.key))
    const exposeVideoOverrides = activeCapability?.mediaKind === 'video'
    const globalFields = exposeVideoOverrides
      ? Array.from(new Map(
        [...(activeCapability?.globalFields || []), ...videoOverrideFields].map((field) => [field.key, field]),
      ).values())
      : activeCapability?.globalFields || []
    const allOverrideFields = globalFields
      .filter((field) => (field.overridable || exposeVideoOverrides) && !rowFieldKeys.has(field.key))
      .map((field) => ({ ...field, isGlobalOverride: true }))
    const hasImageCanvas = activeCapability?.mediaKind === 'image'
      && allOverrideFields.some((field) => field.key === 'aspectRatio' || field.key === 'resolution')
    const overrideFields = hasImageCanvas
      ? allOverrideFields.filter((field) => field.key !== 'aspectRatio' && field.key !== 'resolution')
      : allOverrideFields
    const businessFields = [...rowFields, ...overrideFields]
    const businessColumns: ColDef<BatchRow>[] = businessFields.map((field) => {
      const isAsset = field.valueType === 'asset-list' || field.valueType === 'asset'
      const isPrompt = field.key === 'prompt'
      const isOutfitAsset = activeCapability?.key === 'image.outfit'
        && ['referenceGroups.model', 'referenceGroups.clothes'].includes(field.key)
      const isVideoAspectRatio = activeCapability?.mediaKind === 'video' && field.key === 'aspectRatio'
      const initialWidth = isPrompt
        ? 560
        : isAsset
          ? 202
          : field.key === 'modelConfigId'
            ? 180
            : field.key === 'aspectRatio'
              ? 130
              : field.key === 'outputCount'
                ? 80
                : 300
      const effectiveValue = (row: BatchRow) => {
        const rowValue = valueAt(row.params, field.key)
        return rowValue === undefined && 'isGlobalOverride' in field
          ? valueAt(globalParams, field.key)
          : rowValue
      }
      const selectOptions = field.key === 'modelConfigId'
        ? modelOptions
          .filter((model) => model.type === activeCapability?.mediaKind)
          .map((model) => ({ label: model.name, value: model.id as string | number }))
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
            ? (params: ICellRendererParams<BatchRow>) => params.data ? (
              <GridAssetCell
                assets={assets}
                field={field}
                isUploading={uploadingCell === `${params.data.id}:${field.key}`}
                onAssetReady={onAssetReady}
                onOpenUpload={(...args) => actionsRef.current.onOpenAssetUpload(...args)}
                onPreview={(...args) => actionsRef.current.onPreviewAssets(...args)}
                onUpload={onUpload}
                onUpdate={(...args) => actionsRef.current.onUpdateRow(...args)}
                row={params.data}
              />
            ) : null
            : field.valueType === 'boolean'
              ? (params: ICellRendererParams<BatchRow>) => params.data ? (
                <GridBooleanCell
                  checked={effectiveValue(params.data) === true}
                  disabled={['queued', 'running', 'completed'].includes(params.data.executionStatus)}
                  onChange={(checked) => actionsRef.current.onUpdateRow(params.data!.id, field.key, checked)}
                />
              ) : null
              : isVideoAspectRatio
                ? (params: ICellRendererParams<BatchRow>) => params.data ? (
                  <GridVideoOutputSizeCell
                    aspectRatio={videoAspectRatioOptions.includes(effectiveValue(params.data) as VideoAspectRatio)
                      ? effectiveValue(params.data) as VideoAspectRatio
                      : '9:16'}
                    disabled={['queued', 'running', 'completed'].includes(params.data.executionStatus)}
                    onAspectRatioChange={(nextAspectRatio) => actionsRef.current.onUpdateRow(params.data!.id, field.key, nextAspectRatio)}
                    onResolutionChange={(nextResolution) => actionsRef.current.onUpdateRow(params.data!.id, 'resolution', nextResolution)}
                    resolution={videoResolutionOptions.includes(
                      (valueAt(params.data.params, 'resolution') ?? valueAt(globalParams, 'resolution')) as VideoResolution,
                    )
                      ? (valueAt(params.data.params, 'resolution') ?? valueAt(globalParams, 'resolution')) as VideoResolution
                      : '720P'}
                  />
                ) : null
              : selectOptions.length
                ? (params: ICellRendererParams<BatchRow>) => params.data ? (
                  <GridSelectCell
                    disabled={['queued', 'running', 'completed'].includes(params.data.executionStatus)}
                    label={selectLabels.get(effectiveValue(params.data) as string | number)
                      || String(effectiveValue(params.data) ?? '-')}
                    onOpen={(anchor) => {
                      const rect = anchor.getBoundingClientRect()
                      actionsRef.current.onOpenSelect((current) => {
                        if (current?.rowId === params.data!.id && current.fieldKey === field.key) return null
                        return {
                          anchor: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
                          fieldKey: field.key,
                          options: selectOptions,
                          rowId: params.data!.id,
                          value: valueAt(params.data!.params, field.key) as string | number | undefined,
                        }
                      })
                    }}
                  />
                ) : null
                : undefined,
        colId: field.key,
        editable: (params) => Boolean(params.data)
          && !isPrompt
          && !isAsset
          && field.valueType !== 'boolean'
          && !selectOptions.length
          && !['queued', 'running', 'completed'].includes(params.data!.executionStatus),
        headerName: `${isVideoAspectRatio ? '画布' : field.label}${field.required ? ' *' : ''}`,
        minWidth: isOutfitAsset ? 202 : field.key === 'aspectRatio' ? 130 : field.key === 'outputCount' ? 80 : isAsset ? 180 : 140,
        valueFormatter: selectOptions.length
          ? (params) => {
            const value = params.data ? effectiveValue(params.data) : params.value
            return selectLabels.get(value as string | number) || String(value ?? '-')
          }
          : undefined,
        valueGetter: (params) => params.data ? valueAt(params.data.params, field.key) : undefined,
        valueSetter,
        initialWidth,
        width: isOutfitAsset ? 202 : undefined,
        wrapText: field.valueType === 'string',
      }
    })

    if (hasImageCanvas) {
      const canvasColumn: ColDef<BatchRow> = {
        cellRenderer: (params: ICellRendererParams<BatchRow>) => {
          if (!params.data) return null
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
          ? estimatedImageCredits(params.data, activeCapability, globalParams, modelOptions)
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
    rowsLength,
    uploadingCell,
  ])
}
