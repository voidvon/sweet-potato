import { randomUUID } from 'node:crypto';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vodUploadLimitBytes } from '../../config/env.js';
import { fileStorageKey, fileStorageService, storageMetadata } from '../../shared/file-storage.js';
import {
  getBillingSettings,
  releaseReservedFixedBillableUsage,
  resolveSeedanceVideoPrice,
  reserveFixedBillableUsage,
} from '../billing/billing.service.js';
import type { BillingSettings } from '../billing/billing.types.js';
import { contentRepository, emptyVideoParseResult } from '../content/content.repository.js';
import { contentService, temporaryContentAssetExpiresAt } from '../content/content.service.js';
import {
  contentFilePathForRelativePath,
  execFileAsync,
  fileUrlForContentRelativePath,
  inputMediaRelativePath,
} from '../content/internals/content-common.js';
import { safeFetch } from './video-source.http.js';
import { videoSourceService } from './video-source.service.js';
import { VideoSourceError } from './video-source.types.js';

const danceRemakeModelIds = new Set([
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
]);
const standardDanceRemakeModelId = 'doubao-seedance-2-0-mini-260615';
const standardDanceRemakeQuality = '普清 (480p)';

type DanceRemakeInput = {
  characterImageAssetId: string;
  mode: 'standard' | 'enhanced';
  preserveAudio: boolean;
  quality: string;
  ratio: string;
  referenceVideoAssetId?: string;
  remoteVideo?: {
    input: string;
    trimEnd?: number;
    trimStart?: number;
  };
  userId: string;
  videoModelId: string;
};

export const danceRemakeService = {
  async create(input: DanceRemakeInput) {
    const generationOptions = resolveDanceRemakeGenerationOptions(input);
    if (!danceRemakeModelIds.has(generationOptions.videoModelId)) {
      throw new VideoSourceError('当前模型不支持跳舞复刻');
    }
    const imageAsset = ownAsset(input.characterImageAssetId, input.userId, 'image');
    const localVideoAsset = input.referenceVideoAssetId
      ? ownAsset(input.referenceVideoAssetId, input.userId, 'video')
      : null;
    if (!localVideoAsset && !input.remoteVideo) throw new VideoSourceError('请选择参考视频');
    const task = contentRepository.createParsedVideoTask({
      userId: input.userId,
      sourceUrl: localVideoAsset?.fileUrl || input.remoteVideo?.input || '',
      title: '跳舞复刻',
      prompt: danceRemakePrompt(input),
      parseResult: { ...emptyVideoParseResult },
      aspectRatio: input.ratio,
      expertContext: {
        mode: 'dance_remake',
        currentStep: 'dance_remake_preparing',
        danceRemakePreparationStatus: 'preparing',
        quality: generationOptions.quality,
        ratio: input.ratio,
        videoModelProviderId: 'volcengine-seedance',
        videoModelId: generationOptions.videoModelId,
        referenceImageIds: [imageAsset.id],
        referenceVideoIds: localVideoAsset ? [localVideoAsset.id] : [],
        characterReferenceImageIds: [imageAsset.id],
        generateAudio: input.preserveAudio,
        createdAt: new Date().toISOString(),
      },
    });
    if (!task) throw new VideoSourceError('跳舞复刻准备任务创建失败', 500);
    const generatingTask = contentRepository.markVideoTaskGenerating(task.id);
    if (!generatingTask) throw new VideoSourceError('跳舞复刻准备任务启动失败', 500);
    void prepareDanceRemake(task.id, input, generationOptions, imageAsset.id, localVideoAsset?.id);
    return generatingTask;
  },
};

async function prepareDanceRemake(
  taskId: string,
  input: DanceRemakeInput,
  generationOptions: ReturnType<typeof resolveDanceRemakeGenerationOptions>,
  imageAssetId: string,
  localVideoAssetId?: string,
) {
  let reservationId = '';
  try {
    const videoAsset = localVideoAssetId
      ? ownAsset(localVideoAssetId, input.userId, 'video')
      : input.remoteVideo
        ? await materializeRemoteVideo({ ...input.remoteVideo, userId: input.userId })
        : null;
    if (!videoAsset) throw new VideoSourceError('请选择参考视频');
    const duration = await probeDuration(videoAsset.filePath);
    const durationSeconds = billedReferenceVideoDurationSeconds(duration);
    const settings = getBillingSettings();
    if (!settings) throw new VideoSourceError('系统计费配置不存在', 500);
    const price = resolveDanceRemakePrice({
      durationSeconds,
      quality: generationOptions.quality,
      settings,
      videoModelId: generationOptions.videoModelId,
    });
    const billingSourceId = `dance-remake:${randomUUID()}`;
    const reservation = reserveFixedBillableUsage({
      userId: input.userId,
      category: 'video_generation',
      sourceType: 'dance_remake_generation',
      sourceId: billingSourceId,
      sessionId: billingSourceId,
      credits: price.credits,
      step: 'dance_remake_generation',
      stepLabel: '跳舞复刻',
      pricingMode: 'per_second',
      quantitySnapshot: {
        seconds: durationSeconds,
        resolution: price.resolution,
        configuredCreditsPerSecond: price.creditsPerSecond,
        priceSource: 'system-billing-settings',
      },
      requestSnapshot: {
        mode: input.mode,
        quality: generationOptions.quality,
        duration: `${durationSeconds}s`,
        videoModelId: generationOptions.videoModelId,
      },
    });
    reservationId = reservation.id;
    const preparingTask = contentRepository.findVideoTask(taskId);
    if (!preparingTask || preparingTask.status !== 'generating') {
      throw new VideoSourceError('跳舞复刻准备任务已停止', 409);
    }
    contentRepository.updateVideoTaskContext(taskId, {
      selectedSkillIds: preparingTask.selectedSkillIds,
      expertContext: {
        ...preparingTask.expertContext,
        danceRemakePreparationStatus: 'billing_reserved',
        videoBillingReservationId: reservation.id,
        updatedAt: new Date().toISOString(),
      },
    });
    await contentService.createVideoProduction({
      userId: input.userId,
      taskMode: 'dance_remake',
      precreatedTaskId: taskId,
      prompt: danceRemakePrompt(input),
      quality: generationOptions.quality,
      ratio: input.ratio,
      duration: `${durationSeconds}s`,
      videoModelProviderId: 'volcengine-seedance',
      videoModelId: generationOptions.videoModelId,
      referenceImageIds: [imageAssetId],
      referenceVideoIds: [videoAsset.id],
      characterReferenceImageIds: [imageAssetId],
      generateAudio: input.preserveAudio,
      skipVideoBilling: false,
      videoBillingReservationId: reservation.id,
    });
  } catch (error) {
    if (reservationId) releaseReservedFixedBillableUsage(reservationId);
    failDanceRemakePreparation(taskId, error);
  }
}

function danceRemakePrompt(input: Pick<DanceRemakeInput, 'mode' | 'preserveAudio'>) {
  const prompt = input.mode === 'enhanced'
    ? '以人物参考图作为唯一主体，严格复刻参考视频中的完整舞蹈动作、身体姿态、镜头运动和节奏卡点，保持人物身份、服装和外观稳定，动作自然连贯。'
    : '以人物参考图作为唯一主体，复刻参考视频中的舞蹈动作和节奏，保持人物外观稳定，画面自然连贯。';
  return input.preserveAudio ? `${prompt} 保留并参考原视频中的音乐和节奏。` : `${prompt} 不生成声音。`;
}

function failDanceRemakePreparation(taskId: string, error: unknown) {
  const current = contentRepository.findVideoTask(taskId);
  if (!current || current.status === 'success' || current.status === 'failed') return;
  const failureReason = error instanceof Error ? error.message : String(error || '跳舞复刻素材准备失败');
  contentRepository.updateVideoTaskContext(taskId, {
    selectedSkillIds: current.selectedSkillIds,
    expertContext: {
      ...current.expertContext,
      currentStep: 'dance_remake_preparation_failed',
      danceRemakePreparationStatus: 'failed',
      requiredUserAction: 'resubmit',
      updatedAt: new Date().toISOString(),
    },
  });
  contentRepository.markVideoTaskFailed(taskId, failureReason);
}

export function resolveDanceRemakeGenerationOptions(input: Pick<DanceRemakeInput, 'mode' | 'quality' | 'videoModelId'>) {
  if (input.mode === 'standard') {
    return {
      quality: standardDanceRemakeQuality,
      videoModelId: standardDanceRemakeModelId,
    };
  }
  return {
    quality: input.quality,
    videoModelId: input.videoModelId,
  };
}

export function billedReferenceVideoDurationSeconds(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoSourceError('参考视频时长无效');
  }
  return Math.max(4, Math.min(15, Math.ceil(duration)));
}

export function resolveDanceRemakePrice(input: {
  durationSeconds: number;
  quality: string;
  settings: Pick<BillingSettings,
    | 'seedance2CreditsPerSecond480p'
    | 'seedance2CreditsPerSecond720p'
    | 'seedance2FastCreditsPerSecond480p'
    | 'seedance2FastCreditsPerSecond720p'
    | 'seedance2MiniCreditsPerSecond480p'
    | 'seedance2MiniCreditsPerSecond720p'>;
  videoModelId: string;
}) {
  try {
    const price = resolveSeedanceVideoPrice({
        durationSeconds: input.durationSeconds,
        modelId: input.videoModelId,
        resolution: input.quality,
        settings: input.settings,
      });
    return {
      credits: price.credits,
      creditsPerSecond: price.creditsPerSecond,
      resolution: price.resolution,
    };
  } catch (error) {
    throw new VideoSourceError(
      error instanceof Error ? error.message : '当前视频模型计费配置无效',
      400,
    );
  }
}

function ownAsset(id: string, userId: string, kind: 'image' | 'video') {
  const asset = contentRepository.findAsset(String(id || '').trim());
  if (!asset || asset.userId !== userId) throw new VideoSourceError('参考素材不存在', 404);
  if (!asset.mimeType.startsWith(`${kind}/`)) {
    throw new VideoSourceError(kind === 'image' ? '人物素材必须是图片' : '参考素材必须是视频');
  }
  return asset;
}

export async function materializeRemoteVideo(input: {
  assetKind?: string;
  input: string;
  trimEnd?: number;
  trimStart?: number;
  userId: string;
}) {
  const source = await videoSourceService.resolve(input.input);
  const id = `${source.platform}-${source.externalId}-${randomUUID()}`;
  const outputRelativePath = inputMediaRelativePath('video', `${id}-trimmed.mp4`);
  const sourcePath = path.join(tmpdir(), `${id}-source.mp4`);
  const outputPath = contentFilePathForRelativePath(outputRelativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  let assetCreated = false;
  let persistedFile: Awaited<ReturnType<typeof fileStorageService.storeLocalFile>> | null = null;
  try {
    await downloadVideo(source.downloadUrl, source.resolvedShareUrl, sourcePath);
    const sourceDuration = await probeDuration(sourcePath);
    const { duration: selectionDuration, end, start } = normalizeDanceTrimRange(
      sourceDuration,
      input.trimStart,
      input.trimEnd,
    );
    await execFileAsync('ffmpeg', [
      '-y', '-ss', String(start), '-i', sourcePath, '-t', String(selectionDuration),
      '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-c:a', 'aac',
      '-movflags', '+faststart', outputPath,
    ], { timeout: 180000 });
    const output = await stat(outputPath);
    persistedFile = await fileStorageService.storeLocalFile({
      key: fileStorageKey(outputRelativePath),
      filePath: outputPath,
      fileUrl: fileUrlForContentRelativePath(outputRelativePath),
      mimeType: 'video/mp4',
    });
    const asset = contentService.createAsset({
      userId: input.userId,
      resourceType: 'other',
      name: source.title || '跳舞复刻参考视频',
      originalFileName: `${source.platform}-${source.externalId}-trimmed.mp4`,
      storedFileName: outputRelativePath,
      mimeType: 'video/mp4',
      fileSize: output.size,
      filePath: outputPath,
      fileUrl: persistedFile.fileUrl,
      assetKind: input.assetKind || 'dance_remake_reference_video',
      lifecycleStatus: 'temporary',
      expiresAt: temporaryContentAssetExpiresAt(),
      metadata: {
        duration: selectionDuration,
        externalId: source.externalId,
        kind: 'video_create_reference_upload',
        platform: source.platform,
        source: 'remote_video_download',
        sourceShareUrl: source.sourceUrl,
        temporary: true,
        trimEnd: end,
        trimStart: start,
        ...storageMetadata(persistedFile),
        ...(persistedFile.fileUrl.startsWith('http') ? { publicFileUrl: persistedFile.fileUrl } : {}),
      },
    });
    if (!asset) throw new VideoSourceError('参考视频临时素材创建失败', 500);
    assetCreated = true;
    return asset;
  } finally {
    await rm(sourcePath, { force: true });
    if (!assetCreated) {
      if (persistedFile) {
        await fileStorageService.deleteStoredFile({
          metadata: storageMetadata(persistedFile),
          filePath: outputPath,
        }).catch(() => undefined);
      } else {
        await rm(outputPath, { force: true });
      }
    }
  }
}

async function downloadVideo(url: string, referer: string, filePath: string) {
  const response = await safeFetch(url, {
    headers: { accept: 'video/*,*/*;q=0.8', referer },
  }, { maxRedirects: 8, timeoutMs: 300000 });
  if (![200, 206].includes(response.status) || !response.body) {
    throw new VideoSourceError(`参考视频下载失败（${response.status}）`, 502);
  }
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > vodUploadLimitBytes) throw new VideoSourceError('参考视频文件过大', 413);
  const reader = response.body.getReader();
  const file = await open(filePath, 'wx');
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > vodUploadLimitBytes) {
        await reader.cancel();
        throw new VideoSourceError('参考视频文件过大', 413);
      }
      await file.write(value);
    }
  } finally {
    await file.close();
  }
  if (!size) throw new VideoSourceError('参考视频下载结果为空', 502);
}

export async function probeDuration(filePath: string) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ], { timeout: 15000 });
    const duration = Number(String(stdout || '').trim());
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch {
    // Normalize ffprobe failures below.
  }
  throw new VideoSourceError('无法读取参考视频时长，请确认视频有效');
}

function finiteSecond(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDanceTrimRange(sourceDuration: number, trimStart?: number, trimEnd?: number) {
  const hasExplicitRange = Number.isFinite(trimStart) && Number.isFinite(trimEnd);
  if (sourceDuration > 15 && !hasExplicitRange) {
    throw new VideoSourceError('参考视频超过 15 秒，请先选择截取区间');
  }
  const start = finiteSecond(trimStart, 0);
  const end = finiteSecond(trimEnd, Math.min(sourceDuration, 15));
  const duration = end - start;
  if (start < 0 || end > sourceDuration + 0.2 || duration < 4 || duration > 15) {
    throw new VideoSourceError('参考视频截取区间必须在原视频范围内且时长为 4-15 秒');
  }
  return { duration, end, start };
}
