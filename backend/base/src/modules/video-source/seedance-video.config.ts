export const seedanceVideoModelIds = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
] as const;

export const seedanceVideoDefaults = {
  modelId: seedanceVideoModelIds[0],
  quality: '标清 (720p)',
} as const;

const supportedModelIds = new Set<string>(seedanceVideoModelIds);

export function isSeedanceVideoModelId(value: string) {
  return supportedModelIds.has(value);
}

export function normalizeSeedanceVideoQuality(value: unknown) {
  return value === '480P' || value === '普清 (480p)'
    ? '普清 (480p)'
    : '标清 (720p)';
}
