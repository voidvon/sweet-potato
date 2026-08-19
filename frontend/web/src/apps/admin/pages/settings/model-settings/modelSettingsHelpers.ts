import {
  createModelConfig,
  updateModelConfig,
} from '../../../api/model-config';
import type {
  AudioModelProviderOption,
  ImageModelProviderOption,
  VideoModelProviderOption,
} from '../../../api/model-config';
import type {
  AudioBillingSettings,
  ImageBillingSettings,
  LlmBillingSettings,
  LlmModelPricing,
  ModelConfig,
  ModelType,
  VideoBillingSettings,
} from '../../../types';
import { defaultFormValues } from './modelSettingsConstants';

export type ModelFormValues = ModelConfig;

export function saveModelConfig(values: ModelConfig) {
  return values.id ? updateModelConfig(values.id, values) : createModelConfig(values);
}

export function toNumericValue(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function toTwoDecimalValue(value: unknown, fallback = 0) {
  return Math.round((toNumericValue(value, fallback) + Number.EPSILON) * 100) / 100;
}

export function findLlmPricing(catalog: LlmModelPricing[], provider: string, model: string) {
  return catalog.find((item) => item.provider === provider && item.model === model);
}

export function llmBillingFromPricing(
  pricing: LlmModelPricing,
  currentBilling: Partial<LlmBillingSettings> = {},
): LlmBillingSettings {
  return {
    multiplier: toNumericValue(currentBilling.multiplier, 1),
    inputCreditsPer1M: pricing.inputPricePer1M,
    outputCreditsPer1M: pricing.outputPricePer1M,
    cachedInputCreditsPer1M: pricing.cachedInputPricePer1M,
    maxOutputCreditsForReserve: toNumericValue(currentBilling.maxOutputCreditsForReserve, 0),
    priceCurrency: pricing.currency,
    priceSource: pricing.priceSource,
    priceUpdatedAt: pricing.priceUpdatedAt,
  };
}

export function llmBillingSettingsOf(record: ModelConfig): LlmBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    multiplier: toNumericValue(billing.multiplier, 1),
    inputCreditsPer1M: toNumericValue(billing.inputCreditsPer1M, toNumericValue(billing.inputUsdPer1M, 0)),
    outputCreditsPer1M: toNumericValue(billing.outputCreditsPer1M, toNumericValue(billing.outputUsdPer1M, 0)),
    cachedInputCreditsPer1M: toNumericValue(
      billing.cachedInputCreditsPer1M,
      toNumericValue(billing.cachedInputUsdPer1M, 0),
    ),
    maxOutputCreditsForReserve: toNumericValue(
      billing.maxOutputCreditsForReserve,
      toNumericValue(billing.maxOutputTokensForReserve, 100),
    ),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
    priceCurrency: billing.priceCurrency === 'CNY' ? 'CNY' : billing.priceCurrency === 'USD' ? 'USD' : undefined,
    priceUpdatedAt: typeof billing.priceUpdatedAt === 'string' && billing.priceUpdatedAt.trim()
      ? billing.priceUpdatedAt.trim()
      : undefined,
  };
}

export function imageBillingSettingsOf(record: ModelConfig): ImageBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    creditsPerRequest: toTwoDecimalValue(billing.creditsPerRequest, toNumericValue(billing.perRequestUsd, 0)),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
  };
}

function imageGenerationSettingsOf(record: ModelConfig | null) {
  const settings = record?.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  return settings.imageGeneration && typeof settings.imageGeneration === 'object'
    ? settings.imageGeneration as Record<string, unknown>
    : {};
}

function imageGenerationSupportsCustomResolutionOf(record: ModelConfig | null) {
  return imageGenerationSettingsOf(record).supportsCustomResolution === true;
}

export function imageGenerationSummary(record: ModelConfig) {
  const items = [
    imageGenerationSupportsCustomResolutionOf(record) ? '支持自定义分辨率' : '固定分辨率',
  ].filter(Boolean);
  return items.join('，') || '默认参数';
}

export function videoBillingSettingsOf(record: ModelConfig): VideoBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'system-billing-settings',
  };
}

export function audioBillingSettingsOf(record: ModelConfig): AudioBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    multiplier: toNumericValue(billing.multiplier, 1),
    voiceCloneCredits: toNumericValue(billing.voiceCloneCredits, toNumericValue(billing.voiceCloneUsd, 0)),
    speechCreditsPer1kChars: toNumericValue(
      billing.speechCreditsPer1kChars,
      toNumericValue(billing.speechUsdPer1kChars, 0),
    ),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
  };
}

export function normalizedSettingsForForm(record: ModelConfig | null, activeType: ModelType) {
  const settings = record?.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};

  const billing = activeType === 'llm'
    ? llmBillingSettingsOf(record || defaultFormValues)
    : activeType === 'image'
      ? imageBillingSettingsOf(record || defaultFormValues)
      : activeType === 'video'
        ? videoBillingSettingsOf(record || defaultFormValues)
        : audioBillingSettingsOf(record || defaultFormValues);

  return {
    ...settings,
    ...(activeType === 'image'
      ? {
        imageGeneration: {
          ...imageGenerationSettingsOf(record),
          supportsCustomResolution: imageGenerationSupportsCustomResolutionOf(record),
        },
      }
      : {}),
    billing,
  };
}

export function audioProviderConfigRow(
  provider: AudioModelProviderOption,
  existing?: ModelConfig,
  overrides: Partial<ModelConfig> = {},
): ModelConfig {
  const baseRecord = {
    ...defaultFormValues,
    ...existing,
    ...overrides,
  };
  return {
    ...baseRecord,
    type: 'audio',
    name: provider.name,
    provider: provider.id,
    model: provider.defaultModel,
    baseUrl: overrides.baseUrl ?? existing?.baseUrl ?? provider.defaultBaseUrl ?? '',
    temperature: existing?.temperature ?? 0.7,
    settings: {
      ...(existing?.settings || {}),
      ...(overrides.settings || {}),
      billing: {
        ...audioBillingSettingsOf(baseRecord as ModelConfig),
        ...(overrides.settings && typeof overrides.settings === 'object' && 'billing' in overrides.settings
          ? ((overrides.settings as Record<string, unknown>).billing as Record<string, unknown> || {})
          : {}),
      },
    },
    apiKey: overrides.apiKey ?? existing?.apiKey ?? '',
    isDefault: Boolean(overrides.isDefault ?? existing?.isDefault ?? false),
  };
}

export function videoProviderConfigRow(
  provider: VideoModelProviderOption,
  existing?: ModelConfig,
  overrides: Partial<ModelConfig> = {},
): ModelConfig {
  const baseRecord = {
    ...defaultFormValues,
    ...existing,
    ...overrides,
  };
  return {
    ...baseRecord,
    type: 'video',
    name: provider.name,
    provider: provider.id,
    model: overrides.model || existing?.model || provider.defaultModel,
    baseUrl: overrides.baseUrl ?? existing?.baseUrl ?? provider.defaultBaseUrl,
    temperature: 0,
    settings: {
      ...(existing?.settings || {}),
      ...(overrides.settings || {}),
      billing: {
        ...videoBillingSettingsOf(baseRecord as ModelConfig),
        ...(overrides.settings && typeof overrides.settings === 'object' && 'billing' in overrides.settings
          ? ((overrides.settings as Record<string, unknown>).billing as Record<string, unknown> || {})
          : {}),
      },
    },
    apiKey: overrides.apiKey ?? existing?.apiKey ?? '',
    isDefault: Boolean(overrides.isDefault ?? existing?.isDefault ?? false),
  };
}

export function normalizeImagePayload(payload: ModelConfig): ModelConfig {
  const settings = payload.settings && typeof payload.settings === 'object'
    ? payload.settings
    : {};
  const billing = settings.billing && typeof settings.billing === 'object' && !Array.isArray(settings.billing)
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    ...payload,
    settings: {
      ...settings,
      billing: {
        ...billing,
        creditsPerRequest: toTwoDecimalValue(
          billing.creditsPerRequest,
          toNumericValue(billing.perRequestUsd, 0),
        ),
      },
    },
  };
}
