'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { throwIfAborted, withAbort } = require('../../core/abort');
const { extractColumnLayoutTable } = require('../../core/column-layout-table');
const { isLoginUrl } = require('./auth');

function loadCreatorFilterSchema() {
  let currentDir = __dirname;

  while (currentDir && currentDir !== path.dirname(currentDir)) {
    const candidate = path.join(currentDir, 'backend/base/src/shared/xingtu-creator-filter-schema.json');
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
    currentDir = path.dirname(currentDir);
  }

  throw new Error('Cannot find backend/base/src/shared/xingtu-creator-filter-schema.json from Electron runtime');
}

const creatorFilterSchema = loadCreatorFilterSchema();

const MARKET_URL = 'https://www.xingtu.cn/ad/creator/market';

function findSchemaFilterByLabel(schema, label) {
  const stack = Array.isArray(schema) ? [...schema] : [];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    const filterLabel = normalizeText(
      current['单选']
      || current['多选']
      || current['分级']
      || current['分组单选']
      || current['分组多选']
      || current['范围']
      || current['重置']
      || current['开关']
      || current.title
      || '',
    );
    if (filterLabel === label) {
      return current;
    }
    for (const key of ['filters', 'data', 'groups']) {
      if (Array.isArray(current[key])) {
        stack.push(...current[key]);
      }
    }
  }
  return null;
}

function splitCompactList(value) {
  return normalizeText(value).split(/[,，]/).map(normalizeText).filter(Boolean);
}

function parseHierarchicalOptions(options) {
  if (typeof options === 'string') {
    return options.split(/[;；]/).map((item) => {
      const [label, children] = item.split(':');
      return {
        label: normalizeText(label),
        children: splitCompactList(children),
      };
    }).filter((item) => item.label);
  }
  if (!Array.isArray(options)) {
    return [];
  }
  return options.map((option) => (
    typeof option === 'string'
      ? { label: normalizeText(option) }
      : {
        label: normalizeText(option.label),
        children: Array.isArray(option.children) ? option.children.map(normalizeText).filter(Boolean) : undefined,
      }
  )).filter((option) => option.label);
}

function getSchemaStringOptions(schema, label, legacyKey) {
  if (Array.isArray(schema?.[legacyKey])) {
    return schema[legacyKey].map(normalizeText).filter(Boolean);
  }
  const filter = findSchemaFilterByLabel(schema, label);
  return splitCompactList(filter?.['选项']);
}

function getSchemaHierarchicalOptions(schema, label, legacyKey) {
  if (Array.isArray(schema?.[legacyKey])) {
    return schema[legacyKey].map((option) => ({
      label: normalizeText(option.label),
      children: Array.isArray(option.children) ? option.children.map(normalizeText).filter(Boolean) : undefined,
    })).filter((option) => option.label);
  }
  return parseHierarchicalOptions(findSchemaFilterByLabel(schema, label)?.['选项']);
}

const SHORT_DRAMA_OPTIONS = getSchemaHierarchicalOptions(creatorFilterSchema, '短剧演员', 'shortDramaOptions').map((option) => ({
  label: option.label,
  children: Array.isArray(option.children) ? [...option.children] : undefined,
}));
const SHORT_LIVE_OPTIONS = getSchemaStringOptions(creatorFilterSchema, '短直达人', 'shortLiveOptions').map((label) => ({ label }));
const CREATOR_TOPIC_TYPES = ['短视频达人', '短剧演员', '短直达人', '其它题材'];
const COST_PERFORMANCE_PRESET_SINGLE_LABELS = new Set(['预期播放量', '预期CPM', '预期CPE', '互动率', '完播率', '爆文率']);

function isCreatorMarketUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://www.xingtu.cn' && parsed.pathname === '/ad/creator/market';
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeIndustryLabel(value) {
  const normalized = normalizeText(value);
  if (normalized === '美妆个护') {
    return '美妆';
  }
  if (normalized === '母婴') {
    return '母婴宠物';
  }
  return normalized;
}

function normalizeRegionOptionLabel(value) {
  const normalized = normalizeText(value);
  if (normalized === '北京') {
    return '北京市';
  }
  if (normalized === '上海') {
    return '上海市';
  }
  return normalized;
}

function normalizeSearchMode(value) {
  return normalizeText(value) === 'nickname' ? 'nickname' : 'content';
}

function normalizePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map(normalizeText).filter(Boolean);
}

function normalizeOptionPopoverValue(value, normalizeOption = normalizeText) {
  if (typeof value === 'string') {
    const normalized = normalizeText(normalizeOption(value));
    return normalized ? { default: [normalized] } : {};
  }

  if (Array.isArray(value)) {
    const normalized = normalizeArray(value.map((item) => normalizeOption(item)));
    return normalized.length ? { default: normalized } : {};
  }

  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(source).map(([key, options]) => [key, normalizeArray(normalizeArray(options).map((item) => normalizeOption(item)))]),
  );
}

function normalizeMatchPopoverSelectionMap(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, normalizeOptionPopoverValue(item)]),
  );
}

function normalizeRangePopoverValue(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(source).map(([key, field]) => {
      const current = field && typeof field === 'object' ? field : {};
      return [key, {
        min: normalizeText(current.min || ''),
        max: normalizeText(current.max || ''),
      }];
    }),
  );
}

function normalizeMatchFilters(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    creatorTypeTags: normalizeArray(source.creatorTypeTags),
    creatorTypeSelections: normalizeMatchPopoverSelectionMap(source.creatorTypeSelections),
    contentTopicSelections: normalizeMatchPopoverSelectionMap(source.contentTopicSelections),
    personaIndustrySelections: normalizeMatchPopoverSelectionMap(source.personaIndustrySelections),
    personaCareer: normalizeOptionPopoverValue(source.personaCareer),
    personaHobby: normalizeOptionPopoverValue(source.personaHobby),
    personaTone: normalizeOptionPopoverValue(source.personaTone),
    personaCharacter: normalizeOptionPopoverValue(source.personaCharacter),
    gender: normalizeOptionPopoverValue(source.gender),
    region: normalizeOptionPopoverValue(source.region, normalizeRegionOptionLabel),
    education: normalizeOptionPopoverValue(source.education),
    yellowV: normalizeOptionPopoverValue(source.yellowV),
    connectedUsers: normalizeRangePopoverValue(source.connectedUsers),
    followers: normalizeOptionPopoverValue(source.followers),
    viewerProfile: normalizeOptionPopoverValue(source.viewerProfile),
    fanProfile: normalizeOptionPopoverValue(source.fanProfile),
  };
}

function normalizeRangeSelectionMap(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, normalizeRangePopoverValue(item)]),
  );
}

function normalizePriceQuoteFilter(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    quoteType: normalizeOptionPopoverValue(source.quoteType),
    quoteRange: normalizeOptionPopoverValue(source.quoteRange),
    customRange: normalizeRangePopoverValue(source.customRange),
  };
}

function normalizeTaskCountFilter(value) {
  const source = value && typeof value === 'object' ? value : {};
  const taskCount = source.taskCount && typeof source.taskCount === 'object' ? source.taskCount : {};
  return {
    taskTime: normalizeOptionPopoverValue(source.taskTime),
    taskCount: {
      min: normalizeText(taskCount.min || ''),
      max: normalizeText(taskCount.max || ''),
    },
  };
}

function hydratePriceQuoteFilterFromMatchSelections(priceQuote, matchSelections) {
  const nextValue = normalizePriceQuoteFilter(priceQuote);
  const quoteTypeSelected = countOptionPopoverSelections(nextValue.quoteType) > 0;
  const quoteRangeSelected = countOptionPopoverSelections(nextValue.quoteRange) > 0;
  const customRangeSelected = countRangeSelections(nextValue.customRange) > 0;

  for (const token of normalizeArray(matchSelections)) {
    const parts = token.split('/').map(normalizeText).filter(Boolean);
    const priceIndex = parts.indexOf('达人报价');
    if (priceIndex < 0) {
      continue;
    }

    const kind = parts[priceIndex + 1] || '';
    const value = parts.slice(priceIndex + 2).join('/') || parts[priceIndex + 1] || '';
    if (kind === '报价类型' && value && !quoteTypeSelected) {
      nextValue.quoteType = { __root__: [value] };
      continue;
    }

    if (kind === '报价区间' && value && !quoteRangeSelected && !customRangeSelected) {
      const rangeValue = parts[priceIndex + 3] || '';
      if (value === '报价区间' && rangeValue.includes('~')) {
        const [min = '', max = ''] = rangeValue.split('~');
        nextValue.customRange = {
          报价区间: {
            min: min === '-' ? '' : min,
            max: max === '-' ? '' : max,
          },
        };
        continue;
      }
      nextValue.quoteRange = { __root__: [value] };
      continue;
    }

    if (!kind || kind === '全部') {
      continue;
    }

    if (!quoteRangeSelected && !customRangeSelected) {
      nextValue.quoteRange = { __root__: [kind] };
    }
  }

  return nextValue;
}

function flattenOptionPopoverSelections(value) {
  return Object.values(value || {}).flatMap((options) => normalizeArray(options));
}

function flattenSingleOptionPerGroupSelections(value) {
  return Object.values(value || {})
    .map((options) => normalizeArray(options).at(-1))
    .filter(Boolean);
}

function countOptionPopoverSelections(value) {
  return flattenOptionPopoverSelections(value).length;
}

function countRangeSelections(value) {
  return Object.values(value || {}).filter((field) => {
    const min = normalizeText(field && field.min);
    const max = normalizeText(field && field.max);
    return Boolean(min || max);
  }).length;
}

function countPriceQuoteSelections(value) {
  const source = value && typeof value === 'object' ? value : {};
  return countOptionPopoverSelections(source.quoteType)
    + countOptionPopoverSelections(source.quoteRange)
    + countRangeSelections(source.customRange);
}

function countTaskCountSelections(value) {
  const source = value && typeof value === 'object' ? value : {};
  const taskCount = source.taskCount && typeof source.taskCount === 'object' ? source.taskCount : {};
  return countOptionPopoverSelections(source.taskTime)
    + (normalizeText(taskCount.min || '') || normalizeText(taskCount.max || '') ? 1 : 0);
}

function hasActiveMatchFilters(value) {
  const filters = value && typeof value === 'object' ? value : {};
  return normalizeArray(filters.creatorTypeTags).some((label) => label !== '不限')
    || Object.values(filters.creatorTypeSelections || {}).some((item) => countOptionPopoverSelections(item) > 0)
    || Object.values(filters.contentTopicSelections || {}).some((item) => countOptionPopoverSelections(item) > 0)
    || Object.values(filters.personaIndustrySelections || {}).some((item) => countOptionPopoverSelections(item) > 0)
    || countOptionPopoverSelections(filters.personaCareer) > 0
    || countOptionPopoverSelections(filters.personaHobby) > 0
    || countOptionPopoverSelections(filters.personaTone) > 0
    || countOptionPopoverSelections(filters.personaCharacter) > 0
    || countOptionPopoverSelections(filters.gender) > 0
    || countOptionPopoverSelections(filters.region) > 0
    || countOptionPopoverSelections(filters.education) > 0
    || countOptionPopoverSelections(filters.yellowV) > 0
    || countRangeSelections(filters.connectedUsers) > 0
    || countOptionPopoverSelections(filters.followers) > 0
    || countOptionPopoverSelections(filters.viewerProfile) > 0
    || countOptionPopoverSelections(filters.fanProfile) > 0;
}

function hasActiveCostPerformanceFilters(filters) {
  return Object.values(filters.costPerformanceSelections || {}).some((item) => countOptionPopoverSelections(item) > 0)
    || Object.values(filters.costPerformanceRanges || {}).some((item) => countRangeSelections(item) > 0)
    || countPriceQuoteSelections(filters.costPerformancePriceQuote) > 0
    || countTaskCountSelections(filters.costPerformanceTaskCount) > 0;
}

function buildHierarchicalValue(parent, child) {
  return child ? `${parent}/${child}` : parent;
}

function splitHierarchicalValue(value) {
  const parts = normalizeText(value).split('/').map(normalizeText).filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return {
    parent: parts[0],
    child: parts.slice(1).join('/'),
  };
}

function normalizeCascaderSelections(values, options) {
  const set = new Set(normalizeArray(values));
  const normalized = [];

  for (const option of options) {
    if (!option.children?.length) {
      if (set.has(option.label)) {
        normalized.push(option.label);
      }
      continue;
    }

    const selectedChildren = option.children.filter((child) => set.has(child) || set.has(buildHierarchicalValue(option.label, child)));
    if (set.has(option.label) || selectedChildren.length === option.children.length) {
      normalized.push(option.label);
      continue;
    }

    normalized.push(...selectedChildren.map((child) => buildHierarchicalValue(option.label, child)));
  }

  return normalized;
}

function expandCascaderSelections(values, options) {
  const expanded = [];

  for (const value of normalizeCascaderSelections(values, options)) {
    const option = options.find((item) => item.label === value);
    if (option?.children?.length) {
      expanded.push(...option.children.map((child) => buildHierarchicalValue(option.label, child)));
      continue;
    }
    expanded.push(value);
  }

  return expanded;
}

function toExecutableCascaderSelections(values, options) {
  const source = normalizeArray(values);
  const consumed = new Set();
  const executable = [];

  for (const option of options) {
    if (!option.children?.length) {
      if (source.includes(option.label)) {
        executable.push(option.label);
        consumed.add(option.label);
      }
      continue;
    }

    let selectedChild = '';
    for (const rawValue of source) {
      const hierarchical = splitHierarchicalValue(rawValue);
      if (rawValue === option.label) {
        selectedChild = option.children[0] || '';
        consumed.add(rawValue);
        continue;
      }
      if (hierarchical?.parent === option.label && option.children.includes(hierarchical.child)) {
        selectedChild = hierarchical.child;
        consumed.add(rawValue);
        continue;
      }
      if (option.children.includes(rawValue)) {
        selectedChild = rawValue;
        consumed.add(rawValue);
      }
    }

    if (selectedChild) {
      executable.push(buildHierarchicalValue(option.label, selectedChild));
    }
  }

  for (const rawValue of source) {
    if (!consumed.has(rawValue)) {
      executable.push(rawValue);
    }
  }

  return executable;
}

function findCascaderNodeByLabel(options, label) {
  for (const option of options) {
    if (option.label === label) {
      return option;
    }
    if (!option.children?.length) {
      continue;
    }
    for (const child of option.children) {
      if (child === label) {
        return {
          label: child,
        };
      }
    }
  }
  return null;
}

function normalizeCreatorTopicFilters(source) {
  const creatorTypes = normalizeArray(source.creatorTypes)
    .filter((value) => CREATOR_TOPIC_TYPES.includes(value));
  const shortDramaSelections = toExecutableCascaderSelections(source.shortDramaSelections, SHORT_DRAMA_OPTIONS);
  const shortLiveSelections = toExecutableCascaderSelections(source.shortLiveSelections, SHORT_LIVE_OPTIONS);
  const extraCreatorTypes = normalizeArray(source.extraCreatorTypes);
  const selectedCreatorType = shortDramaSelections.length > 0
    ? '短剧演员'
    : shortLiveSelections.length > 0
      ? '短直达人'
      : extraCreatorTypes.length > 0
        ? '其它题材'
        : creatorTypes.at(-1) || '';

  return {
    creatorTypes: selectedCreatorType ? [selectedCreatorType] : [],
    shortDramaSelections: selectedCreatorType === '短剧演员' ? shortDramaSelections : [],
    shortLiveSelections: selectedCreatorType === '短直达人' ? shortLiveSelections : [],
    extraCreatorTypes: selectedCreatorType === '其它题材' ? extraCreatorTypes.slice(0, 1) : [],
  };
}

function normalizeFilters(filters) {
  const source = filters && typeof filters === 'object' ? filters : {};
  const creatorTopicFilters = normalizeCreatorTopicFilters(source);
  const matchSelections = normalizeArray(source.matchSelections);
  const costPerformanceSelections = normalizeMatchPopoverSelectionMap(source.costPerformanceSelections);
  const costPerformanceRanges = normalizeRangeSelectionMap(source.costPerformanceRanges);
  const costPerformancePriceQuote = hydratePriceQuoteFilterFromMatchSelections(source.costPerformancePriceQuote, matchSelections);
  const costPerformanceTaskCount = normalizeTaskCountFilter(source.costPerformanceTaskCount);
  if (countOptionPopoverSelections(costPerformancePriceQuote.quoteRange) === 0 && countOptionPopoverSelections(costPerformanceSelections.达人报价) > 0) {
    costPerformancePriceQuote.quoteRange = costPerformanceSelections.达人报价;
  }
  delete costPerformanceSelections.达人报价;
  if (countTaskCountSelections(costPerformanceTaskCount) === 0 && countRangeSelections(costPerformanceRanges.进行中的任务数) > 0) {
    const legacyTaskCount = costPerformanceRanges.进行中的任务数.任务数量 || {};
    costPerformanceTaskCount.taskCount = {
      min: normalizeText(legacyTaskCount.min || ''),
      max: normalizeText(legacyTaskCount.max || ''),
    };
  }
  delete costPerformanceRanges.进行中的任务数;

  return {
    collaborationObject: normalizeText(source.collaborationObject || '不限'),
    creatorTypes: creatorTopicFilters.creatorTypes,
    shortDramaSelections: creatorTopicFilters.shortDramaSelections,
    shortLiveSelections: creatorTopicFilters.shortLiveSelections,
    extraCreatorTypes: creatorTopicFilters.extraCreatorTypes,
    industry: normalizeIndustryLabel(source.industry || '不限'),
    goals: normalizeArray(source.goals),
    grassSelections: normalizeArray(source.grassSelections),
    audienceMode: normalizeText(source.audienceMode || '不限'),
    audienceLabels: normalizeArray(source.audienceLabels),
    matchSelections,
    matchFilters: normalizeMatchFilters(source.matchFilters),
    costPerformanceSelections,
    costPerformanceRanges,
    costPerformancePriceQuote,
    costPerformanceTaskCount,
    topicRecommendationSelections: normalizeMatchPopoverSelectionMap(source.topicRecommendationSelections),
    topicRecommendationTags: normalizeArray(source.topicRecommendationTags),
  };
}

async function waitForCooperationFilters(page) {
  await page.locator('tr.filter-list-group').first().waitFor({ state: 'visible', timeout: 12000 });
}

function cooperationRow(page) {
  return page.locator('tr.filter-list-group').first();
}

async function isLocatorSelected(locator) {
  if (!await locator.isVisible().catch(() => false)) {
    return false;
  }
  return locator.evaluate((element) => {
    function hasSelectedState(node) {
      const ariaChecked = node.getAttribute && node.getAttribute('aria-checked');
      const ariaPressed = node.getAttribute && node.getAttribute('aria-pressed');
      const tokens = new Set([
        ...Array.from(node.classList || []),
        ...String(node.className || '').split(/\s+/).filter(Boolean),
      ]);
      return tokens.has('basic-market-highlight-text')
        || tokens.has('selected')
        || tokens.has('checked')
        || tokens.has('is-selected')
        || tokens.has('is-checked')
        || tokens.has('is-active')
        || ariaChecked === 'true'
        || ariaPressed === 'true';
    }

    if ([element, ...Array.from(element.querySelectorAll('*'))].some(hasSelectedState)) {
      return true;
    }

    let current = element;
    while (current) {
      if (hasSelectedState(current)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }).catch(() => false);
}

async function clickIfNeeded(locator, desiredSelected = true) {
  if (!await locator.isVisible().catch(() => false)) {
    return false;
  }
  const selected = await isLocatorSelected(locator);
  if (selected === desiredSelected) {
    return true;
  }
  await locator.click();
  return true;
}

async function readTriggerSelectionMeta(locator, label) {
  const normalizedLabel = normalizeText(label);
  return locator.evaluate((element, expectedLabel) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    const nodes = [element, ...Array.from(element.querySelectorAll('*'))];
    const highlighted = nodes.some((node) => {
      const tokens = new Set([
        ...Array.from(node.classList || []),
        ...String(node.className || '').split(/\s+/).filter(Boolean),
      ]);
      return tokens.has('basic-market-highlight-text');
    });

    const text = clean(element.innerText || element.textContent || '');
    const compactText = text.replace(/\s+/g, '');
    const compactLabel = clean(expectedLabel).replace(/\s+/g, '');
    const countMatch = compactText.match(/·(\d+)$/);
    const count = countMatch ? Number.parseInt(countMatch[1], 10) : 0;

    return {
      text,
      compactText,
      highlighted,
      hasLabel: compactText.includes(compactLabel),
      count: Number.isFinite(count) ? count : 0,
    };
  }, normalizedLabel).catch(() => ({
    text: '',
    compactText: '',
    highlighted: false,
    hasLabel: false,
    count: 0,
  }));
}

async function assertCascaderTriggerSelected(triggerLocator, label, expectedCount, options = {}) {
  const meta = await readTriggerSelectionMeta(triggerLocator, label);
  if (!meta.hasLabel) {
    throw new Error(`级联筛选触发器文案异常: ${label}，当前="${meta.text || ''}"`);
  }
  if (!options.skipHighlight && !meta.highlighted) {
    throw new Error(`级联筛选触发器未高亮: ${label}，当前="${meta.text || ''}"`);
  }
  if (meta.count !== expectedCount) {
    throw new Error(`级联筛选触发器数量异常: ${label}，期望=${expectedCount}，实际=${meta.count}，当前="${meta.text || ''}"`);
  }
}

async function findVisibleFilterTrigger(page, label) {
  const exactText = normalizeText(label);
  const selectors = [
    '.xt-dropdown.star-select.el-dropdown',
    '.xt-dropdown.base-market-dropdown.el-dropdown',
    '.xt-dropdown.basic-market-select-label.el-dropdown',
    '.star-select.el-dropdown',
    '.select-item.el-dropdown',
    '.xt-dropdown.el-dropdown',
    '.base-market-dropdown.el-dropdown',
    '.market-package-select.new.use-design-element',
    '.market-package-select',
    '.basic-market-select-label',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).filter({ hasText: exactText });
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }
      return candidate;
    }
  }

  return null;
}

async function findVisibleTagFilter(page, label) {
  const exactText = normalizeText(label);
  const selectors = [
    'label.el-checkbox',
    '.checkbox-title',
    '.basic-market-select-label',
    '.market-package-select',
    '.market-filter-select-label',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).filter({ hasText: exactText });
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }
      const text = normalizeText(await candidate.innerText().catch(() => ''));
      if (!text.includes(exactText)) {
        continue;
      }
      return candidate;
    }
  }

  return null;
}

async function findThemeRecommendationTagFilter(page, label) {
  const exactText = normalizeText(label);
  const row = page.locator('tr.filter-list-group').filter({ hasText: '主题推荐' }).first();
  const selectors = [
    'label.el-checkbox',
    '.checkbox-title',
    '.checkbox-item',
  ];

  for (const selector of selectors) {
    const locator = row.locator(selector).filter({ hasText: exactText });
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }
      const text = normalizeText(await candidate.innerText().catch(() => ''));
      if (text === exactText || text.includes(exactText)) {
        return candidate;
      }
    }
  }

  return null;
}

async function findThemeRecommendationDropdown(page, label) {
  const exactText = normalizeText(label);
  const row = page.locator('tr.filter-list-group').filter({ hasText: '主题推荐' }).first();
  const selectors = [
    '.xt-dropdown.base-market-dropdown.el-dropdown',
    '.base-market-dropdown.el-dropdown',
    '.xt-dropdown.el-dropdown',
  ];

  for (const selector of selectors) {
    const locator = row.locator(selector).filter({ hasText: exactText });
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }
      return candidate;
    }
  }

  return null;
}

async function assertCountedTriggerSelected(page, label, expectedCount, options = {}) {
  const trigger = await findVisibleFilterTrigger(page, label);
  if (!trigger) {
    throw new Error(`未找到筛选触发器: ${label}`);
  }
  await assertCascaderTriggerSelected(trigger, label, expectedCount, options);
}

async function clickVisibleExactText(page, text, selectors) {
  const exactText = normalizeText(text);
  const scopes = Array.isArray(selectors) && selectors.length
    ? selectors
    : ['.el-popper', '.el-select-dropdown', '.el-dropdown-menu', '.el-popover', '.xt-select-dropdown', '.xt-dropdown-menu', 'body'];

  for (const selector of scopes) {
    const scope = selector === 'body' ? page.locator('body') : page.locator(selector);
    const candidates = scope.getByText(exactText, { exact: true });
    const count = await candidates.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }
      await candidate.click();
      return true;
    }
  }

  return false;
}

async function isPopupOptionSelected(locator) {
  if (!await locator.isVisible().catch(() => false)) {
    return false;
  }
  return locator.evaluate((element) => {
    let current = element;
    while (current) {
      const ariaChecked = current.getAttribute && current.getAttribute('aria-checked');
      const tokens = new Set([
        ...Array.from(current.classList || []),
        ...String(current.className || '').split(/\s+/).filter(Boolean),
      ]);
      if (
        tokens.has('selected')
        || tokens.has('checked')
        || tokens.has('is-selected')
        || tokens.has('is-checked')
        || tokens.has('is-active')
        || ariaChecked === 'true'
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }).catch(() => false);
}

async function findVisibleCascaderOption(page, text) {
  const exactText = normalizeText(text);
  const rows = page.locator('.xt-cascader-option');
  const count = await rows.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if (!await row.isVisible().catch(() => false)) {
      continue;
    }
    const rowText = normalizeText(await row.innerText().catch(() => ''));
    if (rowText !== exactText) {
      continue;
    }
    return row;
  }

  return null;
}

async function activateCascaderBranch(page, text, log, label) {
  const row = await findVisibleCascaderOption(page, text);
  if (!row) {
    log.warn(`未找到级联父级选项: ${label} -> ${normalizeText(text)}`);
    return false;
  }
  await row.click({ force: true });
  await page.waitForTimeout(220);
  return true;
}

async function clickVisibleCascaderOption(page, text, log, label, mode = 'checkbox') {
  const row = await findVisibleCascaderOption(page, text);
  if (!row) {
    throw new Error(`未找到级联选项: ${label} -> ${normalizeText(text)}`);
  }
  if (mode === 'activate') {
    await row.click({ force: true });
    await page.waitForTimeout(180);
    return true;
  }
  if (await isPopupOptionSelected(row)) {
    return true;
  }

  const checkbox = row.locator('.el-checkbox__input').first();
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.click({ force: true });
    await page.waitForTimeout(180);
    if (!await isPopupOptionSelected(row)) {
      throw new Error(`级联选项点击后未选中: ${label} -> ${normalizeText(text)}`);
    }
    return true;
  }

  const original = row.locator('.el-checkbox__original').first();
  if (await original.isVisible().catch(() => false)) {
    await original.click({ force: true });
    await page.waitForTimeout(180);
    if (!await isPopupOptionSelected(row)) {
      throw new Error(`级联选项点击后未选中: ${label} -> ${normalizeText(text)}`);
    }
    return true;
  }

  const inner = row.locator('.el-checkbox__inner, [role="checkbox"], input[type="checkbox"]').first();
  if (await inner.isVisible().catch(() => false)) {
    await inner.click({ force: true });
    await page.waitForTimeout(180);
    if (await isPopupOptionSelected(row) || await isPopupOptionSelectedByText(page, text)) {
      return true;
    }
  }

  const domClickResult = await clickPopupOptionCheckboxByDom(page, text);
  if (domClickResult && domClickResult.clicked) {
    if (domClickResult.mode !== 'already-selected') {
      await page.waitForTimeout(180);
    }
    if (await isPopupOptionSelected(row) || await isPopupOptionSelectedByText(page, text)) {
      return true;
    }
  }

  await row.click({ force: true });
  await page.waitForTimeout(180);
  if (!await isPopupOptionSelected(row) && !await isPopupOptionSelectedByText(page, text)) {
    throw new Error(`级联选项点击后未选中: ${label} -> ${normalizeText(text)}`);
  }
  return true;
}

async function isPopupOptionSelectedByText(page, text) {
  const exactText = normalizeText(text);
  return page.evaluate((targetText) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    function isSelected(element) {
      let current = element;
      while (current) {
        const ariaChecked = current.getAttribute && current.getAttribute('aria-checked');
        const tokens = new Set([
          ...Array.from(current.classList || []),
          ...String(current.className || '').split(/\s+/).filter(Boolean),
        ]);
        if (
          tokens.has('selected')
          || tokens.has('checked')
        || tokens.has('is-selected')
        || tokens.has('is-checked')
          || tokens.has('is-active')
          || ariaChecked === 'true'
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    const optionSelectors = [
      '.el-checkbox__label',
      '.checkbox-title',
      '.xt-cascader-option',
      'label.el-checkbox',
      '.checkbox-item',
      '.el-dropdown-menu__item',
      'li',
      '[role="treeitem"]',
      '[role="menuitemcheckbox"]',
      '[role="checkbox"]',
    ];

    const roots = Array.from(document.querySelectorAll('.el-popper, .el-select-dropdown, .xt-select-dropdown, .el-dropdown-menu, .el-popover'))
      .filter((element) => visible(element));

    for (const root of roots) {
      const candidates = Array.from(root.querySelectorAll(optionSelectors.join(','))).filter((element) => visible(element));
      for (const candidate of candidates) {
        const lines = String(candidate.innerText || '').split('\n').map(clean).filter(Boolean);
        if (clean(candidate.innerText) !== targetText && !lines.includes(targetText)) {
          continue;
        }
        if (isSelected(candidate)) {
          return true;
        }
      }
    }

    return false;
  }, exactText).catch(() => false);
}

async function isPopupOptionVisibleByText(page, text) {
  const exactText = normalizeText(text);
  return page.evaluate((targetText) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    const optionSelectors = [
      '.el-checkbox__label',
      '.checkbox-title',
      '.xt-cascader-option',
      'label.el-checkbox',
      '.checkbox-item',
      '.el-dropdown-menu__item',
      '.el-select-dropdown__item',
      'li',
      '[role="treeitem"]',
      '[role="menuitemcheckbox"]',
      '[role="checkbox"]',
      '[role="option"]',
    ];

    const roots = Array.from(document.querySelectorAll('.el-popper, .el-select-dropdown, .xt-select-dropdown, .el-dropdown-menu, .el-popover'))
      .filter((element) => visible(element));

    for (const root of roots) {
      const candidates = Array.from(root.querySelectorAll(optionSelectors.join(','))).filter((element) => visible(element));
      for (const candidate of candidates) {
        const lines = String(candidate.innerText || '').split('\n').map(clean).filter(Boolean);
        if (clean(candidate.innerText || candidate.textContent || '') === targetText || lines.includes(targetText)) {
          return true;
        }
      }
    }

    return false;
  }, exactText).catch(() => false);
}

async function isPopupOptionSelectedOrGone(page, text) {
  if (await isPopupOptionSelectedByText(page, text)) {
    return true;
  }
  return !await isPopupOptionVisibleByText(page, text);
}

async function clickPopupOptionCheckboxByDom(page, text) {
  const exactText = normalizeText(text);
  return page.evaluate((targetText) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    function isSelected(element) {
      let current = element;
      while (current) {
        const ariaChecked = current.getAttribute && current.getAttribute('aria-checked');
        const tokens = new Set([
          ...Array.from(current.classList || []),
          ...String(current.className || '').split(/\s+/).filter(Boolean),
        ]);
        if (
          tokens.has('selected')
          || tokens.has('checked')
        || tokens.has('is-selected')
        || tokens.has('is-checked')
          || tokens.has('is-active')
          || ariaChecked === 'true'
        ) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    function clickElement(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      element.click();
      ['pointerdown', 'mousedown', 'mouseup'].forEach((type) => {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    }

    const popupRoots = Array.from(document.querySelectorAll('.el-popper, .el-select-dropdown, .xt-select-dropdown, .el-dropdown-menu, .el-popover'))
      .filter((element) => visible(element));

    const optionSelectors = [
      '.el-checkbox__label',
      '.checkbox-title',
      '.xt-cascader-option',
      'label.el-checkbox',
      '.checkbox-item',
      '.el-dropdown-menu__item',
      'li',
      '[role="treeitem"]',
      '[role="menuitemcheckbox"]',
      '[role="checkbox"]',
    ];
    const rowSelectors = [
      'label.el-checkbox',
      '.checkbox-item',
      '.xt-cascader-option',
      '.el-dropdown-menu__item',
      'li',
      '[role="treeitem"]',
      '[role="menuitemcheckbox"]',
      '[role="checkbox"]',
    ];

    for (const root of popupRoots) {
      const candidates = Array.from(root.querySelectorAll(optionSelectors.join(',')))
        .filter((element) => {
          if (!visible(element)) {
            return false;
          }
          const lines = String(element.innerText || '')
            .split('\n')
            .map(clean)
            .filter(Boolean);
          return clean(element.innerText) === targetText || lines.includes(targetText);
        })
        .sort((left, right) => {
          const leftTextLength = clean(left.innerText).length;
          const rightTextLength = clean(right.innerText).length;
          if (leftTextLength !== rightTextLength) {
            return leftTextLength - rightTextLength;
          }
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
        });

      for (const candidate of candidates) {
        const row = candidate.closest(rowSelectors.join(',')) || candidate;
        if (isSelected(row)) {
          return { clicked: true, mode: 'already-selected' };
        }

        const checkbox = row.querySelector('.el-checkbox__input, input[type="checkbox"], .el-checkbox__original, .el-checkbox__inner, .ant-tree-checkbox, .ant-checkbox, [role="checkbox"]')
          || candidate.querySelector('.el-checkbox__input, input[type="checkbox"], .el-checkbox__original, .el-checkbox__inner, .ant-tree-checkbox, .ant-checkbox, [role="checkbox"]')
          || row.parentElement?.querySelector('.el-checkbox__input, input[type="checkbox"], .el-checkbox__original, .el-checkbox__inner, .ant-tree-checkbox, .ant-checkbox, [role="checkbox"]');

        const checkboxTarget = checkbox instanceof HTMLElement ? checkbox : null;

        if (checkboxTarget instanceof HTMLElement && visible(checkboxTarget)) {
          clickElement(checkboxTarget);
          return { clicked: true, mode: 'checkbox', className: checkboxTarget.className || checkboxTarget.tagName };
        }

        const rowRect = row.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rowRect.left + Math.min(16, rowRect.width / 4), rowRect.top + rowRect.height / 2);
        if (hitTarget instanceof HTMLElement && visible(hitTarget)) {
          clickElement(hitTarget);
          return { clicked: true, mode: 'checkbox-hit', className: hitTarget.className || hitTarget.tagName };
        }

        clickElement(row);
        return { clicked: true, mode: 'row', className: row.className || row.tagName };
      }
    }

    return { clicked: false, mode: 'not-found' };
  }, exactText).catch(() => ({ clicked: false, mode: 'error' }));
}

async function clickPopupOptionCheckbox(locator) {
  const checkboxSelectors = [
    '.el-checkbox__input',
    '.el-checkbox__original',
    '.el-checkbox__inner',
    '.ant-checkbox-inner',
    '.ant-tree-checkbox',
    '[role="checkbox"]',
    'input[type="checkbox"]',
    'xpath=ancestor-or-self::label[contains(concat(" ", normalize-space(@class), " "), " el-checkbox ")][1]//*[contains(concat(" ", normalize-space(@class), " "), " el-checkbox__input ")]',
    'xpath=ancestor-or-self::label[contains(concat(" ", normalize-space(@class), " "), " el-checkbox ")][1]//*[contains(concat(" ", normalize-space(@class), " "), " el-checkbox__inner ")]',
    'xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " checkbox-item ")][1]//*[contains(concat(" ", normalize-space(@class), " "), " el-checkbox__inner ")]',
    'xpath=ancestor-or-self::*[@role="checkbox"][1]',
  ];

  for (const selector of checkboxSelectors) {
    const target = locator.locator(selector).first();
    if (!await target.isVisible().catch(() => false)) {
      continue;
    }
    await target.click();
    return true;
  }

  return false;
}

async function inspectPopupOptions(page, text) {
  const exactText = normalizeText(text);
  return page.evaluate((targetText) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }
    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    const roots = Array.from(document.querySelectorAll('.el-popper, .el-select-dropdown, .xt-select-dropdown, .el-dropdown-menu, .el-popover'))
      .filter((element) => visible(element));
    const optionSelectors = [
      '.el-checkbox__label',
      '.checkbox-title',
      '.xt-cascader-option',
      'label.el-checkbox',
      '.checkbox-item',
      '.el-dropdown-menu__item',
      'li',
      '[role="treeitem"]',
      '[role="menuitemcheckbox"]',
      '[role="checkbox"]',
    ];

    return roots.map((root, rootIndex) => ({
      rootIndex,
      className: String(root.className || ''),
      options: Array.from(root.querySelectorAll(optionSelectors.join(',')))
        .filter((element) => visible(element))
        .map((element) => ({
          tag: element.tagName,
          className: String(element.className || '').slice(0, 200),
          text: clean(element.innerText).slice(0, 200),
          matched: clean(element.innerText) === targetText
            || String(element.innerText || '').split('\n').map(clean).filter(Boolean).includes(targetText),
        }))
        .filter((item) => item.text)
        .slice(0, 40),
    }));
  }, exactText).catch(() => []);
}

async function clickPopupOption(page, text, log, label) {
  const exactText = normalizeText(text);
  const cascaderRow = await findVisibleCascaderOption(page, exactText);
  if (cascaderRow) {
    const cascaderClicked = await clickVisibleCascaderOption(page, exactText, log, label);
    if (cascaderClicked) {
      return true;
    }
  }
  const domClickResult = await clickPopupOptionCheckboxByDom(page, exactText);
  if (domClickResult && domClickResult.clicked) {
    if (domClickResult.mode !== 'already-selected') {
      await page.waitForTimeout(180);
    }
    if (!await isPopupOptionSelectedOrGone(page, exactText)) {
      throw new Error(`弹层选项点击后未选中: ${label} -> ${exactText}`);
    }
    return true;
  }
  const candidateSelectors = [
    'body .el-popper label.el-checkbox',
    'body .el-popper .checkbox-item',
    'body .el-popper .checkbox-title',
    'body .el-popper .el-checkbox__label',
    'body .el-popper .el-dropdown-menu__item',
    'body .el-popper .xt-cascader-option',
    'body .el-popper li',
    'body .el-select-dropdown label.el-checkbox',
    'body .el-select-dropdown .el-checkbox__label',
    'body .el-select-dropdown .xt-cascader-option',
    'body .el-select-dropdown .el-select-dropdown__item',
    'body .xt-select-dropdown label.el-checkbox',
    'body .xt-select-dropdown .el-checkbox__label',
    'body .xt-select-dropdown .xt-cascader-option',
    'body .xt-select-dropdown li',
    'body .el-dropdown-menu .el-dropdown-menu__item',
    'body .el-dropdown-menu .xt-cascader-option',
    'body .el-popover label.el-checkbox',
    'body .el-popover .checkbox-title',
  ];

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector).filter({ hasText: exactText });
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }
      if (await isPopupOptionSelected(candidate)) {
        return true;
      }
      const clickedCheckbox = await clickPopupOptionCheckbox(candidate);
      if (!clickedCheckbox) {
        await candidate.click();
      }
      await page.waitForTimeout(180);
      if (!await isPopupOptionSelected(candidate) && !await isPopupOptionSelectedOrGone(page, exactText)) {
        throw new Error(`弹层选项点击后未选中: ${label} -> ${exactText}`);
      }
      return true;
    }
  }

  const clicked = await clickVisibleExactText(page, exactText, ['.el-popper', '.el-select-dropdown', '.xt-select-dropdown', '.el-dropdown-menu', '.el-popover']);
  if (!clicked) {
    const popupDiagnostics = await inspectPopupOptions(page, exactText);
    if (popupDiagnostics.length) {
      log.warn(`弹层选项诊断 ${label} -> ${exactText}: ${JSON.stringify(popupDiagnostics).slice(0, 1800)}`);
    }
    log.warn(`未找到弹层选项: ${label} -> ${exactText}`);
    throw new Error(`未找到弹层选项: ${label} -> ${exactText}`);
  }
  await page.waitForTimeout(180);
  if (!await isPopupOptionSelectedOrGone(page, exactText)) {
    throw new Error(`弹层选项点击后未选中: ${label} -> ${exactText}`);
  }
  return clicked;
}

async function closeOpenDropdown(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(150);
}

async function revealCascaderBranch(page, text, log, label) {
  const activated = await activateCascaderBranch(page, text, log, label);
  if (activated) {
    return true;
  }
  const exactText = normalizeText(text);
  const revealed = await page.evaluate((targetText) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }
    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
    }
    const target = Array.from(document.querySelectorAll('.el-popper .xt-cascader-option, .el-dropdown-menu .xt-cascader-option, .xt-select-dropdown .xt-cascader-option'))
      .find((node) => visible(node) && clean(node.innerText) === targetText);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    ['pointerenter', 'mouseenter', 'mouseover', 'mousemove'].forEach((type) => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    return true;
  }, exactText).catch(() => false);

  if (!revealed) {
    log.warn(`未找到级联父级选项: ${label} -> ${exactText}`);
    return false;
  }
  await page.waitForTimeout(220);
  return true;
}

async function openDropdownTrigger(locator) {
  if (!await locator.isVisible().catch(() => false)) {
    return false;
  }
  await locator.click();
  return true;
}

async function openDropdownTriggerByMouse(page, locator) {
  if (!await locator.isVisible().catch(() => false)) {
    return false;
  }
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    return false;
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

async function openControlledDropdown(page, triggerLocator) {
  const button = triggerLocator.locator('[role="button"]').first();
  const clickable = await button.isVisible().catch(() => false) ? button : triggerLocator;
  if (!await clickable.isVisible().catch(() => false)) {
    return null;
  }
  const controlsId = await clickable.getAttribute('aria-controls').catch(() => '');
  await clickable.click({ force: true });
  await page.waitForTimeout(220);
  return normalizeText(controlsId || '') || null;
}

async function clickDropdownItemByControls(page, controlsId, text) {
  const exactText = normalizeText(text);
  if (!controlsId) {
    return false;
  }
  return page.evaluate(({ id, targetText }) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }
    const root = document.getElementById(id);
    if (!(root instanceof HTMLElement)) {
      return false;
    }
    const items = Array.from(root.querySelectorAll('.el-dropdown-menu__item, .xt-dropdown-item, li'));
    const target = items.find((item) => clean(item.innerText) === targetText);
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    target.click();
    return true;
  }, { id: controlsId, targetText: exactText }).catch(() => false);
}

async function selectDropdownSingleOption(page, triggerLocator, value, log, label) {
  const option = normalizeText(value);
  if (!option) {
    return;
  }

  const controlsId = await openControlledDropdown(page, triggerLocator);
  if (!controlsId) {
    log.warn(`未找到单选下拉触发器: ${label}`);
    return;
  }

  const clicked = await clickDropdownItemByControls(page, controlsId, option);
  if (!clicked) {
    log.warn(`未找到单选下拉选项: ${label} -> ${option}`);
    await closeOpenDropdown(page);
    return;
  }

  await page.waitForTimeout(220);
}

async function selectDropdownOptions(page, triggerLocator, values, log, label) {
  const options = normalizeArray(values);
  if (!options.length) {
    return;
  }

  const opened = await openDropdownTrigger(triggerLocator);
  if (!opened) {
    log.warn(`未找到下拉触发器: ${label}`);
    return;
  }
  await page.waitForTimeout(220);

  for (const option of options) {
    const hierarchical = splitHierarchicalValue(option);
    if (hierarchical) {
      const childClicked = await clickPopupOption(page, hierarchical.child, log, label);
      if (childClicked) {
        continue;
      }
      await revealCascaderBranch(page, hierarchical.parent, log, label);
      await clickPopupOption(page, hierarchical.child, log, label);
      continue;
    }
    await clickPopupOption(page, option, log, label);
  }

  await closeOpenDropdown(page);
}

async function applyCascaderMultiFilter(page, triggerLocator, values, options, log, label) {
  const targets = normalizeArray(values);
  if (!targets.length) {
    return;
  }

  const opened = await openDropdownTrigger(triggerLocator);
  if (!opened) {
    log.warn(`未找到级联筛选触发器: ${label}`);
    return;
  }
  await page.waitForTimeout(220);

  for (const target of targets) {
    const hierarchical = splitHierarchicalValue(target);
    if (hierarchical) {
      const branchNode = findCascaderNodeByLabel(options, hierarchical.parent);
      if (branchNode) {
        await activateCascaderBranch(page, branchNode.label, log, label);
      } else {
        await revealCascaderBranch(page, hierarchical.parent, log, label);
      }
      await clickVisibleCascaderOption(page, hierarchical.child, log, label);
      continue;
    }

    const node = findCascaderNodeByLabel(options, target);
    if (!node) {
      await clickVisibleCascaderOption(page, target, log, label);
      continue;
    }

    if (Array.isArray(node.children) && node.children.length > 0) {
      await activateCascaderBranch(page, node.label, log, label);
      for (const child of node.children) {
        await clickVisibleCascaderOption(page, child, log, label);
      }
      continue;
    }

    await clickVisibleCascaderOption(page, node.label, log, label);
  }

  await closeOpenDropdown(page);
  await page.waitForTimeout(180);
  await assertCascaderTriggerSelected(triggerLocator, label, targets.length);
}

async function applyCooperationFilters(page, filters, log) {
  const normalized = normalizeFilters(filters);
  await waitForCooperationFilters(page);
  const row = cooperationRow(page);
  const selectedCreatorType = normalized.creatorTypes[0] || '';

  if (normalized.collaborationObject === '明星') {
    const starOption = row.getByText('明星', { exact: true }).first();
    if (await starOption.isVisible().catch(() => false)) {
      await clickIfNeeded(starOption, true);
      await page.waitForTimeout(150);
    } else {
      log.warn('未找到合作对象: 明星');
    }
  }

  const shortVideoOption = row.locator('.basic-market-select-label').filter({ hasText: '短视频达人' }).first();
  if (await shortVideoOption.isVisible().catch(() => false)) {
    await clickIfNeeded(shortVideoOption, selectedCreatorType === '短视频达人');
    await page.waitForTimeout(150);
  } else if (selectedCreatorType === '短视频达人') {
    log.warn('未找到题材类型: 短视频达人');
  }

  const shortDramaTrigger = row.locator('.xt-dropdown.basic-market-select-label.el-dropdown').filter({ hasText: '短剧演员' }).first();
  await applyCascaderMultiFilter(page, shortDramaTrigger, normalized.shortDramaSelections, SHORT_DRAMA_OPTIONS, log, '短剧演员');

  const shortLiveTrigger = row.locator('.xt-dropdown.basic-market-select-label.el-dropdown').filter({ hasText: '短直达人' }).first();
  await applyCascaderMultiFilter(page, shortLiveTrigger, normalized.shortLiveSelections, SHORT_LIVE_OPTIONS, log, '短直达人');

  const otherTopicTrigger = row.locator('.xt-dropdown.base-market-dropdown.el-dropdown').filter({ hasText: '其它题材' }).first();
  if (normalized.extraCreatorTypes[0]) {
    await selectDropdownSingleOption(page, otherTopicTrigger, normalized.extraCreatorTypes[0], log, '其它题材');
  }

  if (normalized.industry && normalized.industry !== '不限') {
    const industryLine = row.locator('.market-filter-wrapper--line').filter({ hasText: '适配行业' }).first();
    const industryTrigger = industryLine.locator('.xt-dropdown.base-market-dropdown.el-dropdown').first();
    await selectDropdownSingleOption(page, industryTrigger, normalized.industry, log, '适配行业');
  }

  if (normalized.goals.includes('品牌曝光')) {
    const brandExposure = row.locator('.basic-market-select-label').filter({ hasText: '品牌曝光' }).first();
    if (await brandExposure.isVisible().catch(() => false)) {
      await clickIfNeeded(brandExposure, true);
      await page.waitForTimeout(150);
    }
  }

  if (normalized.goals.includes('行动转化')) {
    const actionConversion = row.locator('.basic-market-select-label').filter({ hasText: '行动转化' }).first();
    if (await actionConversion.isVisible().catch(() => false)) {
      await clickIfNeeded(actionConversion, true);
      await page.waitForTimeout(150);
    }
  }

  const grassTrigger = row.locator('.xt-dropdown.base-market-dropdown.el-dropdown').filter({ hasText: '破圈种草' }).first();
  if (normalized.grassSelections[0]) {
    await selectDropdownSingleOption(page, grassTrigger, normalized.grassSelections[0], log, '破圈种草');
  }

  if (normalized.audienceMode === '八大人群' && normalized.audienceLabels.length) {
    const audienceTrigger = row.locator('.market-package-select.new.use-design-element').first();
    await selectDropdownOptions(page, audienceTrigger, normalized.audienceLabels, log, '八大人群');
  }

  if (normalized.audienceMode === '自定义人群' && normalized.audienceLabels.length) {
    const audienceTrigger = row.locator('.market-package-select.new.use-design-element').first();
    await selectDropdownOptions(page, audienceTrigger, normalized.audienceLabels, log, '自定义人群');
  }
}

async function applyPopupCountFilter(page, triggerLabel, selectedOptions, log) {
  const options = normalizeArray(selectedOptions);
  if (!options.length) {
    return;
  }

  const trigger = await findVisibleFilterTrigger(page, triggerLabel);
  if (!trigger) {
    throw new Error(`未找到筛选触发器: ${triggerLabel}`);
  }

  await selectDropdownOptions(page, trigger, options, log, triggerLabel);
  await page.waitForTimeout(180);
  await assertCountedTriggerSelected(page, triggerLabel, options.length);
}

async function applyCostPerformancePresetSingleFilter(page, triggerLabel, selectedOptions, log) {
  const option = normalizeArray(selectedOptions).at(-1);
  if (!option || option === '全部') {
    return;
  }

  const trigger = await findVisibleFilterTrigger(page, triggerLabel);
  if (!trigger) {
    throw new Error(`未找到性价比单选触发器: ${triggerLabel}`);
  }

  const opened = await openDropdownTrigger(trigger);
  if (!opened) {
    throw new Error(`无法打开性价比单选触发器: ${triggerLabel}`);
  }
  await page.waitForTimeout(220);

  const clicked = await clickVisibleExactText(page, option, ['.el-popper', '.el-select-dropdown', '.xt-select-dropdown', '.el-dropdown-menu', '.el-popover']);
  if (!clicked) {
    const popupDiagnostics = await inspectPopupOptions(page, option);
    if (popupDiagnostics.length) {
      log.warn(`性价比单选弹层诊断 ${triggerLabel} -> ${option}: ${JSON.stringify(popupDiagnostics).slice(0, 1800)}`);
    }
    throw new Error(`未找到性价比单选项: ${triggerLabel} -> ${option}`);
  }
  await page.waitForTimeout(220);

  const selectedTrigger = await findVisibleFilterTrigger(page, option);
  if (!selectedTrigger) {
    const originalText = await trigger.innerText().catch(() => '');
    throw new Error(`性价比单选项选择后触发器未显示目标值: ${triggerLabel} -> ${option}，当前="${normalizeText(originalText)}"`);
  }
}

async function openPriceQuoteInnerDropdown(page, targetLabel, fallbackIndex) {
  return page.evaluate(({ label, index }) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    function clickElement(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      element.click();
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }

    const popper = Array.from(document.querySelectorAll('.price-group-dropdown, .el-popper, .el-popover'))
      .filter(visible)
      .find((element) => {
        const text = clean(element.textContent || '');
        return text.includes('选择报价类型') || text.includes('报价区间');
      });
    if (!popper) {
      return false;
    }

    const labelNodes = Array.from(popper.querySelectorAll('*'))
      .filter((element) => visible(element) && clean(element.textContent || '') === label)
      .sort((left, right) => clean(left.textContent || '').length - clean(right.textContent || '').length);

    for (const labelNode of labelNodes) {
      let row = labelNode.parentElement;
      while (row && row !== popper) {
        const dropdowns = Array.from(row.querySelectorAll('.xt-dropdown.star-select, .xt-dropdown, .star-select, .el-dropdown, [role="button"]'))
          .filter((element) => visible(element) && !/确定|取消|重置/.test(clean(element.textContent || '')));
        const target = dropdowns.find((element) => element !== labelNode && !element.contains(labelNode));
        if (target) {
          const button = target.querySelector('[role="button"]') || target;
          return clickElement(button);
        }
        row = row.parentElement;
      }
    }

    const dropdowns = Array.from(popper.querySelectorAll('.xt-dropdown.star-select, .xt-dropdown, .star-select, .el-dropdown'))
      .filter((element) => visible(element) && !/确定|取消|重置/.test(clean(element.textContent || '')));
    const target = dropdowns[index] || null;
    const button = target?.querySelector('[role="button"]') || target;
    if (!button) {
      return false;
    }
    return clickElement(button);
  }, { label: normalizeText(targetLabel), index: fallbackIndex }).catch(() => false);
}

async function priceQuoteInnerValueIncludes(page, targetLabel, expectedValue) {
  const label = normalizeText(targetLabel);
  const expected = normalizeText(expectedValue);
  if (!expected) {
    return true;
  }

  return page.evaluate(({ label: rowLabel, expectedText }) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    const popper = Array.from(document.querySelectorAll('.price-group-dropdown, .el-popper, .el-popover'))
      .filter(visible)
      .find((element) => {
        const text = clean(element.textContent || '');
        return text.includes('选择报价类型') || text.includes('报价区间');
      });
    if (!popper) {
      return false;
    }

    const labelNodes = Array.from(popper.querySelectorAll('*'))
      .filter((element) => visible(element) && clean(element.textContent || '') === rowLabel)
      .sort((left, right) => clean(left.textContent || '').length - clean(right.textContent || '').length);

    for (const labelNode of labelNodes) {
      let row = labelNode.parentElement;
      while (row && row !== popper) {
        const text = clean(row.textContent || '');
        if (text.includes(rowLabel) && text.includes(expectedText)) {
          return true;
        }
        row = row.parentElement;
      }
    }

    return clean(popper.textContent || '').includes(expectedText);
  }, { label, expectedText: expected }).catch(() => false);
}

async function clickSingleSelectPopupOption(page, text, log, label) {
  const exactText = normalizeText(text);
  if (!exactText) {
    return false;
  }

  const clicked = await page.evaluate((targetText) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    function clickElement(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      element.click();
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    }

    const roots = Array.from(document.querySelectorAll('.el-select-dropdown, .xt-select-dropdown, .el-dropdown-menu, .el-popper'))
      .filter(visible);
	    const optionSelectors = [
	      '.xt-option',
	      '.xt-option__content',
	      '.el-select-dropdown__item',
	      '.xt-select-option',
	      '.el-dropdown-menu__item',
      '[role="option"]',
      'li',
    ];

    for (const root of roots.reverse()) {
      const candidates = Array.from(root.querySelectorAll(optionSelectors.join(',')))
        .filter((element) => {
          if (!visible(element)) {
            return false;
          }
          const lines = String(element.innerText || '')
            .split('\n')
            .map(clean)
            .filter(Boolean);
          return clean(element.innerText || element.textContent || '') === targetText || lines.includes(targetText);
        })
        .sort((left, right) => clean(left.innerText || left.textContent || '').length - clean(right.innerText || right.textContent || '').length);

      const target = candidates[0];
      if (target) {
        return clickElement(target);
      }
    }

    return false;
  }, exactText).catch(() => false);

  if (!clicked) {
    const popupDiagnostics = await inspectPopupOptions(page, exactText);
    if (popupDiagnostics.length) {
      log.warn(`单选下拉诊断 ${label} -> ${exactText}: ${JSON.stringify(popupDiagnostics).slice(0, 1800)}`);
    }
    throw new Error(`未找到单选下拉选项: ${label} -> ${exactText}`);
  }

  await page.waitForTimeout(180);
  return true;
}

async function fillVisiblePopupRangeInputs(page, range) {
  const minValue = normalizeText(range && range.min);
  const maxValue = normalizeText(range && range.max);

  return page.evaluate(({ min, max }) => {
    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    function setInputValue(input, value) {
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    const roots = Array.from(document.querySelectorAll('.price-group-dropdown, .el-popper, .el-select-dropdown, .xt-select-dropdown'))
      .filter((element) => visible(element));
    for (const root of roots) {
      const inputs = Array.from(root.querySelectorAll('input'))
        .filter((input) => input instanceof HTMLInputElement && visible(input));
      if (inputs.length >= 2) {
        setInputValue(inputs[0], min);
        setInputValue(inputs[1], max);
        return true;
      }
    }
    return false;
  }, { min: minValue, max: maxValue }).catch(() => false);
}

async function applyPriceQuoteFilter(page, value, log) {
  const quoteType = flattenSingleOptionPerGroupSelections(value && value.quoteType).at(-1);
  const quoteRange = flattenSingleOptionPerGroupSelections(value && value.quoteRange).at(-1);
  const customRangeEntry = Object.values(value && value.customRange || {}).find((range) => {
    const min = normalizeText(range && range.min);
    const max = normalizeText(range && range.max);
    return Boolean(min || max);
  });
  const hasQuoteType = Boolean(quoteType && quoteType !== '全部');
  const hasQuoteRange = Boolean(quoteRange && quoteRange !== '全部');
  const hasCustomRange = Boolean(customRangeEntry);

  if (!hasQuoteType && !hasQuoteRange && !hasCustomRange) {
    return;
  }

  const trigger = await findVisibleFilterTrigger(page, '达人报价');
  if (!trigger) {
    throw new Error('未找到筛选触发器: 达人报价');
  }

  const opened = await openDropdownTrigger(trigger);
  if (!opened) {
    throw new Error('无法打开筛选触发器: 达人报价');
  }
  await page.waitForTimeout(220);

  if (hasQuoteType) {
    const typeOpened = await openPriceQuoteInnerDropdown(page, '选择报价类型', 0);
    if (!typeOpened) {
      throw new Error('未找到达人报价类型二级下拉');
    }
    await page.waitForTimeout(220);
    await clickSingleSelectPopupOption(page, quoteType, log, '达人报价类型');
    await page.waitForTimeout(160);
    if (!await priceQuoteInnerValueIncludes(page, '选择报价类型', quoteType)) {
      throw new Error(`达人报价类型选择后未生效: ${quoteType}`);
    }
  }

  if (hasQuoteRange) {
    const rangeOpened = await openPriceQuoteInnerDropdown(page, '报价区间', 1);
    if (!rangeOpened) {
      throw new Error('未找到达人报价区间二级下拉');
    }
    await page.waitForTimeout(220);
    await clickSingleSelectPopupOption(page, quoteRange, log, '达人报价区间');
    await page.waitForTimeout(160);
    if (!await priceQuoteInnerValueIncludes(page, '报价区间', quoteRange)) {
      throw new Error(`达人报价区间选择后未生效: ${quoteRange}`);
    }
  } else if (hasCustomRange) {
    const rangeOpened = await openPriceQuoteInnerDropdown(page, '报价区间', 1);
    if (!rangeOpened) {
      throw new Error('未找到达人报价区间二级下拉');
    }
    await page.waitForTimeout(220);
    const filled = await fillVisiblePopupRangeInputs(page, customRangeEntry);
    if (!filled) {
      throw new Error('未找到达人报价自定义区间输入框');
    }
    await page.waitForTimeout(160);
  }

  const confirmed = await page.locator('.price-group-dropdown').getByText('确定', { exact: true }).last().click({ force: true }).then(() => true).catch(() => false);
  if (!confirmed) {
    await closeOpenDropdown(page);
  }
  await page.waitForTimeout(180);
  await assertCountedTriggerSelected(page, '达人报价', [hasQuoteType, hasQuoteRange || hasCustomRange].filter(Boolean).length, { skipHighlight: true });
}

async function openTaskCountInnerDropdown(page, index) {
  const rect = await page.evaluate((dropdownIndex) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    const roots = Array.from(document.querySelectorAll('.el-dropdown-menu.xt-dropdown-menu, .el-popper, .el-popover, .task-count-dropdown, .task-num-dropdown'))
      .filter((element) => visible(element));
    const root = roots.find((element) => {
      const text = clean(element.textContent || '');
      return text.includes('任务时间') || text.includes('任务数量');
    }) || roots.at(-1);
    if (!root) {
      return null;
    }

    const inputs = Array.from(root.querySelectorAll('input.el-popover__reference'))
      .filter((element) => visible(element));
    const target = inputs[dropdownIndex] || null;
    if (!target) {
      return null;
    }

    const targetRect = target.getBoundingClientRect();
    return {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2,
    };
  }, index).catch(() => false);

  if (!rect) {
    return false;
  }

  await page.mouse.click(rect.x, rect.y);
  return true;
}

async function confirmVisiblePopup(page, labels = ['确定']) {
  for (const label of labels) {
    const clicked = await page.evaluate((targetLabel) => {
      function clean(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
      }

      function visible(element) {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 1
          && rect.height > 1
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) !== 0;
      }

      const roots = Array.from(document.querySelectorAll('.el-popper, .el-popover, .price-group-dropdown, .task-count-dropdown, .task-num-dropdown'))
        .filter((element) => visible(element));
      for (const root of roots.reverse()) {
        const buttons = Array.from(root.querySelectorAll('button, .el-button, [role="button"]'))
          .filter((element) => visible(element));
        const target = buttons.find((element) => clean(element.textContent || '') === targetLabel);
        if (target) {
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return true;
        }
      }
      return false;
    }, label).catch(() => false);
    if (clicked) {
      return true;
    }
  }
  return false;
}

async function applyTaskCountFilter(page, value, log) {
  const taskTime = flattenSingleOptionPerGroupSelections(value && value.taskTime).at(-1);
  const taskCount = value && typeof value === 'object' && value.taskCount && typeof value.taskCount === 'object' ? value.taskCount : {};
  const min = normalizeText(taskCount.min || '');
  const max = normalizeText(taskCount.max || '');
  const hasDefaultTaskCountRange = min === '0' && max === '8';
  const hasTaskTime = Boolean(taskTime);
  const hasTaskCount = Boolean(min || max) && !hasDefaultTaskCountRange;

  if (!hasTaskTime && !hasTaskCount) {
    return;
  }

  const trigger = await findVisibleFilterTrigger(page, '进行中的任务数');
  if (!trigger) {
    throw new Error('未找到筛选触发器: 进行中的任务数');
  }

  const opened = await openDropdownTriggerByMouse(page, trigger);
  if (!opened) {
    throw new Error('无法打开筛选触发器: 进行中的任务数');
  }
  await page.waitForTimeout(220);

  if (hasTaskTime) {
    const timeOpened = await openTaskCountInnerDropdown(page, 0);
    if (!timeOpened) {
      throw new Error('未找到进行中的任务数-任务时间下拉');
    }
    await page.waitForTimeout(220);
    await clickSingleSelectPopupOption(page, taskTime, log, '进行中的任务数-任务时间');
    await page.waitForTimeout(160);
  }

  if (min) {
    const minOpened = await openTaskCountInnerDropdown(page, 1);
    if (!minOpened) {
      throw new Error('未找到进行中的任务数-最低数量下拉');
    }
    await page.waitForTimeout(220);
    await clickSingleSelectPopupOption(page, min, log, '进行中的任务数-最低数量');
    await page.waitForTimeout(160);
  }

  if (max) {
    const maxOpened = await openTaskCountInnerDropdown(page, 2);
    if (!maxOpened) {
      throw new Error('未找到进行中的任务数-最高数量下拉');
    }
    await page.waitForTimeout(220);
    await clickSingleSelectPopupOption(page, max, log, '进行中的任务数-最高数量');
    await page.waitForTimeout(160);
  }

  const confirmed = await confirmVisiblePopup(page, ['确定']);
  if (!confirmed) {
    await closeOpenDropdown(page);
  }
  await page.waitForTimeout(180);
  await assertCountedTriggerSelected(page, '进行中的任务数', [hasTaskTime, hasTaskCount].filter(Boolean).length, { skipHighlight: true });
}

async function applyTagFilter(page, label) {
  const tag = await findVisibleTagFilter(page, label);
  if (!tag) {
    throw new Error(`未找到标签筛选项: ${label}`);
  }
  await clickIfNeeded(tag, true);
  await page.waitForTimeout(150);
  if (!await isLocatorSelected(tag)) {
    const text = normalizeText(await tag.innerText().catch(() => ''));
    throw new Error(`标签筛选项未选中: ${label}，当前="${text}"`);
  }
}

async function fillVisibleRangeField(page, fieldLabel, range) {
  const targetLabel = normalizeText(fieldLabel);
  const minValue = normalizeText(range && range.min);
  const maxValue = normalizeText(range && range.max);

  return page.evaluate(({ label, min, max }) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 1
        && rect.height > 1
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0;
    }

    function setInputValue(input, value) {
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    const popupRoots = Array.from(document.querySelectorAll('.el-popper, .el-select-dropdown, .xt-select-dropdown, .el-dropdown-menu, .el-popover'))
      .filter((element) => visible(element));

    for (const root of popupRoots) {
      const elements = Array.from(root.querySelectorAll('*')).filter((element) => visible(element));
      for (const element of elements) {
        if (clean(element.textContent || '') !== label) {
          continue;
        }
        let row = element;
        while (row && row !== root) {
          const inputs = Array.from(row.querySelectorAll('input')).filter((input) => input instanceof HTMLInputElement && visible(input));
          if (inputs.length >= 2) {
            setInputValue(inputs[0], min);
            setInputValue(inputs[1], max);
            return true;
          }
          row = row.parentElement;
        }
      }
    }

    return false;
  }, { label: targetLabel, min: minValue, max: maxValue }).catch(() => false);
}

async function applyRangeCountFilter(page, triggerLabel, value) {
  const selectedFields = Object.entries(value || {}).filter(([, field]) => {
    const min = normalizeText(field && field.min);
    const max = normalizeText(field && field.max);
    return Boolean(min || max);
  });
  if (!selectedFields.length) {
    return;
  }

  const trigger = await findVisibleFilterTrigger(page, triggerLabel);
  if (!trigger) {
    throw new Error(`未找到范围筛选触发器: ${triggerLabel}`);
  }

  const opened = await openDropdownTrigger(trigger);
  if (!opened) {
    throw new Error(`无法打开范围筛选触发器: ${triggerLabel}`);
  }
  await page.waitForTimeout(220);

  for (const [fieldLabel, fieldValue] of selectedFields) {
    const filled = await fillVisibleRangeField(page, fieldLabel, fieldValue);
    if (!filled) {
      throw new Error(`未找到范围筛选字段: ${triggerLabel} -> ${fieldLabel}`);
    }
    await page.waitForTimeout(120);
  }

  await closeOpenDropdown(page);
  await page.waitForTimeout(180);
  await assertCountedTriggerSelected(page, triggerLabel, selectedFields.length);
}

async function applyMatchFilters(page, filters, log) {
  const matchFilters = filters && typeof filters === 'object' ? filters : {};

  for (const label of normalizeArray(matchFilters.creatorTypeTags)) {
    if (label === '不限') {
      continue;
    }
    await applyTagFilter(page, label);
  }

  for (const [label, value] of Object.entries(matchFilters.creatorTypeSelections || {})) {
    await applyPopupCountFilter(page, label, flattenOptionPopoverSelections(value), log);
  }

  for (const [label, value] of Object.entries(matchFilters.contentTopicSelections || {})) {
    await applyPopupCountFilter(page, label, flattenOptionPopoverSelections(value), log);
  }

  for (const [label, value] of Object.entries(matchFilters.personaIndustrySelections || {})) {
    await applyPopupCountFilter(page, label, flattenSingleOptionPerGroupSelections(value), log);
  }

  await applyPopupCountFilter(page, '职业', flattenSingleOptionPerGroupSelections(matchFilters.personaCareer), log);
  await applyPopupCountFilter(page, '爱好', flattenSingleOptionPerGroupSelections(matchFilters.personaHobby), log);
  await applyPopupCountFilter(page, '达人调性', flattenOptionPopoverSelections(matchFilters.personaTone), log);
  await applyPopupCountFilter(page, '主要出镜人物', flattenSingleOptionPerGroupSelections(matchFilters.personaCharacter), log);
  await applyPopupCountFilter(page, '达人性别', flattenSingleOptionPerGroupSelections(matchFilters.gender), log);
  await applyPopupCountFilter(page, '所在地域', flattenOptionPopoverSelections(matchFilters.region), log);
  await applyPopupCountFilter(page, '学历', flattenSingleOptionPerGroupSelections(matchFilters.education), log);
  await applyPopupCountFilter(page, '黄v认证', flattenSingleOptionPerGroupSelections(matchFilters.yellowV), log);
  await applyRangeCountFilter(page, '连接用户数', matchFilters.connectedUsers);
  await applyPopupCountFilter(page, '粉丝数量', flattenSingleOptionPerGroupSelections(matchFilters.followers), log);
  await applyPopupCountFilter(page, '观众画像', flattenSingleOptionPerGroupSelections(matchFilters.viewerProfile), log);
  await applyPopupCountFilter(page, '粉丝画像', flattenSingleOptionPerGroupSelections(matchFilters.fanProfile), log);
}

async function applyCostPerformanceFilters(page, filters, log) {
  const selections = filters && typeof filters === 'object' ? filters.costPerformanceSelections || {} : {};
  const ranges = filters && typeof filters === 'object' ? filters.costPerformanceRanges || {} : {};
  const priceQuote = filters && typeof filters === 'object' ? filters.costPerformancePriceQuote || {} : {};
  const taskCount = filters && typeof filters === 'object' ? filters.costPerformanceTaskCount || {} : {};

  if (countPriceQuoteSelections(priceQuote) > 0) {
    log.info('应用达人报价筛选');
    await applyPriceQuoteFilter(page, priceQuote, log);
  }

  for (const [label, value] of Object.entries(selections)) {
    if (COST_PERFORMANCE_PRESET_SINGLE_LABELS.has(label)) {
      await applyCostPerformancePresetSingleFilter(page, label, flattenSingleOptionPerGroupSelections(value), log);
      continue;
    }
    await applyPopupCountFilter(page, label, flattenSingleOptionPerGroupSelections(value), log);
  }

  await applyTaskCountFilter(page, taskCount, log);

  for (const [label, value] of Object.entries(ranges)) {
    await applyRangeCountFilter(page, label, value);
  }
}

async function applyTopicRecommendationFilters(page, tags) {
  for (const label of normalizeArray(tags)) {
    const tag = await findThemeRecommendationTagFilter(page, label);
    if (!tag) {
      throw new Error(`未找到主题推荐筛选项: ${label}`);
    }
    await clickIfNeeded(tag, true);
    await page.waitForTimeout(150);
    if (!await isLocatorSelected(tag)) {
      const text = normalizeText(await tag.innerText().catch(() => ''));
      throw new Error(`主题推荐筛选项未选中: ${label}，当前="${text}"`);
    }
  }
}

async function applyTopicRecommendationSelectionFilters(page, selections, log) {
  for (const [label, value] of Object.entries(selections || {})) {
    const option = flattenSingleOptionPerGroupSelections(value).at(-1);
    if (!option) {
      continue;
    }

    const trigger = await findThemeRecommendationDropdown(page, label);
    if (!trigger) {
      throw new Error(`未找到主题推荐下拉筛选项: ${label}`);
    }

    const opened = await openDropdownTrigger(trigger);
    if (!opened) {
      throw new Error(`无法打开主题推荐下拉筛选项: ${label}`);
    }
    await page.waitForTimeout(220);

    const clicked = await clickPopupOption(page, option, log, label);
    if (!clicked) {
      throw new Error(`未找到主题推荐下拉选项: ${label} -> ${option}`);
    }
    await page.waitForTimeout(180);
  }
}

async function findSearchInput(page) {
  const selectors = [
    'input[placeholder*="关键词"]',
    'input[placeholder*="搜索"]',
    'input[placeholder*="达人"]',
    'textarea[placeholder*="关键词"]',
    'textarea[placeholder*="搜索"]',
    '[role="textbox"]',
    'input[type="search"]',
    'input:not([type])',
    'input[type="text"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      return locator;
    }
  }

  throw new Error('未找到达人市场搜索输入框');
}

async function getActiveSearchMode(page) {
  const radioWrapper = page.locator('.search-type-radio-wrapper').first();
  if (!await radioWrapper.isVisible().catch(() => false)) {
    return '';
  }
  return normalizeText(await radioWrapper.locator('.search-type-radio-item--active').first().innerText().catch(() => ''));
}

async function applySearchMode(page, searchMode, log) {
  const normalizedMode = normalizeSearchMode(searchMode);
  const targetLabel = normalizedMode === 'nickname' ? '昵称找人' : '内容找人';
  const expectedPlaceholder = normalizedMode === 'nickname'
    ? '输入达人昵称、抖音号或星图ID'
    : '按内容关键词找达人';
  const radioWrapper = page.locator('.search-type-radio-wrapper').first();

  if (!await radioWrapper.isVisible().catch(() => false)) {
    log.warn(`未找到搜索模式切换区，继续使用当前模式: ${targetLabel}`);
    return;
  }

  const activeLabel = await getActiveSearchMode(page);
  log.info(`校验搜索模式，当前: ${activeLabel || '未知'}，目标: ${targetLabel}`);
  if (activeLabel !== targetLabel) {
    const option = radioWrapper.locator('.search-type-radio-item').filter({ hasText: targetLabel }).first();
    if (!await option.isVisible().catch(() => false)) {
      throw new Error(`未找到搜索模式: ${targetLabel}`);
    }
    log.info(`切换搜索模式: ${targetLabel}`);
    await option.click({ force: true });
    await page.waitForFunction((placeholder) => {
      const input = document.querySelector('.search-input-wrapper input');
      return input instanceof HTMLInputElement && input.getAttribute('placeholder') === placeholder;
    }, expectedPlaceholder, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(180);
  }
}

async function triggerSearch(page, signal) {
  const buttonSelectors = [
    'button:has-text("搜索")',
    '[role="button"]:has-text("搜索")',
    '.ant-btn:has-text("搜索")',
    'button[type="submit"]',
  ];

  for (const selector of buttonSelectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await withAbort(signal, button.click());
      return;
    }
  }

  await withAbort(signal, page.keyboard.press('Enter'));
}

async function waitForCreatorTableReady(page, timeout = 12000, signal) {
  const handle = await withAbort(signal, page.waitForFunction(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    const emptyState = Array.from(document.querySelectorAll('.illustration-message.no-data, [class~="illustration-message"][class~="no-data"], [class*="illustration-message"][class*="no-data"]'))
      .find((element) => element instanceof HTMLElement && visible(element) && clean(element.innerText).length > 0);
    if (emptyState instanceof HTMLElement) {
      return { state: 'empty' };
    }

    const bodySection = Array.from(document.querySelectorAll('.base-author-list .section-wrapper'))
      .find((element) => element instanceof HTMLElement && !element.classList.contains('sticky-header') && element.querySelector('.content-column'));
    if (bodySection instanceof HTMLElement) {
      const firstColumn = bodySection.querySelector('.content-section:not(.middle-columns) .content-column');
      const firstCell = firstColumn?.children?.[0];
      const text = clean(firstCell?.innerText || '');
      if (text.length > 0) {
        return { state: 'table' };
      }
    }

    return false;
  }, { timeout }).catch(() => null));

  if (!handle) {
    return { state: 'timeout' };
  }

  const result = await handle.jsonValue().catch(() => null);
  return result && typeof result === 'object'
    ? result
    : { state: 'unknown' };
}

async function extractCreatorEmptyState(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function unique(values) {
      return values.filter((value, index, source) => value && source.indexOf(value) === index);
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function isSpecificMessage(text) {
      return /权益|权限|等级过低|无法访问|访问更多数据|客户权益|暂时无法/i.test(text);
    }

    function isGenericNoResultMessage(text) {
      return /暂无结果|调整关键词|筛选条件|重试/i.test(text);
    }

    function scoreMessage(text) {
      const normalized = clean(text);
      if (!normalized) {
        return -1;
      }
      let score = Math.min(normalized.length, 120);
      if (isSpecificMessage(normalized)) {
        score += 240;
      }
      if (/您的|暂时无法访问更多数据|无法访问更多数据|等级过低/i.test(normalized)) {
        score += 160;
      }
      if (isGenericNoResultMessage(normalized)) {
        score -= 80;
      }
      return score;
    }

    function collectClassNames(element) {
      return unique(
        Array.from(element.classList)
          .map(clean)
          .filter((name) => (
            name
            && (
              name === 'illustration-message'
              || name === 'no-data'
              || name === 'medium'
              || /illustration|message|empty|no-data|medium|title|desc|text|tip/i.test(name)
            )
          )),
      );
    }

    function collectLines(element) {
      const containers = unique([
        element,
        element.parentElement,
        element.closest('[class*="illustration"]'),
        element.closest('[class*="no-data"]'),
        element.closest('[class*="empty"]'),
      ].filter((item) => item instanceof HTMLElement && visible(item)));

      const lines = [];
      for (const container of containers) {
        lines.push(...String(container.innerText || container.textContent || '')
          .split('\n')
          .map(clean)
          .filter((line) => Boolean(line) && line.length <= 120));
      }

      const deduped = unique(lines);
      const specificLines = deduped.filter(isSpecificMessage);
      if (specificLines.length) {
        return specificLines;
      }
      const nonGenericLines = deduped.filter((line) => !isGenericNoResultMessage(line));
      if (nonGenericLines.length) {
        return nonGenericLines;
      }
      return deduped;
    }

    const selectors = [
      '.illustration-message.no-data',
      '[class~="illustration-message"][class~="no-data"]',
      '[class*="illustration-message"][class*="no-data"]',
    ];
    const seen = new Set();
    const candidates = [];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          continue;
        }
        const text = clean(element.innerText);
        if (!text) {
          continue;
        }
        const dedupeKey = `${element.className}::${text}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        const classNames = collectClassNames(element);
        const lines = collectLines(element);
        const message = lines.length
          ? [...lines].sort((left, right) => scoreMessage(right) - scoreMessage(left))[0]
          : text;

        candidates.push({
          selector: classNames.length ? `.${classNames.join('.')}` : selector,
          classNames,
          message,
          score: scoreMessage(message),
          lines,
          rawText: text,
        });
      }
    }

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0];
  });
}

async function throwCreatorEmptyStateError(page, log, fallbackMessage) {
  const emptyState = await extractCreatorEmptyState(page);
  if (emptyState && emptyState.message) {
    const selector = emptyState.selector || emptyState.classNames?.join(' ') || 'unknown-selector';
    const candidateLines = Array.isArray(emptyState.lines) ? emptyState.lines.filter(Boolean) : [];
    const candidateSummary = candidateLines.length > 1 ? `，候选文案: ${candidateLines.join(' | ')}` : '';
    log.warn(`达人搜索结果为空，命中空状态 ${selector}，提示: ${emptyState.message}${candidateSummary}`);
    throw new Error(emptyState.message);
  }

  if (fallbackMessage) {
    log.warn(fallbackMessage);
    throw new Error(fallbackMessage);
  }
}

function splitCreatorValue(value) {
  return normalizeText(value).split(' / ').map(normalizeText).filter(Boolean);
}

function isPlaceholderValue(value) {
  const parts = splitCreatorValue(value);
  if (!parts.length) {
    return true;
  }
  return parts.every((part) => /^[-—–~._/|:：\s]+$/.test(part));
}

function isCreatorHeaderLikeValue(value) {
  const text = normalizeText(value).replace(/[：:]/g, '');
  if (!text) {
    return false;
  }
  return /(达人信息|达人类型|内容主题|连接用户数|21-60s报价|相关视频|粉丝数|预期CPM|预期播放|互动率|完播率|爆款率|操作|达人清单|我的清单|观众画像|粉丝画像)/i.test(text);
}

function countMeaningfulCreatorValues(values) {
  return values
    .map(normalizeText)
    .filter((value) => value && !isPlaceholderValue(value) && !isCreatorHeaderLikeValue(value))
    .length;
}

function isMeaningfulRawCreatorRow(row) {
  const creatorInfo = normalizeText(row.creatorInfo);
  if (!creatorInfo || isPlaceholderValue(creatorInfo) || isCreatorHeaderLikeValue(creatorInfo)) {
    return false;
  }

  const meaningfulInfoParts = splitCreatorValue(creatorInfo)
    .filter((part) => !isPlaceholderValue(part) && !isCreatorHeaderLikeValue(part));
  const creatorName = meaningfulInfoParts[0] || '';
  const hasIdentityAsset = Boolean(normalizeText(row.href) || normalizeText(row.avatarUrl) || normalizeText(row.creatorBadgeIconUrl));
  const detailCount = countMeaningfulCreatorValues([
    row.creatorType,
    row.contentTopic,
    row.connectedUsers,
    row.quote21To60s,
    row.operationText,
  ]);

  if (!hasIdentityAsset && meaningfulInfoParts.length < 2 && detailCount === 0) {
    return false;
  }
  if (creatorName.length <= 1 && !hasIdentityAsset && meaningfulInfoParts.length < 2 && detailCount < 2) {
    return false;
  }

  return true;
}

function isMeaningfulCreatorResult(result) {
  const name = normalizeText(result.name);
  const creatorInfo = normalizeText(result.creatorInfo || name);
  const hasIdentityAsset = Boolean(normalizeText(result.href) || normalizeText(result.avatarUrl) || normalizeText(result.creatorBadgeIconUrl));
  const meaningfulInfoParts = splitCreatorValue(creatorInfo)
    .filter((part) => !isPlaceholderValue(part) && !isCreatorHeaderLikeValue(part));
  const detailCount = countMeaningfulCreatorValues([
    result.creatorType,
    result.contentTopic,
    result.connectedUsers,
    result.quote21To60s,
    result.operationText,
    result.summary,
  ]);

  if (!name || isPlaceholderValue(name) || isCreatorHeaderLikeValue(name)) {
    return false;
  }
  if (!creatorInfo || isPlaceholderValue(creatorInfo) || isCreatorHeaderLikeValue(creatorInfo)) {
    return false;
  }
  if (!hasIdentityAsset && meaningfulInfoParts.length < 2 && detailCount === 0) {
    return false;
  }
  if (name.length <= 1 && !hasIdentityAsset && meaningfulInfoParts.length < 2 && detailCount < 2) {
    return false;
  }

  return true;
}

function isMeaningfulCreatorCardResult(result) {
  const name = normalizeText(result.name);
  const summary = normalizeText(result.summary);
  const href = normalizeText(result.href);
  const detailCount = countMeaningfulCreatorValues([name, summary]);

  if (!name || !summary) {
    return false;
  }
  if (isPlaceholderValue(name) || isPlaceholderValue(summary)) {
    return false;
  }
  if (isCreatorHeaderLikeValue(name)) {
    return false;
  }
  if (!href && name.length <= 1) {
    return false;
  }
  if (!href && detailCount < 2) {
    return false;
  }
  if (!href && /(达人清单|我的清单|观众画像|粉丝画像)/.test(summary)) {
    return false;
  }

  return true;
}

function creatorNameFromInfo(creatorInfo) {
  const parts = normalizeText(creatorInfo).split(' / ').map(normalizeText).filter(Boolean);
  return parts.find((part) => (
    part.length >= 2
    && part.length <= 40
    && !/粉丝|获赞|主页|抖音号|ID[:：]?|达人信息/.test(part)
  )) || parts[0] || '达人';
}

function splitStructuredParts(value) {
  return normalizeText(value).split(' / ').map(normalizeText).filter(Boolean);
}

function parseCreatorInfoParts(creatorInfo) {
  const parts = splitStructuredParts(creatorInfo);
  return {
    parts,
    name: creatorNameFromInfo(creatorInfo),
    gender: parts.find((part) => /^(男|女)$/.test(part)) || '',
    location: parts.find((part) => (
      part
      && !/^(男|女)$/.test(part)
      && part !== creatorNameFromInfo(creatorInfo)
      && !/抖音精选|繁星企划|涨粉|榜|ID[:：]?/.test(part)
    )) || '',
    badges: parts.filter((part) => (
      part
      && part !== creatorNameFromInfo(creatorInfo)
      && !/^(男|女)$/.test(part)
      && part !== (parts.find((item) => (
        item
        && !/^(男|女)$/.test(item)
        && item !== creatorNameFromInfo(creatorInfo)
        && !/抖音精选|繁星企划|涨粉|榜|ID[:：]?/.test(item)
      )) || '')
    )),
  };
}

function parseTopicParts(contentTopic) {
  return splitStructuredParts(contentTopic).filter((part) => part !== '-');
}

function parseOperationParts(operationText) {
  const parts = splitStructuredParts(operationText);
  return {
    label: parts[0] || '',
    hint: parts.slice(1).join(' / '),
  };
}

function normalizeCreatorRow(row) {
  const creatorInfo = normalizeText(row.creatorInfo);
  const creatorType = normalizeText(row.creatorType);
  const contentTopic = normalizeText(row.contentTopic);
  const connectedUsers = normalizeText(row.connectedUsers);
  const quote21To60s = normalizeText(row.quote21To60s);
  const operationText = normalizeText(row.operationText);
  const creator = parseCreatorInfoParts(creatorInfo);
  const operation = parseOperationParts(operationText);
  const contentTopics = parseTopicParts(contentTopic);
  const summary = [
    creatorInfo,
    creatorType,
    contentTopic,
    connectedUsers,
    quote21To60s,
  ].filter(Boolean).join(' | ');

  return {
    name: creator.name,
    summary,
    href: row.href || '',
    avatarUrl: row.avatarUrl || '',
    creatorBadgeIconUrl: row.creatorBadgeIconUrl || '',
    gender: creator.gender,
    location: creator.location,
    badges: creator.badges,
    creatorInfo,
    creatorType,
    contentTopic,
    contentTopics,
    connectedUsers,
    quote21To60s,
    operationText,
    operationLabel: operation.label,
    operationHint: operation.hint,
  };
}

async function extractCreatorSectionTable(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visible(element) {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function cellText(element) {
      if (!(element instanceof HTMLElement)) {
        return '';
      }
      const lines = String(element.innerText || '')
        .split('\n')
        .map(clean)
        .filter(Boolean);
      const seen = new Set();
      return lines
        .filter((line) => {
          if (seen.has(line)) {
            return false;
          }
          seen.add(line);
          return true;
        })
        .join(' / ');
    }

    function cellHref(element) {
      const anchor = element.querySelector?.('a[href]') || element.closest?.('a[href]');
      const href = anchor?.getAttribute('href') || '';
      return href ? new URL(href, window.location.href).toString() : '';
    }

    function columnCells(column) {
      if (!(column instanceof HTMLElement)) {
        return [];
      }
      return Array.from(column.children)
        .filter((child) => child instanceof HTMLElement)
        .map((child, index) => ({
          index,
          text: cellText(child),
          href: cellHref(child),
          avatarUrl: child.querySelector('img')?.getAttribute('src') || child.querySelector('img')?.getAttribute('data-src') || '',
          creatorBadgeIconUrl: Array.from(child.querySelectorAll('img'))[1]?.getAttribute('src') || '',
        }));
    }

    const lists = Array.from(document.querySelectorAll('.base-author-list'))
      .filter((element) => element instanceof HTMLElement && visible(element));
    const authorList = lists.find((element) => clean(element.innerText).includes('达人信息') && clean(element.innerText).includes('21-60s报价')) || lists[0];
    if (!authorList) {
      return { rows: [], diagnostics: { reason: 'missing_base_author_list' } };
    }

    const bodySection = Array.from(authorList.children)
      .find((child) => (
        child instanceof HTMLElement
        && child.classList.contains('section-wrapper')
        && !child.classList.contains('sticky-header')
        && child.querySelector('.content-column')
      ));
    if (!(bodySection instanceof HTMLElement)) {
      return { rows: [], diagnostics: { reason: 'missing_body_section' } };
    }

    const sections = Array.from(bodySection.children)
      .filter((child) => child instanceof HTMLElement && child.classList.contains('content-section'));
    const middleSection = sections.find((section) => section.classList.contains('middle-columns'));
    const fixedSections = sections.filter((section) => !section.classList.contains('middle-columns'));
    const leftSection = fixedSections[0];
    const rightSection = fixedSections[1];
    const leftColumn = leftSection?.querySelector('.content-column') || null;
    const middleColumns = middleSection
      ? Array.from(middleSection.children).filter((child) => child instanceof HTMLElement && child.classList.contains('content-column'))
      : [];
    const rightColumns = rightSection
      ? Array.from(rightSection.children).filter((child) => child instanceof HTMLElement && child.classList.contains('content-column'))
      : [];

    const columns = {
      creatorInfo: columnCells(leftColumn),
      relatedVideo: columnCells(middleColumns[0]),
      creatorType: columnCells(middleColumns[1]),
      contentTopic: columnCells(middleColumns[2]),
      connectedUsers: columnCells(middleColumns[3]),
      followers: columnCells(middleColumns[4]),
      expectedCpm: columnCells(middleColumns[5]),
      expectedPlays: columnCells(middleColumns[6]),
      interactionRate: columnCells(middleColumns[7]),
      completionRate: columnCells(middleColumns[8]),
      viralRate: columnCells(middleColumns[9]),
      quote21To60s: columnCells(rightColumns[0]),
      operationText: columnCells(rightColumns[1]),
    };

    const rowCount = Math.min(20, columns.creatorInfo.length);
    const rows = [];
    for (let index = 0; index < rowCount; index += 1) {
      const row = {
        creatorInfo: columns.creatorInfo[index]?.text || '',
        creatorType: columns.creatorType[index]?.text || '',
        contentTopic: columns.contentTopic[index]?.text || '',
        connectedUsers: columns.connectedUsers[index]?.text || '',
        quote21To60s: columns.quote21To60s[index]?.text || '',
        operationText: columns.operationText[index]?.text || '',
        href: columns.creatorInfo[index]?.href || '',
        avatarUrl: columns.creatorInfo[index]?.avatarUrl || '',
        creatorBadgeIconUrl: columns.creatorInfo[index]?.creatorBadgeIconUrl || '',
      };
      if (row.creatorInfo) {
        rows.push(row);
      }
    }

    return {
      rows,
      diagnostics: {
        reason: rows.length ? 'section_columns' : 'empty_section_columns',
        bodySection: {
          top: Math.round(bodySection.getBoundingClientRect().top),
          childCount: bodySection.children.length,
        },
        columnCounts: Object.fromEntries(Object.entries(columns).map(([key, cells]) => [key, cells.length])),
        columnSamples: {
          creatorInfo: columns.creatorInfo.slice(0, 20),
          quote21To60s: columns.quote21To60s.slice(0, 20),
          operationText: columns.operationText.slice(0, 20),
        },
        firstRows: rows.slice(0, 3),
      },
    };
  });
}

async function collectCreatorSectionRows(page, options = {}) {
  const maxRows = Number(options.maxRows || 20);
  const maxScrollSteps = Number(options.maxScrollSteps || 24);
  const scrollDelayMs = Number(options.scrollDelayMs || 400);
  const stableRoundsLimit = Number(options.stableRoundsLimit || 4);
  const collected = new Map();
  const scrollTrace = [];
  let stableRounds = 0;

  for (let step = 0; step < maxScrollSteps; step += 1) {
    const snapshot = await extractCreatorSectionTable(page);
    for (const row of snapshot.rows) {
      const key = normalizeText(row.creatorInfo);
      if (key && !collected.has(key)) {
        collected.set(key, row);
      }
    }

    const scrollState = await page.evaluate(() => {
      function visible(element) {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 4 && rect.height > 4 && style.visibility !== 'hidden' && style.display !== 'none';
      }

      const authorList = Array.from(document.querySelectorAll('.base-author-list'))
        .find((element) => element instanceof HTMLElement && visible(element) && element.querySelector('.content-column'));
      if (!(authorList instanceof HTMLElement)) {
        return { found: false };
      }
      const rect = authorList.getBoundingClientRect();
      return {
        found: true,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: Math.min(window.innerHeight - 80, Math.max(140, rect.top + Math.min(rect.height, window.innerHeight - 220) / 2)),
        viewportHeight: window.innerHeight,
      };
    });

    scrollTrace.push({
      step,
      collected: collected.size,
      scrollState,
      firstCreator: snapshot.rows[0]?.creatorInfo || '',
      lastCreator: snapshot.rows[snapshot.rows.length - 1]?.creatorInfo || '',
    });

    if (collected.size >= maxRows) {
      break;
    }

    if (!scrollState.found) {
      stableRounds += 1;
      if (stableRounds >= stableRoundsLimit) {
        break;
      }
      await page.waitForTimeout(scrollDelayMs);
      continue;
    }

    await page.mouse.move(scrollState.centerX, scrollState.centerY);
    await page.mouse.wheel(0, Math.max(500, Math.floor(scrollState.viewportHeight * 0.9)));
    await page.waitForTimeout(scrollDelayMs);

    const afterState = await page.evaluate(() => {
      const authorList = document.querySelector('.base-author-list');
      if (!(authorList instanceof HTMLElement)) {
        return { found: false };
      }
      const rect = authorList.getBoundingClientRect();
      return {
        found: true,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      };
    });

    scrollTrace[scrollTrace.length - 1].afterScroll = afterState;

    if (!afterState.found || Math.abs((afterState.top || 0) - scrollState.top) < 2) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }
    if (stableRounds >= stableRoundsLimit) {
      break;
    }
  }

  return {
    rows: Array.from(collected.values())
      .filter(isMeaningfulRawCreatorRow)
      .slice(0, maxRows),
    diagnostics: {
      reason: 'section_columns_scroll_collect',
      collected: collected.size,
      scrollTrace,
    },
  };
}

async function extractCreatorTable(page) {
  const sectionTable = await collectCreatorSectionRows(page, { maxRows: 20 });
  if (sectionTable.rows.length) {
    return {
      results: sectionTable.rows
        .filter(isMeaningfulRawCreatorRow)
        .map(normalizeCreatorRow)
        .filter(isMeaningfulCreatorResult),
      diagnostics: sectionTable.diagnostics,
    };
  }

  const table = await extractColumnLayoutTable(page, {
    columns: [
      { key: 'creatorInfo', label: '达人信息' },
      { key: 'creatorType', label: '达人类型' },
      { key: 'contentTopic', label: '内容主题' },
      { key: 'connectedUsers', label: '连接用户数' },
      { key: 'quote21To60s', label: '21-60s报价' },
      { key: 'operationText', label: '操作' },
    ],
    minColumns: 4,
    minCellsPerRow: 2,
    maxRows: 20,
    maxCellTextLength: 260,
    excludeTextPattern: '^(搜索|筛选|排序|不限|全部|已选|重置|更多筛选|收起)$',
    rowAnchorKeys: ['quote21To60s', 'operationText'],
    anchorRowThreshold: 42,
    rowThreshold: 68,
    rowCenterTolerance: 54,
    firstColumnLeftPadding: 80,
    lastColumnRightPadding: 120,
    firstRowPadding: 80,
    lastRowPadding: 80,
    valueSeparator: ' / ',
  });

  return {
    results: table.rows
      .filter(isMeaningfulRawCreatorRow)
      .map(normalizeCreatorRow)
      .filter(isMeaningfulCreatorResult),
    diagnostics: table.diagnostics,
  };
}

async function extractCreatorCards(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function visibleCard(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 40 && rect.height > 24 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    const candidates = Array.from(document.querySelectorAll([
      '[class*="creator"]',
      '[class*="author"]',
      '[class*="talent"]',
      '[class*="daren"]',
      '[class*="card"]',
      '[class*="list-item"]',
      '[class*="ListItem"]',
      '.ant-card',
      '.ant-list-item',
    ].join(',')));

    const seen = new Set();
    const results = [];

    for (const element of candidates) {
      if (!(element instanceof HTMLElement) || !visibleCard(element)) {
        continue;
      }

      const text = clean(element.innerText);
      if (text.length < 4 || text.length > 900) {
        continue;
      }
      if (/搜索|筛选|排序|不限|全部|已选|重置/.test(text.slice(0, 80)) && text.length < 120) {
        continue;
      }

      const lines = text.split('\n').map(clean).filter(Boolean);
      const name = lines.find((line) => (
        line.length >= 2
        && line.length <= 40
        && !/搜索|筛选|查看|合作|价格|粉丝|播放|互动|分类|标签/.test(line)
      )) || lines[0] || '达人';

      const href = element.querySelector('a[href]')?.getAttribute('href') || '';
      const key = `${name}-${text.slice(0, 120)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      results.push({
        name,
        summary: text,
        href: href ? new URL(href, window.location.href).toString() : '',
      });

      if (results.length >= 20) {
        break;
      }
    }

    return results;
  }).then((results) => results.filter(isMeaningfulCreatorCardResult));
}

async function extractPagination(page) {
  return page.evaluate(() => {
    function toPositiveInt(value, fallback = 0) {
      const parsed = Number.parseInt(String(value || ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    const root = document.querySelector('.el-pagination.xt-pagination, .pagination .el-pagination');
    if (!(root instanceof HTMLElement)) {
      return null;
    }

    const currentPage = toPositiveInt(root.querySelector('.el-pager .active')?.textContent, 1);
    const visiblePages = Array.from(root.querySelectorAll('.el-pager .number'))
      .map((element) => toPositiveInt(element.textContent))
      .filter((value) => value > 0);
    const jumpInput = root.querySelector('.xt-pagination__jump input, .xt-pagination__jump .el-input__inner');
    const jumpMax = toPositiveInt(jumpInput?.getAttribute('max'));
    const totalPages = Math.max(currentPage, jumpMax, ...visiblePages, 1);
    const prevButton = root.querySelector('.btn-prev');
    const nextButton = root.querySelector('.btn-next');

    return {
      currentPage,
      totalPages,
      pageSize: 20,
      estimatedTotal: totalPages * 20,
      hasPrev: !(prevButton instanceof HTMLButtonElement && prevButton.disabled),
      hasNext: !(nextButton instanceof HTMLButtonElement && nextButton.disabled),
      visiblePages,
      showQuickJumper: Boolean(jumpInput),
    };
  });
}

async function jumpToPaginationPage(page, targetPage, log, signal) {
  const pagination = await extractPagination(page);
  if (!pagination) {
    log.warn('当前页未找到分页组件，跳过翻页');
    return null;
  }

  const desiredPage = Math.max(1, Math.min(normalizePositiveInt(targetPage, 1), pagination.totalPages || 1));
  if (desiredPage === pagination.currentPage) {
    return pagination;
  }

  const footer = page.locator('.pagination.xt-space, .el-pagination.xt-pagination').first();
  await footer.scrollIntoViewIfNeeded().catch(() => {});

  const firstCreatorBefore = await page.evaluate(() => {
    const cell = document.querySelector('.base-author-list .section-wrapper:not(.sticky-header) .content-column > *:first-child');
    return String(cell?.innerText || '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');

  const jumpInput = footer.locator('.xt-pagination__jump input, .xt-pagination__jump .el-input__inner').first();
  if (!await jumpInput.isVisible().catch(() => false)) {
    log.warn(`分页组件未找到跳转输入框，无法跳转到第 ${desiredPage} 页`);
    return pagination;
  }

  log.info(`切换到搜索结果第 ${desiredPage} 页`);
  await withAbort(signal, jumpInput.click({ force: true }));
  await withAbort(signal, jumpInput.fill(String(desiredPage)));
  await withAbort(signal, jumpInput.press('Enter'));
  await withAbort(signal, page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}));
  await withAbort(signal, page.waitForFunction(({ target, beforeText }) => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    const activePage = Number.parseInt(String(document.querySelector('.el-pagination.xt-pagination .el-pager .active')?.textContent || ''), 10);
    if (activePage !== target) {
      return false;
    }

    const cell = document.querySelector('.base-author-list .section-wrapper:not(.sticky-header) .content-column > *:first-child');
    const currentText = clean(cell?.innerText || '');
    return !beforeText || currentText !== beforeText || activePage === target;
  }, { target: desiredPage, beforeText: firstCreatorBefore }, { timeout: 12000 }).catch(() => {}));
  await waitForCreatorTableReady(page, 12000, signal);
  await withAbort(signal, page.waitForTimeout(900));

  return extractPagination(page);
}

async function collectCurrentCreatorResultsPage(ctx, options = {}) {
  const signal = ctx && ctx.task ? ctx.task.signal : null;
  ctx.log.info('复用当前达人广场结果页');
  const marketState = await openCreatorMarket(ctx.page, signal);
  if (!marketState.reusedCurrentPage) {
    ctx.log.warn('当前未停留在达人广场结果页，已打开达人广场首页');
  }

  const targetPage = normalizePositiveInt(options.page, 1);
  let pagination = await extractPagination(ctx.page);
  if (!pagination) {
    const emptyState = await extractCreatorEmptyState(ctx.page);
    if (emptyState && emptyState.message) {
      const selector = emptyState.selector || emptyState.classNames?.join(' ') || 'unknown-selector';
      ctx.log.warn(`当前结果页为空，命中空状态 ${selector}，提示: ${emptyState.message}`);
      throw new Error(emptyState.message);
    }
    throw new Error('当前达人广场页面未找到分页结果，请先执行一次搜索');
  }

  throwIfAborted(signal);
  pagination = await jumpToPaginationPage(ctx.page, targetPage, ctx.log, signal) || pagination;
  const readyState = await waitForCreatorTableReady(ctx.page, 12000, signal);
  if (readyState && readyState.state === 'empty') {
    await throwCreatorEmptyStateError(ctx.page, ctx.log, '当前页暂无可展示的达人结果');
  }

  throwIfAborted(signal);
  const table = await extractCreatorTable(ctx.page);
  if (table.results.length) {
    return {
      results: table.results,
      diagnostics: table.diagnostics,
      pagination,
    };
  }

  throwIfAborted(signal);
  const cardResults = await extractCreatorCards(ctx.page);
  if (cardResults.length) {
    return {
      results: cardResults,
      diagnostics: table.diagnostics,
      pagination,
    };
  }

  await throwCreatorEmptyStateError(ctx.page, ctx.log, '当前页暂无可展示的达人结果');
}

async function openCreatorMarket(page, signal) {
  const reusedCurrentPage = isCreatorMarketUrl(page.url());
  if (!isCreatorMarketUrl(page.url())) {
    await withAbort(signal, page.goto(MARKET_URL, { waitUntil: 'domcontentloaded' }));
  }
  await withAbort(signal, page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}));
  if (isLoginUrl(page.url())) {
    throw new Error('进入达人市场时登录态失效，请先进入账号后台确认登录状态');
  }
  return {
    reusedCurrentPage,
  };
}

async function scrollMarketToTop(page, signal) {
  await closeOpenDropdown(page);
  await withAbort(signal, page.keyboard.press('Home').catch(() => {}));
  await page.evaluate(() => {
    const targets = [];
    if (document.scrollingElement) {
      targets.push(document.scrollingElement);
    }
    if (document.documentElement) {
      targets.push(document.documentElement);
    }
    if (document.body) {
      targets.push(document.body);
    }

    const visibleScrollable = Array.from(document.querySelectorAll('*'))
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY || '';
        return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 20;
      });

    for (const element of [...targets, ...visibleScrollable]) {
      element.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await withAbort(signal, page.waitForTimeout(180));
}

async function clearSelectedConditions(page, log, signal) {
  const clearCandidates = [
    page.locator('.search-content--header').getByText('清空', { exact: true }).first(),
    page.locator('.search-content').getByText('清空', { exact: true }).first(),
  ];

  for (const candidate of clearCandidates) {
    if (!await candidate.isVisible().catch(() => false)) {
      continue;
    }
    await withAbort(signal, candidate.click());
    await withAbort(signal, page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}));
    await withAbort(signal, page.waitForTimeout(300));
    log.info('已清空当前已选条件');
    return true;
  }

  log.info('当前页未找到已选条件清空按钮，跳过清空');
  return false;
}

async function resetCooperationFilters(page, log, signal) {
  await waitForCooperationFilters(page);
  const row = cooperationRow(page);
  const resetButton = row.getByText('重置', { exact: true }).first();
  if (!await resetButton.isVisible().catch(() => false)) {
    log.info('当前页未找到合作诉求重置按钮，跳过重置');
    return false;
  }

  await withAbort(signal, resetButton.click());
  await withAbort(signal, page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}));
  await withAbort(signal, page.waitForTimeout(350));
  return true;
}

async function prepareMarketForSearch(page, log, options = {}) {
  const reusedCurrentPage = Boolean(options.reusedCurrentPage);
  const signal = options.signal || null;
  await scrollMarketToTop(page, signal);
  await waitForCooperationFilters(page);
  if (reusedCurrentPage) {
    log.info('复用当前达人广场页面，回到顶部并清空后重置筛选条件');
  } else {
    log.info('已进入达人广场，先清空已选条件再重置筛选条件');
  }
  await clearSelectedConditions(page, log, signal);
  await resetCooperationFilters(page, log, signal);
}

async function searchCreators(ctx, keyword, filters, options = {}) {
  const signal = ctx && ctx.task ? ctx.task.signal : null;
  throwIfAborted(signal);
  ctx.log.info('打开星图达人市场');
  const marketState = await openCreatorMarket(ctx.page, signal);
  throwIfAborted(signal);
  await prepareMarketForSearch(ctx.page, ctx.log, { ...marketState, signal });
  const searchMode = normalizeSearchMode(options.searchMode);
  ctx.log.info('清空筛选条件不会重置搜索模式，搜索前将强制校验当前模式');

  const normalizedFilters = normalizeFilters(filters);
  const hasFilters = normalizedFilters.collaborationObject !== '不限'
    || normalizedFilters.creatorTypes.length > 0
    || normalizedFilters.shortDramaSelections.length > 0
    || normalizedFilters.shortLiveSelections.length > 0
    || normalizedFilters.extraCreatorTypes.length > 0
    || normalizedFilters.industry !== '不限'
    || normalizedFilters.goals.length > 0
    || normalizedFilters.grassSelections.length > 0
    || normalizedFilters.audienceMode !== '不限'
    || normalizedFilters.audienceLabels.length > 0
    || normalizedFilters.matchSelections.length > 0
    || hasActiveMatchFilters(normalizedFilters.matchFilters)
    || hasActiveCostPerformanceFilters(normalizedFilters)
    || Object.values(normalizedFilters.topicRecommendationSelections || {}).some((item) => countOptionPopoverSelections(item) > 0)
    || normalizedFilters.topicRecommendationTags.length > 0;

  if (hasFilters) {
    ctx.log.info('应用合作诉求筛选条件');
    await applyCooperationFilters(ctx.page, normalizedFilters, ctx.log);
    if (normalizedFilters.matchSelections.length > 0 || hasActiveMatchFilters(normalizedFilters.matchFilters)) {
      ctx.log.info('应用匹配度筛选条件');
      await applyMatchFilters(ctx.page, normalizedFilters.matchFilters, ctx.log);
    }
    if (hasActiveCostPerformanceFilters(normalizedFilters)) {
      ctx.log.info('应用性价比筛选条件');
      await applyCostPerformanceFilters(ctx.page, normalizedFilters, ctx.log);
    }
    if (normalizedFilters.topicRecommendationTags.length > 0) {
      ctx.log.info('应用主题推荐筛选条件');
      await applyTopicRecommendationSelectionFilters(ctx.page, normalizedFilters.topicRecommendationSelections, ctx.log);
      await applyTopicRecommendationFilters(ctx.page, normalizedFilters.topicRecommendationTags);
    } else if (Object.values(normalizedFilters.topicRecommendationSelections || {}).some((item) => countOptionPopoverSelections(item) > 0)) {
      ctx.log.info('应用主题推荐筛选条件');
      await applyTopicRecommendationSelectionFilters(ctx.page, normalizedFilters.topicRecommendationSelections, ctx.log);
    }
    await withAbort(signal, ctx.page.waitForTimeout(500));
  }

  throwIfAborted(signal);
  // 清空、重置和筛选操作都不应假设会恢复默认搜索模式，这里每次搜索前都重新校验。
  await applySearchMode(ctx.page, searchMode, ctx.log);
  ctx.log.info(`输入达人关键词: ${keyword}`);
  const searchInput = await findSearchInput(ctx.page);
  await withAbort(signal, searchInput.fill(keyword));

  throwIfAborted(signal);
  ctx.log.info('触发达人搜索');
  await triggerSearch(ctx.page, signal);
  await withAbort(signal, ctx.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}));
  const readyState = await waitForCreatorTableReady(ctx.page, 12000, signal);
  if (readyState && readyState.state === 'empty') {
    await throwCreatorEmptyStateError(ctx.page, ctx.log, '当前搜索暂无结果，请调整关键词或筛选条件后重试');
  }
  await withAbort(signal, ctx.page.waitForTimeout(1200));

  const targetPage = normalizePositiveInt(options.page, 1);
  throwIfAborted(signal);
  let pagination = await extractPagination(ctx.page);
  if (targetPage > 1) {
    pagination = await jumpToPaginationPage(ctx.page, targetPage, ctx.log, signal) || pagination;
  }

  throwIfAborted(signal);
  const table = await extractCreatorTable(ctx.page);
  if (table.results.length) {
    return {
      results: table.results,
      diagnostics: table.diagnostics,
      pagination,
    };
  }

  throwIfAborted(signal);
  const cardResults = await extractCreatorCards(ctx.page);
  if (cardResults.length) {
    return {
      results: cardResults,
      diagnostics: table.diagnostics,
      pagination,
    };
  }

  await throwCreatorEmptyStateError(ctx.page, ctx.log, '当前搜索暂无结果，请调整关键词或筛选条件后重试');
}

module.exports = {
  MARKET_URL,
  collectCurrentCreatorResultsPage,
  searchCreators,
  __test__: {
    hasActiveMatchFilters,
    hasActiveCostPerformanceFilters,
    normalizeFilters,
  },
};
