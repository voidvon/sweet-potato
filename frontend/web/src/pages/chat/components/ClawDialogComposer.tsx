import { Button, Dropdown, Popover, message } from 'antd';
import {
  ArrowRight,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveAssetUrl } from '../../../api/request';
import { listModelConfigs } from '../../../api/model-config';
import type { ChatAttachment, ModelConfig, SendChatPayload } from '../../../types';
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
import {
  estimateImageGenerationCredits,
  imageGenerationCreditsPerRequest,
  resolveImageGenerationOutputCount,
} from '@shared/utils/imageGenerationCredits';
import { ClawReferenceGroups, type ClawReferenceGroupConfig } from './ClawReferenceGroups';
import './ClawDialogComposer.scss';

type ClawDialogComposerProps = {
  attachments: ChatAttachment[];
  composerDraftContext?: SendChatPayload['capabilityContext'];
  composerDraftImageModelConfigId?: string | null;
  input: string;
  onAddFiles: (files: File[], options?: {
    clientGroupKey?: string;
    maxCount?: number;
  }) => Promise<ChatAttachment[]>;
  onInputChange: (value: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: (options?: { capabilityContext?: SendChatPayload['capabilityContext']; imageModelConfigId?: string | null }) => void;
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
type ClawBackgroundKey = 'transparent' | 'white' | 'black';
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
const defaultOptionalPlaceholder = '补充要求（选填），例如：调整光线、风格、姿态…';
const unlimitedReferenceCount = Number.POSITIVE_INFINITY;
const defaultModeOutputConfig: ClawModeOutputConfig = {
  allowedOutputCounts: [1, 2, 3, 4],
  allowedResolutions: ['2K', '4K'],
  defaultOutputCount: 1,
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
  { key: 'transparent', label: '透明背景', description: '保留 alpha 通道，适合继续合成和入库。' },
  { key: 'white', label: '白底', description: '适合电商主图、目录图和快审稿。' },
  { key: 'black', label: '黑底', description: '适合暗场氛围、光效测试和封面图。' },
];

const clawModeConfigs: ClawModeConfig[] = [
  {
    key: 'dialog',
    title: '对话生图',
    description: '多图对话',
    Icon: MessageCircle,
    inputPlaceholder: '描述你要的画面，可上传参考图，输入 @ 引用图片。',
    outputConfig: defaultModeOutputConfig,
    referenceGroups: [{ key: 'reference', label: '参考图', maxCount: 8 }],
    requiresPrompt: true,
  },
  {
    key: 'detail',
    title: '详情图生成',
    description: '商品详情',
    Icon: Images,
    inputPlaceholder: defaultOptionalPlaceholder,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: '描述详情图需求，例如：整体高级、文字少一点，适合淘宝详情页',
    referenceGroups: [
      { key: 'product', label: '产品图', maxCount: 3, required: true },
      { key: 'reference', label: '参考图', maxCount: 10 },
    ],
  },
  {
    key: 'outfit',
    title: '换装',
    description: '一键试穿',
    Icon: Shirt,
    inputPlaceholder: defaultOptionalPlaceholder,
    outputConfig: defaultModeOutputConfig,
    promptHint: '让 图1 的模特穿上 图2 的衣服，AI 自动出图。',
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'clothes', label: '图片', required: true },
    ],
  },
  {
    key: 'model-views',
    title: '模特三视图',
    description: '多角度展示',
    Icon: Layers,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: '为 图1 的模特生成正面 / 45 度侧面 / 背面三视图拼接图。人物必须保持自然站立姿势，完整呈现从头到脚的全身，不得裁切；可参考服装正反面和背景。',
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'front', label: '服装正面', maxCount: 1 },
      { key: 'back', label: '服装背面', maxCount: 1 },
      { key: 'background', label: '背景', maxCount: 1 },
    ],
  },
  {
    key: 'pose-reference',
    title: '姿势参考',
    description: '参考姿态',
    Icon: Scan,
    outputConfig: defaultModeOutputConfig,
    outputCountGroupKey: 'pose',
    outputCountStrategy: 'matchReferenceGroup',
    promptHint: '让 图1 的主体摆出 图2 的姿势。',
    referenceGroups: [
      { key: 'subject', label: '主体', maxCount: 1, required: true },
      { key: 'pose', label: '姿势', required: true },
    ],
  },
  {
    key: 'upscale',
    title: '高清放大',
    description: '提分辨率',
    Icon: Maximize2,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '把 图1 放大变清晰。',
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
  },
  {
    key: 'cutout',
    title: '图片抠图',
    description: '主体分离',
    Icon: Scan,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '把 图1 的背景去掉，按所选底色输出。',
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
    toolbarControls: cutoutToolbarControls,
  },
  {
    key: 'background',
    title: '换背景',
    description: '环境焕新',
    Icon: Images,
    outputCountStrategy: 'fixedOne',
    promptHint: '把 图1 的背景换成 图2 的风格。',
    referenceGroups: [
      { key: 'subject', label: '主体', maxCount: 1, required: true },
      { key: 'background', label: '背景', maxCount: 1, required: true },
    ],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'scene-extract',
    title: '场景提取',
    description: '提取环境',
    Icon: ImagePlus,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '从 图1 提取干净的场景素材。',
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'model-face-swap',
    title: '模特换脸',
    description: '替换模特脸',
    Icon: Shirt,
    outputCountStrategy: 'fixedOne',
    promptHint: '把 图1 模特的脸换成 图2 的样子，造型不变。',
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'face', label: '脸部', maxCount: 1, required: true },
    ],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'head-swap',
    title: '智能换头',
    description: '头部替换',
    Icon: Scan,
    outputCountStrategy: 'fixedOne',
    promptHint: '给 图1 模特随机换一个新头型。',
    referenceGroups: [{ key: 'model', label: '模特', maxCount: 1, required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'face-swap',
    title: '智能换脸',
    description: '脸部替换',
    Icon: Scan,
    outputCountStrategy: 'fixedOne',
    promptHint: '给 图1 模特随机换一张新脸。',
    referenceGroups: [{ key: 'model', label: '模特', maxCount: 1, required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'redraw',
    title: '智能重绘',
    description: '读图后重绘',
    Icon: Brush,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '读懂 图1 的画面内容，整理成提示词后重新生成一张更干净自然的图。',
    referenceGroups: [{ key: 'reference', label: '参考图', required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'detail-enhance',
    title: '细节增强',
    description: '优化细节',
    Icon: Zap,
    inputPlaceholder: defaultOptionalPlaceholder,
    outputConfig: defaultModeOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: '在 图1 涂抹位置上补强、修复或替换：',
    referenceGroups: [{ key: 'base', label: '基础图', maxCount: 1, required: true }],
  },
  {
    key: 'print-extract',
    title: '印花提取',
    description: '提取图案',
    Icon: Images,
    inputPlaceholder: '补充印花提取要求（选填），例如：只保留胸前主图案、支持单张图片详情描述。',
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '提取 图1 服装的印花，输出 PNG 和 PSD。',
    referenceGroups: [{ key: 'clothes', label: '服装', required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
  {
    key: 'face-enhance',
    title: '脸部增强',
    description: '优化脸部',
    Icon: Scan,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '为 图1 等图像增强脸部细节。',
    referenceGroups: [{ key: 'portrait', label: '人像', required: true }],
    toolbarControls: modelOnlyToolbarControls,
  },
];

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

export function ClawDialogComposer({
  attachments,
  composerDraftContext,
  composerDraftImageModelConfigId,
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
  const [selectedModeKey, setSelectedModeKey] = useState<ClawModeKey>('dialog');
  const [imageConfigs, setImageConfigs] = useState<ModelConfig[]>([]);
  const [selectedImageModelValue, setSelectedImageModelValue] = useState('');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<ClawAspectRatioKey>('auto');
  const [selectedBackground, setSelectedBackground] = useState<ClawBackgroundKey>('transparent');
  const [selectedResolution, setSelectedResolution] = useState<ClawResolutionKey>('2K');
  const [selectedOutputCount, setSelectedOutputCount] = useState(1);
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
    return selectedMode.referenceGroups.flatMap((group) => {
      const groupAttachments = groupedAttachments[group.key] || [];
      return groupAttachments.map((attachment) => {
        const label = `图${imageIndex}`;
        imageIndex += 1;
        return {
          attachmentId: attachment.id,
          label,
          name: attachment.name,
          previewUrl: resolveAssetUrl(attachment.url),
          subtitle: group.label,
          token: `@${label}`,
        };
      });
    });
  }, [groupedAttachments, selectedMode.referenceGroups]);
  const missingReferenceGroups = selectedMode.referenceGroups.filter(
    (group) => group.required && !groupedAttachments[group.key]?.length,
  );
  const hasUploadingAttachments = attachments.some((attachment) => attachment.uploadStatus === 'uploading');
  const generationBlockReason = hasUploadingAttachments
    ? '图片上传中'
    : promptRequired && !hasPrompt
      ? '还需输入提示词'
      : missingReferenceGroups.length
        ? `还需上传${missingReferenceGroups[0].label}`
        : '';
  const canStartGeneration = !generationBlockReason;

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
    setSelectedModeKey(nextMode);
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
    window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, [attachments, composerDraftContext, composerDraftImageModelConfigId, continueEditFocusToken]);

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
        const configs = await listModelConfigs('image');
        if (!ignore) {
          setImageConfigs(configs);
        }
      } catch (error) {
        if (!ignore) {
          setImageConfigs([]);
          message.error({
            content: error instanceof Error ? error.message : '图片模型配置加载失败',
            key: 'image-model-config-load-error',
          });
        }
      }
    }

    void loadImageModels();
    return () => {
      ignore = true;
    };
  }, []);

  const selectableImageModels = useMemo<SelectableImageModel[]>(() => {
    return imageConfigs
      .filter((config) => config.id && imageModelIsConfigured(config))
      .map((config) => ({
        config,
        value: imageModelValue(config),
      }));
  }, [imageConfigs]);

  const defaultImageModelValue = useMemo(() => {
    const defaultConfig = imageConfigs.find((item) => item.isDefault && imageModelIsConfigured(item))
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

  const imageModelMenuItems = selectableImageModels.length
    ? selectableImageModels.map((item) => ({
      key: item.value,
      label: item.config.name || item.config.model,
      disabled: false,
    }))
    : [{ key: 'empty', label: '请先配置图片模型', disabled: true }];
  const selectableResolutions = useMemo(
    () => getImageResolutionOptions(selectedRawImageConfig, selectedOutputConfig.allowedResolutions),
    [selectedOutputConfig.allowedResolutions, selectedRawImageConfig],
  );
  const selectableOutputCounts = selectedOutputConfig.allowedOutputCounts;
  const effectiveResolution = selectableResolutions.includes(selectedResolution)
    ? selectedResolution
    : selectableResolutions[0] || selectedOutputConfig.defaultResolution;
  const outputSizeLabel = getImageOutputSize(selectedRawImageConfig, effectiveResolution, selectedAspectRatio);
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
      onSend({
        imageModelConfigId: selectedImageModel?.config.id || null,
        capabilityContext: {
          imageGeneration: {
            modeKey: selectedMode.key,
            modeTitle: selectedMode.title,
            promptText: input.trim(),
            promptHint: selectedMode.promptHint,
            outputSize: supportsCustomResolution ? outputSizeLabel : undefined,
            outputCount: resolvedOutputCount,
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
    <section className="claw-dialog-composer" aria-label="对话生图输入框">
      {showHeading ? (
        <div className="claw-dialog-intro">
          <span className="claw-dialog-intro-brand">
            <span className="claw-dialog-intro-dot" aria-hidden="true" />
            萌猫 AI
          </span>
          <span className="claw-dialog-intro-title">把商品图变成上新视觉</span>
        </div>
      ) : null}

      <div className="claw-dialog-card">
        {showHeading ? (
          <header className="claw-dialog-heading">
            上传商品图，快速生成模特试穿、商品主图、详情图和营销视频，让每一次上新更快进入投放。
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
                emptyText="暂无可引用图片"
                menuTitle="可引用图片"
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
                onClick: ({ key }) => setSelectedModeKey(key as ClawModeKey),
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
                  {selectedImageModel?.config.name || selectedImageModel?.config.model || '图片模型'}
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
                  items: selectableOutputCounts.map((count) => ({ key: String(count), label: `${count} 张` })),
                  onClick: ({ key }) => setSelectedOutputCount(Number(key) || 1),
                  selectedKeys: [String(selectedOutputCount)],
                }}
                trigger={['click']}
              >
                <Button className="claw-option-button" icon={<List size={12} />}>
                  {selectedOutputCount} 张
                  <ChevronDown size={11} />
                </Button>
              </Dropdown>
            ) : null}
          </div>

          <div className="claw-dialog-submit">
            {!canStartGeneration ? (
              <span className="claw-prompt-status">{generationBlockReason}</span>
            ) : null}
            <span className="claw-credit">
              <CreditIcon />
              {formatCreditAmount(totalImageCredits)}
            </span>
            <Button
              aria-label={sending ? '停止生成' : '发送消息'}
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
                onClick={() => setSelectedModeKey(item.key)}
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
