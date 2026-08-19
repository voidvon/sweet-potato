type ImageModelBillingSource = {
  settings?: Record<string, unknown>;
};

export type ImageGenerationOutputCountStrategy =
  | 'selectable'
  | 'fixedOne'
  | 'matchUploadedImages'
  | 'matchReferenceGroup';

function numericValue(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function imageGenerationCreditsPerRequest(model: ImageModelBillingSource | undefined) {
  const settings = model?.settings && typeof model.settings === 'object' ? model.settings : {};
  const billing = settings.billing && typeof settings.billing === 'object' && !Array.isArray(settings.billing)
    ? settings.billing as Record<string, unknown>
    : {};
  return Math.max(0, numericValue(billing.creditsPerRequest, numericValue(billing.perRequestUsd, 0)));
}

export function estimateImageGenerationCredits(creditsPerRequest: number, outputCount: number) {
  const credits = Math.max(0, numericValue(creditsPerRequest));
  const count = Math.max(0, Math.floor(numericValue(outputCount)));
  return Math.round((credits * count + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function resolveImageGenerationOutputCount(input: {
  strategy?: ImageGenerationOutputCountStrategy;
  requestedCount: number;
  uploadedImageCount: number;
  referenceGroupImageCount?: number;
}) {
  if (input.strategy === 'fixedOne') return 1;
  if (input.strategy === 'matchUploadedImages') return Math.max(1, Math.floor(input.uploadedImageCount));
  if (input.strategy === 'matchReferenceGroup') {
    return Math.max(1, Math.floor(input.referenceGroupImageCount || 0));
  }
  return Math.max(1, Math.floor(input.requestedCount));
}
