import { randomBytes } from 'node:crypto';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { jsonrepair } from 'jsonrepair';
import type { ZodTypeAny, infer as InferZodOutput } from 'zod';
import { callBilledLlm } from '../billing/billing.service.js';
import type { BillingContentPart } from '../billing/billing.types.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';

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
}) {
  const config = resolveDefaultLlmModel();
  const result = await callBilledLlm({
    userId: input.userId,
    modelConfig: config,
    sourceType: input.sourceType || 'content_llm',
    sourceId: input.sourceId || randomBytes(12).toString('hex'),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
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
