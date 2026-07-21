import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requirePermission } from '../../shared/auth.middleware.js';
import { contentRepository } from '../content/content.repository.js';
import { assertCreateVideoSourceDuration } from '../content/internals/content-video-duration.js';
import type { ContentAsset } from '../content/content.types.js';
import type { TalkingVideoPromptImage } from './talking-video.prompt.js';
import {
  talkingVideoHistoryRepository,
  type TalkingVideoHistoryMaterial,
  type TalkingVideoHistoryRecord,
} from './talking-video-history.repository.js';
import {
  getTalkingVideoTaskSnapshot,
  startTalkingVideoTask,
  stopTalkingVideoTask,
  subscribeTalkingVideoTask,
  type TalkingVideoTaskEvent,
} from './talking-video-task-runtime.js';

function currentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

function writeEvent(response: Response, event: object) {
  response.write(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`);
  (response as Response & { flush?: () => void }).flush?.();
}

function openTaskStream(req: Request, res: Response, taskId: string) {
  getTalkingVideoTaskSnapshot(taskId, currentUserId(req));
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.socket?.setNoDelay(true);

  let unsubscribe = () => {};
  const finish = () => {
    unsubscribe();
    if (!res.writableEnded) res.end();
  };
  const listener = (event: TalkingVideoTaskEvent) => {
    if (res.writableEnded || res.destroyed) return;
    writeEvent(res, event);
    if (event.type === 'done'
      || (event.type === 'snapshot' && event.status !== 'thinking')
      || (event.type === 'status' && event.status !== 'thinking')) {
      finish();
    }
  };
  unsubscribe = subscribeTalkingVideoTask({ taskId, userId: currentUserId(req), listener });
  if (!res.headersSent) {
    res.flushHeaders();
  }
  if (res.writableEnded) unsubscribe();
  res.once('close', () => unsubscribe());
}

function ownedAsset(userId: string, assetId: string, expectedType: 'image' | 'video') {
  const asset = contentRepository.findAsset(assetId);
  if (!asset || asset.userId !== userId || !asset.mimeType.startsWith(`${expectedType}/`)) {
    throw new Error(expectedType === 'video' ? '口播参考视频不存在' : '参考图片不存在');
  }
  return asset;
}

function promptMedia(asset: ContentAsset) {
  return {
    assetId: asset.id,
    filePath: asset.filePath,
    filename: asset.originalFileName || asset.name,
    mimeType: asset.mimeType,
    updatedAt: asset.updatedAt,
  };
}

function historyMaterial(asset: ContentAsset, role?: TalkingVideoPromptImage['role']): TalkingVideoHistoryMaterial {
  return {
    assetId: asset.id,
    id: asset.id,
    type: asset.mimeType.startsWith('video/') ? 'video' : 'image',
    name: asset.originalFileName || asset.name,
    url: asset.fileUrl,
    serverFileUrl: asset.fileUrl,
    storedFileName: asset.storedFileName,
    ...(role ? { talkingVideoRole: role } : {}),
  };
}

function emptyMetrics() {
  return {
    arkUploadCount: 0,
    arkUploadPollMs: 0,
    understandingModelCalls: 0,
    understandingReplayCalls: 0,
    formatRepairCalls: 0,
    promptRepairCalls: 0,
    reuseCacheHitCount: 0,
  };
}

function numericRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item === 'number' && Number.isFinite(item))
    .map(([key, item]) => [key, Number(item)]));
}

function historyRecord(input: {
  taskId: string;
  video: ContentAsset;
  images: Array<{ asset: ContentAsset; role: TalkingVideoPromptImage['role'] }>;
  deepThink: boolean;
  createdAt?: string;
}): TalkingVideoHistoryRecord {
  const now = input.createdAt || new Date().toISOString();
  return {
    id: input.taskId,
    status: 'thinking',
    phase: 'uploading_assets',
    reasoning: '',
    prompt: '',
    errorMessage: '',
    metrics: emptyMetrics(),
    serverTimings: {},
    sourceVideo: historyMaterial(input.video),
    referenceImages: input.images.map(({ asset, role }) => historyMaterial(asset, role)),
    deepThink: input.deepThink,
    createdAt: now,
    updatedAt: now,
  };
}

function validDate(value: unknown) {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function imageInputs(userId: string, value: unknown): TalkingVideoPromptImage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 9).map((item) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const assetId = String(record.assetId || '');
    const role = String(record.role || 'detail');
    if (!['model', 'product', 'background', 'detail'].includes(role)) {
      throw new Error('参考图片角色无效');
    }
    return {
      ...promptMedia(ownedAsset(userId, assetId, 'image')),
      role: role as TalkingVideoPromptImage['role'],
    };
  });
}

export function createTalkingVideoRouter() {
  const router = Router();
  router.use(requirePermission('web.module.content.create_video'));

  router.get('/prompt/history', (req, res) => {
    res.json({ tasks: talkingVideoHistoryRepository.listByUser(currentUserId(req), 10) });
  });

  router.post('/prompt/history/import', (req, res) => {
    try {
      const userId = currentUserId(req);
      const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
      const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 10) : [];
      for (const value of tasks) {
        try {
          const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          const source = item.sourceVideo && typeof item.sourceVideo === 'object'
            ? item.sourceVideo as Record<string, unknown>
            : {};
          const videoAssetId = String(source.assetId || '');
          if (!videoAssetId) continue;
          const video = ownedAsset(userId, videoAssetId, 'video');
          const imageRecords = Array.isArray(item.referenceImages) ? item.referenceImages.slice(0, 9) : [];
          const images = imageRecords.flatMap((imageValue) => {
            const image = imageValue && typeof imageValue === 'object' ? imageValue as Record<string, unknown> : {};
            const assetId = String(image.assetId || '');
            const role = String(image.talkingVideoRole || 'detail');
            if (!assetId || !['model', 'product', 'background', 'detail'].includes(role)) return [];
            return [{
              asset: ownedAsset(userId, assetId, 'image'),
              role: role as TalkingVideoPromptImage['role'],
            }];
          });
          const rawStatus = String(item.status || 'stopped');
          const status: TalkingVideoHistoryRecord['status'] = ['completed', 'failed', 'stopped'].includes(rawStatus)
            ? rawStatus as TalkingVideoHistoryRecord['status']
            : 'stopped';
          const createdAt = validDate(item.createdAt);
          const base = historyRecord({
            taskId: String(item.id || randomUUID()),
            video,
            images,
            deepThink: item.deepThink !== false,
            createdAt,
          });
          talkingVideoHistoryRepository.insertIfMissing(userId, {
            ...base,
            status,
            phase: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'stopped',
            reasoning: String(item.reasoning || ''),
            prompt: String(item.prompt || ''),
            errorMessage: String(item.errorMessage || ''),
            metrics: numericRecord(item.metrics),
            serverTimings: numericRecord(item.serverTimings),
            updatedAt: createdAt,
          });
        } catch {
          // Ignore stale or deleted local assets while importing the browser cache.
        }
      }
      res.json({ tasks: talkingVideoHistoryRepository.listByUser(userId, 10) });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : '口播历史迁移失败' });
    }
  });

  router.post('/prompt/tasks/:taskId/stream', async (req, res) => {
    try {
      const userId = currentUserId(req);
      const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
      const videoAssetId = String(body.videoAssetId || '');
      if (!videoAssetId) {
        throw new Error('请先上传口播参考视频');
      }
      const video = ownedAsset(userId, videoAssetId, 'video');
      const durationSeconds = Number((await assertCreateVideoSourceDuration(video)).toFixed(3));
      const imagePayload = Array.isArray(body.images) ? body.images.slice(0, 9) : [];
      const historyImages = imagePayload.map((item) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const role = String(record.role || 'detail') as TalkingVideoPromptImage['role'];
        return { asset: ownedAsset(userId, String(record.assetId || ''), 'image'), role };
      });
      const images = imageInputs(userId, imagePayload);
      if (!images.some((image) => image.role === 'model')) {
        throw new Error('请先上传模特图片');
      }

      const taskId = String(req.params.taskId || randomUUID());
      const deepThink = body.deepThink !== false;
      const initialHistory = historyRecord({
        taskId,
        video,
        images: historyImages,
        deepThink,
      });
      talkingVideoHistoryRepository.upsert(userId, initialHistory);
      startTalkingVideoTask({
        taskId,
        userId,
        video: { ...promptMedia(video), durationSeconds },
        images,
        deepThink,
        persistSnapshot: (event) => talkingVideoHistoryRepository.updateState(userId, taskId, {
          status: event.status,
          phase: event.phase,
          reasoning: event.reasoning,
          prompt: event.prompt,
          errorMessage: event.errorMessage,
          metrics: event.metrics,
          serverTimings: event.timings,
        }),
      });
      openTaskStream(req, res, taskId);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : '口播提示词生成失败，请重新尝试' });
    }
  });

  router.get('/prompt/tasks/:taskId/stream', (req, res) => {
    try {
      openTaskStream(req, res, String(req.params.taskId || ''));
    } catch (error) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : '口播任务不存在或已失效';
        if (/口播任务不存在或已失效/u.test(message)) {
          res.status(410).json({ message: '口播任务已失效，请点击继续重新生成' });
          return;
        }
        res.status(404).json({ message });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  router.post('/prompt/tasks/:taskId/stop', (req, res) => {
    try {
      const snapshot = stopTalkingVideoTask(String(req.params.taskId || ''), currentUserId(req));
      res.json(snapshot);
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : '口播任务不存在或已失效' });
    }
  });

  return router;
}
