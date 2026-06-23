import { randomBytes } from 'node:crypto';
import { llmModelPricingRepository, type LlmModelPricingRecord } from './llm-model-pricing.repository.js';

type LlmModelPricingPayload = Partial<LlmModelPricingRecord>;

function normalizeNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeCurrency(value: unknown, fallback: LlmModelPricingRecord['currency'] = 'USD') {
  return value === 'CNY' ? 'CNY' : value === 'USD' ? 'USD' : fallback;
}

export function listLlmModelPricing() {
  return llmModelPricingRepository.list();
}

export function findLlmModelPricing(provider: string, model: string) {
  return llmModelPricingRepository.findByProviderAndModel(provider, model);
}

export function normalizeLlmModelPricing(
  payload: LlmModelPricingPayload,
  fallback?: LlmModelPricingRecord,
): LlmModelPricingRecord {
  const now = new Date().toISOString();
  const priceUpdatedAt = String(payload.priceUpdatedAt || fallback?.priceUpdatedAt || '').trim() || now.slice(0, 10);

  return {
    id: String(payload.id || fallback?.id || `llm-pricing-${randomBytes(6).toString('hex')}`).trim(),
    provider: String(payload.provider || fallback?.provider || '').trim(),
    providerName: String(payload.providerName || fallback?.providerName || '').trim(),
    model: String(payload.model || fallback?.model || '').trim(),
    displayName: String(payload.displayName || fallback?.displayName || '').trim(),
    defaultBaseUrl: String(payload.defaultBaseUrl || fallback?.defaultBaseUrl || '').trim(),
    currency: normalizeCurrency(payload.currency, fallback?.currency || 'USD'),
    inputPricePer1M: normalizeNumber(payload.inputPricePer1M, fallback?.inputPricePer1M || 0),
    outputPricePer1M: normalizeNumber(payload.outputPricePer1M, fallback?.outputPricePer1M || 0),
    cachedInputPricePer1M: normalizeNumber(payload.cachedInputPricePer1M, fallback?.cachedInputPricePer1M || 0),
    priceSource: String(payload.priceSource || fallback?.priceSource || 'official-manual').trim() || 'official-manual',
    priceUpdatedAt,
    createdAt: fallback?.createdAt || now,
    updatedAt: now,
  };
}

export function assertLlmModelPricing(record: LlmModelPricingRecord) {
  if (!record.provider || !record.providerName || !record.model || !record.displayName || !record.defaultBaseUrl) {
    throw new Error('请完整填写 LLM 官方价格目录信息');
  }

  if (
    record.inputPricePer1M < 0
    || record.outputPricePer1M < 0
    || record.cachedInputPricePer1M < 0
  ) {
    throw new Error('LLM 官方价格不能小于 0');
  }
}
