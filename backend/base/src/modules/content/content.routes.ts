import { Router, type Request } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { contentPublicBaseUrl, contentUploadLimitBytes } from '../../config/env.js';
import { dataDir } from '../../db/database.js';
import { requireAnyPermission, requirePermission } from '../../shared/auth.middleware.js';
import { listRouteResources } from '../route-resources/route-resource.service.js';
import { permissionForContentResourceType } from '../../shared/resource-permission.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { registerContentEventClient } from './content.events.js';
import { contentRepository } from './content.repository.js';
import { contentService } from './content.service.js';
import {
  contentFilePathForRelativePath,
  execFileAsync,
  fileUrlForContentRelativePath,
  inputMediaKindForMimeType,
  inputMediaRelativePath,
  resolveLocalContentFilePathFromUrl,
} from './internals/content-common.js';
import type { ContentResourceType } from './content.types.js';
import type { UserRole } from '../users/user.types.js';

const contentFilesDir = path.join(dataDir, 'files');
mkdirSync(contentFilesDir, { recursive: true });

function listContentPermissionCodes() {
  return listRouteResources({ includeDisabled: false, platform: 'web' })
    .filter((resource) => resource.permissionCode.startsWith('web.module.content.'))
    .map((resource) => resource.permissionCode);
}

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

function getCurrentUserPermissions(req: Request) {
  return req.auth?.permissions || [];
}

function getCurrentActor(req: Request) {
  const auth = req.auth;
  const userId = auth?.userId || '';
  const role = (auth?.systemRole || '') as UserRole;
  return {
    userId,
    role,
    permissions: getCurrentUserPermissions(req),
  };
}

function requireContentResourcePermission(req: Request, res: Parameters<typeof sendError>[0], resourceType: ContentResourceType) {
  const permissionKey = permissionForContentResourceType(resourceType);
  if (!permissionKey) {
    sendError(res, 403, '当前账号无权访问该功能');
    return false;
  }
  if (req.auth?.hasPermission(permissionKey)) {
    return true;
  }
  sendError(res, 403, '当前账号无权访问该功能');
  return false;
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
  const fileUrl = `/files/${encodeURIComponent(file.filename)}`;
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

function parseTrimSecond(value: unknown, fieldName: string) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue) || nextValue < 0) {
    throw new Error(`${fieldName} 必须是有效秒数`);
  }
  return roundTrimSecond(nextValue);
}

function roundTrimSecond(value: number) {
  return Number(value.toFixed(1));
}

function fileUrlForContentFile(fileName: string) {
  return fileUrlForContentRelativePath(fileName);
}

function isInputAssetUpload(metadata: Record<string, unknown>) {
  return metadata.kind === 'video_create_reference_upload'
    || metadata.kind === 'voice_source'
    || metadata.uploadedFrom === 'video_remake';
}

async function moveUploadedFileToInputMediaDirectory(file: Express.Multer.File, metadata: Record<string, unknown>) {
  if (!isInputAssetUpload(metadata)) {
    return {
      filePath: file.path,
      fileUrl: fileUrlForContentFile(file.filename),
      storedFileName: file.filename,
    };
  }
  const mediaKind = inputMediaKindForMimeType(file.mimetype || '');
  if (!mediaKind) {
    return {
      filePath: file.path,
      fileUrl: fileUrlForContentFile(file.filename),
      storedFileName: file.filename,
    };
  }
  const storedRelativePath = inputMediaRelativePath(mediaKind, file.filename);
  const filePath = contentFilePathForRelativePath(storedRelativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await rename(file.path, filePath);
  return {
    filePath,
    fileUrl: fileUrlForContentFile(storedRelativePath),
    storedFileName: storedRelativePath,
  };
}

function storedFileNameFromReferenceVideoPayload(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error('缺少参考视频文件');
  }
  const filePath = raw.startsWith('/files/') ? resolveLocalContentFilePathFromUrl(raw) : '';
  const decoded = raw.startsWith('/files/')
    ? decodeURIComponent(raw.replace(/^\/files\//, ''))
    : decodeURIComponent(raw);
  const parts = decoded.split('/').filter(Boolean);
  if (!filePath && (!parts.length || parts.some((part) => part === '..' || part.includes('\\')))) {
    throw new Error('参考视频文件无效');
  }
  const baseName = path.basename(decoded);
  if (!baseName || !baseName.endsWith('-trimmed.mp4')) {
    throw new Error('参考视频文件无效');
  }
  return decoded;
}

export function createContentRouter() {
  const router = Router();

  router.get('/modules', requireAnyPermission(listContentPermissionCodes()), (req, res) => {
    res.json(contentService.listModules({
      role: getCurrentUserRole(req) as 'admin' | 'user',
      permissions: getCurrentUserPermissions(req),
    }));
  });

  router.get('/events', requireAnyPermission(listContentPermissionCodes()), (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      sendError(res, 400, '缺少用户 ID');
      return;
    }
    registerContentEventClient(userId, res);
  });

  router.post('/reference-video/trim', requireAnyPermission(listContentPermissionCodes()), (req, res) => {
    upload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '参考视频上传失败');
          return;
        }
        let outputPath = '';
        try {
          if (!req.file) {
            throw new Error('请选择要剪辑的参考视频');
          }
          if (!String(req.file.mimetype || '').startsWith('video/')) {
            throw new Error('参考素材必须是视频文件');
          }
          const start = parseTrimSecond(req.body.start, '起点');
          const end = parseTrimSecond(req.body.end, '终点');
          const duration = roundTrimSecond(end - start);
          if (duration < 4 || duration > 15) {
            throw new Error('参考视频选区必须在 4-15 秒之间');
          }

          const originalName = decodeUploadFileName(req.file.originalname);
          const parsed = path.parse(sanitizeFileName(originalName));
          const storedFileName = `${Date.now()}-${parsed.name || 'reference-video'}-trimmed.mp4`;
          const storedRelativePath = inputMediaRelativePath('video', storedFileName);
          outputPath = contentFilePathForRelativePath(storedRelativePath);
          await mkdir(path.dirname(outputPath), { recursive: true });

          await execFileAsync('ffmpeg', [
            '-y',
            '-ss', String(start),
            '-i', req.file.path,
            '-t', String(duration),
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-movflags', '+faststart',
            outputPath,
          ], { timeout: 120000 });

          await rm(req.file.path, { force: true });
          const fileUrl = fileUrlForContentFile(storedRelativePath);
          res.status(201).json({
            duration,
            end,
            fileUrl,
            name: storedRelativePath,
            originalFileName: originalName,
            start,
            storedFileName: storedRelativePath,
          });
        } catch (error) {
          if (req.file) {
            await rm(req.file.path, { force: true });
          }
          if (outputPath) {
            await rm(outputPath, { force: true });
          }
          sendError(res, 400, getErrorMessage(error, '参考视频剪辑失败'));
        }
      })();
    });
  });

  router.delete('/reference-video', requireAnyPermission(listContentPermissionCodes()), (req, res) => {
    void (async () => {
      try {
        const storedFileName = storedFileNameFromReferenceVideoPayload(req.body.storedFileName || req.body.fileUrl);
        await rm(contentFilePathForRelativePath(storedFileName), { force: true });
        res.json({ ok: true });
      } catch (error) {
        sendError(res, 400, getErrorMessage(error, '参考视频删除失败'));
      }
    })();
  });

  router.post('/real-person/validation-session', (req, res) => {
    if (!requireContentResourcePermission(req, res, 'real_person')) {
      return;
    }
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
    if (!requireContentResourcePermission(req, res, 'real_person')) {
      return;
    }
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
      const actor = getCurrentActor(req);
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
    const resourceType = String(req.body.resourceType || '') as ContentResourceType;
    if (!requireContentResourcePermission(req, res, resourceType)) {
      return;
    }
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
    if (!requireContentResourcePermission(req, res, 'digital_human')) {
      return;
    }
    try {
      void contentService.generateDigitalHumanThreeView(String(req.params.id || ''), {
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
    if (!requireContentResourcePermission(req, res, 'virtual_portrait')) {
      return;
    }
    try {
      void contentService.generateVirtualPortraitThreeView(String(req.params.id || ''), {
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
    if (!requireContentResourcePermission(req, res, 'voice')) {
      return;
    }
    try {
      void contentService.cloneVoiceGroup(String(req.params.id || ''), {
        ...req.body,
        userId: getCurrentUserId(req),
      })
        .then((group) => res.json(group))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '声音克隆失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '声音克隆失败'));
    }
  });

  router.post('/virtual-portrait/remote-library/sync', requirePermission('web.module.content.virtual_portrait_assets'), (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const role = getCurrentUserRole(req);
      if (!userId || !role) {
        sendError(res, 401, '请先登录');
        return;
      }
      void contentService.syncVirtualPortraitRemoteLibrary({
        actor: getCurrentActor(req),
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
    if (!requireContentResourcePermission(req, res, 'real_person')) {
      return;
    }
    upload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '真人素材上传失败');
          return;
        }
        try {
          const file = uploadedFilePayload(req);
          const metadata = {
            ...parseMetadata(req.body.metadata),
            ...(file?.publicFileUrl ? { publicFileUrl: file.publicFileUrl } : {}),
          };
          const result = await contentService.createRealPersonAsset(String(req.params.id || ''), {
            userId: getCurrentUserId(req),
            name: String(req.body.name || ''),
            description: String(req.body.description || ''),
            url: String(req.body.url || ''),
            metadata,
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
    if (!requireContentResourcePermission(req, res, 'virtual_portrait')) {
      return;
    }
    upload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '人物素材上传失败');
          return;
        }
        try {
          const file = uploadedFilePayload(req);
          const metadata = {
            ...parseMetadata(req.body.metadata),
            ...(file?.publicFileUrl ? { publicFileUrl: file.publicFileUrl } : {}),
          };
          const result = await contentService.createVirtualPortraitAsset(String(req.params.id || ''), {
            userId: getCurrentUserId(req),
            name: String(req.body.name || ''),
            description: String(req.body.description || ''),
            url: String(req.body.url || ''),
            metadata,
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
    const group = contentRepository.findGroup(String(req.params.id || ''));
    if (!group) {
      sendError(res, 404, '分组不存在');
      return;
    }
    if (!requireContentResourcePermission(req, res, group.resourceType)) {
      return;
    }
    try {
      void contentService.updateGroup(String(req.params.id || ''), {
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
      void contentService.deleteGroup(String(req.params.id || ''), {
        ...getCurrentActor(req),
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
        actor: getCurrentActor(req),
        groupId: req.query.groupId ? String(req.query.groupId) : undefined,
        resourceType: req.query.resourceType ? String(req.query.resourceType) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
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
      void contentService.getAsset(String(req.params.id || ''), {
        ...getCurrentActor(req),
      })
        .then((asset) => res.json(asset))
        .catch((error) => sendError(res, 404, getErrorMessage(error, '素材获取失败')));
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, '素材获取失败'));
    }
  });

  router.post('/assets/:id/real-person/sync', (req, res) => {
    if (!requireContentResourcePermission(req, res, 'real_person')) {
      return;
    }
    try {
      void contentService.syncRealPersonAsset(String(req.params.id || ''), {
        userId: getCurrentUserId(req),
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '真人素材状态同步失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '真人素材状态同步失败'));
    }
  });

  router.post('/assets/:id/virtual-portrait/sync', (req, res) => {
    if (!requireContentResourcePermission(req, res, 'virtual_portrait')) {
      return;
    }
    try {
      void contentService.syncVirtualPortraitAsset(String(req.params.id || ''), {
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
          if (!requireContentResourcePermission(req, res, resourceType)) {
            await import('node:fs/promises').then(({ rm }) => rm(req.file!.path, { force: true }));
            return;
          }
          if (resourceType === 'finished_video') {
            throw new Error('成片素材只能由视频生成任务写入');
          }
          const originalFileName = decodeUploadFileName(req.file.originalname);
          const file = uploadedFilePayload(req);
          const metadata = {
            ...parseMetadata(req.body.metadata),
            ...(file?.publicFileUrl ? { publicFileUrl: file.publicFileUrl } : {}),
          };
          const storedFile = await moveUploadedFileToInputMediaDirectory(req.file, metadata);
          const asset = contentService.createAsset({
            userId: getCurrentUserId(req),
            groupId: req.body.groupId ? String(req.body.groupId || '') : undefined,
            resourceType,
            name: String(req.body.name || originalFileName),
            description: String(req.body.description || ''),
            originalFileName,
            storedFileName: storedFile.storedFileName,
            mimeType: req.file.mimetype || 'application/octet-stream',
            fileSize: req.file.size,
            filePath: req.file.path,
            fileUrl: `/files/${encodeURIComponent(req.file.filename)}`,
            metadata,
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
    const currentAsset = contentRepository.findAsset(String(req.params.id || ''));
    if (!currentAsset) {
      sendError(res, 404, '素材不存在');
      return;
    }
    if (!requireContentResourcePermission(req, res, currentAsset.resourceType)) {
      return;
    }
    try {
      void contentService.updateAsset(String(req.params.id || ''), {
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
      res.json(await contentService.deleteAsset(String(req.params.id || ''), {
        ...getCurrentActor(req),
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材删除失败'));
    }
  });

  router.get('/video-tasks', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      res.json(contentService.listVideoTasks(getCurrentUserId(req)));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频任务列表获取失败'));
    }
  });

  router.get('/video-tasks/:id', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.getVideoTaskView(String(req.params.id || ''), getCurrentUserId(req))
        .then((task) => res.json(task))
        .catch((error) => sendError(res, 404, getErrorMessage(error, '视频任务获取失败')));
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, '视频任务获取失败'));
    }
  });

  router.delete('/video-tasks/:id', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.deleteVideoTask(String(req.params.id || ''), getCurrentUserId(req))
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频任务删除失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频任务删除失败'));
    }
  });

  router.patch('/video-tasks/:id/title', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      res.json(contentService.renameVideoTask(String(req.params.id || ''), {
        userId: getCurrentUserId(req),
        title: String(req.body.title || ''),
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '任务名称更新失败'));
    }
  });

  router.get('/video-productions', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.listVideoProductions(getCurrentUserId(req))
        .then((tasks) => res.json(tasks))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频制作记录获取失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频制作记录获取失败'));
    }
  });

  router.post('/video-productions', requirePermission('web.module.content.create_video'), (req, res) => {
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
