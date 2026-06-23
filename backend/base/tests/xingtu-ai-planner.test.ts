import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeXingtuAiPlan, planXingtuSearchWithAi } from '../src/modules/chat/capabilities/chat-capability-xingtu.ai.js';

function mockModelResponses(contents: string[]) {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  let index = 0;

  globalThis.fetch = (async (_url, init) => {
    requests.push(init?.body ? JSON.parse(String(init.body)) : null);
    const content = contents[index++];
    if (content === undefined) {
      throw new Error('Unexpected model request');
    }
    return new Response(JSON.stringify({
      choices: [{
        message: { content },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    requests,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

const TEST_MODEL_CONFIG = {
  id: 'model_1',
  type: 'llm' as const,
  name: 'model',
  provider: 'test',
  model: 'test-model',
  apiKey: 'test-key',
  baseUrl: 'https://llm.example/v1',
  temperature: 0.1,
  isDefault: true,
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z',
};

test('normalizeXingtuAiPlan preserves AI criteria labels and normalizes money ranges only', () => {
  const plan = normalizeXingtuAiPlan({
    keyword: '职场',
    searchMode: 'content',
    criteria: [
      { field: 'creator_type', op: 'in', value: ['短剧演员'] },
      { field: 'short_drama_topic', op: 'in', value: ['办公室'] },
      { field: 'region', op: 'eq', value: '北京地区' },
      { field: 'quote_21_60s', op: 'lte', value: '1万以内' },
    ],
    assumptions: ['把办公室视为职场题材'],
    unresolvedTerms: ['高转化'],
  }, {
    currentInput: '找北京职场相关的短剧演员，21-60 秒报价 1 万以内',
  });

  assert.equal(plan.keyword, '职场');
  assert.equal(plan.searchMode, 'content');
  assert.deepEqual(plan.criteria, [
    { field: 'creator_type', op: 'in', value: ['短剧演员'] },
    { field: 'short_drama_topic', op: 'in', value: ['办公室'] },
    { field: 'region', op: 'eq', value: '北京地区' },
    { field: 'quote_21_60s', op: 'lte', value: '10000' },
  ]);
  assert.deepEqual(plan.automationFilters, {});
  assert.deepEqual(plan.assumptions, ['把办公室视为职场题材']);
  assert.deepEqual(plan.unresolvedTerms, ['高转化']);
});

test('normalizeXingtuAiPlan preserves AI-provided short drama topic criteria', () => {
  const plan = normalizeXingtuAiPlan({
    keyword: '职场',
    searchMode: 'content',
    criteria: [
      { field: 'creator_type', op: 'in', value: ['短剧演员'] },
      { field: 'short_drama_topic', op: 'in', value: ['职场'] },
    ],
  }, {
    currentInput: '帮我查询一下职场相关，并且需要是短剧演员的',
  });

  assert.deepEqual(plan.criteria, [
    { field: 'creator_type', op: 'in', value: ['短剧演员'] },
    { field: 'short_drama_topic', op: 'in', value: ['职场'] },
  ]);
  assert.deepEqual(plan.automationFilters, {});
});

test('normalizeXingtuAiPlan does not infer criteria from raw text when model criteria are missing', () => {
  const plan = normalizeXingtuAiPlan({
    keyword: '',
    searchMode: 'content',
    criteria: [],
  }, {
    currentInput: '帮我查询一下职场相关，并且需要是短剧演员的',
  });

  assert.equal(plan.keyword, '帮我查询一下职场相关，并且需要是短剧演员的');
  assert.deepEqual(plan.criteria, []);
  assert.deepEqual(plan.automationFilters, {});
});

test('normalizeXingtuAiPlan preserves AI-generated real automation filters', () => {
  const plan = normalizeXingtuAiPlan({
    keyword: '职场',
    searchMode: 'content',
    criteria: [
      { field: 'creator_type', op: 'in', value: ['短剧演员'] },
    ],
    automationFilters: {
      shortDramaSelections: ['红果短剧演员', '抖音红果双发演员', '抖音定制短剧达人'],
    },
  }, {
    currentInput: '帮我查询一下职场相关，并且需要是短剧演员的',
  });

  assert.deepEqual(plan.automationFilters, {
    shortDramaSelections: ['红果短剧演员', '抖音红果双发演员', '抖音定制短剧达人'],
  });
});

test('normalizeXingtuAiPlan accepts full schema-driven filters and match filters', () => {
  const plan = normalizeXingtuAiPlan({
    keyword: '美妆',
    searchMode: 'content',
    filters: {
      creatorTypes: ['短视频达人'],
      industry: '美妆',
      goals: ['破圈种草'],
      grassSelections: ['A3人群增量'],
      matchFilters: {
        creatorTypeSelections: {
          美妆: ['护肤保养'],
        },
        personaCareer: {
          职业: ['医生'],
        },
        region: ['上海市'],
        connectedUsers: {
          连接用户数: {
            min: '10000',
            max: '',
          },
        },
      },
    },
  }, {
    currentInput: '找上海美妆短视频达人，护肤保养，医生人设，连接用户数 1 万以上',
  });

  assert.deepEqual(plan.automationFilters, {
    creatorTypes: ['短视频达人'],
    industry: '美妆',
    goals: ['破圈种草'],
    grassSelections: ['A3人群增量'],
    matchFilters: {
      creatorTypeSelections: {
        美妆: ['护肤保养'],
      },
      personaCareer: {
        职业: ['医生'],
      },
      region: ['上海市'],
      connectedUsers: {
        连接用户数: {
          min: '10000',
          max: '',
        },
      },
    },
  });
});

test('planXingtuSearchWithAi repairs plans rejected by AI validation', async () => {
  const mock = mockModelResponses([
    JSON.stringify({
      keyword: '目标主题',
      searchMode: 'content',
      criteria: [],
      automationFilters: {},
      assumptions: [],
      unresolvedTerms: [],
    }),
    JSON.stringify({
      ok: false,
      issues: ['planner 未把用户明确筛选要求放入 automationFilters'],
    }),
    JSON.stringify({
      keyword: '目标主题',
      searchMode: 'content',
      criteria: [],
      automationFilters: {
        matchFilters: {
          creatorTypeSelections: {
            筛选分组: ['筛选选项'],
          },
        },
      },
      assumptions: [],
      unresolvedTerms: [],
    }),
    JSON.stringify({
      ok: true,
      issues: [],
    }),
  ]);

  try {
    const plan = await planXingtuSearchWithAi({
      modelConfig: TEST_MODEL_CONFIG,
      history: [],
      currentInput: '找目标主题，并使用我描述的筛选条件',
    });

    assert.equal(mock.requests.length, 4);
    assert.deepEqual(plan.validationIssues, []);
    assert.deepEqual(plan.automationFilters, {
      matchFilters: {
        creatorTypeSelections: {
          筛选分组: ['筛选选项'],
        },
      },
    });
  } finally {
    mock.restore();
  }
});

test('planXingtuSearchWithAi sends schema-derived option aliases to the model', async () => {
  const mock = mockModelResponses([
    JSON.stringify({
      keyword: '职场',
      searchMode: 'content',
      criteria: [],
      automationFilters: {
        matchFilters: {
          personaIndustrySelections: {
            食品饮料: ['品酒家/调酒师'],
          },
        },
      },
      assumptions: [],
      unresolvedTerms: [],
    }),
    JSON.stringify({
      ok: true,
      issues: [],
    }),
  ]);

  try {
    const plan = await planXingtuSearchWithAi({
      modelConfig: TEST_MODEL_CONFIG,
      history: [],
      currentInput: '帮我查询职场相关，人设是调酒师的达人',
    });

    const searchRequest = mock.requests[0] as { messages: Array<{ role: string; content: string }> };
    const payload = JSON.parse(searchRequest.messages[1].content) as {
      filterOptionIndex: Array<{ path: string; label: string; aliases?: string[] }>;
      matchedFilterOptionCandidates: Array<{ path: string; label: string; matchedBy?: string }>;
    };
    const bartenderOption = payload.filterOptionIndex.find((item) => item.label === '品酒家/调酒师');
    const bartenderCandidate = payload.matchedFilterOptionCandidates.find((item) => item.label === '品酒家/调酒师');

    assert.ok(bartenderOption);
    assert.match(bartenderOption.path, /达人人设\/行业特色人设\/食品饮料\/品酒家\/调酒师/);
    assert.ok(bartenderOption.aliases?.includes('调酒师'));
    assert.ok(bartenderCandidate);
    assert.equal(bartenderCandidate.matchedBy, '调酒师');
    assert.deepEqual(plan.automationFilters, {
      matchFilters: {
        personaIndustrySelections: {
          食品饮料: ['品酒家/调酒师'],
        },
      },
    });
  } finally {
    mock.restore();
  }
});

test('planXingtuSearchWithAi returns AI validation issues after failed repair', async () => {
  const mock = mockModelResponses([
    JSON.stringify({
      keyword: '目标主题',
      searchMode: 'content',
      criteria: [],
      automationFilters: {},
      assumptions: [],
      unresolvedTerms: [],
    }),
    JSON.stringify({
      ok: false,
      issues: ['第一次校验失败'],
    }),
    JSON.stringify({
      keyword: '目标主题',
      searchMode: 'content',
      criteria: [],
      automationFilters: {},
      assumptions: [],
      unresolvedTerms: [],
    }),
    JSON.stringify({
      ok: false,
      issues: ['返修后仍缺少可执行筛选项'],
    }),
  ]);

  try {
    const plan = await planXingtuSearchWithAi({
      modelConfig: TEST_MODEL_CONFIG,
      history: [],
      currentInput: '找目标主题，并使用我描述的筛选条件',
    });

    assert.equal(mock.requests.length, 4);
    assert.deepEqual(plan.validationIssues, ['返修后仍缺少可执行筛选项']);
    assert.deepEqual(plan.unresolvedTerms, ['返修后仍缺少可执行筛选项']);
  } finally {
    mock.restore();
  }
});
