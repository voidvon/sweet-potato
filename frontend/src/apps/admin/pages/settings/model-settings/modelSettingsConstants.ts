import type { ModelConfig, ModelType } from '../../../types';
import { t } from '@shared/i18n';

export const visibleModelTypes: Array<{ key: ModelType; label: string }> = [
  { key: 'llm', label: t("LLM 模型") },
  { key: 'image', label: t("图片模型") },
  { key: 'video', label: t("视频模型") },
  // { key: 'audio', label: '音频模型' },
];

export const defaultFormValues: ModelConfig = {
  type: 'llm',
  name: '',
  provider: '',
  model: '',
  apiKey: '',
  baseUrl: '',
  temperature: 0.7,
  settings: {
    billing: {
      multiplier: 1,
      inputCreditsPer1M: 0,
      outputCreditsPer1M: 0,
      cachedInputCreditsPer1M: 0,
      maxOutputCreditsForReserve: 0,
      priceSource: 'official-manual',
    },
  },
  isDefault: false,
};

export const modelTypeLabelMap: Record<ModelType, string> = {
  llm: t("LLM 模型"),
  image: t("图片模型"),
  video: t("视频模型"),
  audio: t("音频模型"),
};

export function modelTypeFromTabParam(value: string | null): ModelType {
  return visibleModelTypes.some((item) => item.key === value) ? value as ModelType : 'llm';
}
