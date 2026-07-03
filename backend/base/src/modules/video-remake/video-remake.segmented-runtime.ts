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
  type VideoGenerationUsageSnapshot,
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
  generationMode?: 'parallel' | 'queued_extend';
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
  const localUrl = `/files/${encodeURIComponent(input.segmentPath.split('/').pop() || '')}`;
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

function queuedSegmentResultsWithWaiting(segmentInputs: SceneAwareSegmentInput[], segmentResults: Array<Record<string, unknown>>, currentSegmentIndex?: number) {
  return segmentInputs.map((segment) => {
    const existing = segmentResults[segment.segmentIndex - 1]
      || segmentResults.find((item) => Number(item.segmentIndex) === segment.segmentIndex);
    if (existing) {
      if (
        currentSegmentIndex === segment.segmentIndex
        && String(existing.status || '') === 'waiting'
        && !String(existing.jobId || existing.videoUrl || existing.fileUrl || '').trim()
      ) {
        return {
          ...existing,
          status: 'running',
          generationMode: 'queued_extend',
        };
      }
      return existing;
    }
    return {
      segmentIndex: segment.segmentIndex,
      seconds: segment.seconds,
      status: currentSegmentIndex === segment.segmentIndex ? 'running' : 'waiting',
      generationMode: 'queued_extend',
    };
  });
}

function withPreviousSegmentReferenceMaterialContext(materialContext: Record<string, unknown>, previousSegment: Record<string, unknown>) {
  const previousUrl = String(previousSegment.remoteVideoUrl || previousSegment.videoUrl || previousSegment.fileUrl || previousSegment.url || '').trim();
  if (!previousUrl) {
    return materialContext;
  }
  const references = isRecord(materialContext.references) ? materialContext.references : {};
  return {
    ...materialContext,
    references: {
      ...references,
      // In queued extend mode the previous segment must be the only video continuity
      // reference. Keeping the original/reference-primer videos here makes Seedance
      // blend multiple video references and accelerates quality drift.
      videos: [
        {
          id: `queued-extend-previous-segment-${previousSegment.segmentIndex || 1}`,
          name: `前一分段 ${previousSegment.segmentIndex || ''}`.trim(),
          fileUrl: previousUrl,
          url: previousUrl,
          mimeType: 'video/mp4',
          resourceType: 'finished_video',
          metadata: {
            source: 'video_remake_queued_extend_previous_segment',
            segmentIndex: previousSegment.segmentIndex,
            url: previousUrl,
          },
        },
      ],
    },
  };
}

function queuedExtendQualityPromptLines(previousSegment?: Record<string, unknown>) {
  const hasPrevious = Boolean(previousSegment && String(previousSegment.remoteVideoUrl || previousSegment.videoUrl || previousSegment.fileUrl || previousSegment.url || '').trim());
  return [
    '# 排队生成画质基准',
    '本段必须按原始角色、场景、服装、道具和本段分镜重新生成高清画面，保持细节丰富、色彩自然、光影柔和、边缘清晰。',
    '人物面部必须清晰稳定、五官干净、皮肤质感自然；不得出现糊脸、压缩噪点、斑驳色块、纹理脏污、低清晰度参考视频质感。',
    hasPrevious
      ? '上一段视频只用于承接时间连续性、人物位置、运动方向和镜头衔接，不作为画质上限；不得继承上一段的模糊、噪点、压缩感或画质损耗。'
      : '第一段必须建立全片高清画质基准，后续分段画质需要与第一段一致。',
  ].filter(Boolean);
}

function withQueuedExtendQualityPrompt(prompt: string, previousSegment?: Record<string, unknown>) {
  return [
    prompt,
    ...queuedExtendQualityPromptLines(previousSegment),
  ].filter(Boolean).join('\n\n');
}

function withPreviousSegmentExtendPrompt(prompt: string, previousSegment: Record<string, unknown>) {
  if (!String(previousSegment.remoteVideoUrl || previousSegment.videoUrl || previousSegment.fileUrl || previousSegment.url || '').trim()) {
    return withQueuedExtendQualityPrompt(prompt);
  }
  return [
    withQueuedExtendQualityPrompt(prompt, previousSegment),
    '# 视频延长上下文',
    `上一段分段 ${previousSegment.segmentIndex || ''} 已生成，并作为本段的前一段参考视频。`,
    '只使用上一段参考视频来承接画面构图、人物位置、动作连续性和镜头运动方向；画质、细节、面部和背景必须重新生成到高清状态。',
    '本段必须从上一段之后自然延长，不重新开场、不回放上一段画面、不复读上一段口播。',
    '本段口播仍以“本段口播/音频白名单”为唯一来源；上一段参考视频的音轨、口型和台词不得进入本段。',
  ].filter(Boolean).join('\n\n');
}

function queuedExtendQualityNegativePrompts() {
  return [
    '视频延长画质劣化',
    '多次续写导致画质下降',
    '人物面部斑驳色块',
    '脸部色块',
    '糊脸',
    '面部模糊',
    '压缩噪点',
    '纹理劣化',
    '细节丢失',
    '画面逐段变糊',
    '低清晰度参考视频质感',
    '继承上一段模糊画质',
    '上一段压缩感累积',
    '背景边缘糊成一片',
    '服装纹理脏污',
  ];
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
  const generationMode = input.generationMode === 'queued_extend' ? 'queued_extend' : 'parallel';
  if (generationMode === 'queued_extend' && !segmentResults.length) {
    segmentInputs.forEach((segment, index) => {
      segmentResults[index] = {
        segmentIndex: segment.segmentIndex,
        seconds: segment.seconds,
        status: segment.segmentIndex === 1 ? 'running' : 'waiting',
        generationMode,
      };
    });
    persistSegmentedVideoGenerationState(input.taskId, {
      ...state,
      status: 'running',
      request: {
        ...state.request,
        pendingAssetId,
        generationMode,
      },
      segmentResults,
      segmentPaths,
      currentSegmentIndex: 1,
      failureStage: undefined,
      failureReason: undefined,
    });
  }
  const runSegment = async (segment: SceneAwareSegmentInput) => {
    const existingPath = segmentPaths[segment.segmentIndex - 1];
    const existingResult = segmentResults.find((item) => Number(item.segmentIndex) === segment.segmentIndex);
    if (existingPath && existingResult?.videoUrl && existsSync(existingPath)) {
      const completedSegment = completedSegmentResultWithLocalUrl({
        segmentIndex: segment.segmentIndex,
        seconds: segment.seconds,
        provider: typeof existingResult.provider === 'string' ? existingResult.provider : undefined,
        model: typeof existingResult.model === 'string' ? existingResult.model : undefined,
        jobId: typeof existingResult.jobId === 'string' ? existingResult.jobId : undefined,
        remoteVideoUrl: String(existingResult.remoteVideoUrl || existingResult.videoUrl || ''),
        status: typeof existingResult.status === 'string' ? existingResult.status : undefined,
        segmentPath: existingPath,
      });
      segmentResults[segment.segmentIndex - 1] = {
        ...completedSegment,
        generationMode,
      };
      return segmentResults[segment.segmentIndex - 1];
    }
    const previousSegment = generationMode === 'queued_extend' && segment.segmentIndex > 1
      ? segmentResults[segment.segmentIndex - 2]
      : undefined;
    const materialContext = previousSegment
      ? withPreviousSegmentReferenceMaterialContext(segment.materialContext, previousSegment)
      : segment.materialContext;
    const prompt = generationMode === 'queued_extend'
      ? previousSegment
        ? withPreviousSegmentExtendPrompt(segment.prompt, previousSegment)
        : withQueuedExtendQualityPrompt(segment.prompt)
      : segment.prompt;
    const negativePrompts = generationMode === 'queued_extend'
      ? [...input.negativePrompts, ...queuedExtendQualityNegativePrompts()]
      : input.negativePrompts;
    const submitted = existingResult && (typeof existingResult.jobId === 'string' || typeof existingResult.videoUrl === 'string')
      ? existingResult
      : await runtime.callConfiguredVideoModel({
        taskId: input.taskId,
        title: `${input.title}-片段${segment.segmentIndex}`,
        prompt,
        negativePrompts,
        ratio: input.ratio,
        resolution: input.resolution || input.seedanceOptions.resolution,
        duration: formatDurationLabel(segment.seconds),
        context: {
          ...segment.context,
          materialContext,
          videoGenerationFlow: {
            traceId: input.traceId,
            source: generationMode === 'queued_extend'
              ? 'video_remake_queued_extend_segment_generation'
              : 'video_remake_scene_aware_segment_generation',
            segmentIndex: segment.segmentIndex,
            segmentCount: segmentInputs.length,
            referencePrimerSpanId: segment.referencePrimerSpanId,
            previousSegmentIndex: previousSegment ? Number(previousSegment.segmentIndex) || segment.segmentIndex - 1 : undefined,
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
      usage: submitted.usage,
      status: submitted.status,
      generationMode,
    };
    segmentResults[segment.segmentIndex - 1] = createdSegment;
    const submittedSegmentResults = generationMode === 'queued_extend'
      ? queuedSegmentResultsWithWaiting(segmentInputs, segmentResults, segment.segmentIndex)
      : segmentResults.filter(isRecord);
    persistSegmentedVideoGenerationState(input.taskId, {
      ...state,
      status: 'running',
      request: {
        ...state.request,
        pendingAssetId,
        generationMode,
      },
      segmentResults: submittedSegmentResults,
      segmentPaths,
      currentSegmentIndex: segment.segmentIndex,
      failureStage: undefined,
      failureReason: undefined,
    });
    const completed = await runtime.waitForVideoModelCompletion({
      providerId: input.providerId,
      modelId: input.modelId,
      jobId: typeof createdSegment.jobId === 'string' ? createdSegment.jobId : undefined,
      initialVideoUrl: typeof createdSegment.videoUrl === 'string' ? createdSegment.videoUrl : undefined,
      initialCoverUrl: undefined,
      initialUsage: isRecord(createdSegment.usage) ? createdSegment.usage as VideoGenerationUsageSnapshot : undefined,
      initialStatus: createdSegment.videoUrl ? 'completed' : 'running',
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
      sourceType: generationMode === 'queued_extend'
        ? 'video_remake_queued_extend_segment_generation'
        : 'video_remake_scene_aware_segment_generation',
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
        source: generationMode === 'queued_extend'
          ? 'video_remake_queued_extend_segment_generation'
          : 'video_remake_scene_aware_segment_generation',
        generationMode,
        segmentIndex: segment.segmentIndex,
        segmentCount: segmentInputs.length,
        referencePrimerSpanId: segment.referencePrimerSpanId,
        previousSegmentIndex: previousSegment ? Number(previousSegment.segmentIndex) || segment.segmentIndex - 1 : undefined,
      },
    });
    const segmentPath = await downloadGeneratedVideoSegment({
      url: completed.videoUrl,
      taskId: input.taskId,
      segmentIndex: segment.segmentIndex,
      traceId: input.traceId,
    });
    const completedSegment = completedSegmentResultWithLocalUrl({
      segmentIndex: segment.segmentIndex,
      seconds: segment.seconds,
      provider: completed.provider,
      model: completed.model,
      jobId: completed.jobId,
      remoteVideoUrl: completed.videoUrl,
      status: completed.status,
      segmentPath,
    });
    segmentResults[segment.segmentIndex - 1] = {
      ...completedSegment,
      generationMode,
    };
    segmentPaths[segment.segmentIndex - 1] = String(completedSegment.segmentPath || completedSegment.filePath || '');
    const completedSegmentResults = generationMode === 'queued_extend'
      ? queuedSegmentResultsWithWaiting(segmentInputs, segmentResults, segment.segmentIndex + 1)
      : segmentResults;
    persistSegmentedVideoGenerationState(input.taskId, {
      ...state,
      status: 'running',
      request: {
        ...state.request,
        pendingAssetId,
        generationMode,
      },
      segmentResults: completedSegmentResults,
      segmentPaths,
      currentSegmentIndex: segment.segmentIndex,
      failureStage: undefined,
      failureReason: undefined,
    });
    return segmentResults[segment.segmentIndex - 1];
  };

  try {
    const completionResults = generationMode === 'queued_extend'
      ? [] as PromiseSettledResult<Record<string, unknown>>[]
      : await Promise.allSettled(segmentInputs.map((segment) => runSegment(segment)));
    if (generationMode === 'queued_extend') {
      for (const segment of segmentInputs) {
        try {
          const value = await runSegment(segment);
          completionResults.push({ status: 'fulfilled', value });
        } catch (reason) {
          completionResults.push({ status: 'rejected', reason });
          break;
        }
      }
    }

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
        generationMode,
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
      renderMode: generationMode === 'queued_extend' ? 'queued_extend_ffmpeg' as const : 'segmented_ffmpeg' as const,
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
    if (generationMode !== 'queued_extend' && !shouldKeepSegmentFiles(latestSegments)) {
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
    generationMode: state.request.generationMode === 'queued_extend' ? 'queued_extend' : 'parallel',
    traceId: state.request.traceId,
    pendingAssetId: state.request.pendingAssetId,
    segmentInputs,
  }, runtime, state);
}
