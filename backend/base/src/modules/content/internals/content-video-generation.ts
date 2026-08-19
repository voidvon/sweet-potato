import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contentPublicBaseUrl } from '../../../config/env.js';
import { currentTosStorageConfig, putLocalFileToTos } from '../../../shared/file-storage.js';
import { createTraceId, logger, logsDir } from '../../../shared/logger.js';
import {
  findBillableUsageRecordByCategoryAndSourceId,
  recordVideoGenerationUsage,
  settleReservedFixedBillableUsage,
} from '../../billing/billing.service.js';
import { modelConfigRepository } from '../../model-configs/model-config.repository.js';
import type { VideoModelOption, VideoModelProvider } from '../../video-models/video-model-provider.types.js';
import { getVideoModelProvider } from '../../video-models/video-model.registry.js';
import { contentRepository } from '../content.repository.js';
import type {
  VideoGenerationResult
} from '../content.types.js';
import {
  contentFilesDir,
  errorLogContext,
  execFileAsync,
} from './content-common.js';
import { DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS, defaultVideoPollMaxAttempts } from './content-video-polling.js';
import { updateVideoTaskParseResult } from './content-video-task-runtime.js';
import { isRecord, stringValue } from './content-video-task-utils.js';
import { logVideoGenerationFlow } from './content-video-logging.js';
import { absolutizeMaterialUrl } from './content-voice-clone.js';

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

export function resolveDefaultVideoModel(providerId?: string, modelConfigId?: string) {
  const envApiKey = String(process.env.VIDEO_MODEL_API_KEY || process.env.ARK_API_KEY || '').trim();
  const envProviderId = String(providerId || process.env.VIDEO_MODEL_PROVIDER || 'volcengine-seedance').trim();
  const envModel = String(process.env.VIDEO_MODEL_ID || '').trim();
  const envBaseUrl = String(process.env.VIDEO_MODEL_BASE_URL || '').trim();
  const videoConfigs = modelConfigRepository.list('video');
  const explicitConfig = modelConfigId ? modelConfigRepository.find(modelConfigId) : undefined;
  if (explicitConfig && explicitConfig.type !== 'video') {
    throw new Error('请选择视频模型配置');
  }
  const providerConfig = providerId
    ? videoConfigs.find((item) => item.provider === providerId)
    : undefined;
  const defaultConfig = explicitConfig
    || providerConfig
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
  resolution?: string;
  usage?: VideoGenerationUsageSnapshot;
  requestSnapshot?: Record<string, unknown>;
  responseSnapshot?: Record<string, unknown>;
  usageRaw?: Record<string, unknown>;
  skipBilling?: boolean;
  fixedBillingReservationId?: string;
}) {
  if (input.skipBilling) {
    return null;
  }
  if (input.fixedBillingReservationId) {
    return settleReservedFixedBillableUsage({
      reservationId: input.fixedBillingReservationId,
      category: 'video_generation',
      provider: input.providerId,
      model: input.modelId,
      taskId: input.taskId,
      sessionId: input.taskId,
      responseSnapshot: input.responseSnapshot,
    });
  }
  const sourceId = effectiveVideoGenerationSourceId(input.jobId, input.fallbackSourceId);
  if (!sourceId || findBillableUsageRecordByCategoryAndSourceId('video_generation', sourceId)) {
    return null;
  }
  const config = resolveDefaultVideoModel(input.providerId);
  const provider = resolveConfiguredVideoProvider(config);
  const modelOption = resolveConfiguredVideoOption(provider, config, input.modelId);
  const billedDurationSeconds = input.durationSeconds && input.durationSeconds > 0
    ? Math.ceil(input.durationSeconds)
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
    resolution: input.resolution || String(input.requestSnapshot?.resolution || ''),
    usage: input.usage,
    requestSnapshot: input.requestSnapshot,
    responseSnapshot: input.responseSnapshot,
    usageRaw: input.usageRaw,
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

const seedanceReferenceVideoMinPixels = 409_600;

function seedanceReferenceVideoTosKey(asset: Record<string, unknown>, options: { reuseExisting?: boolean; anonymized?: boolean } = {}) {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const existingKey = String(
    options.anonymized
      ? metadata.seedanceAnonymizedReferenceVideoTosKey
      : metadata.seedanceReferenceVideoTosKey || metadata.tosKey || '',
  ).trim();
  if (options.reuseExisting && existingKey) {
    return existingKey;
  }
  const day = new Date().toISOString().slice(0, 10);
  const sourceName = String(asset.originalFileName || asset.name || asset.id || 'reference-video.mp4');
  const extension = path.extname(sourceName) || path.extname(String(asset.filePath || '')) || '.mp4';
  const safeId = String(asset.id || 'asset').replace(/[^\w-]/g, '');
  const keyPrefix = currentTosStorageConfig().keyPrefix || 'app-files';
  return [
    keyPrefix,
    options.anonymized ? 'seedance-reference-video-anonymized' : 'seedance-reference-video',
    day,
    `${safeId}-${Date.now()}-${randomUUID()}${extension.startsWith('.') ? extension : `.${extension}`}`,
  ].filter(Boolean).join('/');
}

async function probeVideoDimensions(filePath: string) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'json',
      filePath,
    ], { timeout: 60_000 });
    const parsed = JSON.parse(String(stdout || '{}')) as { streams?: Array<{ width?: number; height?: number }> };
    const stream = parsed.streams?.[0];
    const width = Math.max(0, Math.floor(Number(stream?.width || 0)));
    const height = Math.max(0, Math.floor(Number(stream?.height || 0)));
    return {
      width,
      height,
      pixelCount: width * height,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('当前环境缺少 ffprobe，无法检查参考视频尺寸');
    }
    throw error;
  }
}

function evenCeil(value: number) {
  const rounded = Math.ceil(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

async function prepareSeedanceReferenceVideoFile(input: {
  asset: Record<string, unknown>;
  filePath: string;
  traceId: string;
  anonymized?: boolean;
}) {
  const dimensions = await probeVideoDimensions(input.filePath);
  if (!input.anonymized && dimensions.pixelCount >= seedanceReferenceVideoMinPixels) {
    return {
      filePath: input.filePath,
      cleanup: false,
      ...dimensions,
    };
  }
  if (!dimensions.width || !dimensions.height) {
    throw new Error('参考视频缺少有效画面尺寸，无法传给 Seedance');
  }
  const scale = Math.max(1, Math.sqrt(seedanceReferenceVideoMinPixels / dimensions.pixelCount));
  const width = evenCeil(dimensions.width * scale);
  const height = evenCeil(dimensions.height * scale);
  const outputDir = path.join(contentFilesDir, 'seedance-reference-video');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `seedance-reference-video-${String(input.asset.id || 'asset')}-${randomUUID()}.mp4`);
  const videoFilter = input.anonymized
    ? `scale=${width}:${height}:flags=lanczos,scale=iw/18:ih/18,scale=${width}:${height}:flags=neighbor,gblur=sigma=10`
    : `scale=${width}:${height}:flags=lanczos`;
  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      input.filePath,
      '-vf',
      videoFilter,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outputPath,
    ], { timeout: 180_000 });
  } catch (error) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('当前环境缺少 ffmpeg，无法将参考视频转码到 Seedance 要求尺寸');
    }
    throw error;
  }
  const nextDimensions = await probeVideoDimensions(outputPath);
  logVideoGenerationFlow('info', input.anonymized
    ? 'seedance reference video anonymized before tos upload'
    : 'seedance reference video upscaled before tos upload', {
    traceId: input.traceId,
    assetId: String(input.asset.id || ''),
    originalWidth: dimensions.width,
    originalHeight: dimensions.height,
    originalPixelCount: dimensions.pixelCount,
    width: nextDimensions.width,
    height: nextDimensions.height,
    pixelCount: nextDimensions.pixelCount,
  });
  return {
    filePath: outputPath,
    cleanup: true,
    ...nextDimensions,
  };
}

async function uploadLocalReferenceVideoToTos(asset: Record<string, unknown>, traceId: string) {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const anonymizeReferenceVideo = isRecord(asset.runtimeOptions) && asset.runtimeOptions.anonymizeReferenceVideo === true;
  const reusablePixelCount = Number(anonymizeReferenceVideo
    ? metadata.seedanceAnonymizedReferenceVideoPixelCount || 0
    : metadata.seedanceReferenceVideoPixelCount || 0);
  const reusableUrl = [
    reusablePixelCount >= seedanceReferenceVideoMinPixels
      ? anonymizeReferenceVideo
        ? metadata.seedanceAnonymizedReferenceVideoUrl
        : metadata.seedanceReferenceVideoUrl
      : '',
    anonymizeReferenceVideo ? '' : metadata.tosPublicUrl,
    anonymizeReferenceVideo ? '' : metadata.publicUrl,
  ].map((item) => String(item || '').trim()).find(isPublicHttpUrl);
  if (reusableUrl) {
    return reusableUrl;
  }
  const filePath = String(asset.filePath || '').trim();
  if (!filePath || !existsSync(filePath)) {
    return '';
  }
  const prepared = await prepareSeedanceReferenceVideoFile({
    asset,
    filePath,
    traceId,
    anonymized: anonymizeReferenceVideo,
  });
  const key = seedanceReferenceVideoTosKey(asset, { anonymized: anonymizeReferenceVideo });
  let uploaded: Awaited<ReturnType<typeof putLocalFileToTos>>;
  try {
    uploaded = await putLocalFileToTos({
      key,
      filePath: prepared.filePath,
      mimeType: 'video/mp4',
    });
  } finally {
    if (prepared.cleanup) {
      await rm(prepared.filePath, { force: true }).catch(() => undefined);
    }
  }
  const publicUrl = uploaded.publicUrl;
  const assetId = String(asset.id || '').trim();
  if (assetId) {
    const current = contentRepository.findAsset(assetId);
    if (current) {
      contentRepository.updateAssetFileInfo(assetId, {
        metadata: {
          ...current.metadata,
          ...(anonymizeReferenceVideo
            ? {
              seedanceAnonymizedReferenceVideoUrl: publicUrl,
              seedanceAnonymizedReferenceVideoTosBucket: uploaded.bucket,
              seedanceAnonymizedReferenceVideoTosKey: key,
              seedanceAnonymizedReferenceVideoSyncedAt: new Date().toISOString(),
              seedanceAnonymizedReferenceVideoWidth: prepared.width,
              seedanceAnonymizedReferenceVideoHeight: prepared.height,
              seedanceAnonymizedReferenceVideoPixelCount: prepared.pixelCount,
            }
            : {
              seedanceReferenceVideoUrl: publicUrl,
              seedanceReferenceVideoTosBucket: uploaded.bucket,
              seedanceReferenceVideoTosKey: key,
              seedanceReferenceVideoSyncedAt: new Date().toISOString(),
              seedanceReferenceVideoWidth: prepared.width,
              seedanceReferenceVideoHeight: prepared.height,
              seedanceReferenceVideoPixelCount: prepared.pixelCount,
              seedanceReferenceVideoUpscaled: prepared.cleanup,
            }),
        },
        updatedAt: current.updatedAt,
      });
    }
  }
  logVideoGenerationFlow('info', 'seedance local reference video uploaded to tos', {
    traceId,
    assetId,
    key,
    publicUrl: summarizeReferenceUrl(publicUrl),
    width: prepared.width,
    height: prepared.height,
    pixelCount: prepared.pixelCount,
    upscaled: prepared.cleanup,
    anonymized: anonymizeReferenceVideo,
  });
  return publicUrl;
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

export async function collectSeedanceVideoUrls(context: Record<string, unknown>) {
  const materialContext = isRecord(context.materialContext) ? context.materialContext : undefined;
  const references = isRecord(materialContext?.references) ? materialContext.references : undefined;
  const traceId = isRecord(context.videoGenerationFlow) ? String(context.videoGenerationFlow.traceId || '') : '';
  const anonymizeReferenceVideos = context.seedanceAnonymizeReferenceVideos === true;
  const urls = await Promise.all((Array.isArray(references?.videos) ? references.videos : [])
    .filter(isRecord)
    .map(async (asset) => {
      const metadata = isRecord(asset.metadata) ? asset.metadata : {};
      const seedanceReferenceVideoPixelCount = Number(anonymizeReferenceVideos
        ? metadata.seedanceAnonymizedReferenceVideoPixelCount || 0
        : metadata.seedanceReferenceVideoPixelCount || 0);
      const candidates = [
        anonymizeReferenceVideos ? '' : publicMaterialUrl(asset.fileUrl),
        anonymizeReferenceVideos ? '' : publicMaterialUrl(asset.url),
        seedanceReferenceVideoPixelCount >= seedanceReferenceVideoMinPixels
          ? publicMaterialUrl(anonymizeReferenceVideos
            ? metadata.seedanceAnonymizedReferenceVideoUrl
            : metadata.seedanceReferenceVideoUrl)
          : '',
        anonymizeReferenceVideos ? '' : publicMaterialUrl(metadata.tosPublicUrl),
        anonymizeReferenceVideos ? '' : publicMaterialUrl(metadata.url),
        anonymizeReferenceVideos ? '' : publicMaterialUrl(seedanceReferenceVideoMetadataSourceUrl(metadata)),
      ].filter(Boolean);
      const resolved = candidates.find((candidate) => isPublicHttpUrl(candidate));
      if (resolved) {
        return resolved;
      }
      const uploaded = await uploadLocalReferenceVideoToTos({
        ...asset,
        runtimeOptions: {
          ...(isRecord(asset.runtimeOptions) ? asset.runtimeOptions : {}),
          anonymizeReferenceVideo: anonymizeReferenceVideos,
        },
      }, traceId);
      if (uploaded) {
        return uploaded;
      }
      logVideoGenerationFlow('warn', 'seedance video reference skipped because resolved url is not public', {
        traceId,
        assetId: String(asset.id || ''),
        filePath: String(asset.filePath || ''),
        fileUrl: String(asset.fileUrl || ''),
        url: String(asset.url || ''),
        metadataUrl: String(metadata.url || ''),
        metadataSourceUrl: String(metadata.sourceUrl || ''),
        contentPublicBaseUrl,
      });
      return '';
    }));
  return Array.from(new Set(urls.filter(Boolean)));
}

export function seedanceReferenceVideoMetadataSourceUrl(metadata: Record<string, unknown>) {
  return metadata.source === 'remote_video_download' ? '' : String(metadata.sourceUrl || '').trim();
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

function formatNegativePrompt(negativePrompts: string[]) {
  return Array.from(new Set(
    negativePrompts
      .map((item) => item.trim())
      .filter(Boolean),
  )).join(', ');
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
  const filePath = path.join(
    dir,
    `${promptDumpFilePart(input.taskId, 'task')}-full-${promptDumpFilePart(input.traceId, 'trace')}.json`,
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

function isCopyrightRestrictionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /copyright|版权|restriction|rights?|infring/i.test(message);
}

function applySeedanceOriginalityPrompt(prompt: string) {
  return [
    prompt.trim(),
    '# 原创表达约束',
    '参考素材仅用于理解主体特征、动作节奏和画面关系；请重新组织场景、镜头和动作，不直接复制参考内容。',
    '画面保持真实拍摄感，不添加来源标记、平台元素、Logo、屏幕文字、水印或生成标记。',
  ].filter(Boolean).join('\n\n');
}

function seedanceOriginalityNegativePrompts() {
  return [
    '平台水印',
    'AI生成',
    'AI 生成',
    'AI generated',
    'AI-generated',
    'AIGC',
    '生成标记',
    '生成水印',
    '右下角水印',
    '商标 Logo',
  ];
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
      '请减少参考素材相似度，弱化对参考内容的依赖，或更换参考图片后重试。',
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
  return contentRepository.updateVideoTaskContext(input.taskId, {
    selectedSkillIds: taskWithResult.selectedSkillIds,
    expertContext: nextExpertContext,
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
  const useSeedanceOriginalityPrompt = input.providerId === 'volcengine-seedance' || isArkSeedanceConfig(config);
  const prompt = useSeedanceOriginalityPrompt
    ? applySeedanceOriginalityPrompt(input.prompt)
    : input.prompt;
  const negativePrompts = useSeedanceOriginalityPrompt
    ? [...input.negativePrompts, ...seedanceOriginalityNegativePrompts()]
    : input.negativePrompts;
  const imageUrls = await collectSeedanceImageUrls(input.context);
  const videoUrls = await collectSeedanceVideoUrls(input.context);
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
  const timeout = setTimeout(() => controller.abort(), DEFAULT_VIDEO_PROCESSING_TIMEOUT_MS);
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
    originalityPrompt: useSeedanceOriginalityPrompt,
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
    originalityPrompt: useSeedanceOriginalityPrompt,
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
        skipBilling: input.context.skipVideoBilling === true,
        fixedBillingReservationId: typeof input.context.videoBillingReservationId === 'string'
          ? input.context.videoBillingReservationId
          : undefined,
        sourceType: typeof flowContext.source === 'string' && flowContext.source.trim()
          ? flowContext.source.trim()
          : 'video_generation',
        taskId: input.taskId,
        fallbackSourceId: input.taskId,
        providerId: input.providerId || config.provider,
        modelId: input.modelId || modelOption.id,
        jobId: result.jobId,
        durationSeconds: effectiveDurationSeconds,
        resolution: input.resolution || input.seedanceOptions?.resolution,
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
