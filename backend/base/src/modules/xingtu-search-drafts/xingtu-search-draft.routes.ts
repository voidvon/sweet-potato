import { Router } from 'express';
import { sendError } from '../../shared/http.js';
import { xingtuSearchDraftService } from './xingtu-search-draft.service.js';
import type { XingtuCriterion, XingtuSearchMode } from './xingtu-search-draft.types.js';

function parseSearchMode(value: unknown): XingtuSearchMode {
  return String(value || '').trim() === 'nickname' ? 'nickname' : 'content';
}

function parseCriteria(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as XingtuCriterion[];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const criterion = item as Partial<XingtuCriterion>;
    if (!criterion.field || !criterion.op || criterion.value === undefined) {
      return [];
    }
    return [{
      field: String(criterion.field).trim(),
      op: criterion.op,
      value: criterion.value,
    } as XingtuCriterion];
  });
}

export function createXingtuSearchDraftRouter() {
  const router = Router();

  router.post('/', (req, res) => {
    try {
      const result = xingtuSearchDraftService.createDraft({
        userId: String(req.body.userId || '').trim(),
        profileId: String(req.body.profileId || '').trim(),
        keyword: String(req.body.keyword || '').trim(),
        searchMode: parseSearchMode(req.body.searchMode),
        criteria: parseCriteria(req.body.criteria),
        sourceText: typeof req.body.sourceText === 'string' ? req.body.sourceText : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '搜索草稿创建失败');
    }
  });

  router.get('/:id', (req, res) => {
    try {
      const userId = String(req.query.userId || '').trim();
      res.json(xingtuSearchDraftService.getDraft(userId, req.params.id));
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '搜索草稿读取失败');
    }
  });

  router.patch('/:id', (req, res) => {
    try {
      const result = xingtuSearchDraftService.updateDraft({
        userId: String(req.body.userId || '').trim(),
        draftId: req.params.id,
        patch: req.body.patch && typeof req.body.patch === 'object'
          ? {
              add: parseCriteria((req.body.patch as { add?: unknown }).add),
              removeFields: Array.isArray((req.body.patch as { removeFields?: unknown }).removeFields)
                ? (req.body.patch as { removeFields?: string[] }).removeFields?.map((item) => String(item).trim()).filter(Boolean)
                : undefined,
              replace: parseCriteria((req.body.patch as { replace?: unknown }).replace),
            }
          : undefined,
      });
      res.json(result);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '搜索草稿更新失败');
    }
  });

  router.post('/:id/run', async (req, res) => {
    try {
      const userId = String(req.body.userId || '').trim();
      const page = Number(req.body.page || 1);
      res.json(await xingtuSearchDraftService.runDraft(userId, req.params.id, page));
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '搜索草稿执行失败');
    }
  });

  return router;
}
