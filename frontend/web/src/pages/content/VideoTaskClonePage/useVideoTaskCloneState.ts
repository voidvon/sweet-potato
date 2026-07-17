import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { message } from 'antd';
import { getSiteConfig } from '../../../api/billing';
import { createContentAssetGroup, createMarketingVideoStoryboard, createSubtitleRemoval, createVideoEnhancement, createVideoProduction, createVideoTranslation, deleteMarketingVideoStoryboard, deleteVideoTask, generateVideoFromMarketingStoryboard, getContentAsset, listContentAssetGroups, listContentAssets, listMarketingVideoStoryboards, listVideoProductionsPage, retryMarketingVideoStoryboard, uploadContentAsset } from '../../../api/content';
import type { PlanningApplyPayload } from '../../../api/content-planning';
import { resolveAssetUrl } from '../../../api/request';
import { createDanceRemake, resolveVideoSource as requestVideoSourceResolve } from '../../../api/video-source';
import type { ContentAsset, ContentAssetResourceType, MarketingVideoStoryboard, SiteConfig, User, VideoGenerationResult, VideoGenerationTask } from '../../../types';
import {
  defaultFilters,
  examplePrompt,
  modelOptionIds,
  toolOptions,
} from './constants';
import type {
  DanceRemakeMode,
  FilterValues,
  MarketingVideoConfig,
  MaterialKey,
  MaterialKind,
  MaterialMode,
  ParamKind,
  PromptPanel,
  LocalMaterialFile,
  SelectedMaterials,
  SelectedMaterialValue,
  SubtitleRemovalConfig,
  ToolOption,
  UploadAnchor,
  VideoTranslationConfig,
  WorksTab,
} from './types';
import { MAX_REFERENCE_VIDEO_DURATION_SECONDS, readVideoDuration, readVideoUrlDuration, shouldTrimReferenceVideo } from './videoMetadata';
import { planningApplyPayloadToFormState } from './planningHelpers';

const defaultSubtitleRemovalConfig: SubtitleRemovalConfig = {
  mode: 'auto',
  contentType: 'subtitle',
  locations: [],
  clipFilter: { mode: 'all', clips: [] },
};

const defaultVideoTranslationConfig: VideoTranslationConfig = {
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  modes: { subtitle: true, voice: false, face: false },
  subtitleSource: 'ocr',
  hardSubtitles: true,
  eraseOriginalSubtitles: false,
  subtitlePlacementConfig: {
    mode: 'manual',
    contentType: 'subtitle',
    locations: [{
      topLeftX: 0.1,
      topLeftY: 0.85,
      bottomRightX: 0.9,
      bottomRightY: 0.95,
    }],
    clipFilter: { mode: 'all', clips: [] },
  },
  fontSize: 24,
  showLines: 2,
};

const defaultMarketingVideoConfig: MarketingVideoConfig = {
  productCategory: '',
  productName: '',
  sellingPoints: '',
};

const marketingVideoDuration = '15s';

const videoProductionsPageSize = 20;

function createdAtRangeFromTimeFilter(filter: string) {
  const value = String(filter || '').trim();
  if (!value || value === '全部时间') {
    return {};
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (value === '今天') {
    return {
      createdAtFrom: todayStart.toISOString(),
      createdAtTo: tomorrowStart.toISOString(),
    };
  }

  if (value === '近 7 天') {
    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 6);
    return {
      createdAtFrom: rangeStart.toISOString(),
      createdAtTo: tomorrowStart.toISOString(),
    };
  }

  if (value === '近 30 天') {
    const rangeStart = new Date(todayStart);
    rangeStart.setDate(rangeStart.getDate() - 29);
    return {
      createdAtFrom: rangeStart.toISOString(),
      createdAtTo: tomorrowStart.toISOString(),
    };
  }

  return {};
}

export function useVideoTaskCloneState(currentUser: User, initialTool: ToolOption = toolOptions[0]) {
  const uploadGroupIdsRef = useRef<Partial<Record<ContentAssetResourceType, string>>>({});
  const retrySubmittingRef = useRef(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [danceRemakeMode, setDanceRemakeMode] = useState<DanceRemakeMode>('enhanced');
  const [prompt, setPrompt] = useState('');
  const [tool, setTool] = useState<ToolOption>(initialTool);
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [materialMode, setMaterialMode] = useState<MaterialMode>(null);
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedMaterials>({});
  const [activeUpload, setActiveUpload] = useState<MaterialKind | null>(null);
  const [uploadAnchor, setUploadAnchor] = useState<UploadAnchor | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [selectedModelAvatar, setSelectedModelAvatar] = useState('');
  const [promptPanel, setPromptPanel] = useState<PromptPanel | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [model, setModel] = useState(initialTool.key === 'dance-remake' ? 'Seedance 2.0 Mini' : 'Seedance 2.0');
  const [ratio, setRatio] = useState('9:16');
  const [quality, setQuality] = useState(initialTool.key === 'dance-remake' ? '480P' : '720P');
  const [duration, setDuration] = useState('5s');
  const [activeParam, setActiveParam] = useState<ParamKind | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(defaultFilters);
  const [voiceAssets, setVoiceAssets] = useState<ContentAsset[]>([]);
  const [voiceGroupNameById, setVoiceGroupNameById] = useState<Record<string, string>>({});
  const [worksAssets, setWorksAssets] = useState<ContentAsset[]>([]);
  const [worksTab, setWorksTab] = useState<WorksTab>('all');
  const [isLoadingLibraryAssets, setIsLoadingLibraryAssets] = useState(false);
  const [videoProductions, setVideoProductions] = useState<VideoGenerationTask[]>([]);
  const [isLoadingProductions, setIsLoadingProductions] = useState(false);
  const [isLoadingMoreProductions, setIsLoadingMoreProductions] = useState(false);
  const [hasMoreVideoProductions, setHasMoreVideoProductions] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [retryingTaskId, setRetryingTaskId] = useState('');
  const [deletingTaskId, setDeletingTaskId] = useState('');
  const [marketingVideoConfig, setMarketingVideoConfig] = useState<MarketingVideoConfig>(defaultMarketingVideoConfig);
  const [marketingStoryboards, setMarketingStoryboards] = useState<MarketingVideoStoryboard[]>([]);
  const [selectedMarketingStoryboardId, setSelectedMarketingStoryboardId] = useState('');
  const [isLoadingMarketingStoryboards, setIsLoadingMarketingStoryboards] = useState(false);
  const [retryingMarketingStoryboardId, setRetryingMarketingStoryboardId] = useState('');
  const [generatingMarketingVideoId, setGeneratingMarketingVideoId] = useState('');
  const [deletingMarketingStoryboardId, setDeletingMarketingStoryboardId] = useState('');
  const [subtitleRemovalConfig, setSubtitleRemovalConfig] = useState<SubtitleRemovalConfig>(defaultSubtitleRemovalConfig);
  const [videoTranslationConfig, setVideoTranslationConfig] = useState<VideoTranslationConfig>(defaultVideoTranslationConfig);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const loadedProductionCountRef = useRef(0);
  const loadedProductionPageRef = useRef(0);
  const isLoadingMoreProductionsRef = useRef(false);
  const productionRequestVersionRef = useRef(0);

  useEffect(() => {
    let ignore = false;
    void getSiteConfig()
      .then((config) => {
        if (!ignore) {
          setSiteConfig(config);
        }
      })
      .catch((error) => {
        if (!ignore) {
          setSiteConfig(null);
          message.error(error instanceof Error ? error.message : '站点价格配置加载失败');
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  const loadMarketingStoryboards = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingMarketingStoryboards(true);
    try {
      const tasks = await listMarketingVideoStoryboards();
      setMarketingStoryboards(tasks);
      return tasks;
    } catch (error) {
      if (!silent) {
        message.error(error instanceof Error ? error.message : '分镜历史加载失败');
      }
      return [];
    } finally {
      if (!silent) setIsLoadingMarketingStoryboards(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketingStoryboards();
  }, [currentUser.id, loadMarketingStoryboards]);

  const hasGeneratingMarketingStoryboard = useMemo(
    () => marketingStoryboards.some((task) => (
      task.status === 'generating'
      || task.videoStatus === 'pending'
      || task.videoStatus === 'parsing'
      || task.videoStatus === 'waiting_edit'
      || task.videoStatus === 'generating'
    )),
    [marketingStoryboards],
  );

  useEffect(() => {
    if (!hasGeneratingMarketingStoryboard) return undefined;
    const timer = window.setInterval(() => {
      void loadMarketingStoryboards(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasGeneratingMarketingStoryboard, loadMarketingStoryboards]);

  const loadLibraryAssets = useCallback(async () => {
    setIsLoadingLibraryAssets(true);
    try {
      const [voiceGroups, voiceList, finishedVideoList] = await Promise.all([
        listContentAssetGroups(currentUser.id, 'voice'),
        listContentAssets({ userId: currentUser.id, resourceType: 'voice' }),
        listContentAssets({ userId: currentUser.id, resourceType: 'finished_video' }),
      ]);
      setVoiceGroupNameById(Object.fromEntries(voiceGroups.map((group) => [group.id, group.name])));
      setVoiceAssets(voiceList.filter(isAllowedAudioAsset));
      setWorksAssets(finishedVideoList.filter((asset) => (
        asset.mimeType.startsWith('image/')
        || (asset.mimeType.startsWith('video/') && isCompletedFinishedVideo(asset))
      )));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '素材库加载失败');
    } finally {
      setIsLoadingLibraryAssets(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    void loadLibraryAssets();
  }, [loadLibraryAssets]);

  const loadVideoProductions = useCallback(async (silent = false) => {
    const requestVersion = productionRequestVersionRef.current + 1;
    productionRequestVersionRef.current = requestVersion;
    if (!silent) {
      setIsLoadingProductions(true);
      setVideoProductions([]);
      setHasMoreVideoProductions(false);
      loadedProductionCountRef.current = 0;
      loadedProductionPageRef.current = 0;
    }
    try {
      const pageSize = silent
        ? Math.max(
          videoProductionsPageSize,
          Math.ceil(loadedProductionCountRef.current / videoProductionsPageSize) * videoProductionsPageSize,
        )
        : videoProductionsPageSize;
      const createdAtRange = createdAtRangeFromTimeFilter(filters.时间);
      const result = await listVideoProductionsPage(currentUser.id, {
        ...createdAtRange,
        page: 1,
        pageSize,
        ratio: filters.比例,
        status: filters.状态,
      });
      if (requestVersion !== productionRequestVersionRef.current) {
        return [];
      }
      setVideoProductions(result.items);
      loadedProductionCountRef.current = result.items.length;
      loadedProductionPageRef.current = Math.ceil(result.items.length / videoProductionsPageSize);
      setHasMoreVideoProductions(result.items.length < result.total);
      return result.items;
    } catch (error) {
      if (!silent && requestVersion === productionRequestVersionRef.current) {
        message.error(error instanceof Error ? error.message : '生成记录加载失败');
      }
      return [];
    } finally {
      if (!silent && requestVersion === productionRequestVersionRef.current) {
        setIsLoadingProductions(false);
      }
    }
  }, [currentUser.id, filters]);

  const loadMoreVideoProductions = useCallback(async () => {
    if (isLoadingMoreProductionsRef.current || !hasMoreVideoProductions) {
      return;
    }
    isLoadingMoreProductionsRef.current = true;
    setIsLoadingMoreProductions(true);
    const requestVersion = productionRequestVersionRef.current;
    const page = loadedProductionPageRef.current + 1;
    try {
      const createdAtRange = createdAtRangeFromTimeFilter(filters.时间);
      const result = await listVideoProductionsPage(currentUser.id, {
        ...createdAtRange,
        page,
        pageSize: videoProductionsPageSize,
        ratio: filters.比例,
        status: filters.状态,
      });
      if (requestVersion !== productionRequestVersionRef.current) {
        return;
      }
      loadedProductionPageRef.current = page;
      setHasMoreVideoProductions(page * videoProductionsPageSize < result.total);
      setVideoProductions((current) => {
        const knownIds = new Set(current.map((task) => task.id));
        const next = [...current, ...result.items.filter((task) => !knownIds.has(task.id))];
        loadedProductionCountRef.current = next.length;
        return next;
      });
    } catch (error) {
      if (requestVersion === productionRequestVersionRef.current) {
        message.error(error instanceof Error ? error.message : '更多生成记录加载失败');
      }
    } finally {
      isLoadingMoreProductionsRef.current = false;
      setIsLoadingMoreProductions(false);
    }
  }, [currentUser.id, filters, hasMoreVideoProductions]);

  useEffect(() => {
    void loadVideoProductions();
  }, [loadVideoProductions]);

  const hasRunningProduction = useMemo(
    () => videoProductions.some(isRunningVideoProduction),
    [videoProductions],
  );

  useEffect(() => {
    if (!hasRunningProduction) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadVideoProductions(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [hasRunningProduction, loadVideoProductions]);

  const canGenerate = useMemo(
    () => (
      tool.materials.every((material) => getSelectedMaterialCount(material, selectedMaterials[material.key]) >= (material.minCount ?? 0))
      && (prompt.trim().length > 0 || Object.keys(selectedMaterials).length > 0)
      && !hasVideoRequiringTrim(selectedMaterials)
      && (tool.key !== 'marketing-video'
        || (marketingVideoConfig.productName.trim().length > 0
          && marketingVideoConfig.productCategory.trim().length > 0
          && marketingVideoConfig.sellingPoints.trim().length > 0))
      && (tool.workspace.generate.handler !== 'subtitle-removal'
        || subtitleRemovalConfig.mode === 'auto'
        || subtitleRemovalConfig.locations.length > 0)
      && (tool.workspace.generate.handler !== 'video-translation'
        || (videoTranslationConfig.sourceLanguage !== videoTranslationConfig.targetLanguage
          && (!videoTranslationConfig.hardSubtitles
            || videoTranslationConfig.subtitlePlacementConfig.locations.length > 0)))
    ),
    [marketingVideoConfig, prompt, selectedMaterials, subtitleRemovalConfig, tool.key, tool.materials, tool.workspace.generate.handler, videoTranslationConfig],
  );
  const hasSelectedAudio = Boolean(selectedMaterials.audio);
  const selectedVideoDuration = getLocalFiles(selectedMaterials.video)[0]?.trimDuration;

  const videoPriceLabel = useMemo(() => {
    const billing = siteConfig?.billing;
    if (!billing) {
      return '';
    }
    if (tool.workspace.generate.handler === 'video-upscale') {
      return formatCreditAmount(billing.videoUpscaleCreditsPerRequest);
    }
    if (tool.key === 'marketing-video') {
      return formatCreditAmount(billing.marketingVideoCreditsPerRequest);
    }
    if (!selectedVideoDuration || !Number.isFinite(selectedVideoDuration)) {
      return '';
    }
    const billedVideoSeconds = Math.ceil(selectedVideoDuration);
    if (tool.workspace.generate.handler === 'subtitle-removal') {
      return formatCreditAmount(
        billedVideoSeconds * billing.subtitleRemovalCreditsPerSecond,
      );
    }
    if (tool.workspace.generate.handler === 'video-translation') {
      const creditsPerSecond = (videoTranslationConfig.modes.subtitle
        ? billing.videoTranslationSubtitleCreditsPerSecond
        : 0)
        + (videoTranslationConfig.modes.voice ? billing.videoTranslationVoiceCreditsPerSecond : 0)
        + (videoTranslationConfig.modes.face ? billing.videoTranslationFaceCreditsPerSecond : 0)
        + (videoTranslationConfig.eraseOriginalSubtitles
          ? billing.videoTranslationEraseSourceCreditsPerSecond
          : 0);
      return formatCreditAmount(billedVideoSeconds * creditsPerSecond);
    }
    return '';
  }, [selectedVideoDuration, siteConfig, tool.key, tool.workspace.generate.handler, videoTranslationConfig]);

  const marketingVideoGenerationPriceLabel = useMemo(() => {
    const billing = siteConfig?.billing;
    const durationSeconds = Number.parseFloat(marketingVideoDuration);
    if (!billing || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return '';
    }
    const is480p = quality === '480P';
    const creditsPerSecond = model === 'Seedance 2.0 Fast'
      ? (is480p ? billing.seedance2FastCreditsPerSecond480p : billing.seedance2FastCreditsPerSecond720p)
      : model === 'Seedance 2.0 Mini'
        ? (is480p ? billing.seedance2MiniCreditsPerSecond480p : billing.seedance2MiniCreditsPerSecond720p)
        : (is480p ? billing.seedance2CreditsPerSecond480p : billing.seedance2CreditsPerSecond720p);
    return formatCreditAmount(Number((durationSeconds * creditsPerSecond).toFixed(6)));
  }, [model, quality, siteConfig]);

  useEffect(() => {
    if (hasSelectedAudio) {
      setVoiceEnabled(true);
    }
  }, [hasSelectedAudio]);

  const canvas = `${ratio} · ${quality}`;
  const paramSummary = `${model} · ${canvas} · ${duration}`;
  const hasCreationFormContent = Boolean(
    prompt.trim()
    || Object.values(selectedMaterials).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    || model !== 'Seedance 2.0'
    || ratio !== '9:16'
    || quality !== '720P'
    || duration !== '5s'
    || !voiceEnabled
    || marketingVideoConfig.productName.trim()
    || marketingVideoConfig.productCategory.trim()
    || marketingVideoConfig.sellingPoints.trim()
  );

  const chooseTool = useCallback((option: ToolOption) => {
    setTool(option);
    setShowToolMenu(false);
    setMaterialMode(null);
    setSelectedMaterials((current) => {
      Object.values(current).forEach((value) => revokeLocalMaterials(getLocalFiles(value)));
      return {};
    });
    setActiveUpload(null);
    setUploadAnchor(null);
    setActiveParam(null);
    setPromptPanel(null);
    setFilterOpen(false);
    setMarketingVideoConfig(defaultMarketingVideoConfig);
    setSubtitleRemovalConfig(defaultSubtitleRemovalConfig);
    setVideoTranslationConfig(defaultVideoTranslationConfig);
    setDanceRemakeMode('enhanced');
    setModel(option.key === 'dance-remake' ? 'Seedance 2.0 Mini' : 'Seedance 2.0');
    setQuality(option.key === 'dance-remake' ? '480P' : '720P');
  }, []);

  const chooseMaterialTab = (mode: MaterialMode) => {
    setMaterialMode(mode);
    if (mode === 'works') {
      setWorksTab('all');
    }
    setActiveUpload(null);
    setUploadAnchor(null);
    setActiveParam(null);
    setPromptPanel(null);
    setFilterOpen(false);
  };

  const openModelPicker = () => {
    setShowModelPicker(true);
    setMaterialMode(null);
    setActiveUpload(null);
    setUploadAnchor(null);
    setActiveParam(null);
    setPromptPanel(null);
    setFilterOpen(false);
  };

  const closeMaterialPopovers = () => {
    setMaterialMode(null);
    setActiveUpload(null);
    setUploadAnchor(null);
  };

  const fillMaterial = (kind: MaterialKind, value: string) => {
    setSelectedMaterials((current) => {
      if (kind.key === 'image' && current.image) {
        return { ...current, image: `参考图 ${Math.min(getImageCount(current.image) + 1, getLimit(kind))} 张` };
      }

      if (kind.key === 'audio' && current.audio) {
        return { ...current, audio: `参考音频 ${Math.min(getAudioCount(current.audio) + 1, getLimit(kind))} 个` };
      }

      return { ...current, [kind.key]: value };
    });
    setActiveUpload(null);
    setUploadAnchor(null);
  };

  const fillMaterialFiles = async (kind: MaterialKind, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    const translationFiles = tool.key === 'video-translation' && kind.key === 'video'
      ? incomingFiles.filter(isMp4VideoFile)
      : incomingFiles;
    if (translationFiles.length < incomingFiles.length) {
      message.warning('视频翻译仅支持 MP4 格式');
    }
    const allowedFiles = kind.key === 'audio'
      ? translationFiles.filter(isAllowedAudioFile)
      : translationFiles;
    if (kind.key === 'audio' && allowedFiles.length < translationFiles.length) {
      message.warning('参考音频仅支持 MP3 或 WAV 格式');
    }
    const selectedFiles = allowedFiles.slice(0, getRemainingCapacity(kind, selectedMaterials[kind.key]));
    if (selectedFiles.length === 0) return;

    const inspectedFiles = await Promise.all(selectedFiles.map(async (file) => ({
      audioDuration: kind.key === 'audio' ? await readAudioDuration(file) : undefined,
      file,
      id: `${kind.key}-${crypto.randomUUID()}`,
      name: file.name,
      trimDuration: kind.key === 'video' ? await readVideoDuration(file) : undefined,
      type: kind.key,
      url: URL.createObjectURL(file),
    }))) satisfies LocalMaterialFile[];
    const localFiles = inspectedFiles;

    setSelectedMaterials((current) => {
      const currentFiles = getLocalFiles(current[kind.key]);
      const acceptedFiles = kind.key === 'audio'
        ? fitAudioFilesWithinLimit(currentFiles, localFiles)
        : localFiles;
      if (kind.key === 'audio' && acceptedFiles.length < localFiles.length) {
        const acceptedFileIds = new Set(acceptedFiles.map((file) => file.id));
        revokeLocalMaterials(localFiles.filter((file) => !acceptedFileIds.has(file.id)));
        message.warning('参考音频总时长不能超过 15 秒');
      }
      if (acceptedFiles.length === 0) {
        return current;
      }
      const nextFiles = kind.key === 'video'
        ? acceptedFiles.slice(0, 1)
        : [...currentFiles, ...acceptedFiles].slice(0, getLimit(kind));

      if (kind.key === 'video') {
        revokeLocalMaterials(currentFiles);
      }

      return { ...current, [kind.key]: nextFiles };
    });
    setActiveUpload(null);
    setUploadAnchor(null);
    setMaterialMode(null);
  };

  const fillMentionPlaceholderFiles = (kind: MaterialKey, files: File[]) => {
    const material = tool.materials.find((item) => item.key === kind);
    if (!material) {
      message.warning(`当前功能不支持${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}素材`);
      return;
    }
    void fillMaterialFiles(material, files);
  };

  const clearMaterial = (kind: MaterialKind) => {
    setSelectedMaterials((current) => {
      const next = { ...current };
      revokeLocalMaterials(getLocalFiles(next[kind.key]));
      delete next[kind.key];
      return next;
    });
  };

  const removeOneMaterial = (kind: MaterialKind, materialId?: string) => {
    if (getLocalFiles(selectedMaterials[kind.key]).length > 0) {
      setSelectedMaterials((current) => {
        const currentFiles = getLocalFiles(current[kind.key]);
        const materialIndex = materialId
          ? currentFiles.findIndex((file) => file.id === materialId)
          : currentFiles.length - 1;
        const removedIndex = materialIndex >= 0 ? materialIndex : currentFiles.length - 1;
        revokeLocalMaterials(currentFiles.slice(removedIndex, removedIndex + 1));
        const nextFiles = currentFiles.filter((_, index) => index !== removedIndex);
        if (nextFiles.length === 0) {
          const next = { ...current };
          delete next[kind.key];
          return next;
        }
        return { ...current, [kind.key]: nextFiles };
      });
      return;
    }

    if (kind.key === 'image') {
      setSelectedMaterials((current) => {
        const count = getImageCount(current.image);
        if (count <= 1) {
          const next = { ...current };
          delete next.image;
          return next;
        }
        return { ...current, image: `参考图 ${count - 1} 张` };
      });
      return;
    }

    if (kind.key === 'audio') {
      setSelectedMaterials((current) => {
        const count = getAudioCount(current.audio);
        if (count <= 1) {
          const next = { ...current };
          delete next.audio;
          return next;
        }
        return { ...current, audio: `参考音频 ${count - 1} 个` };
      });
      return;
    }

    clearMaterial(kind);
  };

  const clearAllMaterials = () => {
    setSelectedMaterials((current) => {
      Object.values(current).forEach((value) => revokeLocalMaterials(getLocalFiles(value)));
      return {};
    });
    setActiveUpload(null);
    setUploadAnchor(null);
    setMaterialMode(null);
  };

  const replaceMaterialFiles = (kind: MaterialKind, files: LocalMaterialFile[]) => {
    setSelectedMaterials((current) => {
      const currentFiles = getLocalFiles(current[kind.key]);
      revokeLocalMaterials(currentFiles);
      return { ...current, [kind.key]: files };
    });
  };

  const chooseAudio = (name: string) => {
    setSelectedMaterials((current) => {
      if (current.audio) {
        return { ...current, audio: `参考音频 ${Math.min(getAudioCount(current.audio) + 1, 3)} 个` };
      }
      return { ...current, audio: name };
    });
    setMaterialMode(null);
  };

  const chooseLibraryAsset = async (kind: MaterialKind, asset: ContentAsset) => {
    if (kind.key === 'audio' && !isAllowedAudioAsset(asset)) {
      message.warning('参考音频仅支持 MP3 或 WAV 格式');
      return;
    }
    const url = resolveAssetUrl(asset.fileUrl);
    const videoDuration = kind.key === 'video'
      ? getAssetDurationSeconds(asset) ?? await readVideoUrlDuration(url)
      : undefined;
    let trimFile: File | undefined;
    if (kind.key === 'video' && shouldTrimReferenceVideo(videoDuration)) {
      try {
        trimFile = await downloadAssetAsFile(asset, getAssetTrimSourceUrl(asset, url));
      } catch (error) {
        message.error(error instanceof Error ? error.message : '作品视频读取失败，请重试');
        return;
      }
    }
    const localMaterial = {
      assetId: asset.id,
      audioDuration: kind.key === 'audio' ? getAssetDurationSeconds(asset) : undefined,
      file: trimFile,
      id: `${kind.key}-${asset.id}-${crypto.randomUUID()}`,
      name: asset.name || asset.originalFileName || asset.storedFileName || kind.label,
      trimDuration: videoDuration,
      type: kind.key,
      url,
    } satisfies LocalMaterialFile;

    setSelectedMaterials((current) => {
      const currentFiles = getLocalFiles(current[kind.key]);
      if (kind.key === 'audio' && getAudioDurationTotal([...currentFiles, localMaterial]) > 15) {
        message.warning('参考音频总时长不能超过 15 秒');
        return current;
      }
      const nextFiles = kind.key === 'video'
        ? [localMaterial]
        : [...currentFiles, localMaterial].slice(0, getLimit(kind));
      if (nextFiles.length === 0) return current;
      return { ...current, [kind.key]: nextFiles };
    });
    setMaterialMode(null);
  };

  const resolveVideoSource = async (input: string) => {
    const messageKey = 'video-source-resolve';
    message.loading({ content: '正在解析视频链接', duration: 0, key: messageKey });
    try {
      const { source } = await requestVideoSourceResolve(input);
      const localMaterial = {
        id: `video-${source.platform}-${source.externalId}-${crypto.randomUUID()}`,
        mediaDuration: source.durationMs > 0 ? source.durationMs / 1000 : undefined,
        name: source.title || `${source.platform} 参考视频`,
        remoteMetadata: source as unknown as Record<string, unknown>,
        remoteSourceUrl: source.sourceUrl,
        serverFileUrl: source.downloadUrl,
        type: 'video',
        url: resolveAssetUrl(source.previewUrl),
      } satisfies LocalMaterialFile;
      setSelectedMaterials((current) => {
        revokeLocalMaterials(getLocalFiles(current.video));
        return { ...current, video: [localMaterial] };
      });
      message.success({ content: '视频链接解析完成', key: messageKey });
      return true;
    } catch (error) {
      message.error({
        content: error instanceof Error ? error.message : '视频链接解析失败',
        key: messageKey,
      });
      return false;
    }
  };

  const chooseModelAsset = (asset: ContentAsset) => {
    const imageMaterial = tool.materials.find((item) => item.key === 'image');
    if (!imageMaterial) return;

    chooseLibraryAsset(imageMaterial, asset);
    setSelectedModelAvatar(asset.id);
    setShowModelPicker(false);
  };

  const chooseModelAvatar = (name: string) => {
    setSelectedModelAvatar(name);
    setSelectedMaterials((current) => {
      revokeLocalMaterials(getLocalFiles(current.image));
      return { ...current, image: name };
    });
    setShowModelPicker(false);
    setMaterialMode(null);
  };

  const chooseParam = (kind: ParamKind, value: string) => {
    if (kind === 'model') setModel(value);
    if (kind === 'duration') setDuration(value);
    setActiveParam(null);
  };

  const chooseCanvasRatio = (value: string) => {
    setRatio(value);
  };

  const chooseCanvasQuality = (value: string) => {
    setQuality(value);
  };

  const fillExamplePrompt = () => {
    setPrompt(examplePrompt);
    setPromptPanel(null);
  };

  const clearFilters = () => {
    setFilters(defaultFilters);
  };

  const applyPlanningResult = useCallback((payload: PlanningApplyPayload) => {
    const next = planningApplyPayloadToFormState(payload);
    setPrompt(next.prompt);
    setDuration(next.duration);
    setSelectedMaterials((current) => {
      Object.values(current).forEach((value) => revokeLocalMaterials(getLocalFiles(value)));
      return {
        image: next.imageMaterials,
        ...(next.audioMaterials.length ? { audio: next.audioMaterials } : {}),
      };
    });
    setPromptPanel(null);
    const referenceLabels = [next.audioMaterials.length ? '参考音色' : ''].filter(Boolean);
    message.success(`已把商品图${referenceLabels.length ? `、${referenceLabels.join('、')}` : ''}、提示词和时长带入视频创作`);
  }, []);

  const editVideoProduction = useCallback(async (task: VideoGenerationTask) => {
    const context = isRecord(task.expertContext) ? task.expertContext : {};
    const mode = stringFromRecord(context, 'mode');
    if (mode && mode !== 'video_create' && mode !== 'video_generation') {
      message.warning('暂时只支持编辑“视频”类型的生成记录');
      return;
    }

    const referenceImageIds = stringArrayFromRecord(context, 'originalReferenceImageIds').length
      ? stringArrayFromRecord(context, 'originalReferenceImageIds')
      : stringArrayFromRecord(context, 'referenceImageIds');
    const referenceVideoIds = stringArrayFromRecord(context, 'referenceVideoIds');
    const referenceAudioIds = stringArrayFromRecord(context, 'referenceAudioIds');
    const referenceIds = Array.from(new Set([
      ...referenceImageIds,
      ...referenceVideoIds,
      ...referenceAudioIds,
    ]));
    const messageKey = 'video-task-edit-backfill';
    message.loading({ content: '正在回填生成配置…', duration: 0, key: messageKey });

    try {
      const assetResults = await Promise.allSettled(referenceIds.map((id) => getContentAsset(id)));
      const assetById = new Map<string, ContentAsset>();
      assetResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          assetById.set(referenceIds[index], result.value);
        }
      });
      const missingReferenceCount = referenceIds.length - assetById.size;

      setSelectedMaterials((current) => {
        Object.values(current).forEach((value) => revokeLocalMaterials(getLocalFiles(value)));
        const imageMaterials = referenceImageIds.flatMap((id) => {
          const asset = assetById.get(id);
          return asset ? [localMaterialFromAsset('image', asset)] : [];
        });
        const videoMaterials = referenceVideoIds.flatMap((id) => {
          const asset = assetById.get(id);
          return asset ? [localMaterialFromAsset('video', asset)] : [];
        });
        const audioMaterials = referenceAudioIds.flatMap((id) => {
          const asset = assetById.get(id);
          return asset ? [localMaterialFromAsset('audio', asset)] : [];
        });
        return {
          ...(imageMaterials.length ? { image: imageMaterials } : {}),
          ...(videoMaterials.length ? { video: videoMaterials.slice(0, 1) } : {}),
          ...(audioMaterials.length ? { audio: audioMaterials.slice(0, 3) } : {}),
        };
      });
      setTool(toolOptions[0]);
      setPrompt(stringFromRecord(context, 'userPrompt', task.prompt || ''));
      setModel(modelLabelFromId(stringFromRecord(context, 'videoModelId')));
      setRatio(stringFromRecord(context, 'ratio', '9:16'));
      setQuality(qualityLabelFromContext(stringFromRecord(context, 'quality')));
      setDuration(durationLabelFromContext(stringFromRecord(context, 'duration')));
      setVoiceEnabled(true);
      setShowToolMenu(false);
      setMaterialMode(null);
      setActiveUpload(null);
      setUploadAnchor(null);
      setShowModelPicker(false);
      setSelectedModelAvatar('');
      setPromptPanel(null);
      setExpandedPrompt(false);
      setActiveParam(null);
      setFilterOpen(false);
      message.success({
        content: missingReferenceCount > 0
          ? `配置已回填，${missingReferenceCount} 个已删除素材未能恢复`
          : '视频创作配置已回填',
        key: messageKey,
      });
    } catch (error) {
      message.error({
        content: error instanceof Error ? error.message : '视频创作配置回填失败',
        key: messageKey,
      });
    }
  }, []);

  const resetCreationForm = useCallback(() => {
    setPrompt('');
    setTool(toolOptions[0]);
    setSelectedMaterials((current) => {
      Object.values(current).forEach((value) => revokeLocalMaterials(getLocalFiles(value)));
      return {};
    });
    setVoiceEnabled(true);
    setShowToolMenu(false);
    setMaterialMode(null);
    setActiveUpload(null);
    setUploadAnchor(null);
    setShowModelPicker(false);
    setSelectedModelAvatar('');
    setPromptPanel(null);
    setExpandedPrompt(false);
    setModel('Seedance 2.0');
    setRatio('9:16');
    setQuality('720P');
    setDuration('5s');
    setActiveParam(null);
    setFilterOpen(false);
    setMarketingVideoConfig(defaultMarketingVideoConfig);
    setSubtitleRemovalConfig(defaultSubtitleRemovalConfig);
    setVideoTranslationConfig(defaultVideoTranslationConfig);
    setDanceRemakeMode('enhanced');
  }, []);

  const handleGenerate = useCallback(async () => {
    if (tool.workspace.generate.handler === 'pending' && tool.key !== 'marketing-video') {
      message.warning(`${tool.label}功能正在接入生成能力`);
      return;
    }
    if (hasVideoRequiringTrim(selectedMaterials)) {
      message.warning('所选视频需先剪辑至 15 秒以内');
      return;
    }
    if (!canGenerate) {
      return;
    }
    try {
      setIsGenerating(true);
      if (tool.workspace.generate.handler === 'dance-remake') {
        const [characterImageAssetId] = await ensureMaterialAssetIds({
          currentUser,
          resourceType: 'other',
          files: getLocalFiles(selectedMaterials.image),
          uploadGroupIdsRef,
        });
        const referenceVideo = getLocalFiles(selectedMaterials.video)[0];
        if (!characterImageAssetId) throw new Error('请上传人物素材');
        if (!referenceVideo) throw new Error('请上传或粘贴参考视频');

        let referenceVideoAssetId = referenceVideo.assetId;
        if (!referenceVideo.remoteSourceUrl && !referenceVideoAssetId) {
          [referenceVideoAssetId] = await ensureMaterialAssetIds({
            currentUser,
            resourceType: 'other',
            files: [referenceVideo],
            uploadGroupIdsRef,
          });
        }
        await createDanceRemake({
          characterImageAssetId,
          mode: danceRemakeMode,
          preserveAudio: voiceEnabled,
          quality: mapQualityLabel(quality),
          ratio,
          referenceVideoAssetId,
          remoteVideo: referenceVideo.remoteSourceUrl ? {
            input: referenceVideo.remoteSourceUrl,
            trimEnd: referenceVideo.trimEnd,
            trimStart: referenceVideo.trimStart,
          } : undefined,
          videoModelId: modelOptionIds[model] || modelOptionIds['Seedance 2.0'],
        });
        await Promise.all([loadLibraryAssets(), loadVideoProductions(true)]);
        chooseTool(tool);
        setVoiceEnabled(true);
        message.success('跳舞复刻任务已提交');
        return;
      }
      const prepared = await prepareGenerationMaterials({
        currentUser,
        prompt,
        selectedMaterials,
        uploadGroupIdsRef,
        voiceEnabled,
      });
      if (tool.key === 'marketing-video') {
        const storyboard = await createMarketingVideoStoryboard({
          productName: marketingVideoConfig.productName.trim(),
          productCategory: marketingVideoConfig.productCategory.trim(),
          sellingPoints: marketingVideoConfig.sellingPoints.trim(),
          additionalPrompt: prompt.trim(),
          referenceImageIds: prepared.referenceImageIds,
        });
        setMarketingStoryboards((current) => [
          storyboard,
          ...current.filter((task) => task.id !== storyboard.id),
        ]);
        setSelectedMarketingStoryboardId(storyboard.id);
        message.success('营销视频分镜任务已提交');
        return;
      }
      if (tool.workspace.generate.handler === 'video-upscale') {
        const sourceAssetId = prepared.referenceVideoIds[0];
        if (!sourceAssetId) {
          throw new Error('请选择待放大视频');
        }
        await createVideoEnhancement({
          userId: currentUser.id,
          sourceAssetId,
          resolution: '1080p',
        });
        await Promise.all([
          loadLibraryAssets(),
          loadVideoProductions(true),
        ]);
        resetCreationForm();
        message.success('视频高清放大任务已提交');
        return;
      }
      if (tool.workspace.generate.handler === 'subtitle-removal') {
        const sourceAssetId = prepared.referenceVideoIds[0];
        if (!sourceAssetId) {
          throw new Error('请选择待擦除字幕的源视频');
        }
        validateSubtitleRemovalConfig(subtitleRemovalConfig);
        await createSubtitleRemoval({
          userId: currentUser.id,
          sourceAssetId,
          ...subtitleRemovalConfig,
        });
        await Promise.all([
          loadLibraryAssets(),
          loadVideoProductions(true),
        ]);
        resetCreationForm();
        message.success('字幕擦除任务已提交');
        return;
      }
      if (tool.workspace.generate.handler === 'video-translation') {
        const sourceAssetId = prepared.referenceVideoIds[0];
        if (!sourceAssetId) {
          throw new Error('请选择待翻译的源视频');
        }
        const request = buildVideoTranslationRequest(videoTranslationConfig);
        await createVideoTranslation({
          userId: currentUser.id,
          sourceAssetId,
          ...request,
        });
        await Promise.all([
          loadLibraryAssets(),
          loadVideoProductions(true),
        ]);
        resetCreationForm();
        message.success('视频翻译任务已提交');
        return;
      }
      await createVideoProduction({
        userId: currentUser.id,
        prompt,
        quality: mapQualityLabel(quality),
        ratio,
        duration,
        videoModelProviderId: 'volcengine-seedance',
        videoModelId: modelOptionIds[model] || modelOptionIds['Seedance 2.0'],
        referenceImageIds: prepared.referenceImageIds,
        referenceVideoIds: prepared.referenceVideoIds,
        referenceAudioIds: prepared.referenceAudioIds,
        characterReferenceImageIds: prepared.characterReferenceImageIds,
      });
      await Promise.all([
        loadLibraryAssets(),
        loadVideoProductions(true),
      ]);
      resetCreationForm();
      message.success('视频生成任务已提交');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频生成失败');
    } finally {
      setIsGenerating(false);
    }
  }, [
    canGenerate,
    chooseTool,
    currentUser,
    danceRemakeMode,
    duration,
    loadLibraryAssets,
    loadVideoProductions,
    marketingVideoConfig,
    model,
    prompt,
    quality,
    ratio,
    resetCreationForm,
    selectedMaterials,
    subtitleRemovalConfig,
    tool.label,
    tool.key,
    tool.workspace.generate.handler,
    voiceEnabled,
    videoTranslationConfig,
  ]);

  const retryMarketingStoryboard = useCallback(async (id: string, optimizationInstruction: string) => {
    if (retryingMarketingStoryboardId) return false;
    try {
      setRetryingMarketingStoryboardId(id);
      const task = await retryMarketingVideoStoryboard(id, optimizationInstruction);
      setMarketingStoryboards((current) => current.map((item) => item.id === task.id ? task : item));
      setSelectedMarketingStoryboardId(task.id);
      message.success('已重新提交分镜生成');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新生成分镜失败');
      return false;
    } finally {
      setRetryingMarketingStoryboardId('');
    }
  }, [retryingMarketingStoryboardId]);

  const generateMarketingVideo = useCallback(async (storyboard: MarketingVideoStoryboard) => {
    if (generatingMarketingVideoId || !storyboard.imageAssetId) {
      return;
    }
    try {
      setGeneratingMarketingVideoId(storyboard.id);
      await generateVideoFromMarketingStoryboard(storyboard.id, {
        quality: mapQualityLabel(quality),
        ratio,
        duration: marketingVideoDuration,
        videoModelProviderId: 'volcengine-seedance',
        videoModelId: modelOptionIds[model] || modelOptionIds['Seedance 2.0'],
      });
      await Promise.all([
        loadVideoProductions(true),
        loadMarketingStoryboards(true),
      ]);
      message.success('视频生成任务已提交，可在右侧视频结果中查看');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频生成任务提交失败');
    } finally {
      setGeneratingMarketingVideoId('');
    }
  }, [generatingMarketingVideoId, loadMarketingStoryboards, loadVideoProductions, model, quality, ratio]);

  const deleteMarketingStoryboard = useCallback(async (id: string) => {
    if (deletingMarketingStoryboardId) return;
    try {
      setDeletingMarketingStoryboardId(id);
      await deleteMarketingVideoStoryboard(id);
      setMarketingStoryboards((current) => current.filter((task) => task.id !== id));
      setSelectedMarketingStoryboardId('');
      message.success('分镜任务已删除');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分镜任务删除失败');
    } finally {
      setDeletingMarketingStoryboardId('');
    }
  }, [deletingMarketingStoryboardId]);

  const retryVideoProduction = useCallback(async (task: VideoGenerationTask) => {
    if (retrySubmittingRef.current) {
      return;
    }
    const context = isRecord(task.expertContext) ? task.expertContext : {};
    if (context.mode === 'video_upscale') {
      const sourceAssetId = stringFromRecord(context, 'sourceAssetId');
      if (!sourceAssetId) {
        message.warning('当前记录缺少源视频素材，无法重试');
        return;
      }
      try {
        retrySubmittingRef.current = true;
        setRetryingTaskId(task.id);
        await createVideoEnhancement({
          userId: currentUser.id,
          sourceAssetId,
          resolution: (stringFromRecord(context, 'enhancementResolution', '1080p').toLowerCase() as '1080p' | '2k' | '4k'),
        });
        await loadVideoProductions(true);
        message.success('已重新提交高清放大任务');
      } catch (error) {
        message.error(error instanceof Error ? error.message : '高清放大重试失败');
      } finally {
        retrySubmittingRef.current = false;
        setRetryingTaskId('');
      }
      return;
    }
    if (context.mode === 'subtitle_removal') {
      const sourceAssetId = stringFromRecord(context, 'sourceAssetId');
      if (!sourceAssetId) {
        message.warning('当前记录缺少源视频素材，无法重试');
        return;
      }
      try {
        retrySubmittingRef.current = true;
        setRetryingTaskId(task.id);
        await createSubtitleRemoval({
          userId: currentUser.id,
          sourceAssetId,
          mode: subtitleRemovalModeFromRecord(context),
          contentType: stringFromRecord(context, 'subtitleRemovalContentType') === 'text' ? 'text' : 'subtitle',
          locations: subtitleRemovalLocationsFromRecord(context),
          clipFilter: subtitleRemovalClipFilterFromRecord(context),
        });
        await loadVideoProductions(true);
        message.success('已重新提交字幕擦除任务');
      } catch (error) {
        message.error(error instanceof Error ? error.message : '字幕擦除重试失败');
      } finally {
        retrySubmittingRef.current = false;
        setRetryingTaskId('');
      }
      return;
    }
    if (context.mode === 'video_translation') {
      const sourceAssetId = stringFromRecord(context, 'sourceAssetId');
      if (!sourceAssetId) {
        message.warning('当前记录缺少源视频素材，无法重试');
        return;
      }
      try {
        retrySubmittingRef.current = true;
        setRetryingTaskId(task.id);
        await createVideoTranslation({
          userId: currentUser.id,
          sourceAssetId,
          sourceLanguage: stringFromRecord(context, 'videoTranslationSourceLanguage', 'zh'),
          targetLanguage: stringFromRecord(context, 'videoTranslationTargetLanguage', 'en'),
          translationTypes: videoTranslationTypesFromRecord(context),
          subtitleSource: stringFromRecord(context, 'videoTranslationSubtitleSource') === 'asr' ? 'asr' : 'ocr',
          subtitleConfig: videoTranslationSubtitleConfigFromRecord(context),
        });
        await loadVideoProductions(true);
        message.success('已重新提交视频翻译任务');
      } catch (error) {
        message.error(error instanceof Error ? error.message : '视频翻译重试失败');
      } finally {
        retrySubmittingRef.current = false;
        setRetryingTaskId('');
      }
      return;
    }
    const payload = buildRetryVideoProductionPayload(task, currentUser.id);
    if (!payload.prompt?.trim()) {
      message.warning('当前记录缺少可重试的提示词，请重新配置后再生成');
      return;
    }
    try {
      retrySubmittingRef.current = true;
      setRetryingTaskId(task.id);
      await createVideoProduction(payload);
      await loadVideoProductions(true);
      message.success('已再次提交生成任务');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '再次生成失败');
    } finally {
      retrySubmittingRef.current = false;
      setRetryingTaskId('');
    }
  }, [currentUser.id, loadVideoProductions]);

  const deleteVideoProduction = useCallback(async (task: VideoGenerationTask) => {
    try {
      setDeletingTaskId(task.id);
      await deleteVideoTask(task.id);
      await Promise.all([
        loadLibraryAssets(),
        loadVideoProductions(true),
      ]);
      message.success('生成记录已删除');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除生成记录失败');
      return false;
    } finally {
      setDeletingTaskId('');
    }
  }, [loadLibraryAssets, loadVideoProductions]);

  return {
    activeParam,
    activeUpload,
    canGenerate,
    canvas,
    currentUser,
    danceRemakeMode,
    chooseAudio,
    chooseLibraryAsset,
    chooseMaterialTab,
    chooseModelAsset,
    chooseModelAvatar,
    chooseCanvasQuality,
    chooseCanvasRatio,
    chooseParam,
    chooseTool,
    closeMaterialPopovers,
    clearFilters,
    duration,
    expandedPrompt,
    applyPlanningResult,
    fillExamplePrompt,
    fillMaterial,
    fillMaterialFiles,
    fillMentionPlaceholderFiles,
    handleGenerate,
    hasCreationFormContent,
    clearMaterial,
    removeOneMaterial,
    replaceMaterialFiles,
    clearAllMaterials,
    filterOpen,
    filters,
    hasMoreVideoProductions,
    isLoadingLibraryAssets,
    isLoadingMoreProductions,
    isLoadingProductions,
    isGenerating,
    materialMode,
    marketingStoryboards,
    marketingVideoConfig,
    marketingVideoGenerationPriceLabel,
    isLoadingMarketingStoryboards,
    retryingMarketingStoryboardId,
    retryMarketingStoryboard,
    generateMarketingVideo,
    generatingMarketingVideoId,
    deleteMarketingStoryboard,
    deletingMarketingStoryboardId,
    selectedMarketingStoryboardId,
    setSelectedMarketingStoryboardId,
    model,
    loadMoreVideoProductions,
    paramSummary,
    prompt,
    promptPanel,
    openModelPicker,
    quality,
    ratio,
    selectedMaterials,
    selectedModelAvatar,
    voiceAssets,
    voiceGroupNameById,
    worksAssets,
    worksTab,
    setWorksTab,
    setActiveParam: (kind: ParamKind | null) => {
      setActiveParam(kind);
      if (kind) {
        setActiveUpload(null);
        setUploadAnchor(null);
        setPromptPanel(null);
        setFilterOpen(false);
      }
    },
    setActiveUpload: (kind: MaterialKind | null) => {
      setActiveUpload(kind);
      if (!kind) setUploadAnchor(null);
      if (kind) {
        setMaterialMode(null);
        setActiveParam(null);
        setPromptPanel(null);
        setFilterOpen(false);
      }
    },
    setActiveUploadWithAnchor: (kind: MaterialKind, anchor: UploadAnchor) => {
      setActiveUpload(kind);
      setUploadAnchor(anchor);
      setMaterialMode(null);
      setActiveParam(null);
      setPromptPanel(null);
      setFilterOpen(false);
    },
    setExpandedPrompt,
    setFilterOpen: (open: boolean) => {
      setFilterOpen(open);
      if (open) {
        setActiveParam(null);
        setActiveUpload(null);
        setUploadAnchor(null);
        setPromptPanel(null);
      }
    },
    setFilters,
    setDanceRemakeMode,
    setMarketingVideoConfig,
    setPrompt,
    setPromptPanel: (panel: PromptPanel | null) => {
      setPromptPanel(panel);
      if (panel) {
        setActiveParam(null);
        setActiveUpload(null);
        setFilterOpen(false);
      }
    },
    setShowToolMenu,
    setShowModelPicker,
    setVoiceEnabled: (enabled: boolean) => {
      if (!enabled && hasSelectedAudio) return;
      setVoiceEnabled(enabled);
    },
    setSubtitleRemovalConfig,
    subtitleRemovalConfig,
    setVideoTranslationConfig,
    videoTranslationConfig,
    deleteVideoProduction,
    deletingTaskId,
    resolveVideoSource,
    retryVideoProduction,
    retryingTaskId,
    editVideoProduction,
    showModelPicker,
    showToolMenu,
    tool,
    uploadAnchor,
    videoProductions,
    videoPriceLabel,
    voiceEnabled,
  };
}

export type VideoTaskCloneState = ReturnType<typeof useVideoTaskCloneState>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, key: string, fallback = '') {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

function stringArrayFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function subtitleRemovalModeFromRecord(record: Record<string, unknown>): SubtitleRemovalConfig['mode'] {
  const value = stringFromRecord(record, 'subtitleRemovalMode');
  return value === 'auto_region' || value === 'manual' ? value : 'auto';
}

function subtitleRemovalLocationsFromRecord(record: Record<string, unknown>): SubtitleRemovalConfig['locations'] {
  const value = record.subtitleRemovalLocations;
  if (!Array.isArray(value)) return defaultSubtitleRemovalConfig.locations;
  const locations = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const topLeftX = Number(item.topLeftX);
    const topLeftY = Number(item.topLeftY);
    const bottomRightX = Number(item.bottomRightX);
    const bottomRightY = Number(item.bottomRightY);
    return [topLeftX, topLeftY, bottomRightX, bottomRightY].every(Number.isFinite)
      ? [{ topLeftX, topLeftY, bottomRightX, bottomRightY }]
      : [];
  });
  return locations.length ? locations : defaultSubtitleRemovalConfig.locations;
}

function subtitleRemovalClipFilterFromRecord(record: Record<string, unknown>): SubtitleRemovalConfig['clipFilter'] {
  const value = record.subtitleRemovalClipFilter;
  if (!isRecord(value)) return defaultSubtitleRemovalConfig.clipFilter;
  const mode = value.mode === 'selected' || value.mode === 'skip' ? value.mode : 'all';
  if (mode === 'all') return { mode, clips: [] };
  const storedClips = Array.isArray(value.clips) ? value.clips : [];
  const clips = storedClips.flatMap((clip) => {
    if (!isRecord(clip)) return [];
    const start = Number(clip.start);
    const end = Number(clip.end);
    return Number.isFinite(start) && Number.isFinite(end) ? [{ start, end }] : [];
  });
  if (clips.length) return { mode, clips };

  const start = Number(value.start || 0);
  const end = Number(value.end || 0);
  return { mode, clips: end > start ? [{ start, end }] : [] };
}

function validateSubtitleRemovalConfig(config: SubtitleRemovalConfig) {
  if (config.mode !== 'auto' && config.locations.length === 0) {
    throw new Error('请先打开视频编辑器框选字幕擦除区域');
  }
  config.locations.forEach((location) => {
    const values = [location.topLeftX, location.topLeftY, location.bottomRightX, location.bottomRightY];
    if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
      || location.topLeftX >= location.bottomRightX
      || location.topLeftY >= location.bottomRightY) {
      throw new Error('字幕擦除区域坐标无效，请重新框选');
    }
  });
  if (config.clipFilter.mode !== 'all') {
    if (config.clipFilter.clips.length === 0) {
      throw new Error('请至少添加一个字幕擦除时间段');
    }
    if (config.clipFilter.clips.some((clip) => clip.start < 0 || clip.end <= clip.start)) {
      throw new Error('字幕擦除时间范围无效，请确保每段结束时间晚于开始时间');
    }
  }
}

function buildVideoTranslationRequest(config: VideoTranslationConfig) {
  if (config.sourceLanguage === config.targetLanguage) {
    throw new Error('源语言和目标语言不能相同');
  }
  const translationTypes: Array<'subtitle' | 'voice' | 'face'> = ['subtitle'];
  if (config.modes.voice) translationTypes.push('voice');
  if (config.modes.face) translationTypes.push('face');
  if (config.modes.face && !config.modes.voice) {
    throw new Error('面容翻译必须同时开启语音翻译');
  }
  const subtitleConfig: {
    isHardSubtitle: boolean;
    isEraseSource: boolean;
    fontSize?: number;
    marginL?: number;
    marginR?: number;
    marginV?: number;
    showLines?: number;
  } = {
    isHardSubtitle: config.hardSubtitles,
    isEraseSource: config.eraseOriginalSubtitles,
  };
  if (config.hardSubtitles) {
    const location = config.subtitlePlacementConfig.locations[0];
    if (!location) {
      throw new Error('请先打开视频编辑器框选硬字幕位置');
    }
    validateSubtitlePlacement(location);
    subtitleConfig.fontSize = config.fontSize;
    subtitleConfig.marginL = roundedRatio(location.topLeftX);
    subtitleConfig.marginR = roundedRatio(1 - location.bottomRightX);
    subtitleConfig.marginV = roundedRatio(1 - location.bottomRightY);
    subtitleConfig.showLines = config.showLines;
  }
  return {
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
    translationTypes,
    subtitleSource: config.subtitleSource,
    subtitleConfig,
  };
}

function validateSubtitlePlacement(location: SubtitleRemovalConfig['locations'][number]) {
  const values = [location.topLeftX, location.topLeftY, location.bottomRightX, location.bottomRightY];
  if (!values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    || location.topLeftX >= location.bottomRightX
    || location.topLeftY >= location.bottomRightY) {
    throw new Error('硬字幕位置坐标无效，请重新框选');
  }
}

function roundedRatio(value: number) {
  return Math.round(Math.max(0, Math.min(0.999999, value)) * 1_000_000) / 1_000_000;
}

function videoTranslationTypesFromRecord(record: Record<string, unknown>) {
  const stored = stringArrayFromRecord(record, 'videoTranslationTypes');
  const translationTypes: Array<'subtitle' | 'voice' | 'face'> = ['subtitle'];
  if (stored.includes('voice')) translationTypes.push('voice');
  if (stored.includes('face')) translationTypes.push('face');
  return translationTypes;
}

function videoTranslationSubtitleConfigFromRecord(record: Record<string, unknown>) {
  const stored = isRecord(record.videoTranslationSubtitleConfig)
    ? record.videoTranslationSubtitleConfig
    : {};
  const isHardSubtitle = stored.isHardSubtitle !== false;
  const subtitleConfig: {
    isHardSubtitle: boolean;
    isEraseSource: boolean;
    fontSize?: number;
    marginL?: number;
    marginR?: number;
    marginV?: number;
    showLines?: number;
  } = {
    isHardSubtitle,
    isEraseSource: stored.isEraseSource === true,
  };
  if (isHardSubtitle) {
    subtitleConfig.fontSize = Number(stored.fontSize || 24);
    subtitleConfig.marginL = Number(stored.marginL || 0);
    subtitleConfig.marginR = Number(stored.marginR || 0);
    subtitleConfig.marginV = Number(stored.marginV || 0);
    subtitleConfig.showLines = Number(stored.showLines ?? 2);
  }
  return subtitleConfig;
}

function buildRetryVideoProductionPayload(task: VideoGenerationTask, userId: string) {
  const context = isRecord(task.expertContext) ? task.expertContext : {};
  const prompt = stringFromRecord(context, 'userPrompt', task.prompt || '');
  return {
    userId,
    taskMode: context.mode === 'dance_remake' ? 'dance_remake' as const : 'video_create' as const,
    retryTaskId: task.id,
    prompt,
    quality: stringFromRecord(context, 'quality', '标清 (720p)'),
    ratio: stringFromRecord(context, 'ratio', '9:16'),
    duration: stringFromRecord(context, 'duration', '5s'),
    videoModelProviderId: stringFromRecord(context, 'videoModelProviderId'),
    videoModelId: stringFromRecord(context, 'videoModelId'),
    referenceImageGroupId: stringFromRecord(context, 'referenceImageGroupId'),
    referenceVideoGroupId: stringFromRecord(context, 'referenceVideoGroupId'),
    referenceAudioGroupId: stringFromRecord(context, 'referenceAudioGroupId'),
    referenceImageIds: stringArrayFromRecord(context, 'originalReferenceImageIds').length
      ? stringArrayFromRecord(context, 'originalReferenceImageIds')
      : stringArrayFromRecord(context, 'referenceImageIds'),
    referenceVideoIds: stringArrayFromRecord(context, 'referenceVideoIds'),
    referenceAudioIds: stringArrayFromRecord(context, 'referenceAudioIds'),
    characterReferenceImageIds: stringArrayFromRecord(context, 'characterReferenceImageIds'),
    generateAudio: context.generateAudio !== false,
  };
}

function getImageCount(value: SelectedMaterialValue) {
  if (Array.isArray(value)) return Math.min(value.length, 9);
  if (!value) return 0;
  const matched = value.match(/(\d+)\s*张/);
  if (matched) return Math.min(Number(matched[1]), 9);
  const indexed = value.match(/(\d+)/);
  if (indexed) return Math.min(Number(indexed[1]), 9);
  return 1;
}

function getAudioCount(value: SelectedMaterialValue) {
  if (Array.isArray(value)) return Math.min(value.length, 3);
  if (!value) return 0;
  const matched = value.match(/参考音频\s*(\d+)\s*个/);
  if (matched) return Math.min(Number(matched[1]), 3);
  return 1;
}

function getSelectedMaterialCount(kind: MaterialKind, value: SelectedMaterialValue) {
  if (kind.key === 'image') return Math.min(getImageCount(value), getLimit(kind));
  if (kind.key === 'audio') return Math.min(getAudioCount(value), getLimit(kind));
  return value ? 1 : 0;
}

function getRemainingCapacity(kind: MaterialKind, current: SelectedMaterialValue) {
  return Math.max(getLimit(kind) - getLocalFiles(current).length, 0);
}

function getLimit(kind: MaterialKind) {
  if (kind.maxCount !== undefined) return kind.maxCount;
  if (kind.key === 'image') return 9;
  if (kind.key === 'audio') return 3;
  return 1;
}

function formatCreditAmount(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function getLocalFiles(value: SelectedMaterialValue): LocalMaterialFile[] {
  return Array.isArray(value) ? value : [];
}

function hasVideoRequiringTrim(selectedMaterials: SelectedMaterials) {
  return getLocalFiles(selectedMaterials.video).some((file) => {
    if (file.trimDuration !== undefined) return shouldTrimReferenceVideo(file.trimDuration);
    if (file.file) return shouldTrimReferenceVideo(file.trimDuration);
    return (file.mediaDuration ?? 0) > MAX_REFERENCE_VIDEO_DURATION_SECONDS;
  });
}

function getAudioDurationTotal(files: LocalMaterialFile[]) {
  return files.reduce((total, file) => total + getAudioDuration(file), 0);
}

function getAudioDuration(file: LocalMaterialFile) {
  const duration = file.audioDuration;
  return Number.isFinite(duration) && duration && duration > 0 ? duration : 7;
}

function fitAudioFilesWithinLimit(currentFiles: LocalMaterialFile[], incomingFiles: LocalMaterialFile[]) {
  const acceptedFiles: LocalMaterialFile[] = [];
  let totalDuration = getAudioDurationTotal(currentFiles);

  incomingFiles.forEach((file) => {
    const duration = getAudioDuration(file);
    if (totalDuration + duration > 15) return;
    acceptedFiles.push(file);
    totalDuration += duration;
  });

  return acceptedFiles;
}

function getAssetDurationSeconds(asset: ContentAsset) {
  const rawDuration = asset.metadata?.duration;
  const duration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

async function downloadAssetAsFile(asset: ContentAsset, url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('作品视频读取失败，请重试');
  }
  const blob = await response.blob();
  const name = asset.originalFileName || asset.name || asset.storedFileName || '参考视频.mp4';
  return new File([blob], name, {
    type: asset.mimeType || blob.type || 'video/mp4',
  });
}

function getAssetTrimSourceUrl(asset: ContentAsset, fallbackUrl: string) {
  const localMirrorUrl = asset.metadata?.localMirrorUrl;
  return typeof localMirrorUrl === 'string' && localMirrorUrl.trim()
    ? resolveAssetUrl(localMirrorUrl)
    : fallbackUrl;
}

function localMaterialFromAsset(type: LocalMaterialFile['type'], asset: ContentAsset): LocalMaterialFile {
  const duration = getAssetDurationSeconds(asset);
  return {
    assetId: asset.id,
    audioDuration: type === 'audio' ? duration : undefined,
    id: `${type}-${asset.id}-${crypto.randomUUID()}`,
    name: asset.name || asset.originalFileName || asset.storedFileName || '参考素材',
    serverFileUrl: asset.fileUrl,
    storedFileName: asset.storedFileName,
    trimDuration: type === 'video' ? duration : undefined,
    type,
    url: resolveAssetUrl(asset.fileUrl),
  };
}

function modelLabelFromId(modelId: string) {
  return Object.entries(modelOptionIds).find(([, id]) => id === modelId)?.[0] || 'Seedance 2.0';
}

function qualityLabelFromContext(value: string) {
  return value.toLowerCase().includes('480') ? '480P' : '720P';
}

function durationLabelFromContext(value: string) {
  const matched = value.match(/(\d+)/);
  return matched ? `${matched[1]}s` : '5s';
}

function isAllowedAudioFile(file: File) {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return mimeType === 'audio/mpeg'
    || mimeType === 'audio/mp3'
    || mimeType === 'audio/wav'
    || mimeType === 'audio/x-wav'
    || name.endsWith('.mp3')
    || name.endsWith('.wav');
}

function isMp4VideoFile(file: File) {
  return file.type.toLowerCase() === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
}

function isAllowedAudioAsset(asset: ContentAsset) {
  const mimeType = asset.mimeType.toLowerCase();
  const fileName = [
    asset.name,
    asset.originalFileName,
    asset.storedFileName,
    asset.fileUrl,
  ].filter(Boolean).join(' ').toLowerCase();
  return mimeType === 'audio/mpeg'
    || mimeType === 'audio/mp3'
    || mimeType === 'audio/wav'
    || mimeType === 'audio/x-wav'
    || fileName.includes('.mp3')
    || fileName.includes('.wav');
}

function readAudioDuration(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const audio = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
      audio.removeAttribute('src');
      URL.revokeObjectURL(objectUrl);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = objectUrl;
  });
}

function revokeLocalMaterials(files: LocalMaterialFile[]) {
  files.forEach((file) => {
    if (file.url.startsWith('blob:')) {
      URL.revokeObjectURL(file.url);
    }
  });
}

function isCompletedFinishedVideo(asset: ContentAsset) {
  const status = typeof asset.metadata?.generationStatus === 'string' ? asset.metadata.generationStatus : '';
  return Boolean(asset.fileUrl) && status !== 'generating' && status !== 'queued' && status !== 'failed';
}

function mapQualityLabel(value: string) {
  return value === '480P' ? '普清 (480p)' : '标清 (720p)';
}

function implicitUploadGroupName(resourceType: ContentAssetResourceType) {
  if (resourceType === 'scene') return '场景素材';
  if (resourceType === 'product') return '产品素材';
  if (resourceType === 'voice') return '视频制作参考音频';
  return '视频制作参考素材';
}

async function ensureUploadGroupId(input: {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
}) {
  const cached = input.uploadGroupIdsRef.current[input.resourceType];
  if (cached) {
    return cached;
  }
  const groups = await listContentAssetGroups(input.currentUser.id, input.resourceType);
  const existing = groups.find((group) => group.metadata?.systemDefault === true || group.name === implicitUploadGroupName(input.resourceType));
  if (existing) {
    input.uploadGroupIdsRef.current[input.resourceType] = existing.id;
    return existing.id;
  }
  const created = await createContentAssetGroup({
    userId: input.currentUser.id,
    resourceType: input.resourceType,
    name: implicitUploadGroupName(input.resourceType),
    metadata: {
      hiddenFromGroupUi: true,
      systemDefault: true,
      source: 'local_upload',
    },
  });
  input.uploadGroupIdsRef.current[input.resourceType] = created.id;
  return created.id;
}

async function ensureMaterialAssetIds(input: {
  currentUser: User;
  resourceType: ContentAssetResourceType;
  files: LocalMaterialFile[];
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
}) {
  if (!input.files.length) {
    return [];
  }
  const groupId = await ensureUploadGroupId({
    currentUser: input.currentUser,
    resourceType: input.resourceType,
    uploadGroupIdsRef: input.uploadGroupIdsRef,
  });
  const ensuredIds = await Promise.all(input.files.map(async (file) => {
    if (file.assetId) {
      return file.assetId;
    }
    if (!file.file) {
      throw new Error(`缺少待上传素材文件：${file.name}`);
    }
    const uploaded = await uploadContentAsset({
      file: file.file,
      userId: input.currentUser.id,
      groupId,
      resourceType: input.resourceType,
      name: file.name,
      metadata: {
        ...(file.audioDuration ? { duration: file.audioDuration } : {}),
        ...(file.trimDuration ? { duration: file.trimDuration } : {}),
        source: 'local_upload',
        temporary: true,
        kind: 'video_create_reference_upload',
        assetKind: `${file.type}_input`,
      },
    });
    file.assetId = uploaded.id;
    file.serverFileUrl = uploaded.fileUrl;
    file.storedFileName = uploaded.storedFileName;
    file.url = resolveAssetUrl(uploaded.fileUrl);
    return uploaded.id;
  }));
  return ensuredIds;
}

function mentionedCharacterReferenceIndexes(prompt: string) {
  const keywordPattern = /人物|人像|真人|模特|角色|主角|主播|达人|女生|男生|女孩|男孩|女人|男人/u;
  const clauses = prompt
    .split(/[\n，。,；;！!？?]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const clauseMentions = clauses.map((clause) => Array.from(clause.matchAll(/@图片(\d+)/g))
    .map((match) => Number(match[1]))
    .filter((imageIndex) => Number.isFinite(imageIndex) && imageIndex > 0)
    .map((imageIndex) => imageIndex - 1));
  const clauseHasKeyword = clauses.map((clause) => keywordPattern.test(clause));
  const indexes = new Set<number>();
  clauseMentions.forEach((mentions, clauseIndex) => {
    if (!mentions.length) {
      return;
    }
    const hasNearbyCharacterKeyword = clauseHasKeyword[clauseIndex]
      || clauseHasKeyword[clauseIndex - 1]
      || clauseHasKeyword[clauseIndex + 1]
      || clauseHasKeyword[clauseIndex + 2]
      || clauseHasKeyword[clauseIndex + 3];
    if (!hasNearbyCharacterKeyword) {
      return;
    }
    mentions.forEach((imageIndex) => {
      indexes.add(imageIndex);
    });
  });
  if (!indexes.size && keywordPattern.test(prompt)) {
    for (const match of prompt.matchAll(/@图片(\d+)/g)) {
      const imageIndex = Number(match[1]);
      if (Number.isFinite(imageIndex) && imageIndex > 0) {
        indexes.add(imageIndex - 1);
      }
    }
  }
  return Array.from(indexes).sort((left, right) => left - right);
}

async function prepareGenerationMaterials(input: {
  currentUser: User;
  prompt: string;
  selectedMaterials: SelectedMaterials;
  uploadGroupIdsRef: MutableRefObject<Partial<Record<ContentAssetResourceType, string>>>;
  voiceEnabled: boolean;
}) {
  const imageFiles = getLocalFiles(input.selectedMaterials.image);
  const videoFiles = getLocalFiles(input.selectedMaterials.video);
  const audioFiles = getLocalFiles(input.selectedMaterials.audio);
  const [referenceImageIds, referenceVideoIds, referenceAudioIds] = await Promise.all([
    ensureMaterialAssetIds({
      currentUser: input.currentUser,
      resourceType: 'other',
      files: imageFiles,
      uploadGroupIdsRef: input.uploadGroupIdsRef,
    }),
    ensureMaterialAssetIds({
      currentUser: input.currentUser,
      resourceType: 'other',
      files: videoFiles,
      uploadGroupIdsRef: input.uploadGroupIdsRef,
    }),
    input.voiceEnabled
      ? ensureMaterialAssetIds({
        currentUser: input.currentUser,
        resourceType: 'voice',
        files: audioFiles,
        uploadGroupIdsRef: input.uploadGroupIdsRef,
      })
      : Promise.resolve<string[]>([]),
  ]);
  const characterReferenceImageIds = mentionedCharacterReferenceIndexes(input.prompt)
    .map((index) => referenceImageIds[index])
    .filter(Boolean);
  return {
    referenceImageIds,
    referenceVideoIds,
    referenceAudioIds,
    characterReferenceImageIds,
  };
}

function taskVideoGenerationResult(task: VideoGenerationTask) {
  const contextResult = task.expertContext?.videoGenerationResult;
  if (contextResult && typeof contextResult === 'object' && !Array.isArray(contextResult)) {
    return task.editableParseResult.videoGenerationResult || contextResult as VideoGenerationResult;
  }
  return task.editableParseResult.videoGenerationResult;
}

function isRunningVideoProduction(task: VideoGenerationTask) {
  const result = taskVideoGenerationResult(task);
  const hasJobId = Boolean(String(result?.jobId || '').trim());
  return task.status === 'generating'
    || (result?.status === 'pending' && hasJobId)
    || result?.status === 'running'
    || (result?.renderStatus === 'queued' && hasJobId)
    || result?.renderStatus === 'rendering';
}
