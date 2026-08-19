import { stat } from 'node:fs/promises';
import path from 'node:path';
import { volcengineVodConfig } from '../../../config/env.js';
import { createTraceId, logger } from '../../../shared/logger.js';
import {
  assertSufficientStepCredits,
  estimateVideoUpscaleCredits,
  estimateVodUploadCredits,
  releaseVideoUpscaleCredits,
  reserveVideoUpscaleCredits,
  settleVideoUpscaleCredits,
} from '../../billing/billing.service.js';
import { contentRepository, emptyVideoParseResult } from '../content.repository.js';
import type { CreateVideoEnhancementPayload, VideoGenerationResult, VideoGenerationTask } from '../content.types.js';
import { createFinishedVideoAsset, createPendingFinishedVideoAsset, markFinishedVideoAssetFailed } from './content-image-assets.js';
import { resolveSourceVideoAspectRatio } from './content-video-aspect-ratio.js';
import { assertCreateVideoSourceDuration } from './content-video-duration.js';
import { mirrorGeneratedVideoToLocalInBackground } from './content-video-local-mirror.js';
import { defaultVideoPollMaxAttempts } from './content-video-polling.js';
import { aiWorkerUrl, uploadLocalVideoToVodWithWorker } from './content-worker-client.js';
import { ensureContentAssetLocalFile } from './content-asset-local-cache.js';

type EnhancementWorkerResult = {
  ok?: boolean;
  message?: string;
  runId?: string;
  status?: string;
  storeUri?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
};

const runningEnhancementTaskIds = new Set<string>();
const completedStatuses = new Set(['success', 'succeeded', 'completed', 'complete', 'done']);
const failedStatuses = new Set(['failed', 'fail', 'error', 'canceled', 'cancelled']);

function enhancementResult(task: VideoGenerationTask) {
  const value = task.editableParseResult.videoGenerationResult || task.expertContext?.videoGenerationResult;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as VideoGenerationResult
    : undefined;
}

function enhancementContext(task: VideoGenerationTask) {
  return task.expertContext && typeof task.expertContext === 'object' ? task.expertContext : {};
}

function updateEnhancementTask(input: {
  task: VideoGenerationTask;
  context: Record<string, unknown>;
  result: VideoGenerationResult;
}) {
  const withParse = contentRepository.updateVideoTaskParseResult(input.task.id, {
    editableParseResult: {
      ...input.task.editableParseResult,
      videoGenerationResult: input.result,
    },
    selectedDigitalHumanId: input.task.selectedDigitalHumanId,
    selectedVoiceId: input.task.selectedVoiceId,
    selectedSceneId: input.task.selectedSceneId,
  }) || input.task;
  return contentRepository.updateVideoTaskContext(input.task.id, {
    selectedSkillIds: withParse.selectedSkillIds,
    expertContext: {
      ...input.context,
      videoGenerationResult: input.result,
      updatedAt: new Date().toISOString(),
    },
  }) || withParse;
}

async function callEnhancementWorker(pathname: string, payload: Record<string, unknown>) {
  const traceId = createTraceId('vod-enhance');
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`视频高清放大服务不可访问：${error instanceof Error ? error.message : '连接失败'}`);
  }
  const text = await response.text();
  let data: EnhancementWorkerResult = {};
  try {
    data = text ? JSON.parse(text) as EnhancementWorkerResult : {};
  } catch {
    throw new Error('视频高清放大服务返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `视频高清放大服务请求失败（${response.status}）`);
  }
  return data;
}

function playbackUrlFromStoreUri(storeUri: string) {
  if (!volcengineVodConfig.playbackBaseUrl) {
    throw new Error('画质增强已完成，但缺少 VOLCENGINE_VOD_PLAYBACK_BASE_URL，无法获取增强视频');
  }
  const normalized = storeUri.trim().replace(/^\/+/, '');
  const separator = normalized.indexOf('/');
  const fileName = separator >= 0 ? normalized.slice(separator + 1) : normalized;
  if (!fileName) {
    throw new Error('火山引擎画质增强结果缺少有效 StoreUri');
  }
  const encodedPath = fileName.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${volcengineVodConfig.playbackBaseUrl}/${encodedPath}`;
}

async function failEnhancementTask(taskId: string, reason: string) {
  const task = contentRepository.findVideoTask(taskId);
  if (!task) return null;
  const result = enhancementResult(task);
  const context = enhancementContext(task);
  const reservationId = String(context.enhancementBillingReservationId || '').trim();
  let billingReleased = false;
  if (reservationId) {
    try {
      billingReleased = releaseVideoUpscaleCredits({
        reservationId,
        userId: task.userId,
        taskId: task.id,
        reason,
      });
    } catch (error) {
      logger.error('video enhancement billing release failed', {
        taskId,
        reservationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const failedResult: VideoGenerationResult = {
    ...(result || {
      version: 1,
      taskId,
      duration: '',
      ratio: task.aspectRatio,
      generatedAt: new Date().toISOString(),
      status: 'failed',
    }),
    status: 'failed',
    errorMessage: reason,
    renderStatus: 'failed',
    videoUrl: null,
    generatedAt: new Date().toISOString(),
  };
  updateEnhancementTask({
    task,
    context: {
      ...context,
      ...(billingReleased ? { enhancementBillingStatus: 'released' } : {}),
    },
    result: failedResult,
  });
  markFinishedVideoAssetFailed(result?.assetId, reason);
  return contentRepository.markVideoTaskFailed(taskId, reason);
}

async function completeEnhancementTask(task: VideoGenerationTask, worker: EnhancementWorkerResult) {
  const context = enhancementContext(task);
  const result = enhancementResult(task);
  const storeUri = String(worker.storeUri || '').trim();
  if (!storeUri) {
    throw new Error('火山引擎画质增强任务已完成，但未返回 StoreUri');
  }
  const remoteVideoUrl = playbackUrlFromStoreUri(storeUri);
  const resolution = String(context.enhancementResolution || '1080p');
  const reservationId = String(context.enhancementBillingReservationId || '').trim();
  const billingRecord = reservationId
    ? settleVideoUpscaleCredits({
      reservationId,
      userId: task.userId,
      taskId: task.id,
      resolution,
      runId: result?.jobId,
      requestSnapshot: {
        sourceAssetId: context.sourceAssetId,
        sourceVid: context.sourceVid,
        resolution,
        config: context.enhancementConfig || 'aigc',
      },
      responseSnapshot: {
        storeUri,
        remoteVideoUrl,
      },
    })
    : null;
  const finishedAsset = createFinishedVideoAsset({
    userId: task.userId,
    taskId: task.id,
    title: task.title,
    videoUrl: remoteVideoUrl,
    provider: 'volcengine-vod',
    model: 'moe-aigc-enhance',
    ratio: result?.ratio || '',
    duration: result?.duration || '',
    mode: 'video_upscale',
    materialContext: {
      sourceAssetId: context.sourceAssetId,
      sourceVid: context.sourceVid,
      resolution,
    },
    assetId: result?.assetId,
  });
  contentRepository.updateFinishedVideoAssetFile(finishedAsset.id, {
    metadata: {
      ...finishedAsset.metadata,
      generatedBy: 'video_enhancement',
      generationStatus: 'completed',
      sourceAssetId: context.sourceAssetId,
      sourceVid: context.sourceVid,
      enhancementRunId: result?.jobId,
      enhancementConfig: 'aigc',
      enhancementResolution: resolution,
      storeUri,
    },
  });
  const completedResult: VideoGenerationResult = {
    ...(result || {
      version: 1,
      taskId: task.id,
      duration: '',
      ratio: task.aspectRatio,
      generatedAt: new Date().toISOString(),
      status: 'completed',
    }),
    status: 'completed',
    provider: 'volcengine-vod',
    model: 'moe-aigc-enhance',
    videoUrl: remoteVideoUrl,
    assetId: finishedAsset.id,
    renderMode: 'provider_generation',
    renderStatus: 'rendered',
    generatedAt: new Date().toISOString(),
  };
  updateEnhancementTask({
    task,
    context: {
      ...context,
      enhancementStatus: 'completed',
      enhancementStoreUri: storeUri,
      remoteGeneratedVideoUrl: remoteVideoUrl,
      ...(billingRecord ? {
        enhancementBillingStatus: 'settled',
        enhancementBillingRecordId: billingRecord.id,
        enhancementBillingCredits: billingRecord.creditCost,
      } : {}),
    },
    result: completedResult,
  });
  const completedTask = contentRepository.markVideoTaskGenerated(task.id, remoteVideoUrl) || task;
  mirrorGeneratedVideoToLocalInBackground({
    taskId: task.id,
    userId: task.userId,
    remoteVideoUrl,
    assetId: finishedAsset.id,
    provider: 'volcengine-vod',
    model: 'moe-aigc-enhance',
  });
  return completedTask;
}

export async function refreshVideoEnhancementTask(task: VideoGenerationTask) {
  if (task.status !== 'generating' || enhancementContext(task).mode !== 'video_upscale') {
    return task;
  }
  const result = enhancementResult(task);
  const runId = String(result?.jobId || '').trim();
  if (!runId) return task;
  const worker = await callEnhancementWorker('/vod/enhancement/get', { runId });
  const status = String(worker.status || '').trim().toLowerCase();
  if (failedStatuses.has(status)) {
    return failEnhancementTask(task.id, worker.errorMessage || `视频高清放大失败：${worker.status || 'unknown'}`);
  }
  if (completedStatuses.has(status)) {
    return completeEnhancementTask(task, worker);
  }
  if (result?.status !== 'running') {
    const runningResult: VideoGenerationResult = {
      ...(result || {
        version: 1,
        taskId: task.id,
        duration: '',
        ratio: task.aspectRatio,
        generatedAt: new Date().toISOString(),
        status: 'running',
      }),
      status: 'running',
      renderStatus: 'rendering',
    };
    return updateEnhancementTask({ task, context: enhancementContext(task), result: runningResult });
  }
  return task;
}

export async function pollVideoEnhancementTask(taskId: string) {
  if (runningEnhancementTaskIds.has(taskId)) return;
  runningEnhancementTaskIds.add(taskId);
  try {
    const intervalMs = Math.max(1000, Number(process.env.VIDEO_ENHANCEMENT_POLL_INTERVAL_MS || 10000));
    const maxAttempts = Math.max(1, Number(
      process.env.VIDEO_ENHANCEMENT_POLL_MAX_ATTEMPTS || defaultVideoPollMaxAttempts(intervalMs),
    ));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = contentRepository.findVideoTask(taskId);
      if (!task || task.status !== 'generating') return;
      const refreshed = await refreshVideoEnhancementTask(task);
      if (!refreshed || refreshed.status !== 'generating') return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    await failEnhancementTask(taskId, '视频高清放大处理超时，请稍后重试');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('video enhancement polling failed', { taskId, reason });
    await failEnhancementTask(taskId, reason);
  } finally {
    runningEnhancementTaskIds.delete(taskId);
  }
}

export async function createVideoEnhancementTask(payload: CreateVideoEnhancementPayload) {
  if (!volcengineVodConfig.playbackBaseUrl) {
    throw new Error('视频高清放大尚未配置播放域名，请设置 VOLCENGINE_VOD_PLAYBACK_BASE_URL');
  }
  try {
    const playbackUrl = new URL(volcengineVodConfig.playbackBaseUrl);
    if (!['http:', 'https:'].includes(playbackUrl.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error('VOLCENGINE_VOD_PLAYBACK_BASE_URL 不是有效的 HTTP(S) 地址');
  }
  let sourceAsset = contentRepository.findAsset(payload.sourceAssetId);
  if (!sourceAsset || sourceAsset.userId !== payload.userId) {
    throw new Error('待放大视频素材不存在');
  }
  if (!sourceAsset.mimeType.startsWith('video/')) {
    throw new Error('请选择视频素材进行高清放大');
  }
  sourceAsset = await ensureContentAssetLocalFile(sourceAsset);
  await assertCreateVideoSourceDuration(sourceAsset);
  const resolution = String(payload.resolution || '1080p').toLowerCase();
  if (!['1080p', '2k', '4k'].includes(resolution)) {
    throw new Error(`不支持的目标分辨率：${resolution}`);
  }
  const fileSizeBytes = sourceAsset.fileSize || (await stat(sourceAsset.filePath)).size;
  const aspectRatio = await resolveSourceVideoAspectRatio(sourceAsset);
  const videoUpscaleCredits = estimateVideoUpscaleCredits();
  const vodUploadCredits = estimateVodUploadCredits(fileSizeBytes);
  assertSufficientStepCredits({
    userId: payload.userId,
    requiredCredits: videoUpscaleCredits + vodUploadCredits,
    step: 'video_upscale',
    stepLabel: '视频高清放大（含 VOD 上传）',
  });
  const title = `${path.parse(sourceAsset.name || sourceAsset.originalFileName).name || '视频'}-高清${resolution.toUpperCase()}`;
  const task = contentRepository.createParsedVideoTask({
    userId: payload.userId,
    sourceUrl: sourceAsset.fileUrl,
    title,
    prompt: `使用火山引擎 VOD AIGC 画质增强至 ${resolution}`,
    parseResult: { ...emptyVideoParseResult },
    aspectRatio,
    expertContext: {
      mode: 'video_upscale',
      ratio: aspectRatio,
      sourceAssetId: sourceAsset.id,
      enhancementResolution: resolution,
      enhancementConfig: 'aigc',
      enhancementStatus: 'uploading',
      createdAt: new Date().toISOString(),
    },
  });
  if (!task) throw new Error('高清放大任务创建失败');
  let reservationId = '';
  let pendingResult: VideoGenerationResult;
  try {
    const billing = reserveVideoUpscaleCredits({
      userId: payload.userId,
      taskId: task.id,
      resolution,
    });
    reservationId = billing.reservation.id;
    const pendingAsset = createPendingFinishedVideoAsset({
      userId: payload.userId,
      taskId: task.id,
      title,
      provider: 'volcengine-vod',
      model: 'moe-aigc-enhance',
      ratio: aspectRatio,
      duration: '',
      mode: 'video_upscale',
      materialContext: { sourceAssetId: sourceAsset.id, resolution },
    });
    pendingResult = {
      version: 1,
      taskId: task.id,
      sourceType: 'video_enhancement',
      status: 'pending',
      provider: 'volcengine-vod',
      model: 'moe-aigc-enhance',
      videoUrl: null,
      duration: '',
      ratio: aspectRatio,
      assetId: pendingAsset.id,
      renderMode: 'provider_generation',
      renderStatus: 'queued',
      generatedAt: new Date().toISOString(),
    };
    updateEnhancementTask({
      task,
      context: {
        ...enhancementContext(task),
        enhancementBillingReservationId: reservationId,
        enhancementBillingStatus: 'reserved',
        enhancementBillingCredits: billing.reservation.reservedCredits,
      },
      result: pendingResult,
    });
    contentRepository.markVideoTaskGenerating(task.id);
  } catch (error) {
    if (reservationId) {
      releaseVideoUpscaleCredits({
        reservationId,
        userId: payload.userId,
        taskId: task.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    contentRepository.markVideoTaskFailed(task.id, error instanceof Error ? error.message : String(error));
    throw error;
  }

  void (async () => {
    try {
      const vod = await uploadLocalVideoToVodWithWorker({
        filePath: sourceAsset.filePath,
        originalFileName: sourceAsset.originalFileName || path.basename(sourceAsset.filePath),
        title: sourceAsset.name,
        fileSizeBytes,
        taskId: task.id,
        userId: payload.userId,
      });
      const latest = contentRepository.findVideoTask(task.id);
      if (!latest || latest.status !== 'generating') return;
      const worker = await callEnhancementWorker('/vod/enhancement/start', {
        vid: vod.vid,
        spaceName: vod.spaceName,
        resolution,
        config: 'aigc',
        repairStyle: 1,
        repairStrength: 0,
      });
      if (!worker.runId) throw new Error('视频高清放大任务未返回 RunId');
      const submittedResult: VideoGenerationResult = {
        ...(enhancementResult(latest) || pendingResult),
        status: 'running',
        jobId: worker.runId,
        renderStatus: 'rendering',
      };
      updateEnhancementTask({
        task: latest,
        context: {
          ...enhancementContext(latest),
          sourceVid: vod.vid,
          vodSpaceName: vod.spaceName,
          enhancementRunId: worker.runId,
          enhancementStatus: 'running',
        },
        result: submittedResult,
      });
      void pollVideoEnhancementTask(task.id);
    } catch (error) {
      await failEnhancementTask(task.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return contentRepository.findVideoTask(task.id) || task;
}

export function resumeVideoEnhancementTasks() {
  contentRepository.listGeneratingVideoTasks()
    .filter((task) => enhancementContext(task).mode === 'video_upscale')
    .forEach((task) => {
      const runId = String(enhancementResult(task)?.jobId || '').trim();
      if (runId) {
        void pollVideoEnhancementTask(task.id);
      } else {
        void failEnhancementTask(task.id, '服务重启前高清放大任务尚未成功提交，请重试');
      }
    });
}
