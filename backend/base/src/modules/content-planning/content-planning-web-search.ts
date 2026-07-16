import { jsonrepair } from 'jsonrepair';
import { resolveDefaultLlmModel } from '../content/configured-llm.client.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import type { ContentPlanningSession } from './content-planning.types.js';

export type ContentPlanningWebSearchResult = {
  query: string;
  title: string;
  url: string;
  snippet: string;
};

export type ContentPlanningWebSearchContext = {
  enabled: boolean;
  queries: string[];
  results: ContentPlanningWebSearchResult[];
  summary?: string | null;
  errorMessage?: string | null;
  searchedAt?: string | null;
};

type SearchOptions = {
  fetchImpl?: typeof fetch;
  maxQueries?: number;
  maxResults?: number;
  modelConfig?: AiModelConfig;
  timeoutMs?: number;
};

type ArkWebSearchOutput = {
  summary?: string | null;
  results?: Array<Partial<ContentPlanningWebSearchResult>>;
  errorMessage?: string | null;
};

const defaultTimeoutMs = 120_000;

export function buildContentPlanningWebSearchQueries(session: ContentPlanningSession) {
  const productName = session.materialBundle.productName.trim();
  const insights = session.analysis.productInsights;
  const category = insights.productCategory.trim();
  const sellingPoints = insights.coreSellingPoints.slice(0, 3).join(' ');
  const scenarios = insights.useScenarios.slice(0, 2).join(' ');
  const contentType = session.settings.contentType.trim();
  const baseTerms = [productName, category, sellingPoints].filter(Boolean).join(' ').trim();
  const queries = [
    [baseTerms, '短视频 爆款 卖点 趋势'].filter(Boolean).join(' '),
    [productName || category, scenarios, contentType, '用户痛点 使用场景'].filter(Boolean).join(' '),
  ]
    .map((query) => query.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return Array.from(new Set(queries)).slice(0, 2);
}

export async function buildContentPlanningWebSearchContext(
  session: ContentPlanningSession,
  options: SearchOptions = {},
): Promise<ContentPlanningWebSearchContext> {
  if (!session.settings.webSearch) {
    return {
      enabled: false,
      queries: [],
      results: [],
      summary: null,
      errorMessage: null,
      searchedAt: null,
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxQueries = Math.max(1, options.maxQueries || 2);
  const maxResults = Math.max(1, options.maxResults || 5);
  const queries = buildContentPlanningWebSearchQueries(session).slice(0, maxQueries);

  try {
    const searchOutput = await fetchArkWebSearchOutput({
      fetchImpl,
      maxResults,
      modelConfig: options.modelConfig || resolveDefaultLlmModel(),
      queries,
      session,
      timeoutMs: options.timeoutMs || defaultTimeoutMs,
    });
    return {
      enabled: true,
      queries,
      results: normalizeArkSearchResults(searchOutput.results || [], queries).slice(0, maxResults),
      summary: normalizeSearchText(searchOutput.summary || ''),
      errorMessage: normalizeSearchText(searchOutput.errorMessage || '') || null,
      searchedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      enabled: true,
      queries,
      results: [],
      summary: null,
      errorMessage: errorMessage(error),
      searchedAt: new Date().toISOString(),
    };
  }
}

async function fetchArkWebSearchOutput(input: {
  fetchImpl: typeof fetch;
  maxResults: number;
  modelConfig: AiModelConfig;
  queries: string[];
  session: ContentPlanningSession;
  timeoutMs: number;
}): Promise<ArkWebSearchOutput> {
  if (!input.modelConfig.apiKey) {
    throw new Error('默认大模型缺少 API Key，无法调用模型联网搜索工具');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(responsesUrl(input.modelConfig.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.modelConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelConfig.model,
        stream: false,
        tools: [
          { type: 'web_search' },
        ],
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  '你是短视频爆款策划的联网检索助手。',
                  '必须使用模型提供的 web_search 工具查询实时信息。',
                  '只返回 JSON，不要 Markdown，不要输出隐藏推理过程。',
                  'JSON 格式：{"summary":"一句话趋势摘要","results":[{"query":"检索词","title":"来源标题","url":"来源 URL","snippet":"与短视频策划相关的趋势、用户关注点或竞品表达"}]}',
                  `最多返回 ${input.maxResults} 条 results；url 不确定时留空，不要编造来源。`,
                ].join('\n'),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildArkWebSearchPrompt(input.session, input.queries),
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response));
    }
    const data = await response.json() as unknown;
    const modelText = extractResponsesText(data);
    if (!modelText.trim()) {
      throw new Error('模型联网搜索未返回有效文本');
    }
    return parseArkWebSearchOutput(modelText);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('模型联网搜索响应超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildArkWebSearchPrompt(session: ContentPlanningSession, queries: string[]) {
  return JSON.stringify({
    task: '围绕商品短视频脚本生成做实时联网检索，提炼可用于创意方向的趋势、用户关注点、竞品表达和使用场景。',
    queries,
    product: {
      name: session.materialBundle.productName,
      prompt: session.materialBundle.prompt,
      category: session.analysis.productInsights.productCategory,
      coreSellingPoints: session.analysis.productInsights.coreSellingPoints,
      targetAudience: session.analysis.productInsights.targetAudience,
      useScenarios: session.analysis.productInsights.useScenarios,
    },
    settings: {
      businessScene: session.settings.businessScene,
      contentType: session.settings.contentType,
      shootingMethod: session.settings.shootingMethod,
      spokenLanguage: session.settings.spokenLanguage,
      durationSeconds: session.settings.durationSeconds,
      styleKeywords: session.settings.styleKeywords,
    },
  }, null, 2);
}

function responsesUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (/\/responses$/iu.test(normalized)) {
    return normalized;
  }
  if (/\/chat\/completions$/iu.test(normalized)) {
    return normalized.replace(/\/chat\/completions$/iu, '/responses');
  }
  return `${normalized}/responses`;
}

async function responseErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `模型联网搜索请求失败：${response.status}`;
  }
  try {
    const data = JSON.parse(text) as { error?: { message?: string } };
    return data.error?.message || `模型联网搜索请求失败：${response.status}`;
  } catch {
    return `模型联网搜索请求失败：${response.status} ${text.slice(0, 180)}`;
  }
}

function parseArkWebSearchOutput(text: string): ArkWebSearchOutput {
  const normalized = text.trim().replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim();
  const match = normalized.match(/\{[\s\S]*\}/u);
  if (!match) {
    return {
      summary: normalized,
      results: [],
    };
  }
  try {
    return JSON.parse(match[0]) as ArkWebSearchOutput;
  } catch {
    return JSON.parse(jsonrepair(match[0])) as ArkWebSearchOutput;
  }
}

function extractResponsesText(data: unknown) {
  const root = asRecord(data);
  if (!root) {
    return '';
  }
  if (typeof root.output_text === 'string') {
    return root.output_text;
  }
  const texts: string[] = [];
  collectResponseTexts(root.output, texts);
  if (!texts.length) {
    collectResponseTexts(root.choices, texts);
  }
  return texts.join('\n').trim();
}

function collectResponseTexts(value: unknown, texts: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectResponseTexts(item, texts));
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  if (typeof record.text === 'string') {
    texts.push(record.text);
  }
  if (typeof record.content === 'string') {
    texts.push(record.content);
  } else {
    collectResponseTexts(record.content, texts);
  }
  collectResponseTexts(record.message, texts);
}

function normalizeArkSearchResults(
  results: Array<Partial<ContentPlanningWebSearchResult>>,
  fallbackQueries: string[],
) {
  return dedupeSearchResults(results.map((result, index) => {
    const snippet = normalizeSearchText(result.snippet || '').slice(0, 240);
    return {
      query: normalizeSearchText(result.query || fallbackQueries[index % Math.max(fallbackQueries.length, 1)] || ''),
      title: normalizeSearchText(result.title || (snippet ? '联网搜索摘要' : '')).slice(0, 120),
      url: normalizeSearchText(result.url || ''),
      snippet,
    };
  }).filter((result) => result.snippet || result.url));
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function dedupeSearchResults(results: ContentPlanningWebSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url || `${result.title}:${result.snippet}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '模型联网搜索失败');
}
