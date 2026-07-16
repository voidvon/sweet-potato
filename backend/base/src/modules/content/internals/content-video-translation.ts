import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { volcengineVodConfig } from '../../../config/env.js';
import { createTraceId, logger } from '../../../shared/logger.js';
import { contentRepository, emptyVideoParseResult } from '../content.repository.js';
import type {
  CreateVideoTranslationPayload,
  VideoGenerationResult,
  VideoGenerationTask,
  VideoTranslationType,
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

type TranslationWorkerResult = {
  ok?: boolean;
  message?: string;
  projectId?: string;
  projectVersion?: string;
  status?: string;
  errorMessage?: string;
  outputVideo?: {
    url?: string;
    fileName?: string;
    vid?: string;
    durationSecond?: number;
  };
};

const runningTaskIds = new Set<string>();
const completedStatuses = new Set(['processsucceed', 'exportsucceed']);
const failedStatuses = new Set(['processfailed', 'exportfailed']);
const sourceLanguages = new Set(['zh', 'en']);
const targetLanguages = new Set(['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt', 'it', 'id', 'vi', 'th', 'ar', 'tr']);

function translationResult(task: VideoGenerationTask) {
  const value = task.editableParseResult.videoGenerationResult || task.expertContext?.videoGenerationResult;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as VideoGenerationResult
    : undefined;
}

function translationContext(task: VideoGenerationTask) {
  return task.expertContext && typeof task.expertContext === 'object' ? task.expertContext : {};
}

function updateTranslationTask(input: {
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

async function callTranslationWorker(pathname: string, payload: Record<string, unknown>) {
  const traceId = createTraceId('vod-video-translation');
  let response: Response;
  try {
    response = await fetch(`${aiWorkerUrl()}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`视频翻译服务不可访问：${error instanceof Error ? error.message : '连接失败'}`);
  }
  const text = await response.text();
  let data: TranslationWorkerResult = {};
  try {
    data = text ? JSON.parse(text) as TranslationWorkerResult : {};
  } catch {
    throw new Error('视频翻译服务返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `视频翻译服务请求失败（${response.status}）`);
  }
  return data;
}

function outputVideoUrl(output: NonNullable<TranslationWorkerResult['outputVideo']>) {
  const directUrl = String(output.url || '').trim();
  if (directUrl) {
    try {
      const parsed = new URL(directUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch {
      throw new Error('火山引擎视频翻译结果返回了无效的播放 URL');
    }
  }
  const fileName = String(output.fileName || '').trim().replace(/^\/+/, '');
  if (!fileName) throw new Error('火山引擎视频翻译结果缺少播放 URL 和 FileName');
  if (!volcengineVodConfig.playbackBaseUrl) {
    throw new Error('视频翻译已完成，但缺少 VOLCENGINE_VOD_PLAYBACK_BASE_URL，无法获取产物视频');
  }
  const encodedPath = fileName.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${volcengineVodConfig.playbackBaseUrl}/${encodedPath}`;
}

async function failVideoTranslationTask(taskId: string, reason: string) {
  const task = contentRepository.findVideoTask(taskId);
  if (!task) return null;
  const result = translationResult(task);
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
  updateTranslationTask({ task, context: translationContext(task), result: failedResult });
  markFinishedVideoAssetFailed(result?.assetId, reason);
  return contentRepository.markVideoTaskFailed(taskId, reason);
}

async function completeVideoTranslationTask(task: VideoGenerationTask, worker: TranslationWorkerResult) {
  const context = translationContext(task);
  const result = translationResult(task);
  const output = worker.outputVideo;
  if (!output) throw new Error('火山引擎视频翻译任务已完成，但未返回输出视频');
  const remoteVideoUrl = outputVideoUrl(output);
  const duration = Number(output.durationSecond);
  const durationLabel = Number.isFinite(duration) && duration > 0 ? `${duration}s` : result?.duration || '';
  const finishedAsset = createFinishedVideoAsset({
    userId: task.userId,
    taskId: task.id,
    title: task.title,
    videoUrl: remoteVideoUrl,
    provider: 'volcengine-vod',
    model: 'ai-video-translation',
    ratio: result?.ratio || '',
    duration: durationLabel,
    mode: 'video_translation',
    materialContext: {
      sourceAssetId: context.sourceAssetId,
      sourceVid: context.sourceVid,
      sourceLanguage: context.videoTranslationSourceLanguage,
      targetLanguage: context.videoTranslationTargetLanguage,
      translationTypes: context.videoTranslationTypes,
    },
    assetId: result?.assetId,
  });
  contentRepository.updateFinishedVideoAssetFile(finishedAsset.id, {
    metadata: {
      ...finishedAsset.metadata,
      generatedBy: 'video_translation',
      generationStatus: 'completed',
      sourceAssetId: context.sourceAssetId,
      sourceVid: context.sourceVid,
      translationProjectId: result?.jobId,
      outputVid: output.vid,
      outputFileName: output.fileName,
      sourceLanguage: context.videoTranslationSourceLanguage,
      targetLanguage: context.videoTranslationTargetLanguage,
      translationTypes: context.videoTranslationTypes,
    },
  });
  const completedResult: VideoGenerationResult = {
    ...(result || {
      version: 1,
      taskId: task.id,
      duration: durationLabel,
      ratio: task.aspectRatio,
      generatedAt: new Date().toISOString(),
      status: 'completed',
    }),
    status: 'completed',
    provider: 'volcengine-vod',
    model: 'ai-video-translation',
    videoUrl: remoteVideoUrl,
    duration: durationLabel,
    assetId: finishedAsset.id,
    renderMode: 'provider_generation',
    renderStatus: 'rendered',
    generatedAt: new Date().toISOString(),
  };
  updateTranslationTask({
    task,
    context: {
      ...context,
      videoTranslationStatus: worker.status,
      outputVid: output.vid,
      outputFileName: output.fileName,
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
    model: 'ai-video-translation',
  });
  return completedTask;
}

export async function refreshVideoTranslationTask(task: VideoGenerationTask) {
  const context = translationContext(task);
  if (task.status !== 'generating' || context.mode !== 'video_translation') return task;
  const result = translationResult(task);
  const projectId = String(result?.jobId || '').trim();
  if (!projectId) return task;
  const worker = await callTranslationWorker('/vod/video-translation/get', {
    projectId,
    spaceName: context.vodSpaceName,
  });
  const status = String(worker.status || '').trim().toLowerCase();
  if (failedStatuses.has(status)) {
    return failVideoTranslationTask(task.id, worker.errorMessage || `视频翻译失败：${worker.status || 'unknown'}`);
  }
  if (completedStatuses.has(status)) return completeVideoTranslationTask(task, worker);
  return updateTranslationTask({
    task,
    context: { ...context, videoTranslationStatus: worker.status || 'InProcessing' },
    result: { ...result, status: 'running', renderStatus: 'rendering' } as VideoGenerationResult,
  });
}

export async function pollVideoTranslationTask(taskId: string) {
  if (runningTaskIds.has(taskId)) return;
  runningTaskIds.add(taskId);
  try {
    const intervalMs = Math.max(1000, Number(process.env.VIDEO_TRANSLATION_POLL_INTERVAL_MS || 10000));
    const maxAttempts = Math.max(1, Number(
      process.env.VIDEO_TRANSLATION_POLL_MAX_ATTEMPTS || defaultVideoPollMaxAttempts(intervalMs),
    ));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const task = contentRepository.findVideoTask(taskId);
      if (!task || task.status !== 'generating') return;
      const refreshed = await refreshVideoTranslationTask(task);
      if (!refreshed || refreshed.status !== 'generating') return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    await failVideoTranslationTask(taskId, '视频翻译处理超时，请稍后重试');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error('video translation polling failed', { taskId, reason });
    await failVideoTranslationTask(taskId, reason);
  } finally {
    runningTaskIds.delete(taskId);
  }
}

function normalizeTranslationTypes(value: unknown): VideoTranslationType[] {
  const raw = Array.isArray(value) ? value.map(String) : [];
  const types: VideoTranslationType[] = ['subtitle'];
  if (raw.includes('voice')) types.push('voice');
  if (raw.includes('face')) types.push('face');
  if (types.includes('face') && !types.includes('voice')) {
    throw new Error('面容翻译必须同时开启语音翻译');
  }
  return types;
}

function normalizeSubtitleConfig(payload: CreateVideoTranslationPayload) {
  const input = payload.subtitleConfig && typeof payload.subtitleConfig === 'object'
    ? payload.subtitleConfig
    : { isHardSubtitle: false, isEraseSource: false };
  const config = {
    isHardSubtitle: input.isHardSubtitle === true,
    isEraseSource: input.isEraseSource === true,
    fontSize: Number(input.fontSize),
    marginL: Number(input.marginL),
    marginR: Number(input.marginR),
    marginV: Number(input.marginV),
    showLines: Number(input.showLines),
  };
  if (!config.isHardSubtitle) {
    return { isHardSubtitle: false, isEraseSource: config.isEraseSource };
  }
  if (!Number.isInteger(config.fontSize) || config.fontSize < 1 || config.fontSize > 80) {
    throw new Error('硬字幕字号必须是 1 到 80 之间的整数');
  }
  if (![config.marginL, config.marginR, config.marginV].every((value) => (
    Number.isFinite(value) && value >= 0 && value < 1
  )) || config.marginL + config.marginR >= 1) {
    throw new Error('硬字幕边距配置无效');
  }
  if (!Number.isInteger(config.showLines) || config.showLines < 0) {
    throw new Error('硬字幕最大行数必须是非负整数');
  }
  return config;
}

export async function createVideoTranslationTask(payload: CreateVideoTranslationPayload) {
  const sourceAsset = contentRepository.findAsset(payload.sourceAssetId);
  if (!sourceAsset || sourceAsset.userId !== payload.userId) throw new Error('待翻译的视频素材不存在');
  if (!sourceAsset.mimeType.startsWith('video/')) throw new Error('请选择视频素材进行翻译');
  const sourceFileName = sourceAsset.originalFileName || sourceAsset.storedFileName || sourceAsset.name;
  if (sourceAsset.mimeType.toLowerCase() !== 'video/mp4' && path.extname(sourceFileName).toLowerCase() !== '.mp4') {
    throw new Error('视频翻译仅支持 MP4 格式');
  }
  const sourceDuration = Number(sourceAsset.metadata?.duration);
  if (Number.isFinite(sourceDuration) && sourceDuration > 600) {
    throw new Error('视频翻译仅支持时长不超过 10 分钟的视频');
  }
  if (!sourceAsset.filePath || !existsSync(sourceAsset.filePath)) throw new Error('源视频尚未保存到本地，请稍后重试');
  const sourceLanguage = String(payload.sourceLanguage || '').trim().toLowerCase();
  const targetLanguage = String(payload.targetLanguage || '').trim().toLowerCase();
  if (!sourceLanguages.has(sourceLanguage)) throw new Error(`不支持的源语言：${sourceLanguage || '空'}`);
  if (!targetLanguages.has(targetLanguage)) throw new Error(`不支持的目标语言：${targetLanguage || '空'}`);
  if (sourceLanguage === targetLanguage) throw new Error('源语言和目标语言不能相同');
  const translationTypes = normalizeTranslationTypes(payload.translationTypes);
  const subtitleSource = payload.subtitleSource === 'asr' ? 'asr' : 'ocr';
  const subtitleConfig = normalizeSubtitleConfig(payload);
  const aspectRatio = await resolveSourceVideoAspectRatio(sourceAsset);
  const title = `${path.parse(sourceAsset.name || sourceAsset.originalFileName).name || '视频'}-${targetLanguage}翻译`;
  const task = contentRepository.createParsedVideoTask({
    userId: payload.userId,
    sourceUrl: sourceAsset.fileUrl,
    title,
    prompt: `使用火山引擎 VOD 将视频从 ${sourceLanguage} 翻译为 ${targetLanguage}`,
    parseResult: { ...emptyVideoParseResult },
    aspectRatio,
    expertContext: {
      mode: 'video_translation',
      ratio: aspectRatio,
      sourceAssetId: sourceAsset.id,
      videoTranslationSourceLanguage: sourceLanguage,
      videoTranslationTargetLanguage: targetLanguage,
      videoTranslationTypes: translationTypes,
      videoTranslationSubtitleSource: subtitleSource,
      videoTranslationSubtitleConfig: subtitleConfig,
      videoTranslationStatus: 'uploading',
      createdAt: new Date().toISOString(),
    },
  });
  if (!task) throw new Error('视频翻译任务创建失败');
  const pendingAsset = createPendingFinishedVideoAsset({
    userId: payload.userId,
    taskId: task.id,
    title,
    provider: 'volcengine-vod',
    model: 'ai-video-translation',
    ratio: aspectRatio,
    duration: '',
    mode: 'video_translation',
    materialContext: {
      sourceAssetId: sourceAsset.id,
      sourceLanguage,
      targetLanguage,
      translationTypes,
      subtitleSource,
      subtitleConfig,
    },
  });
  const pendingResult: VideoGenerationResult = {
    version: 1,
    taskId: task.id,
    sourceType: 'video_translation',
    status: 'pending',
    provider: 'volcengine-vod',
    model: 'ai-video-translation',
    videoUrl: null,
    duration: '',
    ratio: aspectRatio,
    assetId: pendingAsset.id,
    renderMode: 'provider_generation',
    renderStatus: 'queued',
    generatedAt: new Date().toISOString(),
  };
  updateTranslationTask({ task, context: translationContext(task), result: pendingResult });
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
      const worker = await callTranslationWorker('/vod/video-translation/start', {
        vid: vod.vid,
        spaceName: vod.spaceName,
        sourceLanguage,
        targetLanguage,
        translationTypes,
        subtitleSource,
        subtitleConfig,
      });
      if (!worker.projectId) throw new Error('视频翻译任务未返回 ProjectId');
      const submittedResult: VideoGenerationResult = {
        ...(translationResult(latest) || pendingResult),
        status: 'running',
        jobId: worker.projectId,
        renderStatus: 'rendering',
      };
      updateTranslationTask({
        task: latest,
        context: {
          ...translationContext(latest),
          sourceVid: vod.vid,
          vodSpaceName: vod.spaceName,
          videoTranslationProjectId: worker.projectId,
          videoTranslationProjectVersion: worker.projectVersion,
          videoTranslationStatus: 'InProcessing',
        },
        result: submittedResult,
      });
      void pollVideoTranslationTask(task.id);
    } catch (error) {
      await failVideoTranslationTask(task.id, error instanceof Error ? error.message : String(error));
    }
  })();
  return contentRepository.findVideoTask(task.id) || task;
}

export function resumeVideoTranslationTasks() {
  contentRepository.listGeneratingVideoTasks()
    .filter((task) => translationContext(task).mode === 'video_translation')
    .forEach((task) => {
      const projectId = String(translationResult(task)?.jobId || '').trim();
      if (projectId) void pollVideoTranslationTask(task.id);
      else void failVideoTranslationTask(task.id, '服务重启前视频翻译任务尚未成功提交，请重试');
    });
}
