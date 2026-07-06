import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { contentFilesDir } from '../../content/internals/content-common.js';
import {
  extensionForMimeType,
} from '../../content/internals/content-image-assets.js';
import { fileUrlFor } from '../../content/internals/content-voice-clone.js';
import type { ChatCapabilityExecutionInput } from '../chat-capability.types.js';
import type { ChatAttachment } from '../chat.types.js';
import type { AiModelConfig } from '../../model-configs/model-config.types.js';
import {
  resolveImageGenerationProviderAdapter,
  type ImageGenerationProviderResult,
  type ImageGenerationReferenceAsset,
} from './image-generation.provider-adapter.js';

type ImageGenerationPreparedInput = {
  generationOptions?: ImageGenerationModeOptions;
  modelConfig: AiModelConfig;
  modeKey: string;
  outputCount: number;
  outputSize?: string;
  prompt: string;
  referenceAssets: ImageGenerationReferenceAsset[];
  sourceIdPrefix: string;
};

type ImageGenerationModeReferenceGroup = {
  key: string;
  label: string;
  maxCount?: number;
  required?: boolean;
};

type ImageGenerationModeSchema = {
  generationOptions?: ImageGenerationModeOptions;
  key: string;
  promptHint?: string;
  referenceGroups: ImageGenerationModeReferenceGroup[];
  requiresPrompt?: boolean;
  title: string;
};

type ResolvedImageGenerationReferenceGroup = ImageGenerationModeReferenceGroup & {
  attachmentIds: string[];
};

type ImageGenerationModeOptions = {
  background?: 'transparent' | 'opaque' | 'auto';
  outputCompression?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  businessOutputFormats?: string[];
};

const imageGenerationModeSchemas: Record<string, ImageGenerationModeSchema> = {
  dialog: {
    key: 'dialog',
    title: '对话生图',
    referenceGroups: [{ key: 'reference', label: '参考图', maxCount: 8 }],
    requiresPrompt: true,
  },
  detail: {
    key: 'detail',
    title: '详情图生成',
    promptHint: '描述详情图需求，例如：整体高级、文字少一点，适合淘宝详情页',
    referenceGroups: [
      { key: 'product', label: '产品图', maxCount: 3, required: true },
      { key: 'reference', label: '参考图', maxCount: 10 },
    ],
  },
  outfit: {
    key: 'outfit',
    title: '换装',
    promptHint: '让 图一 的模特穿上 图二 的衣服，AI 自动出图。',
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'clothes', label: '图片', required: true },
    ],
  },
  'model-views': {
    key: 'model-views',
    title: '模特三视图',
    promptHint: '为 图一 的模特生成正面 / 45 度侧面 / 背面三视图拼接图，可参考服装正反面和背景。',
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'front', label: '服装正面', maxCount: 1 },
      { key: 'back', label: '服装背面', maxCount: 1 },
      { key: 'background', label: '背景', maxCount: 1 },
    ],
  },
  'pose-reference': {
    key: 'pose-reference',
    title: '姿势参考',
    promptHint: '让 图一 的主体摆出 图二 的姿势。',
    referenceGroups: [
      { key: 'subject', label: '主体', maxCount: 1, required: true },
      { key: 'pose', label: '姿势', required: true },
    ],
  },
  upscale: {
    key: 'upscale',
    title: '高清放大',
    promptHint: '把 图一 放大变清晰。',
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
  },
  cutout: {
    key: 'cutout',
    title: '图片抠图',
    promptHint: '把 图一 的背景去掉，按所选底色输出。',
    generationOptions: {
      background: 'transparent',
      outputFormat: 'png',
    },
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
  },
  background: {
    key: 'background',
    title: '换背景',
    promptHint: '把 图一 的背景换成 图二 的风格。',
    referenceGroups: [
      { key: 'subject', label: '主体', maxCount: 1, required: true },
      { key: 'background', label: '背景', maxCount: 1, required: true },
    ],
  },
  'scene-extract': {
    key: 'scene-extract',
    title: '场景提取',
    promptHint: '从 图一 提取干净的场景素材。',
    generationOptions: {
      background: 'transparent',
      outputFormat: 'png',
    },
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
  },
  'model-face-swap': {
    key: 'model-face-swap',
    title: '模特换脸',
    promptHint: '把 图一 模特的脸换成 图二 的样子，造型不变。',
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'face', label: '脸部', maxCount: 1, required: true },
    ],
  },
  'head-swap': {
    key: 'head-swap',
    title: '智能换头',
    promptHint: '给 图一 模特随机换一个新头型。',
    referenceGroups: [{ key: 'model', label: '模特', maxCount: 1, required: true }],
  },
  'face-swap': {
    key: 'face-swap',
    title: '智能换脸',
    promptHint: '给 图一 模特随机换一张新脸。',
    referenceGroups: [{ key: 'model', label: '模特', maxCount: 1, required: true }],
  },
  redraw: {
    key: 'redraw',
    title: '智能重绘',
    promptHint: '读懂 图一 的画面内容，整理成提示词后重新生成一张更干净自然的图。',
    referenceGroups: [{ key: 'reference', label: '参考图', required: true }],
  },
  'detail-enhance': {
    key: 'detail-enhance',
    title: '细节增强',
    promptHint: '在 图一 涂抹位置上补强、修复或替换：',
    referenceGroups: [{ key: 'base', label: '基础图', maxCount: 1, required: true }],
  },
  'print-extract': {
    key: 'print-extract',
    title: '印花提取',
    promptHint: '提取 图一 服装的印花，输出 PNG 和 PSD。',
    generationOptions: {
      background: 'transparent',
      outputFormat: 'png',
      businessOutputFormats: ['png', 'psd'],
    },
    referenceGroups: [{ key: 'clothes', label: '服装', required: true }],
  },
  'face-enhance': {
    key: 'face-enhance',
    title: '脸部增强',
    promptHint: '为 图一 等图像增强脸部细节。',
    referenceGroups: [{ key: 'portrait', label: '人像', required: true }],
  },
};

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('参考图格式不支持');
  }
  const mimeType = match[1] || 'image/png';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  return {
    buffer: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload)),
    mimeType,
  };
}

function safeImageName(value: string, fallback: string) {
  return (value || fallback).replace(/[^\w.-]+/g, '-').slice(0, 120) || fallback;
}

async function chatAttachmentToReferenceAsset(attachment: ChatAttachment) {
  const parsed = dataUrlToBuffer(attachment.url);
  const originalFileName = safeImageName(attachment.name, 'reference.png');
  const extension = extensionForMimeType(parsed.mimeType);
  const storedFileName = `chat-image-reference-${randomBytes(8).toString('hex')}.${extension}`;
  const filePath = path.join(contentFilesDir, storedFileName);
  await writeFile(filePath, parsed.buffer);
  return {
    filePath,
    mimeType: parsed.mimeType,
    originalFileName,
  };
}

function cleanText(value: string | undefined | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function modeSchemaOf(input: ChatCapabilityExecutionInput) {
  const modeKey = cleanText(input.capabilityContext?.imageGeneration?.modeKey) || 'dialog';
  return imageGenerationModeSchemas[modeKey] || imageGenerationModeSchemas.dialog;
}

function referenceGroupsBySchema(input: ChatCapabilityExecutionInput, modeSchema: ImageGenerationModeSchema) {
  const imageAttachments = input.attachments.filter((attachment) => attachment.kind === 'image' && attachment.url);
  const contextGroups = input.capabilityContext?.imageGeneration?.referenceGroups || [];
  const attachmentsById = new Map(imageAttachments.map((attachment) => [attachment.id, attachment]));
  const contextGroupsByKey = new Map(contextGroups.map((group) => [group.key, group]));

  return modeSchema.referenceGroups.map((schemaGroup) => {
    const contextGroup = contextGroupsByKey.get(schemaGroup.key);
    const attachmentIds = (contextGroup?.attachmentIds || [])
      .filter((attachmentId) => attachmentsById.has(attachmentId));
    if (schemaGroup.required && !attachmentIds.length) {
      throw new Error(`请上传${schemaGroup.label}`);
    }
    if (schemaGroup.maxCount && attachmentIds.length > schemaGroup.maxCount) {
      throw new Error(`${schemaGroup.label}最多上传 ${schemaGroup.maxCount} 张`);
    }
    return {
      ...schemaGroup,
      attachmentIds,
    };
  });
}

function referenceAttachmentsByContext(
  input: ChatCapabilityExecutionInput,
  groups: ResolvedImageGenerationReferenceGroup[],
) {
  const imageAttachments = input.attachments.filter((attachment) => attachment.kind === 'image' && attachment.url);
  const attachmentsById = new Map(imageAttachments.map((attachment) => [attachment.id, attachment]));
  const orderedAttachments = groups.flatMap((group) => (
    group.attachmentIds.flatMap((attachmentId) => {
      const attachment = attachmentsById.get(attachmentId);
      return attachment ? [attachment] : [];
    })
  ));
  const orderedIds = new Set(orderedAttachments.map((attachment) => attachment.id));
  return [
    ...orderedAttachments,
    ...imageAttachments.filter((attachment) => !orderedIds.has(attachment.id) && !input.capabilityContext?.imageGeneration?.referenceGroups?.length),
  ];
}

function buildImageGenerationPrompt(
  input: ChatCapabilityExecutionInput,
  modeSchema: ImageGenerationModeSchema,
  groups: ResolvedImageGenerationReferenceGroup[],
) {
  const context = input.capabilityContext?.imageGeneration;
  const modeTitle = cleanText(context?.modeTitle) || modeSchema.title;
  const userPrompt = cleanText(context?.promptText || input.content);
  const promptHint = cleanText(context?.promptHint) || cleanText(modeSchema.promptHint);
  const outputFormatSummary = modeSchema.generationOptions?.businessOutputFormats?.length
    ? `输出格式：${modeSchema.generationOptions.businessOutputFormats.join(' + ')}`
    : '';
  const groupSummary = groups
    .filter((group) => group.attachmentIds.length)
    .map((group) => `${group.label}：${group.attachmentIds.length} 张`)
    .join('；');
  const parts = [
    modeTitle ? `当前生图模式：${modeTitle}` : '',
    promptHint ? `业务要求：${promptHint}` : '',
    outputFormatSummary ? `业务输出：${outputFormatSummary}` : '',
    userPrompt ? `用户补充：${userPrompt}` : '',
    groupSummary ? `参考图分组：${groupSummary}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function outputCountOf(input: ChatCapabilityExecutionInput) {
  const outputCount = Number(input.capabilityContext?.imageGeneration?.outputCount || 1);
  return Number.isFinite(outputCount) ? Math.max(1, Math.min(4, Math.floor(outputCount))) : 1;
}

function outputSizeOf(input: ChatCapabilityExecutionInput) {
  const outputSize = cleanText(input.capabilityContext?.imageGeneration?.outputSize);
  return outputSize ? outputSize.replace(/\s*x\s*/i, 'x') : undefined;
}

function assertImageModelReady(input: ChatCapabilityExecutionInput) {
  const modelConfig = input.imageModelConfig;
  if (!modelConfig) {
    throw new Error('请先选择图片模型');
  }
  if (modelConfig.type !== 'image') {
    throw new Error('请选择图片模型配置');
  }
  if (!modelConfig.apiKey) {
    throw new Error(`图片模型「${modelConfig.name}」尚未配置 API Key`);
  }
  if (!modelConfig.model || !modelConfig.baseUrl) {
    throw new Error(`图片模型「${modelConfig.name}」配置不完整`);
  }
  return modelConfig;
}

async function prepareImageGeneration(input: ChatCapabilityExecutionInput): Promise<ImageGenerationPreparedInput> {
  const modelConfig = assertImageModelReady(input);
  const modeSchema = modeSchemaOf(input);
  const userPrompt = cleanText(input.capabilityContext?.imageGeneration?.promptText || input.content);
  if (modeSchema.requiresPrompt && !userPrompt) {
    throw new Error('请输入生图提示词');
  }
  const groups = referenceGroupsBySchema(input, modeSchema);
  const prompt = buildImageGenerationPrompt(input, modeSchema, groups);
  if (!prompt) {
    throw new Error('图片生成提示词为空');
  }

  const outputCount = outputCountOf(input);
  const outputSize = outputSizeOf(input);
  const imageAttachments = referenceAttachmentsByContext(input, groups);
  const referenceAssets = imageAttachments.length
    ? await Promise.all(imageAttachments.map(chatAttachmentToReferenceAsset))
    : [];
  const sourceIdPrefix = input.conversation?.id || `chat-image-${Date.now()}`;
  return {
    generationOptions: modeSchema.generationOptions,
    modelConfig,
    modeKey: modeSchema.key,
    outputCount,
    outputSize,
    prompt,
    referenceAssets,
    sourceIdPrefix,
  };
}

async function generateImageItems(input: {
  prepared: ImageGenerationPreparedInput;
  userId: string;
}): Promise<ImageGenerationProviderResult[]> {
  const { prepared, userId } = input;
  const adapter = resolveImageGenerationProviderAdapter(prepared.modelConfig);
  return adapter.generate({
    background: prepared.generationOptions?.background,
    modelConfig: prepared.modelConfig,
    modeKey: prepared.modeKey,
    outputCount: prepared.outputCount,
    outputCompression: prepared.generationOptions?.outputCompression,
    outputFormat: prepared.generationOptions?.outputFormat,
    outputSize: prepared.outputSize,
    prompt: prepared.prompt,
    referenceAssets: prepared.referenceAssets,
    sourceIdPrefix: prepared.sourceIdPrefix,
    userId,
  });
}

async function persistGeneratedImageAttachments(input: {
  generatedItems: ImageGenerationProviderResult[];
  outputCount: number;
}) {
  const { generatedItems, outputCount } = input;
  const assistantAttachments = await Promise.all(generatedItems.map(async (generated, index) => {
    const extension = extensionForMimeType(generated.mimeType);
    const storedFileName = `chat-generated-image-${randomBytes(8).toString('hex')}.${extension}`;
    const filePath = path.join(contentFilesDir, storedFileName);
    await writeFile(filePath, generated.buffer);
    return {
      id: randomBytes(8).toString('hex'),
      kind: 'image' as const,
      name: outputCount > 1 ? `generated-image-${index + 1}.${extension}` : `generated-image.${extension}`,
      type: generated.mimeType,
      size: generated.buffer.byteLength,
      url: fileUrlFor(storedFileName),
    };
  }));
  return assistantAttachments;
}

const ImageGenerationGraphState = Annotation.Root({
  input: Annotation<ChatCapabilityExecutionInput>(),
  prepared: Annotation<ImageGenerationPreparedInput | undefined>(),
  generatedItems: Annotation<ImageGenerationProviderResult[] | undefined>(),
  assistantAttachments: Annotation<ChatAttachment[] | undefined>(),
});

type ImageGenerationGraphStateValue = typeof ImageGenerationGraphState.State;

let compiledImageGenerationGraph: ReturnType<ReturnType<typeof createImageGenerationGraph>['compile']> | null = null;

function createImageGenerationGraph() {
  return new StateGraph(ImageGenerationGraphState)
    .addNode('prepare', async (state: ImageGenerationGraphStateValue) => ({
      prepared: await prepareImageGeneration(state.input),
    }))
    .addNode('generate', async (state: ImageGenerationGraphStateValue) => {
      if (!state.prepared) {
        throw new Error('图片生成参数未准备完成');
      }
      return {
        generatedItems: await generateImageItems({
          prepared: state.prepared,
          userId: state.input.userId,
        }),
      };
    })
    .addNode('persist', async (state: ImageGenerationGraphStateValue) => {
      if (!state.prepared || !state.generatedItems) {
        throw new Error('图片生成结果未准备完成');
      }
      return {
        assistantAttachments: await persistGeneratedImageAttachments({
          generatedItems: state.generatedItems,
          outputCount: state.prepared.outputCount,
        }),
      };
    })
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'generate')
    .addEdge('generate', 'persist')
    .addEdge('persist', END);
}

async function runImageGenerationGraph(input: ChatCapabilityExecutionInput) {
  if (!compiledImageGenerationGraph) {
    compiledImageGenerationGraph = createImageGenerationGraph().compile();
  }
  const result = await compiledImageGenerationGraph.invoke({ input });
  if (!result.prepared || !result.assistantAttachments) {
    throw new Error('图片生成流程未返回有效结果');
  }
  return {
    assistantAttachments: result.assistantAttachments,
    modelConfig: result.prepared.modelConfig,
  };
}

export async function runImageGenerationWorkflow(input: ChatCapabilityExecutionInput) {
  const result = await runImageGenerationGraph(input);
  return {
    assistantAttachments: result.assistantAttachments,
    assistantContent: `已使用 ${result.modelConfig.name} / ${result.modelConfig.model} 生成 ${result.assistantAttachments.length} 张图片。`,
  };
}
