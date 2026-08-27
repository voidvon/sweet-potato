import { Button, Dropdown, Popover, message } from 'antd';
import {
  ArrowRight,
  Bot,
  Brush,
  Check,
  ChevronDown,
  ImagePlus,
  Images,
  Layers,
  List,
  Maximize2,
  MessageCircle,
  Palette,
  Scan,
  Shirt,
  Square,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { resolveAssetUrl } from '../../../api/request';
import { listModelConfigs } from '../../../api/model-config';
import { listUserImageModelConfigs, listUserModelConfigs } from '@shared/api/user-model-config';
import type { ChatAttachment, ChatContextUsage, ModelConfig, SendChatPayload } from '../../../types';
import { MentionRichTextarea, type MentionRichTextareaOption, type MentionRichTextareaRef } from '../../../components/MentionRichTextarea';
import {
  ImageOutputSizePicker,
  getImageOutputSize,
  getImageResolutionOptions,
  imageAspectRatioOptions,
  imageModelSupportsCustomResolution,
  type ImageAspectRatio,
  type ImageResolution,
} from '../../../components/ImageOutputSizePicker';
import { CreditIcon } from '@shared/components/CreditIcon';
import { formatCreditAmount } from '@shared/utils/credits';
import { getStoredUser } from '@shared/utils/session';
import {
  estimateImageGenerationCredits,
  imageGenerationCreditsPerRequest,
  resolveImageGenerationOutputCount,
} from '@shared/utils/imageGenerationCredits';
import { ClawReferenceGroups, type ClawReferenceGroupConfig } from './ClawReferenceGroups';
import './ClawDialogComposer.scss';
import { t } from '@shared/i18n';

type ClawDialogComposerProps = {
  attachments: ChatAttachment[];
  composerDraftContext?: SendChatPayload['capabilityContext'];
  composerDraftImageModelConfigId?: string | null;
  composerDraftModelConfigId?: string | null;
  conversationModelConfigId?: string | null;
  contextUsage?: ChatContextUsage;
  input: string;
  onAddFiles: (files: File[], options?: {
    clientGroupKey?: string;
    maxCount?: number;
  }) => Promise<ChatAttachment[]>;
  onInputChange: (value: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: (options?: {
    capabilityContext?: SendChatPayload['capabilityContext'];
    imageModelConfigId?: string | null;
    modelConfigId?: string | null;
  }) => void;
  onStop: () => void;
  continueEditFocusToken?: number;
  showHeading?: boolean;
  sending: boolean;
};

type ClawModeKey =
  | 'dialog'
  | 'detail'
  | 'outfit'
  | 'model-views'
  | 'pose-reference'
  | 'upscale'
  | 'cutout'
  | 'background'
  | 'scene-extract'
  | 'model-face-swap'
  | 'head-swap'
  | 'face-swap'
  | 'redraw'
  | 'detail-enhance'
  | 'print-extract'
  | 'face-enhance';

type ClawModeConfig = {
  description: string;
  Icon: LucideIcon;
  inputPlaceholder?: string;
  key: ClawModeKey;
  outputConfig?: ClawModeOutputConfig;
  outputCountGroupKey?: string;
  outputCountStrategy?: ClawOutputCountStrategy;
  promptHint?: string;
  referenceGroups: ClawReferenceGroupConfig[];
  requiresPrompt?: boolean;
  title: string;
  toolbarControls?: ClawToolbarControl[];
};

type ClawOutputCountStrategy = 'selectable' | 'fixedOne' | 'matchUploadedImages' | 'matchReferenceGroup';
type ClawToolbarControl = 'model' | 'outputSize' | 'outputCount' | 'background';
type ClawAspectRatioKey = ImageAspectRatio;
type ClawBackgroundKey = 'transparent' | 'opaque' | 'auto';
type ClawResolutionKey = ImageResolution;
type ClawModeOutputConfig = {
  allowedOutputCounts: number[];
  allowedResolutions: ClawResolutionKey[];
  defaultOutputCount: number;
  defaultResolution: ClawResolutionKey;
};
const defaultToolbarControls: ClawToolbarControl[] = ['model', 'outputSize', 'outputCount'];
const modelOnlyToolbarControls: ClawToolbarControl[] = ['model'];
const cutoutToolbarControls: ClawToolbarControl[] = ['model', 'background'];
const defaultOptionalPlaceholder = t("补充要求（选填），例如：调整光线、风格、姿态…");
const unlimitedReferenceCount = Number.POSITIVE_INFINITY;
const defaultModeOutputConfig: ClawModeOutputConfig = {
  allowedOutputCounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  allowedResolutions: ['2K', '4K'],
  defaultOutputCount: 0,
  defaultResolution: '2K',
};

function renderPromptHint(
  promptHint: string,
  hoveredReferenceGroupIndex: number | null,
  onReferenceHoverChange: (groupIndex: number | null) => void,
) {
  return promptHint.split(/(图\d+)/g).map((part, index) => {
    const imageMatch = /^图(\d+)$/.exec(part);
    if (!imageMatch) {
      return part;
    }

    const groupIndex = Number(imageMatch[1]) - 1;
    return (
      <span
        className={`claw-dialog-hint-image${hoveredReferenceGroupIndex === groupIndex ? ' is-linked-hover' : ''}`}
        key={`${part}-${index}`}
        onMouseEnter={() => onReferenceHoverChange(groupIndex)}
        onMouseLeave={() => onReferenceHoverChange(null)}
      >
        {part}
      </span>
    );
  });
}

const backgroundOptions: Array<{ description: string; key: ClawBackgroundKey; label: string }> = [
  { key: 'transparent', label: t("透明背景"), description: t("保留 alpha 通道，适合继续合成和入库。") },
  { key: 'opaque', label: t("不透明背景"), description: t("生成不透明背景，适合电商主图和目录图。") },
  { key: 'auto', label: t("自动背景"), description: t("由图片模型自动选择背景处理方式。") },
];

const clawModeConfigs: ClawModeConfig[] = [
  {
    key: 'dialog',
    title: t("对话生图"),
    description: t("多图对话"),
    Icon: MessageCircle,
    inputPlaceholder: t("描述你要的画面，可上传参考图，输入 @ 引用图片。"),
    outputConfig: defaultModeOutputConfig,
    referenceGroups: [{ key: 'reference', label: t("附件"), maxCount: 8 }],
    requiresPrompt: true,
  },
  {
    key: 'detail',
    title: t("详情图生成"),
    description: t("商品详情"),
    Icon: Images,
    inputPlaceholder: defaultOptionalPlaceholder,
    outputConfig: defaultModeOutputConfig,
    promptHint: t("描述详情图需求，例如：整体高级、文字少一点，适合淘宝详情页"),
    referenceGroups: [
      { key: 'product', label: t("产品资料"), acceptsPdf: true, maxCount: 12, required: true },
      { key: 'reference', label: t("参考图"), maxCount: 10 },
    ],
  },
  {
    key: 'outfit',
    title: t("换装"),
    description: t("一键试穿"),
    Icon: Shirt,
    inputPlaceholder: defaultOptionalPlaceholder,
    outputConfig: defaultModeOutputConfig,
    promptHint: t("让 图1 的模特穿上 图2 的衣服，AI 自动出图。"),
    referenceGroups: [
      { key: 'model', label: t("模特"), maxCount: 1, required: true },
      { key: 'clothes', label: t("图片"), required: true },
    ],
  },
  {
    key: 'model-views',
    title: t("模特三视图"),
    description: t("多角度展示"),
    Icon: Layers,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: t("为 图1 的模特生成正面 / 45 度侧面 / 背面三视图拼接图。人物必须保持自然站立姿势，完整呈现从头到脚的全身，不得裁切；可参考服装正反面和背景。"),
    referenceGroups: [
      { key: 'model', label: t("模特"), maxCount: 1, required: true },
      { key: 'front', label: t("服装正面"), maxCount: 1 },
      { key: 'back', label: t("服装背面"), maxCount: 1 },
      { key: 'background', label: t("背景"), maxCount: 1 },
    ],
  },
  {
    key: 'pose-reference',
    title: t("姿势参考"),
    description: t("参考姿态"),
    Icon: Scan,
    outputConfig: defaultModeOutputConfig,
    outputCountGroupKey: 'pose',
    outputCountStrategy: 'matchReferenceGroup',
    promptHint: t("让 图1 的主体摆出 图2 的姿势。"),
    referenceGroups: [
      { key: 'subject', label: t("主体"), maxCount: 1, required: true },
      { key: 'pose', label: t("姿势"), required: true },
    ],
  },
  {
    key: 'upscale',
    title: t("高清放大"),
    description: t("提分辨率"),
    Icon: Maximize2,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: t("把 图1 放大变清晰。"),
    referenceGroups: [{ key: 'source', label: t("原图"), required: true }],
  },
  {
    key: 'cutout',
    title: t("图片抠图"),
    description: t("主体分离"),
    Icon: Scan,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: t("把 图1 的背景去掉，按所选底色输出。"),
    referenceGroups: [{ key: 'source', label: t("原图"), required: true }],
    toolbarControls: cutoutToolbarControls,
  },
  {
    key: 'background',
    title: t("换背景"),
    description: t("环境焕新"),
    Icon: Images,
    outputCountStrategy: 'fixedOne',
    promptHint: t("把 图1 的背景换成 图2 的风格。"),
    referenceGroups: [
      { key: 'subject', label: t("主体"), maxCount: 1, required: true },
      { key: 'background', label: t("背景"), maxCount: 1, required: true },
    ],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'scene-extract',
    title: t("场景提取"),
    description: t("提取环境"),
    Icon: ImagePlus,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: t("从 图1 提取干净的场景素材。"),
    referenceGroups: [{ key: 'source', label: t("原图"), required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'model-face-swap',
    title: t("模特换脸"),
    description: t("替换模特脸"),
    Icon: Shirt,
    outputCountStrategy: 'fixedOne',
    promptHint: t("把 图1 模特的脸换成 图2 的样子，造型不变。"),
    referenceGroups: [
      { key: 'model', label: t("模特"), maxCount: 1, required: true },
      { key: 'face', label: t("脸部"), maxCount: 1, required: true },
    ],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'head-swap',
    title: t("智能换头"),
    description: t("头部替换"),
    Icon: Scan,
    outputCountStrategy: 'fixedOne',
    promptHint: t("给 图1 模特随机换一个新头型。"),
    referenceGroups: [{ key: 'model', label: t("模特"), maxCount: 1, required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'face-swap',
    title: t("智能换脸"),
    description: t("脸部替换"),
    Icon: Scan,
    outputCountStrategy: 'fixedOne',
    promptHint: t("给 图1 模特随机换一张新脸。"),
    referenceGroups: [{ key: 'model', label: t("模特"), maxCount: 1, required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'redraw',
    title: t("智能重绘"),
    description: t("读图后重绘"),
    Icon: Brush,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: t("读懂 图1 的画面内容，整理成提示词后重新生成一张更干净自然的图。"),
    referenceGroups: [{ key: 'reference', label: t("参考图"), required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'detail-enhance',
    title: t("细节增强"),
    description: t("优化细节"),
    Icon: Zap,
    inputPlaceholder: defaultOptionalPlaceholder,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: t("在 图1 涂抹位置上补强、修复或替换："),
    referenceGroups: [{ key: 'base', label: t("基础图"), maxCount: 1, required: true }],
  },
  {
    key: 'print-extract',
    title: t("印花提取"),
    description: t("提取图案"),
    Icon: Images,
    inputPlaceholder: t("补充印花提取要求（选填），例如：只保留胸前主图案、支持单张图片详情描述。"),
    outputCountStrategy: 'matchUploadedImages',
    promptHint: t("提取 图1 服装的印花，输出 PNG 和 PSD。"),
    referenceGroups: [{ key: 'clothes', label: t("服装"), required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'face-enhance',
    title: t("脸部增强"),
    description: t("优化脸部"),
    Icon: Scan,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: t("为 图1 等图像增强脸部细节。"),
    referenceGroups: [{ key: 'portrait', label: t("人像"), required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
];

function isClawModeKey(value: string | null): value is ClawModeKey {
  return clawModeConfigs.some((mode) => mode.key === value);
}

const featuredModeKeys: ClawModeKey[] = ['outfit', 'dialog', 'upscale', 'background', 'redraw'];
const visibleModeCards = featuredModeKeys
  .map((key) => clawModeConfigs.find((mode) => mode.key === key))
  .filter((mode): mode is ClawModeConfig => Boolean(mode));
const modeMenuItems = clawModeConfigs.map((mode) => {
  const ModeIcon = mode.Icon;

  return {
    key: mode.key,
    label: (
      <span className="claw-mode-menu-item">
        <span className="claw-mode-menu-icon">
          <ModeIcon size={12} />
        </span>
        <span className="claw-mode-menu-copy">
          <span>{mode.title}</span>
        </span>
      </span>
    ),
  };
});

type SelectableImageModel = {
  config: ModelConfig;
  value: string;
};

function imageModelValue(config: ModelConfig) {
  return config.id || `${config.provider}::${config.model}`;
}

function imageModelIsConfigured(config: ModelConfig) {
  return config.isConfigured ?? Boolean(config.apiKey);
}

function llmRequestCreditThreshold(config: ModelConfig | undefined) {
  const settings = config?.settings && typeof config.settings === 'object' ? config.settings : {};
  const billing = settings.billing && typeof settings.billing === 'object' && !Array.isArray(settings.billing)
    ? settings.billing as Record<string, unknown>
    : {};
  const value = Number(billing.maxOutputCreditsForReserve ?? billing.maxOutputTokensForReserve ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function ClawDialogComposer({
  attachments,
  composerDraftContext,
  composerDraftImageModelConfigId,
  composerDraftModelConfigId,
  conversationModelConfigId,
  contextUsage,
  input,
  onAddFiles,
  onInputChange,
  onRemoveAttachment,
  onSend,
  onStop,
  continueEditFocusToken = 0,
  showHeading = true,
  sending,
}: ClawDialogComposerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlModeKey = searchParams.get('mode');
  const selectedModeKey = isClawModeKey(urlModeKey) ? urlModeKey : 'dialog';
  const [llmConfigs, setLlmConfigs] = useState<ModelConfig[]>([]);
  const [selectedModelConfigId, setSelectedModelConfigId] = useState('');
  const [imageConfigs, setImageConfigs] = useState<ModelConfig[]>([]);
  const [selectedImageModelValue, setSelectedImageModelValue] = useState('');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<ClawAspectRatioKey>('auto');
  const [selectedBackground, setSelectedBackground] = useState<ClawBackgroundKey>('transparent');
  const [selectedResolution, setSelectedResolution] = useState<ClawResolutionKey>('2K');
  const [selectedOutputCount, setSelectedOutputCount] = useState(0);
  const [attachmentGroupById, setAttachmentGroupById] = useState<Record<string, string>>({});
  const [hoveredReferenceGroupIndex, setHoveredReferenceGroupIndex] = useState<number | null>(null);
  const textareaRef = useRef<MentionRichTextareaRef | null>(null);
  const hasPrompt = Boolean(input.trim());
  const selectedMode = clawModeConfigs.find((mode) => mode.key === selectedModeKey) ?? clawModeConfigs[0];
  const SelectedModeIcon = selectedMode.Icon;
  const showPromptInput = Boolean(selectedMode.inputPlaceholder);
  const promptRequired = Boolean(selectedMode.requiresPrompt);
  const referenceGroupKeys = useMemo(
    () => selectedMode.referenceGroups.map((group) => group.key),
    [selectedMode],
  );
  const firstReferenceGroupKey = referenceGroupKeys[0];
  const selectedToolbarControls = selectedMode.toolbarControls ?? defaultToolbarControls;
  const outputCountStrategy = selectedMode.outputCountStrategy ?? 'selectable';
  const showImageModelControl = selectedToolbarControls.includes('model');
  const showLlmModelControl = selectedMode.key === 'dialog' || selectedMode.key === 'detail';
  const showOutputSizeControl = selectedToolbarControls.includes('outputSize');
  const showOutputCountControl = selectedToolbarControls.includes('outputCount') && outputCountStrategy === 'selectable';
  const showBackgroundControl = selectedToolbarControls.includes('background');
  const selectedOutputConfig = selectedMode.outputConfig ?? defaultModeOutputConfig;
  const maxReferenceAttachmentCount = useMemo(() => {
    if (selectedMode.referenceGroups.some((group) => !group.maxCount)) {
      return undefined;
    }
    return selectedMode.referenceGroups.reduce((total, group) => total + (group.maxCount || 0), 0);
  }, [selectedMode.referenceGroups]);
  const groupedAttachments = useMemo(() => {
    const groups = Object.fromEntries(referenceGroupKeys.map((key) => [key, [] as ChatAttachment[]]));
    attachments.forEach((attachment) => {
      const mappedGroupKey = attachmentGroupById[attachment.id] || attachment.clientGroupKey;
      const groupKey = mappedGroupKey && referenceGroupKeys.includes(mappedGroupKey)
        ? mappedGroupKey
        : firstReferenceGroupKey;
      if (groupKey) {
        groups[groupKey].push(attachment);
      }
    });
    return groups;
  }, [attachmentGroupById, attachments, firstReferenceGroupKey, referenceGroupKeys]);
  const mentionOptions = useMemo(() => {
    let imageIndex = 1;
    let fileIndex = 1;
    return selectedMode.referenceGroups.flatMap((group) => {
      const groupAttachments = groupedAttachments[group.key] || [];
      return groupAttachments.map((attachment) => {
        const label = attachment.kind === 'image' ? t("图{{0}}", { "0": imageIndex++ }) : t("文件{{0}}", { "0": fileIndex++ });
        return {
          attachmentId: attachment.id,
          label,
          name: attachment.name,
          previewUrl: attachment.kind === 'image' ? resolveAssetUrl(attachment.url) : undefined,
          subtitle: group.label,
          token: `@${label}`,
        };
      });
    });
  }, [groupedAttachments, selectedMode.referenceGroups]);
  const missingReferenceGroups = selectedMode.referenceGroups.filter((group) => (
    group.required && !groupedAttachments[group.key]?.some((attachment) => (
      attachment.kind === 'image'
      || (group.acceptsPdf && (
        attachment.type === 'application/pdf' || attachment.name.toLowerCase().endsWith('.pdf')
      ))
    ))
  ));
  const hasUploadingAttachments = attachments.some((attachment) => attachment.uploadStatus === 'uploading');
  const generationBlockReason = hasUploadingAttachments
    ? t("图片上传中")
    : promptRequired && !hasPrompt
      ? t("还需输入提示词")
      : missingReferenceGroups.length
        ? t("还需上传{{0}}", { "0": missingReferenceGroups[0].label })
        : '';
  const canStartGeneration = !generationBlockReason;

  const selectMode = useCallback((modeKey: ClawModeKey, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('mode', modeKey);
      return next;
    }, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    if (!isClawModeKey(searchParams.get('mode'))) {
      selectMode('dialog', true);
    }
  }, [searchParams, selectMode]);

  useEffect(() => {
    if (!continueEditFocusToken) {
      return;
    }
    const imageGeneration = composerDraftContext?.imageGeneration;
    const draftModeKey = imageGeneration?.modeKey as ClawModeKey | undefined;
    const nextMode = draftModeKey && clawModeConfigs.some((mode) => mode.key === draftModeKey)
      ? draftModeKey
      : 'dialog';
    const nextModeConfig = clawModeConfigs.find((mode) => mode.key === nextMode) ?? clawModeConfigs[0];
    const nextOutputConfig = nextModeConfig.outputConfig ?? defaultModeOutputConfig;
    const draftAttachmentGroups = imageGeneration?.referenceGroups?.flatMap((group) => (
      group.attachmentIds.map((attachmentId) => [attachmentId, group.key] as const)
    ));
    selectMode(nextMode, true);
    setAttachmentGroupById(
      draftAttachmentGroups?.length
        ? Object.fromEntries(draftAttachmentGroups)
        : Object.fromEntries(attachments.map((attachment) => [attachment.id, 'reference'])),
    );
    if (imageGeneration?.aspectRatio && imageAspectRatioOptions.includes(imageGeneration.aspectRatio as ClawAspectRatioKey)) {
      setSelectedAspectRatio(imageGeneration.aspectRatio as ClawAspectRatioKey);
    }
    if (imageGeneration?.resolution && nextOutputConfig.allowedResolutions.includes(imageGeneration.resolution as ClawResolutionKey)) {
      setSelectedResolution(imageGeneration.resolution as ClawResolutionKey);
    }
    if (imageGeneration?.outputBackground) {
      setSelectedBackground(imageGeneration.outputBackground);
    }
    if (typeof imageGeneration?.outputCount === 'number') {
      setSelectedOutputCount(imageGeneration.outputCount);
    }
    if (composerDraftImageModelConfigId) {
      setSelectedImageModelValue(composerDraftImageModelConfigId);
    }
    if (composerDraftModelConfigId) {
      setSelectedModelConfigId(composerDraftModelConfigId);
    }
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, [attachments, composerDraftContext, composerDraftImageModelConfigId, composerDraftModelConfigId, continueEditFocusToken, selectMode]);

  useEffect(() => {
    const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
    setAttachmentGroupById((items) => Object.fromEntries(
      Object.entries(items).filter(([attachmentId]) => attachmentIds.has(attachmentId)),
    ));
  }, [attachments]);

  useEffect(() => {
    setAttachmentGroupById((items) => {
      const nextItems = { ...items };
      let changed = false;
      const groupCounts = Object.fromEntries(referenceGroupKeys.map((key) => [key, 0]));

      attachments.forEach((attachment) => {
        const currentGroupKey = nextItems[attachment.id] || attachment.clientGroupKey;
        if (currentGroupKey && referenceGroupKeys.includes(currentGroupKey)) {
          groupCounts[currentGroupKey] += 1;
          return;
        }

        const nextGroup = selectedMode.referenceGroups.find((group) => {
          const maxCount = group.maxCount ?? unlimitedReferenceCount;
          return groupCounts[group.key] < maxCount;
        }) || selectedMode.referenceGroups[0];
        if (nextGroup) {
          nextItems[attachment.id] = nextGroup.key;
          groupCounts[nextGroup.key] += 1;
          changed = true;
        }
      });

      return changed ? nextItems : items;
    });
  }, [attachments, referenceGroupKeys, selectedMode.referenceGroups]);

  useEffect(() => {
    let ignore = false;

    async function loadImageModels() {
      try {
        const [systemConfigs, personalConfigs, systemLlmConfigs, personalLlmConfigs] = await Promise.all([
          listModelConfigs('image'),
          listUserImageModelConfigs(),
          listModelConfigs('llm'),
          listUserModelConfigs('llm'),
        ]);
        if (!ignore) {
          setImageConfigs([...personalConfigs, ...systemConfigs]);
          setLlmConfigs([...personalLlmConfigs, ...systemLlmConfigs]);
        }
      } catch (error) {
        if (!ignore) {
          setImageConfigs([]);
          setLlmConfigs([]);
          message.error({
            content: error instanceof Error ? error.message : t("模型配置加载失败"),
            key: 'model-config-load-error',
          });
        }
      }
    }

    void loadImageModels();
    return () => {
      ignore = true;
    };
  }, []);

  const selectableLlmModels = useMemo(
    () => llmConfigs.filter((config) => config.id && imageModelIsConfigured(config)),
    [llmConfigs],
  );

  useEffect(() => {
    if (!selectableLlmModels.some((config) => config.id === selectedModelConfigId)) {
      setSelectedModelConfigId(selectableLlmModels[0]?.id || '');
    }
  }, [selectableLlmModels, selectedModelConfigId]);

  useEffect(() => {
    if (conversationModelConfigId && selectableLlmModels.some((config) => config.id === conversationModelConfigId)) {
      setSelectedModelConfigId(conversationModelConfigId);
    }
  }, [conversationModelConfigId, selectableLlmModels]);

  const selectedLlmModel = selectableLlmModels.find((config) => config.id === selectedModelConfigId)
    || selectableLlmModels[0];
  const visibleContextUsage = showLlmModelControl
    && contextUsage
    && contextUsage.modelConfigId === selectedLlmModel?.id
    && Boolean(contextUsage.contextWindow)
    && typeof contextUsage.usedPercent === 'number'
    ? contextUsage
    : undefined;
  const contextUsageLabel = visibleContextUsage
    ? `${visibleContextUsage.usedPercent}%`
    : '';
  const personalLlmModelItems = selectableLlmModels
    .filter((config) => config.scope === 'personal')
    .map((config) => ({ key: config.id!, label: config.name || config.model }));
  const systemLlmModelItems = selectableLlmModels
    .filter((config) => config.scope !== 'personal')
    .map((config) => ({ key: config.id!, label: config.name || config.model }));
  const llmModelMenuItems = selectableLlmModels.length
    ? [
      ...(personalLlmModelItems.length ? [{ key: 'personal-llm-group', type: 'group' as const, label: t("我的模型（免费）"), children: personalLlmModelItems }] : []),
      ...(systemLlmModelItems.length ? [{ key: 'system-llm-group', type: 'group' as const, label: t("系统模型"), children: systemLlmModelItems }] : []),
    ]
    : [{ key: 'empty-llm', label: t("请先配置对话模型"), disabled: true }];

  const selectableImageModels = useMemo<SelectableImageModel[]>(() => {
    return imageConfigs
      .filter((config) => config.id && imageModelIsConfigured(config))
      .map((config) => ({
        config,
        value: imageModelValue(config),
      }));
  }, [imageConfigs]);

  const defaultImageModelValue = useMemo(() => {
    const defaultConfig = imageConfigs.find((item) => item.scope === 'personal' && item.isDefault && imageModelIsConfigured(item))
      || imageConfigs.find((item) => item.scope === 'system' && item.isDefault && imageModelIsConfigured(item))
      || imageConfigs.find(imageModelIsConfigured);
    if (defaultConfig) {
      return imageModelValue(defaultConfig);
    }
    return selectableImageModels[0]?.value || '';
  }, [imageConfigs, selectableImageModels]);

  useEffect(() => {
    if (!selectedImageModelValue && defaultImageModelValue) {
      setSelectedImageModelValue(defaultImageModelValue);
    }
  }, [defaultImageModelValue, selectedImageModelValue]);

  const selectedImageModel = useMemo(
    () => selectableImageModels.find((item) => item.value === selectedImageModelValue) || selectableImageModels[0],
    [selectableImageModels, selectedImageModelValue],
  );
  const selectedRawImageConfig = useMemo(
    () => imageConfigs.find((item) => imageModelValue(item) === selectedImageModelValue)
      || selectedImageModel?.config,
    [imageConfigs, selectedImageModel?.config, selectedImageModelValue],
  );
  const supportsCustomResolution = imageModelSupportsCustomResolution(selectedRawImageConfig);

  const personalImageModelItems = selectableImageModels
    .filter((item) => item.config.scope === 'personal')
    .map((item) => ({ key: item.value, label: item.config.name || item.config.model }));
  const systemImageModelItems = selectableImageModels
    .filter((item) => item.config.scope !== 'personal')
    .map((item) => ({ key: item.value, label: item.config.name || item.config.model }));
  const imageModelMenuItems = selectableImageModels.length
    ? [
      ...(personalImageModelItems.length ? [{ key: 'personal-group', type: 'group' as const, label: t("我的模型（免费）"), children: personalImageModelItems }] : []),
      ...(systemImageModelItems.length ? [{ key: 'system-group', type: 'group' as const, label: t("系统模型"), children: systemImageModelItems }] : []),
    ]
    : [{ key: 'empty', label: t("请先配置图片模型"), disabled: true }];
  const selectableResolutions = useMemo(
    () => getImageResolutionOptions(selectedRawImageConfig, selectedOutputConfig.allowedResolutions),
    [selectedOutputConfig.allowedResolutions, selectedRawImageConfig],
  );
  const selectableOutputCounts = selectedOutputConfig.allowedOutputCounts;
  const effectiveResolution = selectableResolutions.includes(selectedResolution)
    ? selectedResolution
    : selectableResolutions[0] || selectedOutputConfig.defaultResolution;
  // In automatic mode the resolution tier is sent to the provider, while the
  // provider chooses a canvas that can contain this chapter. Passing the
  // preview's square pixel dimensions would turn that recommendation into a
  // hard square canvas for providers such as Seedream.
  const outputSizeLabel = selectedAspectRatio === 'auto'
    ? undefined
    : getImageOutputSize(selectedRawImageConfig, effectiveResolution, selectedAspectRatio);
  const selectedBackgroundOption = backgroundOptions.find((option) => option.key === selectedBackground) || backgroundOptions[0];
  const resolvedOutputCount = resolveImageGenerationOutputCount({
    strategy: outputCountStrategy,
    requestedCount: selectedOutputCount,
    uploadedImageCount: attachments.filter((attachment) => attachment.kind === 'image').length,
    referenceGroupImageCount: (groupedAttachments[selectedMode.outputCountGroupKey || ''] || [])
      .filter((attachment) => attachment.kind === 'image').length,
  });
  const imageCreditsPerRequest = imageGenerationCreditsPerRequest(selectedRawImageConfig);
  const totalImageCredits = estimateImageGenerationCredits(imageCreditsPerRequest, resolvedOutputCount);

  useEffect(() => {
    if (!selectableResolutions.includes(selectedResolution)) {
      setSelectedResolution(selectableResolutions[0] || selectedOutputConfig.defaultResolution);
    }
  }, [selectedOutputConfig.defaultResolution, selectedResolution, selectableResolutions]);

  useEffect(() => {
    if (!selectableOutputCounts.includes(selectedOutputCount)) {
      setSelectedOutputCount(selectedOutputConfig.defaultOutputCount);
    }
  }, [selectedOutputConfig.defaultOutputCount, selectedOutputCount, selectableOutputCounts]);

  const outputSizePanel = (
    <ImageOutputSizePicker
      allowedResolutions={selectedOutputConfig.allowedResolutions}
      aspectRatio={selectedAspectRatio}
      model={selectedRawImageConfig}
      onAspectRatioChange={setSelectedAspectRatio}
      onResolutionChange={setSelectedResolution}
      resolution={selectedResolution}
    />
  );

  function handlePrimaryAction() {
    if (sending) {
      onStop();
      return;
    }
    if (canStartGeneration) {
      if (showLlmModelControl) {
        const threshold = llmRequestCreditThreshold(selectedLlmModel);
        const balance = Math.max(0, Number(getStoredUser()?.creditBalance) || 0);
        if (balance < threshold) {
          message.warning(t("积分余额不足：当前 {{0}} Credit，调用该 LLM 至少需要 {{1}} Credit", {
            "0": formatCreditAmount(balance),
            "1": formatCreditAmount(threshold),
          }));
          return;
        }
      }
      onSend({
        modelConfigId: showLlmModelControl ? selectedLlmModel?.id || null : null,
        imageModelConfigId: selectedImageModel?.config.id || null,
        capabilityContext: {
          imageGeneration: {
            modeKey: selectedMode.key,
            modeTitle: selectedMode.title,
            promptText: input.trim(),
            promptHint: selectedMode.promptHint,
            outputSize: supportsCustomResolution ? outputSizeLabel : undefined,
            outputCount: outputCountStrategy === 'selectable' && selectedOutputCount === 0
              ? undefined
              : resolvedOutputCount,
            outputBackground: showBackgroundControl ? selectedBackground : undefined,
            aspectRatio: selectedAspectRatio,
            resolution: supportsCustomResolution ? effectiveResolution : undefined,
            referenceGroups: selectedMode.referenceGroups.map((group) => ({
              key: group.key,
              label: group.label,
              required: group.required,
              maxCount: group.maxCount,
              attachmentIds: (groupedAttachments[group.key] || []).map((attachment) => attachment.id),
            })),
          },
        },
      });
    }
  }

  async function handleAddReferenceFiles(group: ClawReferenceGroupConfig, files: File[]) {
    const nextAttachments = await onAddFiles(files, {
      clientGroupKey: group.key,
      maxCount: maxReferenceAttachmentCount,
    });
    if (nextAttachments.length) {
      setAttachmentGroupById((items) => ({
        ...items,
        ...Object.fromEntries(nextAttachments.map((attachment) => [attachment.id, group.key])),
      }));
    }
    return nextAttachments;
  }

  function handleRemoveReference(attachmentId: string) {
    setAttachmentGroupById((items) => {
      const nextItems = { ...items };
      delete nextItems[attachmentId];
      return nextItems;
    });
    onRemoveAttachment(attachmentId);
  }

  return (
    <section className="claw-dialog-composer" aria-label={t("对话生图输入框")}>
      {showHeading ? (
        <div className="claw-dialog-intro">
          <span className="claw-dialog-intro-brand">
            <span className="claw-dialog-intro-dot" aria-hidden="true" />
            {t("地瓜 AI")}
          </span>
          <span className="claw-dialog-intro-title">{t("把商品图变成上新视觉")}</span>
        </div>
      ) : null}

      <div className="claw-dialog-card">
        {showHeading ? (
          <header className="claw-dialog-heading">
            {t("上传商品图，快速生成模特试穿、商品主图、详情图和营销视频，让每一次上新更快进入投放。")}
          </header>
        ) : null}

        {selectedMode.promptHint ? (
          <div className="claw-dialog-hint">
            {renderPromptHint(
              selectedMode.promptHint,
              hoveredReferenceGroupIndex,
              setHoveredReferenceGroupIndex,
            )}
          </div>
        ) : null}

        <div className="claw-dialog-input-zone">
          <ClawReferenceGroups
            groupedAttachments={groupedAttachments}
            groups={selectedMode.referenceGroups}
            highlightedGroupIndex={hoveredReferenceGroupIndex}
            onAddFiles={handleAddReferenceFiles}
            onGroupHoverChange={setHoveredReferenceGroupIndex}
            onRemoveAttachment={handleRemoveReference}
          />

          {showPromptInput ? (
            <div className="claw-dialog-textarea-wrap">
              <MentionRichTextarea
                className="claw-dialog-rich-textarea"
                editorClassName="claw-dialog-rich-editor"
                emptyText={t("暂无可引用图片")}
                enableHardBreak
                menuTitle={t("可引用图片")}
                minRows={2}
                onChange={onInputChange}
                onSubmit={handlePrimaryAction}
                options={mentionOptions}
                placeholder={selectedMode.inputPlaceholder}
                ref={textareaRef}
                value={input}
              />
            </div>
          ) : (
            <div className="claw-dialog-mode-hint" />
          )}

        </div>

        <footer className="claw-dialog-toolbar">
          <div className="claw-dialog-options">
            <Dropdown
              menu={{
                items: modeMenuItems,
                onClick: ({ key }) => selectMode(key as ClawModeKey),
                selectedKeys: [selectedModeKey],
              }}
              classNames={{ root: 'claw-mode-dropdown' }}
              trigger={['click']}
            >
              <Button className="claw-option-button is-active" icon={<SelectedModeIcon size={12} />}>
                {selectedMode.title}
                <ChevronDown size={11} />
              </Button>
            </Dropdown>
            {showLlmModelControl ? (
              <Dropdown
                menu={{
                  items: llmModelMenuItems,
                  onClick: ({ key }) => setSelectedModelConfigId(key),
                  selectedKeys: selectedModelConfigId ? [selectedModelConfigId] : [],
                }}
                classNames={{ root: 'claw-llm-model-dropdown' }}
                trigger={['click']}
              >
                <Button className="claw-option-button" icon={<Bot size={12} />}>
                  {selectedLlmModel?.name || selectedLlmModel?.model || t("对话模型")}
                  <ChevronDown size={11} />
                </Button>
              </Dropdown>
            ) : null}
            {showImageModelControl ? (
              <Dropdown
                menu={{
                  items: imageModelMenuItems,
                  onClick: ({ key }) => setSelectedImageModelValue(key),
                  selectedKeys: selectedImageModelValue ? [selectedImageModelValue] : [],
                }}
                classNames={{ root: 'claw-image-model-dropdown' }}
                trigger={['click']}
              >
                <Button className="claw-option-button" icon={<Layers size={12} />}>
                  {selectedImageModel?.config.name || selectedImageModel?.config.model || t("图片模型")}
                  <ChevronDown size={11} />
                </Button>
              </Dropdown>
            ) : null}
            {showBackgroundControl ? (
              <Dropdown
                menu={{
                  items: backgroundOptions.map((option) => ({
                    key: option.key,
                    label: (
                      <span className="claw-background-menu-item">
                        <span className="claw-background-menu-title">{option.label}</span>
                        <span className="claw-background-menu-description">{option.description}</span>
                      </span>
                    ),
                  })),
                  onClick: ({ key }) => setSelectedBackground(key as ClawBackgroundKey),
                  selectedKeys: [selectedBackground],
                }}
                trigger={['click']}
              >
                <Button className="claw-option-button" icon={<Palette size={12} />}>
                  {selectedBackgroundOption.label}
                  <ChevronDown size={11} />
                </Button>
              </Dropdown>
            ) : null}
            {showOutputSizeControl ? (
              <Popover
                arrow={false}
                content={outputSizePanel}
                classNames={{ root: 'image-output-size-popover' }}
                placement="bottomLeft"
                trigger="click"
              >
                <Button className="claw-option-button" icon={<Scan size={12} />}>
                  {selectedAspectRatio}
                  {supportsCustomResolution ? (
                    <>
                      <span className="claw-option-divider" />
                      {selectedResolution}
                    </>
                  ) : null}
                  <ChevronDown size={11} />
                </Button>
              </Popover>
            ) : null}
            {showOutputCountControl ? (
              <Dropdown
                menu={{
                  items: selectableOutputCounts.map((count) => ({
                    key: String(count),
                    label: count === 0 ? t("自动") : t("{{0}} 张", { "0": count }),
                  })),
                  onClick: ({ key }) => setSelectedOutputCount(Number(key)),
                  selectedKeys: [String(selectedOutputCount)],
                }}
                trigger={['click']}
              >
                <Button className="claw-option-button" icon={<List size={12} />}>
                  {selectedOutputCount === 0 ? t("自动") : `${selectedOutputCount} ${t("张")}`}
                  <ChevronDown size={11} />
                </Button>
              </Dropdown>
            ) : null}
          </div>

          <div className="claw-dialog-submit">
            {visibleContextUsage ? (
              <span
                className="claw-context-usage"
                title={t("已使用 {{0}} / {{1}} 有效 Token，默认窗口 {{2}}，有效比例 {{3}}%，剩余 {{4}}%", {
                  "0": new Intl.NumberFormat().format(visibleContextUsage.usedTokens),
                  "1": new Intl.NumberFormat().format(visibleContextUsage.contextWindow || 0),
                  "2": new Intl.NumberFormat().format(visibleContextUsage.maxContextWindow || visibleContextUsage.contextWindow || 0),
                  "3": visibleContextUsage.effectiveContextWindowPercent ?? 100,
                  "4": visibleContextUsage.remainingPercent ?? 0,
                })}
              >
                {contextUsageLabel}
              </span>
            ) : null}
            {!canStartGeneration ? (
              <span className="claw-prompt-status">{generationBlockReason}</span>
            ) : null}
            <span className="claw-credit">
              <CreditIcon />
              {formatCreditAmount(totalImageCredits)}
            </span>
            <Button
              aria-label={sending ? t("停止生成") : t("发送消息")}
              className="claw-send-button"
              disabled={!sending && !canStartGeneration}
              icon={sending ? <Square size={12} fill="currentColor" /> : <ArrowRight size={16} />}
              onClick={handlePrimaryAction}
              type="primary"
            />
          </div>
        </footer>
      </div>

      {showHeading ? (
        <div className="claw-feature-grid">
          {visibleModeCards.map((item) => {
            const FeatureIcon = item.Icon;

            return (
              <button
                className={`claw-feature-card${item.key === selectedModeKey ? ' selected' : ''}`}
                key={item.key}
                onClick={() => selectMode(item.key)}
                type="button"
              >
                <span className="claw-feature-icon">
                  <FeatureIcon size={14} />
                </span>
                <span className="claw-feature-copy">
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                {item.key === selectedModeKey ? (
                  <span className="claw-feature-check">
                    <Check size={10} strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
