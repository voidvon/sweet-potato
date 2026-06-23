import type { AiModelConfig } from '../model-configs/model-config.types.js';

export type BillingSettings = {
  id: 1;
  videoUploadCreditsPerMb: number;
  videoUnderstandingCreditsPer1MTokens: number;
  createdAt: string;
  updatedAt: string;
};

export type CreditLedgerType =
  | 'reserve_debit'
  | 'reserve_refund'
  | 'llm_extra_debit'
  | 'usage_debit'
  | 'admin_adjust';

export type CreditLedgerEntry = {
  id: string;
  userId: string;
  type: CreditLedgerType;
  creditDelta: number;
  creditBalanceAfter: number;
  creditBaseCost?: number | null;
  creditBilledCost?: number | null;
  sourceType?: string | null;
  sourceId?: string | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
};

export type CreditReservationStatus = 'reserved' | 'settled' | 'released';

export type CreditReservation = {
  id: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  reservedCredits: number;
  status: CreditReservationStatus;
  snapshot: Record<string, unknown>;
  createdAt: string;
  settledAt?: string | null;
};

export type LlmUsageRecordStatus = 'completed' | 'failed';

export type LlmUsageRecord = {
  id: string;
  userId: string;
  modelConfigId: string;
  sourceType: string;
  sourceId: string;
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
  usageRaw: Record<string, unknown>;
  billingSnapshot: Record<string, unknown>;
  creditBaseCost: number;
  creditBilledCost: number;
  creditCost: number;
  status: LlmUsageRecordStatus;
  createdAt: string;
};

export type BillableUsageCategory =
  | 'image_generation'
  | 'video_generation'
  | 'voice_clone'
  | 'speech_synthesis'
  | 'vod_upload'
  | 'vod_understanding';

export type BillableUsagePricingMode =
  | 'per_request'
  | 'per_second'
  | 'per_minute'
  | 'per_1k_chars'
  | 'per_mb'
  | 'per_1m_tokens';

export type BillableUsageRecordStatus = 'completed' | 'failed';

export type BillableUsageRecord = {
  id: string;
  userId: string;
  category: BillableUsageCategory;
  modelConfigId?: string | null;
  provider?: string | null;
  model?: string | null;
  sourceType: string;
  sourceId: string;
  taskId?: string | null;
  sessionId?: string | null;
  groupId?: string | null;
  pricingMode: BillableUsagePricingMode;
  quantitySnapshot: Record<string, unknown>;
  usageRaw: Record<string, unknown>;
  requestSnapshot: Record<string, unknown>;
  responseSnapshot: Record<string, unknown>;
  creditBaseCost: number;
  creditBilledCost: number;
  creditCost: number;
  status: BillableUsageRecordStatus;
  createdAt: string;
};

export type ModelBillingSettings = {
  multiplier: number;
  inputCreditsPer1M: number;
  outputCreditsPer1M: number;
  cachedInputCreditsPer1M: number;
  maxOutputCreditsForReserve: number;
  priceSource: string;
};

export type NormalizedLlmUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens: number;
};

export type BillingContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type BillingChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | BillingContentPart[];
};

export type BilledLlmStreamChunk =
  | { type: 'reasoning'; delta: string }
  | { type: 'answer'; delta: string };

export type BilledLlmCallInput = {
  userId: string;
  modelConfig: AiModelConfig;
  sourceType: string;
  sourceId: string;
  messages: BillingChatMessage[];
  temperature: number;
  timeoutMs?: number;
};
