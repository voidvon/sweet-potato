export type ModelType = 'llm' | 'image' | 'video' | 'audio';

export type AiModelConfig = {
  id: string;
  type: ModelType;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  settings?: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};
