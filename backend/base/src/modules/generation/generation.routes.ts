import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { registerGenerationEventClient } from './generation.events.js';
import { generationRepository } from './generation.repository.js';

function getCurrentUserId(req: import('express').Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

export function createGenerationRouter() {
  const router = Router();

  router.get('/events', requirePermission('web.module.chat'), (req, res) => {
    const userId = getCurrentUserId(req);
    if (!userId) {
      sendError(res, 401, '请先登录');
      return;
    }
    registerGenerationEventClient(userId, res);
  });

  router.get('/jobs/:id', requirePermission('web.module.chat'), (req, res) => {
    const userId = getCurrentUserId(req);
    const jobId = String(req.params.id || '');
    const job = generationRepository.findJob(jobId);
    if (!job) {
      sendError(res, 404, '任务不存在');
      return;
    }
    if (job.userId !== userId) {
      sendError(res, 403, '无权访问该任务');
      return;
    }
    res.json({
      job,
      items: generationRepository.listItems(job.id),
    });
  });

  return router;
}
