import { existsSync } from 'node:fs';
import type { VideoModelOption } from '../../video-models/video-model-provider.types.js';
import { publishContentEvent } from '../content.events.js';
import { contentRepository } from '../content.repository.js';
import type {
ContentAsset,
ContentResourceType,
UpdateVideoParsePayload,
VideoGenerationResult
} from '../content.types.js';

import { privateAssetId,stringMetadataField } from './content-common.js';
import { appendVideoGenerationResultHistory,createFinishedVideoAsset,markFinishedVideoAssetFailed } from './content-image-assets.js';
import { isSegmentedVideoGenerationState,queryConfiguredVideoModelTask,recordVideoGenerationUsageIfNeeded,resumeSegmentedSeedanceVideoGeneration } from './content-video-generation.js';
import { isRecord,normalizeParseResult } from './content-viral-analysis.js';
import { logVideoGenerationFlow } from './content-viral-director.js';
import { absolutizeMaterialUrl } from './content-voice-clone.js';
import { resumeSceneAwareSegmentedSeedanceVideoGeneration } from '../../video-remake/video-remake.segmented-runtime.js';

export const runningVideoGenerationPollingTaskIds = new Set<string>();

export function generationResultForTask(task: ReturnType<typeof contentRepository.findVideoTask>) {
  if (!task) {
    return undefined;
  }
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const viralUnderstanding = isRecord(context.viralUnderstanding) ? context.viralUnderstanding : {};
  return task.editableParseResult.videoGenerationResult
    || (isRecord(context.videoGenerationResult) ? context.videoGenerationResult as VideoGenerationResult : undefined)
    || (isRecord(viralUnderstanding.videoGenerationResult) ? viralUnderstanding.videoGenerationResult as VideoGenerationResult : undefined);
}

export function updateVideoTaskParseResult(id: string, payload: UpdateVideoParsePayload) {
  const task = contentRepository.updateVideoTaskParseResult(id, {
    ...payload,
    editableParseResult: normalizeParseResult(payload.editableParseResult),
  });
  if (!task) {
    throw new Error('视频任务不存在');
  }
  return task;
}

export function applyVideoGenerationStatusToTask(
  task: ReturnType<typeof contentRepository.findVideoTask>,
  providerResult: {
    provider?: string;
    model?: string;
    jobId?: string;
    videoUrl?: string;
    coverUrl?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    errorMessage?: string;
    usage?: {
      completionTokens: number;
      totalTokens: number;
      toolUsage?: Record<string, unknown>;
      raw: Record<string, unknown>;
    };
  },
) {
  if (!task) {
    return null;
  }
  const result = generationResultForTask(task);
  const taskContext = isRecord(task.expertContext) ? task.expertContext : {};
  const viralUnderstanding = isRecord(taskContext.viralUnderstanding) ? taskContext.viralUnderstanding : {};
  const isDirectorGeneration = viralUnderstanding.directorStatus === 'generating'
    || isRecord(viralUnderstanding.videoGenerationResult);

  if (providerResult.status === 'failed') {
    const failureReason = providerResult.errorMessage || '视频生成失败';
    contentRepository.markVideoTaskFailed(task.id, failureReason);
    markFinishedVideoAssetFailed(result?.assetId, failureReason);
    const failedResult: VideoGenerationResult = {
      ...(result || {
        version: 1,
        taskId: task.id,
        duration: String(taskContext.duration || '5秒'),
        ratio: String(taskContext.ratio || '9:16'),
        generatedAt: new Date().toISOString(),
        status: 'failed',
      }),
      status: 'failed',
      provider: providerResult.provider,
      model: providerResult.model,
      jobId: providerResult.jobId,
      videoUrl: null,
      coverUrl: providerResult.coverUrl,
      errorMessage: failureReason,
      renderMode: 'provider_generation',
      renderStatus: 'failed',
      generatedAt: new Date().toISOString(),
    };
    const taskWithResult = updateVideoTaskParseResult(task.id, {
      editableParseResult: {
        ...task.editableParseResult,
        videoGenerationResult: failedResult,
      },
      selectedDigitalHumanId: task.selectedDigitalHumanId,
      selectedSceneId: task.selectedSceneId,
      selectedVoiceId: task.selectedVoiceId,
    });
    const nextExpertContext: Record<string, unknown> = {
      ...taskWithResult.expertContext,
      videoResult: failedResult,
      videoGenerationResult: failedResult,
      videoGenerationResults: appendVideoGenerationResultHistory(taskWithResult.expertContext || {}, failedResult),
      currentStep: 'video_generation_failed',
      requiredUserAction: 'configure_video_model_or_retry',
      updatedAt: new Date().toISOString(),
    };
    if (isDirectorGeneration) {
      nextExpertContext.viralUnderstanding = {
        ...(isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {}),
        directorStatus: 'failed',
        directorFailureReason: failureReason,
        videoGenerationResult: failedResult,
        videoGenerationResults: appendVideoGenerationResultHistory(
          isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {},
          failedResult,
        ),
        updatedAt: new Date().toISOString(),
      };
    }
    const failedTask = contentRepository.updateVideoTaskContext(task.id, {
      selectedSkillIds: taskWithResult.selectedSkillIds,
      expertContext: nextExpertContext,
    });
    if (failedTask) {
      publishContentEvent({
        type: 'viral-video-analysis-complete',
        userId: task.userId,
        taskId: task.id,
        phase: isDirectorGeneration ? 'director-failed' : 'failed',
        status: 'failed',
        message: failureReason,
        task: failedTask,
        at: new Date().toISOString(),
      });
    }
    return failedTask;
  }

  if (providerResult.status === 'completed' && providerResult.videoUrl) {
    recordVideoGenerationUsageIfNeeded({
      userId: task.userId,
      taskId: task.id,
      sourceType: typeof result?.sourceType === 'string' && result.sourceType.trim()
        ? result.sourceType.trim()
        : 'video_generation',
      fallbackSourceId: task.id,
      providerId: typeof taskContext.videoModelProviderId === 'string' ? taskContext.videoModelProviderId : providerResult.provider,
      modelId: typeof taskContext.videoModelId === 'string' ? taskContext.videoModelId : providerResult.model,
      jobId: providerResult.jobId,
      duration: result?.duration || String(taskContext.duration || '5秒'),
      usage: providerResult.usage,
      responseSnapshot: {
        provider: providerResult.provider,
        model: providerResult.model,
        status: providerResult.status,
        jobId: providerResult.jobId,
        completionTokens: providerResult.usage?.completionTokens || 0,
        totalTokens: providerResult.usage?.totalTokens || 0,
        hasVideoUrl: Boolean(providerResult.videoUrl),
        hasCoverUrl: Boolean(providerResult.coverUrl),
      },
      usageRaw: {
        requestMode: 'ark_seedance_async',
        polledCompletion: true,
      },
    });
    const finishedVideoAsset = createFinishedVideoAsset({
      userId: task.userId,
      taskId: task.id,
      title: task.title,
      videoUrl: providerResult.videoUrl,
      provider: providerResult.provider,
      model: providerResult.model,
      ratio: result?.ratio || String(taskContext.ratio || '9:16'),
      duration: result?.duration || String(taskContext.duration || '5秒'),
      mode: String(taskContext.mode || 'video_generation'),
      materialContext: isRecord(taskContext.materialContext) ? taskContext.materialContext : {},
      assetId: result?.assetId,
    });
    const taskAfterGenerated = contentRepository.markVideoTaskGenerated(task.id, providerResult.videoUrl);
    if (!taskAfterGenerated) {
      return null;
    }
    const completedResult: VideoGenerationResult = {
      ...(result || {
        version: 1,
        taskId: task.id,
        duration: String(taskContext.duration || '5秒'),
        ratio: String(taskContext.ratio || '9:16'),
        generatedAt: new Date().toISOString(),
        status: 'completed',
      }),
      status: 'completed',
      provider: providerResult.provider,
      model: providerResult.model,
      jobId: providerResult.jobId,
      videoUrl: providerResult.videoUrl,
      coverUrl: providerResult.coverUrl,
      renderMode: 'provider_generation',
      renderStatus: 'rendered',
      assetId: finishedVideoAsset?.id,
      generatedAt: new Date().toISOString(),
    };
    const taskWithResult = updateVideoTaskParseResult(task.id, {
      editableParseResult: {
        ...taskAfterGenerated.editableParseResult,
        videoGenerationResult: completedResult,
      },
      selectedDigitalHumanId: taskAfterGenerated.selectedDigitalHumanId,
      selectedSceneId: taskAfterGenerated.selectedSceneId,
      selectedVoiceId: taskAfterGenerated.selectedVoiceId,
    });
    const nextExpertContext: Record<string, unknown> = {
      ...taskWithResult.expertContext,
      videoResult: completedResult,
      videoGenerationResult: completedResult,
      videoGenerationResults: appendVideoGenerationResultHistory(taskWithResult.expertContext || {}, completedResult),
      currentStep: 'video_generated',
      requiredUserAction: null,
      updatedAt: new Date().toISOString(),
    };
    if (isDirectorGeneration) {
      nextExpertContext.viralUnderstanding = {
        ...(isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {}),
        directorStatus: 'completed',
        directorStep: 'final',
        videoGenerationResult: completedResult,
        videoGenerationResults: appendVideoGenerationResultHistory(
          isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {},
          completedResult,
        ),
        updatedAt: new Date().toISOString(),
      };
    }
    const completedTask = contentRepository.updateVideoTaskContext(task.id, {
      selectedSkillIds: taskWithResult.selectedSkillIds,
      expertContext: nextExpertContext,
    });
    if (completedTask) {
      publishContentEvent({
        type: 'viral-video-analysis-complete',
        userId: task.userId,
        taskId: task.id,
        phase: isDirectorGeneration ? 'director-completed' : 'completed',
        status: 'success',
        message: '视频生成完成',
        task: completedTask,
        asset: finishedVideoAsset || undefined,
        at: new Date().toISOString(),
      });
    }
    return completedTask;
  }

  const nextRunningResult: VideoGenerationResult = {
    ...(result || {
      version: 1,
      taskId: task.id,
      duration: String(taskContext.duration || '5秒'),
      ratio: String(taskContext.ratio || '9:16'),
      generatedAt: new Date().toISOString(),
      status: providerResult.status,
    }),
    status: providerResult.status,
    provider: providerResult.provider,
    model: providerResult.model,
    jobId: providerResult.jobId,
    videoUrl: null,
    coverUrl: providerResult.coverUrl,
    renderMode: 'provider_generation',
    renderStatus: providerResult.status === 'pending' ? 'queued' : 'rendering',
    generatedAt: new Date().toISOString(),
  };
  const taskWithResult = updateVideoTaskParseResult(task.id, {
    editableParseResult: {
      ...task.editableParseResult,
      videoGenerationResult: nextRunningResult,
    },
    selectedDigitalHumanId: task.selectedDigitalHumanId,
    selectedSceneId: task.selectedSceneId,
    selectedVoiceId: task.selectedVoiceId,
  });
  const nextExpertContext: Record<string, unknown> = {
    ...taskWithResult.expertContext,
    videoResult: nextRunningResult,
    videoGenerationResult: nextRunningResult,
    currentStep: providerResult.status === 'pending' ? 'video_generation_submitted' : 'video_generating',
    requiredUserAction: null,
    updatedAt: new Date().toISOString(),
  };
  if (isDirectorGeneration) {
    nextExpertContext.viralUnderstanding = {
      ...(isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {}),
      directorStatus: 'generating',
      directorStep: 'final',
      videoGenerationResult: nextRunningResult,
      updatedAt: new Date().toISOString(),
    };
  }
  return contentRepository.updateVideoTaskContext(task.id, {
    selectedSkillIds: taskWithResult.selectedSkillIds,
    expertContext: nextExpertContext,
  });
}

export async function refreshVideoTaskGenerationStatus(task: ReturnType<typeof contentRepository.findVideoTask>) {
  if (!task) {
    return null;
  }
  const result = generationResultForTask(task);
  const jobId = String(result?.jobId || '').trim();
  if (!jobId || (result?.status !== 'pending' && result?.status !== 'running') || task.status !== 'generating') {
    return task;
  }

  const taskContext = isRecord(task.expertContext) ? task.expertContext : {};
  const providerId = typeof taskContext.videoModelProviderId === 'string' ? taskContext.videoModelProviderId : undefined;
  const modelId = typeof taskContext.videoModelId === 'string' ? taskContext.videoModelId : undefined;
  const providerResult = await queryConfiguredVideoModelTask({
    providerId,
    modelId,
    jobId,
  });
  return applyVideoGenerationStatusToTask(task, providerResult);
}

export async function pollRunningVideoGenerationTask(taskId: string) {
  if (runningVideoGenerationPollingTaskIds.has(taskId)) {
    return;
  }
  runningVideoGenerationPollingTaskIds.add(taskId);
  try {
    const initial = contentRepository.findVideoTask(taskId);
    const segmentedState = initial?.expertContext?.videoGenerationSegments;
    if (initial && isSegmentedVideoGenerationState(segmentedState) && segmentedState.status === 'running') {
      const requestContext = isRecord(segmentedState.request?.context) ? segmentedState.request.context : {};
      if (Array.isArray(requestContext.videoRemakeSegmentInputs) && requestContext.videoRemakeSegmentInputs.length > 0) {
        await resumeSceneAwareSegmentedSeedanceVideoGeneration(initial, segmentedState);
        return;
      }
      await resumeSegmentedSeedanceVideoGeneration(initial, segmentedState);
      return;
    }
    const intervalMs = Number(process.env.VIDEO_GENERATION_POLL_INTERVAL_MS || 30000);
    const maxAttempts = Number(process.env.VIDEO_GENERATION_POLL_MAX_ATTEMPTS || 120);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const latest = contentRepository.findVideoTask(taskId);
      if (!latest || latest.status !== 'generating') {
        return;
      }
      logVideoGenerationFlow('info', 'video generation polling status', {
        taskId,
        attempt,
      });
      const refreshed = await refreshVideoTaskGenerationStatus(latest);
      if (!refreshed || refreshed.status !== 'generating') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    const latest = contentRepository.findVideoTask(taskId);
    if (latest?.status === 'generating') {
      contentRepository.markVideoTaskFailed(taskId, '视频生成轮询超时，请重试');
    }
  } finally {
    runningVideoGenerationPollingTaskIds.delete(taskId);
  }
}

export function serializeMaterialAsset(asset: ContentAsset) {
  return {
    id: asset.id,
    groupId: asset.groupId,
    resourceType: asset.resourceType,
    name: asset.name,
    description: asset.description,
    originalFileName: asset.originalFileName,
    mimeType: asset.mimeType,
    filePath: asset.filePath,
    fileUrl: absolutizeMaterialUrl(asset.fileUrl) || asset.fileUrl,
    metadata: asset.metadata,
  };
}

export function isUsableMaterialAsset(asset: ContentAsset) {
  const kind = String(asset.metadata.kind || asset.metadata.type || asset.metadata.stage || '').toLowerCase();
  if (!asset.fileUrl || /failure|failed|running|pending/.test(kind)) {
    return false;
  }
  return !asset.filePath || existsSync(asset.filePath);
}

export function isRealPersonResource(resourceType: unknown) {
  return String(resourceType || '') === 'real_person';
}

export function isActiveRealPersonAsset(asset: { resourceType: unknown; metadata: Record<string, unknown> }) {
  return !isRealPersonResource(asset.resourceType) || String(asset.metadata.volcStatus || '') === 'Active';
}

export function isSyncedVirtualPortraitAsset(asset: { resourceType: unknown; metadata: Record<string, unknown> }) {
  if (String(asset.resourceType || '') !== 'virtual_portrait') {
    return true;
  }
  return String(asset.metadata.volcStatus || '') === 'Active'
    && Boolean(privateAssetId(asset.metadata) || stringMetadataField(asset.metadata, 'assetUri'));
}

export function isAcceptedImageReferenceAsset(asset: ContentAsset) {
  return asset.mimeType.startsWith('image/') && isActiveRealPersonAsset(asset) && isSyncedVirtualPortraitAsset(asset);
}

export function resolveMaterialAsset(input: {
  userId: string;
  assetId: string;
  label: string;
  accepts: (asset: ContentAsset) => boolean;
}) {
  const asset = contentRepository.findAsset(input.assetId);
  if (!asset || asset.userId !== input.userId) {
    throw new Error(`所选${input.label}素材不存在，请重新选择`);
  }
  if (!isUsableMaterialAsset(asset) || !input.accepts(asset)) {
    if (isRealPersonResource(asset.resourceType) && asset.mimeType.startsWith('image/') && !isActiveRealPersonAsset(asset)) {
      throw new Error('真人素材仍在入库处理中');
    }
    throw new Error(`所选${input.label}素材不可用，请重新选择`);
  }
  return serializeMaterialAsset(asset);
}

export function resolveMaterialGroup(input: {
  userId: string;
  groupId?: string;
  label: string;
  acceptsGroup: (resourceType: ContentResourceType) => boolean;
  acceptsAsset: (asset: ContentAsset) => boolean;
}) {
  const groupId = String(input.groupId || '').trim();
  if (!groupId) {
    return undefined;
  }
  const group = contentRepository.findGroup(groupId);
  if (!group || group.userId !== input.userId || !input.acceptsGroup(group.resourceType)) {
    throw new Error(`所选${input.label}素材组不存在，请重新选择`);
  }
  const assets = contentRepository
    .listAssets({ userId: input.userId, groupId: group.id })
    .filter((asset) => isUsableMaterialAsset(asset) && input.acceptsAsset(asset))
    .map(serializeMaterialAsset);
  return {
    id: group.id,
    resourceType: group.resourceType,
    name: group.name,
    description: group.description,
    metadata: group.metadata,
    assets,
  };
}

export function resolveReferenceMaterials(input: {
  userId: string;
  referenceImageGroupId?: string;
  referenceVideoGroupId?: string;
  referenceAudioGroupId?: string;
  referenceImageIds?: string[];
  referenceVideoIds?: string[];
  referenceAudioIds?: string[];
}) {
  const unique = (items?: string[]) => Array.from(new Set((items || []).map((id) => String(id || '').trim()).filter(Boolean)));
  return {
    imageGroup: resolveMaterialGroup({
      userId: input.userId,
      groupId: input.referenceImageGroupId,
      label: '图片参考',
      acceptsGroup: (resourceType) => ['digital_human', 'scene', 'product'].includes(String(resourceType)) || isRealPersonResource(resourceType),
      acceptsAsset: isAcceptedImageReferenceAsset,
    }),
    videoGroup: resolveMaterialGroup({
      userId: input.userId,
      groupId: input.referenceVideoGroupId,
      label: '视频参考',
      acceptsGroup: (resourceType) => resourceType === 'other' || resourceType === 'finished_video',
      acceptsAsset: (asset) => asset.mimeType.startsWith('video/'),
    }),
    audioGroup: resolveMaterialGroup({
      userId: input.userId,
      groupId: input.referenceAudioGroupId,
      label: '音频参考',
      acceptsGroup: (resourceType) => resourceType === 'voice',
      acceptsAsset: (asset) => asset.mimeType.startsWith('audio/'),
    }),
    images: unique(input.referenceImageIds).map((assetId) => resolveMaterialAsset({
      userId: input.userId,
      assetId,
      label: '图片参考',
      accepts: isAcceptedImageReferenceAsset,
    })),
    videos: unique(input.referenceVideoIds).map((assetId) => resolveMaterialAsset({
      userId: input.userId,
      assetId,
      label: '视频参考',
      accepts: (asset) => asset.mimeType.startsWith('video/'),
    })),
    audios: unique(input.referenceAudioIds).map((assetId) => resolveMaterialAsset({
      userId: input.userId,
      assetId,
      label: '音频参考',
      accepts: (asset) => asset.mimeType.startsWith('audio/'),
    })),
  };
}

export function requireSelectedAsset(input: {
  userId: string;
  assetId?: string | null;
  resourceType: ContentResourceType | ContentResourceType[];
  label: string;
}) {
  if (!input.assetId) {
    return undefined;
  }
  const asset = contentRepository.findAsset(input.assetId);
  const acceptedTypes = Array.isArray(input.resourceType) ? input.resourceType : [input.resourceType];
  if (!asset || asset.userId !== input.userId || !acceptedTypes.includes(asset.resourceType)) {
    throw new Error(`所选${input.label}素材不存在，请重新选择`);
  }
  if (!isUsableMaterialAsset(asset)) {
    throw new Error(`所选${input.label}素材不可用，请重新选择`);
  }
  if (!isSyncedVirtualPortraitAsset(asset)) {
    throw new Error('人物素材尚未完成私域入库');
  }
  return serializeMaterialAsset(asset);
}

export function requireSelectedAssetGroup(input: {
  userId: string;
  groupId?: string | null;
  resourceType: ContentResourceType;
  label: string;
}) {
  if (!input.groupId) {
    return undefined;
  }
  const group = contentRepository.findGroup(input.groupId);
  if (!group || group.userId !== input.userId || group.resourceType !== input.resourceType) {
    throw new Error(`所选${input.label}素材分组不存在，请重新选择`);
  }
  const assets = contentRepository
    .listAssets({ userId: input.userId, groupId: group.id, resourceType: input.resourceType })
    .filter(isUsableMaterialAsset)
    .map(serializeMaterialAsset);
  return {
    id: group.id,
    resourceType: group.resourceType,
    name: group.name,
    description: group.description,
    metadata: group.metadata,
    assets,
  };
}

export function resolveVideoMaterialContext(input: {
  userId: string;
  selectedDigitalHumanId?: string | null;
  selectedSceneId?: string | null;
  selectedVoiceId?: string | null;
  audioUrl?: string;
  referenceImageGroupId?: string;
  referenceVideoGroupId?: string;
  referenceAudioGroupId?: string;
  referenceImageIds?: string[];
  referenceVideoIds?: string[];
  referenceAudioIds?: string[];
}) {
  const digitalHuman = requireSelectedAsset({
    userId: input.userId,
    assetId: input.selectedDigitalHumanId,
    resourceType: ['digital_human', 'virtual_portrait'],
    label: '人物',
  });
  const scene = requireSelectedAssetGroup({
    userId: input.userId,
    groupId: input.selectedSceneId,
    resourceType: 'scene',
    label: '场景',
  });
  const voice = requireSelectedAssetGroup({
    userId: input.userId,
    groupId: input.selectedVoiceId,
    resourceType: 'voice',
    label: '声音',
  });

  return {
    digitalHuman,
    scene,
    voice,
    references: resolveReferenceMaterials({
      userId: input.userId,
      referenceImageGroupId: input.referenceImageGroupId,
      referenceVideoGroupId: input.referenceVideoGroupId,
      referenceAudioGroupId: input.referenceAudioGroupId,
      referenceImageIds: input.referenceImageIds,
      referenceVideoIds: input.referenceVideoIds,
      referenceAudioIds: input.referenceAudioIds,
    }),
    audio: input.audioUrl ? { fileUrl: input.audioUrl, source: 'confirmed_audio' } : undefined,
  };
}

export function summarizeMaterialAsset(asset: {
  name: string;
  description: string;
  originalFileName: string;
}) {
  return [asset.name, asset.description, asset.originalFileName]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('，');
}

export function materialSequenceLabel(kind: '图片' | '视频' | '音频', index: number) {
  return `${kind} ${index + 1}`;
}

export function composeVideoProductionPrompt(input: {
  userPrompt: string;
  quality: string;
  ratio: string;
  duration: string;
  modelOption: VideoModelOption;
  materialContext: ReturnType<typeof resolveVideoMaterialContext>;
}) {
  const sections: string[] = [];
  const basePrompt = input.userPrompt.trim() || '请根据已选参考素材生成一支信息完整、节奏自然、主体一致的视频。';
  sections.push(basePrompt);
  sections.push(`技术要求：视频比例 ${input.ratio}，画质 ${input.quality}，时长 ${input.duration}。`);

  const referenceLines: string[] = [];
  const images = input.materialContext.references.images;
  const videos = input.materialContext.references.videos;
  const audios = input.materialContext.references.audios;

  if (input.modelOption.referencePolicy.imageMode === 'first_frame_required') {
    if (images[0]) {
      referenceLines.push(`首帧严格参考${materialSequenceLabel('图片', 0)}。`);
    }
  } else if (input.modelOption.referencePolicy.imageMode === 'first_last_optional') {
    if (images[0]) {
      referenceLines.push(`首帧严格参考${materialSequenceLabel('图片', 0)}。`);
    }
    if (images[1]) {
      referenceLines.push(`尾帧严格参考${materialSequenceLabel('图片', 1)}。`);
    }
  } else if (images.length) {
    referenceLines.push(`参考图片：${images.map((_, index) => materialSequenceLabel('图片', index)).join('、')}。`);
  }

  if (videos.length) {
    referenceLines.push(`参考视频：${videos.map((_, index) => materialSequenceLabel('视频', index)).join('、')}。优先参考其构图、运镜、节奏和镜头语言。`);
  }

  if (audios.length === 1) {
    referenceLines.push(`参考音频：${materialSequenceLabel('音频', 0)}（${summarizeMaterialAsset(audios[0])}）作为主要声音/节奏参考。`);
  } else if (audios.length >= 2) {
    referenceLines.push(`参考音频：${materialSequenceLabel('音频', 0)}（${summarizeMaterialAsset(audios[0])}）作为背景音乐或节奏参考，${materialSequenceLabel('音频', 1)}（${summarizeMaterialAsset(audios[1])}）作为人物声音或口播音色参考。${audios.slice(2).map((asset, index) => `补充${materialSequenceLabel('音频', index + 2)}（${summarizeMaterialAsset(asset)}）`).join('；')}`);
  }

  if (referenceLines.length) {
    sections.push(`参考素材约束：${referenceLines.join(' ')}`);
  }

  sections.push('生成要求：保持主体、产品、场景和声音风格一致；优先遵循已选首帧/尾帧图片，其次参考视频，再参考音频；不要忽略已选素材，不要生成与参考素材冲突的新主体或新包装。');
  return sections.filter(Boolean).join('\n\n');
}

export function isConfirmationMessage(value: string) {
  return /^(确认|可以|没问题|下一步|继续|通过|ok|okay|yes)$/i.test(value.trim());
}
