import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { streamVideoUnderstanding } from './video-understanding.client.js';

function writeEvent(response: import('express').Response, event: object) {
  response.write(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function createVideoUnderstandingRouter() {
  const router = Router();
  router.use(requirePermission('web.module.chat'));

  router.post('/stream', async (req, res) => {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.once('close', onClose);
    try {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      for await (const event of streamVideoUnderstanding({ ...req.body, signal: controller.signal })) {
        writeEvent(res, event);
        if (event.type === 'error') {
          break;
        }
      }
    } catch (error) {
      if (!res.headersSent) {
        sendError(res, 502, error instanceof Error ? error.message : '视频理解请求失败');
      } else if (!res.writableEnded) {
        writeEvent(res, { type: 'error', message: error instanceof Error ? error.message : '视频理解请求失败' });
      }
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
