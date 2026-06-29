import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { jsonrepair } from 'jsonrepair';
import { logger } from '../../shared/logger.js';
import {
  getViralUnderstandingAgentsWithWorker,
  getViralUnderstandingExecutionWithWorker,
  findUnderstandingTokenFieldSummary,
  formatSeedanceReferenceLabels,
  hasCompletedUnderstandingOutput,
  normalizeDirectorCharacterItems,
  normalizeDirectorSceneItems,
  normalizeUnderstandingTokenUsage,
  isUnderstandingCompleted,
  isUnderstandingFailed,
  seedanceAssetReferenceLabels,
  startViralUnderstandingWithWorker,
  uploadLocalVideoToVodWithWorker,
  uniqueReferenceLabels,
  viralUnderstandingSdkAgentList,
  vodSpaceNameFromUploadResult,
  type ViralUnderstandingOutput,
  type VodUnderstandingExecution,
} from '../content/internals/content-viral-director.js';
import { callConfiguredLlm } from '../content/configured-llm.client.js';
import {
  assertSufficientStepCredits,
  estimateVodUploadCredits,
  recordVodUnderstandingUsage,
} from '../billing/billing.service.js';
import { inspectVideoUrlWithWorker, type InspectedVideoMaterial } from '../content/internals/content-viral-analysis.js';
import { contentRepository } from '../content/content.repository.js';
import { contentFilesDir, execFileAsync } from '../content/internals/content-common.js';
import { absolutizeMaterialUrl } from '../content/internals/content-voice-clone.js';
import {
  buildSegmentedSeedancePrompt,
  callConfiguredVideoModel,
  callSegmentedSeedanceVideoGeneration,
  downloadGeneratedVideoSegment,
  estimatedChineseSpeechSeconds,
  formatDurationLabel,
  mergeGeneratedVideoSegments,
  noOnScreenTextNegativePromptsForExport,
  persistSegmentedVideoGenerationState,
  publicMaterialUrl,
  recordVideoGenerationUsageIfNeeded,
  resolveDefaultVideoModel,
  seedanceGenerationDurationLimit,
  segmentTimeRangeLabel,
  type SegmentedVideoGenerationState,
  waitForVideoModelCompletion,
  userFacingVideoGenerationError,
} from '../content/internals/content-video-generation.js';
import { resolveVideoMaterialContext } from '../content/internals/content-video-task-runtime.js';
import { createTraceId, logToFile } from '../../shared/logger.js';
import { callSceneAwareSegmentedSeedanceVideoGeneration } from './video-remake.segmented-runtime.js';
import {
  buildVideoRemakeSeedanceAudioBindingLines,
  videoRemakeDefaultNegativePrompt,
  videoRemakeDirectorNormalizeSystemPrompt,
  videoRemakeStoryboardSpeakerLimitSystemPrompt,
  videoRemakeStoryboardSpeakerLimitUserPrompt,
  videoRemakeStoryboardSystemPrompt,
} from './video-remake.prompts.js';
import type { VideoRemakeWorkflowState } from './video-remake.types.js';

export type VideoRemakeNodeEvent = {
  node: string;
  message: string;
  progress?: number;
  data?: unknown;
};

export type VideoRemakeNodeContext = {
  sessionId: string;
  userId: string;
  taskId?: string;
  workflow: VideoRemakeWorkflowState;
  forceRerunUnderstanding?: boolean;
  rerunUnderstandingRoles?: string[];
  emit(event: VideoRemakeNodeEvent): void;
  onUnderstandingComplete?(input: {
    vod: Record<string, unknown>;
    audio: Record<string, unknown>;
    visual: Record<string, unknown>;
    pip: Record<string, unknown>;
  }): void;
};

export type VideoRemakeNodeAdapters = {
  uploadToVod(context: VideoRemakeNodeContext): Promise<Record<string, unknown>>;
  analyzeAudio(context: VideoRemakeNodeContext): Promise<Record<string, unknown>>;
  analyzeVisual(context: VideoRemakeNodeContext): Promise<Record<string, unknown>>;
  analyzePip(context: VideoRemakeNodeContext): Promise<Record<string, unknown>>;
  directorNormalize(context: VideoRemakeNodeContext): Promise<Partial<Record<string, unknown>>>;
  generateStoryboard(context: VideoRemakeNodeContext): Promise<Array<Record<string, unknown>>>;
  generateSeedancePrompts(context: VideoRemakeNodeContext): Promise<Array<Record<string, unknown>>>;
  generateVideoSegments(context: VideoRemakeNodeContext): Promise<Array<Record<string, unknown>>>;
  mergeVideo(context: VideoRemakeNodeContext): Promise<Record<string, unknown>>;
  regenerateVideoSegment(context: VideoRemakeNodeContext, input: {
    cardData: Record<string, unknown>;
    segmentIndex: number;
    prompt?: string;
  }): Promise<Record<string, unknown>>;
};

export const videoRemakeVideoModelRuntime = {
  callConfiguredVideoModel,
  callSegmentedSeedanceVideoGeneration,
  callSceneAwareSegmentedSeedanceVideoGeneration,
  waitForVideoModelCompletion,
};

function sourceTitle(workflow: VideoRemakeWorkflowState) {
  return workflow.source.title || '视频复刻任务';
}

function logVideoRemakeGeneration(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
  logToFile('video-remake-generation.log', level, message, context);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fileUrlForContentFile(fileName: string) {
  return `/files/content/${encodeURIComponent(fileName)}`;
}

function fileUrlForContentPath(filePath: string) {
  return fileUrlForContentFile(path.basename(filePath));
}

function contentFilePathFromUrl(url: unknown) {
  const value = textFrom(url);
  if (!value.startsWith('/files/content/')) {
    return '';
  }
  const fileName = decodeURIComponent(value.slice('/files/content/'.length).split(/[?#]/u)[0] || '');
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    return '';
  }
  const filePath = path.join(contentFilesDir, fileName);
  return existsSync(filePath) ? filePath : '';
}

function segmentTiming(segments: Record<string, unknown>[], index: number) {
  const segment = segments[index] || {};
  const startValue = Number(segment.startSecond ?? segment.startTime);
  const endValue = Number(segment.endSecond ?? segment.endTime);
  const durationValue = Number(segment.seconds ?? segment.durationSecond ?? segment.duration);
  const fallbackStart = segments
    .slice(0, index)
    .reduce((sum, item) => sum + Math.max(0, Number(item.seconds ?? item.durationSecond ?? item.duration) || 0), 0);
  const start = Number.isFinite(startValue) ? startValue : fallbackStart;
  const duration = Number.isFinite(endValue) && endValue > start
    ? endValue - start
    : Number.isFinite(durationValue)
      ? durationValue
      : 0;
  return { start, duration };
}

async function extractOriginalSegmentFromCurrentVideo(input: {
  sourcePath: string;
  taskId: string;
  traceId: string;
  segmentIndex: number;
  segments: Record<string, unknown>[];
}) {
  const { start, duration } = segmentTiming(input.segments, input.segmentIndex - 1);
  if (!input.sourcePath || !existsSync(input.sourcePath) || duration <= 0) {
    return null;
  }
  const storedFileName = `video-segment-${input.taskId}-${input.segmentIndex}-${Date.now()}-original.mp4`;
  const outputPath = path.join(contentFilesDir, storedFileName);
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(start),
      '-i',
      input.sourcePath,
      '-t',
      String(duration),
      '-c',
      'copy',
      outputPath,
    ], { timeout: 300_000 });
  } catch (error) {
    logVideoRemakeGeneration('warn', 'extract original segment from current video failed', {
      traceId: input.traceId,
      taskId: input.taskId,
      segmentIndex: input.segmentIndex,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  logVideoRemakeGeneration('info', 'extract original segment from current video completed', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    start,
    duration,
    outputPath,
  });
  return {
    fileName: storedFileName,
    filePath: outputPath,
    videoUrl: fileUrlForContentFile(storedFileName),
  };
}

function findLatestLocalVideoSegment(taskId: string, segmentIndex: number) {
  const prefix = `video-segment-${taskId}-${segmentIndex}-`;
  const files = readdirSync(contentFilesDir)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith('.mp4'))
    .map((fileName) => {
      const filePath = path.join(contentFilesDir, fileName);
      try {
        const stats = statSync(filePath);
        return { fileName, filePath, mtimeMs: stats.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((item): item is { fileName: string; filePath: string; mtimeMs: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files[0];
}

function historicalFinalVideoSegments(cardData: Record<string, unknown>) {
  const videos = Array.isArray(cardData.videos) ? cardData.videos.filter(isRecord) : [];
  const currentUrl = textFrom(cardData.videoUrl);
  const currentVersionLabel = textFrom(cardData.versionLabel);
  const currentVersionNumber = Number(cardData.versionNumber || 0);
  const currentVideo = videos.find((video) => {
    const versionNumber = Number(video.versionNumber || 0);
    return (currentUrl && textFrom(video.videoUrl) === currentUrl)
      || (currentVersionLabel && textFrom(video.versionLabel) === currentVersionLabel)
      || (currentVersionNumber && versionNumber === currentVersionNumber);
  }) || videos[videos.length - 1];
  return currentVideo && Array.isArray(currentVideo.segments)
    ? currentVideo.segments.filter(isRecord)
    : [];
}

function segmentWithLocalFallback(
  segment: Record<string, unknown>,
  input: { taskId: string; segmentIndex: number; traceId: string },
) {
  const videoUrl = textFrom(segment.videoUrl || segment.fileUrl || segment.url);
  if (videoUrl.startsWith('/files/content/')) {
    return segment;
  }
  const local = findLatestLocalVideoSegment(input.taskId, input.segmentIndex);
  if (!local) {
    return segment;
  }
  logVideoRemakeGeneration('info', 'video segment local fallback resolved', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    filePath: local.filePath,
  });
  return {
    ...segment,
    remoteVideoUrl: videoUrl || segment.remoteVideoUrl,
    videoUrl: fileUrlForContentFile(local.fileName),
    fileUrl: fileUrlForContentFile(local.fileName),
    url: fileUrlForContentFile(local.fileName),
    segmentPath: local.filePath,
    filePath: local.filePath,
    status: textFrom(segment.status) === 'generating' ? 'completed' : segment.status || 'completed',
  };
}

function summarizeUnderstandingFailure(result: Record<string, unknown>, execution: VodUnderstandingExecution) {
  const status = textFrom(result.status) || 'unknown';
  const raw = isRecord(result.raw) ? result.raw : {};
  const detail = [
    textFrom(raw.message),
    textFrom(raw.Message),
    textFrom(raw.error),
    textFrom(raw.Error),
    textFrom(raw.error_message),
    textFrom(raw.ErrorMessage),
    textFrom(raw.code),
    textFrom(raw.Code),
  ].filter(Boolean)[0] || '';
  const summary = {
    role: execution.role,
    roleName: execution.roleName,
    runId: execution.runId,
    status,
    detail,
    raw,
  };
  logger.error('video remake understanding execution failed', summary);
  return `${execution.roleName} 解析失败：${status}${detail ? ` (${detail})` : ''} [runId=${execution.runId}]`;
}

function looksLikeJsonPayload(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function stripJsonCodeFence(value: string) {
  return value.trim().replace(/^```json\s*/u, '').replace(/^```\s*/u, '').replace(/```\s*$/u, '').trim();
}

function repairEmbeddedFieldLabelJson(value: string) {
  const embeddedFieldPattern = /(:\s*")([^"\\]*(?:\\.[^"\\]*)*?)([,，;；、])\s*([^"\\{}\[\]:,，;；、\n\r]{1,40})"\s*:/gu;
  return value.replace(embeddedFieldPattern, (_match, prefix: string, text: string, _separator: string, key: string) => (
    `${prefix}${text.trimEnd()}", "${key.trim()}":`
  ));
}

export function repairVideoRemakeJsonPayload(value: unknown) {
  if (typeof value !== 'string') {
    return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  }
  const text = stripJsonCodeFence(value);
  if (!text || !looksLikeJsonPayload(text)) {
    return text;
  }
  try {
    JSON.parse(text);
    return text;
  } catch {
    const preRepaired = repairEmbeddedFieldLabelJson(text);
    try {
      JSON.parse(preRepaired);
      return preRepaired;
    } catch {
      try {
        return jsonrepair(preRepaired);
      } catch {
        return text;
      }
    }
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }
  const text = repairVideoRemakeJsonPayload(value);
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return isRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
  }
  return {};
}

function textFrom(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function durationSecondsFromVod(vod: Record<string, unknown>) {
  const sourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const raw = Number(sourceInfo.duration || sourceInfo.Duration || sourceInfo.durationSeconds || 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return raw > 1000 ? Math.round(raw / 1000) : Math.round(raw);
}

function formatEstimateValue(seconds: number) {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes}分${remain}秒` : `${minutes}分钟`;
}

function formatRemakeAnalysisEstimate(seconds: number) {
  if (!seconds) {
    return '';
  }
  const min = Math.max(1, Math.round(seconds * 2));
  const max = Math.max(min, Math.round(seconds * 3));
  return `${formatEstimateValue(min)} ~ ${formatEstimateValue(max)}`;
}

function taskContent(parsed: Record<string, unknown>, key: string) {
  const section = parsed[key];
  if (isRecord(section)) {
    const content = section.content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (content !== undefined) {
      return readableText(content);
    }
    return readableText(section);
  }
  return readableText(section);
}

function taskContentValue(parsed: Record<string, unknown>, key: string) {
  const section = parsed[key];
  if (isRecord(section) && section.content !== undefined) {
    return section.content;
  }
  return section;
}

function labelFromKey(key: string, fallback: string) {
  return key.trim() || fallback;
}

function splitMergedIndexedEntityText(text: string, prefixes: string[]) {
  const source = text.trim();
  if (!source) {
    return [];
  }
  const prefixPattern = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const entityPattern = new RegExp(`(?:^|[\\s,，、;；])((?:${prefixPattern})\\s*[0-9一二三四五六七八九十]+(?:[（(][^（）()]+[）)])?)`, 'gu');
  const colonIndex = source.search(/[：:]/u);
  if (colonIndex > 0) {
    const header = source.slice(0, colonIndex);
    const commonDescription = source.slice(colonIndex + 1).trim();
    const headerMatches = Array.from(header.matchAll(entityPattern));
    if (headerMatches.length >= 2 && commonDescription) {
      return headerMatches.map((match) => ({
        label: (match[1] || '').trim(),
        description: commonDescription,
      })).filter((item) => item.label);
    }
  }
  const matches = Array.from(source.matchAll(entityPattern))
    .map((match) => ({
      label: (match[1] || '').trim(),
      index: (match.index || 0) + (match[0].length - (match[1] || '').length),
    }))
    .filter((match) => match.label);
  if (matches.length < 2) {
    return [];
  }
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const chunk = source.slice(match.index + match.label.length, next ? next.index : undefined)
      .replace(/^[\s：:，,、;；-]+/u, '')
      .trim();
    return {
      label: match.label,
      description: chunk,
    };
  }).filter((item) => item.description);
}

function readableText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const text = readableText(item);
        return text ? `${index + 1}. ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => {
        const text = readableText(entry);
        return text ? `${key}：${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function isUnknownPlaceholderText(value: string) {
  return /^(不详|未知|未详|不明确|未明确|无法确定|未提供|暂无|无|N\/A|NA|null|undefined)[。.]?$/iu.test(value.trim());
}

function isReferencePromptMetaKey(key: string) {
  return /^(startSecond|endSecond|start|end|startTime|endTime|time|duration|spokenCue|speckCue|speechCue|narrationCue|cue|keywords?|开始时间|结束时间|开始秒|结束秒|出现时间|适用时间|时间范围|口播线索|对应口播|语境线索|关键词)$/iu.test(key.trim());
}

function cleanReferencePromptText(value: unknown): string {
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (!line || isUnknownPlaceholderText(line)) {
          return false;
        }
        const match = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/u);
        if (!match) {
          return true;
        }
        const key = match[1].trim();
        const text = match[2].trim();
        if (isReferencePromptMetaKey(key) || isUnknownPlaceholderText(text)) {
          return false;
        }
        return true;
      })
      .join('\n')
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleanReferencePromptText(item)).filter(Boolean).join('\n');
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => {
        if (isReferencePromptMetaKey(key)) {
          return '';
        }
        const text = cleanReferencePromptText(entry);
        return text ? `${key}：${text}` : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value).trim();
  return isUnknownPlaceholderText(text) ? '' : text;
}

function recordText(value: unknown, key: string) {
  return isRecord(value) ? readableText(value[key]) : '';
}

function recordValue(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function firstRecordText(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return '';
  }
  for (const key of keys) {
    const text = readableText(value[key]).trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function firstRecordNumber(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === '') {
      continue;
    }
    const number = Number(raw);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

function recordKeywords(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }
  const raw = value.keywords || value.keyword || value['关键词'];
  if (Array.isArray(raw)) {
    return raw.map((item) => textFrom(item)).filter(Boolean);
  }
  return readableText(raw)
    .split(/[，,、;；\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function entityTimingFields(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }
  return {
    startSecond: firstRecordNumber(value, ['startSecond', 'start', 'startTime', '开始时间', '开始秒']),
    endSecond: firstRecordNumber(value, ['endSecond', 'end', 'endTime', '结束时间', '结束秒']),
    spokenCue: firstRecordText(value, ['spokenCue', 'speckCue', 'narrationCue', 'speechCue', 'cue', '口播', '口播线索', '对应口播', '语境线索']),
    keywords: recordKeywords(value),
  };
}

function isEmptySemanticText(value: string) {
  return !value || /^(无|暂无|没有|未出现|未发现|未提及|不涉及|无产品|没有产品|无画中画|没有画中画)[。.]?$/u.test(value.trim());
}

function isNoPipText(value: unknown) {
  const text = readableText(value).trim();
  if (isEmptySemanticText(text)) {
    return true;
  }
  return /(?:未出现|未发现|没有|无).*(?:画中画|独立视觉叠加|独立内容区域|后期叠加|叠加视频|叠加图片|截图|录屏|分屏|可复刻的视觉叠加层)/u.test(text);
}

function entriesFromObjectOrArray(value: unknown, fallbackPrefix: string) {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        const wrapped = unwrapSingleLabeledRecord(entry, fallbackPrefix);
        return wrapped || { label: `${fallbackPrefix} ${index + 1}`, value: entry };
      })
      .filter((entry) => entry.value !== undefined && entry.value !== null);
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([label, entry]) => ({ label, value: entry }));
  }
  return [];
}

function entityKeyPattern(prefixes: string[]) {
  const escaped = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^(?:${escaped})(?:\\s*[0-9一二三四五六七八九十]+|[（(].+[）)]|$)`, 'u');
}

function unwrapSingleLabeledRecord(value: unknown, fallbackPrefix: string) {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null);
  if (entries.length !== 1) {
    return undefined;
  }
  const [[label, entry]] = entries;
  if (!entityKeyPattern([fallbackPrefix]).test(label.trim())) {
    return undefined;
  }
  return { label, value: entry };
}

function entityEntriesFromTaskSection(value: unknown, prefixes: string[], fallbackPrefix: string) {
  const pattern = entityKeyPattern(prefixes);
  const directKeys = prefixes.flatMap((prefix) => [
    `${prefix}描述提示词`,
    `${prefix}描述`,
    `${prefix}信息`,
    `${prefix}设定`,
    prefix,
  ]);
  const directValue = directKeys.map((key) => recordValue(value, key)).find((entry) => entry !== undefined && entry !== null);
  const directEntries = entriesFromObjectOrArray(directValue, fallbackPrefix)
    .map((entry, index) => ({
      label: labelFromKey(entry.label, `${fallbackPrefix} ${index + 1}`),
      value: entry.value,
    }));
  const keyedEntries = isRecord(value)
    ? Object.entries(value)
      .filter(([key, entry]) => pattern.test(key.trim()) && entry !== undefined && entry !== null)
      .map(([label, entry]) => ({ label, value: entry }))
    : [];
  const merged = [...keyedEntries, ...directEntries];
  const seen = new Set<string>();
  return merged.filter((entry, index) => {
    const key = `${entry.label || `${fallbackPrefix} ${index + 1}`}::${readableText(entry.value).slice(0, 120)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sceneOnlyPromptText(value: unknown): string {
  if (typeof value === 'string') {
    return cleanReferencePromptText(value)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !/^(?:人物|角色|人像|主播|达人|speaker|character|person|people)\s*[0-9一二三四五六七八九十]*\s*[:：]/iu.test(line))
      .filter((line) => !/^(?:口播|台词|旁白|声线|声音)\s*[:：]/u.test(line))
      .join('\n')
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => sceneOnlyPromptText(item)).filter(Boolean).join('\n');
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => {
        const normalizedKey = key.trim();
        if (/^(人物|角色|人像|主播|达人|speaker|character|person|people)/iu.test(normalizedKey)) {
          return '';
        }
        if (/^(口播|台词|旁白|spokenCue|speckCue|speechCue|narrationCue|声线|声音|voice)$/iu.test(normalizedKey)) {
          return '';
        }
        if (isReferencePromptMetaKey(normalizedKey)) {
          return '';
        }
        const text = sceneOnlyPromptText(entry);
        return text ? `${normalizedKey}：${text}` : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return cleanReferencePromptText(value);
}

function visualCharacters(task2Value: unknown) {
  if (typeof task2Value === 'string') {
    const textEntries = textCharacterEntries(task2Value);
    if (textEntries.length) {
      return textEntries.map((entry, index) => ({
        label: labelFromKey(entry.label, `人物 ${index + 1}`),
        characterPrompt: cleanCharacterPromptText(entry.description),
        voiceStyle: entry.voiceStyle,
        ...entityTimingFieldsFromText(entry.description),
        required: true,
        referenceMode: 'prompt',
      }));
    }
  }
  const promptValue = recordValue(task2Value, '人物描述提示词') || recordValue(task2Value, '人物描述') || recordValue(task2Value, 'characterPrompt');
  const promptEntries = entityEntriesFromTaskSection(task2Value, ['人物', '角色'], '人物');
  const directPrompt = cleanCharacterPromptText(promptValue);
  const splitCharacters = splitMergedIndexedEntityText(directPrompt, ['人物', '角色']);
  if (!promptEntries.length && splitCharacters.length >= 2) {
    return splitCharacters.map((entry, index) => ({
      label: entry.label || `人物 ${index + 1}`,
      characterPrompt: entry.description,
      required: true,
      referenceMode: 'prompt',
    }));
  }
  const labels = Array.from(new Set([
    ...promptEntries.map((entry) => entry.label),
  ]));
  const effectiveLabels = labels.length ? labels : (directPrompt ? ['人物 1'] : []);

  return effectiveLabels.map((label, index) => {
    const prompt = promptEntries.find((entry) => entry.label === label)?.value ?? promptEntries[index]?.value ?? promptValue;
    return {
      label: labelFromKey(label, `人物 ${index + 1}`),
      characterPrompt: cleanCharacterPromptText(prompt),
      voiceStyle: characterVoiceStyle(prompt),
      ...entityTimingFields(prompt),
      required: true,
      referenceMode: 'prompt',
    };
  });
}

function textCharacterEntries(content: string) {
  const text = content.trim();
  if (!text) {
    return [];
  }
  const pattern = /(?:^|\n)\s*(人物\s*[0-9一二三四五六七八九十]+|角色\s*[0-9一二三四五六七八九十]+)\s*[：:]\s*人物描述\s*[：:]\s*([\s\S]*?)(?=(?:\n\s*(?:人物|角色)\s*[0-9一二三四五六七八九十]+\s*[：:]\s*人物描述\s*[：:])|$)/gu;
  return Array.from(text.matchAll(pattern)).map((match) => {
    const body = (match[2] || '').trim();
    const voiceMatch = body.match(/(?:^|[\n；;])\s*人物声线\s*[：:]\s*([\s\S]*?)$/u);
    const description = body
      .replace(/(?:^|[\n；;])\s*人物声线\s*[：:][\s\S]*$/u, '')
      .trim();
    return {
      label: (match[1] || '').trim(),
      description,
      voiceStyle: (voiceMatch?.[1] || '').trim(),
    };
  }).filter((entry) => entry.description || entry.voiceStyle);
}

function entityTimingFieldsFromText(value: string) {
  const match = value.match(/(?:时间范围|适用时间|出现时间)\s*[：:]\s*(\d+(?:\.\d+)?)\s*s?\s*[-~～至到]\s*(\d+(?:\.\d+)?)\s*s?/u);
  if (!match) {
    return {};
  }
  return {
    startSecond: Number(match[1]),
    endSecond: Number(match[2]),
  };
}

function visualScenes(task2Value: unknown, task3Value: unknown, task4Value: unknown) {
  const sceneValue = recordValue(task2Value, '场景描述') || recordValue(task2Value, '场景') || recordValue(task2Value, '环境描述');
  const sceneEntries = entityEntriesFromTaskSection(task2Value, ['场景', '地点', '环境'], '场景');
  const cameraText = readableText(recordValue(task3Value, '机位') || recordValue(task3Value, '机位/景别') || recordValue(task3Value, '景别变化'));
  const atmosphereText = readableText(recordValue(task4Value, '整体氛围'));
  const environmentText = readableText(recordValue(task2Value, '环境') || recordValue(task2Value, '环境空间'));
  const propsText = readableText(recordValue(task2Value, '道具'));
  const lightingText = readableText(recordValue(task2Value, '光线氛围') || recordValue(task2Value, '灯光'));
  const compositionText = readableText(recordValue(task2Value, '构图') || recordValue(task2Value, '构图层次') || recordValue(task2Value, '画面构图'));
  const baseDescription = sceneOnlyPromptText(sceneValue);
  const effectiveEntries = sceneEntries.length ? sceneEntries : (baseDescription || cameraText || atmosphereText ? [{ label: '场景 1', value: sceneValue || task2Value }] : []);

  return effectiveEntries.map((entry, index) => {
    const description = cleanScenePromptText(entry.value);
    const mainDescription = description || baseDescription;
    const sceneDetailLine = (label: string, text: string) => {
      if (!text || mainDescription.includes(text)) {
        return '';
      }
      return `${label}：${text}`;
    };
    const sceneDescription = uniqueUsefulLines([
      mainDescription,
      sceneDetailLine('环境', environmentText),
      sceneDetailLine('道具', propsText),
      sceneDetailLine('灯光', lightingText),
      sceneDetailLine('构图', compositionText),
      effectiveEntries.length > 1 ? '' : sceneDetailLine('机位', cameraText),
      effectiveEntries.length > 1 ? '' : sceneDetailLine('氛围', atmosphereText),
    ]).join('\n');
    return {
      label: labelFromKey(entry.label, `场景 ${index + 1}`),
      description: sceneDescription,
      camera: effectiveEntries.length > 1 ? '' : cameraText,
      atmosphere: effectiveEntries.length > 1 ? '' : atmosphereText,
      ...entityTimingFields(entry.value),
      required: true,
      referenceMode: 'prompt',
    };
  });
}

function visualProducts(task5Value: unknown) {
  const items = (Array.isArray(task5Value) ? task5Value : entriesFromObjectOrArray(task5Value, '产品').map((entry) => entry.value))
    .filter((item) => item !== undefined && item !== null)
    .filter((item) => !isEmptySemanticText(readableText(item)));
  if (!items.length) {
    return {
      noProduct: true,
      referenceMode: 'prompt',
      items: [],
    };
  }
  return {
    noProduct: false,
    referenceMode: 'prompt',
    items: items.map((item, index) => {
      const info = recordValue(item, '产品信息');
      const productType = recordText(item, '产品类型');
      const feature = recordText(item, '产品特征');
      const presentation = recordText(item, '展示方式');
      const brand = recordText(info, '品牌');
      const model = recordText(info, '型号');
      const description = [
        productType ? `类型：${productType}` : '',
        feature ? `特征：${feature}` : '',
        brand && brand !== '无' ? `品牌：${brand}` : '',
        model && model !== '无' ? `型号：${model}` : '',
      ].filter(Boolean).join('\n') || cleanReferencePromptText(item);
      return {
        label: recordText(item, 'label') || recordText(item, 'name') || `产品 ${index + 1}`,
        description,
        presentation,
        productType,
        feature,
        brand,
        model,
        ...entityTimingFields(item),
        noProduct: false,
        referenceMode: 'prompt',
      };
    }),
  };
}

export function visualDetailsFromContent(content: string) {
  const repairedContent = repairVideoRemakeJsonPayload(content);
  const parsed = parseJsonObject(repairedContent);
  const task1Value = taskContentValue(parsed, 'task1');
  const task2Value = taskContentValue(parsed, 'task2') ?? (Object.keys(parsed).length ? undefined : repairedContent);
  const task3Value = taskContentValue(parsed, 'task3');
  const task4Value = taskContentValue(parsed, 'task4');
  const task5Value = taskContentValue(parsed, 'task5');
  const task1 = taskContent(parsed, 'task1');
  const title = recordText(task1Value, '视频标题') || task1;
  return {
    parsed,
    content: repairedContent,
    title,
    characters: visualCharacters(task2Value),
    scenes: visualScenes(task2Value, task3Value, task4Value),
    product: visualProducts(task5Value),
  };
}

function fallbackDirectorNormalizeResult(context: VideoRemakeNodeContext): Partial<Record<string, unknown>> {
  const audio = context.workflow.runtime.analyses?.audio || {};
  const visual = context.workflow.runtime.analyses?.visual || {};
  const pip = context.workflow.runtime.analyses?.pip || {};
  const vod = context.workflow.runtime.vod || {};
  const vodSourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const vodWidth = Number(vodSourceInfo.width);
  const vodHeight = Number(vodSourceInfo.height);
  const vodAspectRatio = normalizeAspectRatioFromSize(vodWidth, vodHeight);
  const rawCharacterItems = Array.isArray(visual.characters) ? (visual.characters as unknown[]).filter(isRecord) : [];
  const characterItems = normalizeDirectorCharacterItems({ items: rawCharacterItems });
  const sceneItems = normalizeDirectorSceneItems({
    items: Array.isArray(visual.scenes) ? visual.scenes : [],
  });
  const voiceItems = (characterItems.length ? characterItems : [{ label: '人物 1' }]).map((character, index) => {
    const characterLabel = textFrom(character.label) || `人物 ${index + 1}`;
    const rawCharacter = rawCharacterItems.find((item) => settingEntityKey(textFrom(item.label) || textFrom(item.name)) === settingEntityKey(characterLabel))
      || rawCharacterItems[index];
    return {
      label: `${characterLabel} 声音`,
      characterLabel,
      characterIndex: index,
      voice: String((audio as Record<string, unknown>).voice || '原声参考'),
      voiceStyle: characterVoiceStyle(rawCharacter) || String((audio as Record<string, unknown>).voiceStyle || ''),
    };
  });
  return {
    basicInfo: {
      title: context.workflow.source.title,
      resolution: vodWidth && vodHeight
        ? `${vodWidth}x${vodHeight}`
        : '1080x1920',
      aspectRatio: nearestPresetAspectRatio(vodAspectRatio) || '9:16',
      sourceUrl: context.workflow.source.sourceUrl,
    },
    expertAnalysis: {
      audio,
      visual,
      pip,
    },
    characterSetting: {
      items: characterItems,
    },
    sceneSetting: {
      items: sceneItems,
    },
    productSetting: typeof visual.product === 'object' && visual.product ? visual.product : {},
    pipSetting: {
      summary: String((pip as Record<string, unknown>).summary || ''),
      appeared: Boolean((pip as Record<string, unknown>).appeared),
      items: Array.isArray((pip as Record<string, unknown>).items)
        ? ((pip as Record<string, unknown>).items as unknown[]).filter(isRecord).map((item) => ({
          ...item,
          replacementPrompt: textFrom(item.replacementPrompt) || textFrom(item.content),
        }))
        : [],
    },
    voiceAudioSetting: {
      voice: String((audio as Record<string, unknown>).voice || '原声参考'),
      voiceStyle: String((audio as Record<string, unknown>).voiceStyle || ''),
      bgm: String((audio as Record<string, unknown>).bgm || ''),
      soundEffects: String((audio as Record<string, unknown>).soundEffects || ''),
      items: voiceItems,
    },
    scriptContent: {
      content: String((audio as Record<string, unknown>).spokenContent || ''),
      source: 'director_normalize',
    },
  };
}

function normalizeAspectRatioFromSize(width: number, height: number) {
  if (!width || !height) {
    return '';
  }
  const gcd = (left: number, right: number): number => (right ? gcd(right, left % right) : left);
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

const presetAspectRatios = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
type PresetAspectRatio = typeof presetAspectRatios[number];

function nearestPresetAspectRatio(value: unknown) {
  const text = textFrom(value).trim().replace(/\s+/gu, '');
  if (!text) {
    return '';
  }
  if (presetAspectRatios.includes(text as typeof presetAspectRatios[number])) {
    return text;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)[:/](\d+(?:\.\d+)?)$/u);
  if (!match) {
    return text;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return text;
  }
  const target = width / height;
  let best: PresetAspectRatio = presetAspectRatios[0];
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const ratio of presetAspectRatios) {
    const [presetWidth, presetHeight] = ratio.split(':').map(Number);
    const distance = Math.abs(target - (presetWidth / presetHeight));
    if (distance < smallestDistance) {
      smallestDistance = distance;
      best = ratio;
    }
  }
  return best;
}

function recordItems(value: unknown) {
  const record = isRecord(value) ? value : {};
  return Array.isArray(record.items) ? record.items.filter(isRecord) : [];
}

function normalizedDirectorCharacterSettingItems(value: unknown) {
  return normalizeDirectorCharacterItems({ items: recordItems(value) });
}

function normalizedDirectorSceneSettingItems(value: unknown) {
  return normalizeDirectorSceneItems({ items: recordItems(value) }).map((item) => ({
    ...item,
    description: scenePromptFromItem(item) || cleanScenePromptText(item.description),
  }));
}

function settingEntityKey(value: unknown) {
  return textFrom(value).replace(/\s+/gu, '').toLowerCase();
}

function characterDescriptionText(item: Record<string, unknown>) {
  return firstRecordText(item, ['人物描述', 'description', '描述']);
}

function characterVoiceStyle(item: unknown) {
  if (!isRecord(item)) {
    return '';
  }
  return firstRecordText(item, [
    'voiceStyle',
    'voice',
    '人物声线',
    '声线',
    '声音',
    '音色',
    '语音风格',
    '语速',
    '语气',
  ]);
}

function rawCharacterPromptText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => rawCharacterPromptText(item)).filter(Boolean).join('\n');
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => {
        if (isReferencePromptMetaKey(key)) {
          return '';
        }
        const text = rawCharacterPromptText(entry);
        return text ? `${key}：${text}` : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value).trim();
  return isUnknownPlaceholderText(text) ? '' : text;
}

function cleanCharacterPromptText(value: unknown) {
  return rawCharacterPromptText(value)
    .split(/[\n；;]/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^人物\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]\s*/u, '').trim())
    .map((line) => line.replace(/^人物描述\s*[：:]\s*/u, '').trim())
    .map((line) => line
      .replace(/^(?:时间范围|适用时间|出现时间)\s*[：:]\s*[^，,；;\n]+[，,；;]?\s*/u, '')
      .replace(/[，,；;]\s*(?:时间范围|适用时间|出现时间)\s*[：:]\s*[^，,；;\n]+/u, '')
      .replace(/^(?:开始时间|开始秒|结束时间|结束秒)\s*[：:]\s*[^，,；;\n]+[，,；;]?\s*/u, '')
      .trim())
    .filter((line) => !/^(?:人物声线|声线|声音|音色|语音风格|语速|语气|口播|台词|旁白)\s*[：:]/u.test(line))
    .join('；')
    .trim();
}

function characterPromptFromItem(item: Record<string, unknown>) {
  return cleanCharacterPromptText(characterDescriptionText(item))
    || cleanCharacterPromptText(item.characterPrompt);
}

function sceneDescriptionText(item: Record<string, unknown>) {
  return firstRecordText(item, ['场景描述', 'description', '描述']);
}

function cleanScenePromptText(value: unknown) {
  return sceneOnlyPromptText(value)
    .split(/[\n；;]/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^场景\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]\s*/u, '').trim())
    .map((line) => line.replace(/^场景描述\s*[：:]\s*/u, '').trim())
    .filter((line) => !/^(?:时间范围|适用时间|出现时间|开始时间|结束时间)\s*[：:]/u.test(line))
    .filter((line) => !/^(?:口播线索|对应口播|语境线索|关键词)\s*[：:]/u.test(line))
    .join('；')
    .trim();
}

function scenePromptFromItem(item: Record<string, unknown>) {
  return cleanScenePromptText(sceneDescriptionText(item))
    || cleanScenePromptText(item.description)
    || cleanScenePromptText(item.scenePrompt);
}

function mergeCharacterItemsWithFallback(
  characterItems: ReturnType<typeof normalizeDirectorCharacterItems>,
  fallbackItems: ReturnType<typeof normalizeDirectorCharacterItems>,
) {
  return characterItems.map((item, index) => {
    const fallback = fallbackItems.find((candidate) => settingEntityKey(candidate.label) === settingEntityKey(item.label))
      || fallbackItems[index];
    if (!fallback) {
      return item;
    }
    const fallbackPrompt = characterPromptFromItem(fallback) || uniqueUsefulLines([
      fallback.appearance ? `外观：${fallback.appearance}` : '',
      fallback.gesture ? `动作：${fallback.gesture}` : '',
      fallback.expression ? `表情：${fallback.expression}` : '',
    ]).join('\n');
    const itemPrompt = characterPromptFromItem(item);
    const mergedPrompt = itemPrompt || fallbackPrompt;
    return {
      ...item,
      appearance: item.appearance || fallback.appearance,
      gesture: item.gesture || fallback.gesture,
      expression: item.expression || fallback.expression,
      characterPrompt: mergedPrompt || fallbackPrompt || itemPrompt,
      startSecond: item.startSecond ?? fallback.startSecond,
      endSecond: item.endSecond ?? fallback.endSecond,
      spokenCue: item.spokenCue || fallback.spokenCue,
      keywords: item.keywords?.length ? item.keywords : fallback.keywords,
    };
  });
}

function mergeSceneItemsWithFallback(
  sceneItems: ReturnType<typeof normalizeDirectorSceneItems>,
  fallbackItems: ReturnType<typeof normalizeDirectorSceneItems>,
) {
  return sceneItems.map((item, index) => {
    const fallback = fallbackItems.find((candidate) => settingEntityKey(candidate.label) === settingEntityKey(item.label))
      || fallbackItems[index];
    if (!fallback) {
      return item;
    }
    const fallbackDescription = scenePromptFromItem(fallback);
    const itemDescription = scenePromptFromItem(item);
    return {
      ...item,
      description: uniqueUsefulLines([fallbackDescription, itemDescription]).join('\n') || itemDescription || fallbackDescription,
      environment: item.environment || fallback.environment,
      props: item.props || fallback.props,
      lighting: item.lighting || fallback.lighting,
      composition: item.composition || fallback.composition,
      camera: item.camera || fallback.camera,
      atmosphere: item.atmosphere || fallback.atmosphere,
      startSecond: item.startSecond ?? fallback.startSecond,
      endSecond: item.endSecond ?? fallback.endSecond,
      spokenCue: item.spokenCue || fallback.spokenCue,
      keywords: item.keywords?.length ? item.keywords : fallback.keywords,
    };
  });
}

function normalizeLlmDirectorResult(value: unknown, context: VideoRemakeNodeContext) {
  const record = isRecord(value) ? value : {};
  const fallback = fallbackDirectorNormalizeResult(context);
  const characterItems = normalizedDirectorCharacterSettingItems(record.characterSetting);
  const sceneItems = normalizedDirectorSceneSettingItems(record.sceneSetting);
  const fallbackCharacterItems = normalizedDirectorCharacterSettingItems(fallback.characterSetting);
  const fallbackSceneItems = normalizedDirectorSceneSettingItems(fallback.sceneSetting);
  const mergedCharacterItems = mergeCharacterItemsWithFallback(characterItems, fallbackCharacterItems);
  const mergedSceneItems = mergeSceneItemsWithFallback(sceneItems, fallbackSceneItems);
  const hasSceneCharacterLeak = mergedSceneItems.some((item) => /(?:^|\n)\s*(?:人物|角色)\s*[0-9一二三四五六七八九十]*\s*[:：]/u.test(item.description || ''));
  if (!sceneItems.length || hasSceneCharacterLeak || (fallbackCharacterItems.length > 0 && !characterItems.length)) {
    return undefined;
  }
  const audio = isRecord(record.voiceAudioSetting) ? record.voiceAudioSetting : {};
  const pip = isRecord(record.pipSetting) ? record.pipSetting : {};
  const visual = context.workflow.runtime.analyses?.visual || {};
  const voiceItems = Array.isArray(audio.items) ? audio.items.filter(isRecord) : [];
  return {
    ...fallback,
    basicInfo: isRecord(record.basicInfo) ? record.basicInfo : fallback.basicInfo,
    expertAnalysis: isRecord(record.expertAnalysis) ? record.expertAnalysis : fallback.expertAnalysis,
    characterSetting: {
      ...(isRecord(record.characterSetting) ? record.characterSetting : {}),
      items: mergedCharacterItems,
    },
    sceneSetting: {
      ...(isRecord(record.sceneSetting) ? record.sceneSetting : {}),
      items: mergedSceneItems,
    },
    productSetting: isRecord(record.productSetting) ? record.productSetting : (typeof visual.product === 'object' && visual.product ? visual.product : {}),
    pipSetting: {
      ...(isRecord(record.pipSetting) ? record.pipSetting : {}),
      summary: textFrom(pip.summary) || textFrom((fallback.pipSetting as Record<string, unknown>).summary),
      appeared: Boolean(pip.appeared),
      items: Array.isArray(pip.items) ? pip.items.filter(isRecord) : [],
    },
    voiceAudioSetting: {
      ...(isRecord(record.voiceAudioSetting) ? record.voiceAudioSetting : {}),
      voice: textFrom(audio.voice) || textFrom((fallback.voiceAudioSetting as Record<string, unknown>).voice) || '原声参考',
      voiceStyle: textFrom(audio.voiceStyle) || textFrom((fallback.voiceAudioSetting as Record<string, unknown>).voiceStyle),
      bgm: textFrom(audio.bgm),
      soundEffects: textFrom(audio.soundEffects),
      items: voiceItems.length ? voiceItems : (fallback.voiceAudioSetting as Record<string, unknown>).items,
    },
    scriptContent: isRecord(record.scriptContent)
      ? {
        ...record.scriptContent,
        content: textFrom(record.scriptContent.content) || textFrom((fallback.scriptContent as Record<string, unknown>).content),
        source: textFrom(record.scriptContent.source) || 'director_normalize_llm',
      }
      : fallback.scriptContent,
  };
}

async function generateDirectorNormalizeWithLlm(context: VideoRemakeNodeContext) {
  const fallback = fallbackDirectorNormalizeResult(context);
  const visual = context.workflow.runtime.analyses?.visual || {};
  const audio = context.workflow.runtime.analyses?.audio || {};
  const pip = context.workflow.runtime.analyses?.pip || {};
  const timeoutMs = Number(process.env.VIDEO_REMAKE_DIRECTOR_LLM_TIMEOUT_MS || 180_000);
  const result = await callConfiguredLlm({
    userId: context.userId,
    temperature: 0.1,
    sourceType: 'video_remake_director_normalize',
    sourceId: context.sessionId,
    system: [
      videoRemakeDirectorNormalizeSystemPrompt,
      '输出 JSON 顶层字段固定为 basicInfo、expertAnalysis、characterSetting、sceneSetting、productSetting、pipSetting、voiceAudioSetting、scriptContent。',
      'characterSetting.items 和 sceneSetting.items 至少各输出一个有效 item；如果视频中确实没有人物，characterSetting.items 才能为空。',
      '严禁把人物字段写入 sceneSetting.items[].description；严禁把场景环境写入 characterSetting.items[].characterPrompt。',
    ].join('\n'),
    user: [
      '请先语义整理以下专家结果，输出严格 JSON：',
      JSON.stringify({
        expectedShape: {
          basicInfo: { title: '', resolution: '', aspectRatio: '', sourceUrl: '' },
          expertAnalysis: { audio: {}, visual: {}, pip: {} },
          characterSetting: {
            items: [{
              label: '人物 1',
              description: '',
              appearance: '',
              characterPrompt: '',
              gesture: '',
              expression: '',
              startSecond: 0,
              endSecond: 0,
              spokenCue: '',
              keywords: [],
              required: true,
              referenceMode: 'prompt',
            }],
          },
          sceneSetting: {
            items: [{
              label: '场景 1',
              description: '',
              environment: '',
              props: '',
              lighting: '',
              composition: '',
              camera: '',
              atmosphere: '',
              startSecond: 0,
              endSecond: 0,
              spokenCue: '',
              keywords: [],
              required: true,
              referenceMode: 'prompt',
            }],
          },
          productSetting: { noProduct: false, referenceMode: 'prompt', items: [] },
          pipSetting: { summary: '', appeared: false, items: [] },
          voiceAudioSetting: {
            voice: '原声参考',
            voiceStyle: '',
            bgm: '',
            soundEffects: '',
            items: [{
              label: '人物 1 声音',
              characterLabel: '人物 1',
              characterIndex: 0,
              voice: '原声参考',
              voiceStyle: '人物声线、音色、语速、语气、语音风格等声音描述',
            }],
          },
          scriptContent: { content: '', source: 'director_normalize_llm' },
        },
      }, null, 2),
      '',
      '# 代码兜底初稿（可参考，但不要照抄其中的字段混淆）',
      JSON.stringify(fallback, null, 2),
      '',
      '# 音频理解专家结果',
      JSON.stringify(audio, null, 2),
      '',
      '# 视频理解专家结果',
      JSON.stringify(visual, null, 2),
      '',
      '# 画中画理解专家结果',
      JSON.stringify(pip, null, 2),
    ].join('\n'),
    timeoutMs,
  });
  const normalized = normalizeLlmDirectorResult(parseJsonObject(result), context);
  if (!normalized) {
    logVideoRemakeGeneration('warn', 'director normalize llm returned invalid structure, fallback to code', {
      sessionId: context.sessionId,
      taskId: context.taskId,
      responseLength: result.length,
      responsePreview: result.slice(0, 800),
    });
  }
  return normalized;
}

function urlInspection(workflow: VideoRemakeWorkflowState) {
  const vod = workflow.runtime.vod || {};
  return isRecord(vod.inspection) ? vod.inspection as unknown as InspectedVideoMaterial : undefined;
}

const understandingCache = new Map<string, Promise<Record<string, ViralUnderstandingOutput>>>();

function serializableExecutions(executions: VodUnderstandingExecution[]) {
  return executions.map((execution) => ({
    role: execution.role,
    roleName: execution.roleName,
    mode: execution.mode,
    runId: execution.runId,
    prompt: execution.prompt,
  }));
}

function serializableExecutionsWithProgress(
  executions: VodUnderstandingExecution[],
  outputs: Record<string, ViralUnderstandingOutput>,
) {
  return executions.map((execution) => ({
    role: execution.role,
    roleName: execution.roleName,
    mode: execution.mode,
    runId: execution.runId,
    prompt: execution.prompt,
    completed: hasCompletedUnderstandingOutput(execution.role, outputs[execution.role]),
  }));
}

function rolesForUnderstanding(
  roles: ReturnType<typeof viralUnderstandingSdkAgentList>,
  forceRerun?: boolean,
  rerunRoles?: string[],
) {
  const targetRoles = new Set((rerunRoles || []).filter(Boolean));
  const selectedRoles = targetRoles.size ? roles.filter((role) => targetRoles.has(role.key)) : roles;
  if (!forceRerun) {
    return selectedRoles;
  }
  const nonce = randomUUID();
  return selectedRoles.map((role) => ({
    ...role,
    prompt: `${role.prompt}\n\n[execution_nonce:${nonce}:${role.key}]`,
  }));
}

function persistedExecutions(value: unknown): VodUnderstandingExecution[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .map((item) => ({
      role: textFrom(item.role),
      roleName: textFrom(item.roleName),
      mode: textFrom(item.mode),
      runId: textFrom(item.runId),
      prompt: textFrom(item.prompt),
    }))
    .filter((item) => item.role && item.roleName && item.runId);
}

async function collectUnderstandingOutputs(context: VideoRemakeNodeContext) {
  const vod = context.workflow.runtime.vod || {};
  const vid = textFrom(vod.vid);
  if (!vid) {
    throw new Error('视频上传未返回 VOD Vid，无法启动真实专家解析');
  }
  const cacheKey = `${context.sessionId}:${vid}`;
  const cached = understandingCache.get(cacheKey);
  if (cached && !context.forceRerunUnderstanding) {
    return cached;
  }
  const promise = (async () => {
    context.emit({ node: 'analyze_audio', message: '正在获取视频理解专家配置。', progress: 24 });
    const agents = await getViralUnderstandingAgentsWithWorker();
    const sdkAgents = rolesForUnderstanding(
      viralUnderstandingSdkAgentList(agents),
      context.forceRerunUnderstanding,
      context.rerunUnderstandingRoles,
    );
    const totalExperts = sdkAgents.length || 3;
    const durationSeconds = durationSecondsFromVod(vod);
    const estimatedAnalysisTime = formatRemakeAnalysisEstimate(durationSeconds);
    const existingUnderstanding = context.workflow.runtime.viralUnderstanding;
    const existingExecutions = !context.forceRerunUnderstanding && existingUnderstanding?.vid === vid
      ? persistedExecutions(existingUnderstanding.executions)
      : [];
    const understanding = existingExecutions.length ? null : await startViralUnderstandingWithWorker({
      vid,
      spaceName: vodSpaceNameFromUploadResult(vod),
      filePath: context.workflow.source.file?.filePath,
      roles: sdkAgents,
      billingContext: {
        userId: context.userId,
        sourceType: 'video_remake_understanding',
        sourceId: context.taskId || context.sessionId,
        taskId: context.taskId,
        sessionId: context.sessionId,
        durationSeconds,
      },
    });
    const executions = existingExecutions.length
      ? existingExecutions
      : Array.isArray(understanding?.executions) ? understanding.executions : [];
    if (!executions.length) {
      throw new Error('视频理解未返回可执行的专家任务');
    }
    const progressExecutions = serializableExecutions(executions);
    const billedRunIds = new Set<string>(
      Array.isArray(existingUnderstanding?.billedRunIds)
        ? existingUnderstanding.billedRunIds.filter((item: unknown): item is string => typeof item === 'string')
        : [],
    );
    context.workflow.runtime.viralUnderstanding = {
      vid,
      spaceName: vodSpaceNameFromUploadResult(vod),
      executions: progressExecutions,
      outputs: {},
      estimatedAnalysisTime,
      billedRunIds: Array.from(billedRunIds),
    };
    context.emit({
      node: 'analyze_visual',
      message: `视频解析中 0/${totalExperts}`,
      progress: 34,
      data: {
        completedExperts: 0,
        totalExperts,
        estimatedAnalysisTime,
        executions: serializableExecutionsWithProgress(executions, {}),
      },
    });
    const outputs: Record<string, ViralUnderstandingOutput> = {};
    let lastCompleted = -1;
    const intervalMs = Number(process.env.VIRAL_UNDERSTANDING_POLL_INTERVAL_MS || 10000);
    const maxAttempts = Number(process.env.VIRAL_UNDERSTANDING_POLL_MAX_ATTEMPTS || 120);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const results = await Promise.all(executions.map(async (execution: VodUnderstandingExecution) => ({
        execution,
        result: await getViralUnderstandingExecutionWithWorker(execution.runId),
      })));
      const failed = results.find(({ result }) => isUnderstandingFailed(result.status || ''));
      if (failed) {
        throw new Error(summarizeUnderstandingFailure(
          isRecord(failed.result) ? failed.result : {},
          failed.execution,
        ));
      }
      results.forEach(({ execution, result }) => {
        if (isUnderstandingCompleted(result.status || '') && (
          result.content
          || isRecord(result.raw)
          || isRecord(result.pictureInPicture)
          || isRecord(result.pipAssets)
        )) {
          outputs[execution.role] = {
            roleName: execution.roleName,
            content: result.content || '',
            raw: result.raw,
            pictureInPicture: isRecord(result.pictureInPicture) ? result.pictureInPicture : undefined,
            pipAssets: isRecord(result.pipAssets) ? result.pipAssets : undefined,
          };
          if (!billedRunIds.has(execution.runId)) {
            const tokenUsage = normalizeUnderstandingTokenUsage({
              raw: result.raw,
              prompt: execution.prompt,
              content: result.content,
            });
            const tokenFieldSummary = findUnderstandingTokenFieldSummary(result.raw);
            logger.info('video remake understanding token usage captured', {
              sessionId: context.sessionId,
              taskId: context.taskId,
              runId: execution.runId,
              role: execution.role,
              roleName: execution.roleName,
              tokenUsage,
              tokenFieldSummary,
              usedFallbackEstimate: !tokenFieldSummary && tokenUsage.totalTokens > 0,
              rawType: typeof result.raw,
            });
            recordVodUnderstandingUsage({
              userId: context.userId,
              sourceType: 'video_remake_understanding',
              sourceId: execution.runId,
              taskId: context.taskId,
              sessionId: context.sessionId,
              runId: execution.runId,
              inputTokens: tokenUsage.inputTokens,
              outputTokens: tokenUsage.outputTokens,
              requestSnapshot: {
                vid,
                spaceName: vodSpaceNameFromUploadResult(vod),
                role: execution.role,
                roleName: execution.roleName,
              },
              responseSnapshot: {
                status: result.status,
                contentChars: (result.content || '').length,
                tokenUsage,
                tokenFieldSummary,
              },
              usageRaw: isRecord(result.raw) ? result.raw : {},
            });
            billedRunIds.add(execution.runId);
            context.workflow.runtime.viralUnderstanding = {
              ...(context.workflow.runtime.viralUnderstanding || {}),
              billedRunIds: Array.from(billedRunIds),
            };
          }
        }
      });
      const completedExperts = Object.keys(outputs).length;
      context.workflow.runtime.viralUnderstanding = {
        ...(context.workflow.runtime.viralUnderstanding || {}),
        outputs,
        estimatedAnalysisTime,
        billedRunIds: Array.from(billedRunIds),
      };
      if (completedExperts !== lastCompleted) {
        lastCompleted = completedExperts;
        const executionsWithProgress = serializableExecutionsWithProgress(executions, outputs);
        context.emit({
          node: 'analyze_pip',
          message: `视频解析中 ${completedExperts}/${executions.length}`,
          progress: Math.min(54, 34 + Math.round((completedExperts / executions.length) * 20)),
          data: { completedExperts, totalExperts: executions.length, estimatedAnalysisTime, executions: executionsWithProgress },
        });
      }
      if (executions.every((execution) => hasCompletedUnderstandingOutput(execution.role, outputs[execution.role]))) {
        context.workflow.runtime.viralUnderstanding = {
          ...(context.workflow.runtime.viralUnderstanding || {}),
          outputs,
          estimatedAnalysisTime,
          billedRunIds: Array.from(billedRunIds),
        };
        const executionsWithProgress = serializableExecutionsWithProgress(executions, outputs);
        context.emit({
          node: 'analyze_pip',
          message: `视频解析完成 ${executions.length}/${executions.length}`,
          progress: 56,
          data: { completedExperts: executions.length, totalExperts: executions.length, estimatedAnalysisTime, executions: executionsWithProgress },
        });
        return outputs;
      }
      await sleep(intervalMs);
    }
    throw new Error('视频理解超时，请稍后重试');
  })();
  if (!context.forceRerunUnderstanding) {
    understandingCache.set(cacheKey, promise);
    promise.catch(() => understandingCache.delete(cacheKey));
  } else {
    understandingCache.delete(cacheKey);
  }
  return promise;
}

function scriptContent(workflow: VideoRemakeWorkflowState) {
  const artifact = workflow.artifacts.scriptContent;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return '';
  }
  return String((artifact as Record<string, unknown>).content || '').trim();
}

function voiceSetting(workflow: VideoRemakeWorkflowState) {
  const artifact = workflow.artifacts.voiceAudioSetting;
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {};
}

function characterSetting(workflow: VideoRemakeWorkflowState) {
  const artifact = workflow.artifacts.characterSetting;
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {};
}

function sceneSetting(workflow: VideoRemakeWorkflowState) {
  const artifact = workflow.artifacts.sceneSetting;
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {};
}

function pipSetting(workflow: VideoRemakeWorkflowState) {
  const artifact = workflow.artifacts.pipSetting;
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {};
}

function productSetting(workflow: VideoRemakeWorkflowState) {
  const artifact = workflow.artifacts.productSetting;
  return artifact && typeof artifact === 'object' && !Array.isArray(artifact)
    ? artifact as Record<string, unknown>
    : {};
}

function settingItems(value: Record<string, unknown>) {
  return Array.isArray(value.items) ? value.items.filter(isRecord) : [];
}

function requiredSettingItems(value: Record<string, unknown>) {
  return settingItems(value).filter((item) => item.required !== false);
}

function enabledSceneItems(value: Record<string, unknown>) {
  return requiredSettingItems(value);
}

function enabledProductItems(value: Record<string, unknown>) {
  if (Boolean(value.noProduct)) {
    return [];
  }
  return settingItems(value).filter((item) => item.required !== false && !Boolean(item.noProduct));
}

function storyboardDisallowsProducts(workflow: VideoRemakeWorkflowState) {
  return enabledProductItems(productSetting(workflow)).length === 0;
}

function usefulText(value: unknown) {
  const text = readableText(value)
    .replace(/；?因文本未提供具体像素坐标，?x、y、width、height\s*暂填\s*0。?/gu, '')
    .trim();
  if (!text || /^无$/u.test(text) || /^无。$/u.test(text) || /未提供|暂填/u.test(text)) {
    return '';
  }
  return text;
}

function uniqueUsefulLines(values: string[]) {
  const seen = new Set<string>();
  return values
    .flatMap((value) => value.split('\n'))
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || /^.+[:：]\s*无$/u.test(line) || /^无$/u.test(line)) {
        return false;
      }
      if (seen.has(line)) {
        return false;
      }
      seen.add(line);
      return true;
    });
}

function promptSectionText(title: string, content: string) {
  const lines = uniqueUsefulLines([content]);
  return lines.length ? `# ${title}\n${lines.join('\n')}` : '';
}

function speechPromptSectionText(title: string, content: string) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^.+[:：]\s*无$/u.test(line) && !/^无$/u.test(line));
  return lines.length ? `# ${title}\n${lines.join('\n')}` : '';
}

function promptSectionContent(text: string, title: string) {
  const pattern = new RegExp(`#\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n#\\s|$)`, 'u');
  return text.match(pattern)?.[1]?.trim() || '';
}

function entityTimingPromptLines(item: Record<string, unknown>) {
  const start = firstRecordNumber(item, ['startSecond', 'start', 'startTime', '开始时间', '开始秒']);
  const end = firstRecordNumber(item, ['endSecond', 'end', 'endTime', '结束时间', '结束秒']);
  const cue = firstRecordText(item, ['spokenCue', 'speckCue', 'narrationCue', 'speechCue', 'cue', '口播', '口播线索', '对应口播', '语境线索']);
  const keywords = recordKeywords(item);
  return [
    start !== undefined || end !== undefined ? `适用时间：${start ?? 0}s - ${end ?? 0}s` : '',
    cue ? `口播线索：${cue}` : '',
    keywords.length ? `关键词：${keywords.join('、')}` : '',
  ].filter(Boolean);
}

function scenePromptText(value: Record<string, unknown>) {
  const items = enabledSceneItems(value);
  if (!items.length) {
    return '';
  }
  return items.map((item, index) => [
    `${textFrom(item.label) || `场景 ${index + 1}`}`,
    usefulText(item.description),
    ...entityTimingPromptLines(item),
  ].filter(Boolean).join('\n')).filter((text) => uniqueUsefulLines([text]).length > 1).join('\n\n');
}

function expandedCharacterSettingItems(value: Record<string, unknown>) {
  const rawItems = settingItems(value);
  const initialItems = (rawItems.length ? rawItems : [{
    label: value.label,
    characterPrompt: characterPromptFromItem(value),
    required: value.required,
    assetId: value.assetId,
    groupId: value.groupId,
  }]).filter((item) => item.required !== false);
  const items = initialItems.flatMap((item) => {
    if (usefulText(item.assetId) || usefulText(item.groupId)) {
      return [item];
    }
    const mergedText = [
      textFrom(item.label),
      usefulText(characterPromptFromItem(item)),
    ].filter(Boolean).join('：');
    const splitCharacters = splitMergedIndexedEntityText(mergedText, ['人物', '角色']);
    if (splitCharacters.length < 2) {
      return [item];
    }
    return splitCharacters.map((entry) => ({
      ...item,
      label: entry.label,
      characterPrompt: entry.description,
    }));
  });
  return items;
}

function characterPromptText(value: Record<string, unknown>) {
  const items = expandedCharacterSettingItems(value);
  if (!items.length) {
    return '';
  }
  return items.map((item, index) => [
    `${textFrom(item.label) || `人物 ${index + 1}`}`,
    usefulText(item.assetId) || usefulText(item.groupId) ? '参考已选择人物素材' : '',
    usefulText(characterPromptFromItem(item)),
    ...entityTimingPromptLines(item),
  ].filter(Boolean).join('\n')).filter((text) => uniqueUsefulLines([text]).length > 1).join('\n\n');
}

type StoryboardEntity = {
  label: string;
  text: string;
  shotText: string;
  startSecond?: number;
  endSecond?: number;
  spokenCue?: string;
  keywords: string[];
};

function entityFromSettingItem(item: Record<string, unknown>, fallbackLabel: string, description: string): StoryboardEntity {
  const label = textFrom(item.label) || fallbackLabel;
  const startSecond = firstRecordNumber(item, ['startSecond', 'start', 'startTime', '开始时间', '开始秒']);
  const endSecond = firstRecordNumber(item, ['endSecond', 'end', 'endTime', '结束时间', '结束秒']);
  const spokenCue = firstRecordText(item, ['spokenCue', 'speckCue', 'narrationCue', 'speechCue', 'cue', '口播', '口播线索', '对应口播', '语境线索']);
  const keywords = recordKeywords(item);
  const cleanDescription = cleanReferencePromptText(description);
  return {
    label,
    text: uniqueUsefulLines([
      `${label}${cleanDescription ? `：${cleanDescription}` : ''}`,
    ]).join('\n'),
    shotText: uniqueUsefulLines([
      `${label}${cleanDescription ? `：${cleanDescription}` : ''}`,
    ]).join('\n'),
    startSecond,
    endSecond,
    spokenCue,
    keywords,
  };
}

function characterCoverageEntities(workflow: VideoRemakeWorkflowState) {
  return expandedCharacterSettingItems(characterSetting(workflow))
    .map((item, index) => entityFromSettingItem(
      item,
      `人物 ${index + 1}`,
      usefulText(characterPromptFromItem(item)),
    ))
    .filter((entity) => entity.label || entity.text);
}

function sceneCoverageEntities(workflow: VideoRemakeWorkflowState) {
  return enabledSceneItems(sceneSetting(workflow))
    .map((item, index) => entityFromSettingItem(
      item,
      `场景 ${index + 1}`,
      usefulText(item.description || item.scenePrompt),
    ))
    .filter((entity) => entity.label || entity.text);
}

function productCoverageEntities(workflow: VideoRemakeWorkflowState) {
  return enabledProductItems(productSetting(workflow))
    .map((item, index) => entityFromSettingItem(
      item,
      `产品 ${index + 1}`,
      [
        usefulText(item.description),
        usefulText(item.presentation),
        usefulText(item.feature),
      ].filter(Boolean).join('，'),
    ))
    .filter((entity) => entity.label || entity.text);
}

function characterCoverageLines(workflow: VideoRemakeWorkflowState) {
  return characterCoverageEntities(workflow).map((entity) => entity.text || entity.label).filter(Boolean);
}

function sceneCoverageLines(workflow: VideoRemakeWorkflowState) {
  return sceneCoverageEntities(workflow).map((entity) => entity.text || entity.label).filter(Boolean);
}

function productCoverageLines(workflow: VideoRemakeWorkflowState) {
  return productCoverageEntities(workflow).map((entity) => entity.text || entity.label).filter(Boolean);
}

function disabledSettingLabels(items: Record<string, unknown>[], fallbackPrefix: string, disabledCheck: (item: Record<string, unknown>) => boolean) {
  return items
    .filter(disabledCheck)
    .map((item, index) => textFrom(item.label) || `${fallbackPrefix} ${index + 1}`)
    .filter(Boolean);
}

function disabledEntityConstraintText(workflow: VideoRemakeWorkflowState) {
  const disabledCharacters = disabledSettingLabels(settingItems(characterSetting(workflow)), '人物', (item) => item.required === false);
  const disabledScenes = disabledSettingLabels(settingItems(sceneSetting(workflow)), '场景', (item) => item.required === false);
  const productValue = productSetting(workflow);
  const disabledProducts = Boolean(productValue.noProduct)
    ? ['全部产品']
    : disabledSettingLabels(settingItems(productValue), '产品', (item) => item.required === false || Boolean(item.noProduct));
  return [
    disabledCharacters.length ? `禁用人物：${disabledCharacters.join('、')}。分镜中不得出现这些人物标签、外观、动作或素材。` : '',
    disabledScenes.length ? `禁用场景：${disabledScenes.join('、')}。分镜中不得出现这些场景标签、环境描述、界面元素或素材。` : '',
    disabledProducts.length ? `禁用产品：${disabledProducts.join('、')}。分镜中不得出现这些产品标签、外观、包装或素材。` : '',
  ].filter(Boolean).join('\n');
}

function productPromptText(value: Record<string, unknown>) {
  const items = enabledProductItems(value);
  if (!items.length) {
    return '';
  }
  return items.map((item, index) => [
    `${textFrom(item.label) || `产品 ${index + 1}`}`,
    usefulText(item.description),
    usefulText(item.presentation) ? `展示方式：${usefulText(item.presentation)}` : '',
    usefulText(item.feature) ? `产品特征：${usefulText(item.feature)}` : '',
    ...entityTimingPromptLines(item),
  ].filter(Boolean).join('\n')).filter((text) => uniqueUsefulLines([text]).length > 1).join('\n\n');
}

function pipPromptText(value: Record<string, unknown>) {
  const pipText = (entry: unknown) => {
    const text = usefulText(entry);
    return text && !isNoPipText(text) ? text : '';
  };
  const items = settingItems(value).filter((item) => item.required !== false && (
    pipText(item.content)
    || pipText(item.replacementPrompt)
    || usefulText(item.replacementAssetUrl)
    || usefulText(item.replacementAssetId)
    || usefulText(item.replacementGroupId)
  ));
  if (!items.length) {
    return '';
  }
  const pipAssetUrl = (item: Record<string, unknown>) => absolutizeMaterialUrl(item.replacementAssetUrl) || usefulText(item.replacementAssetUrl);
  return [
    ...items.map((item, index) => [
      `画中画 ${index + 1}`,
      usefulText(item.startSecond) || usefulText(item.endSecond)
        ? `时间：${usefulText(item.startSecond) || 0}s - ${usefulText(item.endSecond) || 0}s`
        : '',
      usefulText(item.position) ? `位置：${usefulText(item.position)}` : '',
      pipAssetUrl(item)
        ? `图片素材：${usefulText(item.replacementAssetName) || usefulText(item.originalFileName) || '已上传图片'}（${pipAssetUrl(item)}）`
        : '',
      pipText(item.content) ? `内容：${pipText(item.content)}` : '',
      pipText(item.replacementPrompt) ? `替换提示词：${pipText(item.replacementPrompt)}` : '',
    ].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n\n');
}

function numericSecond(value: unknown) {
  const second = Number(value);
  return Number.isFinite(second) ? second : 0;
}

function pipItemsForStoryboardRange(workflow: VideoRemakeWorkflowState, startTime: number, endTime: number) {
  return settingItems(pipSetting(workflow)).filter((item) => {
    if (item.required === false) {
      return false;
    }
    const pipStart = numericSecond(item.startSecond);
    const pipEnd = numericSecond(item.endSecond);
    return pipEnd > pipStart && pipStart < endTime && pipEnd > startTime;
  });
}

type SeedanceReferenceContext = {
  userId: string;
  references: SeedanceReferenceIds;
};

function pipDescriptionForStoryboardRange(
  workflow: VideoRemakeWorkflowState,
  startTime: number,
  endTime: number,
  referenceContext?: SeedanceReferenceContext,
) {
  const pipText = (entry: unknown) => {
    const text = usefulText(entry);
    return text && !isNoPipText(text) ? text : '';
  };
  const pipAssetUrl = (item: Record<string, unknown>) => absolutizeMaterialUrl(item.replacementAssetUrl) || usefulText(item.replacementAssetUrl);
  return pipItemsForStoryboardRange(workflow, startTime, endTime).map((item, index) => {
    const referenceLabels = referenceContext
      ? settingItemReferenceLabels(referenceContext.userId, item, referenceContext.references)
      : [];
    const uniqueLabels = uniqueReferenceLabels(referenceLabels);
    return [
      `${usefulText(item.label) || `画中画 ${index + 1}`}：${numericSecond(item.startSecond)}s - ${numericSecond(item.endSecond)}s`,
      usefulText(item.position) ? `位置：${usefulText(item.position)}` : '',
      uniqueLabels.length ? `素材参考：${formatSeedanceReferenceLabels(uniqueLabels)}` : '',
      !uniqueLabels.length && pipAssetUrl(item)
        ? `图片素材：${usefulText(item.replacementAssetName) || usefulText(item.originalFileName) || '已上传图片'}（${pipAssetUrl(item)}）`
        : '',
      pipText(item.content) ? `内容：${pipText(item.content)}` : '',
      pipText(item.replacementPrompt) ? `替换提示词：${pipText(item.replacementPrompt)}` : '',
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}

function attachPipDescriptionsToStoryboard(
  storyboard: Array<Record<string, unknown>>,
  workflow: VideoRemakeWorkflowState,
  referenceContext?: SeedanceReferenceContext,
) {
  return storyboard.map((shot) => {
    const startTime = numericSecond(shot.startTime);
    const endTime = numericSecond(shot.endTime) || startTime + numericSecond(shot.duration);
    const pipDescription = pipDescriptionForStoryboardRange(workflow, startTime, endTime, referenceContext);
    return pipDescription ? { ...shot, pipDescription } : shot;
  });
}

function hasCharacterLabel(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const compactLabel = label.replace(/\s+/gu, '');
  const escapedCompact = compactLabel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`${escaped}|${escapedCompact}`, 'u').test(text.replace(/\s+/gu, ''));
}

function characterCoverageText(workflow: VideoRemakeWorkflowState) {
  const lines = characterCoverageLines(workflow);
  return lines.length >= 2 ? lines.join('\n') : '';
}

function normalizeMatchText(value: string) {
  return value.replace(/\s+/gu, '').toLowerCase();
}

function textIncludesCue(text: string, cue: string) {
  const normalizedText = normalizeMatchText(text);
  const normalizedCue = normalizeMatchText(cue);
  if (!normalizedCue || normalizedCue.length < 3) {
    return false;
  }
  if (normalizedText.includes(normalizedCue)) {
    return true;
  }
  const parts = cue
    .split(/[，,、。.!！？?；;\n]/u)
    .map((item) => normalizeMatchText(item))
    .filter((item) => item.length >= 4);
  return parts.some((part) => normalizedText.includes(part));
}

function entityOverlapsShot(entity: StoryboardEntity, startTime: number, endTime: number) {
  if (entity.startSecond === undefined || entity.endSecond === undefined || entity.endSecond <= entity.startSecond) {
    return false;
  }
  return entity.startSecond < endTime && entity.endSecond > startTime;
}

function entityCueMatchesShot(entity: StoryboardEntity, narrationText: string, combinedText: string) {
  if (entity.spokenCue && (textIncludesCue(narrationText, entity.spokenCue) || textIncludesCue(combinedText, entity.spokenCue))) {
    return true;
  }
  return entity.keywords.some((keyword) => textIncludesCue(narrationText, keyword) || textIncludesCue(combinedText, keyword));
}

function selectEntitiesForShot(entities: StoryboardEntity[], input: {
  combinedText: string;
  narrationText: string;
  startTime: number;
  endTime: number;
}) {
  if (!entities.length) {
    return [];
  }
  return entities.filter((entity) => {
    if (entity.label && hasCharacterLabel(input.combinedText, entity.label)) {
      return true;
    }
    if (entityOverlapsShot(entity, input.startTime, input.endTime)) {
      return true;
    }
    return entityCueMatchesShot(entity, input.narrationText, input.combinedText);
  });
}

function ensureStoryboardEntityCoverage(storyboard: Array<Record<string, unknown>>, workflow: VideoRemakeWorkflowState) {
  const characters = characterCoverageEntities(workflow);
  if (!characters.length) {
    return storyboard;
  }
  return storyboard.map((shot) => {
    const startTime = numericSecond(shot.startTime);
    const endTime = numericSecond(shot.endTime) || startTime + numericSecond(shot.duration);
    const visualText = usefulText(shot.visualDescription);
    const actionText = usefulText(shot.actionDescription);
    const remakeText = usefulText(shot.remakeSuggestion);
    const narrationText = usefulText(shot.narration);
    const combined = `${visualText}\n${actionText}\n${remakeText}\n${narrationText}`;
    const selectionInput = { combinedText: combined, narrationText, startTime, endTime };
    const selectedCharacters = selectEntitiesForShot(characters, selectionInput);
    const nextCharacters = selectedCharacters.filter((entity) => entity.label && !hasCharacterLabel(actionText, entity.label));
    const nextActionDescription = stripStoryboardEntityDetailBlocks(nextCharacters.length
      ? uniqueUsefulLines([actionText, nextCharacters.map((entity) => entity.shotText || entity.text || entity.label).join('\n')]).join('\n')
      : actionText);
    const nextRemakeSuggestion = sanitizeStoryboardRemakeSuggestion(remakeText);
    if (nextActionDescription === actionText && nextRemakeSuggestion === remakeText) {
      return shot;
    }
    return {
      ...shot,
      actionDescription: nextActionDescription,
      remakeSuggestion: nextRemakeSuggestion,
    };
  });
}

function isForbiddenProductStoryboardLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  return /^(?:产品|商品|货品)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/u.test(trimmed);
}

function isForbiddenProductStoryboardClause(clause: string) {
  const trimmed = clause.trim();
  if (!trimmed) {
    return false;
  }
  return /(?:产品\s*[A-Za-z\d一二三四五六七八九十]*|商品|货品|包装|实物商品|商品实物|产品特写|商品特写|对应产品|对应商品|展示产品|展示商品|产品核心特征|商品核心特征|产品卖点|商品卖点|产品图|商品图|产品轮廓|商品轮廓|商品示意图|产品示意图|不需要产品展示)/u.test(trimmed);
}

function stripProductReferencesFromStoryboardField(value: unknown) {
  const text = usefulText(value);
  if (!text) {
    return '';
  }
  return text
    .split('\n')
    .map((line) => {
      if (isForbiddenProductStoryboardLine(line)) {
        return '';
      }
      const clauses = line
        .split(/[，,。；;]/u)
        .map((clause) => clause.trim())
        .filter(Boolean)
        .filter((clause) => !isForbiddenProductStoryboardClause(clause));
      return clauses.join('，').trim();
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function sanitizeStoryboardForConfirmedSettings(
  storyboard: Array<Record<string, unknown>>,
  workflow: VideoRemakeWorkflowState,
) {
  if (!storyboardDisallowsProducts(workflow)) {
    return storyboard;
  }
  return storyboard.map((shot) => ({
    ...shot,
    visualDescription: stripProductReferencesFromStoryboardField(shot.visualDescription),
    actionDescription: stripProductReferencesFromStoryboardField(shot.actionDescription),
    remakeSuggestion: stripProductReferencesFromStoryboardField(shot.remakeSuggestion),
  }));
}

function audioPromptText(value: Record<string, unknown>) {
  const items = settingItems(value);
  return [
    usefulText(value.voice) ? `声音：${usefulText(value.voice)}` : '',
    usefulText(value.voiceStyle) ? `声音描述：${usefulText(value.voiceStyle)}` : '',
    usefulText(value.bgm) ? `BGM：${usefulText(value.bgm)}` : '',
    usefulText(value.soundEffects) ? `音效：${usefulText(value.soundEffects)}` : '',
    ...items.map((item, index) => [
      textFrom(item.label) || `人物 ${index + 1} 声音`,
      usefulText(item.voice),
      usefulText(item.voiceStyle),
    ].filter(Boolean).join('：')),
  ].filter(Boolean).join('\n');
}

function seedanceAudioBoundaryConstraint() {
  return [
    '音频边界：每段和整片结尾只允许人声自然停止，最后 0.3-0.5 秒保持安静或轻微淡出。',
    '禁止在句尾、段尾或画面切换处添加提示音、转场音、点击音、风噪突增、爆音、尾音、杂音或额外拟音。',
    '如果口播早于画面结束，剩余时间保持安静环境底噪，不补口头语、不补音效。',
  ].join('\n');
}

type SeedanceReferenceIds = {
  referenceImageIds: string[];
  referenceVideoIds: string[];
  referenceAudioIds: string[];
};

type ReferencePrimerGap = {
  kind: 'character' | 'scene' | 'voice' | 'product';
  label: string;
};

type ReferencePrimerSceneSpan = {
  spanId: string;
  segmentIndexes: number[];
  segmentStartIndex: number;
  segmentEndIndex: number;
  sceneLabels: string[];
  people: string[];
  narration: string;
  gapKinds: ReferencePrimerGap['kind'][];
  primer?: ReferencePrimerRecord;
};

type ReferencePrimerRecord = {
  assetId: string;
  videoUrl: string;
  url?: string;
  jobId?: string;
  spokenSentence: string;
  durationSeconds: number;
  gaps: ReferencePrimerGap[];
  spanId?: string;
  sceneLabels?: string[];
  people?: string[];
  segmentIndexes?: number[];
};

type ReferencePrimerPlan = {
  mode: 'single' | 'scene_spans' | 'rapid_switch_fallback';
  spans: ReferencePrimerSceneSpan[];
  segmentPrimerMap: Record<string, string>;
};

function materialAssetIds(items: unknown) {
  return (Array.isArray(items) ? items : [])
    .filter(isRecord)
    .map((asset) => textFrom(asset.id))
    .filter(Boolean);
}

function seedanceReferenceIdsFromMaterialContext(materialContext: ReturnType<typeof resolveVideoMaterialContext>): SeedanceReferenceIds {
  const references: Record<string, unknown> = isRecord(materialContext.references) ? materialContext.references : {};
  const imageGroup = isRecord(references.imageGroup) ? references.imageGroup : {};
  const audioGroup = isRecord(references.audioGroup) ? references.audioGroup : {};
  const unique = (items: string[]) => Array.from(new Set(items));
  return {
    referenceImageIds: unique([
      ...materialAssetIds(references.images),
      ...materialAssetIds(imageGroup.assets),
    ]),
    referenceVideoIds: unique([
      ...materialAssetIds(references.videos),
    ]),
    referenceAudioIds: unique([
      ...materialAssetIds(references.audios),
      ...materialAssetIds(audioGroup.assets),
    ]),
  };
}

function materialContextWithExtraVideoReference(
  materialContext: ReturnType<typeof resolveVideoMaterialContext>,
  videoReference: ReturnType<typeof resolveVideoMaterialContext>['references']['videos'][number],
): ReturnType<typeof resolveVideoMaterialContext> {
  const references = materialContext.references;
  const videos = Array.isArray(references.videos) ? references.videos.filter(isRecord) : [];
  return {
    ...materialContext,
    references: {
      ...references,
      videos: [...videos, videoReference],
    },
  };
}

function ephemeralVideoReferenceAsset(input: {
  id: string;
  name: string;
  fileUrl: string;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    groupId: '',
    name: input.name,
    description: '',
    fileUrl: input.fileUrl,
    filePath: '',
    url: input.fileUrl,
    mimeType: 'video/mp4',
    resourceType: 'finished_video' as const,
    originalFileName: `${input.id}.mp4`,
    metadata: input.metadata || {},
  };
}

function segmentRegenerationReferenceVideo(input: {
  workflow: VideoRemakeWorkflowState;
  cardData: Record<string, unknown>;
  mergedSegments: Record<string, unknown>[];
  segmentIndex: number;
}) {
  const plan = primerPlanFromRuntime(input.workflow, input.cardData);
  const mappedSpan = primerSpanForSegment(plan, input.segmentIndex);
  if (input.segmentIndex <= 1 || isPrimerSceneBoundary(plan, input.segmentIndex)) {
    const primer = isRecord(mappedSpan?.primer)
      ? mappedSpan?.primer
      : isRecord(input.workflow.runtime.referencePrimer)
        ? input.workflow.runtime.referencePrimer
        : undefined;
    const primerUrl = publicMaterialUrl(primer?.videoUrl) || publicMaterialUrl(primer?.url);
    if (!primerUrl) {
      return null;
    }
    return {
      source: 'reference_primer' as const,
      asset: ephemeralVideoReferenceAsset({
        id: String(primer?.assetId || `reference-primer-${input.segmentIndex}`),
        name: '分段参考视频',
        fileUrl: primerUrl,
        metadata: {
          ...(isRecord(primer) ? primer : {}),
          source: 'video_remake_reference_primer',
          url: primerUrl,
        },
      }),
    };
  }

  const previousSegment = input.mergedSegments[input.segmentIndex - 2] || {};
  const previousUrl = publicMaterialUrl(previousSegment.videoUrl || previousSegment.fileUrl || previousSegment.url);
  if (!previousUrl) {
    return null;
  }
  return {
    source: 'previous_segment' as const,
    asset: ephemeralVideoReferenceAsset({
      id: `segment-regeneration-reference-${input.segmentIndex - 1}`,
      name: `分段 ${input.segmentIndex - 1} 参考视频`,
      fileUrl: previousUrl,
      metadata: {
        source: 'video_remake_segment_previous_reference',
        segmentIndex: input.segmentIndex - 1,
        url: previousUrl,
      },
    }),
  };
}

function itemHasConcreteAssetReference(item: Record<string, unknown>) {
  return Boolean(
    textFrom(item.assetId || item.materialId || item.replacementAssetId || item.voiceAssetId)
    || textFrom(item.groupId || item.materialGroupId || item.replacementGroupId || item.voiceGroupId)
    || isRecord(item.asset)
    || isRecord(item.material),
  );
}

function itemUsesPromptReference(item: Record<string, unknown>) {
  const mode = textFrom(item.referenceMode);
  return mode !== 'asset' && !itemHasConcreteAssetReference(item);
}

function referencePrimerGapSummary(gaps: ReferencePrimerGap[]) {
  const grouped = gaps.reduce<Record<ReferencePrimerGap['kind'], string[]>>((acc, gap) => {
    acc[gap.kind].push(gap.label);
    return acc;
  }, {
    character: [],
    scene: [],
    voice: [],
    product: [],
  });
  return [
    grouped.character.length ? `人物：${grouped.character.join('、')}` : '',
    grouped.scene.length ? `场景：${grouped.scene.join('、')}` : '',
    grouped.voice.length ? `声音：${grouped.voice.join('、')}` : '',
    grouped.product.length ? `产品：${grouped.product.join('、')}` : '',
  ].filter(Boolean).join('；');
}

function referencePrimerGaps(workflow: VideoRemakeWorkflowState, materialContext: ReturnType<typeof resolveVideoMaterialContext>) {
  const material = materialContext as Record<string, unknown>;
  const gaps: ReferencePrimerGap[] = [];
  expandedCharacterSettingItems(characterSetting(workflow)).forEach((item, index) => {
    if (item.required !== false && itemUsesPromptReference(item)) {
      gaps.push({ kind: 'character', label: textFrom(item.label) || `人物 ${index + 1}` });
    }
  });
  enabledSceneItems(sceneSetting(workflow)).forEach((item, index) => {
    if (itemUsesPromptReference(item)) {
      gaps.push({ kind: 'scene', label: textFrom(item.label) || `场景 ${index + 1}` });
    }
  });
  const voiceValue = voiceSetting(workflow);
  const voiceItems = settingItems(voiceValue).filter((item) => item.required !== false);
  voiceItems.forEach((item, index) => {
    if (itemUsesPromptReference(item)) {
      gaps.push({ kind: 'voice', label: textFrom(item.label) || `人物 ${index + 1} 声音` });
    }
  });
  if (!voiceItems.length && !Boolean(material.voice) && (usefulText(voiceValue.voice) || usefulText(voiceValue.voiceStyle) || usefulText(voiceValue.bgm) || usefulText(voiceValue.soundEffects))) {
    gaps.push({ kind: 'voice', label: '声音' });
  }
  enabledProductItems(productSetting(workflow)).forEach((item, index) => {
    if (itemUsesPromptReference(item)) {
      gaps.push({ kind: 'product', label: textFrom(item.label) || `产品 ${index + 1}` });
    }
  });
  return gaps;
}

function referencePrimerPromptConstraint(gaps: ReferencePrimerGap[]) {
  const summary = referencePrimerGapSummary(gaps);
  if (!summary) {
    return '';
  }
  return [
    '# 临时参考视频',
    `参考视频1只可作为以下未提供素材项的临时参考：${summary}。`,
    '已有素材的人物、场景、声音或产品必须严格以对应素材为准，不得被参考视频覆盖或替代。',
    '当前分段指定的人物、场景、声音或产品标签不在上述适用范围内时，不得使用参考视频中对应类别的信息；例如参考视频只覆盖场景1，当前分段使用场景2时，不要参考视频里的场景，只按场景2的提示词或素材生成。',
    '参考视频只提供缺素材项的形象、氛围、镜头质感、口播音色或节奏参考；各分段仍严格按本段提示词生成，不复用参考视频里的完整台词或画面顺序。',
  ].join('\n');
}

function settingItemReferenceLabels(userId: string, item: Record<string, unknown>, references: SeedanceReferenceIds) {
  const groupLabels = [
    item.groupId,
    item.materialGroupId,
    item.replacementGroupId,
    item.voiceGroupId,
  ].flatMap((groupId) => {
    const id = textFrom(groupId);
    if (!id) {
      return [];
    }
    const group = contentRepository.findGroup(id);
    if (!group || group.userId !== userId) {
      return [];
    }
    return contentRepository
      .listAssets({ userId, groupId: group.id })
      .flatMap((asset) => seedanceAssetReferenceLabels(asset.id, references));
  });
  return uniqueReferenceLabels([
    ...seedanceAssetReferenceLabels(textFrom(item.assetId || item.materialId), references),
    ...seedanceAssetReferenceLabels(textFrom(item.replacementAssetId), references),
    ...seedanceAssetReferenceLabels(textFrom(item.voiceAssetId), references),
    ...seedanceAssetReferenceLabels(textFrom(isRecord(item.asset) ? item.asset.id || item.asset.assetId : undefined), references),
    ...seedanceAssetReferenceLabels(textFrom(isRecord(item.material) ? item.material.id || item.material.assetId : undefined), references),
    ...groupLabels,
  ]);
}

function promptReferenceLine(prefix: string, labels: string[], suffix: string) {
  const uniqueLabels = uniqueReferenceLabels(labels);
  return uniqueLabels.length ? `${prefix}${formatSeedanceReferenceLabels(uniqueLabels)}${suffix}` : '';
}

function settingReferenceLines(
  userId: string,
  items: Record<string, unknown>[],
  references: SeedanceReferenceIds,
  fallbackPrefix: string,
  suffix: string,
) {
  return items.map((item, index) => {
    const labels = uniqueReferenceLabels(settingItemReferenceLabels(userId, item, references));
    if (!labels.length) {
      return '';
    }
    const label = textFrom(item.label) || `${fallbackPrefix}${index + 1}`;
    return `${label} 对应${formatSeedanceReferenceLabels(labels)}；${suffix}`;
  }).filter(Boolean);
}

function seedanceReferenceGuide(userId: string, workflow: VideoRemakeWorkflowState, references: SeedanceReferenceIds) {
  const lines: string[] = [];
  const characterItems = expandedCharacterSettingItems(characterSetting(workflow));
  const sceneItems = enabledSceneItems(sceneSetting(workflow));
  const productItems = enabledProductItems(productSetting(workflow));
  const pipItems = settingItems(pipSetting(workflow)).filter((item) => item.required !== false);
  const characterLabels = characterItems.flatMap((item) => settingItemReferenceLabels(userId, item, references));
  const sceneLabels = sceneItems.flatMap((item) => settingItemReferenceLabels(userId, item, references));
  const productLabels = productItems.flatMap((item) => settingItemReferenceLabels(userId, item, references));
  const pipLabels = pipItems.flatMap((item) => settingItemReferenceLabels(userId, item, references));
  const audioLabels = references.referenceAudioIds.map((_, index) => `音频${index + 1}`);
  const itemLines = [
    ...settingReferenceLines(
      userId,
      characterItems,
      references,
      '人物',
      '人物外观、服装、发型、体型和整体形象以对应素材为准；动作、表情和讲解节奏以分镜脚本为准。',
    ),
    ...settingReferenceLines(
      userId,
      sceneItems,
      references,
      '场景',
      '场景环境、空间层次和光线氛围以对应素材为准；不要生成与参考场景冲突的新环境。',
    ),
    ...settingReferenceLines(
      userId,
      productItems,
      references,
      '产品',
      '产品或物品外观以对应素材为准；不要生成旧产品、旧包装或旧 Logo。',
    ),
    ...settingReferenceLines(
      userId,
      pipItems,
      references,
      '画中画',
      '素材只用于对应画中画内部替换，保留大致位置、层级和信息功能，不作为主画面人物、场景或产品参考。',
    ),
  ];

  const characterLine = promptReferenceLine(
    '人物外观、服装、发型、体型和整体形象以',
    characterLabels,
    '中的人物为准；动作、表情和讲解节奏以分镜脚本为准。',
  );
  const sceneLine = promptReferenceLine(
    '场景环境、空间层次和光线氛围以',
    sceneLabels,
    '中的场景为准；不要生成与参考场景冲突的新环境。',
  );
  const productLine = promptReferenceLine(
    '产品或物品外观以',
    productLabels,
    '中的素材为准；不要生成旧产品、旧包装或旧 Logo。',
  );
  const pipLine = promptReferenceLine(
    '画中画内部替换素材以',
    pipLabels,
    '为准；保留大致位置、层级和信息功能。',
  );
  lines.push(...itemLines);
  if (!itemLines.length) {
    if (characterLine) lines.push(characterLine);
    if (sceneLine) lines.push(sceneLine);
    if (productLine) lines.push(productLine);
    if (pipLine) lines.push(pipLine);
  }
  const audioBindingLines = buildVideoRemakeSeedanceAudioBindingLines(voiceSetting(workflow), references.referenceAudioIds);
  if (audioBindingLines.length) {
    lines.push(...audioBindingLines);
  } else if (audioLabels.length) {
    lines.push(`人声/音频参考以${audioLabels.map((label) => `参考${label}`).join('、')}为准；只参考音色、语速和口播节奏，不复用素材原始台词，不复刻素材里的杂音、尾音、点击声或转场声。`);
  }
  return uniqueUsefulLines(lines).join('\n');
}

function buildGlobalPrompt(workflow: VideoRemakeWorkflowState) {
  return [
    '# 生成规则',
    '生成纯画面视频；不要添加字幕、文字浮层、标题条、水印、Logo 或界面元素。',
    '人声只走音轨，不进入画面；只能朗读已确认口播内容，不新增结束语或行动号召。',
    '',
    promptSectionText('人物', characterPromptText(characterSetting(workflow))),
    promptSectionText('场景', scenePromptText(sceneSetting(workflow))),
    promptSectionText('产品', productPromptText(productSetting(workflow))),
    promptSectionText('音频', [
      audioPromptText(voiceSetting(workflow)),
      '语速中等自然，咬字清晰，每秒中文约 4 个字以内。',
      'BGM：默认不生成；只有用户明确填写 BGM 时才使用，且不能压过人声。',
      '音效：默认不生成额外音效；不要添加转场音、点击音、提示音或动作拟音。',
      seedanceAudioBoundaryConstraint(),
    ].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function buildSeedanceSystemPrompt(workflow: VideoRemakeWorkflowState) {
  return [
    buildGlobalPrompt(workflow),
  ].filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function parseSpokenSegments(content: string) {
  const segments = collectSpokenSegmentUnits(content);
  if (segments.length) {
    return mergeSemanticSpokenSegments(segments.sort((left, right) => left.startTime - right.startTime));
  }

  const clauses = content
    .split(/(?:[。！？!?]\s*|\n+)/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const fallback = clauses.length ? clauses : ['开场抛出问题', '中段给出解决方案', '结尾展示结果'];
  return mergeSemanticSpokenSegments(fallback.map((narration, index) => ({
    narration,
    startTime: index * 4,
    endTime: (index + 1) * 4,
  })));
}

function collectSpokenSegmentUnits(content: string) {
  const segments: Array<{ narration: string; startTime: number; endTime: number }> = [];
  const speakerPattern = '(?:口播|台词|旁白(?:\\s*\\d+)?|人物\\s*[A-Za-z\\d一二三四五六七八九十]+|角色\\s*[A-Za-z\\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)';
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\d+[.、]\\s*)?(${speakerPattern})\\s*[:：]\\s*([^\\n]*?)(?:[，,；;]\\s*)?时间\\s*[:：]\\s*([0-9.]+)\\s*s?\\s*[-~—–至到]\\s*([0-9.]+)\\s*s?`, 'giu');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const speaker = textFrom(match[1]).replace(/\s+/gu, '');
    const speech = textFrom(match[2]).replace(/\s+/gu, ' ').trim();
    const narration = speaker ? `${speaker}：${speech}` : speech;
    const startTime = Number(match[3]);
    const endTime = Number(match[4]);
    if (narration && Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
      segments.push({ narration, startTime, endTime });
    }
  }
  const inlinePattern = new RegExp(`(?:^|\\n)\\s*(?:\\d+[.、]\\s*)?(${speakerPattern})\\s*[:：]\\s*([^\\n]+?)\\s+([0-9.]+)\\s*s?\\s*[-~—–至到]\\s*([0-9.]+)\\s*s?\\s*(?=\\n|$)`, 'giu');
  while ((match = inlinePattern.exec(content)) !== null) {
    const speaker = textFrom(match[1]).replace(/\s+/gu, '');
    const speech = textFrom(match[2]).replace(/\s+/gu, ' ').trim();
    const narration = speaker ? `${speaker}：${speech}` : speech;
    const startTime = Number(match[3]);
    const endTime = Number(match[4]);
    const key = `${startTime}-${endTime}-${narration}`;
    const exists = segments.some((segment) => `${segment.startTime}-${segment.endTime}-${segment.narration}` === key);
    if (!exists && narration && Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
      segments.push({ narration, startTime, endTime });
    }
  }
  const inferredSegments = inferUntimedSpokenSegments(content, segments);
  if (inferredSegments.length) {
    segments.push(...inferredSegments);
  }
  return segments.sort((left, right) => left.startTime - right.startTime);
}

function inferUntimedSpokenSegments(
  content: string,
  timedSegments: Array<{ narration: string; startTime: number; endTime: number }>,
) {
  if (!timedSegments.length) {
    return [];
  }
  const speakerPattern = '(口播|台词|旁白(?:\\s*\\d+)?|人物\\s*[A-Za-z\\d一二三四五六七八九十]+|角色\\s*[A-Za-z\\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)';
  const timedLinePattern = new RegExp(`^\\s*(?:\\d+[.、]\\s*)?${speakerPattern}\\s*[:：]\\s*([^\\n]*?)(?:[，,；;。]?\\s*)时间\\s*[:：]\\s*([0-9.]+)\\s*s?\\s*[-~—–至到]\\s*([0-9.]+)\\s*s?`, 'iu');
  const untimedLinePattern = new RegExp(`^\\s*(?:\\d+[.、]\\s*)?${speakerPattern}\\s*[:：]\\s*(.+?)\\s*[。.]?\\s*$`, 'iu');
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const timedByLine = lines.map((line) => {
    const match = line.match(timedLinePattern);
    if (!match) {
      return null;
    }
    const speaker = textFrom(match[1]).replace(/\s+/gu, '');
    const speech = textFrom(match[2]).replace(/\s+/gu, ' ').trim();
    return {
      narration: `${speaker}：${speech}`,
      startTime: Number(match[3]),
      endTime: Number(match[4]),
    };
  });
  const inferred: Array<{ narration: string; startTime: number; endTime: number }> = [];
  lines.forEach((line, index) => {
    if (timedByLine[index]) {
      return;
    }
    const match = line.match(untimedLinePattern);
    if (!match || /时间\s*[:：]/u.test(line)) {
      return;
    }
    const speaker = textFrom(match[1]).replace(/\s+/gu, '');
    const speech = textFrom(match[2]).replace(/\s+/gu, ' ').trim();
    if (!speaker || !speech) {
      return;
    }
    const previous = timedByLine.slice(0, index).reverse().find(Boolean) || timedSegments[timedSegments.length - 1];
    const next = timedByLine.slice(index + 1).find(Boolean);
    const previousEnd = Number(previous?.endTime);
    const nextStart = Number(next?.startTime);
    if (!Number.isFinite(previousEnd)) {
      return;
    }
    const hasGapBeforeNext = Number.isFinite(nextStart) && nextStart > previousEnd;
    const inferredDuration = hasGapBeforeNext
      ? Math.min(1, Math.max(0.2, nextStart - previousEnd))
      : 0.2;
    const startTime = hasGapBeforeNext
      ? previousEnd
      : Math.max(0, Number((previousEnd - inferredDuration).toFixed(2)));
    const endTime = hasGapBeforeNext
      ? Number((startTime + inferredDuration).toFixed(2))
      : previousEnd;
    inferred.push({
      narration: `${speaker}：${speech}`,
      startTime,
      endTime,
    });
  });
  return inferred;
}

function mergeSemanticSpokenSegments(segments: Array<{ narration: string; startTime: number; endTime: number }>) {
  const merged: Array<{ narration: string; startTime: number; endTime: number }> = [];
  let current: { narration: string; startTime: number; endTime: number } | null = null;
  const targetMinSeconds = 4;
  const targetMaxSeconds = 10;

  const appendToCurrent = (segment: { narration: string; startTime: number; endTime: number }) => {
    if (!current) {
      current = { ...segment };
      return;
    }
    current = {
      ...current,
      narration: [current.narration, segment.narration].filter(Boolean).join('\n'),
      endTime: segment.endTime,
    };
  };

  const estimatedSeconds = (text: string) => Math.max(1, estimateStoryboardSeconds(text) - 2);

  const flush = () => {
    if (current) {
      merged.push(current);
      current = null;
    }
  };

  segments.forEach((segment) => {
    const currentDuration = current ? Math.max(1, current.endTime - current.startTime) : 0;
    const mergedText = current ? `${current.narration}\n${segment.narration}` : segment.narration;
    const shouldMerge = Boolean(
      current
      && (currentDuration < targetMinSeconds || estimatedSeconds(mergedText) <= targetMaxSeconds)
    );

    if (!current || shouldMerge) {
      appendToCurrent(segment);
      return;
    }
    flush();
    appendToCurrent(segment);
  });

  flush();
  return merged.map((segment, index) => ({
    ...segment,
    narration: segment.narration.replace(/\n{2,}/gu, '\n').trim(),
    startTime: index === 0 ? 0 : segment.startTime,
  }));
}

function visualForShot(index: number, total: number) {
  if (index === 0) {
    return '开场承接口播重点，快速给出视觉钩子。';
  }
  if (index === total - 1) {
    return '收束到关键场景或产品细节，完成信息闭环。';
  }
  return '人物、场景与产品信息按口播节奏切换，保持信息密度。';
}

function firstUsefulLine(text: string) {
  return uniqueUsefulLines([text])[0] || '';
}

function usefulSectionLines(text: string, labelPattern: RegExp) {
  return uniqueUsefulLines([text.replace(labelPattern, '')]);
}

function fallbackStoryboardContext(workflow: VideoRemakeWorkflowState) {
  const characterText = characterPromptText(characterSetting(workflow));
  const sceneText = scenePromptText(sceneSetting(workflow));
  const productText = productPromptText(productSetting(workflow));
  const pipText = pipPromptText(pipSetting(workflow));
  const audioText = audioPromptText(voiceSetting(workflow));
  const characterLines = usefulSectionLines(characterText, /^人物\s*\d+\s*$/gmu);
  const sceneLines = usefulSectionLines(sceneText, /^场景\s*\d+\s*$/gmu);
  return {
    character: characterLines.join('\n'),
    scene: sceneLines.join('\n'),
    product: firstUsefulLine(productText.replace(/^产品\s*\d+\s*$/gmu, '')),
    pip: firstUsefulLine(pipText.replace(/^画中画\s*\d+\s*$/gmu, '')),
    audio: firstUsefulLine(audioText),
  };
}

function fallbackVisualForShot(index: number, total: number, context: ReturnType<typeof fallbackStoryboardContext>) {
  const base = visualForShot(index, total);
  return [
    base,
    context.scene ? `场景：${context.scene}` : '',
    context.product ? `产品/主体：${context.product}` : '',
    context.pip ? `画中画：${context.pip}` : '',
  ].filter(Boolean).join('\n');
}

function fallbackActionForShot(context: ReturnType<typeof fallbackStoryboardContext>) {
  return context.character || '人物按已确认设定自然出镜，动作配合口播节奏。';
}

function fallbackSoundForShot(context: ReturnType<typeof fallbackStoryboardContext>) {
  return context.audio || '安静自然的人声录制环境，不额外添加动作音效或转场音。';
}

function fallbackRemakeSuggestion(context: ReturnType<typeof fallbackStoryboardContext>) {
  return [
    context.pip ? '画中画按本镜头时间范围自然叠加，不遮挡主体。' : '',
    '口播节奏与本镜头台词保持一致。',
  ].filter(Boolean).join('\n');
}

function fieldFromStoryboardBlock(block: string, label: string) {
  const fieldLabels = '时间段|画面|人物/动作|人物动作|动作|台词/旁白|台词|旁白|口播|人声|音效|复刻建议';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:(?:[-*]\\s*)?${escapedLabel}\\s*[:：]|#{1,6}\\s*${escapedLabel}\\s*)\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:(?:[-*]\\s*)?(?:${fieldLabels})\\s*[:：]|#{1,6}\\s*(?:${fieldLabels})\\s*(?:\\n|$))|$)`, 'u');
  return block.match(pattern)?.[1]?.trim() || '';
}

function stripNestedStoryboardFields(value: string, options?: { keepSpeechLabels?: boolean }) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (options?.keepSpeechLabels && /^(?:[-*]\s*)?(?:旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[：:]/u.test(line)) {
        return true;
      }
      return !/^(?:[-*]\s*)?(?:画面|人物\/动作|人物动作|动作|台词\/旁白|台词|旁白|口播|人声|音效|复刻建议)\s*[：:]/u.test(line);
    })
    .join('\n')
    .trim();
}

function stripStoryboardEntityDetailBlocks(value: string) {
  const lines = value.split('\n');
  const result: string[] = [];
  let skippingEntityBlock = false;
  const isEntityHeading = (line: string) => /^(?:人物|角色|场景|产品|画中画)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/u.test(line.trim());
  const isEntityDetailLine = (line: string) => /^(?:人物描述|场景描述|产品描述|外观|动作|表情|气质|声线|环境|环境布置|拍摄地点|空间层次|光线氛围|灯光|构图|机位|氛围|道具|适用时间|时间范围|口播线索|对应口播|语境线索|关键词)\s*[：:]/u.test(line.trim());
  for (const line of lines) {
    const trimmed = line.trim();
    if (isEntityDetailLine(trimmed)) {
      continue;
    }
    if (isEntityHeading(trimmed)) {
      skippingEntityBlock = true;
      continue;
    }
    if (skippingEntityBlock) {
      if (isEntityDetailLine(trimmed)) {
        continue;
      }
      skippingEntityBlock = false;
    }
    result.push(line);
  }
  return result.join('\n').trim();
}

function sanitizeStoryboardRemakeSuggestion(value: string) {
  return stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(value))
    .split(/\n|[。；;]/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:人物|角色|场景|产品|画中画|环境|环境布置|拍摄地点|空间层次|光线氛围|灯光|构图|机位|氛围|道具|外观|动作|表情|气质|声线|人物描述|场景描述|产品描述)\s*[A-Za-z\d一二三四五六七八九十]*\s*[：:]/u.test(line))
    .filter((line) => !/(?:适用时间|时间范围|口播线索|对应口播|语境线索|关键词)\s*[：:]/u.test(line))
    .filter((line) => !/上一(?:镜头|段|个镜头)|上一个镜头|前一(?:镜头|段)/u.test(line))
    .filter((line) => !/保持(?:机位|光线参数|拍摄参数|参数|镜头参数|画面参数)(?:统一|一致|不变)?/u.test(line))
    .filter((line) => !/不要切换景别|不(?:要|需)切换景别|避免人物?出现大幅度?位移|人物不要出现大幅度?位移/u.test(line))
    .join('\n');
}

function parseStoryboardMarkdown(content: string) {
  const normalized = content.replace(/[－—–~～至到]/gu, '-').trim();
  if (!normalized) {
    return [];
  }
  const headingPattern = /(?:^|\n)\s*#{1,4}\s*镜头\s*(\d+)[^\n]*?(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-|｜]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?[^\n]*/giu;
  const matches = Array.from(normalized.matchAll(headingPattern));
  if (!matches.length) {
    return [];
  }

  return matches.map((match, index) => {
    const startOffset = match.index || 0;
    const endOffset = matches[index + 1]?.index ?? normalized.length;
    const block = normalized.slice(startOffset, endOffset).trim();
    const startTime = Number(match[2]);
    const endTime = Number(match[3]);
    const shotIndex = Number(match[1]) || index + 1;
    const visualDescription = stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '画面')));
    const actionDescription = stripStoryboardEntityDetailBlocks(stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '人物/动作')
      || fieldFromStoryboardBlock(block, '人物动作')
      || fieldFromStoryboardBlock(block, '动作')));
    const narration = stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '台词/旁白')
      || fieldFromStoryboardBlock(block, '台词')
      || fieldFromStoryboardBlock(block, '旁白'), { keepSpeechLabels: true });
    const soundEffect = stripNestedStoryboardFields(fieldFromStoryboardBlock(block, '音效'));
    const remakeSuggestion = sanitizeStoryboardRemakeSuggestion(fieldFromStoryboardBlock(block, '复刻建议'));
    return {
      shotId: `shot_${shotIndex}`,
      index: shotIndex,
      label: `镜头 ${shotIndex}`,
      startTime,
      endTime,
      duration: Math.max(1, Number((endTime - startTime).toFixed(1))),
      visualDescription,
      actionDescription,
      narration,
      soundEffect,
      remakeSuggestion,
      seedanceReady: true,
      source: 'llm_storyboard',
    };
  }).filter((shot) => (
    Number.isFinite(shot.startTime)
    && Number.isFinite(shot.endTime)
    && shot.endTime > shot.startTime
    && (shot.visualDescription || shot.narration || shot.remakeSuggestion)
  ));
}

function hasSpeechSpeakerLabel(text: string) {
  return /(?:^|\n|\s)(?:口播|台词|旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[：:]/u.test(text);
}

function stripNarrationSpeakerPrefix(text: string) {
  return text
    .replace(/^\s*(?:口播|台词|旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[：:]\s*/u, '')
    .trim();
}

function splitStoryboardNarrationUnits(text: string) {
  const normalized = usefulText(text)
    .replace(/\r\n?/gu, '\n')
    .replace(/[；;。！？!?]+/gu, '\n');
  return normalized
    .split(/\n+/u)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return [];
      }
      const prefixed = trimmed.match(/^((?:口播|台词|旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[：:])\s*(.+)$/u);
      if (!prefixed) {
        return [trimmed];
      }
      const prefix = prefixed[1].replace(/\s+/gu, '');
      const body = prefixed[2].trim();
      return body ? [`${prefix}${body}`] : [];
    })
    .filter(Boolean);
}

function narrationUnitKey(text: string) {
  return stripNarrationSpeakerPrefix(text)
    .replace(/\s+/gu, '')
    .replace(/[，,。；;！？!?、]/gu, '')
    .trim();
}

function countAllowedNarrationUnits(spokenSegments: Array<{ narration: string; startTime: number; endTime: number }>) {
  const counts = new Map<string, number>();
  spokenSegments.forEach((segment) => {
    splitStoryboardNarrationUnits(segment.narration).forEach((unit) => {
      const key = narrationUnitKey(unit);
      if (!key) {
        return;
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return counts;
}

function isNarrationFragmentAlreadyUsed(
  key: string,
  usedCounts: Map<string, number>,
  allowedCounts: Map<string, number>,
) {
  if (key.length < 6) {
    return false;
  }
  if (allowedCounts.has(key)) {
    return false;
  }
  return Array.from(usedCounts.entries()).some(([usedKey, count]) => (
    count > 0
    && usedKey !== key
    && usedKey.length >= 6
    && (usedKey.includes(key) || key.includes(usedKey))
  ));
}

function trimDuplicateStoryboardNarration(
  storyboard: Array<Record<string, unknown>>,
  spokenSegments: Array<{ narration: string; startTime: number; endTime: number }>,
) {
  const allowedCounts = countAllowedNarrationUnits(spokenSegments);
  const usedCounts = new Map<string, number>();
  return storyboard.map((shot) => {
    const narration = usefulText(shot.narration);
    if (!narration) {
      return shot;
    }
    const units = splitStoryboardNarrationUnits(narration);
    if (units.length <= 1) {
      const key = narrationUnitKey(units[0] || narration);
      const allowed = allowedCounts.get(key) || 1;
      const used = usedCounts.get(key) || 0;
      if (key) {
        usedCounts.set(key, used + 1);
      }
      return key && (used >= allowed || isNarrationFragmentAlreadyUsed(key, usedCounts, allowedCounts))
        ? { ...shot, narration: '' }
        : shot;
    }
    const kept: string[] = [];
    units.forEach((unit) => {
      const key = narrationUnitKey(unit);
      if (!key) {
        return;
      }
      const allowed = allowedCounts.get(key) || 1;
      const used = usedCounts.get(key) || 0;
      if (used < allowed && !isNarrationFragmentAlreadyUsed(key, usedCounts, allowedCounts)) {
        kept.push(unit);
      }
      usedCounts.set(key, used + 1);
    });
    return {
      ...shot,
      narration: kept.join('\n'),
    };
  });
}

function restoreNarrationSpeakerLabels(storyboard: Array<Record<string, unknown>>, spokenSegments: Array<{ narration: string; startTime: number; endTime: number }>) {
  if (!spokenSegments.length) {
    return storyboard;
  }
  return storyboard.map((shot) => {
    const narration = usefulText(shot.narration);
    const startTime = numericSecond(shot.startTime);
    const endTime = numericSecond(shot.endTime) || startTime + numericSecond(shot.duration);
    const matched = spokenSegments.filter((segment) => segment.startTime < endTime && segment.endTime > startTime);
    if (!matched.length) {
      return shot;
    }
    if (!narration) {
      return {
        ...shot,
        narration: matched.map((segment) => segment.narration).join('；'),
      };
    }
    if (hasSpeechSpeakerLabel(narration)) {
      return shot;
    }
    const labelledMatched = matched.filter((segment) => hasSpeechSpeakerLabel(segment.narration));
    if (!labelledMatched.length) {
      return shot;
    }
    const labelledNarration = labelledMatched.map((segment) => segment.narration).join('；');
    return {
      ...shot,
      narration: labelledNarration,
    };
  });
}

export function sanitizeStoryboardNarrationDuplicatesForTest(
  storyboard: Array<Record<string, unknown>>,
  spokenSegments: Array<{ narration: string; startTime: number; endTime: number }>,
) {
  return trimDuplicateStoryboardNarration(storyboard, spokenSegments);
}

function estimateStoryboardSeconds(text: string) {
  const cjkChars = text.match(/[\u3400-\u9fff]/gu)?.length || 0;
  const punctuation = text.match(/[，。！？；,.!?;]/gu)?.length || 0;
  return Math.max(8, Math.ceil(cjkChars / 4 + punctuation * 0.3 + 2));
}

function narrationWeightSeconds(text: string) {
  const value = usefulText(text);
  if (!value) {
    return 2;
  }
  const withoutSpeaker = value.replace(/(?:^|\n)\s*(?:口播|台词|旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[:：]\s*/gu, '');
  const cjkChars = withoutSpeaker.match(/[\u3400-\u9fff]/gu)?.length || 0;
  const latinWords = withoutSpeaker.match(/[A-Za-z0-9]+/gu)?.length || 0;
  const punctuation = withoutSpeaker.match(/[，。！？；,.!?;]/gu)?.length || 0;
  return Math.max(1, cjkChars / 4 + latinWords / 2.5 + punctuation * 0.25);
}

function shouldRebalanceStoryboardTiming(storyboard: Array<Record<string, unknown>>) {
  const timedShots = storyboard
    .map((shot) => ({ shot, timing: storyboardShotTiming(shot), weight: narrationWeightSeconds(usefulText(shot.narration)) }))
    .filter(({ timing }) => timing.duration > 0);
  if (timedShots.length < 2) {
    return false;
  }
  const totalDuration = timedShots.reduce((sum, item) => sum + item.timing.duration, 0);
  const totalWeight = timedShots.reduce((sum, item) => sum + item.weight, 0);
  if (totalDuration <= 0 || totalWeight <= 0) {
    return false;
  }
  return timedShots.some(({ timing, weight }) => {
    const expected = totalDuration * (weight / totalWeight);
    if (expected < 1) {
      return false;
    }
    return timing.duration > expected * 1.85 || timing.duration < expected * 0.55;
  });
}

function rebalanceStoryboardTimingByNarration(storyboard: Array<Record<string, unknown>>, targetSeconds: number) {
  if (!storyboard.length || !Number.isFinite(targetSeconds) || targetSeconds <= 0 || !shouldRebalanceStoryboardTiming(storyboard)) {
    return storyboard;
  }
  const weights = storyboard.map((shot) => narrationWeightSeconds(usefulText(shot.narration)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return storyboard;
  }
  let cursor = 0;
  return storyboard.map((shot, index) => {
    const isLast = index === storyboard.length - 1;
    const remainingShots = storyboard.length - index;
    const remainingSeconds = Math.max(remainingShots, targetSeconds - cursor);
    const rawDuration = isLast
      ? Math.max(1, targetSeconds - cursor)
      : Math.max(1, Math.min(remainingSeconds - (remainingShots - 1), targetSeconds * (weights[index] / totalWeight)));
    const duration = Number(rawDuration.toFixed(1));
    const startTime = Number(cursor.toFixed(1));
    const endTime = isLast ? Number(targetSeconds.toFixed(1)) : Number((cursor + duration).toFixed(1));
    cursor = endTime;
    return {
      ...shot,
      startTime,
      endTime,
      duration: Math.max(1, Number((endTime - startTime).toFixed(1))),
    };
  });
}

async function generateStoryboardWithLlm(context: VideoRemakeNodeContext) {
  const content = scriptContent(context.workflow);
  const vod = context.workflow.runtime.vod || {};
  const targetSeconds = durationSecondsFromVod(vod) || estimateStoryboardSeconds(content);
  const noProductRequired = storyboardDisallowsProducts(context.workflow);
  const system = [
    videoRemakeStoryboardSystemPrompt,
    '必须输出 Markdown，不要输出 JSON。',
    '必须严格按固定模板输出，每个镜头只允许 6 行：',
    '## 镜头 N｜起始-结束秒',
    '画面：本镜头画面，一行写完',
    '人物/动作：本镜头人物和动作，一行写完',
    '台词/旁白：本镜头台词，一行写完',
    '音效：本镜头音效，一行写完',
    '复刻建议：本镜头复刻建议，一行写完',
    '不要使用 ### 小标题、表格、项目符号、编号列表或代码块；不要重复输出任何字段；不要在任一字段值里再次写“画面：”“人物/动作：”“台词/旁白：”“音效：”“复刻建议：”。',
    '不要把已确认人物/场景/产品设定全文复制到镜头字段中；只允许在画面和人物/动作里用一句话引用当前镜头需要的人物、场景、产品标签和本镜头动作。',
    '如果已确认口播内容带有说话主体前缀，例如“口播：xxx”“人物1：xxx”“旁白：yyy”，台词/旁白字段必须原样保留这些主体前缀；同一镜头包含多个主体时用空格或中文分号串联，不要合并成无主体文本。',
    '已确认口播中的每一条对话都必须出现在且只出现在一个镜头的“台词/旁白”字段；短句、应答句、无时间标注的“旁白：对啊”等也不能省略。',
    '台词/旁白必须严格按“已确认口播内容”的原文出现顺序排列，不得提前、延后、交换顺序或跨镜头重排；如果某条口播带时间，镜头时间窗应覆盖该条原始时间范围；如果没有时间，也必须按原文顺序分配。',
    '请按语义完整片段切镜头，每个镜头建议 4-12 秒；不要一句话拆一个镜头。',
    videoRemakeStoryboardSpeakerLimitSystemPrompt,
    '镜头起止时间必须按“台词/旁白”的字数和自然语速分配：中文口播按每秒约 4 个汉字估算，长台词必须给更长时长，短台词只能给较短时长；禁止把每个镜头机械切成接近相同秒数。',
    '上下文依赖的连续短句必须放在同一个镜头台词里，不能把铺垫句和结论句拆开。',
    '每个镜头的“台词/旁白”字段都必须填写与该镜头时间范围重叠的已确认口播原句；输出时去掉“时间：0s-3s”等时间标注，只保留“口播：/旁白：/人物X：”和台词正文；除非该时间段确实没有任何口播，否则不允许留空。',
  ].join('\n');
  const user = [
    `目标总时长：${targetSeconds}秒。`,
    '',
    '# 已确认口播内容',
    content,
    '',
    '# 已确认人物设定',
    characterPromptText(characterSetting(context.workflow)) || '无单独人物设定。',
    characterCoverageText(context.workflow)
      ? [
        '',
        '# 人物覆盖硬约束',
        '以下人物均来自已确认人物设定；当镜头动作涉及多人参与、共同讨论、共同实验、共同购买、群体定价等含义时，人物/动作必须保留所有相关人物标签，不得只写人物1；复刻建议不要重复人物设定：',
        characterCoverageText(context.workflow),
      ].join('\n')
      : '',
    '',
    '# 已确认场景设定',
    scenePromptText(sceneSetting(context.workflow)) || '无单独场景设定。',
    disabledEntityConstraintText(context.workflow) ? [
      '',
      '# 禁用实体约束',
      disabledEntityConstraintText(context.workflow),
    ].join('\n') : '',
    '',
    '# 产品设定',
    productPromptText(productSetting(context.workflow)) || '不需要产品展示。',
    noProductRequired ? [
      '',
      '# 产品硬约束',
      '已确认不需要产品。所有镜头的画面、人物/动作、复刻建议里都不得出现任何产品、商品、货品、包装、实物展示、产品标签、产品编号、产品特写、对应商品图、商品轮廓示意图或商品卖点说明。',
      '口播里即使提到某类物品，也只能保留讲解语义，不要额外安排该物品出镜，不要补充“产品：...”字段，不要写“展示对应产品/商品”“突出产品核心特征”等描述。',
    ].join('\n') : '',
    '',
    '# 画中画设定',
    pipPromptText(pipSetting(context.workflow)) || '无画中画。',
    '',
    '# 人声/音频设定',
    audioPromptText(voiceSetting(context.workflow)) || '原声参考。',
    '',
    '# 输出要求',
    '镜头数量要少而准，优先 4-8 秒一个镜头，避免把上下半句拆开。',
    '每个镜头时长必须和本镜头台词长度匹配：长台词镜头要相应变长，短台词镜头要相应变短；如果某镜头台词明显比其他镜头少，不能给它更长时间。',
    '请先按台词语义切段，再按每秒约 4 个汉字估算每段时长，最后让所有镜头起止时间连续覆盖 0 到目标总时长。',
    '镜头时间不得超过目标总时长；最后一个镜头必须以目标总时长结束，禁止额外生成没有台词的收尾镜头。',
    '台词/旁白只能使用已确认口播原句，不新增结束语或行动号召；已确认口播里的“口播：”“人物1：”“人物2：”“旁白：”等说话主体前缀必须保留到台词/旁白字段。',
    '逐条核对已确认口播清单：每条“口播：...”和“旁白：...”都要按原文顺序分配到镜头；有时间就参考时间范围，没有时间就按前后文本顺序放入相邻语义镜头；不要因为“旁白：对啊”很短就丢弃，也不要把口播标签删除成无主体文本。',
    '分配台词时只能向前顺序消费已确认口播，不能把后面的旁白插入前面的口播之间，也不能把前面遗漏的口播补到后面镜头。',
    '每个镜头必须按自己的起止时间覆盖对应口播：例如镜头 8s-19s 必须填入 8s-19s 内的口播内容，不得省略为只有动作和音效。',
    videoRemakeStoryboardSpeakerLimitUserPrompt,
    '不要写字幕、标题条、屏幕文字、水印或 Logo。',
    '人物/动作字段必须自包含写清本镜头人物姿态、动作，并保留已确认人物设定中需要持续可见的配件、道具、服饰细节或其他标识性细节。',
    '人物/动作字段不要另起“人物1：外观/动作/表情/适用时间/时间范围/口播线索/关键词”等设定明细块；只写当前镜头实际画面里的动作描述。',
    '必须结合本镜头台词/旁白、画面语境和已确认设定，判断本镜头应该出现哪些人物、场景、产品；只写与当前口播语义相关的实体，不要无脑套用第一个人物、场景或产品。',
    '如果人物、场景或产品设定里带有“适用时间”“口播线索”“关键词”，必须优先按当前镜头时间范围和台词语义选择实体；没有时间/线索命中的实体不要强行写入当前镜头。',
    '如果本镜头台词或画面涉及多个人物，人物/动作字段必须逐一写出对应人物标签和动作；不得把多个人物合并成“人物1”，也不得漏掉人物2/人物3/人物4。',
    '复刻建议不得列出人物、角色、场景、产品、画中画、环境、道具、灯光、构图、机位、氛围等设定明细块；这些信息应分别体现在画面和人物/动作字段。',
    '复刻建议只能写本镜头拍摄执行建议，例如景别控制、镜头稳定性、表演节奏、光线控制、避坑要求；不要重复人物外观、场景环境、产品信息，也不要输出“适用时间、时间范围、口播线索、关键词”等设定元信息。',
    '画中画只能分配给时间范围与画中画设定重叠的镜头；不重叠的镜头不要写画中画内容。',
    '复刻建议必须写本镜头可直接执行的具体要求，不要写“保持机位、光线参数和上一镜头一致”“保持拍摄参数统一”“人物不要出现大幅度位移”“不要切换景别”等依赖上一镜头或空泛的句子。',
  ].join('\n');
  const timeoutMs = Number(process.env.VIDEO_REMAKE_STORYBOARD_LLM_TIMEOUT_MS || 300_000);
  const markdown = await callConfiguredLlm({
    userId: context.userId,
    temperature: 0.28,
    sourceType: 'video_remake_storyboard',
    sourceId: context.sessionId,
    system,
    user,
    timeoutMs,
  });
  const parsed = parseStoryboardMarkdown(markdown);
  if (!parsed.length) {
    logVideoRemakeGeneration('warn', 'storyboard llm response could not be parsed', {
      sessionId: context.sessionId,
      taskId: context.taskId,
      responseLength: markdown.length,
      responsePreview: markdown.slice(0, 800),
      hasShotHeading: /镜头\s*\d+/u.test(markdown),
      hasTimeRange: /\d+(?:\.\d+)?\s*(?:秒|s)?\s*[-|｜]\s*\d+(?:\.\d+)?/u.test(markdown),
    });
  }
  const spokenSegments = parseSpokenSegments(content);
  const labelledStoryboard = restoreNarrationSpeakerLabels(parsed, spokenSegments);
  const dedupedStoryboard = trimDuplicateStoryboardNarration(labelledStoryboard, spokenSegments);
  const timedStoryboard = rebalanceStoryboardTimingByNarration(dedupedStoryboard, targetSeconds);
  const references = collectMaterialReferences(context.workflow);
  return sanitizeStoryboardForConfirmedSettings(attachPipDescriptionsToStoryboard(
    ensureStoryboardEntityCoverage(timedStoryboard, context.workflow),
    context.workflow,
    { userId: context.userId, references },
  ), context.workflow);
}

function seedanceMaxSegmentSeconds() {
  const configured = Number(process.env.VIDEO_REMAKE_SEEDANCE_MAX_SEGMENT_SECONDS || 15);
  return Number.isFinite(configured) && configured > 0 ? configured : 15;
}

function seedanceReferencePrimerMinSegments() {
  const configured = Number(process.env.VIDEO_REMAKE_REFERENCE_PRIMER_MIN_SEGMENTS || 3);
  return Number.isFinite(configured) && configured > 1 ? Math.round(configured) : 3;
}

function seedanceReferencePrimerSeconds() {
  const configured = Number(process.env.VIDEO_REMAKE_REFERENCE_PRIMER_SECONDS || 4);
  return Number.isFinite(configured) && configured > 0 ? Math.min(4, Math.max(2, Math.round(configured))) : 4;
}

function seedanceReferencePrimerResolution() {
  return '480p';
}

function storyboardShotTiming(shot: Record<string, unknown>) {
  const startTime = Number(shot.startTime || 0);
  const explicitEndTime = Number(shot.endTime || 0);
  const explicitDuration = Number(shot.duration || 0);
  const duration = explicitDuration > 0
    ? explicitDuration
    : explicitEndTime > startTime
      ? explicitEndTime - startTime
      : 1;
  const endTime = explicitEndTime > startTime ? explicitEndTime : startTime + duration;
  return {
    startTime: Number.isFinite(startTime) ? startTime : 0,
    endTime: Number.isFinite(endTime) ? endTime : startTime + duration,
    duration: Math.max(1, Number.isFinite(duration) ? duration : 1),
  };
}

function splitTextByLength(text: string, count: number) {
  const value = text.trim();
  if (!value || count <= 1) {
    return value ? [value] : [];
  }
  const chunkSize = Math.max(1, Math.ceil(value.length / count));
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize).trim());
  }
  return chunks.filter(Boolean);
}

function splitNarrationForSeedance(text: string, count: number) {
  const value = text.trim();
  if (!value || count <= 1) {
    return value ? [value] : [];
  }
  const units = value
    .split('\n')
    .flatMap((line) => line.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [line])
    .map((unit) => unit.trim())
    .filter(Boolean);
  if (units.length < count) {
    return splitTextByLength(value, count);
  }
  const totalLength = units.reduce((sum, unit) => sum + unit.length, 0);
  const chunks: string[] = [];
  let unitIndex = 0;
  for (let chunkIndex = 0; chunkIndex < count; chunkIndex += 1) {
    const remainingChunks = count - chunkIndex;
    const remainingLength = units.slice(unitIndex).reduce((sum, unit) => sum + unit.length, 0);
    const targetLength = Math.max(1, Math.ceil((remainingLength || totalLength) / remainingChunks));
    const current: string[] = [];
    let currentLength = 0;
    while (unitIndex < units.length && (current.length === 0 || currentLength < targetLength) && units.length - unitIndex > remainingChunks - 1) {
      current.push(units[unitIndex]);
      currentLength += units[unitIndex].length;
      unitIndex += 1;
    }
    chunks.push(current.join('').trim());
  }
  if (unitIndex < units.length) {
    chunks[chunks.length - 1] = [chunks[chunks.length - 1], ...units.slice(unitIndex)].filter(Boolean).join('').trim();
  }
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

function firstShortSpokenSentence(text: string) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }
  const withoutSpeaker = normalized.replace(/^(?:口播|台词|旁白(?:\s*\d+)?|人物\s*[A-Za-z\d一二三四五六七八九十]+|角色\s*[A-Za-z\d一二三四五六七八九十]+|男声|女声|主持人|采访者|被访者)\s*[:：]\s*/u, '');
  const sentence = withoutSpeaker.match(/[^。！？!?；;,.，、]+[。！？!?]?/u)?.[0] || withoutSpeaker;
  return sentence.trim().slice(0, 38);
}

function splitLongStoryboardShotsForSeedance(storyboard: Array<Record<string, unknown>>, maxDuration: number) {
  if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
    return storyboard;
  }
  return storyboard.flatMap((shot) => {
    const timing = storyboardShotTiming(shot);
    if (timing.duration <= maxDuration + 0.01) {
      return [shot];
    }
    const chunkCount = Math.max(2, Math.ceil(timing.duration / maxDuration));
    const narrationChunks = splitNarrationForSeedance(usefulText(shot.narration), chunkCount);
    const chunkDuration = timing.duration / chunkCount;
    return Array.from({ length: chunkCount }, (_, index) => {
      const startTime = Number((timing.startTime + chunkDuration * index).toFixed(1));
      const endTime = index === chunkCount - 1
        ? Number(timing.endTime.toFixed(1))
        : Number((timing.startTime + chunkDuration * (index + 1)).toFixed(1));
      return {
        ...shot,
        shotId: `${textFrom(shot.shotId) || 'shot'}_${index + 1}`,
        label: `${textFrom(shot.label) || '镜头'}-${index + 1}`,
        startTime,
        endTime,
        duration: Math.max(1, Number((endTime - startTime).toFixed(1))),
        narration: narrationChunks[index] || usefulText(shot.narration),
        pipDescription: '',
      };
    });
  });
}

function groupStoryboardForSeedance(storyboard: Array<Record<string, unknown>>, maxDuration: number) {
  const groups: Array<Record<string, unknown>[]> = [];
  let current: Record<string, unknown>[] = [];
  let currentDuration = 0;

  storyboard.forEach((shot) => {
    const { duration } = storyboardShotTiming(shot);
    if (current.length && currentDuration + duration > maxDuration) {
      groups.push(current);
      current = [];
      currentDuration = 0;
    }
    current.push(shot);
    currentDuration += duration;
  });

  if (current.length) {
    groups.push(current);
  }

  return groups.map((shots, index) => {
    const first = shots[0] || {};
    const last = shots[shots.length - 1] || first;
    const firstTiming = storyboardShotTiming(first);
    const lastTiming = storyboardShotTiming(last);
    const startTime = firstTiming.startTime;
    const endTime = lastTiming.endTime || startTime + shots.reduce((sum, shot) => sum + storyboardShotTiming(shot).duration, 0);
    const narration = shots.map((shot) => usefulText(shot.narration)).filter(Boolean).join('\n');
    const visualDescription = uniqueUsefulLines(shots.map((shot) => usefulText(shot.visualDescription))).join('\n');
    const actionDescription = uniqueUsefulLines(shots.map((shot) => usefulText(shot.actionDescription))).join('\n');
    const soundEffect = uniqueUsefulLines(shots.map((shot) => usefulText(shot.soundEffect))).join('\n');
    const pipDescription = uniqueUsefulLines(shots.map((shot) => usefulText(shot.pipDescription))).join('\n');
    const remakeSuggestion = uniqueUsefulLines(shots.map((shot) => usefulText(shot.remakeSuggestion))).join('\n');
    return {
      segmentId: `segment_${index + 1}`,
      index: index + 1,
      shots,
      startTime,
      endTime,
      duration: Math.max(1, Number((endTime - startTime).toFixed(1))),
      segmentPurpose: narration.split('\n')[0]?.slice(0, 24) || `分段 ${index + 1}`,
      narration,
      visualDescription,
      actionDescription,
      soundEffect,
      pipDescription,
      remakeSuggestion,
    };
  });
}

function buildSegmentPrompt(input: {
  segment: Record<string, unknown>;
  referenceGuide: string;
}) {
  const segment = input.segment;
  const currentStoryboard = [
    usefulText(segment.visualDescription) ? `画面：${usefulText(segment.visualDescription)}` : '',
    usefulText(segment.actionDescription) ? `人物/动作：${usefulText(segment.actionDescription)}` : '',
    usefulText(segment.soundEffect) ? `原片音效参考：${usefulText(segment.soundEffect)}；只可作为环境氛围参考，不要在本段结尾追加转场音、点击音或杂音。` : '',
    usefulText(segment.pipDescription) ? `画中画：${usefulText(segment.pipDescription)}` : '',
    usefulText(segment.remakeSuggestion) ? `复刻建议：${usefulText(segment.remakeSuggestion)}` : '',
  ].filter(Boolean).join('\n');
  return [
    promptSectionText('当前分镜', currentStoryboard),
    promptSectionText('素材参考', input.referenceGuide),
    speechPromptSectionText('本段口播', String(segment.narration || '')),
  ].filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function removeDuplicatedPipPromptSection(text: string) {
  return text
    .replace(/\n{2,}#\s*画中画\s*\n[\s\S]*?(?=\n{2,}#\s|$)/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function buildSeedancePromptForRequest(input: {
  systemPrompt: string;
  mainPrompt: string;
  negativePrompt: string;
}) {
  return [
    input.systemPrompt,
    removeDuplicatedPipPromptSection(input.mainPrompt),
    promptSectionText('音频收尾约束', seedanceAudioBoundaryConstraint()),
    promptSectionText('负面约束', input.negativePrompt),
  ].filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function withSeedanceAudioBoundaryConstraint(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.includes('音频收尾约束')) {
    return trimmed;
  }
  return [
    trimmed,
    promptSectionText('音频收尾约束', seedanceAudioBoundaryConstraint()),
  ].filter(Boolean).join('\n\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function confirmedSpeechFromSeedancePrompts(prompts: Array<Record<string, unknown>>) {
  return prompts.map((segment) => {
    const prompt = isRecord(segment.prompt) ? segment.prompt : {};
    const speech = promptSectionContent(String(prompt.mainPrompt || ''), '本段口播');
    return speech.trim();
  }).filter(Boolean).join('\n');
}

function summarizeSpeechBoundary(text: string, side: 'head' | 'tail') {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= 24) {
    return normalized;
  }
  return side === 'head'
    ? `${normalized.slice(0, 24).trim()}...`
    : `...${normalized.slice(-24).trim()}`;
}

function speechPlanFromSeedancePrompts(prompts: Array<Record<string, unknown>>) {
  const speeches = prompts.map((segment) => {
    const prompt = isRecord(segment.prompt) ? segment.prompt : {};
    return promptSectionContent(String(prompt.mainPrompt || ''), '本段口播').trim();
  });
  if (!speeches.some(Boolean)) {
    return undefined;
  }
  return speeches.map((playableSpeech, index) => ({
    segmentIndex: index + 1,
    playableSpeech,
    previousContext: index > 0 ? summarizeSpeechBoundary(speeches[index - 1] || '', 'tail') : '',
    nextContext: index < speeches.length - 1 ? summarizeSpeechBoundary(speeches[index + 1] || '', 'head') : '',
    estimatedSpeechSeconds: estimatedChineseSpeechSeconds(playableSpeech),
    source: playableSpeech ? 'confirmed_speech' as const : 'silent' as const,
  }));
}

function firstSegmentSpeechFromSeedancePrompts(prompts: Array<Record<string, unknown>>) {
  const firstPrompt = isRecord(prompts[0]?.prompt) ? prompts[0].prompt : {};
  return promptSectionContent(String(firstPrompt.mainPrompt || ''), '本段口播').trim()
    || textFrom(prompts[0]?.narration);
}

function primerPlanFromRuntime(workflow: VideoRemakeWorkflowState, cardData?: Record<string, unknown>) {
  const plan = isRecord(cardData?.referencePrimerPlan)
    ? cardData?.referencePrimerPlan
    : isRecord(workflow.runtime.referencePrimerPlan)
      ? workflow.runtime.referencePrimerPlan
      : undefined;
  return plan ? plan as ReferencePrimerPlan : undefined;
}

function primerSpanForSegment(plan: ReferencePrimerPlan | undefined, segmentIndex: number) {
  if (!plan) {
    return undefined;
  }
  const spanId = plan.segmentPrimerMap[String(segmentIndex)];
  if (!spanId) {
    return undefined;
  }
  return plan.spans.find((item) => item.spanId === spanId);
}

function isPrimerSceneBoundary(plan: ReferencePrimerPlan | undefined, segmentIndex: number) {
  const span = primerSpanForSegment(plan, segmentIndex);
  return Boolean(span && span.segmentStartIndex === segmentIndex);
}

function sceneAwarePrimerGaps(
  allGaps: ReferencePrimerGap[],
  span: Pick<ReferencePrimerSceneSpan, 'sceneLabels' | 'people'>,
) {
  const next: ReferencePrimerGap[] = [];
  for (const gap of allGaps) {
    if (gap.kind === 'scene' && span.sceneLabels.length) {
      span.sceneLabels.forEach((label) => next.push({ kind: 'scene', label }));
      continue;
    }
    if (gap.kind === 'character' && span.people.length) {
      span.people.forEach((label) => next.push({ kind: 'character', label }));
      continue;
    }
    next.push(gap);
  }
  return next;
}

function buildReferencePrimerSpanAsset(primer: ReferencePrimerRecord, span: ReferencePrimerSceneSpan) {
  return {
    id: primer.assetId,
    groupId: '',
    name: `分段参考视频-${span.spanId}`,
    description: '用于场景分段生成参考的临时视频',
    fileUrl: primer.videoUrl,
    filePath: '',
    url: primer.videoUrl,
    mimeType: 'video/mp4',
    resourceType: 'finished_video' as const,
    originalFileName: `seedance-reference-primer-${span.spanId}.mp4`,
    metadata: {
      source: 'video_remake_reference_primer',
      spanId: span.spanId,
      sceneLabels: span.sceneLabels,
      people: span.people,
      segmentIndexes: span.segmentIndexes,
      jobId: primer.jobId,
      spokenSentence: primer.spokenSentence,
      url: primer.videoUrl,
      referencePrimerGaps: primer.gaps,
    },
  };
}

function sceneAwarePrimerPlan(input: {
  workflow: VideoRemakeWorkflowState;
  prompts: Array<Record<string, unknown>>;
  segments: Array<Record<string, unknown>>;
  materialContext: ReturnType<typeof resolveVideoMaterialContext>;
}) {
  const allGaps = referencePrimerGaps(input.workflow, input.materialContext);
  if (!allGaps.length || !input.segments.length) {
    return undefined;
  }
  const sceneEntities = sceneCoverageEntities(input.workflow);
  const peopleEntities = characterCoverageEntities(input.workflow);
  const storyboard = Array.isArray(input.workflow.artifacts.storyboardScript)
    ? input.workflow.artifacts.storyboardScript.filter(isRecord)
    : [];
  const matches = input.segments.map((segment, index) => {
    const segmentPrompt = input.prompts[index] || {};
    const promptRecord = isRecord(segmentPrompt.prompt) ? segmentPrompt.prompt : isRecord(segment.prompt) ? segment.prompt : {};
    const startTime = positiveNumber(segment.startSecond || segment.startTime);
    const endTime = positiveNumber(segment.endSecond || segment.endTime) || (startTime + Math.max(1, positiveNumber(segment.durationSecond || segment.duration || 1)));
    const narrationText = promptSectionContent(String(promptRecord.mainPrompt || ''), '本段口播').trim()
      || textFrom(segmentPrompt.narration || segment.narration);
    const overlappingShots = storyboard.filter((shot) => {
      const shotStart = positiveNumber(shot.startSecond || shot.startTime);
      const shotEnd = positiveNumber(shot.endSecond || shot.endTime) || shotStart + positiveNumber(shot.duration || 1);
      return shotStart < endTime && shotEnd > startTime;
    });
    const combinedText = uniqueUsefulLines([
      String(promptRecord.mainPrompt || ''),
      ...overlappingShots.map((shot) => [
        usefulText(shot.visualDescription || shot.visual || shot.description),
        usefulText(shot.actionDescription || shot.action || shot.characterAction),
        usefulText(shot.narration || shot.script),
      ].filter(Boolean).join('\n')),
    ]).join('\n');
    const selectionInput = { combinedText, narrationText, startTime, endTime };
    const selectedScenes = selectEntitiesForShot(sceneEntities, selectionInput);
    const selectedPeople = selectEntitiesForShot(peopleEntities, selectionInput);
    const sceneLabels = Array.from(new Set(selectedScenes.map((item) => item.label).filter(Boolean)));
    const people = Array.from(new Set(selectedPeople.map((item) => item.label).filter(Boolean)));
    const fallbackSceneLabels = !sceneLabels.length && sceneEntities.length ? [sceneEntities[0].label] : sceneLabels;
    const signature = `${fallbackSceneLabels.join('|')}::${people.join('|')}`;
    return {
      segmentIndex: index + 1,
      startTime,
      endTime,
      narrationText,
      sceneLabels: fallbackSceneLabels,
      people,
      signature,
    };
  });

  const rawSpans: ReferencePrimerSceneSpan[] = [];
  for (const match of matches) {
    const current = rawSpans[rawSpans.length - 1];
    if (current && current.segmentIndexes.length > 0 && current.sceneLabels.join('|') === match.sceneLabels.join('|') && current.people.join('|') === match.people.join('|')) {
      current.segmentIndexes.push(match.segmentIndex);
      current.segmentEndIndex = match.segmentIndex;
      current.narration = [current.narration, match.narrationText].filter(Boolean).join('\n');
      current.people = Array.from(new Set([...current.people, ...match.people]));
      current.sceneLabels = Array.from(new Set([...current.sceneLabels, ...match.sceneLabels]));
      continue;
    }
    rawSpans.push({
      spanId: `primer_span_${rawSpans.length + 1}`,
      segmentIndexes: [match.segmentIndex],
      segmentStartIndex: match.segmentIndex,
      segmentEndIndex: match.segmentIndex,
      sceneLabels: [...match.sceneLabels],
      people: [...match.people],
      narration: match.narrationText,
      gapKinds: Array.from(new Set(allGaps.map((item) => item.kind))),
    });
  }

  const allSingleSegmentSpans = rawSpans.every((item) => item.segmentIndexes.length === 1);
  const rapidSwitch = rawSpans.length > 1 && allSingleSegmentSpans;
  const spans = rapidSwitch
    ? [{
      spanId: 'primer_span_1',
      segmentIndexes: matches.map((item) => item.segmentIndex),
      segmentStartIndex: 1,
      segmentEndIndex: matches.length,
      sceneLabels: Array.from(new Set(matches.flatMap((item) => item.sceneLabels))).filter(Boolean),
      people: Array.from(new Set(matches.flatMap((item) => item.people))).filter(Boolean),
      narration: matches.map((item) => item.narrationText).filter(Boolean).join('\n'),
      gapKinds: Array.from(new Set(allGaps.map((item) => item.kind))),
    }]
    : rawSpans;

  const mode: ReferencePrimerPlan['mode'] = rapidSwitch
    ? 'rapid_switch_fallback'
    : spans.length > 1
      ? 'scene_spans'
      : 'single';
  const segmentPrimerMap = Object.fromEntries(spans.flatMap((span) => span.segmentIndexes.map((segmentIndex) => [String(segmentIndex), span.spanId])));
  return {
    mode,
    spans,
    segmentPrimerMap,
    allGaps,
  };
}

async function maybeGenerateSeedanceReferencePrimers(input: {
  context: VideoRemakeNodeContext;
  taskId: string;
  traceId: string;
  prompts: Array<Record<string, unknown>>;
  segments: Array<Record<string, unknown>>;
  materialContext: ReturnType<typeof resolveVideoMaterialContext>;
  providerId: string;
  modelId: string;
  ratio: string;
  resolution: string;
  seedanceOptions: {
    generateAudio?: boolean;
    watermark?: boolean;
    resolution?: string;
  };
}) {
  if (input.segments.length < seedanceReferencePrimerMinSegments()) {
    return undefined;
  }
  const planSeed = sceneAwarePrimerPlan({
    workflow: input.context.workflow,
    prompts: input.prompts,
    segments: input.segments,
    materialContext: input.materialContext,
  });
  if (!planSeed) {
    return undefined;
  }
  const durationSeconds = seedanceReferencePrimerSeconds();
  const resolution = seedanceReferencePrimerResolution();
  const seedanceOptions = {
    ...input.seedanceOptions,
    resolution,
  };
  input.context.emit({
    node: 'merge_video',
    message: '正在生成场景参考视频。',
    progress: 94,
    data: { spanCount: planSeed.spans.length, durationSeconds },
  });
  const primerResults = await Promise.allSettled(planSeed.spans.map(async (span, index) => {
    const spokenSentence = firstShortSpokenSentence(span.narration || firstSegmentSpeechFromSeedancePrompts(input.prompts));
    if (!spokenSentence) {
      return;
    }
    const gaps = sceneAwarePrimerGaps(planSeed.allGaps, span);
    const prompt = [
      buildSeedanceSystemPrompt(input.context.workflow),
      '# 参考视频生成',
      `当前场景参考覆盖分段 ${span.segmentStartIndex}-${span.segmentEndIndex}。`,
      span.sceneLabels.length ? `场景：${span.sceneLabels.join('、')}。` : '',
      span.people.length ? `该场景出现的人物：${span.people.join('、')}。参考视频必须覆盖这些人物。` : '',
      `该参考视频仅用于后续分段参考以下未提供素材项：${referencePrimerGapSummary(gaps)}。`,
      '已有素材的人物、场景、声音或产品不由本参考视频覆盖；不要在参考视频中强化不在适用范围内的实体特征。',
      `只朗读这一句口播：${spokenSentence}`,
      '画面保持自然真实，不加字幕、标题条、水印、Logo 或任何可读文字；不要扩写口播。',
      seedanceAudioBoundaryConstraint(),
    ].filter(Boolean).join('\n\n');
    const primerTaskId = `${input.taskId}-reference-primer-${index + 1}`;
    const primerContext = {
      ...generationContextForSeedance(input.context.workflow, input.traceId),
      materialContext: input.materialContext,
      videoGenerationFlow: {
        traceId: input.traceId,
        source: 'video_remake_reference_primer',
        segmentIndexes: span.segmentIndexes,
        spanId: span.spanId,
      },
      allowSeedanceAudioReference: false,
    };
    const submitted = await videoRemakeVideoModelRuntime.callConfiguredVideoModel({
      taskId: primerTaskId,
      title: `${sourceTitle(input.context.workflow)}-场景参考视频-${index + 1}`,
      prompt,
      negativePrompts: negativePromptList(videoRemakeDefaultNegativePrompt),
      ratio: input.ratio,
      resolution,
      duration: formatDurationLabel(durationSeconds),
      context: primerContext,
      providerId: input.providerId,
      modelId: input.modelId,
      seedanceOptions,
    });
    const completed = await videoRemakeVideoModelRuntime.waitForVideoModelCompletion({
      providerId: input.providerId,
      modelId: input.modelId,
      jobId: submitted.jobId,
      initialVideoUrl: submitted.videoUrl,
      initialCoverUrl: submitted.coverUrl,
      initialStatus: submitted.status,
      traceId: input.traceId,
      taskId: primerTaskId,
    });
    if (!completed.videoUrl) {
      return;
    }
    recordVideoGenerationUsageIfNeeded({
      userId: input.context.userId,
      taskId: input.taskId,
      sourceType: 'video_remake_reference_primer',
      fallbackSourceId: primerTaskId,
      providerId: input.providerId,
      modelId: input.modelId,
      jobId: completed.jobId,
      durationSeconds,
      usage: completed.usage,
      requestSnapshot: {
        requestMode: 'ark_seedance_async',
        ratio: input.ratio,
        resolution,
        duration: formatDurationLabel(durationSeconds),
        durationSeconds,
        segmentCount: span.segmentIndexes.length,
        renderMode: 'reference_primer',
      },
      responseSnapshot: {
        provider: completed.provider,
        model: completed.model,
        status: completed.status,
        jobId: completed.jobId,
        completionTokens: completed.usage?.completionTokens || 0,
        totalTokens: completed.usage?.totalTokens || 0,
        hasVideoUrl: Boolean(completed.videoUrl),
        hasCoverUrl: Boolean(completed.coverUrl),
      },
      usageRaw: {
        requestMode: 'ark_seedance_async',
        source: 'video_remake_reference_primer',
        spanId: span.spanId,
        sceneLabels: span.sceneLabels,
        people: span.people,
      },
    });
    span.primer = {
      assetId: `reference-primer-${span.spanId}-${completed.jobId || input.traceId}`,
      videoUrl: publicMaterialUrl(completed.videoUrl) || completed.videoUrl,
      jobId: completed.jobId,
      spokenSentence,
      durationSeconds,
      gaps,
      spanId: span.spanId,
      sceneLabels: span.sceneLabels,
      people: span.people,
      segmentIndexes: span.segmentIndexes,
    };
  }));
  primerResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      logVideoRemakeGeneration('warn', 'seedance reference primer generation failed', {
        traceId: input.traceId,
        sessionId: input.context.sessionId,
        taskId: input.taskId,
        spanId: planSeed.spans[index]?.spanId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason || ''),
      });
    }
  });
  const plan: ReferencePrimerPlan = {
    mode: planSeed.mode,
    spans: planSeed.spans,
    segmentPrimerMap: planSeed.segmentPrimerMap,
  };
  return plan.spans.some((span) => span.primer) ? plan : undefined;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function seedanceResolutionFromWorkflow(workflow: VideoRemakeWorkflowState) {
  const basicInfo = isRecord(workflow.artifacts.basicInfo) ? workflow.artifacts.basicInfo : {};
  const videoBasicInfo = isRecord(workflow.artifacts.videoBasicInfo) ? workflow.artifacts.videoBasicInfo : {};
  const raw = textFrom(basicInfo.resolution || videoBasicInfo.resolution);
  if (/1080/u.test(raw)) {
    return '1080p';
  }
  if (/720/u.test(raw)) {
    return '720p';
  }
  if (/480/u.test(raw)) {
    return '480p';
  }
  return '720p';
}

function seedanceRatioFromWorkflow(workflow: VideoRemakeWorkflowState) {
  const basicInfo = isRecord(workflow.artifacts.basicInfo) ? workflow.artifacts.basicInfo : {};
  const raw = textFrom(basicInfo.aspectRatio || basicInfo.ratio);
  if (/^\d+\s*:\s*\d+$/u.test(raw)) {
    return raw.replace(/\s+/gu, '');
  }
  const inspection = urlInspection(workflow);
  const width = positiveNumber(inspection?.videoInfo?.width);
  const height = positiveNumber(inspection?.videoInfo?.height);
  if (width && height) {
    return width >= height ? '16:9' : '9:16';
  }
  return '9:16';
}

function storyboardMarkdownFromWorkflow(workflow: VideoRemakeWorkflowState) {
  const storyboard = Array.isArray(workflow.artifacts.storyboardScript)
    ? workflow.artifacts.storyboardScript as Array<Record<string, unknown>>
    : [];
  return storyboard.map((shot, index) => {
    const title = textFrom(shot.title) || `镜头 ${index + 1}`;
    const start = positiveNumber(shot.startSecond || shot.startTime);
    const end = positiveNumber(shot.endSecond || shot.endTime);
    const visual = textFrom(shot.visual) || textFrom(shot.visualDescription) || textFrom(shot.description);
    const action = textFrom(shot.characterAction) || textFrom(shot.actionDescription) || textFrom(shot.action);
    const narration = textFrom(shot.narration) || textFrom(shot.script);
    const audio = textFrom(shot.audio) || textFrom(shot.soundEffect);
    const suggestion = textFrom(shot.reproductionSuggestion) || textFrom(shot.remakeSuggestion) || textFrom(shot.suggestion);
    return [
      `镜头 ${index + 1} | ${start}-${Math.max(end, start + 1)}秒`,
      visual ? `画面：${visual}` : '',
      action ? `人物/动作：${action}` : '',
      narration ? `台词/旁白：${narration}` : '',
      audio ? `音效：${audio}` : '',
      suggestion ? `复刻建议：${suggestion}` : '',
      title && !/^镜头\s*\d+$/u.test(title) ? `备注：${title}` : '',
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}

function totalGenerationSeconds(workflow: VideoRemakeWorkflowState) {
  const storyboard = Array.isArray(workflow.artifacts.storyboardScript)
    ? workflow.artifacts.storyboardScript as Array<Record<string, unknown>>
    : [];
  const storyboardEnd = storyboard.reduce((max, shot) => Math.max(max, positiveNumber(shot.endSecond || shot.endTime)), 0);
  if (storyboardEnd) {
    return Math.max(1, Math.round(storyboardEnd));
  }
  const vodSeconds = workflow.runtime.vod ? durationSecondsFromVod(workflow.runtime.vod) : 0;
  if (vodSeconds) {
    return Math.max(1, vodSeconds);
  }
  const content = scriptContent(workflow);
  return Math.max(4, estimateStoryboardSeconds(content || ''));
}

function negativePromptList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => textFrom(item)).filter(Boolean);
  }
  const text = textFrom(value);
  return text ? [text] : [];
}

function promptRecordHasText(value: unknown): boolean {
  if (textFrom(value)) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return ['mainPrompt', 'seedancePrompt', 'promptText', 'text', 'content', 'systemPrompt']
    .some((key) => promptRecordHasText(value[key]));
}

function collectMaterialReferences(workflow: VideoRemakeWorkflowState) {
  const imageIds = new Set<string>();
  const videoIds = new Set<string>();
  const audioIds = new Set<string>();
  let referenceImageGroupId = '';
  let referenceAudioGroupId = '';
  const addId = (set: Set<string>, value: unknown) => {
    const id = textFrom(value);
    if (id) {
      set.add(id);
    }
  };
  const addGroupId = (value: unknown, preferred: 'image' | 'audio' = 'image') => {
    const id = textFrom(value);
    if (!id) {
      return;
    }
    const group = contentRepository.findGroup(id);
    if (!group) {
      return;
    }
    const assets = contentRepository.listAssets({ userId: group.userId, groupId: group.id });
    if (group.resourceType === 'voice' || preferred === 'audio') {
      referenceAudioGroupId ||= id;
      assets.forEach((asset) => {
        if (asset.mimeType.startsWith('audio/')) {
          addId(audioIds, asset.id);
        }
      });
      return;
    }
    if (['digital_human', 'virtual_portrait', 'real_person', 'scene', 'product'].includes(String(group.resourceType))) {
      referenceImageGroupId ||= id;
      assets.forEach((asset) => {
        if (asset.mimeType.startsWith('image/')) {
          addId(imageIds, asset.id);
        }
      });
    }
  };
  const addMediaId = (value: unknown, defaultSet: Set<string>) => {
    if (!isRecord(value)) {
      return;
    }
    const mimeType = textFrom(value.mimeType);
    const resourceType = textFrom(value.resourceType);
    const target = mimeType.startsWith('audio/') || resourceType === 'voice'
      ? audioIds
      : mimeType.startsWith('video/') || resourceType === 'finished_video'
        ? videoIds
        : defaultSet;
    addId(target, value.assetId || value.id || value.materialId);
  };

  expandedCharacterSettingItems(characterSetting(workflow)).forEach((item) => {
    addId(imageIds, item.assetId || item.materialId || item.replacementAssetId);
    addGroupId(item.groupId || item.materialGroupId || item.replacementGroupId);
    addMediaId(item.asset, imageIds);
    addMediaId(item.material, imageIds);
  });
  enabledSceneItems(sceneSetting(workflow)).forEach((item) => {
    addId(imageIds, item.assetId || item.materialId || item.replacementAssetId);
    addGroupId(item.groupId || item.materialGroupId || item.replacementGroupId);
    addMediaId(item.asset, imageIds);
    addMediaId(item.material, imageIds);
  });
  enabledProductItems(productSetting(workflow)).forEach((item) => {
    addId(imageIds, item.assetId || item.materialId || item.replacementAssetId);
    addGroupId(item.groupId || item.materialGroupId || item.replacementGroupId);
    addMediaId(item.asset, imageIds);
    addMediaId(item.material, imageIds);
  });
  settingItems(pipSetting(workflow)).forEach((item) => {
    addId(imageIds, item.replacementAssetId || item.assetId || item.materialId);
    addGroupId(item.replacementGroupId || item.groupId || item.materialGroupId);
    addMediaId(item.asset, imageIds);
    addMediaId(item.material, imageIds);
  });
  settingItems(voiceSetting(workflow)).forEach((item) => {
    addId(audioIds, item.assetId || item.materialId || item.voiceAssetId);
    addGroupId(item.groupId || item.voiceGroupId || item.materialGroupId, 'audio');
    addMediaId(item.asset, audioIds);
    addMediaId(item.material, audioIds);
  });

  // 从 expertAnalysis.visual 中收集素材组（爆款复刻流程中素材组存储在这里）
  const expertAnalysis = workflow.artifacts.expertAnalysis;
  if (isRecord(expertAnalysis)) {
    const visual = isRecord(expertAnalysis.visual) ? expertAnalysis.visual : {};
    const pip = isRecord(expertAnalysis.pip) ? expertAnalysis.pip : {};
    // 收集 visual 中的素材组引用
    if (Array.isArray(visual.characters)) {
      visual.characters.filter(isRecord).forEach((character) => {
        addId(imageIds, character.assetId);
        addGroupId(character.groupId);
      });
    }
    if (Array.isArray(visual.scenes)) {
      visual.scenes.filter(isRecord).forEach((scene) => {
        addId(imageIds, scene.assetId);
        addGroupId(scene.groupId);
      });
    }
    if (isRecord(visual.product)) {
      addId(imageIds, visual.product.assetId);
      addGroupId(visual.product.groupId);
    }
    // 收集 pip 中的素材组引用
    if (Array.isArray(pip.items)) {
      pip.items.filter(isRecord).forEach((item) => {
        addId(imageIds, item.replacementAssetId || item.assetId);
        addGroupId(item.replacementGroupId || item.groupId);
      });
    }
  }

  return {
    referenceImageGroupId: referenceImageGroupId || undefined,
    referenceAudioGroupId: referenceAudioGroupId || undefined,
    referenceImageIds: Array.from(imageIds),
    referenceVideoIds: Array.from(videoIds),
    referenceAudioIds: Array.from(audioIds),
  };
}

function firstSeedanceFinalPrompt(workflow: VideoRemakeWorkflowState) {
  const prompts = Array.isArray(workflow.artifacts.seedancePrompts)
    ? workflow.artifacts.seedancePrompts as Array<Record<string, unknown>>
    : [];
  const promptBlocks = prompts.map((segment, index) => {
    const prompt = isRecord(segment.prompt) ? segment.prompt : {};
    const finalPrompt = buildSeedancePromptForRequest({
      systemPrompt: String(prompt.systemPrompt || buildSeedanceSystemPrompt(workflow)),
      mainPrompt: String(prompt.mainPrompt || ''),
      negativePrompt: String(prompt.negativePrompt || videoRemakeDefaultNegativePrompt),
    });
    return `分段 ${index + 1}\n${finalPrompt}`;
  }).filter(Boolean);
  return promptBlocks.length
    ? promptBlocks.join('\n\n')
    : buildSeedancePromptForRequest({
      systemPrompt: buildSeedanceSystemPrompt(workflow),
      mainPrompt: '',
      negativePrompt: String(videoRemakeDefaultNegativePrompt),
    });
}

function generationContextForSeedance(workflow: VideoRemakeWorkflowState, traceId: string) {
  const storyboard = storyboardMarkdownFromWorkflow(workflow);
  const speech = scriptContent(workflow);
  const materialReferences = collectMaterialReferences(workflow);
  return {
    workflow,
    confirmedSpeech: speech,
    spokenContent: speech,
    viralUnderstanding: {
      ...(workflow.runtime.viralUnderstanding || {}),
      conversationMessages: storyboard ? [{ source: 'storyboard_final', content: storyboard }] : [],
    },
    videoGenerationFlow: {
      traceId,
      source: 'video_remake_generation',
    },
    allowSeedanceAudioReference: Boolean(materialReferences.referenceAudioIds.length || materialReferences.referenceAudioGroupId),
  };
}

export const defaultVideoRemakeNodeAdapters: VideoRemakeNodeAdapters = {
  async uploadToVod(context) {
    const source = context.workflow.source;
    if (source.kind === 'upload') {
      const file = source.file;
      if (!file?.filePath || !file.originalFileName) {
        throw new Error('缺少本地上传视频文件，无法上传到 VOD');
      }
      const fileSizeBytes = Number(file.fileSize || 0) || statSync(file.filePath).size;
      assertSufficientStepCredits({
        userId: context.userId,
        requiredCredits: estimateVodUploadCredits(fileSizeBytes),
        step: 'upload_to_vod',
        stepLabel: '上传视频',
      });
      context.emit({ node: 'upload_to_vod', message: '正在上传视频到视频点播。', progress: 12 });
      const vod = await uploadLocalVideoToVodWithWorker({
        filePath: file.filePath,
        originalFileName: file.originalFileName,
        title: source.title || file.originalFileName,
        fileSizeBytes,
        taskId: context.taskId,
        userId: context.userId,
      });
      const result = {
        ...vod,
        sourceUrl: source.sourceUrl,
        fileName: file.originalFileName,
        filePath: file.filePath,
        storage: 'volcengine-vod',
        posterUrl: vod.posterUri || source.sourceUrl || file.fileUrl,
      };
      context.workflow.runtime.vod = result;
      context.emit({ node: 'upload_to_vod', message: '视频已上传到 VOD，准备提交专家解析。', progress: 22, data: result });
      return result;
    }
    context.emit({ node: 'upload_to_vod', message: '正在解析视频链接。', progress: 12 });
    const inspection = await inspectVideoUrlWithWorker(source.sourceUrl);
    const result = {
      sourceUrl: source.sourceUrl,
      fileName: inspection.videoInfo.title || source.title,
      storage: 'url-inspection-worker',
      posterUrl: inspection.videoInfo.coverUrl || source.sourceUrl,
      inspection,
    };
    context.workflow.runtime.vod = result;
    context.emit({ node: 'upload_to_vod', message: '视频链接解析完成。', progress: 22, data: result });
    return result;
  },

  async analyzeAudio(context) {
    const inspected = urlInspection(context.workflow);
    if (inspected) {
      context.emit({ node: 'analyze_audio', message: '正在整理链接音频解析结果。', progress: 34 });
      const spokenContent = inspected.transcription?.text || '';
      return {
        roleName: '音频理解专家',
        content: spokenContent,
        summary: spokenContent || '链接解析未返回可用转写文本。',
        spokenContent,
        voice: '原声参考',
        voiceStyle: '参考原视频音色与口播节奏',
        bgm: '',
        soundEffects: '',
        source: 'video_inspect_worker',
      };
    }
    const outputs = await collectUnderstandingOutputs(context);
    const audio = outputs.audio_expert || { roleName: '音频理解专家', content: '' };
    context.emit({ node: 'analyze_audio', message: '音频理解专家结果已返回。', progress: 58 });
    return {
      ...audio,
      summary: audio.content,
      spokenContent: audio.content,
      voice: '原声参考',
      voiceStyle: '参考原视频音色与口播节奏',
      bgm: '',
      soundEffects: '',
    };
  },

  async analyzeVisual(context) {
    const inspected = urlInspection(context.workflow);
    if (inspected) {
      context.emit({ node: 'analyze_visual', message: '正在整理链接画面解析结果。', progress: 42 });
      const info = inspected.videoInfo;
      const summary = [
        info.description,
        info.width && info.height ? `分辨率：${info.width}x${info.height}` : '',
        inspected.frames?.length ? `关键帧：${inspected.frames.length} 张` : '',
      ].filter(Boolean).join('\n');
      return {
        roleName: '视频理解专家',
        content: summary,
        summary,
        characters: [],
        scenes: [{
          label: '场景 1',
          description: summary || info.title || sourceTitle(context.workflow),
          required: true,
          referenceMode: 'prompt',
        }],
        product: {},
        source: 'video_inspect_worker',
      };
    }
    const outputs = await collectUnderstandingOutputs(context);
    const visual = outputs.video_expert || { roleName: '视频理解专家', content: '' };
    const details = visualDetailsFromContent(visual.content);
    context.emit({ node: 'analyze_visual', message: '视频理解专家结果已返回。', progress: 58 });
    return {
      ...visual,
      ...details,
      content: details.content || visual.content,
      summary: details.content || visual.content,
    };
  },

  async analyzePip(context) {
    if (urlInspection(context.workflow)) {
      context.emit({ node: 'analyze_pip', message: '链接解析未发现独立画中画结果。', progress: 46 });
      return {
        roleName: '画中画理解专家',
        content: '',
        summary: '链接解析未发现独立画中画结果。',
        appeared: false,
        items: [],
        source: 'video_inspect_worker',
      };
    }
    const outputs = await collectUnderstandingOutputs(context);
    const pip = outputs.picture_in_picture_expert || { roleName: '画中画解析专家', content: '' };
    const pictureInPicture = isRecord(pip.pictureInPicture) ? pip.pictureInPicture : {};
    context.emit({ node: 'analyze_pip', message: '画中画理解专家结果已返回。', progress: 58 });
    return {
      ...pip,
      summary: textFrom(pictureInPicture.summary) || pip.content,
      appeared: Boolean(pictureInPicture.appeared),
      items: Array.isArray(pictureInPicture.items) ? pictureInPicture.items : [],
      pictureInPicture,
      pipAssets: pip.pipAssets || {},
    };
  },

  async directorNormalize(context) {
    context.emit({ node: 'director_normalize', message: '导演专家正在整理可确认素材表。', progress: 58 });
    if (process.env.VIDEO_REMAKE_DIRECTOR_DISABLE_LLM !== '1') {
      try {
        const llmResult = await generateDirectorNormalizeWithLlm(context);
        if (llmResult) {
          return llmResult;
        }
      } catch (error) {
        logVideoRemakeGeneration('warn', 'director normalize llm failed, fallback to code', {
          sessionId: context.sessionId,
          taskId: context.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return fallbackDirectorNormalizeResult(context);
  },

  async generateStoryboard(context) {
    const content = scriptContent(context.workflow);
    context.emit({ node: 'generate_storyboard', message: '正在生成分镜脚本。', progress: 72 });
    if (process.env.VIDEO_REMAKE_STORYBOARD_DISABLE_LLM === '1') {
      logVideoRemakeGeneration('warn', 'storyboard llm disabled by env, fallback will use confirmed cards', {
        sessionId: context.sessionId,
        taskId: context.taskId,
      });
    } else {
      try {
        const llmStoryboard = await generateStoryboardWithLlm(context);
        if (llmStoryboard.length) {
          return llmStoryboard;
        }
        logVideoRemakeGeneration('warn', 'storyboard llm returned no usable shots, user retry required', {
          sessionId: context.sessionId,
          taskId: context.taskId,
        });
        throw new Error('分镜脚本生成失败：模型返回内容无法解析为分镜，请重试生成分镜');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logVideoRemakeGeneration('warn', 'storyboard llm failed, user retry required', {
          sessionId: context.sessionId,
          taskId: context.taskId,
          error: message,
        });
        throw new Error(message.startsWith('分镜脚本生成失败') ? message : `分镜脚本生成失败：${message}`);
      }
    }
    const segments = parseSpokenSegments(content);
    const fallbackContext = fallbackStoryboardContext(context.workflow);
    const references = collectMaterialReferences(context.workflow);
    return sanitizeStoryboardForConfirmedSettings(attachPipDescriptionsToStoryboard(ensureStoryboardEntityCoverage(segments.map((segment, index) => ({
      shotId: `shot_${index + 1}`,
      index: index + 1,
      label: `镜头 ${index + 1}`,
      startTime: segment.startTime,
      endTime: segment.endTime,
      duration: Math.max(1, Number((segment.endTime - segment.startTime).toFixed(1))),
      visualDescription: fallbackVisualForShot(index, segments.length, fallbackContext),
      actionDescription: fallbackActionForShot(fallbackContext),
      narration: segment.narration,
      soundEffect: fallbackSoundForShot(fallbackContext),
      remakeSuggestion: fallbackRemakeSuggestion(fallbackContext),
      seedanceReady: true,
      source: 'fallback_storyboard',
    })), context.workflow), context.workflow, { userId: context.userId, references }), context.workflow);
  },

  async generateSeedancePrompts(context) {
    const storyboard = Array.isArray(context.workflow.artifacts.storyboardScript)
      ? context.workflow.artifacts.storyboardScript as Array<Record<string, unknown>>
      : [];
    const systemPrompt = buildSeedanceSystemPrompt(context.workflow);
    const referenceIds = collectMaterialReferences(context.workflow);
    const referenceGuide = seedanceReferenceGuide(context.userId, context.workflow, referenceIds);
    const maxDuration = seedanceMaxSegmentSeconds();
    const splitStoryboard = splitLongStoryboardShotsForSeedance(storyboard, maxDuration);
    const storyboardWithPipReferences = attachPipDescriptionsToStoryboard(
      splitStoryboard,
      context.workflow,
      { userId: context.userId, references: referenceIds },
    );
    const segments = groupStoryboardForSeedance(storyboardWithPipReferences, maxDuration);
    context.emit({ node: 'generate_seedance_prompts', message: '正在整理 Seedance 分段提示词。', progress: 82 });
    logVideoRemakeGeneration('info', 'seedance prompts reference labels prepared', {
      sessionId: context.sessionId,
      taskId: context.taskId,
      referenceImageIds: referenceIds.referenceImageIds,
      referenceVideoIds: referenceIds.referenceVideoIds,
      referenceAudioIds: referenceIds.referenceAudioIds,
      referenceGuide,
    });
    return segments.map((segment) => ({
      segmentId: String(segment.segmentId),
      index: Number(segment.index),
      duration: Number(segment.duration || 4),
      startTime: Number(segment.startTime || 0),
      endTime: Number(segment.endTime || Number(segment.duration || 4)),
      maxDuration,
      segmentPurpose: String(segment.segmentPurpose || `分段 ${segment.index}`).slice(0, 24),
      status: 'pending',
      prompt: {
        mainPrompt: buildSegmentPrompt({
          segment,
          referenceGuide,
        }),
        systemPrompt,
        negativePrompt: videoRemakeDefaultNegativePrompt,
        pipPrompt: usefulText(segment.pipDescription),
      },
    }));
  },

  async generateVideoSegments(context) {
    const prompts = Array.isArray(context.workflow.artifacts.seedancePrompts)
      ? context.workflow.artifacts.seedancePrompts as Array<Record<string, unknown>>
      : [];
    context.emit({ node: 'generate_video_segments', message: 'Seedance 分段提示词已准备。', progress: 92 });
    return prompts.map((segment, index) => {
      const prompt = isRecord(segment.prompt) ? segment.prompt : {};
      const spokenLines = promptSectionContent(String(prompt.mainPrompt || ''), '本段口播');
      const finalPrompt = buildSeedancePromptForRequest({
        systemPrompt: String(prompt.systemPrompt || buildSeedanceSystemPrompt(context.workflow)),
        mainPrompt: String(prompt.mainPrompt || ''),
        negativePrompt: String(prompt.negativePrompt || videoRemakeDefaultNegativePrompt),
      });
      logVideoRemakeGeneration('info', 'seedance video segment prepared', {
        sessionId: context.sessionId,
        taskId: context.taskId,
        segmentIndex: index + 1,
        startSecond: positiveNumber(segment.startSecond || segment.startTime),
        endSecond: positiveNumber(segment.endSecond || segment.endTime),
        spokenLines,
      });
      return {
        segmentId: String(segment.segmentId || `segment_${index + 1}`),
        index: index + 1,
        status: 'pending',
        startSecond: positiveNumber(segment.startSecond || segment.startTime),
        endSecond: positiveNumber(segment.endSecond || segment.endTime),
        durationSecond: Math.max(1, positiveNumber(segment.endSecond || segment.endTime) - positiveNumber(segment.startSecond || segment.startTime)),
        promptDigest: finalPrompt.slice(0, 120),
        prompt,
        seedancePrompt: finalPrompt,
        seedanceVersionNumber: segment.seedanceVersionNumber,
        seedanceVersionLabel: segment.seedanceVersionLabel,
        seedanceVersionId: segment.seedanceVersionId,
      };
    });
  },

  async mergeVideo(context) {
    const segments = context.workflow.runtime.videoSegments || [];
    const resolvedVideoConfig = resolveDefaultVideoModel('volcengine-seedance');
    const providerId = resolvedVideoConfig.provider;
    const modelId = resolvedVideoConfig.model;
    const totalSeconds = totalGenerationSeconds(context.workflow);
    const duration = formatDurationLabel(totalSeconds);
    const durationLimit = seedanceGenerationDurationLimit({ providerId, modelId, duration });
    const traceId = createTraceId('video-remake-generation');
    logVideoRemakeGeneration('info', 'node mergeVideo entered', {
      traceId,
      sessionId: context.sessionId,
      taskId: context.taskId,
      userId: context.userId,
      sourceTitle: sourceTitle(context.workflow),
      segmentCount: segments.length,
      totalSeconds,
      duration,
      durationLimit,
    });
    const materialReferences = collectMaterialReferences(context.workflow);
    logVideoRemakeGeneration('info', 'material references collected', {
      traceId,
      sessionId: context.sessionId,
      taskId: context.taskId,
      referenceImageGroupId: materialReferences.referenceImageGroupId,
      referenceAudioGroupId: materialReferences.referenceAudioGroupId,
      referenceImageIds: materialReferences.referenceImageIds,
      referenceVideoIds: materialReferences.referenceVideoIds,
      referenceAudioIds: materialReferences.referenceAudioIds,
    });
    let materialContext = resolveVideoMaterialContext({
      userId: context.userId,
      referenceImageIds: materialReferences.referenceImageIds,
      referenceVideoIds: materialReferences.referenceVideoIds,
      referenceAudioIds: materialReferences.referenceAudioIds,
    });
    let referenceIds = seedanceReferenceIdsFromMaterialContext(materialContext);
    const referenceGuide = seedanceReferenceGuide(context.userId, context.workflow, referenceIds);
    logVideoRemakeGeneration('info', 'material context resolved', {
      traceId,
      sessionId: context.sessionId,
      taskId: context.taskId,
      hasDigitalHuman: Boolean((materialContext as Record<string, unknown>).digitalHuman),
      hasScene: Boolean((materialContext as Record<string, unknown>).scene),
      hasVoice: Boolean((materialContext as Record<string, unknown>).voice),
      referenceImageCount: Array.isArray((materialContext.references as Record<string, unknown>).images)
        ? ((materialContext.references as Record<string, unknown>).images as unknown[]).length
        : 0,
      referenceVideoCount: Array.isArray((materialContext.references as Record<string, unknown>).videos)
        ? ((materialContext.references as Record<string, unknown>).videos as unknown[]).length
        : 0,
      referenceAudioCount: Array.isArray((materialContext.references as Record<string, unknown>).audios)
        ? ((materialContext.references as Record<string, unknown>).audios as unknown[]).length
        : 0,
      referenceImageIds: referenceIds.referenceImageIds,
      referenceVideoIds: referenceIds.referenceVideoIds,
      referenceAudioIds: referenceIds.referenceAudioIds,
      referenceGuide,
    });
    let generationContext = {
      ...generationContextForSeedance(context.workflow, traceId),
      materialContext,
      videoGenerationFlow: {
        traceId,
        source: 'video_remake_generation',
      },
    };
    context.emit({
      node: 'merge_video',
      message: '正在提交 Seedance 视频生成任务。',
      progress: 95,
      data: { providerId, modelId, totalSeconds, segmentCount: segments.length },
    });
    const taskId = context.taskId || context.sessionId;
    const title = sourceTitle(context.workflow);
    const prompts = Array.isArray(context.workflow.artifacts.seedancePrompts)
      ? context.workflow.artifacts.seedancePrompts as Array<Record<string, unknown>>
      : [];
    let prompt = firstSeedanceFinalPrompt(context.workflow);
    const negativePrompts = negativePromptList(videoRemakeDefaultNegativePrompt);
    const ratio = seedanceRatioFromWorkflow(context.workflow);
    const resolution = seedanceResolutionFromWorkflow(context.workflow);
    const seedanceOptions = {
      generateAudio: true,
      watermark: false,
      resolution,
    };
    let primerPlan: ReferencePrimerPlan | undefined;
    logVideoRemakeGeneration('info', 'seedance request prepared', {
      traceId,
      sessionId: context.sessionId,
      taskId,
      title,
      providerId,
      modelId,
      ratio,
      resolution,
      totalSeconds,
      maxSegmentSeconds: durationLimit.maxSeconds,
      mode: totalSeconds > durationLimit.maxSeconds ? 'segmented' : 'single',
      promptLength: prompt.length,
      negativePromptCount: negativePrompts.length,
      seedanceOptions,
      referencePrimerPlan: primerPlan,
    });
    const segmentedConfirmedSpeech = confirmedSpeechFromSeedancePrompts(prompts) || scriptContent(context.workflow);
    const segmentedSpeechPlan = speechPlanFromSeedancePrompts(prompts);
    const result = totalSeconds > durationLimit.maxSeconds
      ? await (async () => {
        logVideoRemakeGeneration('info', 'segmented seedance generation starting', {
          traceId,
          sessionId: context.sessionId,
          taskId,
          totalSeconds,
          maxSegmentSeconds: durationLimit.maxSeconds,
        });
        primerPlan = await maybeGenerateSeedanceReferencePrimers({
          context,
          taskId,
          traceId,
          prompts,
          segments: segments as Array<Record<string, unknown>>,
          materialContext,
          providerId,
          modelId,
          ratio,
          resolution,
          seedanceOptions,
        });
        if (primerPlan) {
          const firstPrimer = primerPlan.spans.find((span) => span.primer)?.primer;
          context.workflow.runtime.referencePrimerPlan = primerPlan;
          context.workflow.runtime.referencePrimer = firstPrimer ? {
            ...firstPrimer,
            videoUrl: firstPrimer.videoUrl,
          } : context.workflow.runtime.referencePrimer;
        }
        const segmentInputs = segments.map((segment, index) => {
          const promptRecord = isRecord(prompts[index]?.prompt) ? prompts[index].prompt : {};
          const finalSegmentPrompt = textFrom(segment.seedancePrompt) || buildSegmentedSeedancePrompt({
            basePrompt: prompt,
            totalSeconds,
            segments: segments.map((item) => Math.max(1, positiveNumber((item as Record<string, unknown>).durationSecond || (item as Record<string, unknown>).duration || 1))),
            segmentIndex: index + 1,
            maxSegmentSeconds: durationLimit.maxSeconds,
            confirmedSpeech: segmentedConfirmedSpeech,
            speechPlan: segmentedSpeechPlan,
          });
          const span = primerSpanForSegment(primerPlan, index + 1);
          const segmentMaterialContext = span?.primer
            ? materialContextWithExtraVideoReference(materialContext, buildReferencePrimerSpanAsset(span.primer, span))
            : materialContext;
          const segmentPrompt = span?.primer
            ? [
              finalSegmentPrompt,
              referencePrimerPromptConstraint(span.primer.gaps),
            ].filter(Boolean).join('\n\n')
            : finalSegmentPrompt;
          return {
            segmentIndex: index + 1,
            seconds: Math.max(1, positiveNumber((segment as Record<string, unknown>).durationSecond || (segment as Record<string, unknown>).duration || 1)),
            prompt: segmentPrompt,
            context: {
              ...generationContext,
              materialContext: segmentMaterialContext,
              videoRemakePrimerPlan: primerPlan,
            },
            materialContext: segmentMaterialContext,
            referencePrimerSpanId: span?.spanId,
          };
        });
        const segmented = await videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration({
          taskId,
          userId: context.userId,
          title,
          negativePrompts: [
            ...negativePrompts,
            ...noOnScreenTextNegativePromptsForExport(),
            '分段开头重复上一段结尾',
            '分段内容重叠',
          ],
          ratio,
          resolution,
          totalSeconds,
          context: {
            ...generationContext,
            videoRemakeSegmentInputs: segmentInputs,
            videoRemakePrimerPlan: primerPlan,
          },
          materialContext,
          providerId,
          modelId,
          seedanceOptions,
          traceId,
          segmentInputs,
        });
        logVideoRemakeGeneration('info', 'segmented seedance generation completed', {
          traceId,
          sessionId: context.sessionId,
          taskId,
          videoUrl: segmented.videoUrl,
          jobId: segmented.jobId,
          segmentCount: Array.isArray(segmented.segments) ? segmented.segments.length : 0,
        });
        return segmented;
      })()
      : await (async () => {
        logVideoRemakeGeneration('info', 'single seedance generation submitting', {
          traceId,
          sessionId: context.sessionId,
          taskId,
          duration,
        });
        const submitted = await videoRemakeVideoModelRuntime.callConfiguredVideoModel({
          taskId,
          title,
          prompt,
          negativePrompts,
          ratio,
          resolution,
          duration,
          context: generationContext,
          providerId,
          modelId,
          seedanceOptions,
        });
        logVideoRemakeGeneration('info', 'single seedance generation submitted', {
          traceId,
          sessionId: context.sessionId,
          taskId,
          provider: submitted.provider,
          model: submitted.model,
          jobId: submitted.jobId,
          status: submitted.status,
          hasVideoUrl: Boolean(submitted.videoUrl),
        });
        const completed = await videoRemakeVideoModelRuntime.waitForVideoModelCompletion({
          providerId,
          modelId,
          jobId: submitted.jobId,
          initialVideoUrl: submitted.videoUrl,
          initialCoverUrl: submitted.coverUrl,
          initialStatus: submitted.status,
          traceId,
          taskId,
        });
        logVideoRemakeGeneration('info', 'single seedance generation completed', {
          traceId,
          sessionId: context.sessionId,
          taskId,
          jobId: completed.jobId,
          status: completed.status,
          videoUrl: completed.videoUrl,
          coverUrl: completed.coverUrl,
          completionTokens: completed.usage?.completionTokens || 0,
          totalTokens: completed.usage?.totalTokens || 0,
        });
        recordVideoGenerationUsageIfNeeded({
          userId: context.userId,
          taskId,
          sourceType: 'video_remake_generation',
          fallbackSourceId: taskId,
          providerId,
          modelId,
          jobId: completed.jobId,
          durationSeconds: totalSeconds,
          usage: completed.usage,
          requestSnapshot: {
            requestMode: 'ark_seedance_async',
            ratio,
            resolution,
            duration,
            durationSeconds: totalSeconds,
            segmentCount: 1,
            renderMode: 'single_seedance',
          },
          responseSnapshot: {
            provider: completed.provider,
            model: completed.model,
            status: completed.status,
            jobId: completed.jobId,
            completionTokens: completed.usage?.completionTokens || 0,
            totalTokens: completed.usage?.totalTokens || 0,
            hasVideoUrl: Boolean(completed.videoUrl),
            hasCoverUrl: Boolean(completed.coverUrl),
          },
          usageRaw: {
            requestMode: 'ark_seedance_async',
            source: 'video_remake_generation',
            renderMode: 'single_seedance',
          },
        });
        if (!completed.videoUrl) {
          throw new Error('视频分段 1 未返回成片地址');
        }
        const singleSegmentPath = await downloadGeneratedVideoSegment({
          url: completed.videoUrl,
          taskId,
          segmentIndex: 1,
          traceId,
        });
        const singleSegmentUrl = fileUrlForContentPath(singleSegmentPath);
        return {
          provider: providerId,
          model: modelId,
          status: 'completed' as const,
          remoteVideoUrl: completed.videoUrl,
          videoUrl: singleSegmentUrl,
          fileUrl: singleSegmentUrl,
          coverUrl: completed.coverUrl,
          jobId: completed.jobId,
          renderMode: 'single_seedance' as const,
          segments: [{
            segmentIndex: 1,
            seconds: totalSeconds,
            provider: completed.provider,
            model: completed.model,
            jobId: completed.jobId,
            remoteVideoUrl: completed.videoUrl,
            videoUrl: singleSegmentUrl,
            fileUrl: singleSegmentUrl,
            url: singleSegmentUrl,
            segmentPath: singleSegmentPath,
            filePath: singleSegmentPath,
            status: completed.status,
          }],
        };
      })();
    context.emit({
      node: 'merge_video',
      message: '视频生成完成。',
      progress: 100,
      data: result,
    });
    return {
      ...result,
      segmentCount: segments.length || (Array.isArray(result.segments) ? result.segments.length : 0),
      referencePrimerPlan: primerPlan,
      referencePrimer: primerPlan?.spans.find((span) => span.primer)?.primer,
      mergedAt: new Date().toISOString(),
      traceId,
    };
  },

  async regenerateVideoSegment(context, input) {
    const traceId = createTraceId('video-remake-segment-regenerate');
    const taskId = context.taskId || context.sessionId;
    const segmentIndex = Math.max(1, Number(input.segmentIndex || 0));
    const cardSegments = Array.isArray(input.cardData.segments)
      ? input.cardData.segments.filter(isRecord)
      : context.workflow.runtime.videoSegments || [];
    const generatedSegments = Array.isArray(input.cardData.generatedSegments)
      ? input.cardData.generatedSegments.filter(isRecord)
      : [];
    const seedancePromptSegments = Array.isArray(input.cardData.seedancePrompts)
      ? input.cardData.seedancePrompts.filter(isRecord)
      : [];
    const historySegments = historicalFinalVideoSegments(input.cardData);
    const mergedSegments = cardSegments.map((segment, index) => {
      const seedancePromptSegment = seedancePromptSegments[index] || {};
      const historySegment = historySegments[index] || {};
      const generatedSegment = generatedSegments[index] || {};
      const merged = {
        ...seedancePromptSegment,
        ...segment,
        ...historySegment,
        ...generatedSegment,
      };
      if (!promptRecordHasText(merged.prompt) && promptRecordHasText(seedancePromptSegment.prompt)) {
        merged.prompt = seedancePromptSegment.prompt;
      }
      if (!textFrom(merged.seedancePrompt) && textFrom(seedancePromptSegment.seedancePrompt)) {
        merged.seedancePrompt = seedancePromptSegment.seedancePrompt;
      }
      return segmentWithLocalFallback(merged, {
        taskId,
        traceId,
        segmentIndex: index + 1,
      });
    });
    if (!mergedSegments.length) {
      throw new Error('当前最终视频没有可重生成的分段');
    }
    const targetSegment = mergedSegments[segmentIndex - 1];
    if (!targetSegment) {
      throw new Error(`分段 ${segmentIndex} 不存在`);
    }
    const resolvedVideoConfig = resolveDefaultVideoModel('volcengine-seedance');
    const providerId = resolvedVideoConfig.provider;
    const modelId = resolvedVideoConfig.model;
    const seconds = Math.max(1, positiveNumber(targetSegment.seconds || targetSegment.durationSecond || targetSegment.duration));
    const targetPrompt = isRecord(targetSegment.prompt) ? targetSegment.prompt : {};
    const promptOverride = input.prompt?.trim();
    const prompt = withSeedanceAudioBoundaryConstraint(promptOverride
      ? buildSeedancePromptForRequest({
        systemPrompt: textFrom(targetPrompt.systemPrompt) || buildSeedanceSystemPrompt(context.workflow),
        mainPrompt: promptOverride,
        negativePrompt: textFrom(targetPrompt.negativePrompt) || videoRemakeDefaultNegativePrompt,
      })
      : (textFrom(targetSegment.seedancePrompt) || buildSeedancePromptForRequest({
        systemPrompt: textFrom(targetPrompt.systemPrompt) || buildSeedanceSystemPrompt(context.workflow),
        mainPrompt: textFrom(targetPrompt.mainPrompt || targetSegment.prompt),
        negativePrompt: textFrom(targetPrompt.negativePrompt) || videoRemakeDefaultNegativePrompt,
      })).trim());
    if (!prompt) {
      throw new Error(`分段 ${segmentIndex} 缺少可重生成的提示词`);
    }
    const materialReferences = collectMaterialReferences(context.workflow);
    let materialContext = resolveVideoMaterialContext({
      userId: context.userId,
      referenceImageIds: materialReferences.referenceImageIds,
      referenceVideoIds: materialReferences.referenceVideoIds,
      referenceAudioIds: materialReferences.referenceAudioIds,
    });
    const regenerationReferenceVideo = segmentRegenerationReferenceVideo({
      workflow: context.workflow,
      cardData: input.cardData,
      mergedSegments,
      segmentIndex,
    });
    if (regenerationReferenceVideo) {
      materialContext = materialContextWithExtraVideoReference(materialContext, regenerationReferenceVideo.asset);
    }
    const generationContext = {
      ...generationContextForSeedance(context.workflow, traceId),
      materialContext,
      videoGenerationFlow: {
        traceId,
        source: 'video_remake_segment_regeneration',
        segmentIndex,
        segmentCount: mergedSegments.length,
      },
    };
    const ratio = seedanceRatioFromWorkflow(context.workflow);
    const resolution = seedanceResolutionFromWorkflow(context.workflow);
    const seedanceOptions = {
      generateAudio: true,
      watermark: false,
      resolution,
    };
    const title = `${sourceTitle(context.workflow)}-片段${segmentIndex}-重生成`;
    logVideoRemakeGeneration('info', 'video segment regeneration submitting', {
      traceId,
      sessionId: context.sessionId,
      taskId,
      cardVersionLabel: textFrom(input.cardData.versionLabel),
      segmentIndex,
      seconds,
      referenceVideoSource: regenerationReferenceVideo?.source || 'none',
      referenceVideoUrl: regenerationReferenceVideo?.asset.fileUrl || '',
    });
    const submitted = await videoRemakeVideoModelRuntime.callConfiguredVideoModel({
      taskId,
      title,
      prompt,
      negativePrompts: [
        ...negativePromptList(videoRemakeDefaultNegativePrompt),
        '分段开头重复上一段结尾',
        '分段内容重叠',
      ],
      ratio,
      resolution,
      duration: formatDurationLabel(seconds),
      context: generationContext,
      providerId,
      modelId,
      seedanceOptions,
    });
    const completed = await videoRemakeVideoModelRuntime.waitForVideoModelCompletion({
      providerId,
      modelId,
      jobId: submitted.jobId,
      initialVideoUrl: submitted.videoUrl,
      initialCoverUrl: submitted.coverUrl,
      initialStatus: submitted.status,
      traceId,
      taskId,
      segmentIndex,
    });
    recordVideoGenerationUsageIfNeeded({
      userId: context.userId,
      taskId,
      sourceType: 'video_remake_segment_regeneration',
      fallbackSourceId: `${taskId}-segment-${segmentIndex}-regeneration`,
      providerId,
      modelId,
      jobId: completed.jobId,
      durationSeconds: seconds,
      usage: completed.usage,
      requestSnapshot: {
        requestMode: 'ark_seedance_async',
        ratio,
        resolution,
        duration: formatDurationLabel(seconds),
        durationSeconds: seconds,
        segmentIndex,
        segmentCount: mergedSegments.length,
        cardVersionLabel: textFrom(input.cardData.versionLabel),
      },
      responseSnapshot: {
        provider: completed.provider,
        model: completed.model,
        status: completed.status,
        jobId: completed.jobId,
        completionTokens: completed.usage?.completionTokens || 0,
        totalTokens: completed.usage?.totalTokens || 0,
        hasVideoUrl: Boolean(completed.videoUrl),
        hasCoverUrl: Boolean(completed.coverUrl),
      },
      usageRaw: {
        requestMode: 'ark_seedance_async',
        source: 'video_remake_segment_regeneration',
        segmentIndex,
        segmentCount: mergedSegments.length,
      },
    });
    if (!completed.videoUrl) {
      throw new Error(`分段 ${segmentIndex} 未返回成片地址`);
    }
    const regeneratedSegmentPath = await downloadGeneratedVideoSegment({
      url: completed.videoUrl,
      taskId,
      segmentIndex,
      traceId,
    });
    const regeneratedSegmentUrl = fileUrlForContentPath(regeneratedSegmentPath);
    const updatedSegments = mergedSegments.map((segment, index) => {
      if (index !== segmentIndex - 1) {
        return segment;
      }
      return {
        ...segment,
        segmentIndex,
        seconds,
        provider: completed.provider,
        model: completed.model,
        jobId: completed.jobId,
        remoteVideoUrl: completed.videoUrl,
        videoUrl: regeneratedSegmentUrl,
        fileUrl: regeneratedSegmentUrl,
        url: regeneratedSegmentUrl,
        segmentPath: regeneratedSegmentPath,
        filePath: regeneratedSegmentPath,
        status: completed.status,
        prompt: promptOverride ? { ...targetPrompt, mainPrompt: promptOverride } : targetPrompt,
        seedancePrompt: prompt,
        regeneratedAt: new Date().toISOString(),
      };
    });
    const currentVideoPath = contentFilePathFromUrl(input.cardData.videoUrl);
    const resolvedSegments = [...updatedSegments];
    const segmentPaths = await Promise.all(updatedSegments.map(async (segment, index) => {
      const currentSegmentIndex = index + 1;
      const existingPath = textFrom(segment.segmentPath || segment.filePath);
      if (existingPath && existsSync(existingPath)) {
        return existingPath;
      }
      if (currentSegmentIndex !== segmentIndex && currentVideoPath) {
        const extracted = await extractOriginalSegmentFromCurrentVideo({
          sourcePath: currentVideoPath,
          taskId,
          traceId,
          segmentIndex: currentSegmentIndex,
          segments: updatedSegments,
        });
        if (extracted) {
          resolvedSegments[index] = {
            ...segment,
            videoUrl: extracted.videoUrl,
            segmentPath: extracted.filePath,
            status: 'completed',
            reusedFromCurrentVersion: true,
          };
          return extracted.filePath;
        }
      }
      const videoUrl = textFrom(segment.videoUrl);
      if (!videoUrl) {
        throw new Error(`分段 ${currentSegmentIndex} 缺少视频地址，无法重新合成`);
      }
      return downloadGeneratedVideoSegment({
        url: videoUrl,
        taskId,
        segmentIndex: currentSegmentIndex,
        traceId,
      });
    }));
    const merged = await mergeGeneratedVideoSegments({
      taskId,
      segmentPaths,
      traceId,
    });
    logVideoRemakeGeneration('info', 'video segment regeneration completed', {
      traceId,
      sessionId: context.sessionId,
      taskId,
      segmentIndex,
      videoUrl: merged.fileUrl,
    });
    return {
      status: 'completed',
      videoUrl: merged.fileUrl,
      renderMode: 'segment_regenerated_ffmpeg',
      regeneratedSegmentIndex: segmentIndex,
      generatedSegments: resolvedSegments,
      segments: resolvedSegments,
      regeneratedAt: new Date().toISOString(),
      traceId,
    };
  },
};
