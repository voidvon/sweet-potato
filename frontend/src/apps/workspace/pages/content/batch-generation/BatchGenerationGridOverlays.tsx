import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button, Popover, Select, Tooltip } from 'antd'
import { X } from 'lucide-react'
import type { BatchRow } from '../../../api/batch-generation'
import {
  ImageOutputSizePicker,
  type ImageAspectRatio,
  type ImageResolution,
} from '../../../components/ImageOutputSizePicker'
import {
  VideoOutputSizePicker,
  type VideoAspectRatio,
  type VideoResolution,
} from '../../../components/VideoOutputSizePicker'
import { VideoDurationPicker } from '../../../components/VideoDurationPicker'
import {
  MentionRichTextarea,
  type MentionRichTextareaOption,
  type MentionRichTextareaRef,
} from '../../../components/MentionRichTextarea'
import type {
  ActiveGridCanvas,
  ActiveGridSelect,
  ActiveGridTooltip,
  ActiveGridVideoCanvas,
  ActivePromptEditor,
} from './batchGenerationGrid.types'
import { t } from '@shared/i18n';

export function GridCanvasOverlay({
  activeCanvas,
  onAspectRatioChange,
  onResolutionChange,
}: {
  activeCanvas: ActiveGridCanvas | null
  onAspectRatioChange: (rowId: string, aspectRatio: ImageAspectRatio) => void
  onResolutionChange: (rowId: string, resolution: ImageResolution) => void
}) {
  if (!activeCanvas) return null
  return (
    <Popover
      arrow={false}
      classNames={{ root: 'image-output-size-popover batch-generation-grid-canvas-popover' }}
      content={(
        <div className="batch-generation-grid-canvas-popover__content">
          <ImageOutputSizePicker
            aspectRatio={activeCanvas.aspectRatio}
            model={activeCanvas.model}
            onAspectRatioChange={(aspectRatio) => onAspectRatioChange(activeCanvas.rowId, aspectRatio)}
            onResolutionChange={(resolution) => onResolutionChange(activeCanvas.rowId, resolution)}
            resolution={activeCanvas.resolution}
          />
        </div>
      )}
      open
      placement="bottomLeft"
      trigger={[]}
    >
      <span
        className="batch-generation-grid-canvas-anchor"
        style={{
          height: activeCanvas.anchor.height,
          left: activeCanvas.anchor.left,
          top: activeCanvas.anchor.top,
          width: activeCanvas.anchor.width,
        }}
      />
    </Popover>
  )
}

export function GridVideoCanvasOverlay({
  activeCanvas,
  onAspectRatioChange,
  onResolutionChange,
}: {
  activeCanvas: ActiveGridVideoCanvas | null
  onAspectRatioChange: (rowId: string, aspectRatio: VideoAspectRatio) => void
  onResolutionChange: (rowId: string, resolution: VideoResolution) => void
}) {
  if (!activeCanvas) return null
  return (
    <Popover
      arrow={false}
      classNames={{ root: 'video-output-size-popover batch-generation-grid-video-canvas-popover' }}
      content={(
        <div className="batch-generation-grid-video-canvas-popover__content">
          <VideoOutputSizePicker
            aspectRatio={activeCanvas.aspectRatio}
            onAspectRatioChange={(aspectRatio) => onAspectRatioChange(activeCanvas.rowId, aspectRatio)}
            onResolutionChange={(resolution) => onResolutionChange(activeCanvas.rowId, resolution)}
            resolution={activeCanvas.resolution}
          />
        </div>
      )}
      open
      placement="bottomLeft"
      trigger={[]}
    >
      <span
        className="batch-generation-grid-video-canvas-anchor"
        style={{
          height: activeCanvas.anchor.height,
          left: activeCanvas.anchor.left,
          top: activeCanvas.anchor.top,
          width: activeCanvas.anchor.width,
        }}
      />
    </Popover>
  )
}

export function GridSelectOverlay({
  activeSelect,
  onChange,
}: {
  activeSelect: ActiveGridSelect | null
  onChange: (rowId: string, fieldKey: string, value: unknown) => void
}) {
  if (!activeSelect) return null
  if (activeSelect.fieldKey === 'duration') {
    const durationPickerWidth = Math.min(340, Math.max(0, window.innerWidth - 16))
    const durationPickerLeft = Math.max(
      8,
      Math.min(activeSelect.anchor.left, window.innerWidth - durationPickerWidth - 8),
    )
    return createPortal(
      <div
        className="batch-generation-grid-duration-picker"
        style={{ left: durationPickerLeft, top: activeSelect.anchor.top + activeSelect.anchor.height }}
      >
        <VideoDurationPicker
          onChange={(value) => onChange(activeSelect.rowId, activeSelect.fieldKey, value)}
          options={activeSelect.options.map((option) => ({ label: option.label, value: String(option.value) }))}
          value={typeof activeSelect.value === 'string' ? activeSelect.value : ''}
        />
      </div>,
      document.body,
    )
  }
  return createPortal(
    <div
      className="batch-generation-grid-select-anchor"
      key={`${activeSelect.rowId}:${activeSelect.fieldKey}`}
      style={{
        height: activeSelect.anchor.height,
        left: activeSelect.anchor.left,
        top: activeSelect.anchor.top,
        width: activeSelect.anchor.width,
      }}
    >
      <Select<string | number>
        autoFocus
        className={activeSelect.fieldKey === 'modelConfigId' ? 'batch-generation-model-select' : undefined}
        onChange={(nextValue) => onChange(
          activeSelect.rowId,
          activeSelect.fieldKey,
          nextValue === '' ? undefined : nextValue,
        )}
        open
        options={activeSelect.fieldKey === 'modelConfigId'
          ? activeSelect.options
          : [{ label: t("使用全局设置"), value: '' }, ...activeSelect.options]}
        popupClassName="ag-custom-component-popup batch-generation-grid-select-popup"
        popupMatchSelectWidth={activeSelect.fieldKey === 'modelConfigId' ? false : Math.max(activeSelect.anchor.width, 160)}
        value={activeSelect.value ?? ''}
      />
    </div>,
    document.body,
  )
}

export function GridPromptEditorOverlay({
  activeEditor,
  activeRow,
  editorRef,
  onCancel,
  onChange,
  onSave,
  options,
  value,
}: {
  activeEditor: ActivePromptEditor | null
  activeRow?: BatchRow
  editorRef: RefObject<MentionRichTextareaRef | null>
  onCancel: () => void
  onChange: (rowId: string, fieldKey: string, value: string) => void
  onSave: () => void
  options: MentionRichTextareaOption[]
  value: string
}) {
  const isActive = Boolean(activeEditor && activeRow)
  return createPortal(
    <div
      aria-hidden={!isActive}
      className={`batch-generation-grid-prompt-editor${activeEditor?.mode === 'fullscreen' ? ' batch-generation-grid-prompt-editor--fullscreen' : ''}${isActive ? '' : ' batch-generation-grid-prompt-editor--hidden'}`}
      role={activeEditor?.mode === 'fullscreen' ? 'dialog' : undefined}
      style={isActive ? {
        height: activeEditor!.mode === 'fullscreen' ? 380 : undefined,
        left: activeEditor!.mode === 'fullscreen'
          ? Math.max(12, Math.min(activeEditor!.anchor.left + 8, window.innerWidth - 532))
          : activeEditor!.anchor.left,
        top: activeEditor!.mode === 'fullscreen'
          ? Math.max(12, Math.min(activeEditor!.anchor.top + 8, window.innerHeight - 392))
          : activeEditor!.anchor.top,
        width: activeEditor!.mode === 'fullscreen' ? 520 : activeEditor!.anchor.width,
      } : undefined}
    >
      {activeEditor?.mode === 'fullscreen' ? (
        <header className="batch-generation-grid-prompt-editor__header">
          <div>
            <strong>{t("编辑提示词")}</strong>
            <span><kbd>Ctrl / Cmd + Enter</kbd> {t("保存")}</span>
            <span><kbd>Esc</kbd> {t("取消")}</span>
          </div>
          <button aria-label={t("取消编辑")} onClick={onCancel} type="button"><X size={18} /></button>
        </header>
      ) : null}
      <div className="batch-generation-grid-prompt-editor__body">
        <MentionRichTextarea
          editorClassName="batch-generation-grid-prompt-editor__content"
          emptyText={t("暂无可引用素材")}
          enableHardBreak
          menuTitle={t("可引用素材")}
          minHeight={activeEditor?.mode === 'fullscreen' ? 0 : activeEditor?.anchor.height ?? 0}
          minRows={1}
          onChange={(nextValue) => {
            if (activeRow && activeEditor) onChange(activeRow.id, activeEditor.fieldKey, nextValue)
          }}
          options={options}
          placeholder={t("输入提示词，使用 @ 引用素材")}
          ref={editorRef}
          suggestionContainer="body"
          value={value}
        />
      </div>
      {activeEditor?.mode === 'fullscreen' ? (
        <footer className="batch-generation-grid-prompt-editor__footer">
          <span>{value.length} {t("字")}</span>
          <div>
            <Button onClick={onCancel}>{t("取消")}</Button>
            <Button onClick={onSave} type="primary">{t("保存")}</Button>
          </div>
        </footer>
      ) : null}
    </div>,
    document.body,
  )
}

export function GridTooltipOverlay({ tooltip }: { tooltip: ActiveGridTooltip | null }) {
  if (!tooltip) return null
  return createPortal(
    <Tooltip open placement="top" title={tooltip.title}>
      <span
        className="batch-generation-grid-tooltip-anchor"
        style={{
          height: tooltip.anchor.height,
          left: tooltip.anchor.left,
          top: tooltip.anchor.top,
          width: tooltip.anchor.width,
        }}
      />
    </Tooltip>,
    document.body,
  )
}
