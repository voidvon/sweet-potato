import type { BuyinFilterValue } from '../buyinCreatorFilterData';
import type {
  MatchPopoverSelectionMap,
  PriceQuoteFilterValue,
  RangeSelectionMap,
  TaskCountFilterValue,
} from './filterTypes';

export type XingtuAccount = {
  id: string;
  name: string;
  profileId: string;
  avatarUrl?: string;
  status: 'logged_in';
  createdAt: string;
};

export type XingtuLoginResult = {
  loggedIn?: boolean;
  nickname?: string;
  url?: string;
};

export type XingtuCreatorSearchPagination = {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  estimatedTotal: number;
  hasPrev?: boolean;
  hasNext?: boolean;
  visiblePages?: number[];
  showQuickJumper?: boolean;
};

export type XingtuCreatorSearchTaskResult = {
  keyword?: string;
  url?: string;
  results?: import('../CreatorResultsTable').CreatorSearchResult[];
  pagination?: XingtuCreatorSearchPagination;
};

export type XingtuCreatorSearchMode = 'content' | 'nickname';

export type XingtuCreatorSearchFilters = {
  collaborationObject: import('../xingtuCreatorFilterData').CollaborationObjectOption;
  creatorTypes: string[];
  shortDramaSelections: string[];
  shortLiveSelections: string[];
  extraCreatorTypes: string[];
  industry: string;
  goals: string[];
  grassSelections: string[];
  audienceMode: import('../xingtuCreatorFilterData').AudienceModeOption;
  audienceLabels: string[];
  matchSelections: string[];
  matchFilters: {
    creatorTypeTags: string[];
    creatorTypeSelections: MatchPopoverSelectionMap;
    contentTopicSelections: MatchPopoverSelectionMap;
    personaIndustrySelections: MatchPopoverSelectionMap;
    personaCareer: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    personaHobby: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    personaTone: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    personaCharacter: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    gender: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    region: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    education: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    yellowV: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    connectedUsers: import('../../../components/RangePopoverFilter').RangePopoverFilterValue;
    followers: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    viewerProfile: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
    fanProfile: import('../../../components/OptionPopoverFilter').OptionPopoverFilterValue;
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

export type ExecutedCreatorSearch = {
  keyword: string;
  profileId: string;
  searchMode: XingtuCreatorSearchMode;
  filters: XingtuCreatorSearchFilters;
};

export const SEARCH_MODE_LABELS: Record<XingtuCreatorSearchMode, string> = {
  content: '内容找人',
  nickname: '昵称找人',
};

export const XINGTU_SEARCH_MODE_PLACEHOLDERS: Record<XingtuCreatorSearchMode, string> = {
  content: '按内容关键词找达人',
  nickname: '输入达人昵称、抖音号或星图ID',
};

export const BUYIN_SEARCH_PLACEHOLDER = '输入达人昵称、抖音号或达人ID';

export const XINGTU_PAGINATION_LOCALE = {
  jump_to: '跳至',
  page: '页',
  prev_page: '上一页',
  next_page: '下一页',
};
