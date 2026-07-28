import { z } from 'zod';
import type {
  CreativeCapabilityDefinition,
  CreativeCapabilityExecutor,
  CreativeCapabilityField,
  CreativeCapabilitySummary,
} from './creative-capability.types.js';

const globalParamsSchema = z.object({
  modelConfigId: z.string().trim().min(1).optional(),
  resolution: z.string().trim().min(1).optional(),
  aspectRatio: z.string().trim().min(1).optional(),
  outputCount: z.number().int().min(1).max(4).optional(),
  duration: z.string().trim().min(1).optional(),
  generateAudio: z.boolean().optional(),
}).passthrough();

const rowParamsSchema = z.object({
  prompt: z.string().optional(),
  referenceAssetIds: z.array(z.string().trim().min(1)).optional(),
  referenceGroups: z.record(z.string(), z.array(z.string().trim().min(1))).optional(),
  referenceImageIds: z.array(z.string().trim().min(1)).optional(),
  referenceVideoIds: z.array(z.string().trim().min(1)).optional(),
  referenceAudioIds: z.array(z.string().trim().min(1)).optional(),
  sourceAssetId: z.string().trim().min(1).optional(),
}).passthrough();

const imageGlobalFields: CreativeCapabilityField[] = [
  { key: 'modelConfigId', label: '模型', valueType: 'string', overridable: true },
  { key: 'resolution', label: '分辨率', valueType: 'string', overridable: true },
  { key: 'aspectRatio', label: '画面比例', valueType: 'string', overridable: true },
  { key: 'outputCount', label: '出图张数', valueType: 'number', overridable: true },
];

const videoGlobalFields: CreativeCapabilityField[] = [
  { key: 'modelConfigId', label: '模型', valueType: 'string', overridable: true },
  { key: 'resolution', label: '分辨率', valueType: 'string', overridable: true },
  { key: 'aspectRatio', label: '画面比例', valueType: 'string', overridable: true },
  { key: 'duration', label: '时长', valueType: 'string', overridable: true },
  { key: 'generateAudio', label: '生成音频', valueType: 'boolean', overridable: true },
];

const videoRowFields: CreativeCapabilityField[] = [
  { key: 'prompt', label: '提示词', valueType: 'string' },
  { key: 'referenceImageIds', label: '参考图', valueType: 'asset-list' },
  { key: 'referenceVideoIds', label: '参考视频', valueType: 'asset-list' },
  { key: 'referenceAudioIds', label: '参考音频', valueType: 'asset-list' },
];

const imageCapabilityRowFields: Record<string, CreativeCapabilityField[]> = {
  'image.dialog': [
    { key: 'prompt', label: '提示词', valueType: 'string', required: true },
    { key: 'referenceGroups.reference', label: '参考图', valueType: 'asset-list' },
  ],
  'image.outfit': [
    { key: 'referenceGroups.model', label: '模特', valueType: 'asset-list', required: true },
    { key: 'referenceGroups.clothes', label: '服装', valueType: 'asset-list', required: true },
    { key: 'prompt', label: '补充提示词', valueType: 'string' },
  ],
  'image.model_views': [
    { key: 'referenceGroups.model', label: '模特', valueType: 'asset-list', required: true },
    { key: 'referenceGroups.front', label: '服装正面', valueType: 'asset-list' },
    { key: 'referenceGroups.back', label: '服装背面', valueType: 'asset-list' },
    { key: 'referenceGroups.background', label: '背景', valueType: 'asset-list' },
  ],
  'image.pose_reference': [
    { key: 'referenceGroups.subject', label: '主体', valueType: 'asset-list', required: true },
    { key: 'referenceGroups.pose', label: '姿势', valueType: 'asset-list', required: true },
    { key: 'prompt', label: '补充提示词', valueType: 'string' },
  ],
  'image.upscale': [{ key: 'referenceGroups.source', label: '原图', valueType: 'asset-list', required: true }],
  'image.cutout': [{ key: 'referenceGroups.source', label: '原图', valueType: 'asset-list', required: true }],
  'image.background': [
    { key: 'referenceGroups.subject', label: '主体', valueType: 'asset-list', required: true },
    { key: 'referenceGroups.background', label: '背景', valueType: 'asset-list', required: true },
    { key: 'prompt', label: '补充提示词', valueType: 'string' },
  ],
  'image.scene_extract': [{ key: 'referenceGroups.source', label: '原图', valueType: 'asset-list', required: true }],
  'image.model_face_swap': [
    { key: 'referenceGroups.model', label: '模特', valueType: 'asset-list', required: true },
    { key: 'referenceGroups.face', label: '脸部', valueType: 'asset-list', required: true },
  ],
  'image.head_swap': [{ key: 'referenceGroups.model', label: '模特', valueType: 'asset-list', required: true }],
  'image.face_swap': [{ key: 'referenceGroups.model', label: '模特', valueType: 'asset-list', required: true }],
  'image.redraw': [
    { key: 'referenceGroups.reference', label: '参考图', valueType: 'asset-list', required: true },
    { key: 'prompt', label: '补充提示词', valueType: 'string' },
  ],
  'image.print_extract': [{ key: 'referenceGroups.clothes', label: '服装', valueType: 'asset-list', required: true }],
  'image.face_enhance': [{ key: 'referenceGroups.portrait', label: '人像', valueType: 'asset-list', required: true }],
};

const selectableImageOutputCountCapabilities = new Set(['image.dialog', 'image.outfit']);

function defineCapability(input: Pick<CreativeCapabilityDefinition, 'key' | 'label' | 'mediaKind'>) {
  const globalFields = input.mediaKind === 'image'
    ? imageGlobalFields.filter((field) => field.key !== 'outputCount' || selectableImageOutputCountCapabilities.has(input.key))
    : videoGlobalFields;
  return {
    ...input,
    schemaVersion: 1,
    globalFields,
    rowFields: input.mediaKind === 'image' ? imageCapabilityRowFields[input.key] || [] : videoRowFields,
    globalParamsSchema,
    rowParamsSchema,
  } satisfies CreativeCapabilityDefinition;
}

const capabilities = [
  defineCapability({ key: 'image.dialog', label: '对话生图', mediaKind: 'image' }),
  defineCapability({ key: 'image.outfit', label: '换装', mediaKind: 'image' }),
  defineCapability({ key: 'image.model_views', label: '模特三视图', mediaKind: 'image' }),
  defineCapability({ key: 'image.pose_reference', label: '姿势参考', mediaKind: 'image' }),
  defineCapability({ key: 'image.upscale', label: '高清放大', mediaKind: 'image' }),
  defineCapability({ key: 'image.cutout', label: '图片抠图', mediaKind: 'image' }),
  defineCapability({ key: 'image.background', label: '换背景', mediaKind: 'image' }),
  defineCapability({ key: 'image.scene_extract', label: '场景提取', mediaKind: 'image' }),
  defineCapability({ key: 'image.model_face_swap', label: '模特换脸', mediaKind: 'image' }),
  defineCapability({ key: 'image.head_swap', label: '智能换头', mediaKind: 'image' }),
  defineCapability({ key: 'image.face_swap', label: '智能换脸', mediaKind: 'image' }),
  defineCapability({ key: 'image.redraw', label: '智能重绘', mediaKind: 'image' }),
  defineCapability({ key: 'image.print_extract', label: '印花提取', mediaKind: 'image' }),
  defineCapability({ key: 'image.face_enhance', label: '脸部增强', mediaKind: 'image' }),
  defineCapability({ key: 'video.generate', label: '视频', mediaKind: 'video' }),
  defineCapability({ key: 'video.upscale', label: '视频高清放大', mediaKind: 'video' }),
  defineCapability({ key: 'video.dance_remake', label: '跳舞复刻', mediaKind: 'video' }),
  defineCapability({ key: 'video.subject_replace', label: '模特 / 商品替换', mediaKind: 'video' }),
] satisfies CreativeCapabilityDefinition[];

const definitionsByKey = new Map(capabilities.map((capability) => [capability.key, capability]));
const executorsByKey = new Map<string, CreativeCapabilityExecutor>();

export function listCreativeCapabilities(): CreativeCapabilitySummary[] {
  return capabilities.map(({ globalParamsSchema: _global, rowParamsSchema: _row, ...capability }) => capability);
}

export function getCreativeCapability(key: string) {
  return definitionsByKey.get(key);
}

export function requireCreativeCapability(key: string) {
  const capability = getCreativeCapability(key);
  if (!capability) {
    throw new Error('不支持的创作功能');
  }
  return capability;
}

export function normalizeCreativeGlobalParams(capabilityKey: string, value: unknown) {
  return requireCreativeCapability(capabilityKey).globalParamsSchema.parse(value || {});
}

export function normalizeCreativeRowParams(capabilityKey: string, value: unknown) {
  return requireCreativeCapability(capabilityKey).rowParamsSchema.parse(value || {});
}

export function mergeCreativeParams(
  capabilityKey: string,
  globalParams: Record<string, unknown>,
  rowParams: Record<string, unknown>,
) {
  return {
    ...normalizeCreativeGlobalParams(capabilityKey, globalParams),
    ...normalizeCreativeRowParams(capabilityKey, rowParams),
  };
}

export function registerCreativeCapabilityExecutor(key: string, executor: CreativeCapabilityExecutor) {
  requireCreativeCapability(key);
  executorsByKey.set(key, executor);
}

export function getCreativeCapabilityExecutor(key: string) {
  return executorsByKey.get(key);
}
