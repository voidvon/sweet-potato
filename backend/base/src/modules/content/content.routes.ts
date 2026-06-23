import { Router, type Request } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { contentPublicBaseUrl, contentUploadLimitBytes } from '../../config/env.js';
import { dataDir } from '../../db/database.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { registerContentEventClient } from './content.events.js';
import { contentService } from './content.service.js';
import type { ContentResourceType } from './content.types.js';

const contentFilesDir = path.join(dataDir, 'content-files');
mkdirSync(contentFilesDir, { recursive: true });

function sanitizeFileName(fileName: string) {
  const parsed = path.parse(fileName);
  const base = parsed.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
  const ext = parsed.ext.replace(/[^\w.]+/g, '');
  return `${base}${ext}`;
}

function decodeUploadFileName(fileName: string) {
  if (!fileName) {
    return fileName;
  }
  const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
  // multer/busboy may expose non-ASCII filenames as latin1 mojibake. Only replace
  // when the latin1->utf8 roundtrip clearly produces a healthier Unicode string.
  if (decoded && decoded !== fileName && /[\u4e00-\u9fff]/.test(decoded) && /[ÃÂÄÅæéèç]/.test(fileName)) {
    return decoded;
  }
  return fileName;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, contentFilesDir);
    },
    filename(_req, file, callback) {
      callback(null, `${Date.now()}-${sanitizeFileName(decodeUploadFileName(file.originalname))}`);
    },
  }),
  limits: {
    fileSize: contentUploadLimitBytes,
  },
});

function parseMetadata(value: unknown) {
  if (!value) {
    return {};
  }
  if (typeof value !== 'string') {
    return {};
  }
  return JSON.parse(value);
}

function getCurrentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

function getCurrentUserRole(req: Request) {
  return req.auth?.user?.role || '';
}

function isPrivateOrLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const hostname = normalized.replace(/:\d+$/, '');
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  const match = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match) {
    const secondOctet = Number(match[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

export function requestPublicBaseUrl(req: Pick<Request, 'headers'>) {
  if (contentPublicBaseUrl) {
    return contentPublicBaseUrl;
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
  const host = forwardedHost || String(req.headers.host || '').trim();
  if (!host || isPrivateOrLoopbackHost(host)) {
    return '';
  }
  const proto = forwardedProto || 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function uploadedFilePayloadFromMulterFile(file: Express.Multer.File, publicBaseUrl = '') {
  const fileUrl = `/files/content/${encodeURIComponent(file.filename)}`;
  return {
    originalFileName: decodeUploadFileName(file.originalname),
    storedFileName: file.filename,
    mimeType: file.mimetype || 'application/octet-stream',
    fileSize: file.size,
    filePath: file.path,
    fileUrl,
    publicFileUrl: publicBaseUrl ? `${publicBaseUrl}${fileUrl}` : undefined,
  };
}

function uploadedFilePayload(req: Request) {
  if (!req.file) {
    return undefined;
  }
  return uploadedFilePayloadFromMulterFile(req.file, requestPublicBaseUrl(req));
}

export function createContentRouter() {
  const router = Router();

  router.get('/modules', (_req, res) => {
    res.json(contentService.listModules());
  });

  router.get('/events', (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      sendError(res, 400, '缺少用户 ID');
      return;
    }
    registerContentEventClient(userId, res);
  });

  router.post('/real-person/validation-session', (req, res) => {
    try {
      void contentService.createRealPersonValidationSession({
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((result) => res.status(201).json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '真人认证会话创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '真人认证会话创建失败'));
    }
  });

  router.post('/real-person/validation-result', (req, res) => {
    try {
      void contentService.getRealPersonValidationResult({
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '真人认证结果获取失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '真人认证结果获取失败'));
    }
  });

  router.get('/real-person/callback', (req, res) => {
    try {
      void contentService.handleRealPersonCallback(req.query as Record<string, unknown>)
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '真人认证回调处理失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '真人认证回调处理失败'));
    }
  });

  router.get('/asset-groups', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      const actor = { userId, role };
      if (req.query.page || req.query.pageSize) {
        void contentService.listGroupsPage({
          actor,
          resourceType: req.query.resourceType ? String(req.query.resourceType) : undefined,
          page: req.query.page ? Number(req.query.page) : undefined,
          pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
        })
          .then((result) => res.json(result))
          .catch((error) => sendError(res, 400, getErrorMessage(error, '素材分组获取失败')));
        return;
      }
      void contentService.listGroups(
        actor,
        req.query.resourceType ? String(req.query.resourceType) : undefined,
      )
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '素材分组获取失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材分组获取失败'));
    }
  });

  router.post('/asset-groups', (req, res) => {
    try {
      void contentService.createGroup({
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((group) => res.status(201).json(group))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '素材分组创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材分组创建失败'));
    }
  });

  router.post('/asset-groups/:id/digital-human/three-view', (req, res) => {
    try {
      void contentService.generateDigitalHumanThreeView(req.params.id, {
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((asset) => res.status(201).json(asset))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '三视图生成失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '三视图生成失败'));
    }
  });

  router.post('/asset-groups/:id/virtual-portrait/three-view', (req, res) => {
    try {
      void contentService.generateVirtualPortraitThreeView(req.params.id, {
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((asset) => res.status(201).json(asset))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '虚拟人像三视图生成失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '虚拟人像三视图生成失败'));
    }
  });

  router.post('/asset-groups/:id/voice/clone', (req, res) => {
    try {
      void contentService.cloneVoiceGroup(req.params.id, {
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((group) => res.json(group))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '声音克隆失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '声音克隆失败'));
    }
  });

  router.post('/virtual-portrait/remote-library/sync', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      void contentService.syncVirtualPortraitRemoteLibrary({
        actor: { userId, role },
        projectName: typeof req.body?.projectName === 'string' ? req.body.projectName : undefined,
        pageSize: typeof req.body?.pageSize === 'number' ? req.body.pageSize : undefined,
        includeAssets: typeof req.body?.includeAssets === 'boolean' ? req.body.includeAssets : undefined,
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '虚拟人像云端全量同步失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '虚拟人像云端全量同步失败'));
    }
  });

  router.post('/asset-groups/:id/real-person/assets', (req, res) => {
    upload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '真人素材上传失败');
          return;
        }
        try {
          const file = uploadedFilePayload(req);
          const result = await contentService.createRealPersonAsset(req.params.id, {
            userId: getCurrentUserId(req),
            name: String(req.body.name || ''),
            description: String(req.body.description || ''),
            url: String(req.body.url || ''),
            metadata: parseMetadata(req.body.metadata),
          }, file);
          res.status(201).json(result);
        } catch (error) {
          if (req.file) {
            await import('node:fs/promises').then(({ rm }) => rm(req.file!.path, { force: true }));
          }
          sendError(res, 400, getErrorMessage(error, '真人素材上传失败'));
        }
      })();
    });
  });

  router.post('/asset-groups/:id/virtual-portrait/assets', (req, res) => {
    upload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '人物素材上传失败');
          return;
        }
        try {
          const file = uploadedFilePayload(req);
          const result = await contentService.createVirtualPortraitAsset(req.params.id, {
            userId: getCurrentUserId(req),
            name: String(req.body.name || ''),
            description: String(req.body.description || ''),
            url: String(req.body.url || ''),
            metadata: parseMetadata(req.body.metadata),
          }, file);
          res.status(201).json(result.asset);
        } catch (error) {
          if (req.file) {
            await import('node:fs/promises').then(({ rm }) => rm(req.file!.path, { force: true }));
          }
          sendError(res, 400, getErrorMessage(error, '人物素材上传失败'));
        }
      })();
    });
  });

  router.patch('/asset-groups/:id', (req, res) => {
    try {
      void contentService.updateGroup(req.params.id, {
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((group) => res.json(group))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '素材分组更新失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材分组更新失败'));
    }
  });

  router.delete('/asset-groups/:id', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      void contentService.deleteGroup(req.params.id, {
        userId,
        role,
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '素材分组删除失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材分组删除失败'));
    }
  });

  router.get('/assets', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      void contentService.listAssets({
        actor: { userId, role },
        groupId: req.query.groupId ? String(req.query.groupId) : undefined,
        resourceType: req.query.resourceType ? String(req.query.resourceType) : undefined,
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '素材列表获取失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材列表获取失败'));
    }
  });

  router.get('/assets/:id', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      void contentService.getAsset(req.params.id, {
        userId,
        role,
      })
        .then((asset) => res.json(asset))
        .catch((error) => sendError(res, 404, getErrorMessage(error, '素材获取失败')));
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, '素材获取失败'));
    }
  });

  router.post('/assets/:id/real-person/sync', (req, res) => {
    try {
      void contentService.syncRealPersonAsset(req.params.id, {
        userId: getCurrentUserId(req),
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '真人素材状态同步失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '真人素材状态同步失败'));
    }
  });

  router.post('/assets/:id/virtual-portrait/sync', (req, res) => {
    try {
      void contentService.syncVirtualPortraitAsset(req.params.id, {
        userId: getCurrentUserId(req),
      })
        .then((result) => res.json(result.asset))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '人物素材状态同步失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '人物素材状态同步失败'));
    }
  });

  router.post('/assets/upload', (req, res) => {
    upload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '素材上传失败');
          return;
        }
        try {
          if (!req.file) {
            throw new Error('请选择要上传的素材文件');
          }
          const resourceType = String(req.body.resourceType || 'other') as ContentResourceType;
          if (resourceType === 'finished_video') {
            throw new Error('成片素材只能由视频生成任务写入');
          }
          const originalFileName = decodeUploadFileName(req.file.originalname);
          const asset = contentService.createAsset({
            userId: getCurrentUserId(req),
            groupId: String(req.body.groupId || ''),
            resourceType,
            name: String(req.body.name || originalFileName),
            description: String(req.body.description || ''),
            originalFileName,
            storedFileName: req.file.filename,
            mimeType: req.file.mimetype || 'application/octet-stream',
            fileSize: req.file.size,
            filePath: req.file.path,
            fileUrl: `/files/content/${encodeURIComponent(req.file.filename)}`,
            metadata: parseMetadata(req.body.metadata),
          });
          res.status(201).json(asset);
        } catch (error) {
          if (req.file) {
            await import('node:fs/promises').then(({ rm }) => rm(req.file!.path, { force: true }));
          }
          sendError(res, 400, getErrorMessage(error, '素材上传失败'));
        }
      })();
    });
  });

  router.patch('/assets/:id', (req, res) => {
    try {
      void contentService.updateAsset(req.params.id, {
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((asset) => res.json(asset))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '素材更新失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材更新失败'));
    }
  });

  router.delete('/assets/:id', async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      res.json(await contentService.deleteAsset(req.params.id, {
        userId,
        role,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材删除失败'));
    }
  });

  router.get('/video-tasks', (req, res) => {
    try {
      res.json(contentService.listVideoTasks(getCurrentUserId(req)));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频任务列表获取失败'));
    }
  });

  router.get('/video-tasks/:id', (req, res) => {
    try {
      void contentService.getVideoTaskView(req.params.id, getCurrentUserId(req))
        .then((task) => res.json(task))
        .catch((error) => sendError(res, 404, getErrorMessage(error, '视频任务获取失败')));
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, '视频任务获取失败'));
    }
  });

  router.delete('/video-tasks/:id', (req, res) => {
    try {
      void contentService.deleteVideoTask(req.params.id, getCurrentUserId(req))
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频任务删除失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频任务删除失败'));
    }
  });

  router.patch('/video-tasks/:id/title', (req, res) => {
    try {
      res.json(contentService.renameVideoTask(req.params.id, {
        userId: getCurrentUserId(req),
        title: String(req.body.title || ''),
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '任务名称更新失败'));
    }
  });

  router.get('/video-productions', (req, res) => {
    try {
      void contentService.listVideoProductions(getCurrentUserId(req))
        .then((tasks) => res.json(tasks))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频制作记录获取失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频制作记录获取失败'));
    }
  });

  router.post('/video-productions', (req, res) => {
    try {
      void contentService.createVideoProduction({
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频制作任务创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频制作任务创建失败'));
    }
  });

  return router;
}
