import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { logToFile } from '../../shared/logger.js';
import { InsufficientStepCreditsError } from '../billing/billing.service.js';
import { contentRepository } from '../content/content.repository.js';
import { callConfiguredLlm } from '../content/configured-llm.client.js';
import {
  buildOneClickCloneOutputs,
  generateOneClickCloneParseResultWithLlm,
  parseResultToMarkdown,
} from '../content/internals/content-viral-analysis.js';
import { pollRunningVideoGenerationTask, generationResultForTask } from '../content/internals/content-video-task-runtime.js';
import { isSegmentedVideoGenerationState, userFacingVideoGenerationError } from '../content/internals/content-video-generation.js';
import type {
  UploadVideoRemakePipAssetPayload,
  UploadVideoRemakePayload,
  VideoRemakeCardMessage,
  VideoRemakeCardType,
  VideoRemakeChatIntent,
  VideoRemakeSession,
  VideoRemakeSessionSnapshot,
  VideoRemakeTask,
  VideoRemakeTextMessage,
  VideoRemakeWorkflowEvent,
  VideoRemakeWorkflowNode,
  VideoRemakeWorkflowState,
} from './video-remake.types.js';
import { publishVideoRemakeEvent } from './video-remake.events.js';
import { defaultVideoRemakeNodeAdapters, repairVideoRemakeJsonPayload, visualDetailsFromContent, type VideoRemakeNodeContext, type VideoRemakeNodeEvent } from './video-remake.node-adapters.js';
import { runVideoRemakeAnalysisGraph } from './video-remake.langgraph.js';
import { videoRemakeRepository } from './video-remake.repository.js';
import { resumeSceneAwareSegmentedSeedanceVideoGeneration } from './video-remake.segmented-runtime.js';
import { logger } from '../../shared/logger.js';
import {
  artifactDependencies,
  artifactKeyForCard,
  cardConfirmationOrder,
  cardTitles,
  dataForCard,
} from './video-remake.workflow.js';

const editCardIntentMap: Array<{ cardType: VideoRemakeCardType; keywords: string[] }> = [
  { cardType: 'basic_info', keywords: ['基础信息', '标题', '分辨率', '比例', '视频信息'] },
  { cardType: 'character_setting', keywords: ['人物', '角色', '人设', '人物素材', '换人'] },
  { cardType: 'scene_setting', keywords: ['场景', '背景', '室内', '户外', '环境'] },
  { cardType: 'product_setting', keywords: ['产品', '商品', '货品', '带货'] },
  { cardType: 'pip_setting', keywords: ['画中画', '分屏', '叠加', '图片叠加', '截图', '录屏'] },
  { cardType: 'voice_audio_setting', keywords: ['人声', '声音', '音频', '配音', '音色', '声音库'] },
  { cardType: 'script_content', keywords: ['口播', '文案', '台词', '脚本内容', '话术'] },
  { cardType: 'storyboard_script', keywords: ['分镜', '镜头', '分镜脚本', '镜头脚本'] },
  { cardType: 'seedance_prompt', keywords: ['提示词', '生成提示词', '视频提示词', 'seedance'] },
  { cardType: 'final_video', keywords: ['最终视频', '成片', '合成视频', '生成视频'] },
];

function logVideoRemakeGeneration(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
  logToFile('video-remake-generation.log', level, message, context);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function videoGenerationFailureMessage(error: unknown) {
  return userFacingVideoGenerationError(error) || errorMessage(error);
}

function nowIso() {
  return new Date().toISOString();
}

function startupResumeDelayMs() {
  const raw = Number(process.env.VIDEO_REMAKE_RESUME_SCAN_DELAY_MS || process.env.VIDEO_GENERATION_RESUME_SCAN_DELAY_MS || 1500);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 1500;
}

const MAX_CONCURRENT_VIDEO_REMAKE_SESSIONS = 8;

function generationMonitorIntervalMs() {
  const raw = Number(process.env.VIDEO_REMAKE_GENERATION_MONITOR_INTERVAL_MS || process.env.VIDEO_GENERATION_POLL_INTERVAL_MS || 30000);
  return Number.isFinite(raw) && raw >= 1000 ? Math.round(raw) : 30000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function fieldText(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSameJsonValue(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

async function waitMs(ms: number) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assertUserId(userId: string) {
  if (!userId.trim()) {
    throw new Error('缺少用户 ID');
  }
}

function isActiveVideoRemakeSessionStatus(status: VideoRemakeSession['status']) {
  return ['running', 'generating'].includes(status);
}

function activeVideoRemakeSessionCount(userId: string, excludeSessionId?: string) {
  return videoRemakeRepository
    .listSessionSummaries(userId)
    .filter((session) => session.id !== excludeSessionId && isActiveVideoRemakeSessionStatus(session.status))
    .length;
}

function assertVideoRemakeSessionCapacity(userId: string, excludeSessionId?: string) {
  const activeCount = activeVideoRemakeSessionCount(userId, excludeSessionId);
  if (activeCount >= MAX_CONCURRENT_VIDEO_REMAKE_SESSIONS) {
    throw new Error(`正在处理${activeCount}个视频，请稍候再试`);
  }
}

function defaultWorkflow(input: { mode: string; title: string; sourceUrl: string; sourceKind: 'upload' | 'url'; file?: UploadVideoRemakePayload }): VideoRemakeWorkflowState {
  return {
    mode: input.mode,
    currentNode: 'upload_to_vod',
    artifacts: {},
    invalidArtifacts: [],
    source: {
      kind: input.sourceKind,
      title: input.title,
      sourceUrl: input.sourceUrl,
      file: input.file ? {
        originalFileName: input.file.originalFileName,
        storedFileName: input.file.storedFileName,
        mimeType: input.file.mimeType,
        fileSize: input.file.fileSize,
        filePath: input.file.filePath,
        fileUrl: input.file.fileUrl,
      } : undefined,
    },
    runtime: {},
    updatedAt: nowIso(),
  };
}

function taskForSession(session: VideoRemakeSession) {
  return session.taskId ? videoRemakeRepository.findTask(session.taskId) || undefined : undefined;
}

function latestFinalVideoCard(session: VideoRemakeSession) {
  return session.messages
    .filter((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardType === 'final_video')
    .at(-1);
}

function hasCompletedFinalVideoData(data: unknown) {
  if (!isRecord(data)) {
    return false;
  }
  return Boolean(fieldText(data.videoUrl) || fieldText(data.status) === 'completed');
}

function finalVideoVersionNumber(data: unknown) {
  if (!isRecord(data)) {
    return 0;
  }
  const explicit = Number(data.versionNumber);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const label = fieldText(data.versionLabel || data.version);
  const matched = label.match(/^v(\d+)$/i);
  return matched ? Number(matched[1]) : 0;
}

function finalVideoVersionLabel(data: Record<string, unknown>) {
  return fieldText(data.versionLabel || data.version)
    || (finalVideoVersionNumber(data) ? `v${finalVideoVersionNumber(data)}` : '');
}

function finalVideoSegments(data: Record<string, unknown>) {
  return Array.isArray(data.generatedSegments)
    ? data.generatedSegments.filter(isRecord)
    : Array.isArray(data.segments)
      ? data.segments.filter(isRecord)
      : [];
}

function segmentIndexFor(segment: Record<string, unknown>, fallbackIndex: number) {
  const value = Number(segment.segmentIndex || segment.index || fallbackIndex + 1);
  return Number.isFinite(value) && value > 0 ? value : fallbackIndex + 1;
}

function segmentVideoUrl(segment: Record<string, unknown>) {
  return fieldText(segment.videoUrl || segment.fileUrl || segment.url);
}

function hasSegmentVideoUrls(segments: Record<string, unknown>[]) {
  return segments.some((segment) => Boolean(segmentVideoUrl(segment)));
}

function finalVideoAssetId(data: Record<string, unknown>) {
  const directAssetId = fieldText(data.assetId);
  if (directAssetId) {
    return directAssetId;
  }
  const videos = Array.isArray(data.videos) ? data.videos.filter(isRecord) : [];
  return fieldText(videos.at(-1)?.assetId);
}

function finalVideoSegmentsFromAsset(assetId: unknown) {
  const id = fieldText(assetId);
  if (!id) {
    return [];
  }
  const asset = contentRepository.findAsset(id);
  const metadata = isRecord(asset?.metadata) ? asset.metadata : {};
  const segments = Array.isArray(metadata.segments) ? metadata.segments.filter(isRecord) : [];
  return segments.map((segment, index) => {
    const videoUrl = segmentVideoUrl(segment);
    return {
      ...segment,
      segmentIndex: segmentIndexFor(segment, index),
      ...(videoUrl ? { videoUrl } : {}),
      status: videoUrl ? 'completed' : fieldText(segment.status) || 'completed',
    };
  });
}

function mergeSegmentRecord(base: Record<string, unknown>, overlay: Record<string, unknown>) {
  const baseVideoUrl = segmentVideoUrl(base);
  const overlayVideoUrl = segmentVideoUrl(overlay);
  return {
    ...base,
    ...overlay,
    ...(baseVideoUrl && !overlayVideoUrl ? { videoUrl: baseVideoUrl } : {}),
    ...(overlayVideoUrl ? { videoUrl: overlayVideoUrl } : {}),
  };
}

function mergeSegmentsByIndex(baseSegments: Record<string, unknown>[], persistedSegments: Record<string, unknown>[]) {
  if (!persistedSegments.length) {
    return baseSegments;
  }
  const byIndex = new Map(persistedSegments.map((segment, index) => [
    segmentIndexFor(segment, index),
    segment,
  ]));
  const source = baseSegments.length ? baseSegments : persistedSegments;
  return source.map((segment, index) => mergeSegmentRecord(
    segment,
    byIndex.get(segmentIndexFor(segment, index)) || {},
  ));
}

function normalizeCompletedFinalVideoSegments(data: Record<string, unknown>, segments: Record<string, unknown>[]) {
  if (!fieldText(data.videoUrl) && fieldText(data.status) !== 'completed') {
    return segments;
  }
  return segments.map((segment) => {
    const status = fieldText(segment.status);
    if (status && !['pending', 'generating', 'regenerating', 'running', 'submitted', 'processing'].includes(status)) {
      return segment;
    }
    return {
      ...segment,
      status: 'completed',
    };
  });
}

function persistFinalVideoSegmentsForCard(session: VideoRemakeSession, cardId: string, data: Record<string, unknown>) {
  const segments = finalVideoSegments(data);
  const versionLabel = finalVideoVersionLabel(data);
  if (!segments.length || !versionLabel) {
    return;
  }
  videoRemakeRepository.upsertFinalVideoSegments({
    sessionId: session.id,
    cardId,
    versionLabel,
    versionNumber: finalVideoVersionNumber(data),
    segments,
  });
}

function withPersistedFinalVideoSegments(session: VideoRemakeSession, cardId: string, data: Record<string, unknown>) {
  const versionLabel = finalVideoVersionLabel(data);
  if (!versionLabel) {
    return data;
  }
  const persistedSegments = videoRemakeRepository.listFinalVideoSegments({
    sessionId: session.id,
    cardId,
    versionLabel,
    versionNumber: finalVideoVersionNumber(data),
  });
  const assetSegments = finalVideoSegmentsFromAsset(finalVideoAssetId(data));
  const persistedWithAssetSegments = mergeSegmentsByIndex(persistedSegments, assetSegments);
  if (!persistedWithAssetSegments.length) {
    const plannedSegments = Array.isArray(data.segments) ? data.segments.filter(isRecord) : [];
    const generatedSegments = Array.isArray(data.generatedSegments) ? data.generatedSegments.filter(isRecord) : [];
    const normalizedSegments = normalizeCompletedFinalVideoSegments(data, plannedSegments.length ? plannedSegments : generatedSegments);
    if (!normalizedSegments.length) {
      return data;
    }
    return {
      ...data,
      segments: normalizedSegments,
      generatedSegments: normalizedSegments,
    };
  }
  const plannedSegments = Array.isArray(data.segments) ? data.segments.filter(isRecord) : [];
  const generatedSegments = Array.isArray(data.generatedSegments) ? data.generatedSegments.filter(isRecord) : [];
  const mergedSegments = normalizeCompletedFinalVideoSegments(
    data,
    mergeSegmentsByIndex(plannedSegments.length ? plannedSegments : generatedSegments, persistedWithAssetSegments),
  );
  if (cardId && hasSegmentVideoUrls(assetSegments) && !hasSegmentVideoUrls(persistedSegments)) {
    videoRemakeRepository.upsertFinalVideoSegments({
      sessionId: session.id,
      cardId,
      versionLabel,
      versionNumber: finalVideoVersionNumber(data),
      segments: mergedSegments,
    });
  }
  return {
    ...data,
    segments: mergedSegments,
    generatedSegments: mergedSegments,
  };
}

function nextFinalVideoVersionNumber(session: VideoRemakeSession) {
  const maxVersion = session.messages
    .filter((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardType === 'final_video')
    .reduce((max, message) => Math.max(max, finalVideoVersionNumber(message.data)), 0);
  return maxVersion + 1;
}

function withFinalVideoVersion(session: VideoRemakeSession, data: unknown, options?: { forceNext?: boolean }): Record<string, unknown> {
  const base = isRecord(data) ? data : {};
  const versionNumber = options?.forceNext || !finalVideoVersionNumber(base)
    ? nextFinalVideoVersionNumber(session)
    : finalVideoVersionNumber(base);
  return {
    ...base,
    versionNumber,
    versionLabel: `v${versionNumber}`,
  };
}

function normalizeFinalVideoGenerationMode(data: Record<string, unknown>) {
  if (fieldText(data.regenerationMode) === 'segment') {
    return data;
  }
  return {
    ...data,
    generationMode: 'parallel',
  };
}

function seedancePromptVersionNumber(data: unknown) {
  if (Array.isArray(data)) {
    return seedancePromptVersionNumber(data[0]);
  }
  if (!isRecord(data)) {
    return 0;
  }
  const explicit = Number(data.seedanceVersionNumber || data.versionNumber);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const label = fieldText(data.seedanceVersionLabel || data.versionLabel || data.version);
  const matched = label.match(/^v(\d+)$/i);
  return matched ? Number(matched[1]) : 0;
}

function nextSeedancePromptVersionNumber(session: VideoRemakeSession) {
  const maxVersion = session.messages
    .filter((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardType === 'seedance_prompt')
    .reduce((max, message) => Math.max(max, seedancePromptVersionNumber(message.data)), 0);
  return maxVersion + 1;
}

function withSeedancePromptVersion(session: VideoRemakeSession, data: unknown, options?: { forceNext?: boolean }) {
  const items = Array.isArray(data) ? data.filter(isRecord) : [];
  const currentVersion = seedancePromptVersionNumber(items);
  const versionNumber = options?.forceNext || !currentVersion ? nextSeedancePromptVersionNumber(session) : currentVersion;
  const versionLabel = `v${versionNumber}`;
  const versionId = `seedance_${versionNumber}`;
  return items.map((item) => ({
    ...item,
    seedanceVersionNumber: versionNumber,
    seedanceVersionLabel: versionLabel,
    seedanceVersionId: versionId,
  }));
}

function seedancePromptItemsFromData(data: unknown) {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  if (!isRecord(data)) {
    return [];
  }
  for (const value of [data.items, data.prompts, data.seedancePrompts, data.previousData, data.segments]) {
    if (Array.isArray(value)) {
      const items = value.filter(isRecord);
      if (items.length) {
        return items;
      }
    }
  }
  return [];
}

function latestEditableSeedancePromptData(session: VideoRemakeSession, excludeCardId?: string) {
  const artifactItems = seedancePromptItemsFromData(session.workflow.artifacts.seedancePrompts);
  if (artifactItems.length) {
    return artifactItems;
  }
  const finalVideoItems = seedancePromptItemsFromData(session.workflow.artifacts.finalVideo);
  if (finalVideoItems.length) {
    return finalVideoItems;
  }
  const cards = [...session.messages]
    .reverse()
    .filter((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardId !== excludeCardId);
  for (const card of cards) {
    if (card.cardType !== 'seedance_prompt' && card.cardType !== 'final_video') {
      continue;
    }
    const items = seedancePromptItemsFromData(card.data);
    if (items.length) {
      return items;
    }
  }
  return [];
}

function finalVideoHistory(data: unknown) {
  if (!isRecord(data)) {
    return [];
  }
  const existing = Array.isArray(data.videos)
    ? data.videos.filter(isRecord)
    : [];
  const currentUrl = fieldText(data.videoUrl);
  if (!currentUrl) {
    return existing;
  }
  const hasCurrent = existing.some((item) => fieldText(item.videoUrl) === currentUrl);
  if (hasCurrent) {
    return existing;
  }
  return [
    ...existing,
    {
      versionNumber: finalVideoVersionNumber(data),
      versionLabel: fieldText(data.versionLabel) || (finalVideoVersionNumber(data) ? `v${finalVideoVersionNumber(data)}` : ''),
      videoUrl: currentUrl,
      generatedAt: fieldText(data.generatedAt) || nowIso(),
      assetId: fieldText(data.assetId),
      jobId: fieldText(data.jobId),
      referencePrimerPlan: isRecord(data.referencePrimerPlan) ? data.referencePrimerPlan : undefined,
      segments: Array.isArray(data.generatedSegments) ? data.generatedSegments : data.segments,
    },
  ];
}

function finalVideoHistoryWithResult(baseData: Record<string, unknown>, result: Record<string, unknown>) {
  const regenerationMode = fieldText(baseData.regenerationMode);
  const historySource = regenerationMode === 'segment' && isRecord(baseData.sourceSnapshot)
    ? baseData.sourceSnapshot
    : baseData;
  const baseHistory = finalVideoHistory(historySource);
  const videoUrl = fieldText(result.videoUrl);
  if (!videoUrl) {
    return baseHistory;
  }
  const baseVersionNumber = finalVideoVersionNumber(historySource);
  const baseVersionLabel = fieldText(historySource.versionLabel) || (baseVersionNumber ? `v${baseVersionNumber}` : '');
  if (regenerationMode === 'segment') {
    const replacement = {
      versionNumber: baseVersionNumber || 1,
      versionLabel: baseVersionLabel || 'v1',
      videoUrl,
      generatedAt: fieldText(result.regeneratedAt || result.generatedAt) || nowIso(),
      renderMode: fieldText(result.renderMode),
      regeneratedSegmentIndex: result.regeneratedSegmentIndex,
      referencePrimerPlan: isRecord(result.referencePrimerPlan)
        ? result.referencePrimerPlan
        : isRecord(baseData.referencePrimerPlan)
          ? baseData.referencePrimerPlan
          : undefined,
      segments: Array.isArray(result.generatedSegments) ? result.generatedSegments : result.segments,
    };
    const replacedHistory = baseHistory.map((item) => {
      const itemVersionNumber = finalVideoVersionNumber(item);
      const itemVersionLabel = fieldText(item.versionLabel) || (itemVersionNumber ? `v${itemVersionNumber}` : '');
      if (
        (baseVersionNumber && itemVersionNumber === baseVersionNumber)
        || (baseVersionLabel && itemVersionLabel === baseVersionLabel)
        || fieldText(item.videoUrl) === fieldText(historySource.videoUrl)
      ) {
        return replacement;
      }
      return item;
    });
    if (replacedHistory.some((item) => fieldText(item.videoUrl) === videoUrl)) {
      return replacedHistory;
    }
    return [...replacedHistory, replacement];
  }
  if (baseHistory.some((item) => fieldText(item.videoUrl) === videoUrl)) {
    return baseHistory;
  }
  const nextVersionNumber = baseHistory.reduce((max, item) => Math.max(max, finalVideoVersionNumber(item)), 0) + 1;
  return [
    ...baseHistory,
    {
      versionNumber: nextVersionNumber,
      versionLabel: `v${nextVersionNumber}`,
      videoUrl,
      generatedAt: fieldText(result.regeneratedAt || result.generatedAt) || nowIso(),
      renderMode: fieldText(result.renderMode),
      regeneratedSegmentIndex: result.regeneratedSegmentIndex,
      referencePrimerPlan: isRecord(result.referencePrimerPlan)
        ? result.referencePrimerPlan
        : isRecord(baseData.referencePrimerPlan)
          ? baseData.referencePrimerPlan
          : undefined,
      segments: Array.isArray(result.generatedSegments) ? result.generatedSegments : result.segments,
    },
  ];
}

function finalVideoGeneratingSegmentsForMode(segments: unknown[], generationMode: string) {
  const items = segments.filter(isRecord);
  if (generationMode !== 'queued_extend') {
    return items;
  }
  return items.map((segment, index) => ({
    ...segment,
    status: index === 0 && fieldText(segment.status) !== 'completed' ? 'running' : index === 0 ? fieldText(segment.status) : 'waiting',
    generationMode,
  }));
}

function mergeFinalVideoSegmentProgress(plannedSegments: unknown[], segmentResults: unknown[]) {
  const planned = Array.isArray(plannedSegments) ? plannedSegments.filter(isRecord) : [];
  const results = Array.isArray(segmentResults) ? segmentResults.filter(isRecord) : [];
  if (!planned.length) {
    return results;
  }
  return planned.map((segment, index) => {
    const segmentIndex = segmentIndexFor(segment, index);
    const result = results.find((item, resultIndex) => segmentIndexFor(item, resultIndex) === segmentIndex);
    return result ? { ...segment, ...result } : segment;
  });
}

function hasRecoverableSegmentedFailure(segmentState: unknown) {
  if (!isSegmentedVideoGenerationState(segmentState) || segmentState.status !== 'failed') {
    return false;
  }
  const results = Array.isArray(segmentState.segmentResults) ? segmentState.segmentResults.filter(isRecord) : [];
  const completedCount = results.filter((item) => fieldText(item.videoUrl || item.fileUrl || item.remoteVideoUrl)).length;
  const runningCount = results.filter((item) => fieldText(item.jobId) && fieldText(item.status) !== 'completed').length;
  return completedCount > 0 || runningCount > 0;
}

function markSegmentRegenerationDraftItems(items: unknown, segmentIndex: number) {
  return Array.isArray(items)
    ? items.filter(isRecord).map((segment, index) => {
      const currentSegmentIndex = segmentIndexFor(segment, index);
      if (currentSegmentIndex !== segmentIndex) {
        return {
          ...cloneJson(segment),
          status: fieldText(segment.status) || 'completed',
        };
      }
      return {
        ...cloneJson(segment),
        status: 'generating',
        message: `分段 ${segmentIndex} 重新生成中，请稍候。`,
        regeneratedAt: undefined,
        videoUrl: undefined,
        fileUrl: undefined,
        url: undefined,
        remoteVideoUrl: undefined,
        segmentPath: undefined,
        filePath: undefined,
        jobId: undefined,
      };
    })
    : [];
}

function finalVideoSegmentRegenerationDraft(
  sourceData: Record<string, unknown>,
  options: { segmentIndex: number; sourceCardId: string },
) {
  const seedancePrompts = Array.isArray(sourceData.seedancePrompts)
    ? sourceData.seedancePrompts.filter(isRecord)
    : [];
  const sourceSegments = finalVideoSegments(sourceData);
  const versionNumber = finalVideoVersionNumber(sourceData);
  const versionLabel = fieldText(sourceData.versionLabel) || (versionNumber ? `v${versionNumber}` : '');
  return {
    ...cloneJson(sourceData),
    status: 'generating',
    message: `分段 ${options.segmentIndex} 重新生成中，请稍候。`,
    regenerationMode: 'segment',
    regeneratedSegmentIndex: options.segmentIndex,
    seedancePrompts: cloneJson(seedancePrompts),
    seedanceVersionNumber: Number(sourceData.seedanceVersionNumber) || undefined,
    seedanceVersionLabel: fieldText(sourceData.seedanceVersionLabel),
    seedanceVersionId: fieldText(sourceData.seedanceVersionId),
    versionNumber: versionNumber || Number(sourceData.versionNumber) || undefined,
    versionLabel,
    versionId: fieldText(sourceData.versionId),
    sourceCardId: options.sourceCardId,
    sourceVersionLabel: fieldText(sourceData.versionLabel),
    sourceSnapshot: cloneJson(sourceData),
    referencePrimerPlan: isRecord(sourceData.referencePrimerPlan) ? cloneJson(sourceData.referencePrimerPlan) : undefined,
    segments: markSegmentRegenerationDraftItems(sourceSegments, options.segmentIndex),
    generatedSegments: markSegmentRegenerationDraftItems(sourceSegments, options.segmentIndex),
    videos: cloneJson(finalVideoHistory(sourceData)),
    videoUrl: undefined,
    errorMessage: undefined,
  };
}

function clearFinalVideoRunState(data: Record<string, unknown>) {
  return {
    ...data,
    status: undefined,
    message: undefined,
    errorMessage: undefined,
    videoUrl: undefined,
    assetId: undefined,
    jobId: undefined,
    generatedSegments: undefined,
    generatedAt: undefined,
    regeneratedAt: undefined,
    traceId: undefined,
    renderMode: undefined,
    segments: Array.isArray(data.segments)
      ? data.segments.map((segment) => isRecord(segment)
        ? {
          ...segment,
          videoUrl: undefined,
          fileUrl: undefined,
          url: undefined,
          status: undefined,
        }
        : segment)
      : undefined,
    videos: undefined,
  };
}

function normalizeInterruptedGeneration(session: VideoRemakeSession) {
  const card = latestFinalVideoCard(session);
  if (!card || card.status !== 'pending') {
    return session;
  }
  const data = isRecord(card.data) ? card.data : {};
  if (fieldText(data.status) !== 'generating') {
    return session;
  }
  const task = taskForSession(session);
  const active = session.status === 'generating' || task?.status === 'generating';
  if (active) {
    return session;
  }
  const failedData = {
    ...data,
    status: 'failed',
    message: '视频生成中断。',
    errorMessage: '未检测到正在运行的视频生成任务，请重新生成。',
  };
  logVideoRemakeGeneration('warn', 'interrupted generation state normalized', {
    sessionId: session.id,
    taskId: session.taskId,
    cardId: card.cardId,
    sessionStatus: session.status,
    taskStatus: task?.status,
  });
  updateCardById(session, card.cardId, { status: 'failed', data: failedData });
  const failedCard = session.messages.find((message): message is VideoRemakeCardMessage => (
    message.type === 'card' && message.cardId === card.cardId
  ));
  if (failedCard) {
    videoRemakeRepository.upsertCard(session.id, failedCard);
  }
  syncArtifact(session, 'final_video', failedData);
  session.status = 'failed';
  session.currentStep = 'failed';
  session.workflow.currentNode = 'failed';
  refreshTask(session, 'failed');
  const persisted = videoRemakeRepository.updateSession(session.id, {
    taskId: session.taskId || null,
    filename: session.filename || null,
    status: session.status,
    currentStep: session.currentStep,
    invalidArtifacts: session.invalidArtifacts,
    artifacts: session.artifacts,
    workflow: session.workflow,
    cancelledAt: session.cancelledAt || null,
  });
  return persisted || session;
}

function snapshot(session: VideoRemakeSession): VideoRemakeSessionSnapshot {
  const normalized = normalizeInterruptedGeneration(session);
  const messages = normalized.messages.map((message) => {
    if (message.type !== 'card') {
      return message;
    }
    if (message.cardType === 'storyboard_script') {
      return {
        ...message,
        data: sanitizeStoryboardSnapshotData(normalized, message.data),
      };
    }
    if (!isRecord(message.data)) {
      return message;
    }
    if (message.cardType === 'expert_analysis') {
      const expertKey = fieldText(message.data.expertKey);
      return {
        ...message,
        data: sanitizeExpertAnalysisRecord(expertKey, message.data),
      };
    }
    if (message.cardType !== 'final_video') {
      return message;
    }
    return {
      ...message,
      data: withPersistedFinalVideoSegments(normalized, message.cardId, message.data),
    };
  });
  const finalVideoArtifact = isRecord(normalized.workflow.artifacts.finalVideo)
    ? withPersistedFinalVideoSegments(normalized, '', normalized.workflow.artifacts.finalVideo)
    : normalized.workflow.artifacts.finalVideo;
  return {
    ...normalized,
    messages,
    workflow: {
      ...normalized.workflow,
      artifacts: {
        ...normalized.workflow.artifacts,
        finalVideo: finalVideoArtifact,
      },
    },
    task: taskForSession(normalized),
  };
}

function completeSessionFromVideoGeneration(
  session: VideoRemakeSession,
  card: VideoRemakeCardMessage,
  data: Record<string, unknown>,
  videoUrl: string,
) {
  const assetSegments = finalVideoSegmentsFromAsset(finalVideoAssetId(data));
  const resolvedSegments = Array.isArray(data.generatedSegments)
    ? data.generatedSegments
    : Array.isArray(data.segments)
      ? data.segments
      : [];
  const completedSegments = normalizeCompletedFinalVideoSegments(
    { ...data, status: 'completed', videoUrl },
    mergeSegmentsByIndex(resolvedSegments.filter(isRecord), assetSegments),
  );
  const completedData = {
    ...data,
    status: 'completed',
    message: '视频生成完成。',
    videoUrl,
    generatedAt: fieldText(data.generatedAt) || nowIso(),
    referencePrimerPlan: isRecord(data.referencePrimerPlan) ? data.referencePrimerPlan : undefined,
    generatedSegments: completedSegments,
    segments: completedSegments,
  };
  updateCardById(session, card.cardId, {
    status: 'confirmed',
    data: {
      ...completedData,
      videos: finalVideoHistory(completedData),
    },
  });
  persistFinalVideoSegmentsForCard(session, card.cardId, completedData);
  syncArtifact(session, 'final_video', {
    ...completedData,
    videos: finalVideoHistory(completedData),
  });
  session.status = 'completed';
  session.currentStep = 'completed';
  session.workflow.currentNode = 'completed';
  refreshTask(session, 'success', videoUrl);
  return persistSession(session);
}

function failSessionFromVideoGeneration(
  session: VideoRemakeSession,
  card: VideoRemakeCardMessage,
  data: Record<string, unknown>,
  failureReason: string,
) {
  const failedData = {
    ...data,
    status: 'failed',
    message: '视频生成失败。',
    errorMessage: failureReason,
  };
  updateCardById(session, card.cardId, { status: 'failed', data: failedData });
  syncArtifact(session, 'final_video', failedData);
  session.status = 'failed';
  session.currentStep = 'failed';
  session.workflow.currentNode = 'failed';
  refreshTask(session, 'failed');
  return persistSession(session);
}

function hasPendingFinalVideoData(data: Record<string, unknown>) {
  const status = fieldText(data.status);
  if (status === 'generating' || status === 'pending') {
    return true;
  }
  const segments = finalVideoSegments(data);
  return segments.some((segment) => {
    const segmentStatus = fieldText(segment.status);
    return ['pending', 'generating', 'running', 'submitted', 'processing'].includes(segmentStatus);
  });
}

function canAttemptFinalVideoSync(session: VideoRemakeSession) {
  const card = latestFinalVideoCard(session);
  if (!card || card.cardType !== 'final_video' || !isRecord(card.data)) {
    return false;
  }
  const status = fieldText(card.data.status);
  return session.status === 'generating'
    || status === 'generating'
    || status === 'failed'
    || card.status === 'failed';
}

function canResumeStalledFinalVideoGeneration(
  session: VideoRemakeSession,
  card: VideoRemakeCardMessage,
  data: Record<string, unknown>,
  segmentState: unknown,
  result: Record<string, unknown> | null,
) {
  if (session.status !== 'generating' || fieldText(data.status) !== 'generating') {
    return false;
  }
  if (!['generate_video_segments', 'merge_video'].includes(session.workflow.currentNode)) {
    return false;
  }
  if (isSegmentedVideoGenerationState(segmentState)) {
    return false;
  }
  if (result?.jobId || result?.videoUrl || result?.status === 'running' || result?.status === 'pending') {
    return false;
  }
  const hasSegments = Array.isArray(data.segments) && data.segments.length > 0;
  return card.cardType === 'final_video' && hasSegments;
}

function canResumeUnderstandingAnalysis(session: VideoRemakeSession) {
  if (session.workflow.pendingInterrupt) {
    return false;
  }
  if (!['running', 'failed'].includes(session.status)) {
    return false;
  }
  return [
    'upload_to_vod',
    'analyze_audio',
    'analyze_visual',
    'analyze_pip',
    'director_normalize',
    'failed',
  ].includes(session.workflow.currentNode);
}

function clearObsoleteUnderstandingInterrupt(session: VideoRemakeSession) {
  const pending = session.workflow.pendingInterrupt;
  if (!pending) {
    return false;
  }
  if (![
    'upload_to_vod',
    'analyze_audio',
    'analyze_visual',
    'analyze_pip',
    'director_normalize',
    'failed',
  ].includes(session.workflow.currentNode)) {
    return false;
  }
  const pendingCard = findCardById(session, pending.cardId);
  if (pendingCard && pendingCard.status !== 'expired' && pending.reason !== 'regenerate') {
    return false;
  }
  session.workflow.pendingInterrupt = undefined;
  session.workflow.updatedAt = nowIso();
  return true;
}

const runningVideoRemakeGenerationMonitorTaskIds = new Set<string>();
const activeVideoRemakeGenerationTaskIds = new Set<string>();
const videoRemakeSessionSyncInflight = new Map<string, Promise<VideoRemakeSessionSnapshot>>();
let videoRemakeGenerationMonitorTimer: ReturnType<typeof setInterval> | null = null;

function startVideoRemakeGenerationMonitor(taskId: string | undefined, source: string) {
  const normalizedTaskId = fieldText(taskId);
  if (
    !normalizedTaskId
    || runningVideoRemakeGenerationMonitorTaskIds.has(normalizedTaskId)
    || activeVideoRemakeGenerationTaskIds.has(normalizedTaskId)
  ) {
    return;
  }
  runningVideoRemakeGenerationMonitorTaskIds.add(normalizedTaskId);
  void (async () => {
    try {
      const session = videoRemakeRepository.findSessionByTaskId(normalizedTaskId);
      if (session && canAttemptFinalVideoSync(session)) {
        const synced = await syncSessionVideoGenerationState(session, false);
        if (synced.status !== 'generating') {
          return;
        }
      }
      await pollRunningVideoGenerationTask(normalizedTaskId);
    } catch (error) {
      logger.warn('video remake generation monitor polling failed', {
        taskId: normalizedTaskId,
        source,
        error: errorMessage(error),
      });
    }
    try {
      const session = videoRemakeRepository.findSessionByTaskId(normalizedTaskId);
      if (session && canAttemptFinalVideoSync(session)) {
        await syncSessionVideoGenerationState(session, false);
      }
    } catch (error) {
      logger.warn('video remake generation monitor sync failed', {
        taskId: normalizedTaskId,
        source,
        error: errorMessage(error),
      });
    } finally {
      runningVideoRemakeGenerationMonitorTaskIds.delete(normalizedTaskId);
    }
  })();
}

function scanRunningVideoRemakeGenerations(source: string) {
  const sessions = videoRemakeRepository.listResumableSessions()
    .filter((session) => (
      session.status === 'generating'
      && session.taskId
      && !activeVideoRemakeGenerationTaskIds.has(session.taskId)
    ));
  for (const session of sessions) {
    startVideoRemakeGenerationMonitor(session.taskId, source);
  }
}

function markVideoRemakeGenerationActive(taskId: string | undefined) {
  const normalizedTaskId = fieldText(taskId);
  if (!normalizedTaskId) {
    return () => undefined;
  }
  activeVideoRemakeGenerationTaskIds.add(normalizedTaskId);
  return () => {
    activeVideoRemakeGenerationTaskIds.delete(normalizedTaskId);
  };
}

async function syncSessionVideoGenerationState(session: VideoRemakeSession, waitForCompletion = true) {
  const task = session.taskId ? contentRepository.findVideoTask(session.taskId) : null;
  const card = latestFinalVideoCard(session);
  if (!task || !card || card.cardType !== 'final_video') {
    return persistSession(session);
  }
  let latestTask = task;
  let segmentState = latestTask.expertContext?.videoGenerationSegments;
  let result = generationResultForTask(latestTask);
  const data = isRecord(card.data) ? card.data : {};
  const hasRunningResult = isSegmentedVideoGenerationState(segmentState)
    ? segmentState.status === 'running'
    : Boolean(result?.jobId && (result.status === 'pending' || result.status === 'running'));
  if (waitForCompletion && hasRunningResult) {
    await pollRunningVideoGenerationTask(task.id);
    latestTask = contentRepository.findVideoTask(task.id) || latestTask;
    segmentState = latestTask.expertContext?.videoGenerationSegments;
    result = generationResultForTask(latestTask);
  }
  if (isSegmentedVideoGenerationState(segmentState) && segmentState.status === 'completed') {
    const pendingAssetId = fieldText(segmentState.request.pendingAssetId);
    const segmentedRenderMode = fieldText(segmentState.request.generationMode) === 'queued_extend'
      ? 'queued_extend_ffmpeg'
      : 'segmented_ffmpeg';
    const asset = pendingAssetId ? contentRepository.findAsset(pendingAssetId) : null;
    const segmentResults = Array.isArray(segmentState.segmentResults) ? segmentState.segmentResults.filter(isRecord) : [];
    const videoUrl = fieldText(asset?.fileUrl) || fieldText(latestTask.generatedVideoUrl) || fieldText(result?.videoUrl);
    if (!videoUrl) {
      return persistSession(session);
    }
    return completeSessionFromVideoGeneration(session, card, {
      ...data,
      assetId: asset?.id || pendingAssetId || fieldText(data.assetId),
      jobId: segmentResults.map((item) => fieldText(item.jobId)).filter(Boolean).join(','),
      generationMode: fieldText(segmentState.request.generationMode) || fieldText(data.generationMode),
      renderMode: fieldText(data.renderMode) || segmentedRenderMode,
      generatedSegments: segmentResults,
    }, videoUrl);
  }
  if (isSegmentedVideoGenerationState(segmentState) && segmentState.status === 'failed') {
    if (hasRecoverableSegmentedFailure(segmentState)) {
      const segmentResults = Array.isArray(segmentState.segmentResults) ? segmentState.segmentResults.filter(isRecord) : [];
      const progressSegments = mergeFinalVideoSegmentProgress(Array.isArray(data.segments) ? data.segments : [], segmentResults);
      const resumeData = {
        ...data,
        status: 'generating',
        message: '视频生成中，请稍候。',
        errorMessage: undefined,
        generatedSegments: segmentResults,
        segments: progressSegments,
      };
      updateCardById(session, card.cardId, { status: 'pending', data: resumeData });
      syncArtifact(session, 'final_video', resumeData);
      session.status = 'generating';
      session.currentStep = 'merge_video';
      session.workflow.currentNode = 'merge_video';
      refreshTask(session, 'generating', null);
      persistSession(session);
      logVideoRemakeGeneration('warn', 'resuming failed segmented final video generation from saved segment state', {
        sessionId: session.id,
        taskId: session.taskId,
        cardId: card.cardId,
        completedSegments: segmentResults.filter((item) => fieldText(item.videoUrl || item.fileUrl || item.remoteVideoUrl)).map((item) => Number(item.segmentIndex)),
        runningSegments: segmentResults.filter((item) => fieldText(item.jobId) && fieldText(item.status) !== 'completed').map((item) => Number(item.segmentIndex)),
        failureReason: fieldText(segmentState.failureReason),
      });
      const resumed = await resumeSceneAwareSegmentedSeedanceVideoGeneration(latestTask, {
        ...segmentState,
        status: 'running',
        failureStage: undefined,
        failureReason: undefined,
      });
      if (resumed) {
        const merged = resumed as Record<string, unknown>;
        session.workflow.runtime.mergedVideo = merged;
        const completedData = {
          ...resumeData,
          ...merged,
          status: 'completed',
          message: '视频生成完成。',
          generatedAt: nowIso(),
          generatedSegments: Array.isArray(merged.segments) ? merged.segments : resumeData.generatedSegments,
          segments: Array.isArray(merged.segments) ? merged.segments : resumeData.segments,
          videos: finalVideoHistory({
            ...resumeData,
            ...merged,
            status: 'completed',
            generatedSegments: Array.isArray(merged.segments) ? merged.segments : resumeData.generatedSegments,
            segments: Array.isArray(merged.segments) ? merged.segments : resumeData.segments,
          }),
        };
        updateCardById(session, card.cardId, { status: 'confirmed', data: completedData });
        persistFinalVideoSegmentsForCard(session, card.cardId, completedData);
        syncArtifact(session, 'final_video', completedData);
        session.status = 'completed';
        session.currentStep = 'completed';
        session.workflow.currentNode = 'completed';
        refreshTask(session, 'success', fieldText(merged.videoUrl));
        pushEvent(session, { type: 'workflow.done', finalVideoUrl: fieldText(merged.videoUrl) });
        return persistSession(session);
      }
    }
    return failSessionFromVideoGeneration(
      session,
      card,
      data,
      fieldText(segmentState.failureReason) || '视频分段生成失败',
    );
  }
  if (result?.status === 'completed' && fieldText(result.videoUrl)) {
    return completeSessionFromVideoGeneration(session, card, {
      ...data,
      provider: result.provider,
      model: result.model,
      jobId: result.jobId,
      coverUrl: result.coverUrl,
      renderMode: result.renderMode,
      assetId: fieldText(result.assetId) || fieldText(data.assetId),
    }, fieldText(result.videoUrl));
  }
  if (result?.status === 'failed') {
    const rawMessage = fieldText(result.errorMessage) || '视频生成失败';
    return failSessionFromVideoGeneration(session, card, data, videoGenerationFailureMessage(new Error(rawMessage)));
  }
  if (canResumeStalledFinalVideoGeneration(session, card, data, segmentState, result || null)) {
    const generationMode = fieldText(data.generationMode);
    const segments = Array.isArray(data.segments)
      ? data.segments
      : session.workflow.runtime.videoSegments || [];
    const displaySegments = finalVideoGeneratingSegmentsForMode(segments, generationMode);
    const resumeData = {
      ...data,
      status: 'generating',
      message: '视频生成中，请稍候。',
      errorMessage: undefined,
      segments: displaySegments,
    };
    updateCardById(session, card.cardId, { status: 'pending', data: resumeData });
    syncArtifact(session, 'final_video', resumeData);
    persistSession(session);
    logVideoRemakeGeneration('warn', 'resuming stalled final video generation without active video task', {
      sessionId: session.id,
      taskId: session.taskId,
      cardId: card.cardId,
      currentNode: session.workflow.currentNode,
      generationMode,
    });
    const emit = (event: VideoRemakeNodeEvent) => pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
    const context = () => createNodeContext(session, emit);
    return await runFinalVideoMerge(session, card.cardId, resumeData, displaySegments, context);
  }
  if (session.status === 'generating' && fieldText(data.status) === 'generating') {
    if (isSegmentedVideoGenerationState(segmentState) && segmentState.status === 'running') {
      const segmentResults = Array.isArray(segmentState.segmentResults) ? segmentState.segmentResults.filter(isRecord) : [];
      const progressData = {
        ...data,
        generatedSegments: segmentResults,
        segments: mergeFinalVideoSegmentProgress(Array.isArray(data.segments) ? data.segments : [], segmentResults),
      };
      updateCardById(session, card.cardId, { status: card.status, data: progressData });
      syncArtifact(session, 'final_video', progressData);
    }
    logVideoRemakeGeneration('info', 'video generation sync deferred while generation is still active', {
      sessionId: session.id,
      taskId: session.taskId,
      cardId: card.cardId,
      waitForCompletion,
      taskStatus: latestTask.status,
      hasSegmentState: Boolean(segmentState),
      resultStatus: result?.status,
      resultJobId: result?.jobId,
    });
    startVideoRemakeGenerationMonitor(session.taskId, 'sync-deferred');
    return persistSession(session);
  }
  if (waitForCompletion && hasPendingFinalVideoData(data)) {
    return failSessionFromVideoGeneration(
      session,
      card,
      data,
      '未检测到正在运行的视频生成任务，可能在服务重启前未完成任务状态落库，请重新生成。',
    );
  }
  return persistSession(session);
}

function pushEvent(session: VideoRemakeSession, event: VideoRemakeWorkflowEvent) {
  session.events.push(event);
  session.updatedAt = nowIso();
  if (event.type === 'message') {
    session.messages.push(event.message);
  }
  if (event.type === 'card.create') {
    session.messages.push(event.card);
    videoRemakeRepository.upsertCard(session.id, event.card);
  }
  if (event.type === 'card.update') {
    session.messages = session.messages.map((message) => (
      message.type === 'card' && message.cardId === event.cardId
        ? { ...message, status: event.status || message.status, data: event.data === undefined ? message.data : event.data }
        : message
    ));
    const card = session.messages.find((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardId === event.cardId);
    if (card) {
      videoRemakeRepository.upsertCard(session.id, card);
    }
  }
  videoRemakeRepository.appendEvent(session.id, event);
  publishVideoRemakeEvent(session.userId, { ...event, sessionId: session.id, taskId: session.taskId });
}

function addMessage(
  session: VideoRemakeSession,
  role: VideoRemakeTextMessage['role'],
  content: string,
  attachment?: VideoRemakeTextMessage['attachment'],
) {
  const message: VideoRemakeTextMessage = {
    id: randomUUID(),
    type: 'text',
    role,
    content,
    ...(attachment ? { attachment } : {}),
    createdAt: nowIso(),
  };
  pushEvent(session, { type: 'message', message });
  return message;
}

function addAssistantMessage(session: VideoRemakeSession, content: string) {
  return addMessage(session, 'assistant', content);
}

function addCard(session: VideoRemakeSession, cardType: VideoRemakeCardType, input?: { status?: VideoRemakeCardMessage['status']; data?: unknown }) {
  const card: VideoRemakeCardMessage = {
    id: randomUUID(),
    type: 'card',
    role: 'assistant',
    cardId: randomUUID(),
    cardType,
    title: cardTitles[cardType],
    status: input?.status || 'pending',
    data: input?.data === undefined ? dataForCard(cardType, { workflow: session.workflow }) : input.data,
    createdAt: nowIso(),
  };
  pushEvent(session, { type: 'card.create', card });
  return card;
}

function lastEditableCardOfType(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  const cards = session.messages.filter((message): message is VideoRemakeCardMessage => (
    message.type === 'card'
    && message.cardType === cardType
    && (message.status === 'editing' || message.status === 'pending')
  ));
  return cards[cards.length - 1] || null;
}

function ensureEditingCard(session: VideoRemakeSession, cardType: VideoRemakeCardType, input?: { data?: unknown }) {
  const existing = lastEditableCardOfType(session, cardType);
  if (existing) {
    if (existing.status === 'pending' && !(input && Object.prototype.hasOwnProperty.call(input, 'data'))) {
      return existing;
    }
    if (input && Object.prototype.hasOwnProperty.call(input, 'data')) {
      return updateCardById(session, existing.cardId, { status: 'editing', data: input.data });
    }
    if (existing.status !== 'editing') {
      return updateCardById(session, existing.cardId, { status: 'editing' });
    }
    return existing;
  }
  return addCard(session, cardType, { status: 'editing', data: input?.data });
}

function ensurePendingCard(session: VideoRemakeSession, cardType: VideoRemakeCardType, data: unknown) {
  const existing = lastEditableCardOfType(session, cardType);
  if (existing) {
    return updateCardById(session, existing.cardId, { status: 'pending', data });
  }
  return addCard(session, cardType, { status: 'pending', data });
}

function openLatestCardForEditing(session: VideoRemakeSession, cardType: VideoRemakeCardType, input?: { data?: unknown }) {
  const existing = lastCardOfType(session, cardType);
  if (!existing) {
    return ensureEditingCard(session, cardType, input);
  }
  const data = input && Object.prototype.hasOwnProperty.call(input, 'data') ? input.data : existing.data;
  const editingData = Array.isArray(data)
    ? {
      items: data,
      editingFromConfirmed: existing.status === 'confirmed',
      editingOriginalData: cloneJson(existing.data),
    }
    : {
      ...isRecord(data) ? data : {},
      editingFromConfirmed: existing.status === 'confirmed',
    };
  return updateCardById(session, existing.cardId, {
    status: 'editing',
    data: editingData,
  });
}

function routeIntent(message: string): VideoRemakeChatIntent {
  const normalized = message.trim();
  if (/^(继续|下一步|确认继续|继续生成|开始生成)$/u.test(normalized)) {
    return { intent: 'continue_workflow', instruction: normalized };
  }
  if (/重新生成|重生成|再生成|重做/u.test(normalized) && /视频|最终|成片/u.test(normalized)) {
    return { intent: 'regenerate_artifact', target: 'final_video', instruction: normalized };
  }
  const target = editCardIntentMap.find((item) => item.keywords.some((keyword) => normalized.includes(keyword)))?.cardType;
  if (!target) {
    return { intent: 'unknown', instruction: normalized };
  }
  if (/添加|新增|增加|加一个|补一个|再加/u.test(normalized)) {
    return { intent: 'add_artifact_item', target, instruction: normalized };
  }
  if (/重新生成|重生成|再生成|重做/u.test(normalized)) {
    return { intent: 'regenerate_artifact', target, instruction: normalized };
  }
  if (/帮我|改成|改得|重写|优化|更/u.test(normalized)) {
    return { intent: 'modify_artifact_with_llm', target, instruction: normalized };
  }
  return { intent: 'open_edit_card', target, instruction: normalized };
}

function inferPartialIntent(message: string): VideoRemakeChatIntent | null {
  const normalized = message.trim();
  const target = [
    { cardType: 'basic_info' as const, keywords: ['分辨率', '比例', '画幅', '标题', '名称', '1080', '720', '480', '9:16', '16:9'] },
    { cardType: 'script_content' as const, keywords: ['口播', '文案', '台词', '话术', '旁白'] },
    { cardType: 'product_setting' as const, keywords: ['产品', '商品', '货品', '卖点', '价格'] },
    { cardType: 'character_setting' as const, keywords: ['人物', '角色', '人设', '发型', '衣服', '服装'] },
    { cardType: 'scene_setting' as const, keywords: ['场景', '背景', '环境', '室内', '户外'] },
    { cardType: 'voice_audio_setting' as const, keywords: ['声音', '音频', '配音', '音色', '语速', 'bgm', 'BGM'] },
    { cardType: 'pip_setting' as const, keywords: ['画中画', '截图', '录屏', '叠加'] },
    { cardType: 'seedance_prompt' as const, keywords: ['提示词', 'prompt', 'Prompt'] },
  ].find((item) => item.keywords.some((keyword) => normalized.includes(keyword)))?.cardType;
  if (!target) {
    return null;
  }
  if (/添加|新增|增加|加一个|补一个|再加/u.test(normalized)) {
    return { intent: 'add_artifact_item', target, instruction: normalized };
  }
  if (/重新生成|重生成|再生成|重做/u.test(normalized)) {
    return { intent: 'regenerate_artifact', target, instruction: normalized };
  }
  if (/改|换|调整|设置|变成|改成|优化|重写|更/u.test(normalized) || target === 'basic_info') {
    return { intent: 'modify_artifact_with_llm', target, instruction: normalized };
  }
  return { intent: 'open_edit_card', target, instruction: normalized };
}

function downstreamInvalidationWarning(session: VideoRemakeSession, target: VideoRemakeCardType) {
  const affected = (artifactDependencies[target] || [])
    .filter((cardType) => ['storyboard_script', 'seedance_prompt', 'final_video'].includes(cardType))
    .filter((cardType) => {
      const card = lastCardOfType(session, cardType);
      return card && card.status !== 'expired';
    })
    .map((cardType) => cardTitles[cardType]);
  if (!affected.length) {
    return '';
  }
  return `确认后将编辑${cardTitles[target]}，已生成的${Array.from(new Set(affected)).join('、')}会失效，需要重新确认或生成。`;
}

function intentConfirmationMessage(session: VideoRemakeSession, intent: Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>) {
  const actionText = intent.intent === 'add_artifact_item'
    ? `新增${cardTitles[intent.target]}`
    : intent.intent === 'regenerate_artifact'
      ? `重新生成${cardTitles[intent.target]}`
      : `编辑${cardTitles[intent.target]}`;
  return {
    message: `你是想${actionText}吗？`,
    description: downstreamInvalidationWarning(session, intent.target),
  };
}

function addIntentConfirmationCard(session: VideoRemakeSession, intent: Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>) {
  const copy = intentConfirmationMessage(session, intent);
  return addCard(session, 'llm_thinking', {
    status: 'editing',
    data: {
      kind: 'intent_confirmation',
      status: 'waiting_confirm',
      message: copy.message,
      description: copy.description,
      confirmText: intent.intent === 'add_artifact_item' ? '确认新增' : intent.intent === 'regenerate_artifact' ? '确认重新生成' : '确认编辑',
      cancelText: '先不处理',
      intent: intent.intent,
      targetCardType: intent.target,
      instruction: intent.instruction,
      createdAt: nowIso(),
    },
  });
}

function editableDataForChatTarget(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  if (cardType === 'seedance_prompt') {
    return latestEditableSeedancePromptData(session);
  }
  return dataForCard(cardType, { workflow: session.workflow });
}

function shouldConfirmChatIntent(session: VideoRemakeSession, intent: Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>) {
  if (intent.intent === 'regenerate_artifact' && intent.target === 'final_video') {
    return false;
  }
  const title = cardTitles[intent.target] || '';
  return Boolean(title && !intent.instruction.includes(title) && downstreamInvalidationWarning(session, intent.target));
}

async function askLlmForUnknownChat(session: VideoRemakeSession, instruction: string, cardId: string) {
  const system = [
    '你是爆款复刻工作流里的对话助手。',
    '用户当前输入没有命中明确操作关键词，你不能擅自修改卡片或生成视频。',
    '请用中文快速反问用户想做什么，或请用户补充必要信息。',
    '回复要短，1-2 句话即可；优先提示用户可以说：重新生成视频、修改人物、修改场景、修改口播、修改提示词、重新生成分镜。',
  ].join('\n');
  const user = [
    `用户输入：${instruction}`,
    `当前会话状态：${session.status}`,
    `当前步骤：${session.currentStep}`,
    `当前待确认卡片：${session.workflow.pendingInterrupt?.cardType || '无'}`,
  ].join('\n');
  try {
    const answer = (await callConfiguredLlm({
      userId: session.userId,
      temperature: 0.2,
      sourceType: 'video_remake_chat_intent_clarification',
      sourceId: session.id,
      system,
      user,
      timeoutMs: 30_000,
    })).trim();
    const message = answer || '我还不确定你想调整哪一部分。你可以告诉我：重新生成视频、修改人物/场景/口播，或补充具体修改要求。';
    updateCardById(session, cardId, {
      status: 'confirmed',
      data: {
        status: 'completed',
        message,
        instruction,
        answeredAt: nowIso(),
      },
    });
  } catch (error) {
    const message = '我还不确定你想调整哪一部分。你可以告诉我：重新生成视频、修改人物/场景/口播，或补充具体修改要求。';
    updateCardById(session, cardId, {
      status: 'failed',
      data: {
        status: 'failed',
        message,
        instruction,
        errorMessage: errorMessage(error),
        answeredAt: nowIso(),
      },
    });
  }
}

function applyRuleBasedArtifactPatch(input: {
  cardType: VideoRemakeCardType;
  instruction: string;
  current: unknown;
}) {
  const instruction = input.instruction.trim();
  if (input.cardType === 'script_content') {
    const current = isRecord(input.current) ? input.current : {};
    const content = String(current.content || '').trim();
    if (/更夸张|更炸|更强|更有冲击力/u.test(instruction)) {
      return {
        ...current,
        content: `${content || '先抛出最强冲突点。'} 语气更直接，开场先把问题放大，再快速给出解决方案和结果证明。`.trim(),
        tone: 'dramatic',
        patchInstruction: instruction,
      };
    }
    return {
      ...current,
      content: content || instruction,
      patchInstruction: instruction,
    };
  }

  if (input.cardType === 'voice_audio_setting') {
    const current = isRecord(input.current) ? input.current : {};
    const items = Array.isArray(current.items) ? current.items : [];
    const voice = /女声/u.test(instruction) ? '女声' : /男声/u.test(instruction) ? '男声' : /AI|克隆/u.test(instruction) ? 'AI 克隆声线' : '替换声线';
    const voiceStyle = /温柔/u.test(instruction) ? '温柔' : /情绪|夸张|更强/u.test(instruction) ? '情绪饱满' : '清晰有力';
    return {
      ...current,
      voice,
      voiceStyle,
      items: items.map((item) => (isRecord(item) ? { ...item, voice, voiceStyle } : item)),
      patchInstruction: instruction,
    };
  }

  if (input.cardType === 'storyboard_script') {
    return [];
  }

  if (isRecord(input.current)) {
    return {
      ...input.current,
      patchInstruction: instruction,
    };
  }

  return input.current;
}

function nextManualItemIndex(items: Record<string, unknown>[]) {
  return items.length + 1;
}

function appendManualArtifactItem(cardType: VideoRemakeCardType, current: unknown) {
  const data = isRecord(current) ? current : {};
  const items = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  const nextIndex = nextManualItemIndex(items);
  if (cardType === 'character_setting') {
    return {
      ...data,
      items: [...items, { label: `人物 ${nextIndex}`, required: true, referenceMode: 'prompt', manuallyAdded: true }],
    };
  }
  if (cardType === 'scene_setting') {
    return {
      ...data,
      items: [...items, { label: `场景 ${nextIndex}`, required: true, referenceMode: 'prompt', manuallyAdded: true }],
    };
  }
  if (cardType === 'product_setting') {
    return {
      ...data,
      items: [...items, { label: `产品 ${nextIndex}`, noProduct: false, referenceMode: 'prompt', manuallyAdded: true }],
    };
  }
  if (cardType === 'pip_setting') {
    return {
      ...data,
      activeItemIndex: items.length,
      items: [...items, { id: `pip_${nextIndex}`, label: `画中画 ${nextIndex}`, required: true, referenceMode: 'asset', manuallyAdded: true }],
    };
  }
  if (cardType === 'voice_audio_setting') {
    return {
      ...data,
      items: [...items, {
        label: `人物 ${nextIndex} 声音`,
        characterLabel: `人物 ${nextIndex}`,
        characterIndex: nextIndex - 1,
        voice: '原声',
        voiceStyle: '',
        manuallyAdded: true,
      }],
    };
  }
  return current;
}

function isUnknownPlaceholderText(value: string) {
  return /^(不详|未知|未详|不明确|未明确|无法确定|未提供|暂无|无|N\/A|NA|null|undefined)[。.]?$/iu.test(value.trim());
}

function isReferencePromptMetaLine(line: string) {
  const match = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/u);
  if (!match) {
    return isUnknownPlaceholderText(line);
  }
  const key = match[1].trim();
  const text = match[2].trim();
  return /^(startSecond|endSecond|start|end|startTime|endTime|time|duration|spokenCue|speckCue|speechCue|narrationCue|cue|keywords?|开始时间|结束时间|开始秒|结束秒|出现时间|时间范围|口播线索|对应口播|语境线索|关键词)$/iu.test(key)
    || isUnknownPlaceholderText(text);
}

function cleanReferencePromptText(value: unknown) {
  return fieldText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isReferencePromptMetaLine(line))
    .join('\n')
    .trim();
}

function isStoryboardProductDisabled(session: VideoRemakeSession) {
  const productSetting = isRecord(session.workflow.artifacts.productSetting)
    ? session.workflow.artifacts.productSetting
    : isRecord(session.artifacts.product_setting)
      ? session.artifacts.product_setting
      : {};
  if (Boolean(productSetting.noProduct)) {
    return true;
  }
  const items = Array.isArray(productSetting.items) ? productSetting.items.filter(isRecord) : [];
  return !items.some((item) => (
    !Boolean(item.noProduct)
    && Boolean(
      cleanReferencePromptText(item.description)
      || cleanReferencePromptText(item.presentation)
      || cleanReferencePromptText(item.feature)
      || fieldText(item.assetId).trim()
      || fieldText(item.groupId).trim()
    )
  ));
}

function stripProductTextFromStoryboardField(value: unknown) {
  const text = fieldText(value).trim();
  if (!text) {
    return '';
  }
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^(?:产品|商品|货品)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/u.test(trimmed)) {
        return '';
      }
      return line
        .split(/[，,。；;]/u)
        .map((clause) => clause.trim())
        .filter(Boolean)
        .filter((clause) => !/(?:产品\s*[A-Za-z\d一二三四五六七八九十]*|商品|货品|包装|实物商品|商品实物|产品特写|商品特写|对应产品|对应商品|展示产品|展示商品|产品核心特征|商品核心特征|产品卖点|商品卖点|产品图|商品图|产品轮廓|商品轮廓|商品示意图|产品示意图|不需要产品展示)/u.test(clause))
        .join('，')
        .trim();
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function sanitizeStoryboardSnapshotData(session: VideoRemakeSession, data: unknown) {
  if (!isStoryboardProductDisabled(session)) {
    return data;
  }
  const shots = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : null;
  if (!shots) {
    return data;
  }
  const sanitizedShots = shots.map((shot) => {
    if (!isRecord(shot)) {
      return shot;
    }
    return {
      ...shot,
      visualDescription: stripProductTextFromStoryboardField(shot.visualDescription),
      actionDescription: stripProductTextFromStoryboardField(shot.actionDescription),
      remakeSuggestion: stripProductTextFromStoryboardField(shot.remakeSuggestion),
    };
  });
  if (Array.isArray(data)) {
    return sanitizedShots;
  }
  const recordData = isRecord(data) ? data : {};
  return {
    ...recordData,
    items: sanitizedShots,
  };
}

function normalizeCharacterSettingData(data: unknown) {
  if (!isRecord(data)) {
    return data;
  }
  const rawItems = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  if (!rawItems.length) {
    return data;
  }
  return {
    ...data,
    items: rawItems.map((item) => {
      const { appearance: _appearance, gesture: _gesture, expression: _expression, ...rest } = item;
      return {
        ...rest,
        characterPrompt: cleanReferencePromptText(item.characterPrompt),
      };
    }),
  };
}

function stripUiOnlyItemFlags(data: unknown) {
  if (!isRecord(data)) {
    return data;
  }
  const rawItems = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  if (!rawItems.length) {
    return data;
  }
  return {
    ...data,
    items: rawItems.map((item) => {
      const { manuallyAdded: _manuallyAdded, ...rest } = item;
      return rest;
    }),
  };
}

function assertCharacterSettingData(data: unknown) {
  if (!isRecord(data)) {
    return;
  }
  const rawItems = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  rawItems.forEach((item, index) => {
    if (item.required === false) {
      return;
    }
    const referenceMode = fieldText(item.referenceMode).trim();
    if (referenceMode !== 'asset') {
      return;
    }
    const hasReference = Boolean(
      fieldText(item.assetId).trim()
      || fieldText(item.groupId).trim()
      || fieldText(item.materialId).trim()
      || fieldText(item.materialGroupId).trim()
      || fieldText(item.replacementAssetId).trim()
      || fieldText(item.replacementGroupId).trim(),
    );
    if (!hasReference) {
      const label = fieldText(item.label).trim() || `人物 ${index + 1}`;
      throw new Error(`${label} 已选择“参考素材”，请先选择人物素材后再确认。`);
    }
  });
}

function normalizeSceneSettingData(data: unknown) {
  if (!isRecord(data)) {
    return data;
  }
  const rawItems = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  if (!rawItems.length) {
    return data;
  }
  return {
    ...data,
    items: rawItems.map((item) => {
      const baseDescription = cleanReferencePromptText(item.description);
      const sceneDetailLine = (label: string, value: unknown) => {
        const text = cleanReferencePromptText(value);
        if (!text || baseDescription.includes(text)) {
          return '';
        }
        return `${label}：${text}`;
      };
      const description = [
        baseDescription,
        sceneDetailLine('环境', item.environment),
        sceneDetailLine('道具', item.props),
        sceneDetailLine('灯光', item.lighting),
        sceneDetailLine('构图', item.composition),
        sceneDetailLine('机位', item.camera),
        sceneDetailLine('氛围', item.atmosphere),
      ].filter(Boolean).filter((line, index, lines) => lines.indexOf(line) === index).join('\n');
      const {
        environment: _environment,
        props: _props,
        lighting: _lighting,
        composition: _composition,
        camera: _camera,
        atmosphere: _atmosphere,
        scenePrompt: _scenePrompt,
        ...rest
      } = item;
      return {
        ...rest,
        description,
      };
    }),
  };
}

function normalizeProductSettingData(data: unknown) {
  if (!isRecord(data)) {
    return data;
  }
  const cleanItem = (item: Record<string, unknown>) => ({
    ...item,
    description: cleanReferencePromptText(item.description),
    presentation: cleanReferencePromptText(item.presentation),
    productType: cleanReferencePromptText(item.productType),
    feature: cleanReferencePromptText(item.feature),
    brand: cleanReferencePromptText(item.brand),
    model: cleanReferencePromptText(item.model),
  });
  const rawItems = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  if (rawItems.length) {
    return {
      ...data,
      items: rawItems.map(cleanItem),
    };
  }
  return cleanItem(data);
}

function normalizeCardDataForStorage(cardType: VideoRemakeCardType, data: unknown) {
  const cleanData = isRecord(data)
    ? Object.fromEntries(Object.entries(data).filter(([key]) => (
      key !== 'editingFromConfirmed'
      && key !== 'editingOriginalData'
      && key !== 'activeItemIndex'
    )))
    : data;
  const cleanCardData = stripUiOnlyItemFlags(cleanData);
  if ((cardType === 'storyboard_script' || cardType === 'seedance_prompt') && isRecord(cleanCardData) && Array.isArray(cleanCardData.items)) {
    return cleanCardData.items;
  }
  if (cardType === 'character_setting') {
    const normalized = normalizeCharacterSettingData(cleanCardData);
    assertCharacterSettingData(normalized);
    return normalized;
  }
  if (cardType === 'scene_setting') {
    return normalizeSceneSettingData(cleanCardData);
  }
  if (cardType === 'product_setting') {
    return normalizeProductSettingData(cleanCardData);
  }
  if (cardType === 'voice_audio_setting' || cardType === 'pip_setting') {
    return cleanCardData;
  }
  return cleanCardData;
}

function videoDurationSecondsForSession(session: VideoRemakeSession) {
  const videoBasicInfo = isRecord(session.workflow.artifacts.videoBasicInfo)
    ? session.workflow.artifacts.videoBasicInfo
    : isRecord(session.artifacts.video_basic_info)
      ? session.artifacts.video_basic_info
      : {};
  const raw = Number(videoBasicInfo.durationSeconds || videoBasicInfo.duration || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function isImagePipAsset(item: Record<string, unknown>) {
  const mimeType = fieldText(item.replacementAssetMimeType || item.mimeType).toLowerCase();
  if (mimeType) {
    return mimeType.startsWith('image/');
  }
  const url = fieldText(item.replacementAssetUrl || item.fileUrl).toLowerCase();
  return /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/u.test(url);
}

function strictSecondValue(value: unknown) {
  if (typeof value === 'string' && !value.trim()) {
    return Number.NaN;
  }
  const second = Number(value);
  return Number.isFinite(second) ? second : Number.NaN;
}

function assertPipSettingData(session: VideoRemakeSession, data: unknown) {
  if (!isRecord(data)) {
    return;
  }
  const durationSeconds = videoDurationSecondsForSession(session);
  const ranges = (Array.isArray(data.items) ? data.items.filter(isRecord) : [])
    .filter((item) => item.required !== false)
    .map((item, index) => {
      const startSecond = strictSecondValue(item.startSecond);
      const endSecond = strictSecondValue(item.endSecond);
      const label = fieldText(item.label) || `画中画 ${index + 1}`;
      if (!Number.isFinite(startSecond) || !Number.isFinite(endSecond)) {
        throw new Error(`${label} 请填写开始和结束时间`);
      }
      if (startSecond < 0 || endSecond <= startSecond) {
        throw new Error(`${label} 时间范围不正确，结束时间必须大于开始时间`);
      }
      if (durationSeconds > 0 && (startSecond >= durationSeconds || endSecond >= durationSeconds)) {
        throw new Error(`${label} 开始和结束时间都必须小于视频时长 ${durationSeconds}s`);
      }
      const hasPrompt = fieldText(item.replacementPrompt || item.content).trim();
      const hasUploadedAsset = fieldText(item.replacementAssetUrl || item.fileUrl || item.replacementAssetId).trim();
      if (!hasPrompt && !hasUploadedAsset) {
        throw new Error(`${label} 请上传图片素材或填写画中画描述提示词`);
      }
      if (hasUploadedAsset && !isImagePipAsset(item)) {
        throw new Error(`${label} 画中画素材只能上传图片`);
      }
      return { label, startSecond, endSecond };
    })
    .sort((left, right) => left.startSecond - right.startSecond);

  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (current.startSecond < previous.endSecond) {
      throw new Error(`${previous.label} 和 ${current.label} 的时间范围重叠，请调整后再确认`);
    }
  }
}

function syncArtifact(session: VideoRemakeSession, cardType: VideoRemakeCardType, data: unknown) {
  const key = artifactKeyForCard(cardType);
  session.workflow.artifacts = { ...session.workflow.artifacts, [key]: data };
  session.artifacts = { ...session.artifacts, [cardType]: data };
  session.invalidArtifacts = session.invalidArtifacts.filter((item) => item !== cardType);
  session.workflow.invalidArtifacts = session.workflow.invalidArtifacts.filter((item) => item !== cardType);
  session.workflow.updatedAt = nowIso();
}

function markStoryboardCardFailed(session: VideoRemakeSession, cardId: string, error: unknown, previousData?: unknown) {
  const message = errorMessage(error);
  const failedData = {
    status: 'failed',
    message: '分镜脚本生成失败，请稍后重试。',
    errorMessage: message,
    retryable: true,
    previousData,
    failedAt: nowIso(),
  };
  updateCardById(session, cardId, { status: 'failed', data: failedData });
  session.status = 'waiting_edit';
  session.currentStep = 'generate_storyboard';
  session.workflow.currentNode = 'generate_storyboard';
  session.workflow.pendingInterrupt = {
    type: 'confirm_card',
    cardId,
    cardType: 'storyboard_script',
    reason: 'regenerate',
  };
  session.workflow.updatedAt = nowIso();
  pushEvent(session, { type: 'error', step: 'generate_storyboard', message, retryable: true });
}

function expertRuntimeKey(expertKey: string) {
  if (expertKey === 'audio') {
    return 'audio';
  }
  if (expertKey === 'visual') {
    return 'visual';
  }
  if (expertKey === 'pip') {
    return 'pip';
  }
  return '';
}

function understandingRoleForRuntimeKey(runtimeKey: string) {
  if (runtimeKey === 'audio') {
    return 'audio_expert';
  }
  if (runtimeKey === 'visual') {
    return 'video_expert';
  }
  if (runtimeKey === 'pip') {
    return 'picture_in_picture_expert';
  }
  return '';
}

function expertRetryInvalidation(runtimeKey: string): VideoRemakeCardType[] {
  return runtimeKey
    ? ['basic_info', ...cardConfirmationOrder.slice(1), 'storyboard_script', 'seedance_prompt', 'final_video']
    : ['storyboard_script', 'seedance_prompt', 'final_video'];
}

function hasUnderstandingProgress(value: unknown): value is {
  completedExperts?: unknown;
  totalExperts?: unknown;
  estimatedAnalysisTime?: unknown;
  executions?: unknown;
} {
  return isRecord(value) && (value.completedExperts !== undefined || value.totalExperts !== undefined);
}

function completedUnderstandingExecutions(value: unknown, completedCount?: number) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const count = completedCount ?? value.length;
  return value.filter(isRecord).map((item, index) => ({
    ...item,
    completed: index < count,
  }));
}

function formatDuration(seconds: number) {
  if (!seconds) {
    return '';
  }
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes}分${remain}秒` : `${minutes}分钟`;
}

function aspectRatioFromSize(width: number, height: number) {
  if (!width || !height) {
    return '';
  }
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function buildVideoBasicInfo(vod: Record<string, unknown>, workflow: VideoRemakeWorkflowState) {
  const sourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const inspection = isRecord(vod.inspection) ? vod.inspection : {};
  const videoInfo = isRecord(inspection.videoInfo) ? inspection.videoInfo : {};
  const width = Number(sourceInfo.width || sourceInfo.Width || videoInfo.width || 0);
  const height = Number(sourceInfo.height || sourceInfo.Height || videoInfo.height || 0);
  const rawDuration = Number(sourceInfo.duration || sourceInfo.Duration || sourceInfo.durationSeconds || videoInfo.duration || 0);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 1000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration || 0);
  return {
    title: workflow.source.title,
    fileName: workflow.source.title,
    vid: fieldText(vod.vid),
    resolution: height ? `${height}p` : '',
    resolutionDetail: width && height ? `${width}x${height}` : '',
    aspectRatio: aspectRatioFromSize(width, height) || '9:16',
    duration: formatDuration(durationSeconds),
    durationSeconds,
  };
}

function invalidateDependents(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  const dependents = artifactDependencies[cardType] || [];
  invalidateCards(session, dependents);
}

function invalidateCards(session: VideoRemakeSession, dependents: VideoRemakeCardType[]) {
  const invalid = new Set([...session.invalidArtifacts, ...session.workflow.invalidArtifacts, ...dependents]);
  session.invalidArtifacts = [...invalid];
  session.workflow.invalidArtifacts = [...invalid];
}

function deferredInvalidationCardTypes(session: VideoRemakeSession) {
  const value = session.workflow.runtime.deferredInvalidationCardTypes;
  return Array.isArray(value)
    ? value.filter((item): item is VideoRemakeCardType => typeof item === 'string' && Boolean(artifactDependencies[item as VideoRemakeCardType]))
    : [];
}

function markDeferredInvalidation(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  if (!(artifactDependencies[cardType] || []).length) {
    return;
  }
  session.workflow.runtime.deferredInvalidationCardTypes = Array.from(new Set([
    ...deferredInvalidationCardTypes(session),
    cardType,
  ]));
}

function consumeDeferredInvalidationCardTypes(session: VideoRemakeSession) {
  const cardTypes = deferredInvalidationCardTypes(session);
  session.workflow.runtime.deferredInvalidationCardTypes = undefined;
  return cardTypes;
}

function isCompletedFinalVideoCard(card: VideoRemakeCardMessage) {
  if (card.cardType !== 'final_video') {
    return false;
  }
  const data = isRecord(card.data) ? card.data : {};
  return Boolean(fieldText(data.videoUrl) || fieldText(data.status) === 'completed');
}

function hasCompletedFinalVideoAfterCard(session: VideoRemakeSession, cardId: string) {
  const cardIndex = session.messages.findIndex((message) => message.type === 'card' && message.cardId === cardId);
  if (cardIndex < 0) {
    return false;
  }
  return session.messages.slice(cardIndex + 1).some((message): message is VideoRemakeCardMessage => (
    message.type === 'card'
    && message.cardType === 'final_video'
    && isCompletedFinalVideoCard(message)
  ));
}

function expireCard(session: VideoRemakeSession, card: VideoRemakeCardMessage, reason: string) {
  updateCardById(session, card.cardId, {
    status: 'expired',
    data: {
      ...isRecord(card.data) ? card.data : {},
      expiredReason: reason,
      expiredAt: nowIso(),
    },
  });
}

function expireDependentDraftCards(session: VideoRemakeSession, cardType: VideoRemakeCardType, reason: string) {
  const dependents = artifactDependencies[cardType] || [];
  const targets = new Set(dependents);
  session.messages
    .filter((message): message is VideoRemakeCardMessage => (
      message.type === 'card'
      && targets.has(message.cardType)
      && !isCompletedFinalVideoCard(message)
      && (message.status === 'pending' || message.status === 'editing' || message.status === 'confirmed')
    ))
    .forEach((card) => {
      updateCardById(session, card.cardId, {
        status: 'expired',
        data: {
          ...isRecord(card.data) ? card.data : {},
          expiredReason: reason,
          expiredAt: nowIso(),
        },
      });
    });
}

function expireCardsOfTypes(session: VideoRemakeSession, cardTypes: VideoRemakeCardType[], reason = 'expert_retry') {
  const targets = new Set(cardTypes);
  session.messages
    .filter((message): message is VideoRemakeCardMessage => (
      message.type === 'card'
      && targets.has(message.cardType)
      && !isCompletedFinalVideoCard(message)
      && (message.status === 'pending' || message.status === 'editing' || message.status === 'confirmed')
    ))
    .forEach((card) => {
      updateCardById(session, card.cardId, {
        status: 'expired',
        data: {
          ...isRecord(card.data) ? card.data : {},
          expiredReason: reason,
          expiredAt: nowIso(),
        },
      });
    });
}

function setWorkflowNode(session: VideoRemakeSession, node: VideoRemakeWorkflowNode, label: string, percent?: number) {
  session.currentStep = node;
  session.workflow.currentNode = node;
  session.workflow.updatedAt = nowIso();
  pushEvent(session, { type: 'workflow.progress', step: node, label, percent });
}

function interruptForCard(session: VideoRemakeSession, card: VideoRemakeCardMessage, reason: 'initial_review' | 'manual_edit' | 'regenerate' = 'initial_review') {
  session.status = 'waiting_edit';
  session.workflow.pendingInterrupt = { type: 'confirm_card', cardId: card.cardId, cardType: card.cardType, reason };
  pushEvent(session, {
    type: 'workflow.interrupt',
    interruptType: 'confirm_card',
    cardId: card.cardId,
    cardType: card.cardType,
    data: card.data,
  });
}

function taskContext(input: { mode: string; workflow: VideoRemakeWorkflowState }) {
  return {
    mode: input.mode,
    videoRemake: {
      workflow: input.workflow,
      artifacts: input.workflow.artifacts,
      invalidArtifacts: input.workflow.invalidArtifacts,
      updatedAt: nowIso(),
    },
  };
}

function mergeAnalysisParseResult(workflow: VideoRemakeWorkflowState) {
  const audio = workflow.runtime.analyses?.audio || {};
  const visual = workflow.runtime.analyses?.visual || {};
  const pip = workflow.runtime.analyses?.pip || {};
  return {
    person: JSON.stringify((visual as Record<string, unknown>).characters || []),
    scene: JSON.stringify((visual as Record<string, unknown>).scenes || []),
    voice: String((audio as Record<string, unknown>).voiceStyle || ''),
    shotLanguage: String((visual as Record<string, unknown>).summary || ''),
    product: JSON.stringify((visual as Record<string, unknown>).product || {}),
    pip: JSON.stringify(pip),
    spokenContent: String((audio as Record<string, unknown>).spokenContent || ''),
    extraDetails: String((audio as Record<string, unknown>).summary || ''),
    analysisProcess: [
      { roleName: '音频理解专家', content: audio },
      { roleName: '视频理解专家', content: visual },
      { roleName: '画中画理解专家', content: pip },
    ],
  };
}

function urlCloneAnalysesFromParseResult(parseResult: {
  person?: string;
  scene?: string;
  voice?: string;
  shotLanguage?: string;
  product?: string;
  pip?: string;
  spokenContent?: string;
  extraDetails?: string;
}, sourceUrl: string) {
  const visualSummary = [
    parseResult.scene || '',
    parseResult.shotLanguage || '',
    parseResult.product || '',
    parseResult.extraDetails || '',
  ].filter(Boolean).join('\n');
  const pipText = String(parseResult.pip || '').trim();
  const noPip = !pipText || /^(无|暂无|没有|未出现|未发现|不涉及|无画中画)[。.]?$/u.test(pipText);
  return {
    audio: {
      roleName: '一键复刻解析专家',
      content: parseResultToMarkdown(parseResult as never),
      summary: parseResult.voice || parseResult.extraDetails || '已根据链接生成复刻初稿。',
      spokenContent: parseResult.spokenContent || '',
      voice: '待用户确认',
      voiceStyle: parseResult.voice || '待用户确认',
      bgm: '',
      soundEffects: '',
      source: 'url_llm_reverse_prompt',
    },
    visual: {
      roleName: '分镜脚本分析专家',
      content: visualSummary || '已根据链接生成复刻初稿，待用户确认细节。',
      summary: visualSummary || '已根据链接生成复刻初稿，待用户确认细节。',
      characters: parseResult.person ? [{
        label: '人物 1',
        description: parseResult.person,
        characterPrompt: parseResult.person,
        required: true,
        referenceMode: 'prompt',
      }] : [],
      scenes: [{
        label: '场景 1',
        description: parseResult.scene || parseResult.extraDetails || '待用户确认场景细节',
        required: true,
        referenceMode: 'prompt',
      }],
      product: {
        description: parseResult.product || '',
        summary: parseResult.product || '',
        sourceUrl,
      },
      source: 'url_llm_reverse_prompt',
    },
    pip: {
      roleName: '画中画理解专家',
      content: noPip ? '' : pipText,
      summary: noPip ? '链接文本反推未发现明确画中画信息。' : pipText,
      appeared: !noPip,
      items: noPip ? [] : [{
        label: '画中画 1',
        content: pipText,
        replacementPrompt: pipText,
      }],
      source: 'url_llm_reverse_prompt',
    },
  };
}

function expertCardsFromAnalyses(workflow: VideoRemakeWorkflowState) {
  const audio = sanitizeExpertAnalysisRecord('audio', workflow.runtime.analyses?.audio || {});
  const visual = sanitizeExpertAnalysisRecord('visual', workflow.runtime.analyses?.visual || {});
  const pip = sanitizeExpertAnalysisRecord('pip', workflow.runtime.analyses?.pip || {});
  return [
    { expertKey: 'audio', roleName: '音频理解专家', analysis: audio },
    { expertKey: 'visual', roleName: '视频理解专家', analysis: visual },
    { expertKey: 'pip', roleName: '画中画理解专家', analysis: pip },
  ].map((item) => ({
    expertKey: item.expertKey,
    roleName: String((item.analysis as Record<string, unknown>).roleName || item.roleName),
    ...item.analysis,
  })).filter((item) => hasRenderableExpertAnalysis(item));
}

function completeUnderstandingStage(session: VideoRemakeSession, input: {
  audio: Record<string, unknown>;
  visual: Record<string, unknown>;
  pip: Record<string, unknown>;
}) {
  session.workflow.runtime.analyses = {
    audio: input.audio,
    visual: input.visual,
    pip: input.pip,
  };
  const parsingCard = lastCardOfType(session, 'generation_progress');
  if (parsingCard) {
    const parsingData = isRecord(parsingCard.data) ? parsingCard.data : {};
    const totalExperts = Number(parsingData.totalExperts || 3);
    updateCardById(session, parsingCard.cardId, {
      status: 'confirmed',
      data: {
        ...parsingData,
        step: 'analyze_pip',
        status: 'completed',
        message: `视频解析完成 ${totalExperts}/${totalExperts}，专家结果已返回。`,
        percent: 100,
        completedExperts: totalExperts,
        totalExperts,
        executions: completedUnderstandingExecutions(parsingData.executions, totalExperts),
      },
    });
  }
  syncArtifact(session, 'expert_analysis', session.workflow.artifacts.expertAnalysis || {});
  const existingExpertKeys = new Set(
    session.messages
      .filter((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardType === 'expert_analysis')
      .map((message) => fieldText(isRecord(message.data) ? message.data.expertKey : undefined))
      .filter(Boolean),
  );
  expertCardsFromAnalyses(session.workflow).forEach((expert) => {
    const key = fieldText(expert.expertKey);
    if (!key || existingExpertKeys.has(key)) {
      return;
    }
    existingExpertKeys.add(key);
    addCard(session, 'expert_analysis', { status: 'confirmed', data: expert });
  });
  ensureDirectorNormalizePendingCard(session);
  videoRemakeRepository.updateSession(session.id, {
    status: session.status,
    currentStep: session.currentStep,
    invalidArtifacts: session.invalidArtifacts,
    artifacts: session.artifacts,
    workflow: session.workflow,
  });
}

function ensureDirectorNormalizePendingCard(session: VideoRemakeSession, reason?: string) {
  return ensurePendingCard(session, 'director_normalize', {
    step: 'director_normalize',
    status: 'running',
    message: reason === 'expert_retry'
      ? '专家重新解析完成，视频导演正在重新整理可确认素材表。'
      : '视频导演正在整理人物、场景、画中画和口播设定。',
    percent: 58,
    ...(reason ? { reason } : {}),
  });
}

function confirmDirectorNormalizeCard(session: VideoRemakeSession, card: VideoRemakeCardMessage | null, reason?: string) {
  const target = card || lastCardOfType(session, 'director_normalize');
  if (!target) {
    return;
  }
  updateCardById(session, target.cardId, {
    status: 'confirmed',
    data: {
      ...isRecord(target.data) ? target.data : {},
      step: 'director_normalize',
      status: 'completed',
      message: reason === 'expert_retry'
        ? '视频导演已根据重新解析结果整理完成。'
        : '视频导演已整理完成，已生成可确认设定。',
      percent: 100,
      ...(reason ? { reason } : {}),
    },
  });
}

function isSyntheticExpertPlaceholderContent(content: string) {
  return [
    '视频理解专家已完成解析，已返回结构化结果。',
    '画中画理解专家已完成解析，已返回结构化结果。',
  ].includes(content.trim());
}

function looksLikeJsonPayload(content: string) {
  const trimmed = content.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function isIncompleteJsonPayload(content: string) {
  const trimmed = content.trim();
  if (!looksLikeJsonPayload(trimmed)) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    return true;
  }
}

function repairJsonPayload(content: string) {
  return repairVideoRemakeJsonPayload(content);
}

function sanitizeExpertAnalysisRecord(expertKey: string, analysis: Record<string, unknown>) {
  const next = { ...analysis };
  const rawContent = fieldText(next.content);
  const rawSummary = fieldText(next.summary);
  const content = repairJsonPayload(rawContent);
  const summary = repairJsonPayload(rawSummary);
  if (content !== rawContent) {
    next.content = content;
  }
  if (summary !== rawSummary) {
    next.summary = summary;
  }
  if (expertKey === 'visual') {
    let characters = Array.isArray(next.characters) ? next.characters : [];
    let scenes = Array.isArray(next.scenes) ? next.scenes : [];
    let product = isRecord(next.product) ? next.product : {};
    let productItems = Array.isArray(product.items) ? product.items : [];
    if (content && (!characters.length || !scenes.length)) {
      const details = visualDetailsFromContent(content);
      if (details.content !== content) {
        next.content = details.content;
        if (summary === content || summary === rawContent) {
          next.summary = details.content;
        }
      }
      if (!characters.length && details.characters.length) {
        next.characters = details.characters;
        characters = details.characters;
      }
      if (!scenes.length && details.scenes.length) {
        next.scenes = details.scenes;
        scenes = details.scenes;
      }
      if (!productItems.length && details.product.items.length) {
        next.product = details.product;
        product = details.product;
        productItems = details.product.items;
      } else if (!isRecord(next.product) && details.product.noProduct) {
        next.product = details.product;
        product = details.product;
      }
    }
    if (isSyntheticExpertPlaceholderContent(content) && !characters.length && !scenes.length && !productItems.length && product.noProduct !== false) {
      next.content = '';
    }
    if (isSyntheticExpertPlaceholderContent(summary) && !fieldText(next.content)) {
      next.summary = '';
    }
    if (isIncompleteJsonPayload(content) && !characters.length && !scenes.length && !productItems.length && product.noProduct !== false) {
      next.content = '';
      next.summary = '视频理解结果不完整，原始返回被截断，请重试视频理解专家。';
    }
  }
  if (expertKey === 'pip') {
    const pictureInPicture = isRecord(next.pictureInPicture) ? next.pictureInPicture : {};
    const items = Array.isArray(next.items)
      ? next.items
      : Array.isArray(pictureInPicture.items) ? pictureInPicture.items : [];
    const appeared = Boolean(next.appeared ?? pictureInPicture.appeared);
    if (isSyntheticExpertPlaceholderContent(content) && !appeared && !items.length) {
      next.content = '';
    }
    if (isSyntheticExpertPlaceholderContent(summary) && !fieldText(next.content)) {
      next.summary = '';
    }
  }
  return next;
}

function hasRenderableExpertAnalysis(analysis: Record<string, unknown>) {
  const expertKey = fieldText(analysis.expertKey);
  if (expertKey === 'audio') {
    return Boolean(fieldText(analysis.spokenContent) || fieldText(analysis.content) || fieldText(analysis.summary));
  }
  if (expertKey === 'visual') {
    const characters = Array.isArray(analysis.characters) ? analysis.characters : [];
    const scenes = Array.isArray(analysis.scenes) ? analysis.scenes : [];
    const product = isRecord(analysis.product) ? analysis.product : {};
    const productItems = Array.isArray(product.items) ? product.items : [];
    return Boolean(
      fieldText(analysis.content)
      || fieldText(analysis.summary)
      || characters.length
      || scenes.length
      || productItems.length
      || product.noProduct === false
    );
  }
  if (expertKey === 'pip') {
    const pictureInPicture = isRecord(analysis.pictureInPicture) ? analysis.pictureInPicture : {};
    const items = Array.isArray(analysis.items)
      ? analysis.items
      : Array.isArray(pictureInPicture.items) ? pictureInPicture.items : [];
    const appeared = Boolean(analysis.appeared ?? pictureInPicture.appeared);
    return Boolean(
      appeared
      || items.length
      || fieldText(analysis.content)
      || fieldText(analysis.summary)
    );
  }
  return Boolean(fieldText(analysis.content) || fieldText(analysis.summary));
}

function refreshedTaskExpertContext(
  current: VideoRemakeTask,
  session: VideoRemakeSession,
  options?: { resetVideoGeneration?: boolean },
) {
  const existingContext = isRecord(current.expertContext) ? current.expertContext : {};
  const nextContext: Record<string, unknown> = {
    ...existingContext,
    ...taskContext({ mode: session.workflow.mode, workflow: session.workflow }),
  };
  if (options?.resetVideoGeneration) {
    delete nextContext.videoGenerationSegments;
    delete nextContext.videoGenerationResult;
    delete nextContext.videoGenerationResults;
    delete nextContext.videoResult;
    const viralUnderstanding = isRecord(nextContext.viralUnderstanding)
      ? { ...nextContext.viralUnderstanding }
      : undefined;
    if (viralUnderstanding) {
      delete viralUnderstanding.videoGenerationResult;
      delete viralUnderstanding.videoGenerationResults;
      nextContext.viralUnderstanding = viralUnderstanding;
    }
  }
  return nextContext;
}

function refreshTask(session: VideoRemakeSession, status?: VideoRemakeTask['status'], generatedVideoUrl?: string | null) {
  if (!session.taskId) {
    return;
  }
  const current = videoRemakeRepository.findTask(session.taskId);
  if (!current) {
    return;
  }
  const parseResult = mergeAnalysisParseResult(session.workflow);
  const resetVideoGeneration = status === 'generating' && generatedVideoUrl === null;
  const editableParseResult = Object.keys(session.workflow.artifacts || {}).length
    ? { ...parseResult, artifacts: session.workflow.artifacts }
    : current.editableParseResult;
  if (resetVideoGeneration) {
    delete (editableParseResult as Record<string, unknown>).videoGenerationResult;
  }
  videoRemakeRepository.updateTask(session.taskId, {
    status,
    rawParseResult: Object.keys(session.workflow.runtime.analyses || {}).length ? parseResult : current.rawParseResult,
    editableParseResult,
    expertContext: refreshedTaskExpertContext(current, session, { resetVideoGeneration }),
    generatedVideoUrl,
  });
}

function persistSession(session: VideoRemakeSession) {
  refreshTask(session);
  const persisted = videoRemakeRepository.updateSession(session.id, {
    taskId: session.taskId || null,
    filename: session.filename || null,
    status: session.status,
    currentStep: session.currentStep,
    invalidArtifacts: session.invalidArtifacts,
    artifacts: session.artifacts,
    workflow: session.workflow,
    cancelledAt: session.cancelledAt || null,
  });
  if (!persisted) {
    throw new Error('视频复刻会话保存失败');
  }
  return snapshot(persisted);
}

function failSession(session: VideoRemakeSession, failureReason: string) {
  const failedStep = session.currentStep;
  session.status = 'failed';
  session.currentStep = 'failed';
  session.workflow.currentNode = 'failed';
  session.workflow.updatedAt = nowIso();
  session.workflow.pendingInterrupt = undefined;
  const uploadCard = lastCardOfType(session, 'uploading');
  if (uploadCard && (failedStep === 'upload_to_vod' || uploadCard.status === 'pending')) {
    const uploadData = isRecord(uploadCard.data) ? uploadCard.data : {};
    updateCardById(session, uploadCard.cardId, {
      status: 'failed',
      data: {
        ...uploadData,
        status: 'failed',
        message: failureReason,
        errorMessage: failureReason,
      },
    });
  }
  const progressCard = lastCardOfType(session, 'generation_progress');
  if (progressCard) {
    const progressData = isRecord(progressCard.data) ? progressCard.data : {};
    updateCardById(session, progressCard.cardId, {
      status: 'failed',
      data: {
        ...progressData,
        step: 'failed',
        status: 'failed',
        message: failureReason,
      },
    });
  }
  pushEvent(session, { type: 'error', step: session.currentStep, message: failureReason, retryable: true });
  pushEvent(session, {
    type: 'session.status',
    status: session.status,
    currentStep: session.currentStep,
    invalidArtifacts: session.invalidArtifacts,
  });
  refreshTask(session, 'failed');
  if (session.taskId) {
    const current = videoRemakeRepository.findTask(session.taskId);
    if (current) {
      videoRemakeRepository.updateTask(session.taskId, {
        status: 'failed',
        rawParseResult: current.rawParseResult,
        editableParseResult: current.editableParseResult,
        expertContext: taskContext({ mode: session.workflow.mode, workflow: session.workflow }),
        failureReason,
      });
    }
  }
  return persistSession(session);
}

async function runNode<T>(session: VideoRemakeSession, node: VideoRemakeWorkflowNode, execute: () => Promise<T>) {
  logVideoRemakeGeneration('info', 'workflow node starting', {
    sessionId: session.id,
    taskId: session.taskId,
    node,
    status: session.status,
    currentStep: session.currentStep,
  });
  setWorkflowNode(session, node, node, undefined);
  try {
    const result = await execute();
    session.workflow.updatedAt = nowIso();
    logVideoRemakeGeneration('info', 'workflow node completed', {
      sessionId: session.id,
      taskId: session.taskId,
      node,
    });
    return result;
  } catch (error) {
    logVideoRemakeGeneration('error', 'workflow node failed', {
      sessionId: session.id,
      taskId: session.taskId,
      node,
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

function isInsufficientStepCreditsError(error: unknown): error is InsufficientStepCreditsError {
  return error instanceof InsufficientStepCreditsError;
}

function workflowNodeForCreditStep(step: string): VideoRemakeWorkflowNode {
  const candidates: VideoRemakeWorkflowNode[] = [
    'upload_to_vod',
    'analyze_audio',
    'analyze_visual',
    'analyze_pip',
    'director_normalize',
    'generate_storyboard',
    'generate_seedance_prompts',
    'generate_video_segments',
    'merge_video',
  ];
  return candidates.includes(step as VideoRemakeWorkflowNode)
    ? step as VideoRemakeWorkflowNode
    : 'upload_to_vod';
}

function markSessionWaitingForCredit(session: VideoRemakeSession, error: InsufficientStepCreditsError) {
  const blockedAt = nowIso();
  const node = workflowNodeForCreditStep(error.step);
  session.status = 'waiting_credit';
  session.currentStep = node;
  session.workflow.currentNode = node;
  session.workflow.updatedAt = blockedAt;
  session.workflow.runtime.creditBlock = {
    step: error.step,
    stepLabel: error.stepLabel,
    message: error.message,
    currentCredits: error.currentCredits,
    requiredCredits: error.requiredCredits,
    shortfallCredits: error.shortfallCredits,
    createdAt: blockedAt,
  };
  pushEvent(session, {
    type: 'error',
    step: error.step,
    message: error.message,
    retryable: true,
  });
  if (node === 'upload_to_vod') {
    const uploadCard = lastCardOfType(session, 'uploading');
    if (uploadCard) {
      updateCardById(session, uploadCard.cardId, {
        status: 'failed',
        data: {
          ...isRecord(uploadCard.data) ? uploadCard.data : {},
          status: 'failed',
          message: error.message,
          requiredCredits: error.requiredCredits,
          currentCredits: error.currentCredits,
          shortfallCredits: error.shortfallCredits,
        },
      });
    } else {
      const progressCard = lastCardOfType(session, 'generation_progress')
        || addCard(session, 'generation_progress', {
          status: 'failed',
          data: {
            kind: 'url_parsing',
            step: error.step,
            status: 'failed',
            message: error.message,
            requiredCredits: error.requiredCredits,
            currentCredits: error.currentCredits,
            shortfallCredits: error.shortfallCredits,
          },
        });
      updateCardById(session, progressCard.cardId, {
        status: 'failed',
        data: {
          ...isRecord(progressCard.data) ? progressCard.data : {},
          kind: 'url_parsing',
          step: error.step,
          status: 'failed',
          message: error.message,
          requiredCredits: error.requiredCredits,
          currentCredits: error.currentCredits,
          shortfallCredits: error.shortfallCredits,
        },
      });
    }
  } else {
    const progressCard = lastCardOfType(session, 'generation_progress')
      || addCard(session, 'generation_progress', {
        status: 'failed',
        data: {
          step: error.step,
          status: 'failed',
          message: error.message,
          requiredCredits: error.requiredCredits,
          currentCredits: error.currentCredits,
          shortfallCredits: error.shortfallCredits,
        },
      });
    updateCardById(session, progressCard.cardId, {
      status: 'failed',
      data: {
        ...isRecord(progressCard.data) ? progressCard.data : {},
        step: error.step,
        status: 'failed',
        message: error.message,
        requiredCredits: error.requiredCredits,
        currentCredits: error.currentCredits,
        shortfallCredits: error.shortfallCredits,
      },
    });
  }
  addAssistantMessage(session, error.message);
  refreshTask(session, 'waiting_credit');
  return persistSession(session);
}

function clearCreditBlock(session: VideoRemakeSession) {
  session.workflow.runtime.creditBlock = undefined;
}

function requireSession(sessionId: string) {
  const session = videoRemakeRepository.findSession(sessionId);
  if (!session) {
    throw new Error('视频复刻会话不存在');
  }
  return session;
}

function requireTask(session: VideoRemakeSession) {
  const task = taskForSession(session);
  if (!task) {
    throw new Error('当前会话还没有绑定视频任务');
  }
  return task;
}

function updateCardById(session: VideoRemakeSession, cardId: string, patch: { status?: VideoRemakeCardMessage['status']; data?: unknown }) {
  const card = session.messages.find((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardId === cardId);
  if (!card) {
    throw new Error('卡片不存在');
  }
  pushEvent(session, { type: 'card.update', cardId, status: patch.status, data: patch.data });
  return { ...card, status: patch.status || card.status, data: patch.data === undefined ? card.data : patch.data };
}

function editingDataForCard(card: VideoRemakeCardMessage) {
  if (card.status !== 'confirmed') {
    return card.data;
  }
  return editingDataFromConfirmedData(card.data);
}

function editingDataFromConfirmedData(value: unknown) {
  if (Array.isArray(value)) {
    return {
      items: value,
      editingFromConfirmed: true,
      editingOriginalData: cloneJson(value),
    };
  }
  return {
    ...isRecord(value) ? value : {},
    editingFromConfirmed: true,
    editingOriginalData: cloneJson(value),
  };
}

function confirmedDataFromEditingData(cardType: VideoRemakeCardType, value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }
  const data = isRecord(value) ? value : {};
  if ((cardType === 'storyboard_script' || cardType === 'seedance_prompt') && Array.isArray(data.items)) {
    return data.items;
  }
  const { editingFromConfirmed: _editingFromConfirmed, editingOriginalData: _editingOriginalData, ...restData } = data;
  return restData;
}

function originalDataForEditingComparison(cardType: VideoRemakeCardType, value: unknown) {
  const data = isRecord(value) ? value : {};
  return Object.prototype.hasOwnProperty.call(data, 'editingOriginalData')
    ? data.editingOriginalData
    : confirmedDataFromEditingData(cardType, value);
}

function markUploadCardUploaded(session: VideoRemakeSession, vod?: unknown) {
  const uploadCard = lastCardOfType(session, 'uploading');
  if (!uploadCard) {
    return;
  }
  const data = isRecord(uploadCard.data) ? uploadCard.data : {};
  const hasBasicInfo = Boolean(lastCardOfType(session, 'video_basic_info'));
  if (
    uploadCard.status === 'confirmed'
    && fieldText(data.status) === 'uploaded'
    && (hasBasicInfo || !fieldText(data.message).includes('正在读取基础信息'))
  ) {
    return;
  }
  const vodRecord = isRecord(vod) ? vod : {};
  updateCardById(session, uploadCard.cardId, {
    status: 'confirmed',
    data: {
      ...data,
      status: 'uploaded',
      message: hasBasicInfo ? '视频已上传完成，基础信息已读取完成。' : '视频已上传完成，正在读取基础信息。',
      vid: fieldText(vodRecord.vid),
    },
  });
}

function markUploadBasicInfoReady(session: VideoRemakeSession) {
  const uploadCard = lastCardOfType(session, 'uploading');
  if (!uploadCard) {
    return;
  }
  const data = isRecord(uploadCard.data) ? uploadCard.data : {};
  updateCardById(session, uploadCard.cardId, {
    status: 'confirmed',
    data: {
      ...data,
      status: 'uploaded',
      message: '视频已上传完成，基础信息已读取完成。',
    },
  });
}

function lastCardOfType(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  const cards = session.messages.filter((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardType === cardType);
  return cards[cards.length - 1] || null;
}

function isCardSatisfied(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  const latest = lastCardOfType(session, cardType);
  return latest?.status === 'confirmed' && !session.workflow.invalidArtifacts.includes(cardType);
}

function hasProductSetting(value: unknown) {
  const data = isRecord(value) ? value : {};
  if (Boolean(data.noProduct)) {
    return false;
  }
  const items = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  if (items.length) {
    return items.some((item) => (
      !Boolean(item.noProduct)
      && Boolean(
        cleanReferencePromptText(item.description)
        || cleanReferencePromptText(item.presentation)
        || fieldText(item.assetId).trim()
        || fieldText(item.groupId).trim()
      )
    ));
  }
  return Boolean(
    cleanReferencePromptText(data.description)
    || cleanReferencePromptText(data.presentation)
    || fieldText(data.assetId).trim()
    || fieldText(data.groupId).trim()
  );
}

function isNoPipText(value: unknown) {
  const text = fieldText(value).trim();
  if (!text || /^(无|暂无|没有|未出现|未发现|未提及|不涉及|无画中画|没有画中画)[。.]?$/u.test(text)) {
    return true;
  }
  return /(?:未出现|未发现|没有|无).*(?:画中画|独立视觉叠加|独立内容区域|后期叠加|叠加视频|叠加图片|截图|录屏|分屏|可复刻的视觉叠加层)/u.test(text);
}

function hasPipSetting(value: unknown) {
  const data = isRecord(value) ? value : {};
  const items = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
  return items.some((item) => Boolean(
    (!isNoPipText(item.content) && fieldText(item.content).trim())
    || (!isNoPipText(item.replacementPrompt) && fieldText(item.replacementPrompt).trim())
    || fieldText(item.replacementAssetId).trim()
    || fieldText(item.replacementGroupId).trim()
  ));
}

function shouldAskDefaultConfirmation(session: VideoRemakeSession, cardType: VideoRemakeCardType) {
  if (cardType === 'product_setting') {
    return hasProductSetting(dataForCard(cardType, { workflow: session.workflow }));
  }
  if (cardType === 'pip_setting') {
    return hasPipSetting(dataForCard(cardType, { workflow: session.workflow }));
  }
  return true;
}

function nextUnsatisfiedConfirmationCard(session: VideoRemakeSession, current: VideoRemakeCardType) {
  const currentIndex = cardConfirmationOrder.indexOf(current);
  const startIndex = currentIndex < 0 ? cardConfirmationOrder.length : currentIndex + 1;
  return cardConfirmationOrder.slice(startIndex).find((cardType) => (
    shouldAskDefaultConfirmation(session, cardType) && !isCardSatisfied(session, cardType)
  ));
}

function findCardById(session: VideoRemakeSession, cardId: string) {
  return session.messages.find((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardId === cardId) || null;
}

async function continueAfterConfirmation(
  session: VideoRemakeSession,
  currentCardType: VideoRemakeCardType,
  context: () => VideoRemakeNodeContext,
) {
  const nextCard = nextUnsatisfiedConfirmationCard(session, currentCardType);
  if (nextCard) {
    const card = ensureEditingCard(session, nextCard, { data: dataForCard(nextCard, { workflow: session.workflow }) });
    interruptForCard(session, card);
    return;
  }
  if (isCardSatisfied(session, 'script_content') && !isCardSatisfied(session, 'storyboard_script')) {
    session.status = 'running';
    const pendingCard = ensurePendingCard(session, 'storyboard_script', {
      status: 'thinking',
      message: '分镜脚本分析专家正在根据已确认口播思考分镜脚本，请稍候。',
      createdFrom: 'script_content_confirmation',
      startedAt: nowIso(),
    });
    persistSession(session);
    let storyboard: unknown;
    try {
      storyboard = await runNode(session, 'generate_storyboard', () => defaultVideoRemakeNodeAdapters.generateStoryboard(context()));
    } catch (error) {
      markStoryboardCardFailed(session, pendingCard.cardId, error);
      return;
    }
    syncArtifact(session, 'storyboard_script', storyboard);
    const card = updateCardById(session, pendingCard.cardId, { status: 'editing', data: storyboard });
    interruptForCard(session, card);
    return;
  }
  if (isCardSatisfied(session, 'storyboard_script') && !isCardSatisfied(session, 'seedance_prompt')) {
    session.status = 'running';
    const prompts = withSeedancePromptVersion(
      session,
      await runNode(session, 'generate_seedance_prompts', () => defaultVideoRemakeNodeAdapters.generateSeedancePrompts(context())),
      { forceNext: true },
    );
    syncArtifact(session, 'seedance_prompt', prompts);
    const card = ensureEditingCard(session, 'seedance_prompt', { data: prompts });
    interruptForCard(session, card);
    return;
  }
  if (isCardSatisfied(session, 'seedance_prompt') && currentCardType === 'seedance_prompt') {
    session.status = 'running';
    const segments = await runNode(session, 'generate_video_segments', () => defaultVideoRemakeNodeAdapters.generateVideoSegments(context()));
    session.workflow.runtime.videoSegments = segments;
    const seedancePrompts = Array.isArray(session.workflow.artifacts.seedancePrompts)
      ? session.workflow.artifacts.seedancePrompts.filter(isRecord)
      : [];
    const seedanceVersionNumber = seedancePromptVersionNumber(seedancePrompts);
    const finalVideoDraft = withFinalVideoVersion(session, {
      message: 'Seedance 分段已准备好，确认后开始生成视频。',
      generationMode: 'parallel',
      segments,
      seedancePrompts,
      seedanceVersionNumber,
      seedanceVersionLabel: seedanceVersionNumber ? `v${seedanceVersionNumber}` : '',
      seedanceVersionId: seedanceVersionNumber ? `seedance_${seedanceVersionNumber}` : '',
    }, { forceNext: Boolean(latestFinalVideoCard(session) && hasCompletedFinalVideoData(latestFinalVideoCard(session)?.data)) });
    syncArtifact(session, 'final_video', finalVideoDraft);
    const previousFinalCard = latestFinalVideoCard(session);
    const card = previousFinalCard && !hasCompletedFinalVideoData(previousFinalCard.data)
      ? updateCardById(session, previousFinalCard.cardId, { status: 'editing', data: finalVideoDraft })
      : addCard(session, 'final_video', { status: 'editing', data: finalVideoDraft });
    interruptForCard(session, card);
  }
}

async function runFinalVideoMerge(
  session: VideoRemakeSession,
  targetCardId: string,
  baseData: Record<string, unknown>,
  segments: unknown[],
  context: () => VideoRemakeNodeContext,
) {
  const releaseGenerationActive = markVideoRemakeGenerationActive(session.taskId);
  try {
    logVideoRemakeGeneration('info', 'merge_video node starting', {
      sessionId: session.id,
      taskId: session.taskId,
      cardId: targetCardId,
      versionLabel: fieldText(baseData.versionLabel),
    });
    const merged = await runNode(session, 'merge_video', () => defaultVideoRemakeNodeAdapters.mergeVideo(context()));
    session.workflow.runtime.mergedVideo = merged;
    logVideoRemakeGeneration('info', 'merge_video node completed', {
      sessionId: session.id,
      taskId: session.taskId,
      cardId: targetCardId,
      versionLabel: fieldText(baseData.versionLabel),
      videoUrl: String((merged as Record<string, unknown>).videoUrl || ''),
      provider: String((merged as Record<string, unknown>).provider || ''),
      model: String((merged as Record<string, unknown>).model || ''),
      jobId: String((merged as Record<string, unknown>).jobId || ''),
      renderMode: String((merged as Record<string, unknown>).renderMode || ''),
    });
    const generatedAt = nowIso();
    const finalVideoData = {
      ...baseData,
      ...merged,
      status: 'completed',
      message: '视频生成完成。',
      generatedAt,
      referencePrimerPlan: isRecord((merged as Record<string, unknown>).referencePrimerPlan)
        ? (merged as Record<string, unknown>).referencePrimerPlan
        : baseData.referencePrimerPlan,
      generatedSegments: Array.isArray((merged as Record<string, unknown>).segments)
        ? (merged as Record<string, unknown>).segments
        : baseData.generatedSegments,
      segments: Array.isArray((merged as Record<string, unknown>).segments)
        ? (merged as Record<string, unknown>).segments
        : baseData.segments,
    };
    const videos = finalVideoHistory(finalVideoData);
    const completedData = {
      ...finalVideoData,
      videos,
    };
    updateCardById(session, targetCardId, { status: 'confirmed', data: completedData });
    persistFinalVideoSegmentsForCard(session, targetCardId, completedData);
    syncArtifact(session, 'final_video', completedData);
    session.status = 'completed';
    session.currentStep = 'completed';
    session.workflow.currentNode = 'completed';
    refreshTask(session, 'success', String((merged as Record<string, unknown>).videoUrl || ''));
    pushEvent(session, { type: 'workflow.done', finalVideoUrl: String((merged as Record<string, unknown>).videoUrl || '') });
    return persistSession(session);
  } catch (error) {
    const message = errorMessage(error);
    const userMessage = videoGenerationFailureMessage(error);
    logVideoRemakeGeneration('error', 'merge_video node failed', {
      sessionId: session.id,
      taskId: session.taskId,
      cardId: targetCardId,
      versionLabel: fieldText(baseData.versionLabel),
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    const failedData = {
      ...baseData,
      status: 'failed',
      message: '视频生成失败。',
      errorMessage: userMessage,
      segments,
    };
    updateCardById(session, targetCardId, { status: 'failed', data: failedData });
    syncArtifact(session, 'final_video', failedData);
    session.status = 'failed';
    session.currentStep = 'failed';
    session.workflow.currentNode = 'failed';
    refreshTask(session, 'failed');
    return persistSession(session);
  } finally {
    releaseGenerationActive();
  }
}

async function confirmFinalVideoCard(
  session: VideoRemakeSession,
  cardId: string,
  normalizedData: unknown,
  context: () => VideoRemakeNodeContext,
) {
  const previousCard = findCardById(session, cardId);
  const previousData = previousCard?.data;
  const previousHasVideo = isRecord(previousData) && (fieldText(previousData.videoUrl) || fieldText(previousData.status) === 'completed');
  const incomingData = isRecord(normalizedData) ? normalizedData : {};
  const clearedIncomingData = normalizeFinalVideoGenerationMode(clearFinalVideoRunState(incomingData));
  const baseData = previousHasVideo
    ? withFinalVideoVersion(session, clearedIncomingData, { forceNext: true })
    : withFinalVideoVersion(session, clearedIncomingData);
  const targetCard = previousHasVideo
    ? addCard(session, 'final_video', { status: 'editing', data: baseData })
    : previousCard;
  if (!targetCard) {
    throw new Error('卡片不存在');
  }
  const targetCardId = targetCard.cardId;
  const segments = Array.isArray(baseData.segments)
    ? baseData.segments
    : session.workflow.runtime.videoSegments || [];
  const generationMode = fieldText(baseData.generationMode);
  const displaySegments = finalVideoGeneratingSegmentsForMode(segments, generationMode);
  session.workflow.pendingInterrupt = undefined;
  session.status = 'generating';
  refreshTask(session, 'generating', null);
  logVideoRemakeGeneration('info', 'final video confirmation accepted', {
    sessionId: session.id,
    taskId: session.taskId,
    cardId: targetCardId,
    previousCardId: cardId,
    forkedFromCompletedCard: Boolean(previousHasVideo),
    versionLabel: fieldText(baseData.versionLabel),
    currentStep: session.currentStep,
    videoSegmentCount: session.workflow.runtime.videoSegments?.length || 0,
  });
  updateCardById(session, targetCardId, {
    status: 'pending',
    data: {
      ...baseData,
      status: 'generating',
      message: '视频生成中，请稍候。',
      errorMessage: undefined,
      segments: displaySegments,
    },
  });
  syncArtifact(session, 'final_video', {
    ...baseData,
    status: 'generating',
    message: '视频生成中，请稍候。',
    errorMessage: undefined,
    segments: displaySegments,
  });
  persistSession(session);
  logVideoRemakeGeneration('info', 'final video card marked generating and persisted', {
    sessionId: session.id,
    taskId: session.taskId,
    cardId: targetCardId,
    versionLabel: fieldText(baseData.versionLabel),
  });
  return runFinalVideoMerge(session, targetCardId, baseData, segments, context);
}

async function regenerateFinalVideoFromChat(session: VideoRemakeSession, instruction: string) {
  const card = lastCardOfType(session, 'final_video');
  if (!card) {
    addAssistantMessage(session, '当前还没有最终视频卡片。请先确认提示词卡片，生成最终视频后再重新生成。');
    return persistSession(session);
  }
  const emit = (event: VideoRemakeNodeEvent) => pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
  const context = () => ({ sessionId: session.id, userId: session.userId, taskId: session.taskId, workflow: session.workflow, emit });
  const data = isRecord(card.data)
    ? { ...card.data, regenerateInstruction: instruction, regeneratedAt: nowIso() }
    : dataForCard('final_video', { workflow: session.workflow });
  addAssistantMessage(session, '已收到重新生成视频的指令，正在重新提交最终视频生成。');
  return confirmFinalVideoCard(session, card.cardId, data, context);
}

async function executeConfirmedChatIntent(session: VideoRemakeSession, intent: Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>) {
  if (intent.intent === 'add_artifact_item') {
    const current = dataForCard(intent.target, { workflow: session.workflow });
    const draft = appendManualArtifactItem(intent.target, current);
    expireCardsOfTypes(session, [intent.target], 'superseded_by_add_item');
    const card = addCard(session, intent.target, {
      status: 'editing',
      data: {
        ...editingDataFromConfirmedData(draft),
        editingOriginalData: cloneJson(current),
      },
    });
    interruptForCard(session, card, 'manual_edit');
    addAssistantMessage(session, `已新建${cardTitles[intent.target]}草案，请在新卡片里补充后确认。`);
    return persistSession(session);
  }
  if (intent.intent === 'modify_artifact_with_llm') {
    const patched = applyRuleBasedArtifactPatch({
      cardType: intent.target,
      instruction: intent.instruction,
      current: dataForCard(intent.target, { workflow: session.workflow }),
    });
    const originalData = dataForCard(intent.target, { workflow: session.workflow });
    const card = ensureEditingCard(session, intent.target, {
      data: {
        ...editingDataFromConfirmedData(patched),
        editingOriginalData: cloneJson(originalData),
      },
    });
    interruptForCard(session, card, 'manual_edit');
    addAssistantMessage(session, `${cardTitles[intent.target]}已按你的指令生成修改草案，请确认。`);
    return persistSession(session);
  }
  if (intent.intent === 'regenerate_artifact') {
    if (intent.target === 'final_video') {
      return regenerateFinalVideoFromChat(session, intent.instruction);
    }
    const card = lastCardOfType(session, intent.target) || ensureEditingCard(session, intent.target);
    return videoRemakeService.regenerateCard(session.id, card.cardId, {
      userId: session.userId,
      cardType: intent.target,
      instruction: intent.instruction,
    });
  }
  const data = editableDataForChatTarget(session, intent.target);
  if (intent.target === 'seedance_prompt' && (!Array.isArray(data) || !data.length)) {
    addAssistantMessage(session, '当前还没有可调整的提示词卡片。请先确认分镜脚本，生成提示词后再调整。');
    return persistSession(session);
  }
  const card = openLatestCardForEditing(session, intent.target, { data });
  interruptForCard(session, card, 'manual_edit');
  addAssistantMessage(session, `已打开${cardTitles[intent.target]}编辑，请在上方卡片中调整后确认。`);
  return persistSession(session);
}

function createWorkflowEmit(session: VideoRemakeSession) {
  return (event: VideoRemakeNodeEvent) => {
    pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
    if (event.node === 'upload_to_vod' && isRecord(event.data)) {
      markUploadCardUploaded(session, event.data);
    }
    if (event.node === 'upload_to_vod' && isRecord(event.data) && !lastCardOfType(session, 'video_basic_info')) {
      const videoBasicInfo = buildVideoBasicInfo(event.data, session.workflow);
      syncArtifact(session, 'video_basic_info', videoBasicInfo);
      addCard(session, 'video_basic_info', { status: 'confirmed', data: videoBasicInfo });
      markUploadBasicInfoReady(session);
    }
    let progressCard = lastCardOfType(session, 'generation_progress');
    const progressData = isRecord(progressCard?.data) ? progressCard.data : {};
    if (progressCard && !progressData.retriedExpertKey && isRecord(event.data) && (event.data.completedExperts !== undefined || event.data.totalExperts !== undefined)) {
      updateCardById(session, progressCard.cardId, {
        status: 'pending',
        data: {
          ...progressData,
          step: event.node,
          status: 'running',
          message: event.message,
          percent: event.progress,
          completedExperts: event.data.completedExperts,
          totalExperts: event.data.totalExperts,
          estimatedAnalysisTime: event.data.estimatedAnalysisTime,
          executions: event.data.executions,
        },
      });
    }
    if ((!progressCard || progressData.retriedExpertKey) && isRecord(event.data) && (event.data.completedExperts !== undefined || event.data.totalExperts !== undefined)) {
      progressCard = addCard(session, 'generation_progress', {
        status: 'pending',
        data: {
          step: event.node,
          status: 'running',
          message: event.message,
          percent: event.progress,
          completedExperts: event.data.completedExperts,
          totalExperts: event.data.totalExperts,
          estimatedAnalysisTime: event.data.estimatedAnalysisTime,
          executions: event.data.executions,
        },
      });
    }
    if (isRecord(event.data) && (event.data.completedExperts !== undefined || event.data.totalExperts !== undefined)) {
      videoRemakeRepository.updateSession(session.id, {
        status: session.status,
        currentStep: session.currentStep,
        invalidArtifacts: session.invalidArtifacts,
        artifacts: session.artifacts,
        workflow: session.workflow,
      });
    }
  };
}

function createNodeContext(
  session: VideoRemakeSession,
  emit: (event: VideoRemakeNodeEvent) => void,
  forceRerunUnderstanding = false,
  rerunUnderstandingRoles?: string[],
  onUnderstandingComplete?: VideoRemakeNodeContext['onUnderstandingComplete'],
): VideoRemakeNodeContext {
  return {
    sessionId: session.id,
    userId: session.userId,
    taskId: session.taskId,
    workflow: session.workflow,
    forceRerunUnderstanding,
    rerunUnderstandingRoles,
    emit,
    onUnderstandingComplete,
  };
}

function finalizeAnalysis(session: VideoRemakeSession, input: {
  vod?: Record<string, unknown>;
  audio: Record<string, unknown>;
  visual: Record<string, unknown>;
  pip: Record<string, unknown>;
  normalized: Partial<Record<string, unknown>>;
  engine?: Record<string, unknown>;
}) {
  if (input.vod) {
    session.workflow.runtime.vod = input.vod;
    markUploadCardUploaded(session, input.vod);
  }
  session.workflow.runtime.analyses = {
    audio: input.audio,
    visual: input.visual,
    pip: input.pip,
  };
  session.workflow.runtime.langGraph = input.engine;
  clearCreditBlock(session);
  const normalized = input.normalized;
  Object.entries(normalized).forEach(([key, value]) => {
    session.workflow.artifacts = { ...session.workflow.artifacts, [key]: value };
  });
  completeUnderstandingStage(session, { audio: input.audio, visual: input.visual, pip: input.pip });
  confirmDirectorNormalizeCard(session, lastCardOfType(session, 'director_normalize'));
  const firstCard = ensureEditingCard(session, 'basic_info', { data: dataForCard('basic_info', { workflow: session.workflow }) });
  interruptForCard(session, firstCard);
  refreshTask(session, 'waiting_edit');
  return persistSession(session);
}

async function runAnalysisFromExistingVod(session: VideoRemakeSession, forceRerunUnderstanding = false) {
  session.status = 'running';
  const emit = createWorkflowEmit(session);
  const context = () => createNodeContext(session, emit, forceRerunUnderstanding);
  const audio = await runNode(session, 'analyze_audio', () => defaultVideoRemakeNodeAdapters.analyzeAudio(context()));
  const visual = await runNode(session, 'analyze_visual', () => defaultVideoRemakeNodeAdapters.analyzeVisual(context()));
  const pip = await runNode(session, 'analyze_pip', () => defaultVideoRemakeNodeAdapters.analyzePip(context()));
  completeUnderstandingStage(session, { audio, visual, pip });
  const normalized = await runNode(session, 'director_normalize', () => defaultVideoRemakeNodeAdapters.directorNormalize(context()));
  return finalizeAnalysis(session, { audio, visual, pip, normalized });
}

async function withSessionSyncLock(
  sessionId: string,
  runner: () => Promise<VideoRemakeSessionSnapshot>,
) {
  const inflight = videoRemakeSessionSyncInflight.get(sessionId);
  if (inflight) {
    return await inflight;
  }
  const promise = runner().finally(() => {
    if (videoRemakeSessionSyncInflight.get(sessionId) === promise) {
      videoRemakeSessionSyncInflight.delete(sessionId);
    }
  });

  videoRemakeSessionSyncInflight.set(sessionId, promise);
  return await promise;
}
async function runUrlCloneAnalysis(session: VideoRemakeSession) {
  session.status = 'running';
  const emit = createWorkflowEmit(session);
  const context = () => createNodeContext(session, emit);
  const url = session.workflow.source.sourceUrl.trim();
  if (!url) {
    throw new Error('缺少视频链接');
  }
  emit({ node: 'upload_to_vod', message: '正在根据链接反推视频提示词。', progress: 18 });
  const parseResult = await generateOneClickCloneParseResultWithLlm({
    userId: session.userId,
    url,
  });
  const analyses = urlCloneAnalysesFromParseResult(parseResult, url);
  session.workflow.runtime.vod = {
    sourceUrl: url,
    storage: 'llm-url-reverse-prompt',
    posterUrl: url,
  };
  session.workflow.runtime.analyses = analyses;
  session.workflow.runtime.viralUnderstanding = {
    outputs: buildOneClickCloneOutputs(parseResult).outputs,
    estimatedAnalysisTime: 'LLM 反推初稿已生成',
  };
  emit({
    node: 'analyze_pip',
    message: '链接反推初稿已生成，正在整理导演确认卡片。',
    progress: 56,
    data: {
      completedExperts: 3,
      totalExperts: 3,
      kind: 'url_parsing',
    },
  });
  const normalized = await runNode(session, 'director_normalize', () => defaultVideoRemakeNodeAdapters.directorNormalize(context()));
  return finalizeAnalysis(session, {
    vod: session.workflow.runtime.vod,
    audio: analyses.audio,
    visual: analyses.visual,
    pip: analyses.pip,
    normalized,
    engine: {
      name: 'llm-url-reverse-prompt',
      graph: 'url_llm_reverse_prompt',
      nodes: ['upload_to_vod', 'director_normalize'],
      topology: 'url -> llm_reverse_prompt -> director_normalize',
    },
  });
}

export const videoRemakeService = {
  listTasks(userId: string) {
    assertUserId(userId);
    return videoRemakeRepository.listTasks(userId);
  },

  getTask(id: string) {
    const task = videoRemakeRepository.findTask(id);
    if (!task) {
      throw new Error('视频复刻任务不存在');
    }
    return task;
  },

  createSession(input: { userId: string; filename?: string }) {
    assertUserId(input.userId);
    const workflow = defaultWorkflow({
      mode: 'video_remake_session',
      title: input.filename || '爆款复刻',
      sourceUrl: '',
      sourceKind: 'url',
    });
    const session = videoRemakeRepository.createSession({
      userId: input.userId,
      filename: input.filename,
      status: 'created',
      currentStep: 'upload_to_vod',
      workflow,
    });
    if (!session) {
      throw new Error('视频复刻会话创建失败');
    }
    return persistSession(session);
  },

  listSessions(userId: string) {
    assertUserId(userId);
    return videoRemakeRepository.listSessionSummaries(userId);
  },

  resumeIncompleteSessionsOnStartup() {
    const sessions = videoRemakeRepository.listResumableSessions();
    if (!sessions.length) {
      logger.info('no resumable video remake sessions on startup');
      return;
    }
    logger.info('resuming video remake sessions on startup', {
      count: sessions.length,
      sessionIds: sessions.map((item) => item.id),
    });
    const delayMs = startupResumeDelayMs();
    void (async () => {
      for (const [index, session] of sessions.entries()) {
        try {
          if (index > 0) {
            await waitMs(delayMs);
          }
          if (session.status === 'generating' && session.taskId) {
            await this.syncSessionByTaskId(session.taskId, { waitForCompletion: false });
          } else {
            await this.syncSession(session.id, {
              userId: session.userId,
              waitForCompletion: false,
            });
          }
        } catch (error) {
          logger.warn('video remake startup resume failed', {
            sessionId: session.id,
            taskId: session.taskId,
            error: errorMessage(error),
          });
        }
      }
    })();
  },

  startGenerationMonitorScheduler() {
    if (videoRemakeGenerationMonitorTimer) {
      return;
    }
    scanRunningVideoRemakeGenerations('scheduler-start');
    videoRemakeGenerationMonitorTimer = setInterval(() => {
      scanRunningVideoRemakeGenerations('scheduler');
    }, generationMonitorIntervalMs());
  },

  getSession(sessionId: string) {
    return snapshot(requireSession(sessionId));
  },

  async syncSession(sessionId: string, input: { userId: string; waitForCompletion?: boolean }) {
    return await withSessionSyncLock(sessionId, async () => {
      assertUserId(input.userId);
      const session = requireSession(sessionId);
      if (session.userId !== input.userId) {
        throw new Error('无权访问该会话');
      }
      clearObsoleteUnderstandingInterrupt(session);
      if (canAttemptFinalVideoSync(session)) {
        return await syncSessionVideoGenerationState(session, input.waitForCompletion !== false);
      }
      if (canResumeUnderstandingAnalysis(session)) {
        return await runAnalysisFromExistingVod(session);
      }
      return persistSession(session);
    });
  },

  async syncSessionByTaskId(taskId: string, options?: { waitForCompletion?: boolean }) {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      return null;
    }
    const session = videoRemakeRepository.findSessionByTaskId(normalizedTaskId);
    if (!session) {
      return null;
    }
    clearObsoleteUnderstandingInterrupt(session);
    if (canAttemptFinalVideoSync(session)) {
      return await syncSessionVideoGenerationState(session, options?.waitForCompletion !== false);
    }
    if (canResumeUnderstandingAnalysis(session)) {
      return await runAnalysisFromExistingVod(session);
    }
    return persistSession(session);
  },

  renameSession(sessionId: string, input: { userId: string; filename: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const filename = input.filename.trim();
    if (!filename) {
      throw new Error('会话名称不能为空');
    }
    const updated = videoRemakeRepository.updateSession(session.id, { filename });
    if (!updated) {
      throw new Error('会话名称更新失败');
    }
    publishVideoRemakeEvent(session.userId, {
      type: 'session.status',
      status: updated.status,
      currentStep: updated.currentStep,
      invalidArtifacts: updated.invalidArtifacts,
      sessionId: updated.id,
      taskId: updated.taskId,
    });
    return snapshot(updated);
  },

  deleteSession(sessionId: string, input: { userId: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    if (!videoRemakeRepository.deleteSession(session.id)) {
      throw new Error('会话删除失败');
    }
    publishVideoRemakeEvent(session.userId, {
      type: 'session.status',
      status: 'cancelled',
      currentStep: 'cancelled',
      invalidArtifacts: [],
      sessionId: session.id,
      taskId: session.taskId,
    });
    return { ok: true };
  },

  async parseUrl(input: { userId: string; url: string }) {
    assertUserId(input.userId);
    if (!/^https?:\/\//i.test(input.url)) {
      throw new Error('请输入有效的视频链接');
    }
    const title = '爆款复刻链接解析';
    const workflow = defaultWorkflow({
      mode: 'video_remake_url_parse',
      title,
      sourceUrl: input.url,
      sourceKind: 'url',
    });
    const task = videoRemakeRepository.createTask({
      userId: input.userId,
      sourceUrl: input.url,
      title,
      prompt: `请解析这个爆款视频链接：\n${input.url}`,
      expertContext: taskContext({ mode: 'video_remake_url_parse', workflow }),
    });
    if (!task) {
      throw new Error('视频复刻任务创建失败');
    }
    return videoRemakeRepository.updateTask(task.id, { status: 'parsing' }) || task;
  },

  async parseSessionUrl(sessionId: string, input: { userId: string; url: string }) {
    assertUserId(input.userId);
    if (!/^https?:\/\//i.test(input.url)) {
      throw new Error('请输入有效的视频链接');
    }
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const title = '爆款复刻链接解析';
    session.workflow = defaultWorkflow({
      mode: 'video_remake_url_parse',
      title,
      sourceUrl: input.url,
      sourceKind: 'url',
    });
    session.workflow.runtime.vod = {
      vid: `remake-vid-${session.id.slice(0, 8)}`,
      sourceUrl: input.url,
      storage: 'remote-url-adapter',
      posterUrl: input.url,
    };
    const task = videoRemakeRepository.createTask({
      userId: input.userId,
      sourceUrl: input.url,
      title,
      prompt: `请解析这个爆款视频链接：\n${input.url}`,
      expertContext: taskContext({ mode: 'video_remake_url_parse', workflow: session.workflow }),
    });
    if (!task) {
      throw new Error('视频复刻任务创建失败');
    }
    session.taskId = task.id;
    session.filename = title;
    session.status = 'running';
    addAssistantMessage(session, '视频链接已接收，正在准备解析。');
    addCard(session, 'generation_progress', {
      status: 'pending',
      data: {
        kind: 'url_parsing',
        step: 'upload_to_vod',
        status: 'running',
        percent: 12,
        sourceUrl: input.url,
        title,
        message: '视频链接已接收，正在准备解析。',
      },
    });
    return persistSession(session);
  },

  async upload(sessionId: string, payload: UploadVideoRemakePayload) {
    assertUserId(payload.userId);
    await stat(payload.filePath);
    const session = requireSession(sessionId);
    if (session.userId !== payload.userId) {
      throw new Error('无权访问该会话');
    }
    const title = payload.originalFileName || '上传视频复刻';
    session.workflow = defaultWorkflow({
      mode: 'video_remake_upload_parse',
      title,
      sourceUrl: payload.fileUrl,
      sourceKind: 'upload',
      file: payload,
    });
    session.workflow.runtime.vod = {
      vid: `remake-vid-${session.id.slice(0, 8)}`,
      sourceUrl: payload.fileUrl,
      fileName: payload.originalFileName,
      storage: 'local-upload-adapter',
      posterUrl: payload.fileUrl,
    };
    const task = videoRemakeRepository.createTask({
      userId: payload.userId,
      sourceUrl: payload.fileUrl,
      title,
      prompt: `请解析这个上传爆款视频：${title}`,
      expertContext: taskContext({ mode: 'video_remake_upload_parse', workflow: session.workflow }),
    });
    if (!task) {
      throw new Error('视频复刻任务创建失败');
    }
    session.taskId = task.id;
    session.filename = title;
    session.status = 'running';
    addMessage(session, 'user', '请解析这个爆款视频：', {
      type: 'video',
      url: payload.fileUrl,
      title,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
    });
    addCard(session, 'uploading', { status: 'pending', data: { title, fileUrl: payload.fileUrl, mimeType: payload.mimeType, fileSize: payload.fileSize, status: 'uploading', message: '视频正在上传中...' } });
    return persistSession(session);
  },

  uploadPipAsset(sessionId: string, payload: UploadVideoRemakePipAssetPayload) {
    assertUserId(payload.userId);
    const session = requireSession(sessionId);
    if (session.userId !== payload.userId) {
      throw new Error('无权访问该会话');
    }
    if (!payload.mimeType.startsWith('image/')) {
      throw new Error('画中画素材只能上传图片');
    }
    return {
      originalFileName: payload.originalFileName,
      storedFileName: payload.storedFileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      fileUrl: payload.fileUrl,
    };
  },

  async run(sessionId: string) {
    const session = requireSession(sessionId);
    requireTask(session);
    assertVideoRemakeSessionCapacity(session.userId, session.id);
    session.status = 'running';
    clearCreditBlock(session);
    try {
      if (session.workflow.source.kind === 'url') {
        return await runUrlCloneAnalysis(session);
      }
      const emit = createWorkflowEmit(session);
      session.workflow.runtime.viralUnderstanding = undefined;
      let understandingStageCompleted = false;
      const context = () => createNodeContext(session, emit, false, undefined, ({ vod, audio, visual, pip }) => {
        if (understandingStageCompleted) {
          return;
        }
        understandingStageCompleted = true;
        session.workflow.runtime.vod = vod;
        markUploadCardUploaded(session, vod);
        completeUnderstandingStage(session, { audio, visual, pip });
      });
      const graphResult = await runNode(session, 'director_normalize', () => runVideoRemakeAnalysisGraph(context(), defaultVideoRemakeNodeAdapters));
      if (!understandingStageCompleted) {
        completeUnderstandingStage(session, {
          audio: graphResult.audio,
          visual: graphResult.visual,
          pip: graphResult.pip,
        });
      }
      return finalizeAnalysis(session, {
        vod: graphResult.vod,
        audio: graphResult.audio,
        visual: graphResult.visual,
        pip: graphResult.pip,
        normalized: graphResult.normalized,
        engine: graphResult.engine,
      });
    } catch (error) {
      if (isInsufficientStepCreditsError(error)) {
        return markSessionWaitingForCredit(session, error);
      }
      const failureReason = error instanceof Error ? error.message : '视频复刻流程执行失败';
      logger.error('video remake run failed', {
        sessionId: session.id,
        taskId: session.taskId,
        currentStep: session.currentStep,
        failureReason,
      });
      return failSession(session, failureReason);
    }
  },

  async resume(sessionId: string) {
    const session = requireSession(sessionId);
    const pending = session.workflow.pendingInterrupt;
    if (pending) {
      addAssistantMessage(session, '当前有待确认卡片，请确认或重新编辑后继续。');
      return persistSession(session);
    }
    if (session.status === 'created') {
      return this.run(sessionId);
    }
    if (session.status === 'waiting_credit') {
      assertVideoRemakeSessionCapacity(session.userId, session.id);
      const blockedStep = fieldText(session.workflow.runtime.creditBlock?.step);
      if (blockedStep === 'analyze_audio' && fieldText(session.workflow.runtime.vod?.vid)) {
        try {
          return await runAnalysisFromExistingVod(session);
        } catch (error) {
          if (isInsufficientStepCreditsError(error)) {
            return markSessionWaitingForCredit(session, error);
          }
          throw error;
        }
      }
      return this.run(sessionId);
    }
    if (canAttemptFinalVideoSync(session)) {
      return await syncSessionVideoGenerationState(session, false);
    }
    return persistSession(session);
  },

  listEvents(sessionId: string, input: { userId: string; afterIndex?: number }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const start = Number.isFinite(input.afterIndex) ? Math.max(0, Number(input.afterIndex) + 1) : 0;
    return {
      events: session.events.slice(start).map((event, index) => ({ index: start + index, ...event })),
      nextIndex: session.events.length - 1,
    };
  },

  async sendChat(sessionId: string, input: { userId: string; message: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const content = input.message.trim();
    if (!content) {
      throw new Error('消息不能为空');
    }
    addMessage(session, 'user', content);
    const intent = routeIntent(content);
    if (intent.intent === 'unknown') {
      const partialIntent = inferPartialIntent(content);
      if (partialIntent && 'target' in partialIntent) {
        const confirmedIntent = partialIntent as Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>;
        addIntentConfirmationCard(session, confirmedIntent);
        return { session: persistSession(session), intent: confirmedIntent };
      }
      const thinkingCard = addCard(session, 'llm_thinking', {
        status: 'pending',
        data: {
          status: 'thinking',
          message: '大模型正在理解你的需求，请稍候。',
          instruction: content,
          createdAt: nowIso(),
        },
      });
      persistSession(session);
      await askLlmForUnknownChat(session, content, thinkingCard.cardId);
      return { session: persistSession(session), intent };
    }
    if (intent.intent === 'continue_workflow') {
      addAssistantMessage(session, '请先确认当前编辑中的卡片，确认后我会继续推进下一步。');
      return { session: persistSession(session), intent };
    }
    if (!intent.target) {
      return { session: persistSession(session), intent };
    }
    if (shouldConfirmChatIntent(session, intent)) {
      addIntentConfirmationCard(session, intent);
      return { session: persistSession(session), intent };
    }
    const nextSession = await executeConfirmedChatIntent(session, intent);
    return { session: nextSession, intent };
  },

  async confirmCard(sessionId: string, cardId: string, input: { userId: string; cardType: VideoRemakeCardType; data: unknown; mode?: 'confirm' | 'save_only' }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const previousCard = findCardById(session, cardId);
    const previousStatus = previousCard?.status;
    const previousData = previousCard?.data;
    if (input.cardType === 'llm_thinking') {
      if (!previousCard || previousCard.cardType !== 'llm_thinking') {
        throw new Error('意图确认卡片不存在');
      }
      const data = isRecord(previousCard.data) ? previousCard.data : {};
      if (fieldText(data.kind) !== 'intent_confirmation') {
        updateCardById(session, cardId, { status: 'confirmed', data: { ...data, status: 'completed', confirmedAt: nowIso() } });
        return persistSession(session);
      }
      const target = fieldText(data.targetCardType) as VideoRemakeCardType;
      const intentName = fieldText(data.intent) as VideoRemakeChatIntent['intent'];
      const instruction = fieldText(data.instruction);
      if (!target || !cardTitles[target] || !['open_edit_card', 'add_artifact_item', 'modify_artifact_with_llm', 'regenerate_artifact'].includes(intentName)) {
        updateCardById(session, cardId, {
          status: 'failed',
          data: { ...data, status: 'failed', message: '无法确认这条操作，请重新描述你的需求。', confirmedAt: nowIso() },
        });
        return persistSession(session);
      }
      updateCardById(session, cardId, {
        status: 'confirmed',
        data: { ...data, status: 'confirmed', message: '已确认，正在为你处理。', confirmedAt: nowIso() },
      });
      return executeConfirmedChatIntent(session, {
        intent: intentName as Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>['intent'],
        target,
        instruction,
      } as Extract<VideoRemakeChatIntent, { target: VideoRemakeCardType }>);
    }
    const previousConfirmedData = previousCard ? originalDataForEditingComparison(input.cardType, previousCard.data) : undefined;
    const rawNormalizedData = normalizeCardDataForStorage(input.cardType, input.data);
    const normalizedData = input.cardType === 'seedance_prompt'
      ? withSeedancePromptVersion(session, rawNormalizedData)
      : rawNormalizedData;
    if (input.cardType === 'pip_setting') {
      assertPipSettingData(session, normalizedData);
    }
    const changedFromPrevious = !isSameJsonValue(previousConfirmedData, normalizedData);
    const emit = (event: VideoRemakeNodeEvent) => pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
    const context = () => ({ sessionId: session.id, userId: session.userId, taskId: session.taskId, workflow: session.workflow, emit });
    if (input.cardType === 'final_video') {
      return confirmFinalVideoCard(session, cardId, normalizedData, context);
    }
    try {
      updateCardById(session, cardId, { status: 'confirmed', data: normalizedData });
      syncArtifact(session, input.cardType, normalizedData);
      if (input.mode === 'save_only') {
        if (changedFromPrevious) {
          markDeferredInvalidation(session, input.cardType);
        }
        session.workflow.pendingInterrupt = undefined;
        session.status = 'waiting_edit';
        return persistSession(session);
      }
      if (changedFromPrevious) {
        const invalidationSources = Array.from(new Set([...consumeDeferredInvalidationCardTypes(session), input.cardType]));
        invalidationSources.forEach((cardType) => {
          invalidateDependents(session, cardType);
          expireDependentDraftCards(session, cardType, 'upstream_manual_edit');
        });
      } else {
        consumeDeferredInvalidationCardTypes(session).forEach((cardType) => {
          invalidateDependents(session, cardType);
          expireDependentDraftCards(session, cardType, 'upstream_manual_edit');
        });
      }
      session.workflow.pendingInterrupt = undefined;

      if (input.cardType === 'script_content') {
        await continueAfterConfirmation(session, input.cardType, context);
        return persistSession(session);
      }
      if (input.cardType === 'storyboard_script') {
        await continueAfterConfirmation(session, input.cardType, context);
        return persistSession(session);
      }
      if (input.cardType === 'seedance_prompt') {
        await continueAfterConfirmation(session, input.cardType, context);
        return persistSession(session);
      }
    } catch (error) {
      updateCardById(session, cardId, {
        status: previousStatus === 'confirmed' ? 'confirmed' : 'editing',
        data: previousData === undefined ? input.data : previousData,
      });
      persistSession(session);
      throw error;
    }

    await continueAfterConfirmation(session, input.cardType, context);
    return persistSession(session);
  },

  editCard(sessionId: string, cardId: string, input: { userId: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const card = findCardById(session, cardId);
    if (!card) {
      throw new Error('卡片不存在');
    }
    if (card.status === 'expired' || card.status === 'failed') {
      throw new Error('当前卡片不可编辑');
    }
    if (card.cardType === 'storyboard_script' && hasCompletedFinalVideoAfterCard(session, card.cardId)) {
      const draftData = editingDataFromConfirmedData(dataForCard('storyboard_script', { workflow: session.workflow }));
      expireCard(session, card, 'superseded_by_storyboard_edit_after_final_video');
      const nextCard = addCard(session, 'storyboard_script', { status: 'editing', data: draftData });
      interruptForCard(session, nextCard, 'manual_edit');
      return persistSession(session);
    }
    let editData: unknown = editingDataForCard(card);
    if (card.cardType === 'seedance_prompt') {
      const seedancePromptData = latestEditableSeedancePromptData(session, card.cardId);
      if (!seedancePromptData.length) {
        throw new Error('当前还没有可编辑的提示词数据，请先重新生成提示词。');
      }
      editData = editingDataFromConfirmedData(seedancePromptData);
    }
    updateCardById(session, cardId, {
      status: 'editing',
      data: editData,
    });
    interruptForCard(session, findCardById(session, cardId) || card, 'manual_edit');
    return persistSession(session);
  },

  cancelCard(sessionId: string, cardId: string, input: { userId: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const card = findCardById(session, cardId);
    if (!card) {
      throw new Error('卡片不存在');
    }
    if (card.cardType === 'llm_thinking') {
      updateCardById(session, cardId, {
        status: 'confirmed',
        data: {
          ...(isRecord(card.data) ? card.data : {}),
          status: 'cancelled',
          message: '已取消本次操作。',
          cancelledAt: nowIso(),
        },
      });
      return persistSession(session);
    }
    const cardData = isRecord(card.data) ? card.data : {};
    if (card.status === 'editing' && (cardData.editingFromConfirmed || card.cardType === 'seedance_prompt')) {
      updateCardById(session, cardId, {
        status: 'confirmed',
        data: originalDataForEditingComparison(card.cardType, card.data),
      });
    }
    session.workflow.pendingInterrupt = undefined;
    return persistSession(session);
  },

  async regenerateCard(sessionId: string, cardId: string, input: { userId: string; cardType: VideoRemakeCardType; instruction?: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const emit = (event: VideoRemakeNodeEvent) => pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
    const context = () => ({ sessionId: session.id, userId: session.userId, taskId: session.taskId, workflow: session.workflow, emit });
    let data = dataForCard(input.cardType, { workflow: session.workflow });
    if (input.cardType === 'final_video') {
      const card = findCardById(session, cardId);
      if (!card || card.cardType !== 'final_video') {
        throw new Error('最终视频卡片不存在');
      }
      const nextData = isRecord(card.data)
        ? { ...clearFinalVideoRunState(card.data), regenerateInstruction: input.instruction || '', regeneratedAt: nowIso() }
        : dataForCard('final_video', { workflow: session.workflow });
      return confirmFinalVideoCard(session, card.cardId, nextData, context);
    }
    if (input.cardType === 'storyboard_script') {
      const sourceCard = findCardById(session, cardId);
      const shouldForkStoryboardCard = Boolean(sourceCard && hasCompletedFinalVideoAfterCard(session, cardId));
      if (sourceCard && shouldForkStoryboardCard) {
        expireCard(session, sourceCard, 'superseded_by_storyboard_regenerate_after_final_video');
      }
      const targetCard = shouldForkStoryboardCard
        ? addCard(session, 'storyboard_script', { status: 'pending', data: {} })
        : sourceCard;
      if (!targetCard) {
        throw new Error('分镜脚本卡片不存在');
      }
      updateCardById(session, targetCard.cardId, {
        status: 'pending',
        data: {
          status: 'regenerating',
          message: '分镜脚本重新解析中，请稍候。',
          regeneratedAt: nowIso(),
        },
      });
      persistSession(session);
      try {
        data = await runNode(session, 'generate_storyboard', () => defaultVideoRemakeNodeAdapters.generateStoryboard(context()));
      } catch (error) {
        markStoryboardCardFailed(session, targetCard.cardId, error, data);
        return persistSession(session);
      }
      syncArtifact(session, input.cardType, data);
      updateCardById(session, targetCard.cardId, { status: 'confirmed', data });
      invalidateDependents(session, input.cardType);
      expireDependentDraftCards(session, input.cardType, 'storyboard_regenerated');
      session.workflow.pendingInterrupt = undefined;
      session.status = 'waiting_edit';
      await continueAfterConfirmation(session, input.cardType, context);
      return persistSession(session);
    } else if (input.cardType === 'seedance_prompt') {
      data = withSeedancePromptVersion(
        session,
        await runNode(session, 'generate_seedance_prompts', () => defaultVideoRemakeNodeAdapters.generateSeedancePrompts(context())),
        { forceNext: true },
      );
    } else if (isRecord(data)) {
      data = { ...data, regenerateInstruction: input.instruction || '', regeneratedAt: nowIso() };
    }
    syncArtifact(session, input.cardType, data);
    updateCardById(session, cardId, { status: 'editing', data });
    const card = session.messages.find((message): message is VideoRemakeCardMessage => message.type === 'card' && message.cardId === cardId);
    if (card) {
      interruptForCard(session, card, 'regenerate');
    }
    return persistSession(session);
  },

  async regenerateFinalVideoSegment(sessionId: string, cardId: string, input: { userId: string; segmentIndex: number; prompt?: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const card = findCardById(session, cardId);
    if (!card || card.cardType !== 'final_video') {
      throw new Error('最终视频卡片不存在');
    }
    const currentData = isRecord(card.data) ? card.data : {};
    const currentStatus = fieldText(currentData.status);
    const shouldUseStoredSnapshot = fieldText(currentData.regenerationMode) === 'segment'
      && (card.status === 'pending' || card.status === 'failed' || currentStatus === 'generating' || currentStatus === 'failed');
    const rawSourceData = shouldUseStoredSnapshot && isRecord(currentData.sourceSnapshot) ? currentData.sourceSnapshot : currentData;
    const sourceData = withPersistedFinalVideoSegments(session, cardId, rawSourceData);
    const segmentIndex = Math.max(1, Number(input.segmentIndex || 0));
    const plannedSegments = Array.isArray(sourceData.segments) ? sourceData.segments.filter(isRecord) : [];
    const generatedSegments = Array.isArray(sourceData.generatedSegments) ? sourceData.generatedSegments.filter(isRecord) : [];
    const sourceSegments = plannedSegments.length ? plannedSegments : generatedSegments;
    if (!sourceSegments[segmentIndex - 1]) {
      throw new Error(`分段 ${segmentIndex} 不存在`);
    }
    const pendingData = finalVideoSegmentRegenerationDraft(sourceData, {
      segmentIndex,
      sourceCardId: cardId,
    });
    const targetCard = addCard(session, 'final_video', {
      status: 'pending',
      data: pendingData,
    });
    const targetCardId = targetCard.cardId;
    session.workflow.pendingInterrupt = undefined;
    session.status = 'generating';
    session.currentStep = 'merge_video';
    session.workflow.currentNode = 'merge_video';
    refreshTask(session, 'generating', null);
    syncArtifact(session, 'final_video', pendingData);
    persistSession(session);
    const emit = (event: VideoRemakeNodeEvent) => pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
    const context = () => ({ sessionId: session.id, userId: session.userId, taskId: session.taskId, workflow: session.workflow, emit });
    const releaseGenerationActive = markVideoRemakeGenerationActive(session.taskId);
    try {
      const regenerated = await defaultVideoRemakeNodeAdapters.regenerateVideoSegment(context(), {
        cardData: sourceData,
        segmentIndex,
        prompt: input.prompt,
      });
      const videos = finalVideoHistoryWithResult(pendingData, regenerated);
      const nextData = {
        ...pendingData,
        ...regenerated,
        status: 'completed',
        message: '分段已重新生成，并已重新合成最终视频。',
        referencePrimerPlan: isRecord(regenerated.referencePrimerPlan)
          ? regenerated.referencePrimerPlan
          : pendingData.referencePrimerPlan,
        generatedSegments: Array.isArray(regenerated.generatedSegments) ? regenerated.generatedSegments : pendingData.generatedSegments,
        segments: Array.isArray(regenerated.segments) ? regenerated.segments : pendingData.segments,
        videos,
      };
      updateCardById(session, targetCardId, { status: 'confirmed', data: nextData });
      persistFinalVideoSegmentsForCard(session, targetCardId, nextData);
      syncArtifact(session, 'final_video', nextData);
      session.status = 'completed';
      session.currentStep = 'completed';
      session.workflow.currentNode = 'completed';
      refreshTask(session, 'success', fieldText(regenerated.videoUrl) || fieldText(sourceData.videoUrl));
      return persistSession(session);
    } catch (error) {
      const message = errorMessage(error);
      const userMessage = videoGenerationFailureMessage(error);
      const markFailedSegment = (items: unknown) => Array.isArray(items)
        ? items.filter(isRecord).map((segment, index) => ({
          ...segment,
          status: index === segmentIndex - 1 ? 'failed' : 'completed',
          message: index === segmentIndex - 1 ? `分段 ${segmentIndex} 重新生成失败。` : '复用当前版本原分段。',
        }))
        : items;
      const failedData = {
        ...pendingData,
        status: 'failed',
        message: `分段 ${segmentIndex} 重新生成失败。`,
        errorMessage: userMessage,
        segments: markFailedSegment(pendingData.segments),
        generatedSegments: markFailedSegment(pendingData.generatedSegments),
      };
      updateCardById(session, targetCardId, { status: 'failed', data: failedData });
      syncArtifact(session, 'final_video', failedData);
      session.status = 'failed';
      session.currentStep = 'failed';
      session.workflow.currentNode = 'failed';
      refreshTask(session, 'failed');
      return persistSession(session);
    } finally {
      releaseGenerationActive();
    }
  },

  async retryExpert(sessionId: string, cardId: string, input: { userId: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    const card = session.messages.find((message): message is VideoRemakeCardMessage => (
      message.type === 'card' && message.cardId === cardId
    ));
    if (!card || card.cardType !== 'expert_analysis') {
      throw new Error('只能重试专家解析卡片');
    }
    const expertKey = fieldText(isRecord(card.data) ? card.data.expertKey : '');
    const runtimeKey = expertRuntimeKey(expertKey);
    if (!runtimeKey) {
      throw new Error('无法识别要重试的专家');
    }
    const rerunUnderstandingRole = understandingRoleForRuntimeKey(runtimeKey);
    if (!rerunUnderstandingRole) {
      throw new Error('无法识别要重试的视频理解角色');
    }
    const retriedAt = nowIso();
    const roleName = fieldText(isRecord(card.data) ? card.data.roleName : '') || card.title;
    const invalidatedCardTypes = expertRetryInvalidation(runtimeKey);
    session.status = 'running';
    session.workflow.pendingInterrupt = undefined;
    refreshTask(session, 'parsing');
    updateCardById(session, cardId, {
      status: 'expired',
      data: { ...isRecord(card.data) ? card.data : {}, retrying: true, retriedAt },
    });
    invalidateCards(session, invalidatedCardTypes);
    expireCardsOfTypes(session, invalidatedCardTypes);
    addAssistantMessage(session, `已重新提交${roleName}，正在重新解析该专家。`);
    const progressCard = addCard(session, 'generation_progress', {
      status: 'pending',
      data: {
        step: 'analyze_audio',
        status: 'running',
        message: `${roleName}重新解析已开始。`,
        percent: 24,
        completedExperts: 0,
        totalExperts: 1,
        retriedExpertKey: expertKey,
        retriedExpertName: roleName,
        retriedFromCardId: cardId,
        retriedAt,
      },
    });
    const currentUnderstanding = session.workflow.runtime.viralUnderstanding;
    if (currentUnderstanding) {
      const retainedOutputs = isRecord(currentUnderstanding.outputs) ? { ...currentUnderstanding.outputs } : {};
      delete retainedOutputs[rerunUnderstandingRole];
      const retainedExecutions = Array.isArray(currentUnderstanding.executions)
        ? currentUnderstanding.executions.filter((execution) => (
          !isRecord(execution) || fieldText(execution.role) !== rerunUnderstandingRole
        ))
        : [];
      session.workflow.runtime.viralUnderstanding = {
        ...currentUnderstanding,
        executions: retainedExecutions,
        outputs: retainedOutputs,
      };
    }
    session.workflow.runtime.analyses = {
      ...(session.workflow.runtime.analyses || {}),
      [runtimeKey]: undefined,
    };
    const currentExpertAnalysisBeforeRetry = isRecord(session.workflow.artifacts.expertAnalysis)
      ? session.workflow.artifacts.expertAnalysis
      : {};
    session.workflow.artifacts = {
      ...session.workflow.artifacts,
      expertAnalysis: {
        ...currentExpertAnalysisBeforeRetry,
        [runtimeKey]: undefined,
      },
    };
    const emit = (event: VideoRemakeNodeEvent) => {
      pushEvent(session, { type: 'workflow.progress', step: event.node, label: event.message, percent: event.progress });
      if (hasUnderstandingProgress(event.data)) {
        const currentProgressCard = findCardById(session, progressCard.cardId);
        const progressData = isRecord(currentProgressCard?.data) ? currentProgressCard.data : {};
        updateCardById(session, progressCard.cardId, {
          status: 'pending',
          data: {
            ...progressData,
            step: event.node,
            status: 'running',
            message: event.message,
            percent: event.progress,
            completedExperts: 0,
            totalExperts: 1,
            retriedExpertKey: expertKey,
            retriedExpertName: roleName,
            retriedFromCardId: cardId,
            retriedAt,
          },
        });
        videoRemakeRepository.updateSession(session.id, {
          status: session.status,
          currentStep: session.currentStep,
          invalidArtifacts: session.invalidArtifacts,
          artifacts: session.artifacts,
          workflow: session.workflow,
        });
      }
    };
    const context = () => ({
      sessionId: session.id,
      userId: session.userId,
      taskId: session.taskId,
      workflow: session.workflow,
      forceRerunUnderstanding: true,
      rerunUnderstandingRoles: [rerunUnderstandingRole],
      emit,
    });
    let nextData: Record<string, unknown>;
    try {
      clearCreditBlock(session);
      if (runtimeKey === 'audio') {
        nextData = await runNode(session, 'analyze_audio', () => defaultVideoRemakeNodeAdapters.analyzeAudio(context()));
      } else if (runtimeKey === 'visual') {
        nextData = await runNode(session, 'analyze_visual', () => defaultVideoRemakeNodeAdapters.analyzeVisual(context()));
      } else {
        nextData = await runNode(session, 'analyze_pip', () => defaultVideoRemakeNodeAdapters.analyzePip(context()));
      }
    } catch (error) {
      if (isInsufficientStepCreditsError(error)) {
        return markSessionWaitingForCredit(session, error);
      }
      throw error;
    }
    session.workflow.runtime.analyses = {
      ...(session.workflow.runtime.analyses || {}),
      [runtimeKey]: nextData,
    };
    const currentExpertAnalysis = isRecord(session.workflow.artifacts.expertAnalysis)
      ? session.workflow.artifacts.expertAnalysis
      : {};
    syncArtifact(session, 'expert_analysis', {
      ...currentExpertAnalysis,
      [runtimeKey]: nextData,
    });
    session.workflow.runtime.videoSegments = undefined;
    session.workflow.runtime.mergedVideo = undefined;
    session.workflow.artifacts = {
      ...session.workflow.artifacts,
      storyboardScript: undefined,
      seedancePrompts: undefined,
      finalVideo: undefined,
    };
    session.artifacts = {
      ...session.artifacts,
      storyboard_script: undefined,
      seedance_prompt: undefined,
      final_video: undefined,
    };
    const currentProgressCard = findCardById(session, progressCard.cardId);
    const progressData = isRecord(currentProgressCard?.data) ? currentProgressCard.data : {};
    updateCardById(session, progressCard.cardId, {
      status: 'confirmed',
      data: {
        ...progressData,
        step: session.currentStep,
        status: 'completed',
        message: `${roleName}重新解析完成。`,
        percent: 100,
        completedExperts: 1,
        totalExperts: 1,
        executions: completedUnderstandingExecutions(progressData.executions, 1),
        retriedExpertKey: expertKey,
        retriedExpertName: roleName,
        retriedFromCardId: cardId,
        retriedAt,
      },
    });
    addCard(session, 'expert_analysis', {
      status: 'confirmed',
      data: {
        ...nextData,
        expertKey,
        roleName,
        retriedAt,
        retriedFromCardId: cardId,
      },
    });
    const directorCard = ensureDirectorNormalizePendingCard(session, 'expert_retry');
    const normalized = await runNode(session, 'director_normalize', () => defaultVideoRemakeNodeAdapters.directorNormalize(context()));
    Object.entries(normalized).forEach(([key, value]) => {
      session.workflow.artifacts = { ...session.workflow.artifacts, [key]: value };
    });
    syncArtifact(session, 'expert_analysis', session.workflow.artifacts.expertAnalysis || {});
    confirmDirectorNormalizeCard(session, directorCard, 'expert_retry');
    const firstCard = ensureEditingCard(session, 'basic_info', { data: dataForCard('basic_info', { workflow: session.workflow }) });
    session.status = 'waiting_edit';
    interruptForCard(session, firstCard, 'regenerate');
    refreshTask(session, 'waiting_edit');
    return persistSession(session);
  },

  cancelSession(sessionId: string, input: { userId: string }) {
    assertUserId(input.userId);
    const session = requireSession(sessionId);
    if (session.userId !== input.userId) {
      throw new Error('无权访问该会话');
    }
    session.status = 'cancelled';
    session.currentStep = 'cancelled';
    session.workflow.currentNode = 'cancelled';
    session.workflow.pendingInterrupt = undefined;
    session.cancelledAt = nowIso();
    pushEvent(session, { type: 'session.status', status: 'cancelled', currentStep: 'cancelled', invalidArtifacts: session.invalidArtifacts });
    refreshTask(session, 'cancelled');
    return persistSession(session);
  },
};

export function createVideoRemakeService() {
  return videoRemakeService;
}
