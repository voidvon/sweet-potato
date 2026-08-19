import { useMemo, useState } from 'react';
import { message } from 'antd';
import {
  deleteLlmModelPricing,
  deleteModelConfig,
  listAudioModelProviders,
  listImageModelProviders,
  listLlmModelPricing,
  listModelConfigs,
  listVideoModelProviders,
  reorderModelConfigs,
  setDefaultModelConfig,
} from '../../../api/model-config';
import type {
  AudioModelProviderOption,
  ImageModelProviderOption,
  VideoModelProviderOption,
} from '../../../api/model-config';
import type { LlmModelPricing, ModelConfig, ModelType } from '../../../types';
import {
  audioProviderConfigRow,
  saveModelConfig,
  videoProviderConfigRow,
} from './modelSettingsHelpers';

export function useModelSettingsData() {
  const [audioProviders, setAudioProviders] = useState<AudioModelProviderOption[]>([]);
  const [imageProviders, setImageProviders] = useState<ImageModelProviderOption[]>([]);
  const [llmModelPricing, setLlmModelPricing] = useState<LlmModelPricing[]>([]);
  const [videoProviders, setVideoProviders] = useState<VideoModelProviderOption[]>([]);
  const [configsByType, setConfigsByType] = useState<Record<ModelType, ModelConfig[]>>({
    llm: [],
    image: [],
    video: [],
    audio: [],
  });
  const [loadingByType, setLoadingByType] = useState<Partial<Record<ModelType, boolean>>>({});
  const [loadedTypes, setLoadedTypes] = useState<Partial<Record<ModelType, boolean>>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [llmPricingModalOpen, setLlmPricingModalOpen] = useState(false);
  const [llmPricingEditorModalOpen, setLlmPricingEditorModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ModelConfig | null>(null);
  const [editingLlmPricing, setEditingLlmPricing] = useState<LlmModelPricing | null>(null);
  const [savingProviderId, setSavingProviderId] = useState('');
  const [sortingImageModels, setSortingImageModels] = useState(false);

  const audioConfigRows = useMemo(
    () => audioProviders.map((provider) => audioProviderConfigRow(
      provider,
      configsByType.audio.find((item) => item.type === 'audio' && item.provider === provider.id),
    )),
    [audioProviders, configsByType.audio],
  );
  const videoConfigRows = useMemo(
    () => videoProviders.map((provider) => videoProviderConfigRow(
      provider,
      configsByType.video.find((item) => item.type === 'video' && item.provider === provider.id),
    )),
    [videoProviders, configsByType.video],
  );

  async function loadConfigs(type: ModelType) {
    setLoadingByType((current) => ({ ...current, [type]: true }));
    try {
      if (type === 'audio') {
        const [rows, providers] = await Promise.all([listModelConfigs(type), listAudioModelProviders()]);
        setAudioProviders(providers);
        setConfigsByType((current) => ({ ...current, [type]: rows }));
      } else if (type === 'image') {
        const [rows, providers] = await Promise.all([listModelConfigs(type), listImageModelProviders()]);
        setImageProviders(providers);
        setConfigsByType((current) => ({ ...current, [type]: rows }));
      } else if (type === 'video') {
        const [rows, providers] = await Promise.all([listModelConfigs(type), listVideoModelProviders()]);
        setVideoProviders(providers);
        setConfigsByType((current) => ({ ...current, [type]: rows }));
      } else if (type === 'llm') {
        const [rows, pricing] = await Promise.all([listModelConfigs(type), listLlmModelPricing()]);
        setLlmModelPricing(pricing);
        setConfigsByType((current) => ({ ...current, [type]: rows }));
      } else {
        const rows = await listModelConfigs(type);
        setConfigsByType((current) => ({ ...current, [type]: rows }));
      }
      setLoadedTypes((current) => ({ ...current, [type]: true }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模型配置加载失败');
    } finally {
      setLoadingByType((current) => ({ ...current, [type]: false }));
    }
  }

  async function loadLlmModelPricing() {
    const pricing = await listLlmModelPricing();
    setLlmModelPricing(pricing);
  }

  function openCreateModal(activeType: ModelType) {
    if (activeType === 'audio' || activeType === 'video') {
      message.info(activeType === 'audio'
        ? '音频模型由服务端适配器提供，只能编辑 Key 和 Base URL'
        : '视频模型由服务端适配器提供，只需配置 API Key');
      return;
    }
    setEditingRecord(null);
    setModalOpen(true);
  }

  function openCreateLlmPricingModal() {
    setEditingLlmPricing(null);
    setLlmPricingEditorModalOpen(true);
  }

  function openLlmPricingModal() {
    setLlmPricingModalOpen(true);
  }

  function openEditLlmPricingModal(record: LlmModelPricing) {
    setEditingLlmPricing(record);
    setLlmPricingEditorModalOpen(true);
  }

  function openEditModal(record: ModelConfig) {
    setEditingRecord(record);
    setModalOpen(true);
  }

  async function handleSetDefault(activeType: ModelType, record: ModelConfig) {
    try {
      if (activeType === 'audio' && !record.id) {
        const provider = audioProviders.find((item) => item.id === record.provider);
        if (!provider) {
          throw new Error('音频服务商不存在');
        }
        await saveModelConfig(audioProviderConfigRow(provider, record, { isDefault: true }));
      } else if (activeType === 'video' && !record.id) {
        const provider = videoProviders.find((item) => item.id === record.provider);
        if (!provider) {
          throw new Error('视频服务商不存在');
        }
        await saveModelConfig(videoProviderConfigRow(provider, record, { isDefault: true }));
      } else if (record.id) {
        await setDefaultModelConfig(record.id);
      }
      message.success(`已将 ${record.name} 设为默认`);
      await loadConfigs(activeType);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '默认模型设置失败');
    }
  }

  async function handleDelete(activeType: ModelType, record: ModelConfig) {
    if (!record.id) {
      return;
    }
    try {
      await deleteModelConfig(record.id);
      message.success('模型配置已删除');
      await loadConfigs(activeType);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模型配置删除失败');
    }
  }

  async function handleDeleteLlmPricing(record: LlmModelPricing) {
    try {
      await deleteLlmModelPricing(record.id);
      message.success('LLM 官方价格目录已删除');
      await loadLlmModelPricing();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'LLM 官方价格目录删除失败');
    }
  }

  async function handleVideoModelChange(record: ModelConfig, model: string) {
    const provider = videoProviders.find((item) => item.id === record.provider);
    if (!provider) {
      message.error('视频服务商不存在');
      return;
    }
    setSavingProviderId(provider.id);
    try {
      await saveModelConfig(videoProviderConfigRow(provider, record, { model }));
      message.success('视频模型已更新');
      await loadConfigs('video');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '视频模型更新失败');
    } finally {
      setSavingProviderId('');
    }
  }

  async function handleMoveImageModel(record: ModelConfig, offset: -1 | 1) {
    const rows = configsByType.image;
    const currentIndex = rows.findIndex((item) => item.id === record.id);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= rows.length) {
      return;
    }

    const nextRows = [...rows];
    [nextRows[currentIndex], nextRows[nextIndex]] = [nextRows[nextIndex], nextRows[currentIndex]];
    setConfigsByType((current) => ({ ...current, image: nextRows }));
    setSortingImageModels(true);
    try {
      const savedRows = await reorderModelConfigs('image', nextRows.flatMap((item) => item.id ? [item.id] : []));
      setConfigsByType((current) => ({ ...current, image: savedRows }));
      message.success('图片模型顺序已保存');
    } catch (error) {
      setConfigsByType((current) => ({ ...current, image: rows }));
      message.error(error instanceof Error ? error.message : '图片模型排序保存失败');
    } finally {
      setSortingImageModels(false);
    }
  }

  async function handleModelSaved(activeType: ModelType) {
    setModalOpen(false);
    await loadConfigs(activeType);
  }

  async function handleLlmPricingSaved() {
    setLlmPricingEditorModalOpen(false);
    setEditingLlmPricing(null);
    await loadConfigs('llm');
  }

  return {
    audioConfigRows,
    audioProviders,
    configsByType,
    editingLlmPricing,
    editingRecord,
    handleDelete,
    handleDeleteLlmPricing,
    handleLlmPricingSaved,
    handleModelSaved,
    handleMoveImageModel,
    handleSetDefault,
    handleVideoModelChange,
    imageProviders,
    llmModelPricing,
    llmPricingEditorModalOpen,
    llmPricingModalOpen,
    loadedTypes,
    loadingByType,
    loadConfigs,
    modalOpen,
    openCreateLlmPricingModal,
    openCreateModal,
    openEditLlmPricingModal,
    openEditModal,
    openLlmPricingModal,
    savingProviderId,
    setLlmPricingEditorModalOpen,
    setLlmPricingModalOpen,
    setModalOpen,
    sortingImageModels,
    videoConfigRows,
    videoProviders,
  };
}
