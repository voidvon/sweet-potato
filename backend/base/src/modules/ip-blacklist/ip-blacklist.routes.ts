import { Router } from 'express';
import { requireAdmin } from '../../shared/auth.middleware.js';
import { resolveClientIp } from '../../shared/client-ip.js';
import { sendError } from '../../shared/http.js';
import { ipBlacklistService } from './ip-blacklist.service.js';

export function createIpBlacklistRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => {
    res.json(ipBlacklistService.getSettings(resolveClientIp(req)));
  });

  router.put('/', (req, res) => {
    try {
      res.json(ipBlacklistService.updateSettings(req.body || {}, resolveClientIp(req)));
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : 'IP 黑名单保存失败');
    }
  });

  return router;
}
