import { contentRepository } from '../content/content.repository.js';
import type { ContentAsset } from '../content/content.types.js';
import {
  expectedImageGenerationOutputCount,
  getImageGenerationModeSchema,
  runImageGenerationWorkflow,
} from '../chat/capabilities/image-generation.workflow.js';
import type { ImageGenerationWorkflowInput } from '../chat/capabilities/image-generation.workflow.js';
import type { ChatAttachment } from '../chat/chat.types.js';
import { estimateImageGenerationCredits } from '../billing/billing.service.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import { registerCreativeCapabilityExecutor } from './creative-capability.registry.js';
import type {
  CreativeCapabilityExecutionContext,
  CreativeCapabilityExecutor,
  CreativeCapabilityPreparedExecution,
} from './creative-capability.types.js';

const imageCapabilityKeys = [
  'image.dialog',
  'image.outfit',
  'image.model_views',
  'image.pose_reference',
  'image.upscale',
  'image.cutout',
  'image.background',
  'image.scene_extract',
  'image.model_face_swap',
  'image.head_swap',
  'image.face_swap',
  'image.redraw',
  'image.print_extract',
  'image.face_enhance',
] as const;

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function imageModeKey(capabilityKey: string) {
  return capabilityKey.slice('image.'.length).replace(/_/g, '-');
}

function requireModelConfig(type: AiModelConfig['type'], id?: string) {
  const configs = modelConfigRepository.list(type);
  const config = id
    ? configs.find((item) => item.id === id)
    : configs.find((item) => item.isDefault) || configs[0];
  if (!config) {
    throw new Error(type === 'image' ? '请先配置图片模型' : '请先配置语言模型');
  }
  if (!config.apiKey || !config.model || !config.baseUrl) {
    throw new Error(`模型「${config.name}」配置不完整`);
  }
  return config;
}

function modelSnapshot(config: AiModelConfig) {
  return {
    id: config.id,
    type: config.type,
    name: config.name,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    updatedAt: config.updatedAt,
  };
}

function modelIdFromSnapshot(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return stringValue((value as Record<string, unknown>).id);
}

function referenceGroupsOf(
  params: Record<string, unknown>,
  modeKey: string,
): Array<{
  key: string;
  label: string;
  required?: boolean;
  maxCount?: number;
  attachmentIds: string[];
}> {
  const schema = getImageGenerationModeSchema(modeKey);
  if (!schema) throw new Error('不支持的图片生成功能');
  const validate = (groups: Array<{
    key: string;
    label: string;
    required?: boolean;
    maxCount?: number;
    attachmentIds: string[];
  }>) => {
    groups.forEach((group) => {
      if (group.required && !group.attachmentIds.length) {
        throw new Error(`请上传${group.label}`);
      }
      if (group.maxCount && group.attachmentIds.length > group.maxCount) {
        throw new Error(`${group.label}最多上传 ${group.maxCount} 张`);
      }
    });
    return groups;
  };
  const explicit = params.referenceGroups;
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
    const record = explicit as Record<string, unknown>;
    return validate(schema.referenceGroups.map((group) => {
      const values = record[group.key];
      return {
        key: group.key,
        label: group.label,
        required: group.required,
        maxCount: group.maxCount,
        attachmentIds: Array.isArray(values) ? values.map(String) : [],
      };
    }));
  }

  const remaining = Array.isArray(params.referenceAssetIds)
    ? params.referenceAssetIds.map(String)
    : [];
  let cursor = 0;
  return validate(schema.referenceGroups.map((group, index) => {
    const isLast = index === schema.referenceGroups.length - 1;
    const count = isLast
      ? remaining.length - cursor
      : group.maxCount || (group.required ? 1 : 0);
    const attachmentIds = remaining.slice(cursor, cursor + Math.max(0, count));
    cursor += attachmentIds.length;
    return {
      key: group.key,
      label: group.label,
      required: group.required,
      maxCount: group.maxCount,
      attachmentIds,
    };
  }));
}

function requireOwnedImageAssets(userId: string, assetIds: string[]) {
  const uniqueIds = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
  return uniqueIds.map((assetId) => {
    const asset = contentRepository.findAsset(assetId);
    if (!asset || asset.userId !== userId) {
      throw new Error(`参考图片不存在或无权访问：${assetId}`);
    }
    if (!asset.mimeType.toLowerCase().startsWith('image/')) {
      throw new Error(`参考素材不是图片：${asset.name}`);
    }
    return asset;
  });
}

function attachmentOf(asset: ContentAsset): ChatAttachment {
  const width = numberValue(asset.metadata.width);
  const height = numberValue(asset.metadata.height);
  return {
    id: asset.id,
    assetId: asset.id,
    name: asset.originalFileName || asset.name,
    type: asset.mimeType,
    size: asset.fileSize,
    kind: 'image',
    url: asset.fileUrl,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
}

function workflowInput(input: {
  context: CreativeCapabilityExecutionContext;
  params: Record<string, unknown>;
  imageModelConfig: AiModelConfig;
  llmModelConfig: AiModelConfig;
}): ImageGenerationWorkflowInput {
  const modeKey = stringValue(input.params.modeKey);
  const groups = referenceGroupsOf(input.params, modeKey);
  const assets = requireOwnedImageAssets(
    input.context.userId,
    groups.flatMap((group) => group.attachmentIds),
  );
  const attachmentsById = new Map(assets.map((asset) => [asset.id, attachmentOf(asset)]));
  const attachments = groups.flatMap((group) => group.attachmentIds.flatMap((assetId) => {
    const attachment = attachmentsById.get(assetId);
    return attachment ? [attachment] : [];
  }));
  const outputCount = numberValue(input.params.outputCount);
  const outputBackground = stringValue(input.params.outputBackground);
  const normalizedOutputBackground = outputBackground === 'transparent'
    || outputBackground === 'white'
    || outputBackground === 'black'
    ? outputBackground
    : undefined;
  return {
    userId: input.context.userId,
    sourceType: input.context.sourceType,
    sourceId: input.context.sourceId,
    content: stringValue(input.params.prompt),
    modelConfig: input.llmModelConfig,
    imageModelConfig: input.imageModelConfig,
    history: [],
    attachments,
    capabilityContext: {
      imageGeneration: {
        modeKey,
        promptText: stringValue(input.params.prompt),
        resolution: stringValue(input.params.resolution) || undefined,
        aspectRatio: stringValue(input.params.aspectRatio) || undefined,
        ...(outputCount ? { outputCount } : {}),
        ...(normalizedOutputBackground
          ? { outputBackground: normalizedOutputBackground }
          : {}),
        referenceGroups: groups,
      },
    },
  };
}

function modelConfigsFromPrepared(prepared: CreativeCapabilityPreparedExecution) {
  const imageSnapshot = prepared.modelConfigSnapshot.image;
  const llmSnapshot = prepared.modelConfigSnapshot.llm;
  const imageModelConfig = requireModelConfig('image', modelIdFromSnapshot(imageSnapshot));
  const llmId = modelIdFromSnapshot(llmSnapshot);
  const llmModelConfig = llmId ? requireModelConfig('llm', llmId) : imageModelConfig;
  return { imageModelConfig, llmModelConfig };
}

function createImageExecutor(capabilityKey: string): CreativeCapabilityExecutor {
  return {
    prepare(context, params) {
      const modeKey = imageModeKey(capabilityKey);
      const modeSchema = getImageGenerationModeSchema(modeKey);
      if (!modeSchema) throw new Error('不支持的图片生成功能');
      if (modeSchema.requiresPrompt && !stringValue(params.prompt)) {
        throw new Error('请输入生图提示词');
      }
      const imageModelConfig = requireModelConfig('image', stringValue(params.modelConfigId));
      const llmModelConfig = modeKey === 'redraw'
        ? requireModelConfig('llm', stringValue(params.llmModelConfigId))
        : undefined;
      const effectiveParams: Record<string, unknown> = { ...params, modeKey, modelConfigId: imageModelConfig.id };
      if (llmModelConfig) effectiveParams.llmModelConfigId = llmModelConfig.id;
      const input = workflowInput({
        context,
        params: effectiveParams,
        imageModelConfig,
        llmModelConfig: llmModelConfig || imageModelConfig,
      });
      const outputCount = expectedImageGenerationOutputCount(input);
      return {
        effectiveParams,
        modelConfigSnapshot: {
          image: modelSnapshot(imageModelConfig),
          ...(llmModelConfig ? { llm: modelSnapshot(llmModelConfig) } : {}),
        },
        estimatedCredits: estimateImageGenerationCredits(imageModelConfig, outputCount),
      };
    },

    async execute(context, prepared) {
      const configs = modelConfigsFromPrepared(prepared);
      const result = await runImageGenerationWorkflow({
        ...workflowInput({ context, params: prepared.effectiveParams, ...configs }),
        onImageGenerationAttachmentsChange: async () => undefined,
      });
      const outputAssetIds = (result.assistantAttachments || [])
        .map((attachment) => attachment.assetId || '')
        .filter(Boolean);
      if (!outputAssetIds.length) {
        const message = result.imageGenerationFailures?.map((failure) => failure.message).join('；');
        throw new Error(message || '图片生成未返回可用结果');
      }
      return {
        outputAssetIds,
        creditCost: Number(result.creditCost || 0),
        metadata: {
          failures: result.imageGenerationFailures || [],
          requestedOutputCount: expectedImageGenerationOutputCount(
            workflowInput({ context, params: prepared.effectiveParams, ...configs }),
          ),
        },
      };
    },
  };
}

export function registerImageCreativeCapabilityExecutors() {
  imageCapabilityKeys.forEach((key) => {
    registerCreativeCapabilityExecutor(key, createImageExecutor(key));
  });
}
