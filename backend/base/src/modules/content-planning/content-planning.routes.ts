import { Router, type Request } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { contentPlanningService } from './content-planning.service.js';
import { registerContentPlanningEventClient } from './content-planning.events.js';

function currentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

function bodyRecord(req: Request) {
  return req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
}

function withUserId<T extends Record<string, unknown>>(req: Request, input: T) {
  return { ...input, userId: currentUserId(req) };
}

export function createContentPlanningRouter() {
  const router = Router();
  router.use(requirePermission('web.module.content.create_video'));

  router.get('/events', (req, res) => {
    const userId = currentUserId(req);
    if (!userId) {
      sendError(res, 401, '请先登录');
      return;
    }
    registerContentPlanningEventClient(userId, res);
  });

  router.post('/sessions', (req, res) => {
    try {
      res.json(contentPlanningService.createSession(withUserId(req, bodyRecord(req)) as never));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning session creation failed'));
    }
  });

  router.get('/sessions/:id/updates', (req, res) => {
    try {
      const since = typeof req.query.since === 'string' ? req.query.since : undefined;
      res.json(contentPlanningService.getUpdates(currentUserId(req), req.params.id, since));
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, 'planning session not found'));
    }
  });

  router.get('/sessions/:id', (req, res) => {
    try {
      res.json(contentPlanningService.getSession(currentUserId(req), req.params.id));
    } catch (error) {
      sendError(res, 404, getErrorMessage(error, 'planning session not found'));
    }
  });

  router.post('/sessions/:id/analyze', (req, res) => {
    try {
      res.status(202).json(contentPlanningService.analyze(withUserId(req, {
        ...bodyRecord(req),
        sessionId: req.params.id,
        productName: String(bodyRecord(req).productName || ''),
        imageAssetIds: Array.isArray(bodyRecord(req).imageAssetIds) ? bodyRecord(req).imageAssetIds : [],
      }) as never));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning analysis failed'));
    }
  });

  router.patch('/sessions/:id/confirmation', (req, res) => {
    try {
      res.json(contentPlanningService.updateConfirmation(withUserId(req, {
        ...bodyRecord(req),
        sessionId: req.params.id,
      }) as never));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning confirmation failed'));
    }
  });

  router.patch('/sessions/:id/settings', (req, res) => {
    try {
      res.json(contentPlanningService.updateSettings(withUserId(req, {
        ...bodyRecord(req),
        sessionId: req.params.id,
      }) as never));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning settings update failed'));
    }
  });

  router.post('/sessions/:id/generate', (req, res) => {
    try {
      const body = bodyRecord(req);
      res.status(202).json(contentPlanningService.generate(
        currentUserId(req),
        req.params.id,
        body.regenerate === true,
      ));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning generation failed'));
    }
  });

  router.post('/sessions/:id/candidates/:candidateId/select', (req, res) => {
    try {
      res.json(contentPlanningService.selectCandidate(currentUserId(req), req.params.id, req.params.candidateId));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning candidate selection failed'));
    }
  });

  router.post('/sessions/:id/apply', (req, res) => {
    try {
      const body = bodyRecord(req);
      res.json(contentPlanningService.apply(
        currentUserId(req),
        req.params.id,
        typeof body.candidateId === 'string' ? body.candidateId : undefined,
      ));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'planning result apply failed'));
    }
  });

  return router;
}
