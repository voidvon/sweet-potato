import { useMemo, useState } from 'react';
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
  SelectedMaterials,
  ToolOption,
  UploadAnchor,
} from './types';

export function useVideoTaskCloneState() {
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

  const canGenerate = useMemo(
    () => prompt.trim().length > 0 || Object.keys(selectedMaterials).length > 0,
    [prompt, selectedMaterials],
  );

  const canvas = `${ratio} · ${quality}`;
  const paramSummary = `${model} · ${canvas} · ${duration}`;

  const chooseTool = (option: ToolOption) => {
    setTool(option);
    setShowToolMenu(false);
    setMaterialMode(null);
    setSelectedMaterials({});
    setActiveUpload(null);
    setUploadAnchor(null);
    setActiveParam(null);
    setPromptPanel(null);
    setFilterOpen(false);
  };

  const chooseMaterialTab = (mode: MaterialMode) => {
    setMaterialMode(mode);
    setActiveUpload(null);
    setUploadAnchor(null);
    setActiveParam(null);
    setPromptPanel(null);
    setFilterOpen(false);
    if (mode === 'model') {
      setShowModelPicker(true);
      setMaterialMode(null);
    }
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

  const clearMaterial = (kind: MaterialKind) => {
    setSelectedMaterials((current) => {
      const next = { ...current };
      delete next[kind.key];
      return next;
    });
  };

  const removeOneMaterial = (kind: MaterialKind) => {
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
    setSelectedMaterials({});
    setActiveUpload(null);
    setUploadAnchor(null);
    setMaterialMode(null);
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

  const chooseModelAvatar = (name: string) => {
    setSelectedModelAvatar(name);
    setSelectedMaterials((current) => ({ ...current, image: name }));
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
    chooseMaterialTab,
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
    clearMaterial,
    removeOneMaterial,
    clearAllMaterials,
    filterOpen,
    filters,
    materialMode,
    model,
    paramSummary,
    prompt,
    promptPanel,
    quality,
    ratio,
    selectedMaterials,
    selectedModelAvatar,
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
    setVoiceEnabled,
    showModelPicker,
    showToolMenu,
    tool,
    uploadAnchor,
    voiceEnabled,
  };
}

export type VideoTaskCloneState = ReturnType<typeof useVideoTaskCloneState>;

function getImageCount(value: string | undefined) {
  if (!value) return 0;
  const matched = value.match(/(\d+)\s*张/);
  if (matched) return Math.min(Number(matched[1]), 9);
  const indexed = value.match(/(\d+)/);
  if (indexed) return Math.min(Number(indexed[1]), 9);
  return 1;
}

function getAudioCount(value: string | undefined) {
  if (!value) return 0;
  const matched = value.match(/参考音频\s*(\d+)\s*个/);
  if (matched) return Math.min(Number(matched[1]), 3);
  return 1;
}
