export const DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS = 15 * 60_000;

export function defaultVideoPollMaxAttempts(intervalMs: number) {
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1;
  return Math.max(1, Math.ceil(DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS / safeIntervalMs));
}
