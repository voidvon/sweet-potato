import { Alert, Button, Input, InputNumber, Modal, Popover, Radio, Select, Tabs, Tooltip, Upload, message } from 'antd';
import { useEffect, useRef, useState, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, Info, ListPlus, Pause, PencilLine, Play, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { VideoRemakeCardMessage, VideoRemakeCardType } from '../../../api/video-remake';
import type { ContentAsset, ContentAssetGroup } from '../../../types';
import { AppForm } from '../../../components/AppForm';
import { AssetLibraryAudioWave } from '../../../components/AssetLibraryCard';
import { MentionRichTextarea, type MentionRichTextareaOption } from '../../../components/MentionRichTextarea';
import { AssetSelector, type AssetSelectorKind } from './AssetSelector';
import {
  assetPreviewUrl,
  asItems,
  asRecord,
  cardTypeLabels,
  fieldBool,
  fieldText,
  isRecord,
  mediaUrl,
  updateAt,
} from './videoRemakeCardUtils';

type CardRendererContext = {
  assets: ContentAsset[];
  groups: ContentAssetGroup[];
  disabled?: boolean;
  syncing?: boolean;
  active?: boolean;
  draft?: unknown;
  onEnsureAssets?: () => Promise<void>;
  onConfirm: (data: unknown) => Promise<void>;
  onCancel: () => Promise<void>;
  onDraftChange?: Dispatch<SetStateAction<unknown>>;
  onEdit: () => Promise<void>;
  onRegenerate?: (instruction?: string) => Promise<void>;
  onRegenerateFinalSegment?: (segmentIndex: number, prompt?: string) => Promise<void>;
  onRegenerateFinalSegments?: (segments: FinalSegmentRegenerationInput[]) => Promise<void>;
  onSyncProgress?: () => Promise<void>;
  onUploadPipImage?: (file: File) => Promise<{ fileUrl: string; originalFileName: string; mimeType: string; fileSize: number }>;
  onUploadReferenceImage?: (kind: 'scene' | 'product', file: File) => Promise<ContentAsset>;
  videoAspectRatio?: string;
  videoDurationSeconds?: number;
};

type CardRendererProps = CardRendererContext & {
  card: VideoRemakeCardMessage;
};

type AssetSelectorState = {
  kind: AssetSelectorKind;
  title: string;
  selectedAssetId?: string;
  selectedAssetIds?: string[];
  selectedGroupId?: string;
  maxSelection?: number;
  onSelect: (selection: { assetId?: string; assetIds?: string[]; groupId?: string }) => void;
};

type FinalSegmentQueueItem = {
  mode: 'direct' | 'prompt';
  prompt?: string;
  segmentIndex: number;
};

type FinalSegmentRegenerationInput = {
  prompt?: string;
  segmentIndex: number;
};

type SeedanceReferenceMention = {
  assetId?: string;
  fileUrl?: string;
  label: string;
  mimeType?: string;
  name?: string;
  token: string;
};

type EditableCardProps = CardRendererProps & {
  children: (args: {
    draft: unknown;
    setDraft: Dispatch<SetStateAction<unknown>>;
    setSelector: Dispatch<SetStateAction<AssetSelectorState | null>>;
  }) => ReactNode;
};

function compactLines(lines: Array<[string, string | undefined]>) {
  return lines
    .filter(([, value]) => value && value.trim())
    .map(([label, value]) => `${label}：${value}`)
    .join('\n');
}

function isUnknownPlaceholderText(value: string) {
  return /^(不详|未知|未详|不明确|未明确|无法确定|未提供|暂无|无|N\/A|NA|null|undefined)[。.]?$/iu.test(value.trim());
}

function isReferencePromptMetaLine(line: string) {
  const match = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/u);
  if (!match) {
    return isUnknownPlaceholderText(line);
  }
  const key = match[1].trim();
  const text = match[2].trim();
  return /^(startSecond|endSecond|start|end|startTime|endTime|time|duration|spokenCue|speckCue|speechCue|narrationCue|cue|keywords?|开始时间|结束时间|开始秒|结束秒|出现时间|时间范围|口播线索|对应口播|语境线索|关键词)$/iu.test(key)
    || isUnknownPlaceholderText(text);
}

function cleanReferencePromptText(value: unknown) {
  return fieldText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isReferencePromptMetaLine(line))
    .join('\n')
    .trim();
}

function isProgressExecutionCompleted(item: Record<string, unknown>) {
  const status = fieldText(item.status || item.state || item.executionStatus).toLowerCase();
  return item.completed === true
    || ['completed', 'success', 'succeeded', 'done', 'finished', '已完成'].includes(status);
}

function characterDisplayPromptText(item: Record<string, unknown>) {
  const prompt = cleanReferencePromptText(item.characterPrompt);
  const detailLines = [
    ['外观', cleanReferencePromptText(item.appearance)],
    ['动作', cleanReferencePromptText(item.gesture)],
    ['表情', cleanReferencePromptText(item.expression)],
  ]
    .filter(([, text]) => text && !prompt.includes(text))
    .map(([label, text]) => `${label}：${text}`);
  return [...detailLines, prompt].filter(Boolean).join('\n').trim();
}

function normalizeResolution(value: unknown, detail?: unknown, aspectRatio?: unknown) {
  const text = [fieldText(value), fieldText(detail)].filter(Boolean).join(' ');
  const dimension = text.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (dimension) {
    const shortSide = Math.min(Number(dimension[1]), Number(dimension[2]));
    if (shortSide <= 480) {
      return '480p';
    }
    if (shortSide <= 720) {
      return '720p';
    }
    return '1080p';
  }
  const numeric = Number((fieldText(value) || fieldText(detail)).match(/\d+/)?.[0] || 0);
  if (!numeric) {
    return '';
  }
  const aspect = fieldText(aspectRatio);
  if (numeric > 1080 && /^(9:16|3:4)$/u.test(aspect)) {
    return numeric <= 1280 ? '720p' : '1080p';
  }
  if (numeric <= 480) {
    return '480p';
  }
  if (numeric <= 720 || numeric <= 1280) {
    return '720p';
  }
  return '1080p';
}

const presetAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
type PresetAspectRatio = typeof presetAspectRatios[number];

function nearestPresetAspectRatio(value: unknown) {
  const text = fieldText(value).trim().replace(/\s+/gu, '');
  if (!text) {
    return '';
  }
  if (presetAspectRatios.includes(text as typeof presetAspectRatios[number])) {
    return text;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/u);
  if (!match) {
    return text;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return text;
  }
  const target = width / height;
  let best: PresetAspectRatio = presetAspectRatios[0];
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of presetAspectRatios) {
    const [presetWidth, presetHeight] = ratio.split(':').map(Number);
    const distance = Math.abs(target - (presetWidth / presetHeight));
    if (distance < smallestDistance) {
      smallestDistance = distance;
      best = ratio;
    }
  }
  return best;
}

function SummaryBlock({ lines, emptyText = '暂无内容，等待生成。' }: { lines: string; emptyText?: string }) {
  return <div className="remake-summary">{lines.trim() || emptyText}</div>;
}

function promptSection(text: string, heading: string) {
  const pattern = new RegExp(`#\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n#\\s|$)`, 'u');
  return text.match(pattern)?.[1]?.trim() || '';
}

function promptStoryboardLines(mainPrompt: string) {
  const section = promptSection(mainPrompt, '本段画面') || promptSection(mainPrompt, '当前分镜');
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function removeDuplicatedPipPromptSection(text: string) {
  return text
    .replace(/\n{2,}#\s*画中画\s*\n[\s\S]*?(?=\n{2,}#\s|$)/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function editableSeedancePromptText(text: string) {
  return removeDuplicatedPipPromptSection(text);
}

function sanitizePipPreviewText(text: string) {
  return text
    .replace(/；?因文本未提供具体像素坐标，?x、y、width、height\s*暂填\s*0。?/gu, '')
    .replace(/位置：\s*未明确（文本未提供具体位置）/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function hasVisiblePipText(text: string) {
  const value = sanitizePipPreviewText(text);
  return Boolean(value && !/^无画中画[。.]?$/u.test(value));
}

function totalDurationText(segments: Record<string, unknown>[]) {
  const total = segments.reduce((sum, segment) => sum + (Number(segment.duration) || 0), 0);
  return total ? `${Number(total.toFixed(1))}s` : '待确认';
}

function maxSegmentDurationText(segments: Record<string, unknown>[]) {
  const configured = Number(segments.find((segment) => Number(segment.maxDuration))?.maxDuration || 15);
  return `≤ ${configured}s`;
}

function formatShotTime(shot: Record<string, unknown>) {
  const start = fieldText(shot.startTime);
  const end = fieldText(shot.endTime);
  const duration = fieldText(shot.duration);
  if (start || end) {
    return `${start || 0}s - ${end || duration || 0}s`;
  }
  return duration ? `${duration}s` : '';
}

function findSelectedAsset(assets: ContentAsset[], id: unknown) {
  const assetId = fieldText(id);
  return assetId ? assets.find((asset) => asset.id === assetId) : undefined;
}

function findSelectedAssets(assets: ContentAsset[], ids: unknown) {
  const values = Array.isArray(ids) ? ids.map((item) => fieldText(item)).filter(Boolean) : [];
  return values
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is ContentAsset => Boolean(asset));
}

function selectedAssetIdsFromItem(item: Record<string, unknown>) {
  const values = Array.isArray(item.assetIds)
    ? item.assetIds.map((entry) => fieldText(entry)).filter(Boolean)
    : [];
  if (values.length) {
    return Array.from(new Set(values)).slice(0, 9);
  }
  const fallback = fieldText(item.assetId).trim();
  return fallback ? [fallback] : [];
}

function findSelectedGroup(groups: ContentAssetGroup[], id: unknown) {
  const groupId = fieldText(id);
  return groupId ? groups.find((group) => group.id === groupId) : undefined;
}

function SelectedReference({
  asset,
  group,
  emptyText,
}: {
  asset?: ContentAsset;
  group?: ContentAssetGroup;
  emptyText: string;
}) {
  if (!asset && !group) {
    return <span className="remake-selected-empty">{emptyText}</span>;
  }
  const title = asset?.name || asset?.originalFileName || group?.name || '已选择素材';
  const description = asset?.description || asset?.originalFileName || group?.description || (group?.assetCount !== undefined ? `${group.assetCount} 个素材` : '');
  const preview = asset ? assetPreviewUrl(asset) : assetPreviewUrl(group?.coverAssets?.[0]);
  const mimeType = asset?.mimeType || group?.coverAssets?.[0]?.mimeType || '';

  return (
    <div className="remake-selected-reference">
      <div className="remake-selected-thumb">
        {mimeType.startsWith('image/') && preview ? <img alt={title} src={preview} /> : null}
        {mimeType.startsWith('video/') && preview ? <video muted preload="metadata" src={preview} /> : null}
        {!preview || mimeType.startsWith('audio/') ? <span>{asset?.resourceType === 'voice' || group?.resourceType === 'voice' ? '声' : group ? '组' : '素'}</span> : null}
      </div>
      <div className="remake-selected-info">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </div>
    </div>
  );
}

function resolveGroupPreviewAsset(group: ContentAssetGroup | undefined, assets: ContentAsset[], mimePrefix?: string) {
  if (!group) {
    return undefined;
  }
  const coverMatch = group.coverAssets?.find((item) => !mimePrefix || item.mimeType.startsWith(mimePrefix));
  if (coverMatch) {
    return coverMatch;
  }
  return assets.find((item) => item.groupId === group.id && (!mimePrefix || item.mimeType.startsWith(mimePrefix)));
}

function resolveAudioCharacterLabel(item: Record<string, unknown>, index: number) {
  const characterLabel = fieldText(item.characterLabel);
  if (characterLabel) {
    return characterLabel;
  }
  const rawLabel = fieldText(item.label);
  if (rawLabel && !['content', 'text', 'item', 'items'].includes(rawLabel.toLowerCase())) {
    return rawLabel.replace(/\s*声音$/u, '') || rawLabel;
  }
  return `人物 ${index + 1}`;
}

function seedanceReferenceMentions(prompt: Record<string, unknown>, assets: ContentAsset[]): SeedanceReferenceMention[] {
  const rawReferenceMentions = prompt.referenceMentions;
  const explicitItems = Array.isArray(rawReferenceMentions) ? rawReferenceMentions : [];
  const explicit = explicitItems
    .map((item): SeedanceReferenceMention | null => {
      if (!isRecord(item)) {
        return null;
      }
      const label = fieldText(item.label);
      const token = fieldText(item.token) || (label ? `@${label}` : '');
      if (!label || !token) {
        return null;
      }
      const asset = findSelectedAsset(assets, item.assetId);
      return {
        assetId: fieldText(item.assetId),
        fileUrl: fieldText(item.fileUrl) || asset?.fileUrl || '',
        label,
        mimeType: fieldText(item.mimeType) || asset?.mimeType || '',
        name: fieldText(item.name) || asset?.name || asset?.originalFileName || label,
        token,
      };
    })
    .filter((item): item is SeedanceReferenceMention => Boolean(item));
  if (Array.isArray(rawReferenceMentions)) {
    return explicit;
  }
  const images = assets.filter((asset) => asset.mimeType.startsWith('image/'));
  const videos = assets.filter((asset) => asset.mimeType.startsWith('video/'));
  const audios = assets.filter((asset) => asset.mimeType.startsWith('audio/'));
  return [
    ...images.map((asset, index) => ({
      assetId: asset.id,
      fileUrl: asset.fileUrl,
      label: `图片${index + 1}`,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalFileName || `图片${index + 1}`,
      token: `@图片${index + 1}`,
    })),
    ...videos.map((asset, index) => ({
      assetId: asset.id,
      fileUrl: asset.fileUrl,
      label: `视频${index + 1}`,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalFileName || `视频${index + 1}`,
      token: `@视频${index + 1}`,
    })),
    ...audios.map((asset, index) => ({
      assetId: asset.id,
      fileUrl: asset.fileUrl,
      label: `音频${index + 1}`,
      mimeType: asset.mimeType,
      name: asset.name || asset.originalFileName || `音频${index + 1}`,
      token: `@音频${index + 1}`,
    })),
  ];
}

function renderSeedancePromptWithReferences(text: string, mentions: SeedanceReferenceMention[]) {
  const parts = text.split(/(@(?:图片|视频|音频)\d+)/gu);
  return parts.map((part, index) => {
    const match = part.match(/^@((?:图片|视频|音频)\d+)$/u);
    if (!match) {
      return <span key={`${index}-${part}`}>{part}</span>;
    }
    const mention = mentions.find((item) => item.token === part || item.label === match[1]);
    const previewUrl = mention?.fileUrl ? mediaUrl(mention.fileUrl) : '';
    return (
      <span className="remake-seedance-reference-chip" contentEditable={false} data-seedance-token={part} key={`${index}-${part}`}>
        {mention?.mimeType?.startsWith('image/') && previewUrl ? <img alt={match[1]} src={previewUrl} /> : null}
        {mention?.mimeType?.startsWith('audio/') ? <span className="remake-seedance-reference-chip-icon">♪</span> : null}
        {mention?.mimeType?.startsWith('video/') ? <span className="remake-seedance-reference-chip-icon">视</span> : null}
        <b>{match[1]}</b>
      </span>
    );
  });
}

function seedanceMentionOptions(mentions: SeedanceReferenceMention[]): MentionRichTextareaOption[] {
  return mentions.map((mention) => ({
    label: mention.label,
    mimeType: mention.mimeType,
    previewUrl: mention.mimeType?.startsWith('image/') && mention.fileUrl ? mediaUrl(mention.fileUrl) : '',
    subtitle: mention.name,
    token: mention.token,
  }));
}

function SquareReferencePicker({
  asset,
  assets,
  emptyText,
  group,
  groups,
  onClear,
  onEnsureAssets,
  onSelect,
  onUpload,
  pickText,
  preferAudioPreview = false,
  selectorKind,
  selectorTitle,
}: {
  asset?: ContentAsset;
  assets: ContentAsset[];
  emptyText: string;
  group?: ContentAssetGroup;
  groups: ContentAssetGroup[];
  onClear?: () => void;
  onEnsureAssets?: () => Promise<void>;
  onSelect: (selection: { assetId?: string; groupId?: string }) => void;
  onUpload?: (file: File) => Promise<void>;
  pickText: string;
  preferAudioPreview?: boolean;
  selectorKind: AssetSelectorKind;
  selectorTitle: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const previewAsset = asset || resolveGroupPreviewAsset(group, assets, preferAudioPreview ? 'audio/' : undefined) || resolveGroupPreviewAsset(group, assets);
  const previewUrl = assetPreviewUrl(previewAsset);
  const mimeType = previewAsset?.mimeType || '';
  const title = asset?.name || asset?.originalFileName || group?.name || pickText;
  const hasSelection = Boolean(asset || group);
  const isAudio = mimeType.startsWith('audio/');

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }
    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('pause', handlePause);
    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('pause', handlePause);
    };
  }, [previewUrl]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const toggleAudio = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
      return;
    }
    audio.pause();
    setIsPlaying(false);
  };

  const handlePick = () => {
    if (!hasSelection) {
      void onEnsureAssets?.().finally(() => setSelectorOpen(true));
    }
  };

  return (
    <>
      <div
        className={`remake-picker-card ${hasSelection ? 'selected' : 'empty'} ${isAudio ? 'audio' : ''}`}
        onClick={handlePick}
        onKeyDown={(event) => {
          if (!hasSelection && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            handlePick();
          }
        }}
        role={!hasSelection ? 'button' : undefined}
        tabIndex={!hasSelection ? 0 : undefined}
      >
        {hasSelection ? (
          <>
            {mimeType.startsWith('image/') && previewUrl ? <img alt={title} className="remake-picker-card-media" src={previewUrl} /> : null}
            {mimeType.startsWith('video/') && previewUrl ? <video className="remake-picker-card-media" muted preload="metadata" src={previewUrl} /> : null}
            {isAudio ? <AssetLibraryAudioWave className="remake-picker-card-audio-wave" /> : null}
            <div className="remake-picker-card-overlay">
              <span>{title}</span>
            </div>
            {isAudio && previewUrl ? (
              <>
                <button
                  aria-label={isPlaying ? '暂停播放' : '播放声音'}
                  className="remake-picker-card-audio-button"
                  onClick={(event) => { void toggleAudio(event); }}
                  type="button"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <audio ref={audioRef} preload="none" src={previewUrl} />
              </>
            ) : null}
            {onClear ? (
              <button
                aria-label="清除已选素材"
                className="remake-picker-card-clear"
                onClick={(event) => {
                  event.stopPropagation();
                  onClear();
                }}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
          </>
        ) : (
          <div className="remake-picker-card-placeholder">
            <Plus size={18} />
            <strong>选择素材</strong>
          </div>
        )}
      </div>
      <AssetSelector
        assets={assets}
        groups={groups}
        kind={selectorKind}
        onCancel={() => setSelectorOpen(false)}
        onSelect={(selection) => {
          onSelect(selection);
          setSelectorOpen(false);
        }}
        onUpload={onUpload}
        open={selectorOpen}
        selectedAssetId={asset?.id}
        selectedGroupId={group?.id}
        title={selectorTitle}
      />
    </>
  );
}

function confirmButtonText(cardType: VideoRemakeCardType) {
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

function expiredText(cardType: VideoRemakeCardType) {
  const label = cardTypeLabels[cardType] || '当前卡片';
  return `${label}基于旧版设定生成，当前已失效。`;
}

function isCompletedFinalVideoCard(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'final_video') {
    return false;
  }
  const data = asRecord(card.data);
  return Boolean(fieldText(data.videoUrl) || fieldText(data.status) === 'completed');
}

function ReadonlyCard({ children }: { children: ReactNode }) {
  return <div className="remake-card-body">{children}</div>;
}

function EditableCard({
  card,
  assets,
  groups,
  disabled,
  active,
  onEnsureAssets,
  onConfirm,
  onCancel,
  onEdit,
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

function renderItemTabs(
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

function renderStatusSummary(card: VideoRemakeCardMessage) {
  const data = asRecord(card.data);
  return fieldText(data.message) || fieldText(data.label) || fieldText(data.step);
}

function StatusCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const status = fieldText(data.status);
  const message = renderStatusSummary(props.card);
  const isUploaded = status === 'uploaded' || props.card.status === 'confirmed';
  const displayMessage = isUploaded && message.includes('正在读取基础信息')
    ? '视频已上传完成，基础信息已读取完成。'
    : message;
  return (
    <ReadonlyCard>
      <div className="remake-status-bubble remake-upload-bubble">
        <p>{displayMessage || (isUploaded ? '视频已上传完成，基础信息已读取完成。' : '正在上传视频，请稍候...')}</p>
        {!isUploaded ? (
          <div className="remake-progress-detail">
            <div className="remake-progress-track"><i style={{ width: '68%' }} /></div>
          </div>
        ) : null}
      </div>
    </ReadonlyCard>
  );
}

function VideoBasicInfoCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const lines = [
    // ['文件名', fieldText(data.fileName) || fieldText(data.title)],
    ['分辨率', normalizeResolution(data.resolution, data.resolutionDetail, data.aspectRatio)],
    ['宽高比', fieldText(data.aspectRatio)],
    ['视频时长', fieldText(data.duration)],
  ].filter(([, value]) => value);
  return (
    <ReadonlyCard>
      <div className="remake-video-basic">
        <ul>
          {lines.map(([label, value]) => (
            <li key={label}>
              <span>{label}：</span>
              <strong>{value}</strong>
            </li>
          ))}
        </ul>
      </div>
    </ReadonlyCard>
  );
}

function ExpertAnalysisCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const legacySections = ['audio', 'visual', 'pip']
    .map((key) => asRecord(data[key]))
    .filter((section) => Object.keys(section).length > 0);
  const sections = legacySections.length ? legacySections : [data];

  const readableLabels: Record<string, string> = {
    videoTitle: '视频标题',
    sceneDescription: '场景描述',
    characterImage: '人物形象',
    characterAction: '人物动作',
    expressionDetail: '表情细节',
    cameraMovement: '运镜方式',
    sceneChange: '景别变化',
    transition: '转场方式',
    cameraRhythm: '镜头节奏',
    soundEffect: '声音特效',
    subtitleStyle: '字幕样式',
    visualEffect: '画面特效',
    overallMood: '整体氛围',
    productInfo: '产品信息',
    appeared: '是否出现',
    summary: '总结',
    startSecond: '开始时间',
    endSecond: '结束时间',
    position: '位置',
    content: '内容',
    confidence: '置信度',
    label: '名称',
    description: '描述',
    start: '开始时间',
    end: '结束时间',
    startTime: '开始时间',
    endTime: '结束时间',
    duration: '时长',
    spokenCue: '口播',
    speckCue: '口播',
    speechCue: '口播',
    narrationCue: '口播',
    视频内容: '视频内容',
    场景描述: '场景描述',
    场景名称: '场景名称',
    人物描述: '人物描述',
    人物名称: '人物名称',
    产品描述: '产品描述',
    产品名称: '产品名称',
    产品信息: '产品信息',
    画中画信息: '画中画信息',
    开始秒: '开始秒',
    结束秒: '结束秒',
    口播线索: '口播线索',
    环境布置: '环境布置',
    空间层次: '空间层次',
    光线氛围: '光线氛围',
  };

  const humanKey = (key: string) => readableLabels[key] || key;

  const parseJsonLike = (value: string): unknown | null => {
    const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/```\s*$/u, '').trim();
    const candidates = [trimmed];
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(trimmed.slice(objectStart, objectEnd + 1));
    }
    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
    }
    for (const candidate of candidates) {
      const jsonText = candidate.trim();
      if (!jsonText.startsWith('{') && !jsonText.startsWith('[')) {
        continue;
      }
      try {
        return JSON.parse(jsonText);
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  };

  const stringify = (value: unknown): string => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const parsed = parseJsonLike(trimmed);
      if (parsed !== null) {
        return stringify(parsed);
      }
      return trimmed;
    }
    if (Array.isArray(value)) {
      return value.length ? value.map((item, index) => {
        if (typeof item === 'string') {
          return `${index + 1}. ${item}`;
        }
        const record = asRecord(item);
        const productName = fieldText(record['产品类型']) || `项目 ${index + 1}`;
        const productFeature = fieldText(record['产品特征']);
        const displayMode = fieldText(record['展示方式']);
        if (productFeature || displayMode) {
          return `${index + 1}. ${productName}${productFeature ? `，${productFeature}` : ''}${displayMode ? `；${displayMode}` : ''}`;
        }
        const summary: string = Object.entries(record)
          .filter(([key]) => !['id', 'type', 'raw'].includes(key))
          .map(([key, entry]) => `${humanKey(key)}：${stringify(entry)}`)
          .filter(Boolean)
          .join('；');
        return `${index + 1}. ${summary || String(item)}`;
      }).join('\n') : '';
    }
    if (value && typeof value === 'object') {
      return Object.entries(asRecord(value))
        .filter(([key]) => !['id', 'type', 'raw'].includes(key))
        .map(([key, item]) => `${humanKey(key)}：${stringify(item)}`)
        .filter((line) => !line.endsWith('：'))
        .join('；');
    }
    return value === undefined || value === null ? '' : String(value);
  };

  const visualSectionTitleMap: Record<string, string> = {
    task1: '基础识别',
    task2: '画面内容',
    task3: '镜头语言',
    task4: '视听元素',
    task5: '产品信息',
  };

  const visualFieldLabels: Record<string, string> = {
    视频标题: '视频标题',
    场景描述: '场景描述',
    人物形象: '人物形象',
    人物动作: '人物动作',
    表情细节: '表情细节',
    运镜方式: '运镜方式',
    景别变化: '景别变化',
    转场方式: '转场方式',
    镜头节奏: '镜头节奏',
    声音特效: '声音特效',
    字幕样式: '字幕样式',
    画面特效: '画面特效',
    整体氛围: '整体氛围',
  };

  const productText = (value: unknown, index: number) => {
    const record = asRecord(value);
    const info = asRecord(record['产品信息']);
    return compactLines([
      [`产品 ${index + 1}`, fieldText(record['产品类型'])],
      ['特征', fieldText(record['产品特征'])],
      ['展示方式', fieldText(record['展示方式'])],
      ['品牌', fieldText(info['品牌']) && fieldText(info['品牌']) !== '无' ? fieldText(info['品牌']) : undefined],
      ['型号', fieldText(info['型号']) && fieldText(info['型号']) !== '无' ? fieldText(info['型号']) : undefined],
    ]) || stringify(value);
  };

  const timeRangeText = (record: Record<string, unknown>) => {
    const start = fieldText(record['开始秒'] ?? record.startSecond ?? record.start ?? record.startTime);
    const end = fieldText(record['结束秒'] ?? record.endSecond ?? record.end ?? record.endTime);
    return start || end ? `${start || '?'}s - ${end || '?'}s` : '';
  };

  const structuredArrayPrefix = (key: string) => {
    if (key.includes('场景')) {
      return '场景';
    }
    if (key.includes('人物')) {
      return '人物';
    }
    if (key.includes('产品')) {
      return '产品';
    }
    if (key.includes('画中画')) {
      return '画中画';
    }
    if (key.includes('口播')) {
      return '口播';
    }
    return humanKey(key).replace(/(描述|信息|列表)$/u, '') || '项目';
  };

  const structuredArrayRows = (key: string, value: unknown[]) => {
    const prefix = structuredArrayPrefix(key);
    return value.map((item, index) => {
      if (typeof item === 'string') {
        return { label: `${prefix} ${index + 1}`, text: item.trim() };
      }
      const itemRecord = asRecord(item);
      const wrappedEntry = Object.entries(itemRecord).length === 1
        ? Object.entries(itemRecord)[0]
        : undefined;
      const record = wrappedEntry && asRecord(wrappedEntry[1]) ? asRecord(wrappedEntry[1]) : itemRecord;
      const title = fieldText(record['场景名称'])
        || fieldText(record['人物名称'])
        || fieldText(record['产品名称'])
        || fieldText(record.label)
        || fieldText(record.name)
        || fieldText(wrappedEntry?.[0])
        || `${prefix} ${index + 1}`;
      const skippedKeys = new Set([
        'id',
        'type',
        'raw',
        'label',
        'name',
        '场景名称',
        '人物名称',
        '产品名称',
        '开始秒',
        '结束秒',
        'startSecond',
        'endSecond',
        'start',
        'end',
        'startTime',
        'endTime',
      ]);
      const lines = Object.entries(record)
        .filter(([entryKey]) => !skippedKeys.has(entryKey))
        .map(([entryKey, entryValue]) => [humanKey(entryKey), stringify(entryValue)] as [string, string])
        .filter(([, entryValue]) => entryValue.trim());
      const timeRange = timeRangeText(record);
      const text = compactLines([
        ['时间', timeRange],
        ...lines,
      ]);
      return { label: title, text: text || stringify(item) };
    }).filter((entry) => entry.text.trim());
  };

  const isEntityRecordKey = (key: string) => /^(?:场景|人物|产品|画中画|口播)\s*[0-9一二三四五六七八九十]+/u.test(key.trim());

  const structuredRowsFromAny = (value: unknown, sourceKey = '解析内容'): Array<{ label: string; text: string }> => {
    if (typeof value === 'string') {
      const parsed = parseJsonLike(value);
      if (parsed !== null) {
        return structuredRowsFromAny(parsed, sourceKey);
      }
      return value.trim() ? [{ label: humanKey(sourceKey), text: value.trim() }] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => {
        if (typeof item === 'string') {
          return item.trim() ? [{ label: `${structuredArrayPrefix(sourceKey)} ${index + 1}`, text: item.trim() }] : [];
        }
        const record = asRecord(item);
        const wrappedEntry = Object.entries(record).length === 1 ? Object.entries(record)[0] : undefined;
        if (wrappedEntry && asRecord(wrappedEntry[1])) {
          return structuredRowsFromAny(wrappedEntry[1], wrappedEntry[0]);
        }
        const text = stringify(item);
        return text.trim() ? [{ label: `${structuredArrayPrefix(sourceKey)} ${index + 1}`, text }] : [];
      });
    }
    if (value && typeof value === 'object') {
      const record = asRecord(value);
      const entries = Object.entries(record);
      const entityRows = entries.flatMap(([key, entry]) => {
        if (isEntityRecordKey(key) || Array.isArray(entry)) {
          return structuredRowsFromAny(entry, key);
        }
        return [];
      });
      if (entityRows.length) {
        const directRows = entries.flatMap(([key, entry]) => {
          if (isEntityRecordKey(key) || Array.isArray(entry)) {
            return [];
          }
          const text = stringify(entry);
          return text.trim() ? [{ label: visualFieldLabels[key] || humanKey(key), text }] : [];
        });
        return [...directRows, ...entityRows];
      }
      const label = isEntityRecordKey(sourceKey) ? sourceKey : (visualFieldLabels[sourceKey] || humanKey(sourceKey));
      const skippedKeys = new Set(['id', 'type', 'raw', 'label', 'name']);
      const text = compactLines(entries
        .filter(([key]) => !skippedKeys.has(key))
        .map(([key, entry]) => [humanKey(key), stringify(entry)] as [string, string | undefined]));
      return text.trim() ? [{ label, text }] : [];
    }
    const text = stringify(value);
    return text.trim() ? [{ label: humanKey(sourceKey), text }] : [];
  };

  const visualContentRows = (value: unknown, sourceKey = '') => {
    if (Array.isArray(value)) {
      const rows = structuredArrayRows(sourceKey, value);
      if (rows.length) {
        return rows;
      }
      return value.map((item, index) => ({ label: `产品 ${index + 1}`, text: productText(item, index) })).filter((entry) => entry.text.trim());
    }
    const record = asRecord(value);
    const rows = Object.entries(record).flatMap(([key, entry]) => {
      if (isEntityRecordKey(key)) {
        return structuredRowsFromAny(entry, key);
      }
      if (Array.isArray(entry)) {
        return structuredRowsFromAny(entry, key);
      }
      const text = stringify(entry);
      return text.trim() ? [{ label: visualFieldLabels[key] || humanKey(key), text }] : [];
    });
    return rows.length ? rows : [{ label: '解析内容', text: stringify(value) }];
  };

  const visualRowsFromTaskJson = (content: string) => {
    const trimmed = content.trim();
    const parsedJson = parseJsonLike(trimmed);
    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      return [{ label: '解析内容', text: trimmed }];
    }
    return Object.entries(parsedJson).map(([taskKey, taskValue]) => {
      const task = asRecord(taskValue);
      const fields = Object.entries(task).flatMap(([fieldKey, fieldValue]) => {
        if (fieldKey === 'content') {
          return structuredRowsFromAny(fieldValue, fieldKey);
        }
        return structuredRowsFromAny(fieldValue, fieldKey);
      });
      const fallbackFields = fields.length ? fields : structuredRowsFromAny(taskValue, taskKey);
      return { label: visualSectionTitleMap[taskKey] || humanKey(taskKey) || '解析内容', fields: fallbackFields };
    }).filter((entry) => entry.fields.length);
  };

  const pipItemsText = (items: unknown[]) => {
    return items.map((item, index) => {
      const record = asRecord(item);
      const start = fieldText(record.startSecond);
      const end = fieldText(record.endSecond);
      return compactLines([
        [`画中画 ${index + 1}`, fieldText(record.label)],
        ['时间', start || end ? `${start || '?'}s - ${end || '?'}s` : undefined],
        ['位置', fieldText(record.position)],
        ['内容', stringify(record.content || record.description || record.summary)],
        ['置信度', fieldText(record.confidence)],
      ]);
    }).filter(Boolean).join('\n\n');
  };

  const pipRowsFromLooseText = (value: string) => {
    const text = value.trim();
    if (!text) {
      return [];
    }
    const itemBlocks = Array.from(text.matchAll(/\{[\s\S]*?["']?content["']?\s*:\s*["'][\s\S]*?["']\s*,?\s*["']?confidence["']?\s*:\s*[^}\n]+[\s\S]*?\}/giu))
      .map((match) => match[0]);
    const rows = itemBlocks.map((block, index) => {
      const pickString = (key: string) => {
        const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']*)["']`, 'iu');
        return block.match(pattern)?.[1]?.trim() || '';
      };
      const pickNumber = (key: string) => {
        const pattern = new RegExp(`["']?${key}["']?\\s*:\\s*([0-9.]+)`, 'iu');
        return block.match(pattern)?.[1]?.trim() || '';
      };
      const start = pickNumber('startSecond');
      const end = pickNumber('endSecond');
      const rowText = compactLines([
        ['时间', start || end ? `${start || '?'}s - ${end || '?'}s` : undefined],
        ['位置', pickString('position')],
        ['内容', pickString('content')],
        ['置信度', pickNumber('confidence')],
      ]);
      return rowText ? { label: `画中画 ${index + 1}`, text: rowText } : null;
    }).filter((row): row is { label: string; text: string } => Boolean(row));
    return rows;
  };

  const rowsForSection = (section: Record<string, unknown>) => {
    const expertKey = fieldText(section.expertKey);
    const roleName = fieldText(section.roleName);
    if (expertKey === 'audio' || roleName.includes('音频')) {
      return [{ label: '口播内容', text: fieldText(section.spokenContent) || fieldText(section.content) || fieldText(section.summary) }];
    }
    if (expertKey === 'visual' || roleName.includes('视频')) {
      return visualRowsFromTaskJson(fieldText(section.content) || fieldText(section.summary));
    }
    const pictureInPicture = asRecord(section.pictureInPicture);
    const items = Array.isArray(section.items) ? section.items : Array.isArray(pictureInPicture.items) ? pictureInPicture.items : [];
    const appeared = Boolean(section.appeared ?? pictureInPicture.appeared);
    if (expertKey === 'pip' || roleName.includes('画中画')) {
      const looseRows = pipRowsFromLooseText(fieldText(section.content) || fieldText(section.summary));
      if (!items.length && looseRows.length) {
        return looseRows;
      }
      if (!appeared || items.length === 0) {
        return [{ label: '画中画信息', text: fieldText(section.summary) || fieldText(pictureInPicture.summary) || '无画中画' }];
      }
      return [{ label: '画中画信息', text: pipItemsText(items) }];
    }
    return [{ label: '解析内容', text: fieldText(section.content) || fieldText(section.summary) }];
  };

  const hasFieldList = (entry: ReturnType<typeof rowsForSection>[number]): entry is { label: string; fields: Array<{ label: string; text: string }> } => (
    'fields' in entry && Array.isArray(entry.fields)
  );

  return (
    <ReadonlyCard>
      <div className="remake-expert-details">
        {sections.map((section, index) => {
          const roleName = fieldText(section.roleName) || `专家 ${index + 1}`;
          const entries = rowsForSection(section).filter((entry) => {
            if (hasFieldList(entry)) {
              return entry.fields.length;
            }
            return fieldText(entry.text).trim();
          });
          return (
            <section className="remake-expert-detail" key={`${roleName}-${index}`}>
              {entries.length ? entries.map((entry) => (
                <div className="remake-expert-row" key={entry.label}>
                  <span>{entry.label}</span>
                  {hasFieldList(entry) ? (
                    <div className="remake-expert-field-list">
                      {entry.fields.map((field, fieldIndex) => (
                        <p key={`${entry.label}-${field.label}-${fieldIndex}`}>
                          <b>{field.label}：</b>{field.text}
                        </p>
                      ))}
                    </div>
                  ) : <p>{fieldText(entry.text)}</p>}
                </div>
              )) : <p>等待专家分析结果同步。</p>}
            </section>
          );
        })}
      </div>
    </ReadonlyCard>
  );
}

function BasicInfoCard(props: CardRendererProps) {
  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const resolution = normalizeResolution(data.resolution, data.resolutionDetail, data.aspectRatio);
        return props.card.status === 'editing' ? (
          <div className="remake-card-fields two">
            <label>
              分辨率
              <Select
                options={['480p', '720p', '1080p'].map((value) => ({ label: value, value }))}
                placeholder="请选择分辨率"
                value={resolution || undefined}
                onChange={(value) => setDraft({ ...data, resolution: value })}
              />
            </label>
            <label>
              宽高比
              <Select
                options={['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].map((value) => ({ label: value, value }))}
                placeholder="请选择宽高比"
                value={nearestPresetAspectRatio(data.aspectRatio) || undefined}
                onChange={(value) => setDraft({ ...data, aspectRatio: value })}
              />
            </label>
          </div>
        ) : (
          <SummaryBlock
            lines={compactLines([
              ['分辨率', normalizeResolution(data.resolution, data.resolutionDetail, data.aspectRatio)],
              ['宽高比', fieldText(data.aspectRatio)],
            ])}
          />
        );
      }}
    </EditableCard>
  );
}

function CharacterCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && JSON.stringify(props.card.data).includes('assetId')) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft, setSelector }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ label: '人物 1', required: true, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const mode = fieldText(item.referenceMode) || 'prompt';
        const hasSelectedAssetReference = Boolean(fieldText(item.assetId) || fieldText(item.groupId));
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [...items, { label: `人物 ${items.length + 1}`, required: true, referenceMode: 'prompt', manuallyAdded: true }];
          setDraft({ ...data, items: nextItems });
          setActiveIndex(nextItems.length - 1);
        };
        const removeItem = () => {
          if (items.length <= 1) {
            return;
          }
          const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
          setDraft({ ...data, items: nextItems });
          setActiveIndex(Math.min(index, nextItems.length - 1));
        };

        if (props.card.status !== 'editing') {
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '人物')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `人物 ${index + 1}`],
                  ['是否需要', item.required === false ? '不需要' : '需要'],
                  ['参考方式', (fieldText(item.referenceMode) || (hasSelectedAssetReference ? 'asset' : 'prompt')) === 'asset' ? '参考素材' : '参考提示词'],
                  ['人物素材', hasSelectedAssetReference ? '已选择人物素材' : undefined],
                  ['人物描述提示词', characterDisplayPromptText(item)],
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '人物', { addLabel: '+ 添加人物', onAdd: addItem })}
            <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
              <AppForm.Item label="当前">
                <div className="remake-current-line">
                  <span>{fieldText(item.label) || `人物 ${index + 1}`}</span>
                  {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
                </div>
              </AppForm.Item>
              <AppForm.Item className="remake-radio-field" label="是否需要此人物">
                <Radio.Group
                  options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                  value={item.required === false ? 'no' : 'yes'}
                  onChange={(event) => setItem({ required: event.target.value !== 'no' })}
                />
              </AppForm.Item>
              {item.required === false ? null : (
                <>
                  <AppForm.Item className="remake-radio-field" label="人物设定参考">
                    <Radio.Group
                      options={[{ label: '参考素材', value: 'asset' }, { label: '参考提示词', value: 'prompt' }]}
                      value={mode}
                      onChange={(event) => setItem({ referenceMode: event.target.value, assetId: event.target.value === 'prompt' ? '' : item.assetId })}
                    />
                  </AppForm.Item>
                  {mode === 'asset' ? (
                    <AppForm.Item label="人物素材">
                      <SquareReferencePicker
                        asset={findSelectedAsset(props.assets, item.assetId)}
                        assets={props.assets}
                        emptyText="点击选择人物素材"
                        group={findSelectedGroup(props.groups, item.groupId)}
                        groups={props.groups}
                        onClear={fieldText(item.assetId) || fieldText(item.groupId) ? () => setItem({ assetId: '', groupId: '' }) : undefined}
                        onEnsureAssets={props.onEnsureAssets}
                        onSelect={(selection) => setItem({ assetId: selection.assetId || '', groupId: selection.groupId || '' })}
                        pickText="选择人物素材"
                        selectorKind="character"
                        selectorTitle="选择人物素材"
                      />
                    </AppForm.Item>
                  ) : null}
                  <AppForm.Item label="人物描述提示词">
                    <Input.TextArea
                      autoSize={{ minRows: 3 }}
                      value={cleanReferencePromptText(item.characterPrompt)}
                      onChange={(event) => setItem({ characterPrompt: event.target.value })}
                    />
                  </AppForm.Item>
                </>
              )}
            </AppForm>
          </div>
        );
      }}
    </EditableCard>
  );
}

function SceneCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && (JSON.stringify(props.card.data).includes('groupId') || JSON.stringify(props.card.data).includes('assetId') || JSON.stringify(props.card.data).includes('assetIds'))) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft, setSelector }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ label: '场景 1', required: true, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const mode = fieldText(item.referenceMode) || 'prompt';
        const selectedAssetIds = selectedAssetIdsFromItem(item);
        const selectedAssets = findSelectedAssets(props.assets, selectedAssetIds);
        const hasSelectedAssetReference = selectedAssetIds.length > 0 || Boolean(fieldText(item.groupId));
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [...items, { label: `场景 ${items.length + 1}`, required: true, referenceMode: 'prompt', manuallyAdded: true }];
          setDraft({ ...data, items: nextItems });
          setActiveIndex(nextItems.length - 1);
        };
        const removeItem = () => {
          if (items.length <= 1) {
            return;
          }
          const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
          setDraft({ ...data, items: nextItems });
          setActiveIndex(Math.min(index, nextItems.length - 1));
        };

        if (props.card.status !== 'editing') {
          const sceneRequired = item.required !== false;
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '场景')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `场景 ${index + 1}`],
                  ['是否需要', sceneRequired ? '需要' : '不需要'],
                  ...(sceneRequired ? [
                    ['参考方式', (fieldText(item.referenceMode) || (hasSelectedAssetReference ? 'asset' : 'prompt')) === 'asset' ? '参考素材' : '参考提示词'],
                    ['场景素材', hasSelectedAssetReference ? '已选择场景素材' : undefined],
                    ['场景描述', cleanReferencePromptText(item.description)],
                  ] as Array<[string, string | undefined]> : []),
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '场景', { addLabel: '+ 添加场景', onAdd: addItem })}
            <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
              <AppForm.Item label="当前">
                <div className="remake-current-line">
                  <span>{fieldText(item.label) || `场景 ${index + 1}`}</span>
                  {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
                </div>
              </AppForm.Item>
              <AppForm.Item className="remake-radio-field" label="是否需要此场景">
                <Radio.Group
                  options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                  value={item.required === false ? 'no' : 'yes'}
                  onChange={(event) => setItem({ required: event.target.value !== 'no' })}
                />
              </AppForm.Item>
              {item.required === false ? null : (
                <>
                  <AppForm.Item className="remake-radio-field" label="场景设定参考">
                    <Radio.Group
                      options={[{ label: '参考素材', value: 'asset' }, { label: '参考提示词', value: 'prompt' }]}
                      value={mode}
                      onChange={(event) => setItem({
                        referenceMode: event.target.value,
                        groupId: event.target.value === 'prompt' ? '' : (selectedAssetIds.length ? '' : item.groupId),
                        assetId: event.target.value === 'prompt' ? '' : item.assetId,
                        assetIds: event.target.value === 'prompt' ? [] : selectedAssetIds,
                      })}
                    />
                  </AppForm.Item>
                  {mode === 'asset' ? (
                    <AppForm.Item label="场景素材">
                      <SquareReferencePicker
                        asset={selectedAssets[0]}
                        assets={props.assets}
                        emptyText="点击选择场景素材"
                        group={undefined}
                        groups={[]}
                        onEnsureAssets={props.onEnsureAssets}
                        onClear={hasSelectedAssetReference ? () => setItem({ groupId: '', assetId: '', assetIds: [] }) : undefined}
                        onSelect={(selection) => {
                          const nextId = fieldText(selection.assetId);
                          setItem({ groupId: '', assetId: nextId, assetIds: nextId ? [nextId] : [] });
                        }}
                        onUpload={props.onUploadReferenceImage ? async (file) => {
                          const asset = await props.onUploadReferenceImage?.('scene', file);
                          if (!asset) {
                            return;
                          }
                          setItem({ groupId: '', assetId: asset.id, assetIds: [asset.id] });
                        } : undefined}
                        pickText="选择素材"
                        selectorKind="scene_asset"
                        selectorTitle="选择场景素材"
                      />
                    </AppForm.Item>
                  ) : null}
                  <AppForm.Item label="场景描述">
                    <Input.TextArea autoSize={{ minRows: 3 }} value={cleanReferencePromptText(item.description)} onChange={(event) => setItem({ description: event.target.value })} />
                  </AppForm.Item>
                </>
              )}
            </AppForm>
          </div>
        );
      }}
    </EditableCard>
  );
}

function ProductCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && (JSON.stringify(props.card.data).includes('groupId') || JSON.stringify(props.card.data).includes('assetId') || JSON.stringify(props.card.data).includes('assetIds'))) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft, setSelector }) => {
        const data = asRecord(draft);
        const rawItems = asItems(data.items);
        const hasProductData = rawItems.length > 0 || Boolean(
          fieldText(data.description)
          || fieldText(data.presentation)
          || fieldText(data.groupId)
          || fieldText(data.assetId)
          || fieldText(data.productType)
          || fieldText(data.feature)
          || fieldText(data.label),
        );
        const items = rawItems.length ? rawItems : [hasProductData ? data : { label: '产品 1', noProduct: true, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const mode = fieldText(item.referenceMode) || fieldText(data.referenceMode) || 'prompt';
        const selectedAssetIds = selectedAssetIdsFromItem(item);
        const selectedAssets = findSelectedAssets(props.assets, selectedAssetIds);
        const noProduct = fieldBool(item.noProduct) || fieldBool(data.noProduct) || !hasProductData;
        const setItem = (patch: Record<string, unknown>) => {
          if (rawItems.length) {
            setDraft({ ...data, items: updateAt(items, index, patch) });
            return;
          }
          setDraft({ ...data, ...patch });
        };
        const addItem = () => {
          const nextBaseItems = rawItems.length ? items : [{ ...data, label: fieldText(data.label) || '产品 1' }];
          const nextItems = [...nextBaseItems, { label: `产品 ${nextBaseItems.length + 1}`, noProduct: false, referenceMode: 'prompt', manuallyAdded: true }];
          setDraft({ ...data, items: nextItems });
          setActiveIndex(nextItems.length - 1);
        };
        const removeItem = () => {
          if (items.length <= 1) {
            return;
          }
          const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
          setDraft({ ...data, items: nextItems });
          setActiveIndex(Math.min(index, nextItems.length - 1));
        };

        if (props.card.status !== 'editing') {
          if (noProduct) {
            return <SummaryBlock lines="不需要产品" />;
          }
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '产品')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `产品 ${index + 1}`],
                  ['是否需要产品', fieldBool(item.noProduct) ? '不需要' : '需要'],
                  ['参考方式', (fieldText(item.referenceMode) || mode) === 'asset' ? '参考素材' : '参考提示词'],
                  ['产品素材', selectedAssetIds.length ? '已选择产品素材' : fieldText(item.groupId) ? '已选择产品组' : undefined],
                  ['产品描述', cleanReferencePromptText(item.description)],
                  ['展示方式', cleanReferencePromptText(item.presentation)],
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '产品', { addLabel: '+ 添加产品', onAdd: addItem })}
            <div className="remake-current-line">
              <span>当前：{fieldText(item.label) || `产品 ${index + 1}`}</span>
              {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
            </div>
            <label className="remake-radio-field">
              <span>是否需要产品</span>
              <Radio.Group
                options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                value={noProduct ? 'no' : 'yes'}
                onChange={(event) => setItem({ noProduct: event.target.value === 'no' })}
              />
            </label>
            {noProduct ? null : (
              <>
                <label className="remake-radio-field">
                  <span>产品设定参考</span>
                  <Radio.Group
                    options={[{ label: '参考素材', value: 'asset' }, { label: '参考提示词', value: 'prompt' }]}
                    value={mode}
                    onChange={(event) => setItem({
                      referenceMode: event.target.value,
                      groupId: event.target.value === 'prompt' ? '' : (selectedAssetIds.length ? '' : item.groupId),
                      assetId: event.target.value === 'prompt' ? '' : item.assetId,
                      assetIds: event.target.value === 'prompt' ? [] : selectedAssetIds,
                    })}
                  />
                </label>
                {mode === 'asset' ? (
                  <label>
                    产品素材
                    <div className="remake-asset-field">
                      <SquareReferencePicker
                        asset={selectedAssets[0]}
                        assets={props.assets}
                        emptyText="点击选择产品素材"
                        group={undefined}
                        groups={[]}
                        onEnsureAssets={props.onEnsureAssets}
                        onClear={selectedAssetIds.length || fieldText(item.groupId) ? () => setItem({ groupId: '', assetId: '', assetIds: [] }) : undefined}
                        onSelect={(selection) => {
                          const nextId = fieldText(selection.assetId);
                          setItem({ groupId: '', assetId: nextId, assetIds: nextId ? [nextId] : [] });
                        }}
                        onUpload={props.onUploadReferenceImage ? async (file) => {
                          const asset = await props.onUploadReferenceImage?.('product', file);
                          if (!asset) {
                            return;
                          }
                          setItem({ groupId: '', assetId: asset.id, assetIds: [asset.id] });
                        } : undefined}
                        pickText="选择素材"
                        selectorKind="product_asset"
                        selectorTitle="选择产品素材"
                      />
                    </div>
                  </label>
                ) : null}
                <label>产品描述<Input.TextArea autoSize={{ minRows: 2 }} value={cleanReferencePromptText(item.description)} onChange={(event) => setItem({ description: event.target.value })} /></label>
                <label>展示方式<Input.TextArea autoSize={{ minRows: 2 }} value={cleanReferencePromptText(item.presentation)} onChange={(event) => setItem({ presentation: event.target.value })} /></label>
              </>
            )}
          </div>
        );
      }}
    </EditableCard>
  );
}

function PipCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const data = asRecord(props.card.data);
    const items = asItems(data.items);
    const focusIndex = Number(data.activeItemIndex);
    setActiveIndex(Number.isFinite(focusIndex) && focusIndex >= 0
      ? Math.min(focusIndex, Math.max(0, items.length - 1))
      : 0);
  }, [props.card.cardId]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ id: 'pip_1', label: '画中画 1', required: false, referenceMode: 'prompt' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const pipPrompt = fieldText(item.replacementPrompt) || fieldText(item.content);
        const videoDuration = Math.max(0, Math.floor(Number(props.videoDurationSeconds || 0)));
        const uploadedImageUrl = fieldText(item.replacementAssetUrl || item.fileUrl);
        const uploadedImageName = fieldText(item.replacementAssetName || item.originalFileName || item.storedFileName);
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [...items, { id: `pip_${items.length + 1}`, label: `画中画 ${items.length + 1}`, required: true, referenceMode: 'asset', manuallyAdded: true }];
          setDraft({ ...data, items: nextItems });
          setActiveIndex(nextItems.length - 1);
        };
        const removeItem = () => {
          if (items.length <= 1) {
            return;
          }
          const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
          setDraft({ ...data, items: nextItems });
          setActiveIndex(Math.min(index, nextItems.length - 1));
        };

        if (props.card.status !== 'editing') {
          if (item.required === false && !items.some((entry) => entry.required !== false)) {
            return <SummaryBlock lines="不需要画中画" />;
          }
          return (
            <div className="remake-card-fields">
              {renderItemTabs(items, activeIndex, setActiveIndex, '画中画')}
              <SummaryBlock
                lines={compactLines([
                  ['当前', fieldText(item.label) || `画中画 ${index + 1}`],
                  ['是否需要', item.required === false ? '不需要' : '需要'],
                  ['出现时间', fieldText(item.startSecond) || fieldText(item.endSecond) ? `${fieldText(item.startSecond) || '?'}s - ${fieldText(item.endSecond) || '?'}s` : undefined],
                  ['位置', fieldText(item.position)],
                  ['图片素材', uploadedImageName || (uploadedImageUrl ? '已上传图片' : undefined)],
                  ['画中画描述提示词', pipPrompt],
                ])}
              />
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            {renderItemTabs(items, activeIndex, setActiveIndex, '画中画', { addLabel: '+ 添加画中画', onAdd: addItem })}
            <div className="remake-current-line">
              <span>当前：{fieldText(item.label) || `画中画 ${index + 1}`}</span>
              {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
            </div>
            <label className="remake-radio-field">
              <span>是否需要此画中画</span>
              <Radio.Group
                options={[{ label: '需要', value: 'yes' }, { label: '不需要', value: 'no' }]}
                value={item.required === false ? 'no' : 'yes'}
                onChange={(event) => setItem({ required: event.target.value !== 'no' })}
              />
            </label>
            {item.required === false ? null : (
              <>
                <div className="remake-card-fields three">
                  <label>
                    开始时间（秒）
                    <InputNumber
                      controls
                      min={0}
                      max={videoDuration ? Math.max(0, videoDuration - 1) : undefined}
                      precision={0}
                      value={Number.isFinite(Number(item.startSecond)) ? Number(item.startSecond) : null}
                      onChange={(value) => setItem({ startSecond: value ?? '' })}
                    />
                  </label>
                  <label>
                    结束时间（秒）
                    <InputNumber
                      controls
                      min={0}
                      max={videoDuration ? Math.max(0, videoDuration - 1) : undefined}
                      precision={0}
                      value={Number.isFinite(Number(item.endSecond)) ? Number(item.endSecond) : null}
                      onChange={(value) => setItem({ endSecond: value ?? '' })}
                    />
                  </label>
                  <label>大致位置<Input value={fieldText(item.position)} onChange={(event) => setItem({ position: event.target.value })} /></label>
                </div>
                <label>
                  画中画图片素材
                  <div className="remake-asset-field">
                    {uploadedImageUrl ? (
                      <div className="remake-selected-reference">
                        <div className="remake-selected-thumb">
                          <img src={mediaUrl(uploadedImageUrl)} alt={uploadedImageName || '画中画图片'} />
                        </div>
                        <div className="remake-selected-info">
                          <strong>{uploadedImageName || '已上传图片'}</strong>
                          <small>图片素材</small>
                        </div>
                      </div>
                    ) : (
                      <span>未上传图片</span>
                    )}
                    <div className="remake-asset-actions">
                      {uploadedImageUrl ? <Button size="small" onClick={() => setItem({ replacementAssetUrl: '', replacementAssetName: '', replacementAssetMimeType: '', replacementAssetType: '' })}>清除</Button> : null}
                      <Upload
                        accept="image/*"
                        beforeUpload={(file) => {
                          if (!file.type.startsWith('image/')) {
                            return Upload.LIST_IGNORE;
                          }
                          void props.onUploadPipImage?.(file).then((result) => {
                            setItem({
                              referenceMode: 'asset',
                              replacementAssetUrl: result.fileUrl,
                              replacementAssetName: result.originalFileName,
                              replacementAssetMimeType: result.mimeType,
                              replacementAssetSize: result.fileSize,
                              replacementAssetType: 'image',
                            });
                          });
                          return Upload.LIST_IGNORE;
                        }}
                        maxCount={1}
                        showUploadList={false}
                      >
                        <Button size="small">上传图片</Button>
                      </Upload>
                    </div>
                  </div>
                </label>
                <label>画中画描述提示词<Input.TextArea autoSize={{ minRows: 3 }} value={pipPrompt} onChange={(event) => setItem({ replacementPrompt: event.target.value })} /></label>
              </>
            )}
          </div>
        );
      }}
    </EditableCard>
  );
}

function AudioCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('voice');
  useEffect(() => {
    setActiveIndex(0);
    setActiveTab('voice');
  }, [props.card.cardId]);
  useEffect(() => {
    if (props.card.status === 'editing' && (JSON.stringify(props.card.data).includes('groupId') || JSON.stringify(props.card.data).includes('assetId'))) {
      void props.onEnsureAssets?.();
    }
  }, [props.card.data, props.card.status, props.onEnsureAssets]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft, setSelector }) => {
        const data = asRecord(draft);
        const items = asItems(data.items).length ? asItems(data.items) : [{ label: '人物 1 声音', voice: '原声' }];
        const index = Math.min(activeIndex, items.length - 1);
        const item = items[index] || {};
        const currentCharacterLabel = resolveAudioCharacterLabel(item, index);
        const setItem = (patch: Record<string, unknown>) => setDraft({ ...data, items: updateAt(items, index, patch) });
        const addItem = () => {
          const nextItems = [
            ...items,
            {
              label: `人物 ${items.length + 1} 声音`,
              characterLabel: `人物 ${items.length + 1}`,
              characterIndex: items.length,
              voice: '原声',
              voiceStyle: '',
              manuallyAdded: true,
            },
          ];
          setDraft({ ...data, items: nextItems });
          setActiveIndex(nextItems.length - 1);
        };
        const removeItem = () => {
          if (items.length <= 1) {
            return;
          }
          const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
          setDraft({ ...data, items: nextItems });
          setActiveIndex(Math.min(index, nextItems.length - 1));
        };

        if (props.card.status !== 'editing') {
          return (
            <div className="remake-card-fields">
              <Tabs
                activeKey={activeTab}
                items={[
                  { key: 'voice', label: '人声' },
                  { key: 'audio', label: '音频' },
                ]}
                onChange={setActiveTab}
              />
              {activeTab === 'voice' ? (
                <>
                  {renderItemTabs(items, activeIndex, setActiveIndex, '人物')}
                  <SummaryBlock
                    lines={compactLines([
                      ['当前', currentCharacterLabel],
                      ['声音策略', fieldText(item.voice)],
                      ['声音库', fieldText(item.groupId) || fieldText(item.assetId) ? '已选择声音库' : undefined],
                      ['声音描述', fieldText(item.voiceStyle)],
                    ])}
                  />
                </>
              ) : (
                <SummaryBlock
                  lines={compactLines([
                    ['BGM', fieldText(data.bgm)],
                    ['音效', fieldText(data.soundEffects)],
                  ])}
                  emptyText="暂无音频设定。"
                />
              )}
            </div>
          );
        }

        return (
          <div className="remake-card-fields">
            <Tabs
              activeKey={activeTab}
              items={[
                { key: 'voice', label: '人声' },
                { key: 'audio', label: '音频' },
              ]}
              onChange={setActiveTab}
            />
            {activeTab === 'voice' ? (
              <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
                {renderItemTabs(items, activeIndex, setActiveIndex, '人物', { addLabel: '+ 添加人声', onAdd: addItem })}
                <AppForm.Item label="当前">
                  <div className="remake-current-line">
                    <span>{currentCharacterLabel}</span>
                    {items.length > 1 && fieldBool(item.manuallyAdded) ? <Button size="small" danger type="text" onClick={removeItem}>删除</Button> : null}
                  </div>
                </AppForm.Item>
                <AppForm.Item label="人声标签">
                  <Input
                    value={fieldText(item.characterLabel) || fieldText(item.label)}
                    onChange={(event) => setItem({ characterLabel: event.target.value, label: `${event.target.value || `人物 ${index + 1}`} 声音` })}
                  />
                </AppForm.Item>
                <AppForm.Item label="声音策略">
                  <Select
                    options={['原声', '替换声', '不生成'].map((value) => ({ label: value, value }))}
                    value={fieldText(item.voice) || '原声'}
                    onChange={(value) => setItem({ voice: value })}
                  />
                </AppForm.Item>
                {fieldText(item.voice) === '替换声' ? (
                  <AppForm.Item label="声音库">
                    <SquareReferencePicker
                      asset={findSelectedAsset(props.assets, item.assetId)}
                      assets={props.assets}
                      emptyText="点击选择声音库"
                      group={findSelectedGroup(props.groups, item.groupId)}
                      groups={props.groups}
                      onClear={fieldText(item.groupId) || fieldText(item.assetId) ? () => setItem({ groupId: '', assetId: '' }) : undefined}
                      onEnsureAssets={props.onEnsureAssets}
                      onSelect={(selection) => setItem({ groupId: selection.groupId || '', assetId: selection.assetId || '' })}
                      pickText="选择声音库"
                      preferAudioPreview
                      selectorKind="voice_group"
                      selectorTitle="选择声音库"
                    />
                  </AppForm.Item>
                ) : null}
                <AppForm.Item label="声音描述">
                  <Input.TextArea autoSize={{ minRows: 2 }} value={fieldText(item.voiceStyle)} onChange={(event) => setItem({ voiceStyle: event.target.value })} />
                </AppForm.Item>
              </AppForm>
            ) : (
              <AppForm className="remake-card-form remake-card-form-horizontal" layout="horizontal" labelCol={{ flex: '112px' }} wrapperCol={{ flex: '1 1 0' }}>
                <AppForm.Item label="BGM">
                  <Input value={fieldText(data.bgm)} onChange={(event) => setDraft({ ...data, bgm: event.target.value })} />
                </AppForm.Item>
                <AppForm.Item label="音效">
                  <Input value={fieldText(data.soundEffects)} onChange={(event) => setDraft({ ...data, soundEffects: event.target.value })} />
                </AppForm.Item>
              </AppForm>
            )}
          </div>
        );
      }}
    </EditableCard>
  );
}

function ScriptCard(props: CardRendererProps) {
  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        return props.card.status === 'editing' ? (
          <div className="remake-card-fields">
            <label>口播/人声内容<Input.TextArea autoSize={{ minRows: 7 }} value={fieldText(data.content)} onChange={(event) => setDraft({ ...data, content: event.target.value })} /></label>
          </div>
        ) : (
          <SummaryBlock lines={fieldText(data.content)} emptyText="暂无口播内容。" />
        );
      }}
    </EditableCard>
  );
}

function StoryboardCard(props: CardRendererProps) {
  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const isRegenerating = fieldText(data.status) === 'regenerating';
        const displayDraft = draft;
        if (props.card.status === 'pending' && isRegenerating) {
          return <Alert message={fieldText(data.message) || '分镜脚本重新解析中，请稍候。'} showIcon type="info" />;
        }
        if (props.card.status === 'pending' && !Array.isArray(displayDraft)) {
          return <Alert message={fieldText(data.message) || '分镜脚本分析中，请稍候。'} showIcon type="info" />;
        }
        if (props.card.status === 'failed' || fieldText(data.status) === 'failed') {
          return (
            <div className="remake-card-fields">
              <Alert
                description={fieldText(data.errorMessage)}
                message={fieldText(data.message) || '分镜脚本生成失败，请稍后重试。'}
                showIcon
                type="error"
              />
              <div className="remake-card-actions-inline">
                <Button disabled={props.disabled} onClick={() => void props.onRegenerate?.()} type="primary">
                  重新生成分镜
                </Button>
              </div>
            </div>
          );
        }
        const shots = Array.isArray(displayDraft) ? displayDraft.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))) : [];
        if (!shots.length) {
          return <Alert message="分镜脚本生成中，请稍后。" showIcon type="info" />;
        }
        return (
          <div className="remake-storyboard-list">
            {isRegenerating ? (
              <Alert message={fieldText(data.message) || '分镜脚本重新解析中，请稍候。'} showIcon type="info" />
            ) : null}
            {shots.map((shot, index) => {
              const pipText = sanitizePipPreviewText(fieldText(shot.pipDescription));
              return (
                <section className="remake-storyboard-shot" key={fieldText(shot.shotId) || index}>
                  <header>
                    <strong>{fieldText(shot.label) || `镜头 ${index + 1}`}</strong>
                    <span>{formatShotTime(shot)}</span>
                  </header>
                  <ul className="remake-storyboard-points">
                    {fieldText(shot.visualDescription) ? <li><b>画面：</b>{fieldText(shot.visualDescription)}</li> : null}
                    {fieldText(shot.actionDescription) ? <li><b>人物/动作：</b>{fieldText(shot.actionDescription)}</li> : null}
                    {fieldText(shot.narration) ? <li><b>台词/旁白：</b>{fieldText(shot.narration)}</li> : null}
                    {fieldText(shot.soundEffect) ? <li><b>音效：</b>{fieldText(shot.soundEffect)}</li> : null}
                    {hasVisiblePipText(pipText) ? <li><b>画中画：</b>{pipText}</li> : null}
                    {fieldText(shot.remakeSuggestion) ? <li><b>复刻建议：</b>{fieldText(shot.remakeSuggestion)}</li> : null}
                    {!fieldText(shot.visualDescription) && !fieldText(shot.narration) ? <li><b>画面：</b>按已确认素材和口播节奏生成。</li> : null}
                  </ul>
                </section>
              );
            })}
          </div>
        );
      }}
    </EditableCard>
  );
}

function SeedanceCard(props: CardRendererProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [props.card.cardId]);

  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const draftRecord = asRecord(draft);
        const directSegments = asItems(draft);
        const wrappedSegments = asItems(draftRecord.items);
        const promptSegments = asItems(draftRecord.prompts);
        const previousSegments = asItems(draftRecord.previousData);
        const generatedSegments = asItems(draftRecord.segments);
        const fallbackSegments = [
          ...previousSegments,
          ...generatedSegments,
          ...promptSegments,
        ];
        const segments = directSegments.length ? directSegments : wrappedSegments.length ? wrappedSegments : fallbackSegments;
        if (!segments.length) {
          return <Alert message="提示词生成中，请稍后。" showIcon type="info" />;
        }
        const index = Math.min(activeIndex, segments.length - 1);
        const segment = segments[index] || {};
        const prompt = asRecord(segment.prompt);
        const mentionOptions = seedanceReferenceMentions(prompt, props.assets);
        const setPrompt = (patch: Record<string, unknown>) => {
          const updatedSegments = updateAt(segments, index, { prompt: { ...prompt, ...patch } });
          setDraft(directSegments.length
            ? updatedSegments
            : wrappedSegments.length
              ? { ...draftRecord, items: updatedSegments }
              : promptSegments.length
                ? { ...draftRecord, prompts: updatedSegments }
                : { ...draftRecord, previousData: updatedSegments });
        };
        const mainPrompt = promptTextValue(prompt);
        const videoAspectRatio = fieldText(props.videoAspectRatio) || '9:16';
        const overview = [
          ['视频比例', videoAspectRatio],
          ['总时长', totalDurationText(segments)],
          ['分段数量', `${segments.length}`],
          ['单段限制', maxSegmentDurationText(segments)],
        ];

        if (props.card.status !== 'editing') {
          const previewIndex = Math.min(activeIndex, segments.length - 1);
          const previewSegment = segments[previewIndex] || {};
          const previewPrompt = asRecord(previewSegment.prompt);
          const previewTime = formatShotTime(previewSegment);
          return (
            <div className="remake-seedance">
              <div className="remake-seedance-overview">
                {overview.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
              </div>
              {renderItemTabs(segments.map((item, itemIndex) => ({ ...item, label: `分段 ${itemIndex + 1}` })), previewIndex, setActiveIndex, '分段')}
              <div className="remake-seedance-workbench">
                <section className="remake-seedance-preview-panel">
                  <header>
                    <div>
                      <span>当前预览</span>
                      <strong>分段 {previewIndex + 1}</strong>
                    </div>
                    {previewTime ? <time>{previewTime}</time> : null}
                  </header>
                  <SeedancePromptPreview mentions={seedanceReferenceMentions(previewPrompt, props.assets)} text={promptTextValue(previewPrompt)} />
                </section>
              </div>
            </div>
          );
        }

        return (
          <div className="remake-card-fields remake-seedance">
            <div className="remake-seedance-overview">
              {overview.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
            </div>
            {renderItemTabs(segments.map((item, itemIndex) => ({ ...item, label: `分段 ${itemIndex + 1}` })), index, setActiveIndex, '分段')}
            <div className="remake-seedance-workbench">
              <section className="remake-seedance-preview-panel remake-seedance-editor-panel">
                <header>
                  <div>
                    <span>正在编辑</span>
                    <strong>分段 {index + 1}</strong>
                  </div>
                  {formatShotTime(segment) ? <time>{formatShotTime(segment)}</time> : null}
                </header>
                <div className="remake-prompt-editor">
                  <label>提示词</label>
                  <MentionRichTextarea
                    disabled={props.disabled}
                    onChange={(value) => setPrompt({ mainPrompt: value })}
                    options={seedanceMentionOptions(mentionOptions)}
                    value={mainPrompt}
                  />
                </div>
              </section>
            </div>
          </div>
        );
      }}
    </EditableCard>
  );
}

function SeedancePromptPreview({ mentions, text }: { mentions: SeedanceReferenceMention[]; text: string }) {
  const value = text.trim();
  if (!value) {
    return <p className="remake-seedance-empty">暂无提示词内容</p>;
  }
  return (
    <div className="remake-seedance-prompt-preview">
      <p>{renderSeedancePromptWithReferences(value, mentions)}</p>
    </div>
  );
}

function PromptPreview({ title, text }: { title: string; text: string }) {
  const value = text.trim();
  if (!value) {
    return null;
  }
  return (
    <div className="remake-prompt-preview">
      <b>{title}</b>
      <p>{value}</p>
    </div>
  );
}

function promptTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return editableSeedancePromptText(value.trim());
  }
  if (Array.isArray(value)) {
    return editableSeedancePromptText(value.map(promptTextValue).filter(Boolean).join('\n\n'));
  }
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return '';
  }
  const directKeys = ['mainPrompt', 'seedancePrompt', 'promptText', 'text', 'content', 'systemPrompt'];
  for (const key of directKeys) {
    const text = promptTextValue(record[key]);
    if (text) {
      return editableSeedancePromptText(text);
    }
  }
  const nestedKeys = ['prompt', 'data', 'value'];
  for (const key of nestedKeys) {
    const text = promptTextValue(record[key]);
    if (text) {
      return editableSeedancePromptText(text);
    }
  }
  return '';
}

function GenerationProgressCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const isVideoGeneration = fieldText(data.kind) === 'video_generation';
  const status = fieldText(data.status) || '排队中';
  const message = fieldText(data.message)
    .replace(/\s*\d+\s*\/\s*\d+/u, '')
    .replace(/，?预计用时\s*[^，。]+/u, '')
    .trim();
  const result = asRecord(data.result);
  const videoUrl = fieldText(data.videoUrl) || fieldText(result.videoUrl);
  const rawCompletedExperts = Number(data.completedExperts ?? 0);
  const rawTotalExperts = Number(data.totalExperts ?? 0);
  const isCompleted = props.card.status === 'confirmed' || status === 'completed';
  const isFailed = props.card.status === 'failed' || status === 'failed';
  const retriedExpertName = fieldText(data.retriedExpertName);
  const executionItems = Array.isArray(data.executions)
    ? data.executions.map(asRecord).filter((item) => Object.keys(item).length > 0)
    : [];
  const fallbackExpertLabels = retriedExpertName ? [retriedExpertName] : ['音频理解专家', '视频理解专家', '画中画理解专家'];
  const totalExperts = rawTotalExperts || executionItems.length || fallbackExpertLabels.length;
  const completedFromExecutions = executionItems.filter(isProgressExecutionCompleted).length;
  const derivedCompletedExperts = Math.min(totalExperts, Math.max(rawCompletedExperts, completedFromExecutions));
  const allExpertsCompleted = !isFailed && totalExperts > 0 && derivedCompletedExperts >= totalExperts;
  const displayCompleted = isCompleted || allExpertsCompleted;
  const completedExperts = displayCompleted ? totalExperts : derivedCompletedExperts;
  const expertItems = executionItems.length
    ? executionItems.map((item, index) => ({
      label: fieldText(item.roleName) || fallbackExpertLabels[index] || `专家 ${index + 1}`,
      completed: displayCompleted || isProgressExecutionCompleted(item) || index < completedExperts,
    }))
    : fallbackExpertLabels.slice(0, totalExperts || 3).map((label, index) => ({
      label,
      completed: displayCompleted || index < completedExperts,
    }));
  const percent = displayCompleted
    ? 100
    : totalExperts > 0
    ? Math.max(0, Math.min(100, Math.round((completedExperts / totalExperts) * 100)))
    : Number(data.percent || 0);
  const allowManualSync = !displayCompleted && !isFailed && typeof props.onSyncProgress === 'function';
  const visibleExpertItems = expertItems.slice(0, totalExperts || expertItems.length || 3);
  return (
    <ReadonlyCard>
      <div className={`remake-status-bubble remake-progress-bubble ${displayCompleted ? 'is-completed' : isFailed ? 'is-failed' : 'is-running'}`}>
        {!isVideoGeneration && totalExperts > 0 ? (
          <div className="remake-expert-progress-list">
            {visibleExpertItems.map((item) => {
              const itemRunning = !item.completed && !displayCompleted && !isFailed;
              const itemFailed = !item.completed && isFailed;
              const stateClass = item.completed ? 'is-done' : itemFailed ? 'is-failed' : itemRunning ? 'is-running' : 'is-muted';
              const stateText = item.completed ? '已完成' : itemRunning ? '解析中' : itemFailed ? '未完成' : '等待中';
              return (
                <div className={`remake-expert-progress-item ${stateClass}`} key={item.label}>
                  <span className="remake-expert-progress-dot" aria-hidden="true" />
                  <b>{item.label}</b>
                  <em>{stateText}</em>
                </div>
              );
            })}
          </div>
        ) : null}
        {!isVideoGeneration && !isFailed && totalExperts > 0 ? (
          <div className="remake-progress-detail">
            <div className="remake-progress-track"><i className={!displayCompleted ? 'is-running' : undefined} style={{ width: `${percent}%` }} /></div>
            <div className="remake-progress-meta">
              <small>
                {displayCompleted ? `全部完成 ${totalExperts}/${totalExperts}` : `已完成 ${completedExperts}/${totalExperts}`}
              </small>
              {allowManualSync ? (
                <Tooltip title="手动同步">
                  <button
                    aria-label="手动同步解析进度"
                    className="remake-message-icon-action"
                    disabled={props.disabled || props.syncing}
                    onClick={() => void props.onSyncProgress?.()}
                    type="button"
                  >
                    <RefreshCw className={props.syncing ? 'is-spinning' : undefined} size={14} />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          </div>
        ) : null}
        {videoUrl ? <a href={mediaUrl(videoUrl)} rel="noreferrer" target="_blank">查看视频</a> : null}
      </div>
    </ReadonlyCard>
  );
}

function DirectorNormalizeCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const status = fieldText(data.status);
  const isCompleted = props.card.status === 'confirmed' || status === 'completed';
  return (
    <ReadonlyCard>
      <div className="remake-status-bubble">
        <p>{fieldText(data.message) || (isCompleted ? '视频导演已整理完成。' : '视频导演正在整理可确认设定，请稍候。')}</p>
      </div>
    </ReadonlyCard>
  );
}

function LlmThinkingCard(props: CardRendererProps) {
  const data = asRecord(props.card.data);
  const status = fieldText(data.status);
  const message = fieldText(data.message) || fieldText(data.answer);
  const description = fieldText(data.description);
  const isIntentConfirmation = fieldText(data.kind) === 'intent_confirmation' && props.card.status === 'editing';
  const visualStatus = props.card.status === 'failed'
    ? 'failed'
    : isIntentConfirmation || props.card.status === 'pending'
      ? 'info'
      : 'success';
  const Icon = visualStatus === 'failed' ? CircleAlert : visualStatus === 'success' ? CheckCircle2 : Info;
  return (
    <ReadonlyCard>
      <div className={`remake-ai-note remake-ai-note-${visualStatus}`}>
        <span className="remake-ai-note-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={2.4} />
        </span>
        <div className="remake-ai-note-copy">
          <p>{message || (status === 'thinking' || props.card.status === 'pending' ? '大模型正在理解你的需求，请稍候。' : '需要你补充更多信息。')}</p>
          {description ? <p className="remake-ai-note-description">{description}</p> : null}
        </div>
      </div>
      {isIntentConfirmation ? (
        <div className="remake-card-actions remake-intent-card-actions">
          <Button disabled={props.disabled} onClick={() => void props.onCancel()}>
            {fieldText(data.cancelText) || '取消'}
          </Button>
          <Button disabled={props.disabled} onClick={() => void props.onConfirm(data)} type="primary">
            {fieldText(data.confirmText) || '确认'}
          </Button>
        </div>
      ) : null}
    </ReadonlyCard>
  );
}

function FinalVideoCard(props: CardRendererProps) {
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState(0);
  const [promptEditor, setPromptEditor] = useState<{ mentions: SeedanceReferenceMention[]; mode: 'regenerate' | 'queue'; segmentIndex: number; prompt: string } | null>(null);
  const [promptPreview, setPromptPreview] = useState<{ mentions: SeedanceReferenceMention[]; segmentIndex: number; prompt: string } | null>(null);
  const [segmentQueue, setSegmentQueue] = useState<FinalSegmentQueueItem[]>([]);
  const [openSegmentActionIndex, setOpenSegmentActionIndex] = useState<number | null>(null);
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const requestSegmentRegeneration = async (segmentIndex: number, prompt?: string) => {
    if (!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment) {
      return;
    }
    setRegeneratingIndex(segmentIndex);
    try {
      if (props.onRegenerateFinalSegments) {
        await props.onRegenerateFinalSegments([{ segmentIndex, prompt }]);
      } else {
        await props.onRegenerateFinalSegment?.(segmentIndex, prompt);
      }
      setPromptEditor(null);
      setPromptPreview(null);
      setSegmentsOpen(false);
      setOpenSegmentActionIndex(null);
    } finally {
      setRegeneratingIndex(0);
    }
  };
  const upsertSegmentQueue = (item: FinalSegmentQueueItem) => {
    setSegmentQueue((current) => {
      const next = current.filter((queueItem) => queueItem.segmentIndex !== item.segmentIndex);
      return [...next, item].sort((left, right) => left.segmentIndex - right.segmentIndex);
    });
  };
  const removeSegmentQueueItem = (segmentIndex: number) => {
    setSegmentQueue((current) => current.filter((item) => item.segmentIndex !== segmentIndex));
  };
  const submitSegmentQueue = async () => {
    if ((!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment) || !segmentQueue.length) {
      return;
    }
    const queue = [...segmentQueue].sort((left, right) => left.segmentIndex - right.segmentIndex);
    setQueueSubmitting(true);
    try {
      setRegeneratingIndex(queue[0]?.segmentIndex || 0);
      const segments = queue.map((item) => ({
        segmentIndex: item.segmentIndex,
        prompt: item.mode === 'prompt' ? item.prompt : undefined,
      }));
      if (props.onRegenerateFinalSegments) {
        await props.onRegenerateFinalSegments(segments);
      } else {
        for (const item of segments) {
          setRegeneratingIndex(item.segmentIndex);
          await props.onRegenerateFinalSegment?.(item.segmentIndex, item.prompt);
        }
      }
      setSegmentQueue([]);
      setPromptEditor(null);
      setPromptPreview(null);
      setSegmentsOpen(false);
      setOpenSegmentActionIndex(null);
    } finally {
      setRegeneratingIndex(0);
      setQueueSubmitting(false);
    }
  };
  return (
    <EditableCard {...props}>
      {({ draft, setDraft }) => {
        const data = asRecord(draft);
        const video = fieldText(data.videoUrl);
        const status = fieldText(data.status);
        const generationMode = fieldText(data.generationMode) === 'queued_extend' ? 'queued_extend' : 'parallel';
        const regenerationMode = fieldText(data.regenerationMode);
        const isSegmentRegenerationCard = regenerationMode === 'segment';
        const regeneratedSegmentIndexes = Array.isArray(data.regeneratedSegmentIndexes)
          ? data.regeneratedSegmentIndexes.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
          : [];
        const regeneratedSegmentIndex = Number(data.regeneratedSegmentIndex || 0);
        const regeneratedSegmentLabel = regeneratedSegmentIndexes.length
          ? `分段 ${regeneratedSegmentIndexes.join('、')}`
          : regeneratedSegmentIndex > 0
            ? `分段 ${regeneratedSegmentIndex}`
            : '分段';
        const versionLabel = fieldText(data.versionLabel || data.version) || (fieldText(data.versionNumber) ? `v${fieldText(data.versionNumber)}` : '');
        const isPendingSegmentRegeneration = isSegmentRegenerationCard
          && (props.card.status === 'pending' || status === 'generating');

        const videoHistory = asItems(data.videos);
        const currentVideo = videoHistory.find((item) => {
          const itemVersionNumber = Number(item.versionNumber || 0);
          const dataVersionNumber = Number(data.versionNumber || 0);
          return (video && fieldText(item.videoUrl) === video)
            || (versionLabel && fieldText(item.versionLabel || item.version) === versionLabel)
            || (dataVersionNumber > 0 && itemVersionNumber === dataVersionNumber);
        }) || videoHistory[videoHistory.length - 1] || {};
        const segments = asItems(data.segments);
        const generatedSegments = asItems(data.generatedSegments);
        const historySegments = asItems(currentVideo.segments);
        const seedancePrompts = asItems(data.seedancePrompts);
        const displaySegments = segments.length
          ? segments
          : generatedSegments.length
            ? generatedSegments
            : historySegments.length
              ? historySegments
              : seedancePrompts;
        const hasCompletedFinalVideo = Boolean(video) || status === 'completed';
        const rawSegmentRows = displaySegments.map((segment, index) => {
          const seedancePromptSegment = seedancePrompts[index] || {};
          const generatedSegment = generatedSegments[index] || {};
          const row = {
            ...seedancePromptSegment,
            ...segment,
            ...generatedSegment,
          };
          if (!promptTextValue(row.prompt)) {
            row.prompt = promptTextValue(generatedSegment.prompt)
              ? generatedSegment.prompt
              : promptTextValue(segment.prompt)
                ? segment.prompt
                : seedancePromptSegment.prompt;
          }
          if (!promptTextValue(row.seedancePrompt)) {
            row.seedancePrompt = promptTextValue(generatedSegment.seedancePrompt)
              ? generatedSegment.seedancePrompt
              : promptTextValue(segment.seedancePrompt)
                ? segment.seedancePrompt
                : seedancePromptSegment.seedancePrompt;
          }
          return row;
        });
        const segmentRows = rawSegmentRows;
        const segmentStatusMeta = (segment: Record<string, unknown>, fallbackIndex?: number): { label: string; tone: 'done' | 'running' | 'failed' | 'muted' } => {
          const index = Number(segment.segmentIndex || segment.index || fallbackIndex || 0);
          const value = fieldText(segment.status);
          if (isSegmentRegenerationCard && regeneratedSegmentIndex > 0) {
            if (index !== regeneratedSegmentIndex) {
              return { label: '已完成', tone: 'done' };
            }
            if (value === 'failed') {
              return { label: '生成失败', tone: 'failed' };
            }
            if (value === 'completed' || fieldText(segment.regeneratedAt)) {
              return { label: '重生成完成', tone: 'done' };
            }
            return { label: '重生成中', tone: 'running' };
          }
          if (value === 'completed') {
            return { label: '已完成', tone: 'done' };
          }
          if (value === 'failed') {
            return { label: '生成失败', tone: 'failed' };
          }
          if (value === 'skipped') {
            return { label: '已跳过', tone: 'muted' };
          }
          if (value === 'waiting' || (generationMode === 'queued_extend' && index > 1 && (!value || value === 'pending'))) {
            return { label: '等待中', tone: 'muted' };
          }
          if (hasCompletedFinalVideo) {
            return { label: '已完成', tone: 'done' };
          }
          return { label: '生成中', tone: 'running' };
        };
        const segmentStatus = (segment: Record<string, unknown>, fallbackIndex?: number) => {
          return segmentStatusMeta(segment, fallbackIndex).label;
        };
        const isSegmentGenerating = (segment: Record<string, unknown>, fallbackIndex?: number) => {
          if (hasCompletedFinalVideo && !isSegmentRegenerationCard) {
            return false;
          }
          const label = segmentStatus(segment, fallbackIndex);
          const value = fieldText(segment.status);
          const index = Number(segment.segmentIndex || segment.index || fallbackIndex || 0);
          if (generationMode === 'queued_extend' && index > 1 && (!value || value === 'pending' || value === 'waiting')) {
            return false;
          }
          return /生成中/u.test(label)
            || ['pending', 'generating', 'regenerating', 'running', 'submitted', 'processing'].includes(value);
        };
        const segmentTime = (segment: Record<string, unknown>) => {
          const start = fieldText(segment.startSecond || segment.startTime);
          const end = fieldText(segment.endSecond || segment.endTime);
          const seconds = fieldText(segment.seconds || segment.durationSecond || segment.duration);
          if (start || end) {
            return `${start || 0}-${end || seconds || 0}s`;
          }
          return seconds ? `${seconds}s` : '';
        };
        const segmentVideo = (segment: Record<string, unknown>) => fieldText(segment.videoUrl || segment.fileUrl || segment.url);
        const completedSegmentCount = segmentRows.filter((segment, index) => segmentStatusMeta(segment, index + 1).tone === 'done').length;
        const failedSegmentCount = segmentRows.filter((segment, index) => segmentStatusMeta(segment, index + 1).tone === 'failed').length;
        const runningSegmentCount = segmentRows.filter((segment, index) => isSegmentGenerating(segment, index + 1)).length;
        const segmentProgressPercent = segmentRows.length
          ? Math.round((completedSegmentCount / segmentRows.length) * 100)
          : 0;
        const canInspectSegments = !isPendingSegmentRegeneration
          && segmentRows.length > 0
          && (hasCompletedFinalVideo || isSegmentRegenerationCard || status === 'generating' || status === 'failed' || props.card.status === 'failed');
        const segmentPromptText = (segment: Record<string, unknown>) => {
          return promptTextValue(segment.prompt)
            || promptTextValue(segment.seedancePrompt);
        };
        const openPromptEditor = (segmentIndex: number, segment: Record<string, unknown>, mode: 'regenerate' | 'queue') => {
          setOpenSegmentActionIndex(null);
          setPromptEditor({
            mentions: seedanceReferenceMentions(asRecord(segment.prompt), props.assets),
            mode,
            segmentIndex,
            prompt: segmentPromptText(segment),
          });
        };
        const openPromptPreview = (segmentIndex: number, segment: Record<string, unknown>) => {
          setPromptPreview({
            mentions: seedanceReferenceMentions(asRecord(segment.prompt), props.assets),
            segmentIndex,
            prompt: segmentPromptText(segment),
          });
        };
        const queueSegment = (segmentIndex: number) => {
          setOpenSegmentActionIndex(null);
          upsertSegmentQueue({ mode: 'direct', segmentIndex });
          message.success(`分段 ${segmentIndex} 已加入待生成队列`);
        };
        const regenerateSegmentFromMenu = (segmentIndex: number) => {
          setOpenSegmentActionIndex(null);
          void requestSegmentRegeneration(segmentIndex);
        };
        const confirmPromptEditor = async () => {
          if (!promptEditor) {
            return;
          }
          if (promptEditor.mode === 'queue') {
            upsertSegmentQueue({
              mode: 'prompt',
              prompt: promptEditor.prompt,
              segmentIndex: promptEditor.segmentIndex,
            });
            message.success(`分段 ${promptEditor.segmentIndex} 已加入待生成队列`);
            setPromptEditor(null);
            return;
          }
          await requestSegmentRegeneration(promptEditor.segmentIndex, promptEditor.prompt);
        };
        const renderPromptPreviewModal = () => (
          <Modal
            footer={null}
            onCancel={() => setPromptPreview(null)}
            open={Boolean(promptPreview)}
            title={`分段 ${promptPreview?.segmentIndex || ''} 提示词`}
            width={820}
          >
            <div className="remake-segment-prompt-preview-modal">
              <SeedancePromptPreview mentions={promptPreview?.mentions || []} text={promptPreview?.prompt || ''} />
            </div>
          </Modal>
        );
        const renderPromptEditorModal = () => (
          <Modal
            okButtonProps={{ loading: regeneratingIndex === promptEditor?.segmentIndex }}
            okText={promptEditor?.mode === 'queue' ? '加入待生成队列' : '重新生成'}
            onCancel={() => setPromptEditor(null)}
            onOk={() => void confirmPromptEditor()}
            open={Boolean(promptEditor)}
            title={`调整分段 ${promptEditor?.segmentIndex || ''} 提示词`}
            width={820}
          >
            <div className="remake-prompt-editor remake-segment-prompt-editor">
              <label>提示词</label>
              <MentionRichTextarea
                fallbackMentionMenu
                minRows={10}
                onChange={(value) => setPromptEditor((current) => current ? { ...current, prompt: value } : current)}
                options={seedanceMentionOptions(promptEditor?.mentions || [])}
                placeholder="输入分段生成提示词，可通过 @ 引用素材"
                suggestionContainer=".ant-modal-root"
                value={promptEditor?.prompt || ''}
              />
            </div>
          </Modal>
        );
        const renderSegmentsModal = () => (
          <Modal
            footer={segmentRows.length ? (
              <div className="remake-final-segment-queue-footer">
                <div>
                  <strong>待生成队列</strong>
                  <span>{segmentQueue.length ? `已选择 ${segmentQueue.map((item) => `分段 ${item.segmentIndex}`).join('、')}` : '可先调整多个分段，再统一提交生成'}</span>
                </div>
                <Button disabled={!segmentQueue.length || queueSubmitting || regeneratingIndex > 0} onClick={() => setSegmentQueue([])}>
                  清空队列
                </Button>
                <Button
                  disabled={!segmentQueue.length || (!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment)}
                  loading={queueSubmitting}
                  onClick={() => void submitSegmentQueue()}
                  type="primary"
                >
                  统一生成
                </Button>
              </div>
            ) : null}
            onCancel={() => setSegmentsOpen(false)}
            open={segmentsOpen}
            title={`${versionLabel ? `${versionLabel} ` : ''}生成分段`}
            width={960}
          >
            <div className="remake-final-segments-modal">
              {segmentRows.length ? (
                <>
                  <div className="remake-final-segments-summary">
                    <div>
                      <strong>{`${completedSegmentCount}/${segmentRows.length}`}</strong>
                      <span>已完成</span>
                    </div>
                    <div>
                      <strong>{runningSegmentCount}</strong>
                      <span>生成中</span>
                    </div>
                    <div>
                      <strong>{failedSegmentCount}</strong>
                      <span>失败</span>
                    </div>
                    <div>
                      <strong>{`${segmentProgressPercent}%`}</strong>
                      <span>整体进度</span>
                    </div>
                  </div>
                  {segmentQueue.length ? (
                    <div className="remake-final-segment-queue">
                      <span>待生成</span>
                      {segmentQueue.map((item) => (
                        <button key={item.segmentIndex} onClick={() => removeSegmentQueueItem(item.segmentIndex)} type="button">
                          {`分段 ${item.segmentIndex}${item.mode === 'prompt' ? ' · 已调词' : ' · 直接'}`}
                          <X size={12} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="remake-final-segment-grid">
                    {segmentRows.map((segment, index) => {
                      const source = segmentVideo(segment);
                      const segmentGenerating = isSegmentGenerating(segment, index + 1);
                      const segmentActionDisabled = (!props.onRegenerateFinalSegments && !props.onRegenerateFinalSegment) || regeneratingIndex > 0 || segmentGenerating;
                      const statusMeta = segmentStatusMeta(segment, index + 1);
                      const queuedItem = segmentQueue.find((item) => item.segmentIndex === index + 1);
                      const actionContent = (
                        <div className="remake-final-segment-action-menu">
                          <button disabled={segmentActionDisabled} onClick={() => openPromptEditor(index + 1, segment, 'regenerate')} type="button">
                            <PencilLine size={16} />
                            <span>
                              <strong>调整提示词后重新生成</strong>
                              <small>编辑当前分段提示词，并立即提交这一段</small>
                            </span>
                          </button>
                          <button disabled={segmentActionDisabled} onClick={() => regenerateSegmentFromMenu(index + 1)} type="button">
                            <RotateCcw size={16} />
                            <span>
                              <strong>直接重新生成</strong>
                              <small>使用当前分段提示词立即提交</small>
                            </span>
                          </button>
                          <button disabled={segmentActionDisabled} onClick={() => queueSegment(index + 1)} type="button">
                            <ListPlus size={16} />
                            <span>
                              <strong>放入待生成队列</strong>
                              <small>先收集多个分段，稍后统一生成</small>
                            </span>
                          </button>
                          <button disabled={segmentActionDisabled} onClick={() => openPromptEditor(index + 1, segment, 'queue')} type="button">
                            <PencilLine size={16} />
                            <span>
                              <strong>调整后放入队列</strong>
                              <small>适合多个分段分别调词后统一生成</small>
                            </span>
                          </button>
                        </div>
                      );
                      return (
                        <div
                          key={`${fieldText(segment.segmentId || segment.segmentIndex) || index}`}
                          className={`remake-final-segment-item ${isSegmentRegenerationCard && regeneratedSegmentIndex === index + 1 ? 'is-regenerating' : ''}`}
                        >
                          <header>
                            <strong>{`分段 ${index + 1}`}</strong>
                            <span>{segmentTime(segment)}</span>
                            <em className={`remake-segment-status-pill is-${statusMeta.tone}`}>
                              <span aria-hidden="true" />
                              {statusMeta.label}
                            </em>
                          </header>
                          {source ? <video controls src={mediaUrl(source)} /> : <div className="remake-final-segment-placeholder">暂无分段视频</div>}
                          {segmentPromptText(segment) ? (
                            <button className="remake-final-segment-prompt-button" onClick={() => openPromptPreview(index + 1, segment)} type="button">
                              查看提示词
                            </button>
                          ) : null}
                          <div className="remake-final-segment-actions">
                            {queuedItem ? (
                              <span className="remake-final-segment-queued">
                                {queuedItem.mode === 'prompt' ? '已加入队列 · 调整提示词' : '已加入队列 · 直接生成'}
                              </span>
                            ) : null}
                            <Popover
                              content={actionContent}
                              onOpenChange={(open) => setOpenSegmentActionIndex(open ? index + 1 : null)}
                              open={openSegmentActionIndex === index + 1}
                              placement="bottomRight"
                              trigger="click"
                            >
                              <Button
                                disabled={segmentActionDisabled}
                                loading={regeneratingIndex === index + 1}
                                type="primary"
                              >
                                重生成
                                <ChevronDown size={14} />
                              </Button>
                            </Popover>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : <Alert message="暂无可查看的生成分段。" type="info" showIcon />}
            </div>
          </Modal>
        );
        if (props.card.status === 'pending' || status === 'generating' || props.card.status === 'failed' || status === 'failed') {
          const showPendingSegments = canInspectSegments && segmentRows.length > 0;
          const canManualSync = typeof props.onSyncProgress === 'function';
          const pendingHint = isSegmentRegenerationCard
            ? `正在基于 ${versionLabel || '当前版本'} 重新生成${regeneratedSegmentLabel}`
            : '';
          const pendingMessage = isPendingSegmentRegeneration
            ? `${regeneratedSegmentLabel}重新生成中，请稍候。`
            : fieldText(data.message) || (props.card.status === 'failed' || status === 'failed' ? '视频生成失败。' : '视频生成中，请稍候。');
          return (
            <>
                <div className="remake-video-generation-card">
                  <div className="remake-final-card-head">
                    {showPendingSegments ? <Button onClick={() => setSegmentsOpen(true)}>查看分段</Button> : null}
                  </div>
                {showPendingSegments ? (
                  <div className="remake-video-generation-segments">
                    <div className="remake-video-generation-summary">
                      <div>
                        <strong>分段生成进度</strong>
                        <span>{`${completedSegmentCount}/${segmentRows.length} 已完成${runningSegmentCount ? ` · ${runningSegmentCount} 生成中` : ''}${failedSegmentCount ? ` · ${failedSegmentCount} 失败` : ''}`}</span>
                      </div>
                      <span>{`${segmentProgressPercent}%`}</span>
                    </div>
                    <div className="remake-video-generation-progress" aria-hidden="true">
                      <span style={{ width: `${segmentProgressPercent}%` }} />
                    </div>
                    <div className="remake-video-generation-list">
                      {segmentRows.map((segment, index) => {
                        const statusMeta = segmentStatusMeta(segment, index + 1);
                        return (
                          <div
                            key={`${fieldText(segment.segmentId || segment.segmentIndex) || index}`}
                            className={`remake-video-generation-row is-${statusMeta.tone}`}
                          >
                            <span className="remake-video-generation-index">{`分段 ${index + 1}`}</span>
                            <span className="remake-video-generation-time">{segmentTime(segment)}</span>
                            <span className={`remake-segment-status-pill is-${statusMeta.tone}`}>
                              <span aria-hidden="true" />
                              {statusMeta.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {fieldText(data.errorMessage) ? <p className="remake-video-generation-error">错误原因：{fieldText(data.errorMessage)}</p> : null}
                {pendingHint ? <p className="remake-video-generation-hint">{pendingHint}</p> : null}
                {/* <p className="remake-video-generation-hint">
                  {generationMode === 'queued_extend' ? '生成方式：排队生成（视频延长）' : '生成方式：批量分段生成'}
                </p> */}
                <div className="remake-video-generation-status-line">
                  <p aria-live="polite">
                    {props.card.status === 'failed' || status === 'failed' ? null : <span className="remake-generating-indicator" aria-hidden="true"><span /><span /><span /></span>}
                    {pendingMessage}
                  </p>
                  {canManualSync ? (
                    <Tooltip title="手动同步">
                      <button
                        aria-label="手动同步视频生成状态"
                        className="remake-message-icon-action"
                        disabled={props.disabled || props.syncing}
                        onClick={() => void props.onSyncProgress?.()}
                        type="button"
                      >
                        <RefreshCw className={props.syncing ? 'is-spinning' : undefined} size={14} />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
              {showPendingSegments ? renderSegmentsModal() : null}
              {renderPromptPreviewModal()}
              {renderPromptEditorModal()}
            </>
          );
        }
        return (
          <>
            <div className="remake-final-card">
              <div className="remake-final-card-head">
                {canInspectSegments && segmentRows.length ? <Button onClick={() => setSegmentsOpen(true)}>查看分段</Button> : null}
              </div>
              <p>{fieldText(data.message) || '确认后将使用你确认的卡片内容组织生成提示词产出视频。'}</p>
              {/* {hasCompletedFinalVideo ? (
                <p className="remake-video-generation-hint">
                  {generationMode === 'queued_extend' ? '生成方式：排队生成（视频延长）' : '生成方式：批量分段生成'}
                </p>
              ) : null} */}
              {video ? <video controls src={mediaUrl(video)} /> : null}
            </div>
            {renderSegmentsModal()}
            {renderPromptPreviewModal()}
            {renderPromptEditorModal()}
          </>
        );
      }}
    </EditableCard>
  );
}

export const cardRegistry: Record<VideoRemakeCardType, (props: CardRendererProps) => ReactElement> = {
  uploading: StatusCard,
  video_basic_info: VideoBasicInfoCard,
  basic_info: BasicInfoCard,
  expert_analysis: ExpertAnalysisCard,
  character_setting: CharacterCard,
  scene_setting: SceneCard,
  product_setting: ProductCard,
  pip_setting: PipCard,
  voice_audio_setting: AudioCard,
  script_content: ScriptCard,
  storyboard_script: StoryboardCard,
  seedance_prompt: SeedanceCard,
  generation_progress: GenerationProgressCard,
  director_normalize: DirectorNormalizeCard,
  llm_thinking: LlmThinkingCard,
  final_video: FinalVideoCard,
};

export function renderVideoRemakeCard(props: CardRendererProps) {
  const Renderer = cardRegistry[props.card.cardType];
  return <Renderer {...props} />;
}
