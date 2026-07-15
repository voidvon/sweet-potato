import { Router } from 'express';
import { getSiteConfig } from '../billing/billing.service.js';
import { sendError } from '../../shared/http.js';

export function createSiteConfigRouter() {
  const router = Router();

  router.get('/', (_req, res) => {
    const config = getSiteConfig();
    if (!config) {
      sendError(res, 404, '站点配置不存在');
      return;
    }
    res.json(config);
  });

  return router;
}
