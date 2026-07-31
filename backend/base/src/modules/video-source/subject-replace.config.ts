import { seedanceVideoDefaults } from './seedance-video.config.js';

export const subjectReplaceTypes = ['model', 'clothing', 'face', 'background', 'product'] as const;
export type SubjectReplaceType = typeof subjectReplaceTypes[number];

export const subjectReplaceDefaults = {
  preserveAudio: true,
  quality: seedanceVideoDefaults.quality,
  subjectType: 'model' as SubjectReplaceType,
  videoModelId: seedanceVideoDefaults.modelId,
} as const;

const supportedSubjectReplaceTypes = new Set<string>(subjectReplaceTypes);

export function isSubjectReplaceType(value: unknown): value is SubjectReplaceType {
  return typeof value === 'string' && supportedSubjectReplaceTypes.has(value);
}
