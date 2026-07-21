import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { videoSourceService } from './video-source.service.js';
import { VideoSourceError } from './video-source.types.js';
import { proxyVideoPreview, videoPreviewUrl } from './video-source.preview.js';
import { danceRemakeService } from './dance-remake.service.js';
import { subjectReplaceService } from './subject-replace.service.js';

export function createVideoSourceRouter() {
  const router = Router();

  router.post('/resolve', requirePermission('web.module.content.create_video'), (req, res) => {
    void videoSourceService.resolve(String(req.body?.input || ''))
      .then((source) => res.json({ source: { ...source, previewUrl: videoPreviewUrl(source) } }))
      .catch((error) => sendError(
        res,
        error instanceof VideoSourceError ? error.statusCode : 500,
        getErrorMessage(error, '视频链接解析失败'),
      ));
  });

  router.get('/preview', (req, res) => {
    void proxyVideoPreview(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      sendError(
        res,
        error instanceof VideoSourceError ? error.statusCode : 500,
        getErrorMessage(error, '视频预览失败'),
      );
    });
  });

  router.post('/dance-remakes', requirePermission('web.module.content.create_video'), (req, res) => {
    void danceRemakeService.create({
      characterImageAssetId: String(req.body?.characterImageAssetId || ''),
      mode: req.body?.mode === 'standard' ? 'standard' : 'enhanced',
      preserveAudio: req.body?.preserveAudio !== false,
      quality: req.body?.quality === '标清 (720p)' ? '标清 (720p)' : '普清 (480p)',
      ratio: '9:16',
      referenceVideoAssetId: req.body?.referenceVideoAssetId
        ? String(req.body.referenceVideoAssetId)
        : undefined,
      remoteVideo: req.body?.remoteVideo?.input ? {
        input: String(req.body.remoteVideo.input),
        trimEnd: req.body.remoteVideo.trimEnd,
        trimStart: req.body.remoteVideo.trimStart,
      } : undefined,
      userId: req.auth?.userId || '',
      videoModelId: String(req.body?.videoModelId || ''),
    })
      .then(() => res.status(201).json({ ok: true }))
      .catch((error) => sendError(
        res,
        error instanceof VideoSourceError ? error.statusCode : 400,
        getErrorMessage(error, '跳舞复刻任务创建失败'),
      ));
  });

  router.post('/subject-replaces', requirePermission('web.module.content.create_video'), (req, res) => {
    void subjectReplaceService.create({
      imageAssetIds: Array.isArray(req.body?.imageAssetIds)
        ? req.body.imageAssetIds.map(String)
        : [],
      preserveAudio: req.body?.preserveAudio !== false,
      quality: req.body?.quality === '普清 (480p)' ? '普清 (480p)' : '标清 (720p)',
      referenceVideoAssetId: req.body?.referenceVideoAssetId
        ? String(req.body.referenceVideoAssetId)
        : undefined,
      remoteVideo: req.body?.remoteVideo?.input ? {
        input: String(req.body.remoteVideo.input),
        trimEnd: req.body.remoteVideo.trimEnd,
        trimStart: req.body.remoteVideo.trimStart,
      } : undefined,
      subjectType: req.body?.subjectType,
      userId: req.auth?.userId || '',
      videoModelId: String(req.body?.videoModelId || ''),
    })
      .then((task) => res.status(201).json(task))
      .catch((error) => sendError(
        res,
        error instanceof VideoSourceError ? error.statusCode : 400,
        getErrorMessage(error, '主体替换任务创建失败'),
      ));
  });

  return router;
}
