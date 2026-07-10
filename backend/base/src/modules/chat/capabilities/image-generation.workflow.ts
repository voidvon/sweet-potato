import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';
import { assertSufficientStepCredits } from '../../billing/billing.service.js';
import {
  contentFilePathForRelativePath,
  contentFilesDir,
  generatedMediaRelativePath,
  inputMediaRelativePath,
  resolveLocalContentFilePathFromUrl,
} from '../../content/internals/content-common.js';
import {
  createGeneratedImageWorkAsset,
  extensionForMimeType,
} from '../../content/internals/content-image-assets.js';
import { fileUrlFor } from '../../content/internals/content-voice-clone.js';
import { isUpstreamModelError } from '../../model-providers/provider-error.js';
import type { ChatCapabilityExecutionInput } from '../chat-capability.types.js';
import type { ChatAttachment, ChatImageGenerationFailure } from '../chat.types.js';
import type { AiModelConfig } from '../../model-configs/model-config.types.js';
import { askConfiguredModelWithMessages } from '../chat-completion.service.js';
import {
  resolveImageGenerationProviderAdapter,
  type ImageGenerationProviderResult,
  type ImageGenerationReferenceAsset,
} from './image-generation.provider-adapter.js';

type ImageGenerationPreparedInput = {
  generationOptions?: ImageGenerationModeOptions;
  modelConfig: AiModelConfig;
  modeKey: string;
  modeTitle: string;
  outputAspectRatio?: string;
  outputCount: number;
  outputSize?: string;
  requestedResolution?: string;
  prompt: string;
  userPrompt: string;
  redrawPromptTexts?: string[];
  referenceAssets: ImageGenerationReferenceAsset[];
  referenceAssetBatches?: ImageGenerationReferenceAsset[][];
  referenceAssetBatchPrompts?: string[];
  referenceDecision?: ImageGenerationReferenceDecision;
  sourceIdPrefix: string;
};

type ImageGenerationModeReferenceGroup = {
  key: string;
  label: string;
  maxCount?: number;
  required?: boolean;
};

type ImageGenerationModeSchema = {
  generationPrompt?: string;
  generationOptions?: ImageGenerationModeOptions;
  key: string;
  outputConfig?: ImageGenerationOutputConfig;
  outputCountGroupKey?: string;
  outputCountStrategy?: ImageGenerationOutputCountStrategy;
  promptHint?: string;
  referenceGroups: ImageGenerationModeReferenceGroup[];
  requiresPrompt?: boolean;
  title: string;
};

type ResolvedImageGenerationReferenceGroup = ImageGenerationModeReferenceGroup & {
  attachmentIds: string[];
};

type ImageGenerationOutputCountStrategy = 'selectable' | 'fixedOne' | 'matchUploadedImages' | 'matchReferenceGroup';
type ImageGenerationModeOptions = {
  background?: 'transparent' | 'opaque' | 'auto';
  outputCompression?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  businessOutputFormats?: string[];
};

type ImageGenerationResolutionKey = '1K' | '2K' | '4K';

type ImageGenerationOutputConfig = {
  allowedOutputCounts: number[];
  allowedResolutions: ImageGenerationResolutionKey[];
  defaultOutputCount: number;
  defaultResolution: ImageGenerationResolutionKey;
  maxLongEdgeByResolution: Record<ImageGenerationResolutionKey, number>;
};

const imageGenerationReferenceDecisionSchema = z.object({
  intent: z.enum(['new_image', 'edit_latest_image']),
  useLatestGeneratedImage: z.boolean(),
  reason: z.string(),
});

type ImageGenerationReferenceDecision = z.infer<typeof imageGenerationReferenceDecisionSchema>;

const defaultOutputConfig: ImageGenerationOutputConfig = {
  allowedOutputCounts: [1, 2, 3, 4],
  allowedResolutions: ['2K', '4K'],
  defaultOutputCount: 1,
  defaultResolution: '2K',
  maxLongEdgeByResolution: {
    '1K': 1024,
    '2K': 2048,
    '4K': 4096,
  },
};

const imageGenerationModeSchemas: Record<string, ImageGenerationModeSchema> = {
  dialog: {
    key: 'dialog',
    title: '对话生图',
    outputConfig: defaultOutputConfig,
    referenceGroups: [{ key: 'reference', label: '参考图', maxCount: 8 }],
    requiresPrompt: true,
  },
  detail: {
    key: 'detail',
    title: '详情图生成',
    outputConfig: defaultOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: '描述详情图需求，例如：整体高级、文字少一点，适合淘宝详情页',
    generationPrompt: [
      '以产品图为核心主体生成电商详情页素材，保持产品外观、结构、颜色、材质、品牌元素和关键卖点准确。',
      '可参考参考图的风格、光影、构图、场景氛围和视觉层级，但不要改变产品本身。',
      '画面需要干净高级，适合商品详情页展示，主体清晰，背景和道具服务于产品表达。',
      '不要生成错误文字、乱码文字、额外 logo 或与产品无关的主体。',
    ].join(''),
    referenceGroups: [
      { key: 'product', label: '产品图', maxCount: 3, required: true },
      { key: 'reference', label: '参考图', maxCount: 10 },
    ],
  },
  outfit: {
    key: 'outfit',
    title: '换装',
    outputConfig: defaultOutputConfig,
    promptHint: '让 图一 的模特穿上 图二 的衣服，AI 自动出图。',
    generationPrompt: [
      '以图一中的模特为主体，保持模特的脸部身份、发型、身材比例、姿势、背景和整体构图不变。',
      '将图二中的服装准确穿到图一模特身上，保留服装的款式、颜色、材质、纹理、图案和细节。',
      '服装需要自然贴合人体姿态，边缘干净，光影、透视和褶皱与原图一致。',
      '不要改变模特身份，不要生成多余人物，不要改变服装设计。',
    ].join(''),
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'clothes', label: '图片', required: true },
    ],
  },
  'model-views': {
    key: 'model-views',
    title: '模特三视图',
    outputConfig: defaultOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: '为 图一 的模特生成正面 / 45 度侧面 / 背面三视图拼接图，可参考服装正反面和背景。',
    generationPrompt: [
      '以图一中的模特为主体，生成正面、45 度侧面和背面三视图拼接图。',
      '保持同一模特身份、脸部特征、身材比例、发型和整体造型一致。',
      '如提供服装正面、服装背面或背景参考，需要准确参考对应服装结构、颜色、材质、图案和背景氛围。',
      '三视图需要排列清晰，姿态自然，光影统一，服装和人体比例合理。',
      '不要生成多余人物，不要混淆正反面，不要改变模特身份。',
    ].join(''),
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
    outputConfig: defaultOutputConfig,
    outputCountGroupKey: 'pose',
    outputCountStrategy: 'matchReferenceGroup',
    promptHint: '让 图一 的主体摆出 图二 的姿势。',
    generationPrompt: [
      '第一张参考图是主体图，只用于提供需要被保留的主体身份、外观、服装、材质、颜色和整体视觉特征。',
      '第二张及后续参考图是姿势图，只用于提供姿势、肢体动作、身体朝向、动态节奏和重心参考。',
      '最终结果必须是第一张参考图中的主体摆出第二张参考图中的姿势。',
      '不要把第二张参考图中的主体身份、外观、服装或背景迁移到最终结果中。',
      '姿势变化需要符合人体或主体结构，比例正确，重心自然，边缘干净。',
      '不要改变第一张主体的身份，不要替换服装，不要生成多余人物或错误肢体。',
    ].join(''),
    referenceGroups: [
      { key: 'subject', label: '主体', maxCount: 1, required: true },
      { key: 'pose', label: '姿势', required: true },
    ],
  },
  upscale: {
    key: 'upscale',
    title: '高清放大',
    outputConfig: defaultOutputConfig,
    outputCountStrategy: 'matchUploadedImages',
    promptHint: '把 图一 放大变清晰。',
    generationPrompt: [
      '对图一进行高清放大和清晰度增强，保持原图内容、构图、主体身份、颜色、材质和风格不变。',
      '提升细节质感、边缘清晰度、纹理表现和整体锐度，同时减少噪点、模糊、压缩痕迹和低清晰度问题。',
      '不要重绘成不同画面，不要改变主体形态、背景、服装、脸部身份或文字内容。',
    ].join(''),
    referenceGroups: [{ key: 'source', label: '原图', required: true }],
  },
  cutout: {
    key: 'cutout',
    title: '图片抠图',
    promptHint: '把 图一 的背景去掉，按所选底色输出。',
    outputCountStrategy: 'matchUploadedImages',
    generationPrompt: [
      '对图一进行主体抠图，准确保留前景主体、边缘细节、发丝、透明材质和细小结构。',
      '移除背景并输出干净主体，边缘自然，不残留背景色块、杂边、阴影污渍或多余物体。',
      '根据用户选择的输出底色生成结果，保持主体原始颜色、材质、光影和比例，不要改变主体造型。',
    ].join(''),
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
    outputCountStrategy: 'fixedOne',
    generationPrompt: [
      '以图一中的主体为准，保持主体身份、轮廓、颜色、材质、服装、姿态和细节不变。',
      '将图一背景替换为图二所体现的背景风格、场景氛围、光影方向、色调和空间关系。',
      '主体与新背景需要自然融合，边缘干净，透视、阴影和环境光一致。',
      '不要改变主体，不要生成多余主体，不要让背景遮挡主体关键区域。',
    ].join(''),
    referenceGroups: [
      { key: 'subject', label: '主体', maxCount: 1, required: true },
      { key: 'background', label: '背景', maxCount: 1, required: true },
    ],
  },
  'scene-extract': {
    key: 'scene-extract',
    title: '场景提取',
    promptHint: '从 图一 提取干净的场景素材。',
    outputCountStrategy: 'matchUploadedImages',
    generationPrompt: [
      '从图一中提取干净的场景或背景素材，尽量移除人物、商品、前景遮挡物和与场景无关的主体。',
      '保留原场景的空间结构、透视关系、光影、色调、材质和环境氛围。',
      '对被移除主体遮挡的区域进行自然补全，使场景完整、干净、可作为后续合成背景使用。',
      '不要生成新的主要人物或商品，不要改变场景风格。',
    ].join(''),
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
    outputCountStrategy: 'fixedOne',
    generationPrompt: [
      '以图一模特照片为基础，保持图一的身体、发型、服装、姿势、背景、光影和整体构图不变。',
      '将图一模特的脸部替换为图二脸部参考的身份特征，包括五官比例、脸型、神态和年龄气质。',
      '替换后的脸部需要与图一头部角度、光线、肤色、清晰度和透视自然融合。',
      '不要改变服装、身体、背景或发型，不要生成多余人物。',
    ].join(''),
    referenceGroups: [
      { key: 'model', label: '模特', maxCount: 1, required: true },
      { key: 'face', label: '脸部', maxCount: 1, required: true },
    ],
  },
  'head-swap': {
    key: 'head-swap',
    title: '智能换头',
    promptHint: '给 图一 模特随机换一个新头型。',
    outputCountStrategy: 'fixedOne',
    generationPrompt: [
      '以图一模特为基础，保持身体、服装、姿势、背景、构图和整体光影不变。',
      '需要彻底替换整个头部形象，不需要保留原脸部身份或原发型，可以使用完全不同的发型、发量、发色深浅、脸型、五官比例、眉眼鼻唇细节和整体气质。',
      '新头部与原图相比应有明显差异，避免只做轻微美化、局部修饰或相似脸替换。',
      '在明显更换头部的前提下，新头部仍需与原身体比例、头部角度、视角、光线、清晰度和服装风格自然融合。',
      '必须保持图一模特的人种、肤色范围和族裔视觉特征不变，不要跨人种转换。',
      '不要改变身体、服装、背景、姿势和构图，不要生成多余人物或明显拼接痕迹。',
    ].join(''),
    referenceGroups: [{ key: 'model', label: '模特', maxCount: 1, required: true }],
  },
  'face-swap': {
    key: 'face-swap',
    title: '智能换脸',
    promptHint: '给 图一 模特随机换一张新脸。',
    outputCountStrategy: 'fixedOne',
    generationPrompt: [
      '以图一模特为基础，保持发型、身体、服装、姿势、背景、构图和整体光影不变。',
      '需要更激进地替换脸部身份，不需要保留原脸特征，可以使用明显不同的脸型、五官比例、眉眼鼻唇细节、年龄感和神态气质，避免只做美颜、磨皮或轻微修饰。',
      '新脸与原图相比应有清晰可见的身份差异，但必须保持图一模特的人种、肤色范围和族裔视觉特征不变，不要跨人种转换。',
      '替换区域需要与原图头部角度、光线、清晰度和透视自然融合，不影响头发、服装、身体和背景。',
      '不要改变发型、整体造型、身体、服装、背景、姿势和构图，不要生成多余人物或明显拼接痕迹。',
    ].join(''),
    referenceGroups: [{ key: 'model', label: '模特', maxCount: 1, required: true }],
  },
  redraw: {
    key: 'redraw',
    title: '智能重绘',
    promptHint: '读懂 图一 的画面内容，整理成提示词后重新生成一张更干净自然的图。',
    outputCountStrategy: 'matchUploadedImages',
    generationPrompt: [
      '先解读图一的主体、场景、构图、风格、色调、光影、材质、镜头语言和主要视觉元素，整理成一段可直接用于文生图的完整提示词。',
      '再完全基于整理后的提示词生成一张新的图片，第二步生成时不要继续参照、编辑或复制原始图片。',
      '新图需要保留原图的核心语义和视觉意图，同时优化画面质量、细节、光影、比例、边缘和整体完成度。',
      '可以修正原图中的噪点、模糊、瑕疵、不自然结构和杂乱背景，但不要偏离原始主题。',
    ].join(''),
    referenceGroups: [{ key: 'reference', label: '参考图', required: true }],
  },
  'detail-enhance': {
    key: 'detail-enhance',
    title: '细节增强',
    outputConfig: defaultOutputConfig,
    outputCountStrategy: 'fixedOne',
    promptHint: '在 图一 涂抹位置上补强、修复或替换：',
    generationPrompt: [
      '以图一为基础，对用户指定或涂抹区域进行细节增强、修复或替换。',
      '未指定区域需要尽量保持不变，包括主体身份、构图、背景、光影、颜色、材质和整体风格。',
      '增强区域需要与周围内容自然融合，纹理、边缘、透视、光影和清晰度一致。',
      '不要引入无关元素，不要破坏原图主体结构。',
    ].join(''),
    referenceGroups: [{ key: 'base', label: '基础图', maxCount: 1, required: true }],
  },
  'print-extract': {
    key: 'print-extract',
    title: '印花提取',
    promptHint: '提取 图一 服装的印花，输出 PNG 和 PSD。',
    outputCountStrategy: 'matchUploadedImages',
    generationPrompt: [
      '从图一服装中提取印花图案，尽量还原印花的图形、颜色、边缘、层次、纹理和位置关系。',
      '输出应聚焦印花本身，去除服装褶皱、人体、背景、阴影和干扰元素对图案的影响。',
      '图案边缘需要干净，适合后续设计、复刻、编辑或制作为透明底素材。',
      '不要生成与原印花无关的新图案，不要改变主要图案结构。',
    ].join(''),
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
    outputCountStrategy: 'matchUploadedImages',
    generationPrompt: [
      '对图一中的人脸进行细节增强，保持人物身份、脸型、五官比例、表情、年龄气质、发型、身体、背景和构图不变。',
      '提升脸部清晰度、皮肤质感、眼睛细节、轮廓边缘和整体自然度，减少模糊、噪点、压缩痕迹和瑕疵。',
      '增强结果需要真实自然，避免过度磨皮、塑料感、五官变形或身份变化。',
      '不要改变服装、姿势、背景，不要生成多余人物。',
    ].join(''),
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

function localContentFilePathFromUrl(value: string) {
  const normalized = cleanText(value);
  return resolveLocalContentFilePathFromUrl(normalized) || null;
}

async function chatAttachmentToReferenceAsset(attachment: ChatAttachment) {
  const originalFileName = safeImageName(attachment.name, 'reference.png');
  const localFilePath = localContentFilePathFromUrl(attachment.url);
  if (localFilePath) {
    await access(localFilePath);
    return {
      filePath: localFilePath,
      mimeType: attachment.type || 'image/png',
      originalFileName,
    };
  }

  const parsed = dataUrlToBuffer(attachment.url);
  const extension = extensionForMimeType(parsed.mimeType);
  const storedFileName = `chat-image-reference-${randomBytes(8).toString('hex')}.${extension}`;
  const storedRelativePath = inputMediaRelativePath('image', storedFileName);
  const filePath = contentFilePathForRelativePath(storedRelativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, parsed.buffer);
  return {
    filePath,
    mimeType: parsed.mimeType,
    originalFileName,
  };
}

async function imageUrlForModelVision(attachment: ChatAttachment) {
  const localFilePath = localContentFilePathFromUrl(attachment.url);
  if (!localFilePath) {
    return attachment.url;
  }
  const bytes = await readFile(localFilePath);
  const mimeType = attachment.type || 'image/png';
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function latestGeneratedImageAttachment(input: ChatCapabilityExecutionInput) {
  for (const message of [...input.history].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }
    const imageAttachment = (message.attachments || [])
      .filter((attachment) => attachment.kind === 'image' && attachment.url && attachment.url.startsWith('/files/'))
      .at(-1);
    if (imageAttachment) {
      return imageAttachment;
    }
  }
  return null;
}

function cleanText(value: string | undefined | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function numericValue(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundCreditCost(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

function parsePngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24
    || buffer.readUInt32BE(0) !== 0x89504e47
    || buffer.readUInt32BE(4) !== 0x0d0a1a0a
    || buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (offset + 2 > buffer.length) {
      return null;
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebpDimensions(buffer: Buffer) {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    };
  }
  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function imageDimensions(buffer: Buffer, mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase();
  const dimensions = normalizedMimeType.includes('png')
    ? parsePngDimensions(buffer)
    : normalizedMimeType.includes('jpeg') || normalizedMimeType.includes('jpg')
      ? parseJpegDimensions(buffer)
      : normalizedMimeType.includes('webp')
        ? parseWebpDimensions(buffer)
        : parsePngDimensions(buffer) || parseJpegDimensions(buffer) || parseWebpDimensions(buffer);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return null;
  }
  return dimensions;
}

function imageCreditsPerRequest(modelConfig: AiModelConfig) {
  const settings = modelConfig.settings && typeof modelConfig.settings === 'object' && !Array.isArray(modelConfig.settings)
    ? modelConfig.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object' && !Array.isArray(settings.billing)
    ? settings.billing as Record<string, unknown>
    : {};
  return Math.max(0, numericValue(billing.creditsPerRequest, numericValue(billing.perRequestUsd, 0)));
}

function imageGenerationCreditCost(modelConfig: AiModelConfig, generatedCount: number) {
  return roundCreditCost(imageCreditsPerRequest(modelConfig) * Math.max(0, generatedCount));
}

function assertSufficientImageGenerationCredits(input: {
  modelConfig: AiModelConfig;
  outputCount: number;
  userId: string;
}) {
  assertSufficientStepCredits({
    userId: input.userId,
    requiredCredits: imageGenerationCreditCost(input.modelConfig, input.outputCount),
    step: 'image_generation',
    stepLabel: '图片生成',
  });
}

function imageGenerationFailureMessage(error: unknown) {
  if (isUpstreamModelError(error, 'provider_insufficient_balance')) {
    return '生成失败，积分不足';
  }
  return error instanceof Error ? error.message : String(error || '图片生成失败');
}

function accumulatedImageGenerationCreditCost(input: ChatCapabilityExecutionInput) {
  return Math.max(0, numericValue(input.capabilityContext?.imageGeneration?.accumulatedCreditCost, 0));
}

function modeSchemaOf(input: ChatCapabilityExecutionInput) {
  const modeKey = cleanText(input.capabilityContext?.imageGeneration?.modeKey) || 'dialog';
  return imageGenerationModeSchemas[modeKey] || imageGenerationModeSchemas.dialog;
}

export function expectedImageGenerationOutputCount(input: {
  attachments: ChatAttachment[];
  capabilityContext?: ChatCapabilityExecutionInput['capabilityContext'];
}) {
  const modeSchema = modeSchemaOf(input as ChatCapabilityExecutionInput);
  const outputConfig = imageGenerationOutputConfigOf(modeSchema);
  if (modeSchema.outputCountStrategy === 'fixedOne') {
    return 1;
  }
  if (modeSchema.outputCountStrategy === 'matchUploadedImages') {
    return Math.max(1, input.attachments.filter((attachment) => attachment.kind === 'image').length);
  }
  if (modeSchema.outputCountStrategy === 'matchReferenceGroup') {
    const targetGroup = input.capabilityContext?.imageGeneration?.referenceGroups
      ?.find((group) => group.key === modeSchema.outputCountGroupKey);
    return Math.max(1, targetGroup?.attachmentIds?.length || 0);
  }
  const requestedCount = Number(input.capabilityContext?.imageGeneration?.outputCount);
  if (!Number.isFinite(requestedCount)) {
    return outputConfig.defaultOutputCount;
  }
  const normalizedCount = Math.max(1, Math.floor(requestedCount));
  return outputConfig.allowedOutputCounts.includes(normalizedCount)
    ? normalizedCount
    : outputConfig.defaultOutputCount;
}

function imageModelSupportsCustomResolution(modelConfig: AiModelConfig) {
  const settings = modelConfig.settings && typeof modelConfig.settings === 'object'
    ? modelConfig.settings
    : {};
  const imageGeneration = settings.imageGeneration && typeof settings.imageGeneration === 'object'
    ? settings.imageGeneration as Record<string, unknown>
    : {};
  return imageGeneration.supportsCustomResolution === true
    || (
      modelConfig.provider === 'google-gemini-images'
      && ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'].includes(modelConfig.model.replace(/^models\//, ''))
    );
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

function referenceAttachmentsByGroup(
  input: ChatCapabilityExecutionInput,
  groups: ResolvedImageGenerationReferenceGroup[],
) {
  const imageAttachments = input.attachments.filter((attachment) => attachment.kind === 'image' && attachment.url);
  const attachmentsById = new Map(imageAttachments.map((attachment) => [attachment.id, attachment]));
  return new Map(groups.map((group) => [
    group.key,
    group.attachmentIds.flatMap((attachmentId) => {
      const attachment = attachmentsById.get(attachmentId);
      return attachment ? [attachment] : [];
    }),
  ]));
}

function imageSequenceLabel(index: number) {
  const labels = ['图一', '图二', '图三', '图四', '图五', '图六', '图七', '图八'];
  return labels[index] || `图${index + 1}`;
}

function referenceImageSequenceSummary(groups: ResolvedImageGenerationReferenceGroup[]) {
  let index = 0;
  const parts = groups.flatMap((group) => group.attachmentIds.map(() => {
    const label = imageSequenceLabel(index);
    index += 1;
    return `${label}=${group.label}`;
  }));
  return parts.join('；');
}

async function describeRedrawImage(input: {
  attachment: ChatAttachment;
  executionInput: ChatCapabilityExecutionInput;
  modeSchema: ImageGenerationModeSchema;
  userPrompt: string;
}) {
  const imageUrl = await imageUrlForModelVision(input.attachment);
  return askConfiguredModelWithMessages(input.executionInput.modelConfig, [
    {
      role: 'system',
      content: [
        '你是电商和视觉设计场景中的图片反推提示词专家。',
        '你的任务是阅读用户提供的图片，把它转换成一段可以直接用于文生图的完整提示词。',
        '只输出最终提示词，不要输出解释、标题、编号、Markdown 或 JSON。',
        '提示词需要覆盖主体、场景、构图、镜头、材质、光影、色彩、风格、细节质量和必要的负面约束。',
        '不要要求后续图片模型参考、编辑、复制或保持原图；第二步会完全基于你输出的文字重新生成新图片。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `当前功能：${input.modeSchema.title}`,
            `业务要求：${input.modeSchema.generationPrompt || input.modeSchema.promptHint || ''}`,
            input.userPrompt ? `用户补充：${input.userPrompt}` : '',
            '请根据这张图片生成一段完整、可执行的文生图提示词。',
          ].filter(Boolean).join('\n'),
        },
        {
          type: 'image_url',
          image_url: { url: imageUrl },
        },
      ],
    },
  ], { temperature: 0.2 });
}

async function decideImageGenerationReference(input: {
  executionInput: ChatCapabilityExecutionInput;
  modeSchema: ImageGenerationModeSchema;
  userPrompt: string;
  latestGeneratedImage?: ChatAttachment | null;
}) {
  if (input.modeSchema.key !== 'dialog' || !input.latestGeneratedImage) {
    return null;
  }

  const parser = StructuredOutputParser.fromZodSchema(imageGenerationReferenceDecisionSchema);
  const recentHistory = input.executionInput.history.slice(-8).map((message) => ({
    role: message.role,
    content: cleanText(message.content).slice(0, 500),
    imageCount: (message.attachments || []).filter((attachment) => attachment.kind === 'image').length,
  }));
  const response = await askConfiguredModelWithMessages(input.executionInput.modelConfig, [
    {
      role: 'system',
      content: [
        'You are an image-generation orchestration agent.',
        'Decide whether the current user request should create a completely new image or edit the latest generated image in this conversation.',
        'Use semantic understanding and conversation context. Do not rely on hard-coded keywords or any single language.',
        'Choose edit_latest_image only when the user is referring to, modifying, improving, continuing, or asking about the existing generated image.',
        'Choose new_image when the user gives a standalone image request or starts a different scene, subject, or concept.',
        parser.getFormatInstructions(),
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        mode: input.modeSchema.title,
        currentUserRequest: input.userPrompt,
        recentConversation: recentHistory,
        latestGeneratedImage: {
          name: input.latestGeneratedImage.name,
          type: input.latestGeneratedImage.type,
        },
      }),
    },
  ], { temperature: 0 });
  const decision = await parser.parse(response);
  return decision.useLatestGeneratedImage && decision.intent === 'edit_latest_image'
    ? decision
    : null;
}

function buildImageGenerationPrompt(
  input: ChatCapabilityExecutionInput,
  modeSchema: ImageGenerationModeSchema,
  groups: ResolvedImageGenerationReferenceGroup[],
  options?: {
    referenceDecision?: ImageGenerationReferenceDecision | null;
    usePromptAspectRatio?: boolean;
  },
) {
  const context = input.capabilityContext?.imageGeneration;
  const modeTitle = cleanText(context?.modeTitle) || modeSchema.title;
  const userPrompt = cleanText(context?.promptText || input.content);
  const generationPrompt = cleanText(modeSchema.generationPrompt || modeSchema.promptHint || context?.promptHint);
  const outputBackground = context?.outputBackground;
  const aspectRatio = cleanText(context?.aspectRatio);
  const outputFormatSummary = modeSchema.generationOptions?.businessOutputFormats?.length
    ? `输出格式：${modeSchema.generationOptions.businessOutputFormats.join(' + ')}`
    : '';
  const aspectRatioSummary = options?.usePromptAspectRatio && aspectRatio && aspectRatio !== 'auto'
    ? `画面比例：尽量按照 ${aspectRatio} 构图；最终画面应明显呈现 ${aspectRatio} 的宽高比例，不要使用默认横图或方图构图。`
    : '';
  const groupSummary = groups
    .filter((group) => group.attachmentIds.length)
    .map((group) => `${group.label}：${group.attachmentIds.length} 张`)
    .join('；');
  const referenceSequenceSummary = referenceImageSequenceSummary(groups);
  const outputBackgroundSummary = modeSchema.key === 'cutout' && outputBackground
    ? outputBackground === 'transparent'
      ? '输出底色：透明背景，保留 alpha 通道，主体外区域必须透明，适合继续合成和入库。'
      : outputBackground === 'white'
        ? '输出底色：白底，主体外区域使用纯白背景，适合电商主图、目录图和快审稿。'
        : '输出底色：黑底，主体外区域使用纯黑背景，适合暗场氛围、光效测试和封面图。'
    : '';
  const referenceDecisionSummary = options?.referenceDecision
    ? '连续对话约束：基于上一张生成图进行修改，尽量保持原图主体、构图、身份特征和整体风格，只改变用户本轮明确要求调整的部分。'
    : '';
  const parts = [
    modeTitle ? `当前生图模式：${modeTitle}` : '',
    generationPrompt ? `业务要求：${generationPrompt}` : '',
    referenceDecisionSummary,
    outputBackgroundSummary,
    outputFormatSummary ? `业务输出：${outputFormatSummary}` : '',
    aspectRatioSummary,
    userPrompt ? `用户补充：${userPrompt}` : '',
    groupSummary ? `参考图分组：${groupSummary}` : '',
    referenceSequenceSummary ? `参考图顺序：${referenceSequenceSummary}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

function generationOptionsOf(
  modeSchema: ImageGenerationModeSchema,
  context: ChatCapabilityExecutionInput['capabilityContext'],
) {
  const outputBackground = context?.imageGeneration?.outputBackground;
  if (modeSchema.key !== 'cutout') {
    return modeSchema.generationOptions;
  }
  if (outputBackground === 'transparent') {
    return {
      ...modeSchema.generationOptions,
      background: 'transparent' as const,
      outputFormat: 'png' as const,
    };
  }
  if (outputBackground === 'white' || outputBackground === 'black') {
    return {
      ...modeSchema.generationOptions,
      background: 'opaque' as const,
      outputFormat: 'png' as const,
    };
  }
  return modeSchema.generationOptions;
}

function imageGenerationOutputConfigOf(modeSchema: ImageGenerationModeSchema) {
  return modeSchema.outputConfig || defaultOutputConfig;
}

function outputCountOf(
  input: ChatCapabilityExecutionInput,
  modeSchema: ImageGenerationModeSchema,
  referenceAttachments: ChatAttachment[],
) {
  if (modeSchema.outputCountStrategy === 'fixedOne') {
    return 1;
  }
  const outputConfig = imageGenerationOutputConfigOf(modeSchema);
  if (modeSchema.outputCountStrategy === 'matchUploadedImages') {
    const imageCount = referenceAttachments.filter((attachment) => attachment.kind === 'image').length;
    return Math.max(1, imageCount || 1);
  }
  if (modeSchema.outputCountStrategy === 'matchReferenceGroup') {
    const targetGroup = input.capabilityContext?.imageGeneration?.referenceGroups
      ?.find((group) => group.key === modeSchema.outputCountGroupKey);
    return Math.max(1, targetGroup?.attachmentIds?.length || 0);
  }
  const requestedCount = Number(input.capabilityContext?.imageGeneration?.outputCount);
  if (!Number.isFinite(requestedCount)) {
    return outputConfig.defaultOutputCount;
  }
  const normalizedCount = Math.max(1, Math.floor(requestedCount));
  return outputConfig.allowedOutputCounts.includes(normalizedCount)
    ? normalizedCount
    : outputConfig.defaultOutputCount;
}

function parseOutputSize(value: string | undefined) {
  const normalized = cleanText(value).replace(/\s*x\s*/gi, 'x');
  if (!normalized) {
    return null;
  }
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(normalized);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    width,
    height,
  };
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

const seedreamOutputSizes: Record<ImageGenerationResolutionKey, Record<string, string>> = {
  '1K': {
    auto: '1024x1024',
    '21:9': '1568x672',
    '16:9': '1312x736',
    '3:2': '1248x832',
    '4:3': '1152x864',
    '1:1': '1024x1024',
    '3:4': '864x1152',
    '2:3': '832x1248',
    '9:16': '736x1312',
  },
  '2K': {
    auto: '2048x2048',
    '21:9': '3136x1344',
    '16:9': '2848x1600',
    '3:2': '2496x1664',
    '4:3': '2304x1728',
    '1:1': '2048x2048',
    '3:4': '1728x2304',
    '2:3': '1664x2496',
    '9:16': '1600x2848',
  },
  '4K': {
    auto: '4096x4096',
    '21:9': '6240x2656',
    '16:9': '5504x3040',
    '3:2': '4992x3328',
    '4:3': '4704x3520',
    '1:1': '4096x4096',
    '3:4': '3520x4704',
    '2:3': '3328x4992',
    '9:16': '3040x5504',
  },
};
const seedreamPro2KOutputSizes: Record<string, string> = {
  auto: '2048x2048',
  '21:9': '3108x1332',
  '16:9': '2720x1530',
  '3:2': '2496x1664',
  '4:3': '2304x1728',
  '1:1': '2048x2048',
  '3:4': '1728x2304',
  '2:3': '1664x2496',
  '9:16': '1530x2720',
};

export function resolveSeedreamOutputSize(model: string, resolution: string, aspectRatio: string) {
  if (!/^doubao-seedream-5-0-/i.test(model.trim())) {
    return null;
  }
  const isPro = /^doubao-seedream-5-0-pro-/i.test(model.trim());
  const resolvedResolution: ImageGenerationResolutionKey = isPro || resolution !== '4K' ? '2K' : '4K';
  const sizes = isPro ? seedreamPro2KOutputSizes : seedreamOutputSizes[resolvedResolution];
  return {
    outputSize: sizes[aspectRatio] || sizes.auto,
    resolution: resolvedResolution,
  };
}

function normalizeOutputSize(input: ChatCapabilityExecutionInput, modeSchema: ImageGenerationModeSchema, modelConfig: AiModelConfig) {
  if (!imageModelSupportsCustomResolution(modelConfig)) {
    return {
      outputSize: undefined,
      resolution: undefined,
    };
  }
  const outputConfig = imageGenerationOutputConfigOf(modeSchema);
  const requestedResolution = cleanText(input.capabilityContext?.imageGeneration?.resolution) as ImageGenerationResolutionKey | '';
  let resolution = outputConfig.allowedResolutions.includes(requestedResolution as ImageGenerationResolutionKey)
    ? requestedResolution as ImageGenerationResolutionKey
    : outputConfig.defaultResolution;
  if (modelConfig.provider === 'google-gemini-images') {
    const normalizedModel = modelConfig.model.replace(/^models\//, '');
    if (normalizedModel === 'gemini-3.1-flash-lite-image') {
      return { outputSize: undefined, resolution: '1K' as const };
    } else if (normalizedModel === 'gemini-3.1-flash-image') {
      resolution = ['1K', '2K', '4K'].includes(requestedResolution) ? requestedResolution as ImageGenerationResolutionKey : '1K';
      return { outputSize: undefined, resolution };
    }
  }
  if (modelConfig.provider === 'volcengine-seedream') {
    const seedreamOutput = resolveSeedreamOutputSize(
      modelConfig.model,
      resolution,
      cleanText(input.capabilityContext?.imageGeneration?.aspectRatio) || 'auto',
    );
    if (seedreamOutput) {
      return seedreamOutput;
    }
  }
  const parsedSize = parseOutputSize(input.capabilityContext?.imageGeneration?.outputSize);
  if (!parsedSize) {
    return {
      outputSize: undefined,
      resolution,
    };
  }
  const limit = outputConfig.maxLongEdgeByResolution[resolution];
  const longEdge = Math.max(parsedSize.width, parsedSize.height);
  if (!Number.isFinite(limit) || limit <= 0 || longEdge <= 0) {
    return {
      outputSize: `${parsedSize.width}x${parsedSize.height}`,
      resolution,
    };
  }
  const scale = Math.min(1, limit / longEdge);
  let width = Math.max(1, Math.round(parsedSize.width * scale));
  let height = Math.max(1, Math.round(parsedSize.height * scale));
  const divisor = gcd(width, height);
  const ratioWidth = Math.max(1, Math.round(width / divisor));
  const ratioHeight = Math.max(1, Math.round(height / divisor));
  const snappedWidth = Math.max(1, ratioWidth * Math.max(1, Math.round(width / ratioWidth)));
  const snappedHeight = Math.max(1, ratioHeight * Math.max(1, Math.round(height / ratioHeight)));
  width = Math.min(limit, snappedWidth);
  height = Math.min(limit, snappedHeight);
  return {
    outputSize: `${width}x${height}`,
    resolution,
  };
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
  const supportsCustomResolution = imageModelSupportsCustomResolution(modelConfig);
  const imageAttachments = referenceAttachmentsByContext(input, groups);
  const imageAttachmentsByGroup = referenceAttachmentsByGroup(input, groups);
  const latestGeneratedImage = imageAttachments.length ? null : latestGeneratedImageAttachment(input);
  const referenceDecision = await decideImageGenerationReference({
    executionInput: input,
    modeSchema,
    userPrompt,
    latestGeneratedImage,
  });
  const prompt = buildImageGenerationPrompt(input, modeSchema, groups, {
    referenceDecision,
    usePromptAspectRatio: !supportsCustomResolution,
  });
  if (!prompt) {
    throw new Error('图片生成提示词为空');
  }

  const normalizedOutput = normalizeOutputSize(input, modeSchema, modelConfig);
  const effectiveReferenceAttachments = referenceDecision && latestGeneratedImage
    ? [latestGeneratedImage]
    : imageAttachments;
  const outputCount = outputCountOf(input, modeSchema, effectiveReferenceAttachments);
  const redrawPromptTexts = modeSchema.key === 'redraw'
    ? await Promise.all(effectiveReferenceAttachments.slice(0, outputCount).map((attachment, index) => describeRedrawImage({
      attachment,
      executionInput: input,
      modeSchema,
      userPrompt: [
        userPrompt,
        effectiveReferenceAttachments.length > 1 ? `当前处理第 ${index + 1} 张上传图片。` : '',
      ].filter(Boolean).join('\n'),
    })))
    : undefined;
  const referenceAssets = effectiveReferenceAttachments.length
    ? await Promise.all(effectiveReferenceAttachments.map(chatAttachmentToReferenceAsset))
    : [];
  let referenceAssetBatches: ImageGenerationReferenceAsset[][] | undefined;
  let referenceAssetBatchPrompts: string[] | undefined;
  if (modeSchema.key !== 'redraw' && modeSchema.outputCountStrategy === 'matchUploadedImages' && referenceAssets.length) {
    referenceAssetBatches = referenceAssets.slice(0, outputCount).map((asset) => [asset]);
  }
  if (modeSchema.key !== 'redraw' && modeSchema.outputCountStrategy === 'matchReferenceGroup' && modeSchema.outputCountGroupKey) {
    const targetAttachments = (imageAttachmentsByGroup.get(modeSchema.outputCountGroupKey) || []).slice(0, outputCount);
    const stableAttachments = groups
      .filter((group) => group.key !== modeSchema.outputCountGroupKey)
      .flatMap((group) => imageAttachmentsByGroup.get(group.key) || []);
    referenceAssetBatches = await Promise.all(targetAttachments.map(async (targetAttachment) => [
      ...(await Promise.all(stableAttachments.map(chatAttachmentToReferenceAsset))),
      await chatAttachmentToReferenceAsset(targetAttachment),
    ]));
    referenceAssetBatchPrompts = targetAttachments.map((_, index) => (
      `当前批次：使用主体参考图，并只使用第 ${index + 1} 张${modeSchema.referenceGroups.find((group) => group.key === modeSchema.outputCountGroupKey)?.label || '目标参考图'}作为姿势参考；不要参考其他姿势图。`
    ));
  }
  const sourceIdPrefix = input.conversation?.id || `chat-image-${Date.now()}`;
  return {
    generationOptions: generationOptionsOf(modeSchema, input.capabilityContext),
    modelConfig,
    modeKey: modeSchema.key,
    modeTitle: cleanText(input.capabilityContext?.imageGeneration?.modeTitle) || modeSchema.title,
    outputAspectRatio: cleanText(input.capabilityContext?.imageGeneration?.aspectRatio) || 'auto',
    outputCount,
    outputSize: normalizedOutput.outputSize,
    requestedResolution: normalizedOutput.resolution,
    prompt,
    userPrompt,
    redrawPromptTexts,
    referenceAssets,
    referenceAssetBatches,
    referenceAssetBatchPrompts,
    referenceDecision: referenceDecision || undefined,
    sourceIdPrefix,
  };
}

async function generateImageItems(input: {
  prepared: ImageGenerationPreparedInput;
  userId: string;
}): Promise<ImageGenerationProviderResult[]> {
  const { prepared, userId } = input;
  const adapter = resolveImageGenerationProviderAdapter(prepared.modelConfig);
  if (prepared.redrawPromptTexts?.length) {
    const generatedItems = await Promise.all(prepared.redrawPromptTexts.map(async (redrawPrompt, index) => {
      const results = await adapter.generate({
        background: prepared.generationOptions?.background,
        modelConfig: prepared.modelConfig,
        modeKey: prepared.modeKey,
        outputCount: 1,
        outputCompression: prepared.generationOptions?.outputCompression,
        outputFormat: prepared.generationOptions?.outputFormat,
        outputAspectRatio: prepared.outputAspectRatio,
        outputResolution: prepared.requestedResolution,
        outputSize: prepared.outputSize,
        prompt: [
          redrawPrompt,
          prepared.prompt,
          '生成方式：完全基于以上文字提示词生成新图，不要参考、编辑、复制或沿用原始上传图片。',
        ].join('\n'),
        referenceAssets: [],
        referenceDecision: prepared.referenceDecision?.intent,
        sourceIdPrefix: `${prepared.sourceIdPrefix}-redraw-${index + 1}`,
        userId,
      });
      return results[0] ? [results[0]] : [];
    }));
    return generatedItems.flat();
  }

  if (prepared.referenceAssetBatches?.length) {
    const generatedItems = await Promise.all(prepared.referenceAssetBatches.map(async (referenceAssets, index) => {
      const results = await adapter.generate({
        background: prepared.generationOptions?.background,
        modelConfig: prepared.modelConfig,
        modeKey: prepared.modeKey,
        outputCount: 1,
        outputCompression: prepared.generationOptions?.outputCompression,
        outputFormat: prepared.generationOptions?.outputFormat,
        outputAspectRatio: prepared.outputAspectRatio,
        outputResolution: prepared.requestedResolution,
        outputSize: prepared.outputSize,
        prompt: [
          prepared.prompt,
          prepared.referenceAssetBatchPrompts?.[index]
            || `当前批次：只处理本次请求中的第 ${index + 1} 张上传图片；不要参考其他上传图片。`,
        ].join('\n'),
        referenceAssets,
        referenceDecision: prepared.referenceDecision?.intent,
        sourceIdPrefix: `${prepared.sourceIdPrefix}-${index + 1}`,
        userId,
      });
      return results[0] ? [results[0]] : [];
    }));
    return generatedItems.flat();
  }

  return adapter.generate({
    background: prepared.generationOptions?.background,
    modelConfig: prepared.modelConfig,
    modeKey: prepared.modeKey,
    outputCount: prepared.outputCount,
    outputCompression: prepared.generationOptions?.outputCompression,
    outputFormat: prepared.generationOptions?.outputFormat,
    outputAspectRatio: prepared.outputAspectRatio,
    outputResolution: prepared.requestedResolution,
    outputSize: prepared.outputSize,
    prompt: prepared.prompt,
    referenceAssets: prepared.referenceAssets,
    referenceDecision: prepared.referenceDecision?.intent,
    sourceIdPrefix: prepared.sourceIdPrefix,
    userId,
  });
}

async function persistGeneratedImageAttachments(input: {
  generatedItems: ImageGenerationProviderResult[];
  outputCount: number;
  prepared: ImageGenerationPreparedInput;
  userId: string;
  conversationId?: string;
}) {
  const { conversationId, generatedItems, outputCount, prepared, userId } = input;
  const assistantAttachments = await Promise.all(generatedItems.map((generated, index) => (
    persistGeneratedImageAttachment({ conversationId, generated, index, outputCount, prepared, userId })
  )));
  return assistantAttachments;
}

async function persistGeneratedImageAttachment(input: {
  conversationId?: string;
  generated: ImageGenerationProviderResult;
  index: number;
  outputCount: number;
  prepared: ImageGenerationPreparedInput;
  slotIndex?: number;
  userId: string;
}) {
  const { conversationId, generated, index, outputCount, prepared, userId } = input;
  const slotIndex = input.slotIndex ?? index;
  const extension = extensionForMimeType(generated.mimeType);
  const storedFileName = `chat-generated-image-${randomBytes(8).toString('hex')}.${extension}`;
  const storedRelativePath = generatedMediaRelativePath('image', storedFileName);
  const filePath = contentFilePathForRelativePath(storedRelativePath);
  const dimensions = imageDimensions(generated.buffer, generated.mimeType);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, generated.buffer);
  const fileUrl = fileUrlFor(storedRelativePath);
  await createGeneratedImageWorkAsset({
    userId,
    buffer: generated.buffer,
    mimeType: generated.mimeType,
    storedFileName: storedRelativePath,
    filePath,
    fileUrl,
    originalFileName: outputCount > 1 ? `generated-image-${slotIndex + 1}.${extension}` : `generated-image.${extension}`,
    provider: prepared.modelConfig.provider,
    model: prepared.modelConfig.model,
    mode: prepared.modeKey,
    modeTitle: prepared.modeTitle,
    prompt: prepared.userPrompt || prepared.prompt,
    conversationId,
    slotIndex,
    ...(dimensions ? dimensions : {}),
  });
  return {
    id: randomBytes(8).toString('hex'),
    kind: 'image' as const,
    name: outputCount > 1 ? `generated-image-${slotIndex + 1}.${extension}` : `generated-image.${extension}`,
    type: generated.mimeType,
    size: generated.buffer.byteLength,
    url: fileUrl,
    ...(dimensions ? dimensions : {}),
    imageGenerationSlotIndex: slotIndex,
  };
}

async function generateAndPersistImageAttachments(input: {
  prepared: ImageGenerationPreparedInput;
  userId: string;
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void | Promise<void>;
}) {
  const { prepared, userId, onAttachmentsChange } = input;
  const persistedAttachments: ChatAttachment[] = [];
  const imageGenerationFailures: ChatImageGenerationFailure[] = [];
  const sortedPersistedAttachments = () => [...persistedAttachments].sort((left, right) => (
    (left.imageGenerationSlotIndex ?? 0) - (right.imageGenerationSlotIndex ?? 0)
  ));
  const sortedFailures = () => [...imageGenerationFailures].sort((left, right) => left.slotIndex - right.slotIndex);

  async function persistResults(results: ImageGenerationProviderResult[], slotStartIndex: number) {
    if (!results.length) {
      throw new Error('图片模型未返回图片');
    }
    const attachments = await Promise.all(results.map((generated, index) => (
      persistGeneratedImageAttachment({
        generated,
        index: slotStartIndex + index,
        outputCount: prepared.outputCount,
        prepared,
        slotIndex: slotStartIndex + index,
        userId,
        conversationId: prepared.sourceIdPrefix,
      })
    )));
    persistedAttachments.push(...attachments);
    if (attachments.length) {
      await onAttachmentsChange?.(sortedPersistedAttachments());
    }
  }

  function collectSettledGenerationFailures(results: PromiseSettledResult<unknown>[]) {
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        return;
      }
      imageGenerationFailures.push({
        slotIndex: index,
        message: imageGenerationFailureMessage(result.reason),
      });
    });
  }

  const adapter = resolveImageGenerationProviderAdapter(prepared.modelConfig);
  if (prepared.redrawPromptTexts?.length) {
    const results = await Promise.allSettled(prepared.redrawPromptTexts.map(async (redrawPrompt, index) => {
      const results = await adapter.generate({
        background: prepared.generationOptions?.background,
        modelConfig: prepared.modelConfig,
        modeKey: prepared.modeKey,
        outputCount: 1,
        outputCompression: prepared.generationOptions?.outputCompression,
        outputFormat: prepared.generationOptions?.outputFormat,
        outputAspectRatio: prepared.outputAspectRatio,
        outputResolution: prepared.requestedResolution,
        outputSize: prepared.outputSize,
        prompt: [
          redrawPrompt,
          prepared.prompt,
          '生成方式：完全基于以上文字提示词生成新图，不要参考、编辑、复制或沿用原始上传图片。',
        ].join('\n'),
        referenceAssets: [],
        referenceDecision: prepared.referenceDecision?.intent,
        sourceIdPrefix: `${prepared.sourceIdPrefix}-redraw-${index + 1}`,
        userId,
      });
      await persistResults(results.slice(0, 1), index);
    }));
    collectSettledGenerationFailures(results);
    return {
      attachments: sortedPersistedAttachments(),
      failures: sortedFailures(),
    };
  }

  if (prepared.referenceAssetBatches?.length) {
    const results = await Promise.allSettled(prepared.referenceAssetBatches.map(async (referenceAssets, index) => {
      const results = await adapter.generate({
        background: prepared.generationOptions?.background,
        modelConfig: prepared.modelConfig,
        modeKey: prepared.modeKey,
        outputCount: 1,
        outputCompression: prepared.generationOptions?.outputCompression,
        outputFormat: prepared.generationOptions?.outputFormat,
        outputAspectRatio: prepared.outputAspectRatio,
        outputResolution: prepared.requestedResolution,
        outputSize: prepared.outputSize,
        prompt: [
          prepared.prompt,
          prepared.referenceAssetBatchPrompts?.[index]
            || `当前批次：只处理本次请求中的第 ${index + 1} 张上传图片；不要参考其他上传图片。`,
        ].join('\n'),
        referenceAssets,
        referenceDecision: prepared.referenceDecision?.intent,
        sourceIdPrefix: `${prepared.sourceIdPrefix}-${index + 1}`,
        userId,
      });
      await persistResults(results.slice(0, 1), index);
    }));
    collectSettledGenerationFailures(results);
    return {
      attachments: sortedPersistedAttachments(),
      failures: sortedFailures(),
    };
  }

  await persistResults(await adapter.generate({
    background: prepared.generationOptions?.background,
    modelConfig: prepared.modelConfig,
    modeKey: prepared.modeKey,
    outputCount: prepared.outputCount,
    outputCompression: prepared.generationOptions?.outputCompression,
    outputFormat: prepared.generationOptions?.outputFormat,
    outputAspectRatio: prepared.outputAspectRatio,
    outputResolution: prepared.requestedResolution,
    outputSize: prepared.outputSize,
    prompt: prepared.prompt,
    referenceAssets: prepared.referenceAssets,
    referenceDecision: prepared.referenceDecision?.intent,
    sourceIdPrefix: prepared.sourceIdPrefix,
    userId,
  }), 0);

  return {
    attachments: sortedPersistedAttachments(),
    failures: sortedFailures(),
  };
}

async function runPreparedImageGeneration(input: ChatCapabilityExecutionInput, prepared: ImageGenerationPreparedInput) {
  const generatedItems = await generateImageItems({
    prepared,
    userId: input.userId,
  });
  return {
    assistantAttachments: await persistGeneratedImageAttachments({
      generatedItems,
      outputCount: prepared.outputCount,
      prepared,
      userId: input.userId,
      conversationId: input.conversation?.id,
    }),
    modelConfig: prepared.modelConfig,
  };
}

export async function runImageGenerationWorkflow(input: ChatCapabilityExecutionInput) {
  if (input.onImageGenerationAttachmentsChange) {
    const prepared = await prepareImageGeneration(input);
    assertSufficientImageGenerationCredits({
      modelConfig: prepared.modelConfig,
      outputCount: prepared.outputCount,
      userId: input.userId,
    });
    const assistantAttachments = await generateAndPersistImageAttachments({
      prepared,
      userId: input.userId,
      onAttachmentsChange: input.onImageGenerationAttachmentsChange,
    });
    const failureCount = assistantAttachments.failures.length;
    return {
      assistantAttachments: assistantAttachments.attachments,
      imageGenerationFailures: assistantAttachments.failures,
      creditCost: roundCreditCost(
        accumulatedImageGenerationCreditCost(input)
        + imageGenerationCreditCost(prepared.modelConfig, assistantAttachments.attachments.length),
      ),
      assistantContent: imageGenerationAssistantContent({
        attachmentsCount: assistantAttachments.attachments.length,
        failures: assistantAttachments.failures,
        modelConfig: prepared.modelConfig,
      }),
    };
  }

  const prepared = await prepareImageGeneration(input);
  assertSufficientImageGenerationCredits({
    modelConfig: prepared.modelConfig,
    outputCount: prepared.outputCount,
    userId: input.userId,
  });
  const result = await runPreparedImageGeneration(input, prepared);
  return {
    assistantAttachments: result.assistantAttachments,
    creditCost: roundCreditCost(
      accumulatedImageGenerationCreditCost(input)
      + imageGenerationCreditCost(result.modelConfig, result.assistantAttachments.length),
    ),
    assistantContent: `已使用 ${result.modelConfig.name} / ${result.modelConfig.model} 生成 ${result.assistantAttachments.length} 张图片。`,
  };
}

function imageGenerationAssistantContent(input: {
  attachmentsCount: number;
  failures: ChatImageGenerationFailure[];
  modelConfig: AiModelConfig;
}) {
  const failureCount = input.failures.length;
  if (failureCount && !input.attachmentsCount) {
    const failureMessages = new Set(input.failures.map((failure) => failure.message));
    if (failureMessages.size === 1) {
      return input.failures[0]?.message || '图片生成失败';
    }
  }
  return failureCount
    ? `已使用 ${input.modelConfig.name} / ${input.modelConfig.model} 生成 ${input.attachmentsCount} 张图片，${failureCount} 张失败。`
    : `已使用 ${input.modelConfig.name} / ${input.modelConfig.model} 生成 ${input.attachmentsCount} 张图片。`;
}
