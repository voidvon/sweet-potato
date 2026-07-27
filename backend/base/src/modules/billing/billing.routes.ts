import { Router } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { getErrorMessage, sendError } from '../../shared/http.js';
import {
  getBillingSettings,
  getCreditSummary,
  listAdminBillableUsageRecords,
  listAdminCreditLedger,
  listAdminLlmUsageRecords,
  listCustomerCreditLedger,
  normalizeBillingSettings,
  saveBillingSettings,
} from './billing.service.js';

export function createBillingRouter() {
  const router = Router();

  router.get('/me/ledger', (req, res) => {
    const currentUserId = req.auth?.userId;
    if (!currentUserId) {
      sendError(res, 401, '请先登录');
      return;
    }
    const limit = Number(req.query.limit || 100);
    res.json(listCustomerCreditLedger({ userId: currentUserId, limit: Number.isFinite(limit) ? limit : 100 }));
  });

  router.get('/me/summary', (req, res) => {
    const currentUserId = req.auth?.userId;
    if (!currentUserId) {
      sendError(res, 401, '请先登录');
      return;
    }
    res.json(getCreditSummary(currentUserId));
  });

  router.get('/me/usage', (req, res) => {
    sendError(res, 403, '当前账户无权访问 LLM 用量明细');
  });

  router.get('/me/billable-usage', (req, res) => {
    sendError(res, 403, '当前账户无权访问业务消费明细');
  });

  router.use(requirePermission('admin.route.system.billing.view'));

  router.get('/settings', (_req, res) => {
    const settings = getBillingSettings();
    if (!settings) {
      sendError(res, 404, '计费配置不存在');
      return;
    }
    res.json(settings);
  });

  router.put('/settings', (req, res) => {
    try {
      const current = getBillingSettings() || undefined;
      const settings = normalizeBillingSettings(req.body || {}, current);
      res.json(saveBillingSettings(settings));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '计费配置保存失败'));
    }
  });

  router.get('/ledger', (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const limit = Number(req.query.limit || 100);
    res.json(listAdminCreditLedger({ userId, limit: Number.isFinite(limit) ? limit : 100 }));
  });

  router.get('/usage', (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const limit = Number(req.query.limit || 100);
    res.json(listAdminLlmUsageRecords({ userId, limit: Number.isFinite(limit) ? limit : 100 }));
  });

  router.get('/billable-usage', (req, res) => {
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
    const limit = Number(req.query.limit || 100);
    res.json(listAdminBillableUsageRecords({ userId, limit: Number.isFinite(limit) ? limit : 100 }));
  });

  return router;
}
