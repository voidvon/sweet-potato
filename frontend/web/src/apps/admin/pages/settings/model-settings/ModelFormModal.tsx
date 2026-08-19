import { useEffect, useMemo, useState } from 'react';
import { Form, Modal, message } from 'antd';
import type {
  AudioModelProviderOption,
  ImageModelProviderOption,
  VideoModelProviderOption,
} from '../../../api/model-config';
import type { LlmBillingSettings, LlmModelPricing, ModelConfig, ModelType } from '../../../types';
import { defaultFormValues, modelTypeLabelMap } from './modelSettingsConstants';
import { AudioVideoModelFields, StandardModelFields } from './ModelFormFields';
import {
  type ModelFormValues,
  audioProviderConfigRow,
  findLlmPricing,
  llmBillingFromPricing,
  normalizeImagePayload,
  normalizedSettingsForForm,
  saveModelConfig,
  toNumericValue,
  videoProviderConfigRow,
} from './modelSettingsHelpers';

type ModelFormModalProps = {
  activeType: ModelType;
  audioProviders: AudioModelProviderOption[];
  imageProviders: ImageModelProviderOption[];
  llmModelPricing: LlmModelPricing[];
  videoProviders: VideoModelProviderOption[];
  editingRecord: ModelConfig | null;
  open: boolean;
  onCancel: () => void;
  onSaved: () => void;
};

export function ModelFormModal({
  activeType,
  audioProviders,
  imageProviders,
  llmModelPricing,
  videoProviders,
  editingRecord,
  open,
  onCancel,
  onSaved,
}: ModelFormModalProps) {
  const [form] = Form.useForm<ModelFormValues>();
  const [saving, setSaving] = useState(false);
  const selectedImageProviderId = Form.useWatch('provider', form);
  const audioProvider = activeType === 'audio' && editingRecord
    ? audioProviders.find((item) => item.id === editingRecord.provider)
    : undefined;
  const videoProvider = activeType === 'video' && editingRecord
    ? videoProviders.find((item) => item.id === editingRecord.provider)
    : undefined;
  const imageProviderOptions = useMemo(() => imageProviders.map((provider) => ({
    label: provider.name,
    value: provider.id,
  })), [imageProviders]);
  const selectedImageProvider = activeType === 'image'
    ? imageProviders.find((provider) => provider.id === selectedImageProviderId)
    : undefined;
  const imageModelOptions = useMemo(() => {
    const options = (selectedImageProvider?.models || []).map((model) => ({
      label: `${model.name} (${model.id})`,
      value: model.id,
      disabled: model.disabled,
    }));
    const currentModel = String(form.getFieldValue('model') || '').trim();
    if (currentModel && !options.some((item) => item.value === currentModel)) {
      return [{ label: currentModel, value: currentModel }, ...options];
    }
    return options;
  }, [form, selectedImageProvider]);

  function applyLlmPricing(pricing: LlmModelPricing) {
    const currentSettings = (form.getFieldValue('settings') || {}) as Record<string, unknown>;
    const currentBilling = ((currentSettings.billing || {}) as Partial<LlmBillingSettings>);
    form.setFieldsValue({
      provider: pricing.provider,
      model: pricing.model,
      baseUrl: pricing.defaultBaseUrl,
      settings: {
        ...currentSettings,
        billing: llmBillingFromPricing(pricing, currentBilling),
      },
    });
  }

  function handleImageProviderChange(providerId: string) {
    const provider = imageProviders.find((item) => item.id === providerId);
    if (!provider) {
      return;
    }
    const currentSettings = (form.getFieldValue('settings') || {}) as Record<string, unknown>;
    const defaultSettings = provider.defaultSettings && typeof provider.defaultSettings === 'object'
      ? provider.defaultSettings
      : {};
    const currentImageGeneration = currentSettings.imageGeneration && typeof currentSettings.imageGeneration === 'object' && !Array.isArray(currentSettings.imageGeneration)
      ? currentSettings.imageGeneration as Record<string, unknown>
      : {};
    const defaultImageGeneration = defaultSettings.imageGeneration && typeof defaultSettings.imageGeneration === 'object' && !Array.isArray(defaultSettings.imageGeneration)
      ? defaultSettings.imageGeneration as Record<string, unknown>
      : {};
    form.setFieldsValue({
      name: provider.name,
      provider: provider.id,
      model: provider.defaultModel,
      baseUrl: provider.defaultBaseUrl,
      settings: {
        ...currentSettings,
        ...defaultSettings,
        imageGeneration: {
          ...currentImageGeneration,
          ...defaultImageGeneration,
        },
        billing: currentSettings.billing,
      },
    });
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue({
      ...defaultFormValues,
      type: activeType,
      ...(editingRecord || {}),
      settings: normalizedSettingsForForm(editingRecord, activeType),
    });

    if (activeType === 'llm') {
      const provider = editingRecord?.provider || defaultFormValues.provider;
      const model = editingRecord?.model || defaultFormValues.model;
      const pricing = findLlmPricing(llmModelPricing, provider, model);
      if (pricing) {
        applyLlmPricing(pricing);
      }
    } else if (activeType === 'image' && !editingRecord && imageProviders.length) {
      handleImageProviderChange(imageProviders[0].id);
    }
  }, [activeType, editingRecord, form, imageProviders, llmModelPricing, open]);

  async function handleSubmit(values: ModelFormValues) {
    setSaving(true);
    try {
      const payload = values;
      if (activeType === 'audio' && editingRecord) {
        if (!audioProvider) {
          throw new Error('音频服务商不存在');
        }
        await saveModelConfig(audioProviderConfigRow(audioProvider, editingRecord, {
          apiKey: payload.apiKey,
          baseUrl: payload.baseUrl,
          settings: payload.settings,
        }));
      } else if (activeType === 'video' && editingRecord) {
        if (!videoProvider) {
          throw new Error('视频服务商不存在');
        }
        await saveModelConfig(videoProviderConfigRow(videoProvider, editingRecord, {
          apiKey: payload.apiKey,
          settings: payload.settings,
        }));
      } else {
        if (activeType === 'llm') {
          const pricing = findLlmPricing(llmModelPricing, payload.provider, payload.model);
          if (!pricing) {
            await saveModelConfig({
              ...defaultFormValues,
              ...editingRecord,
              ...payload,
              type: activeType,
              settings: payload.settings || {},
            });
            message.success('模型配置已保存');
            onSaved();
            return;
          }
          const currentBilling = ((payload.settings || {}) as Record<string, unknown>).billing as Partial<LlmBillingSettings> | undefined;
          await saveModelConfig({
            ...defaultFormValues,
            ...editingRecord,
            ...payload,
            type: activeType,
            provider: pricing.provider,
            model: pricing.model,
            baseUrl: pricing.defaultBaseUrl,
            settings: {
              ...(payload.settings || {}),
              billing: llmBillingFromPricing(pricing, currentBilling || {}),
            },
          });
          message.success('模型配置已保存');
          onSaved();
          return;
        }
        const nextPayload = {
          ...defaultFormValues,
          ...editingRecord,
          ...payload,
          type: activeType,
          settings: payload.settings || {},
        };
        await saveModelConfig(activeType === 'image' ? normalizeImagePayload(nextPayload) : nextPayload);
      }
      message.success('模型配置已保存');
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '模型配置保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      className={activeType === 'audio' || activeType === 'video' ? 'audio-model-modal' : undefined}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
      open={open}
      title={editingRecord ? '编辑模型配置' : `新增${modelTypeLabelMap[activeType]}`}
      width={activeType === 'audio' || activeType === 'video' ? 760 : 720}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
        {(activeType === 'audio' || activeType === 'video') && editingRecord ? (
          <AudioVideoModelFields
            activeType={activeType}
            audioProvider={audioProvider}
            editingRecord={editingRecord}
            videoProvider={videoProvider}
          />
        ) : (
          <StandardModelFields
            activeType={activeType}
            form={form}
            imageModelOptions={imageModelOptions}
            imageProviderOptions={imageProviderOptions}
            onImageProviderChange={handleImageProviderChange}
          />
        )}
      </Form>
    </Modal>
  );
}
