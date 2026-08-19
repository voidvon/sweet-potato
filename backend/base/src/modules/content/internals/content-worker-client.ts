import { existsSync, statSync } from 'node:fs';
import { createTraceId, logger } from '../../../shared/logger.js';
import { recordVodUploadUsage } from '../../billing/billing.service.js';
import { publishContentEvent } from '../content.events.js';
import { errorLogContext } from './content-common.js';

export type VodUploadWorkerResult = {
  ok?: boolean;
  message?: string;
  vid?: string;
  spaceName?: string;
  posterUri?: string;
  requestId?: string;
  sourceInfo?: {
    fileName?: string;
    height?: number;
    width?: number;
  };
} & Record<string, unknown>;

export function aiWorkerUrl() {
  return (process.env.PYTHON_AI_WORKER_URL || 'http://127.0.0.1:7075').replace(/\/+$/, '');
}

export async function uploadLocalVideoToVodWithWorker(input: {
  filePath: string;
  originalFileName: string;
  title: string;
  fileSizeBytes: number;
  taskId?: string;
  userId?: string;
}) {
  const traceId = createTraceId('vod-upload');
  logger.info('video worker VOD upload started', {
    traceId,
    filePath: input.filePath,
    fileName: input.originalFileName,
    workerUrl: aiWorkerUrl(),
  });
  const resolvedFileSizeBytes = input.fileSizeBytes > 0
    ? input.fileSizeBytes
    : (existsSync(input.filePath) ? statSync(input.filePath).size : 0);
  let response: Response;
  let lastProgress = -1;
  const publishProgress = (progress: number, message = '视频正在上传中..') => {
    if (!input.userId || !input.taskId || progress === lastProgress) {
      return;
    }
    lastProgress = progress;
    publishContentEvent({
      type: 'video-generation-status',
      userId: input.userId,
      taskId: input.taskId,
      phase: 'vod-uploading',
      status: 'running',
      progress,
      message,
      at: new Date().toISOString(),
    });
  };
  const progressTimer = input.userId && input.taskId ? setInterval(() => {
    void (async () => {
      try {
        const progressResponse = await fetch(`${aiWorkerUrl()}/vod/upload/progress?uploadId=${encodeURIComponent(traceId)}`);
        const progressData = await progressResponse.json() as { progress?: unknown; message?: unknown };
        const progress = Number(progressData.progress);
        if (Number.isFinite(progress)) {
          publishProgress(Math.max(0, Math.min(100, Math.round(progress))), typeof progressData.message === 'string' ? progressData.message : '视频正在上传中..');
        }
      } catch {
        // Progress polling is best-effort; the upload request remains the source of truth.
      }
    })();
  }, 1000) : undefined;
  try {
    response = await fetch(`${aiWorkerUrl()}/vod/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Trace-Id': traceId },
      body: JSON.stringify({
        filePath: input.filePath,
        fileName: input.originalFileName,
        title: input.title,
        uploadId: traceId,
      }),
    });
  } catch (error) {
    logger.error('video worker VOD upload connection failed', {
      traceId,
      fileName: input.originalFileName,
      error: errorLogContext(error),
    });
    throw new Error(`VOD 上传失败：Python AI Worker 未启动或不可访问（${error instanceof Error ? error.message : '连接失败'}）`);
  } finally {
    if (progressTimer) {
      clearInterval(progressTimer);
    }
  }
  const text = await response.text();
  let data: VodUploadWorkerResult = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('VOD 上传失败：Python AI Worker 返回了无法解析的响应');
  }
  if (!response.ok || data.ok === false || !data.vid) {
    logger.warn('video worker VOD upload returned failure', {
      traceId,
      status: response.status,
      message: data.message,
      bodyPreview: text.slice(0, 1000),
    });
    throw new Error(data.message || `VOD 上传失败：Python AI Worker 处理失败（${response.status}）`);
  }
  const uploaded = {
    vid: data.vid || '',
    spaceName: data.spaceName || '',
    posterUri: data.posterUri || '',
    requestId: data.requestId || '',
    sourceInfo: data.sourceInfo || {},
  };
  if (input.userId) {
    recordVodUploadUsage({
      userId: input.userId,
      sourceType: 'vod_upload',
      sourceId: input.taskId || input.filePath,
      taskId: input.taskId,
      fileSizeBytes: resolvedFileSizeBytes,
      requestSnapshot: {
        originalFileName: input.originalFileName,
        title: input.title,
        fileSizeBytes: resolvedFileSizeBytes,
      },
      responseSnapshot: {
        vid: uploaded.vid,
        spaceName: uploaded.spaceName,
        requestId: uploaded.requestId,
      },
    });
  }
  publishProgress(100, '视频上传完成');
  logger.info('video worker VOD upload completed', {
    traceId,
    fileName: input.originalFileName,
    vid: uploaded.vid,
    requestId: uploaded.requestId,
  });
  return uploaded;
}
