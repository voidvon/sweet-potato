import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { siteAccessLogService } from './site-access-log.service.js';

export function createSiteAccessLogRouter() {
  const router = Router();
  router.use(requirePermission('admin.route.system.access_logs.view'));

  router.get('/', (req, res) => {
    res.json(siteAccessLogService.list(req.query));
  });

  router.get('/settings', (_req, res) => {
    res.json(siteAccessLogService.getSettings());
  });

  router.put('/settings', (req, res) => {
    try {
      res.json(siteAccessLogService.updateSettings(req.body || {}));
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '日志设置保存失败');
    }
  });

  return router;
}
