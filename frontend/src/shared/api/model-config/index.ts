import type { ImageModelOption, LlmModelPricing, ModelConfig, ModelType, VideoModelOption } from '../../types';
import { request } from '../core/request';

enum Api {
  modelConfigs = '/api/model-configs',
  llmModelPricing = '/api/model-configs/llm-model-pricing',
  audioProviders = '/api/model-configs/audio-providers',
  imageProviders = '/api/model-configs/image-providers',
  videoProviders = '/api/model-configs/video-providers',
  modelConfigDetail = '/api/model-configs/:id',
  defaultModelConfig = '/api/model-configs/:id/default',
}

export function listModelConfigs(type?: ModelType) {
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  return request<ModelConfig[]>(`${Api.modelConfigs}${query}`);
}

export function listLlmModelPricing() {
  return request<LlmModelPricing[]>(Api.llmModelPricing);
}

export function createLlmModelPricing(payload: LlmModelPricing) {
  return request<LlmModelPricing>(Api.llmModelPricing, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateLlmModelPricing(id: string, payload: LlmModelPricing) {
  return request<LlmModelPricing>(`${Api.llmModelPricing}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteLlmModelPricing(id: string) {
  return request<void>(`${Api.llmModelPricing}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function createModelConfig(payload: ModelConfig) {
  return request<ModelConfig>(Api.modelConfigs, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type AudioModelProviderOption = {
  id: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp?: string;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  baseUrlHelp?: string;
  defaultBaseUrl?: string;
  defaultModel: string;
};

export function listAudioModelProviders() {
  return request<AudioModelProviderOption[]>(Api.audioProviders);
}

export type ImageModelProviderOption = {
  id: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultSettings?: Record<string, unknown>;
  models: ImageModelOption[];
};

export function listImageModelProviders() {
  return request<ImageModelProviderOption[]>(Api.imageProviders);
}

export type VideoModelProviderOption = {
  id: string;
  name: string;
  description: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHelp?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: VideoModelOption[];
};

export function listVideoModelProviders() {
  return request<VideoModelProviderOption[]>(Api.videoProviders);
}

export function updateModelConfig(id: string, payload: ModelConfig) {
  return request<ModelConfig>(Api.modelConfigDetail.replace(':id', id), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function setDefaultModelConfig(id: string) {
  return request<ModelConfig>(Api.defaultModelConfig.replace(':id', id), {
    method: 'PUT',
  });
}

export function deleteModelConfig(id: string) {
  return request<void>(Api.modelConfigDetail.replace(':id', id), {
    method: 'DELETE',
  });
}
