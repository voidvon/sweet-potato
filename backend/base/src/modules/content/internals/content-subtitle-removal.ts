import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { volcengineVodConfig } from '../../../config/env.js';
import { createTraceId, logger } from '../../../shared/logger.js';
import { contentRepository, emptyVideoParseResult } from '../content.repository.js';
import type {
  CreateSubtitleRemovalPayload,
  SubtitleRemovalLocation,
  VideoGenerationResult,
  VideoGenerationTask,
} from '../content.types.js';
import {
  createFinishedVideoAsset,
  createPendingFinishedVideoAsset,
  markFinishedVideoAssetFailed,
} from './content-image-assets.js';
import { resolveSourceVideoAspectRatio } from './content-video-aspect-ratio.js';
import { mirrorGeneratedVideoToLocalInBackground } from './content-video-local-mirror.js';
import { defaultVideoPollMaxAttempts } from './content-video-polling.js';
import { aiWorkerUrl } from './content-viral-analysis.js';
import { uploadLocalVideoToVodWithWorker } from './content-viral-director.js';

type SubtitleRemovalWorkerResult = {
  ok?: boolean;
  message?: string;
  runId?: string;
  status?: string;
  fileName?: string;
  vid?: string;
  duration?: number;
  errorMessage?: string;
};

const runningTaskIds = new Set<string>();
const completedStatuses = new Set(['success', 'succeeded', 'completed', 'complete', 'done']);
const failedStatuses = new Set(['failed', 'fail', 'error', 'canceled', 'cancelled']);

function removalResult(task: VideoGenerationTask) {
  const value = task.editableParseResult.videoGenerationResult || task.expertContext?.videoGenerationResult;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as VideoGenerationResult
    : undefined;
}

function removalContext(task: VideoGenerationTask) {
  return task.expertContext && typeof task.expertContext === 'object' ? task.expertContext : {};
}

function updateRemovalTask(input: {
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

async function callSubtitleRemovalWorker(pathname: string, payload: Record<string, unknown>) {
  const traceId = createTraceId('vod-subtitle-erase');
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`字幕擦除服务不可访问：${error instanceof Error ? error.message : '连接失败'}`);
  }
  const text = await response.text();
  let data: SubtitleRemovalWorkerResult = {};
  try {
    data = text ? JSON.parse(text) as SubtitleRemovalWorkerResult : {};
  } catch {
    throw new Error('字幕擦除服务返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `字幕擦除服务请求失败（${response.status}）`);
  }
  return data;
}

function playbackUrlFromFileName(fileName: string) {
  if (!volcengineVodConfig.playbackBaseUrl) {
    throw new Error('字幕擦除已完成，但缺少 VOLCENGINE_VOD_PLAYBACK_BASE_URL，无法获取产物视频');
  }
  const normalized = fileName.trim().replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('火山引擎字幕擦除结果缺少有效 FileName');
  }
  const encodedPath = normalized.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${volcengineVodConfig.playbackBaseUrl}/${encodedPath}`;
}

async function failSubtitleRemovalTask(taskId: string, reason: string) {
  const task = contentRepository.findVideoTask(taskId);
  if (!task) return null;
  const result = removalResult(task);
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
  updateRemovalTask({ task, context: removalContext(task), result: failedResult });
  markFinishedVideoAssetFailed(result?.assetId, reason);
  return contentRepository.markVideoTaskFailed(taskId, reason);
}

async function completeSubtitleRemovalTask(task: VideoGenerationTask, worker: SubtitleRemovalWorkerResult) {
  const context = removalContext(task);
  const result = removalResult(task);
  const fileName = String(worker.fileName || '').trim();
  if (!fileName) {
    throw new Error('火山引擎字幕擦除任务已完成，但未返回 FileName');
  }
  const remoteVideoUrl = playbackUrlFromFileName(fileName);
  const mode = String(context.subtitleRemovalMode || 'auto');
  const finishedAsset = createFinishedVideoAsset({
    userId: task.userId,
    taskId: task.id,
    title: task.title,
    videoUrl: remoteVideoUrl,
    provider: 'volcengine-vod',
    model: 'subtitle-erase',
    ratio: result?.ratio || '',
    duration: worker.duration ? `${worker.duration}s` : result?.duration || '',
    mode: 'subtitle_removal',
    materialContext: {
      sourceAssetId: context.sourceAssetId,
      sourceVid: context.sourceVid,
      subtitleRemovalMode: mode,
    },
    assetId: result?.assetId,
  });
  contentRepository.updateFinishedVideoAssetFile(finishedAsset.id, {
    metadata: {
      ...finishedAsset.metadata,
      generatedBy: 'video_subtitle_removal',
      generationStatus: 'completed',
      sourceAssetId: context.sourceAssetId,
      sourceVid: context.sourceVid,
      subtitleRemovalRunId: result?.jobId,
      subtitleRemovalMode: mode,
      outputVid: worker.vid,
      fileName,
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
    model: 'subtitle-erase',
    videoUrl: remoteVideoUrl,
    duration: worker.duration ? `${worker.duration}s` : result?.duration || '',
    assetId: finishedAsset.id,
    renderMode: 'provider_generation',
    renderStatus: 'rendered',
    generatedAt: new Date().toISOString(),
  };
  updateRemovalTask({
    task,
    context: {
      ...context,
      subtitleRemovalStatus: 'completed',
      subtitleRemovalFileName: fileName,
      outputVid: worker.vid,
      remoteGeneratedVideoUrl: remoteVideoUrl,
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
    model: 'subtitle-erase',
  });
  return completedTask;
}

export async function refreshSubtitleRemovalTask(task: VideoGenerationTask) {
  if (task.status !== 'generating' || removalContext(task).mode !== 'subtitle_removal') {
    return task;
  }
  const result = removalResult(task);
  const runId = String(result?.jobId || '').trim();
  if (!runId) return task;
  const worker = await callSubtitleRemovalWorker('/vod/subtitle-removal/get', { runId });
  const status = String(worker.status || '').trim().toLowerCase();
  if (failedStatuses.has(status)) {
    return failSubtitleRemovalTask(task.id, worker.errorMessage || `字幕擦除失败：${worker.status || 'unknown'}`);
  }
  if (completedStatuses.has(status)) {
    return completeSubtitleRemovalTask(task, worker);
  }
  if (result?.status !== 'running') {
    return updateRemovalTask({
      task,
      context: removalContext(task),
      result: { ...result, status: 'running', renderStatus: 'rendering' } as VideoGenerationResult,
    });
  }
  return task;
}

export async function pollSubtitleRemovalTask(taskId: string) {
  if (runningTaskIds.has(taskId)) return;
  runningTaskIds.add(taskId);
  try {
    const intervalMs = Math.max(1000, Number(process.env.VIDEO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS || 10000));
    const maxAttempts = Math.max(1, Number(
      process.env.VIDEO_SUBTITLE_REMOVAL_POLL_MAX_ATTEMPTS || defaultVideoPollMaxAttempts(intervalMs),
    ));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = contentRepository.findVideoTask(taskId);
      if (!task || task.status !== 'generating') return;
      const refreshed = await refreshSubtitleRemovalTask(task);
      if (!refreshed || refreshed.status !== 'generating') return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    await failSubtitleRemovalTask(taskId, '字幕擦除处理超时，请稍后重试');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('subtitle removal polling failed', { taskId, reason });
    await failSubtitleRemovalTask(taskId, reason);
  } finally {
    runningTaskIds.delete(taskId);
  }
}

function validatePlaybackBaseUrl() {
  if (!volcengineVodConfig.playbackBaseUrl) {
    throw new Error('字幕擦除尚未配置播放域名，请设置 VOLCENGINE_VOD_PLAYBACK_BASE_URL');
  }
  try {
    const playbackUrl = new URL(volcengineVodConfig.playbackBaseUrl);
    if (!['http:', 'https:'].includes(playbackUrl.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error('VOLCENGINE_VOD_PLAYBACK_BASE_URL 不是有效的 HTTP(S) 地址');
  }
}

function normalizeLocations(payload: CreateSubtitleRemovalPayload) {
  const locations = Array.isArray(payload.locations) ? payload.locations : [];
  locations.forEach(validateLocation);
  if (payload.mode !== 'auto' && locations.length === 0) {
    throw new Error('指定区域擦除必须至少包含一个有效区域');
  }
  return locations;
}

function validateLocation(location: SubtitleRemovalLocation) {
  const values = [location.topLeftX, location.topLeftY, location.bottomRightX, location.bottomRightY];
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    || location.topLeftX >= location.bottomRightX
    || location.topLeftY >= location.bottomRightY) {
    throw new Error('字幕擦除区域坐标无效');
  }
}

function normalizeClipFilter(payload: CreateSubtitleRemovalPayload) {
  const filter = payload.clipFilter;
  if (filter?.mode !== 'selected' && filter?.mode !== 'skip') {
    return { mode: 'all' as const, clips: [] };
  }
  const rawClips = Array.isArray(filter.clips)
    ? filter.clips
    : [{ start: filter.start, end: filter.end }];
  const clips = rawClips.map((clip) => ({
    start: Number(clip?.start),
    end: Number(clip?.end),
  }));
  if (clips.length === 0 || clips.some((clip) => (
    !Number.isFinite(clip.start)
    || !Number.isFinite(clip.end)
    || clip.start < 0
    || clip.end <= clip.start
  ))) {
    throw new Error('字幕擦除时间范围无效');
  }
  return { mode: filter.mode, clips };
}

export async function createSubtitleRemovalTask(payload: CreateSubtitleRemovalPayload) {
  validatePlaybackBaseUrl();
  const sourceAsset = contentRepository.findAsset(payload.sourceAssetId);
  if (!sourceAsset || sourceAsset.userId !== payload.userId) throw new Error('待擦除字幕的视频素材不存在');
  if (!sourceAsset.mimeType.startsWith('video/')) throw new Error('请选择视频素材进行字幕擦除');
  if (!sourceAsset.filePath || !existsSync(sourceAsset.filePath)) throw new Error('源视频尚未保存到本地，请稍后重试');
  const mode = payload.mode === 'auto_region' || payload.mode === 'manual' ? payload.mode : 'auto';
  const contentType = payload.contentType === 'text' ? 'text' : 'subtitle';
  const locations = normalizeLocations({ ...payload, mode });
  const clipFilter = normalizeClipFilter(payload);
  const aspectRatio = await resolveSourceVideoAspectRatio(sourceAsset);

  const modeLabel = mode === 'auto' ? '智能识别' : mode === 'auto_region' ? '智能框选' : '强制框选';
  const title = `${path.parse(sourceAsset.name || sourceAsset.originalFileName).name || '视频'}-字幕擦除`;
  const task = contentRepository.createParsedVideoTask({
    userId: payload.userId,
    sourceUrl: sourceAsset.fileUrl,
    title,
    prompt: `使用火山引擎 VOD ${modeLabel}擦除字幕`,
    parseResult: { ...emptyVideoParseResult },
    aspectRatio,
    expertContext: {
      mode: 'subtitle_removal',
      ratio: aspectRatio,
      sourceAssetId: sourceAsset.id,
      subtitleRemovalMode: mode,
      subtitleRemovalContentType: contentType,
      subtitleRemovalLocations: locations,
      subtitleRemovalClipFilter: clipFilter,
      subtitleRemovalStatus: 'uploading',
      createdAt: new Date().toISOString(),
    },
  });
  if (!task) throw new Error('字幕擦除任务创建失败');
  const pendingAsset = createPendingFinishedVideoAsset({
    userId: payload.userId,
    taskId: task.id,
    title,
    provider: 'volcengine-vod',
    model: 'subtitle-erase',
    ratio: aspectRatio,
    duration: '',
    mode: 'subtitle_removal',
    materialContext: { sourceAssetId: sourceAsset.id, mode, contentType, locations, clipFilter },
  });
  const pendingResult: VideoGenerationResult = {
    version: 1,
    taskId: task.id,
    sourceType: 'subtitle_removal',
    status: 'pending',
    provider: 'volcengine-vod',
    model: 'subtitle-erase',
    videoUrl: null,
    duration: '',
    ratio: aspectRatio,
    assetId: pendingAsset.id,
    renderMode: 'provider_generation',
    renderStatus: 'queued',
    generatedAt: new Date().toISOString(),
  };
  updateRemovalTask({ task, context: removalContext(task), result: pendingResult });
  contentRepository.markVideoTaskGenerating(task.id);

  void (async () => {
    try {
      const fileSizeBytes = sourceAsset.fileSize || (await stat(sourceAsset.filePath)).size;
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
      const worker = await callSubtitleRemovalWorker('/vod/subtitle-removal/start', {
        vid: vod.vid,
        spaceName: vod.spaceName,
        mode,
        contentType,
        locations,
        clipFilter,
      });
      if (!worker.runId) throw new Error('字幕擦除任务未返回 RunId');
      const submittedResult: VideoGenerationResult = {
        ...(removalResult(latest) || pendingResult),
        status: 'running',
        jobId: worker.runId,
        renderStatus: 'rendering',
      };
      updateRemovalTask({
        task: latest,
        context: {
          ...removalContext(latest),
          sourceVid: vod.vid,
          vodSpaceName: vod.spaceName,
          subtitleRemovalRunId: worker.runId,
          subtitleRemovalStatus: 'running',
        },
        result: submittedResult,
      });
      void pollSubtitleRemovalTask(task.id);
    } catch (error) {
      await failSubtitleRemovalTask(task.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return contentRepository.findVideoTask(task.id) || task;
}

export function resumeSubtitleRemovalTasks() {
  contentRepository.listGeneratingVideoTasks()
    .filter((task) => removalContext(task).mode === 'subtitle_removal')
    .forEach((task) => {
      const runId = String(removalResult(task)?.jobId || '').trim();
      if (runId) void pollSubtitleRemovalTask(task.id);
      else void failSubtitleRemovalTask(task.id, '服务重启前字幕擦除任务尚未成功提交，请重试');
    });
}
