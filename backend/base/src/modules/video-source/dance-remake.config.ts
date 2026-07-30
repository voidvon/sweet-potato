export const danceRemakeModelIds = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
] as const;

export const danceRemakeDefaults = {
  enhancedModelId: danceRemakeModelIds[0],
  enhancedQuality: '标清 (720p)',
  standardModelId: danceRemakeModelIds[2],
  standardQuality: '普清 (480p)',
} as const;

const supportedDanceRemakeModelIds = new Set<string>(danceRemakeModelIds);

export function isDanceRemakeModelId(value: string) {
  return supportedDanceRemakeModelIds.has(value);
}

export function normalizeDanceRemakeQuality(value: unknown) {
  return value === '480P' || value === '普清 (480p)'
    ? '普清 (480p)'
    : '标清 (720p)';
}
