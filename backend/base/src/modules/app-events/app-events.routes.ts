import { Router } from 'express';
import { sendError } from '../../shared/http.js';
import { registerAppEventClient } from './app.events.js';

export function createAppEventsRouter() {
  const router = Router();

  router.get('/events', (req, res) => {
    const userId = req.auth?.userId || req.auth?.user?.id || '';
    if (!userId) {
      sendError(res, 401, '请先登录');
      return;
    }
    registerAppEventClient(userId, res);
  });

  return router;
}
