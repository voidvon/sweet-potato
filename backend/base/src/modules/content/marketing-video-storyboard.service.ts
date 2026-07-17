import { randomUUID } from 'node:crypto';
import {
  findReservedFixedBillableUsage,
  getBillingSettings,
  releaseFixedBillableUsage,
  reserveFixedBillableUsage,
  settleFixedBillableUsage,
} from '../billing/billing.service.js';
import type { CreditReservation } from '../billing/billing.types.js';
import { modelConfigRepository } from '../model-configs/model-config.repository.js';
import { isUpstreamModelError } from '../model-providers/provider-error.js';
import { contentRepository } from './content.repository.js';
import { contentService, temporaryContentAssetExpiresAt } from './content.service.js';
import {
  createGeneratedImageWorkAsset,
  editImageWithConfiguredModel,
  editImageWithJsonReferences,
  generateImageWithConfiguredModel,
} from './internals/content-image-assets.js';
import {
  marketingVideoStoryboardRepository,
  type MarketingVideoStoryboard,
} from './marketing-video-storyboard.repository.js';

type CreateMarketingVideoStoryboardInput = {
  userId: string;
  productName: string;
  productCategory: string;
  sellingPoints: string;
  additionalPrompt?: string;
  referenceImageIds?: string[];
};

type GenerateMarketingVideoInput = {
  quality?: string;
  ratio?: string;
  duration?: string;
  videoModelProviderId?: string;
  videoModelId?: string;
};

const runningStoryboardIds = new Set<string>();

function requiredText(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!text) {
    throw new Error(`${label}不能为空`);
  }
  return text;
}

function normalizedSellingPoints(value: unknown) {
  const points = String(value || '')
    .split(/\r?\n/)
    .map((point) => point.trim())
    .filter(Boolean);
  if (!points.length) {
    throw new Error('核心卖点不能为空');
  }
  return points.join('；');
}

function storyboardPrompt(input: Pick<CreateMarketingVideoStoryboardInput, 'productName' | 'productCategory' | 'sellingPoints' | 'additionalPrompt'>) {
  return [
    '围绕这款产品，帮我生成TVC六宫格分镜，每个六宫格必须带镜头，视觉，文案',
    `商品名称：{{${input.productName}}}`,
    `商品类目：{{${input.productCategory}}}`,
    `核心卖点：{{${input.sellingPoints}}}`,
    ...(input.additionalPrompt ? [`补充要求：{{${input.additionalPrompt}}}`] : []),
  ].join('\n');
}

function selectedStoryboardModel() {
  const settings = getBillingSettings();
  if (!settings) {
    throw new Error('系统计费配置不存在');
  }
  const modelConfig = settings.marketingVideoStoryboardModelConfigId
    ? modelConfigRepository.find(settings.marketingVideoStoryboardModelConfigId)
    : null;
  if (!modelConfig || modelConfig.type !== 'image') {
    throw new Error('后台尚未配置有效的营销视频分镜模型');
  }
  return { settings, modelConfig };
}

function referenceAssets(userId: string, ids: string[]) {
  return ids.map((id) => {
    const asset = contentRepository.findAsset(id);
    if (!asset || asset.userId !== userId || !asset.mimeType.startsWith('image/')) {
      throw new Error('商品参考图不存在或无权访问');
    }
    return asset;
  });
}

function storyboardGenerationErrorMessage(error: unknown) {
  if (!isUpstreamModelError(error)) {
    return error instanceof Error ? error.message : '分镜生成失败';
  }
  const status = error.status ? `HTTP ${error.status}` : '';
  const code = error.code ? error.code.replace(/^provider_/, '') : '';
  const context = [status, code].filter(Boolean).join(' / ');
  const providerMessage = String(error.providerMessage || '').trim();
  const message = String(error.message || '').trim() || '图片模型请求失败';
  const detail = providerMessage && providerMessage !== message
    ? `${message}；供应商信息：${providerMessage}`
    : message;
  return context ? `图片模型请求失败（${context}）：${detail}` : `图片模型请求失败：${detail}`;
}

function reserve(task: MarketingVideoStoryboard) {
  const { settings } = selectedStoryboardModel();
  const credits = Math.max(0, Number(settings.marketingVideoCreditsPerRequest || 0));
  if (credits <= 0) {
    return null;
  }
  return reserveFixedBillableUsage({
    userId: task.userId,
    category: 'marketing_video_storyboard',
    sourceType: 'marketing_video_storyboard',
    sourceId: `${task.id}:storyboard:${randomUUID()}`,
    sessionId: task.id,
    credits,
    step: 'marketing_video_storyboard',
    stepLabel: '营销视频分镜生成',
    requestSnapshot: {
      productName: task.productName,
      productCategory: task.productCategory,
      referenceImageCount: task.referenceImageIds.length,
    },
  });
}

async function runGeneration(taskId: string, reservation: CreditReservation | null) {
  runningStoryboardIds.add(taskId);
  const task = marketingVideoStoryboardRepository.findById(taskId);
  if (!task) {
    if (reservation) releaseFixedBillableUsage(reservation);
    runningStoryboardIds.delete(taskId);
    return;
  }
  try {
    const modelConfig = modelConfigRepository.find(task.modelConfigId);
    if (!modelConfig || modelConfig.type !== 'image') {
      throw new Error('分镜任务使用的图片模型已不存在');
    }
    const references = referenceAssets(task.userId, task.referenceImageIds);
    const generated = references.length > 0
      ? await (modelConfig.provider === 'openai-images'
        ? editImageWithConfiguredModel({
          prompt: task.prompt,
          referenceAssets: references,
          modelConfig,
        })
        : editImageWithJsonReferences({
          prompt: task.prompt,
          referenceAssets: references,
          modelConfig,
        }))
      : await generateImageWithConfiguredModel({
        prompt: task.prompt,
        modelConfig,
      });
    const asset = await createGeneratedImageWorkAsset({
      userId: task.userId,
      buffer: generated.buffer,
      mimeType: generated.mimeType,
      title: `${task.title} 分镜`,
      provider: modelConfig.provider,
      model: modelConfig.model,
      mode: 'marketing_video_storyboard',
      modeTitle: '营销视频分镜',
      prompt: task.prompt,
    });
    marketingVideoStoryboardRepository.markReady(task.id, {
      imageAssetId: asset.id,
      imageUrl: asset.fileUrl,
    });
    if (reservation) {
      settleFixedBillableUsage({
        reservation,
        category: 'marketing_video_storyboard',
        provider: modelConfig.provider,
        model: modelConfig.model,
        sessionId: task.id,
        responseSnapshot: { imageAssetId: asset.id, imageUrl: asset.fileUrl },
      });
    }
  } catch (error) {
    marketingVideoStoryboardRepository.markFailed(
      task.id,
      storyboardGenerationErrorMessage(error),
    );
    if (reservation) releaseFixedBillableUsage(reservation);
  } finally {
    runningStoryboardIds.delete(taskId);
  }
}

function startGeneration(task: MarketingVideoStoryboard) {
  const { settings, modelConfig } = selectedStoryboardModel();
  const reservation = reserve(task);
  const updated = marketingVideoStoryboardRepository.markGenerating(task.id, {
    reservationId: reservation?.id || null,
    creditCost: Number(settings.marketingVideoCreditsPerRequest || 0),
    modelConfigId: modelConfig.id,
    modelName: modelConfig.name || modelConfig.model,
  });
  if (!updated) {
    if (reservation) releaseFixedBillableUsage(reservation);
    throw new Error('分镜任务更新失败');
  }
  void runGeneration(task.id, reservation);
  return updated;
}

export const marketingVideoStoryboardService = {
  list(userId: string) {
    return marketingVideoStoryboardRepository.listByUser(requiredText(userId, '用户')).map((task) => {
      if (task.status !== 'generating' || runningStoryboardIds.has(task.id)) {
        const videoTask = task.videoTaskId ? contentRepository.findVideoTask(task.videoTaskId) : null;
        return { ...task, videoStatus: videoTask?.status || null };
      }
      const reservation = findReservedFixedBillableUsage({
        sourceType: 'marketing_video_storyboard',
        sessionId: task.id,
      });
      if (reservation) releaseFixedBillableUsage(reservation);
      const failedTask = marketingVideoStoryboardRepository.markFailed(task.id, '服务重启导致分镜生成中断，请重新生成') || task;
      return { ...failedTask, videoStatus: null };
    });
  },

  create(input: CreateMarketingVideoStoryboardInput) {
    const userId = requiredText(input.userId, '用户');
    const productName = requiredText(input.productName, '商品名称');
    const productCategory = requiredText(input.productCategory, '商品类目');
    const sellingPoints = normalizedSellingPoints(input.sellingPoints);
    const additionalPrompt = String(input.additionalPrompt || '').trim();
    const referenceImageIds = [...new Set((input.referenceImageIds || []).map(String).filter(Boolean))].slice(0, 5);
    referenceAssets(userId, referenceImageIds);
    const { settings, modelConfig } = selectedStoryboardModel();
    const now = new Date().toISOString();
    const id = randomUUID();
    const task: MarketingVideoStoryboard = {
      id,
      userId,
      title: `营销视频 #${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`,
      productName,
      productCategory,
      sellingPoints,
      additionalPrompt,
      prompt: storyboardPrompt({ productName, productCategory, sellingPoints, additionalPrompt }),
      referenceImageIds,
      modelConfigId: modelConfig.id,
      modelName: modelConfig.name || modelConfig.model,
      status: 'generating',
      imageAssetId: null,
      imageUrl: null,
      videoTaskId: null,
      reservationId: null,
      creditCost: Number(settings.marketingVideoCreditsPerRequest || 0),
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    marketingVideoStoryboardRepository.create(task);
    try {
      contentRepository.retainAssetsForReference({
        assetIds: referenceImageIds,
        userId,
        referenceType: 'marketing_video_storyboard',
        referenceId: task.id,
      });
      return startGeneration(task);
    } catch (error) {
      contentRepository.deleteAssetReferences('marketing_video_storyboard', task.id);
      referenceImageIds.forEach((assetId) => {
        contentRepository.markAssetTemporaryIfUnreferenced(assetId, temporaryContentAssetExpiresAt());
      });
      marketingVideoStoryboardRepository.delete(task.id);
      throw error;
    }
  },

  retry(userId: string, id: string) {
    const task = marketingVideoStoryboardRepository.findById(id);
    if (!task || task.userId !== userId) {
      throw new Error('分镜任务不存在');
    }
    if (task.status === 'generating') {
      throw new Error('分镜正在生成中');
    }
    return startGeneration(task);
  },

  delete(userId: string, id: string) {
    const task = marketingVideoStoryboardRepository.findById(id);
    if (!task || task.userId !== userId) {
      throw new Error('分镜任务不存在');
    }
    if (task.status === 'generating') {
      throw new Error('分镜正在生成中，暂时无法删除');
    }
    marketingVideoStoryboardRepository.delete(task.id);
  },

  async generateVideo(userId: string, id: string, input: GenerateMarketingVideoInput) {
    const task = marketingVideoStoryboardRepository.findById(id);
    if (!task || task.userId !== userId) {
      throw new Error('分镜任务不存在');
    }
    if (task.status !== 'ready' || !task.imageAssetId) {
      throw new Error('分镜尚未生成完成');
    }
    const productImageCount = task.referenceImageIds.length;
    const storyboardImageNumber = productImageCount + 1;
    const referenceDescription = productImageCount === 0
      ? '参考图1的九宫格分镜内容'
      : productImageCount === 1
        ? '参考图1的商品素材与图2的九宫格分镜内容'
        : `参考图1至图${productImageCount}的商品素材与图${storyboardImageNumber}的九宫格分镜内容`;
    const prompt = [
      `${referenceDescription}，生成商业级TVC广告视频，同时生成与广告内容、节奏和氛围相符合的背景音乐。`,
      `商品名称：${task.productName}`,
      `商品类目：${task.productCategory}`,
      `核心卖点：${task.sellingPoints}`,
      ...(task.additionalPrompt ? [`补充要求：${task.additionalPrompt}`] : []),
    ].join('\n');
    const videoTask = await contentService.createVideoProduction({
      userId,
      prompt,
      quality: String(input.quality || '标清 (720p)'),
      ratio: String(input.ratio || '9:16'),
      duration: String(input.duration || '5s'),
      videoModelProviderId: String(input.videoModelProviderId || 'volcengine-seedance'),
      videoModelId: String(input.videoModelId || ''),
      referenceImageIds: [...task.referenceImageIds, task.imageAssetId],
      skipVideoBilling: true,
    });
    marketingVideoStoryboardRepository.markVideoSubmitted(task.id, videoTask.id);
    return videoTask;
  },
};
