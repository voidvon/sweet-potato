import type { OptionPopoverFilterValue } from '../../../components/OptionPopoverFilter';
import type { RangePopoverFilterValue } from '../../../components/RangePopoverFilter';
import type {
  AudienceModeOption,
  CollaborationObjectOption,
  CreatorTypeOption,
  GoalOption,
} from '../xingtuCreatorFilterData';

export type MatchPopoverSelectionMap = Record<string, OptionPopoverFilterValue>;
export type RangeSelectionMap = Record<string, RangePopoverFilterValue>;

export type PriceQuoteFilterValue = {
  quoteType: OptionPopoverFilterValue;
  quoteRange: OptionPopoverFilterValue;
  customRange: RangePopoverFilterValue;
};

export type TaskCountFilterValue = {
  taskTime: OptionPopoverFilterValue;
  taskCount: {
    min: string;
    max: string;
  };
};

export type XingtuCreatorFilterValues = {
  collaborationObject: CollaborationObjectOption;
  creatorTypes: string[];
  shortDramaSelections: string[];
  shortLiveSelections: string[];
  extraCreatorTypes: string[];
  industry: string;
  goals: string[];
  grassSelections: string[];
  audienceMode: AudienceModeOption;
  audienceTreeKeys: string[];
  matchCreatorTypeTags: string[];
  matchCreatorTypeSelections: MatchPopoverSelectionMap;
  matchContentTopicSelections: MatchPopoverSelectionMap;
  matchPersonaIndustrySelections: MatchPopoverSelectionMap;
  matchPersonaCareer: OptionPopoverFilterValue;
  matchPersonaHobby: OptionPopoverFilterValue;
  matchPersonaTone: OptionPopoverFilterValue;
  matchPersonaCharacter: OptionPopoverFilterValue;
  matchGender: OptionPopoverFilterValue;
  matchRegion: OptionPopoverFilterValue;
  matchEducation: OptionPopoverFilterValue;
  matchYellowV: OptionPopoverFilterValue;
  matchConnectedUsers: RangePopoverFilterValue;
  matchFollowers: OptionPopoverFilterValue;
  matchViewerProfile: OptionPopoverFilterValue;
  matchFanProfile: OptionPopoverFilterValue;
  costPerformanceSelections: MatchPopoverSelectionMap;
  costPerformanceRanges: RangeSelectionMap;
  costPerformancePriceQuote: PriceQuoteFilterValue;
  costPerformanceTaskCount: TaskCountFilterValue;
  topicRecommendationSelections: MatchPopoverSelectionMap;
  topicRecommendationTags: string[];
};

export type XingtuCreatorFilterActions = {
  onCollaborationObjectChange: (value: CollaborationObjectOption) => void;
  onCreatorTypeSelect: (value: CreatorTypeOption) => void;
  onShortDramaSelectionsChange: (values: string[]) => void;
  onShortLiveSelectionsChange: (values: string[]) => void;
  onExtraCreatorTypeSelect: (value: string) => void;
  onIndustryChange: (value: string) => void;
  onGoalSelect: (value: GoalOption) => void;
  onGrassSelectionSelect: (value: string) => void;
  onAudienceModeReset: () => void;
  onAudienceOptionSelect: (value: string) => void;
  onResetMatchCreatorType: () => void;
  onToggleMatchCreatorTypeTag: (label: string) => void;
  onMatchCreatorTypeSelectionChange: (label: string, value: OptionPopoverFilterValue) => void;
  onMatchPersonaIndustrySelectionChange: (label: string, value: OptionPopoverFilterValue) => void;
  onMatchPersonaCareerChange: (value: OptionPopoverFilterValue) => void;
  onMatchPersonaHobbyChange: (value: OptionPopoverFilterValue) => void;
  onMatchPersonaToneChange: (value: OptionPopoverFilterValue) => void;
  onMatchPersonaCharacterChange: (value: OptionPopoverFilterValue) => void;
  onResetMatchContentTopic: () => void;
  onMatchContentTopicSelectionChange: (label: string, value: OptionPopoverFilterValue) => void;
  onMatchGenderChange: (value: OptionPopoverFilterValue) => void;
  onMatchRegionChange: (value: OptionPopoverFilterValue) => void;
  onMatchEducationChange: (value: OptionPopoverFilterValue) => void;
  onMatchYellowVChange: (value: OptionPopoverFilterValue) => void;
  onMatchConnectedUsersChange: (value: RangePopoverFilterValue) => void;
  onMatchFollowersChange: (value: OptionPopoverFilterValue) => void;
  onMatchViewerProfileChange: (value: OptionPopoverFilterValue) => void;
  onMatchFanProfileChange: (value: OptionPopoverFilterValue) => void;
  onCostPerformanceSelectionChange: (label: string, value: OptionPopoverFilterValue) => void;
  onCostPerformanceRangeChange: (label: string, value: RangePopoverFilterValue) => void;
  onCostPerformancePriceQuoteChange: (value: PriceQuoteFilterValue) => void;
  onCostPerformanceTaskCountChange: (value: TaskCountFilterValue) => void;
  onTopicRecommendationSelectionChange: (label: string, value: OptionPopoverFilterValue) => void;
  onToggleTopicRecommendationTag: (label: string) => void;
};

export type XingtuCreatorFiltersProps = {
  values: XingtuCreatorFilterValues;
  actions: XingtuCreatorFilterActions;
};
