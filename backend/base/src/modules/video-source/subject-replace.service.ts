import { contentRepository, emptyVideoParseResult } from '../content/content.repository.js';
import { contentService } from '../content/content.service.js';
import { materializeRemoteVideo, probeDuration } from './dance-remake.service.js';
import { VideoSourceError } from './video-source.types.js';

const subjectTypes = new Set(['model', 'clothing', 'face', 'background', 'product']);
const supportedModelIds = new Set([
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
]);

type SubjectReplaceType = 'model' | 'clothing' | 'face' | 'background' | 'product';

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
    if (!subjectTypes.has(input.subjectType)) {
      throw new VideoSourceError('请选择正确的图片类型');
    }
    if (!supportedModelIds.has(input.videoModelId)) {
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
  try {
    const video = localVideoAssetId
      ? ownAsset(localVideoAssetId, input.userId, 'video')
      : await materializeRemoteVideo({ ...input.remoteVideo!, userId: input.userId });
    const durationSeconds = Math.max(4, Math.min(15, Math.round(await probeDuration(video.filePath))));
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
      generateAudio: input.preserveAudio,
      skipVideoBilling: false,
    });
  } catch (error) {
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
    model: '使用图片1中的模特替换视频1中的人物主体，严格保持参考视频的动作、镜头、构图和节奏，保持新模特身份与外观稳定。',
    clothing: imageCount > 1
      ? '使用图片1的服饰正面和图片2的服饰反面替换视频1中人物的服饰，严格保持人物身份、动作、镜头、构图和节奏，确保服饰前后细节一致稳定。'
      : '使用图片1中的服饰替换视频1中人物的服饰，严格保持人物身份、动作、镜头、构图和节奏，保持服饰细节稳定。',
    face: '使用图片1中的人脸替换视频1中人物的人脸，严格保持参考视频的动作、表情、镜头、构图和节奏，保持新面部身份稳定自然。',
    background: '使用图片1中的背景替换视频1的背景，严格保持前景主体、动作、镜头、构图和节奏，确保前景边缘自然、背景稳定。',
    product: '使用图片1中的商品替换视频1中的商品主体，严格保持参考视频的手部动作、镜头、构图和节奏，保持商品外观与细节稳定。',
  }[type];
  return preserveAudio
    ? `${instruction} 保留并参考原视频中的音乐和节奏。`
    : `${instruction} 不生成声音。`;
}
