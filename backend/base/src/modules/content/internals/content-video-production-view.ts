import type { VideoGenerationResult, VideoGenerationTask } from '../content.types.js';

const stringContextKeys = [
  'currentStep',
  'enhancementResolution',
  'mode',
  'quality',
  'subjectReplaceType',
  'subjectType',
  'subtitleRemovalMode',
  'videoTranslationSourceLanguage',
  'videoTranslationTargetLanguage',
] as const;

const stringArrayContextKeys = [
  'videoTranslationTypes',
] as const;

function exposedGenerationResult(task: VideoGenerationTask) {
  const result = task.editableParseResult.videoGenerationResult
    || task.expertContext.videoGenerationResult as VideoGenerationResult | undefined;
  if (!result) {
    return undefined;
  }
  return {
    status: result.status,
    videoUrl: result.videoUrl,
    coverUrl: result.coverUrl,
    errorMessage: result.errorMessage,
    duration: result.duration,
    ratio: result.ratio,
    renderStatus: result.renderStatus,
    assetId: result.assetId,
    generatedAt: result.generatedAt,
  };
}

function exposedContext(context: Record<string, unknown>) {
  const entries: Array<[string, unknown]> = [];
  stringContextKeys.forEach((key) => {
    if (typeof context[key] === 'string') entries.push([key, context[key]]);
  });
  stringArrayContextKeys.forEach((key) => {
    if (Array.isArray(context[key])) entries.push([key, context[key].filter((item): item is string => typeof item === 'string')]);
  });
  return Object.fromEntries(entries);
}

export function toVideoProductionView(task: VideoGenerationTask) {
  const videoGenerationResult = exposedGenerationResult(task);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    editableParseResult: videoGenerationResult ? { videoGenerationResult } : {},
    expertContext: exposedContext(task.expertContext),
    generatedVideoUrl: task.generatedVideoUrl,
    generatedCoverUrl: task.generatedCoverUrl,
    aspectRatio: task.aspectRatio,
    creditCost: task.creditCost,
    failureReason: task.failureReason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
