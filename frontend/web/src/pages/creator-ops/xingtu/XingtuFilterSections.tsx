import { CollapsibleFilterRow } from '../../../components/CollapsibleFilterRow';
import {
  hasOptionPopoverFilterSelections,
  OptionPopoverFilter,
  type OptionPopoverFilterValue,
} from '../../../components/OptionPopoverFilter';
import { RangePopoverFilter, type RangePopoverFilterValue } from '../../../components/RangePopoverFilter';
import { TreePopoverFilter } from '../../../components/TreePopoverFilter';
import {
  COST_PERFORMANCE_FILTERS,
  MATCH_CONNECTED_USER_FIELDS,
  MATCH_CONTENT_TOPIC_FILTERS,
  MATCH_CREATOR_TYPE_FILTERS,
  TOPIC_RECOMMENDATION_FILTER_GROUPS,
  type MatchInlineFilterItem,
  type MatchPopoverFilterItem,
  type MatchPresetRangeFilterItem,
  type MatchRangeFilterItem,
} from '../xingtuCreatorFilterData';
import { XingtuCooperationSection } from './XingtuCooperationSection';
import type {
  MatchPopoverSelectionMap,
  RangeSelectionMap,
  XingtuCreatorFiltersProps,
} from './filterTypes';
import {
  MATCH_BACKGROUND_POPOVER_FILTERS,
  MATCH_FAN_PROFILE_GROUPS,
  MATCH_FOLLOWER_COUNT_POPOVER_FILTER,
  MATCH_PERSONA_CAREER_POPOVER_FILTER,
  MATCH_PERSONA_CHARACTER_POPOVER_FILTER,
  MATCH_PERSONA_HOBBY_POPOVER_FILTER,
  MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS,
  MATCH_PERSONA_TONE_POPOVER_FILTER,
  MATCH_VIEWER_PROFILE_GROUPS,
  buildTreeDataFromMultiGroups,
  countTreeGroupSelections,
  hasSelectionsInFilterMap,
  isMultiGroupPopover,
  normalizeGroupSelectionsToTreeValues,
  normalizeTreeValuesToGroupSelections,
} from './filterUtils';
import { PresetRangeFilter } from './XingtuRangeFilterControls';
import { PriceQuoteFilter, TaskCountFilter } from './XingtuQuoteAndTaskFilters';

function renderMatchPopoverItem(
  item: MatchPopoverFilterItem,
  value: OptionPopoverFilterValue,
  onChange: (nextValue: OptionPopoverFilterValue) => void,
) {
  if (isMultiGroupPopover(item)) {
    const treeValues = normalizeGroupSelectionsToTreeValues(item.groups, value);
    const treeData = buildTreeDataFromMultiGroups(item.groups);
    const allSelectedValues = item.groups.flatMap((group) => (
      group.label
        ? [group.key]
        : group.options
    ));

    return (
      <TreePopoverFilter
        allSelectedValues={allSelectedValues}
        getDisplayCount={(nextValues) => countTreeGroupSelections(item.groups, nextValues)}
        label={item.label}
        maxHeight={380}
        minWidth={120}
        normalizeValues={(nextValues) => nextValues}
        onChange={(nextValues) => {
          onChange(normalizeTreeValuesToGroupSelections(item.groups, nextValues));
        }}
        selected={hasOptionPopoverFilterSelections(item.groups, value)}
        treeData={treeData}
        values={treeValues}
      />
    );
  }

  return (
    <OptionPopoverFilter
      displayMode={item.displayMode}
      groups={item.groups}
      label={item.label}
      maxHeight={380}
      minWidth={120}
      onChange={onChange}
      value={value}
    />
  );
}

function renderRangeFilterItem(
  item: MatchRangeFilterItem,
  value: RangePopoverFilterValue,
  onChange: (nextValue: RangePopoverFilterValue) => void,
) {
  const normalizedValue = value || Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));

  return (
    <RangePopoverFilter
      fields={item.fields}
      label={item.label}
      maxWidth={360}
      minWidth={320}
      onChange={onChange}
      unit={item.unit}
      value={normalizedValue}
    />
  );
}

function renderPresetRangeFilterItem(
  item: MatchPresetRangeFilterItem,
  popoverValue: OptionPopoverFilterValue,
  rangeValue: RangePopoverFilterValue,
  onPopoverChange: (nextValue: OptionPopoverFilterValue) => void,
  onRangeChange: (nextValue: RangePopoverFilterValue) => void,
) {
  return (
    <PresetRangeFilter
      item={item}
      onPopoverChange={onPopoverChange}
      onRangeChange={onRangeChange}
      popoverValue={popoverValue}
      rangeValue={rangeValue}
    />
  );
}

function renderGenericFilterItem(
  item: MatchInlineFilterItem,
  popoverValues: MatchPopoverSelectionMap,
  rangeValues: RangeSelectionMap,
  selectedTags: string[],
  handlers: {
    onPopoverChange: (label: string, value: OptionPopoverFilterValue) => void;
    onRangeChange: (label: string, value: RangePopoverFilterValue) => void;
    onTagToggle: (label: string) => void;
  },
) {
  if (item.type === 'tag') {
    return (
      <button
        className={`xingtu-filter-option${selectedTags.includes(item.label) ? ' selected' : ''}`}
        onClick={() => handlers.onTagToggle(item.label)}
        type="button"
      >
        {item.label}
      </button>
    );
  }

  if (item.type === 'range') {
    return renderRangeFilterItem(
      item,
      rangeValues[item.label],
      (nextValue) => handlers.onRangeChange(item.label, nextValue),
    );
  }

  if (item.type === 'presetRange') {
    return renderPresetRangeFilterItem(
      item,
      popoverValues[item.label],
      rangeValues[item.label],
      (nextValue) => handlers.onPopoverChange(item.label, nextValue),
      (nextValue) => handlers.onRangeChange(item.label, nextValue),
    );
  }

  if (item.type === 'popover') {
    return renderMatchPopoverItem(
      item,
      popoverValues[item.label],
      (nextValue) => handlers.onPopoverChange(item.label, nextValue),
    );
  }

  return null;
}

export function XingtuCreatorFilters({ values, actions }: XingtuCreatorFiltersProps) {
  const isMatchCreatorTypeDefault = !values.matchCreatorTypeTags.length && !hasSelectionsInFilterMap(values.matchCreatorTypeSelections);
  const isMatchContentTopicDefault = !hasSelectionsInFilterMap(values.matchContentTopicSelections);

  return (
    <>
      <XingtuCooperationSection actions={actions} values={values} />

      <div className="xingtu-filter-panel-divider" />

      <div className="xingtu-filter-section-row">
        <div className="xingtu-filter-section-side">匹配度</div>
        <div className="xingtu-filter-section-body">
          <CollapsibleFilterRow contentClassName="xingtu-filter-line-content-match" label="达人类型">
            {MATCH_CREATOR_TYPE_FILTERS.map((item) => (
              <span className="xingtu-match-option-shell" key={item.label}>
                {item.type === 'tag'
                  ? (
                    <button
                      className={`xingtu-filter-option${(item.label === '不限' ? isMatchCreatorTypeDefault : values.matchCreatorTypeTags.includes(item.label)) ? ' selected' : ''}`}
                      onClick={() => {
                        if (item.label === '不限') {
                          actions.onResetMatchCreatorType();
                          return;
                        }
                        actions.onToggleMatchCreatorTypeTag(item.label);
                      }}
                      type="button"
                    >
                      {item.label}
                    </button>
                  )
                  : item.type === 'popover'
                    ? renderMatchPopoverItem(
                      item,
                      values.matchCreatorTypeSelections[item.label],
                      (nextValue) => {
                        actions.onMatchCreatorTypeSelectionChange(item.label, nextValue);
                      },
                    )
                    : null}
              </span>
            ))}
          </CollapsibleFilterRow>

          <CollapsibleFilterRow
            className="xingtu-filter-line-match-grouped"
            collapsedHeight={26}
            contentClassName="xingtu-filter-line-content-match xingtu-filter-line-content-match-grouped"
            label="达人人设"
            singleLineCollapsed
          >
            <div className="xingtu-filter-subgroup-label">行业特色人设</div>
            {MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS.map((item) => (
              <span className="xingtu-match-option-shell" key={item.label}>
                {renderMatchPopoverItem(
                  item,
                  values.matchPersonaIndustrySelections[item.label],
                  (nextValue) => {
                    actions.onMatchPersonaIndustrySelectionChange(item.label, nextValue);
                  },
                )}
              </span>
            ))}
            <div className="xingtu-filter-subgroup-label">职业爱好</div>
            {renderMatchPopoverItem(MATCH_PERSONA_CAREER_POPOVER_FILTER, values.matchPersonaCareer, actions.onMatchPersonaCareerChange)}
            {renderMatchPopoverItem(MATCH_PERSONA_HOBBY_POPOVER_FILTER, values.matchPersonaHobby, actions.onMatchPersonaHobbyChange)}
            {renderMatchPopoverItem(MATCH_PERSONA_TONE_POPOVER_FILTER, values.matchPersonaTone, actions.onMatchPersonaToneChange)}
            {renderMatchPopoverItem(MATCH_PERSONA_CHARACTER_POPOVER_FILTER, values.matchPersonaCharacter, actions.onMatchPersonaCharacterChange)}
          </CollapsibleFilterRow>

          <CollapsibleFilterRow contentClassName="xingtu-filter-line-content-match" label="内容主题">
            {MATCH_CONTENT_TOPIC_FILTERS.map((item) => (
              <span className="xingtu-match-option-shell" key={item.label}>
                {item.type === 'tag'
                  ? (
                    <button
                      className={`xingtu-filter-option${isMatchContentTopicDefault ? ' selected' : ''}`}
                      onClick={actions.onResetMatchContentTopic}
                      type="button"
                    >
                      {item.label}
                    </button>
                  )
                  : item.type === 'popover'
                    ? renderMatchPopoverItem(
                      item,
                      values.matchContentTopicSelections[item.label],
                      (nextValue) => {
                        actions.onMatchContentTopicSelectionChange(item.label, nextValue);
                      },
                    )
                    : null}
              </span>
            ))}
          </CollapsibleFilterRow>

          <div className="xingtu-filter-line xingtu-filter-line-match">
            <div className="xingtu-filter-line-label">背景信息</div>
            <div className="xingtu-filter-line-content xingtu-filter-line-content-match">
              {renderMatchPopoverItem(MATCH_BACKGROUND_POPOVER_FILTERS[0], values.matchGender, actions.onMatchGenderChange)}
              {renderMatchPopoverItem(MATCH_BACKGROUND_POPOVER_FILTERS[1], values.matchRegion, actions.onMatchRegionChange)}
              {renderMatchPopoverItem(MATCH_BACKGROUND_POPOVER_FILTERS[2], values.matchEducation, actions.onMatchEducationChange)}
              {renderMatchPopoverItem(MATCH_BACKGROUND_POPOVER_FILTERS[3], values.matchYellowV, actions.onMatchYellowVChange)}
            </div>
          </div>

          <div className="xingtu-filter-line xingtu-filter-line-match">
            <div className="xingtu-filter-line-label">受众画像</div>
            <div className="xingtu-filter-line-content xingtu-filter-line-content-match">
              <RangePopoverFilter
                fields={MATCH_CONNECTED_USER_FIELDS}
                label="连接用户数"
                maxWidth={360}
                minWidth={320}
                onChange={actions.onMatchConnectedUsersChange}
                value={values.matchConnectedUsers}
              />
              {renderMatchPopoverItem(MATCH_FOLLOWER_COUNT_POPOVER_FILTER, values.matchFollowers, actions.onMatchFollowersChange)}
              <OptionPopoverFilter
                groups={MATCH_VIEWER_PROFILE_GROUPS}
                label="观众画像"
                maxHeight={420}
                maxWidth={360}
                minWidth={320}
                onChange={actions.onMatchViewerProfileChange}
                value={values.matchViewerProfile}
              />
              <OptionPopoverFilter
                groups={MATCH_FAN_PROFILE_GROUPS}
                label="粉丝画像"
                maxHeight={420}
                maxWidth={360}
                minWidth={320}
                onChange={actions.onMatchFanProfileChange}
                value={values.matchFanProfile}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="xingtu-filter-panel-divider" />

      <div className="xingtu-filter-section-row">
        <div className="xingtu-filter-section-side">性价比</div>
        <div className="xingtu-filter-section-body">
          {COST_PERFORMANCE_FILTERS.map((group) => (
            <div className="xingtu-filter-line xingtu-filter-line-match" key={group.title}>
              <div className="xingtu-filter-line-label">{group.title}</div>
              <div className="xingtu-filter-line-content xingtu-filter-line-content-match">
                {group.filters.map((item) => (
                  <span className="xingtu-match-option-shell" key={item.label}>
                    {item.type === 'priceQuote'
                      ? <PriceQuoteFilter item={item} onChange={actions.onCostPerformancePriceQuoteChange} value={values.costPerformancePriceQuote} />
                      : item.type === 'taskCount'
                        ? <TaskCountFilter item={item} onChange={actions.onCostPerformanceTaskCountChange} value={values.costPerformanceTaskCount} />
                        : renderGenericFilterItem(
                          item,
                          values.costPerformanceSelections,
                          values.costPerformanceRanges,
                          [],
                          {
                            onPopoverChange: actions.onCostPerformanceSelectionChange,
                            onRangeChange: actions.onCostPerformanceRangeChange,
                            onTagToggle: () => {},
                          },
                        )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="xingtu-filter-panel-divider" />

      <div className="xingtu-filter-section-row">
        <div className="xingtu-filter-section-side">主题推荐</div>
        <div className="xingtu-filter-section-body">
          {TOPIC_RECOMMENDATION_FILTER_GROUPS.map((group) => (
            <CollapsibleFilterRow contentClassName="xingtu-filter-line-content-match" key={group.title} label={group.title}>
              {group.filters.map((item) => (
                <span className="xingtu-match-option-shell" key={item.label}>
                  {renderGenericFilterItem(
                    item,
                    values.topicRecommendationSelections,
                    {},
                    values.topicRecommendationTags,
                    {
                      onPopoverChange: actions.onTopicRecommendationSelectionChange,
                      onRangeChange: () => {},
                      onTagToggle: actions.onToggleTopicRecommendationTag,
                    },
                  )}
                </span>
              ))}
            </CollapsibleFilterRow>
          ))}
        </div>
      </div>
    </>
  );
}
