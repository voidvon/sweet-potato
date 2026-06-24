import { Router, type Request } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { contentUploadLimitBytes, vodUploadLimitBytes } from '../../config/env.js';
import { dataDir } from '../../db/database.js';
import { requirePermission } from '../../shared/auth.middleware.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { registerVideoRemakeEventClient } from './video-remake.events.js';
import { videoRemakeService } from './video-remake.service.js';
import type { VideoRemakeCardType } from './video-remake.types.js';

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
  if (decoded && decoded !== fileName && /[\u4e00-\u9fff]/.test(decoded) && /[ÃÂÄÅæéèç]/.test(fileName)) {
    return decoded;
  }
  return fileName;
}

const vodUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, contentFilesDir);
    },
    filename(_req, file, callback) {
      callback(null, `${Date.now()}-video-remake-${sanitizeFileName(decodeUploadFileName(file.originalname))}`);
    },
  }),
  limits: {
    fileSize: vodUploadLimitBytes,
  },
  fileFilter(_req, file, callback) {
    if (!file.mimetype.startsWith('video/')) {
      callback(new Error('请上传视频文件'));
      return;
    }
    callback(null, true);
  },
});

const pipImageUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, contentFilesDir);
    },
    filename(_req, file, callback) {
      callback(null, `${Date.now()}-video-remake-pip-${sanitizeFileName(decodeUploadFileName(file.originalname))}`);
    },
  }),
  limits: {
    fileSize: contentUploadLimitBytes,
  },
  fileFilter(_req, file, callback) {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('画中画素材只能上传图片'));
      return;
    }
    callback(null, true);
  },
});

function getCurrentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

export function createVideoRemakeRouter() {
  const router = Router();

  router.use(requirePermission('web.module.content.video_remake'));

  router.get('/events', (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      sendError(res, 401, '请先登录');
      return;
    }
    registerVideoRemakeEventClient(userId, res);
  });

  router.get('/tasks', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.listTasks(userId));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻任务获取失败'));
    }
  });

  router.get('/tasks/:id', (req, res) => {
    try {
      const currentUserId = getCurrentUserId(req);
      const task = videoRemakeService.getTask(req.params.id);
      if (task.userId !== currentUserId) {
        sendError(res, 403, '无权访问该任务');
        return;
      }
      res.json(task);
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻任务获取失败'));
    }
  });

  router.post('/parse-url', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.parseUrl({
        userId,
        url: String(req.body.url || ''),
      })
        .then((task) => res.status(201).json(task))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频链接解析失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频链接解析失败'));
    }
  });

  router.post('/sessions', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.status(201).json(videoRemakeService.createSession({
        userId,
        filename: req.body.filename ? String(req.body.filename) : undefined,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻会话创建失败'));
    }
  });

  router.get('/sessions', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.listSessions(userId));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻会话获取失败'));
    }
  });

  router.get('/sessions/:sessionId', (req, res) => {
    try {
      const currentUserId = getCurrentUserId(req);
      const session = videoRemakeService.getSession(req.params.sessionId);
      if (session.userId !== currentUserId) {
        sendError(res, 403, '无权访问该会话');
        return;
      }
      res.json(session);
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻会话获取失败'));
    }
  });

  router.patch('/sessions/:sessionId', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.renameSession(req.params.sessionId, {
        userId,
        filename: String(req.body.filename || ''),
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻会话更新失败'));
    }
  });

  router.delete('/sessions/:sessionId', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.deleteSession(req.params.sessionId, {
        userId,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻会话删除失败'));
    }
  });

  router.post('/sessions/:sessionId/upload', (req, res) => {
    vodUpload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '视频上传失败');
          return;
        }
        try {
          if (!req.file) {
            throw new Error('请选择要上传的视频文件');
          }
          const userId = getCurrentUserId(req);
          const originalFileName = decodeUploadFileName(req.file.originalname);
          const result = await videoRemakeService.upload(req.params.sessionId, {
            userId,
            originalFileName,
            storedFileName: req.file.filename,
            mimeType: req.file.mimetype || 'application/octet-stream',
            fileSize: req.file.size,
            filePath: req.file.path,
            fileUrl: `/files/content/${encodeURIComponent(req.file.filename)}`,
          });
          res.status(201).json(result);
        } catch (error) {
          if (req.file) {
            await import('node:fs/promises').then(({ rm }) => rm(req.file!.path, { force: true }));
          }
          sendError(res, 400, getErrorMessage(error, '视频上传解析失败'));
        }
      })();
    });
  });

  router.post('/sessions/:sessionId/pip-assets/upload', (req, res) => {
    pipImageUpload.single('file')(req, res, (uploadError) => {
      void (async () => {
        if (uploadError) {
          sendError(res, 400, uploadError instanceof Error ? uploadError.message : '画中画图片上传失败');
          return;
        }
        try {
          if (!req.file) {
            throw new Error('请选择要上传的画中画图片');
          }
          const userId = getCurrentUserId(req);
          const originalFileName = decodeUploadFileName(req.file.originalname);
          const result = videoRemakeService.uploadPipAsset(req.params.sessionId, {
            userId,
            originalFileName,
            storedFileName: req.file.filename,
            mimeType: req.file.mimetype || 'application/octet-stream',
            fileSize: req.file.size,
            filePath: req.file.path,
            fileUrl: `/files/content/${encodeURIComponent(req.file.filename)}`,
          });
          res.status(201).json(result);
        } catch (error) {
          if (req.file) {
            await import('node:fs/promises').then(({ rm }) => rm(req.file!.path, { force: true }));
          }
          sendError(res, 400, getErrorMessage(error, '画中画图片上传失败'));
        }
      })();
    });
  });

  router.post('/sessions/:sessionId/parse-url', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.parseSessionUrl(req.params.sessionId, {
        userId,
        url: String(req.body.url || ''),
      })
        .then((session) => res.status(201).json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频链接解析失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频链接解析失败'));
    }
  });

  router.post('/sessions/:sessionId/run', (req, res) => {
    try {
      const currentUserId = getCurrentUserId(req);
      const session = videoRemakeService.getSession(req.params.sessionId);
      if (session.userId !== currentUserId) {
        sendError(res, 403, '无权访问该会话');
        return;
      }
      void videoRemakeService.run(req.params.sessionId)
        .then((session) => res.json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频复刻流程启动失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻流程启动失败'));
    }
  });

  router.post('/sessions/:sessionId/resume', (req, res) => {
    try {
      const currentUserId = getCurrentUserId(req);
      const session = videoRemakeService.getSession(req.params.sessionId);
      if (session.userId !== currentUserId) {
        sendError(res, 403, '无权访问该会话');
        return;
      }
      void videoRemakeService.resume(req.params.sessionId)
        .then((session) => res.json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频复刻流程恢复失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻流程恢复失败'));
    }
  });

  router.post('/sessions/:sessionId/sync', (req, res) => {
    try {
      const currentUserId = getCurrentUserId(req);
      const session = videoRemakeService.getSession(req.params.sessionId);
      if (session.userId !== currentUserId) {
        sendError(res, 403, '无权访问该会话');
        return;
      }
      void videoRemakeService.syncSession(req.params.sessionId, {
        userId: currentUserId,
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '视频复刻进度同步失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻进度同步失败'));
    }
  });

  router.get('/sessions/:sessionId/events', (req, res) => {
    try {
      const afterIndex = req.query.afterIndex === undefined ? undefined : Number(req.query.afterIndex);
      res.json(videoRemakeService.listEvents(req.params.sessionId, {
        userId: getCurrentUserId(req),
        afterIndex,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻事件获取失败'));
    }
  });

  router.post('/sessions/:sessionId/chat', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.sendChat(req.params.sessionId, {
        userId,
        message: String(req.body.message || ''),
      })
        .then((result) => res.json(result))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '聊天指令处理失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '聊天指令处理失败'));
    }
  });

  router.post('/sessions/:sessionId/cards/:cardId/confirm', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.confirmCard(req.params.sessionId, req.params.cardId, {
        userId,
        cardType: String(req.body.cardType || '') as VideoRemakeCardType,
        data: req.body.data,
        mode: req.body.mode === 'save_only' ? 'save_only' : 'confirm',
      })
        .then((session) => res.json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '卡片确认失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '卡片确认失败'));
    }
  });

  router.post('/sessions/:sessionId/cards/:cardId/cancel', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.cancelCard(req.params.sessionId, req.params.cardId, {
        userId,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '卡片取消失败'));
    }
  });

  router.post('/sessions/:sessionId/cards/:cardId/edit', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.editCard(req.params.sessionId, req.params.cardId, {
        userId,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '卡片编辑失败'));
    }
  });

  router.post('/sessions/:sessionId/cards/:cardId/regenerate', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.regenerateCard(req.params.sessionId, req.params.cardId, {
        userId,
        cardType: String(req.body.cardType || '') as VideoRemakeCardType,
        instruction: req.body.instruction ? String(req.body.instruction) : undefined,
      })
        .then((session) => res.json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '卡片重新生成失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '卡片重新生成失败'));
    }
  });

  router.post('/sessions/:sessionId/cards/:cardId/final-video/segments/:segmentIndex/regenerate', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.regenerateFinalVideoSegment(req.params.sessionId, req.params.cardId, {
        userId,
        segmentIndex: Number(req.params.segmentIndex),
        prompt: typeof req.body.prompt === 'string' ? req.body.prompt : undefined,
      })
        .then((session) => res.json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '分段重新生成失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '分段重新生成失败'));
    }
  });

  router.post('/sessions/:sessionId/cards/:cardId/retry-expert', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      void videoRemakeService.retryExpert(req.params.sessionId, req.params.cardId, {
        userId,
      })
        .then((session) => res.json(session))
        .catch((error) => sendError(res, 400, getErrorMessage(error, '专家重新解析失败')));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '专家重新解析失败'));
    }
  });

  router.post('/sessions/:sessionId/cancel', (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      res.json(videoRemakeService.cancelSession(req.params.sessionId, {
        userId,
      }));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '视频复刻流程取消失败'));
    }
  });

  return router;
}
