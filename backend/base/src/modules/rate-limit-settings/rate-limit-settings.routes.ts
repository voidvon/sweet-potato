import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { rateLimitSettingsService } from './rate-limit-settings.service.js';

export function createRateLimitSettingsRouter() {
  const router = Router();
  router.use(requirePermission('admin.route.system.settings.view'));

  router.get('/', (_req, res) => {
    res.json({ rules: rateLimitSettingsService.listRules() });
  });

  router.put('/', (req, res) => {
    try {
      res.json({ rules: rateLimitSettingsService.updateRules(req.body || {}) });
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '限速规则保存失败');
    }
  });

  return router;
}
