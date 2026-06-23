import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Pagination, Popover, Radio, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { InputRef } from 'antd';
import { ArrowRightOutlined, CaretDownOutlined, CheckOutlined, InfoCircleOutlined, PlusOutlined, SearchOutlined, XFilled } from '@ant-design/icons';
import {
  cancelAutomationTask,
  closeAutomationWindows,
  getAutomationTask,
  isElectronEgg,
  startAutomationTask,
  stopAutomationProfile,
  type AutomationTask,
} from '../../ipc';
import { type OptionPopoverFilterGroup, type OptionPopoverFilterValue } from '../../components/OptionPopoverFilter';
import { type RangePopoverFilterValue } from '../../components/RangePopoverFilter';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import { BuyinCreatorFilters } from './BuyinCreatorFilters';
import {
  collectBuyinFilterTokens,
  cloneBuyinFilterValue,
  createEmptyBuyinFilterValue,
  type BuyinFilterValue,
} from './buyinCreatorFilterData';
import { XingtuCreatorFilters, type PriceQuoteFilterValue, type TaskCountFilterValue } from './XingtuCreatorFilters';
import {
  COST_PERFORMANCE_FILTERS,
  createAudienceProfileGroups,
  MATCH_BACKGROUND_FILTERS,
  MATCH_CONNECTED_USER_FIELDS,
  MATCH_CONTENT_TOPIC_FILTERS,
  MATCH_CREATOR_TYPE_FILTERS,
  MATCH_FOLLOWER_COUNT_FILTER,
  MATCH_PERSONA_CAREER_FILTER,
  MATCH_PERSONA_CHARACTER_FILTER,
  MATCH_PERSONA_HOBBY_FILTER,
  MATCH_PERSONA_INDUSTRY_FILTERS,
  MATCH_PERSONA_TONE_FILTER,
  TOPIC_RECOMMENDATION_FILTERS,
  normalizeShortDramaSelections,
  type AudienceModeOption,
  type CollaborationObjectOption,
  type CreatorTypeOption,
  type GoalOption,
  type MatchInlineFilterItem,
} from './xingtuCreatorFilterData';
import { CREATOR_OPS_PLATFORM_CONFIG, type CreatorOpsPlatform } from './creatorOpsPlatforms';
import { CreatorResultsTable, type CreatorSearchResult } from './CreatorResultsTable';
import './XingtuCreatorPage.scss';

const XINGTU_PAGINATION_LOCALE = {
  jump_to: '跳至',
  page: '页',
  prev_page: '上一页',
  next_page: '下一页',
};

type AutomationTaskError = Error & {
  taskStatus?: AutomationTask['status'];
};

function createAutomationTaskError(task: AutomationTask): AutomationTaskError {
  const error = new Error(
    task.error || (task.status === 'canceled' ? '任务已取消' : '任务未完成'),
  ) as AutomationTaskError;
  error.taskStatus = task.status;
  return error;
}

function isCanceledAutomationTaskError(error: unknown): error is AutomationTaskError {
  return error instanceof Error && (error as AutomationTaskError).taskStatus === 'canceled';
}

type XingtuAccount = {
  id: string;
  name: string;
  profileId: string;
  avatarUrl?: string;
  status: 'logged_in';
  createdAt: string;
};

type XingtuLoginResult = {
  loggedIn?: boolean;
  nickname?: string;
  url?: string;
};

type XingtuCreatorSearchTaskResult = {
  keyword?: string;
  url?: string;
  results?: CreatorSearchResult[];
  pagination?: XingtuCreatorSearchPagination;
};

type XingtuCreatorSearchPagination = {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  estimatedTotal: number;
  hasPrev?: boolean;
  hasNext?: boolean;
  visiblePages?: number[];
  showQuickJumper?: boolean;
};

type XingtuCreatorSearchMode = 'content' | 'nickname';

type XingtuCreatorSearchFilters = {
  collaborationObject: CollaborationObjectOption;
  creatorTypes: string[];
  shortDramaSelections: string[];
  shortLiveSelections: string[];
  extraCreatorTypes: string[];
  industry: string;
  goals: string[];
  grassSelections: string[];
  audienceMode: AudienceModeOption;
  audienceLabels: string[];
  matchSelections: string[];
  matchFilters: {
    creatorTypeTags: string[];
    creatorTypeSelections: MatchPopoverSelectionMap;
    contentTopicSelections: MatchPopoverSelectionMap;
    personaIndustrySelections: MatchPopoverSelectionMap;
    personaCareer: OptionPopoverFilterValue;
    personaHobby: OptionPopoverFilterValue;
    personaTone: OptionPopoverFilterValue;
    personaCharacter: OptionPopoverFilterValue;
    gender: OptionPopoverFilterValue;
    region: OptionPopoverFilterValue;
    education: OptionPopoverFilterValue;
    yellowV: OptionPopoverFilterValue;
    connectedUsers: RangePopoverFilterValue;
    followers: OptionPopoverFilterValue;
    viewerProfile: OptionPopoverFilterValue;
    fanProfile: OptionPopoverFilterValue;
  };
  costPerformanceSelections: MatchPopoverSelectionMap;
  costPerformanceRanges: RangeSelectionMap;
  costPerformancePriceQuote: PriceQuoteFilterValue;
  costPerformanceTaskCount: TaskCountFilterValue;
  topicRecommendationSelections: MatchPopoverSelectionMap;
  topicRecommendationTags: string[];
  buyinFilters: BuyinFilterValue;
  buyinFilterTokens: string[];
};

type ExecutedCreatorSearch = {
  keyword: string;
  profileId: string;
  searchMode: XingtuCreatorSearchMode;
  filters: XingtuCreatorSearchFilters;
};

type MatchPopoverSelectionMap = Record<string, OptionPopoverFilterValue>;
type RangeSelectionMap = Record<string, RangePopoverFilterValue>;

const SEARCH_MODE_LABELS: Record<XingtuCreatorSearchMode, string> = {
  content: '内容找人',
  nickname: '昵称找人',
};

const XINGTU_SEARCH_MODE_PLACEHOLDERS: Record<XingtuCreatorSearchMode, string> = {
  content: '按内容关键词找达人',
  nickname: '输入达人昵称、抖音号或星图ID',
};
const BUYIN_SEARCH_PLACEHOLDER = '输入达人昵称、抖音号或达人ID';
const MATCH_VIEWER_PROFILE_GROUPS = createAudienceProfileGroups('观众');
const MATCH_FAN_PROFILE_GROUPS = createAudienceProfileGroups('粉丝');
const MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS = MATCH_PERSONA_INDUSTRY_FILTERS as Array<Extract<MatchInlineFilterItem, { type: 'popover' }>>;
const MATCH_BACKGROUND_POPOVER_FILTERS = MATCH_BACKGROUND_FILTERS as Array<Extract<MatchInlineFilterItem, { type: 'popover' }>>;
const MATCH_PERSONA_CAREER_POPOVER_FILTER = MATCH_PERSONA_CAREER_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_PERSONA_HOBBY_POPOVER_FILTER = MATCH_PERSONA_HOBBY_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_PERSONA_TONE_POPOVER_FILTER = MATCH_PERSONA_TONE_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_PERSONA_CHARACTER_POPOVER_FILTER = MATCH_PERSONA_CHARACTER_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_FOLLOWER_COUNT_POPOVER_FILTER = MATCH_FOLLOWER_COUNT_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const COST_PERFORMANCE_INLINE_FILTERS = COST_PERFORMANCE_FILTERS.flatMap((group) => group.filters);
const TOPIC_RECOMMENDATION_INLINE_FILTERS = TOPIC_RECOMMENDATION_FILTERS;

function getCostPerformancePriceQuoteFilter() {
  const item = COST_PERFORMANCE_INLINE_FILTERS.find((entry): entry is Extract<MatchInlineFilterItem, { type: 'priceQuote' }> => entry.type === 'priceQuote');
  if (!item) {
    throw new Error('Missing xingtu cost performance price quote filter');
  }
  return item;
}

const COST_PERFORMANCE_PRICE_QUOTE_FILTER = getCostPerformancePriceQuoteFilter();

function getCostPerformanceTaskCountFilter() {
  const item = COST_PERFORMANCE_INLINE_FILTERS.find((entry): entry is Extract<MatchInlineFilterItem, { type: 'taskCount' }> => entry.type === 'taskCount');
  if (!item) {
    throw new Error('Missing xingtu cost performance task count filter');
  }
  return item;
}

const COST_PERFORMANCE_TASK_COUNT_FILTER = getCostPerformanceTaskCountFilter();

function createEmptyOptionPopoverValue(groups: OptionPopoverFilterGroup[]): OptionPopoverFilterValue {
  return Object.fromEntries(groups.map((group) => [group.key, []]));
}

function createEmptyFilterSelectionMap(items: MatchInlineFilterItem[]): MatchPopoverSelectionMap {
  return Object.fromEntries(
    items
      .filter((item): item is Extract<MatchInlineFilterItem, { type: 'popover' | 'presetRange' }> => item.type === 'popover' || item.type === 'presetRange')
      .map((item) => [item.label, createEmptyOptionPopoverValue(item.groups)]),
  );
}

function createEmptyRangePopoverValue(fields: string[]): RangePopoverFilterValue {
  return Object.fromEntries(fields.map((field) => [field, { min: '', max: '' }]));
}

function createEmptyRangeSelectionMap(items: Array<{ type: string; label: string; fields?: string[] }>): RangeSelectionMap {
  return Object.fromEntries(
    items
      .filter((item): item is { type: 'range' | 'presetRange'; label: string; fields: string[] } => (item.type === 'range' || item.type === 'presetRange') && Array.isArray(item.fields))
      .map((item) => [item.label, createEmptyRangePopoverValue(item.fields)]),
  );
}

function createEmptyPriceQuoteValue(): PriceQuoteFilterValue {
  return {
    quoteType: createEmptyOptionPopoverValue([COST_PERFORMANCE_PRICE_QUOTE_FILTER.quoteTypeGroup]),
    quoteRange: createEmptyOptionPopoverValue([COST_PERFORMANCE_PRICE_QUOTE_FILTER.quoteRangeGroup]),
    customRange: createEmptyRangePopoverValue(COST_PERFORMANCE_PRICE_QUOTE_FILTER.fields),
  };
}

function createEmptyTaskCountValue(): TaskCountFilterValue {
  return {
    taskTime: createEmptyOptionPopoverValue([COST_PERFORMANCE_TASK_COUNT_FILTER.taskTimeGroup]),
    taskCount: {
      min: '',
      max: '',
    },
  };
}


function collectPopoverSelectionTokens(
  prefix: string,
  groups: OptionPopoverFilterGroup[],
  value: OptionPopoverFilterValue,
) {
  const tokens: string[] = [];

  for (const group of groups) {
    const selectedOptions = value[group.key] || [];
    for (const option of selectedOptions) {
      tokens.push([prefix, group.label, option].filter(Boolean).join('/'));
    }
  }

  return tokens;
}

function collectFilterSelectionMapTokens(
  prefix: string,
  items: MatchInlineFilterItem[],
  value: MatchPopoverSelectionMap,
) {
  const tokens: string[] = [];

  for (const item of items) {
    if (item.type !== 'popover' && item.type !== 'presetRange') {
      continue;
    }
    tokens.push(...collectPopoverSelectionTokens(`${prefix}/${item.label}`, item.groups, value[item.label] || createEmptyOptionPopoverValue(item.groups)));
  }

  return tokens;
}

function collectRangeSelectionTokens(prefix: string, value: RangePopoverFilterValue) {
  const tokens: string[] = [];

  for (const [field, range] of Object.entries(value)) {
    const min = String(range?.min || '').trim();
    const max = String(range?.max || '').trim();
    if (!min && !max) {
      continue;
    }
    tokens.push(`${prefix}/${field}/${min || '-'}~${max || '-'}`);
  }

  return tokens;
}

function collectPriceQuoteSelectionTokens(prefix: string, value: PriceQuoteFilterValue) {
  return [
    ...collectPopoverSelectionTokens(`${prefix}/报价类型`, [COST_PERFORMANCE_PRICE_QUOTE_FILTER.quoteTypeGroup], value.quoteType),
    ...collectPopoverSelectionTokens(`${prefix}/报价区间`, [COST_PERFORMANCE_PRICE_QUOTE_FILTER.quoteRangeGroup], value.quoteRange),
    ...collectRangeSelectionTokens(`${prefix}/报价区间`, value.customRange),
  ];
}

function collectTaskCountSelectionTokens(prefix: string, value: TaskCountFilterValue) {
  const tokens = collectPopoverSelectionTokens(`${prefix}/任务时间`, [COST_PERFORMANCE_TASK_COUNT_FILTER.taskTimeGroup], value.taskTime);
  const min = String(value.taskCount?.min || '').trim();
  const max = String(value.taskCount?.max || '').trim();
  if (min || max) {
    tokens.push(`${prefix}/任务数量/${min || '-'}~${max || '-'}`);
  }
  return tokens;
}

function cloneOptionPopoverValue(value: OptionPopoverFilterValue) {
  return Object.fromEntries(
    Object.entries(value).map(([key, options]) => [key, [...options]]),
  );
}

function cloneMatchPopoverSelectionMap(value: MatchPopoverSelectionMap) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneOptionPopoverValue(item)]),
  );
}

function cloneRangePopoverValue(value: RangePopoverFilterValue) {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, { min: field.min, max: field.max }]),
  );
}

function cloneRangeSelectionMap(value: RangeSelectionMap) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneRangePopoverValue(item)]),
  );
}

function clonePriceQuoteValue(value: PriceQuoteFilterValue) {
  return {
    quoteType: cloneOptionPopoverValue(value.quoteType),
    quoteRange: cloneOptionPopoverValue(value.quoteRange),
    customRange: cloneRangePopoverValue(value.customRange),
  };
}

function cloneTaskCountValue(value: TaskCountFilterValue) {
  const fallback = createEmptyTaskCountValue();
  return {
    taskTime: cloneOptionPopoverValue(value.taskTime || fallback.taskTime),
    taskCount: {
      min: value.taskCount?.min || '',
      max: value.taskCount?.max || '',
    },
  };
}

function createProfileId(prefix: string) {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

  return `${prefix}-${Date.now()}-${randomPart}`;
}

function normalizeAccounts(accounts: unknown[]): XingtuAccount[] {
  const seenProfileIds = new Set<string>();
  const normalizedAccounts: XingtuAccount[] = [];

  for (const account of accounts) {
    if (!(
      account
      && typeof account === 'object'
      && typeof (account as XingtuAccount).id === 'string'
      && typeof (account as XingtuAccount).name === 'string'
      && typeof (account as XingtuAccount).profileId === 'string'
      && (account as XingtuAccount).status === 'logged_in'
      && typeof (account as XingtuAccount).createdAt === 'string'
    )) {
      continue;
    }

    const normalizedAccount = account as XingtuAccount;
    if (seenProfileIds.has(normalizedAccount.profileId)) {
      continue;
    }
    seenProfileIds.add(normalizedAccount.profileId);
    normalizedAccounts.push(normalizedAccount);
  }

  return normalizedAccounts;
}

function upsertAccount(accounts: XingtuAccount[], nextAccount: XingtuAccount) {
  return normalizeAccounts([
    nextAccount,
    ...accounts.filter((account) => account.profileId !== nextAccount.profileId),
  ]);
}

function readAccounts(storageKey: string): XingtuAccount[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeAccounts(parsed);
  } catch {
    return [];
  }
}

function writeAccounts(storageKey: string, accounts: XingtuAccount[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(normalizeAccounts(accounts)));
}

function readSelectedProfileId(selectedAccountKey: string) {
  return window.localStorage.getItem(selectedAccountKey) || '';
}

function writeSelectedProfileId(selectedAccountKey: string, profileId: string) {
  if (!profileId) {
    window.localStorage.removeItem(selectedAccountKey);
    return;
  }
  window.localStorage.setItem(selectedAccountKey, profileId);
}

function describeAutomationTaskStatus(task: AutomationTask | null) {
  if (!task) {
    return '';
  }
  switch (task.status) {
    case 'created':
      return '已创建';
    case 'running':
      return '执行中';
    case 'waiting_user':
      return '等待用户操作';
    case 'done':
      return '已完成';
    case 'failed':
      return '失败';
    case 'canceled':
      return '已取消';
    default:
      return task.status;
  }
}

function getAutomationTaskStatusTagColor(task: AutomationTask | null) {
  switch (task?.status) {
    case 'done':
      return 'success';
    case 'failed':
      return 'error';
    case 'canceled':
      return 'warning';
    case 'running':
    case 'waiting_user':
      return 'processing';
    default:
      return 'default';
  }
}

function getAutomationTaskLogTriggerClassName(task: AutomationTask | null) {
  if (!task) {
    return 'xingtu-task-log-trigger';
  }
  return `xingtu-task-log-trigger is-${task.status}`;
}

type XingtuCreatorPageProps = {
  platform?: CreatorOpsPlatform;
};

export function XingtuCreatorPage({ platform = 'xingtu' }: XingtuCreatorPageProps) {
  const platformConfig = CREATOR_OPS_PLATFORM_CONFIG[platform] || CREATOR_OPS_PLATFORM_CONFIG.xingtu;
  const { setHeaderExtra } = useWorkspaceHeader();
  const commandInputRef = useRef<InputRef>(null);
  const [accounts, setAccounts] = useState<XingtuAccount[]>(() => readAccounts(platformConfig.storageKey));
  const [selectedProfileId, setSelectedProfileId] = useState(() => readSelectedProfileId(platformConfig.selectedAccountKey));
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [searchMode, setSearchMode] = useState<XingtuCreatorSearchMode>('content');
  const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
  const [loginProfileId, setLoginProfileId] = useState<string | null>(null);
  const [loginTask, setLoginTask] = useState<AutomationTask | null>(null);
  const [searchTask, setSearchTask] = useState<AutomationTask | null>(null);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [isSwitchingProfile, setIsSwitchingProfile] = useState(false);
  const [openingProfileIds, setOpeningProfileIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isStoppingSearch, setIsStoppingSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<CreatorSearchResult[]>([]);
  const [searchPagination, setSearchPagination] = useState<XingtuCreatorSearchPagination | null>(null);
  const [lastSearchKeyword, setLastSearchKeyword] = useState('');
  const [lastExecutedSearch, setLastExecutedSearch] = useState<ExecutedCreatorSearch | null>(null);
  const [collaborationObject, setCollaborationObject] = useState<CollaborationObjectOption>('不限');
  const [activeCreatorType, setActiveCreatorType] = useState<CreatorTypeOption | ''>('短视频达人');
  const [shortDramaSelections, setShortDramaSelections] = useState<string[]>([]);
  const [shortLiveSelections, setShortLiveSelections] = useState<string[]>([]);
  const [extraCreatorTypes, setExtraCreatorTypes] = useState<string[]>([]);
  const [industry, setIndustry] = useState<string>('不限');
  const [goals, setGoals] = useState<string[]>(['品牌曝光']);
  const [grassSelections, setGrassSelections] = useState<string[]>([]);
  const [audienceMode, setAudienceMode] = useState<AudienceModeOption>('不限');
  const [audienceTreeKeys, setAudienceTreeKeys] = useState<string[]>([]);
  const [matchCreatorTypeTags, setMatchCreatorTypeTags] = useState<string[]>([]);
  const [matchCreatorTypeSelections, setMatchCreatorTypeSelections] = useState<MatchPopoverSelectionMap>(() => createEmptyFilterSelectionMap(MATCH_CREATOR_TYPE_FILTERS));
  const [matchContentTopicSelections, setMatchContentTopicSelections] = useState<MatchPopoverSelectionMap>(() => createEmptyFilterSelectionMap(MATCH_CONTENT_TOPIC_FILTERS));
  const [matchPersonaIndustrySelections, setMatchPersonaIndustrySelections] = useState<MatchPopoverSelectionMap>(() => createEmptyFilterSelectionMap(MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS));
  const [matchPersonaCareer, setMatchPersonaCareer] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_PERSONA_CAREER_POPOVER_FILTER.groups));
  const [matchPersonaHobby, setMatchPersonaHobby] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_PERSONA_HOBBY_POPOVER_FILTER.groups));
  const [matchPersonaTone, setMatchPersonaTone] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_PERSONA_TONE_POPOVER_FILTER.groups));
  const [matchPersonaCharacter, setMatchPersonaCharacter] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_PERSONA_CHARACTER_POPOVER_FILTER.groups));
  const [matchGender, setMatchGender] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_BACKGROUND_POPOVER_FILTERS[0].groups));
  const [matchRegion, setMatchRegion] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_BACKGROUND_POPOVER_FILTERS[1].groups));
  const [matchEducation, setMatchEducation] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_BACKGROUND_POPOVER_FILTERS[2].groups));
  const [matchYellowV, setMatchYellowV] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_BACKGROUND_POPOVER_FILTERS[3].groups));
  const [matchConnectedUsers, setMatchConnectedUsers] = useState<RangePopoverFilterValue>(() => createEmptyRangePopoverValue(MATCH_CONNECTED_USER_FIELDS));
  const [matchFollowers, setMatchFollowers] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_FOLLOWER_COUNT_POPOVER_FILTER.groups));
  const [matchViewerProfile, setMatchViewerProfile] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_VIEWER_PROFILE_GROUPS));
  const [matchFanProfile, setMatchFanProfile] = useState<OptionPopoverFilterValue>(() => createEmptyOptionPopoverValue(MATCH_FAN_PROFILE_GROUPS));
  const [costPerformanceSelections, setCostPerformanceSelections] = useState<MatchPopoverSelectionMap>(() => createEmptyFilterSelectionMap(COST_PERFORMANCE_INLINE_FILTERS));
  const [costPerformanceRanges, setCostPerformanceRanges] = useState<RangeSelectionMap>(() => createEmptyRangeSelectionMap(COST_PERFORMANCE_INLINE_FILTERS));
  const [costPerformancePriceQuote, setCostPerformancePriceQuote] = useState<PriceQuoteFilterValue>(() => createEmptyPriceQuoteValue());
  const [costPerformanceTaskCount, setCostPerformanceTaskCount] = useState<TaskCountFilterValue>(() => createEmptyTaskCountValue());
  const [topicRecommendationSelections, setTopicRecommendationSelections] = useState<MatchPopoverSelectionMap>(() => createEmptyFilterSelectionMap(TOPIC_RECOMMENDATION_INLINE_FILTERS));
  const [topicRecommendationTags, setTopicRecommendationTags] = useState<string[]>([]);
  const [buyinFilters, setBuyinFilters] = useState<BuyinFilterValue>(() => createEmptyBuyinFilterValue());

  const isLoginRunning = Boolean(loginTaskId);
  const selectedAccount = accounts.find((account) => account.profileId === selectedProfileId) || null;
  const displayedAccount = selectedAccount || accounts[0] || null;
  const isPageActiveRef = useRef(true);
  const activeSearchTaskIdRef = useRef('');
  const activeSearchProfileIdRef = useRef('');
  const searchCancelRequestedRef = useRef(false);
  const profileSwitchPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const selectedProfileIdRef = useRef(selectedProfileId);
  const completedLoginTaskIdsRef = useRef<Set<string>>(new Set());
  function selectCreatorTypeGroup(option: CreatorTypeOption, selected: boolean) {
    setActiveCreatorType(selected ? option : '');
    setShortDramaSelections([]);
    setShortLiveSelections([]);
    setExtraCreatorTypes([]);
  }

  function toggleCreatorType(option: CreatorTypeOption) {
    if (activeCreatorType === option) {
      return;
    }
    selectCreatorTypeGroup(option, true);
  }

  function selectExtraCreatorType(option: string) {
    const nextValue = extraCreatorTypes[0] === option ? '' : option;
    setActiveCreatorType(nextValue ? '其它题材' : '');
    setShortDramaSelections([]);
    setShortLiveSelections([]);
    setExtraCreatorTypes(nextValue ? [nextValue] : []);
  }

  function selectGoalGroup(option: GoalOption, selected: boolean) {
    if (!selected) {
      setGoals([]);
      if (option === '破圈种草') {
        setGrassSelections([]);
      }
      return;
    }

    setGoals([option]);
    if (option !== '破圈种草') {
      setGrassSelections([]);
    }
  }

  function toggleGoal(option: GoalOption) {
    if (goals.includes(option)) {
      return;
    }
    selectGoalGroup(option, true);
  }

  function handleShortDramaSelectionsChange(values: string[]) {
    const nextValues = normalizeShortDramaSelections(values);
    setActiveCreatorType(nextValues.length > 0 ? '短剧演员' : '');
    setShortDramaSelections(nextValues);
    setShortLiveSelections([]);
    setExtraCreatorTypes([]);
  }

  function handleShortLiveSelectionsChange(values: string[]) {
    setActiveCreatorType(values.length > 0 ? '短直达人' : '');
    setShortDramaSelections([]);
    setShortLiveSelections(values);
    setExtraCreatorTypes([]);
  }

  function handleGrassSelectionSelect(option: string) {
    const nextValue = grassSelections[0] === option ? '' : option;
    selectGoalGroup('破圈种草', Boolean(nextValue));
    setGrassSelections(nextValue ? [nextValue] : []);
  }

  function handleAudienceModeReset() {
    setAudienceMode('不限');
    setAudienceTreeKeys([]);
  }

  function handleAudienceOptionSelect(option: string) {
    const nextValue = audienceTreeKeys[0] === option ? '' : option;
    setAudienceMode(nextValue ? '八大人群' : '不限');
    setAudienceTreeKeys(nextValue ? [nextValue] : []);
  }

  function updateFilterSelectionMap(
    currentValue: MatchPopoverSelectionMap,
    label: string,
    nextValue: OptionPopoverFilterValue,
  ) {
    return {
      ...currentValue,
      [label]: nextValue,
    };
  }

  function clearFilterSelectionMap(items: MatchInlineFilterItem[]) {
    return createEmptyFilterSelectionMap(items);
  }

  function resetMatchCreatorTypeFilters() {
    setMatchCreatorTypeTags([]);
    setMatchCreatorTypeSelections(clearFilterSelectionMap(MATCH_CREATOR_TYPE_FILTERS));
  }

  function toggleMatchCreatorTypeTag(label: string) {
    setMatchCreatorTypeTags((currentValue) => (
      currentValue.includes(label)
        ? currentValue.filter((value) => value !== label)
        : [...currentValue, label]
    ));
  }

  function handleMatchCreatorTypeSelectionChange(label: string, nextValue: OptionPopoverFilterValue) {
    setMatchCreatorTypeSelections((currentValue) => updateFilterSelectionMap(currentValue, label, nextValue));
  }

  function handleMatchPersonaIndustrySelectionChange(label: string, nextValue: OptionPopoverFilterValue) {
    setMatchPersonaIndustrySelections((currentValue) => updateFilterSelectionMap(currentValue, label, nextValue));
  }

  function resetMatchContentTopicFilters() {
    setMatchContentTopicSelections(clearFilterSelectionMap(MATCH_CONTENT_TOPIC_FILTERS));
  }

  function handleMatchContentTopicSelectionChange(label: string, nextValue: OptionPopoverFilterValue) {
    setMatchContentTopicSelections((currentValue) => updateFilterSelectionMap(currentValue, label, nextValue));
  }

  function handleCostPerformanceSelectionChange(label: string, nextValue: OptionPopoverFilterValue) {
    setCostPerformanceSelections((currentValue) => updateFilterSelectionMap(currentValue, label, nextValue));
  }

  function handleTopicRecommendationSelectionChange(label: string, nextValue: OptionPopoverFilterValue) {
    setTopicRecommendationSelections((currentValue) => updateFilterSelectionMap(currentValue, label, nextValue));
  }

  function handleCostPerformanceRangeChange(label: string, nextValue: RangePopoverFilterValue) {
    setCostPerformanceRanges((currentValue) => ({
      ...currentValue,
      [label]: nextValue,
    }));
  }

  function toggleTopicRecommendationTag(label: string) {
    setTopicRecommendationTags((currentValue) => (
      currentValue.includes(label)
        ? currentValue.filter((value) => value !== label)
        : [...currentValue, label]
    ));
  }

  useEffect(() => {
    isPageActiveRef.current = true;

    return () => {
      isPageActiveRef.current = false;
      const taskId = activeSearchTaskIdRef.current.trim();
      const profileId = activeSearchProfileIdRef.current.trim();
      activeSearchTaskIdRef.current = '';
      activeSearchProfileIdRef.current = '';
      if (taskId) {
        void cancelAutomationTask(taskId);
      }
      if (profileId) {
        void closeAutomationWindows(profileId);
      }
    };
  }, []);

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
  }, [selectedProfileId]);

  useEffect(() => {
    if (!accounts.length) {
      if (selectedProfileId) {
        setSelectedProfileId('');
        selectedProfileIdRef.current = '';
        writeSelectedProfileId(platformConfig.selectedAccountKey, '');
      }
      return;
    }

    if (!selectedProfileId || !accounts.some((account) => account.profileId === selectedProfileId)) {
      setSelectedProfileId(accounts[0].profileId);
      selectedProfileIdRef.current = accounts[0].profileId;
      writeSelectedProfileId(platformConfig.selectedAccountKey, accounts[0].profileId);
    }
  }, [accounts, selectedProfileId]);

  useEffect(() => {
    if (!loginTaskId || !loginProfileId) {
      return undefined;
    }

    let stopped = false;
    let syncing = false;
    const syncTask = async () => {
      if (syncing) {
        return;
      }
      syncing = true;
      const result = await getAutomationTask(loginTaskId);
      syncing = false;
      if (stopped) {
        return;
      }
      if (!result.ok || !result.task) {
        stopped = true;
        message.error(result.message || `获取${platformConfig.platformName}登录状态失败`);
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
        return;
      }

      setLoginTask(result.task);
      if (result.task.status === 'done') {
        if (completedLoginTaskIdsRef.current.has(result.task.id)) {
          stopped = true;
          setLoginTaskId(null);
          setLoginProfileId(null);
          setLoginTask(null);
          return;
        }
        completedLoginTaskIdsRef.current.add(result.task.id);
        stopped = true;
        const taskResult = (result.task.result || {}) as XingtuLoginResult;
        const nickname = typeof taskResult.nickname === 'string' ? taskResult.nickname.trim() : '';
        if (!nickname) {
          message.error(`${platformConfig.platformName}登录成功，但未读取到账号昵称`);
        } else {
          const nextAccount: XingtuAccount = {
            id: loginProfileId,
            name: nickname,
            profileId: loginProfileId,
            status: 'logged_in',
            createdAt: new Date().toISOString(),
          };
          let nextAccounts: XingtuAccount[] = [];
          setAccounts((current) => {
            nextAccounts = upsertAccount(current, nextAccount);
            return nextAccounts;
          });
          writeAccounts(platformConfig.storageKey, nextAccounts);
          await selectAccountProfile(loginProfileId);
          message.success(`${platformConfig.platformName}账号已登录：${nickname}`);
        }
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
        return;
      }

      if (result.task.status === 'canceled') {
        stopped = true;
        message.info(`${platformConfig.platformName}登录窗口已关闭，未新增账号`);
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
        return;
      }

      if (result.task.status === 'failed') {
        stopped = true;
        message.error(result.task.error || `${platformConfig.platformName}登录失败`);
        setLoginTaskId(null);
        setLoginProfileId(null);
        setLoginTask(null);
      }
    };

    void syncTask();
    const timer = window.setInterval(syncTask, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [loginProfileId, loginTaskId, selectAccountProfile]);

  async function selectAccountProfile(profileId: string) {
    const nextProfileId = profileId.trim();
    if (!nextProfileId) {
      return;
    }

    const queued = profileSwitchPromiseRef.current
      .catch(() => {})
      .then(async () => {
        if (!isPageActiveRef.current) {
          return;
        }

        setIsSwitchingProfile(true);
        const previousProfileId = selectedProfileIdRef.current.trim();

        selectedProfileIdRef.current = nextProfileId;
        setSelectedProfileId(nextProfileId);
        writeSelectedProfileId(platformConfig.selectedAccountKey, nextProfileId);
        setAccountPickerOpen(false);

        if (isElectronEgg && previousProfileId && previousProfileId !== nextProfileId) {
          const stopResult = await stopAutomationProfile(previousProfileId, platformConfig.site);
          if (isPageActiveRef.current && !stopResult.ok) {
            message.warning(stopResult.message || '关闭旧账号自动化任务失败');
          }
        }
      })
      .finally(() => {
        if (isPageActiveRef.current) {
          setIsSwitchingProfile(false);
        }
      });

    profileSwitchPromiseRef.current = queued;
    await queued;
  }

  const handleAddAccount = useCallback(async () => {
    if (!isElectronEgg) {
      message.warning(`${platformConfig.platformName}登录只能在 Electron 应用内运行`);
      return;
    }
    if (isLoginRunning) {
      message.warning(`已有${platformConfig.platformName}登录窗口正在处理`);
      return;
    }

    const profileId = createProfileId(platformConfig.profilePrefix);
    setIsStartingLogin(true);
    const result = await startAutomationTask({
      adapter: platformConfig.loginAdapter,
      profileId,
      input: {},
    });
    setIsStartingLogin(false);

    if (!result.ok || !result.taskId) {
      message.error(result.message || `打开${platformConfig.platformName}登录窗口失败`);
      return;
    }

    setLoginProfileId(profileId);
    setLoginTaskId(result.taskId);
    setLoginTask(result.task || null);
    setAccountPickerOpen(false);
    message.info(`请在新窗口完成${platformConfig.platformName}登录`);
  }, [isLoginRunning, platformConfig.loginAdapter, platformConfig.platformName, platformConfig.profilePrefix]);

  const handleSelectAccount = useCallback(async (account: XingtuAccount) => {
    await selectAccountProfile(account.profileId);
  }, [selectAccountProfile]);

  const handleOpenProfile = useCallback(async (account: XingtuAccount) => {
    await waitForPendingProfileSwitch();
    if (!isElectronEgg) {
      message.warning('只能在 Electron 应用内打开 Profile');
      return;
    }
    if (openingProfileIds.includes(account.profileId)) {
      return;
    }

    setOpeningProfileIds((value) => [...value, account.profileId]);
    try {
      const result = await startAutomationTask({
        adapter: platformConfig.openProfileAdapter,
        profileId: account.profileId,
        input: {},
      });

      if (!result.ok || !result.taskId) {
        message.error(result.message || `打开${platformConfig.platformName} Profile 失败`);
        return;
      }

      await waitForTaskDone(result.taskId);
      if (!isPageActiveRef.current) {
        return;
      }

      message.success(`已打开：${account.name}`);
    } catch (error) {
      if (!isPageActiveRef.current) {
        return;
      }
      message.error(error instanceof Error ? error.message : `打开${platformConfig.platformName} Profile 失败`);
    } finally {
      if (isPageActiveRef.current) {
        setOpeningProfileIds((value) => value.filter((profileId) => profileId !== account.profileId));
      }
    }
  }, [openingProfileIds]);

  function setActiveSearchTask(taskId: string, profileId: string) {
    activeSearchTaskIdRef.current = taskId.trim();
    activeSearchProfileIdRef.current = profileId.trim();
  }

  function clearActiveSearchTask(taskId?: string) {
    if (taskId && activeSearchTaskIdRef.current !== taskId.trim()) {
      return;
    }
    activeSearchTaskIdRef.current = '';
    activeSearchProfileIdRef.current = '';
  }

  async function waitForPendingProfileSwitch() {
    await profileSwitchPromiseRef.current.catch(() => {});
  }

  function waitForTaskDone(taskId: string, onUpdate?: (task: AutomationTask) => void) {
    return new Promise<AutomationTask>((resolve, reject) => {
      const timer = window.setInterval(async () => {
        if (!isPageActiveRef.current) {
          window.clearInterval(timer);
          reject(new Error('页面已关闭'));
          return;
        }
        const result = await getAutomationTask(taskId);
        if (!result.ok || !result.task) {
          window.clearInterval(timer);
          reject(new Error(result.message || '获取任务状态失败'));
          return;
        }
        onUpdate?.(result.task);
        if (result.task.status === 'done') {
          window.clearInterval(timer);
          resolve(result.task);
          return;
        }
        if (result.task.status === 'failed' || result.task.status === 'canceled') {
          window.clearInterval(timer);
          reject(createAutomationTaskError(result.task));
        }
      }, 1000);
    });
  }

  async function handleStopCreatorSearch() {
    const taskId = activeSearchTaskIdRef.current.trim();
    if (!taskId || isStoppingSearch) {
      return;
    }

    searchCancelRequestedRef.current = true;
    setIsStoppingSearch(true);
    const result = await cancelAutomationTask(taskId);
    if (!isPageActiveRef.current) {
      return;
    }
    if (!result.ok) {
      if (result.task) {
        setSearchTask(result.task);
      }
      if (result.message === '任务已结束') {
        searchCancelRequestedRef.current = false;
        setIsStoppingSearch(false);
        return;
      }
      searchCancelRequestedRef.current = false;
      setIsStoppingSearch(false);
      message.error(result.message || '停止达人搜索失败');
      return;
    }
    if (result.task) {
      setSearchTask(result.task);
    }
  }

  function buildCurrentFilters(): XingtuCreatorSearchFilters {
    const activeAudienceKeys = audienceMode === '八大人群' ? audienceTreeKeys : [];
    const activeCreatorTypes = activeCreatorType ? [activeCreatorType] : [];
    const matchSelections = [
      ...matchCreatorTypeTags.map((item) => `匹配度/达人类型/${item}`),
      ...collectFilterSelectionMapTokens('匹配度/达人类型', MATCH_CREATOR_TYPE_FILTERS, matchCreatorTypeSelections),
      ...collectFilterSelectionMapTokens('匹配度/内容主题', MATCH_CONTENT_TOPIC_FILTERS, matchContentTopicSelections),
      ...collectFilterSelectionMapTokens('匹配度/达人人设', MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS, matchPersonaIndustrySelections),
      ...collectPopoverSelectionTokens('匹配度/达人人设/职业爱好/职业', MATCH_PERSONA_CAREER_POPOVER_FILTER.groups, matchPersonaCareer),
      ...collectPopoverSelectionTokens('匹配度/达人人设/职业爱好/爱好', MATCH_PERSONA_HOBBY_POPOVER_FILTER.groups, matchPersonaHobby),
      ...collectPopoverSelectionTokens('匹配度/达人人设/职业爱好/达人调性', MATCH_PERSONA_TONE_POPOVER_FILTER.groups, matchPersonaTone),
      ...collectPopoverSelectionTokens('匹配度/达人人设/职业爱好/主要出镜人物', MATCH_PERSONA_CHARACTER_POPOVER_FILTER.groups, matchPersonaCharacter),
      ...collectPopoverSelectionTokens('匹配度/背景信息/达人性别', MATCH_BACKGROUND_POPOVER_FILTERS[0].groups, matchGender),
      ...collectPopoverSelectionTokens('匹配度/背景信息/所在地域', MATCH_BACKGROUND_POPOVER_FILTERS[1].groups, matchRegion),
      ...collectPopoverSelectionTokens('匹配度/背景信息/学历', MATCH_BACKGROUND_POPOVER_FILTERS[2].groups, matchEducation),
      ...collectPopoverSelectionTokens('匹配度/背景信息/黄v认证', MATCH_BACKGROUND_POPOVER_FILTERS[3].groups, matchYellowV),
      ...collectRangeSelectionTokens('匹配度/受众画像', matchConnectedUsers),
      ...collectPopoverSelectionTokens('匹配度/受众画像/粉丝数量', MATCH_FOLLOWER_COUNT_POPOVER_FILTER.groups, matchFollowers),
      ...collectPopoverSelectionTokens('匹配度/受众画像/观众画像', MATCH_VIEWER_PROFILE_GROUPS, matchViewerProfile),
      ...collectPopoverSelectionTokens('匹配度/受众画像/粉丝画像', MATCH_FAN_PROFILE_GROUPS, matchFanProfile),
      ...collectFilterSelectionMapTokens('性价比', COST_PERFORMANCE_INLINE_FILTERS, costPerformanceSelections),
      ...Object.entries(costPerformanceRanges).flatMap(([label, value]) => collectRangeSelectionTokens(`性价比/${label}`, value)),
      ...collectPriceQuoteSelectionTokens('性价比/达人报价', costPerformancePriceQuote),
      ...collectTaskCountSelectionTokens('性价比/进行中的任务数', costPerformanceTaskCount),
      ...collectFilterSelectionMapTokens('主题推荐', TOPIC_RECOMMENDATION_INLINE_FILTERS, topicRecommendationSelections),
      ...topicRecommendationTags.map((item) => `主题推荐/${item}`),
    ];
    const buyinFilterTokens = collectBuyinFilterTokens(buyinFilters);

    return {
      collaborationObject,
      creatorTypes: activeCreatorTypes,
      shortDramaSelections,
      shortLiveSelections,
      extraCreatorTypes,
      industry,
      goals,
      grassSelections,
      audienceMode,
      audienceLabels: activeAudienceKeys.filter(Boolean),
      matchSelections,
      matchFilters: {
        creatorTypeTags: [...matchCreatorTypeTags],
        creatorTypeSelections: cloneMatchPopoverSelectionMap(matchCreatorTypeSelections),
        contentTopicSelections: cloneMatchPopoverSelectionMap(matchContentTopicSelections),
        personaIndustrySelections: cloneMatchPopoverSelectionMap(matchPersonaIndustrySelections),
        personaCareer: cloneOptionPopoverValue(matchPersonaCareer),
        personaHobby: cloneOptionPopoverValue(matchPersonaHobby),
        personaTone: cloneOptionPopoverValue(matchPersonaTone),
        personaCharacter: cloneOptionPopoverValue(matchPersonaCharacter),
        gender: cloneOptionPopoverValue(matchGender),
        region: cloneOptionPopoverValue(matchRegion),
        education: cloneOptionPopoverValue(matchEducation),
        yellowV: cloneOptionPopoverValue(matchYellowV),
        connectedUsers: cloneRangePopoverValue(matchConnectedUsers),
        followers: cloneOptionPopoverValue(matchFollowers),
        viewerProfile: cloneOptionPopoverValue(matchViewerProfile),
        fanProfile: cloneOptionPopoverValue(matchFanProfile),
      },
      costPerformanceSelections: cloneMatchPopoverSelectionMap(costPerformanceSelections),
      costPerformanceRanges: cloneRangeSelectionMap(costPerformanceRanges),
      costPerformancePriceQuote: clonePriceQuoteValue(costPerformancePriceQuote),
      costPerformanceTaskCount: cloneTaskCountValue(costPerformanceTaskCount),
      topicRecommendationSelections: cloneMatchPopoverSelectionMap(topicRecommendationSelections),
      topicRecommendationTags: [...topicRecommendationTags],
      buyinFilters: cloneBuyinFilterValue(buyinFilters),
      buyinFilterTokens,
    };
  }

  async function executeCreatorSearch(options?: { page?: number; search?: ExecutedCreatorSearch; pageOnly?: boolean }) {
    await waitForPendingProfileSwitch();
    const page = Math.max(1, options?.page || 1);
    const reuseSearch = options?.search || null;
    const pageOnly = Boolean(options?.pageOnly);
    const keyword = reuseSearch?.keyword || commandText.trim();
    const profileId = reuseSearch?.profileId || selectedProfileIdRef.current.trim() || displayedAccount?.profileId || '';
    const activeSearchMode = reuseSearch?.searchMode || searchMode;
    const filters = reuseSearch?.filters || buildCurrentFilters();

    if (!pageOnly && !keyword) {
      if (platformConfig.supportsSearchModes) {
        message.warning(activeSearchMode === 'nickname' ? '请输入达人昵称、抖音号或星图ID' : '请输入内容关键词');
      } else {
        message.warning('请输入达人昵称、抖音号或达人ID');
      }
      return;
    }
    if (!profileId) {
      message.warning(`请先新增或选择${platformConfig.platformName}账号`);
      return;
    }
    if (!isElectronEgg) {
      message.warning('达人搜索只能在 Electron 应用内运行');
      return;
    }
    if (isSearching) {
      return;
    }

    searchCancelRequestedRef.current = false;
    setIsStoppingSearch(false);
    commandInputRef.current?.focus();
    setIsSearching(true);
    if (!pageOnly) {
      setLastSearchKeyword(keyword);
    }
    if (!pageOnly && (!reuseSearch || page === 1)) {
      setSearchResults([]);
      setSearchPagination(null);
    }

    const executedSearch: ExecutedCreatorSearch = {
      keyword,
      profileId,
      searchMode: activeSearchMode,
      filters: {
        ...filters,
        creatorTypes: [...filters.creatorTypes],
        shortDramaSelections: [...filters.shortDramaSelections],
        shortLiveSelections: [...filters.shortLiveSelections],
        extraCreatorTypes: [...filters.extraCreatorTypes],
        goals: [...filters.goals],
        grassSelections: [...filters.grassSelections],
        audienceLabels: [...filters.audienceLabels],
        matchSelections: [...filters.matchSelections],
        matchFilters: {
          creatorTypeTags: [...filters.matchFilters.creatorTypeTags],
          creatorTypeSelections: cloneMatchPopoverSelectionMap(filters.matchFilters.creatorTypeSelections),
          contentTopicSelections: cloneMatchPopoverSelectionMap(filters.matchFilters.contentTopicSelections),
          personaIndustrySelections: cloneMatchPopoverSelectionMap(filters.matchFilters.personaIndustrySelections),
          personaCareer: cloneOptionPopoverValue(filters.matchFilters.personaCareer),
          personaHobby: cloneOptionPopoverValue(filters.matchFilters.personaHobby),
          personaTone: cloneOptionPopoverValue(filters.matchFilters.personaTone),
          personaCharacter: cloneOptionPopoverValue(filters.matchFilters.personaCharacter),
          gender: cloneOptionPopoverValue(filters.matchFilters.gender),
          region: cloneOptionPopoverValue(filters.matchFilters.region),
          education: cloneOptionPopoverValue(filters.matchFilters.education),
          yellowV: cloneOptionPopoverValue(filters.matchFilters.yellowV),
          connectedUsers: cloneRangePopoverValue(filters.matchFilters.connectedUsers),
          followers: cloneOptionPopoverValue(filters.matchFilters.followers),
          viewerProfile: cloneOptionPopoverValue(filters.matchFilters.viewerProfile),
          fanProfile: cloneOptionPopoverValue(filters.matchFilters.fanProfile),
        },
        costPerformanceSelections: cloneMatchPopoverSelectionMap(filters.costPerformanceSelections),
        costPerformanceRanges: cloneRangeSelectionMap(filters.costPerformanceRanges),
        costPerformancePriceQuote: clonePriceQuoteValue(filters.costPerformancePriceQuote || createEmptyPriceQuoteValue()),
        costPerformanceTaskCount: cloneTaskCountValue(filters.costPerformanceTaskCount || createEmptyTaskCountValue()),
        topicRecommendationSelections: cloneMatchPopoverSelectionMap(filters.topicRecommendationSelections),
        topicRecommendationTags: [...filters.topicRecommendationTags],
        buyinFilters: cloneBuyinFilterValue(filters.buyinFilters || createEmptyBuyinFilterValue()),
        buyinFilterTokens: [...(filters.buyinFilterTokens || [])],
      },
    };

    const started = await startAutomationTask({
      adapter: platformConfig.searchAdapter,
      profileId,
      input: pageOnly
        ? { page, pageOnly: true }
        : {
          keyword,
          page,
          searchMode: activeSearchMode,
          ...(platformConfig.supportsFilters ? { filters: executedSearch.filters } : {}),
        },
    });

    if (!isPageActiveRef.current) {
      if (started.ok && started.taskId) {
        void cancelAutomationTask(started.taskId);
        void closeAutomationWindows(profileId);
      }
      return;
    }

    if (!started.ok || !started.taskId) {
      setIsSearching(false);
      message.error(started.message || '启动达人搜索失败');
      return;
    }

    setActiveSearchTask(started.taskId, profileId);
    setSearchTask(started.task || null);

    try {
      const task = await waitForTaskDone(started.taskId, setSearchTask);
      if (!isPageActiveRef.current) {
        return;
      }
      setSearchTask(task);
      const taskResult = (task.result || {}) as XingtuCreatorSearchTaskResult;
      setSearchResults(Array.isArray(taskResult.results) ? taskResult.results : []);
      setSearchPagination(taskResult.pagination || null);
      if (!pageOnly) {
        setLastExecutedSearch(executedSearch);
        message.success('达人搜索完成');
      }
    } catch (error) {
      if (!isPageActiveRef.current) {
        return;
      }
      if (isCanceledAutomationTaskError(error)) {
        message.info(searchCancelRequestedRef.current ? '已停止本次搜索' : '搜索任务已取消');
      } else {
        message.error(error instanceof Error ? error.message : pageOnly ? '分页加载失败' : '达人搜索失败');
      }
    } finally {
      clearActiveSearchTask(started.taskId);
      searchCancelRequestedRef.current = false;
      if (!isPageActiveRef.current) {
        return;
      }
      setIsSearching(false);
      setIsStoppingSearch(false);
      window.setTimeout(() => commandInputRef.current?.focus(), 0);
    }
  }

  async function handleSearchCreators() {
    await executeCreatorSearch({ page: 1 });
  }

  async function handleSearchButtonClick() {
    if (isSearching) {
      await handleStopCreatorSearch();
      return;
    }
    await handleSearchCreators();
  }

  const displayedAccountAvatar = displayedAccount?.name?.trim().slice(0, 1) || '账';
  const commandInputPlaceholder = platformConfig.supportsSearchModes
    ? XINGTU_SEARCH_MODE_PLACEHOLDERS[searchMode]
    : BUYIN_SEARCH_PLACEHOLDER;
  const searchTaskLogContent = useMemo(() => {
    const searchTaskLogs = searchTask?.logs.slice(-6) || [];
  const commandInputPlaceholder = platformConfig.supportsSearchModes
    ? XINGTU_SEARCH_MODE_PLACEHOLDERS[searchMode]
    : BUYIN_SEARCH_PLACEHOLDER;

    return searchTask ? (
      <div className="xingtu-task-log-popover">
        <div className="xingtu-task-log-popover-header">
          <span>最近一次达人搜索</span>
          <Tag color={getAutomationTaskStatusTagColor(searchTask)}>
            {describeAutomationTaskStatus(searchTask)}
          </Tag>
        </div>
        <div>Task ID: {searchTask.id}</div>
        <div>Profile: {searchTask.profileId}</div>
        {searchTask.error ? <div>错误: {searchTask.error}</div> : null}
        {searchTaskLogs.length ? (
          <div className="xingtu-task-log-lines">
            {searchTaskLogs.map((log) => (
              <div key={`${log.time}-${log.message}`}>
                [{log.level}] {log.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    ) : (
      <div className="xingtu-task-log-popover xingtu-task-log-popover-empty">
        暂无达人搜索任务日志
      </div>
    );
  }, [searchTask]);

  const accountPickerContent = useMemo(() => (
    <div className="xingtu-account-popover">
      {accounts.length ? (
        <div className="xingtu-account-list" role="list">
          {accounts.map((account) => {
            const selected = account.profileId === displayedAccount?.profileId;
            return (
              <div className="xingtu-account-list-item" key={account.id} role="listitem">
                <div
                  className={`xingtu-account-item${selected ? ' selected' : ''}`}
                  onClick={() => {
                    void handleSelectAccount(account);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void handleSelectAccount(account);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="xingtu-account-name">
                    {selected ? <CheckOutlined /> : null}
                    <span>{account.name}</span>
                  </span>
                  <Tooltip title="进入后台">
                    <Button
                      className="xingtu-account-backstage"
                      disabled={!isElectronEgg}
                      icon={<ArrowRightOutlined />}
                      loading={openingProfileIds.includes(account.profileId)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleOpenProfile(account);
                      }}
                      shape="circle"
                      type="text"
                    />
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty className="xingtu-account-list-empty" description="暂无账号" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
      <div className="xingtu-account-popover-footer">
        <Button
          block
          disabled={!isElectronEgg || isLoginRunning}
          icon={<PlusOutlined />}
          loading={isStartingLogin || isLoginRunning}
          onClick={handleAddAccount}
        >
          新增账号
        </Button>
      </div>
    </div>
  ), [
    accounts,
    displayedAccount?.profileId,
    handleAddAccount,
    handleOpenProfile,
    handleSelectAccount,
    isLoginRunning,
    isStartingLogin,
    openingProfileIds,
  ]);

  const activeCreatorTypes = activeCreatorType ? [activeCreatorType] : [];

  const headerActions = useMemo(() => (
    <div className="xingtu-creator-header-actions">
      <Popover
        arrow={false}
        content={searchTaskLogContent}
        placement="bottomRight"
        trigger={['hover', 'click']}
      >
        <Button
          aria-label="查看达人搜索日志"
          className={getAutomationTaskLogTriggerClassName(searchTask)}
          icon={<InfoCircleOutlined />}
          shape="circle"
          type="text"
        />
      </Popover>

      <Popover
        arrow={false}
        content={accountPickerContent}
        onOpenChange={setAccountPickerOpen}
        open={accountPickerOpen}
        placement="bottomLeft"
        trigger="click"
      >
        <Button className="xingtu-account-trigger" type="text">
          {displayedAccount?.avatarUrl ? (
            <img
              alt=""
              className="xingtu-account-trigger-avatar-image"
              referrerPolicy="no-referrer"
              src={displayedAccount.avatarUrl}
            />
          ) : (
            <span className="xingtu-account-trigger-avatar" aria-hidden="true">{displayedAccountAvatar}</span>
          )}
          <span className="xingtu-account-trigger-name">{displayedAccount?.name || '未选择账号'}</span>
          <CaretDownOutlined />
        </Button>
      </Popover>
    </div>
  ), [
    accountPickerContent,
    accountPickerOpen,
    displayedAccount?.avatarUrl,
    displayedAccount?.name,
    displayedAccountAvatar,
    searchTask,
    searchTaskLogContent,
  ]);

  useEffect(() => {
    setHeaderExtra(headerActions);

    return () => {
      setHeaderExtra(null);
    };
  }, [headerActions, setHeaderExtra]);

  return (
    <div className="xingtu-creator-page">
      {!isElectronEgg ? (
        <Alert message={`当前是 Web 预览模式，${platformConfig.platformName}登录 Profile 只能在 Electron 应用内创建。`} showIcon type="warning" />
      ) : null}

      {loginTask ? (
        <Alert
          message={`${platformConfig.platformName}登录进行中`}
          description={loginTask.status === 'running' ? '请在弹出的浏览器窗口完成登录。登录成功后会自动读取昵称并关闭窗口。' : `正在准备${platformConfig.platformName}登录窗口。`}
          showIcon
          type="info"
        />
      ) : null}

      <section className="xingtu-spotlight-panel">
        <div className={`xingtu-spotlight-bar${platformConfig.supportsSearchModes ? '' : ' xingtu-spotlight-bar-single'}`}>
          {platformConfig.supportsSearchModes ? (
            <Radio.Group
              buttonStyle="solid"
              className="xingtu-search-mode-group"
              onChange={(event) => setSearchMode(event.target.value as XingtuCreatorSearchMode)}
              optionType="button"
              size="small"
              value={searchMode}
            >
              <Radio.Button value="content">{SEARCH_MODE_LABELS.content}</Radio.Button>
              <Radio.Button value="nickname">{SEARCH_MODE_LABELS.nickname}</Radio.Button>
            </Radio.Group>
          ) : null}
          <Input
            className="xingtu-command-input"
            onChange={(event) => setCommandText(event.target.value)}
            onPressEnter={handleSearchCreators}
            placeholder={commandInputPlaceholder}
            ref={commandInputRef}
            size="large"
            value={commandText}
            variant="borderless"
          />

          <Button
            className="xingtu-search-button"
            aria-label={isSearching ? '停止达人搜索' : '开始达人搜索'}
            danger={isSearching}
            disabled={isSwitchingProfile || isStoppingSearch}
            icon={isSearching ? <XFilled /> : <SearchOutlined />}
            onClick={handleSearchButtonClick}
            shape="circle"
            type="primary"
          />
        </div>
      </section>

      {platformConfig.supportsFilters ? (
        <section className="xingtu-filter-panel xingtu-filter-panel-merged">
          <div className="xingtu-filter-panel-body xingtu-filter-panel-body-structured">
            {platformConfig.key === 'buyin' ? (
              <BuyinCreatorFilters
                onChange={setBuyinFilters}
                value={buyinFilters}
              />
            ) : (
              <XingtuCreatorFilters
              actions={{
                onAudienceModeReset: handleAudienceModeReset,
                onAudienceOptionSelect: handleAudienceOptionSelect,
                onCollaborationObjectChange: setCollaborationObject,
                onCostPerformancePriceQuoteChange: setCostPerformancePriceQuote,
                onCostPerformanceRangeChange: handleCostPerformanceRangeChange,
                onCostPerformanceSelectionChange: handleCostPerformanceSelectionChange,
                onCostPerformanceTaskCountChange: setCostPerformanceTaskCount,
                onTopicRecommendationSelectionChange: handleTopicRecommendationSelectionChange,
                onCreatorTypeSelect: toggleCreatorType,
                onExtraCreatorTypeSelect: selectExtraCreatorType,
                onGoalSelect: toggleGoal,
                onGrassSelectionSelect: handleGrassSelectionSelect,
                onIndustryChange: setIndustry,
                onMatchConnectedUsersChange: setMatchConnectedUsers,
                onMatchContentTopicSelectionChange: handleMatchContentTopicSelectionChange,
                onMatchCreatorTypeSelectionChange: handleMatchCreatorTypeSelectionChange,
                onMatchEducationChange: setMatchEducation,
                onMatchFanProfileChange: setMatchFanProfile,
                onMatchFollowersChange: setMatchFollowers,
                onMatchGenderChange: setMatchGender,
                onMatchPersonaCareerChange: setMatchPersonaCareer,
                onMatchPersonaCharacterChange: setMatchPersonaCharacter,
                onMatchPersonaHobbyChange: setMatchPersonaHobby,
                onMatchPersonaIndustrySelectionChange: handleMatchPersonaIndustrySelectionChange,
                onMatchPersonaToneChange: setMatchPersonaTone,
                onMatchRegionChange: setMatchRegion,
                onMatchViewerProfileChange: setMatchViewerProfile,
                onMatchYellowVChange: setMatchYellowV,
                onResetMatchContentTopic: resetMatchContentTopicFilters,
                onResetMatchCreatorType: resetMatchCreatorTypeFilters,
                onShortDramaSelectionsChange: handleShortDramaSelectionsChange,
                onShortLiveSelectionsChange: handleShortLiveSelectionsChange,
                onToggleTopicRecommendationTag: toggleTopicRecommendationTag,
                onToggleMatchCreatorTypeTag: toggleMatchCreatorTypeTag,
              }}
              values={{
                audienceMode,
                audienceTreeKeys,
                collaborationObject,
                costPerformancePriceQuote,
                costPerformanceRanges,
                costPerformanceSelections,
                costPerformanceTaskCount,
                creatorTypes: activeCreatorTypes,
                extraCreatorTypes,
                goals,
                grassSelections,
                industry,
                matchConnectedUsers,
                matchContentTopicSelections,
                matchCreatorTypeSelections,
                matchCreatorTypeTags,
                matchEducation,
                matchFanProfile,
                matchFollowers,
                matchGender,
                matchPersonaCareer,
                matchPersonaCharacter,
                matchPersonaHobby,
                matchPersonaIndustrySelections,
                matchPersonaTone,
                matchRegion,
                matchViewerProfile,
                matchYellowV,
                shortDramaSelections,
                shortLiveSelections,
                topicRecommendationSelections,
                topicRecommendationTags,
              }}
              />
            )}
          </div>
        </section>
      ) : null}

      {lastSearchKeyword ? (
        <section className="xingtu-search-results">
          <div className="xingtu-search-results-header">
            <Typography.Title level={5}>搜索结果</Typography.Title>
            <Typography.Text type="secondary">
              {platformConfig.supportsSearchModes && lastExecutedSearch ? `${SEARCH_MODE_LABELS[lastExecutedSearch.searchMode]}：${lastSearchKeyword}` : lastSearchKeyword}
            </Typography.Text>
          </div>
          <CreatorResultsTable loading={isSearching} platform={platformConfig.key} results={searchResults} />
          {searchPagination ? (
            <div className="xingtu-search-results-footer">
              <div className="xingtu-search-results-footer-meta">
                <Typography.Text type="secondary">
                  第 {searchPagination.currentPage} / {searchPagination.totalPages} 页
                </Typography.Text>
                <Typography.Text type="secondary">
                  每页 {searchPagination.pageSize} 条
                </Typography.Text>
              </div>
              <Pagination
                className="xingtu-search-results-pagination"
                current={searchPagination.currentPage}
                disabled={isSearching}
                locale={XINGTU_PAGINATION_LOCALE}
                onChange={(page) => {
                  if (!lastExecutedSearch || page === searchPagination.currentPage) {
                    return;
                  }
                  void executeCreatorSearch({ page, search: lastExecutedSearch, pageOnly: true });
                }}
                pageSize={searchPagination.pageSize}
                showQuickJumper={searchPagination.showQuickJumper}
                showSizeChanger={false}
                total={Math.max(searchPagination.estimatedTotal, searchPagination.totalPages * searchPagination.pageSize)}
                itemRender={(page, type, originalElement) => {
                  if (type === 'prev') {
                    return (
                      <Button
                        className="xingtu-search-results-page-button"
                        disabled={isSearching || searchPagination.currentPage <= 1}
                        size="small"
                        type="text"
                      >
                        上一页
                      </Button>
                    );
                  }
                  if (type === 'next') {
                    return (
                      <Button
                        className="xingtu-search-results-page-button"
                        disabled={isSearching || searchPagination.currentPage >= searchPagination.totalPages}
                        size="small"
                        type="text"
                      >
                        下一页
                      </Button>
                    );
                  }
                  return originalElement;
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
