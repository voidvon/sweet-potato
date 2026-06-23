'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test__ } = require('./creator-market');

test('normalizeFilters accepts plain short drama topic labels from chat capability payloads', () => {
  const filters = __test__.normalizeFilters({
    creatorTypes: ['短剧演员'],
    shortDramaSelections: ['职场'],
  });

  assert.deepEqual(filters.shortDramaSelections, ['抖音定制短剧达人/职场']);
});

test('normalizeFilters keeps leaf short drama actors executable', () => {
  const filters = __test__.normalizeFilters({
    creatorTypes: ['短剧演员'],
    shortDramaSelections: ['红果短剧演员'],
  });

  assert.deepEqual(filters.shortDramaSelections, ['红果短剧演员']);
});

test('normalizeFilters keeps one short drama child per parent group', () => {
  const filters = __test__.normalizeFilters({
    creatorTypes: ['短剧演员'],
    shortDramaSelections: ['甜宠', '搞笑'],
  });

  assert.deepEqual(filters.shortDramaSelections, ['抖音定制短剧达人/搞笑']);
});

test('normalizeFilters keeps only one creator topic group', () => {
  const filters = __test__.normalizeFilters({
    creatorTypes: ['短视频达人'],
    shortDramaSelections: ['红果短剧演员'],
    shortLiveSelections: ['带货达人'],
    extraCreatorTypes: ['合集达人'],
  });

  assert.deepEqual(filters.creatorTypes, ['短剧演员']);
  assert.deepEqual(filters.shortDramaSelections, ['红果短剧演员']);
  assert.deepEqual(filters.shortLiveSelections, []);
  assert.deepEqual(filters.extraCreatorTypes, []);
});

test('normalizeFilters adapts backend semantic labels to xingtu UI labels', () => {
  const filters = __test__.normalizeFilters({
    industry: '美妆个护',
    matchFilters: {
      region: '上海',
    },
  });

  assert.equal(filters.industry, '美妆');
  assert.deepEqual(filters.matchFilters.region, {
    default: ['上海市'],
  });
  assert.equal(__test__.hasActiveMatchFilters(filters.matchFilters), true);
});

test('normalizeFilters keeps cost performance and topic recommendation filters', () => {
  const filters = __test__.normalizeFilters({
    costPerformanceSelections: {
      预期CPM: {
        __root__: ['30以下'],
      },
      达人报价: {
        __root__: ['5w-10w'],
      },
    },
    costPerformanceRanges: {
      进行中的任务数: {
        任务数量: {
          min: '1',
          max: '3',
        },
      },
    },
    costPerformancePriceQuote: {
      quoteType: {
        __root__: ['21-60s视频'],
      },
    },
    topicRecommendationTags: ['高性价比达人'],
    topicRecommendationSelections: {
      抖音精选品牌伙伴计划: {
        __root__: ['人感种草'],
      },
    },
  });

  assert.deepEqual(filters.costPerformanceSelections.预期CPM, {
    __root__: ['30以下'],
  });
  assert.equal(filters.costPerformanceSelections.达人报价, undefined);
  assert.equal(filters.costPerformanceRanges.进行中的任务数, undefined);
  assert.deepEqual(filters.costPerformanceTaskCount, {
    taskTime: {},
    taskCount: {
      min: '1',
      max: '3',
    },
  });
  assert.deepEqual(filters.costPerformancePriceQuote, {
    quoteType: {
      __root__: ['21-60s视频'],
    },
    quoteRange: {
      __root__: ['5w-10w'],
    },
    customRange: {},
  });
  assert.deepEqual(filters.topicRecommendationTags, ['高性价比达人']);
  assert.deepEqual(filters.topicRecommendationSelections.抖音精选品牌伙伴计划, {
    __root__: ['人感种草'],
  });
  assert.equal(__test__.hasActiveCostPerformanceFilters(filters), true);
});

test('normalizeFilters restores price quote filters from match selection tokens', () => {
  const filters = __test__.normalizeFilters({
    matchSelections: [
      '性价比/达人报价/报价类型/21-60s视频',
      '性价比/达人报价/报价区间/5w-10w',
      '性价比/预期播放量/__root__/10w-100w',
    ],
    costPerformanceSelections: {
      预期播放量: {
        __root__: ['10w-100w'],
      },
    },
  });

  assert.deepEqual(filters.costPerformancePriceQuote, {
    quoteType: {
      __root__: ['21-60s视频'],
    },
    quoteRange: {
      __root__: ['5w-10w'],
    },
    customRange: {},
  });
  assert.deepEqual(filters.costPerformanceSelections.预期播放量, {
    __root__: ['10w-100w'],
  });
  assert.equal(__test__.hasActiveCostPerformanceFilters(filters), true);
});
