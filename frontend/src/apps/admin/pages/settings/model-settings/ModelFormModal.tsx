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
import { t } from '@shared/i18n';

type ModelFormModalProps = {
  activeType: ModelType;
  audioProviders: AudioModelProviderOption[];
  imageProviders: ImageModelProviderOption[];
  llmModelPricing: LlmModelPricing[];
  videoProviders: VideoModelProviderOption[];
  editingRecord: ModelConfig | null;
  open: boolean;
  onCancel: () => void;
  onOpenLlmPricing: () => void;
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
  onOpenLlmPricing,
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
  const llmModelOptions = useMemo(() => llmModelPricing.map((pricing) => ({
    label: `${pricing.displayName} (${pricing.providerName})`,
    value: pricing.id,
  })), [llmModelPricing]);

  function applyLlmPricing(pricing: LlmModelPricing) {
    const currentSettings = (form.getFieldValue('settings') || {}) as Record<string, unknown>;
    const currentBilling = ((currentSettings.billing || {}) as Partial<LlmBillingSettings>);
    form.setFieldsValue({
      llmPricingId: pricing.id,
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
    form.resetFields();
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
      const { llmPricingId, ...payload } = values;
      if (activeType === 'audio' && editingRecord) {
        if (!audioProvider) {
          throw new Error(t("音频服务商不存在"));
        }
        await saveModelConfig(audioProviderConfigRow(audioProvider, editingRecord, {
          apiKey: payload.apiKey,
          baseUrl: payload.baseUrl,
          settings: payload.settings,
        }));
      } else if (activeType === 'video' && editingRecord) {
        if (!videoProvider) {
          throw new Error(t("视频服务商不存在"));
        }
        await saveModelConfig(videoProviderConfigRow(videoProvider, editingRecord, {
          apiKey: payload.apiKey,
          settings: payload.settings,
        }));
      } else {
        if (activeType === 'llm') {
          const pricing = llmModelPricing.find((item) => item.id === llmPricingId);
          if (!pricing) {
            throw new Error(t("请选择官方价格目录中的模型"));
          }
          const llmSettings = { ...((payload.settings || {}) as Record<string, unknown>) };
          delete llmSettings.contextWindowTokens;
          delete llmSettings.contextWindow;
          delete llmSettings.modelContextWindow;
          delete llmSettings.effectiveContextWindowPercent;
          delete llmSettings.effectiveWindowPercent;
          const currentBilling = llmSettings.billing as Partial<LlmBillingSettings> | undefined;
          await saveModelConfig({
            ...defaultFormValues,
            ...editingRecord,
            ...payload,
            type: activeType,
            provider: pricing.provider,
            model: pricing.model,
            // Keep the URL entered in the form. The pricing catalog supplies
            // the provider/model defaults, but must not overwrite a custom
            // compatible endpoint when an existing LLM config is saved.
            baseUrl: payload.baseUrl,
            settings: {
              ...llmSettings,
              billing: llmBillingFromPricing(pricing, currentBilling || {}),
            },
          });
          message.success(t("模型配置已保存"));
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
      message.success(t("模型配置已保存"));
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("模型配置保存失败"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      className={activeType === 'audio' || activeType === 'video' ? 'audio-model-modal' : undefined}
      confirmLoading={saving}
      okText={t("保存")}
      cancelText={t("取消")}
      onCancel={onCancel}
      onOk={() => form.submit()}
      open={open}
      title={editingRecord ? t("编辑模型配置") : t("新增{{0}}", { "0": modelTypeLabelMap[activeType] })}
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
            imageModelOptions={imageModelOptions}
            imageProviderOptions={imageProviderOptions}
            llmModelOptions={llmModelOptions}
            onImageProviderChange={handleImageProviderChange}
            onLlmModelChange={(pricingId) => {
              const pricing = llmModelPricing.find((item) => item.id === pricingId);
              if (pricing) {
                applyLlmPricing(pricing);
              }
            }}
            onOpenLlmPricing={onOpenLlmPricing}
          />
        )}
      </Form>
    </Modal>
  );
}
