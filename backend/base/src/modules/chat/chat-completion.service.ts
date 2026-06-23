import { randomBytes } from 'node:crypto';
import { callBilledLlm, streamBilledLlm } from '../billing/billing.service.js';
import type { BillingChatMessage } from '../billing/billing.types.js';
import type { AiAgent } from '../agents/agent.types.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import type { ChatAttachment, ChatMessage } from './chat.types.js';

export type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >;
};

type ChatCompletionChoice = {
  message?: {
    content?: string;
    reasoning_content?: string;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  error?: {
    message?: string;
  };
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function buildChatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

function buildSystemPrompt(agent: AiAgent) {
  const parts = [agent.systemPrompt || `你是「${agent.name}」。${agent.description}`];

  if (agent.runMode === 'reasoning') {
    parts.push('请在回答前进行充分分析，但最终只输出清晰、可执行的结论。');
  }

  if (agent.tools.length) {
    parts.push(`可用工具配置：${agent.tools.join('、')}。`);
  }

  if (agent.skills.length) {
    parts.push(`技能配置：${agent.skills.join('、')}。`);
  }

  parts.push(`检索策略：${agent.retrievalStrategy}。`);
  parts.push(`网络搜索：${agent.webSearchEnabled ? '已启用' : '未启用'}。`);

  return parts.join('\n');
}

function formatAttachmentSummary(attachments: ChatAttachment[] = []) {
  if (!attachments.length) {
    return '';
  }

  return [
    '',
    '用户随消息添加了以下附件：',
    ...attachments.map((item) => `- ${item.name}（${item.kind === 'image' ? '图片' : '文件'}，${item.type || '未知类型'}，${item.size} bytes）`),
  ].join('\n');
}

function buildUserContent(content: string, attachments: ChatAttachment[] = []): BillingChatMessage['content'] {
  const imageAttachments = attachments.filter((item) => item.kind === 'image' && item.url);
  const text = `${content}${formatAttachmentSummary(attachments)}`.trim() || '请分析附件内容。';

  if (!imageAttachments.length) {
    return text;
  }

  return [
    { type: 'text', text },
    ...imageAttachments.map((item) => ({
      type: 'image_url' as const,
      image_url: { url: item.url },
    })),
  ];
}

function buildMessages(agent: AiAgent, history: ChatMessage[], content: string, attachments: ChatAttachment[] = []): BillingChatMessage[] {
  const contextMessages = history.slice(-20).map((item) => ({
    role: item.role,
    content: `${item.content}${formatAttachmentSummary(item.attachments)}`.trim(),
  }));

  return [
    { role: 'system', content: buildSystemPrompt(agent) },
    ...contextMessages,
    { role: 'user', content: buildUserContent(content, attachments) },
  ];
}

export function assertModelConfigReady(modelConfig: AiModelConfig) {
  if (!modelConfig.apiKey) {
    throw new Error('当前模型未配置 API Key，请先在模型配置中补充密钥');
  }

  if (!modelConfig.baseUrl || !modelConfig.model) {
    throw new Error('当前模型配置不完整，请检查 Base URL 和模型名称');
  }
}

export async function askConfiguredModel(input: {
  userId: string;
  sourceId?: string;
  agent: AiAgent;
  modelConfig: AiModelConfig;
  history: ChatMessage[];
  content: string;
  attachments?: ChatAttachment[];
}) {
  assertModelConfigReady(input.modelConfig);
  const result = await callBilledLlm({
    userId: input.userId,
    modelConfig: input.modelConfig,
    sourceType: 'chat_completion',
    sourceId: input.sourceId || randomBytes(12).toString('hex'),
    messages: buildMessages(input.agent, input.history, input.content, input.attachments || []),
    temperature: input.modelConfig.temperature,
  });
  return result.content;
}

export async function askConfiguredModelWithMessages(
  modelConfig: AiModelConfig,
  messages: ChatCompletionMessage[],
  options: { temperature?: number } = {},
) {
  assertModelConfigReady(modelConfig);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(buildChatCompletionsUrl(modelConfig.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${modelConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages,
        temperature: options.temperature ?? modelConfig.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as ChatCompletionResponse) : null;

    if (!response.ok) {
      throw new Error(data?.error?.message || `模型服务请求失败：${response.status}`);
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      throw new Error('模型服务未返回有效内容');
    }

    return answer;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('模型服务响应超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function* streamConfiguredModel(input: {
  userId: string;
  sourceId?: string;
  agent: AiAgent;
  modelConfig: AiModelConfig;
  history: ChatMessage[];
  content: string;
  attachments?: ChatAttachment[];
  signal?: AbortSignal;
}) {
  assertModelConfigReady(input.modelConfig);
  for await (const chunk of streamBilledLlm({
    userId: input.userId,
    modelConfig: input.modelConfig,
    sourceType: 'chat_completion',
    sourceId: input.sourceId || randomBytes(12).toString('hex'),
    messages: buildMessages(input.agent, input.history, input.content, input.attachments || []),
    temperature: input.modelConfig.temperature,
    signal: input.signal,
  })) {
    yield chunk;
  }
}
