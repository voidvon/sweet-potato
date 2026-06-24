import { Router } from 'express';
import { requireAdmin } from '../../shared/auth.middleware.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { listRoleAssignableResourceTree } from '../route-resources/route-resource.service.js';
import {
  createAppRole,
  deleteAppRole,
  listAppRoles,
  updateAppRole,
} from './role.service.js';

export function createRoleRouter() {
  const router = Router();

  router.use(requireAdmin);

  router.get('/resource-tree', (req, res) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    res.json(listRoleAssignableResourceTree({
      includeDisabled: false,
      platform: platform === 'web' || platform === 'admin' ? platform : undefined,
    }));
  });

  router.get('/', (_req, res) => {
    res.json(listAppRoles());
  });

  router.post('/', (req, res) => {
    try {
      const role = createAppRole({
        name: req.body.name,
        description: req.body.description,
        resourceIds: req.body.resourceIds,
        isDefault: req.body.isDefault,
      });
      res.status(201).json({ role });
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '角色创建失败'));
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const role = updateAppRole(req.params.id, {
        name: req.body.name,
        description: req.body.description,
        resourceIds: req.body.resourceIds,
        isDefault: req.body.isDefault,
      });
      res.json({ role });
    } catch (error) {
      const message = getErrorMessage(error, '角色更新失败');
      sendError(res, message === '角色不存在' ? 404 : 400, message);
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      deleteAppRole(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      const message = getErrorMessage(error, '角色删除失败');
      sendError(res, message === '角色不存在' ? 404 : 400, message);
    }
  });

  return router;
}
