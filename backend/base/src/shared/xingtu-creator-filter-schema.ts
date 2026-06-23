import schemaData from './xingtu-creator-filter-schema.json' with { type: 'json' };

export type XingtuHierarchicalFilterOption = {
  label: string;
  children?: string[];
};

type RawSemanticFilter = {
  title?: string;
  filters?: RawSemanticFilter[];
  单选?: string;
  多选?: string;
  分级?: string;
  分组单选?: string;
  分组多选?: string;
  范围?: string;
  重置?: string;
  开关?: string;
  选项?: string | Array<string | XingtuHierarchicalFilterOption | RawSemanticFilter>;
  分组?: Array<string | Record<string, string>>;
};

type RawSection = {
  title: string;
  data: unknown[];
};

export const XINGTU_CREATOR_FILTER_SCHEMA = schemaData as RawSection[];

function cleanText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitCompactList(value: unknown) {
  const text = cleanText(value);
  return text ? text.split(/[,，]/).map(cleanText).filter(Boolean) : [];
}

function getFilterLabel(filter: RawSemanticFilter) {
  return cleanText(
    filter.单选
    || filter.多选
    || filter.分级
    || filter.分组单选
    || filter.分组多选
    || filter.范围
    || filter.重置
    || filter.开关
    || filter.title
    || '',
  );
}

function walkFilters(node: unknown, visitor: (filter: RawSemanticFilter) => void) {
  if (Array.isArray(node)) {
    node.forEach((item) => walkFilters(item, visitor));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }

  const filter = node as RawSemanticFilter & { data?: unknown[]; groups?: unknown[] };
  visitor(filter);
  walkFilters(filter.filters, visitor);
  walkFilters(filter.data, visitor);
  walkFilters(filter.groups, visitor);
}

function findFilterByLabel(label: string) {
  let matched: RawSemanticFilter | undefined;
  walkFilters(XINGTU_CREATOR_FILTER_SCHEMA, (filter) => {
    if (!matched && getFilterLabel(filter) === label) {
      matched = filter;
    }
  });
  return matched;
}

function normalizeStringOptions(options: RawSemanticFilter['选项']): string[] {
  if (typeof options === 'string') {
    return splitCompactList(options);
  }
  if (!Array.isArray(options)) {
    return [];
  }
  return options.map((item) => (
    typeof item === 'string' ? cleanText(item) : cleanText((item as XingtuHierarchicalFilterOption).label || getFilterLabel(item as RawSemanticFilter))
  )).filter(Boolean);
}

function parseHierarchicalOptions(options: RawSemanticFilter['选项']): XingtuHierarchicalFilterOption[] {
  if (typeof options === 'string') {
    return options.split(/[;；]/).map((item) => {
      const [label, children] = item.split(':');
      return {
        label: cleanText(label),
        children: splitCompactList(children),
      };
    }).filter((item) => item.label);
  }

  if (!Array.isArray(options)) {
    return [];
  }

  return options.map((item) => {
    if (typeof item === 'string') {
      return { label: cleanText(item) };
    }
    const option = item as XingtuHierarchicalFilterOption;
    return {
      label: cleanText(option.label),
      children: Array.isArray(option.children) ? option.children.map(cleanText).filter(Boolean) : undefined,
    };
  }).filter((item) => item.label);
}

function getOptions(label: string) {
  return normalizeStringOptions(findFilterByLabel(label)?.选项);
}

export function buildXingtuHierarchicalValue(parent: string, child?: string) {
  return child ? `${parent}/${child}` : parent;
}

export const XINGTU_INDUSTRY_OPTIONS = getOptions('适配行业');

export const XINGTU_EXTRA_CREATOR_TYPE_OPTIONS = getOptions('其它题材');

export const XINGTU_SHORT_DRAMA_OPTIONS = parseHierarchicalOptions(findFilterByLabel('短剧演员')?.选项);

export const XINGTU_SHORT_DRAMA_ALL_VALUES = XINGTU_SHORT_DRAMA_OPTIONS.map((option) => option.label);

export const XINGTU_SHORT_DRAMA_UI_OPTIONS = XINGTU_SHORT_DRAMA_OPTIONS.flatMap((option) => (
  option.children?.length
    ? [option.label, ...option.children.map((child) => buildXingtuHierarchicalValue(option.label, child))]
    : [option.label]
));

export const XINGTU_SHORT_LIVE_OPTIONS = getOptions('短直达人');

export const XINGTU_GRASS_PLANTING_OPTIONS = getOptions('破圈种草');

export const XINGTU_EIGHT_AUDIENCE_OPTIONS = getOptions('八大人群');

export function normalizeXingtuShortDramaSelections(values: string[]) {
  const set = new Set(values.map(String));
  const normalized: string[] = [];

  for (const option of XINGTU_SHORT_DRAMA_OPTIONS) {
    if (!option.children?.length) {
      if (set.has(option.label)) {
        normalized.push(option.label);
      }
      continue;
    }

    const childValues = option.children.map((child) => buildXingtuHierarchicalValue(option.label, child));
    if (set.has(option.label) || childValues.every((value) => set.has(value))) {
      normalized.push(option.label);
      continue;
    }

    normalized.push(...childValues.filter((value) => set.has(value)));
  }

  return normalized;
}

export function getXingtuShortDramaDisplayCount(values: string[]) {
  const normalized = normalizeXingtuShortDramaSelections(values);
  let count = 0;

  for (const value of normalized) {
    const option = XINGTU_SHORT_DRAMA_OPTIONS.find((item) => item.label === value);
    if (option?.children?.length) {
      count += option.children.length;
      continue;
    }
    count += 1;
  }

  return count;
}
