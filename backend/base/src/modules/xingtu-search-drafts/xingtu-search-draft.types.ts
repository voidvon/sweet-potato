export type XingtuSearchMode = 'content' | 'nickname';

export type XingtuCriterionOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'between'
  | 'gte'
  | 'lte'
  | 'contains';

export type XingtuCriterionValue = string | string[] | [string, string];

export type XingtuCriterion = {
  field: string;
  op: XingtuCriterionOp;
  value: XingtuCriterionValue;
};

export type XingtuFilterFieldDef = {
  field: string;
  label: string;
  category: string;
  valueType: 'single' | 'multi' | 'range';
  supportedOps: XingtuCriterionOp[];
  aliases?: string[];
};

export type XingtuFilterValueDef = {
  field: string;
  value: string;
  label: string;
  aliases?: string[];
};

export type XingtuSearchDraftStatus = 'draft' | 'running' | 'completed' | 'failed';

export type XingtuSearchDraftRunSummary = {
  resultCount?: number;
  currentPage?: number;
  totalPages?: number;
  executionMode?: 'preview' | 'desktop';
  runAt?: string;
};

export type XingtuSearchDraft = {
  id: string;
  userId: string;
  profileId: string;
  keyword: string;
  searchMode: XingtuSearchMode;
  criteria: XingtuCriterion[];
  automationFilters?: Record<string, unknown> | null;
  sourceText?: string;
  status: XingtuSearchDraftStatus;
  lastRunTaskId?: string | null;
  lastResultSummary?: XingtuSearchDraftRunSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type XingtuSearchDraftRecord = Omit<XingtuSearchDraft, 'criteria' | 'automationFilters' | 'lastResultSummary' | 'sourceText' | 'lastRunTaskId'> & {
  criteria: string;
  automationFilters: string | null;
  sourceText: string | null;
  lastRunTaskId: string | null;
  lastResultSummary: string | null;
};

export type XingtuResolveFiltersResult = {
  ok: true;
  keyword: string;
  searchMode: XingtuSearchMode;
  criteria: XingtuCriterion[];
  unresolvedTerms: string[];
  warnings: string[];
  assumptions: string[];
};

export type XingtuDraftSummary = {
  keyword: string;
  searchMode: XingtuSearchMode;
  criteriaCount: number;
  criteriaSummary: string[];
};

export type XingtuCreateDraftInput = {
  userId: string;
  profileId: string;
  keyword: string;
  searchMode: XingtuSearchMode;
  criteria?: XingtuCriterion[];
  automationFilters?: Record<string, unknown> | null;
  sourceText?: string;
};

export type XingtuDraftPatch = {
  add?: XingtuCriterion[];
  removeFields?: string[];
  replace?: XingtuCriterion[];
};

export type XingtuUpdateDraftInput = {
  userId: string;
  draftId: string;
  patch?: XingtuDraftPatch;
};

export type XingtuReplaceDraftInput = {
  userId: string;
  draftId: string;
  keyword: string;
  searchMode: XingtuSearchMode;
  criteria?: XingtuCriterion[];
  automationFilters?: Record<string, unknown> | null;
  sourceText?: string;
};

export type XingtuAutomationSearchInput = {
  keyword: string;
  searchMode: XingtuSearchMode;
  page?: number;
  filters: Record<string, unknown>;
};

export type XingtuAutomationPreviewResult = {
  automationInput: XingtuAutomationSearchInput;
  unsupportedCriteria: XingtuCriterion[];
};

export type XingtuUpdateDraftResult = {
  ok: true;
  draftId: string;
  summary: XingtuDraftSummary;
  appliedChanges: string[];
  unresolvedTerms: string[];
  warnings: string[];
};

export type XingtuRunDraftResult = {
  ok: true;
  draftId: string;
  profileId: string;
  keyword: string;
  searchMode: XingtuSearchMode;
  status: 'desktop_done';
  pagination: {
    currentPage: number;
    totalPages: number;
    pageSize: number;
    estimatedTotal: number;
    hasPrev?: boolean;
    hasNext?: boolean;
    visiblePages?: number[];
    showQuickJumper?: boolean;
  } | null;
  results: Array<Record<string, unknown>>;
  warnings: string[];
  automationInputPreview: XingtuAutomationSearchInput;
};
