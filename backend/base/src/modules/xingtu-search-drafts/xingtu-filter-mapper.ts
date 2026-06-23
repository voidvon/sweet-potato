import { findXingtuCatalogValueLabel } from './xingtu-filter-catalog.js';
import type { XingtuAutomationPreviewResult, XingtuAutomationSearchInput, XingtuCriterion, XingtuSearchDraft } from './xingtu-search-draft.types.js';

function quoteRangeForCriterion(criterion: XingtuCriterion) {
  if (criterion.field !== 'quote_21_60s') {
    return null;
  }
  if (criterion.op === 'between' && Array.isArray(criterion.value) && criterion.value.length === 2) {
    return { min: String(criterion.value[0] || ''), max: String(criterion.value[1] || '') };
  }
  if (criterion.op === 'gte' && typeof criterion.value === 'string') {
    return { min: criterion.value, max: '' };
  }
  if (criterion.op === 'lte' && typeof criterion.value === 'string') {
    return { min: '', max: criterion.value };
  }
  return null;
}

export function mapXingtuDraftToAutomationInput(draft: XingtuSearchDraft, page = 1): XingtuAutomationPreviewResult {
  if (draft.automationFilters && typeof draft.automationFilters === 'object') {
    return {
      automationInput: {
        keyword: draft.keyword,
        searchMode: draft.searchMode,
        page,
        filters: draft.automationFilters,
      },
      unsupportedCriteria: [],
    };
  }

  const filters: Record<string, unknown> = {};
  const unsupportedCriteria: XingtuCriterion[] = [];

  for (const criterion of draft.criteria) {
    if (criterion.field === 'industry' && criterion.op === 'eq' && typeof criterion.value === 'string') {
      filters.industry = findXingtuCatalogValueLabel('industry', criterion.value);
      continue;
    }

    if (criterion.field === 'creator_type' && criterion.op === 'in' && Array.isArray(criterion.value)) {
      filters.creatorTypes = criterion.value.map((item) => findXingtuCatalogValueLabel('creator_type', item));
      continue;
    }

    if (criterion.field === 'short_drama_topic' && criterion.op === 'in' && Array.isArray(criterion.value)) {
      filters.shortDramaSelections = criterion.value.map((item) => findXingtuCatalogValueLabel('short_drama_topic', item));
      continue;
    }

    if (criterion.field === 'region' && criterion.op === 'eq' && typeof criterion.value === 'string') {
      filters.matchFilters = {
        ...(filters.matchFilters && typeof filters.matchFilters === 'object' ? filters.matchFilters as Record<string, unknown> : {}),
        region: findXingtuCatalogValueLabel('region', criterion.value),
      };
      continue;
    }

    const quoteRange = quoteRangeForCriterion(criterion);
    if (quoteRange) {
      filters.matchFilters = {
        ...(filters.matchFilters && typeof filters.matchFilters === 'object' ? filters.matchFilters as Record<string, unknown> : {}),
        quote21To60s: quoteRange,
      };
      continue;
    }

    unsupportedCriteria.push(criterion);
  }

  const automationInput: XingtuAutomationSearchInput = {
    keyword: draft.keyword,
    searchMode: draft.searchMode,
    page,
    filters,
  };

  return {
    automationInput,
    unsupportedCriteria,
  };
}
