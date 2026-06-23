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
