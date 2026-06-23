import type { OptionPopoverFilterGroup, OptionPopoverFilterValue } from '../../components/OptionPopoverFilter';
import type { RangePopoverFilterValue } from '../../components/RangePopoverFilter';
import schemaData from './buyinCreatorFilterSchema.json';
import { BUYIN_PROVINCE_CITY_OPTIONS } from './buyinProvinceCityOptions';

type RawBuyinFilter = {
  单选?: string;
  多选?: string;
  范围?: string;
  开关?: string;
  复合?: string;
  分组?: RawBuyinFilter[];
  选项?: string;
  字段?: string[] | string;
  单位?: string;
  保留默认选项?: boolean;
  级联选项?: Array<{
    标签: string;
    子级?: string[];
  }>;
};

type RawBuyinFilterField = {
  title: string;
  filters: RawBuyinFilter[];
};

type RawBuyinFilterSection = {
  title: string;
  data: RawBuyinFilterField[];
};

export type BuyinPopoverFilterItem = {
  type: 'popover';
  label: string;
  groups: OptionPopoverFilterGroup[];
  displayMode?: 'count' | 'selected';
  renderAsTree?: boolean;
  treeSelectionMode?: 'single' | 'multiple';
  treeSelectAllLabel?: string;
};

export type BuyinRangeFilterItem = {
  type: 'range';
  label: string;
  fields: string[];
  unit?: string;
};

export type BuyinToggleFilterItem = {
  type: 'toggle';
  label: string;
};

export type BuyinInlineOptionsFilterItem = {
  type: 'inline-options';
  label: string;
  group: OptionPopoverFilterGroup;
};

export type BuyinAggregateFilterControl =
  | {
    type: 'single';
    key: string;
    label: string;
    options: string[];
    defaultValue?: string;
  }
  | {
    type: 'tree-single';
    key: string;
    label: string;
    options: Array<{
      label: string;
      value: string;
      children?: Array<{
        label: string;
        value: string;
      }>;
    }>;
    defaultValue?: string;
  };

export type BuyinAggregatePopoverFilterItem = {
  type: 'aggregate-popover';
  label: string;
  controls: BuyinAggregateFilterControl[];
};

export type BuyinFilterItem =
  | BuyinPopoverFilterItem
  | BuyinRangeFilterItem
  | BuyinToggleFilterItem
  | BuyinInlineOptionsFilterItem
  | BuyinAggregatePopoverFilterItem;

export type BuyinFilterGroup = {
  sectionTitle: string;
  title: string;
  filters: BuyinFilterItem[];
};

export type BuyinFilterValue = {
  selections: Record<string, OptionPopoverFilterValue>;
  ranges: Record<string, RangePopoverFilterValue>;
};

const ROOT_GROUP_KEY = '__root__';
const BUYIN_MULTI_TREE_FILTER_LABELS = new Set(['达人等级', '粉丝量', '合作等级']);
const BUYIN_REGION_AGGREGATE_LABELS = new Set(['达人画像', '粉丝画像', '粉丝偏好']);
const BUYIN_REGION_CONTROL_LABELS = new Set(['达人地区', '地区']);

function createBuyinRegionOptions() {
  return [
    { label: '不限', value: '不限' },
    ...BUYIN_PROVINCE_CITY_OPTIONS.map((option) => {
      const children = 'children' in option && Array.isArray(option.children)
        ? option.children.map((child) => ({
          label: child.label,
          value: child.value,
        }))
        : undefined;
      return {
        label: option.label,
        value: option.value,
        children,
      };
    }),
  ];
}

function createDefaultGroupSelection(group: OptionPopoverFilterGroup) {
  return group.options.includes('全部') ? ['全部'] : [];
}

function createDefaultPopoverSelection(item: BuyinPopoverFilterItem) {
  return Object.fromEntries(item.groups.map((group) => [group.key, createDefaultGroupSelection(group)]));
}

function splitOptions(value?: string) {
  return String(value || '')
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFields(value: string[] | string | undefined, fallback: string) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  const fields = splitOptions(value);
  return fields.length ? fields : [fallback];
}

function normalizeOptions(filter: RawBuyinFilter) {
  const options = splitOptions(filter.选项);
  if (filter.保留默认选项) {
    return options;
  }
  return options.filter((option) => !['不限', '全部'].includes(option));
}

function resolveCascadeGroups(filter: RawBuyinFilter): OptionPopoverFilterGroup[] {
  const nodes = Array.isArray(filter.级联选项) ? filter.级联选项 : [];
  const rootOptions = nodes
    .filter((node) => !Array.isArray(node.子级) || !node.子级.length)
    .map((node) => normalizeText(node.标签))
    .filter(Boolean);
  const childGroups = nodes
    .filter((node) => Array.isArray(node.子级) && node.子级.length)
    .map((node) => {
      const label = normalizeText(node.标签);
      return {
        key: label,
        label,
        mode: 'single' as const,
        options: (node.子级 || []).map(normalizeText).filter(Boolean),
      };
    })
    .filter((group) => group.key && group.options.length);

  const groups: OptionPopoverFilterGroup[] = [];
  if (rootOptions.length) {
    groups.push({
      key: ROOT_GROUP_KEY,
      mode: 'single',
      options: rootOptions,
    });
  }
  groups.push(...childGroups);
  return groups;
}

function resolveFilter(filter: RawBuyinFilter, groupTitle?: string): BuyinFilterItem | null {
  const compositeLabel = filter.复合?.trim();
  if (compositeLabel) {
    if (BUYIN_REGION_AGGREGATE_LABELS.has(compositeLabel)) {
      const controls = (filter.分组 || [])
        .map((group): BuyinAggregateFilterControl | null => {
          const singleLabel = group.单选?.trim();
          if (!singleLabel) {
            return null;
          }
          if (BUYIN_REGION_CONTROL_LABELS.has(singleLabel)) {
            return {
              type: 'tree-single',
              key: singleLabel,
              label: singleLabel,
              options: createBuyinRegionOptions(),
              defaultValue: '不限',
            };
          }
          const options = splitOptions(group.选项);
          return {
            type: 'single',
            key: singleLabel,
            label: singleLabel,
            options,
            defaultValue: options.includes('不限') ? '不限' : undefined,
          };
        })
        .filter((control): control is BuyinAggregateFilterControl => Boolean(control));

      if (!controls.length) {
        return null;
      }

      return {
        type: 'aggregate-popover',
        label: compositeLabel,
        controls,
      };
    }

    const groups = (filter.分组 || [])
      .map((group): OptionPopoverFilterGroup | null => {
        const singleLabel = group.单选?.trim();
        const multiLabel = group.多选?.trim();
        const label = singleLabel || multiLabel;
        if (!label) {
          return null;
        }
        return {
          key: label,
          label,
          mode: singleLabel ? 'single' as const : 'multi' as const,
          options: normalizeOptions(group),
          showSelectAll: Boolean(multiLabel),
        };
      })
      .filter((group): group is OptionPopoverFilterGroup => Boolean(group?.options.length));

    if (!groups.length) {
      return null;
    }

    return {
      type: 'popover',
      label: compositeLabel,
      groups,
    };
  }

  const toggleLabel = filter.开关?.trim();
  if (toggleLabel) {
    return {
      type: 'toggle',
      label: toggleLabel,
    };
  }

  const singleLabel = filter.单选?.trim();
  if (singleLabel) {
    const cascadeGroups = resolveCascadeGroups(filter);
    return {
      type: 'popover',
      label: singleLabel,
      displayMode: filter.保留默认选项 ? 'count' : 'selected',
      groups: cascadeGroups.length ? cascadeGroups : [
        {
          key: ROOT_GROUP_KEY,
          mode: 'single',
          options: normalizeOptions(filter),
        },
      ],
      renderAsTree: Boolean(cascadeGroups.length),
      treeSelectionMode: cascadeGroups.length ? 'single' : undefined,
    };
  }

  const multiLabel = filter.多选?.trim();
  if (multiLabel) {
    if (multiLabel === '内容类型') {
      const options = splitOptions(filter.选项);
      if (!options.length) {
        return null;
      }

      return {
        type: 'inline-options',
        label: multiLabel,
        group: {
          key: ROOT_GROUP_KEY,
          mode: 'multi',
          options,
          showSelectAll: false,
        },
      };
    }

    return {
      type: 'popover',
      label: multiLabel,
      groups: [
        {
          key: ROOT_GROUP_KEY,
          mode: 'multi',
          options: normalizeOptions(filter),
          showSelectAll: true,
        },
      ],
      renderAsTree: groupTitle === '带货数据' || BUYIN_MULTI_TREE_FILTER_LABELS.has(multiLabel),
      treeSelectionMode: groupTitle === '带货数据' || BUYIN_MULTI_TREE_FILTER_LABELS.has(multiLabel) ? 'multiple' : undefined,
      treeSelectAllLabel: multiLabel === '达人等级' ? '不限' : undefined,
    };
  }

  const rangeLabel = filter.范围?.trim();
  if (rangeLabel) {
    return {
      type: 'range',
      label: rangeLabel,
      fields: normalizeFields(filter.字段, rangeLabel),
      unit: filter.单位,
    };
  }

  return null;
}

export const BUYIN_CREATOR_FILTER_GROUPS: BuyinFilterGroup[] = (schemaData as RawBuyinFilterSection[]).flatMap((section) => (
  section.data.map((field) => ({
    sectionTitle: section.title,
    title: field.title,
    filters: field.filters.map((filter) => resolveFilter(filter, field.title)).filter((item): item is BuyinFilterItem => Boolean(item)),
  }))
));

export const BUYIN_CREATOR_FILTER_ITEMS = BUYIN_CREATOR_FILTER_GROUPS.flatMap((group) => group.filters);

export function createEmptyBuyinFilterValue(): BuyinFilterValue {
  return {
    selections: Object.fromEntries(
      BUYIN_CREATOR_FILTER_GROUPS.flatMap((group) => (
        group.filters
          .filter((item): item is BuyinPopoverFilterItem | BuyinToggleFilterItem | BuyinInlineOptionsFilterItem | BuyinAggregatePopoverFilterItem => item.type === 'popover' || item.type === 'toggle' || item.type === 'inline-options' || item.type === 'aggregate-popover')
          .map((item) => [
            item.label,
            item.type === 'popover'
              ? createDefaultPopoverSelection(item)
              : item.type === 'inline-options'
                ? { [item.group.key]: createDefaultGroupSelection(item.group) }
                : item.type === 'aggregate-popover'
                  ? Object.fromEntries(item.controls.map((control) => [control.key, []]))
                : group.title === '主推类目' && item.label === '全部'
                  ? { [ROOT_GROUP_KEY]: ['全部'] }
                  : { [ROOT_GROUP_KEY]: [] },
          ])
      )),
    ),
    ranges: Object.fromEntries(
      BUYIN_CREATOR_FILTER_ITEMS
        .filter((item): item is BuyinRangeFilterItem => item.type === 'range')
        .map((item) => [item.label, Object.fromEntries(item.fields.map((field) => [field, { min: '', max: '' }]))]),
    ),
  };
}

export function cloneBuyinFilterValue(value: BuyinFilterValue): BuyinFilterValue {
  return {
    selections: Object.fromEntries(
      Object.entries(value.selections || {}).map(([label, groups]) => [
        label,
        Object.fromEntries(Object.entries(groups || {}).map(([groupKey, options]) => [groupKey, [...options]])),
      ]),
    ),
    ranges: Object.fromEntries(
      Object.entries(value.ranges || {}).map(([label, fields]) => [
        label,
        Object.fromEntries(
          Object.entries(fields || {}).map(([field, range]) => [
            field,
            {
              min: range?.min || '',
              max: range?.max || '',
            },
          ]),
        ),
      ]),
    ),
  };
}

export function collectBuyinFilterTokens(value: BuyinFilterValue) {
  const tokens: string[] = [];

  for (const group of BUYIN_CREATOR_FILTER_GROUPS) {
    for (const item of group.filters) {
      if (item.type === 'popover') {
        for (const optionGroup of item.groups) {
          const selectedOptions = value.selections[item.label]?.[optionGroup.key] || [];
          for (const option of selectedOptions) {
            tokens.push(
              [
                group.sectionTitle,
                group.title,
                item.label,
                optionGroup.key === ROOT_GROUP_KEY ? '' : optionGroup.label || optionGroup.key,
                option,
              ].filter(Boolean).join('/'),
            );
          }
        }
        continue;
      }

      if (item.type === 'toggle') {
        const selectedOptions = value.selections[item.label]?.[ROOT_GROUP_KEY] || [];
        if (selectedOptions.includes(item.label)) {
          tokens.push([group.sectionTitle, group.title, item.label, item.label].filter(Boolean).join('/'));
        }
        continue;
      }

      if (item.type === 'inline-options') {
        const selectedOptions = value.selections[item.label]?.[item.group.key] || [];
        for (const option of selectedOptions) {
          tokens.push([group.sectionTitle, group.title, item.label, option].filter(Boolean).join('/'));
        }
        continue;
      }

      if (item.type === 'aggregate-popover') {
        for (const control of item.controls) {
          const selectedOptions = value.selections[item.label]?.[control.key] || [];
          for (const option of selectedOptions) {
            const tokenValue = control.type === 'tree-single' ? option.replace(/\//g, '>') : option;
            tokens.push([group.sectionTitle, group.title, item.label, control.label, tokenValue].filter(Boolean).join('/'));
          }
        }
        continue;
      }

      const rangeValue = value.ranges[item.label] || {};
      for (const [field, range] of Object.entries(rangeValue)) {
        if (!range?.min && !range?.max) {
          continue;
        }
        tokens.push([group.sectionTitle, group.title, item.label, field, `${range.min || '-'}~${range.max || '-'}`].filter(Boolean).join('/'));
      }
    }
  }

  return tokens;
}
