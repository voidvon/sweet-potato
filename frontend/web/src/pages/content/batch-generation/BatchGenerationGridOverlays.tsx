import type { RefObject } from 'react'
import { Button, Select, Tooltip } from 'antd'
import { X } from 'lucide-react'
import type { BatchRow } from '../../../api/batch-generation'
import {
  MentionRichTextarea,
  type MentionRichTextareaOption,
  type MentionRichTextareaRef,
} from '../../../components/MentionRichTextarea'
import type {
  ActiveGridSelect,
  ActiveGridTooltip,
  ActivePromptEditor,
} from './batchGenerationGrid.types'

export function GridSelectOverlay({
  activeSelect,
  onChange,
}: {
  activeSelect: ActiveGridSelect | null
  onChange: (rowId: string, fieldKey: string, value: unknown) => void
}) {
  if (!activeSelect) return null
  return (
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
        onChange={(nextValue) => onChange(
          activeSelect.rowId,
          activeSelect.fieldKey,
          nextValue === '' ? undefined : nextValue,
        )}
        open
        options={[
          { label: '使用全局设置', value: '' },
          ...activeSelect.options,
        ]}
        popupClassName="ag-custom-component-popup batch-generation-grid-select-popup"
        popupMatchSelectWidth={Math.max(activeSelect.anchor.width, 160)}
        value={activeSelect.value ?? ''}
      />
    </div>
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
  return (
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
            <strong>编辑提示词</strong>
            <span><kbd>Ctrl / Cmd + Enter</kbd> 保存</span>
            <span><kbd>Esc</kbd> 取消</span>
          </div>
          <button aria-label="取消编辑" onClick={onCancel} type="button"><X size={18} /></button>
        </header>
      ) : null}
      <div className="batch-generation-grid-prompt-editor__body">
        <MentionRichTextarea
          editorClassName="batch-generation-grid-prompt-editor__content"
          emptyText="暂无可引用素材"
          enableHardBreak
          menuTitle="可引用素材"
          minHeight={activeEditor?.mode === 'fullscreen' ? 0 : activeEditor?.anchor.height ?? 0}
          minRows={1}
          onChange={(nextValue) => {
            if (activeRow && activeEditor) onChange(activeRow.id, activeEditor.fieldKey, nextValue)
          }}
          options={options}
          placeholder="输入提示词，使用 @ 引用素材"
          ref={editorRef}
          suggestionContainer="body"
          value={value}
        />
      </div>
      {activeEditor?.mode === 'fullscreen' ? (
        <footer className="batch-generation-grid-prompt-editor__footer">
          <span>{value.length} 字</span>
          <div>
            <Button onClick={onCancel}>取消</Button>
            <Button onClick={onSave} type="primary">保存</Button>
          </div>
        </footer>
      ) : null}
    </div>
  )
}

export function GridTooltipOverlay({ tooltip }: { tooltip: ActiveGridTooltip | null }) {
  if (!tooltip) return null
  return (
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
    </Tooltip>
  )
}
