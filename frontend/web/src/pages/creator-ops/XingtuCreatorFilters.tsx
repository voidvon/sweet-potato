import { Fragment, useState } from 'react';
import { Button, Dropdown, Input, Popover, Select } from 'antd';
import type { MenuProps } from 'antd';
import { CaretDownOutlined, CheckOutlined } from '@ant-design/icons';
import { CollapsibleFilterRow } from '../../components/CollapsibleFilterRow';
import {
  hasOptionPopoverFilterSelections,
  OptionPopoverFilter,
  type OptionPopoverFilterGroup,
  type OptionPopoverFilterValue,
} from '../../components/OptionPopoverFilter';
import { RangePopoverFilter, type RangePopoverFilterValue } from '../../components/RangePopoverFilter';
import { TreePopoverFilter } from '../../components/TreePopoverFilter';
import {
  COOPERATION_SECTION_LINES,
  COST_PERFORMANCE_FILTERS,
  createAudienceProfileGroups,
  getShortDramaDisplayCount,
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
  TOPIC_RECOMMENDATION_FILTER_GROUPS,
  normalizeShortDramaSelections,
  type AudienceModeOption,
  type CollaborationObjectOption,
  type CreatorFilterControlSchema,
  type CreatorTypeOption,
  type GoalOption,
  type MatchInlineFilterItem,
  type MatchPriceQuoteFilterItem,
  type MatchPresetRangeFilterItem,
  type MatchPopoverFilterItem,
  type MatchRangeFilterItem,
  type MatchTaskCountFilterItem,
} from './xingtuCreatorFilterData';

type MatchPopoverSelectionMap = Record<string, OptionPopoverFilterValue>;
type RangeSelectionMap = Record<string, RangePopoverFilterValue>;

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

type XingtuCreatorFilterValues = {
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

type XingtuCreatorFilterActions = {
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

type XingtuCreatorFiltersProps = {
  values: XingtuCreatorFilterValues;
  actions: XingtuCreatorFilterActions;
};

const MATCH_VIEWER_PROFILE_GROUPS = createAudienceProfileGroups('观众');
const MATCH_FAN_PROFILE_GROUPS = createAudienceProfileGroups('粉丝');
const MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS = MATCH_PERSONA_INDUSTRY_FILTERS as Array<Extract<MatchInlineFilterItem, { type: 'popover' }>>;
const MATCH_BACKGROUND_POPOVER_FILTERS = MATCH_BACKGROUND_FILTERS as Array<Extract<MatchInlineFilterItem, { type: 'popover' }>>;
const MATCH_PERSONA_CAREER_POPOVER_FILTER = MATCH_PERSONA_CAREER_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_PERSONA_HOBBY_POPOVER_FILTER = MATCH_PERSONA_HOBBY_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_PERSONA_TONE_POPOVER_FILTER = MATCH_PERSONA_TONE_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_PERSONA_CHARACTER_POPOVER_FILTER = MATCH_PERSONA_CHARACTER_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
const MATCH_FOLLOWER_COUNT_POPOVER_FILTER = MATCH_FOLLOWER_COUNT_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;

function renderFilterOption(label: string, selected: boolean, onClick: () => void) {
  return (
    <button
      className={`xingtu-filter-option${selected ? ' selected' : ''}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function renderDropdownTrigger(label: string, selected: boolean, count = 0) {
  return (
    <button
      className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`}
      type="button"
    >
      <span>{label}</span>
      {count > 0 ? <span className="xingtu-filter-option-count">{count}</span> : null}
      <CaretDownOutlined />
    </button>
  );
}

function buildMenu(options: string[], selectedKeys: string[], onSelect: (value: string) => void): MenuProps {
  return {
    className: 'xingtu-filter-dropdown-menu',
    items: options.map((option) => ({
      key: option,
      label: option,
    })),
    onClick: ({ key }) => {
      onSelect(String(key));
    },
    selectable: true,
    selectedKeys,
  };
}

function isMultiGroupPopover(item: MatchPopoverFilterItem) {
  return item.groups.every((group) => group.mode === 'multi');
}

function buildGroupChildValue(groupKey: string, option: string) {
  return `${groupKey}/${option}`;
}

function buildTreeDataFromMultiGroups(groups: OptionPopoverFilterGroup[]) {
  if (groups.length === 1 && !groups[0].label) {
    return groups[0].options.map((option) => ({
      title: option,
      value: option,
      key: option,
    }));
  }

  return groups.map((group) => (
    group.label
      ? {
        title: group.label,
        value: group.key,
        key: group.key,
        children: group.options.map((option) => ({
          title: option,
          value: buildGroupChildValue(group.key, option),
          key: buildGroupChildValue(group.key, option),
        })),
      }
      : {
        title: group.options[0],
        value: group.options[0],
        key: group.options[0],
      }
  ));
}

function normalizeTreeValuesToGroupSelections(groups: OptionPopoverFilterGroup[], values: string[]) {
  const valueSet = new Set(values);
  const nextValue = Object.fromEntries(groups.map((group) => [group.key, []])) as OptionPopoverFilterValue;

  for (const group of groups) {
    if (!group.label) {
      nextValue[group.key] = group.options.filter((option) => valueSet.has(option));
      continue;
    }

    if (valueSet.has(group.key)) {
      nextValue[group.key] = [...group.options];
      continue;
    }

    nextValue[group.key] = group.options.filter((option) => valueSet.has(buildGroupChildValue(group.key, option)));
  }

  return nextValue;
}

function normalizeGroupSelectionsToTreeValues(groups: OptionPopoverFilterGroup[], value: OptionPopoverFilterValue) {
  const nextValues: string[] = [];

  for (const group of groups) {
    const selectedOptions = value[group.key] || [];
    if (!selectedOptions.length) {
      continue;
    }

    if (!group.label) {
      nextValues.push(...selectedOptions);
      continue;
    }

    if (selectedOptions.length === group.options.length) {
      nextValues.push(group.key);
      continue;
    }

    nextValues.push(...selectedOptions.map((option) => buildGroupChildValue(group.key, option)));
  }

  return nextValues;
}

function countTreeGroupSelections(groups: OptionPopoverFilterGroup[], values: string[]) {
  const normalized = normalizeTreeValuesToGroupSelections(groups, values);
  return groups.reduce((count, group) => count + (normalized[group.key]?.length || 0), 0);
}

function hasSelectionsInFilterMap(value: MatchPopoverSelectionMap) {
  return Object.values(value).some((entry) => Object.values(entry).some((options) => options.length > 0));
}

function hasRangeSelections(value: RangePopoverFilterValue | undefined) {
  return Object.values(value || {}).some((field) => field.min || field.max);
}

function normalizeNumericInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const [integer = '', ...decimalParts] = cleaned.split('.');
  if (!decimalParts.length) {
    return integer;
  }
  return `${integer}.${decimalParts.join('')}`;
}

function normalizeBoundedNumericInput(value: string, min?: number, max?: number) {
  const normalized = normalizeNumericInput(value);
  if (!normalized) {
    return '';
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) {
    return '';
  }
  if (typeof max === 'number' && numericValue > max) {
    return String(max);
  }
  if (typeof min === 'number' && numericValue < min) {
    return String(min);
  }
  return normalized;
}

type PresetRangeFilterProps = {
  item: MatchPresetRangeFilterItem;
  popoverValue: OptionPopoverFilterValue;
  rangeValue: RangePopoverFilterValue;
  onPopoverChange: (nextValue: OptionPopoverFilterValue) => void;
  onRangeChange: (nextValue: RangePopoverFilterValue) => void;
};

function PresetRangeFilter({
  item,
  popoverValue,
  rangeValue,
  onPopoverChange,
  onRangeChange,
}: PresetRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const normalizedPopoverValue = popoverValue || Object.fromEntries(item.groups.map((group) => [group.key, []]));
  const normalizedRangeValue = rangeValue || Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
  const [draftRangeValue, setDraftRangeValue] = useState<RangePopoverFilterValue>(normalizedRangeValue);
  const presetSelectedCount = item.groups.reduce((count, group) => count + (normalizedPopoverValue[group.key]?.length || 0), 0);
  const selectedPreset = item.groups.flatMap((group) => normalizedPopoverValue[group.key] || [])[0] || '';
  const rangeSelected = hasRangeSelections(normalizedRangeValue);
  const selected = presetSelectedCount > 0 || rangeSelected;
  const displayLabel = selectedPreset || (rangeSelected ? '自定义' : item.label);

  const clearRanges = () => Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
  const clearPresets = () => Object.fromEntries(item.groups.map((group) => [group.key, []]));
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRangeValue(normalizedRangeValue);
    }
    setOpen(nextOpen);
  };

  const content = (
    <div className="option-popover-filter xingtu-preset-range-filter">
      <div className="option-popover-filter__body">
        {item.groups.map((group) => {
          const selectedOptions = normalizedPopoverValue[group.key] || [];
          return (
            <div className="option-popover-filter__group" key={group.key}>
              <div className="option-popover-filter__options">
                {group.options.map((option) => {
                  const isChecked = selectedOptions.includes(option);
                  return (
                    <button
                      className={`option-popover-filter__option${isChecked ? ' is-selected' : ''}`}
                      key={option}
                      onClick={() => {
                        onRangeChange(clearRanges());
                        onPopoverChange({
                          ...normalizedPopoverValue,
                          [group.key]: isChecked ? [] : [option],
                        });
                        setOpen(false);
                      }}
                      type="button"
                    >
                      <span className="option-popover-filter__option-text">{option}</span>
                      {isChecked ? <CheckOutlined /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="range-popover-filter__body">
          {item.fields.map((field) => {
            const fieldValue = draftRangeValue[field] || { min: '', max: '' };
            return (
              <div className="range-popover-filter__row xingtu-preset-range-filter__row" key={field}>
                <div className="range-popover-filter__inputs xingtu-preset-range-filter__inputs">
                  <Input
                    inputMode="decimal"
                    onChange={(event) => {
                      const nextValue = normalizeBoundedNumericInput(event.target.value, item.min, item.max);
                      setDraftRangeValue({
                        ...draftRangeValue,
                        [field]: {
                          ...fieldValue,
                          min: nextValue,
                        },
                      });
                    }}
                    placeholder={typeof item.min === 'number' ? String(item.min) : undefined}
                    style={{ width: 100 }}
                    suffix={item.unit}
                    value={fieldValue.min}
                  />
                  <span className="range-popover-filter__separator">-</span>
                  <Input
                    inputMode="decimal"
                    onChange={(event) => {
                      const nextValue = normalizeBoundedNumericInput(event.target.value, item.min, item.max);
                      setDraftRangeValue({
                        ...draftRangeValue,
                        [field]: {
                          ...fieldValue,
                          max: nextValue,
                        },
                      });
                    }}
                    placeholder={typeof item.max === 'number' ? String(item.max) : undefined}
                    style={{ width: 100 }}
                    suffix={item.unit}
                    value={fieldValue.max}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              onPopoverChange(clearPresets());
              onRangeChange(clearRanges());
              setDraftRangeValue(clearRanges());
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              onPopoverChange(clearPresets());
              onRangeChange(draftRangeValue);
              setOpen(false);
            }}
            size="small"
            type="primary"
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={handleOpenChange}
      open={open}
      overlayClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-preset-range-filter-overlay"
      placement="bottomLeft"
      trigger="click"
    >
      <button className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`} type="button">
        <span>{displayLabel}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}

type PriceQuoteFilterProps = {
  item: MatchPriceQuoteFilterItem;
  value: PriceQuoteFilterValue;
  onChange: (nextValue: PriceQuoteFilterValue) => void;
};

type PriceQuoteRangeSelectProps = {
  item: MatchPriceQuoteFilterItem;
  quoteRangeValue: OptionPopoverFilterValue;
  customRangeValue: RangePopoverFilterValue;
  onQuoteRangeChange: (nextValue: OptionPopoverFilterValue) => void;
  onCustomRangeChange: (nextValue: RangePopoverFilterValue) => void;
};

function PriceQuoteRangeSelect({
  item,
  quoteRangeValue,
  customRangeValue,
  onQuoteRangeChange,
  onCustomRangeChange,
}: PriceQuoteRangeSelectProps) {
  const [open, setOpen] = useState(false);
  const group = item.quoteRangeGroup;
  const normalizedQuoteRangeValue = quoteRangeValue || { [group.key]: [] };
  const normalizedCustomRangeValue = customRangeValue || Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
  const [draftRangeValue, setDraftRangeValue] = useState<RangePopoverFilterValue>(normalizedCustomRangeValue);
  const selectedOptions = normalizedQuoteRangeValue[group.key] || [];
  const selectedPreset = selectedOptions[0] || '';
  const customRangeSelected = hasRangeSelections(normalizedCustomRangeValue);

  const clearRanges = () => Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
  const clearPresets = () => ({ [group.key]: [] });
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRangeValue(normalizedCustomRangeValue);
    }
    setOpen(nextOpen);
  };

  const content = (
    <div className="option-popover-filter xingtu-preset-range-filter">
      <div className="option-popover-filter__body">
        <div className="option-popover-filter__group">
          <div className="option-popover-filter__options">
            {group.options.map((option) => {
              const isChecked = selectedOptions.includes(option);
              return (
                <button
                  className={`option-popover-filter__option${isChecked ? ' is-selected' : ''}`}
                  key={option}
                  onClick={() => {
                    onCustomRangeChange(clearRanges());
                    onQuoteRangeChange(option === '全部' || isChecked ? clearPresets() : { [group.key]: [option] });
                    setOpen(false);
                  }}
                  type="button"
                >
                  <span className="option-popover-filter__option-text">{option}</span>
                  {isChecked ? <CheckOutlined /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="range-popover-filter__body">
          {item.fields.map((field) => {
            const fieldValue = draftRangeValue[field] || { min: '', max: '' };
            return (
              <div className="range-popover-filter__row xingtu-preset-range-filter__row" key={field}>
                <div className="range-popover-filter__inputs xingtu-preset-range-filter__inputs">
                  <Input
                    inputMode="decimal"
                    onChange={(event) => {
                      const nextValue = normalizeBoundedNumericInput(event.target.value, item.min, item.max);
                      setDraftRangeValue({
                        ...draftRangeValue,
                        [field]: {
                          ...fieldValue,
                          min: nextValue,
                        },
                      });
                    }}
                    placeholder={typeof item.min === 'number' ? String(item.min) : undefined}
                    style={{ width: 100 }}
                    suffix={item.unit}
                    value={fieldValue.min}
                  />
                  <span className="range-popover-filter__separator">-</span>
                  <Input
                    inputMode="decimal"
                    onChange={(event) => {
                      const nextValue = normalizeBoundedNumericInput(event.target.value, item.min, item.max);
                      setDraftRangeValue({
                        ...draftRangeValue,
                        [field]: {
                          ...fieldValue,
                          max: nextValue,
                        },
                      });
                    }}
                    placeholder={typeof item.max === 'number' ? String(item.max) : undefined}
                    style={{ width: 100 }}
                    suffix={item.unit}
                    value={fieldValue.max}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              const emptyRange = clearRanges();
              onQuoteRangeChange(clearPresets());
              onCustomRangeChange(emptyRange);
              setDraftRangeValue(emptyRange);
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              onQuoteRangeChange(clearPresets());
              onCustomRangeChange(draftRangeValue);
              setOpen(false);
            }}
            size="small"
            type="primary"
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Select
      className="xingtu-price-quote-filter__select-control"
      open={open}
      onOpenChange={handleOpenChange}
      options={[
        ...group.options.map((option) => ({ label: option, value: option })),
        ...(customRangeSelected ? [{ label: '自定义', value: '__custom__' }] : []),
      ]}
      placeholder="全部"
      popupClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-preset-range-filter-overlay"
      popupMatchSelectWidth={false}
      popupRender={() => content}
      size="small"
      value={selectedPreset || (customRangeSelected ? '__custom__' : undefined)}
    />
  );
}

function PriceQuoteFilter({ item, value, onChange }: PriceQuoteFilterProps) {
  const [open, setOpen] = useState(false);
  const normalizedValue = value || {
    quoteType: { [item.quoteTypeGroup.key]: [] },
    quoteRange: { [item.quoteRangeGroup.key]: [] },
    customRange: Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }])),
  };
  const normalizedCustomRange = normalizedValue.customRange || Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
  const selectedQuoteType = (normalizedValue.quoteType?.[item.quoteTypeGroup.key] || [])[0] || '';
  const selectedQuoteRange = (normalizedValue.quoteRange?.[item.quoteRangeGroup.key] || [])[0] || '';
  const customRangeSelected = hasRangeSelections(normalizedCustomRange);
  const selected = Boolean(selectedQuoteType || selectedQuoteRange || customRangeSelected);
  const selectedCount = [Boolean(selectedQuoteType), Boolean(selectedQuoteRange || customRangeSelected)].filter(Boolean).length;
  const displayLabel = selectedCount > 0 ? `${item.label}·${selectedCount}` : item.label;

  const clearCustomRange = () => Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]));
  const emptyQuoteType = () => ({ [item.quoteTypeGroup.key]: [] });
  const emptyQuoteRange = () => ({ [item.quoteRangeGroup.key]: [] });

  const content = (
    <div className="option-popover-filter xingtu-price-quote-filter">
      <div className="option-popover-filter__body xingtu-price-quote-filter__body">
        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">选择报价类型</span>
          <Select
            className="xingtu-price-quote-filter__select-control"
            onChange={(option) => {
              onChange({
                ...normalizedValue,
                quoteType: option === '全部' ? emptyQuoteType() : { [item.quoteTypeGroup.key]: [option] },
              });
            }}
            options={item.quoteTypeGroup.options.map((option) => ({ label: option, value: option }))}
            popupClassName="xingtu-filter-dropdown-menu xingtu-price-quote-filter__menu"
            size="small"
            value={selectedQuoteType || '全部'}
          />
        </div>

        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">报价区间</span>
          <PriceQuoteRangeSelect
            customRangeValue={normalizedCustomRange}
            item={item}
            onCustomRangeChange={(nextCustomRange) => {
              onChange({
                ...normalizedValue,
                quoteRange: emptyQuoteRange(),
                customRange: nextCustomRange,
              });
            }}
            onQuoteRangeChange={(nextQuoteRange) => {
              onChange({
                ...normalizedValue,
                quoteRange: nextQuoteRange,
                customRange: clearCustomRange(),
              });
            }}
            quoteRangeValue={normalizedValue.quoteRange}
          />
        </div>

        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              const emptyRange = clearCustomRange();
              onChange({
                quoteType: emptyQuoteType(),
                quoteRange: emptyQuoteRange(),
                customRange: emptyRange,
              });
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
            }}
            size="small"
            type="primary"
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={setOpen}
      open={open}
      overlayClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-price-quote-filter-overlay"
      placement="bottomLeft"
      trigger="click"
    >
      <button className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`} type="button">
        <span>{displayLabel}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}

type TaskCountFilterProps = {
  item: MatchTaskCountFilterItem;
  value: TaskCountFilterValue;
  onChange: (nextValue: TaskCountFilterValue) => void;
};

function createEmptyTaskCountValue(item: MatchTaskCountFilterItem): TaskCountFilterValue {
  return {
    taskTime: { [item.taskTimeGroup.key]: [] },
    taskCount: {
      min: '',
      max: '',
    },
  };
}

function TaskCountFilter({ item, value, onChange }: TaskCountFilterProps) {
  const [open, setOpen] = useState(false);
  const defaultValue = createEmptyTaskCountValue(item);
  const normalizedValue = value
    ? {
      taskTime: value.taskTime || defaultValue.taskTime,
      taskCount: {
        min: value.taskCount?.min || '',
        max: value.taskCount?.max || '',
      },
    }
    : defaultValue;
  const [draftValue, setDraftValue] = useState<TaskCountFilterValue>(normalizedValue);
  const selectedTaskTime = (normalizedValue.taskTime?.[item.taskTimeGroup.key] || [])[0] || '';
  const selectedMin = normalizedValue.taskCount?.min || '';
  const selectedMax = normalizedValue.taskCount?.max || '';
  const selected = Boolean(selectedTaskTime || selectedMin || selectedMax);
  const countLabel = [
    selectedMin ? `> ${selectedMin}` : '',
    selectedMax ? `< ${selectedMax}` : '',
  ].filter(Boolean).join(' 且 ');
  const displayLabel = [selectedTaskTime, countLabel].filter(Boolean).join(' ') || item.label;

  const draftTaskTime = (draftValue.taskTime?.[item.taskTimeGroup.key] || [])[0] || '';
  const draftMin = draftValue.taskCount?.min || '';
  const draftMax = draftValue.taskCount?.max || '';
  const maxNumber = draftMax === '' ? null : Number(draftMax);
  const minNumber = draftMin === '' ? null : Number(draftMin);
  const availableMinOptions = item.minOptions.filter((option) => maxNumber === null || Number(option) < maxNumber);
  const availableMaxOptions = item.maxOptions.filter((option) => minNumber === null || Number(option) > minNumber);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftValue(normalizedValue);
    }
    setOpen(nextOpen);
  };
  const updateDraftTaskTime = (option: string) => {
    setDraftValue({
      ...draftValue,
      taskTime: {
        [item.taskTimeGroup.key]: option ? [option] : [],
      },
    });
  };
  const updateDraftMin = (option?: string) => {
    const nextMin = option || '';
    const nextMinNumber = nextMin === '' ? null : Number(nextMin);
    const nextMax = nextMinNumber !== null && draftMax !== '' && Number(draftMax) <= nextMinNumber ? '' : draftMax;
    setDraftValue({
      ...draftValue,
      taskCount: {
        min: nextMin,
        max: nextMax,
      },
    });
  };
  const updateDraftMax = (option?: string) => {
    const nextMax = option || '';
    const nextMaxNumber = nextMax === '' ? null : Number(nextMax);
    const nextMin = nextMaxNumber !== null && draftMin !== '' && Number(draftMin) >= nextMaxNumber ? '' : draftMin;
    setDraftValue({
      ...draftValue,
      taskCount: {
        min: nextMin,
        max: nextMax,
      },
    });
  };
  const content = (
    <div className="option-popover-filter xingtu-task-count-filter">
      <div className="option-popover-filter__body xingtu-task-count-filter__body">
        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">任务时间</span>
          <Select
            allowClear
            className="xingtu-task-count-filter__select xingtu-task-count-filter__select-time"
            onChange={updateDraftTaskTime}
            options={item.taskTimeGroup.options.map((option) => ({ label: option, value: option }))}
            placeholder="任务时间"
            popupClassName="xingtu-filter-dropdown-menu xingtu-task-count-filter__menu"
            size="small"
            value={draftTaskTime || undefined}
          />
        </div>

        <div className="xingtu-price-quote-filter__row">
          <span className="xingtu-price-quote-filter__label">任务数量</span>
          <div className="xingtu-task-count-filter__range-selects">
            <Select
              allowClear
              className="xingtu-task-count-filter__select xingtu-task-count-filter__select-number"
              onChange={updateDraftMin}
              options={availableMinOptions.map((option) => ({ label: option, value: option }))}
              placeholder="最低数量"
              popupClassName="xingtu-filter-dropdown-menu xingtu-task-count-filter__menu"
              size="small"
              value={draftMin || undefined}
            />
            <span className="range-popover-filter__separator">-</span>
            <Select
              allowClear
              className="xingtu-task-count-filter__select xingtu-task-count-filter__select-number"
              onChange={updateDraftMax}
              options={availableMaxOptions.map((option) => ({ label: option, value: option }))}
              placeholder="最高数量"
              popupClassName="xingtu-filter-dropdown-menu xingtu-task-count-filter__menu"
              size="small"
              value={draftMax || undefined}
            />
          </div>
        </div>

        <div className="range-popover-filter__footer xingtu-preset-range-filter__footer">
          <Button
            onClick={() => {
              const emptyValue = createEmptyTaskCountValue(item);
              setDraftValue(emptyValue);
              onChange(emptyValue);
            }}
            size="small"
            type="text"
          >
            重置
          </Button>
          <Button
            onClick={() => {
              onChange(draftValue);
              setOpen(false);
            }}
            size="small"
            type="primary"
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={handleOpenChange}
      open={open}
      overlayClassName="option-popover-filter-overlay range-popover-filter-overlay xingtu-task-count-filter-overlay"
      placement="bottomLeft"
      trigger="click"
    >
      <button className={`xingtu-filter-option xingtu-filter-option-dropdown${selected ? ' selected' : ''}`} type="button">
        <span>{displayLabel}</span>
        <CaretDownOutlined />
      </button>
    </Popover>
  );
}

export function XingtuCreatorFilters({ values, actions }: XingtuCreatorFiltersProps) {
  const isMatchCreatorTypeDefault = !values.matchCreatorTypeTags.length && !hasSelectionsInFilterMap(values.matchCreatorTypeSelections);
  const isMatchContentTopicDefault = !hasSelectionsInFilterMap(values.matchContentTopicSelections);

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
      return renderFilterOption(
        item.label,
        selectedTags.includes(item.label),
        () => handlers.onTagToggle(item.label),
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

    if (item.type === 'priceQuote') {
      return (
        <PriceQuoteFilter
          item={item}
          onChange={actions.onCostPerformancePriceQuoteChange}
          value={values.costPerformancePriceQuote}
        />
      );
    }

    if (item.type === 'taskCount') {
      return (
        <TaskCountFilter
          item={item}
          onChange={actions.onCostPerformanceTaskCountChange}
          value={values.costPerformanceTaskCount}
        />
      );
    }

    return renderMatchPopoverItem(
      item,
      popoverValues[item.label],
      (nextValue) => handlers.onPopoverChange(item.label, nextValue),
    );
  }

  function renderCooperationControl(control: CreatorFilterControlSchema) {
    switch (control.kind) {
      case 'option': {
        if (control.intent === 'collaborationObject') {
          const value = control.value as CollaborationObjectOption;
          return renderFilterOption(control.label, values.collaborationObject === value, () => {
            if (values.collaborationObject !== value) {
              actions.onCollaborationObjectChange(value);
            }
          });
        }

        if (control.intent === 'creatorType') {
          const value = control.value as CreatorTypeOption;
          return renderFilterOption(control.label, values.creatorTypes.includes(value), () => {
            actions.onCreatorTypeSelect(value);
          });
        }

        if (control.intent === 'goal') {
          const value = control.value as GoalOption;
          return renderFilterOption(control.label, values.goals.includes(value), () => {
            actions.onGoalSelect(value);
          });
        }

        return renderFilterOption(control.label, values.audienceMode === '不限', () => {
          if (values.audienceMode === '不限' && values.audienceTreeKeys.length === 0) {
            return;
          }
          actions.onAudienceModeReset();
        });
      }

      case 'tree':
        if (control.groupValue === '短剧演员') {
          return (
            <TreePopoverFilter
              key={control.groupValue}
              actionIndent={control.actionIndent}
              allSelectedValues={control.allSelectedValues}
              getDisplayCount={getShortDramaDisplayCount}
              label={control.label}
              maxHeight={control.maxHeight}
              maxWidth={control.maxWidth}
              minWidth={control.minWidth}
              normalizeValues={control.normalizeMode === 'shortDrama' ? normalizeShortDramaSelections : undefined}
              onChange={actions.onShortDramaSelectionsChange}
              selected={values.creatorTypes.includes(control.groupValue) || values.shortDramaSelections.length > 0}
              treeData={control.treeData}
              values={values.shortDramaSelections}
            />
          );
        }

        return (
          <TreePopoverFilter
            key={control.groupValue}
            label={control.label}
            maxHeight={control.maxHeight}
            maxWidth={control.maxWidth}
            minWidth={control.minWidth}
            onChange={actions.onShortLiveSelectionsChange}
            selected={values.creatorTypes.includes(control.groupValue) || values.shortLiveSelections.length > 0}
            treeData={control.treeData}
            values={values.shortLiveSelections}
          />
        );

      case 'dropdown':
        if (control.intent === 'extraCreatorType') {
          const selected = values.creatorTypes.includes('其它题材') || values.extraCreatorTypes.length > 0;
          return (
            <Dropdown classNames={{ root: 'xingtu-filter-dropdown-overlay' }} menu={buildMenu(control.options, values.extraCreatorTypes, actions.onExtraCreatorTypeSelect)} placement="bottomLeft" trigger={['click']}>
              {renderDropdownTrigger(values.extraCreatorTypes[0] || control.defaultLabel, selected)}
            </Dropdown>
          );
        }

        if (control.intent === 'grassSelection') {
          const selected = values.goals.includes('破圈种草') || values.grassSelections.length > 0;
          return (
            <Dropdown classNames={{ root: 'xingtu-filter-dropdown-overlay' }} menu={buildMenu(control.options, values.grassSelections, actions.onGrassSelectionSelect)} placement="bottomLeft" trigger={['click']}>
              {renderDropdownTrigger(values.grassSelections[0] || control.defaultLabel, selected)}
            </Dropdown>
          );
        }

        return (
          <Dropdown classNames={{ root: 'xingtu-filter-dropdown-overlay' }} menu={buildMenu(control.options, values.audienceTreeKeys, actions.onAudienceOptionSelect)} placement="bottomLeft" trigger={['click']}>
            {renderDropdownTrigger(values.audienceTreeKeys[0] || control.defaultLabel, values.audienceMode === '八大人群' || values.audienceTreeKeys.length > 0)}
          </Dropdown>
        );

      case 'popover': {
        const content = (
          <div className="xingtu-filter-popover">
            <div className="xingtu-filter-popover-grid">
              {control.options.map((option) => (
                <Fragment key={option}>
                  {renderFilterOption(option, values.industry === option, () => actions.onIndustryChange(option))}
                </Fragment>
              ))}
            </div>
          </div>
        );

        return (
          <Popover arrow={false} content={content} placement="bottomLeft" trigger="click">
            <button className={`xingtu-filter-option${values.industry !== '不限' ? ' selected' : ''}`} type="button">
              {values.industry}
              <CaretDownOutlined />
            </button>
          </Popover>
        );
      }

      case 'subgroup':
        return (
          <>
            <div className="xingtu-filter-subgroup-label">{control.label}</div>
            {control.controls.map((childControl) => (
              <Fragment key={childControl.key}>
                {renderCooperationControl(childControl)}
              </Fragment>
            ))}
          </>
        );

      default:
        return null;
    }
  }

  return (
    <>
      <div className="xingtu-filter-section-row">
        <div className="xingtu-filter-section-side">合作诉求</div>
        <div className="xingtu-filter-section-body">
          {COOPERATION_SECTION_LINES.map((line) => (
            <div className="xingtu-filter-line xingtu-filter-line-match" key={line.key}>
              {line.fields.map((field) => (
                <Fragment key={field.key}>
                  <div className="xingtu-filter-line-label">{field.label}</div>
                  <div className={`xingtu-filter-line-content xingtu-filter-line-content-match${field.contentClassName ? ` ${field.contentClassName}` : ''}`}>
                    {field.controls.map((control) => (
                      <Fragment key={control.key}>
                        {renderCooperationControl(control)}
                      </Fragment>
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="xingtu-filter-panel-divider" />

      <div className="xingtu-filter-section-row">
        <div className="xingtu-filter-section-side">匹配度</div>
        <div className="xingtu-filter-section-body">
          <CollapsibleFilterRow contentClassName="xingtu-filter-line-content-match" label="达人类型">
            {MATCH_CREATOR_TYPE_FILTERS.map((item) => (
              <span className="xingtu-match-option-shell" key={item.label}>
                {item.type === 'tag'
                  ? item.label === '不限'
                    ? renderFilterOption(
                      item.label,
                      isMatchCreatorTypeDefault,
                      actions.onResetMatchCreatorType,
                    )
                    : renderFilterOption(
                      item.label,
                      values.matchCreatorTypeTags.includes(item.label),
                      () => actions.onToggleMatchCreatorTypeTag(item.label),
                    )
                  : item.type === 'popover' ? renderMatchPopoverItem(
                    item,
                    values.matchCreatorTypeSelections[item.label],
                    (nextValue) => {
                      actions.onMatchCreatorTypeSelectionChange(item.label, nextValue);
                    },
                  ) : null}
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
                  ? renderFilterOption(
                    item.label,
                    isMatchContentTopicDefault,
                    actions.onResetMatchContentTopic,
                  )
                  : item.type === 'popover' ? renderMatchPopoverItem(
                    item,
                    values.matchContentTopicSelections[item.label],
                    (nextValue) => {
                      actions.onMatchContentTopicSelectionChange(item.label, nextValue);
                    },
                  ) : null}
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
                    {renderGenericFilterItem(
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
