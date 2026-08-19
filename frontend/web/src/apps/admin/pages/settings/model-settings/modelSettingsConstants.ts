import type { ModelConfig, ModelType } from '../../../types';

export const visibleModelTypes: Array<{ key: ModelType; label: string }> = [
  { key: 'llm', label: 'LLM 模型' },
  { key: 'image', label: '图片模型' },
  { key: 'video', label: '视频模型' },
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
  llm: 'LLM 模型',
  image: '图片模型',
  video: '视频模型',
  audio: '音频模型',
};

export function modelTypeFromTabParam(value: string | null): ModelType {
  return visibleModelTypes.some((item) => item.key === value) ? value as ModelType : 'llm';
}
