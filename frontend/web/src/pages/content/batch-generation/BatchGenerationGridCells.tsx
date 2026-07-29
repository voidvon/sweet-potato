import type { ReactNode } from 'react'
import { Button, Popconfirm, Space, Switch, Tag, Typography } from 'antd'
import { CreditIcon } from '@shared/components/CreditIcon'
import { formatCreditAmount } from '@shared/utils/credits'
import { ChevronDown, Copy, ExternalLink, Maximize2, Play, Plus, Scan, Trash2, UploadCloud, X } from 'lucide-react'
import type {
  BatchAttempt,
  BatchExecutionStatus,
  BatchRow,
  CreativeCapabilityField,
} from '../../../api/batch-generation'
import { resolveAssetUrl } from '../../../api/request'
import type { MentionRichTextareaOption } from '../../../components/MentionRichTextarea'
import type { ContentAsset } from '../../../types'
import {
  MAX_REFERENCE_IMAGE_COUNT,
  assetAccept,
  assetLabel,
  statusMeta,
  stringArray,
  valueAt,
} from './batchGenerationGrid.utils'

export function GridSelectCell({
  disabled,
  label,
  onOpen,
}: {
  disabled?: boolean
  label: string
  onOpen: (anchor: HTMLElement) => void
}) {
  return (
    <div
      aria-disabled={disabled}
      className={`batch-generation-grid-select-cell${disabled ? ' batch-generation-grid-select-cell--disabled' : ''}`}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen(event.currentTarget)
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (!disabled) onOpen(event.currentTarget)
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <span className="batch-generation-grid-select-cell__value">{label}</span>
      <ChevronDown aria-hidden="true" size={14} />
    </div>
  )
}

export function GridCanvasCell({
  disabled,
  label,
  onOpen,
}: {
  disabled?: boolean
  label: string
  onOpen: (anchor: HTMLElement) => void
}) {
  return (
    <div
      aria-disabled={disabled}
      className={`batch-generation-grid-canvas-cell${disabled ? ' batch-generation-grid-canvas-cell--disabled' : ''}`}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen(event.currentTarget)
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (!disabled) onOpen(event.currentTarget)
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <Scan aria-hidden="true" size={13} />
      <span>{label}</span>
      <ChevronDown aria-hidden="true" size={14} />
    </div>
  )
}

export function GridPromptCell({
  disabled,
  options,
  value,
  onFullscreen,
  onOpen,
}: {
  disabled?: boolean
  options: MentionRichTextareaOption[]
  value: string
  onFullscreen: (anchor: HTMLElement) => void
  onOpen: (anchor: HTMLElement) => void
}) {
  const optionByToken = new Map(options.map((option) => [option.token, option]))
  const tokens = [...optionByToken.keys()].sort((left, right) => right.length - left.length)
  const paragraphs = value.split('\n').map((line, lineIndex) => {
    const content: ReactNode[] = []
    let cursor = 0

    while (cursor < line.length) {
      const token = tokens.find((item) => line.startsWith(item, cursor))
      if (!token) {
        const nextTokenIndex = tokens
          .map((item) => line.indexOf(item, cursor + 1))
          .filter((index) => index !== -1)
          .sort((left, right) => left - right)[0] ?? line.length
        content.push(line.slice(cursor, nextTokenIndex))
        cursor = nextTokenIndex
        continue
      }

      const option = optionByToken.get(token)!
      const mentionKind = option.mimeType?.startsWith('video/')
        ? 'video'
        : option.mimeType?.startsWith('audio/') ? 'audio' : 'image'
      content.push(
        <span className="mention-rich-textarea-chip batch-generation-grid-prompt-mention" data-mention-kind={mentionKind} key={`${lineIndex}:${token}:${cursor}`}>
          {mentionKind === 'image' && option.previewUrl ? <img alt="" src={option.previewUrl} /> : null}
          {mentionKind === 'video' ? <span className="mention-rich-textarea-chip-icon">视</span> : null}
          {mentionKind === 'audio' ? <span className="mention-rich-textarea-chip-icon">♪</span> : null}
          <b>{option.label}</b>
        </span>,
      )
      cursor += token.length
    }

    return <p key={lineIndex}>{content.length ? content : <br />}</p>
  })

  return (
    <div
      aria-disabled={disabled}
      className={`batch-generation-grid-prompt-cell${disabled ? ' batch-generation-grid-prompt-cell--disabled' : ''}`}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (!disabled) onOpen(event.currentTarget)
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen(event.currentTarget)
        }
      }}
    >
      {!disabled ? (
        <button
          aria-label="全屏编辑提示词"
          className="batch-generation-grid-prompt-cell__fullscreen"
          onClick={(event) => {
            event.stopPropagation()
            onFullscreen(event.currentTarget.closest('.batch-generation-grid-prompt-cell') || event.currentTarget)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          <Maximize2 size={12} />
        </button>
      ) : null}
      <div className="batch-generation-grid-prompt-cell__content">
        {value ? paragraphs : <span className="batch-generation-grid-prompt-cell__placeholder">输入提示词，使用 @ 引用素材</span>}
      </div>
    </div>
  )
}

export function GridAssetCell({
  assets,
  field,
  isUploading,
  onOpenUpload,
  onPreview,
  onUpdate,
  row,
}: {
  assets: Record<string, ContentAsset>
  field: CreativeCapabilityField
  isUploading: boolean
  onOpenUpload: (row: BatchRow, field: CreativeCapabilityField, currentCount: number, maxCount: number) => void
  onPreview: (current: number, items: Array<{ alt: string; src: string }>) => void
  onUpdate: (rowId: string, fieldKey: string, value: unknown) => void
  row: BatchRow
}) {
  const storedValue = valueAt(row.params, field.key)
  const ids = field.valueType === 'asset-list'
    ? stringArray(storedValue)
    : typeof storedValue === 'string' && storedValue ? [storedValue] : []
  const isImageField = assetAccept(field) === 'image/*'
  const maxCount = field.valueType === 'asset-list' ? MAX_REFERENCE_IMAGE_COUNT : 1
  const uploadDisabled = ['queued', 'running', 'completed'].includes(row.executionStatus)

  if (isImageField) {
    const canUpload = ids.length < maxCount
    const previewItems = ids.flatMap((id, index) => {
      const asset = assets[id]
      const src = resolveAssetUrl(asset?.fileUrl)
      return src ? [{
        alt: asset?.name || asset?.originalFileName || `${assetLabel(field)} ${index + 1}`,
        id,
        src,
      }] : []
    })
    return (
      <div className="batch-generation-grid-assets">
        {ids.map((id, index) => {
          const asset = assets[id]
          const src = resolveAssetUrl(asset?.fileUrl)
          const alt = asset?.name || asset?.originalFileName || `${assetLabel(field)} ${index + 1}`
          return (
            <div className="batch-generation-grid-asset" key={id}>
              {src ? (
                <button
                  aria-label={`预览${alt}`}
                  className="batch-generation-grid-asset__preview"
                  onClick={(event) => {
                    event.stopPropagation()
                    onPreview(
                      Math.max(0, previewItems.findIndex((item) => item.id === id)),
                      previewItems.map((item) => ({ alt: item.alt, src: item.src })),
                    )
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <img alt={alt} className="batch-generation-grid-asset__image" height={40} loading="lazy" src={src} width={40} />
                </button>
              ) : <span className="batch-generation-grid-asset__placeholder"><UploadCloud size={15} /></span>}
              {!uploadDisabled ? (
                <button
                  aria-label={`移除${alt}`}
                  className="batch-generation-grid-asset__remove"
                  onClick={(event) => {
                    event.stopPropagation()
                    const nextIds = ids.filter((assetId) => assetId !== id)
                    onUpdate(row.id, field.key, field.valueType === 'asset-list' ? nextIds : undefined)
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <X size={10} strokeWidth={2.4} />
                </button>
              ) : null}
            </div>
          )
        })}
        {canUpload ? (
          <div className="batch-generation-grid-asset-upload">
            <button
              aria-label={`添加${field.label}`}
              className="batch-generation-grid-asset-add"
              disabled={uploadDisabled || isUploading}
              onClick={() => onOpenUpload(row, field, ids.length, maxCount)}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              {isUploading ? <span className="batch-generation-grid-asset-add__spinner" /> : <Plus size={18} />}
            </button>
            {ids.length ? <span className="batch-generation-grid-asset-upload__count">{ids.length}/{maxCount}</span> : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <Space size={6} wrap>
      {ids.map((id) => {
        const asset = assets[id]
        return (
          <Tag
            closable={!uploadDisabled}
            key={id}
            onClose={(event) => {
              event.preventDefault()
              const nextIds = ids.filter((assetId) => assetId !== id)
              onUpdate(row.id, field.key, field.valueType === 'asset-list' ? nextIds : undefined)
            }}
          >
            {asset?.name || asset?.originalFileName || `${assetLabel(field)} ${ids.indexOf(id) + 1}`}
          </Tag>
        )
      })}
      {ids.length < maxCount ? (
        <Button
          aria-label={`添加${field.label}`}
          disabled={uploadDisabled || isUploading}
          icon={<UploadCloud size={15} />}
          loading={isUploading}
          onClick={() => onOpenUpload(row, field, ids.length, maxCount)}
          size="small"
          type="dashed"
        >
          添加
        </Button>
      ) : null}
    </Space>
  )
}

export function GridBooleanCell({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <Switch checked={checked} disabled={disabled} onChange={onChange} size="small" />
}

export function GridStatusCell({ status }: { status: BatchExecutionStatus }) {
  const meta = statusMeta[status]
  return (
    <span className={`sheet-task-stats__${meta.tone}`}>
      <span className="sheet-task-stats__dot" />
      {meta.label}
    </span>
  )
}

export function GridResultCell({
  assets,
  attempt,
  onHideTooltip,
  onPreview,
  onShowTooltip,
}: {
  assets: Record<string, ContentAsset>
  attempt?: BatchAttempt
  onHideTooltip: () => void
  onPreview: (current: number, items: Array<{ alt: string; src: string }>) => void
  onShowTooltip: (target: HTMLElement, title: string) => void
}) {
  if (!attempt?.outputs.length) {
    return attempt?.errorMessage ? (
      <Typography.Text
        onBlur={onHideTooltip}
        onFocus={(event) => onShowTooltip(event.currentTarget, attempt.errorMessage!)}
        onMouseEnter={(event) => onShowTooltip(event.currentTarget, attempt.errorMessage!)}
        onMouseLeave={onHideTooltip}
        tabIndex={0}
        type="danger"
      >
        查看错误
      </Typography.Text>
    ) : <Typography.Text type="secondary">-</Typography.Text>
  }
  const previewItems = attempt.outputs.flatMap((output, index) => {
    const asset = assets[output.assetId]
    const src = resolveAssetUrl(asset?.fileUrl)
    return asset?.mimeType.startsWith('image/') && src ? [{
      alt: asset.name || asset.originalFileName || `生成结果 ${index + 1}`,
      outputId: output.id,
      src,
    }] : []
  })

  return (
    <div className="batch-generation-grid-assets batch-generation-grid-results">
      {attempt.outputs.map((output) => {
        const asset = assets[output.assetId]
        const url = resolveAssetUrl(asset?.fileUrl)
        if (asset?.mimeType.startsWith('image/') && url) {
          const alt = asset.name || asset.originalFileName || '生成结果'
          return (
            <div className="batch-generation-grid-asset" key={output.id}>
              <button
                aria-label={`预览${alt}`}
                className="batch-generation-grid-asset__preview"
                onClick={(event) => {
                  event.stopPropagation()
                  onPreview(
                    Math.max(0, previewItems.findIndex((item) => item.outputId === output.id)),
                    previewItems.map((item) => ({ alt: item.alt, src: item.src })),
                  )
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <img
                  alt={alt}
                  className="batch-generation-grid-asset__image"
                  decoding="async"
                  height={40}
                  loading="lazy"
                  src={url}
                  width={40}
                />
              </button>
            </div>
          )
        }
        return (
          <Button
            disabled={!url}
            href={url || undefined}
            icon={<ExternalLink size={14} />}
            key={output.id}
            rel="noreferrer"
            size="small"
            target="_blank"
            type="link"
          >
            查看
          </Button>
        )
      })}
    </div>
  )
}

export function GridCreditsCell({ value }: { value: number }) {
  const formattedValue = formatCreditAmount(value)
  return (
    <span aria-label={`预计消耗 ${formattedValue} 积分`} className="batch-generation-grid-credit-value">
      <CreditIcon />
      {formattedValue}
    </span>
  )
}

export function GridActionsCell({
  canCopy,
  onCopy,
  onDelete,
  onHideTooltip,
  onRun,
  onShowTooltip,
  row,
}: {
  canCopy: boolean
  onCopy: (row: BatchRow) => void
  onDelete: (row: BatchRow) => void
  onHideTooltip: () => void
  onRun: (row: BatchRow) => void
  onShowTooltip: (target: HTMLElement, title: string) => void
  row: BatchRow
}) {
  const disabled = ['queued', 'running'].includes(row.executionStatus)
  const tooltipEvents = (title: string) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => onShowTooltip(event.currentTarget, title),
    onMouseLeave: onHideTooltip,
  })
  return (
    <Space size={4}>
      {row.executionStatus !== 'completed' ? (
        <Button
          {...tooltipEvents('执行此行')}
          aria-label="执行此行"
          className="batch-generation-grid-action-button batch-generation-grid-action-button--run"
          disabled={disabled}
          icon={<Play fill="currentColor" size={14} />}
          onClick={() => {
            onHideTooltip()
            onRun(row)
          }}
          size="small"
          type="default"
        />
      ) : null}
      <Button
        {...tooltipEvents('复制此行')}
        aria-label="复制此行"
        className="batch-generation-grid-action-button"
        disabled={!canCopy}
        icon={<Copy size={14} />}
        onClick={() => {
          onHideTooltip()
          onCopy(row)
        }}
        size="small"
        type="default"
      />
      <Popconfirm onConfirm={() => onDelete(row)} title="确认删除这一行？">
        <Button
          {...tooltipEvents('删除')}
          aria-label="删除"
          className="batch-generation-grid-action-button batch-generation-grid-action-button--delete"
          disabled={disabled}
          icon={<Trash2 size={14} />}
          onClick={onHideTooltip}
          size="small"
          type="default"
        />
      </Popconfirm>
    </Space>
  )
}
