import { Router, type Request } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { contentPublicBaseUrl } from '../../config/env.js';
import { dataDir } from '../../db/database.js';
import { requireAdmin, requireAnyPermission, requirePermission } from '../../shared/auth.middleware.js';
import { listRouteResources } from '../route-resources/route-resource.service.js';
import { permissionForContentResourceType } from '../../shared/resource-permission.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { batchRequestSettingsService } from '../batch-request-settings/batch-request-settings.service.js';
import { registerContentEventClient } from './content.events.js';
import { contentRepository } from './content.repository.js';
import { contentUploadIntentRepository } from './content-upload-intent.repository.js';
import { contentService, temporaryContentAssetExpiresAt } from './content.service.js';
import { marketingVideoStoryboardService } from './marketing-video-storyboard.service.js';
import {
  contentAssetThumbnailPath,
  normalizeContentThumbnailSize,
} from './internals/content-asset-thumbnail.js';
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
import {
  createTosUploadUrl,
  currentFileStorageProvider,
  currentTosStorageConfig,
  fileStorageKey,
  fileStorageService,
  headTosObject,
  storageMetadata,
  tosPublicUrl,
} from '../../shared/file-storage.js';

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

function createUpload() {
  return multer({
    storage: multer.diskStorage({
      destination(_req, _file, callback) {
        callback(null, contentFilesDir);
      },
      filename(_req, file, callback) {
        callback(null, `${Date.now()}-${sanitizeFileName(decodeUploadFileName(file.originalname))}`);
      },
    }),
    limits: {
      fileSize: batchRequestSettingsService.getFileSizeLimitBytes(),
    },
  });
}

function uploadErrorMessage(error: unknown, fallback: string) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return `上传文件不能超过 ${batchRequestSettingsService.getSettings().maxFileSizeMb} MB`;
  }
  return error instanceof Error ? error.message : fallback;
}

function parseMetadata(value: unknown) {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
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

  router.get('/temporary-assets/cleanup-candidates', requirePermission('admin.route.system.temporary_assets.view'), (req, res) => {
    try {
      res.json(contentService.listTemporaryAssetCleanupCandidates({
        page: req.query.page,
        pageSize: req.query.pageSize,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '待清理素材获取失败'));
    }
  });

  router.get('/temporary-assets/settings', requirePermission('admin.route.system.temporary_assets.view'), (_req, res) => {
    res.json(contentService.getTemporaryAssetCleanupSettings());
  });

  router.put('/temporary-assets/settings', requirePermission('admin.route.system.temporary_assets.view'), (req, res) => {
    try {
      res.json(contentService.updateTemporaryAssetCleanupSettings(req.body || {}));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '临时素材清理设置保存失败'));
    }
  });

  router.get('/temporary-assets/disk-space', requirePermission('admin.route.system.temporary_assets.view'), (_req, res) => {
    void statfs(contentFilesDir, { bigint: true })
      .then((fileSystem) => {
        res.json({ availableBytes: Number(fileSystem.bavail * fileSystem.bsize) });
      })
      .catch((error) => sendError(res, 500, getErrorMessage(error, '磁盘剩余空间获取失败')));
  });

  router.get('/temporary-assets/cleanup-logs', requirePermission('admin.route.system.temporary_assets.view'), (_req, res) => {
    try {
      res.json(contentService.listTemporaryAssetCleanupLogs());
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '素材清理日志获取失败'));
    }
  });

  router.get('/temporary-assets/orphan-files', requirePermission('admin.route.system.temporary_assets.view'), (_req, res) => {
    void contentService.inspectOrphanContentFiles()
      .then((result) => res.json(result))
      .catch((error) => sendError(res, 500, getErrorMessage(error, '孤立文件检查失败')));
  });

  router.post('/temporary-assets/orphan-files/delete', requirePermission('admin.route.system.temporary_assets.view'), (req, res) => {
    const relativePaths = Array.isArray(req.body?.relativePaths)
      ? req.body.relativePaths.filter((relativePath: unknown): relativePath is string => typeof relativePath === 'string')
      : [];
    void contentService.deleteOrphanContentFiles(relativePaths)
      .then((result) => res.json(result))
      .catch((error) => sendError(res, 400, getErrorMessage(error, '孤立文件删除失败')));
  });

  router.post('/temporary-assets/cleanup-selected', requirePermission('admin.route.system.temporary_assets.view'), (req, res) => {
    const assetIds = Array.isArray(req.body?.assetIds)
      ? req.body.assetIds.filter((assetId: unknown): assetId is string => typeof assetId === 'string')
      : [];
    void contentService.deleteTemporaryAssets(assetIds)
      .then((result) => res.json(result))
      .catch((error) => sendError(res, 400, getErrorMessage(error, '临时素材删除失败')));
  });

  router.post('/temporary-assets/cleanup', requirePermission('admin.route.system.temporary_assets.view'), (_req, res) => {
    void contentService.cleanupExpiredTemporaryAssets('manual')
      .then((result) => res.json(result))
      .catch((error) => sendError(res, 400, getErrorMessage(error, '临时素材清理失败')));
  });

  router.post('/reference-video/trim', requireAnyPermission(listContentPermissionCodes()), (req, res) => {
    createUpload().single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadErrorMessage(uploadError, '参考视频上传失败'));
          return;
        }
        let sourcePath = '';
        let outputPath = '';
        let derivedAssetId = '';
        let persistedFile: Awaited<ReturnType<typeof fileStorageService.storeLocalFile>> | null = null;
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

          const userId = getCurrentUserId(req);
          const originalName = decodeUploadFileName(req.file.originalname);
          const parsed = path.parse(sanitizeFileName(originalName));
          sourcePath = req.file.path;
          const expiresAt = temporaryContentAssetExpiresAt();
          const storedFileName = `${Date.now()}-${parsed.name || 'reference-video'}-trimmed.mp4`;
          const storedRelativePath = inputMediaRelativePath('video', storedFileName);
          outputPath = contentFilePathForRelativePath(storedRelativePath);
          await mkdir(path.dirname(outputPath), { recursive: true });

          await execFileAsync('ffmpeg', [
            '-y',
            '-ss', String(start),
            '-i', sourcePath,
            '-t', String(duration),
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-movflags', '+faststart',
            outputPath,
          ], { timeout: 120000 });
          await rm(sourcePath, { force: true });
          sourcePath = '';

          const outputFile = await stat(outputPath);
          persistedFile = await fileStorageService.storeLocalFile({
            key: fileStorageKey(storedRelativePath),
            filePath: outputPath,
            fileUrl: fileUrlForContentFile(storedRelativePath),
            mimeType: 'video/mp4',
          });
          const fileUrl = persistedFile.fileUrl;
          const derivedAsset = contentService.createAsset({
            userId,
            resourceType: 'other',
            name: originalName || '参考视频',
            originalFileName: `${parsed.name || 'reference-video'}-trimmed.mp4`,
            storedFileName: storedRelativePath,
            mimeType: 'video/mp4',
            fileSize: outputFile.size,
            filePath: outputPath,
            fileUrl,
            assetKind: 'video_trimmed',
            lifecycleStatus: 'temporary',
            expiresAt,
            metadata: {
              duration,
              kind: 'video_create_reference_upload',
              source: 'local_upload',
              temporary: true,
              trimStart: start,
              trimEnd: end,
              ...storageMetadata(persistedFile),
              ...(fileUrl.startsWith('http') ? { publicFileUrl: fileUrl } : {}),
            },
          });
          if (!derivedAsset) {
            throw new Error('裁剪视频素材保存失败');
          }
          derivedAssetId = derivedAsset.id;
          res.status(201).json({
            assetId: derivedAsset.id,
            duration,
            end,
            fileUrl,
            name: storedRelativePath,
            originalFileName: originalName,
            start,
            storedFileName: storedRelativePath,
          });
        } catch (error) {
          if (derivedAssetId) contentRepository.deleteAsset(derivedAssetId);
          if (persistedFile) {
            await fileStorageService.deleteStoredFile({
              metadata: storageMetadata(persistedFile),
              filePath: outputPath,
            }).catch(() => undefined);
            outputPath = '';
          }
          await Promise.all([
            req.file?.path,
            sourcePath,
            outputPath,
          ].filter(Boolean).map((filePath) => rm(filePath!, { force: true })));
          sendError(res, 400, getErrorMessage(error, '参考视频剪辑失败'));
        }
      })();
    });
  });

  router.delete('/reference-video', requireAnyPermission(listContentPermissionCodes()), (req, res) => {
    void (async () => {
      try {
        const assetId = String(req.body.assetId || '').trim();
        if (assetId) {
          const asset = contentRepository.findAsset(assetId);
          if (!asset || asset.userId !== getCurrentUserId(req)) {
            throw new Error('参考视频素材不存在');
          }
          if (asset.lifecycleStatus !== 'temporary') {
            res.json({ ok: true });
            return;
          }
          const parentAssetId = asset.parentAssetId;
          await contentService.deleteAsset(assetId, {
            userId: getCurrentUserId(req),
            role: getCurrentUserRole(req) as UserRole,
          });
          if (parentAssetId) {
            const parent = contentRepository.findAsset(parentAssetId);
            const hasRemainingChildren = contentRepository
              .listAssets({ userId: getCurrentUserId(req) })
              .some((candidate) => candidate.parentAssetId === parentAssetId);
            if (parent?.userId === getCurrentUserId(req)
              && parent.lifecycleStatus === 'temporary'
              && !hasRemainingChildren) {
              await contentService.deleteAsset(parent.id, {
                userId: getCurrentUserId(req),
                role: getCurrentUserRole(req) as UserRole,
              });
            }
          }
          res.json({ ok: true });
          return;
        }
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
    createUpload().single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadErrorMessage(uploadError, '真人素材上传失败'));
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
    createUpload().single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadErrorMessage(uploadError, '人物素材上传失败'));
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

  router.get('/assets/:id/thumbnail', async (req, res) => {
    try {
      const asset = await contentService.getAsset(String(req.params.id || ''), {
        ...getCurrentActor(req),
      });
      const filePath = await contentAssetThumbnailPath(
        asset,
        normalizeContentThumbnailSize(req.query.size),
      );
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      res.type('image/webp').sendFile(filePath);
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, '素材缩略图生成失败'));
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

  router.post('/assets/direct-upload/prepare', (req, res) => {
    void (async () => {
      try {
        const resourceType = String(req.body.resourceType || 'other') as ContentResourceType;
        if (!requireContentResourcePermission(req, res, resourceType)) return;
        if (resourceType === 'finished_video') {
          throw new Error('成片素材只能由视频生成任务写入');
        }
        if (await currentFileStorageProvider() !== 'tos') {
          res.json({ directUpload: false });
          return;
        }

        const userId = getCurrentUserId(req);
        const groupId = String(req.body.groupId || '').trim();
        const group = contentRepository.findGroup(groupId);
        if (!group || group.userId !== userId || group.resourceType !== resourceType) {
          throw new Error('素材分组不存在');
        }
        const originalFileName = String(req.body.originalFileName || '').trim();
        const mimeType = String(req.body.mimeType || 'application/octet-stream').trim();
        const fileSize = Number(req.body.fileSize || 0);
        if (!originalFileName) throw new Error('缺少文件名');
        if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new Error('文件大小无效');
        if (fileSize > batchRequestSettingsService.getFileSizeLimitBytes()) {
          throw new Error(`上传文件不能超过 ${batchRequestSettingsService.getSettings().maxFileSizeMb} MB`);
        }

        const mediaKind = inputMediaKindForMimeType(mimeType);
        if (!mediaKind) throw new Error('暂不支持该文件类型直传');
        const id = randomUUID();
        const storedFileName = inputMediaRelativePath(
          mediaKind,
          `${Date.now()}-${id}-${sanitizeFileName(originalFileName)}`,
        );
        const objectKey = fileStorageKey(storedFileName);
        const config = currentTosStorageConfig();
        const metadata = parseMetadata(req.body.metadata);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
        const lifecycleStatus = metadata.temporary === true ? 'temporary' : 'permanent';
        const intent = contentUploadIntentRepository.create({
          id,
          userId,
          groupId,
          provider: 'tos',
          bucket: config.bucket,
          objectKey,
          publicFileUrl: tosPublicUrl(objectKey),
          resourceType,
          originalFileName,
          storedFileName,
          mimeType,
          fileSize,
          name: String(req.body.name || originalFileName).trim() || originalFileName,
          description: String(req.body.description || '').trim(),
          assetKind: typeof metadata.assetKind === 'string' ? metadata.assetKind : 'upload',
          lifecycleStatus,
          metadata,
          status: 'pending',
          assetId: null,
          expiresAt,
          createdAt: now.toISOString(),
          completedAt: null,
        });
        if (!intent) throw new Error('上传任务创建失败');
        res.status(201).json({
          directUpload: true,
          intentId: intent.id,
          uploadUrl: createTosUploadUrl({ key: objectKey, expiresInSeconds: 900 }),
          headers: { 'Content-Type': mimeType },
          expiresAt,
        });
      } catch (error) {
        sendError(res, 400, getErrorMessage(error, '直传任务创建失败'));
      }
    })();
  });

  router.post('/assets/direct-upload/complete', (req, res) => {
    void (async () => {
      try {
        const intentId = String(req.body.intentId || '').trim();
        const intent = contentUploadIntentRepository.find(intentId);
        if (!intent || intent.userId !== getCurrentUserId(req)) {
          throw new Error('上传任务不存在');
        }
        if (!requireContentResourcePermission(req, res, intent.resourceType)) return;
        if (intent.status === 'completed' && intent.assetId) {
          const completedAsset = contentRepository.findAsset(intent.assetId);
          if (completedAsset) {
            res.json(completedAsset);
            return;
          }
        }
        if (Date.parse(intent.expiresAt) <= Date.now()) throw new Error('上传任务已过期，请重新上传');

        const object = await headTosObject(intent.objectKey, intent.bucket);
        if (object.contentLength !== intent.fileSize) {
          throw new Error('上传文件大小校验失败，请重新上传');
        }
        const fileUrl = intent.publicFileUrl || tosPublicUrl(intent.objectKey);
        const temporary = intent.lifecycleStatus === 'temporary';
        const asset = contentService.createAsset({
          userId: intent.userId,
          groupId: intent.groupId,
          resourceType: intent.resourceType,
          name: intent.name,
          description: intent.description,
          originalFileName: intent.originalFileName,
          storedFileName: intent.storedFileName,
          mimeType: intent.mimeType,
          fileSize: object.contentLength,
          filePath: '',
          fileUrl,
          assetKind: intent.assetKind,
          lifecycleStatus: intent.lifecycleStatus,
          expiresAt: temporary ? temporaryContentAssetExpiresAt() : null,
          metadata: {
            ...intent.metadata,
            storageProvider: 'tos',
            storageKey: intent.objectKey,
            storageBucket: intent.bucket,
            publicFileUrl: fileUrl,
          },
        });
        if (!asset) throw new Error('素材记录创建失败');
        contentUploadIntentRepository.complete(intent.id, asset.id);
        res.status(201).json(asset);
      } catch (error) {
        sendError(res, 400, getErrorMessage(error, '直传文件登记失败'));
      }
    })();
  });

  router.post('/assets/upload', (req, res) => {
    createUpload().single('file')(req, res, (uploadError) => {
      void (async () => {
        let persistedFile: Awaited<ReturnType<typeof fileStorageService.storeLocalFile>> | undefined;
        if (uploadError) {
          sendError(res, 400, uploadErrorMessage(uploadError, '素材上传失败'));
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
          const uploadMetadata = {
            ...parseMetadata(req.body.metadata),
            ...(file?.publicFileUrl ? { publicFileUrl: file.publicFileUrl } : {}),
          };
          const storedFile = await moveUploadedFileToInputMediaDirectory(req.file, uploadMetadata);
          persistedFile = await fileStorageService.storeLocalFile({
            key: fileStorageKey(storedFile.storedFileName),
            filePath: storedFile.filePath,
            fileUrl: storedFile.fileUrl,
            mimeType: req.file.mimetype || 'application/octet-stream',
          });
          const metadata = {
            ...uploadMetadata,
            ...storageMetadata(persistedFile),
            ...(persistedFile.fileUrl.startsWith('http') ? { publicFileUrl: persistedFile.fileUrl } : {}),
          };
          const temporary = metadata.temporary === true;
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
            filePath: storedFile.filePath,
            fileUrl: persistedFile.fileUrl,
            assetKind: typeof metadata.assetKind === 'string' ? metadata.assetKind : 'upload',
            lifecycleStatus: temporary ? 'temporary' : 'permanent',
            expiresAt: temporary ? temporaryContentAssetExpiresAt() : null,
            metadata,
          });
          res.status(201).json(asset);
        } catch (error) {
          if (persistedFile) {
            await fileStorageService.deleteStoredFile({
              metadata: storageMetadata(persistedFile),
              filePath: persistedFile.filePath,
            }).catch(() => undefined);
          } else if (req.file) {
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
      void contentService.listVideoProductions(getCurrentUserId(req), {
        createdAtFrom: req.query.createdAtFrom,
        createdAtTo: req.query.createdAtTo,
        search: req.query.search,
        ratio: req.query.ratio,
        status: req.query.status,
        page: req.query.page,
        pageSize: req.query.pageSize,
      })
        .then((tasks) => res.json(tasks))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频制作记录获取失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频制作记录获取失败'));
    }
  });

  router.get('/marketing-video-storyboards', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      res.json(marketingVideoStoryboardService.list(getCurrentUserId(req)));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '营销视频分镜历史获取失败'));
    }
  });

  router.post('/marketing-video-storyboards', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      const task = marketingVideoStoryboardService.create({
        userId: getCurrentUserId(req),
        productName: String(req.body.productName || ''),
        productCategory: String(req.body.productCategory || ''),
        sellingPoints: String(req.body.sellingPoints || ''),
        additionalPrompt: String(req.body.additionalPrompt || ''),
        referenceImageIds: Array.isArray(req.body.referenceImageIds) ? req.body.referenceImageIds : [],
      });
      res.status(201).json(task);
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '营销视频分镜任务创建失败'));
    }
  });

  router.post('/marketing-video-storyboards/:id/retry', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      res.json(marketingVideoStoryboardService.retry(
        getCurrentUserId(req),
        String(req.params.id || ''),
        String(req.body.optimizationInstruction || ''),
      ));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '营销视频分镜重新生成失败'));
    }
  });

  router.delete('/marketing-video-storyboards/:id', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      marketingVideoStoryboardService.delete(getCurrentUserId(req), String(req.params.id || ''));
      res.status(204).send();
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '营销视频分镜删除失败'));
    }
  });

  router.post('/marketing-video-storyboards/:id/generate-video', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void marketingVideoStoryboardService.generateVideo(
        getCurrentUserId(req),
        String(req.params.id || ''),
        {
          quality: req.body.quality,
          ratio: req.body.ratio,
          duration: req.body.duration,
          videoModelProviderId: req.body.videoModelProviderId,
          videoModelId: req.body.videoModelId,
        },
      )
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '营销视频生成任务创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '营销视频生成任务创建失败'));
    }
  });

  router.post('/video-productions', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.createVideoProduction({
        ...req.body,
        userId: getCurrentUserId(req),
        skipVideoBilling: false,
      })
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频制作任务创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频制作任务创建失败'));
    }
  });

  router.post('/video-enhancements', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.createVideoEnhancement({
        userId: getCurrentUserId(req),
        sourceAssetId: String(req.body.sourceAssetId || ''),
        resolution: req.body.resolution,
      })
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频高清放大任务创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频高清放大任务创建失败'));
    }
  });

  router.post('/subtitle-removals', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.createSubtitleRemoval({
        userId: getCurrentUserId(req),
        sourceAssetId: String(req.body.sourceAssetId || ''),
        mode: req.body.mode,
        contentType: req.body.contentType,
        locations: req.body.locations,
        clipFilter: req.body.clipFilter,
      })
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '字幕擦除任务创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '字幕擦除任务创建失败'));
    }
  });

  router.post('/video-translations', requirePermission('web.module.content.create_video'), (req, res) => {
    try {
      void contentService.createVideoTranslation({
        userId: getCurrentUserId(req),
        sourceAssetId: String(req.body.sourceAssetId || ''),
        sourceLanguage: String(req.body.sourceLanguage || ''),
        targetLanguage: String(req.body.targetLanguage || ''),
        translationTypes: req.body.translationTypes,
        subtitleSource: req.body.subtitleSource,
        subtitleConfig: req.body.subtitleConfig,
      })
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频翻译任务创建失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频翻译任务创建失败'));
    }
  });

  return router;
}
