import { randomUUID } from 'node:crypto';
import { desktopAutomationClient } from '../desktop-automation/desktop-automation.client.js';
import { findXingtuCatalogValueLabel } from './xingtu-filter-catalog.js';
import { mapXingtuDraftToAutomationInput } from './xingtu-filter-mapper.js';
import { xingtuSearchDraftRepository } from './xingtu-search-draft.repository.js';
import type {
  XingtuCreateDraftInput,
  XingtuCriterion,
  XingtuDraftSummary,
  XingtuReplaceDraftInput,
  XingtuRunDraftResult,
  XingtuSearchDraft,
  XingtuUpdateDraftInput,
  XingtuUpdateDraftResult,
} from './xingtu-search-draft.types.js';

function assertUserId(userId: string) {
  if (!userId.trim()) {
    throw new Error('缺少用户 ID');
  }
}

function assertDraftOwnership(draft: XingtuSearchDraft | undefined, userId: string) {
  if (!draft) {
    throw new Error('搜索草稿不存在');
  }
  if (draft.userId !== userId) {
    throw new Error('无权访问该搜索草稿');
  }
  return draft;
}

function normalizeKeyword(keyword: string) {
  return keyword.replace(/\s+/g, ' ').trim();
}

function dedupeCriteria(criteria: XingtuCriterion[]) {
  const byField = new Map<string, XingtuCriterion>();
  for (const criterion of criteria) {
    byField.set(criterion.field, criterion);
  }
  return Array.from(byField.values());
}

function applyCriterionReplacements(existing: XingtuCriterion[], incoming: XingtuCriterion[]) {
  return dedupeCriteria([
    ...existing.filter((item) => !incoming.some((next) => next.field === item.field)),
    ...incoming,
  ]);
}

function summarizeCriterion(criterion: XingtuCriterion) {
  if (criterion.field === 'industry' && criterion.op === 'eq' && typeof criterion.value === 'string') {
    return `行业=${findXingtuCatalogValueLabel('industry', criterion.value)}`;
  }
  if (criterion.field === 'region' && criterion.op === 'eq' && typeof criterion.value === 'string') {
    return `地区=${findXingtuCatalogValueLabel('region', criterion.value)}`;
  }
  if (criterion.field === 'creator_type' && criterion.op === 'in' && Array.isArray(criterion.value)) {
    return `达人类型=${criterion.value.map((item) => findXingtuCatalogValueLabel('creator_type', item)).join('、')}`;
  }
  if (criterion.field === 'quote_21_60s' && criterion.op === 'lte' && typeof criterion.value === 'string') {
    return `21-60秒报价<=${criterion.value}`;
  }
  if (criterion.field === 'quote_21_60s' && criterion.op === 'gte' && typeof criterion.value === 'string') {
    return `21-60秒报价>=${criterion.value}`;
  }
  if (criterion.field === 'quote_21_60s' && criterion.op === 'between' && Array.isArray(criterion.value) && criterion.value.length === 2) {
    return `21-60秒报价=${criterion.value[0]}~${criterion.value[1]}`;
  }
  return `${criterion.field}:${criterion.op}`;
}

function buildDraftSummary(draft: XingtuSearchDraft): XingtuDraftSummary {
  return {
    keyword: draft.keyword,
    searchMode: draft.searchMode,
    criteriaCount: draft.criteria.length,
    criteriaSummary: draft.criteria.map(summarizeCriterion),
  };
}

function normalizeTaskResult(value: unknown) {
  if (!value || typeof value !== 'object') {
    return {
      results: [] as Array<Record<string, unknown>>,
      pagination: null as XingtuRunDraftResult['pagination'],
    };
  }
  const payload = value as {
    results?: unknown;
    pagination?: XingtuRunDraftResult['pagination'];
  };
  return {
    results: Array.isArray(payload.results)
      ? payload.results.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      : [],
    pagination: payload.pagination && typeof payload.pagination === 'object' ? payload.pagination : null,
  };
}

export const xingtuSearchDraftService = {
  createDraft(input: XingtuCreateDraftInput) {
    assertUserId(input.userId);
    if (!input.profileId.trim()) {
      throw new Error('缺少 profileId');
    }
    const keyword = normalizeKeyword(input.keyword);
    if (!keyword) {
      throw new Error('搜索关键词不能为空');
    }

    const now = new Date().toISOString();
    const draft: XingtuSearchDraft = {
      id: randomUUID(),
      userId: input.userId.trim(),
      profileId: input.profileId.trim(),
      keyword,
      searchMode: input.searchMode,
      criteria: dedupeCriteria(input.criteria || []),
      automationFilters: input.automationFilters || null,
      sourceText: input.sourceText?.trim() || undefined,
      status: 'draft',
      lastRunTaskId: null,
      lastResultSummary: null,
      createdAt: now,
      updatedAt: now,
    };

    xingtuSearchDraftRepository.create(draft);
    return {
      ok: true as const,
      draftId: draft.id,
      summary: buildDraftSummary(draft),
    };
  },

  getDraft(userId: string, draftId: string) {
    assertUserId(userId);
    const draft = assertDraftOwnership(xingtuSearchDraftRepository.find(draftId), userId.trim());
    return {
      ok: true as const,
      draft: {
        draftId: draft.id,
        profileId: draft.profileId,
        keyword: draft.keyword,
        searchMode: draft.searchMode,
        criteria: draft.criteria,
        automationFilters: draft.automationFilters || null,
        criteriaSummary: buildDraftSummary(draft).criteriaSummary,
        status: draft.status,
        lastResultSummary: draft.lastResultSummary || null,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      },
    };
  },

  replaceDraft(input: XingtuReplaceDraftInput) {
    assertUserId(input.userId);
    const current = assertDraftOwnership(xingtuSearchDraftRepository.find(input.draftId), input.userId.trim());
    const keyword = normalizeKeyword(input.keyword);
    if (!keyword) {
      throw new Error('搜索关键词不能为空');
    }

    const nextDraft: XingtuSearchDraft = {
      ...current,
      keyword,
      searchMode: input.searchMode,
      criteria: dedupeCriteria(input.criteria || []),
      automationFilters: input.automationFilters || null,
      sourceText: input.sourceText?.trim() || undefined,
      status: 'draft',
      lastRunTaskId: null,
      lastResultSummary: null,
      updatedAt: new Date().toISOString(),
    };

    xingtuSearchDraftRepository.update(nextDraft);

    return {
      ok: true as const,
      draftId: nextDraft.id,
      summary: buildDraftSummary(nextDraft),
    };
  },

  updateDraft(input: XingtuUpdateDraftInput): XingtuUpdateDraftResult {
    assertUserId(input.userId);
    const current = assertDraftOwnership(xingtuSearchDraftRepository.find(input.draftId), input.userId.trim());

    let nextDraft = current;
    const appliedChanges: string[] = [];
    const unresolvedTerms: string[] = [];
    const warnings: string[] = [];

    if (input.patch?.removeFields?.length) {
      nextDraft = {
        ...nextDraft,
        criteria: nextDraft.criteria.filter((item) => !input.patch?.removeFields?.includes(item.field)),
      };
      appliedChanges.push(...input.patch.removeFields.map((field) => `remove:${field}`));
    }

    if (input.patch?.replace?.length) {
      nextDraft = {
        ...nextDraft,
        criteria: applyCriterionReplacements(nextDraft.criteria, input.patch.replace),
      };
      appliedChanges.push(...input.patch.replace.map(summarizeCriterion));
    }

    if (input.patch?.add?.length) {
      nextDraft = {
        ...nextDraft,
        criteria: applyCriterionReplacements(nextDraft.criteria, input.patch.add),
      };
      appliedChanges.push(...input.patch.add.map(summarizeCriterion));
    }

    nextDraft = {
      ...nextDraft,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    };

    xingtuSearchDraftRepository.update(nextDraft);

    return {
      ok: true,
      draftId: nextDraft.id,
      summary: buildDraftSummary(nextDraft),
      appliedChanges,
      unresolvedTerms,
      warnings,
    };
  },

  async runDraft(userId: string, draftId: string, page = 1): Promise<XingtuRunDraftResult> {
    assertUserId(userId);
    const draft = assertDraftOwnership(xingtuSearchDraftRepository.find(draftId), userId.trim());
    const normalizedPage = Math.max(1, Math.floor(page || 1));
    const preview = mapXingtuDraftToAutomationInput(draft, normalizedPage);
    const now = new Date().toISOString();

    const warnings: string[] = [];
    if (preview.unsupportedCriteria.length) {
      warnings.push(`存在 ${preview.unsupportedCriteria.length} 个未映射到自动化输入的条件。`);
    }

    try {
      const health = await desktopAutomationClient.health();
      if (!health.ok) {
        throw new Error('桌面自动化 bridge 不可用');
      }

      const startResult = await desktopAutomationClient.startTask({
        adapter: 'xingtu-search-creators',
        profileId: draft.profileId,
        input: preview.automationInput,
      });
      if (!startResult.ok || !startResult.taskId) {
        throw new Error(startResult.message || '桌面自动化任务启动失败');
      }

      const task = await desktopAutomationClient.waitForTaskDone(startResult.taskId);
      if (task.status === 'failed') {
        throw new Error(task.error || '桌面自动化任务执行失败');
      }
      if (task.status === 'canceled') {
        throw new Error('桌面自动化任务已取消');
      }

      const normalized = normalizeTaskResult(task.result);
      const resultCount = normalized.results.length;
      const updatedDraft: XingtuSearchDraft = {
        ...draft,
        status: 'completed',
        lastRunTaskId: task.id,
        lastResultSummary: {
          currentPage: normalized.pagination?.currentPage || normalizedPage,
          totalPages: normalized.pagination?.totalPages,
          resultCount,
          executionMode: 'desktop',
          runAt: now,
        },
        updatedAt: now,
      };
      xingtuSearchDraftRepository.update(updatedDraft);

      return {
        ok: true,
        draftId: draft.id,
        profileId: draft.profileId,
        keyword: draft.keyword,
        searchMode: draft.searchMode,
        status: 'desktop_done',
        pagination: normalized.pagination,
        results: normalized.results,
        warnings,
        automationInputPreview: preview.automationInput,
      };
    } catch (error) {
      const updatedDraft: XingtuSearchDraft = {
        ...draft,
        status: 'failed',
        lastResultSummary: {
          currentPage: normalizedPage,
          executionMode: 'desktop',
          runAt: now,
        },
        updatedAt: now,
      };
      xingtuSearchDraftRepository.update(updatedDraft);
      throw error instanceof Error ? error : new Error('桌面自动化执行失败');
    }
  },
};
