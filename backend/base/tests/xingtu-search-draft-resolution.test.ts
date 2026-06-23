import assert from 'node:assert/strict';
import test from 'node:test';
import { xingtuChatCapabilityHandler } from '../src/modules/chat/capabilities/chat-capability-xingtu.provider.js';
import { resolveChatCapabilityInvocation } from '../src/modules/chat/chat-capability.service.js';
import { mapXingtuDraftToAutomationInput } from '../src/modules/xingtu-search-drafts/xingtu-filter-mapper.js';

test('xingtu mapper prefers AI-provided automation filters over criteria translation', () => {
  const preview = mapXingtuDraftToAutomationInput({
    id: 'draft_1',
    userId: 'user_1',
    profileId: 'profile_1',
    keyword: '职场',
    searchMode: 'content',
    criteria: [],
    automationFilters: {
      shortDramaSelections: ['红果短剧演员', '抖音红果双发演员', '抖音定制短剧达人'],
    },
    status: 'draft',
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  }, 1);

  assert.deepEqual(preview.automationInput, {
    keyword: '职场',
    searchMode: 'content',
    page: 1,
    filters: {
      shortDramaSelections: ['红果短剧演员', '抖音红果双发演员', '抖音定制短剧达人'],
    },
  });
  assert.deepEqual(preview.unsupportedCriteria, []);
});

test('xingtu capability invocation strips full-width mention token before resolving intent', () => {
  const invocation = resolveChatCapabilityInvocation(
    '＠星图达人 帮我查询一下关于职场的达人，要求是短剧演员',
    ['xingtu_creator_search'],
  );

  assert.equal(invocation?.capability, 'xingtu_creator_search');
  assert.equal(invocation?.cleanedContent, '帮我查询一下关于职场的达人，要求是短剧演员');
});

test('xingtu capability answers filter option questions without creating search action', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  const responses = [
    JSON.stringify({
      choices: [{
        message: {
          content: '{"intent":"filter_options_question"}',
        },
      }],
    }),
    JSON.stringify({
      choices: [{
        message: {
          content: '可以按合作诉求和匹配度筛选，例如适配行业、达人类型、内容主题等。',
        },
      }],
    }),
  ];
  let responseIndex = 0;

  globalThis.fetch = (async (_url, init) => {
    requestBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(responses[responseIndex++], {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await xingtuChatCapabilityHandler.execute({
      userId: 'user_1',
      content: '当前可以进行筛选的数据选项有哪些，给我举例一下',
      history: [],
      agent: {
        id: 'agent_1',
        name: 'quick-answer',
        description: '',
        icon: 'chat',
        builtIn: true,
        capabilities: ['chat'],
        runMode: 'quick',
        modelConfigId: null,
        systemPrompt: '',
        tools: [],
        skills: [],
        retrievalStrategy: 'semantic',
        webSearchEnabled: false,
        multimodal: {
          imageUpload: false,
          fileUpload: false,
        },
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      modelConfig: {
        id: 'model_1',
        type: 'llm',
        name: 'model',
        provider: 'test',
        model: 'test-model',
        apiKey: 'test-key',
        baseUrl: 'https://llm.example/v1',
        temperature: 0.1,
        isDefault: true,
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
    });

    assert.match(result.assistantContent, /合作诉求和匹配度/);
    assert.equal(result.assistantActions, undefined);
    assert.deepEqual(result.metadata, {});
    assert.equal(requestBodies.length, 2);
    assert.equal((requestBodies[0] as { stream?: boolean } | null)?.stream, false);
    const intentRequest = requestBodies[0] as { messages: Array<{ role: string; content: string }> };
    const optionsRequest = requestBodies[1] as { messages: Array<{ role: string; content: string }> };
    const intentPayload = JSON.parse(intentRequest.messages[1].content) as { task?: string };
    const optionsPayload = JSON.parse(optionsRequest.messages[1].content) as { task?: string; filterSchema?: unknown };

    assert.match(intentRequest.messages[0].content, /星图达人能力助手/);
    assert.equal(intentPayload.task, 'intent_classification');
    assert.equal(optionsPayload.task, 'filter_options_question');
    assert.ok(Array.isArray(optionsPayload.filterSchema));
    assert.doesNotMatch(optionsRequest.messages[1].content, /完整星图筛选 JSON如下/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('xingtu capability confirmation content includes persona industry selections', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  const responses = [
    JSON.stringify({
      choices: [{
        message: {
          content: '{"intent":"search_plan"}',
        },
      }],
    }),
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
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
        },
      }],
    }),
    JSON.stringify({
      choices: [{
        message: {
          content: '{"ok":true,"issues":[]}',
        },
      }],
    }),
    JSON.stringify({
      choices: [{
        message: {
          content: '已整理筛选条件：搜索词“职场”，UI 筛选 matchFilters/personaIndustrySelections/食品饮料：品酒家/调酒师。确认后执行搜索。',
        },
      }],
    }),
  ];
  let responseIndex = 0;

  globalThis.fetch = (async (_url, init) => {
    requestBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(responses[responseIndex++], {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await xingtuChatCapabilityHandler.execute({
      userId: 'user_1',
      content: '帮我查询职场相关，人设是调酒师的达人',
      history: [],
      capabilityContext: {
        xingtuProfileId: 'profile_1',
      },
      agent: {
        id: 'agent_1',
        name: 'quick-answer',
        description: '',
        icon: 'chat',
        builtIn: true,
        capabilities: ['chat'],
        runMode: 'quick',
        modelConfigId: null,
        systemPrompt: '',
        tools: [],
        skills: [],
        retrievalStrategy: 'semantic',
        webSearchEnabled: false,
        multimodal: {
          imageUpload: false,
          fileUpload: false,
        },
        createdAt: '2026-06-08T00:00:00.000Z',
      },
      modelConfig: {
        id: 'model_1',
        type: 'llm',
        name: 'model',
        provider: 'test',
        model: 'test-model',
        apiKey: 'test-key',
        baseUrl: 'https://llm.example/v1',
        temperature: 0.1,
        isDefault: true,
        createdAt: '2026-06-08T00:00:00.000Z',
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
    });

    assert.match(result.assistantContent, /已整理筛选条件/);
    assert.match(result.assistantContent, /matchFilters\/personaIndustrySelections\/食品饮料：品酒家\/调酒师/);
    assert.doesNotMatch(result.assistantContent, /当前没有额外筛选项/);
    assert.equal(requestBodies.length, 4);
    const confirmationRequest = requestBodies[3] as { messages: Array<{ content: string }> };
    const confirmationPayload = JSON.parse(confirmationRequest.messages[1].content) as { task?: string };
    assert.equal(confirmationPayload.task, 'plan_confirmation');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
