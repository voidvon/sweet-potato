import { randomBytes } from 'node:crypto';
import { modelConfigRepository } from './model-config.repository.js';
import { findLlmModelPricing } from './llm-model-pricing.service.js';
import type { AiModelConfig, ModelType } from './model-config.types.js';

export function isModelType(value: unknown): value is ModelType {
  return ['llm', 'image', 'video', 'audio'].includes(String(value));
}

function normalizeSettings(value: unknown, fallback?: Record<string, unknown>) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return fallback || {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLlmBillingSettings(settings: Record<string, unknown>, provider: string, model: string) {
  const billing = isRecord(settings.billing) ? settings.billing : {};
  const pricing = findLlmModelPricing(provider, model);
  return {
    ...settings,
    billing: {
      multiplier: normalizeNumber(billing.multiplier, 1),
      inputCreditsPer1M: pricing
        ? pricing.inputPricePer1M
        : normalizeNumber(billing.inputCreditsPer1M, normalizeNumber(billing.inputUsdPer1M, 0)),
      outputCreditsPer1M: pricing
        ? pricing.outputPricePer1M
        : normalizeNumber(billing.outputCreditsPer1M, normalizeNumber(billing.outputUsdPer1M, 0)),
      cachedInputCreditsPer1M: pricing
        ? pricing.cachedInputPricePer1M
        : normalizeNumber(billing.cachedInputCreditsPer1M, normalizeNumber(billing.cachedInputUsdPer1M, 0)),
      maxOutputCreditsForReserve: Math.max(
        0,
        normalizeNumber(
          billing.maxOutputCreditsForReserve,
          normalizeNumber(billing.maxOutputTokensForReserve, 0),
        ),
      ),
      priceCurrency: pricing?.currency || String(billing.priceCurrency || '').trim() || undefined,
      priceUpdatedAt: pricing?.priceUpdatedAt || String(billing.priceUpdatedAt || '').trim() || undefined,
      priceSource: pricing?.priceSource || String(billing.priceSource || 'official-manual').trim() || 'official-manual',
    },
  };
}

function normalizeImageBillingSettings(settings: Record<string, unknown>) {
  const billing = isRecord(settings.billing) ? settings.billing : {};
  const imageGeneration = isRecord(settings.imageGeneration) ? settings.imageGeneration : {};
  return {
    ...settings,
    imageGeneration: {
      ...imageGeneration,
      supportsCustomResolution: imageGeneration.supportsCustomResolution === true,
    },
    billing: {
      creditsPerRequest: Math.max(
        0,
        normalizeNumber(billing.creditsPerRequest, normalizeNumber(billing.perRequestUsd, 0)),
      ),
      priceSource: String(billing.priceSource || 'official-manual').trim() || 'official-manual',
    },
  };
}

function normalizeVideoBillingSettings(settings: Record<string, unknown>) {
  const billing = isRecord(settings.billing) ? settings.billing : {};
  return {
    ...settings,
    billing: {
      multiplier: Math.max(0, normalizeNumber(billing.multiplier, 1)),
      creditsPer1MTokens: Math.max(
        0,
        normalizeNumber(billing.creditsPer1MTokens, normalizeNumber(billing.usdPer1MTokens, 0)),
      ),
      priceSource: String(billing.priceSource || 'official-manual').trim() || 'official-manual',
    },
  };
}

function normalizeAudioBillingSettings(settings: Record<string, unknown>) {
  const billing = isRecord(settings.billing) ? settings.billing : {};
  return {
    ...settings,
    billing: {
      multiplier: Math.max(0, normalizeNumber(billing.multiplier, 1)),
      voiceCloneCredits: Math.max(
        0,
        normalizeNumber(billing.voiceCloneCredits, normalizeNumber(billing.voiceCloneUsd, 0)),
      ),
      speechCreditsPer1kChars: Math.max(
        0,
        normalizeNumber(
          billing.speechCreditsPer1kChars,
          normalizeNumber(billing.speechUsdPer1kChars, 0),
        ),
      ),
      priceSource: String(billing.priceSource || 'official-manual').trim() || 'official-manual',
    },
  };
}

export function normalizeModelConfig(body: Record<string, unknown>, fallback?: AiModelConfig): AiModelConfig {
  const now = new Date().toISOString();
  const typeValue = body.type ?? fallback?.type ?? 'llm';
  const type = isModelType(typeValue) ? typeValue : 'llm';
  const provider = String(body.provider || fallback?.provider || '').trim();
  const model = String(body.model || fallback?.model || '').trim();
  const baseSettings = normalizeSettings(body.settings, fallback?.settings);
  const normalizedSettings = type === 'llm'
    ? normalizeLlmBillingSettings(baseSettings, provider, model)
    : type === 'image'
      ? normalizeImageBillingSettings(baseSettings)
      : type === 'video'
        ? normalizeVideoBillingSettings(baseSettings)
        : normalizeAudioBillingSettings(baseSettings);

  return {
    id: fallback?.id || randomBytes(12).toString('hex'),
    type,
    name: String(body.name || fallback?.name || '').trim(),
    provider,
    model,
    apiKey: String(body.apiKey ?? fallback?.apiKey ?? '').trim(),
    baseUrl: String(body.baseUrl ?? fallback?.baseUrl ?? '').trim().replace(/\/+$/, ''),
    temperature: Number(body.temperature ?? fallback?.temperature ?? 0.7),
    settings: normalizedSettings,
    isDefault: Boolean(body.isDefault ?? fallback?.isDefault ?? false),
    sortOrder: Number(body.sortOrder ?? fallback?.sortOrder ?? 0),
    createdAt: fallback?.createdAt || now,
    updatedAt: now,
  };
}

function assertLlmBillingSettings(config: AiModelConfig) {
  const pricing = findLlmModelPricing(config.provider, config.model);
  if (!pricing) {
    throw new Error('请选择价格目录中的 LLM 模型');
  }

  const settings = isRecord(config.settings) ? config.settings : {};
  const billing = isRecord(settings.billing) ? settings.billing : null;
  if (!billing) {
    throw new Error('请先完善 LLM 模型计费配置');
  }
  const multiplier = normalizeNumber(billing.multiplier, 0);
  const inputCreditsPer1M = normalizeNumber(
    billing.inputCreditsPer1M,
    normalizeNumber(billing.inputUsdPer1M, -1),
  );
  const outputCreditsPer1M = normalizeNumber(
    billing.outputCreditsPer1M,
    normalizeNumber(billing.outputUsdPer1M, -1),
  );
  const cachedInputCreditsPer1M = normalizeNumber(
    billing.cachedInputCreditsPer1M,
    normalizeNumber(billing.cachedInputUsdPer1M, -1),
  );
  const maxOutputCreditsForReserve = normalizeNumber(
    billing.maxOutputCreditsForReserve,
    normalizeNumber(billing.maxOutputTokensForReserve, 0),
  );

  if (multiplier <= 0) {
    throw new Error('LLM 模型消耗倍率必须大于 0');
  }
  if (inputCreditsPer1M < 0 || outputCreditsPer1M < 0 || cachedInputCreditsPer1M < 0) {
    throw new Error('LLM 模型的输入、输出和缓存命中价格不能小于 0');
  }
  if (maxOutputCreditsForReserve < 0) {
    throw new Error('LLM 模型的请求门槛不能小于 0');
  }
}

function assertImageBillingSettings(config: AiModelConfig) {
  if (/\/images\/(edits|generations|variations)$/i.test(config.baseUrl.replace(/\/+$/, ''))) {
    throw new Error('图片模型 Base URL 请填写 API 根地址，不要填写 /images/edits、/images/generations 或 /images/variations');
  }
  const settings = isRecord(config.settings) ? config.settings : {};
  const billing = isRecord(settings.billing) ? settings.billing : null;
  if (!billing) {
    return;
  }
  if (
    normalizeNumber(billing.creditsPerRequest, normalizeNumber(billing.perRequestUsd, 0)) < 0
  ) {
    throw new Error('图片模型计费配置不能小于 0');
  }
}

function assertVideoBillingSettings(config: AiModelConfig) {
  const settings = isRecord(config.settings) ? config.settings : {};
  const billing = isRecord(settings.billing) ? settings.billing : null;
  if (!billing) {
    return;
  }
  if (
    normalizeNumber(billing.multiplier, 1) < 0
    || normalizeNumber(billing.creditsPer1MTokens, normalizeNumber(billing.usdPer1MTokens, 0)) < 0
  ) {
    throw new Error('视频模型计费配置不能小于 0');
  }
}

function assertAudioBillingSettings(config: AiModelConfig) {
  const settings = isRecord(config.settings) ? config.settings : {};
  const billing = isRecord(settings.billing) ? settings.billing : null;
  if (!billing) {
    return;
  }
  if (
    normalizeNumber(billing.multiplier, 1) < 0
    || normalizeNumber(billing.voiceCloneCredits, normalizeNumber(billing.voiceCloneUsd, 0)) < 0
    || normalizeNumber(
      billing.speechCreditsPer1kChars,
      normalizeNumber(billing.speechUsdPer1kChars, 0),
    ) < 0
  ) {
    throw new Error('音频模型计费配置不能小于 0');
  }
}

export function serializeModelConfig(config: AiModelConfig) {
  return {
    ...config,
    isDefault: Boolean(config.isDefault),
  };
}

export function persistModelConfig(config: AiModelConfig, mode: 'insert' | 'update') {
  if (mode === 'insert') {
    config.sortOrder = modelConfigRepository.nextSortOrder(config.type);
  }
  if (config.type === 'audio' || config.type === 'video') {
    if (!config.name || !config.provider) {
      throw new Error('配置名称和服务商必填');
    }
    if (config.type === 'video') {
      assertVideoBillingSettings(config);
    } else {
      assertAudioBillingSettings(config);
    }
    modelConfigRepository.save(config, mode);
    return;
  }

  if (!config.name || !config.provider || !config.baseUrl || !config.model) {
    throw new Error('配置名称、服务商、模型名称和 Base URL 必填');
  }

  if (config.type === 'llm') {
    assertLlmBillingSettings(config);
  } else if (config.type === 'image') {
    assertImageBillingSettings(config);
  } else if (config.type === 'video') {
    assertVideoBillingSettings(config);
  } else if (config.type === 'audio') {
    assertAudioBillingSettings(config);
  }

  modelConfigRepository.save(config, mode);
}
