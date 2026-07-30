import { randomUUID } from 'node:crypto';
import {
  releaseReservedFixedBillableUsage,
  reserveFixedBillableUsage,
} from '../billing/billing.service.js';
import { contentRepository, emptyVideoParseResult } from '../content/content.repository.js';
import { contentService } from '../content/content.service.js';
import {
  estimateDanceRemakeAssetPrice,
  materializeRemoteVideo,
} from './dance-remake.service.js';
import { VideoSourceError } from './video-source.types.js';
import { isSeedanceVideoModelId } from './seedance-video.config.js';
import { isSubjectReplaceType, type SubjectReplaceType } from './subject-replace.config.js';

type SubjectReplaceInput = {
  imageAssetIds: string[];
  preserveAudio: boolean;
  quality: string;
  referenceVideoAssetId?: string;
  remoteVideo?: {
    input: string;
    trimEnd?: number;
    trimStart?: number;
  };
  subjectType: SubjectReplaceType;
  userId: string;
  videoModelId: string;
};

export const subjectReplaceService = {
  async create(input: SubjectReplaceInput) {
    if (!isSubjectReplaceType(input.subjectType)) {
      throw new VideoSourceError('请选择正确的图片类型');
    }
    if (!isSeedanceVideoModelId(input.videoModelId)) {
      throw new VideoSourceError('当前模型不支持主体替换');
    }
    const expectedMaxImages = input.subjectType === 'clothing' ? 2 : 1;
    const imageIds = [...new Set(input.imageAssetIds.map((id) => id.trim()).filter(Boolean))];
    if (imageIds.length < 1 || imageIds.length > expectedMaxImages) {
      throw new VideoSourceError(input.subjectType === 'clothing' ? '请上传服饰正面图，反面图最多一张' : '请上传一张主体图片');
    }
    const images = imageIds.map((id) => ownAsset(id, input.userId, 'image'));
    const localVideo = input.referenceVideoAssetId
      ? ownAsset(input.referenceVideoAssetId, input.userId, 'video')
      : null;
    if (!localVideo && !input.remoteVideo) {
      throw new VideoSourceError('请选择参考视频');
    }
    const prompt = subjectReplacePrompt(input.subjectType, images.length, input.preserveAudio);
    const task = contentRepository.createParsedVideoTask({
      userId: input.userId,
      sourceUrl: localVideo?.fileUrl || input.remoteVideo?.input || '',
      title: '主体替换',
      prompt,
      parseResult: { ...emptyVideoParseResult },
      aspectRatio: '9:16',
      expertContext: {
        mode: 'subject_replace',
        currentStep: 'subject_replace_preparing',
        quality: input.quality,
        ratio: '9:16',
        videoModelProviderId: 'volcengine-seedance',
        videoModelId: input.videoModelId,
        referenceImageIds: images.map((asset) => asset.id),
        referenceVideoIds: localVideo ? [localVideo.id] : [],
        generateAudio: input.preserveAudio,
        subjectType: input.subjectType,
        subjectReplaceType: input.subjectType,
        subjectReplaceRemoteVideo: input.remoteVideo || null,
        createdAt: new Date().toISOString(),
      },
    });
    if (!task) throw new VideoSourceError('主体替换准备任务创建失败', 500);
    const generatingTask = contentRepository.markVideoTaskGenerating(task.id);
    if (!generatingTask) throw new VideoSourceError('主体替换准备任务启动失败', 500);
    void prepareSubjectReplace(task.id, input, images.map((asset) => asset.id), localVideo?.id);
    return generatingTask;
  },
};

async function prepareSubjectReplace(
  taskId: string,
  input: SubjectReplaceInput,
  imageAssetIds: string[],
  localVideoAssetId?: string,
) {
  let reservationId = '';
  try {
    const video = localVideoAssetId
      ? ownAsset(localVideoAssetId, input.userId, 'video')
      : await materializeRemoteVideo({ ...input.remoteVideo!, userId: input.userId });
    const materializedTask = contentRepository.findVideoTask(taskId);
    if (!materializedTask || materializedTask.status !== 'generating') {
      throw new VideoSourceError('主体替换准备任务已停止', 409);
    }
    contentRepository.updateVideoTaskContext(taskId, {
      selectedSkillIds: materializedTask.selectedSkillIds,
      expertContext: {
        ...materializedTask.expertContext,
        referenceVideoIds: [video.id],
        subjectReplacePreparationStatus: 'video_materialized',
        materializedReferenceVideoAssetId: video.id,
        updatedAt: new Date().toISOString(),
      },
    });
    const price = await estimateDanceRemakeAssetPrice({
      filePath: video.filePath,
      quality: input.quality,
      videoModelId: input.videoModelId,
    });
    const { durationSeconds } = price;
    const billingSourceId = `subject-replace:${randomUUID()}`;
    const reservation = reserveFixedBillableUsage({
      userId: input.userId,
      category: 'video_generation',
      sourceType: 'subject_replace_generation',
      sourceId: billingSourceId,
      sessionId: billingSourceId,
      credits: price.credits,
      step: 'subject_replace_generation',
      stepLabel: '主体替换',
      pricingMode: 'per_second',
      quantitySnapshot: {
        seconds: durationSeconds,
        resolution: price.resolution,
        configuredCreditsPerSecond: price.creditsPerSecond,
        priceSource: 'system-billing-settings',
      },
      requestSnapshot: {
        subjectType: input.subjectType,
        quality: input.quality,
        duration: `${durationSeconds}s`,
        videoModelId: input.videoModelId,
      },
    });
    reservationId = reservation.id;
    const preparingTask = contentRepository.findVideoTask(taskId);
    if (!preparingTask || preparingTask.status !== 'generating') {
      throw new VideoSourceError('主体替换准备任务已停止', 409);
    }
    contentRepository.updateVideoTaskContext(taskId, {
      selectedSkillIds: preparingTask.selectedSkillIds,
      expertContext: {
        ...preparingTask.expertContext,
        subjectReplacePreparationStatus: 'billing_reserved',
        videoBillingReservationId: reservation.id,
        updatedAt: new Date().toISOString(),
      },
    });
    await contentService.createVideoProduction({
      userId: input.userId,
      taskMode: 'subject_replace',
      precreatedTaskId: taskId,
      prompt: subjectReplacePrompt(input.subjectType, imageAssetIds.length, input.preserveAudio),
      quality: input.quality,
      ratio: '9:16',
      duration: `${durationSeconds}s`,
      videoModelProviderId: 'volcengine-seedance',
      videoModelId: input.videoModelId,
      referenceImageIds: imageAssetIds,
      referenceVideoIds: [video.id],
      characterReferenceImageIds: ['model', 'face'].includes(input.subjectType)
        ? [imageAssetIds[0]]
        : [],
      subjectReplaceType: input.subjectType,
      subjectReplaceRemoteVideo: input.remoteVideo,
      generateAudio: input.preserveAudio,
      skipVideoBilling: false,
      videoBillingReservationId: reservation.id,
    });
  } catch (error) {
    if (reservationId) releaseReservedFixedBillableUsage(reservationId);
    const current = contentRepository.findVideoTask(taskId);
    if (!current || current.status === 'success' || current.status === 'failed') return;
    const reason = error instanceof Error ? error.message : String(error || '主体替换素材准备失败');
    contentRepository.updateVideoTaskContext(taskId, {
      selectedSkillIds: current.selectedSkillIds,
      expertContext: {
        ...current.expertContext,
        currentStep: 'subject_replace_preparation_failed',
        requiredUserAction: 'resubmit',
        updatedAt: new Date().toISOString(),
      },
    });
    contentRepository.markVideoTaskFailed(taskId, reason);
  }
}

function ownAsset(id: string, userId: string, kind: 'image' | 'video') {
  const asset = contentRepository.findAsset(id);
  if (!asset || asset.userId !== userId) {
    throw new VideoSourceError('参考素材不存在', 404);
  }
  if (!asset.mimeType.startsWith(`${kind}/`)) {
    throw new VideoSourceError(kind === 'image' ? '主体素材必须是图片' : '参考素材必须是视频');
  }
  return asset;
}

export function subjectReplacePrompt(type: SubjectReplaceType, imageCount: number, preserveAudio: boolean) {
  const instruction = {
    model: '将视频1中的原模特完整替换为图片1中的模特。图片1中的人物是唯一的人物身份和外观来源，生成视频中的人物必须严格使用图片1模特的人脸、五官、发型、发色、服装、配饰、体型和整体人物特征，不得保留或混合视频1原模特的人脸、发型、服装或身份特征。视频1只用于参考动作、身体姿态、表情变化、镜头运动、构图和节奏；让图片1中的同一个完整人物自然执行视频1中的动作，确保所有镜头里人脸、发型、服装和人物身份始终一致稳定。',
    clothing: imageCount > 1
      ? '使用图片1的服饰正面和图片2的服饰反面替换视频1中人物的服饰，严格保持人物身份、动作、镜头、构图和节奏，确保服饰前后细节一致稳定。'
      : '使用图片1中的服饰替换视频1中人物的服饰，严格保持人物身份、动作、镜头、构图和节奏，保持服饰细节稳定。',
    face: '使用图片1中的人脸替换视频1中人物的人脸，严格保持参考视频的动作、表情、镜头、构图和节奏，保持新面部身份稳定自然。',
    background: '图片1仅用于提供背景环境，必须完全忽略图片1中出现的任何人物、人脸、人体、服饰和动作，不得将其作为主体参考。只替换视频1的背景区域；视频1中的前景人物是唯一的人物身份来源，必须完整保留其人脸、身份、发型、服装、体态、动作和表情，严禁换人、换脸、改变人物外观或新增人物。严格保持视频1的镜头、构图和节奏，确保前景人物边缘自然、背景稳定。',
    product: '使用图片1中的商品替换视频1中的商品主体，严格保持参考视频的手部动作、镜头、构图和节奏，保持商品外观与细节稳定。',
  }[type];
  return preserveAudio
    ? `${instruction} 保留并参考原视频中的音乐和节奏。`
    : `${instruction} 不生成声音。`;
}
