import type { DataNode } from 'antd/es/tree';
import type { OptionPopoverFilterGroup } from '../../components/OptionPopoverFilter';
import filterSchemaData from './xingtuCreatorFilterSchema.json';

export type CollaborationObjectOption = '不限' | '明星';
export type CreatorTypeOption = '短视频达人' | '短剧演员' | '短直达人' | '其它题材';
export type GoalOption = '品牌曝光' | '破圈种草' | '行动转化';
export type AudienceModeOption = '不限' | '八大人群';

export type HierarchicalFilterOption = {
  label: string;
  children?: string[] | string;
};

type SelectionMode =
  | 'single'
  | 'multi'
  | 'hierarchical'
  | 'group'
  | 'toggle'
  | 'reset'
  | 'multiGroup'
  | 'range';

type CreatorFilterControlIntent =
  | 'collaborationObject'
  | 'creatorType'
  | 'goal'
  | 'resetAudienceMode'
  | 'shortDrama'
  | 'shortLive'
  | 'extraCreatorType'
  | 'grassSelection'
  | 'eightAudience'
  | 'industry';

export type CreatorFilterControlSchema =
  | {
    kind: 'option';
    key: string;
    label: string;
    intent: 'collaborationObject' | 'creatorType' | 'goal' | 'resetAudienceMode';
    value: string;
  }
  | {
    kind: 'tree';
    key: string;
    label: string;
    intent: 'shortDrama' | 'shortLive';
    groupValue: CreatorTypeOption;
    treeData: DataNode[];
    allSelectedValues?: string[];
    minWidth?: number;
    maxWidth?: number | string;
    maxHeight?: number;
    actionIndent?: number;
    normalizeMode?: 'shortDrama';
    displayCountMode?: 'shortDrama';
  }
  | {
    kind: 'dropdown';
    key: string;
    label: string;
    intent: 'extraCreatorType' | 'grassSelection' | 'eightAudience';
    options: string[];
    defaultLabel: string;
  }
  | {
    kind: 'popover';
    key: string;
    label: string;
    intent: 'industry';
    options: string[];
  }
  | {
    kind: 'subgroup';
    key: string;
    label: string;
    controls: CreatorFilterControlSchema[];
  };

export type CreatorFilterFieldSchema = {
  key: string;
  label: string;
  contentClassName?: string;
  controls: CreatorFilterControlSchema[];
};

export type CreatorFilterLineSchema = {
  key: string;
  fields: CreatorFilterFieldSchema[];
};

export type MatchInlineFilterItem =
  | {
    type: 'tag';
    label: string;
  }
  | {
    type: 'popover';
    label: string;
    groups: OptionPopoverFilterGroup[];
    displayMode?: 'count' | 'selected';
  }
  | {
    type: 'range';
    label: string;
    fields: string[];
    unit?: string;
  }
  | {
    type: 'presetRange';
    label: string;
    groups: OptionPopoverFilterGroup[];
    fields: string[];
    unit?: string;
    min?: number;
    max?: number;
    displayMode?: 'count' | 'selected';
  }
  | {
    type: 'priceQuote';
    label: string;
    quoteTypeGroup: OptionPopoverFilterGroup;
    quoteRangeGroup: OptionPopoverFilterGroup;
    fields: string[];
    unit?: string;
    min?: number;
    max?: number;
  }
  | {
    type: 'taskCount';
    label: string;
    taskTimeGroup: OptionPopoverFilterGroup;
    minOptions: string[];
    maxOptions: string[];
  };

export type MatchPopoverFilterItem = Extract<MatchInlineFilterItem, { type: 'popover' }>;
export type MatchRangeFilterItem = Extract<MatchInlineFilterItem, { type: 'range' }>;
export type MatchPresetRangeFilterItem = Extract<MatchInlineFilterItem, { type: 'presetRange' }>;
export type MatchPriceQuoteFilterItem = Extract<MatchInlineFilterItem, { type: 'priceQuote' }>;
export type MatchTaskCountFilterItem = Extract<MatchInlineFilterItem, { type: 'taskCount' }>;

type RawSemanticGroup = {
  [label: string]: string;
} | string;

type RawSemanticFilter = {
  title?: string;
  组内?: '单选';
  filters?: RawSemanticFilter[];
  单选?: string;
  报价?: string;
  任务数?: string;
  多选?: string;
  分级?: string;
  分组单选?: string;
  分组多选?: string;
  范围?: string;
  重置?: string;
  开关?: string;
  选项?: string | Array<string | HierarchicalFilterOption | RawSemanticFilter>;
  分组?: RawSemanticGroup[];
  字段?: string[] | string;
  单位?: string;
  最小值?: number;
  最大值?: number;
  报价类型选项?: string;
  报价区间选项?: string;
  任务时间选项?: string;
  最低数量选项?: string;
  最高数量选项?: string;
};

type RawCooperationField = {
  title: string;
  filters: RawSemanticFilter[];
};

type MatchDataTitle = '达人类型' | '内容主题' | '背景信息' | '受众画像';
type CostPerformanceDataTitle = '合作信息' | '合作数据';

type RawMatchFilterListItem<T extends string> = {
  title: T;
  filters: RawSemanticFilter[];
};

type RawMatchFilterItem =
  | RawMatchFilterListItem<'达人类型'>
  | RawMatchFilterListItem<'内容主题'>
  | RawMatchFilterListItem<'背景信息'>
  | RawMatchFilterListItem<'受众画像'>
  | {
    title: '达人人设';
    groups: Array<{
      title: '行业特色人设' | '职业爱好';
      filters: RawSemanticFilter[];
    }>;
  };

type XingtuCreatorFilterSection =
  | {
    title: '合作诉求';
    data: RawCooperationField[];
  }
  | {
    title: '匹配度';
    data: RawMatchFilterItem[];
  }
  | {
    title: '性价比';
    data: RawMatchFilterListItem<CostPerformanceDataTitle>[];
  }
  | {
    title: '主题推荐';
    data: RawMatchFilterListItem<'优选达人' | '活动精选'>[];
  };

type XingtuCreatorFilterSchemaData = XingtuCreatorFilterSection[];

export const XINGTU_CREATOR_FILTER_SCHEMA = filterSchemaData as XingtuCreatorFilterSchemaData;

const ROOT_GROUP_KEY = '__root__';
const SELECTED_DISPLAY_LABELS = new Set(['职业', '爱好', '主要出镜人物', '达人性别', '学历', '黄v认证', '粉丝数量']);
const COOPERATION_FIELD_KEY_BY_TITLE: Record<string, string> = {
  合作对象: 'collaboration-object',
  适配行业: 'industry',
  营销目标: 'goal',
  匹配人群: 'audience',
};

function getFilterSection<T extends XingtuCreatorFilterSection['title']>(title: T) {
  const section = XINGTU_CREATOR_FILTER_SCHEMA.find((item): item is Extract<XingtuCreatorFilterSection, { title: T }> => item.title === title);
  if (!section) {
    throw new Error(`Missing xingtu creator filter section: ${title}`);
  }
  return section;
}

function getMatchDataItem<T extends RawMatchFilterItem['title']>(title: T) {
  const section = getFilterSection('匹配度');
  const item = section.data.find((entry): entry is Extract<RawMatchFilterItem, { title: T }> => entry.title === title);
  if (!item) {
    throw new Error(`Missing xingtu match filter item: ${title}`);
  }
  return item;
}

function buildHierarchicalValue(parent: string, child?: string) {
  return child ? `${parent}/${child}` : parent;
}

function getFilterSpec(filter: RawSemanticFilter): { selection: SelectionMode; label: string } | undefined {
  if (filter.单选) return { selection: 'single', label: filter.单选 };
  if (filter.多选) return { selection: 'multi', label: filter.多选 };
  if (filter.分级) return { selection: 'hierarchical', label: filter.分级 };
  if (filter.分组单选) return { selection: 'multiGroup', label: filter.分组单选 };
  if (filter.分组多选) return { selection: 'multiGroup', label: filter.分组多选 };
  if (filter.范围) return { selection: 'range', label: filter.范围 };
  if (filter.重置) return { selection: 'reset', label: filter.重置 };
  if (filter.开关) return { selection: 'toggle', label: filter.开关 };
  return undefined;
}

function isHierarchicalFilterOption(option: string | HierarchicalFilterOption | RawSemanticFilter): option is HierarchicalFilterOption {
  return typeof option !== 'string' && 'label' in option && !('filters' in option);
}

function isSemanticFilter(option: string | HierarchicalFilterOption | RawSemanticFilter): option is RawSemanticFilter {
  return typeof option !== 'string' && ('filters' in option || Boolean(getFilterSpec(option as RawSemanticFilter)));
}

function splitCompactList(value: string[] | string | undefined) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeRawOptions(options: RawSemanticFilter['选项'] = []) {
  return typeof options === 'string' ? splitCompactList(options) : options;
}

function normalizeStringOptions(options: RawSemanticFilter['选项'] = []) {
  return normalizeRawOptions(options).map((option) => {
    if (typeof option === 'string') {
      return option;
    }
    if (isSemanticFilter(option)) {
      return getFilterSpec(option)?.label || option.title || '';
    }
    return option.label;
  }).filter(Boolean);
}

function normalizeFields(fields: RawSemanticFilter['字段'] = []) {
  return splitCompactList(fields);
}

function parseHierarchicalOptionText(options: string) {
  return options.split(';').map((item) => {
    const [label, children] = item.split(':');
    return {
      label: (label || '').trim(),
      children: splitCompactList(children),
    };
  }).filter((option) => option.label);
}

function normalizeHierarchicalOptions(options: RawSemanticFilter['选项'] = []): HierarchicalFilterOption[] {
  if (typeof options === 'string' && options.includes(';')) {
    return parseHierarchicalOptionText(options);
  }

  return normalizeRawOptions(options).map((option) => (
    typeof option === 'string'
      ? { label: option }
      : {
        label: isSemanticFilter(option) ? getFilterSpec(option)?.label || option.title || '' : option.label,
        children: isHierarchicalFilterOption(option) ? splitCompactList(option.children) : undefined,
      }
  )).filter((option) => option.label);
}

function normalizeSemanticOptions(options: RawSemanticFilter['选项'] = []) {
  return normalizeRawOptions(options).filter(isSemanticFilter);
}

function buildTreeDataFromHierarchicalOptions(options: HierarchicalFilterOption[]) {
  return options.map((option) => {
    const children = splitCompactList(option.children);

    return children.length
      ? {
        title: option.label,
        value: option.label,
        key: option.label,
        children: children.map((child) => ({
          title: child,
          value: buildHierarchicalValue(option.label, child),
          key: buildHierarchicalValue(option.label, child),
        })),
      }
      : {
        title: option.label,
        value: option.label,
        key: option.label,
      };
  });
}

function buildTreeDataFromStringOptions(options: string[]) {
  return options.map((option) => ({
    title: option,
    value: option,
    key: option,
  }));
}

function inferCooperationIntent(fieldTitle: string, label: string): CreatorFilterControlIntent {
  if (label === '短视频达人') return 'creatorType';
  if (label === '短剧演员') return 'shortDrama';
  if (label === '短直达人') return 'shortLive';
  if (label === '其它题材') return 'extraCreatorType';
  if (fieldTitle === '适配行业') return 'industry';
  if (label === '破圈种草') return 'grassSelection';
  if (fieldTitle === '营销目标') return 'goal';
  if (label === '八大人群') return 'eightAudience';
  if (fieldTitle === '合作对象') return 'collaborationObject';
  return 'resetAudienceMode';
}

function buildCooperationControlKey(fieldTitle: string, label: string) {
  return `${fieldTitle}:${label}`;
}

function resolveCooperationControl(filter: RawSemanticFilter, fieldTitle: string): CreatorFilterControlSchema {
  if (filter.title && filter.filters) {
    return {
      kind: 'subgroup',
      key: buildCooperationControlKey(fieldTitle, filter.title),
      label: filter.title,
      controls: filter.filters.map((item) => resolveCooperationControl(item, fieldTitle)),
    };
  }

  const spec = getFilterSpec(filter);
  if (!spec) {
    throw new Error(`Invalid cooperation filter in ${fieldTitle}`);
  }

  const intent = inferCooperationIntent(fieldTitle, spec.label);
  const key = buildCooperationControlKey(fieldTitle, spec.label);

  if (spec.selection === 'hierarchical') {
    const options = normalizeHierarchicalOptions(filter.选项);
    const treeData = options.some((option) => option.children?.length)
      ? buildTreeDataFromHierarchicalOptions(options)
      : buildTreeDataFromStringOptions(normalizeStringOptions(filter.选项));
    const isShortDrama = intent === 'shortDrama';

    return {
      kind: 'tree',
      key,
      label: spec.label,
      intent: intent as Extract<CreatorFilterControlSchema, { kind: 'tree' }>['intent'],
      groupValue: spec.label as CreatorTypeOption,
      treeData,
      allSelectedValues: isShortDrama ? options.map((option) => option.label) : undefined,
      minWidth: 120,
      maxWidth: isShortDrama ? 'min(420px, 100vw)' : undefined,
      maxHeight: isShortDrama ? 360 : 320,
      actionIndent: isShortDrama ? 54 : undefined,
      normalizeMode: isShortDrama ? 'shortDrama' : undefined,
      displayCountMode: isShortDrama ? 'shortDrama' : undefined,
    };
  }

  if (filter.选项 && ['extraCreatorType', 'grassSelection', 'eightAudience'].includes(intent)) {
    return {
      kind: 'dropdown',
      key,
      label: spec.label,
      intent: intent as Extract<CreatorFilterControlSchema, { kind: 'dropdown' }>['intent'],
      options: normalizeStringOptions(filter.选项),
      defaultLabel: spec.label,
    };
  }

  if (spec.selection === 'single' && intent === 'industry') {
    return {
      kind: 'popover',
      key,
      label: spec.label,
      intent: 'industry',
      options: normalizeStringOptions(filter.选项),
    };
  }

  return {
    kind: 'option',
    key,
    label: spec.label,
    intent: intent as Extract<CreatorFilterControlSchema, { kind: 'option' }>['intent'],
    value: spec.label,
  };
}

function resolveCooperationField(field: RawCooperationField): CreatorFilterFieldSchema {
  return {
    key: COOPERATION_FIELD_KEY_BY_TITLE[field.title] || field.title,
    label: field.title,
    contentClassName: field.title === '合作对象' ? 'xingtu-filter-line-content-match-grouped' : undefined,
    controls: field.filters.map((filter) => resolveCooperationControl(filter, field.title)),
  };
}

function createOptionPopoverGroup(group: RawSemanticGroup): OptionPopoverFilterGroup {
  if (typeof group === 'string') {
    const options = splitCompactList(group);

    return {
      key: ROOT_GROUP_KEY,
      mode: 'multi',
      options,
      showSelectAll: options.length > 1,
    };
  }

  const [label = ROOT_GROUP_KEY, value = ''] = Object.entries(group)[0] || [];
  const options = splitCompactList(value);

  return {
    key: label || ROOT_GROUP_KEY,
    label: label || undefined,
    mode: 'single',
    options,
  };
}

function createSingleRootGroup(options: string[]): OptionPopoverFilterGroup {
  return {
    key: ROOT_GROUP_KEY,
    mode: 'single',
    options,
  };
}

function createMultiRootGroup(options: string[]): OptionPopoverFilterGroup {
  return {
    key: ROOT_GROUP_KEY,
    mode: 'multi',
    options,
    showSelectAll: options.length > 1,
  };
}

function getMatchDisplayMode(filter: RawSemanticFilter): MatchPopoverFilterItem['displayMode'] {
  const spec = getFilterSpec(filter);
  return spec && SELECTED_DISPLAY_LABELS.has(spec.label) ? 'selected' : undefined;
}

function getRangeUnit(filter: RawSemanticFilter, label: string) {
  if (typeof filter.单位 === 'string') {
    return filter.单位;
  }
  if (['互动率', '完播率', '爆文率'].includes(label)) {
    return '%';
  }
  if (label === '达人报价') {
    return '元';
  }
  if (label === '预期播放量') {
    return 'w';
  }
  return '';
}

function resolveMatchFilterItem(filter: RawSemanticFilter): MatchInlineFilterItem {
  if (filter.任务数) {
    return {
      type: 'taskCount',
      label: filter.任务数,
      taskTimeGroup: createSingleRootGroup(splitCompactList(filter.任务时间选项)),
      minOptions: splitCompactList(filter.最低数量选项),
      maxOptions: splitCompactList(filter.最高数量选项),
    };
  }

  if (filter.报价) {
    const fields = normalizeFields(filter.字段);
    return {
      type: 'priceQuote',
      label: filter.报价,
      quoteTypeGroup: createSingleRootGroup(splitCompactList(filter.报价类型选项)),
      quoteRangeGroup: createSingleRootGroup(splitCompactList(filter.报价区间选项)),
      fields: fields.length ? fields : ['报价区间'],
      unit: getRangeUnit(filter, filter.报价),
      min: filter.最小值,
      max: filter.最大值,
    };
  }

  const spec = getFilterSpec(filter);
  if (!spec) {
    throw new Error('Invalid xingtu match filter');
  }

  if (spec.selection === 'range') {
    const fields = normalizeFields(filter.字段);
    return {
      type: 'range',
      label: spec.label,
      fields: fields.length ? fields : [spec.label],
      unit: getRangeUnit(filter, spec.label),
    };
  }

  const hasOptions = Boolean(filter.选项 || filter.分组?.length);

  if (spec.selection === 'single' && filter.字段) {
    const fields = normalizeFields(filter.字段);
    return {
      type: 'presetRange',
      label: spec.label,
      groups: [createSingleRootGroup(normalizeStringOptions(filter.选项))],
      fields: fields.length ? fields : [spec.label],
      unit: getRangeUnit(filter, spec.label),
      min: filter.最小值,
      max: filter.最大值,
      displayMode: getMatchDisplayMode(filter),
    };
  }

  if (!hasOptions && (spec.selection === 'reset' || spec.selection === 'toggle')) {
    return {
      type: 'tag',
      label: spec.label,
    };
  }

  const groups = filter.分组?.length
    ? filter.分组.map(createOptionPopoverGroup)
    : spec.selection === 'single'
      ? [createSingleRootGroup(normalizeStringOptions(filter.选项))]
      : [createMultiRootGroup(normalizeStringOptions(filter.选项))];

  return {
    type: 'popover',
    label: spec.label,
    groups,
    displayMode: getMatchDisplayMode(filter),
  };
}

function resolveMatchPopoverFilterItem(filter: RawSemanticFilter): MatchPopoverFilterItem {
  return resolveMatchFilterItem(filter) as MatchPopoverFilterItem;
}

function findCooperationFilter(predicate: (filter: RawSemanticFilter) => boolean) {
  const stack = [...COOPERATION_SECTION.data.flatMap((field) => field.filters)];

  while (stack.length) {
    const filter = stack.shift();
    if (!filter) {
      continue;
    }
    if (predicate(filter)) {
      return filter;
    }
    if (filter.filters) {
      stack.push(...filter.filters);
    }
  }

  return undefined;
}

function getCooperationOptions(intent: CreatorFilterControlIntent) {
  const labelByIntent: Partial<Record<CreatorFilterControlIntent, string>> = {
    industry: '适配行业',
    extraCreatorType: '其它题材',
    shortLive: '短直达人',
    grassSelection: '破圈种草',
    eightAudience: '八大人群',
  };
  const label = labelByIntent[intent];
  const filter = label ? findCooperationFilter((item) => getFilterSpec(item)?.label === label) : undefined;
  return filter ? normalizeStringOptions(filter.选项) : [];
}

export function normalizeShortDramaSelections(values: string[]) {
  const set = new Set(values.map(String));
  const normalized: string[] = [];

  for (const option of SHORT_DRAMA_OPTIONS) {
    const children = splitCompactList(option.children);

    if (!children.length) {
      if (set.has(option.label)) {
        normalized.push(option.label);
      }
      continue;
    }

    const childValues = children.map((child) => buildHierarchicalValue(option.label, child));
    if (set.has(option.label)) {
      normalized.push(option.label);
      continue;
    }

    const selectedChildValue = values
      .map(String)
      .filter((value) => childValues.includes(value) || children.includes(value))
      .at(-1);
    if (selectedChildValue) {
      const child = splitCompactList(selectedChildValue).length === 1 && !selectedChildValue.includes('/')
        ? selectedChildValue
        : selectedChildValue.split('/').pop() || selectedChildValue;
      normalized.push(buildHierarchicalValue(option.label, child));
    }
  }

  return normalized;
}

export function getShortDramaDisplayCount(values: string[]) {
  const normalized = normalizeShortDramaSelections(values);
  let count = 0;

  for (const value of normalized) {
    const option = SHORT_DRAMA_OPTIONS.find((item) => item.label === value);
    const children = splitCompactList(option?.children);
    if (children.length) {
      count += children.length;
      continue;
    }
    count += 1;
  }

  return count;
}

const COOPERATION_SECTION = getFilterSection('合作诉求');
const MATCH_CREATOR_TYPE_ITEM = getMatchDataItem('达人类型');
const MATCH_PERSONA_ITEM = getMatchDataItem('达人人设');
const MATCH_CONTENT_TOPIC_ITEM = getMatchDataItem('内容主题');
const MATCH_BACKGROUND_ITEM = getMatchDataItem('背景信息');
const MATCH_AUDIENCE_PROFILE_ITEM = getMatchDataItem('受众画像');
const COST_PERFORMANCE_SECTION = getFilterSection('性价比');
const TOPIC_RECOMMENDATION_SECTION = getFilterSection('主题推荐');
const MATCH_PERSONA_INDUSTRY_GROUP = MATCH_PERSONA_ITEM.groups.find((group) => group.title === '行业特色人设');
const MATCH_PERSONA_CAREER_GROUP = MATCH_PERSONA_ITEM.groups.find((group) => group.title === '职业爱好');
const MATCH_CONNECTED_USER_ITEM = MATCH_AUDIENCE_PROFILE_ITEM.filters.find((filter) => getFilterSpec(filter)?.selection === 'range');
const MATCH_FOLLOWER_COUNT_ITEM = MATCH_AUDIENCE_PROFILE_ITEM.filters.find((filter) => getFilterSpec(filter)?.label === '粉丝数量');

if (!MATCH_PERSONA_INDUSTRY_GROUP || !MATCH_PERSONA_CAREER_GROUP || !MATCH_CONNECTED_USER_ITEM || !MATCH_FOLLOWER_COUNT_ITEM) {
  throw new Error('Invalid xingtu match filter schema');
}

const COOPERATION_FIELDS = COOPERATION_SECTION.data.map(resolveCooperationField);

export const COOPERATION_SECTION_LINES: CreatorFilterLineSchema[] = [
  {
    key: 'cooperation-primary',
    fields: COOPERATION_FIELDS.filter((field) => field.key === 'collaboration-object'),
  },
  {
    key: 'cooperation-secondary',
    fields: COOPERATION_FIELDS.filter((field) => field.key !== 'collaboration-object'),
  },
];

export const INDUSTRY_OPTIONS = getCooperationOptions('industry');

export const EXTRA_CREATOR_TYPE_OPTIONS = getCooperationOptions('extraCreatorType');

export const SHORT_DRAMA_OPTIONS = normalizeHierarchicalOptions(
  findCooperationFilter((filter) => getFilterSpec(filter)?.label === '短剧演员')?.选项,
);

export const SHORT_DRAMA_TREE_DATA = buildTreeDataFromHierarchicalOptions(SHORT_DRAMA_OPTIONS);

export const SHORT_DRAMA_ALL_VALUES = SHORT_DRAMA_OPTIONS.map((option) => option.label);

export const SHORT_LIVE_OPTIONS = getCooperationOptions('shortLive');

export const SHORT_LIVE_TREE_DATA = buildTreeDataFromStringOptions(SHORT_LIVE_OPTIONS);

export const GRASS_PLANTING_OPTIONS = getCooperationOptions('grassSelection');

export const EIGHT_AUDIENCE_OPTIONS = getCooperationOptions('eightAudience');

export const MATCH_CREATOR_TYPE_FILTERS = MATCH_CREATOR_TYPE_ITEM.filters.map(resolveMatchFilterItem);

export const MATCH_PERSONA_INDUSTRY_FILTERS = MATCH_PERSONA_INDUSTRY_GROUP.filters.map(resolveMatchPopoverFilterItem);

export const MATCH_PERSONA_CAREER_FILTER = resolveMatchPopoverFilterItem(MATCH_PERSONA_CAREER_GROUP.filters[0]);

export const MATCH_PERSONA_HOBBY_FILTER = resolveMatchPopoverFilterItem(MATCH_PERSONA_CAREER_GROUP.filters[1]);

export const MATCH_PERSONA_TONE_FILTER = resolveMatchPopoverFilterItem(MATCH_PERSONA_CAREER_GROUP.filters[2]);

export const MATCH_PERSONA_CHARACTER_FILTER = resolveMatchPopoverFilterItem(MATCH_PERSONA_CAREER_GROUP.filters[3]);

export const MATCH_CONTENT_TOPIC_FILTERS = MATCH_CONTENT_TOPIC_ITEM.filters.map(resolveMatchFilterItem);

export const COST_PERFORMANCE_FILTERS = COST_PERFORMANCE_SECTION.data.map((item) => ({
  title: item.title,
  filters: item.filters.map(resolveMatchFilterItem),
}));

export const TOPIC_RECOMMENDATION_FILTER_GROUPS = TOPIC_RECOMMENDATION_SECTION.data.map((item) => ({
  title: item.title,
  filters: item.filters.map(resolveMatchFilterItem),
}));

export const TOPIC_RECOMMENDATION_FILTERS = TOPIC_RECOMMENDATION_FILTER_GROUPS.flatMap((group) => group.filters);

export const MATCH_BACKGROUND_FILTERS = MATCH_BACKGROUND_ITEM.filters.map(resolveMatchPopoverFilterItem);

export const MATCH_FOLLOWER_COUNT_FILTER = resolveMatchPopoverFilterItem(MATCH_FOLLOWER_COUNT_ITEM);

export function createAudienceProfileGroups(prefix: '观众' | '粉丝'): OptionPopoverFilterGroup[] {
  const filter = MATCH_AUDIENCE_PROFILE_ITEM.filters.find((item) => getFilterSpec(item)?.label === `${prefix}画像`);
  return filter?.分组?.map(createOptionPopoverGroup) || [];
}

export const MATCH_CONNECTED_USER_FIELDS = splitCompactList(MATCH_CONNECTED_USER_ITEM.字段);
