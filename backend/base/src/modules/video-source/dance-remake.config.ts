import {
  isSeedanceVideoModelId,
  normalizeSeedanceVideoQuality,
  seedanceVideoDefaults,
  seedanceVideoModelIds,
} from './seedance-video.config.js';

export const danceRemakeDefaults = {
  enhancedModelId: seedanceVideoDefaults.modelId,
  enhancedQuality: seedanceVideoDefaults.quality,
  standardModelId: seedanceVideoModelIds[2],
  standardQuality: '普清 (480p)',
} as const;

export function isDanceRemakeModelId(value: string) {
  return isSeedanceVideoModelId(value);
}

export function normalizeDanceRemakeQuality(value: unknown) {
  return normalizeSeedanceVideoQuality(value);
}
