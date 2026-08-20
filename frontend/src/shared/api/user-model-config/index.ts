import type { ModelConfig, ModelType } from '../../types';
import type { ImageModelProviderOption } from '../model-config';
import { request } from '../core/request';

const basePath = '/api/user-model-configs';

export function listUserModelConfigs(type?: Extract<ModelType, 'llm' | 'image'>) {
  return request<ModelConfig[]>(type ? `${basePath}?type=${type}` : basePath);
}

export function listUserImageModelConfigs() {
  return listUserModelConfigs('image');
}

export function listUserImageModelProviders() {
  return request<ImageModelProviderOption[]>(`${basePath}/image-providers`);
}

export function createUserModelConfig(payload: ModelConfig) {
  return request<ModelConfig>(basePath, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateUserModelConfig(id: string, payload: ModelConfig) {
  return request<ModelConfig>(`${basePath}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function setDefaultUserModelConfig(id: string) {
  return request<ModelConfig>(`${basePath}/${encodeURIComponent(id)}/default`, { method: 'PUT' });
}

export function deleteUserModelConfig(id: string) {
  return request<void>(`${basePath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const createUserImageModelConfig = createUserModelConfig;
export const updateUserImageModelConfig = updateUserModelConfig;
export const setDefaultUserImageModelConfig = setDefaultUserModelConfig;
export const deleteUserImageModelConfig = deleteUserModelConfig;
