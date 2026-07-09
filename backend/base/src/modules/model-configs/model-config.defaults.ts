import type { AiModelConfig } from './model-config.types.js';

export const defaultModelConfig: AiModelConfig = {
  id: 'default-llm',
  type: 'llm',
  name: '默认 LLM 模型',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.7,
  settings: {
    billing: {
      multiplier: 1,
      maxOutputCreditsForReserve: 0,
    },
  },
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const defaultImageModelConfig: AiModelConfig = {
  id: 'default-image',
  type: 'image',
  name: '默认图片模型',
  provider: 'volcengine-seedream',
  model: 'doubao-seedream-5-0-lite-260128',
  apiKey: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  temperature: 0.7,
  settings: {
    imageGeneration: {
      adapter: 'volcengine-seedream',
    },
    billing: {
      creditsPerRequest: 0,
      priceSource: 'official-manual',
    },
  },
  isDefault: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const openaiImageModelConfig: AiModelConfig = {
  id: 'openai-image',
  type: 'image',
  name: 'OpenAI Images',
  provider: 'openai-images',
  model: 'gpt-image-1',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.7,
  settings: {
    imageSize: '1024x1024',
    imageGeneration: {
      adapter: 'compatible',
    },
    billing: {
      creditsPerRequest: 0,
      priceSource: 'official-manual',
    },
  },
  isDefault: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
