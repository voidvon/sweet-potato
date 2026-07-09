import { existsSync } from 'node:fs';
import { mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
digitalHumanThreeViewPrompt
} from '../../../config/env.js';
import { recordImageGenerationUsage } from '../../billing/billing.service.js';
import { UpstreamModelError, normalizeUpstreamModelError } from '../../model-providers/provider-error.js';
import { contentRepository } from '../content.repository.js';
import type {
ContentAsset,
ContentResourceType,
VideoGenerationResult
} from '../content.types.js';

import {
contentFilePathForRelativePath,
contentFilesDir,
createContentAssetRecord,
deleteRemoteVirtualPortraitAsset,
fileUrlForContentRelativePath,
generatedMediaRelativePath,
threeViewImageSize
} from './content-common.js';
import { resolveDefaultImageModel } from './content-video-generation.js';
import { isRecord } from './content-viral-analysis.js';

type ImageModelConfig = ReturnType<typeof resolveDefaultImageModel>;

type GeneratedImage = {
  buffer: Buffer;
  mimeType: string;
  source: string;
  model: string;
};

type ImageBillingContext = {
  userId: string;
  sourceType: string;
  sourceId: string;
  groupId?: string;
};

export function imageEditsUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/images/edits`;
}

export function imageGenerationsUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/images/generations`;
}

function imageGenerationSize(config: { provider?: string; settings?: Record<string, unknown> }) {
  const size = config.settings && typeof config.settings.imageSize === 'string'
    ? config.settings.imageSize.trim()
    : '';
  if (size) {
    return size;
  }
  return config.provider === 'openai-images' ? '1024x1024' : threeViewImageSize;
}

function requestedImageSize(config: { provider?: string; settings?: Record<string, unknown> }, size?: string) {
  const requestedSize = String(size || '').trim();
  return requestedSize || imageGenerationSize(config);
}

export async function parseGeneratedImageResponse(response: Response, config: { model: string }): Promise<GeneratedImage> {
  const contentType = response.headers.get('content-type') || '';
  if (response.ok && contentType.toLowerCase().startsWith('image/')) {
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: contentType,
      source: 'binary',
      model: config.model,
    };
  }

  const text = await response.text();
  const compactText = text.replace(/\s+/g, ' ').trim();
  const preview = compactText.slice(0, 500);
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) {
      throw normalizeUpstreamModelError({
        message: imageModelHttpErrorMessage(response.status, preview),
        status: response.status,
      });
    }
    throw new Error(preview ? `图片模型返回了无法解析的响应：${preview}` : '图片模型返回了无法解析的响应');
  }
  if (!response.ok) {
    const message = (data as { error?: { message?: string }; message?: string })?.error?.message
      || (data as { message?: string })?.message
      || imageModelHttpErrorMessage(response.status, preview);
    throw normalizeUpstreamModelError({
      message,
      status: response.status,
    });
  }
  const first = (data as { data?: Array<{ b64_json?: string; url?: string }> }).data?.[0];
  if (first?.b64_json) {
    return {
      buffer: Buffer.from(first.b64_json, 'base64'),
      mimeType: 'image/png',
      source: 'b64_json',
      model: config.model,
    };
  }
  if (first?.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) {
      throw new Error(`图片模型返回的图片下载失败：${imageResponse.status}`);
    }
    return {
      buffer: Buffer.from(await imageResponse.arrayBuffer()),
      mimeType: imageResponse.headers.get('content-type') || 'image/png',
      source: first.url,
      model: config.model,
    };
  }
  throw new Error('图片模型未返回图片数据');
}

function imageModelHttpErrorMessage(status: number, preview?: string) {
  if (status === 524 || /524:\s*A timeout occurred/i.test(preview || '')) {
    return '图片模型上游服务超时（524），请稍后重试或检查图片模型 Base URL/服务商可用性';
  }
  if (/^\s*<!doctype html/i.test(preview || '') || /<html[\s>]/i.test(preview || '')) {
    return `图片模型上游返回了错误页：HTTP ${status}`;
  }
  return preview || `图片模型请求失败：${status}`;
}

function imageModelTimeoutMs(config: ImageModelConfig) {
  const settings = config.settings && typeof config.settings === 'object' && !Array.isArray(config.settings)
    ? config.settings
    : {};
  const imageGeneration = settings.imageGeneration && typeof settings.imageGeneration === 'object' && !Array.isArray(settings.imageGeneration)
    ? settings.imageGeneration as Record<string, unknown>
    : {};
  const configured = Number(
    imageGeneration.requestTimeoutMs
      ?? imageGeneration.timeoutMs
      ?? settings.imageRequestTimeoutMs
      ?? settings.timeoutMs
      ?? process.env.IMAGE_MODEL_TIMEOUT_MS
      ?? 300_000,
  );
  if (!Number.isFinite(configured) || configured <= 0) {
    return 300_000;
  }
  return Math.min(Math.max(configured, 10_000), 600_000);
}

export async function withImageModelTimeout<T>(request: (input: { config: ReturnType<typeof resolveDefaultImageModel>; signal: AbortSignal }) => Promise<T>) {
  const config = resolveDefaultImageModel();
  return withSpecificImageModelTimeout(config, request);
}

export async function withSpecificImageModelTimeout<T>(
  config: ImageModelConfig,
  request: (input: { config: ImageModelConfig; signal: AbortSignal }) => Promise<T>,
) {
  const controller = new AbortController();
  const timeoutMs = imageModelTimeoutMs(config);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request({ config, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamModelError({
        code: 'provider_timeout',
        message: `图片模型请求超过 ${Math.round(timeoutMs / 1000)} 秒未响应，请检查图片模型配置或稍后重试`,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function referenceAssetToDataUri(asset: { filePath: string; mimeType: string }) {
  const bytes = await readFile(asset.filePath);
  const mimeType = asset.mimeType || 'image/png';
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export function normalizeImageModelError(error: unknown): never {
  if (error instanceof Error && /unexpected EOF/i.test(error.message)) {
    throw new Error('图片模型上游连接中断（unexpected EOF）。请确认默认图片模型支持带参考图生成，并优先配置支持 image_urls/image 参数的 /images/generations，或支持 multipart 的 /images/edits。');
  }
  throw error;
}

export async function editImageWithJsonReferences(input: {
  prompt: string;
  referenceAssets: Array<{ filePath: string; mimeType: string; originalFileName: string }>;
  background?: string;
  modelConfig?: ImageModelConfig;
  outputCompression?: number;
  outputFormat?: string;
  size?: string;
  billingContext?: ImageBillingContext;
}): Promise<GeneratedImage> {
  const run: <T>(request: (input: { config: ImageModelConfig; signal: AbortSignal }) => Promise<T>) => Promise<T> = input.modelConfig
    ? (request) => withSpecificImageModelTimeout(input.modelConfig!, request)
    : withImageModelTimeout;
  return run(async ({ config, signal }) => {
    try {
      const imageUrls = await Promise.all(input.referenceAssets.slice(0, 4).map(referenceAssetToDataUri));
      const size = requestedImageSize(config, input.size);
      const response = await fetch(imageGenerationsUrl(config.baseUrl), {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          prompt: input.prompt,
          image: imageUrls.length <= 1 ? imageUrls[0] : imageUrls,
          n: 1,
          size,
          response_format: 'b64_json',
          watermark: false,
          ...(input.background ? { background: input.background } : {}),
          ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
          ...(input.outputCompression !== undefined ? { output_compression: input.outputCompression } : {}),
        }),
      });
      const generated = await parseGeneratedImageResponse(response, config);
      if (input.billingContext) {
        recordImageGenerationUsage({
          userId: input.billingContext.userId,
          modelConfig: config,
          sourceType: input.billingContext.sourceType,
          sourceId: input.billingContext.sourceId,
          groupId: input.billingContext.groupId,
          requestSnapshot: {
            promptLength: input.prompt.length,
            referenceAssetCount: input.referenceAssets.length,
            requestMode: 'json_references',
            size,
            background: input.background,
            outputFormat: input.outputFormat,
            outputCompression: input.outputCompression,
          },
          responseSnapshot: {
            mimeType: generated.mimeType,
            source: generated.source,
            model: generated.model,
            byteLength: generated.buffer.byteLength,
          },
        });
      }
      return generated;
    } catch (error) {
      normalizeImageModelError(error);
    }
  });
}

export async function editImageWithConfiguredModel(input: {
  prompt: string;
  referenceAssets: Array<{ filePath: string; mimeType: string; originalFileName: string }>;
  background?: string;
  modelConfig?: ImageModelConfig;
  outputCompression?: number;
  outputFormat?: string;
  size?: string;
  billingContext?: ImageBillingContext;
}): Promise<GeneratedImage> {
  const resolvedConfig = input.modelConfig || resolveDefaultImageModel();
  return withSpecificImageModelTimeout(resolvedConfig, async ({ config, signal }) => {
    try {
      const size = requestedImageSize(config, input.size);
      const form = new FormData();
      form.set('model', config.model);
      form.set('prompt', input.prompt);
      form.set('n', '1');
      form.set('size', size);
      form.set('response_format', 'b64_json');
      if (input.background) {
        form.set('background', input.background);
      }
      if (input.outputFormat) {
        form.set('output_format', input.outputFormat);
      }
      if (input.outputCompression !== undefined) {
        form.set('output_compression', String(input.outputCompression));
      }
      for (const asset of input.referenceAssets.slice(0, 6)) {
        const bytes = await readFile(asset.filePath);
        const blob = new Blob([bytes], { type: asset.mimeType || 'image/png' });
        form.append('image', blob, asset.originalFileName || 'reference.png');
      }
      const response = await fetch(imageEditsUrl(config.baseUrl), {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: form,
      });
      const generated = await parseGeneratedImageResponse(response, config);
      if (input.billingContext) {
        recordImageGenerationUsage({
          userId: input.billingContext.userId,
          modelConfig: config,
          sourceType: input.billingContext.sourceType,
          sourceId: input.billingContext.sourceId,
          groupId: input.billingContext.groupId,
          requestSnapshot: {
            promptLength: input.prompt.length,
            referenceAssetCount: input.referenceAssets.length,
            requestMode: 'multipart_edits',
            size,
            background: input.background,
            outputFormat: input.outputFormat,
            outputCompression: input.outputCompression,
          },
          responseSnapshot: {
            mimeType: generated.mimeType,
            source: generated.source,
            model: generated.model,
            byteLength: generated.buffer.byteLength,
          },
        });
      }
      return generated;
    } catch (error) {
      normalizeImageModelError(error);
    }
  });
}

export async function generateImageWithConfiguredModel(input: {
  prompt: string;
  background?: string;
  modelConfig: ImageModelConfig;
  outputCompression?: number;
  outputFormat?: string;
  size?: string;
  billingContext?: ImageBillingContext;
}): Promise<GeneratedImage> {
  return withSpecificImageModelTimeout(input.modelConfig, async ({ config, signal }) => {
    try {
      const size = requestedImageSize(config, input.size);
      const response = await fetch(imageGenerationsUrl(config.baseUrl), {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          prompt: input.prompt,
          n: 1,
          size,
          response_format: 'b64_json',
          watermark: false,
          ...(input.background ? { background: input.background } : {}),
          ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
          ...(input.outputCompression !== undefined ? { output_compression: input.outputCompression } : {}),
        }),
      });
      const generated = await parseGeneratedImageResponse(response, config);
      if (input.billingContext) {
        recordImageGenerationUsage({
          userId: input.billingContext.userId,
          modelConfig: config,
          sourceType: input.billingContext.sourceType,
          sourceId: input.billingContext.sourceId,
          groupId: input.billingContext.groupId,
          requestSnapshot: {
            promptLength: input.prompt.length,
            referenceAssetCount: 0,
            requestMode: 'text_to_image',
            size,
            background: input.background,
            outputFormat: input.outputFormat,
            outputCompression: input.outputCompression,
          },
          responseSnapshot: {
            mimeType: generated.mimeType,
            source: generated.source,
            model: generated.model,
            byteLength: generated.buffer.byteLength,
          },
        });
      }
      return generated;
    } catch (error) {
      normalizeImageModelError(error);
    }
  });
}

export function isThreeViewResultAsset(asset: { metadata: Record<string, unknown>; name: string; description: string }) {
  if (asset.metadata.kind === 'three_view_failure' || asset.metadata.kind === 'three_view_running') {
    return false;
  }
  return asset.metadata.kind === 'three_view_result'
    || /三视图|多视图|成品|结果|three[-_ ]?view/i.test(`${asset.name} ${asset.description}`);
}

export function isThreeViewFailureAsset(asset: { metadata: Record<string, unknown> }) {
  return asset.metadata.kind === 'three_view_failure';
}

export function isThreeViewRunningAsset(asset: { metadata: Record<string, unknown> }) {
  return asset.metadata.kind === 'three_view_running';
}

export function extensionForMimeType(mimeType: string) {
  if (/jpe?g/i.test(mimeType)) {
    return 'jpg';
  }
  if (/webp/i.test(mimeType)) {
    return 'webp';
  }
  return 'png';
}

export function buildThreeViewPrompt(input: {
  trainingAssets: Array<{ name: string; description: string; originalFileName: string }>;
}) {
  return `${digitalHumanThreeViewPrompt}

用户已上传 ${input.trainingAssets.length} 张授权训练照片。必须以输入参考图中的人物为准，不要生成其他人物。
最终图片必须是干净的纯人物设计图：不要出现任何文字、标题、人物名称、角度标注、说明、Logo、水印、边框或 UI 元素；不要复述或推断照片文件名。`;
}

export async function deleteContentAssetFile(asset: { id: string; filePath: string; resourceType?: ContentResourceType; metadata?: Record<string, unknown> }) {
  if (asset.resourceType === 'virtual_portrait' && asset.metadata) {
    await deleteRemoteVirtualPortraitAsset(asset as ContentAsset);
  }
  contentRepository.deleteAsset(asset.id);
  if (asset.filePath && existsSync(asset.filePath)) {
    await rm(asset.filePath, { force: true });
  }
}

export function linkedVideoTaskId(asset: { resourceType: ContentResourceType; metadata: Record<string, unknown> }) {
  if (asset.resourceType !== 'finished_video' || typeof asset.metadata.videoTaskId !== 'string') {
    return '';
  }
  return asset.metadata.videoTaskId.trim();
}

export function ensureGeneratedAssetGroup(userId: string, resourceType: ContentResourceType, name: string, description: string) {
  const existing = contentRepository.listGroups({ userId, resourceType })
    .find((group) => group.name === name);
  if (existing) {
    return existing;
  }
  const group = contentRepository.createGroup({ userId, resourceType, name, description });
  if (!group) {
    throw new Error('素材分组创建失败');
  }
  return group;
}

export function videoFileNameFromUrl(url: string) {
  try {
    const parsed = new URL(url, 'https://local.invalid');
    const fileName = path.basename(parsed.pathname);
    return fileName || 'generated-video.mp4';
  } catch {
    return 'generated-video.mp4';
  }
}

function generatedImageFileUrl(storedFileName: string) {
  return fileUrlForContentRelativePath(storedFileName);
}

export async function createGeneratedImageWorkAsset(input: {
  userId: string;
  buffer: Buffer;
  mimeType: string;
  storedFileName?: string;
  filePath?: string;
  fileUrl?: string;
  title?: string;
  originalFileName?: string;
  provider?: string;
  model?: string;
  mode?: string;
  modeTitle?: string;
  prompt?: string;
  conversationId?: string;
  slotIndex?: number;
  width?: number;
  height?: number;
}) {
  const extension = extensionForMimeType(input.mimeType);
  const storedRelativePath = input.storedFileName || generatedMediaRelativePath('image', `work-generated-image-${randomBytes(8).toString('hex')}.${extension}`);
  const filePath = input.filePath || contentFilePathForRelativePath(storedRelativePath);
  const fileUrl = input.fileUrl || generatedImageFileUrl(storedRelativePath);
  if (!input.filePath) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.buffer);
  }

  const group = ensureGeneratedAssetGroup(input.userId, 'finished_video', '生成图片', '图片创作自动产生的作品');
  const generatedAt = new Date().toISOString();
  const asset = createContentAssetRecord({
    userId: input.userId,
    groupId: group.id,
    resourceType: 'finished_video',
    name: input.title || `生成图片-${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    description: '图片创作生成的作品',
    originalFileName: input.originalFileName || `generated-image.${extension}`,
    storedFileName: storedRelativePath,
    mimeType: input.mimeType,
    fileSize: input.buffer.byteLength,
    filePath,
    fileUrl,
    metadata: {
      generatedBy: 'image_model',
      generationStatus: 'completed',
      provider: input.provider,
      model: input.model,
      mode: input.mode || 'image_generation',
      modeTitle: input.modeTitle,
      prompt: input.prompt,
      conversationId: input.conversationId,
      slotIndex: input.slotIndex,
      width: input.width,
      height: input.height,
      generatedAt,
    },
  });
  if (!asset) {
    throw new Error('图片作品创建失败');
  }
  return asset;
}

export function createFinishedVideoAsset(input: {
  userId: string;
  taskId: string;
  title: string;
  videoUrl: string;
  provider?: string;
  model?: string;
  ratio: string;
  duration: string;
  mode?: string;
  materialContext: Record<string, unknown>;
  assetId?: string;
}) {
  if (input.assetId) {
    const current = contentRepository.findAsset(input.assetId);
    if (current && current.userId === input.userId && current.resourceType === 'finished_video') {
      const originalFileName = videoFileNameFromUrl(input.videoUrl);
      const updated = contentRepository.updateFinishedVideoAssetFile(input.assetId, {
        description: '视频模型返回的真实成片地址',
        originalFileName,
        storedFileName: originalFileName,
        mimeType: 'video/mp4',
        fileSize: 0,
        filePath: '',
        fileUrl: input.videoUrl,
        metadata: {
          ...current.metadata,
          generatedBy: 'video_model',
          generationStatus: 'completed',
          provider: input.provider,
          model: input.model,
          videoTaskId: input.taskId,
          ratio: input.ratio,
          duration: input.duration,
          mode: input.mode || 'video_generation',
          materialContext: input.materialContext,
          completedAt: new Date().toISOString(),
        },
      });
      if (updated) {
        return updated;
      }
    }
  }
  const existing = contentRepository
    .listAssets({ userId: input.userId, resourceType: 'finished_video' })
    .find((asset) => asset.metadata.videoTaskId === input.taskId && asset.fileUrl === input.videoUrl);
  if (existing) {
    return existing;
  }
  const group = ensureGeneratedAssetGroup(input.userId, 'finished_video', '生成成片', '视频生成任务自动产生的成片');
  const originalFileName = videoFileNameFromUrl(input.videoUrl);
  const asset = contentRepository.createAsset({
    userId: input.userId,
    groupId: group.id,
    resourceType: 'finished_video',
    name: input.title || `生成视频-${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    description: '视频模型返回的真实成片地址',
    originalFileName,
    storedFileName: originalFileName,
    mimeType: 'video/mp4',
    fileSize: 0,
    filePath: '',
    fileUrl: input.videoUrl,
    metadata: {
      generatedBy: 'video_model',
      provider: input.provider,
      model: input.model,
      videoTaskId: input.taskId,
      ratio: input.ratio,
      duration: input.duration,
      mode: input.mode || 'video_generation',
      materialContext: input.materialContext,
      generatedAt: new Date().toISOString(),
    },
  });
  if (!asset) {
    throw new Error('成片素材创建失败');
  }
  return asset;
}

export function createPendingFinishedVideoAsset(input: {
  userId: string;
  taskId: string;
  title: string;
  provider?: string;
  model?: string;
  ratio: string;
  duration: string;
  mode?: string;
  traceId?: string;
  materialContext?: Record<string, unknown>;
}) {
  const group = ensureGeneratedAssetGroup(input.userId, 'finished_video', '生成成片', '视频生成任务自动产生的成片');
  const now = new Date().toISOString();
  const asset = contentRepository.createAsset({
    userId: input.userId,
    groupId: group.id,
    resourceType: 'finished_video',
    name: input.title || `生成视频-${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    description: '视频正在生成中',
    originalFileName: 'generating-video.mp4',
    storedFileName: '',
    mimeType: 'video/mp4',
    fileSize: 0,
    filePath: '',
    fileUrl: '',
    metadata: {
      generatedBy: 'video_model',
      generationStatus: 'generating',
      provider: input.provider,
      model: input.model,
      videoTaskId: input.taskId,
      ratio: input.ratio,
      duration: input.duration,
      mode: input.mode || 'video_generation',
      traceId: input.traceId,
      materialContext: input.materialContext || {},
      generatedAt: now,
    },
  });
  if (!asset) {
    throw new Error('成片占位素材创建失败');
  }
  return asset;
}

export function markFinishedVideoAssetFailed(assetId: string | undefined, errorMessage: string) {
  if (!assetId) {
    return;
  }
  const current = contentRepository.findAsset(assetId);
  if (!current || current.resourceType !== 'finished_video') {
    return;
  }
  contentRepository.updateFinishedVideoAssetFile(assetId, {
    description: '视频生成失败',
    metadata: {
      ...current.metadata,
      generationStatus: 'failed',
      errorMessage,
      failedAt: new Date().toISOString(),
    },
  });
}

export function markGeneratingFinishedVideoAssetsFailedForTask(taskId: string, errorMessage: string) {
  const task = contentRepository.findVideoTask(taskId);
  if (!task) {
    return;
  }
  contentRepository
    .listAssets({ userId: task.userId, resourceType: 'finished_video' })
    .filter((asset) => asset.metadata.videoTaskId === taskId && asset.metadata.generationStatus === 'generating')
    .forEach((asset) => markFinishedVideoAssetFailed(asset.id, errorMessage));
}

export function appendVideoGenerationResultHistory(context: Record<string, unknown>, result: VideoGenerationResult) {
  const history = Array.isArray(context.videoGenerationResults)
    ? context.videoGenerationResults.filter(isRecord)
    : [];
  const key = result.assetId || result.jobId || result.generatedAt;
  const nextHistory = history.filter((item) => {
    const itemKey = String(item.assetId || item.jobId || item.generatedAt || '');
    return itemKey !== key;
  });
  nextHistory.push(result as unknown as Record<string, unknown>);
  return nextHistory;
}
