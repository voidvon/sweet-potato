import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contentPublicBaseUrl } from '../../../config/env.js';
import { createTraceId, logger, logsDir } from '../../../shared/logger.js';
import { findBillableUsageRecordByCategoryAndSourceId, recordVideoGenerationUsage } from '../../billing/billing.service.js';
import { modelConfigRepository } from '../../model-configs/model-config.repository.js';
import type { VideoModelOption, VideoModelProvider } from '../../video-models/video-model-provider.types.js';
import { getVideoModelProvider } from '../../video-models/video-model.registry.js';
import { contentRepository } from '../content.repository.js';
import type {
  VideoGenerationResult,
  VideoGenerationTask,
  ViralReplicationPlan
} from '../content.types.js';
import {
  contentFilePathForRelativePath,
  contentFilesDir,
  errorLogContext,
  execFileAsync,
  generatedMediaRelativePath,
} from './content-common.js';
import { createPendingFinishedVideoAsset, ensureGeneratedAssetGroup } from './content-image-assets.js';
import { updateVideoTaskParseResult } from './content-video-task-runtime.js';
import { isRecord } from './content-viral-analysis.js';
import { ViralDirectorStatus, logVideoGenerationFlow, normalizeViralConversationMessages, stringValue } from './content-viral-director.js';
import { renderPromptTemplate, viralSeedanceSegmentPromptTemplate } from './content-viral-director-prompts.js';
import { absolutizeMaterialUrl, fileUrlFor } from './content-voice-clone.js';

export function resolveDefaultImageModel() {
  const config = modelConfigRepository.list('image').find((item) => Boolean(item.isDefault))
    || modelConfigRepository.list('image')[0];
  if (!config?.apiKey) {
    throw new Error('请先在模型配置中配置默认图片模型 API Key');
  }
  if (!config.model || !config.baseUrl) {
    throw new Error('默认图片模型配置不完整，缺少 model 或 baseUrl');
  }
  return config;
}

export function resolveDefaultVideoModel(providerId?: string) {
  const envApiKey = String(process.env.VIDEO_MODEL_API_KEY || process.env.ARK_API_KEY || '').trim();
  const envProviderId = String(providerId || process.env.VIDEO_MODEL_PROVIDER || 'volcengine-seedance').trim();
  const envModel = String(process.env.VIDEO_MODEL_ID || '').trim();
  const envBaseUrl = String(process.env.VIDEO_MODEL_BASE_URL || '').trim();
  const videoConfigs = modelConfigRepository.list('video');
  const providerConfig = providerId
    ? videoConfigs.find((item) => item.provider === providerId)
    : undefined;
  const defaultConfig = providerConfig
    || videoConfigs.find((item) => Boolean(item.isDefault))
    || videoConfigs[0];

  if (!defaultConfig && envApiKey) {
    const provider = getVideoModelProvider(envProviderId);
    const model = envModel || provider.defaultModel;
    return {
      id: `env-${provider.id}`,
      type: 'video' as const,
      name: provider.name,
      provider: provider.id,
      model,
      apiKey: envApiKey,
      baseUrl: envBaseUrl || provider.defaultBaseUrl,
      temperature: 0,
      settings: {},
      isDefault: true,
      sortOrder: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  if (!defaultConfig?.apiKey || !defaultConfig.model || !defaultConfig.provider) {
    throw new Error('请先配置视频模型');
  }

  const provider = getVideoModelProvider(defaultConfig.provider);
  return {
    ...defaultConfig,
    baseUrl: defaultConfig.baseUrl || envBaseUrl || provider.defaultBaseUrl,
    apiKey: defaultConfig.apiKey || envApiKey,
    model: defaultConfig.model || envModel || provider.defaultModel,
  };
}

export function resolveConfiguredVideoProvider(config: ReturnType<typeof resolveDefaultVideoModel>) {
  return getVideoModelProvider(config.provider || 'volcengine-seedance');
}

export function resolveConfiguredVideoOption(provider: VideoModelProvider, config: ReturnType<typeof resolveDefaultVideoModel>, modelId?: string) {
  const resolvedModelId = String(modelId || config.model || provider.defaultModel).trim();
  return provider.models.find((item) => item.id === resolvedModelId) || {
    id: resolvedModelId,
    name: resolvedModelId,
    description: '自定义模型',
    supportedReferenceTypes: [] as const,
    referencePolicy: {
      imageMode: 'none' as const,
      maxImages: 0,
      allowVideo: false,
      maxVideos: 0,
      allowAudio: false,
      maxAudios: 0,
    },
    durationPolicy: {
      minSeconds: 4,
      maxSeconds: 15,
      defaultSeconds: 5,
      supportsAuto: false,
    },
  };
}

export function isArkSeedanceConfig(config: { baseUrl: string; model: string; provider?: string }) {
  return /seedance/i.test(config.model)
    || /ark/i.test(config.provider || '')
    || /ark\.cn-[\w-]+\.volces\.com/i.test(config.baseUrl)
    || /\/contents\/generations\/tasks$/i.test(config.baseUrl.replace(/\/+$/, ''));
}

type VideoGenerationTaskSnapshot = {
  provider?: string;
  model?: string;
  jobId?: string;
  videoUrl?: string;
  coverUrl?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
  rawStatus?: string;
  usage?: VideoGenerationUsageSnapshot;
};

export type VideoGenerationUsageSnapshot = {
  completionTokens: number;
  totalTokens: number;
  toolUsage?: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export function videoGenerationUrl(baseUrl: string, config?: { model: string; provider?: string }) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/contents\/generations\/tasks$/i.test(trimmed)) {
    return trimmed;
  }
  if (config && isArkSeedanceConfig({ baseUrl, ...config })) {
    return `${trimmed}/contents/generations/tasks`;
  }
  if (/\/videos\/generations$/.test(trimmed) || /\/video\/generations$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/videos/generations`;
}

export function parseDurationSeconds(duration: string) {
  const raw = duration.trim();
  if (raw === '-1' || raw === '智能时长' || raw.toLowerCase() === 'auto') {
    return -1;
  }
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.round(value);
}

export function formatDurationLabel(seconds: number) {
  return `${Math.round(seconds)}秒`;
}

function integerFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return 0;
}

function usageRecordFromVideoGenerationRecord(record: Record<string, unknown>) {
  const nestedTask = isRecord(record.task) ? record.task : undefined;
  const first = Array.isArray(record.data) && isRecord(record.data[0]) ? record.data[0] : undefined;
  return [record.usage, first?.usage, nestedTask?.usage]
    .find((item) => isRecord(item)) as Record<string, unknown> | undefined;
}

function parseVideoGenerationUsage(record: Record<string, unknown>): VideoGenerationUsageSnapshot | undefined {
  const usage = usageRecordFromVideoGenerationRecord(record);
  if (!usage) {
    return undefined;
  }
  const completionTokens = integerFromRecord(usage, ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens']);
  const totalTokens = Math.max(
    completionTokens,
    integerFromRecord(usage, ['total_tokens', 'totalTokens']),
  );
  const toolUsage = isRecord(usage.tool_usage)
    ? usage.tool_usage
    : isRecord(usage.toolUsage)
      ? usage.toolUsage
      : undefined;
  if (!completionTokens && !totalTokens && !toolUsage) {
    return undefined;
  }
  return {
    completionTokens,
    totalTokens,
    toolUsage,
    raw: usage,
  };
}

export function vodDurationSeconds(vod: Record<string, unknown>) {
  const sourceInfo = isRecord(vod.sourceInfo) ? vod.sourceInfo : {};
  const raw = Number(sourceInfo.duration || sourceInfo.Duration || sourceInfo.durationSeconds || 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return raw > 1000 ? Math.round(raw / 1000) : Math.round(raw);
}

export function formatAnalysisEstimate(seconds: number) {
  if (!seconds) {
    return '';
  }
  const min = Math.max(1, Math.round(seconds * 1.5));
  const max = Math.max(min, Math.round(seconds * 3));
  const format = (value: number) => {
    if (value < 60) {
      return `${value}秒`;
    }
    const minutes = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${minutes}分${rest}秒` : `${minutes}分钟`;
  };
  return `${format(min)}-${format(max)}`;
}

export function seedanceDurationSeconds(duration: string, modelOption: VideoModelOption, settings?: Record<string, unknown>) {
  const configured = Number(settings?.durationSeconds || settings?.duration);
  const requested = parseDurationSeconds(duration);
  const preferred = Number.isFinite(configured) ? Math.round(configured) : requested;
  if (preferred === -1 && modelOption.durationPolicy.supportsAuto) {
    return -1;
  }
  if (Number.isFinite(preferred) && typeof preferred === 'number') {
    return Math.min(
      modelOption.durationPolicy.maxSeconds,
      Math.max(modelOption.durationPolicy.minSeconds, preferred),
    );
  }
  return modelOption.durationPolicy.defaultSeconds;
}

export function seedanceGenerationDurationLimit(input: {
  providerId?: string;
  modelId?: string;
  duration: string;
}) {
  const config = resolveDefaultVideoModel(input.providerId);
  const provider = resolveConfiguredVideoProvider(config);
  const modelOption = resolveConfiguredVideoOption(provider, config, input.modelId);
  const requested = parseDurationSeconds(input.duration);
  const configured = Number(config.settings?.durationSeconds || config.settings?.duration);
  const effective = requested && requested > 0
    ? requested
    : Number.isFinite(configured)
      ? Math.round(configured)
      : modelOption.durationPolicy.defaultSeconds;
  return {
    requestedSeconds: effective,
    maxSeconds: modelOption.durationPolicy.maxSeconds,
    modelId: modelOption.id,
    providerId: provider.id,
  };
}

function effectiveVideoGenerationSourceId(jobId: string | undefined, fallbackSourceId: string) {
  return String(jobId || fallbackSourceId || '').trim();
}

export function recordVideoGenerationUsageIfNeeded(input: {
  userId: string;
  taskId: string;
  sourceType: string;
  fallbackSourceId: string;
  providerId?: string;
  modelId?: string;
  jobId?: string;
  duration?: string;
  durationSeconds?: number;
  usage?: VideoGenerationUsageSnapshot;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
  usageRaw?: Record<string, unknown>;
}) {
  const sourceId = effectiveVideoGenerationSourceId(input.jobId, input.fallbackSourceId);
  if (!sourceId || findBillableUsageRecordByCategoryAndSourceId('video_generation', sourceId)) {
    return null;
  }
  const config = resolveDefaultVideoModel(input.providerId);
  const provider = resolveConfiguredVideoProvider(config);
  const modelOption = resolveConfiguredVideoOption(provider, config, input.modelId);
  const billedDurationSeconds = input.durationSeconds && input.durationSeconds > 0
    ? Math.round(input.durationSeconds)
    : input.duration
      ? seedanceDurationSeconds(input.duration, modelOption, config.settings)
      : modelOption.durationPolicy.defaultSeconds;
  const billingModelConfig = {
    ...config,
    id: modelOption.id,
    name: modelOption.name,
    model: modelOption.id,
  };
  return recordVideoGenerationUsage({
    userId: input.userId,
    modelConfig: billingModelConfig,
    sourceType: input.sourceType,
    sourceId,
    taskId: input.taskId,
    durationSeconds: billedDurationSeconds,
    usage: input.usage,
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    usageRaw: input.usageRaw,
  });
}

export function splitVideoDurationSeconds(totalSeconds: number, maxSegmentSeconds: number) {
  const total = Math.max(1, Math.round(totalSeconds));
  const max = Math.max(1, Math.round(maxSegmentSeconds));
  if (total <= max) {
    return [total];
  }
  const segmentCount = Math.ceil(total / max);
  const base = Math.floor(total / segmentCount);
  let remainder = total % segmentCount;
  return Array.from({ length: segmentCount }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return value;
  });
}

type StoryboardRange = {
  start: number;
  end: number;
  shotLabel: string;
  visualText: string;
  speechText: string;
};

type ParsedStoryboardBlockContent = {
  visualText: string;
  speechText: string;
  visualField: string;
  actionField: string;
  soundField: string;
};

type StoryboardSegmentGroup = {
  segmentIndex: number;
  start: number;
  end: number;
  seconds: number;
  ranges: StoryboardRange[];
  source: 'storyboard' | 'fallback';
};

type SegmentedSpeechSlice = {
  segmentIndex: number;
  playableSpeech: string;
  previousContext: string;
  nextContext: string;
  estimatedSpeechSeconds: number;
  source: 'confirmed_speech' | 'storyboard_fallback' | 'silent';
};

function normalizeSegmentedSpeechPlan(value: unknown, expectedSegments: number): SegmentedSpeechSlice[] | undefined {
  if (!Array.isArray(value) || value.length !== expectedSegments) {
    return undefined;
  }
  const normalized: SegmentedSpeechSlice[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      return undefined;
    }
    const source = item.source === 'confirmed_speech' || item.source === 'storyboard_fallback' || item.source === 'silent'
      ? item.source
      : undefined;
    if (!source) {
      return undefined;
    }
    const playableSpeech = stringValue(item.playableSpeech).trim();
    normalized.push({
      segmentIndex: Number(item.segmentIndex) || index + 1,
      playableSpeech,
      previousContext: stringValue(item.previousContext).trim(),
      nextContext: stringValue(item.nextContext).trim(),
      estimatedSpeechSeconds: Number(item.estimatedSpeechSeconds) || estimatedChineseSpeechSeconds(playableSpeech),
      source,
    });
  }
  return normalized;
}

function extractStoryboardFromContext(context: Record<string, unknown>) {
  const viralUnderstanding = isRecord(context.viralUnderstanding) ? context.viralUnderstanding : {};
  const conversationMessages = normalizeViralConversationMessages(viralUnderstanding.conversationMessages);
  return conversationMessages.find((item) => item.source === 'storyboard_final')?.content || '';
}

function extractConfirmedSpeechFromContext(context: Record<string, unknown>) {
  const candidates: string[] = [];
  const push = (value: unknown) => {
    const text = stringValue(value).trim();
    if (text) {
      candidates.push(text);
    }
  };
  const viralUnderstanding = isRecord(context.viralUnderstanding) ? context.viralUnderstanding : {};
  const directorConfirmed = isRecord(context.directorConfirmed)
    ? context.directorConfirmed
    : isRecord(viralUnderstanding.directorConfirmed)
      ? viralUnderstanding.directorConfirmed
      : undefined;
  const directorDraft = isRecord(viralUnderstanding.directorDraft) ? viralUnderstanding.directorDraft : undefined;
  push(directorConfirmed?.part);
  push(directorDraft?.part);
  push(context.confirmedSpeech);
  push(context.spokenContent);
  const workspace = isRecord(context.workspace) ? context.workspace : undefined;
  push(workspace?.spokenContent);
  const editableParseResult = isRecord(context.editableParseResult) ? context.editableParseResult : undefined;
  push(editableParseResult?.spokenContent);
  return candidates.find(Boolean) || '';
}

const storyboardTimeValuePattern = String.raw`\d+(?::\d+(?:\.\d+)?){1,2}|\d+(?:\.\d+)?`;
const storyboardRangePatternSource = String.raw`(${storyboardTimeValuePattern})\s*(?:秒|s)?\s*-\s*(${storyboardTimeValuePattern})\s*(?:秒|s)?`;

function parseStoryboardTimeSeconds(value: string) {
  const normalized = value.trim();
  if (!normalized.includes(':')) {
    return Number(normalized);
  }
  const parts = normalized.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return Number.NaN;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return Number.NaN;
}

function parseStoryboardRanges(storyboard: string): StoryboardRange[] {
  const normalized = storyboard.replace(/[－—–~～至到]/g, '-');
  const blockPattern = new RegExp(String.raw`(?:^|\n)(?=(?:#{1,4}\s*)?镜头\s*\d+[\s\S]*?${storyboardRangePatternSource})`, 'g');
  const starts = Array.from(normalized.matchAll(blockPattern)).map((match) => match.index || 0);
  const blocks = starts.length
    ? starts.map((start, index) => ({
      text: storyboard.slice(start, starts[index + 1] || storyboard.length).trim(),
      normalizedText: normalized.slice(start, starts[index + 1] || normalized.length).trim(),
    })).filter((item) => item.text)
    : normalized.split(new RegExp(String.raw`\n(?=.*?${storyboardRangePatternSource})`, 'g')).map((normalizedText) => {
      const start = normalized.indexOf(normalizedText);
      return {
        text: storyboard.slice(start, start + normalizedText.length).trim(),
        normalizedText: normalizedText.trim(),
      };
    }).filter((item) => item.text);
  const rangePattern = new RegExp(storyboardRangePatternSource, 'i');
  const ranges = blocks.flatMap((block, index) => {
    const match = block.normalizedText.match(rangePattern);
    if (!match) {
      return [];
    }
    const start = parseStoryboardTimeSeconds(match[1]);
    const end = parseStoryboardTimeSeconds(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    const shotMatch = block.normalizedText.match(/镜头\s*(\d+)/);
    const shotLabel = shotMatch?.[1] ? `镜头 ${shotMatch[1]}` : `镜头 ${index + 1}`;
    const content = parseStoryboardBlockContent(block.text, shotLabel, start, end);
    return [{
      start,
      end,
      shotLabel,
      visualText: content.visualText,
      speechText: content.speechText,
      _parsedContent: content,
    }];
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  return resolveStoryboardRangeReferences(ranges).map(({ _parsedContent, ...range }) => range);
}

function normalizeStoryboardHeading(line: string) {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/^\*+/, '')
    .replace(/\*+$/g, '')
    .trim();
}

function normalizeVisualPromptLine(line: string) {
  return line
    .replace(/说到“[^”]+”时/g, '关键表达时')
    .replace(/念到“[^”]+”时/g, '关键表达时')
    .replace(/表达“[^”]+”/g, '表达对应情绪')
    .replace(/仿佛在列举“[^”]+”/g, '做列举动作')
    .replace(/“[^”]+”/g, '对应内容')
    .replace(/台词/g, '人声')
    .replace(/旁白/g, '人声')
    .replace(/口播/g, '人声');
}

function isTextProhibitionLine(line: string) {
  return /(?:字幕|屏幕文字|可读文字|文字浮层|逐字稿|caption|subtitle|transcript)/i.test(line)
    && /(?:不生成|不要|禁止|不添加|无新增|保持干净)/.test(line);
}

function parseStoryboardBlockContent(block: string, shotLabel: string, start: number, end: number): ParsedStoryboardBlockContent {
  type Section = 'visual' | 'action' | 'sound' | 'speech' | 'blocked' | '';
  let section: Section = '';
  const visualLines: string[] = [`${shotLabel}｜${start}-${end}秒`];
  const speechLines: string[] = [];
  const fieldLines: Record<'visual' | 'action' | 'sound', string[]> = {
    visual: [],
    action: [],
    sound: [],
  };
  const pushVisualLine = (line: string, field?: 'visual' | 'action' | 'sound') => {
    const normalized = normalizeVisualPromptLine(line.replace(/^[-*]\s*/, '').trim());
    if (normalized) {
      visualLines.push(normalized);
      if (field) {
        fieldLines[field].push(normalized.replace(/^(?:画面|人物\/动作|音效)[：:]\s*/, '').trim());
      }
    }
  };

  for (const rawLine of block.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^```/.test(trimmed)) {
      continue;
    }
    const heading = normalizeStoryboardHeading(trimmed);
    if (/^镜头\s*\d+/.test(heading)) {
      continue;
    }
    const inlineVisual = heading.match(/^画面\s*[：:]\s*(.+)$/);
    if (inlineVisual) {
      section = 'visual';
      pushVisualLine(`画面：${inlineVisual[1].trim()}`, 'visual');
      continue;
    }
    const inlineAction = heading.match(/^(?:人物\/动作|人物动作|动作)\s*[：:]\s*(.+)$/);
    if (inlineAction) {
      section = 'action';
      pushVisualLine(`人物/动作：${inlineAction[1].trim()}`, 'action');
      continue;
    }
    const inlineSound = heading.match(/^音效\s*[：:]\s*(.+)$/);
    if (inlineSound) {
      section = 'sound';
      if (!isTextProhibitionLine(inlineSound[1])) {
        pushVisualLine(`音效：${inlineSound[1].trim()}`, 'sound');
      }
      continue;
    }
    if (/^(?:复刻建议|字幕|字幕样式|文案)\s*[：:].+$/u.test(heading)) {
      section = 'blocked';
      continue;
    }
    if (/^画面\s*[：:]?$/.test(heading)) {
      section = 'visual';
      visualLines.push('画面：');
      continue;
    }
    if (/^(?:人物\/动作|人物动作|动作)\s*[：:]?$/.test(heading)) {
      section = 'action';
      visualLines.push('人物/动作：');
      continue;
    }
    if (/^音效\s*[：:]?$/.test(heading)) {
      section = 'sound';
      visualLines.push('音效：');
      continue;
    }
    const inlineSpeech = heading.match(/^(?:台词\/旁白|台词|旁白|口播|人声|人声内容)(?:\/人声)?\s*[：:]\s*(.+)$/);
    if (inlineSpeech) {
      section = 'speech';
      speechLines.push(inlineSpeech[1].trim());
      continue;
    }
    if (/^(?:台词\/旁白|台词|旁白|口播|人声|人声内容)(?:\/人声)?\s*[：:]?$/.test(heading)) {
      section = 'speech';
      continue;
    }
    if (/^(?:复刻建议|字幕|字幕样式|文案)\s*[：:]?$/.test(heading)) {
      section = 'blocked';
      continue;
    }
    if ((section === 'visual' || section === 'action' || section === 'sound') && !isTextProhibitionLine(trimmed)) {
      pushVisualLine(trimmed, section);
    } else if (section === 'speech') {
      speechLines.push(trimmed.replace(/^[-*]\s*/, ''));
    }
  }

  return {
    visualText: visualLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    speechText: speechLines.join('\n').trim(),
    visualField: fieldLines.visual.join('\n').trim(),
    actionField: fieldLines.action.join('\n').trim(),
    soundField: fieldLines.sound.join('\n').trim(),
  };
}

function shotNumberFromLabel(label: string) {
  const match = label.match(/镜头\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function storyboardReferencePrefix(value: string) {
  const normalized = value.trim();
  const explicit = normalized.match(/^同\s*镜头\s*(\d+)\s*[，,、；;。:]?\s*(.*)$/);
  if (explicit) {
    return {
      targetShot: Number(explicit[1]),
      suffix: explicit[2]?.trim() || '',
    };
  }
  if (/^(?:同上|同前|同前一镜头|延续上(?:一)?镜头)\s*[，,、；;。:]?\s*$/.test(normalized)) {
    return {
      targetShot: -1,
      suffix: '',
    };
  }
  const inherited = normalized.match(/^(?:同上|同前|同前一镜头|延续上(?:一)?镜头)\s*[，,、；;。:]\s*(.+)$/);
  if (inherited) {
    return {
      targetShot: -1,
      suffix: inherited[1].trim(),
    };
  }
  return null;
}

function resolveStoryboardReferencedField(
  value: string,
  field: 'visualField' | 'actionField' | 'soundField',
  currentIndex: number,
  ranges: Array<StoryboardRange & { _parsedContent: ParsedStoryboardBlockContent }>,
) {
  const reference = storyboardReferencePrefix(value);
  if (!reference) {
    return value.trim();
  }
  const target = reference.targetShot > 0
    ? ranges.find((range) => shotNumberFromLabel(range.shotLabel) === reference.targetShot)
    : ranges[currentIndex - 1];
  const referenced = target?._parsedContent[field]?.trim();
  if (!referenced) {
    return value.trim();
  }
  return [referenced, reference.suffix].filter(Boolean).join('\n').trim();
}

function resolveStoryboardRangeReferences(ranges: Array<StoryboardRange & { _parsedContent: ParsedStoryboardBlockContent }>) {
  return ranges.map((range, index) => {
    const visualField = resolveStoryboardReferencedField(range._parsedContent.visualField, 'visualField', index, ranges);
    const actionField = resolveStoryboardReferencedField(range._parsedContent.actionField, 'actionField', index, ranges);
    const soundField = resolveStoryboardReferencedField(range._parsedContent.soundField, 'soundField', index, ranges);
    const visualLines = [
      `${range.shotLabel}｜${range.start}-${range.end}秒`,
      visualField ? `画面：${visualField}` : '',
      actionField ? `人物/动作：${actionField}` : '',
      soundField ? `音效：${soundField}` : '',
    ].filter(Boolean);
    return {
      ...range,
      visualText: visualLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      _parsedContent: {
        ...range._parsedContent,
        visualField,
        actionField,
        soundField,
      },
    };
  });
}

function ensureStructuredStoryboardRange(range: StoryboardRange | (Partial<StoryboardRange> & { text?: string })) {
  if (range.visualText !== undefined && range.speechText !== undefined) {
    return range as StoryboardRange;
  }
  const legacyText = 'text' in range ? range.text : '';
  const parsed = parseStoryboardBlockContent(
    String(legacyText || ''),
    String(range.shotLabel || '镜头'),
    Number(range.start || 0),
    Number(range.end || 0),
  );
  return {
    start: Number(range.start || 0),
    end: Number(range.end || 0),
    shotLabel: String(range.shotLabel || '镜头'),
    visualText: parsed.visualText,
    speechText: parsed.speechText,
  };
}

function fallbackSegmentGroups(totalSeconds: number, maxSegmentSeconds: number): StoryboardSegmentGroup[] {
  const total = Math.max(1, Math.round(totalSeconds));
  const max = Math.max(1, Math.round(maxSegmentSeconds));
  let cursor = 0;
  return splitVideoDurationSeconds(total, max).map((seconds, index) => {
    const start = cursor;
    cursor += seconds;
    return {
      segmentIndex: index + 1,
      start,
      end: cursor,
      seconds,
      ranges: [],
      source: 'fallback',
    };
  });
}

function createStoryboardSegmentGroup(ranges: StoryboardRange[], segmentIndex: number): StoryboardSegmentGroup {
  const start = ranges[0]?.start || 0;
  const end = ranges.at(-1)?.end || start;
  return {
    segmentIndex,
    start,
    end,
    seconds: Math.max(1, Math.round(end - start)),
    ranges,
    source: 'storyboard',
  };
}

function splitLongStoryboardRange(range: StoryboardRange, maxSegmentSeconds: number, startSegmentIndex: number) {
  if (range.speechText.trim()) {
    return [createStoryboardSegmentGroup([range], startSegmentIndex)];
  }
  const max = Math.max(1, Math.round(maxSegmentSeconds));
  const groups: StoryboardSegmentGroup[] = [];
  let cursor = range.start;
  let segmentIndex = startSegmentIndex;
  while (cursor < range.end) {
    const end = Math.min(range.end, cursor + max);
    groups.push({
      segmentIndex,
      start: cursor,
      end,
      seconds: Math.max(1, Math.round(end - cursor)),
      ranges: [{
        ...range,
        start: cursor,
        end,
        visualText: `${range.visualText}\n本段只生成 ${cursor}-${end} 秒子区间。`,
      }],
      source: 'storyboard',
    });
    cursor = end;
    segmentIndex += 1;
  }
  return groups;
}

function buildStoryboardSegmentGroups(totalSeconds: number, maxSegmentSeconds: number, storyboard: string): StoryboardSegmentGroup[] {
  const total = Math.max(1, Math.round(totalSeconds));
  const max = Math.max(1, Math.round(maxSegmentSeconds));
  const ranges = parseStoryboardRanges(storyboard)
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(total, range.start)),
      end: Math.max(0, Math.min(total, range.end)),
    }))
    .filter((range) => range.end > range.start);
  if (!ranges.length) {
    return fallbackSegmentGroups(total, max);
  }
  const groups: StoryboardSegmentGroup[] = [];
  let currentRanges: StoryboardRange[] = [];
  const pushCurrent = () => {
    if (!currentRanges.length) {
      return;
    }
    groups.push(createStoryboardSegmentGroup(currentRanges, groups.length + 1));
    currentRanges = [];
  };
  ranges.forEach((range) => {
    const rangeSeconds = Math.max(1, Math.round(range.end - range.start));
    if (rangeSeconds > max) {
      pushCurrent();
      groups.push(...splitLongStoryboardRange(range, max, groups.length + 1));
      return;
    }
    if (currentRanges.length) {
      const nextStart = currentRanges[0].start;
      const nextSeconds = Math.max(1, Math.round(range.end - nextStart));
      if (nextSeconds > max) {
        pushCurrent();
      }
    }
    currentRanges.push(range);
  });
  pushCurrent();
  return groups.length ? groups : fallbackSegmentGroups(total, max);
}

export function estimatedChineseSpeechSeconds(text: string) {
  const normalized = text
    .replace(/\s+/g, '')
    .replace(/[，,。.!！?？；;：:“”"‘’'、（）()[\]{}<>《》]/g, '');
  if (!normalized) {
    return 0;
  }
  return Math.ceil(normalized.length / 4);
}

function normalizeSpeechScript(text: string) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function segmentSpeechWeightHints(input: {
  segments: number[];
  segmentPlan?: StoryboardSegmentGroup[];
  storyboard?: string;
}) {
  const plan = input.segmentPlan?.length === input.segments.length ? input.segmentPlan : undefined;
  if (plan) {
    const weights = plan.map((group) => {
      const speechHint = normalizeSpeechScript(formatStoryboardRangesSpeech(group.ranges.map(ensureStructuredStoryboardRange)));
      return speechHint ? Math.max(1, estimatedChineseSpeechSeconds(speechHint)) : 0;
    });
    if (weights.some((value) => value > 0)) {
      return weights;
    }
  }
  if (input.storyboard && storyboardHasSpeech(input.storyboard)) {
    const weights = input.segments.map((_seconds, index) => {
      const ranges = storyboardRangesForWindow(input.storyboard || '', input.segments, index + 1);
      const speechHint = normalizeSpeechScript(formatStoryboardRangesSpeech(ranges.current));
      return speechHint ? Math.max(1, estimatedChineseSpeechSeconds(speechHint)) : 0;
    });
    if (weights.some((value) => value > 0)) {
      return weights;
    }
  }
  return input.segments.map((seconds) => Math.max(1, Math.round(seconds)));
}

function skipSpeechWhitespace(text: string, index: number) {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function findSpeechBreakIndex(text: string, start: number, targetChars: number) {
  const minEnd = Math.min(text.length, start + 1);
  const idealEnd = Math.min(text.length, start + Math.max(1, targetChars));
  if (idealEnd >= text.length) {
    return text.length;
  }
  const searchWindow = Math.max(12, Math.min(48, Math.round(targetChars * 0.35)));
  const breakPattern = /[。！？!?；;，,\n]/gu;
  const forwardSlice = text.slice(idealEnd, Math.min(text.length, idealEnd + searchWindow));
  const forwardMatch = forwardSlice.match(breakPattern);
  if (forwardMatch) {
    const matched = forwardMatch[0];
    const offset = forwardSlice.indexOf(matched);
    return skipSpeechWhitespace(text, idealEnd + offset + matched.length);
  }
  const backwardStart = Math.max(minEnd, idealEnd - searchWindow);
  const backwardSlice = text.slice(backwardStart, idealEnd);
  const backwardMatches = Array.from(backwardSlice.matchAll(breakPattern));
  if (backwardMatches.length) {
    const matched = backwardMatches.at(-1);
    if (matched && matched.index !== undefined) {
      return skipSpeechWhitespace(text, backwardStart + matched.index + matched[0].length);
    }
  }
  return skipSpeechWhitespace(text, idealEnd);
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

function buildSegmentedSpeechPlan(input: {
  confirmedSpeech?: string;
  segments: number[];
  segmentPlan?: StoryboardSegmentGroup[];
  storyboard?: string;
}) {
  const fallbackStoryboardSpeech = input.segmentPlan?.length
    ? normalizeSpeechScript(input.segmentPlan
      .map((group) => formatStoryboardRangesSpeech(group.ranges.map(ensureStructuredStoryboardRange)))
      .filter(Boolean)
      .join('\n'))
    : input.storyboard
      ? normalizeSpeechScript(formatStoryboardRangesSpeech(parseStoryboardRanges(input.storyboard)))
      : '';
  const fullSpeech = normalizeSpeechScript(input.confirmedSpeech || fallbackStoryboardSpeech);
  const emptyPlan = input.segments.map((_, index) => ({
    segmentIndex: index + 1,
    playableSpeech: '',
    previousContext: '',
    nextContext: '',
    estimatedSpeechSeconds: 0,
    source: 'silent' as const,
  }));
  if (!fullSpeech) {
    return emptyPlan;
  }
  const weights = segmentSpeechWeightHints({
    segments: input.segments,
    segmentPlan: input.segmentPlan,
    storyboard: input.storyboard,
  });
  const totalWeight = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!totalWeight) {
    return emptyPlan;
  }
  const positiveIndexes = weights
    .map((weight, index) => ({ weight, index }))
    .filter((item) => item.weight > 0)
    .map((item) => item.index);
  const chunks = Array.from({ length: input.segments.length }, () => '');
  let cursor = 0;
  let remainingWeight = totalWeight;
  positiveIndexes.forEach((segmentIndex, position) => {
    const isLast = position === positiveIndexes.length - 1;
    const start = skipSpeechWhitespace(fullSpeech, cursor);
    if (start >= fullSpeech.length) {
      cursor = fullSpeech.length;
      return;
    }
    if (isLast) {
      chunks[segmentIndex] = fullSpeech.slice(start).trim();
      cursor = fullSpeech.length;
      return;
    }
    const remainingText = fullSpeech.slice(start);
    const targetChars = Math.max(
      1,
      Math.round((remainingText.length * weights[segmentIndex]) / Math.max(1, remainingWeight)),
    );
    const end = findSpeechBreakIndex(fullSpeech, start, targetChars);
    chunks[segmentIndex] = fullSpeech.slice(start, end).trim();
    cursor = end;
    remainingWeight -= weights[segmentIndex];
  });
  return chunks.map((playableSpeech, index): SegmentedSpeechSlice => ({
    segmentIndex: index + 1,
    playableSpeech,
    previousContext: index > 0 ? summarizeSpeechBoundary(chunks[index - 1] || '', 'tail') : '',
    nextContext: index < chunks.length - 1 ? summarizeSpeechBoundary(chunks[index + 1] || '', 'head') : '',
    estimatedSpeechSeconds: estimatedChineseSpeechSeconds(playableSpeech),
    source: playableSpeech
      ? (input.confirmedSpeech?.trim() ? 'confirmed_speech' : 'storyboard_fallback')
      : 'silent',
  }));
}

export async function buildStrictStoryboardSegmentGroups(input: {
  taskId: string;
  traceId: string;
  totalSeconds: number;
  maxSegmentSeconds: number;
  storyboard: string;
}) {
  const groups = buildStoryboardSegmentGroups(input.totalSeconds, input.maxSegmentSeconds, input.storyboard);
  logVideoGenerationFlow('info', 'strict storyboard segment plan selected', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentCount: groups.length,
    segmentPlan: groups.map((group) => ({
      segmentIndex: group.segmentIndex,
      seconds: group.seconds,
      range: `${group.start}-${group.end}`,
      source: group.source,
      shots: group.ranges.map((range) => range.shotLabel),
    })),
  });
  return groups;
}

export function segmentTimeRangeLabel(segments: number[], segmentIndex: number) {
  const start = segments.slice(0, Math.max(0, segmentIndex - 1)).reduce((sum, value) => sum + value, 0);
  const end = start + (segments[segmentIndex - 1] || 0);
  return `${start}-${end} 秒`;
}

function segmentTimeWindow(segments: number[], segmentIndex: number) {
  const start = segments.slice(0, Math.max(0, segmentIndex - 1)).reduce((sum, value) => sum + value, 0);
  const end = start + (segments[segmentIndex - 1] || 0);
  return { start, end };
}

function storyboardRangesForWindow(storyboard: string, segments: number[], segmentIndex: number) {
  const { start, end } = segmentTimeWindow(segments, segmentIndex);
  const ranges = parseStoryboardRanges(storyboard);
  const overlaps = ranges.filter((range) => range.end > start && range.start < end);
  const previous = ranges.filter((range) => range.end <= start).at(-1);
  const next = ranges.find((range) => range.start >= end);
  return {
    current: overlaps,
    previous: previous ? [previous] : [],
    next: next ? [next] : [],
  };
}

function formatStoryboardRangeSummary(range: StoryboardRange) {
  return `${range.shotLabel}（${range.start}-${range.end} 秒）`;
}

function clampPromptText(text: string, maxChars: number) {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxChars);
  const lastBreak = sliced.lastIndexOf('\n');
  const safeSlice = lastBreak > Math.floor(maxChars * 0.6) ? sliced.slice(0, lastBreak) : sliced;
  return `${safeSlice.trim()}\n（其余细节按同一镜头节奏自然延续，不新增画面文字。）`;
}

function formatStoryboardRangesVisual(ranges: StoryboardRange[]) {
  return ranges.map((range) => range.visualText).filter(Boolean).join('\n');
}

function formatStoryboardRangesSpeech(ranges: StoryboardRange[]) {
  return ranges.map((range) => range.speechText).filter(Boolean).join('\n');
}

function storyboardHasSpeech(storyboard: string | undefined) {
  return Boolean(storyboard && formatStoryboardRangesSpeech(parseStoryboardRanges(storyboard)).trim());
}

function storyboardSegmentPlanHasSpeech(segmentPlan: StoryboardSegmentGroup[] | undefined) {
  return Boolean(segmentPlan?.some((group) => formatStoryboardRangesSpeech(group.ranges.map(ensureStructuredStoryboardRange)).trim()));
}

function buildSegmentAudioContract(input: {
  fixedSpeech: string;
  seconds: number;
  hasConfirmedSpeech: boolean;
  previousSpeechContext?: string;
  nextSpeechContext?: string;
}) {
  if (input.fixedSpeech) {
    const speechSeconds = estimatedChineseSpeechSeconds(input.fixedSpeech);
    return [
      '本段固定人声（必须逐字朗读，不能增删、改写、重复或提前朗读相邻段内容）：',
      input.fixedSpeech,
      `估算自然语速约 ${speechSeconds} 秒；本段约 ${input.seconds} 秒。保持自然语速，不加速，不续写。`,
      input.previousSpeechContext ? `上一段尾部上下文（仅用于衔接，不可朗读）：${input.previousSpeechContext}` : '',
      input.nextSpeechContext ? `下一段开头上下文（仅用于衔接，不可朗读）：${input.nextSpeechContext}` : '',
    ].filter(Boolean).join('\n');
  }
  if (input.hasConfirmedSpeech) {
    return [
      '本段固定人声：无。本段只保留环境音、动作音或转场音，不要把相邻段台词挪到本段朗读。',
      input.previousSpeechContext ? `上一段尾部上下文（仅用于衔接，不可朗读）：${input.previousSpeechContext}` : '',
      input.nextSpeechContext ? `下一段开头上下文（仅用于衔接，不可朗读）：${input.nextSpeechContext}` : '',
    ].join('\n');
  }
  return '本段无固定人声，仅保留环境音、动作音或转场音，不临时补人声。';
}

function seedanceSegmentBasePrompt(prompt: string) {
  const text = prompt.trim();
  if (!text) {
    return '';
  }
  const firstSegmentIndex = text.search(/(?:^|\n)分段\s*\d+\s*\n/u);
  return (firstSegmentIndex >= 0 ? text.slice(0, firstSegmentIndex) : text).trim();
}

function formatStoryboardRangesSummary(ranges: StoryboardRange[]) {
  return ranges.map(formatStoryboardRangeSummary).join('、');
}

function noOnScreenTextNegativePrompts() {
  return [
    '字幕',
    '口播字幕',
    '自动字幕',
    '对白字幕',
    '台词字幕',
    '旁白字幕',
    '人物字幕',
    '歌词字幕',
    '中文字幕',
    '英文字幕',
    '硬字幕',
    '内嵌字幕',
    '字幕条',
    '底部字幕',
    '居中字幕',
    '白色描边字幕',
    '黑底字幕',
    'caption',
    'captions',
    'subtitle',
    'subtitles',
    'closed captions',
    'burned-in captions',
    'hardcoded subtitles',
    'transcript overlay',
    'speech-to-text overlay',
    '屏幕文字',
    '屏幕大字',
    '标题条',
    '贴纸文字',
    '角标说明',
    'UI 文案',
    '文字浮层',
    '台词文字浮层',
    '逐字稿',
    '对白文字',
    '旁白文字',
    '可读文字',
    '文字卡片',
    '文字标签',
    '弹幕',
    '水印',
    'AI生成',
    'AI 生成',
    'AI generated',
    'AI-generated',
    'AIGC',
    'AI 角标',
    'AI 下标',
    '生成标记',
    '生成水印',
    '右下角水印',
    '右下角角标',
    '右下角下标',
    'AI生成角标',
    'AI生成下标',
    '无关 Logo',
    '新增 Logo',
    '拜拜',
    '再见',
    '下期见',
    '关注我',
    '点赞关注',
  ];
}

export function noOnScreenTextNegativePromptsForExport() {
  return noOnScreenTextNegativePrompts();
}

function formatNegativePrompt(negativePrompts: string[]) {
  return Array.from(new Set(
    negativePrompts
      .map((item) => item.trim())
      .filter(Boolean),
  )).join(', ');
}

function isCopyrightRestrictionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /copyright|版权|restriction|rights?|infring/i.test(message);
}

function applySeedanceCopyrightSafePrompt(prompt: string, retry = false) {
  const replacements: Array<[RegExp, string]> = [
    [/请生成一支可复刻爆款结构的短视频[，,。；;\s]*/g, ''],
    [/标题为[「《].*?[」》][，,。；;\s]*/g, ''],
    [/画幅比例[：:].*?(?:。|\n|$)/g, ''],
    [/目标清晰度[：:].*?(?:。|\n|$)/g, ''],
    [/复刻爆款/g, '短视频结构'],
    [/爆款复刻/g, '短视频结构'],
    [/复刻/g, '结构参考'],
    [/同款/g, '同类'],
    [/原视频/g, '参考内容'],
    [/原片/g, '参考内容'],
    [/模仿/g, '参考节奏'],
    [/照着/g, '参考节奏'],
    [/参考图片\s*\d*/g, '人物素材'],
    [/参考素材/g, '素材'],
    [/抖音/g, '短视频'],
  ];
  let sanitized = prompt;
  replacements.forEach(([pattern, replacement]) => {
    sanitized = sanitized.replace(pattern, replacement);
  });
  const guard = retry
    ? [
      '# 原创表达重试',
      '人物素材只用于保持人物外观一致；画面按当前分镜重新组织自然镜头。',
      '保留人物动作节奏、表情和口播语义，使用自然拍摄角度和连贯场景表达。',
      '不要添加来源标记、平台元素、Logo、屏幕文字、水印、AI生成标记、AI generated 字样、右下角角标或下标。',
    ].join('\n')
    : [
      '# 原创性约束',
      '人物素材只用于保持人物外观一致；场景、镜头和动作按当前分镜自然表达。',
      '画面保持真实拍摄感，不添加来源标记、平台元素、Logo、屏幕文字、水印、AI生成标记、AI generated 字样、右下角角标或下标。',
    ].join('\n');
  return `${sanitized.trim()}\n\n${guard}`;
}

function seedanceCopyrightSafeNegativePrompts(retry = false) {
  return [
    '平台水印',
    'AI生成',
    'AI 生成',
    'AI generated',
    'AI-generated',
    'AIGC',
    'AI生成角标',
    'AI生成下标',
    'AI 角标',
    'AI 下标',
    '生成标记',
    '生成水印',
    '右下角水印',
    '右下角角标',
    '右下角下标',
    '商标 Logo',
    '明星名人形象',
    retry ? '屏幕文字' : '',
    retry ? '可读文字' : '',
  ].filter(Boolean);
}

export function seedanceSegmentSpeechReferenceGuard() {
  return [
    '口播优先级：本段只允许朗读“音频白名单”或“本段口播”列出的文本；开头必须直接、清晰朗读本段第一句，不得含糊带过。',
    '参考图片/参考视频/参考音频只用于对应素材特征；参考视频的音轨、口型、原始台词、语气停顿和发声节奏不得作为本段口播来源。',
    '禁止复读上一段结尾、参考视频台词或参考素材里的任何原声内容；不得把参考视频里的含糊发音、尾音、杂音带入本段。',
  ].join('\n');
}

export function buildSegmentedSeedancePrompt(input: {
  basePrompt: string;
  totalSeconds: number;
  segments: number[];
  segmentIndex: number;
  maxSegmentSeconds?: number;
  segmentPlan?: StoryboardSegmentGroup[];
  storyboard?: string;
  confirmedSpeech?: string;
  speechPlan?: SegmentedSpeechSlice[];
}) {
  const storyboardGroups = input.segmentPlan?.length ? input.segmentPlan : [];
  const storyboardGroup = storyboardGroups[input.segmentIndex - 1];
  const fallbackWindow = segmentTimeWindow(input.segments, input.segmentIndex);
  const seconds = storyboardGroup?.seconds || input.segments[input.segmentIndex - 1] || 0;
  const start = storyboardGroup?.start ?? fallbackWindow.start;
  const end = storyboardGroup?.end ?? fallbackWindow.end;
  const timeRange = storyboardGroup ? `${start}-${end} 秒` : segmentTimeRangeLabel(input.segments, input.segmentIndex);
  const storyboardRanges = storyboardGroup
    ? {
      current: storyboardGroup.ranges.map(ensureStructuredStoryboardRange),
      previous: (storyboardGroups[input.segmentIndex - 2]?.ranges || []).map(ensureStructuredStoryboardRange),
      next: (storyboardGroups[input.segmentIndex]?.ranges || []).map(ensureStructuredStoryboardRange),
    }
    : input.storyboard
      ? storyboardRangesForWindow(input.storyboard, input.segments, input.segmentIndex)
      : { current: [], previous: [], next: [] };
  const speechPlan = input.speechPlan?.length === input.segments.length
    ? input.speechPlan
    : buildSegmentedSpeechPlan({
      confirmedSpeech: input.confirmedSpeech,
      segments: input.segments,
      segmentPlan: storyboardGroups,
      storyboard: input.storyboard,
    });
  const currentSpeechPlan = speechPlan[input.segmentIndex - 1];
  const fixedSpeech = currentSpeechPlan?.playableSpeech
    || (input.confirmedSpeech?.trim() ? '' : formatStoryboardRangesSpeech(storyboardRanges.current));
  const hasConfirmedSpeech = speechPlan.some((item) => item.playableSpeech)
    || Boolean(input.confirmedSpeech?.trim())
    || storyboardSegmentPlanHasSpeech(storyboardGroups)
    || storyboardHasSpeech(input.storyboard);
  const currentStoryboard = clampPromptText(formatStoryboardRangesVisual(storyboardRanges.current), 900);
  const previousBoundarySummary = formatStoryboardRangesSummary(storyboardRanges.previous);
  const nextBoundarySummary = formatStoryboardRangesSummary(storyboardRanges.next);
  const audioContract = buildSegmentAudioContract({
    fixedSpeech,
    seconds,
    hasConfirmedSpeech,
    previousSpeechContext: currentSpeechPlan?.previousContext || '',
    nextSpeechContext: currentSpeechPlan?.nextContext || '',
  });
  const storyboardGroupSummary = storyboardGroup?.ranges.length
    ? storyboardGroup.ranges.map(formatStoryboardRangeSummary).join('、')
    : '';
  const currentStoryboardSection = storyboardRanges.current.length ? [
    '# 本段生成合同',
    `画面任务：第 ${input.segmentIndex}/${input.segments.length} 段，${start}-${end} 秒，只生成${storyboardGroupSummary || '本时间窗'}。`,
    '字幕规则：本段只生成纯画面和音轨，画面内不要出现字幕、口播文字、逐字稿、标题条、文字浮层或任何可读文字。',
    currentStoryboard || '本段按已确认场景与人物生成自然动作，画面无新增可读文字。',
    '',
    '音频白名单：',
    audioContract,
    seedanceSegmentSpeechReferenceGuard(),
    '',
    '边界：',
    previousBoundarySummary ? `上一段已完成，不回放：${previousBoundarySummary}` : '无上一段。',
    nextBoundarySummary ? `下一段稍后生成，不提前：${nextBoundarySummary}` : '无下一段。',
    '',
    '画面要求：保持真实拍摄感，画面内无新增可读文字、标识、来源标记或界面元素；禁止朗读白名单外内容或新增结尾口号。',
  ].join('\n') : [
    '# 本段生成合同',
    `画面任务：第 ${input.segmentIndex}/${input.segments.length} 段，${start}-${end} 秒，只按本时间窗生成。`,
    '字幕规则：本段只生成纯画面和音轨，画面内不要出现字幕、口播文字、逐字稿、标题条、文字浮层或任何可读文字。',
    '音频白名单：',
    audioContract,
    seedanceSegmentSpeechReferenceGuard(),
    '画面要求：保持真实拍摄感，画面内无新增可读文字、标识、来源标记或界面元素；禁止复述完整脚本。',
  ].join('\n');
  return renderPromptTemplate(viralSeedanceSegmentPromptTemplate, {
    GLOBAL_PROMPT: seedanceSegmentBasePrompt(input.basePrompt),
    CURRENT_STORYBOARD_SECTION: currentStoryboardSection,
    SEGMENT_SUMMARY: storyboardGroupSummary
      ? `这是第 ${input.segmentIndex}/${input.segments.length} 个分镜分段。本段只生成 ${storyboardGroupSummary}，时长约 ${seconds} 秒。`
      : `这是第 ${input.segmentIndex}/${input.segments.length} 个视频分段，本段生成时长约 ${seconds} 秒。`,
    SEGMENT_BASIS: storyboardGroupSummary
      ? '分段依据：严格只按分镜脚本镜头边界切分；短镜头可以按顺序合并成同一段，但不得拆普通镜头、不得跳镜头、不得按固定时间尺重新切片。'
      : `分段依据：没有可用的确认分镜时才按时长兜底分段；本段对应 ${timeRange}。`,
    SEGMENT_START: start,
    SEGMENT_END: end,
    SEGMENT_OPENING_RULE: input.segmentIndex === 1
      ? '第 1 段负责自然开场，但不要在结尾做全片收束。'
      : '本段开头必须直接承接上一段之后的新动作/新镜头，不要出现重新举杯、重新展示、重新进入场景、重新开场等回放式画面。',
    SEGMENT_ENDING_RULE: input.segmentIndex === input.segments.length
      ? '最后一段只允许按音频白名单自然结束；如果白名单里没有拜拜、再见、关注、下期见等结束语，严禁自行补结束语。'
      : '本段结尾保持动作向下一段自然延续，不要定格成最终尾帧，不要重复下一段将要发生的动作。',
  });
}

export function seedanceBooleanSetting(settings: Record<string, unknown> | undefined, key: string, fallback: boolean) {
  if (!settings || settings[key] === undefined) {
    return fallback;
  }
  return settings[key] === true || String(settings[key]).toLowerCase() === 'true';
}

export function publicMaterialUrl(value: unknown) {
  return absolutizeMaterialUrl(value);
}

export function seedanceAssetUri(value: unknown) {
  const raw = String(value || '').trim();
  return /^asset:\/\/\S+/i.test(raw) ? raw : '';
}

export function seedanceAssetUriFromMetadata(metadata: unknown) {
  if (!isRecord(metadata)) {
    return '';
  }
  const directUri = seedanceAssetUri(metadata.assetUri);
  if (directUri) {
    return directUri;
  }
  const volcAssetId = String(metadata.volcAssetId || '').trim();
  return volcAssetId ? `asset://${volcAssetId}` : '';
}

export function summarizeVideoContentItems(content: unknown) {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.map((item) => {
    if (!isRecord(item)) {
      return { type: typeof item };
    }
    const imageUrl = isRecord(item.image_url) ? stringValue(item.image_url.url) : '';
    const videoUrl = isRecord(item.video_url) ? stringValue(item.video_url.url) : '';
    const audioUrl = isRecord(item.audio_url) ? stringValue(item.audio_url.url) : '';
    const text = stringValue(item.text);
    return {
      type: item.type,
      role: item.role,
      textChars: text.length || undefined,
      url: summarizeReferenceUrl(imageUrl || videoUrl || audioUrl),
    };
  });
}

function summarizeReferenceUrl(url: string) {
  if (!url) {
    return undefined;
  }
  if (/^data:/i.test(url)) {
    const mediaType = url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : Math.min(url.length, 40));
    return `data:${mediaType};base64,<${url.length} chars>`;
  }
  return url.length > 180 ? `${url.slice(0, 180)}...<${url.length} chars>` : url;
}

function summarizeReferenceUrls(urls: string[]) {
  return urls.map((url) => summarizeReferenceUrl(url)).filter(Boolean);
}

export function extractGeneratedVideoUrlFromRecord(record: Record<string, unknown>) {
  const first = Array.isArray(record.data) && isRecord(record.data[0]) ? record.data[0] : undefined;
  const content = isRecord(record.content) ? record.content : undefined;
  const output = isRecord(record.output) ? record.output : undefined;
  const result = isRecord(record.result) ? record.result : undefined;
  const resultContent = isRecord(result?.content) ? result.content : undefined;
  const nestedTask = isRecord(record.task) ? record.task : undefined;
  const nestedTaskContent = isRecord(nestedTask?.content) ? nestedTask.content : undefined;
  return String(
    first?.url
    || first?.video_url
    || record.url
    || record.video_url
    || content?.video_url
    || content?.url
    || output?.video_url
    || output?.url
    || result?.video_url
    || result?.url
    || resultContent?.video_url
    || resultContent?.url
    || nestedTask?.video_url
    || nestedTaskContent?.video_url
    || '',
  ).trim();
}

export function extractGeneratedCoverUrlFromRecord(record: Record<string, unknown>) {
  const first = Array.isArray(record.data) && isRecord(record.data[0]) ? record.data[0] : undefined;
  const content = isRecord(record.content) ? record.content : undefined;
  const output = isRecord(record.output) ? record.output : undefined;
  const result = isRecord(record.result) ? record.result : undefined;
  const resultContent = isRecord(result?.content) ? result.content : undefined;
  return String(
    first?.cover_url
    || first?.preview_image_url
    || record.cover_url
    || record.preview_image_url
    || record.last_frame_url
    || content?.last_frame_url
    || output?.last_frame_url
    || result?.last_frame_url
    || resultContent?.last_frame_url
    || '',
  ).trim();
}

export async function fileAssetToDataUrl(asset: Record<string, unknown>, fallbackMimePrefix: 'image' | 'audio') {
  const filePath = String(asset.filePath || '').trim();
  if (!filePath || !existsSync(filePath)) {
    return '';
  }
  const mimeType = String(asset.mimeType || '').trim().toLowerCase();
  const normalizedMimeType = mimeType.startsWith(`${fallbackMimePrefix}/`)
    ? mimeType
    : `${fallbackMimePrefix}/${fallbackMimePrefix === 'image' ? 'png' : 'wav'}`;
  const bytes = await readFile(filePath);
  return `data:${normalizedMimeType};base64,${bytes.toString('base64')}`;
}

export function selectedReferenceSummary(context: Record<string, unknown>) {
  const materialContext = isRecord(context.materialContext) ? context.materialContext : undefined;
  const references = isRecord(materialContext?.references) ? materialContext.references : undefined;
  return {
    images: Array.isArray(references?.images) ? references.images.length : 0,
    videos: Array.isArray(references?.videos) ? references.videos.length : 0,
    audios: Array.isArray(references?.audios) ? references.audios.length : 0,
  };
}

function selectedImageReferenceAssets(context: Record<string, unknown>) {
  const materialContext = isRecord(context.materialContext) ? context.materialContext : undefined;
  const references = isRecord(materialContext?.references) ? materialContext.references : undefined;
  const groups = [
    references?.images,
    isRecord(references?.imageGroup) ? references.imageGroup.assets : undefined,
  ];
  return groups
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .filter(isRecord);
}

function isPublicHttpUrl(value: string) {
  if (!/^https?:\/\/\S+/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.trim().toLowerCase();
    if (!hostname) {
      return false;
    }
    if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '127.0.0.1' || hostname === '::1') {
      return false;
    }
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) {
      return false;
    }
    const private172 = hostname.match(/^172\.(\d{1,3})\./);
    if (private172) {
      const second = Number(private172[1]);
      if (second >= 16 && second <= 31) {
        return false;
      }
    }
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const normalized = hostname.slice(1, -1);
      if (normalized === '::1' || normalized.toLowerCase().startsWith('fe80:') || normalized.toLowerCase().startsWith('fc') || normalized.toLowerCase().startsWith('fd')) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function assertSelectedReferencesResolved(input: {
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  context: Record<string, unknown>;
}) {
  const allowSeedanceAudioReference = input.context.allowSeedanceAudioReference === true;
  const selected = selectedReferenceSummary(input.context);
  const unresolved: string[] = [];
  if (selected.images > 0 && input.imageUrls.length === 0) {
    unresolved.push(`图片 ${selected.images} 个`);
  }
  if (allowSeedanceAudioReference && selected.audios > 0 && input.audioUrls.length === 0) {
    unresolved.push(`音频 ${selected.audios} 个`);
  }
  if (unresolved.length) {
    const videoHint = selected.videos > 0
      ? (contentPublicBaseUrl
        ? `参考视频仍需要可访问绝对地址，当前 CONTENT_PUBLIC_BASE_URL=${contentPublicBaseUrl}`
        : '参考视频仍需要可访问绝对地址，当前未配置 CONTENT_PUBLIC_BASE_URL')
      : '请检查素材文件是否存在且可读取';
    throw new Error(`已选择的参考素材未能转换成模型可用输入：${unresolved.join('、')}。${videoHint}`);
  }
}

export async function resolveSeedanceImageReferenceUrl(asset: Record<string, unknown>) {
  const resourceType = String(asset.resourceType || '').trim();
  const assetUri = seedanceAssetUriFromMetadata(asset.metadata);
  if (resourceType === 'virtual_portrait' && assetUri) {
    return assetUri;
  }
  const localDataUrl = await fileAssetToDataUrl(asset, 'image');
  const source = asset.metadata && isRecord(asset.metadata) ? String(asset.metadata.source || '').trim() : '';
  if (localDataUrl && source === 'local_upload') {
    return localDataUrl;
  }
  const publicUrlCandidates = [
    publicMaterialUrl(asset.fileUrl),
    publicMaterialUrl(asset.url),
    publicMaterialUrl(asset.metadata && isRecord(asset.metadata) ? asset.metadata.url : undefined),
    publicMaterialUrl(asset.metadata && isRecord(asset.metadata) ? asset.metadata.sourceUrl : undefined),
  ].filter((candidate) => isPublicHttpUrl(candidate));
  if (publicUrlCandidates[0]) {
    return publicUrlCandidates[0];
  }
  if (localDataUrl) {
    return localDataUrl;
  }
  return assetUri;
}

export async function collectSeedanceImageUrls(context: Record<string, unknown>) {
  const assets = selectedImageReferenceAssets(context);
  const urls = await Promise.all(assets.map((asset) => resolveSeedanceImageReferenceUrl(asset)));
  return Array.from(new Set(urls.filter(Boolean)));
}

export function collectSeedanceVideoUrls(context: Record<string, unknown>) {
  const materialContext = isRecord(context.materialContext) ? context.materialContext : undefined;
  const references = isRecord(materialContext?.references) ? materialContext.references : undefined;
  const traceId = isRecord(context.videoGenerationFlow) ? String(context.videoGenerationFlow.traceId || '') : '';
  const urls = (Array.isArray(references?.videos) ? references.videos : [])
    .filter(isRecord)
    .map((asset) => {
      const candidates = [
        publicMaterialUrl(asset.fileUrl),
        publicMaterialUrl(asset.url),
        publicMaterialUrl(asset.metadata && isRecord(asset.metadata) ? asset.metadata.url : undefined),
        publicMaterialUrl(asset.metadata && isRecord(asset.metadata) ? asset.metadata.sourceUrl : undefined),
      ].filter(Boolean);
      const resolved = candidates.find((candidate) => isPublicHttpUrl(candidate));
      if (!resolved) {
        logVideoGenerationFlow('warn', 'seedance video reference skipped because resolved url is not public', {
          traceId,
          assetId: String(asset.id || ''),
          fileUrl: String(asset.fileUrl || ''),
          url: String(asset.url || ''),
          metadataUrl: asset.metadata && isRecord(asset.metadata) ? String(asset.metadata.url || '') : '',
          metadataSourceUrl: asset.metadata && isRecord(asset.metadata) ? String(asset.metadata.sourceUrl || '') : '',
          contentPublicBaseUrl,
        });
      }
      return resolved || '';
    })
    .filter(Boolean);
  return Array.from(new Set(urls));
}

export async function collectSeedanceAudioUrls(context: Record<string, unknown>, audioUrl?: string) {
  const allowSeedanceAudioReference = context.allowSeedanceAudioReference === true;
  if (!allowSeedanceAudioReference) {
    return [];
  }
  const materialContext = isRecord(context.materialContext) ? context.materialContext : undefined;
  const references = isRecord(materialContext?.references) ? materialContext.references : undefined;
  const referenceAudios = await Promise.all((Array.isArray(references?.audios) ? references.audios : [])
    .filter(isRecord)
    .map(async (asset) => (
      await fileAssetToDataUrl(asset, 'audio')
      || publicMaterialUrl(asset.fileUrl)
      || publicMaterialUrl(asset.url)
      || publicMaterialUrl(asset.metadata && isRecord(asset.metadata) ? asset.metadata.url : undefined)
      || publicMaterialUrl(asset.metadata && isRecord(asset.metadata) ? asset.metadata.sourceUrl : undefined)
    )));
  const fallbackAudioUrl = referenceAudios.some(Boolean) ? '' : publicMaterialUrl(audioUrl);
  const urls = [
    ...referenceAudios,
    fallbackAudioUrl,
  ].filter(Boolean);
  return Array.from(new Set(urls));
}

export function buildSeedanceContentItems(input: {
  promptText: string;
  modelOption: VideoModelOption;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
}) {
  const policy = input.modelOption.referencePolicy;
  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: input.promptText,
    },
  ];

  if (policy.imageMode === 'reference_images') {
    input.imageUrls.slice(0, policy.maxImages).forEach((url) => {
      content.push({
        type: 'image_url',
        image_url: { url },
        role: 'reference_image',
      });
    });
  } else if (policy.imageMode === 'first_frame_required' || policy.imageMode === 'first_last_optional') {
    const [firstFrame, lastFrame] = input.imageUrls;
    if (firstFrame) {
      content.push({
        type: 'image_url',
        image_url: { url: firstFrame },
        role: 'first_frame',
      });
    }
    if (lastFrame && policy.imageMode === 'first_last_optional') {
      content.push({
        type: 'image_url',
        image_url: { url: lastFrame },
        role: 'last_frame',
      });
    }
  }

  if (policy.allowVideo) {
    input.videoUrls.slice(0, policy.maxVideos).forEach((url) => {
      content.push({
        type: 'video_url',
        video_url: { url },
        role: 'reference_video',
      });
    });
  }

  const hasVisualReference = content.some((item) => item.type === 'image_url' || item.type === 'video_url');
  if (policy.allowAudio && hasVisualReference) {
    input.audioUrls.slice(0, policy.maxAudios).forEach((url) => {
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference_audio',
      });
    });
  } else if (policy.allowAudio && input.audioUrls.length > 0) {
    logger.warn('skip seedance reference audio because visual reference is missing', {
      audioCount: input.audioUrls.length,
      modelId: input.modelOption.id,
    });
  }

  return content;
}

export function buildVideoGenerationRequestBody(input: {
  config: ReturnType<typeof resolveDefaultVideoModel>;
  provider: VideoModelProvider;
  modelOption: VideoModelOption;
  taskId: string;
  title: string;
  prompt: string;
  negativePrompts: string[];
  ratio: string;
  resolution?: string;
  duration: string;
  audioUrl?: string;
  context: Record<string, unknown>;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  seedanceOptions?: {
    generateAudio?: boolean;
    watermark?: boolean;
  };
}) {
  if (input.provider.id === 'volcengine-seedance' || isArkSeedanceConfig(input.config)) {
    const durationSeconds = seedanceDurationSeconds(input.duration, input.modelOption, input.config.settings);
    const cameraFixed = seedanceBooleanSetting(input.config.settings, 'cameraFixed', false);
    const watermark = input.seedanceOptions?.watermark ?? false;
    const generateAudio = input.seedanceOptions?.generateAudio
      ?? seedanceBooleanSetting(
        input.config.settings,
        'generateAudio',
        input.modelOption.referencePolicy.allowAudio,
      );
    const content = buildSeedanceContentItems({
      promptText: input.prompt,
      modelOption: input.modelOption,
      imageUrls: input.imageUrls || [],
      videoUrls: input.videoUrls || [],
      audioUrls: input.audioUrls || [],
    });
    return {
      model: input.modelOption.id,
      content,
      negative_prompt: formatNegativePrompt(input.negativePrompts) || undefined,
      ratio: input.ratio,
      resolution: input.resolution || undefined,
      duration: durationSeconds,
      generate_audio: generateAudio,
      camera_fixed: cameraFixed,
      watermark,
    };
  }

  const requestBody: Record<string, unknown> = {
    model: input.config.model,
    prompt: input.prompt,
    negative_prompt: formatNegativePrompt(input.negativePrompts),
    size: input.ratio,
    duration: input.duration,
    metadata: {
      taskId: input.taskId,
      title: input.title,
      audioUrl: input.audioUrl,
      context: input.context,
    },
  };
  if (input.audioUrl && input.config.settings?.supportsAudioInput === true) {
    requestBody.audio_url = input.audioUrl;
    requestBody.reference_audio_url = input.audioUrl;
  }
  return requestBody;
}

export async function parseVideoGenerationResponse(response: Response, config: { provider: string; model: string }, context: { taskId: string; requestUrl: string }) {
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    logger.error('video model returned invalid json', {
      taskId: context.taskId,
      requestUrl: context.requestUrl,
      provider: config.provider,
      model: config.model,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      bodyPreview: text.slice(0, 2000),
      error: errorLogContext(error),
    });
    throw new Error('视频模型返回了无法解析的响应');
  }
  if (!response.ok) {
    const message = (data as { error?: { message?: string }; message?: string })?.error?.message
      || (data as { message?: string })?.message
      || `视频模型请求失败：${response.status}`;
    logger.error('video model request failed', {
      taskId: context.taskId,
      requestUrl: context.requestUrl,
      provider: config.provider,
      model: config.model,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      response: data,
      bodyPreview: text.slice(0, 2000),
      message,
    });
    throw new Error(message);
  }
  const record = isRecord(data) ? data : {};
  const nestedTask = isRecord(record.task) ? record.task : undefined;
  const first = Array.isArray(record.data) && isRecord(record.data[0]) ? record.data[0] : undefined;
  const videoUrl = extractGeneratedVideoUrlFromRecord(record);
  const jobId = String(first?.id || record.id || record.task_id || record.jobId || nestedTask?.id || '').trim();
  const rawStatus = String(record.status || first?.status || nestedTask?.status || '').toLowerCase();
  const coverUrl = extractGeneratedCoverUrlFromRecord(record);
  const usage = parseVideoGenerationUsage(record);
  if (!videoUrl && !jobId) {
    throw new Error('视频模型未返回 videoUrl 或 jobId');
  }
  const isFailed = ['failed', 'error', 'cancelled', 'canceled'].includes(rawStatus);
  return {
    provider: config.provider,
    model: config.model,
    jobId: jobId || undefined,
    videoUrl: videoUrl || undefined,
    coverUrl: coverUrl || undefined,
    usage,
    status: isFailed ? 'failed' as const : videoUrl ? 'completed' as const : 'running' as const,
  };
}

function promptDumpFilePart(value: unknown, fallback: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

function summarizeVideoRequestBodyForLog(requestBody: unknown) {
  const record = isRecord(requestBody) ? requestBody : {};
  const negativePrompt = typeof record.negative_prompt === 'string' ? record.negative_prompt : '';
  return {
    model: typeof record.model === 'string' ? record.model : undefined,
    ratio: typeof record.ratio === 'string' ? record.ratio : undefined,
    resolution: typeof record.resolution === 'string' ? record.resolution : undefined,
    duration: record.duration,
    generateAudio: record.generate_audio,
    cameraFixed: record.camera_fixed,
    watermark: record.watermark,
    negativePromptChars: negativePrompt.length,
    contentSummary: summarizeVideoContentItems(record.content),
  };
}

async function writeVideoPromptDebugDump(input: {
  traceId: string;
  taskId: string;
  title: string;
  requestUrl: string;
  provider: string;
  model: string;
  requestMode: string;
  ratio: string;
  resolution?: string;
  duration: string;
  prompt: string;
  negativePrompts: string[];
  context: Record<string, unknown>;
  requestBody: unknown;
}) {
  const flowContext = isRecord(input.context.videoGenerationFlow)
    ? input.context.videoGenerationFlow as Record<string, unknown>
    : {};
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(logsDir, 'video-prompts', date);
  await mkdir(dir, { recursive: true });
  const segmentPart = flowContext.segmentIndex === undefined
    ? 'full'
    : `segment-${promptDumpFilePart(flowContext.segmentIndex, 'unknown')}`;
  const filePath = path.join(
    dir,
    `${promptDumpFilePart(input.taskId, 'task')}-${segmentPart}-${promptDumpFilePart(input.traceId, 'trace')}.json`,
  );
  await writeFile(filePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    traceId: input.traceId,
    taskId: input.taskId,
    title: input.title,
    requestUrl: input.requestUrl,
    provider: input.provider,
    model: input.model,
    requestMode: input.requestMode,
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    videoGenerationFlow: flowContext,
    prompt: input.prompt,
    negativePrompts: input.negativePrompts,
    requestBody: input.requestBody,
  }, null, 2), 'utf8');
  return filePath;
}

export function userFacingVideoGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/content\[\d+\]\.audio_url/i.test(message) && /not valid/i.test(message)) {
    return 'seedance 不支持仅上传音频素材';
  }
  if (/input image may contain real person/i.test(message)) {
    return [
      '视频生成平台拒绝了本次输入图片，原因是图片可能包含真人或可识别人物。',
      '这不代表平台一定不能使用真人素材，但当前这张参考图未通过平台审核。',
      '请尝试更换已授权且符合平台要求的参考图，或先移除人物参考图，仅用文字描述人物形象后重试。',
      `平台原始错误：${message}`,
    ].join('\n');
  }
  if (isCopyrightRestrictionError(message)) {
    return [
      '视频生成平台拒绝了本次生成，原因是输出画面可能与既有内容过于相似。',
      '系统已尝试使用更中性的原创表达重新生成失败分段；如果仍失败，请减少参考素材相似度、弱化“结构参考”要求，或更换参考图片后重试。',
      `平台原始错误：${message}`,
    ].join('\n');
  }
  return message || '视频生成失败';
}

export function persistPendingVideoGenerationResult(input: {
  taskId: string;
  providerResult: Awaited<ReturnType<typeof callConfiguredVideoModel>>;
  duration: string;
  ratio: string;
  sourceType?: string;
  audioSource?: VideoGenerationResult['audioSource'];
  usedReplicationPlan?: ViralReplicationPlan;
  mode?: string;
  director?: {
    status?: ViralDirectorStatus;
  };
}) {
  const task = contentRepository.findVideoTask(input.taskId);
  if (!task || input.providerResult.status === 'completed') {
    return task;
  }
  const status: VideoGenerationResult['status'] = input.providerResult.status === 'failed'
    ? 'failed'
    : 'running';
  const result: VideoGenerationResult = {
    version: 1,
    taskId: input.taskId,
    status,
    sourceType: input.sourceType,
    provider: input.providerResult.provider,
    model: input.providerResult.model,
    jobId: input.providerResult.jobId,
    videoUrl: input.providerResult.videoUrl || null,
    coverUrl: input.providerResult.coverUrl,
    duration: input.duration,
    ratio: input.ratio,
    usedReplicationPlan: input.usedReplicationPlan,
    renderMode: 'provider_generation',
    renderStatus: status === 'failed' ? 'failed' : 'rendering',
    audioSource: input.audioSource,
    generatedAt: new Date().toISOString(),
  };
  const taskWithResult = updateVideoTaskParseResult(input.taskId, {
    editableParseResult: {
      ...task.editableParseResult,
      videoGenerationResult: result,
    },
    selectedDigitalHumanId: task.selectedDigitalHumanId,
    selectedSceneId: task.selectedSceneId,
    selectedVoiceId: task.selectedVoiceId,
  });
  const nextExpertContext: Record<string, unknown> = {
    ...taskWithResult.expertContext,
    videoResult: result,
    videoGenerationResult: result,
    currentStep: 'video_generation_submitted',
    requiredUserAction: null,
    updatedAt: new Date().toISOString(),
  };
  if (input.director) {
    nextExpertContext.viralUnderstanding = {
      ...(isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {}),
      directorStatus: input.director.status || 'generating',
      directorStep: 'final',
      videoGenerationResult: result,
      updatedAt: new Date().toISOString(),
    };
  }
  return contentRepository.updateVideoTaskContext(input.taskId, {
    selectedSkillIds: taskWithResult.selectedSkillIds,
    expertContext: nextExpertContext,
  });
}

export type SegmentedVideoGenerationState = {
  status: 'running' | 'completed' | 'failed';
  failureStage?: 'segment_generation' | 'merge';
  failureReason?: string;
  request: {
    taskId: string;
    userId: string;
    title: string;
    prompt: string;
    negativePrompts: string[];
    ratio: string;
    resolution?: string;
    totalSeconds: number;
    maxSegmentSeconds: number;
    context: Record<string, unknown>;
    materialContext: Record<string, unknown>;
    providerId: string;
    modelId: string;
    seedanceOptions: {
      generateAudio?: boolean;
      watermark?: boolean;
      resolution?: string;
    };
    confirmedSpeech?: string;
    speechPlan?: SegmentedSpeechSlice[];
    generationMode?: string;
    traceId: string;
    pendingAssetId?: string;
  };
  segments: number[];
  segmentPlan?: StoryboardSegmentGroup[];
  currentSegmentIndex?: number;
  segmentResults: Array<Record<string, unknown>>;
  segmentPaths: string[];
  updatedAt: string;
};

export function isSegmentedVideoGenerationState(value: unknown): value is SegmentedVideoGenerationState {
  return isRecord(value)
    && (value.status === 'running' || value.status === 'failed' || value.status === 'completed')
    && isRecord(value.request)
    && Array.isArray(value.segments)
    && value.segments.length > 1
    && Array.isArray(value.segmentResults)
    && Array.isArray(value.segmentPaths);
}

function shouldKeepSegmentFiles(value: unknown) {
  return isRecord(value)
    && (value.status === 'running' || value.status === 'failed' || value.status === 'completed')
    && Array.isArray(value.segmentPaths)
    && value.segmentPaths.some((item) => typeof item === 'string' && item.trim().length > 0);
}

function fulfilledValues<T>(results: PromiseSettledResult<T>[]) {
  return results.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
}

function firstRejected(results: PromiseSettledResult<unknown>[]) {
  return results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
}

export function persistSegmentedVideoGenerationState(taskId: string, state: SegmentedVideoGenerationState) {
  const task = contentRepository.findVideoTask(taskId);
  if (!task) {
    return null;
  }
  return contentRepository.updateVideoTaskContext(taskId, {
    selectedSkillIds: task.selectedSkillIds || [],
    expertContext: {
      ...(task.expertContext || {}),
      videoGenerationSegments: {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    },
  });
}

export function videoGenerationTaskQueryUrl(baseUrl: string, jobId: string) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/contents\/generations\/tasks$/i.test(trimmed)) {
    return `${trimmed}/${encodeURIComponent(jobId)}`;
  }
  return `${trimmed}/contents/generations/tasks/${encodeURIComponent(jobId)}`;
}

function parseVideoGenerationTaskSnapshot(
  record: Record<string, unknown>,
  defaults?: { provider?: string; model?: string; jobId?: string },
): VideoGenerationTaskSnapshot {
  const error = isRecord(record.error) ? record.error : undefined;
  const rawStatus = String(record.status || '').toLowerCase();
  const videoUrl = extractGeneratedVideoUrlFromRecord(record);
  const coverUrl = extractGeneratedCoverUrlFromRecord(record);
  const errorMessage = String(error?.message || record.message || '').trim();
  const usage = parseVideoGenerationUsage(record);
  let status: 'pending' | 'running' | 'completed' | 'failed' = 'running';
  if (rawStatus === 'queued') {
    status = 'pending';
  } else if (rawStatus === 'running') {
    status = 'running';
  } else if (rawStatus === 'succeeded') {
    status = videoUrl ? 'completed' : 'failed';
  } else if (['failed', 'expired', 'cancelled', 'canceled', 'error'].includes(rawStatus)) {
    status = 'failed';
  }
  return {
    provider: defaults?.provider,
    model: typeof record.model === 'string' ? String(record.model) : defaults?.model,
    jobId: String(record.id || defaults?.jobId || '').trim() || undefined,
    videoUrl: videoUrl || undefined,
    coverUrl: coverUrl || undefined,
    usage,
    status,
    errorMessage: errorMessage || (rawStatus === 'succeeded' && !videoUrl ? '视频任务已完成，但查询响应中没有解析到 video_url' : undefined),
    rawStatus,
  };
}

export async function queryConfiguredVideoModelTask(input: {
  providerId?: string;
  modelId?: string;
  jobId: string;
}) {
  const config = resolveDefaultVideoModel(input.providerId);
  const provider = resolveConfiguredVideoProvider(config);
  const modelOption = resolveConfiguredVideoOption(provider, config, input.modelId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const requestUrl = videoGenerationTaskQueryUrl(config.baseUrl, input.jobId);
  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('视频任务查询返回了无法解析的响应');
    }
    if (!response.ok) {
      const message = (data as { error?: { message?: string }; message?: string })?.error?.message
        || (data as { message?: string })?.message
        || `视频任务查询失败：${response.status}`;
      throw new Error(message);
    }
    const record = isRecord(data) ? data : {};
    const parsed = parseVideoGenerationTaskSnapshot(record, {
      provider: config.provider,
      model: modelOption.id,
      jobId: input.jobId,
    });
    logVideoGenerationFlow('info', 'video task query response parsed', {
      taskId: input.jobId,
      provider: config.provider,
      model: modelOption.id,
      rawStatus: parsed.rawStatus,
      hasVideoUrl: Boolean(parsed.videoUrl),
      hasCoverUrl: Boolean(parsed.coverUrl),
      response: record,
    });
    return {
      provider: parsed.provider || config.provider,
      model: parsed.model || modelOption.id,
      jobId: parsed.jobId || input.jobId,
      videoUrl: parsed.videoUrl,
      coverUrl: parsed.coverUrl,
      usage: parsed.usage,
      status: parsed.status,
      errorMessage: parsed.errorMessage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function callConfiguredVideoModel(input: {
  taskId: string;
  title: string;
  prompt: string;
  negativePrompts: string[];
  ratio: string;
  resolution?: string;
  duration: string;
  audioUrl?: string;
  context: Record<string, unknown>;
  providerId?: string;
  modelId?: string;
  seedanceOptions?: {
    generateAudio?: boolean;
    watermark?: boolean;
    resolution?: string;
  };
}) {
  const config = resolveDefaultVideoModel(input.providerId);
  const provider = resolveConfiguredVideoProvider(config);
  const modelOption = resolveConfiguredVideoOption(provider, config, input.modelId);
  const task = contentRepository.findVideoTask(input.taskId);
  const useSeedanceCopyrightSafePrompt = input.providerId === 'volcengine-seedance' || isArkSeedanceConfig(config);
  const prompt = useSeedanceCopyrightSafePrompt
    ? applySeedanceCopyrightSafePrompt(input.prompt)
    : input.prompt;
  const negativePrompts = useSeedanceCopyrightSafePrompt
    ? [...input.negativePrompts, ...seedanceCopyrightSafeNegativePrompts()]
    : input.negativePrompts;
  const imageUrls = await collectSeedanceImageUrls(input.context);
  const videoUrls = collectSeedanceVideoUrls(input.context);
  const audioUrls = await collectSeedanceAudioUrls(input.context, input.audioUrl);
  const selectedReferences = selectedReferenceSummary(input.context);
  const audioReferenceDisabledReason = input.context.allowSeedanceAudioReference === true
    ? ''
    : selectedReferences.audios > 0 || input.audioUrl
      ? 'Seedance 音频参考默认禁用，避免模型直接复用声音素材原始内容；只按音频白名单生成口播。'
      : '';
  assertSelectedReferencesResolved({
    imageUrls,
    videoUrls,
    audioUrls,
    context: input.context,
  });
  const policy = modelOption.referencePolicy;
  if (policy.imageMode === 'first_frame_required' && imageUrls.length < 1) {
    throw new Error(`${modelOption.name} 至少需要 1 张参考图片`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);
  const requestUrl = videoGenerationUrl(config.baseUrl, config);
  const requestBody = buildVideoGenerationRequestBody({
    config,
    provider,
    modelOption,
    taskId: input.taskId,
    title: input.title,
    prompt,
    negativePrompts,
    ratio: input.ratio,
    resolution: input.resolution || input.seedanceOptions?.resolution,
    duration: input.duration,
    audioUrl: input.audioUrl,
    context: input.context,
    imageUrls,
    videoUrls,
    audioUrls,
    seedanceOptions: input.seedanceOptions,
  });
  const flowContext = isRecord(input.context.videoGenerationFlow)
    ? input.context.videoGenerationFlow as Record<string, unknown>
    : {};
  const flowTraceId = typeof flowContext.traceId === 'string' ? flowContext.traceId : createTraceId('video-generation');
  const requestMode = isArkSeedanceConfig(config) ? 'ark_seedance_async' : 'openai_compatible_video';
  let promptDumpPath: string | undefined;
  try {
    promptDumpPath = await writeVideoPromptDebugDump({
      traceId: flowTraceId,
      taskId: input.taskId,
      title: input.title,
      requestUrl,
      provider: config.provider,
      model: modelOption.id,
      requestMode,
      ratio: input.ratio,
      resolution: input.resolution || input.seedanceOptions?.resolution,
      duration: input.duration,
      prompt,
      negativePrompts,
      context: input.context,
      requestBody,
    });
  } catch (error) {
    logger.warn('video prompt debug dump failed', {
      traceId: flowTraceId,
      taskId: input.taskId,
      error: errorLogContext(error),
    });
  }
  logVideoGenerationFlow('info', 'video model request prepared', {
    traceId: flowTraceId,
    taskId: input.taskId,
    requestUrl,
    provider: config.provider,
    model: modelOption.id,
    requestMode,
    promptChars: prompt.length,
    negativePromptCount: negativePrompts.length,
    copyrightSafePrompt: useSeedanceCopyrightSafePrompt,
    promptDumpPath,
    ratio: input.ratio,
    resolution: input.resolution || input.seedanceOptions?.resolution,
    duration: input.duration,
    hasAudio: Boolean(input.audioUrl),
    imageReferenceCount: imageUrls.length,
    videoReferenceCount: videoUrls.length,
    audioReferenceCount: audioUrls.length,
    audioReferenceDisabledReason,
    imageReferenceUrls: summarizeReferenceUrls(imageUrls),
    videoReferenceUrls: summarizeReferenceUrls(videoUrls),
    audioReferenceUrls: summarizeReferenceUrls(audioUrls),
    requestBodySummary: summarizeVideoRequestBodyForLog(requestBody),
  });
  logger.info('video model request started', {
    taskId: input.taskId,
    requestUrl,
    provider: config.provider,
    model: modelOption.id,
    requestMode,
    promptChars: prompt.length,
    negativePromptCount: negativePrompts.length,
    copyrightSafePrompt: useSeedanceCopyrightSafePrompt,
    promptDumpPath,
    ratio: input.ratio,
    resolution: input.resolution || input.seedanceOptions?.resolution,
    duration: input.duration,
    hasAudio: Boolean(input.audioUrl),
    imageReferenceCount: imageUrls.length,
    videoReferenceCount: videoUrls.length,
    audioReferenceCount: audioUrls.length,
    audioReferenceDisabledReason,
    imageReferenceUrls: summarizeReferenceUrls(imageUrls),
    videoReferenceUrls: summarizeReferenceUrls(videoUrls),
    audioReferenceUrls: summarizeReferenceUrls(audioUrls),
    requestBodySummary: summarizeVideoRequestBodyForLog(requestBody),
  });
  try {
    logVideoGenerationFlow('info', 'video model fetch started', {
      traceId: flowTraceId,
      taskId: input.taskId,
      requestUrl,
      provider: config.provider,
      model: modelOption.id,
    });
    const response = await fetch(requestUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const result = await parseVideoGenerationResponse(response, {
      provider: config.provider,
      model: modelOption.id,
    }, { taskId: input.taskId, requestUrl });
    if (task?.userId && (result.usage || result.status === 'completed')) {
      const requestedDurationSeconds = seedanceDurationSeconds(input.duration, modelOption, config.settings);
      const effectiveDurationSeconds = requestedDurationSeconds > 0
        ? requestedDurationSeconds
        : modelOption.durationPolicy.defaultSeconds;
      recordVideoGenerationUsageIfNeeded({
        userId: task.userId,
        sourceType: typeof flowContext.source === 'string' && flowContext.source.trim()
          ? flowContext.source.trim()
          : 'video_generation',
        taskId: input.taskId,
        fallbackSourceId: input.taskId,
        providerId: input.providerId || config.provider,
        modelId: input.modelId || modelOption.id,
        jobId: result.jobId,
        durationSeconds: effectiveDurationSeconds,
        usage: result.usage,
        requestSnapshot: {
          requestMode,
          ratio: input.ratio,
          resolution: input.resolution || input.seedanceOptions?.resolution || '',
          duration: input.duration,
          durationSeconds: effectiveDurationSeconds,
          hasAudio: Boolean(input.audioUrl),
          imageReferenceCount: imageUrls.length,
          videoReferenceCount: videoUrls.length,
          audioReferenceCount: audioUrls.length,
        },
        responseSnapshot: {
          provider: result.provider,
          model: result.model,
          status: result.status,
          jobId: result.jobId,
          completionTokens: result.usage?.completionTokens || 0,
          totalTokens: result.usage?.totalTokens || 0,
          hasVideoUrl: Boolean(result.videoUrl),
          hasCoverUrl: Boolean(result.coverUrl),
        },
        usageRaw: {
          requestMode,
          promptChars: prompt.length,
          negativePromptCount: negativePrompts.length,
        },
      });
    }
    logVideoGenerationFlow('info', 'video model response parsed', {
      traceId: flowTraceId,
      taskId: input.taskId,
      provider: result.provider,
      model: result.model,
      status: result.status,
      hasVideoUrl: Boolean(result.videoUrl),
      hasCoverUrl: Boolean(result.coverUrl),
      jobId: result.jobId,
    });
    logger.info('video model request completed', {
      taskId: input.taskId,
      requestUrl,
      provider: config.provider,
      model: modelOption.id,
      status: result.status,
      hasVideoUrl: Boolean(result.videoUrl),
      jobId: result.jobId,
    });
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logVideoGenerationFlow('error', 'video model request timeout', {
        traceId: flowTraceId,
        taskId: input.taskId,
        requestUrl,
        provider: config.provider,
        model: modelOption.id,
      });
      throw new Error('视频模型请求超时，请检查默认视频模型配置或稍后重试');
    }
    logVideoGenerationFlow('error', 'video model request crashed', {
      traceId: flowTraceId,
      taskId: input.taskId,
      requestUrl,
      provider: config.provider,
      model: modelOption.id,
      error: errorLogContext(error),
    });
    logger.error('video model request crashed', {
      taskId: input.taskId,
      requestUrl,
      provider: config.provider,
      model: modelOption.id,
      error: errorLogContext(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForVideoModelCompletion(input: {
  providerId?: string;
  modelId?: string;
  jobId?: string;
  initialVideoUrl?: string;
  initialCoverUrl?: string;
  initialUsage?: VideoGenerationUsageSnapshot;
  initialStatus: 'running' | 'completed' | 'failed';
  traceId: string;
  taskId: string;
  segmentIndex?: number;
}) {
  if (input.initialStatus === 'completed' && input.initialVideoUrl) {
    return {
      provider: input.providerId,
      model: input.modelId,
      jobId: input.jobId,
      videoUrl: input.initialVideoUrl,
      coverUrl: input.initialCoverUrl,
      usage: input.initialUsage,
      status: 'completed' as const,
    };
  }
  if (!input.jobId) {
    throw new Error('视频分段任务缺少 jobId，无法轮询结果');
  }
  const intervalMs = Number(process.env.VIDEO_GENERATION_POLL_INTERVAL_MS || 30000);
  const maxAttempts = Number(process.env.VIDEO_GENERATION_POLL_MAX_ATTEMPTS || 120);
  const maxTransientErrors = Number(process.env.VIDEO_GENERATION_POLL_MAX_TRANSIENT_ERRORS || 8);
  let transientErrors = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logVideoGenerationFlow('info', 'video segment polling status', {
      traceId: input.traceId,
      taskId: input.taskId,
      segmentIndex: input.segmentIndex,
      jobId: input.jobId,
      attempt,
    });
    let result: Awaited<ReturnType<typeof queryConfiguredVideoModelTask>>;
    try {
      result = await queryConfiguredVideoModelTask({
        providerId: input.providerId,
        modelId: input.modelId,
        jobId: input.jobId,
      });
      transientErrors = 0;
    } catch (error) {
      transientErrors += 1;
      logVideoGenerationFlow('warn', 'video segment polling transient error', {
        traceId: input.traceId,
        taskId: input.taskId,
        segmentIndex: input.segmentIndex,
        jobId: input.jobId,
        attempt,
        transientErrors,
        maxTransientErrors,
        error: errorLogContext(error),
      });
      if (transientErrors > maxTransientErrors) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    if (result.status === 'completed' && result.videoUrl) {
      return result;
    }
    if (result.status === 'failed') {
      throw new Error(result.errorMessage || '视频分段生成失败');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('视频分段生成轮询超时');
}

export async function downloadGeneratedVideoSegment(input: {
  url: string;
  taskId: string;
  segmentIndex: number;
  traceId: string;
}) {
  logVideoGenerationFlow('info', 'video segment download started', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    url: input.url,
  });
  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error(`下载视频分段失败：${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const storedFileName = `video-segment-${input.taskId}-${input.segmentIndex}-${Date.now()}.mp4`;
  const filePath = path.join(contentFilesDir, storedFileName);
  await writeFile(filePath, bytes);
  logVideoGenerationFlow('info', 'video segment download completed', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    filePath,
    bytes: bytes.byteLength,
  });
  return filePath;
}

function localVideoSegmentUrlFromPath(filePath: string) {
  return fileUrlFor(path.basename(filePath));
}

function completedSegmentResultWithLocalUrl(input: {
  segmentIndex: number;
  seconds: number;
  provider?: string;
  model?: string;
  jobId?: string;
  remoteVideoUrl: string;
  status?: string;
  segmentPath: string;
}) {
  const localUrl = localVideoSegmentUrlFromPath(input.segmentPath);
  return {
    segmentIndex: input.segmentIndex,
    seconds: input.seconds,
    provider: input.provider,
    model: input.model,
    jobId: input.jobId,
    remoteVideoUrl: input.remoteVideoUrl,
    videoUrl: localUrl,
    fileUrl: localUrl,
    url: localUrl,
    status: input.status,
    segmentPath: input.segmentPath,
    filePath: input.segmentPath,
  };
}

async function regenerateCopyrightSafeVideoSegment(input: {
  taskId: string;
  title: string;
  segmentIndex: number;
  segmentCount: number;
  seconds: number;
  prompt: string;
  negativePrompts: string[];
  ratio: string;
  resolution?: string;
  context: Record<string, unknown>;
  providerId: string;
  modelId: string;
  seedanceOptions: {
    generateAudio?: boolean;
    watermark?: boolean;
    resolution?: string;
  };
  traceId: string;
}) {
  logVideoGenerationFlow('warn', 'video segment copyright failure retry started', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    seconds: input.seconds,
  });
  const retryResult = await callConfiguredVideoModel({
    taskId: input.taskId,
    title: `${input.title}-片段${input.segmentIndex}-原创化重试`,
    prompt: input.prompt,
    negativePrompts: input.negativePrompts,
    ratio: input.ratio,
    resolution: input.resolution || input.seedanceOptions.resolution,
    duration: formatDurationLabel(input.seconds),
    context: {
      ...input.context,
      videoGenerationFlow: {
        traceId: input.traceId,
        source: 'viral_director_segment_generation_copyright_retry',
        segmentIndex: input.segmentIndex,
        segmentCount: input.segmentCount,
      },
    },
    providerId: input.providerId,
    modelId: input.modelId,
    seedanceOptions: input.seedanceOptions,
  });
  const completed = await waitForVideoModelCompletion({
    providerId: input.providerId,
    modelId: input.modelId,
    jobId: retryResult.jobId,
    initialVideoUrl: retryResult.videoUrl,
    initialCoverUrl: retryResult.coverUrl,
    initialUsage: retryResult.usage,
    initialStatus: retryResult.status,
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
  });
  const retryTask = contentRepository.findVideoTask(input.taskId);
  if (retryTask?.userId) {
    recordVideoGenerationUsageIfNeeded({
      userId: retryTask.userId,
      taskId: input.taskId,
      sourceType: 'viral_director_segment_generation_copyright_retry',
      fallbackSourceId: `${input.taskId}-segment-${input.segmentIndex}-copyright-retry`,
      providerId: input.providerId,
      modelId: input.modelId,
      jobId: completed.jobId,
      durationSeconds: input.seconds,
      usage: completed.usage,
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
        segmentIndex: input.segmentIndex,
        segmentCount: input.segmentCount,
        copyrightRetry: true,
      },
    });
  }
  if (!completed.videoUrl) {
    throw new Error(`视频分段 ${input.segmentIndex} 原创化重试未返回成片地址`);
  }
  const segmentPath = await downloadGeneratedVideoSegment({
    url: completed.videoUrl,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    traceId: input.traceId,
  });
  logVideoGenerationFlow('info', 'video segment copyright failure retry completed', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentIndex: input.segmentIndex,
    jobId: completed.jobId,
  });
  return {
    ...completedSegmentResultWithLocalUrl({
      segmentIndex: input.segmentIndex,
      seconds: input.seconds,
      provider: completed.provider,
      model: completed.model,
      jobId: completed.jobId,
      remoteVideoUrl: completed.videoUrl,
      status: completed.status,
      segmentPath,
    }),
  };
}

async function hasAudioStream(filePath: string) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { timeout: 60_000 });
    return String(stdout).trim() === 'audio';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('当前环境缺少 ffprobe，无法检查合并视频的音轨信息');
    }
    return false;
  }
}

async function normalizeMergedVideoAudio(input: {
  taskId: string;
  traceId: string;
  inputPath: string;
  outputPath: string;
}) {
  const hasAudio = await hasAudioStream(input.inputPath);
  if (!hasAudio) {
    await rename(input.inputPath, input.outputPath);
    logVideoGenerationFlow('info', 'merged video has no audio stream; skipped loudness normalization', {
      traceId: input.traceId,
      taskId: input.taskId,
      outputPath: input.outputPath,
    });
    return;
  }
  logVideoGenerationFlow('info', 'merged video audio normalization started', {
    traceId: input.traceId,
    taskId: input.taskId,
    inputPath: input.inputPath,
    outputPath: input.outputPath,
    filter: 'loudnorm=I=-16:LRA=11:TP=-1.5',
  });
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      input.inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      '-af',
      'loudnorm=I=-16:LRA=11:TP=-1.5',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      input.outputPath,
    ], { timeout: 600_000 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('当前环境缺少 ffmpeg，无法做分段音频响度归一化');
    }
    throw error;
  } finally {
    await rm(input.inputPath, { force: true });
  }
  logVideoGenerationFlow('info', 'merged video audio normalization completed', {
    traceId: input.traceId,
    taskId: input.taskId,
    outputPath: input.outputPath,
  });
}

export async function mergeGeneratedVideoSegments(input: {
  taskId: string;
  segmentPaths: string[];
  traceId: string;
}) {
  if (input.segmentPaths.length < 2) {
    throw new Error('至少需要两个分段才能合并');
  }
  const listFilePath = path.join(contentFilesDir, `video-segments-${input.taskId}-${Date.now()}.txt`);
  const storedFileName = `generated-video-${input.taskId}-${Date.now()}.mp4`;
  const storedRelativePath = generatedMediaRelativePath('video', storedFileName);
  const concatOutputPath = path.join(contentFilesDir, `generated-video-concat-${input.taskId}-${Date.now()}.mp4`);
  const outputPath = contentFilePathForRelativePath(storedRelativePath);
  const escapeConcatPath = (filePath: string) => filePath.replace(/'/g, "'\\''");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(listFilePath, input.segmentPaths.map((filePath) => `file '${escapeConcatPath(filePath)}'`).join('\n'), 'utf8');
  logVideoGenerationFlow('info', 'ffmpeg concat started', {
    traceId: input.traceId,
    taskId: input.taskId,
    segmentCount: input.segmentPaths.length,
    outputPath,
  });
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFilePath,
      '-c',
      'copy',
      concatOutputPath,
    ], { timeout: 600_000 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('当前环境缺少 ffmpeg，无法合并分段视频');
    }
    throw error;
  } finally {
    await rm(listFilePath, { force: true });
  }
  await normalizeMergedVideoAudio({
    taskId: input.taskId,
    traceId: input.traceId,
    inputPath: concatOutputPath,
    outputPath,
  });
  const outputStat = await stat(outputPath);
  const fileUrl = fileUrlFor(storedRelativePath);
  logVideoGenerationFlow('info', 'ffmpeg concat completed', {
    traceId: input.traceId,
    taskId: input.taskId,
    outputPath,
    fileUrl,
    bytes: outputStat.size,
  });
  return {
    filePath: outputPath,
    fileUrl,
    storedFileName: storedRelativePath,
    fileSize: outputStat.size,
  };
}

export async function callSegmentedSeedanceVideoGeneration(input: {
  taskId: string;
  userId: string;
  title: string;
  prompt: string;
  negativePrompts: string[];
  ratio: string;
  resolution?: string;
  totalSeconds: number;
  maxSegmentSeconds: number;
  context: Record<string, unknown>;
  materialContext: Record<string, unknown>;
  providerId: string;
  modelId: string;
  seedanceOptions: {
    generateAudio?: boolean;
    watermark?: boolean;
    resolution?: string;
  };
  confirmedSpeech?: string;
  speechPlan?: SegmentedSpeechSlice[];
  traceId: string;
  pendingAssetId?: string;
}) {
  const storyboard = extractStoryboardFromContext(input.context);
  const confirmedSpeech = input.confirmedSpeech?.trim() || extractConfirmedSpeechFromContext(input.context);
  const segmentGroups = await buildStrictStoryboardSegmentGroups({
    taskId: input.taskId,
    traceId: input.traceId,
    totalSeconds: input.totalSeconds,
    maxSegmentSeconds: input.maxSegmentSeconds,
    storyboard,
  });
  const segments = segmentGroups.map((group) => group.seconds);
  const speechPlan = normalizeSegmentedSpeechPlan(input.speechPlan, segments.length)
    || buildSegmentedSpeechPlan({
      confirmedSpeech,
      segments,
      segmentPlan: segmentGroups,
      storyboard,
    });
  let pendingAssetId = input.pendingAssetId;
  logVideoGenerationFlow('info', 'segmented video generation started', {
    traceId: input.traceId,
    taskId: input.taskId,
    totalSeconds: input.totalSeconds,
    maxSegmentSeconds: input.maxSegmentSeconds,
    segments,
    segmentPlan: segmentGroups.map((group) => ({
      segmentIndex: group.segmentIndex,
      seconds: group.seconds,
      range: `${group.start}-${group.end}`,
      source: group.source,
      shots: group.ranges.map((range) => range.shotLabel),
    })),
    speechPlan: speechPlan.map((item) => ({
      segmentIndex: item.segmentIndex,
      chars: item.playableSpeech.length,
      playableSpeech: item.playableSpeech,
      estimatedSpeechSeconds: item.estimatedSpeechSeconds,
      source: item.source,
    })),
    storyboardAligned: Boolean(storyboard),
  });
  let state: SegmentedVideoGenerationState = {
    status: 'running',
    request: {
      taskId: input.taskId,
      userId: input.userId,
      title: input.title,
      prompt: input.prompt,
      negativePrompts: input.negativePrompts,
      ratio: input.ratio,
      resolution: input.resolution,
      totalSeconds: input.totalSeconds,
      maxSegmentSeconds: input.maxSegmentSeconds,
      context: input.context,
      materialContext: input.materialContext,
      providerId: input.providerId,
      modelId: input.modelId,
      seedanceOptions: input.seedanceOptions,
      confirmedSpeech,
      speechPlan,
      traceId: input.traceId,
      pendingAssetId,
    },
    segments,
    segmentPlan: segmentGroups,
    segmentResults: [],
    segmentPaths: [],
    updatedAt: new Date().toISOString(),
  };
  persistSegmentedVideoGenerationState(input.taskId, state);
  const segmentPaths: string[] = [];
  const segmentResults: Array<Record<string, unknown>> = [];
  try {
    const createdSegmentResults = await Promise.allSettled(segments.map(async (seconds, index) => {
      const segmentIndex = index + 1;
      const segmentPrompt = buildSegmentedSeedancePrompt({
        basePrompt: input.prompt,
        totalSeconds: input.totalSeconds,
        segments,
        segmentIndex,
        maxSegmentSeconds: input.maxSegmentSeconds,
        segmentPlan: segmentGroups,
        storyboard,
        confirmedSpeech,
        speechPlan,
      });
      logVideoGenerationFlow('info', 'video segment generation requested', {
        traceId: input.traceId,
        taskId: input.taskId,
        segmentIndex,
        seconds,
        timeRange: segmentTimeRangeLabel(segments, segmentIndex),
        playableSpeech: speechPlan[index]?.playableSpeech || '',
      });
      const result = await callConfiguredVideoModel({
        taskId: input.taskId,
        title: `${input.title}-片段${segmentIndex}`,
        prompt: segmentPrompt,
        negativePrompts: [
          ...input.negativePrompts,
          ...noOnScreenTextNegativePrompts(),
          '分段开头重复上一段结尾',
          '分段内容重叠',
        ],
        ratio: input.ratio,
        resolution: input.resolution || input.seedanceOptions.resolution,
        duration: formatDurationLabel(seconds),
        context: {
          ...input.context,
          videoGenerationFlow: {
            traceId: input.traceId,
            source: 'viral_director_segment_generation',
            segmentIndex,
            segmentCount: segments.length,
          },
        },
        providerId: input.providerId,
        modelId: input.modelId,
        seedanceOptions: input.seedanceOptions,
      });
      const createdSegment = {
        segmentIndex,
        seconds,
        provider: result.provider,
        model: result.model,
        jobId: result.jobId,
        videoUrl: result.videoUrl,
        usage: result.usage,
        status: result.status,
      };
      segmentResults[segmentIndex - 1] = createdSegment;
      persistSegmentedVideoGenerationState(input.taskId, {
        ...state,
        status: 'running',
        segmentResults: segmentResults.filter(isRecord),
        segmentPaths,
        currentSegmentIndex: undefined,
        failureStage: undefined,
        failureReason: undefined,
      });
      return createdSegment;
    }));
    const createdSegments = fulfilledValues(createdSegmentResults);
    createdSegments
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .forEach((item) => {
        segmentResults[item.segmentIndex - 1] = item;
      });
    const failedCreate = firstRejected(createdSegmentResults);
    if (failedCreate) {
      state = {
        ...state,
        status: 'failed',
        failureStage: 'segment_generation',
        failureReason: userFacingVideoGenerationError(failedCreate.reason),
        segmentResults,
        segmentPaths,
        currentSegmentIndex: undefined,
      };
      persistSegmentedVideoGenerationState(input.taskId, state);
      throw failedCreate.reason;
    }
    if (!pendingAssetId) {
      const pendingAsset = createPendingFinishedVideoAsset({
        userId: input.userId,
        taskId: input.taskId,
        title: input.title,
        provider: input.providerId,
        model: input.modelId,
        ratio: input.ratio,
        duration: formatDurationLabel(input.totalSeconds),
        mode: 'viral_replication_director_generation_segmented',
        traceId: input.traceId,
        materialContext: input.materialContext,
      });
      pendingAssetId = pendingAsset.id;
    }
    state = {
      ...state,
      request: {
        ...state.request,
        pendingAssetId,
      },
      currentSegmentIndex: undefined,
      segmentResults,
      segmentPaths,
    };
    persistSegmentedVideoGenerationState(input.taskId, state);

    const completedSegmentResults = await Promise.allSettled(segments.map(async (seconds, index) => {
      const segmentIndex = index + 1;
      const pendingResult = segmentResults.find((item) => Number(item.segmentIndex) === segmentIndex);
      if (!pendingResult) {
        throw new Error(`视频分段 ${segmentIndex} 未发起生成任务`);
      }
      let completed: Awaited<ReturnType<typeof waitForVideoModelCompletion>>;
      try {
        completed = await waitForVideoModelCompletion({
          providerId: input.providerId,
          modelId: input.modelId,
          jobId: typeof pendingResult.jobId === 'string' ? pendingResult.jobId : undefined,
          initialVideoUrl: typeof pendingResult.videoUrl === 'string' ? pendingResult.videoUrl : undefined,
          initialCoverUrl: undefined,
          initialUsage: isRecord(pendingResult.usage) ? pendingResult.usage as VideoGenerationUsageSnapshot : undefined,
          initialStatus: pendingResult.videoUrl ? 'completed' : 'running',
          traceId: input.traceId,
          taskId: input.taskId,
          segmentIndex,
        });
        recordVideoGenerationUsageIfNeeded({
          userId: input.userId,
          taskId: input.taskId,
          sourceType: 'viral_director_segment_generation',
          fallbackSourceId: `${input.taskId}-segment-${segmentIndex}`,
          providerId: input.providerId,
          modelId: input.modelId,
          jobId: completed.jobId,
          durationSeconds: seconds,
          usage: completed.usage,
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
            segmentIndex,
            segmentCount: segments.length,
          },
        });
      } catch (error) {
        if (!isCopyrightRestrictionError(error)) {
          throw error;
        }
        const segmentPrompt = buildSegmentedSeedancePrompt({
          basePrompt: input.prompt,
          totalSeconds: input.totalSeconds,
          segments,
          segmentIndex,
          maxSegmentSeconds: input.maxSegmentSeconds,
          segmentPlan: segmentGroups,
          storyboard,
          confirmedSpeech,
          speechPlan,
        });
        return regenerateCopyrightSafeVideoSegment({
          taskId: input.taskId,
          title: input.title,
          segmentIndex,
          segmentCount: segments.length,
          seconds,
          prompt: segmentPrompt,
          negativePrompts: [
            ...input.negativePrompts,
            ...noOnScreenTextNegativePrompts(),
            '分段开头重复上一段结尾',
            '分段内容重叠',
          ],
          ratio: input.ratio,
          resolution: input.resolution || input.seedanceOptions.resolution,
          context: input.context,
          providerId: input.providerId,
          modelId: input.modelId,
          seedanceOptions: input.seedanceOptions,
          traceId: input.traceId,
        });
      }
      if (!completed.videoUrl) {
        throw new Error(`视频分段 ${segmentIndex} 未返回成片地址`);
      }
      const segmentPath = await downloadGeneratedVideoSegment({
        url: completed.videoUrl,
        taskId: input.taskId,
        segmentIndex,
        traceId: input.traceId,
      });
      return completedSegmentResultWithLocalUrl({
        segmentIndex,
        seconds,
        provider: completed.provider,
        model: completed.model,
        jobId: completed.jobId,
        remoteVideoUrl: completed.videoUrl,
        status: completed.status,
        segmentPath,
      });
    }));
    const completedSegments = fulfilledValues(completedSegmentResults);
    completedSegments
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .forEach((item) => {
        const resultIndex = segmentResults.findIndex((result) => Number(result.segmentIndex) === item.segmentIndex);
        const nextResult = {
          segmentIndex: item.segmentIndex,
          seconds: item.seconds,
          provider: item.provider,
          model: item.model,
          jobId: item.jobId,
          videoUrl: item.videoUrl,
          fileUrl: item.fileUrl,
          url: item.url,
          remoteVideoUrl: item.remoteVideoUrl,
          segmentPath: item.segmentPath,
          filePath: item.filePath,
          status: item.status,
        };
        if (resultIndex >= 0) {
          segmentResults[resultIndex] = nextResult;
        } else {
          segmentResults.push(nextResult);
        }
        segmentPaths[item.segmentIndex - 1] = item.segmentPath;
      });
    state = {
      ...state,
      status: 'running',
      segmentResults,
      segmentPaths,
      currentSegmentIndex: undefined,
      failureStage: undefined,
      failureReason: undefined,
    };
    persistSegmentedVideoGenerationState(input.taskId, state);
    const failedCompletion = firstRejected(completedSegmentResults);
    if (failedCompletion) {
      state = {
        ...state,
        status: 'failed',
        failureStage: 'segment_generation',
        failureReason: userFacingVideoGenerationError(failedCompletion.reason),
        segmentResults,
        segmentPaths,
        currentSegmentIndex: undefined,
      };
      persistSegmentedVideoGenerationState(input.taskId, state);
      throw failedCompletion.reason;
    }
    const merged = await mergeGeneratedVideoSegments({
      taskId: input.taskId,
      segmentPaths: segments.map((_, index) => segmentPaths[index]).filter(Boolean),
      traceId: input.traceId,
    });
    const group = ensureGeneratedAssetGroup(input.userId, 'finished_video', '生成成片', '视频生成任务自动产生的成片');
    const pendingAsset = pendingAssetId ? contentRepository.findAsset(pendingAssetId) : null;
    const asset = pendingAsset
      ? contentRepository.updateFinishedVideoAssetFile(pendingAsset.id, {
        description: '分段生成后由 ffmpeg 合并的真实成片',
        originalFileName: merged.storedFileName,
        storedFileName: merged.storedFileName,
        mimeType: 'video/mp4',
        fileSize: merged.fileSize,
        filePath: merged.filePath,
        fileUrl: merged.fileUrl,
        metadata: {
          ...pendingAsset.metadata,
          generatedBy: 'video_model',
          generationStatus: 'completed',
          provider: input.providerId,
          model: input.modelId,
          videoTaskId: input.taskId,
          ratio: input.ratio,
          duration: formatDurationLabel(input.totalSeconds),
          mode: 'viral_replication_director_generation_segmented',
          materialContext: input.materialContext,
          segments: segmentResults,
          completedAt: new Date().toISOString(),
        },
      })
      : contentRepository.createAsset({
        userId: input.userId,
        groupId: group.id,
        resourceType: 'finished_video',
        name: input.title || `生成视频-${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        description: '分段生成后由 ffmpeg 合并的真实成片',
        originalFileName: merged.storedFileName,
        storedFileName: merged.storedFileName,
        mimeType: 'video/mp4',
        fileSize: merged.fileSize,
        filePath: merged.filePath,
        fileUrl: merged.fileUrl,
        metadata: {
          generatedBy: 'video_model',
          generationStatus: 'completed',
          provider: input.providerId,
          model: input.modelId,
          videoTaskId: input.taskId,
          ratio: input.ratio,
          duration: formatDurationLabel(input.totalSeconds),
          mode: 'viral_replication_director_generation_segmented',
          materialContext: input.materialContext,
          segments: segmentResults,
          generatedAt: new Date().toISOString(),
        },
      });
    if (!asset) {
      throw new Error('分段合并成片素材创建失败');
    }
    persistSegmentedVideoGenerationState(input.taskId, {
      ...state,
      status: 'completed',
      segmentResults,
      segmentPaths,
    });
    return {
      provider: input.providerId,
      model: input.modelId,
      status: 'completed' as const,
      videoUrl: merged.fileUrl,
      coverUrl: undefined,
      jobId: segmentResults.map((item) => item.jobId).filter(Boolean).join(',') || undefined,
      assetId: asset.id,
      renderMode: 'segmented_ffmpeg' as const,
      segments: segmentResults,
    };
  } catch (error) {
    const completedPathCount = segmentPaths.filter(Boolean).length;
    state = {
      ...state,
      status: 'failed',
      failureStage: completedPathCount === segments.length ? 'merge' : 'segment_generation',
      failureReason: userFacingVideoGenerationError(error),
      segmentResults,
      segmentPaths,
      currentSegmentIndex: undefined,
    };
    persistSegmentedVideoGenerationState(input.taskId, state);
    throw error;
  } finally {
    const latest = contentRepository.findVideoTask(input.taskId);
    const latestSegments = latest?.expertContext?.videoGenerationSegments;
    if (!shouldKeepSegmentFiles(latestSegments)) {
      await Promise.all(segmentPaths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)));
    }
  }
}

export async function resumeSegmentedSeedanceVideoGeneration(task: VideoGenerationTask, state: SegmentedVideoGenerationState) {
  const request = state.request;
  const segmentPaths = state.segments.map((_, index) => {
    const filePath = state.segmentPaths[index];
    return filePath && existsSync(filePath) ? filePath : '';
  });
  const segmentResults = [...state.segmentResults];
  const completedIndexes = new Set(segmentResults
    .filter((item) => {
      const segmentIndex = Number(item.segmentIndex);
      return Boolean(segmentIndex && item.videoUrl && segmentPaths[segmentIndex - 1]);
    })
    .map((item) => Number(item.segmentIndex)));
  logVideoGenerationFlow('info', 'resuming segmented video generation', {
    traceId: request.traceId,
    taskId: task.id,
    completedSegments: Array.from(completedIndexes),
    currentSegmentIndex: state.currentSegmentIndex,
  });
  try {
    const storyboard = extractStoryboardFromContext(request.context);
    const confirmedSpeech = request.confirmedSpeech?.trim()
      || extractConfirmedSpeechFromContext(request.context)
      || extractConfirmedSpeechFromContext(task.expertContext || {});
    const segmentPlan = state.segmentPlan?.length === state.segments.length ? state.segmentPlan : undefined;
    const speechPlan = normalizeSegmentedSpeechPlan(request.speechPlan, state.segments.length)
      || buildSegmentedSpeechPlan({
        confirmedSpeech,
        segments: state.segments,
        segmentPlan,
        storyboard,
      });
    const pendingSegments = state.segments
      .map((seconds, index) => ({ seconds, segmentIndex: index + 1 }))
      .filter((item) => !completedIndexes.has(item.segmentIndex));
    const submittedSegmentResults = await Promise.allSettled(pendingSegments.map(async ({ seconds, segmentIndex }) => {
      const segmentPrompt = buildSegmentedSeedancePrompt({
        basePrompt: request.prompt,
        totalSeconds: request.totalSeconds,
        segments: state.segments,
        segmentIndex,
        maxSegmentSeconds: request.maxSegmentSeconds,
        segmentPlan,
        storyboard,
        confirmedSpeech,
        speechPlan,
      });
      let result: Awaited<ReturnType<typeof callConfiguredVideoModel>>;
      const existingResult = segmentResults.find((item) => Number(item.segmentIndex) === segmentIndex);
      if (typeof existingResult?.jobId === 'string' || typeof existingResult?.videoUrl === 'string') {
        result = {
          provider: String(existingResult.provider || request.providerId),
          model: String(existingResult.model || request.modelId),
          jobId: typeof existingResult.jobId === 'string' ? existingResult.jobId : undefined,
          videoUrl: typeof existingResult.videoUrl === 'string' ? existingResult.videoUrl : undefined,
          usage: isRecord(existingResult.usage) ? existingResult.usage as VideoGenerationUsageSnapshot : undefined,
          coverUrl: undefined,
          status: existingResult.videoUrl ? 'completed' : 'running',
        };
      } else {
        logVideoGenerationFlow('info', 'resume video segment generation requested', {
          traceId: request.traceId,
          taskId: request.taskId,
          segmentIndex,
          seconds,
          timeRange: segmentTimeRangeLabel(state.segments, segmentIndex),
        });
        result = await callConfiguredVideoModel({
          taskId: request.taskId,
          title: `${request.title}-片段${segmentIndex}`,
          prompt: segmentPrompt,
          negativePrompts: [
            ...request.negativePrompts,
            ...noOnScreenTextNegativePrompts(),
            '分段开头重复上一段结尾',
            '分段内容重叠',
          ],
          ratio: request.ratio,
          resolution: request.resolution || request.seedanceOptions.resolution,
          duration: formatDurationLabel(seconds),
          context: {
            ...request.context,
            videoGenerationFlow: {
              traceId: request.traceId,
              source: 'viral_director_segment_generation',
              segmentIndex,
              segmentCount: state.segments.length,
            },
          },
          providerId: request.providerId,
          modelId: request.modelId,
          seedanceOptions: request.seedanceOptions,
        });
      }
      return { segmentIndex, seconds, result };
    }));
    const submittedSegments = fulfilledValues(submittedSegmentResults);
    for (const { segmentIndex, seconds, result } of submittedSegments) {
      const resultIndex = segmentResults.findIndex((item) => Number(item.segmentIndex) === segmentIndex);
      const nextSegmentResult = {
        segmentIndex,
        seconds,
        provider: result.provider,
        model: result.model,
        jobId: result.jobId,
        videoUrl: result.videoUrl,
        usage: result.usage,
        status: result.status,
      };
      if (resultIndex >= 0) {
        segmentResults[resultIndex] = nextSegmentResult;
      } else {
        segmentResults.push(nextSegmentResult);
      }
    }
    if (submittedSegments.length > 0) {
      logVideoGenerationFlow('info', 'resume segmented video generation submitted all segments', {
        traceId: request.traceId,
        taskId: request.taskId,
        segmentCount: submittedSegments.length,
        segments: submittedSegments.map((item) => ({
          segmentIndex: item.segmentIndex,
          jobId: item.result.jobId,
          hasVideoUrl: Boolean(item.result.videoUrl),
        })),
      });
      persistSegmentedVideoGenerationState(task.id, {
        ...state,
        status: 'running',
        segmentPlan,
        currentSegmentIndex: undefined,
        segmentResults,
        segmentPaths,
        failureStage: undefined,
        failureReason: undefined,
      });
    }
    const failedSubmit = firstRejected(submittedSegmentResults);
    if (failedSubmit) {
      persistSegmentedVideoGenerationState(task.id, {
        ...state,
        status: 'failed',
        failureStage: 'segment_generation',
        failureReason: userFacingVideoGenerationError(failedSubmit.reason),
        segmentPlan,
        currentSegmentIndex: undefined,
        segmentResults,
        segmentPaths,
      });
      throw failedSubmit.reason;
    }
    const completedSegmentResults = await Promise.allSettled(submittedSegments.map(async ({ segmentIndex, seconds, result }) => {
      let completed: Awaited<ReturnType<typeof waitForVideoModelCompletion>>;
      try {
        completed = await waitForVideoModelCompletion({
          providerId: request.providerId,
          modelId: request.modelId,
          jobId: result.jobId,
          initialVideoUrl: result.videoUrl,
          initialCoverUrl: result.coverUrl,
          initialUsage: result.usage,
          initialStatus: result.status,
          traceId: request.traceId,
          taskId: request.taskId,
          segmentIndex,
        });
        recordVideoGenerationUsageIfNeeded({
          userId: request.userId,
          taskId: request.taskId,
          sourceType: 'viral_director_segment_generation',
          fallbackSourceId: `${request.taskId}-segment-${segmentIndex}`,
          providerId: request.providerId,
          modelId: request.modelId,
          jobId: completed.jobId,
          durationSeconds: seconds,
          usage: completed.usage,
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
            segmentIndex,
            segmentCount: state.segments.length,
            resumed: true,
          },
        });
      } catch (error) {
        if (!isCopyrightRestrictionError(error)) {
          throw error;
        }
        const segmentPrompt = buildSegmentedSeedancePrompt({
          basePrompt: request.prompt,
          totalSeconds: request.totalSeconds,
          segments: state.segments,
          segmentIndex,
          maxSegmentSeconds: request.maxSegmentSeconds,
          segmentPlan,
          storyboard,
          confirmedSpeech,
          speechPlan,
        });
        return regenerateCopyrightSafeVideoSegment({
          taskId: request.taskId,
          title: request.title,
          segmentIndex,
          segmentCount: state.segments.length,
          seconds,
          prompt: segmentPrompt,
          negativePrompts: [
            ...request.negativePrompts,
            ...noOnScreenTextNegativePrompts(),
            '分段开头重复上一段结尾',
            '分段内容重叠',
          ],
          ratio: request.ratio,
          resolution: request.resolution || request.seedanceOptions.resolution,
          context: request.context,
          providerId: request.providerId,
          modelId: request.modelId,
          seedanceOptions: request.seedanceOptions,
          traceId: request.traceId,
        });
      }
      if (!completed.videoUrl) {
        throw new Error(`视频分段 ${segmentIndex} 未返回成片地址`);
      }
      const segmentPath = await downloadGeneratedVideoSegment({
        url: completed.videoUrl,
        taskId: request.taskId,
        segmentIndex,
        traceId: request.traceId,
      });
      return completedSegmentResultWithLocalUrl({
        segmentIndex,
        seconds,
        provider: completed.provider,
        model: completed.model,
        jobId: completed.jobId,
        remoteVideoUrl: completed.videoUrl,
        status: completed.status,
        segmentPath,
      });
    }));
    const completedSegments = fulfilledValues(completedSegmentResults);
    completedSegments
      .sort((left, right) => left.segmentIndex - right.segmentIndex)
      .forEach((item) => {
        const resultIndex = segmentResults.findIndex((result) => Number(result.segmentIndex) === item.segmentIndex);
        const nextSegmentResult = {
          segmentIndex: item.segmentIndex,
          seconds: item.seconds,
          provider: item.provider,
          model: item.model,
          jobId: item.jobId,
          videoUrl: item.videoUrl,
          fileUrl: item.fileUrl,
          url: item.url,
          remoteVideoUrl: item.remoteVideoUrl,
          segmentPath: item.segmentPath,
          filePath: item.filePath,
          status: item.status,
        };
        if (resultIndex >= 0) {
          segmentResults[resultIndex] = nextSegmentResult;
        } else {
          segmentResults.push(nextSegmentResult);
        }
        segmentPaths[item.segmentIndex - 1] = item.segmentPath;
        completedIndexes.add(item.segmentIndex);
      });
    if (completedSegments.length > 0) {
      persistSegmentedVideoGenerationState(task.id, {
        ...state,
        status: 'running',
        segmentPlan,
        currentSegmentIndex: undefined,
        segmentResults,
        segmentPaths,
        failureStage: undefined,
        failureReason: undefined,
      });
    }
    const failedCompletion = firstRejected(completedSegmentResults);
    if (failedCompletion) {
      persistSegmentedVideoGenerationState(task.id, {
        ...state,
        status: 'failed',
        failureStage: 'segment_generation',
        failureReason: userFacingVideoGenerationError(failedCompletion.reason),
        segmentPlan,
        currentSegmentIndex: undefined,
        segmentResults,
        segmentPaths,
      });
      throw failedCompletion.reason;
    }
    const orderedSegmentPaths = state.segments.map((_, index) => segmentPaths[index]).filter(Boolean);
    if (orderedSegmentPaths.length !== state.segments.length) {
      throw new Error('分段视频未全部完成，无法合并成片');
    }
    const merged = await mergeGeneratedVideoSegments({
      taskId: task.id,
      segmentPaths: orderedSegmentPaths,
      traceId: request.traceId,
    });
    const group = ensureGeneratedAssetGroup(request.userId, 'finished_video', '生成成片', '视频生成任务自动产生的成片');
    const pendingAsset = request.pendingAssetId ? contentRepository.findAsset(request.pendingAssetId) : null;
    const asset = pendingAsset
      ? contentRepository.updateFinishedVideoAssetFile(pendingAsset.id, {
        description: '分段生成后由 ffmpeg 合并的真实成片',
        originalFileName: merged.storedFileName,
        storedFileName: merged.storedFileName,
        mimeType: 'video/mp4',
        fileSize: merged.fileSize,
        filePath: merged.filePath,
        fileUrl: merged.fileUrl,
        metadata: {
          ...pendingAsset.metadata,
          generatedBy: 'video_model',
          generationStatus: 'completed',
          provider: request.providerId,
          model: request.modelId,
          videoTaskId: task.id,
          ratio: request.ratio,
          duration: formatDurationLabel(request.totalSeconds),
          mode: 'viral_replication_director_generation_segmented',
          materialContext: request.materialContext,
          segments: segmentResults,
          resumed: true,
          completedAt: new Date().toISOString(),
        },
      })
      : contentRepository.createAsset({
        userId: request.userId,
        groupId: group.id,
        resourceType: 'finished_video',
        name: request.title || `生成视频-${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        description: '分段生成后由 ffmpeg 合并的真实成片',
        originalFileName: merged.storedFileName,
        storedFileName: merged.storedFileName,
        mimeType: 'video/mp4',
        fileSize: merged.fileSize,
        filePath: merged.filePath,
        fileUrl: merged.fileUrl,
        metadata: {
          generatedBy: 'video_model',
          generationStatus: 'completed',
          provider: request.providerId,
          model: request.modelId,
          videoTaskId: task.id,
          ratio: request.ratio,
          duration: formatDurationLabel(request.totalSeconds),
          mode: 'viral_replication_director_generation_segmented',
          materialContext: request.materialContext,
          segments: segmentResults,
          resumed: true,
          generatedAt: new Date().toISOString(),
        },
      });
    if (!asset) {
      throw new Error('分段合并成片素材创建失败');
    }
    const completedResult: VideoGenerationResult = {
      version: 1,
      taskId: task.id,
      status: 'completed',
      provider: request.providerId,
      model: request.modelId,
      jobId: segmentResults.map((item) => item.jobId).filter(Boolean).join(',') || undefined,
      videoUrl: merged.fileUrl,
      duration: formatDurationLabel(request.totalSeconds),
      ratio: request.ratio,
      renderMode: 'provider_generation',
      renderStatus: 'rendered',
      audioSource: 'provider_audio',
      assetId: asset.id,
      generatedAt: new Date().toISOString(),
    };
    const generatedTask = contentRepository.markVideoTaskGenerated(task.id, merged.fileUrl) || task;
    const taskWithResult = updateVideoTaskParseResult(task.id, {
      editableParseResult: {
        ...generatedTask.editableParseResult,
        videoGenerationResult: completedResult,
      },
      selectedDigitalHumanId: generatedTask.selectedDigitalHumanId,
      selectedSceneId: generatedTask.selectedSceneId,
      selectedVoiceId: generatedTask.selectedVoiceId,
    });
    const completedTask = contentRepository.updateVideoTaskContext(task.id, {
      selectedSkillIds: taskWithResult.selectedSkillIds,
      expertContext: {
        ...taskWithResult.expertContext,
        videoGenerationSegments: {
          ...state,
          status: 'completed',
          segmentResults,
          segmentPaths,
          updatedAt: new Date().toISOString(),
        },
        viralUnderstanding: {
          ...(isRecord(taskWithResult.expertContext.viralUnderstanding) ? taskWithResult.expertContext.viralUnderstanding : {}),
          directorStatus: 'completed',
          directorStep: 'final',
          videoGenerationResult: completedResult,
          updatedAt: new Date().toISOString(),
        },
        videoResult: completedResult,
        videoGenerationResult: completedResult,
        currentStep: 'video_generated',
        requiredUserAction: null,
        updatedAt: new Date().toISOString(),
      },
    });
    return completedTask;
  } catch (error) {
    const orderedSegmentPaths = state.segments.map((_, index) => segmentPaths[index]).filter(Boolean);
    persistSegmentedVideoGenerationState(task.id, {
      ...state,
      status: 'failed',
      failureStage: orderedSegmentPaths.length === state.segments.length ? 'merge' : 'segment_generation',
      failureReason: userFacingVideoGenerationError(error),
      currentSegmentIndex: undefined,
      segmentResults,
      segmentPaths,
    });
    throw error;
  } finally {
    const latest = contentRepository.findVideoTask(task.id);
    const latestSegments = latest?.expertContext?.videoGenerationSegments;
    if (!shouldKeepSegmentFiles(latestSegments)) {
      await Promise.all(segmentPaths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)));
    }
  }
}
