import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Modal, Segmented, Select, Slider, message } from 'antd';
import {
  createContentAssetGroup,
  createVideoProduction,
  deleteVideoTask,
  listContentAssetGroups,
  listContentAssets,
  listVideoProductions,
  uploadContentAsset,
} from '../../api/content';
import { listModelConfigs, listVideoModelProviders } from '../../api/model-config';
import { API_BASE_URL } from '../../api/request';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type {
  ContentAsset,
  ContentAssetGroup,
  ContentResourceType,
  ModelConfig,
  User,
  VideoGenerationResult,
  VideoGenerationTask,
  VideoModelOption,
  VideoModelReferencePolicy,
} from '../../types';
import type { VideoModelProviderOption } from '../../api/model-config';
import { validateVoiceAudioFiles, voiceAudioAccept } from '../../utils/voiceAudioUpload';

type VideoCreatePageProps = {
  currentUser: User;
};

const qualityOptions = ['普清 (480p)', '标清 (720p)'];
const ratioOptions = ['9:16', '16:9', '3:4', '4:3', '1:1'];
type PickerKind = 'image' | 'video' | 'audio';

const pickerConfig: Record<PickerKind, {
  label: string;
  title: string;
  hint: string;
  emptyText: string;
  accept: string;
  resourceType: ContentResourceType;
  groupName: string;
  limit: number;
}> = {
  image: {
    label: '参考图片',
    title: '选择参考图片',
    hint: '从数字人、场景或产品素材中选择具体图片。',
    emptyText: '暂无可选图片素材',
    accept: 'image/*',
    resourceType: 'product',
    groupName: '视频制作参考图片',
    limit: 9,
  },
  video: {
    label: '参考视频',
    title: '选择参考视频',
    hint: '上传并选择自己的参考视频，不会进入成片素材库。',
    emptyText: '暂无已上传参考视频',
    accept: 'video/*',
    resourceType: 'other',
    groupName: '视频制作参考视频',
    limit: 3,
  },
  audio: {
    label: '参考音频',
    title: '选择参考音频',
    hint: '从人声素材库选择具体音频，或本地上传 wav/mp3。',
    emptyText: '暂无可选音频素材',
    accept: voiceAudioAccept,
    resourceType: 'voice',
    groupName: '视频制作参考音频',
    limit: 3,
  },
};

const defaultPrompt = `
整体风格：电影感、暖色调、高饱和度
氛围：轻松愉快、专业可信`;

const preferredVideoModelId = 'doubao-seedance-2-0-260128';

type SelectableVideoModel = {
  provider: VideoModelProviderOption;
  model: VideoModelOption;
  value: string;
};

function formatDate(value: string) {
  return value ? value.replace('T', ' ').slice(0, 19) : '';
}

function taskMeta(task: VideoGenerationTask) {
  const context = task.expertContext || {};
  return {
    quality: String(context.quality || '标清 (720p)'),
    ratio: String(context.ratio || '9:16'),
    duration: String(context.duration || '5秒'),
    videoModelProviderId: typeof context.videoModelProviderId === 'string' ? context.videoModelProviderId : '',
    videoModelId: typeof context.videoModelId === 'string' ? context.videoModelId : '',
    referenceImageIds: Array.isArray(context.referenceImageIds) ? context.referenceImageIds.map(String) : [],
    referenceVideoIds: Array.isArray(context.referenceVideoIds) ? context.referenceVideoIds.map(String) : [],
    referenceAudioIds: Array.isArray(context.referenceAudioIds) ? context.referenceAudioIds.map(String) : [],
    referenceImageGroupId: typeof context.referenceImageGroupId === 'string' ? context.referenceImageGroupId : '',
    referenceVideoGroupId: typeof context.referenceVideoGroupId === 'string' ? context.referenceVideoGroupId : '',
    referenceAudioGroupId: typeof context.referenceAudioGroupId === 'string' ? context.referenceAudioGroupId : '',
  };
}

function assetUrl(asset: ContentAsset) {
  if (/^https?:\/\//i.test(asset.fileUrl)) {
    return asset.fileUrl;
  }
  return `${API_BASE_URL}${asset.fileUrl}`;
}

function audioSourceLabel(asset: ContentAsset, group?: ContentAssetGroup) {
  if (asset.metadata?.kind === 'voice_clone_preview') {
    return '克隆试听';
  }
  if (asset.metadata?.source === 'local_upload' || group?.metadata?.source === 'local_upload') {
    return '本地上传';
  }
  return '本地上传';
}

function isVideoGenerationResult(value: unknown): value is VideoGenerationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return status === 'pending' || status === 'running' || status === 'completed' || status === 'failed';
}

function isSyntheticGeneratedVideoUrl(url?: string | null) {
  return Boolean(url && /\/files\/generated-[^/?#]+\.mp4(?:[?#].*)?$/i.test(url));
}

function resolveMediaUrl(url?: string | null) {
  if (!url) {
    return '';
  }
  return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
}

function taskVideoGenerationResult(task: VideoGenerationTask) {
  const contextResult = isVideoGenerationResult(task.expertContext?.videoGenerationResult)
    ? task.expertContext.videoGenerationResult
    : undefined;
  return task.editableParseResult.videoGenerationResult || contextResult;
}

function taskVideoUrl(task: VideoGenerationTask) {
  const result = taskVideoGenerationResult(task);
  const rawGeneratedVideoUrl = !isSyntheticGeneratedVideoUrl(task.generatedVideoUrl)
    ? task.generatedVideoUrl
    : undefined;
  const rawResultVideoUrl = !isSyntheticGeneratedVideoUrl(result?.videoUrl)
    ? result?.videoUrl
    : undefined;
  return resolveMediaUrl(rawGeneratedVideoUrl || rawResultVideoUrl);
}

function videoTaskViewState(task: VideoGenerationTask) {
  const result = taskVideoGenerationResult(task);
  const videoUrl = taskVideoUrl(task);
  const hasVideoUrl = Boolean(videoUrl);
  const isQueuedOrRunning = Boolean(
    !hasVideoUrl
    && (
      task.status === 'generating'
      || result?.status === 'running'
      || result?.status === 'pending'
      || result?.renderStatus === 'queued'
      || result?.renderStatus === 'rendering'
    ),
  );
  const isFailed = Boolean(
    !hasVideoUrl
    && (task.status === 'failed' || result?.status === 'failed' || result?.renderStatus === 'failed')
  );
  const isMissingResult = Boolean(!hasVideoUrl && task.status === 'success');

  if (hasVideoUrl) {
    return {
      label: '已完成',
      className: 'success',
      posterText: '成片已生成',
      note: '视频模型已返回真实成片地址。',
      videoUrl,
    };
  }
  if (isFailed) {
    return {
      label: '生成失败',
      className: 'failed',
      posterText: '生成失败',
      note: result?.errorMessage || task.failureReason || '视频模型未返回可用成片，请检查配置后重试。',
      videoUrl,
    };
  }
  if (isQueuedOrRunning) {
    const queued = result?.renderStatus === 'queued' || result?.status === 'pending';
    return {
      label: queued ? '已排队' : '生成中',
      className: 'running',
      posterText: queued ? '视频生成已排队' : '等待成片地址',
      note: result?.jobId
        ? `任务号：${result.jobId}。后端返回真实成片地址后会回写到任务记录。`
        : '后端返回真实成片地址后会回写到任务记录。',
      videoUrl,
    };
  }
  if (isMissingResult) {
    return {
      label: '等待成片',
      className: 'running',
      posterText: '后端尚未返回真实成片地址',
      note: '任务已进入完成态但没有可播放 URL，页面不会展示占位视频。请稍后刷新或重新提交生成。',
      videoUrl,
    };
  }
  return {
    label: '待处理',
    className: 'running',
    posterText: '等待生成任务推进',
    note: '任务尚未进入成片生成或后端还没有返回生成状态。',
    videoUrl,
  };
}

function resultError(task: VideoGenerationTask) {
  return task.failureReason || taskVideoGenerationResult(task)?.errorMessage || '';
}

function productionAssetId(task: VideoGenerationTask) {
  return taskVideoGenerationResult(task)?.assetId || '';
}

function selectedGroupId(assetIds: string[], assets: ContentAsset[]) {
  return assetIds.map((id) => assets.find((asset) => asset.id === id)?.groupId).find(Boolean) || '';
}

function isRealPersonResource(resourceType: unknown) {
  return String(resourceType || '') === 'real_person';
}

function isActiveRealPersonAsset(asset: ContentAsset) {
  return !isRealPersonResource(asset.resourceType) || String(asset.metadata?.volcStatus || '') === 'Active';
}

function isSelectableImageAsset(asset: ContentAsset) {
  return asset.mimeType.startsWith('image/') && isActiveRealPersonAsset(asset);
}

function hasInactiveRealPersonImage(assetIds: string[], assets: ContentAsset[]) {
  return assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .some((asset) => Boolean(asset && isRealPersonResource(asset.resourceType) && !isActiveRealPersonAsset(asset)));
}

function promptCountClassName(count: number) {
  if (count >= 4500) {
    return 'char-count danger';
  }
  if (count >= 4000) {
    return 'char-count warning';
  }
  return 'char-count';
}

function formatDurationOption(seconds: number) {
  return `${seconds}秒`;
}

function parseDurationOptionSeconds(value: string) {
  if (value === '智能时长') {
    return -1;
  }
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function videoModelValue(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

function parseVideoModelValue(value: string) {
  const [providerId = '', modelId = ''] = value.split('::');
  return { providerId, modelId };
}

function referenceBlockTitle(kind: PickerKind, policy: VideoModelReferencePolicy) {
  if (kind !== 'image') {
    return pickerConfig[kind].label;
  }
  if (policy.imageMode === 'first_frame_required') {
    return '首帧图片';
  }
  if (policy.imageMode === 'first_last_optional') {
    return '首尾帧图片';
  }
  return '参考图片';
}

function referenceBlockHint(kind: PickerKind, policy: VideoModelReferencePolicy) {
  if (kind === 'image') {
    if (policy.imageMode === 'first_frame_required') {
      return '当前模型要求上传 1 张首帧图片。';
    }
    if (policy.imageMode === 'first_last_optional') {
      return '可上传 1-2 张图片，分别作为首帧 / 尾帧。';
    }
    return '当前模型支持 1-9 张参考图，后端会按火山多模态参考接口传入。';
  }
  if (kind === 'video') {
    return '当前模型支持最多 3 个参考视频。';
  }
  return policy.audioRequiresVisualReference
    ? '当前模型支持最多 3 个参考音频，且至少要同时提供 1 个参考图片或参考视频。'
    : '当前模型支持最多 3 个参考音频。';
}

export function VideoCreatePage({ currentUser }: VideoCreatePageProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [quality, setQuality] = useState('标清 (720p)');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState('5秒');
  const [manualDurationSeconds, setManualDurationSeconds] = useState(5);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [records, setRecords] = useState<VideoGenerationTask[]>([]);
  const [groups, setGroups] = useState<ContentAssetGroup[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [videoProviders, setVideoProviders] = useState<VideoModelProviderOption[]>([]);
  const [videoConfigs, setVideoConfigs] = useState<ModelConfig[]>([]);
  const [selectedVideoModelValue, setSelectedVideoModelValue] = useState('');
  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([]);
  const [referenceVideoIds, setReferenceVideoIds] = useState<string[]>([]);
  const [referenceAudioIds, setReferenceAudioIds] = useState<string[]>([]);
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const loadRecords = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const list = await listVideoProductions(currentUser.id);
      setRecords(list.slice(0, 8));
    } catch (error) {
      if (!options?.silent) {
        message.error(error instanceof Error ? error.message : '生成记录加载失败');
      }
    }
  }, [currentUser.id]);

  const loadAssets = useCallback(async () => {
    try {
      const [groupList, assetList, providers, configs] = await Promise.all([
        listContentAssetGroups(currentUser.id),
        listContentAssets({ userId: currentUser.id }),
        listVideoModelProviders(),
        listModelConfigs('video'),
      ]);
      setGroups(groupList);
      setAssets(assetList);
      setVideoProviders(providers);
      setVideoConfigs(configs);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材加载失败');
    }
  }, [currentUser.id]);

  useEffect(() => {
    void loadRecords();
    void loadAssets();
  }, [loadRecords, loadAssets]);

  const hasActiveRecords = useMemo(
    () => records.some((record) => {
      const status = videoTaskViewState(record);
      return status.label === '已排队' || status.label === '生成中' || status.label === '等待成片';
    }),
    [records],
  );

  useEffect(() => {
    if (!hasActiveRecords) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadRecords({ silent: true });
    }, 8000);
    return () => window.clearInterval(timer);
  }, [hasActiveRecords, loadRecords]);

  const selectableVideoModels = useMemo<SelectableVideoModel[]>(() => {
    const configuredProviders = new Set(
      videoConfigs.filter((item) => item.apiKey).map((item) => item.provider),
    );
    const visibleProviders = videoProviders.filter((provider) => configuredProviders.has(provider.id));
    return visibleProviders.flatMap((provider) => provider.models.map((model) => ({
      provider,
      model,
      value: videoModelValue(provider.id, model.id),
    })));
  }, [videoConfigs, videoProviders]);

  const defaultVideoModelValue = useMemo(() => {
    const preferredModel = selectableVideoModels.find((item) => item.model.id === preferredVideoModelId);
    if (preferredModel) {
      return preferredModel.value;
    }
    const defaultConfig = videoConfigs.find((item) => item.isDefault && item.apiKey)
      || videoConfigs.find((item) => item.apiKey);
    if (!defaultConfig) {
      return selectableVideoModels[0]?.value || '';
    }
    return videoModelValue(defaultConfig.provider, defaultConfig.model);
  }, [selectableVideoModels, videoConfigs]);

  useEffect(() => {
    if (!selectedVideoModelValue && defaultVideoModelValue) {
      setSelectedVideoModelValue(defaultVideoModelValue);
    }
  }, [defaultVideoModelValue, selectedVideoModelValue]);

  const selectedVideoModel = useMemo(
    () => selectableVideoModels.find((item) => item.value === selectedVideoModelValue) || selectableVideoModels[0],
    [selectableVideoModels, selectedVideoModelValue],
  );
  const selectedReferencePolicy = selectedVideoModel?.model.referencePolicy;
  const selectedDurationPolicy = selectedVideoModel?.model.durationPolicy;
  const durationMode = duration === '智能时长' ? 'auto' : 'manual';

  useEffect(() => {
    if (!selectedReferencePolicy) {
      return;
    }
    setReferenceImageIds((current) => current.slice(0, selectedReferencePolicy.maxImages));
    setReferenceVideoIds((current) => current.slice(0, selectedReferencePolicy.maxVideos));
    setReferenceAudioIds((current) => current.slice(0, selectedReferencePolicy.maxAudios));
  }, [selectedReferencePolicy]);

  useEffect(() => {
    if (!selectedVideoModel) {
      return;
    }
    const selectedSeconds = parseDurationOptionSeconds(duration);
    const policy = selectedVideoModel.model.durationPolicy;
    const invalidAuto = selectedSeconds === -1 && !policy.supportsAuto;
    const invalidRange = typeof selectedSeconds === 'number'
      && selectedSeconds !== -1
      && (selectedSeconds < policy.minSeconds || selectedSeconds > policy.maxSeconds);
    if (invalidAuto || invalidRange || !duration) {
      setDuration(formatDurationOption(policy.defaultSeconds));
    }
  }, [duration, selectedVideoModel]);

  useEffect(() => {
    const durationSeconds = parseDurationOptionSeconds(duration);
    if (typeof durationSeconds === 'number' && durationSeconds > 0) {
      setManualDurationSeconds(durationSeconds);
    }
  }, [duration]);

  const displayedManualDurationSeconds = useMemo(() => {
    if (!selectedDurationPolicy) {
      return manualDurationSeconds;
    }
    return Math.min(
      selectedDurationPolicy.maxSeconds,
      Math.max(selectedDurationPolicy.minSeconds, manualDurationSeconds),
    );
  }, [manualDurationSeconds, selectedDurationPolicy]);

  const imageGroups = useMemo(
    () => groups.filter((group) => ['digital_human', 'scene', 'product'].includes(String(group.resourceType)) || isRealPersonResource(group.resourceType)),
    [groups],
  );
  const videoReferenceGroups = useMemo(
    () => groups.filter((group) => (
      group.resourceType === 'other'
      && group.metadata?.kind === 'video_create_reference_upload'
      && group.metadata?.referenceKind === 'video'
    )),
    [groups],
  );
  const audioGroups = useMemo(
    () => groups.filter((group) => group.resourceType === 'voice'),
    [groups],
  );
  const imageAssets = useMemo(
    () => assets.filter((asset) => imageGroups.some((group) => group.id === asset.groupId) && isSelectableImageAsset(asset)),
    [assets, imageGroups],
  );
  const videoAssets = useMemo(
    () => assets.filter((asset) => (
      videoReferenceGroups.some((group) => group.id === asset.groupId)
      && asset.mimeType.startsWith('video/')
      && asset.metadata?.kind === 'video_create_reference_upload'
      && asset.metadata?.referenceKind === 'video'
    )),
    [assets, videoReferenceGroups],
  );
  const audioAssets = useMemo(
    () => assets.filter((asset) => {
      const group = audioGroups.find((item) => item.id === asset.groupId);
      if (!group || !asset.mimeType.startsWith('audio/')) {
        return false;
      }
      const isClonePreview = asset.metadata?.kind === 'voice_clone_preview';
      const isLocalUpload = asset.metadata?.source === 'local_upload'
        || group.metadata?.source === 'local_upload'
        || (asset.metadata?.kind === 'video_create_reference_upload' && asset.metadata?.referenceKind === 'audio');
      return isClonePreview || isLocalUpload;
    }),
    [assets, audioGroups],
  );

  async function handleGenerate() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      message.warning('请输入视频制作提示词');
      return;
    }
    if (!selectedVideoModel) {
      message.warning('请先在模型配置页配置视频模型 API Key');
      return;
    }
    const { providerId, modelId } = parseVideoModelValue(selectedVideoModel.value);
    const policy = selectedVideoModel.model.referencePolicy;
    if (policy.imageMode === 'first_frame_required' && referenceImageIds.length < 1) {
      message.warning('当前模型至少需要 1 张首帧图片');
      return;
    }
    if (policy.allowAudio && policy.audioRequiresVisualReference && referenceAudioIds.length > 0 && referenceImageIds.length === 0 && referenceVideoIds.length === 0) {
      message.warning('参考音频需要搭配至少 1 个参考图片或参考视频');
      return;
    }
    if (hasInactiveRealPersonImage(referenceImageIds, assets)) {
      message.warning('真人素材仍在入库处理中');
      return;
    }
    try {
      setIsSubmitting(true);
      await createVideoProduction({
        userId: currentUser.id,
        prompt: trimmedPrompt,
        quality,
        ratio,
        duration,
        videoModelProviderId: providerId,
        videoModelId: modelId,
        referenceImageGroupId: selectedGroupId(referenceImageIds, assets),
        referenceVideoGroupId: selectedGroupId(referenceVideoIds, assets),
        referenceAudioGroupId: selectedGroupId(referenceAudioIds, assets),
        referenceImageIds,
        referenceVideoIds,
        referenceAudioIds,
      });
      await Promise.all([loadRecords(), loadAssets()]);
      message.success('视频生成任务已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频生成失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectedIdsFor(kind: PickerKind) {
    if (kind === 'image') {
      return referenceImageIds;
    }
    if (kind === 'video') {
      return referenceVideoIds;
    }
    return referenceAudioIds;
  }

  function assetsFor(kind: PickerKind) {
    if (kind === 'image') {
      return imageAssets;
    }
    if (kind === 'video') {
      return videoAssets;
    }
    return audioAssets;
  }

  function setSelectedIdsFor(kind: PickerKind, nextIds: string[]) {
    if (kind === 'image') {
      setReferenceImageIds(nextIds);
    } else if (kind === 'video') {
      setReferenceVideoIds(nextIds);
    } else {
      setReferenceAudioIds(nextIds);
    }
  }

  function toggleAsset(kind: PickerKind, assetId: string) {
    const selectedIds = selectedIdsFor(kind);
    if (selectedIds.includes(assetId)) {
      setSelectedIdsFor(kind, selectedIds.filter((id) => id !== assetId));
      return;
    }
    const asset = assets.find((item) => item.id === assetId);
    if (kind === 'image' && asset && !isSelectableImageAsset(asset)) {
      message.warning('真人素材仍在入库处理中');
      return;
    }
    const limit = kind === 'image'
      ? (selectedReferencePolicy?.maxImages || pickerConfig[kind].limit)
      : kind === 'video'
        ? (selectedReferencePolicy?.maxVideos || pickerConfig[kind].limit)
        : (selectedReferencePolicy?.maxAudios || pickerConfig[kind].limit);
    if (selectedIds.length >= limit) {
      message.warning(`${pickerConfig[kind].label}最多选择 ${limit} 个`);
      return;
    }
    setSelectedIdsFor(kind, [...selectedIds, assetId]);
  }

  function groupName(groupId: string) {
    return groups.find((group) => group.id === groupId)?.name || '未分组';
  }

  function referenceIdsFromMeta(meta: ReturnType<typeof taskMeta>, kind: PickerKind) {
    if (kind === 'image') {
      return meta.referenceImageIds.length ? meta.referenceImageIds : imageAssets.filter((asset) => asset.groupId === meta.referenceImageGroupId).map((asset) => asset.id);
    }
    if (kind === 'video') {
      return meta.referenceVideoIds.length ? meta.referenceVideoIds : videoAssets.filter((asset) => asset.groupId === meta.referenceVideoGroupId).map((asset) => asset.id);
    }
    return meta.referenceAudioIds.length ? meta.referenceAudioIds : audioAssets.filter((asset) => asset.groupId === meta.referenceAudioGroupId).map((asset) => asset.id);
  }

  function applyRecordToForm(record: VideoGenerationTask) {
    const meta = taskMeta(record);
    setPrompt(record.prompt || defaultPrompt);
    setQuality(qualityOptions.includes(meta.quality) ? meta.quality : '标清 (720p)');
    setRatio(ratioOptions.includes(meta.ratio) ? meta.ratio : '9:16');
    setDuration(meta.duration || '5秒');
    if (meta.videoModelProviderId && meta.videoModelId) {
      setSelectedVideoModelValue(videoModelValue(meta.videoModelProviderId, meta.videoModelId));
    }
    setReferenceImageIds(referenceIdsFromMeta(meta, 'image').slice(0, pickerConfig.image.limit));
    setReferenceVideoIds(referenceIdsFromMeta(meta, 'video').slice(0, pickerConfig.video.limit));
    setReferenceAudioIds(referenceIdsFromMeta(meta, 'audio').slice(0, pickerConfig.audio.limit));
    message.success('已回填任务参数，可调整后重新生成');
  }

  async function handleRegenerate(record: VideoGenerationTask) {
    const meta = taskMeta(record);
    const nextPrompt = (record.prompt || prompt).trim();
    if (!nextPrompt) {
      message.warning('该记录缺少提示词，无法重新生成');
      return;
    }
    if (hasInactiveRealPersonImage(meta.referenceImageIds, assets)) {
      message.warning('真人素材仍在入库处理中');
      return;
    }
    try {
      setIsSubmitting(true);
      await createVideoProduction({
        userId: currentUser.id,
        prompt: nextPrompt,
        quality: meta.quality,
        ratio: meta.ratio,
        duration: meta.duration,
        videoModelProviderId: meta.videoModelProviderId,
        videoModelId: meta.videoModelId,
        referenceImageGroupId: meta.referenceImageGroupId,
        referenceVideoGroupId: meta.referenceVideoGroupId,
        referenceAudioGroupId: meta.referenceAudioGroupId,
        referenceImageIds: meta.referenceImageIds,
        referenceVideoIds: meta.referenceVideoIds,
        referenceAudioIds: meta.referenceAudioIds,
      });
      await Promise.all([loadRecords(), loadAssets()]);
      message.success('已使用原参数重新提交生成');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新生成失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDeleteRecord(record: VideoGenerationTask) {
    Modal.confirm({
      title: '删除生成记录',
      content: '删除后会同时移除该任务关联的成片素材，确定继续？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        try {
          await deleteVideoTask(record.id);
          await Promise.all([loadRecords(), loadAssets()]);
          message.success('生成记录已删除');
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除生成记录失败');
        }
      },
    });
  }

  async function ensureUploadGroup(kind: PickerKind) {
    const config = pickerConfig[kind];
    const groups = await listContentAssetGroups(currentUser.id, config.resourceType);
    const existing = groups.find((group) => group.name === config.groupName);
    if (existing) {
      return existing;
    }
    return createContentAssetGroup({
      userId: currentUser.id,
      resourceType: config.resourceType,
      name: config.groupName,
      description: '视频制作页上传的参考素材',
      metadata: kind === 'audio'
        ? { kind: 'video_create_reference_upload', referenceKind: kind, source: 'local_upload' }
        : { kind: 'video_create_reference_upload', referenceKind: kind },
    });
  }

  async function handleUploadReference(files: FileList | null) {
    if (!pickerKind || !files?.length) {
      return;
    }
    const config = pickerConfig[pickerKind];
    const selectedIds = selectedIdsFor(pickerKind);
    const limit = pickerKind === 'image'
      ? (selectedReferencePolicy?.maxImages || config.limit)
      : pickerKind === 'video'
        ? (selectedReferencePolicy?.maxVideos || config.limit)
        : (selectedReferencePolicy?.maxAudios || config.limit);
    const availableSlots = limit - selectedIds.length;
    if (availableSlots <= 0) {
      message.warning(`${referenceBlockTitle(pickerKind, selectedReferencePolicy || {
        imageMode: 'reference_images',
        maxImages: config.limit,
        allowVideo: true,
        maxVideos: config.limit,
        allowAudio: true,
        maxAudios: config.limit,
      })}最多选择 ${limit} 个`);
      return;
    }
    let uploadFiles = Array.from(files).slice(0, availableSlots);
    if (pickerKind === 'audio') {
      try {
        const validated = await validateVoiceAudioFiles(uploadFiles);
        uploadFiles = validated.map((item) => item.file);
      } catch (error) {
        message.error(error instanceof Error ? error.message : '参考音频校验失败');
        if (uploadInputRef.current) {
          uploadInputRef.current.value = '';
        }
        return;
      }
    }
    try {
      setIsUploading(true);
      const group = await ensureUploadGroup(pickerKind);
      const uploadedAssets = await Promise.all(uploadFiles.map(async (file) => {
        const audioDuration = pickerKind === 'audio'
          ? (await validateVoiceAudioFiles([file]))[0]?.duration
          : undefined;
        return uploadContentAsset({
          file,
          userId: currentUser.id,
          groupId: group.id,
          resourceType: config.resourceType,
          name: file.name,
          description: `${config.title}上传`,
          metadata: pickerKind === 'audio'
            ? { kind: 'voice_source', referenceKind: pickerKind, source: 'local_upload', duration: audioDuration }
            : { kind: 'video_create_reference_upload', referenceKind: pickerKind },
        });
      }));
      await loadAssets();
      setSelectedIdsFor(pickerKind, [...selectedIds, ...uploadedAssets.map((asset) => asset.id)]);
      if (files.length > uploadFiles.length) {
        message.info(`已按上限上传并选中 ${uploadFiles.length} 个素材`);
      }
      message.success('参考素材已上传');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '参考素材上传失败');
    } finally {
      setIsUploading(false);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = '';
      }
    }
  }

  function renderReferenceBlock(kind: PickerKind) {
    const config = pickerConfig[kind];
    if (!selectedReferencePolicy) {
      return null;
    }
    if (kind === 'image' && selectedReferencePolicy.imageMode === 'none') {
      return null;
    }
    if (kind === 'video' && !selectedReferencePolicy.allowVideo) {
      return null;
    }
    if (kind === 'audio' && !selectedReferencePolicy.allowAudio) {
      return null;
    }
    const selectedIds = selectedIdsFor(kind);
    const selectedAssets = selectedIds
      .map((id) => assets.find((asset) => asset.id === id))
      .filter((asset): asset is ContentAsset => Boolean(asset));
    return (
      <div className="reference-block">
        <div>
          <span>{referenceBlockTitle(kind, selectedReferencePolicy)}</span>
          <small>
            {selectedIds.length}/
            {kind === 'image'
              ? selectedReferencePolicy.maxImages
              : kind === 'video'
                ? selectedReferencePolicy.maxVideos
                : selectedReferencePolicy.maxAudios}
          </small>
        </div>
        <button className="reference-picker-entry" onClick={() => setPickerKind(kind)} type="button">
          <span className="reference-picker-icon">{kind === 'image' ? '🖼️' : kind === 'video' ? '🎥' : '🎵'}</span>
          <span>
            <strong>{selectedIds.length ? `已选择 ${selectedIds.length} 个${referenceBlockTitle(kind, selectedReferencePolicy)}` : config.title}</strong>
            <small>{referenceBlockHint(kind, selectedReferencePolicy)}</small>
          </span>
        </button>
        {selectedAssets.length ? (
          <div className="reference-selected-strip">
            {selectedAssets.map((asset) => (
              <span key={asset.id} title={asset.name}>{asset.name}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderPickerModal() {
    if (!pickerKind) {
      return null;
    }
    const config = pickerConfig[pickerKind];
    const pickerAssets = assetsFor(pickerKind);
    const selectedIds = selectedIdsFor(pickerKind);
    return (
      <Modal
        centered
        footer={null}
        onCancel={() => setPickerKind(null)}
        open
        title={config.title}
        width={860}
      >
        <div className="reference-picker-modal">
          <div className="reference-picker-toolbar">
            <div>
              <strong>
                已选择 {selectedIds.length}/{
                  pickerKind === 'image'
                    ? (selectedReferencePolicy?.maxImages || config.limit)
                    : pickerKind === 'video'
                      ? (selectedReferencePolicy?.maxVideos || config.limit)
                      : (selectedReferencePolicy?.maxAudios || config.limit)
                } 个素材
              </strong>
              <span>{config.hint}</span>
            </div>
            <Button loading={isUploading} onClick={() => uploadInputRef.current?.click()} type="primary">
              上传自己的素材
            </Button>
            <input
              accept={config.accept}
              hidden
              multiple
              onChange={(event) => void handleUploadReference(event.target.files)}
              ref={uploadInputRef}
              type="file"
            />
          </div>
          <div className={pickerKind === 'audio' ? 'reference-audio-grid modal-grid' : 'reference-asset-grid modal-grid'}>
            {pickerAssets.map((asset) => {
              const active = selectedIds.includes(asset.id);
              if (pickerKind === 'audio') {
                const group = groups.find((item) => item.id === asset.groupId);
                return (
                  <article className={active ? 'reference-audio-card active' : 'reference-audio-card'} key={asset.id}>
                    <button className="reference-audio-select" onClick={() => toggleAsset(pickerKind, asset.id)} type="button">
                      <span className="reference-audio-mark">♪</span>
                      <span className="reference-audio-copy">
                        <strong title={asset.name}>{asset.name}</strong>
                        <small>{group?.name || '未分组音频'}</small>
                      </span>
                      <span className="reference-audio-badge">{audioSourceLabel(asset, group)}</span>
                    </button>
                    <audio controls onClick={(event) => event.stopPropagation()} src={assetUrl(asset)} />
                  </article>
                );
              }
              return (
                <button
                  className={active ? 'reference-asset-card active' : 'reference-asset-card'}
                  key={asset.id}
                  onClick={() => toggleAsset(pickerKind, asset.id)}
                  type="button"
                >
                  <span className="reference-asset-preview">
                    {pickerKind === 'image' ? <img alt={asset.name} src={assetUrl(asset)} /> : null}
                    {pickerKind === 'video' ? <video muted src={assetUrl(asset)} /> : null}
                  </span>
                  <strong>{asset.name}</strong>
                  <small>{groupName(asset.groupId)}</small>
                </button>
              );
            })}
            {!pickerAssets.length ? (
              <div className="reference-empty-state">
                <strong>{config.emptyText}</strong>
                <span>{pickerKind === 'audio' ? '可上传 wav/mp3，单段 2-15 秒，最多 3 段，总时长不超过 15 秒。' : '可以点击右上角上传自己的素材。'}</span>
              </div>
            ) : null}
          </div>
          <div className="reference-picker-footer">
            <Button onClick={() => setSelectedIdsFor(pickerKind, [])}>清空选择</Button>
            <Button onClick={() => setPickerKind(null)} type="primary">完成</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <ContentStudioLayout>
      <section className="create-page">
        <div className="video-settings-panel">
          <div className="create-container">
            <div className="create-card">
              <div className="create-card-title">基础设置</div>
              <div className="create-row">
                <span className="create-label">生成模型</span>
                <div className="model-select-wrap">
                  {selectableVideoModels.length ? (
                    <Select
                      className="model-select"
                      onChange={setSelectedVideoModelValue}
                      optionLabelProp="label"
                      options={selectableVideoModels.map((item) => ({
                        value: item.value,
                        label: item.model.name,
                        disabled: Boolean(item.model.disabled),
                        searchLabel: `${item.model.name} ${item.model.id} ${item.provider.name}`,
                      }))}
                      placeholder="请选择生成模型"
                      showSearch
                      value={selectedVideoModelValue || undefined}
                      filterOption={(input, option) => String(option?.searchLabel || '')
                        .toLowerCase()
                        .includes(input.toLowerCase())}
                    />
                  ) : (
                    <span className="model-subtext">请先到模型配置页填写视频模型 API Key</span>
                  )}
                </div>
              </div>
              {selectedVideoModel ? (
                <div className="model-subtext" style={{ marginBottom: 16 }}>
                  {selectedVideoModel.provider.name} · {selectedVideoModel.model.description} · {selectedVideoModel.model.id}
                </div>
              ) : null}
              <div className="create-row">
                <span className="create-label">画质选择</span>
                <div className="create-options">
                  {qualityOptions.map((item) => (
                    <button className={quality === item ? 'option-btn active' : 'option-btn'} key={item} onClick={() => setQuality(item)} type="button">{item}</button>
                  ))}
                </div>
              </div>
              <div className="create-row">
                <span className="create-label">视频比例</span>
                <div className="create-options">
                  {ratioOptions.map((item) => (
                    <button className={ratio === item ? 'option-btn active' : 'option-btn'} key={item} onClick={() => setRatio(item)} type="button">{item}</button>
                  ))}
                </div>
              </div>
              <div className="create-row">
                <span className="create-label">视频长度</span>
                <div className="duration-selector">
                  <Segmented
                    block
                    className="duration-mode-toggle"
                    onChange={(value) => {
                      if (value === 'auto') {
                        setDuration('智能时长');
                        return;
                      }
                      const fallbackSeconds = selectedDurationPolicy?.defaultSeconds || displayedManualDurationSeconds;
                      setDuration(formatDurationOption(displayedManualDurationSeconds || fallbackSeconds));
                    }}
                    options={[
                      { label: '按秒数', value: 'manual' },
                      {
                        label: '智能时长',
                        value: 'auto',
                        disabled: !selectedDurationPolicy?.supportsAuto,
                      },
                    ]}
                    value={durationMode}
                  />
                  {durationMode === 'manual' ? (
                    <div className="duration-slider-row">
                      <Slider
                        className="duration-slider"
                        max={selectedDurationPolicy?.maxSeconds || 15}
                        min={selectedDurationPolicy?.minSeconds || 4}
                        onChange={(value) => {
                          const nextValue = Array.isArray(value) ? value[0] : value;
                          setManualDurationSeconds(nextValue);
                          setDuration(formatDurationOption(nextValue));
                        }}
                        step={1}
                        value={displayedManualDurationSeconds}
                      />
                      <div className="duration-input-wrap">
                        <InputNumber
                          controls={false}
                          max={selectedDurationPolicy?.maxSeconds || 15}
                          min={selectedDurationPolicy?.minSeconds || 4}
                          onChange={(value) => {
                            if (typeof value !== 'number' || Number.isNaN(value)) {
                              return;
                            }
                            setManualDurationSeconds(value);
                            setDuration(formatDurationOption(value));
                          }}
                          precision={0}
                          value={displayedManualDurationSeconds}
                        />
                        <span>秒</span>
                      </div>
                    </div>
                  ) : (
                    <div className="duration-auto-tip">
                      由模型在可用范围内自动选择合适的视频时长。
                    </div>
                  )}
                </div>
              </div>
              {selectedVideoModel ? (
                <div className="model-subtext" style={{ marginTop: -4 }}>
                  时长范围：{selectedVideoModel.model.durationPolicy.minSeconds}-{selectedVideoModel.model.durationPolicy.maxSeconds} 秒
                  {selectedVideoModel.model.durationPolicy.supportsAuto ? '，支持智能时长' : ''}
                </div>
              ) : null}
            </div>

            <div className="create-card">
              <div className="create-card-title">参考素材</div>
              {renderReferenceBlock('image')}
              {renderReferenceBlock('video')}
              {renderReferenceBlock('audio')}
            </div>

            <div className="create-card">
              <div className="create-card-title">参考提示词</div>
              <div className="prompt-textarea-wrapper">
                <Input.TextArea className="prompt-textarea" maxLength={5000} onChange={(event) => setPrompt(event.target.value)} value={prompt} />
                <div className={promptCountClassName(prompt.length)}>{prompt.length}/5000</div>
              </div>
              
            </div>

            <Button block className="generate-btn" loading={isSubmitting} onClick={handleGenerate} type="primary">🎬 生成视频</Button>
          </div>
        </div>

        <div className="video-result-list">
          <div className="result-list-header">
            <span className="result-list-title">生成记录</span>
          </div>
          {records.length === 0 ? (
            <div className="video-result-empty">暂无生成记录</div>
          ) : records.map((record) => {
            const meta = taskMeta(record);
            const status = videoTaskViewState(record);
            const videoUrl = status.videoUrl;
            const errorMessage = resultError(record);
            const assetId = productionAssetId(record);
            return (
              <div className="video-result-card" key={record.id}>
                <div className="card-header">
                  <span className="card-time">{formatDate(record.createdAt)}</span>
                  <span className={`card-status ${status.className}`}>{status.label}</span>
                </div>
                <div className="card-params">
                  <span className="param-tag">ID: {record.id.slice(0, 5)}</span>
                  <span className="param-tag">{meta.ratio}</span>
                  <span className="param-tag">{meta.duration}</span>
                  <span className="param-tag">{meta.quality}</span>
                  <span className="param-tag">有声</span>
                </div>
                <div className="card-content-row">
                  <div className={`card-preview ratio-${meta.ratio.replace(':', '-')}`}>
                    {videoUrl ? <video controls src={videoUrl} /> : (
                      <div className="video-poster">
                        <span>🎬</span>
                        <small>{status.posterText}</small>
                      </div>
                    )}
                  </div>
                </div>
                {status.note ? <div className={status.className === 'failed' ? 'video-record-note failed' : 'video-record-note'}>{status.note}</div> : null}
                {errorMessage && errorMessage !== status.note ? <div className="video-record-note failed">{errorMessage}</div> : null}
                {assetId ? <div className="video-record-note">已入库成片素材：{assetId.slice(0, 8)}</div> : null}
                <div className="card-actions-row">
                  <button className="action-text-btn" onClick={() => applyRecordToForm(record)} type="button">重新编辑</button>
                  <button className="action-text-btn" onClick={() => void handleRegenerate(record)} type="button">重新生成</button>
                  <button className="action-text-btn" disabled={!videoUrl} onClick={() => window.open(videoUrl, '_blank', 'noreferrer')} type="button">打开</button>
                  <a className={videoUrl ? 'action-text-btn' : 'action-text-btn disabled'} href={videoUrl || undefined} download>下载</a>
                  <button className="action-text-btn delete" onClick={() => handleDeleteRecord(record)} type="button">删除</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {renderPickerModal()}
    </ContentStudioLayout>
  );
}
