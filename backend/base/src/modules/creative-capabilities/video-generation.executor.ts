import {
  estimateVideoGenerationPrice,
  estimateVideoUpscaleCredits,
} from '../billing/billing.service.js';
import { contentRepository } from '../content/content.repository.js';
import { contentService } from '../content/content.service.js';
import {
  formatDurationLabel,
  resolveConfiguredVideoOption,
  resolveConfiguredVideoProvider,
  resolveDefaultVideoModel,
  seedanceDurationSeconds,
} from '../content/internals/content-video-generation.js';
import { pollVideoEnhancementTask } from '../content/internals/content-video-enhancement.js';
import { generationResultForTask, pollRunningVideoGenerationTask } from '../content/internals/content-video-task-runtime.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import {
  danceRemakeService,
  estimateDanceRemakeAssetPrice,
} from '../video-source/dance-remake.service.js';
import { danceRemakeDefaults, normalizeDanceRemakeQuality } from '../video-source/dance-remake.config.js';
import { normalizeSeedanceVideoQuality } from '../video-source/seedance-video.config.js';
import {
  isSubjectReplaceType,
  subjectReplaceDefaults,
  type SubjectReplaceType,
} from '../video-source/subject-replace.config.js';
import { subjectReplaceService } from '../video-source/subject-replace.service.js';
import { registerCreativeCapabilityExecutor } from './creative-capability.registry.js';
import type {
  CreativeCapabilityExecutionContext,
  CreativeCapabilityExecutor,
  CreativeCapabilityPreparedExecution,
} from './creative-capability.types.js';

const VIDEO_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const VIDEO_TASK_CHECK_INTERVAL_MS = 1_000;

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
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

function snapshotModelId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return stringValue((value as Record<string, unknown>).id);
}

function requireOwnedAssets(input: {
  userId: string;
  assetIds: string[];
  mimePrefix: string;
  label: string;
}) {
  [...new Set(input.assetIds)].forEach((assetId) => {
    const asset = contentRepository.findAsset(assetId);
    if (!asset || asset.userId !== input.userId) {
      throw new Error(`所选${input.label}素材不存在或无权访问`);
    }
    if (!asset.mimeType.startsWith(input.mimePrefix)) {
      throw new Error(`所选素材不是${input.label}`);
    }
  });
}

function normalizeVideoParams(params: Record<string, unknown>, modelConfig: AiModelConfig) {
  const provider = resolveConfiguredVideoProvider(modelConfig);
  const modelId = stringValue(params.videoModelId) || modelConfig.model || provider.defaultModel;
  const option = resolveConfiguredVideoOption(provider, modelConfig, modelId);
  const duration = stringValue(params.duration) || formatDurationLabel(option.durationPolicy.defaultSeconds);
  const quality = stringValue(params.quality) || stringValue(params.resolution) || '标清 (720p)';
  const ratio = stringValue(params.ratio) || stringValue(params.aspectRatio) || '9:16';
  const referenceAudioIds = stringArray(params.referenceAudioIds);
  return {
    ...params,
    prompt: stringValue(params.prompt),
    videoModelConfigId: modelConfig.id,
    videoModelProviderId: modelConfig.provider,
    videoModelId: modelId,
    duration,
    quality,
    ratio,
    referenceImageIds: stringArray(params.referenceImageIds),
    referenceVideoIds: stringArray(params.referenceVideoIds),
    referenceAudioIds,
    generateAudio: referenceAudioIds.length > 0 || params.generateAudio !== false,
  };
}

function resolveModelForPrepared(prepared: CreativeCapabilityPreparedExecution) {
  const id = snapshotModelId(prepared.modelConfigSnapshot.video)
    || stringValue(prepared.effectiveParams.videoModelConfigId);
  const config = modelConfigRepository.find(id);
  if (!config && id.startsWith('env-')) {
    return resolveDefaultVideoModel();
  }
  if (!config || config.type !== 'video' || !config.apiKey) {
    throw new Error('批量任务使用的视频模型已删除或未配置 API Key');
  }
  return config;
}

async function waitForVideoTask(taskId: string, userId: string) {
  const deadline = Date.now() + VIDEO_TASK_TIMEOUT_MS;
  let pollingStarted = false;
  while (Date.now() < deadline) {
    const task = contentRepository.findVideoTask(taskId);
    if (!task || task.userId !== userId) {
      throw new Error('批量视频任务不存在或无权访问');
    }
    if (task.status === 'success') return task;
    if (task.status === 'failed') {
      throw new Error(task.failureReason || generationResultForTask(task)?.errorMessage || '视频生成失败');
    }
    const result = generationResultForTask(task);
    if (!pollingStarted && task.status === 'generating' && result?.jobId) {
      pollingStarted = true;
      void pollRunningVideoGenerationTask(task.id);
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_TASK_CHECK_INTERVAL_MS));
  }
  throw new Error('视频生成等待超时，任务会继续在后台轮询');
}

async function waitForVideoEnhancementTask(taskId: string, userId: string) {
  const deadline = Date.now() + VIDEO_TASK_TIMEOUT_MS;
  void pollVideoEnhancementTask(taskId);
  while (Date.now() < deadline) {
    const task = contentRepository.findVideoTask(taskId);
    if (!task || task.userId !== userId) {
      throw new Error('批量视频高清放大任务不存在或无权访问');
    }
    if (task.status === 'success') return task;
    if (task.status === 'failed') {
      throw new Error(task.failureReason || generationResultForTask(task)?.errorMessage || '视频高清放大失败');
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_TASK_CHECK_INTERVAL_MS));
  }
  throw new Error('视频高清放大等待超时，任务会继续在后台处理');
}

const videoGenerateExecutor: CreativeCapabilityExecutor = {
  prepare(context, params) {
    const prompt = stringValue(params.prompt);
    if (!prompt) throw new Error('请输入视频生成提示词');
    const requestedModelConfigId = stringValue(params.videoModelConfigId) || stringValue(params.modelConfigId);
    const modelConfig = resolveDefaultVideoModel(undefined, requestedModelConfigId || undefined);
    const effectiveParams = normalizeVideoParams(params, modelConfig);
    requireOwnedAssets({
      userId: context.userId,
      assetIds: effectiveParams.referenceImageIds,
      mimePrefix: 'image/',
      label: '参考图片',
    });
    requireOwnedAssets({
      userId: context.userId,
      assetIds: effectiveParams.referenceVideoIds,
      mimePrefix: 'video/',
      label: '参考视频',
    });
    requireOwnedAssets({
      userId: context.userId,
      assetIds: effectiveParams.referenceAudioIds,
      mimePrefix: 'audio/',
      label: '参考音频',
    });
    const provider = resolveConfiguredVideoProvider(modelConfig);
    const option = resolveConfiguredVideoOption(provider, modelConfig, effectiveParams.videoModelId);
    const durationSeconds = seedanceDurationSeconds(effectiveParams.duration, option, modelConfig.settings);
    const price = estimateVideoGenerationPrice({
      durationSeconds,
      modelId: option.id,
      modelName: option.name,
      resolution: effectiveParams.quality,
    });
    return {
      effectiveParams,
      modelConfigSnapshot: { video: modelSnapshot(modelConfig) },
      estimatedCredits: price.credits,
    };
  },

  async execute(context, prepared) {
    const params = prepared.effectiveParams;
    const modelConfig = resolveModelForPrepared(prepared);
    const task = context.generationJobId
      ? contentService.getVideoTask(context.generationJobId, context.userId)
      : await contentService.createVideoProduction({
        userId: context.userId,
        taskMode: 'video_create',
        prompt: stringValue(params.prompt),
        quality: stringValue(params.quality),
        ratio: stringValue(params.ratio),
        duration: stringValue(params.duration),
        videoModelConfigId: modelConfig.id,
        videoModelProviderId: modelConfig.provider,
        videoModelId: stringValue(params.videoModelId),
        referenceImageIds: stringArray(params.referenceImageIds),
        referenceVideoIds: stringArray(params.referenceVideoIds),
        referenceAudioIds: stringArray(params.referenceAudioIds),
        generateAudio: params.generateAudio !== false,
        billingSourceType: context.sourceType,
        billingSourceId: context.sourceId,
      });
    if (!context.generationJobId) {
      await context.onExternalJobCreated?.(task.id);
    }
    const completedTask = await waitForVideoTask(task.id, context.userId);
    const result = generationResultForTask(completedTask);
    const assetId = stringValue(result?.assetId)
      || contentRepository.listAssets({ userId: context.userId, resourceType: 'finished_video' })
        .find((asset) => asset.metadata.videoTaskId === completedTask.id)?.id
      || '';
    if (!assetId) throw new Error('视频已完成，但未找到结果资产');
    return {
      outputAssetIds: [assetId],
      creditCost: prepared.estimatedCredits,
      metadata: {
        videoTaskId: completedTask.id,
        videoUrl: completedTask.generatedVideoUrl || result?.videoUrl || '',
      },
    };
  },
};

const videoUpscaleExecutor: CreativeCapabilityExecutor = {
  prepare(context, params) {
    const [sourceAssetId] = stringArray(params.referenceVideoIds);
    if (!sourceAssetId) throw new Error('请选择视频素材');
    const sourceAsset = contentRepository.findAsset(sourceAssetId);
    if (!sourceAsset || sourceAsset.userId !== context.userId) {
      throw new Error('待放大视频素材不存在或无权访问');
    }
    if (!sourceAsset.mimeType.startsWith('video/')) {
      throw new Error('请选择视频素材进行高清放大');
    }
    return {
      effectiveParams: { referenceVideoIds: [sourceAsset.id] },
      modelConfigSnapshot: {
        videoEnhancement: { model: 'moe-aigc-enhance', provider: 'volcengine-vod', resolution: '1080p' },
      },
      estimatedCredits: estimateVideoUpscaleCredits(),
    };
  },

  async execute(context, prepared) {
    const [sourceAssetId] = stringArray(prepared.effectiveParams.referenceVideoIds);
    const task = context.generationJobId
      ? contentService.getVideoTask(context.generationJobId, context.userId)
      : await contentService.createVideoEnhancement({
        userId: context.userId,
        sourceAssetId,
        resolution: '1080p',
      });
    if (!context.generationJobId) {
      await context.onExternalJobCreated?.(task.id);
    }
    const completedTask = await waitForVideoEnhancementTask(task.id, context.userId);
    const result = generationResultForTask(completedTask);
    const assetId = stringValue(result?.assetId)
      || contentRepository.listAssets({ userId: context.userId, resourceType: 'finished_video' })
        .find((asset) => asset.metadata.videoTaskId === completedTask.id)?.id
      || '';
    if (!assetId) throw new Error('视频高清放大已完成，但未找到结果资产');
    return {
      outputAssetIds: [assetId],
      creditCost: Number(completedTask.creditCost ?? prepared.estimatedCredits),
      metadata: {
        resolution: '1080p',
        sourceAssetId,
        videoTaskId: completedTask.id,
        videoUrl: completedTask.generatedVideoUrl || result?.videoUrl || '',
      },
    };
  },
};

const videoDanceRemakeExecutor: CreativeCapabilityExecutor = {
  async prepare(context, params) {
    const mode = params.danceRemakeMode === 'enhanced' ? 'enhanced' : 'standard';
    const characterImageAssetId = stringValue(params.characterImageAssetId);
    const [referenceVideoAssetId] = stringArray(params.referenceVideoIds);
    if (!characterImageAssetId) throw new Error('请选择人物图');
    if (!referenceVideoAssetId) throw new Error('请选择参考视频');
    requireOwnedAssets({
      userId: context.userId,
      assetIds: [characterImageAssetId],
      mimePrefix: 'image/',
      label: '人物图',
    });
    requireOwnedAssets({
      userId: context.userId,
      assetIds: [referenceVideoAssetId],
      mimePrefix: 'video/',
      label: '参考视频',
    });
    const videoModelId = mode === 'standard'
      ? danceRemakeDefaults.standardModelId
      : stringValue(params.videoModelId) || danceRemakeDefaults.enhancedModelId;
    const quality = mode === 'standard'
      ? danceRemakeDefaults.standardQuality
      : normalizeDanceRemakeQuality(params.quality);
    const preserveAudio = mode === 'standard' || params.preserveAudio !== false;
    const price = await estimateDanceRemakeAssetPrice({
      filePath: contentRepository.findAsset(referenceVideoAssetId)!.filePath,
      quality,
      videoModelId,
    });
    return {
      effectiveParams: {
        characterImageAssetId,
        danceRemakeMode: mode,
        preserveAudio,
        quality,
        ratio: '9:16',
        referenceVideoIds: [referenceVideoAssetId],
        videoModelId,
      },
      modelConfigSnapshot: {
        danceRemake: { mode, quality, videoModelId },
      },
      estimatedCredits: price.credits,
    };
  },

  async execute(context, prepared) {
    const params = prepared.effectiveParams;
    const [referenceVideoAssetId] = stringArray(params.referenceVideoIds);
    const task = context.generationJobId
      ? contentService.getVideoTask(context.generationJobId, context.userId)
      : await danceRemakeService.create({
        characterImageAssetId: stringValue(params.characterImageAssetId),
        mode: params.danceRemakeMode === 'enhanced' ? 'enhanced' : 'standard',
        preserveAudio: params.preserveAudio === true,
        quality: stringValue(params.quality),
        ratio: '9:16',
        referenceVideoAssetId,
        userId: context.userId,
        videoModelId: stringValue(params.videoModelId),
      });
    if (!context.generationJobId) {
      await context.onExternalJobCreated?.(task.id);
    }
    const completedTask = await waitForVideoTask(task.id, context.userId);
    const result = generationResultForTask(completedTask);
    const assetId = stringValue(result?.assetId)
      || contentRepository.listAssets({ userId: context.userId, resourceType: 'finished_video' })
        .find((asset) => asset.metadata.videoTaskId === completedTask.id)?.id
      || '';
    if (!assetId) throw new Error('跳舞复刻已完成，但未找到结果资产');
    return {
      outputAssetIds: [assetId],
      creditCost: Number(completedTask.creditCost || 0),
      metadata: {
        danceRemakeMode: params.danceRemakeMode,
        videoTaskId: completedTask.id,
        videoUrl: completedTask.generatedVideoUrl || result?.videoUrl || '',
      },
    };
  },
};

const subjectImageFields: Record<SubjectReplaceType, string[]> = {
  background: ['subjectBackgroundImageAssetId'],
  clothing: ['subjectClothingFrontAssetId', 'subjectClothingBackAssetId'],
  face: ['subjectFaceImageAssetId'],
  model: ['subjectModelImageAssetId'],
  product: ['subjectProductImageAssetId'],
};

const videoSubjectReplaceExecutor: CreativeCapabilityExecutor = {
  async prepare(context, params) {
    const subjectType = isSubjectReplaceType(params.subjectReplaceType)
      ? params.subjectReplaceType
      : subjectReplaceDefaults.subjectType;
    const [requiredImageField, ...optionalImageFields] = subjectImageFields[subjectType];
    const requiredImageAssetId = stringValue(params[requiredImageField]);
    const imageAssetIds = [
      requiredImageAssetId,
      ...optionalImageFields.map((field) => stringValue(params[field])),
    ].filter(Boolean);
    const [referenceVideoAssetId] = stringArray(params.referenceVideoIds);
    if (!requiredImageAssetId) {
      throw new Error(subjectType === 'clothing' ? '请选择服饰正面图' : '请选择主体图片');
    }
    if (!referenceVideoAssetId) throw new Error('请选择参考视频');
    requireOwnedAssets({
      userId: context.userId,
      assetIds: imageAssetIds,
      mimePrefix: 'image/',
      label: '主体图片',
    });
    requireOwnedAssets({
      userId: context.userId,
      assetIds: [referenceVideoAssetId],
      mimePrefix: 'video/',
      label: '参考视频',
    });
    const videoModelId = stringValue(params.videoModelId) || subjectReplaceDefaults.videoModelId;
    const quality = normalizeSeedanceVideoQuality(params.quality);
    const preserveAudio = params.preserveAudio !== false;
    const price = await estimateDanceRemakeAssetPrice({
      filePath: contentRepository.findAsset(referenceVideoAssetId)!.filePath,
      quality,
      videoModelId,
    });
    return {
      effectiveParams: {
        imageAssetIds,
        preserveAudio,
        quality,
        referenceVideoIds: [referenceVideoAssetId],
        subjectReplaceType: subjectType,
        videoModelId,
      },
      modelConfigSnapshot: {
        subjectReplace: { quality, subjectType, videoModelId },
      },
      estimatedCredits: price.credits,
    };
  },

  async execute(context, prepared) {
    const params = prepared.effectiveParams;
    const [referenceVideoAssetId] = stringArray(params.referenceVideoIds);
    const subjectType = isSubjectReplaceType(params.subjectReplaceType)
      ? params.subjectReplaceType
      : subjectReplaceDefaults.subjectType;
    const task = context.generationJobId
      ? contentService.getVideoTask(context.generationJobId, context.userId)
      : await subjectReplaceService.create({
        imageAssetIds: stringArray(params.imageAssetIds),
        preserveAudio: params.preserveAudio !== false,
        quality: stringValue(params.quality),
        referenceVideoAssetId,
        subjectType,
        userId: context.userId,
        videoModelId: stringValue(params.videoModelId),
      });
    if (!context.generationJobId) {
      await context.onExternalJobCreated?.(task.id);
    }
    const completedTask = await waitForVideoTask(task.id, context.userId);
    const result = generationResultForTask(completedTask);
    const assetId = stringValue(result?.assetId)
      || contentRepository.listAssets({ userId: context.userId, resourceType: 'finished_video' })
        .find((asset) => asset.metadata.videoTaskId === completedTask.id)?.id
      || '';
    if (!assetId) throw new Error('模特 / 商品替换已完成，但未找到结果资产');
    return {
      outputAssetIds: [assetId],
      creditCost: Number(completedTask.creditCost || 0),
      metadata: {
        subjectReplaceType: subjectType,
        videoTaskId: completedTask.id,
        videoUrl: completedTask.generatedVideoUrl || result?.videoUrl || '',
      },
    };
  },
};

export function registerVideoCreativeCapabilityExecutors() {
  registerCreativeCapabilityExecutor('video.generate', videoGenerateExecutor);
  registerCreativeCapabilityExecutor('video.upscale', videoUpscaleExecutor);
  registerCreativeCapabilityExecutor('video.dance_remake', videoDanceRemakeExecutor);
  registerCreativeCapabilityExecutor('video.subject_replace', videoSubjectReplaceExecutor);
}
