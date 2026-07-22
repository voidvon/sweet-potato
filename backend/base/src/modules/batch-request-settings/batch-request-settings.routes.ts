import { Router } from 'express';
import { requireAdmin } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { batchRequestSettingsService } from './batch-request-settings.service.js';

export function createBatchRequestSettingsRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (_req, res) => {
    res.json(batchRequestSettingsService.getSettings());
  });

  router.put('/', (req, res) => {
    try {
      res.json(batchRequestSettingsService.updateSettings(req.body || {}));
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '批量 API 请求设置保存失败');
    }
  });

  return router;
}
