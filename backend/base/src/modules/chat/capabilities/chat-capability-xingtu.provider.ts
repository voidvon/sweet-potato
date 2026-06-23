import {
  answerXingtuFilterOptionsQuestionWithAi,
  classifyXingtuCapabilityIntentWithAi,
  generateXingtuPlanConfirmationWithAi,
  type XingtuAiDraftSnapshot,
  planXingtuSearchWithAi,
  summarizeXingtuSearchResultWithAi,
  type XingtuAiSearchPlan,
} from './chat-capability-xingtu.ai.js';
import { xingtuSearchDraftService } from '../../xingtu-search-drafts/xingtu-search-draft.service.js';
import type { ChatCapabilityExecutionInput, ChatCapabilityExecutionResult, ChatCapabilityHandler, ChatConversationMetadata } from '../chat-capability.types.js';
import type { ChatMessageAction } from '../chat.types.js';

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function collectFilterSummaryLines(value: unknown, path: string[], lines: string[]) {
  if (Array.isArray(value)) {
    const values = value.map((item) => cleanText(String(item || ''))).filter(Boolean);
    if (path.length && values.length) {
      lines.push(`${path.join('/')}：${values.join('、')}`);
    }
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([key, current]) => {
      const label = cleanText(key);
      if (label) {
        collectFilterSummaryLines(current, [...path, label], lines);
      }
    });
    return;
  }

  const text = cleanText(String(value || ''));
  if (path.length && text && text !== '不限') {
    lines.push(`${path.join('/')}：${text}`);
  }
}

function summarizeParsedFilters(filters: Record<string, unknown>) {
  const lines: string[] = [];
  collectFilterSummaryLines(filters, [], lines);
  return lines;
}

function buildFallbackAssistantContent(result: Awaited<ReturnType<typeof xingtuSearchDraftService.runDraft>>, plan?: XingtuAiSearchPlan) {
  const parsedFilters = summarizeParsedFilters(result.automationInputPreview.filters);
  const lines = [
    '已结合对话内容解析条件，并执行星图达人搜索。',
    `搜索词：${plan?.keyword || result.keyword}`,
  ];

  if (parsedFilters.length) {
    lines.push('解析条件：');
    parsedFilters.forEach((line) => lines.push(`- ${line}`));
  }

  const resultCount = result.results.length;
  const page = result.pagination?.currentPage || 1;
  const totalPages = result.pagination?.totalPages || 1;
  lines.push(`结果：第 ${page}/${totalPages} 页，当前返回 ${resultCount} 条。`);

  const topItems = result.results.slice(0, 5);
  if (topItems.length) {
    lines.push('前 5 条结果：');
    topItems.forEach((item, index) => {
      const name = String(item.name || item.nickname || `达人${index + 1}`).trim();
      const topic = Array.isArray(item.contentTopics)
        ? item.contentTopics.join('、')
        : String(item.contentTopic || item.summary || '').trim();
      const quote = String(item.quote21To60s || item.quote || '').trim();
      lines.push(`${index + 1}. ${name}${topic ? `｜${topic}` : ''}${quote ? `｜21-60秒报价 ${quote}` : ''}`);
    });
  }

  if (result.warnings.length) {
    lines.push('提示：');
    result.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  return lines.join('\n');
}

function buildConfirmSearchAction(): ChatMessageAction[] {
  return [{
    id: 'xingtu_confirm_search',
    label: '确认搜索',
    kind: 'primary',
    submitContent: '@星图达人 确认搜索',
  }];
}

export const xingtuChatCapabilityHandler: ChatCapabilityHandler = {
  capability: 'xingtu_creator_search',
  mentionTokens: ['@星图达人', '＠星图达人'],
  async execute(input: ChatCapabilityExecutionInput): Promise<ChatCapabilityExecutionResult> {
    const metadata = (input.conversation?.metadata || {}) as ChatConversationMetadata;
    const existingDraftId = metadata.capabilityState?.xingtu?.draftId || '';
    const existingProfileId = metadata.capabilityState?.xingtu?.profileId || '';
    const lastPage = metadata.capabilityState?.xingtu?.lastPage || 1;
    const pendingConfirmation = Boolean(metadata.capabilityState?.xingtu?.pendingConfirmation);
    const profileId = String(input.capabilityContext?.xingtuProfileId || existingProfileId || '').trim();
    const cleanedContent = cleanText(input.content);

    if (!cleanedContent) {
      throw new Error('请在 @星图达人 后补充搜索需求');
    }
    const intent = await classifyXingtuCapabilityIntentWithAi({
      modelConfig: input.modelConfig,
      history: input.history,
      currentInput: cleanedContent,
      lastPage,
      pendingConfirmation,
    });

    if (intent.intent === 'filter_options_question') {
      return {
        capability: 'xingtu_creator_search',
        assistantContent: await answerXingtuFilterOptionsQuestionWithAi({
          modelConfig: input.modelConfig,
          history: input.history,
          currentInput: cleanedContent,
        }),
        metadata,
      };
    }
    if (!profileId) {
      throw new Error('缺少星图 profileId，请先在星图达人页选择已登录账号后再使用 @星图达人');
    }

    const requestedPage = intent.intent === 'page_navigation' ? intent.page || null : null;
    const wantsConfirmSearch = intent.intent === 'confirm_search';
    let draftId = existingDraftId;
    let plan: XingtuAiSearchPlan | null = null;
    let existingDraftSnapshot: XingtuAiDraftSnapshot | null = null;
    let assistantActions: ChatMessageAction[] | undefined;

    if (wantsConfirmSearch) {
      if (!draftId) {
        throw new Error('当前还没有待确认的星图搜索，请先描述筛选条件');
      }
      if (!pendingConfirmation) {
        throw new Error('当前没有待确认的搜索条件，请先重新整理筛选条件');
      }
    }

    if (requestedPage !== null) {
      if (!draftId) {
        throw new Error('当前还没有星图搜索草稿，请先发起一次搜索，再使用翻页指令');
      }
      if (pendingConfirmation) {
        throw new Error('当前筛选条件还未确认，请先点击“确认搜索”再翻页');
      }
      const existingDraft = xingtuSearchDraftService.getDraft(input.userId, draftId).draft;
      existingDraftSnapshot = {
        keyword: existingDraft.keyword,
        searchMode: existingDraft.searchMode,
        criteria: existingDraft.criteria,
        automationFilters: existingDraft.automationFilters || null,
      };
      plan = {
        keyword: existingDraft.keyword,
        searchMode: existingDraft.searchMode,
        criteria: existingDraft.criteria,
        automationFilters: existingDraft.automationFilters || {},
        assumptions: [],
        unresolvedTerms: [],
        validationIssues: [],
      };
    } else if (!wantsConfirmSearch) {
      const existingDraft = draftId
        ? xingtuSearchDraftService.getDraft(input.userId, draftId).draft
        : null;
      existingDraftSnapshot = existingDraft
        ? {
            keyword: existingDraft.keyword,
            searchMode: existingDraft.searchMode,
            criteria: existingDraft.criteria,
            automationFilters: existingDraft.automationFilters || null,
          }
        : null;
      plan = await planXingtuSearchWithAi({
        modelConfig: input.modelConfig,
        history: input.history,
        currentInput: cleanedContent,
        existingDraft: existingDraftSnapshot,
      });

      if (!draftId) {
        const created = xingtuSearchDraftService.createDraft({
          userId: input.userId,
          profileId,
          keyword: plan.keyword,
          searchMode: plan.searchMode,
          criteria: plan.criteria,
          automationFilters: plan.automationFilters,
          sourceText: cleanedContent,
        });
        draftId = created.draftId;
      } else {
        xingtuSearchDraftService.replaceDraft({
          userId: input.userId,
          draftId,
          keyword: plan.keyword,
          searchMode: plan.searchMode,
          criteria: plan.criteria,
          automationFilters: plan.automationFilters,
          sourceText: cleanedContent,
        });
      }
    }

    if (wantsConfirmSearch) {
      const existingDraft = xingtuSearchDraftService.getDraft(input.userId, draftId).draft;
      existingDraftSnapshot = {
        keyword: existingDraft.keyword,
        searchMode: existingDraft.searchMode,
        criteria: existingDraft.criteria,
        automationFilters: existingDraft.automationFilters || null,
      };
      plan = {
        keyword: existingDraft.keyword,
        searchMode: existingDraft.searchMode,
        criteria: existingDraft.criteria,
        automationFilters: existingDraft.automationFilters || {},
        assumptions: [],
        unresolvedTerms: [],
        validationIssues: [],
      };
    }

    if (!requestedPage && !wantsConfirmSearch) {
      const validationIssues = (plan as XingtuAiSearchPlan).validationIssues || [];
      const nextMetadata: ChatConversationMetadata = {
        capabilityState: {
          ...(metadata.capabilityState || {}),
          xingtu: {
            draftId,
            profileId,
            lastPage,
            pendingConfirmation: validationIssues.length === 0,
          },
        },
      };

      return {
        capability: 'xingtu_creator_search',
        assistantContent: await generateXingtuPlanConfirmationWithAi({
          modelConfig: input.modelConfig,
          currentInput: cleanedContent,
          plan: {
            ...(plan as XingtuAiSearchPlan),
            validationIssues,
          },
        }),
        assistantActions: validationIssues.length ? undefined : buildConfirmSearchAction(),
        metadata: nextMetadata,
      };
    }

    const page = requestedPage || 1;
    const result = await xingtuSearchDraftService.runDraft(input.userId, draftId, page);
    let assistantContent = '';

    try {
      assistantContent = await summarizeXingtuSearchResultWithAi({
        agent: input.agent,
        modelConfig: input.modelConfig,
        userMessage: cleanedContent,
        plan: (plan || {
          keyword: existingDraftSnapshot?.keyword || result.keyword,
          searchMode: existingDraftSnapshot?.searchMode || result.searchMode,
          criteria: existingDraftSnapshot?.criteria || [],
          automationFilters: existingDraftSnapshot?.automationFilters || {},
          assumptions: [],
          unresolvedTerms: [],
          validationIssues: [],
        }) as XingtuAiSearchPlan,
        result,
      });
    } catch {
      assistantContent = buildFallbackAssistantContent(result, plan || undefined);
    }

    const nextMetadata: ChatConversationMetadata = {
      capabilityState: {
        ...(metadata.capabilityState || {}),
        xingtu: {
          draftId,
          profileId,
          lastPage: result.pagination?.currentPage || page,
          pendingConfirmation: false,
        },
      },
    };

    return {
      capability: 'xingtu_creator_search',
      assistantContent,
      assistantActions,
      metadata: nextMetadata,
    };
  },
};
