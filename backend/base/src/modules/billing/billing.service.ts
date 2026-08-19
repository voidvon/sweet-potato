import { randomBytes } from 'node:crypto';
import { db } from '../../db/database.js';
import type { AiModelConfig } from '../model-configs/model-config.types.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import { findLlmModelPricing } from '../model-configs/llm-model-pricing.service.js';
import { userRepository } from '../users/user.repository.js';
import { publishCreditBalanceUpdated } from './billing.events.js';
import { billingRepository } from './billing.repository.js';
import type {
  BillableUsageCategory,
  BillableUsagePricingMode,
  BillableUsageRecord,
  BilledLlmCallInput,
  BilledLlmStreamChunk,
  BillingChatMessage,
  BillingSettings,
  CreditLedgerEntry,
  CreditReservation,
  LlmUsageRecord,
  ModelBillingSettings,
  NormalizedLlmUsage,
  SiteConfig,
} from './billing.types.js';

type OpenAiUsagePayload = Record<string, unknown> | undefined;

function runCreditTransaction<Result>(userId: string, transaction: () => Result) {
  const previousBalance = userRepository.findById(userId)?.creditBalance;
  const result = transaction();
  const creditBalance = userRepository.findById(userId)?.creditBalance;
  if (
    typeof previousBalance === 'number'
    && typeof creditBalance === 'number'
    && previousBalance !== creditBalance
  ) {
    publishCreditBalanceUpdated({
      userId,
      creditBalance,
      creditDelta: roundCredits(creditBalance - previousBalance),
    });
  }
  return result;
}

type NonStreamCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      thinking_content?: string;
      thinking?: string;
    };
  }>;
  usage?: OpenAiUsagePayload;
  error?: { message?: string };
  message?: string;
};

type StreamCompletionResponse = {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      thinking_content?: string;
      thinking?: string;
    };
  }>;
  usage?: OpenAiUsagePayload;
  error?: { message?: string };
};

type NonLlmModelBillingSettings = {
  multiplier: number;
  creditsPerRequest: number;
  voiceCloneCredits: number;
  speechCreditsPer1kChars: number;
  priceSource: string;
};

export class InsufficientCreditsError extends Error {
  constructor() {
    super('积分不足或账户已欠费，请充值后继续使用');
    this.name = 'InsufficientCreditsError';
  }
}

export class InsufficientStepCreditsError extends Error {
  currentCredits: number;
  requiredCredits: number;
  shortfallCredits: number;
  step: string;
  stepLabel: string;
  comparison: 'gt' | 'gte';

  constructor(input: {
    step: string;
    stepLabel: string;
    currentCredits: number;
    requiredCredits: number;
    comparison?: 'gt' | 'gte';
  }) {
    const currentCredits = roundCredits(input.currentCredits);
    const requiredCredits = roundCredits(input.requiredCredits);
    const shortfallCredits = roundCredits(Math.max(0, requiredCredits - currentCredits));
    const comparison = input.comparison || 'gte';
    super(
      comparison === 'gt'
        ? `积分不足，无法继续${input.stepLabel}。当前剩余 ${currentCredits} 积分，需要大于 ${requiredCredits} 积分，请充值后重试。`
        : `积分不足，无法继续${input.stepLabel}。当前剩余 ${currentCredits} 积分，需要至少 ${requiredCredits} 积分，请充值后重试。`,
    );
    this.name = 'InsufficientStepCreditsError';
    this.step = input.step;
    this.stepLabel = input.stepLabel;
    this.currentCredits = currentCredits;
    this.requiredCredits = requiredCredits;
    this.shortfallCredits = shortfallCredits;
    this.comparison = comparison;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function displayNameForModelId(model?: string | null) {
  const value = String(model || '').trim();
  const names: Record<string, string> = {
    'doubao-seedance-2-0-260128': 'Seedance 2.0',
    'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
    'doubao-seedance-2-0-mini-260615': 'Seedance 2.0 Mini',
  };
  return names[value] || value;
}

function modelNameForLedgerEntry(entry: CreditLedgerEntry) {
  if (isRecord(entry.snapshot)) {
    const category = stringFromRecord(entry.snapshot, ['category']);
    if (category === 'video_generation' && entry.sourceId) {
      const billableRecord = billingRepository.findBillableUsageRecordByCategoryAndSourceId('video_generation', entry.sourceId);
      const modelName = displayNameForModelId(billableRecord?.model);
      if (modelName) {
        return modelName;
      }
    }
    const direct = stringFromRecord(entry.snapshot, ['modelName']);
    if (direct) {
      return direct;
    }
  }
  if (!entry.sourceId) {
    return '';
  }
  const usageRecord = billingRepository.findUsageRecordBySourceId(entry.sourceId);
  if (!usageRecord) {
    return '';
  }
  return stringFromRecord(usageRecord.billingSnapshot, ['modelName']) || usageRecord.modelConfigId;
}

function normalizeNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundCredits(value: number) {
  return Number(value.toFixed(6));
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

function estimateTextTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateMessageTokens(messages: BillingChatMessage[]) {
  return messages.reduce((total, message) => {
    if (typeof message.content === 'string') {
      return total + estimateTextTokens(message.content);
    }
    return total + message.content.reduce((sum, part) => {
      if (part.type === 'text') {
        return sum + estimateTextTokens(part.text);
      }
      return sum + Math.max(256, estimateTextTokens(part.image_url.url));
    }, 0);
  }, 12);
}

function normalizeUsage(raw: OpenAiUsagePayload): NormalizedLlmUsage {
  const usage = isRecord(raw) ? raw : {};
  const promptTokens = numberFromRecord(usage, ['prompt_tokens', 'input_tokens']);
  const completionTokens = numberFromRecord(usage, ['completion_tokens', 'output_tokens']);
  const promptDetails = isRecord(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : isRecord(usage.input_tokens_details)
      ? usage.input_tokens_details
      : {};
  const cachedPromptTokens = numberFromRecord(promptDetails, ['cached_tokens']);
  return {
    promptTokens,
    completionTokens,
    cachedPromptTokens,
  };
}

function modelBillingSettingsOf(modelConfig: AiModelConfig): ModelBillingSettings {
  const settings = isRecord(modelConfig.settings) ? modelConfig.settings : {};
  const billing = isRecord(settings.billing) ? settings.billing : {};
  const pricing = findLlmModelPricing(modelConfig.provider, modelConfig.model);
  return {
    multiplier: normalizeNumber(billing.multiplier, 0),
    inputCreditsPer1M: pricing
      ? pricing.inputPricePer1M
      : normalizeNumber(
        billing.inputCreditsPer1M,
        normalizeNumber(billing.inputUsdPer1M, 0),
      ),
    outputCreditsPer1M: pricing
      ? pricing.outputPricePer1M
      : normalizeNumber(
        billing.outputCreditsPer1M,
        normalizeNumber(billing.outputUsdPer1M, 0),
      ),
    cachedInputCreditsPer1M: pricing
      ? pricing.cachedInputPricePer1M
      : normalizeNumber(
        billing.cachedInputCreditsPer1M,
        normalizeNumber(billing.cachedInputUsdPer1M, 0),
      ),
    maxOutputCreditsForReserve: roundCredits(Math.max(
      0,
      normalizeNumber(
        billing.maxOutputCreditsForReserve,
        normalizeNumber(billing.maxOutputTokensForReserve, 0),
      ),
    )),
    priceSource: pricing?.priceSource || stringFromRecord(billing, ['priceSource']) || 'official-manual',
  };
}

function nonLlmModelBillingSettingsOf(modelConfig: AiModelConfig): NonLlmModelBillingSettings {
  const settings = isRecord(modelConfig.settings) ? modelConfig.settings : {};
  const billing = isRecord(settings.billing) ? settings.billing : {};
  return {
    multiplier: modelConfig.type === 'image' ? 1 : normalizeNumber(billing.multiplier, 1),
    creditsPerRequest: normalizeNumber(
      billing.creditsPerRequest,
      normalizeNumber(billing.perRequestUsd, 0),
    ),
    voiceCloneCredits: normalizeNumber(
      billing.voiceCloneCredits,
      normalizeNumber(billing.voiceCloneUsd, 0),
    ),
    speechCreditsPer1kChars: normalizeNumber(
      billing.speechCreditsPer1kChars,
      normalizeNumber(billing.speechUsdPer1kChars, 0),
    ),
    priceSource: stringFromRecord(billing, ['priceSource']) || 'official-manual',
  };
}

export function imageGenerationCreditsPerRequest(modelConfig: AiModelConfig) {
  return nonLlmModelBillingSettingsOf(modelConfig).creditsPerRequest;
}

export function estimateImageGenerationCredits(modelConfig: AiModelConfig, outputCount: number) {
  const normalizedOutputCount = Math.max(0, Math.floor(Number(outputCount) || 0));
  return roundCredits(imageGenerationCreditsPerRequest(modelConfig) * normalizedOutputCount);
}

function assertSystemBillingReady() {
  const settings = billingRepository.getSettings();
  if (!settings) {
    throw new Error('系统计费配置不存在');
  }
  return settings;
}

function assertBillingReady(modelConfig: AiModelConfig) {
  const settings = assertSystemBillingReady();
  const modelBilling = modelBillingSettingsOf(modelConfig);
  if (
    modelBilling.multiplier <= 0
    || modelBilling.inputCreditsPer1M < 0
    || modelBilling.outputCreditsPer1M < 0
    || modelBilling.cachedInputCreditsPer1M < 0
    || modelBilling.maxOutputCreditsForReserve < 0
  ) {
    throw new Error(`模型「${modelConfig.name}」的计费配置不完整，请联系管理员`);
  }
  return { settings, modelBilling };
}

function calculateCreditBaseCost(usage: NormalizedLlmUsage, modelBilling: ModelBillingSettings) {
  const cachedPromptTokens = Math.max(0, Math.min(usage.cachedPromptTokens, usage.promptTokens));
  const uncachedPromptTokens = Math.max(0, usage.promptTokens - cachedPromptTokens);
  return roundCredits(
    uncachedPromptTokens / 1_000_000 * modelBilling.inputCreditsPer1M
    + cachedPromptTokens / 1_000_000 * modelBilling.cachedInputCreditsPer1M
    + usage.completionTokens / 1_000_000 * modelBilling.outputCreditsPer1M,
  );
}

function buildSnapshot(input: {
  modelConfig: AiModelConfig;
  billingSettings: BillingSettings;
  modelBilling: ModelBillingSettings;
  usage?: NormalizedLlmUsage;
}) {
  return {
    modelConfigId: input.modelConfig.id,
    modelName: input.modelConfig.name,
    provider: input.modelConfig.provider,
    model: input.modelConfig.model,
    modelBilling: input.modelBilling,
    usage: input.usage,
  };
}

function buildBillableSnapshot(input: {
  settings: BillingSettings;
  category: BillableUsageCategory;
  modelConfig?: AiModelConfig;
  modelBilling?: NonLlmModelBillingSettings;
  pricingMode: BillableUsagePricingMode;
  quantitySnapshot: Record<string, unknown>;
  requestSnapshot: Record<string, unknown>;
  responseSnapshot: Record<string, unknown>;
  usageRaw: Record<string, unknown>;
}) {
  return {
    category: input.category,
    pricingMode: input.pricingMode,
    modelConfigId: input.modelConfig?.id || null,
    modelName: input.modelConfig?.name || '',
    provider: input.modelConfig?.provider || '',
    model: input.modelConfig?.model || '',
    modelBilling: input.modelBilling || null,
    quantitySnapshot: input.quantitySnapshot,
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    usageRaw: input.usageRaw,
  };
}

function persistBillableUsageCharge(input: {
  userId: string;
  category: BillableUsageCategory;
  modelConfig?: AiModelConfig;
  provider?: string;
  model?: string;
  sourceType: string;
  sourceId: string;
  taskId?: string | null;
  sessionId?: string | null;
  groupId?: string | null;
  pricingMode: BillableUsagePricingMode;
  quantitySnapshot?: Record<string, unknown>;
  usageRaw?: Record<string, unknown>;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
  creditBaseCost: number;
  multiplier?: number;
  priceSource?: string;
  creditRounding?: 'precision' | 'ceil';
}) {
  const settings = assertSystemBillingReady();
  const creditBaseCost = roundCredits(Math.max(0, input.creditBaseCost));
  const multiplier = Math.max(0, normalizeNumber(input.multiplier, 1));
  const creditBilledCost = input.creditRounding === 'ceil'
    ? Math.ceil(creditBaseCost * multiplier)
    : roundCredits(creditBaseCost * multiplier);
  const creditCost = creditBilledCost;
  const now = new Date().toISOString();
  const quantitySnapshot = input.quantitySnapshot || {};
  const usageRaw = input.usageRaw || {};
  const requestSnapshot = input.requestSnapshot || {};
  const responseSnapshot = input.responseSnapshot || {};
  const snapshot = buildBillableSnapshot({
    settings,
    category: input.category,
    modelConfig: input.modelConfig,
    modelBilling: input.modelConfig ? {
      ...nonLlmModelBillingSettingsOf(input.modelConfig),
      multiplier,
      priceSource: input.priceSource || nonLlmModelBillingSettingsOf(input.modelConfig).priceSource,
    } : undefined,
    pricingMode: input.pricingMode,
    quantitySnapshot,
    requestSnapshot,
    responseSnapshot,
    usageRaw,
  });

  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    let nextCreditBalance = user.creditBalance;
    if (creditCost > 0) {
      if (roundCredits(user.creditBalance) < creditCost) {
        throw new InsufficientCreditsError();
      }
      nextCreditBalance = roundCredits(nextCreditBalance - creditCost);
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'usage_debit',
        creditDelta: -creditCost,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost,
        creditBilledCost,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        snapshot,
        createdAt: now,
      });
    }
    const record: BillableUsageRecord = {
      id: randomBytes(12).toString('hex'),
      userId: input.userId,
      category: input.category,
      modelConfigId: input.modelConfig?.id || null,
      provider: input.provider || input.modelConfig?.provider || null,
      model: input.model || input.modelConfig?.model || null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      taskId: input.taskId || null,
      sessionId: input.sessionId || null,
      groupId: input.groupId || null,
      pricingMode: input.pricingMode,
      quantitySnapshot,
      usageRaw,
      requestSnapshot,
      responseSnapshot,
      creditBaseCost,
      creditBilledCost,
      creditCost,
      status: 'completed',
      createdAt: now,
    };
    billingRepository.createBillableUsageRecord(record);
    return record;
  });

  return runCreditTransaction(input.userId, transaction);
}

function charsTo1kUnits(charCount: number) {
  return Math.max(0, charCount) / 1000;
}

function bytesToMb(byteCount: number) {
  return Math.max(0, byteCount) / (1024 * 1024);
}

export function billedVodUploadMegabytes(fileSizeBytes: number) {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return 0;
  return Math.ceil(fileSizeBytes / (1024 * 1024));
}

function minutesFromSeconds(durationSeconds: number) {
  return Math.max(0, durationSeconds) / 60;
}

export function estimateVodUploadCredits(fileSizeBytes: number) {
  const settings = assertSystemBillingReady();
  return roundCredits(billedVodUploadMegabytes(fileSizeBytes) * settings.videoUploadCreditsPerMb);
}

export function estimateVideoUpscaleCredits() {
  const settings = assertSystemBillingReady();
  return roundCredits(Math.max(0, settings.videoUpscaleCreditsPerRequest));
}

export function estimateVideoUpscaleAssetCredits(fileSizeBytes: number) {
  return roundCredits(estimateVideoUpscaleCredits() + estimateVodUploadCredits(fileSizeBytes));
}

export function estimateSubtitleRemovalPrice(durationSeconds: number) {
  const settings = assertSystemBillingReady();
  const seconds = Math.max(1, Math.ceil(durationSeconds));
  const creditsPerSecond = Math.max(0, settings.subtitleRemovalCreditsPerSecond);
  return {
    credits: roundCredits(seconds * creditsPerSecond),
    creditsPerSecond,
    durationSeconds: seconds,
  };
}

export function estimateVideoTranslationPrice(input: {
  durationSeconds: number;
  eraseSourceSubtitles: boolean;
  translationTypes: Array<'subtitle' | 'voice' | 'face'>;
}) {
  const settings = assertSystemBillingReady();
  const seconds = Math.max(1, Math.ceil(input.durationSeconds));
  const creditsPerSecond = (input.translationTypes.includes('subtitle')
    ? settings.videoTranslationSubtitleCreditsPerSecond
    : 0)
    + (input.translationTypes.includes('voice') ? settings.videoTranslationVoiceCreditsPerSecond : 0)
    + (input.translationTypes.includes('face') ? settings.videoTranslationFaceCreditsPerSecond : 0)
    + (input.eraseSourceSubtitles ? settings.videoTranslationEraseSourceCreditsPerSecond : 0);
  return {
    credits: roundCredits(seconds * Math.max(0, creditsPerSecond)),
    creditsPerSecond: Math.max(0, creditsPerSecond),
    durationSeconds: seconds,
  };
}

export function reserveVideoUpscaleCredits(input: {
  userId: string;
  taskId: string;
  resolution: string;
}) {
  const settings = assertSystemBillingReady();
  const reservedCredits = estimateVideoUpscaleCredits();
  const now = new Date().toISOString();
  const snapshot = {
    category: 'video_upscale',
    pricingMode: 'per_request',
    quantitySnapshot: {
      requests: 1,
      resolution: input.resolution,
      configuredCreditsPerRequest: settings.videoUpscaleCreditsPerRequest,
      priceSource: 'system-billing-settings',
    },
  };
  const reservation: CreditReservation = {
    id: randomBytes(12).toString('hex'),
    userId: input.userId,
    sourceType: 'video_upscale',
    sourceId: input.taskId,
    reservedCredits,
    status: 'reserved',
    snapshot,
    createdAt: now,
    settledAt: null,
  };
  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const currentCredits = roundCredits(user.creditBalance);
    if (currentCredits < reservedCredits) {
      throw new InsufficientStepCreditsError({
        step: 'video_upscale',
        stepLabel: '视频高清放大',
        currentCredits,
        requiredCredits: reservedCredits,
      });
    }
    const nextCreditBalance = roundCredits(currentCredits - reservedCredits);
    if (reservedCredits > 0) {
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'reserve_debit',
        creditDelta: -reservedCredits,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost: reservedCredits,
        creditBilledCost: reservedCredits,
        sourceType: 'video_upscale',
        sourceId: input.taskId,
        snapshot,
        createdAt: now,
      });
    }
    billingRepository.createReservation(reservation);
    return {
      reservation,
      nextCreditBalance,
    };
  });
  return runCreditTransaction(input.userId, transaction);
}

export function settleVideoUpscaleCredits(input: {
  reservationId: string;
  userId: string;
  taskId: string;
  resolution: string;
  runId?: string;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
}) {
  const transaction = db.transaction(() => {
    const existing = billingRepository.findBillableUsageRecordByCategoryAndSourceId('video_upscale', input.taskId);
    if (existing) {
      return existing;
    }
    const reservation = billingRepository.findReservation(input.reservationId);
    if (!reservation || reservation.userId !== input.userId || reservation.sourceId !== input.taskId) {
      throw new Error('视频高清放大积分预扣记录不存在');
    }
    if (reservation.status === 'released') {
      throw new Error('视频高清放大积分已退回，无法重复结算');
    }
    const now = new Date().toISOString();
    const creditCost = roundCredits(reservation.reservedCredits);
    const record: BillableUsageRecord = {
      id: randomBytes(12).toString('hex'),
      userId: input.userId,
      category: 'video_upscale',
      modelConfigId: null,
      provider: 'volcengine-vod',
      model: 'moe-aigc-enhance',
      sourceType: 'video_upscale',
      sourceId: input.taskId,
      taskId: input.taskId,
      sessionId: null,
      groupId: null,
      pricingMode: 'per_request',
      quantitySnapshot: {
        requests: 1,
        resolution: input.resolution,
        configuredCreditsPerRequest: creditCost,
        priceSource: 'system-billing-settings',
      },
      usageRaw: {
        directCreditPricing: true,
        directCreditCost: creditCost,
        runId: input.runId || null,
      },
      requestSnapshot: input.requestSnapshot || {},
      responseSnapshot: input.responseSnapshot || {},
      creditBaseCost: creditCost,
      creditBilledCost: creditCost,
      creditCost,
      status: 'completed',
      createdAt: now,
    };
    billingRepository.updateReservationStatus(reservation.id, 'settled', now);
    billingRepository.createBillableUsageRecord(record);
    return record;
  });
  return transaction();
}

export function releaseVideoUpscaleCredits(input: {
  reservationId: string;
  userId: string;
  taskId: string;
  reason: string;
}) {
  const transaction = db.transaction(() => {
    const reservation = billingRepository.findReservation(input.reservationId);
    if (
      !reservation
      || reservation.userId !== input.userId
      || reservation.sourceId !== input.taskId
      || reservation.status !== 'reserved'
    ) {
      return false;
    }
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const now = new Date().toISOString();
    const refundedCredits = roundCredits(reservation.reservedCredits);
    const nextCreditBalance = roundCredits(user.creditBalance + refundedCredits);
    if (refundedCredits > 0) {
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'reserve_refund',
        creditDelta: refundedCredits,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost: refundedCredits,
        creditBilledCost: refundedCredits,
        sourceType: 'video_upscale',
        sourceId: input.taskId,
        snapshot: {
          ...reservation.snapshot,
          releaseReason: input.reason,
        },
        createdAt: now,
      });
    }
    billingRepository.updateReservationStatus(reservation.id, 'released', now);
    return true;
  });
  return runCreditTransaction(input.userId, transaction);
}

export function assertSufficientStepCredits(input: {
  userId: string;
  requiredCredits: number;
  step: string;
  stepLabel: string;
}) {
  assertSystemBillingReady();
  const requiredCredits = roundCredits(Math.max(0, input.requiredCredits));
  const user = userRepository.findById(input.userId);
  if (!user) {
    throw new Error('用户不存在');
  }
  if (requiredCredits <= 0) {
    return {
      currentCredits: roundCredits(user.creditBalance),
      requiredCredits,
    };
  }
  const currentCredits = roundCredits(user.creditBalance);
  if (currentCredits < requiredCredits) {
    throw new InsufficientStepCreditsError({
      step: input.step,
      stepLabel: input.stepLabel,
      currentCredits,
      requiredCredits,
    });
  }
  return {
    currentCredits,
    requiredCredits,
  };
}

function assertSufficientLlmRequestCredits(input: {
  userId: string;
  thresholdCredits: number;
  step: string;
  stepLabel: string;
}) {
  const settings = assertSystemBillingReady();
  const thresholdCredits = roundCredits(Math.max(0, input.thresholdCredits));
  const user = userRepository.findById(input.userId);
  if (!user) {
    throw new Error('用户不存在');
  }
  const currentCredits = roundCredits(user.creditBalance);
  if (currentCredits <= thresholdCredits) {
    throw new InsufficientStepCreditsError({
      step: input.step,
      stepLabel: input.stepLabel,
      currentCredits,
      requiredCredits: thresholdCredits,
      comparison: 'gt',
    });
  }
  return {
    currentCredits,
    thresholdCredits,
  };
}

function reserveCredits(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  modelConfig: AiModelConfig;
  settings: BillingSettings;
  modelBilling: ModelBillingSettings;
  messages: BillingChatMessage[];
}) {
  const estimatedUsage: NormalizedLlmUsage = {
    promptTokens: estimateMessageTokens(input.messages),
    completionTokens: 0,
    cachedPromptTokens: 0,
  };
  const estimatedPromptCreditBaseCost = calculateCreditBaseCost(estimatedUsage, input.modelBilling);
  const estimatedPromptCreditBilledCost = roundCredits(estimatedPromptCreditBaseCost * input.modelBilling.multiplier);
  const reservedCredits = roundCredits(estimatedPromptCreditBilledCost + input.modelBilling.maxOutputCreditsForReserve);
  const now = new Date().toISOString();
  const reservation: CreditReservation = {
    id: randomBytes(12).toString('hex'),
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    reservedCredits,
    status: 'reserved',
    snapshot: buildSnapshot({
      modelConfig: input.modelConfig,
      billingSettings: input.settings,
      modelBilling: input.modelBilling,
      usage: estimatedUsage,
    }),
    createdAt: now,
    settledAt: null,
  };
  const ledgerEntry: CreditLedgerEntry = {
    id: randomBytes(12).toString('hex'),
    userId: input.userId,
    type: 'reserve_debit',
    creditDelta: -reservedCredits,
    creditBalanceAfter: 0,
    creditBaseCost: estimatedPromptCreditBaseCost,
    creditBilledCost: estimatedPromptCreditBilledCost,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    snapshot: {
      ...reservation.snapshot,
      reserve: {
        estimatedPromptCreditCost: estimatedPromptCreditBilledCost,
        maxOutputCreditsForReserve: input.modelBilling.maxOutputCreditsForReserve,
        reservedCredits,
      },
    },
    createdAt: now,
  };

  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const nextCreditBalance = roundCredits(user.creditBalance - reservedCredits);
    userRepository.updateCreditBalance(user.id, nextCreditBalance);
    ledgerEntry.creditBalanceAfter = nextCreditBalance;
    billingRepository.createReservation(reservation);
    billingRepository.createLedgerEntry(ledgerEntry);
    return {
      reservation,
      nextCreditBalance,
      estimatedUsage,
    };
  });

  return runCreditTransaction(input.userId, transaction);
}

function releaseReservation(input: {
  reservation: CreditReservation;
  sourceType: string;
  sourceId: string;
}) {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.reservation.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const nextCreditBalance = roundCredits(user.creditBalance + input.reservation.reservedCredits);
    userRepository.updateCreditBalance(user.id, nextCreditBalance);
    billingRepository.updateReservationStatus(input.reservation.id, 'released', now);
    billingRepository.createLedgerEntry({
      id: randomBytes(12).toString('hex'),
      userId: user.id,
      type: 'reserve_refund',
      creditDelta: input.reservation.reservedCredits,
      creditBalanceAfter: nextCreditBalance,
      creditBaseCost: null,
      creditBilledCost: null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      snapshot: input.reservation.snapshot,
      createdAt: now,
    });
  });
  runCreditTransaction(input.reservation.userId, transaction);
}

function settleReservation(input: {
  reservation: CreditReservation;
  userId: string;
  sourceType: string;
  sourceId: string;
  modelConfig: AiModelConfig;
  settings: BillingSettings;
  modelBilling: ModelBillingSettings;
  usage: NormalizedLlmUsage;
}) {
  const creditBaseCost = calculateCreditBaseCost(input.usage, input.modelBilling);
  const creditBilledCost = roundCredits(creditBaseCost * input.modelBilling.multiplier);
  const creditCost = creditBilledCost;
  const refundCredits = roundCredits(input.reservation.reservedCredits - creditCost);
  const now = new Date().toISOString();
  const snapshot = buildSnapshot({
    modelConfig: input.modelConfig,
    billingSettings: input.settings,
    modelBilling: input.modelBilling,
    usage: input.usage,
  });

  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    let nextCreditBalance = user.creditBalance;
    if (refundCredits > 0) {
      nextCreditBalance = roundCredits(nextCreditBalance + refundCredits);
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'reserve_refund',
        creditDelta: refundCredits,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost,
        creditBilledCost,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        snapshot,
        createdAt: now,
      });
    } else if (refundCredits < 0) {
      const extraDebit = Math.abs(refundCredits);
      nextCreditBalance = roundCredits(nextCreditBalance - extraDebit);
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'llm_extra_debit',
        creditDelta: -extraDebit,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost,
        creditBilledCost,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        snapshot,
        createdAt: now,
      });
    }
    billingRepository.updateReservationStatus(input.reservation.id, 'settled', now);
    const usageRecord: LlmUsageRecord = {
      id: randomBytes(12).toString('hex'),
      userId: input.userId,
      modelConfigId: input.modelConfig.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      cachedPromptTokens: input.usage.cachedPromptTokens,
      usageRaw: snapshot.usage && isRecord(snapshot.usage) ? snapshot.usage : {},
      billingSnapshot: snapshot,
      creditBaseCost,
      creditBilledCost,
      creditCost,
      status: 'completed',
      createdAt: now,
    };
    billingRepository.createUsageRecord(usageRecord);
    return {
      nextCreditBalance,
      creditCost,
    };
  });

  return runCreditTransaction(input.userId, transaction);
}

function recordFailedUsage(input: {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  settings: BillingSettings;
  modelBilling: ModelBillingSettings;
  usage?: NormalizedLlmUsage;
}) {
  billingRepository.createUsageRecord({
    id: randomBytes(12).toString('hex'),
    userId: input.userId,
    modelConfigId: input.modelConfig.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    promptTokens: input.usage?.promptTokens || 0,
    completionTokens: input.usage?.completionTokens || 0,
    cachedPromptTokens: input.usage?.cachedPromptTokens || 0,
    usageRaw: {},
    billingSnapshot: buildSnapshot({
      modelConfig: input.modelConfig,
      billingSettings: input.settings,
      modelBilling: input.modelBilling,
      usage: input.usage,
    }),
    creditBaseCost: 0,
    creditBilledCost: 0,
    creditCost: 0,
    status: 'failed',
    createdAt: new Date().toISOString(),
  });
}

function completionTextFromMessages(messages: BillingChatMessage[]) {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return message.content;
    }
    return message.content.map((part) => (part.type === 'text' ? part.text : part.image_url.url)).join('\n');
  }).join('\n');
}

export function normalizeBillingSettings(input: Partial<BillingSettings> & Record<string, unknown>, fallback?: BillingSettings): BillingSettings {
  const now = new Date().toISOString();
  const fallbackRecord = (fallback || {}) as Record<string, unknown>;

  return {
    id: 1,
    seedance2CreditsPerSecond720p: normalizeNumber(
      input.seedance2CreditsPerSecond720p,
      normalizeNumber(fallbackRecord.seedance2CreditsPerSecond720p, 20),
    ),
    seedance2CreditsPerSecond480p: normalizeNumber(
      input.seedance2CreditsPerSecond480p,
      normalizeNumber(fallbackRecord.seedance2CreditsPerSecond480p, 12),
    ),
    seedance2FastCreditsPerSecond720p: normalizeNumber(
      input.seedance2FastCreditsPerSecond720p,
      normalizeNumber(fallbackRecord.seedance2FastCreditsPerSecond720p, 18),
    ),
    seedance2FastCreditsPerSecond480p: normalizeNumber(
      input.seedance2FastCreditsPerSecond480p,
      normalizeNumber(fallbackRecord.seedance2FastCreditsPerSecond480p, 11),
    ),
    seedance2MiniCreditsPerSecond720p: normalizeNumber(
      input.seedance2MiniCreditsPerSecond720p,
      normalizeNumber(fallbackRecord.seedance2MiniCreditsPerSecond720p, 15),
    ),
    seedance2MiniCreditsPerSecond480p: normalizeNumber(
      input.seedance2MiniCreditsPerSecond480p,
      normalizeNumber(fallbackRecord.seedance2MiniCreditsPerSecond480p, 7),
    ),
    videoUploadCreditsPerMb: normalizeNumber(
      numberFromRecord(input, ['videoUploadCreditsPerMb', 'videoUploadCreditsPerSecond']),
      numberFromRecord(fallbackRecord, ['videoUploadCreditsPerMb', 'videoUploadCreditsPerSecond']) || 0,
    ),
    contentPlanningAnalysisCreditsPerRequest: normalizeNumber(
      input.contentPlanningAnalysisCreditsPerRequest,
      normalizeNumber(fallbackRecord.contentPlanningAnalysisCreditsPerRequest, 2),
    ),
    contentPlanningGenerationCreditsPerRequest: normalizeNumber(
      input.contentPlanningGenerationCreditsPerRequest,
      normalizeNumber(fallbackRecord.contentPlanningGenerationCreditsPerRequest, 3),
    ),
    talkingVideoPromptCreditsPerRequest: normalizeNumber(
      input.talkingVideoPromptCreditsPerRequest,
      normalizeNumber(fallbackRecord.talkingVideoPromptCreditsPerRequest, 3),
    ),
    marketingVideoCreditsPerRequest: normalizeNumber(
      input.marketingVideoCreditsPerRequest,
      normalizeNumber(fallbackRecord.marketingVideoCreditsPerRequest, 15),
    ),
    marketingVideoStoryboardModelConfigId: String(
      input.marketingVideoStoryboardModelConfigId
      ?? fallbackRecord.marketingVideoStoryboardModelConfigId
      ?? '',
    ).trim(),
    videoUpscaleCreditsPerRequest: normalizeNumber(
      input.videoUpscaleCreditsPerRequest,
      normalizeNumber(fallbackRecord.videoUpscaleCreditsPerRequest, 20),
    ),
    subtitleRemovalCreditsPerSecond: normalizeNumber(
      input.subtitleRemovalCreditsPerSecond,
      normalizeNumber(fallbackRecord.subtitleRemovalCreditsPerSecond, 2),
    ),
    videoTranslationSubtitleCreditsPerSecond: normalizeNumber(
      input.videoTranslationSubtitleCreditsPerSecond,
      normalizeNumber(fallbackRecord.videoTranslationSubtitleCreditsPerSecond, 1),
    ),
    videoTranslationVoiceCreditsPerSecond: normalizeNumber(
      input.videoTranslationVoiceCreditsPerSecond,
      normalizeNumber(fallbackRecord.videoTranslationVoiceCreditsPerSecond, 2),
    ),
    videoTranslationFaceCreditsPerSecond: normalizeNumber(
      input.videoTranslationFaceCreditsPerSecond,
      normalizeNumber(fallbackRecord.videoTranslationFaceCreditsPerSecond, 2),
    ),
    videoTranslationEraseSourceCreditsPerSecond: normalizeNumber(
      input.videoTranslationEraseSourceCreditsPerSecond,
      normalizeNumber(fallbackRecord.videoTranslationEraseSourceCreditsPerSecond, 2),
    ),
    createdAt: fallback?.createdAt || now,
    updatedAt: now,
  };
}

export function listCreditLedger(input: { userId?: string; limit?: number } = {}) {
  return billingRepository.listLedgerEntries(input);
}

export function listLlmUsageRecords(input: { userId?: string; limit?: number } = {}) {
  return billingRepository.listUsageRecords(input);
}

export function listBillableUsageRecords(input: { userId?: string; limit?: number } = {}) {
  return billingRepository.listBillableUsageRecords(input);
}

export function listCustomerCreditLedger(input: { userId: string; limit?: number }) {
  return billingRepository.listLedgerEntries(input).map((entry) => ({
    id: entry.id,
    type: entry.type,
    creditDelta: entry.creditDelta,
    creditBalanceAfter: entry.creditBalanceAfter,
    sourceType: entry.sourceType,
    modelName: modelNameForLedgerEntry(entry) || undefined,
    createdAt: entry.createdAt,
  }));
}

export function getCreditSummary(userId: string) {
  return billingRepository.getCreditSummary(userId);
}

export function listAdminCreditLedger(input: { userId?: string; limit?: number } = {}) {
  return billingRepository.listLedgerEntries(input).map((entry) => ({
    id: entry.id,
    userId: entry.userId,
    type: entry.type,
    creditDelta: entry.creditDelta,
    creditBalanceAfter: entry.creditBalanceAfter,
    sourceType: entry.sourceType,
    createdAt: entry.createdAt,
  }));
}

export function listCustomerLlmUsageRecords(input: { userId: string; limit?: number }) {
  return billingRepository.listUsageRecords(input).map((record) => ({
    id: record.id,
    modelConfigId: record.modelConfigId,
    modelName: stringFromRecord(record.billingSnapshot, ['modelName']) || record.modelConfigId,
    sourceType: record.sourceType,
    creditCost: record.creditCost,
    status: record.status,
    createdAt: record.createdAt,
  }));
}

export function listAdminLlmUsageRecords(input: { userId?: string; limit?: number } = {}) {
  return billingRepository.listUsageRecords(input).map((record) => ({
    id: record.id,
    userId: record.userId,
    modelConfigId: record.modelConfigId,
    modelName: stringFromRecord(record.billingSnapshot, ['modelName']) || record.modelConfigId,
    sourceType: record.sourceType,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    cachedPromptTokens: record.cachedPromptTokens,
    creditCost: record.creditCost,
    status: record.status,
    createdAt: record.createdAt,
  }));
}

export function listCustomerBillableUsageRecords(input: { userId: string; limit?: number }) {
  return billingRepository.listBillableUsageRecords(input).map((record) => ({
    id: record.id,
    category: record.category,
    provider: record.provider,
    model: record.model,
    sourceType: record.sourceType,
    pricingMode: record.pricingMode,
    creditCost: record.creditCost,
    status: record.status,
    createdAt: record.createdAt,
  }));
}

export function listAdminBillableUsageRecords(input: { userId?: string; limit?: number } = {}) {
  return billingRepository.listBillableUsageRecords(input).map((record) => ({
    id: record.id,
    userId: record.userId,
    category: record.category,
    provider: record.provider,
    model: record.model,
    sourceType: record.sourceType,
    pricingMode: record.pricingMode,
    creditCost: record.creditCost,
    status: record.status,
    createdAt: record.createdAt,
  }));
}

export function findBillableUsageRecordByCategoryAndSourceId(
  category: BillableUsageCategory,
  sourceId: string,
) {
  return billingRepository.findBillableUsageRecordByCategoryAndSourceId(category, sourceId);
}

export function getBillingSettings() {
  return billingRepository.getSettings();
}

export function getContentPlanningBillingCredits() {
  const settings = assertSystemBillingReady();
  return {
    analysisCredits: roundCredits(Math.max(0, settings.contentPlanningAnalysisCreditsPerRequest)),
    generationCredits: roundCredits(Math.max(0, settings.contentPlanningGenerationCreditsPerRequest)),
  };
}

export function getSiteConfig(): SiteConfig | null {
  const settings = getBillingSettings();
  if (!settings) {
    return null;
  }
  const { id: _id, createdAt: _createdAt, ...billing } = settings;
  return { billing };
}

export function saveBillingSettings(settings: BillingSettings) {
  const prices = [
    settings.seedance2CreditsPerSecond720p,
    settings.seedance2CreditsPerSecond480p,
    settings.seedance2FastCreditsPerSecond720p,
    settings.seedance2FastCreditsPerSecond480p,
    settings.seedance2MiniCreditsPerSecond720p,
    settings.seedance2MiniCreditsPerSecond480p,
    settings.videoUploadCreditsPerMb,
    settings.contentPlanningAnalysisCreditsPerRequest,
    settings.contentPlanningGenerationCreditsPerRequest,
    settings.talkingVideoPromptCreditsPerRequest,
    settings.marketingVideoCreditsPerRequest,
    settings.videoUpscaleCreditsPerRequest,
    settings.subtitleRemovalCreditsPerSecond,
    settings.videoTranslationSubtitleCreditsPerSecond,
    settings.videoTranslationVoiceCreditsPerSecond,
    settings.videoTranslationFaceCreditsPerSecond,
    settings.videoTranslationEraseSourceCreditsPerSecond,
  ];
  if (prices.some((price) => !Number.isFinite(price) || price < 0)) {
    throw new Error('计费单价必须是大于或等于 0 的数字');
  }
  const storyboardModel = settings.marketingVideoStoryboardModelConfigId
    ? modelConfigRepository.find(settings.marketingVideoStoryboardModelConfigId)
    : null;
  if (!storyboardModel || storyboardModel.type !== 'image') {
    throw new Error('请选择有效的营销视频分镜图片模型');
  }
  billingRepository.saveSettings(settings);
  return settings;
}

export function reserveFixedBillableUsage(input: {
  userId: string;
  category: BillableUsageCategory;
  sourceType: string;
  sourceId: string;
  sessionId?: string;
  credits: number;
  step: string;
  stepLabel: string;
  pricingMode?: BillableUsagePricingMode;
  quantitySnapshot?: Record<string, unknown>;
  requestSnapshot?: Record<string, unknown>;
}) {
  const settings = assertSystemBillingReady();
  const credits = roundCredits(Math.max(0, normalizeNumber(input.credits, 0)));
  const now = new Date().toISOString();
  const quantitySnapshot = input.quantitySnapshot || {
    requests: 1,
    configuredCreditsPerRequest: credits,
    priceSource: 'system-billing-settings',
  };
  const snapshot = buildBillableSnapshot({
    settings,
    category: input.category,
    pricingMode: input.pricingMode || 'per_request',
    quantitySnapshot,
    requestSnapshot: input.requestSnapshot || {},
    responseSnapshot: {},
    usageRaw: {
      directCreditPricing: true,
      directCreditCost: credits,
    },
  });
  const reservation: CreditReservation = {
    id: randomBytes(12).toString('hex'),
    userId: input.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    reservedCredits: credits,
    status: 'reserved',
    snapshot: {
      ...snapshot,
      sessionId: input.sessionId || null,
    },
    createdAt: now,
    settledAt: null,
  };

  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    if (credits > 0 && roundCredits(user.creditBalance) < credits) {
      throw new InsufficientStepCreditsError({
        step: input.step,
        stepLabel: input.stepLabel,
        currentCredits: user.creditBalance,
        requiredCredits: credits,
      });
    }
    const nextCreditBalance = credits > 0
      ? roundCredits(user.creditBalance - credits)
      : roundCredits(user.creditBalance);
    if (credits > 0) {
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'reserve_debit',
        creditDelta: -credits,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost: credits,
        creditBilledCost: credits,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        snapshot: reservation.snapshot,
        createdAt: now,
      });
    }
    billingRepository.createReservation(reservation);
    return reservation;
  });

  return runCreditTransaction(input.userId, transaction);
}

export function settleFixedBillableUsage(input: {
  reservation: CreditReservation;
  category: BillableUsageCategory;
  provider?: string;
  model?: string;
  taskId?: string;
  sessionId?: string;
  responseSnapshot?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const reservation = billingRepository.findReservation(input.reservation.id);
    if (!reservation) {
      throw new Error('积分预留记录不存在');
    }
    if (reservation.status !== 'reserved') {
      throw new Error('积分预留记录已经处理');
    }
    const quantitySnapshot = isRecord(reservation.snapshot.quantitySnapshot)
      ? reservation.snapshot.quantitySnapshot
      : { requests: 1 };
    const requestSnapshot = isRecord(reservation.snapshot.requestSnapshot)
      ? reservation.snapshot.requestSnapshot
      : {};
    const responseSnapshot = input.responseSnapshot || {};
    const usageRaw = isRecord(reservation.snapshot.usageRaw)
      ? reservation.snapshot.usageRaw
      : {};
    const pricingMode = String(reservation.snapshot.pricingMode || 'per_request') as BillableUsagePricingMode;
    billingRepository.updateReservationStatus(reservation.id, 'settled', now);
    billingRepository.markReservedLedgerAsUsageDebit({
      userId: reservation.userId,
      sourceType: reservation.sourceType,
      sourceId: reservation.sourceId,
    });
    const record: BillableUsageRecord = {
      id: randomBytes(12).toString('hex'),
      userId: reservation.userId,
      category: input.category,
      modelConfigId: null,
      provider: input.provider || null,
      model: input.model || null,
      sourceType: reservation.sourceType,
      sourceId: reservation.sourceId,
      taskId: input.taskId || null,
      sessionId: input.sessionId || null,
      groupId: null,
      pricingMode,
      quantitySnapshot,
      usageRaw,
      requestSnapshot,
      responseSnapshot,
      creditBaseCost: reservation.reservedCredits,
      creditBilledCost: reservation.reservedCredits,
      creditCost: reservation.reservedCredits,
      status: 'completed',
      createdAt: now,
    };
    billingRepository.createBillableUsageRecord(record);
    return record;
  });
  return transaction();
}

export function settleReservedFixedBillableUsage(input: {
  reservationId: string;
  category: BillableUsageCategory;
  provider?: string;
  model?: string;
  taskId?: string;
  sessionId?: string;
  responseSnapshot?: Record<string, unknown>;
}) {
  const reservation = billingRepository.findReservation(input.reservationId);
  if (!reservation || reservation.status !== 'reserved') {
    return null;
  }
  return settleFixedBillableUsage({
    ...input,
    reservation,
  });
}

export function releaseReservedFixedBillableUsage(reservationId: string) {
  const reservation = billingRepository.findReservation(reservationId);
  if (!reservation || reservation.status !== 'reserved') {
    return;
  }
  releaseFixedBillableUsage(reservation);
}

export function findReservedFixedBillableUsage(input: { sourceType: string; sessionId: string }) {
  return billingRepository.findLatestReservedReservationBySourceTypeAndSessionId(
    input.sourceType,
    input.sessionId,
  );
}

export function releaseFixedBillableUsage(reservation: CreditReservation) {
  const current = billingRepository.findReservation(reservation.id);
  if (!current || current.status !== 'reserved') {
    return;
  }
  releaseReservation({
    reservation: current,
    sourceType: current.sourceType,
    sourceId: current.sourceId,
  });
}

export function recordImageGenerationUsage(input: {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  groupId?: string;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
}) {
  const billing = nonLlmModelBillingSettingsOf(input.modelConfig);
  return persistBillableUsageCharge({
    userId: input.userId,
    category: 'image_generation',
    modelConfig: input.modelConfig,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    groupId: input.groupId,
    pricingMode: 'per_request',
    quantitySnapshot: {
      requests: 1,
      priceSource: billing.priceSource,
    },
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    creditBaseCost: billing.creditsPerRequest,
    multiplier: 1,
    priceSource: billing.priceSource,
  });
}

export function recordVideoGenerationUsage(input: {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  taskId?: string;
  durationSeconds: number;
  resolution?: string;
  usage?: {
    completionTokens?: number;
    totalTokens?: number;
    toolUsage?: Record<string, unknown>;
    raw?: Record<string, unknown>;
  };
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
  usageRaw?: Record<string, unknown>;
}) {
  const price = estimateVideoGenerationPrice({
    durationSeconds: input.durationSeconds,
    modelId: input.modelConfig.model,
    modelName: input.modelConfig.name,
    resolution: input.resolution,
  });
  return persistBillableUsageCharge({
    userId: input.userId,
    category: 'video_generation',
    modelConfig: input.modelConfig,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    taskId: input.taskId,
    pricingMode: 'per_second',
    quantitySnapshot: {
      seconds: price.durationSeconds,
      resolution: price.resolution,
      configuredCreditsPerSecond: price.creditsPerSecond,
      priceSource: 'system-billing-settings',
    },
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    usageRaw: {
      ...(input.usageRaw || {}),
      providerUsage: input.usage?.raw || {},
      toolUsage: input.usage?.toolUsage || {},
    },
    creditBaseCost: price.credits,
    multiplier: 1,
    priceSource: 'system-billing-settings',
  });
}

export function estimateVideoGenerationPrice(input: {
  durationSeconds: number;
  modelId: string;
  modelName?: string;
  resolution?: string;
}) {
  const settings = assertSystemBillingReady();
  return resolveSeedanceVideoPrice({
    durationSeconds: input.durationSeconds,
    modelId: input.modelId,
    modelName: input.modelName,
    resolution: input.resolution,
    settings,
  });
}

export function resolveSeedanceVideoPrice(input: {
  durationSeconds: number;
  modelId: string;
  modelName?: string;
  resolution?: string;
  settings: Pick<BillingSettings,
    | 'seedance2CreditsPerSecond480p'
    | 'seedance2CreditsPerSecond720p'
    | 'seedance2FastCreditsPerSecond480p'
    | 'seedance2FastCreditsPerSecond720p'
    | 'seedance2MiniCreditsPerSecond480p'
    | 'seedance2MiniCreditsPerSecond720p'>;
}) {
  const resolution = /480p/i.test(input.resolution || '') ? '480p' : '720p';
  const modelPrices = {
    'doubao-seedance-2-0-260128': {
      '480p': input.settings.seedance2CreditsPerSecond480p,
      '720p': input.settings.seedance2CreditsPerSecond720p,
    },
    'doubao-seedance-2-0-fast-260128': {
      '480p': input.settings.seedance2FastCreditsPerSecond480p,
      '720p': input.settings.seedance2FastCreditsPerSecond720p,
    },
    'doubao-seedance-2-0-mini-260615': {
      '480p': input.settings.seedance2MiniCreditsPerSecond480p,
      '720p': input.settings.seedance2MiniCreditsPerSecond720p,
    },
  }[input.modelId];
  if (!modelPrices) {
    throw new Error(`视频模型「${input.modelName || input.modelId}」尚未配置按清晰度计费价格`);
  }
  const creditsPerSecond = Number(modelPrices[resolution]);
  if (!Number.isFinite(creditsPerSecond) || creditsPerSecond < 0) {
    throw new Error(`视频模型「${input.modelName || input.modelId}」的 ${resolution} 计费价格无效`);
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('视频时长无效');
  }
  const durationSeconds = Math.max(1, Math.ceil(input.durationSeconds));
  return {
    credits: roundCredits(durationSeconds * creditsPerSecond),
    creditsPerSecond,
    durationSeconds,
    resolution,
  };
}

export function recordVoiceCloneUsage(input: {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  groupId?: string;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
}) {
  const billing = nonLlmModelBillingSettingsOf(input.modelConfig);
  return persistBillableUsageCharge({
    userId: input.userId,
    category: 'voice_clone',
    modelConfig: input.modelConfig,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    groupId: input.groupId,
    pricingMode: 'per_request',
    quantitySnapshot: {
      requests: 1,
      priceSource: billing.priceSource,
    },
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    creditBaseCost: billing.voiceCloneCredits,
    multiplier: billing.multiplier,
    priceSource: billing.priceSource,
  });
}

export function recordSpeechSynthesisUsage(input: {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  taskId?: string;
  groupId?: string;
  charCount: number;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
}) {
  const billing = nonLlmModelBillingSettingsOf(input.modelConfig);
  return persistBillableUsageCharge({
    userId: input.userId,
    category: 'speech_synthesis',
    modelConfig: input.modelConfig,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    taskId: input.taskId,
    groupId: input.groupId,
    pricingMode: 'per_1k_chars',
    quantitySnapshot: {
      charCount: input.charCount,
      units1kChars: charsTo1kUnits(input.charCount),
      priceSource: billing.priceSource,
    },
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    creditBaseCost: roundCredits(charsTo1kUnits(input.charCount) * billing.speechCreditsPer1kChars),
    multiplier: billing.multiplier,
    priceSource: billing.priceSource,
  });
}

export function recordVodUploadUsage(input: {
  userId: string;
  sourceType: string;
  sourceId: string;
  taskId?: string;
  sessionId?: string;
  fileSizeBytes: number;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
}) {
  const settings = assertSystemBillingReady();
  const fileSizeMb = bytesToMb(input.fileSizeBytes);
  const billedSizeMb = billedVodUploadMegabytes(input.fileSizeBytes);
  const creditCost = estimateVodUploadCredits(input.fileSizeBytes);
  return persistBillableUsageCharge({
    userId: input.userId,
    category: 'vod_upload',
    provider: 'volcengine-vod',
    model: 'vod_upload',
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    pricingMode: 'per_mb',
    quantitySnapshot: {
      fileSizeBytes: input.fileSizeBytes,
      actualSizeMb: roundCredits(fileSizeMb),
      billedSizeMb,
      sizeMb: billedSizeMb,
      priceSource: 'system-billing-settings',
      configuredCreditsPerMb: settings.videoUploadCreditsPerMb,
    },
    requestSnapshot: {
      ...(input.requestSnapshot || {}),
      fileSizeBytes: input.fileSizeBytes,
    },
    creditBaseCost: creditCost,
    multiplier: 1,
    priceSource: 'system-billing-settings',
    usageRaw: {
      directCreditPricing: true,
      directCreditCost: creditCost,
    },
    responseSnapshot: {
      ...(input.responseSnapshot || {}),
      directCreditPricing: true,
    },
  });
}

export function adjustUserCredits(input: {
  userId: string;
  delta: number;
  operatorUserId?: string;
}) {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    const nextCreditBalance = roundCredits(user.creditBalance + input.delta);
    if (nextCreditBalance < 0) {
      throw new Error('用户积分不能小于 0');
    }
    userRepository.updateCreditBalance(user.id, nextCreditBalance);
    billingRepository.createLedgerEntry({
      id: randomBytes(12).toString('hex'),
      userId: user.id,
      type: 'admin_adjust',
      creditDelta: roundCredits(input.delta),
      creditBalanceAfter: nextCreditBalance,
      creditBaseCost: null,
      creditBilledCost: null,
      sourceType: 'admin_adjust',
      sourceId: input.operatorUserId || null,
      snapshot: {
        operatorUserId: input.operatorUserId,
      },
      createdAt: now,
    });
    return userRepository.findById(user.id);
  });
  return runCreditTransaction(input.userId, transaction);
}

export async function callBilledLlm(input: BilledLlmCallInput) {
  const { settings, modelBilling } = assertBillingReady(input.modelConfig);
  assertSufficientLlmRequestCredits({
    userId: input.userId,
    thresholdCredits: modelBilling.maxOutputCreditsForReserve,
    step: 'llm_request',
    stepLabel: 'LLM 请求',
  });
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(input.timeoutMs)) && Number(input.timeoutMs) > 0
    ? Number(input.timeoutMs)
    : 120_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) as NonStreamCompletionResponse : {};
    if (!response.ok) {
      throw new Error(data.error?.message || data.message || `模型服务请求失败：${response.status}`);
    }
    const content = data.choices?.[0]?.message?.content?.trim();
    const reasoning = (
      data.choices?.[0]?.message?.reasoning_content
      || data.choices?.[0]?.message?.reasoning
      || data.choices?.[0]?.message?.thinking_content
      || data.choices?.[0]?.message?.thinking
      || ''
    ).trim();
    if (!content) {
      throw new Error('模型服务未返回有效内容');
    }
    const usage = normalizeUsage(data.usage);
    const finalUsage = usage.promptTokens || usage.completionTokens
      ? usage
      : {
        promptTokens: estimateMessageTokens(input.messages),
        completionTokens: estimateTextTokens(`${reasoning}\n${content}`),
        cachedPromptTokens: 0,
      };
    recordLlmUsageCharge({
      userId: input.userId,
      modelConfig: input.modelConfig,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      settings,
      modelBilling,
      usage: finalUsage,
    });
    return {
      content,
      reasoning,
      usage: finalUsage,
    };
  } catch (error) {
    recordFailedUsage({
      userId: input.userId,
      modelConfig: input.modelConfig,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      settings,
      modelBilling,
    });
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('模型服务响应超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function* streamBilledLlm(input: BilledLlmCallInput): AsyncGenerator<BilledLlmStreamChunk, void, void> {
  const { settings, modelBilling } = assertBillingReady(input.modelConfig);
  assertSufficientLlmRequestCredits({
    userId: input.userId,
    thresholdCredits: modelBilling.maxOutputCreditsForReserve,
    step: 'llm_request',
    stepLabel: 'LLM 请求',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const upstreamSignal = input.signal;
  const handleUpstreamAbort = () => {
    controller.abort(upstreamSignal?.reason);
  };
  upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true });
  let finalUsage: NormalizedLlmUsage | null = null;
  let reasoningContent = '';
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
        stream_options: {
          include_usage: true,
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      const data = text ? JSON.parse(text) as StreamCompletionResponse : {};
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
        if (!trimmed || !trimmed.startsWith('data:')) {
          continue;
        }
        const dataText = trimmed.replace(/^data:\s?/, '');
        if (dataText === '[DONE]') {
          break;
        }
        const data = JSON.parse(dataText) as StreamCompletionResponse;
        if (data.error?.message) {
          throw new Error(data.error.message);
        }
        const usage = normalizeUsage(data.usage);
        if (usage.promptTokens || usage.completionTokens || usage.cachedPromptTokens) {
          finalUsage = usage;
        }
        for (const choice of data.choices || []) {
          const delta = choice.delta || {};
          const reasoningDelta = delta.reasoning_content || delta.reasoning || delta.thinking_content || delta.thinking;
          if (reasoningDelta) {
            reasoningContent += reasoningDelta;
            yield { type: 'reasoning', delta: reasoningDelta };
          }
          if (delta.content) {
            answerContent += delta.content;
            yield { type: 'answer', delta: delta.content };
          }
        }
      }
    }
    if (!answerContent.trim()) {
      throw new Error('模型服务未返回有效内容');
    }
    if (!finalUsage) {
      finalUsage = {
        promptTokens: estimateMessageTokens(input.messages),
        completionTokens: estimateTextTokens(`${reasoningContent}\n${answerContent}`),
        cachedPromptTokens: 0,
      };
    }
    recordLlmUsageCharge({
      userId: input.userId,
      modelConfig: input.modelConfig,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      settings,
      modelBilling,
      usage: finalUsage,
    });
  } catch (error) {
    recordFailedUsage({
      userId: input.userId,
      modelConfig: input.modelConfig,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      settings,
      modelBilling,
      usage: finalUsage || {
        promptTokens: estimateMessageTokens(input.messages),
        completionTokens: estimateTextTokens(`${reasoningContent}\n${answerContent}`),
        cachedPromptTokens: 0,
      },
    });
    if (error instanceof Error && error.name === 'AbortError') {
      if (upstreamSignal?.aborted) {
        throw new Error('请求已取消');
      }
      throw new Error('模型服务响应超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', handleUpstreamAbort);
  }
}

function recordLlmUsageCharge(input: {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  settings: BillingSettings;
  modelBilling: ModelBillingSettings;
  usage: NormalizedLlmUsage;
}) {
  const creditBaseCost = calculateCreditBaseCost(input.usage, input.modelBilling);
  const creditBilledCost = roundCredits(creditBaseCost * input.modelBilling.multiplier);
  const creditCost = creditBilledCost;
  const now = new Date().toISOString();
  const snapshot = buildSnapshot({
    modelConfig: input.modelConfig,
    billingSettings: input.settings,
    modelBilling: input.modelBilling,
    usage: input.usage,
  });

  const transaction = db.transaction(() => {
    const user = userRepository.findById(input.userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    let nextCreditBalance = user.creditBalance;
    if (creditCost > 0) {
      nextCreditBalance = roundCredits(nextCreditBalance - creditCost);
      userRepository.updateCreditBalance(user.id, nextCreditBalance);
      billingRepository.createLedgerEntry({
        id: randomBytes(12).toString('hex'),
        userId: user.id,
        type: 'usage_debit',
        creditDelta: -creditCost,
        creditBalanceAfter: nextCreditBalance,
        creditBaseCost,
        creditBilledCost,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        snapshot,
        createdAt: now,
      });
    }
    const usageRecord: LlmUsageRecord = {
      id: randomBytes(12).toString('hex'),
      userId: input.userId,
      modelConfigId: input.modelConfig.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      cachedPromptTokens: input.usage.cachedPromptTokens,
      usageRaw: snapshot.usage && isRecord(snapshot.usage) ? snapshot.usage : {},
      billingSnapshot: snapshot,
      creditBaseCost,
      creditBilledCost,
      creditCost,
      status: 'completed',
      createdAt: now,
    };
    billingRepository.createUsageRecord(usageRecord);
    return {
      nextCreditBalance,
      creditCost,
    };
  });

  return runCreditTransaction(input.userId, transaction);
}
