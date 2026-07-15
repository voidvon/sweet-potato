import { randomBytes } from 'node:crypto';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { jsonrepair } from 'jsonrepair';
import type { ZodTypeAny, infer as InferZodOutput } from 'zod';
import { callBilledLlm, streamBilledLlm } from '../billing/billing.service.js';
import type { BillingContentPart } from '../billing/billing.types.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';

type ConfiguredLlmBillingMode = 'usage' | 'external_fixed';

type StreamCompletionResponse = {
  choices?: Array<{ delta?: { content?: string } }>;
  error?: { message?: string };
};

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

export async function* streamConfiguredLlmWithoutBilling(input: {
  modelConfig: AiModelConfig;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  timeoutMs?: number;
}): AsyncGenerator<string, void, void> {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(input.timeoutMs)) && Number(input.timeoutMs) > 0
    ? Number(input.timeoutMs)
    : 180_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let answerContent = '';
  try {
    const response = await fetch(chatCompletionsUrl(input.modelConfig.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.modelConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelConfig.model,
        messages: input.messages,
        temperature: input.temperature,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      let data: StreamCompletionResponse = {};
      try {
        data = text ? JSON.parse(text) as StreamCompletionResponse : {};
      } catch {
        data = {};
      }
      throw new Error(data.error?.message || `模型服务请求失败：${response.status}`);
    }
    if (!response.body) {
      throw new Error('模型服务未返回流式响应');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) {
          continue;
        }
        const dataText = trimmed.replace(/^data:\s?/, '');
        if (!dataText || dataText === '[DONE]') {
          continue;
        }
        const data = JSON.parse(dataText) as StreamCompletionResponse;
        if (data.error?.message) {
          throw new Error(data.error.message);
        }
        for (const choice of data.choices || []) {
          const delta = choice.delta?.content || '';
          if (!delta) {
            continue;
          }
          answerContent += delta;
          yield delta;
        }
      }
    }
    if (!answerContent.trim()) {
      throw new Error('模型服务未返回有效内容');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('模型服务响应超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveDefaultLlmModel() {
  const config = modelConfigRepository.list('llm').find((item) => Boolean(item.isDefault))
    || modelConfigRepository.list('llm')[0];
  if (!config?.apiKey) {
    throw new Error('请先配置默认大模型 API Key，视频助手需要模型配置才能处理自然语言');
  }
  if (!config.model || !config.baseUrl) {
    throw new Error('默认大模型配置不完整，缺少 model 或 baseUrl');
  }
  return config;
}

export function extractJsonObject<T>(text: string): T {
  const normalized = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const match = normalized.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('大模型未返回 JSON');
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return JSON.parse(jsonrepair(match[0])) as T;
  }
}

export async function callConfiguredLlm(input: {
  userId: string;
  system: string;
  user: string;
  temperature?: number;
  sourceType?: string;
  sourceId?: string;
  timeoutMs?: number;
  onContentDelta?: (delta: string, content: string) => void | Promise<void>;
  billingMode?: ConfiguredLlmBillingMode;
}) {
  const config = resolveDefaultLlmModel();
  const sourceId = input.sourceId || randomBytes(12).toString('hex');
  const messages = [
    { role: 'system' as const, content: input.system },
    { role: 'user' as const, content: input.user },
  ];
  if (input.billingMode === 'external_fixed') {
    let content = '';
    for await (const delta of streamConfiguredLlmWithoutBilling({
      modelConfig: config,
      messages,
      temperature: input.temperature ?? config.temperature ?? 0.7,
      timeoutMs: input.timeoutMs,
    })) {
      content += delta;
      await input.onContentDelta?.(delta, content);
    }
    return content.trim();
  }
  if (input.onContentDelta) {
    let content = '';
    for await (const chunk of streamBilledLlm({
      userId: input.userId,
      modelConfig: config,
      sourceType: input.sourceType || 'content_llm',
      sourceId,
      messages,
      temperature: input.temperature ?? config.temperature ?? 0.7,
      timeoutMs: input.timeoutMs,
    })) {
      if (chunk.type !== 'answer') {
        continue;
      }
      content += chunk.delta;
      await input.onContentDelta(chunk.delta, content);
    }
    if (!content.trim()) {
      throw new Error('模型服务未返回有效内容');
    }
    return content.trim();
  }
  const result = await callBilledLlm({
    userId: input.userId,
    modelConfig: config,
    sourceType: input.sourceType || 'content_llm',
    sourceId,
    messages,
    temperature: input.temperature ?? config.temperature ?? 0.7,
    timeoutMs: input.timeoutMs,
  });
  if (/^API call failed/i.test(result.content)) {
    throw new Error(result.content);
  }
  return result.content;
}

export class StructuredLlmOutputParseError extends Error {
  readonly content: string;

  constructor(message: string, content: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StructuredLlmOutputParseError';
    this.content = content;
  }
}

export function createStructuredOutputParser<T extends ZodTypeAny>(schema: T) {
  return StructuredOutputParser.fromZodSchema(schema);
}

export async function parseStructuredLlmOutput<T extends ZodTypeAny>(schema: T, content: string) {
  const parser = createStructuredOutputParser(schema);
  try {
    return await parser.parse(content);
  } catch (error) {
    throw new StructuredLlmOutputParseError('结构化输出解析失败', content, { cause: error });
  }
}

export async function callConfiguredStructuredLlm<T extends ZodTypeAny>(input: {
  userId: string;
  system: string;
  user: string;
  schema: T;
  temperature?: number;
  sourceType?: string;
  sourceId?: string;
  timeoutMs?: number;
  formatInstructionsPrefix?: string;
  formatInstructionsTarget?: 'system' | 'user';
  onContentDelta?: (delta: string, content: string) => void | Promise<void>;
  billingMode?: ConfiguredLlmBillingMode;
}) {
  const parser = createStructuredOutputParser(input.schema);
  const formatInstructions = [
    input.formatInstructionsPrefix?.trim(),
    parser.getFormatInstructions(),
  ].filter(Boolean).join('\n\n');
  const formatInstructionsTarget = input.formatInstructionsTarget || 'system';
  const system = formatInstructionsTarget === 'system'
    ? [input.system, formatInstructions].filter(Boolean).join('\n\n')
    : input.system;
  const user = formatInstructionsTarget === 'user'
    ? [input.user, formatInstructions].filter(Boolean).join('\n\n')
    : input.user;
  const content = await callConfiguredLlm({
    userId: input.userId,
    system,
    user,
    temperature: input.temperature,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    timeoutMs: input.timeoutMs,
    onContentDelta: input.onContentDelta,
    billingMode: input.billingMode,
  });
  try {
    const parsed = await parser.parse(content);
    return {
      content,
      parsed: parsed as InferZodOutput<T>,
      parser,
    };
  } catch (error) {
    throw new StructuredLlmOutputParseError('结构化输出解析失败', content, { cause: error });
  }
}

export async function callConfiguredMultimodalLlm(input: {
  userId: string;
  system: string;
  text: string;
  imageDataUris: string[];
  temperature?: number;
  sourceType?: string;
  sourceId?: string;
}) {
  const config = resolveDefaultLlmModel();
  const content: BillingContentPart[] = [
    { type: 'text', text: input.text },
    ...input.imageDataUris.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
  const result = await callBilledLlm({
    userId: input.userId,
    modelConfig: config,
    sourceType: input.sourceType || 'content_multimodal_llm',
    sourceId: input.sourceId || randomBytes(12).toString('hex'),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content },
    ],
    temperature: input.temperature ?? config.temperature ?? 0.4,
  });
  return result.content;
}

export function isUnsupportedImageMessageError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /unknown variant [`'"]?image_url|expected [`'"]?text|image_url/i.test(error.message);
}
