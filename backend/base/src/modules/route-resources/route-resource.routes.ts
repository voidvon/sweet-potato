import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import {
  createRouteResource,
  deleteRouteResource,
  getRouteResource,
  listRoleAssignableResourceTree,
  listRouteResourceTree,
  listRouteResources,
  updateRouteResource,
} from './route-resource.service.js';

export function createRouteResourceRouter() {
  const router = Router();

  router.get('/public-tree', (req, res) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    res.json(listRouteResourceTree({
      includeDisabled: false,
      platform: platform === 'web' || platform === 'admin' ? platform : undefined,
    }));
  });

  router.use(requirePermission('admin.route.system.route_resources.view'));

  router.get('/', (req, res) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    res.json(listRouteResources({
      includeDisabled,
      platform: platform === 'web' || platform === 'admin' ? platform : undefined,
    }));
  });

  router.get('/tree', (req, res) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const assignableOnly = req.query.assignableOnly === '1' || req.query.assignableOnly === 'true';
    const includeDisabled = req.query.includeDisabled === '1' || req.query.includeDisabled === 'true';
    const filters = {
      includeDisabled,
      platform: platform === 'web' || platform === 'admin' ? platform : undefined,
    } as const;
    res.json(assignableOnly ? listRoleAssignableResourceTree(filters) : listRouteResourceTree(filters));
  });

  router.get('/:id', (req, res) => {
    const resource = getRouteResource(String(req.params.id || ''));
    if (!resource) {
      sendError(res, 404, '资源不存在');
      return;
    }
    res.json(resource);
  });

  router.post('/', (req, res) => {
    try {
      const resource = createRouteResource(req.body);
      res.status(201).json({ resource });
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '资源创建失败'));
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const resource = updateRouteResource(String(req.params.id || ''), req.body);
      res.json({ resource });
    } catch (error) {
      const message = getErrorMessage(error, '资源更新失败');
      sendError(res, message === '资源不存在' ? 404 : 400, message);
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      deleteRouteResource(String(req.params.id || ''));
      res.json({ ok: true });
    } catch (error) {
      const message = getErrorMessage(error, '资源删除失败');
      sendError(res, message === '资源不存在' ? 404 : 400, message);
    }
  });

  return router;
}
