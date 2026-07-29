import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../../db/database.js';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { batchRequestSettingsService } from '../batch-request-settings/batch-request-settings.service.js';
import { contentRepository } from '../content/content.repository.js';
import { contentService } from '../content/content.service.js';
import {
  contentFilePathForRelativePath,
  fileUrlForContentRelativePath,
  inputMediaKindForMimeType,
  inputMediaRelativePath,
} from '../content/internals/content-common.js';
import { listCreativeCapabilities } from '../creative-capabilities/creative-capability.registry.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import { registerBatchGenerationEventClient } from './batch-generation.events.js';
import { batchGenerationRunService } from './batch-generation-run.service.js';
import {
  BatchGenerationConflictError,
  BatchGenerationNotFoundError,
  batchGenerationService,
} from './batch-generation.service.js';

const batchUploadDir = path.join(dataDir, 'files', 'batch-generation-uploads');
mkdirSync(batchUploadDir, { recursive: true });

function sanitizeFileName(fileName: string) {
  const parsed = path.parse(fileName);
  const base = parsed.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
  const ext = parsed.ext.replace(/[^\w.]+/g, '');
  return `${base}${ext}`;
}

const uploadReference = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, batchUploadDir),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${randomUUID()}-${sanitizeFileName(file.originalname)}`),
  }),
  limits: { fileSize: batchRequestSettingsService.getFileSizeLimitBytes() },
});

function userIdOf(req: import('express').Request) {
  return req.auth?.userId || '';
}

function sendBatchError(res: import('express').Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof BatchGenerationNotFoundError) {
    sendError(res, 404, message);
    return;
  }
  if (error instanceof BatchGenerationConflictError) {
    sendError(res, 409, message);
    return;
  }
  sendError(res, 400, message);
}

export function createBatchGenerationRouter() {
  const router = Router();
  router.use(requirePermission('web.module.content.batch_generation'));

  router.get('/capabilities', (_req, res) => {
    res.json(listCreativeCapabilities());
  });

  router.get('/model-options', (_req, res) => {
    res.json(
      modelConfigRepository
        .list()
        .filter((config) => (config.type === 'image' || config.type === 'video') && Boolean(config.apiKey))
        .map((config) => ({
          id: config.id,
          type: config.type,
          name: config.name,
          isDefault: Boolean(config.isDefault),
        })),
    );
  });

  router.get('/events', (req, res) => {
    registerBatchGenerationEventClient(userIdOf(req), res);
  });

  router.post('/assets/upload', (req, res) => {
    uploadReference.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          const message = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE'
            ? `上传文件不能超过 ${batchRequestSettingsService.getSettings().maxFileSizeMb} MB`
            : uploadError instanceof Error ? uploadError.message : '参考素材上传失败';
          sendError(res, 400, message);
          return;
        }
        const file = req.file;
        if (!file) {
          sendError(res, 400, '请选择上传文件');
          return;
        }
        let finalPath = file.path;
        try {
          const mediaKind = inputMediaKindForMimeType(file.mimetype);
          if (!mediaKind) throw new Error('仅支持图片、视频或音频素材');
          const storedFileName = inputMediaRelativePath(mediaKind, file.filename);
          finalPath = contentFilePathForRelativePath(storedFileName);
          await mkdir(path.dirname(finalPath), { recursive: true });
          await rename(file.path, finalPath);
          const asset = contentService.createAsset({
            userId: userIdOf(req),
            resourceType: 'other',
            name: String(req.body.name || file.originalname).trim() || file.originalname,
            description: '批量生成参考素材',
            originalFileName: file.originalname,
            storedFileName,
            mimeType: file.mimetype || 'application/octet-stream',
            fileSize: file.size,
            filePath: finalPath,
            fileUrl: fileUrlForContentRelativePath(storedFileName),
            assetKind: 'batch_generation_reference',
            metadata: {
              source: 'local_upload',
              kind: 'batch_generation_reference',
              sheetId: String(req.body.sheetId || '').trim(),
              fieldKey: String(req.body.fieldKey || '').trim(),
            },
          });
          res.status(201).json(asset);
        } catch (error) {
          await rm(finalPath, { force: true }).catch(() => undefined);
          sendBatchError(res, error, '参考素材上传失败');
        }
      })();
    });
  });

  router.get('/assets/:assetId', (req, res) => {
    const asset = contentRepository.findAsset(req.params.assetId);
    if (!asset || asset.userId !== userIdOf(req)) {
      sendError(res, 404, '素材不存在');
      return;
    }
    res.json(asset);
  });

  router.get('/sheets', (req, res) => {
    res.json(batchGenerationService.listSheets(userIdOf(req)));
  });

  router.post('/sheets', (req, res) => {
    try {
      const sheet = batchGenerationService.createSheet({
        userId: userIdOf(req),
        name: req.body.name,
        capabilityKey: req.body.capabilityKey,
        globalParams: req.body.globalParams,
      });
      res.status(201).json(sheet);
    } catch (error) {
      sendBatchError(res, error, '表格创建失败');
    }
  });

  router.get('/sheets/:sheetId', (req, res) => {
    try {
      res.json(batchGenerationService.getSheet(userIdOf(req), req.params.sheetId));
    } catch (error) {
      sendBatchError(res, error, '表格读取失败');
    }
  });

  router.patch('/sheets/:sheetId', (req, res) => {
    try {
      res.json(batchGenerationService.updateSheet({
        userId: userIdOf(req),
        sheetId: req.params.sheetId,
        name: req.body.name,
        globalParams: req.body.globalParams,
        sortOrder: req.body.sortOrder,
        revision: req.body.revision,
      }));
    } catch (error) {
      sendBatchError(res, error, '表格更新失败');
    }
  });

  router.delete('/sheets/:sheetId', (req, res) => {
    try {
      res.json(batchGenerationService.deleteSheet(userIdOf(req), req.params.sheetId));
    } catch (error) {
      sendBatchError(res, error, '表格删除失败');
    }
  });

  router.post('/sheets/:sheetId/rows', (req, res) => {
    try {
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [req.body.params || {}];
      res.status(201).json(batchGenerationService.addRows({
        userId: userIdOf(req),
        sheetId: req.params.sheetId,
        rows,
      }));
    } catch (error) {
      sendBatchError(res, error, '表格行创建失败');
    }
  });

  router.patch('/sheets/:sheetId/rows/:rowId', (req, res) => {
    try {
      res.json(batchGenerationService.updateRow({
        userId: userIdOf(req),
        sheetId: req.params.sheetId,
        rowId: req.params.rowId,
        params: req.body.params,
        revision: req.body.revision,
      }));
    } catch (error) {
      sendBatchError(res, error, '表格行更新失败');
    }
  });

  router.delete('/sheets/:sheetId/rows/:rowId', (req, res) => {
    try {
      res.json(batchGenerationService.deleteRow(userIdOf(req), req.params.sheetId, req.params.rowId));
    } catch (error) {
      sendBatchError(res, error, '表格行删除失败');
    }
  });

  router.get('/sheets/:sheetId/runs', (req, res) => {
    try {
      res.json(batchGenerationRunService.listRuns(userIdOf(req), req.params.sheetId));
    } catch (error) {
      sendBatchError(res, error, '批量任务读取失败');
    }
  });

  router.post('/sheets/:sheetId/runs', async (req, res) => {
    try {
      const run = await batchGenerationRunService.startRun({
        userId: userIdOf(req),
        sheetId: req.params.sheetId,
        rowIds: req.body.rowIds,
      });
      res.status(202).json(run);
    } catch (error) {
      sendBatchError(res, error, '批量任务创建失败');
    }
  });

  router.get('/runs/:runId', (req, res) => {
    try {
      res.json(batchGenerationRunService.getRun(userIdOf(req), req.params.runId));
    } catch (error) {
      sendBatchError(res, error, '批量任务读取失败');
    }
  });

  router.post('/runs/:runId/retry', async (req, res) => {
    try {
      const run = await batchGenerationRunService.retryRun(userIdOf(req), req.params.runId);
      res.status(202).json(run);
    } catch (error) {
      sendBatchError(res, error, '批量任务重试失败');
    }
  });

  return router;
}
