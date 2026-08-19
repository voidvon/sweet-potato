import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { logger } from '../../../shared/logger.js';
import { fileStorageKey, fileStorageService, storageMetadata, type StoredFileMetadata } from '../../../shared/file-storage.js';
import { contentRepository } from '../content.repository.js';
import type { ContentAsset, VideoGenerationResult } from '../content.types.js';
import {
  contentFilePathForRelativePath,
  execFileAsync,
  fileUrlForContentRelativePath,
  generatedMediaRelativePath,
} from './content-common.js';
import { isRecord, normalizeParseResult } from './content-video-task-utils.js';

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
const runningGeneratedVideoCoverAssetIds = new Set<string>();

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
  input: { remoteVideoUrl: string; localVideoUrl: string; coverUrl?: string; mirroredAt: string },
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
    ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
    remoteVideoUrl: typeof value.remoteVideoUrl === 'string' && value.remoteVideoUrl.trim()
      ? value.remoteVideoUrl
      : input.remoteVideoUrl,
    localMirroredAt: input.mirroredAt,
  };
}

export async function generateVideoCover(input: {
  assetId: string;
  taskId: string;
  videoFilePath: string;
}) {
  const storedFileName = `${input.taskId}-${randomUUID()}-cover.jpg`;
  const storedRelativePath = generatedMediaRelativePath('image', storedFileName);
  const localCoverUrl = fileUrlForContentRelativePath(storedRelativePath);
  const coverFilePath = contentFilePathForRelativePath(storedRelativePath);
  await mkdir(path.dirname(coverFilePath), { recursive: true });
  contentRepository.updateFinishedVideoAssetFile(input.assetId, {
    metadata: {
      ...(contentRepository.findAsset(input.assetId)?.metadata || {}),
      coverStatus: 'generating',
      coverLastAttemptAt: new Date().toISOString(),
    },
  });
  let persistedCover: Awaited<ReturnType<typeof fileStorageService.storeLocalFile>> | null = null;
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', input.videoFilePath,
      '-map', '0:V:0',
      '-vf', "select=eq(n\\,0),scale='min(1280,iw)':-2",
      '-frames:v', '1',
      '-q:v', '2',
      coverFilePath,
    ], { timeout: 30_000 });
    const coverFileSize = (await stat(coverFilePath)).size;
    persistedCover = await fileStorageService.storeLocalFile({
      key: fileStorageKey(storedRelativePath),
      filePath: coverFilePath,
      fileUrl: localCoverUrl,
      mimeType: 'image/jpeg',
    });
    const currentAsset = contentRepository.findAsset(input.assetId);
    if (!currentAsset) {
      await fileStorageService.deleteStoredFile({
        metadata: storageMetadata(persistedCover),
        filePath: coverFilePath,
      });
      return null;
    }
    const coverStorage = storageMetadata(persistedCover);
    const persistedCoverUrl = persistedCover.fileUrl;
    const generatedAt = new Date().toISOString();
    const updatedAsset = contentRepository.updateFinishedVideoAssetFile(input.assetId, {
      metadata: {
        ...currentAsset.metadata,
        coverStatus: 'completed',
        coverUrl: persistedCoverUrl,
        coverFilePath,
        coverStoredFileName: storedRelativePath,
        coverMimeType: 'image/jpeg',
        coverFileSize,
        coverGeneratedAt: generatedAt,
        coverStorageProvider: coverStorage.storageProvider,
        coverStorageKey: coverStorage.storageKey,
        coverStorageBucket: coverStorage.storageBucket,
        coverFailureReason: undefined,
      },
    });
    if (!updatedAsset) {
      await fileStorageService.deleteStoredFile({
        metadata: coverStorage,
        filePath: coverFilePath,
      });
      return null;
    }
    const currentTask = contentRepository.findVideoTask(input.taskId);
    if (currentTask) {
      const taskWithCover = contentRepository.markVideoTaskCoverGenerated(input.taskId, persistedCoverUrl, {
        updatedAt: currentTask.updatedAt,
      }) || currentTask;
      const resultWithCover = isRecord(taskWithCover.editableParseResult.videoGenerationResult)
        ? { ...taskWithCover.editableParseResult.videoGenerationResult, coverUrl: persistedCoverUrl }
        : taskWithCover.editableParseResult.videoGenerationResult;
      const taskWithResult = contentRepository.updateVideoTaskParseResult(input.taskId, {
        editableParseResult: normalizeParseResult({
          ...taskWithCover.editableParseResult,
          videoGenerationResult: resultWithCover,
        }),
        selectedDigitalHumanId: taskWithCover.selectedDigitalHumanId,
        selectedSceneId: taskWithCover.selectedSceneId,
        selectedVoiceId: taskWithCover.selectedVoiceId,
        updatedAt: taskWithCover.updatedAt,
      }) || taskWithCover;
      const expertContext = isRecord(taskWithResult.expertContext) ? taskWithResult.expertContext : {};
      const addCover = (value: unknown) => isRecord(value)
        ? { ...value, coverUrl: persistedCoverUrl }
        : value;
      contentRepository.updateVideoTaskContext(input.taskId, {
        selectedSkillIds: taskWithResult.selectedSkillIds,
        expertContext: {
          ...expertContext,
          videoResult: addCover(expertContext.videoResult),
          videoGenerationResult: addCover(expertContext.videoGenerationResult),
          videoGenerationResults: Array.isArray(expertContext.videoGenerationResults)
            ? expertContext.videoGenerationResults.map(addCover)
            : expertContext.videoGenerationResults,
          generatedCoverUrl: persistedCoverUrl,
          generatedCoverAt: generatedAt,
        },
        updatedAt: taskWithResult.updatedAt,
      });
    }
    const previousCoverFilePath = typeof currentAsset.metadata.coverFilePath === 'string'
      ? currentAsset.metadata.coverFilePath
      : undefined;
    const previousCoverStorageKey = typeof currentAsset.metadata.coverStorageKey === 'string'
      ? currentAsset.metadata.coverStorageKey
      : '';
    if (previousCoverFilePath || (previousCoverStorageKey && previousCoverStorageKey !== coverStorage.storageKey)) {
      await fileStorageService.deleteStoredFile({
        metadata: {
          storageProvider: currentAsset.metadata.coverStorageProvider,
          storageKey: previousCoverStorageKey,
          storageBucket: currentAsset.metadata.coverStorageBucket,
        },
        filePath: previousCoverFilePath,
      }).catch((error) => {
        logger.warn('previous generated video cover cleanup failed', {
          taskId: input.taskId,
          assetId: input.assetId,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }
    return { coverUrl: persistedCoverUrl, generatedAt };
  } catch (error) {
    if (persistedCover) {
      await fileStorageService.deleteStoredFile({
        metadata: storageMetadata(persistedCover),
        filePath: coverFilePath,
      }).catch(() => undefined);
    } else {
      await rm(coverFilePath, { force: true }).catch(() => undefined);
    }
    const currentAsset = contentRepository.findAsset(input.assetId);
    if (currentAsset) {
      contentRepository.updateFinishedVideoAssetFile(input.assetId, {
        metadata: {
          ...currentAsset.metadata,
          coverStatus: 'failed',
          coverFailureReason: error instanceof Error ? error.message : String(error),
          coverLastAttemptAt: new Date().toISOString(),
        },
      });
    }
    logger.warn('generated video cover extraction failed', {
      taskId: input.taskId,
      assetId: input.assetId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function markAssetMirrorStatus(input: {
  assetId?: string | null;
  taskId: string;
  status: 'downloading' | 'completed' | 'failed';
  remoteVideoUrl: string;
  localVideoUrl?: string;
  fileUrl?: string;
  storage?: StoredFileMetadata;
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
    fileUrl: input.fileUrl ?? input.localVideoUrl ?? asset.fileUrl,
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
      ...(input.storage || {}),
    },
    updatedAt: asset.updatedAt,
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
    const storedFileName = `${input.taskId}-${randomUUID()}${extension}`;
    const storedRelativePath = generatedMediaRelativePath('video', storedFileName);
    const localVideoUrl = fileUrlForContentRelativePath(storedRelativePath);
    filePath = contentFilePathForRelativePath(storedRelativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(filePath),
    );
    const fileSize = (await stat(filePath)).size;
    const currentAsset = input.assetId
      ? contentRepository.findAsset(input.assetId)
      : contentRepository
        .listAssets({ userId: input.userId, resourceType: 'finished_video' })
        .find((asset) => asset.metadata.videoTaskId === input.taskId);
    if (!currentAsset) {
      await rm(filePath, { force: true });
      filePath = '';
      logger.info('discarded generated video mirror after asset deletion', {
        taskId: input.taskId,
        assetId: input.assetId,
        remoteVideoUrl,
      });
      return;
    }
    const persistedFile = await fileStorageService.storeLocalFile({
      key: fileStorageKey(storedRelativePath),
      filePath,
      fileUrl: localVideoUrl,
      mimeType: response.headers.get('content-type') || 'video/mp4',
    });
    const storedVideoUrl = persistedFile.fileUrl;
    const mirroredAt = new Date().toISOString();
    markAssetMirrorStatus({
      assetId: input.assetId,
      taskId: input.taskId,
      status: 'completed',
      remoteVideoUrl,
      localVideoUrl,
      fileUrl: storedVideoUrl,
      storage: storageMetadata(persistedFile),
      filePath,
      storedFileName: storedRelativePath,
      originalFileName: originalVideoFileName(remoteVideoUrl, storedFileName),
      fileSize,
    });
    const cover = await generateVideoCover({
      assetId: currentAsset.id,
      taskId: input.taskId,
      videoFilePath: filePath,
    });
    const taskBeforeLocalUrlUpdate = contentRepository.findVideoTask(input.taskId);
    const preservedTaskUpdatedAt = taskBeforeLocalUrlUpdate?.updatedAt;
    const latestTask = contentRepository.markVideoTaskGenerated(input.taskId, storedVideoUrl, {
      updatedAt: preservedTaskUpdatedAt,
    });
    if (!latestTask || latestTask.userId !== input.userId) {
      return;
    }
    const latestTaskWithCover = cover
      ? contentRepository.findVideoTask(input.taskId) || latestTask
      : latestTask;
    const currentResult = latestTaskWithCover.editableParseResult.videoGenerationResult;
    const localizedResult = localizeResultUrl(currentResult, {
      remoteVideoUrl,
      localVideoUrl: storedVideoUrl,
      coverUrl: cover?.coverUrl,
      mirroredAt,
    }) as VideoGenerationResult;
    const taskWithParse = contentRepository.updateVideoTaskParseResult(input.taskId, {
      editableParseResult: normalizeParseResult({
        ...latestTaskWithCover.editableParseResult,
        videoGenerationResult: localizedResult,
      }),
      selectedDigitalHumanId: latestTaskWithCover.selectedDigitalHumanId,
      selectedSceneId: latestTaskWithCover.selectedSceneId,
      selectedVoiceId: latestTaskWithCover.selectedVoiceId,
      updatedAt: latestTaskWithCover.updatedAt,
    }) || latestTaskWithCover;
    const expertContext = isRecord(taskWithParse.expertContext) ? taskWithParse.expertContext : {};
    contentRepository.updateVideoTaskContext(input.taskId, {
      selectedSkillIds: taskWithParse.selectedSkillIds,
      expertContext: {
        ...expertContext,
        videoResult: localizeResultUrl(expertContext.videoResult, { remoteVideoUrl, localVideoUrl: storedVideoUrl, coverUrl: cover?.coverUrl, mirroredAt }),
        videoGenerationResult: localizeResultUrl(expertContext.videoGenerationResult, { remoteVideoUrl, localVideoUrl: storedVideoUrl, coverUrl: cover?.coverUrl, mirroredAt }),
        videoGenerationResults: Array.isArray(expertContext.videoGenerationResults)
          ? expertContext.videoGenerationResults.map((item) => localizeResultUrl(item, { remoteVideoUrl, localVideoUrl: storedVideoUrl, coverUrl: cover?.coverUrl, mirroredAt }))
          : expertContext.videoGenerationResults,
        remoteGeneratedVideoUrl: remoteVideoUrl,
        localGeneratedVideoUrl: storedVideoUrl,
        ...(cover ? { generatedCoverUrl: cover.coverUrl, generatedCoverAt: cover.generatedAt } : {}),
        generatedVideoMirroredAt: mirroredAt,
        updatedAt: mirroredAt,
      },
      updatedAt: taskWithParse.updatedAt,
    });
    logger.info('generated video mirrored to persistent storage', {
      taskId: input.taskId,
      assetId: input.assetId,
      remoteVideoUrl,
      localVideoUrl: storedVideoUrl,
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

export async function backfillMissingGeneratedVideoCovers(input: { userId?: string; limit?: number } = {}) {
  const allCandidates = contentRepository
    .listAssets({ userId: input.userId, resourceType: 'finished_video' })
    .filter((asset) => asset.mimeType.startsWith('video/'))
    .filter((asset) => !String(asset.metadata.coverUrl || '').trim())
    .filter((asset) => !String(asset.metadata.coverLastAttemptAt || '').trim())
    .filter((asset) => Boolean(asset.filePath) && existsSync(asset.filePath))
    .filter((asset) => !runningGeneratedVideoCoverAssetIds.has(asset.id));
  const candidates = input.limit === undefined
    ? allCandidates
    : allCandidates.slice(0, Math.max(1, input.limit));
  let completed = 0;
  let failed = 0;
  let nextIndex = 0;
  const workerCount = Math.min(2, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < candidates.length) {
      const asset = candidates[nextIndex];
      nextIndex += 1;
      if (!asset) continue;
      runningGeneratedVideoCoverAssetIds.add(asset.id);
      try {
        const taskId = typeof asset.metadata.videoTaskId === 'string' && asset.metadata.videoTaskId.trim()
          ? asset.metadata.videoTaskId.trim()
          : asset.id;
        const cover = await generateVideoCover({
          assetId: asset.id,
          taskId,
          videoFilePath: asset.filePath,
        });
        if (cover) completed += 1;
        else failed += 1;
      } finally {
        runningGeneratedVideoCoverAssetIds.delete(asset.id);
      }
    }
  }));
  if (candidates.length) {
    logger.info('generated video cover backfill completed', {
      userId: input.userId,
      candidates: candidates.length,
      completed,
      failed,
    });
  }
  return { candidates: candidates.length, completed, failed };
}
