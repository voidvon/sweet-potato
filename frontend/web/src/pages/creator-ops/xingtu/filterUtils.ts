import type { MenuProps } from 'antd';
import type { OptionPopoverFilterGroup, OptionPopoverFilterValue } from '../../../components/OptionPopoverFilter';
import type { RangePopoverFilterValue } from '../../../components/RangePopoverFilter';
import {
  createAudienceProfileGroups,
  MATCH_BACKGROUND_FILTERS,
  MATCH_FOLLOWER_COUNT_FILTER,
  MATCH_PERSONA_CAREER_FILTER,
  MATCH_PERSONA_CHARACTER_FILTER,
  MATCH_PERSONA_HOBBY_FILTER,
  MATCH_PERSONA_INDUSTRY_FILTERS,
  MATCH_PERSONA_TONE_FILTER,
  type MatchInlineFilterItem,
  type MatchPopoverFilterItem,
  type MatchTaskCountFilterItem,
} from '../xingtuCreatorFilterData';
import type { TaskCountFilterValue } from './filterTypes';

export const MATCH_VIEWER_PROFILE_GROUPS = createAudienceProfileGroups('观众');
export const MATCH_FAN_PROFILE_GROUPS = createAudienceProfileGroups('粉丝');
export const MATCH_PERSONA_INDUSTRY_POPOVER_FILTERS = MATCH_PERSONA_INDUSTRY_FILTERS as Array<Extract<MatchInlineFilterItem, { type: 'popover' }>>;
export const MATCH_BACKGROUND_POPOVER_FILTERS = MATCH_BACKGROUND_FILTERS as Array<Extract<MatchInlineFilterItem, { type: 'popover' }>>;
export const MATCH_PERSONA_CAREER_POPOVER_FILTER = MATCH_PERSONA_CAREER_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
export const MATCH_PERSONA_HOBBY_POPOVER_FILTER = MATCH_PERSONA_HOBBY_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
export const MATCH_PERSONA_TONE_POPOVER_FILTER = MATCH_PERSONA_TONE_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
export const MATCH_PERSONA_CHARACTER_POPOVER_FILTER = MATCH_PERSONA_CHARACTER_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;
export const MATCH_FOLLOWER_COUNT_POPOVER_FILTER = MATCH_FOLLOWER_COUNT_FILTER as Extract<MatchInlineFilterItem, { type: 'popover' }>;

export function buildMenu(options: string[], selectedKeys: string[], onSelect: (value: string) => void): MenuProps {
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

export function isMultiGroupPopover(item: MatchPopoverFilterItem) {
  return item.groups.every((group) => group.mode === 'multi');
}

export function buildGroupChildValue(groupKey: string, option: string) {
  return `${groupKey}/${option}`;
}

export function buildTreeDataFromMultiGroups(groups: OptionPopoverFilterGroup[]) {
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

export function normalizeTreeValuesToGroupSelections(groups: OptionPopoverFilterGroup[], values: string[]) {
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

export function normalizeGroupSelectionsToTreeValues(groups: OptionPopoverFilterGroup[], value: OptionPopoverFilterValue) {
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

export function countTreeGroupSelections(groups: OptionPopoverFilterGroup[], values: string[]) {
  const normalized = normalizeTreeValuesToGroupSelections(groups, values);
  return groups.reduce((count, group) => count + (normalized[group.key]?.length || 0), 0);
}

export function hasSelectionsInFilterMap(value: Record<string, OptionPopoverFilterValue>) {
  return Object.values(value).some((entry) => Object.values(entry).some((options) => options.length > 0));
}

export function hasRangeSelections(value: RangePopoverFilterValue | undefined) {
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

export function normalizeBoundedNumericInput(value: string, min?: number, max?: number) {
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

export function createEmptyTaskCountValue(item: MatchTaskCountFilterItem): TaskCountFilterValue {
  return {
    taskTime: { [item.taskTimeGroup.key]: [] },
    taskCount: {
      min: '',
      max: '',
    },
  };
}
