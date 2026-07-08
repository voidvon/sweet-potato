import { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { listContentAssets } from '../../../api/content';
import { resolveAssetUrl } from '../../../api/request';
import type { ContentAsset, User } from '../../../types';
import {
  defaultFilters,
  examplePrompt,
  toolOptions,
} from './constants';
import type {
  FilterValues,
  MaterialKind,
  MaterialMode,
  ParamKind,
  PromptPanel,
  LocalMaterialFile,
  SelectedMaterials,
  SelectedMaterialValue,
  ToolOption,
  UploadAnchor,
  WorksTab,
} from './types';

export function useVideoTaskCloneState(currentUser: User) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [tool, setTool] = useState<ToolOption>(toolOptions[0]);
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [materialMode, setMaterialMode] = useState<MaterialMode>(null);
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedMaterials>({});
  const [activeUpload, setActiveUpload] = useState<MaterialKind | null>(null);
  const [uploadAnchor, setUploadAnchor] = useState<UploadAnchor | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [selectedModelAvatar, setSelectedModelAvatar] = useState('');
  const [promptPanel, setPromptPanel] = useState<PromptPanel | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const [model, setModel] = useState('Seedance 2.0');
  const [ratio, setRatio] = useState('9:16');
  const [quality, setQuality] = useState('720P');
  const [duration, setDuration] = useState('5s');
  const [activeParam, setActiveParam] = useState<ParamKind | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(defaultFilters);
  const [voiceAssets, setVoiceAssets] = useState<ContentAsset[]>([]);
  const [worksAssets, setWorksAssets] = useState<ContentAsset[]>([]);
  const [worksTab, setWorksTab] = useState<WorksTab>('all');
  const [isLoadingLibraryAssets, setIsLoadingLibraryAssets] = useState(false);

  const loadLibraryAssets = useCallback(async () => {
    setIsLoadingLibraryAssets(true);
    try {
      const [voiceList, finishedVideoList] = await Promise.all([
        listContentAssets({ userId: currentUser.id, resourceType: 'voice' }),
        listContentAssets({ userId: currentUser.id, resourceType: 'finished_video' }),
      ]);
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

  const canGenerate = useMemo(
    () => prompt.trim().length > 0 || Object.keys(selectedMaterials).length > 0,
    [prompt, selectedMaterials],
  );
  const hasSelectedAudio = Boolean(selectedMaterials.audio);

  useEffect(() => {
    if (hasSelectedAudio) {
      setVoiceEnabled(true);
    }
  }, [hasSelectedAudio]);

  const canvas = `${ratio} · ${quality}`;
  const paramSummary = `${model} · ${canvas} · ${duration}`;

  const chooseTool = (option: ToolOption) => {
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
  };

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
        return { ...current, image: `参考图 ${Math.min(getImageCount(current.image) + 1, 9)} 张` };
      }

      if (kind.key === 'audio' && current.audio) {
        return { ...current, audio: `参考音频 ${Math.min(getAudioCount(current.audio) + 1, 3)} 个` };
      }

      return { ...current, [kind.key]: value };
    });
    setActiveUpload(null);
    setUploadAnchor(null);
  };

  const fillMaterialFiles = async (kind: MaterialKind, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    const allowedFiles = kind.key === 'audio'
      ? incomingFiles.filter(isAllowedAudioFile)
      : incomingFiles;
    if (kind.key === 'audio' && allowedFiles.length < incomingFiles.length) {
      message.warning('参考音频仅支持 MP3 或 WAV 格式');
    }
    const selectedFiles = allowedFiles.slice(0, getRemainingCapacity(kind, selectedMaterials[kind.key]));
    if (selectedFiles.length === 0) return;

    const localFiles = await Promise.all(selectedFiles.map(async (file) => ({
      audioDuration: kind.key === 'audio' ? await readAudioDuration(file) : undefined,
      file,
      id: `${kind.key}-${crypto.randomUUID()}`,
      name: file.name,
      type: kind.key,
      url: URL.createObjectURL(file),
    }))) satisfies LocalMaterialFile[];

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

  const clearMaterial = (kind: MaterialKind) => {
    setSelectedMaterials((current) => {
      const next = { ...current };
      revokeLocalMaterials(getLocalFiles(next[kind.key]));
      delete next[kind.key];
      return next;
    });
  };

  const removeOneMaterial = (kind: MaterialKind) => {
    if (getLocalFiles(selectedMaterials[kind.key]).length > 0) {
      setSelectedMaterials((current) => {
        const currentFiles = getLocalFiles(current[kind.key]);
        revokeLocalMaterials(currentFiles.slice(-1));
        const nextFiles = currentFiles.slice(0, -1);
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

  const chooseLibraryAsset = (kind: MaterialKind, asset: ContentAsset) => {
    if (kind.key === 'audio' && !isAllowedAudioAsset(asset)) {
      message.warning('参考音频仅支持 MP3 或 WAV 格式');
      return;
    }
    const url = resolveAssetUrl(asset.fileUrl);
    const localMaterial = {
      assetId: asset.id,
      audioDuration: kind.key === 'audio' ? getAssetDurationSeconds(asset) : undefined,
      id: `${kind.key}-${asset.id}-${crypto.randomUUID()}`,
      name: asset.name || asset.originalFileName || asset.storedFileName || kind.label,
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

  return {
    activeParam,
    activeUpload,
    canGenerate,
    canvas,
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
    fillExamplePrompt,
    fillMaterial,
    fillMaterialFiles,
    clearMaterial,
    removeOneMaterial,
    replaceMaterialFiles,
    clearAllMaterials,
    filterOpen,
    filters,
    isLoadingLibraryAssets,
    materialMode,
    model,
    paramSummary,
    prompt,
    promptPanel,
    openModelPicker,
    quality,
    ratio,
    selectedMaterials,
    selectedModelAvatar,
    voiceAssets,
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
    showModelPicker,
    showToolMenu,
    tool,
    uploadAnchor,
    voiceEnabled,
  };
}

export type VideoTaskCloneState = ReturnType<typeof useVideoTaskCloneState>;

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

function getRemainingCapacity(kind: MaterialKind, current: SelectedMaterialValue) {
  return Math.max(getLimit(kind) - getLocalFiles(current).length, 0);
}

function getLimit(kind: MaterialKind) {
  if (kind.key === 'image') return 9;
  if (kind.key === 'audio') return 3;
  return 1;
}

function getLocalFiles(value: SelectedMaterialValue): LocalMaterialFile[] {
  return Array.isArray(value) ? value : [];
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
