import { Button, Tabs } from 'antd';
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { VideoRemakeCardMessage, VideoRemakeCardType } from '../../../../api/video-remake';
import { AssetSelector } from '../AssetSelector';
import { asItems, asRecord, cardTypeLabels, fieldBool, fieldText } from '../videoRemakeCardUtils';
import { SummaryBlock } from './textHelpers';
import type { AssetSelectorState, EditableCardProps } from './types';

export function confirmButtonText(cardType: VideoRemakeCardType) {
  const map: Partial<Record<VideoRemakeCardType, string>> = {
    basic_info: '确认基础信息',
    character_setting: '确认人物设定',
    scene_setting: '确认场景设定',
    product_setting: '确认产品设定',
    pip_setting: '确认画中画设定',
    voice_audio_setting: '确认人声/音频',
    script_content: '确认口播内容',
    storyboard_script: '确认分镜脚本',
    seedance_prompt: '确认生成提示词',
    final_video: '开始生成视频',
  };
  return map[cardType] || `确认${cardTypeLabels[cardType]}`;
}

export function expiredText(cardType: VideoRemakeCardType) {
  const label = cardTypeLabels[cardType] || '当前卡片';
  return `${label}基于旧版设定生成，当前已失效。`;
}

export function isCompletedFinalVideoCard(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'final_video') {
    return false;
  }
  const data = asRecord(card.data);
  return Boolean(fieldText(data.videoUrl) || fieldText(data.status) === 'completed');
}

export function ReadonlyCard({ children }: { children: ReactNode }) {
  return <div className="remake-card-body">{children}</div>;
}

export function EditableCard({
  card,
  assets,
  groups,
  disabled,
  active,
  onEnsureAssets,
  onConfirm,
  onCancel,
  draft: controlledDraft,
  onDraftChange,
  children,
}: EditableCardProps) {
  const [localDraft, setLocalDraft] = useState<unknown>(card.data);
  const [selector, setSelector] = useState<AssetSelectorState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const draft = onDraftChange ? controlledDraft : localDraft;
  const setDraft: Dispatch<SetStateAction<unknown>> = (value) => {
    if (onDraftChange) {
      onDraftChange(value);
      return;
    }
    setLocalDraft(value);
  };

  useEffect(() => {
    if (!onDraftChange) {
      setLocalDraft(card.data);
    }
    setSelector(null);
  }, [card.cardId, card.data, onDraftChange]);

  const draftRecord = asRecord(draft);
  const hasEditableSeedanceDraft = card.cardType === 'seedance_prompt'
    && (
      asItems(draft).length > 0
      || asItems(draftRecord.items).length > 0
      || asItems(draftRecord.prompts).length > 0
      || asItems(draftRecord.previousData).length > 0
      || asItems(draftRecord.segments).length > 0
    );
  const isPendingPlaceholder = ['thinking', 'regenerating', 'generating'].includes(fieldText(draftRecord.status))
    || /生成中|解析中|思考/u.test(fieldText(draftRecord.message));
  const blocksEdit = isPendingPlaceholder && !hasEditableSeedanceDraft;
  const allowEdit = card.status === 'editing' && !blocksEdit;
  const allowCancelEdit = allowEdit && (
    fieldBool(asRecord(card.data).editingFromConfirmed)
    || card.cardType === 'seedance_prompt'
  );

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      const confirmDraft = card.cardType === 'final_video'
        ? { ...asRecord(draft), generationMode: 'parallel' }
        : draft;
      await onConfirm(confirmDraft);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className={`remake-card-body ${active ? 'active' : ''}`}>
        {card.status === 'expired' && !isCompletedFinalVideoCard(card) ? <SummaryBlock lines={expiredText(card.cardType)} /> : children({
          draft,
          setDraft,
          setSelector: (value) => {
            if (typeof value === 'function') {
              setSelector(value);
              return;
            }
            if (!value) {
              setSelector(null);
              return;
            }
            void onEnsureAssets?.().finally(() => setSelector(value));
          },
        })}
      </div>
      {allowEdit ? <div className="remake-card-actions">
        {allowEdit ? (
          <>
            {allowCancelEdit ? (
              <Button disabled={disabled || isSaving} onClick={() => void onCancel()}>
                取消编辑
              </Button>
            ) : null}
            <Button disabled={disabled || isSaving} onClick={handleConfirm} type="primary">
              {confirmButtonText(card.cardType)}
            </Button>
          </>
        ) : null}
      </div> : null}
      {selector ? (
        <AssetSelector
          assets={assets}
          groups={groups}
          kind={selector.kind}
          maxSelection={selector.maxSelection}
          onCancel={() => setSelector(null)}
          onSelect={(selection) => {
            selector.onSelect(selection);
            setSelector(null);
          }}
          open
          selectedAssetId={selector.selectedAssetId}
          selectedAssetIds={selector.selectedAssetIds}
          selectedGroupId={selector.selectedGroupId}
          title={selector.title}
        />
      ) : null}
    </>
  );
}

export function renderItemTabs(
  items: Record<string, unknown>[],
  activeIndex: number,
  setActiveIndex: (index: number) => void,
  fallbackLabel: string,
  options?: { addLabel?: string; onAdd?: () => void },
) {
  if (items.length <= 1 && !options?.onAdd) {
    return null;
  }
  return (
    <Tabs
      activeKey={String(Math.min(activeIndex, items.length - 1))}
      className="remake-card-tabs"
      items={[
        ...items.map((item, index) => ({
        key: String(index),
        label: fieldText(item.label) || `${fallbackLabel} ${index + 1}`,
        })),
        ...(options?.onAdd ? [{ key: '__add__', label: options.addLabel || `+ 添加${fallbackLabel}` }] : []),
      ]}
      onChange={(key) => {
        if (key === '__add__') {
          options?.onAdd?.();
          return;
        }
        setActiveIndex(Number(key));
      }}
      size="small"
    />
  );
}

export function renderStatusSummary(card: VideoRemakeCardMessage) {
  const data = asRecord(card.data);
  return fieldText(data.message) || fieldText(data.label) || fieldText(data.step);
}
