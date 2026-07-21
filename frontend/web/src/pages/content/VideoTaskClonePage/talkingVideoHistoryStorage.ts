import type { LocalMaterialFile, TalkingVideoPromptTask } from './types';
import { resolveAssetUrl } from '../../../api/request';

export const TALKING_VIDEO_HISTORY_LIMIT = 10;

function storageKey(userId: string) {
  return `video-task:talking-video-history:${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function persistedMaterial(value: unknown): LocalMaterialFile | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  const storedUrl = String(value.serverFileUrl || value.url || '').trim();
  if (!['image', 'video', 'audio'].includes(String(type)) || !storedUrl || storedUrl.startsWith('blob:')) return null;
  return {
    ...(typeof value.assetId === 'string' ? { assetId: value.assetId } : {}),
    ...(typeof value.audioDuration === 'number' ? { audioDuration: value.audioDuration } : {}),
    id: String(value.id || value.assetId || crypto.randomUUID()),
    ...(typeof value.mediaDuration === 'number' ? { mediaDuration: value.mediaDuration } : {}),
    name: String(value.name || '未命名素材'),
    ...(isRecord(value.remoteMetadata) ? { remoteMetadata: value.remoteMetadata } : {}),
    ...(typeof value.remoteSourceUrl === 'string' ? { remoteSourceUrl: value.remoteSourceUrl } : {}),
    ...(typeof value.serverFileUrl === 'string' ? { serverFileUrl: value.serverFileUrl } : {}),
    ...(typeof value.storedFileName === 'string' ? { storedFileName: value.storedFileName } : {}),
    ...(typeof value.talkingVideoRole === 'string'
      && ['model', 'product', 'background', 'detail'].includes(value.talkingVideoRole)
      ? { talkingVideoRole: value.talkingVideoRole as LocalMaterialFile['talkingVideoRole'] }
      : {}),
    ...(typeof value.trimDuration === 'number' ? { trimDuration: value.trimDuration } : {}),
    ...(typeof value.trimEnd === 'number' ? { trimEnd: value.trimEnd } : {}),
    ...(typeof value.trimStart === 'number' ? { trimStart: value.trimStart } : {}),
    type: type as LocalMaterialFile['type'],
    url: resolveAssetUrl(storedUrl),
  };
}

export function normalizeTalkingVideoPromptTasks(value: unknown): TalkingVideoPromptTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TalkingVideoPromptTask[] => {
    if (!isRecord(item)) return [];
    const sourceVideo = persistedMaterial(item.sourceVideo);
    if (!sourceVideo || sourceVideo.type !== 'video') return [];
    const status = String(item.status);
    if (!['preparing', 'thinking', 'completed', 'failed', 'stopped'].includes(status)) return [];
    const referenceImages = Array.isArray(item.referenceImages)
      ? item.referenceImages.map(persistedMaterial).filter((material): material is LocalMaterialFile => material?.type === 'image')
      : [];
    return [{
      id: String(item.id || crypto.randomUUID()),
      phase: typeof item.phase === 'string'
        && ['uploading_assets', 'understanding_video', 'validating_analysis', 'generating_prompt', 'validating_prompt', 'repairing_prompt', 'completed', 'failed', 'stopped'].includes(item.phase)
        ? item.phase as TalkingVideoPromptTask['phase']
        : status === 'completed'
          ? 'completed'
          : status === 'failed'
            ? 'failed'
            : status === 'stopped'
              ? 'stopped'
              : 'uploading_assets',
      status: status as TalkingVideoPromptTask['status'],
      reasoning: String(item.reasoning || ''),
      prompt: String(item.prompt || ''),
      errorMessage: String(item.errorMessage || ''),
      metrics: {
        arkUploadCount: Number(isRecord(item.metrics) ? item.metrics.arkUploadCount : 0) || 0,
        arkUploadPollMs: Number(isRecord(item.metrics) ? item.metrics.arkUploadPollMs : 0) || 0,
        understandingModelCalls: Number(isRecord(item.metrics) ? item.metrics.understandingModelCalls : 0) || 0,
        understandingReplayCalls: Number(isRecord(item.metrics) ? item.metrics.understandingReplayCalls : 0) || 0,
        formatRepairCalls: Number(isRecord(item.metrics) ? item.metrics.formatRepairCalls : 0) || 0,
        promptRepairCalls: Number(isRecord(item.metrics) ? item.metrics.promptRepairCalls : 0) || 0,
        reuseCacheHitCount: Number(isRecord(item.metrics) ? item.metrics.reuseCacheHitCount : 0) || 0,
      },
      serverTimings: isRecord(item.serverTimings) ? {
        ...(typeof item.serverTimings.t_analysis_done_ms === 'number' ? { t_analysis_done_ms: item.serverTimings.t_analysis_done_ms } : {}),
        ...(typeof item.serverTimings.t_first_phase_ms === 'number' ? { t_first_phase_ms: item.serverTimings.t_first_phase_ms } : {}),
        ...(typeof item.serverTimings.t_first_reasoning_ms === 'number' ? { t_first_reasoning_ms: item.serverTimings.t_first_reasoning_ms } : {}),
        ...(typeof item.serverTimings.t_result_ms === 'number' ? { t_result_ms: item.serverTimings.t_result_ms } : {}),
      } : {},
      clientTimings: isRecord(item.clientTimings) ? {
        ...(typeof item.clientTimings.firstReasoningMs === 'number' ? { firstReasoningMs: item.clientTimings.firstReasoningMs } : {}),
        ...(typeof item.clientTimings.firstVisiblePhaseMs === 'number' ? { firstVisiblePhaseMs: item.clientTimings.firstVisiblePhaseMs } : {}),
      } : {},
      sourceVideo,
      referenceImages,
      createdAt: String(item.createdAt || new Date().toISOString()),
    }];
  }).slice(0, TALKING_VIDEO_HISTORY_LIMIT);
}

export function loadTalkingVideoPromptTasks(userId: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? normalizeTalkingVideoPromptTasks(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveTalkingVideoPromptTasks(userId: string, tasks: TalkingVideoPromptTask[]) {
  if (typeof window === 'undefined') return;
  const persisted = normalizeTalkingVideoPromptTasks(tasks);
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(persisted));
  } catch {
    // History persistence is best-effort and must not block video generation.
  }
}
