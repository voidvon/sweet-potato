import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { logger } from '../../../shared/logger.js';
import { contentRepository } from '../content.repository.js';
import type { ContentAsset, VideoGenerationResult } from '../content.types.js';
import {
  contentFilePathForRelativePath,
  fileUrlForContentRelativePath,
  generatedMediaRelativePath,
} from './content-common.js';
import { isRecord, normalizeParseResult } from './content-viral-analysis.js';

type MirrorGeneratedVideoInput = {
  taskId: string;
  userId: string;
  remoteVideoUrl: string;
  assetId?: string | null;
  provider?: string;
  model?: string;
};

const runningGeneratedVideoMirrorTaskIds = new Set<string>();
const queuedGeneratedVideoMirrorTaskIds = new Set<string>();
const generatedVideoMirrorQueue: MirrorGeneratedVideoInput[] = [];
const maxGeneratedVideoMirrorConcurrency = 2;
let activeGeneratedVideoMirrorCount = 0;

function isHttpRemoteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('/files/')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function generatedVideoExtension(remoteUrl: string, contentType: string | null) {
  const normalizedContentType = (contentType || '').toLowerCase();
  if (normalizedContentType.includes('webm')) {
    return '.webm';
  }
  if (normalizedContentType.includes('quicktime') || normalizedContentType.includes('mov')) {
    return '.mov';
  }
  try {
    const ext = path.extname(new URL(remoteUrl).pathname).toLowerCase();
    if (['.mp4', '.mov', '.webm', '.m4v'].includes(ext)) {
      return ext;
    }
  } catch {
    // Fall through to the common provider default.
  }
  return '.mp4';
}

function originalVideoFileName(remoteUrl: string, fallback: string) {
  try {
    const basename = path.basename(new URL(remoteUrl).pathname);
    return decodeURIComponent(basename || fallback);
  } catch {
    return fallback;
  }
}

function localizeResultUrl(
  value: unknown,
  input: { remoteVideoUrl: string; localVideoUrl: string; mirroredAt: string },
) {
  if (!isRecord(value)) {
    return value;
  }
  const currentVideoUrl = typeof value.videoUrl === 'string' ? value.videoUrl.trim() : '';
  const currentFileUrl = typeof value.fileUrl === 'string' ? value.fileUrl.trim() : '';
  if (
    currentVideoUrl
    && currentVideoUrl !== input.remoteVideoUrl
    && currentVideoUrl !== input.localVideoUrl
    && currentFileUrl !== input.remoteVideoUrl
  ) {
    return value;
  }
  if (!currentVideoUrl && currentFileUrl && currentFileUrl !== input.remoteVideoUrl) {
    return value;
  }
  if (!currentVideoUrl && !currentFileUrl && value.status !== 'completed') {
    return value;
  }
  return {
    ...value,
    videoUrl: input.localVideoUrl,
    fileUrl: input.localVideoUrl,
    localVideoUrl: input.localVideoUrl,
    remoteVideoUrl: typeof value.remoteVideoUrl === 'string' && value.remoteVideoUrl.trim()
      ? value.remoteVideoUrl
      : input.remoteVideoUrl,
    localMirroredAt: input.mirroredAt,
  };
}

function markAssetMirrorStatus(input: {
  assetId?: string | null;
  taskId: string;
  status: 'downloading' | 'completed' | 'failed';
  remoteVideoUrl: string;
  localVideoUrl?: string;
  filePath?: string;
  storedFileName?: string;
  originalFileName?: string;
  fileSize?: number;
  reason?: string;
}) {
  const asset = input.assetId
    ? contentRepository.findAsset(input.assetId)
    : contentRepository
      .listAssets({ resourceType: 'finished_video' })
      .find((item) => item.metadata.videoTaskId === input.taskId);
  if (!asset || asset.resourceType !== 'finished_video') {
    return;
  }
  const now = new Date();
  const previousAttemptCount = Number(asset.metadata.localMirrorAttemptCount || 0);
  const attemptCount = input.status === 'failed' ? previousAttemptCount + 1 : previousAttemptCount;
  const retryDelayMs = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * Math.max(1, 2 ** Math.max(0, attemptCount - 1)));
  const nextRetryAt = input.status === 'failed'
    ? new Date(now.getTime() + retryDelayMs).toISOString()
    : undefined;
  contentRepository.updateFinishedVideoAssetFile(asset.id, {
    description: input.status === 'completed' ? '服务端已同步下载的生成成片' : asset.description,
    originalFileName: input.originalFileName ?? asset.originalFileName,
    storedFileName: input.storedFileName ?? asset.storedFileName,
    mimeType: asset.mimeType || 'video/mp4',
    fileSize: input.fileSize ?? asset.fileSize,
    filePath: input.filePath ?? asset.filePath,
    fileUrl: input.localVideoUrl ?? asset.fileUrl,
    metadata: {
      ...asset.metadata,
      generationStatus: asset.metadata.generationStatus || 'completed',
      remoteVideoUrl: input.remoteVideoUrl,
      localVideoUrl: input.localVideoUrl ?? asset.metadata.localVideoUrl,
      localMirrorStatus: input.status,
      localMirrorFailureReason: input.reason,
      localMirrorAttemptCount: attemptCount,
      localMirrorLastAttemptAt: input.status === 'downloading' ? now.toISOString() : asset.metadata.localMirrorLastAttemptAt,
      localMirrorNextRetryAt: nextRetryAt,
      localMirroredAt: input.status === 'completed' ? new Date().toISOString() : asset.metadata.localMirroredAt,
    },
  });
}

async function mirrorGeneratedVideoToLocal(input: MirrorGeneratedVideoInput) {
  const remoteVideoUrl = input.remoteVideoUrl.trim();
  if (!isHttpRemoteUrl(remoteVideoUrl)) {
    return;
  }
  const mirrorKey = `${input.taskId}:${remoteVideoUrl}`;
  if (runningGeneratedVideoMirrorTaskIds.has(mirrorKey)) {
    return;
  }
  runningGeneratedVideoMirrorTaskIds.add(mirrorKey);
  markAssetMirrorStatus({
    assetId: input.assetId,
    taskId: input.taskId,
    status: 'downloading',
    remoteVideoUrl,
  });
  let filePath = '';
  try {
    const response = await fetch(remoteVideoUrl);
    if (!response.ok) {
      throw new Error(`下载生成视频失败：HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('下载生成视频失败：响应体为空');
    }
    const extension = generatedVideoExtension(remoteVideoUrl, response.headers.get('content-type'));
    const storedFileName = `generated-video-${input.taskId}-${randomUUID()}${extension}`;
    const storedRelativePath = generatedMediaRelativePath('video', storedFileName);
    const localVideoUrl = fileUrlForContentRelativePath(storedRelativePath);
    filePath = contentFilePathForRelativePath(storedRelativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(filePath),
    );
    const fileSize = (await stat(filePath)).size;
    const mirroredAt = new Date().toISOString();
    markAssetMirrorStatus({
      assetId: input.assetId,
      taskId: input.taskId,
      status: 'completed',
      remoteVideoUrl,
      localVideoUrl,
      filePath,
      storedFileName: storedRelativePath,
      originalFileName: originalVideoFileName(remoteVideoUrl, storedFileName),
      fileSize,
    });
    const latestTask = contentRepository.markVideoTaskGenerated(input.taskId, localVideoUrl);
    if (!latestTask || latestTask.userId !== input.userId) {
      return;
    }
    const currentResult = latestTask.editableParseResult.videoGenerationResult;
    const localizedResult = localizeResultUrl(currentResult, {
      remoteVideoUrl,
      localVideoUrl,
      mirroredAt,
    }) as VideoGenerationResult;
    const taskWithParse = contentRepository.updateVideoTaskParseResult(input.taskId, {
      editableParseResult: normalizeParseResult({
        ...latestTask.editableParseResult,
        videoGenerationResult: localizedResult,
      }),
      selectedDigitalHumanId: latestTask.selectedDigitalHumanId,
      selectedSceneId: latestTask.selectedSceneId,
      selectedVoiceId: latestTask.selectedVoiceId,
    }) || latestTask;
    const expertContext = isRecord(taskWithParse.expertContext) ? taskWithParse.expertContext : {};
    contentRepository.updateVideoTaskContext(input.taskId, {
      selectedSkillIds: taskWithParse.selectedSkillIds,
      expertContext: {
        ...expertContext,
        videoResult: localizeResultUrl(expertContext.videoResult, { remoteVideoUrl, localVideoUrl, mirroredAt }),
        videoGenerationResult: localizeResultUrl(expertContext.videoGenerationResult, { remoteVideoUrl, localVideoUrl, mirroredAt }),
        videoGenerationResults: Array.isArray(expertContext.videoGenerationResults)
          ? expertContext.videoGenerationResults.map((item) => localizeResultUrl(item, { remoteVideoUrl, localVideoUrl, mirroredAt }))
          : expertContext.videoGenerationResults,
        remoteGeneratedVideoUrl: remoteVideoUrl,
        localGeneratedVideoUrl: localVideoUrl,
        generatedVideoMirroredAt: mirroredAt,
        updatedAt: mirroredAt,
      },
    });
    logger.info('generated video mirrored to local storage', {
      taskId: input.taskId,
      assetId: input.assetId,
      remoteVideoUrl,
      localVideoUrl,
      fileSize,
    });
  } catch (error) {
    if (filePath) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
    const reason = error instanceof Error ? error.message : String(error);
    markAssetMirrorStatus({
      assetId: input.assetId,
      taskId: input.taskId,
      status: 'failed',
      remoteVideoUrl,
      reason,
    });
    logger.warn('generated video local mirror failed', {
      taskId: input.taskId,
      assetId: input.assetId,
      remoteVideoUrl,
      reason,
    });
  } finally {
    runningGeneratedVideoMirrorTaskIds.delete(mirrorKey);
  }
}

export function mirrorGeneratedVideoToLocalInBackground(input: MirrorGeneratedVideoInput) {
  const remoteVideoUrl = input.remoteVideoUrl.trim();
  if (!isHttpRemoteUrl(remoteVideoUrl)) {
    return;
  }
  const mirrorKey = `${input.taskId}:${remoteVideoUrl}`;
  if (runningGeneratedVideoMirrorTaskIds.has(mirrorKey) || queuedGeneratedVideoMirrorTaskIds.has(mirrorKey)) {
    return;
  }
  queuedGeneratedVideoMirrorTaskIds.add(mirrorKey);
  generatedVideoMirrorQueue.push({
    ...input,
    remoteVideoUrl,
  });
  drainGeneratedVideoMirrorQueue();
}

function drainGeneratedVideoMirrorQueue() {
  while (activeGeneratedVideoMirrorCount < maxGeneratedVideoMirrorConcurrency && generatedVideoMirrorQueue.length) {
    const next = generatedVideoMirrorQueue.shift();
    if (!next) {
      continue;
    }
    const mirrorKey = `${next.taskId}:${next.remoteVideoUrl.trim()}`;
    queuedGeneratedVideoMirrorTaskIds.delete(mirrorKey);
    activeGeneratedVideoMirrorCount += 1;
    void mirrorGeneratedVideoToLocal(next)
      .catch((error) => {
        logger.warn('generated video mirror queue task failed', {
          taskId: next.taskId,
          assetId: next.assetId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        activeGeneratedVideoMirrorCount = Math.max(0, activeGeneratedVideoMirrorCount - 1);
        drainGeneratedVideoMirrorQueue();
      });
  }
}

function mirrorCandidateFromAsset(asset: ContentAsset, now = new Date()): MirrorGeneratedVideoInput | null {
  if (asset.resourceType !== 'finished_video') {
    return null;
  }
  if (asset.fileUrl.startsWith('/files/') && asset.filePath) {
    return null;
  }
  const taskId = typeof asset.metadata.videoTaskId === 'string' ? asset.metadata.videoTaskId.trim() : '';
  if (!taskId) {
    return null;
  }
  const remoteVideoUrl = typeof asset.metadata.remoteVideoUrl === 'string' && asset.metadata.remoteVideoUrl.trim()
    ? asset.metadata.remoteVideoUrl.trim()
    : asset.fileUrl.trim();
  if (!isHttpRemoteUrl(remoteVideoUrl)) {
    return null;
  }
  const localMirrorStatus = typeof asset.metadata.localMirrorStatus === 'string' ? asset.metadata.localMirrorStatus : '';
  if (localMirrorStatus === 'completed') {
    return null;
  }
  const nextRetryAt = typeof asset.metadata.localMirrorNextRetryAt === 'string'
    ? Date.parse(asset.metadata.localMirrorNextRetryAt)
    : Number.NaN;
  if (Number.isFinite(nextRetryAt) && nextRetryAt > now.getTime()) {
    return null;
  }
  return {
    taskId,
    userId: asset.userId,
    remoteVideoUrl,
    assetId: asset.id,
    provider: typeof asset.metadata.provider === 'string' ? asset.metadata.provider : undefined,
    model: typeof asset.metadata.model === 'string' ? asset.metadata.model : undefined,
  };
}

export function schedulePendingGeneratedVideoMirrors(input: { userId?: string; limit?: number } = {}) {
  const now = new Date();
  const candidates = contentRepository
    .listAssets({ userId: input.userId, resourceType: 'finished_video' })
    .map((asset) => mirrorCandidateFromAsset(asset, now))
    .filter((item): item is MirrorGeneratedVideoInput => Boolean(item))
    .slice(0, Math.max(1, input.limit || 50));
  candidates.forEach((candidate) => mirrorGeneratedVideoToLocalInBackground(candidate));
  if (candidates.length) {
    logger.info('scheduled pending generated video mirrors', {
      userId: input.userId,
      count: candidates.length,
      active: activeGeneratedVideoMirrorCount,
      queued: generatedVideoMirrorQueue.length,
    });
  }
  return candidates.length;
}
