import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { contentRepository } from '../content/content.repository.js';
import { createPendingFinishedVideoAsset } from '../content/internals/content-image-assets.js';
import {
  callConfiguredVideoModel,
  downloadGeneratedVideoSegment,
  formatDurationLabel,
  mergeGeneratedVideoSegments,
  persistSegmentedVideoGenerationState,
  recordVideoGenerationUsageIfNeeded,
  type SegmentedVideoGenerationState,
  userFacingVideoGenerationError,
  waitForVideoModelCompletion,
} from '../content/internals/content-video-generation.js';

type RuntimeFns = {
  callConfiguredVideoModel: typeof callConfiguredVideoModel;
  waitForVideoModelCompletion: typeof waitForVideoModelCompletion;
};

export type SceneAwareSegmentInput = {
  segmentIndex: number;
  seconds: number;
  prompt: string;
  context: Record<string, unknown>;
  materialContext: Record<string, unknown>;
  referencePrimerSpanId?: string;
};

type SceneAwareRunInput = {
  taskId: string;
  userId: string;
  title: string;
  negativePrompts: string[];
  ratio: string;
  resolution?: string;
  totalSeconds: number;
  context: Record<string, unknown>;
  materialContext: Record<string, unknown>;
  providerId: string;
  modelId: string;
  seedanceOptions: {
    generateAudio?: boolean;
    watermark?: boolean;
    resolution?: string;
  };
  traceId: string;
  segmentInputs: SceneAwareSegmentInput[];
  pendingAssetId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sceneAwareSegmentInputsFromContext(context: Record<string, unknown>) {
  const raw = context.videoRemakeSegmentInputs;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRecord).map((item, index) => ({
    segmentIndex: Number(item.segmentIndex) || index + 1,
    seconds: Math.max(1, Number(item.seconds) || 1),
    prompt: String(item.prompt || '').trim(),
    context: isRecord(item.context) ? item.context : {},
    materialContext: isRecord(item.materialContext) ? item.materialContext : {},
    referencePrimerSpanId: typeof item.referencePrimerSpanId === 'string' ? item.referencePrimerSpanId : undefined,
  })).filter((item) => item.prompt);
}

function completedSegmentResultWithLocalUrl(input: {
  segmentIndex: number;
  seconds: number;
  provider?: string;
  model?: string;
  jobId?: string;
  remoteVideoUrl: string;
  status?: string;
  segmentPath: string;
}) {
  const localUrl = `/files/content/${encodeURIComponent(input.segmentPath.split('/').pop() || '')}`;
  return {
    segmentIndex: input.segmentIndex,
    seconds: input.seconds,
    provider: input.provider,
    model: input.model,
    jobId: input.jobId,
    remoteVideoUrl: input.remoteVideoUrl,
    videoUrl: localUrl,
    fileUrl: localUrl,
    url: localUrl,
    status: input.status,
    segmentPath: input.segmentPath,
    filePath: input.segmentPath,
  };
}

function firstRejected(results: PromiseSettledResult<unknown>[]) {
  return results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
}

function fulfilledValues<T>(results: PromiseSettledResult<T>[]) {
  return results.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
}

function shouldKeepSegmentFiles(value: unknown) {
  return isRecord(value)
    && (value.status === 'running' || value.status === 'failed' || value.status === 'completed')
    && Array.isArray(value.segmentPaths)
    && value.segmentPaths.some((item) => typeof item === 'string' && item.trim().length > 0);
}

async function runSceneAwareSegmentedSeedanceVideoGeneration(
  input: SceneAwareRunInput,
  runtime: RuntimeFns,
  resumeState?: SegmentedVideoGenerationState,
) {
  const segmentInputs = input.segmentInputs
    .slice()
    .sort((left, right) => left.segmentIndex - right.segmentIndex);
  const segments = segmentInputs.map((item) => item.seconds);
  let pendingAssetId = input.pendingAssetId || resumeState?.request.pendingAssetId;
  if (!pendingAssetId) {
    pendingAssetId = createPendingFinishedVideoAsset({
      userId: input.userId,
      taskId: input.taskId,
      title: input.title,
      provider: input.providerId,
      model: input.modelId,
      ratio: input.ratio,
      duration: formatDurationLabel(input.totalSeconds),
      mode: 'video_remake_scene_aware_segmented',
      traceId: input.traceId,
      materialContext: input.materialContext,
    }).id;
  }

  let state: SegmentedVideoGenerationState = resumeState || {
    status: 'running',
    request: {
      taskId: input.taskId,
      userId: input.userId,
      title: input.title,
      prompt: '',
      negativePrompts: input.negativePrompts,
      ratio: input.ratio,
      resolution: input.resolution,
      totalSeconds: input.totalSeconds,
      maxSegmentSeconds: Math.max(...segments, 1),
      context: {
        ...input.context,
        videoRemakeSegmentInputs: segmentInputs,
      },
      materialContext: input.materialContext,
      providerId: input.providerId,
      modelId: input.modelId,
      seedanceOptions: input.seedanceOptions,
      traceId: input.traceId,
      pendingAssetId,
    },
    segments,
    segmentResults: [],
    segmentPaths: [],
    updatedAt: new Date().toISOString(),
  };
  persistSegmentedVideoGenerationState(input.taskId, state);

  const segmentResults = [...state.segmentResults];
  const segmentPaths = [...state.segmentPaths];

  try {
    const submittedResults = await Promise.allSettled(segmentInputs.map(async (segment) => {
      const existing = segmentResults.find((item) => Number(item.segmentIndex) === segment.segmentIndex);
      if (existing && (typeof existing.jobId === 'string' || typeof existing.videoUrl === 'string')) {
        return existing;
      }
      const submitted = await runtime.callConfiguredVideoModel({
        taskId: input.taskId,
        title: `${input.title}-片段${segment.segmentIndex}`,
        prompt: segment.prompt,
        negativePrompts: input.negativePrompts,
        ratio: input.ratio,
        resolution: input.resolution || input.seedanceOptions.resolution,
        duration: formatDurationLabel(segment.seconds),
        context: {
          ...segment.context,
          materialContext: segment.materialContext,
          videoGenerationFlow: {
            traceId: input.traceId,
            source: 'video_remake_scene_aware_segment_generation',
            segmentIndex: segment.segmentIndex,
            segmentCount: segmentInputs.length,
            referencePrimerSpanId: segment.referencePrimerSpanId,
          },
        },
        providerId: input.providerId,
        modelId: input.modelId,
        seedanceOptions: input.seedanceOptions,
      });
      const createdSegment = {
        segmentIndex: segment.segmentIndex,
        seconds: segment.seconds,
        provider: submitted.provider,
        model: submitted.model,
        jobId: submitted.jobId,
        videoUrl: submitted.videoUrl,
        status: submitted.status,
      };
      segmentResults[segment.segmentIndex - 1] = createdSegment;
      persistSegmentedVideoGenerationState(input.taskId, {
        ...state,
        status: 'running',
        request: {
          ...state.request,
          pendingAssetId,
        },
        segmentResults: segmentResults.filter(isRecord),
        segmentPaths,
        currentSegmentIndex: undefined,
        failureStage: undefined,
        failureReason: undefined,
      });
      return createdSegment;
    }));

    const failedSubmit = firstRejected(submittedResults);
    const createdSegments = fulfilledValues(submittedResults).sort((left, right) => Number(left.segmentIndex) - Number(right.segmentIndex));
    createdSegments.forEach((item) => {
      segmentResults[Number(item.segmentIndex) - 1] = item;
    });
    if (failedSubmit) {
      state = {
        ...state,
        status: 'failed',
        failureStage: 'segment_generation',
        failureReason: userFacingVideoGenerationError(failedSubmit.reason),
        request: {
          ...state.request,
          pendingAssetId,
        },
        segmentResults,
        segmentPaths,
      };
      persistSegmentedVideoGenerationState(input.taskId, state);
      throw failedSubmit.reason;
    }

    const completionResults = await Promise.allSettled(segmentInputs.map(async (segment) => {
      const existingPath = segmentPaths[segment.segmentIndex - 1];
      const existingResult = segmentResults.find((item) => Number(item.segmentIndex) === segment.segmentIndex);
      if (existingPath && existingResult?.videoUrl && existsSync(existingPath)) {
        return completedSegmentResultWithLocalUrl({
          segmentIndex: segment.segmentIndex,
          seconds: segment.seconds,
          provider: typeof existingResult.provider === 'string' ? existingResult.provider : undefined,
          model: typeof existingResult.model === 'string' ? existingResult.model : undefined,
          jobId: typeof existingResult.jobId === 'string' ? existingResult.jobId : undefined,
          remoteVideoUrl: String(existingResult.remoteVideoUrl || existingResult.videoUrl || ''),
          status: typeof existingResult.status === 'string' ? existingResult.status : undefined,
          segmentPath: existingPath,
        });
      }
      if (!existingResult) {
        throw new Error(`视频分段 ${segment.segmentIndex} 未发起生成任务`);
      }
      const completed = await runtime.waitForVideoModelCompletion({
        providerId: input.providerId,
        modelId: input.modelId,
        jobId: typeof existingResult.jobId === 'string' ? existingResult.jobId : undefined,
        initialVideoUrl: typeof existingResult.videoUrl === 'string' ? existingResult.videoUrl : undefined,
        initialCoverUrl: undefined,
        initialStatus: existingResult.videoUrl ? 'completed' : 'running',
        traceId: input.traceId,
        taskId: input.taskId,
        segmentIndex: segment.segmentIndex,
      });
      if (!completed.videoUrl) {
        throw new Error(`视频分段 ${segment.segmentIndex} 未返回成片地址`);
      }
      recordVideoGenerationUsageIfNeeded({
        userId: input.userId,
        taskId: input.taskId,
        sourceType: 'video_remake_scene_aware_segment_generation',
        fallbackSourceId: `${input.taskId}-segment-${segment.segmentIndex}`,
        providerId: input.providerId,
        modelId: input.modelId,
        jobId: completed.jobId,
        durationSeconds: segment.seconds,
        usage: completed.usage,
        responseSnapshot: {
          provider: completed.provider,
          model: completed.model,
          status: completed.status,
          jobId: completed.jobId,
          completionTokens: completed.usage?.completionTokens || 0,
          totalTokens: completed.usage?.totalTokens || 0,
          hasVideoUrl: Boolean(completed.videoUrl),
          hasCoverUrl: Boolean(completed.coverUrl),
        },
        usageRaw: {
          requestMode: 'ark_seedance_async',
          source: 'video_remake_scene_aware_segment_generation',
          segmentIndex: segment.segmentIndex,
          segmentCount: segmentInputs.length,
          referencePrimerSpanId: segment.referencePrimerSpanId,
        },
      });
      const segmentPath = await downloadGeneratedVideoSegment({
        url: completed.videoUrl,
        taskId: input.taskId,
        segmentIndex: segment.segmentIndex,
        traceId: input.traceId,
      });
      return completedSegmentResultWithLocalUrl({
        segmentIndex: segment.segmentIndex,
        seconds: segment.seconds,
        provider: completed.provider,
        model: completed.model,
        jobId: completed.jobId,
        remoteVideoUrl: completed.videoUrl,
        status: completed.status,
        segmentPath,
      });
    }));

    const failedCompletion = firstRejected(completionResults);
    const completedSegments = fulfilledValues(completionResults).sort((left, right) => Number(left.segmentIndex) - Number(right.segmentIndex));
    completedSegments.forEach((item) => {
      const resultIndex = Number(item.segmentIndex) - 1;
      segmentResults[resultIndex] = item;
      segmentPaths[resultIndex] = String(item.segmentPath || item.filePath || '');
    });
    state = {
      ...state,
      status: failedCompletion ? 'failed' : 'running',
      request: {
        ...state.request,
        pendingAssetId,
      },
      failureStage: failedCompletion ? 'segment_generation' : undefined,
      failureReason: failedCompletion ? userFacingVideoGenerationError(failedCompletion.reason) : undefined,
      segmentResults,
      segmentPaths,
    };
    persistSegmentedVideoGenerationState(input.taskId, state);
    if (failedCompletion) {
      throw failedCompletion.reason;
    }

    const merged = await mergeGeneratedVideoSegments({
      taskId: input.taskId,
      segmentPaths: segmentPaths.filter(Boolean),
      traceId: input.traceId,
    });
    const pendingAsset = pendingAssetId ? contentRepository.findAsset(pendingAssetId) : null;
    if (!pendingAsset) {
      throw new Error('分段生成占位素材不存在');
    }
    const asset = contentRepository.updateFinishedVideoAssetFile(pendingAsset.id, {
      description: '场景感知分段生成后由 ffmpeg 合并的真实成片',
      originalFileName: merged.storedFileName,
      storedFileName: merged.storedFileName,
      mimeType: 'video/mp4',
      fileSize: merged.fileSize,
      filePath: merged.filePath,
      fileUrl: merged.fileUrl,
      metadata: {
        ...pendingAsset.metadata,
        generatedBy: 'video_model',
        generationStatus: 'completed',
        provider: input.providerId,
        model: input.modelId,
        videoTaskId: input.taskId,
        ratio: input.ratio,
        duration: formatDurationLabel(input.totalSeconds),
        mode: 'video_remake_scene_aware_segmented',
        materialContext: input.materialContext,
        segments: segmentResults,
        completedAt: new Date().toISOString(),
      },
    });
    if (!asset) {
      throw new Error('分段合并成片素材更新失败');
    }
    persistSegmentedVideoGenerationState(input.taskId, {
      ...state,
      status: 'completed',
      request: {
        ...state.request,
        pendingAssetId,
      },
      segmentResults,
      segmentPaths,
    });
    return {
      provider: input.providerId,
      model: input.modelId,
      status: 'completed' as const,
      videoUrl: merged.fileUrl,
      coverUrl: undefined,
      jobId: segmentResults.map((item) => String(item.jobId || '')).filter(Boolean).join(',') || undefined,
      assetId: asset.id,
      renderMode: 'segmented_ffmpeg' as const,
      segments: segmentResults,
    };
  } catch (error) {
    persistSegmentedVideoGenerationState(input.taskId, {
      ...state,
      status: 'failed',
      request: {
        ...state.request,
        pendingAssetId,
      },
      failureStage: 'segment_generation',
      failureReason: userFacingVideoGenerationError(error),
      segmentResults,
      segmentPaths,
    });
    throw error;
  } finally {
    const latest = contentRepository.findVideoTask(input.taskId);
    const latestSegments = latest?.expertContext?.videoGenerationSegments;
    if (!shouldKeepSegmentFiles(latestSegments)) {
      await Promise.all(segmentPaths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)));
    }
  }
}

export async function callSceneAwareSegmentedSeedanceVideoGeneration(
  input: SceneAwareRunInput,
  runtime: RuntimeFns = {
    callConfiguredVideoModel,
    waitForVideoModelCompletion,
  },
) {
  return runSceneAwareSegmentedSeedanceVideoGeneration(input, runtime);
}

export async function resumeSceneAwareSegmentedSeedanceVideoGeneration(
  task: ReturnType<typeof contentRepository.findVideoTask>,
  state: SegmentedVideoGenerationState,
  runtime: RuntimeFns = {
    callConfiguredVideoModel,
    waitForVideoModelCompletion,
  },
) {
  if (!task) {
    return null;
  }
  const requestContext = isRecord(state.request.context) ? state.request.context : {};
  const segmentInputs = sceneAwareSegmentInputsFromContext(requestContext);
  if (!segmentInputs.length) {
    return null;
  }
  return runSceneAwareSegmentedSeedanceVideoGeneration({
    taskId: task.id,
    userId: task.userId,
    title: state.request.title,
    negativePrompts: state.request.negativePrompts,
    ratio: state.request.ratio,
    resolution: state.request.resolution,
    totalSeconds: state.request.totalSeconds,
    context: requestContext,
    materialContext: isRecord(state.request.materialContext) ? state.request.materialContext : {},
    providerId: state.request.providerId,
    modelId: state.request.modelId,
    seedanceOptions: state.request.seedanceOptions,
    traceId: state.request.traceId,
    pendingAssetId: state.request.pendingAssetId,
    segmentInputs,
  }, runtime, state);
}
