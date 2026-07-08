import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import { PlusOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import {
  createLlmModelPricing,
  createModelConfig,
  deleteLlmModelPricing,
  deleteModelConfig,
  listAudioModelProviders,
  listImageModelProviders,
  listLlmModelPricing,
  listModelConfigs,
  listVideoModelProviders,
  setDefaultModelConfig,
  updateLlmModelPricing,
  updateModelConfig,
} from '../../api/model-config';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type { AudioModelProviderOption, ImageModelProviderOption, VideoModelProviderOption } from '../../api/model-config';
import type {
  AudioBillingSettings,
  ImageBillingSettings,
  LlmBillingSettings,
  LlmModelPricing,
  ModelConfig,
  ModelType,
  VideoBillingSettings,
} from '../../types';
import './ModelSettingsPage.scss';

const visibleModelTypes: Array<{ key: ModelType; label: string }> = [
  { key: 'llm', label: 'LLM 模型' },
  { key: 'image', label: '图片模型' },
  { key: 'video', label: '视频模型' },
  // { key: 'audio', label: '音频模型' },
];

function modelTypeFromTabParam(value: string | null): ModelType {
  return visibleModelTypes.some((item) => item.key === value) ? value as ModelType : 'llm';
}

function saveModelConfig(values: ModelConfig) {
  return values.id ? updateModelConfig(values.id, values) : createModelConfig(values);
}

const defaultFormValues: ModelConfig = {
  type: 'llm',
  name: '',
  provider: '',
  model: '',
  apiKey: '',
  baseUrl: '',
  temperature: 0.7,
  settings: {
    billing: {
      multiplier: 1,
      inputCreditsPer1M: 0,
      outputCreditsPer1M: 0,
      cachedInputCreditsPer1M: 0,
      maxOutputCreditsForReserve: 0,
      priceSource: 'official-manual',
    },
  },
  isDefault: false,
};

const modelTypeLabelMap: Record<ModelType, string> = {
  llm: 'LLM 模型',
  image: '图片模型',
  video: '视频模型',
  audio: '音频模型',
};

type ModelColumn = NonNullable<TableProps<ModelConfig>['columns']>[number];
type LlmPriceTableRow = {
  key: string;
  billing: Partial<LlmBillingSettings>;
  multiplier: number;
};

function toNumericValue(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toTwoDecimalValue(value: unknown, fallback = 0) {
  return Math.round((toNumericValue(value, fallback) + Number.EPSILON) * 100) / 100;
}

function currencySymbol(currency?: LlmBillingSettings['priceCurrency']) {
  return currency === 'CNY' ? '¥' : '$';
}

function formatOfficialPer1MTokens(value: unknown, currency?: LlmBillingSettings['priceCurrency']) {
  return `${currencySymbol(currency)}${toNumericValue(value, 0).toFixed(4)} / 1M Tokens`;
}

function formatCreditPer1MTokens(value: unknown) {
  return `${toNumericValue(value, 0).toFixed(4)} Credit / 1M Tokens`;
}

function renderLlmPriceLines(billing: Partial<LlmBillingSettings>, options: { multiplier?: number; official?: boolean } = {}) {
  const priceRows = [
    { label: '输入价格', value: billing.inputCreditsPer1M },
    { label: '补全价格', value: billing.outputCreditsPer1M },
    { label: '缓存价格', value: billing.cachedInputCreditsPer1M },
  ];
  const multiplier = options.multiplier ?? 1;

  return (
    <div className="llm-price-lines">
      {priceRows.map((item) => (
        <div className="llm-price-line" key={item.label}>
          <span>{item.label}</span>
          <strong>
            {options.official
              ? formatOfficialPer1MTokens(item.value, billing.priceCurrency)
              : formatCreditPer1MTokens(toNumericValue(item.value, 0) * multiplier)}
          </strong>
        </div>
      ))}
    </div>
  );
}

function renderCompactLlmOfficialPriceLines(pricing: LlmModelPricing) {
  const priceRows = [
    { label: '输入价格', value: pricing.inputPricePer1M },
    { label: '补全价格', value: pricing.outputPricePer1M },
    { label: '缓存价格', value: pricing.cachedInputPricePer1M },
  ];

  return (
    <div className="llm-price-lines">
      {priceRows.map((item) => (
        <div className="llm-price-line-compact" key={item.label}>
          <span>{item.label}</span>
          <strong>{formatOfficialPer1MTokens(item.value, pricing.currency)}</strong>
        </div>
      ))}
    </div>
  );
}

function findLlmPricing(catalog: LlmModelPricing[], provider: string, model: string) {
  return catalog.find((item) => item.provider === provider && item.model === model);
}

function findLlmPricingById(catalog: LlmModelPricing[], id: string) {
  return catalog.find((item) => item.id === id);
}

function llmBillingFromPricing(pricing: LlmModelPricing, currentBilling: Partial<LlmBillingSettings> = {}): LlmBillingSettings {
  return {
    multiplier: toNumericValue(currentBilling.multiplier, 1),
    inputCreditsPer1M: pricing.inputPricePer1M,
    outputCreditsPer1M: pricing.outputPricePer1M,
    cachedInputCreditsPer1M: pricing.cachedInputPricePer1M,
    maxOutputCreditsForReserve: toNumericValue(currentBilling.maxOutputCreditsForReserve, 0),
    priceCurrency: pricing.currency,
    priceSource: pricing.priceSource,
    priceUpdatedAt: pricing.priceUpdatedAt,
  };
}

function llmBillingSettingsOf(record: ModelConfig): LlmBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    multiplier: toNumericValue(billing.multiplier, 1),
    inputCreditsPer1M: toNumericValue(billing.inputCreditsPer1M, toNumericValue(billing.inputUsdPer1M, 0)),
    outputCreditsPer1M: toNumericValue(billing.outputCreditsPer1M, toNumericValue(billing.outputUsdPer1M, 0)),
    cachedInputCreditsPer1M: toNumericValue(
      billing.cachedInputCreditsPer1M,
      toNumericValue(billing.cachedInputUsdPer1M, 0),
    ),
    maxOutputCreditsForReserve: toNumericValue(
      billing.maxOutputCreditsForReserve,
      toNumericValue(billing.maxOutputTokensForReserve, 100),
    ),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
    priceCurrency: billing.priceCurrency === 'CNY' ? 'CNY' : billing.priceCurrency === 'USD' ? 'USD' : undefined,
    priceUpdatedAt: typeof billing.priceUpdatedAt === 'string' && billing.priceUpdatedAt.trim()
      ? billing.priceUpdatedAt.trim()
      : undefined,
  };
}

function imageBillingSettingsOf(record: ModelConfig): ImageBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    creditsPerRequest: toTwoDecimalValue(billing.creditsPerRequest, toNumericValue(billing.perRequestUsd, 0)),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
  };
}

function imageGenerationSettingsOf(record: ModelConfig | null) {
  const settings = record?.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  return settings.imageGeneration && typeof settings.imageGeneration === 'object'
    ? settings.imageGeneration as Record<string, unknown>
    : {};
}

function imageGenerationSupportsCustomResolutionOf(record: ModelConfig | null) {
  return imageGenerationSettingsOf(record).supportsCustomResolution === true;
}

function imageGenerationSummary(record: ModelConfig) {
  const items = [
    imageGenerationSupportsCustomResolutionOf(record) ? '支持自定义分辨率' : '固定分辨率',
  ].filter(Boolean);
  return items.join('，') || '默认参数';
}

function videoBillingSettingsOf(record: ModelConfig): VideoBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    multiplier: toNumericValue(billing.multiplier, 1),
    creditsPer1MTokens: toNumericValue(billing.creditsPer1MTokens, toNumericValue(billing.usdPer1MTokens, 0)),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
  };
}

function audioBillingSettingsOf(record: ModelConfig): AudioBillingSettings {
  const settings = record.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};
  const billing = settings.billing && typeof settings.billing === 'object'
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    multiplier: toNumericValue(billing.multiplier, 1),
    voiceCloneCredits: toNumericValue(billing.voiceCloneCredits, toNumericValue(billing.voiceCloneUsd, 0)),
    speechCreditsPer1kChars: toNumericValue(
      billing.speechCreditsPer1kChars,
      toNumericValue(billing.speechUsdPer1kChars, 0),
    ),
    priceSource: typeof billing.priceSource === 'string' && billing.priceSource.trim()
      ? billing.priceSource.trim()
      : 'official-manual',
  };
}

function normalizedSettingsForForm(record: ModelConfig | null, activeType: ModelType) {
  const settings = record?.settings && typeof record.settings === 'object'
    ? record.settings as Record<string, unknown>
    : {};

  const billing = activeType === 'llm'
    ? llmBillingSettingsOf(record || defaultFormValues)
    : activeType === 'image'
      ? imageBillingSettingsOf(record || defaultFormValues)
      : activeType === 'video'
        ? videoBillingSettingsOf(record || defaultFormValues)
        : audioBillingSettingsOf(record || defaultFormValues);

  return {
    ...settings,
    ...(activeType === 'image'
      ? {
        imageGeneration: {
          ...imageGenerationSettingsOf(record),
          supportsCustomResolution: imageGenerationSupportsCustomResolutionOf(record),
        },
      }
      : {}),
    billing,
  };
}

function audioProviderConfigRow(provider: AudioModelProviderOption, existing?: ModelConfig, overrides: Partial<ModelConfig> = {}): ModelConfig {
  const baseRecord = {
    ...defaultFormValues,
    ...existing,
    ...overrides,
  };
  return {
    ...baseRecord,
    type: 'audio',
    name: provider.name,
    provider: provider.id,
    model: provider.defaultModel,
    baseUrl: overrides.baseUrl ?? existing?.baseUrl ?? provider.defaultBaseUrl ?? '',
    temperature: existing?.temperature ?? 0.7,
    settings: {
      ...(existing?.settings || {}),
      ...(overrides.settings || {}),
      billing: {
        ...audioBillingSettingsOf(baseRecord as ModelConfig),
        ...(overrides.settings && typeof overrides.settings === 'object' && 'billing' in overrides.settings
          ? ((overrides.settings as Record<string, unknown>).billing as Record<string, unknown> || {})
          : {}),
      },
    },
    apiKey: overrides.apiKey ?? existing?.apiKey ?? '',
    isDefault: Boolean(overrides.isDefault ?? existing?.isDefault ?? false),
  };
}

function videoProviderConfigRow(provider: VideoModelProviderOption, existing?: ModelConfig, overrides: Partial<ModelConfig> = {}): ModelConfig {
  const baseRecord = {
    ...defaultFormValues,
    ...existing,
    ...overrides,
  };
  return {
    ...baseRecord,
    type: 'video',
    name: provider.name,
    provider: provider.id,
    model: overrides.model || existing?.model || provider.defaultModel,
    baseUrl: overrides.baseUrl ?? existing?.baseUrl ?? provider.defaultBaseUrl,
    temperature: 0,
    settings: {
      ...(existing?.settings || {}),
      ...(overrides.settings || {}),
      billing: {
        ...videoBillingSettingsOf(baseRecord as ModelConfig),
        ...(overrides.settings && typeof overrides.settings === 'object' && 'billing' in overrides.settings
          ? ((overrides.settings as Record<string, unknown>).billing as Record<string, unknown> || {})
          : {}),
      },
    },
    apiKey: overrides.apiKey ?? existing?.apiKey ?? '',
    isDefault: Boolean(overrides.isDefault ?? existing?.isDefault ?? false),
  };
}

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

type ModelFormValues = ModelConfig & {
  llmPricingId?: string;
};

type LlmPricingFormValues = LlmModelPricing;

function normalizeImagePayload(payload: ModelConfig): ModelConfig {
  const settings = payload.settings && typeof payload.settings === 'object'
    ? payload.settings
    : {};
  const billing = settings.billing && typeof settings.billing === 'object' && !Array.isArray(settings.billing)
    ? settings.billing as Record<string, unknown>
    : {};
  return {
    ...payload,
    settings: {
      ...settings,
      billing: {
        ...billing,
        creditsPerRequest: toTwoDecimalValue(
          billing.creditsPerRequest,
          toNumericValue(billing.perRequestUsd, 0),
        ),
      },
    },
  };
}

function ModelFormModal({
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
  const llmModelOptions = useMemo(() => {
    const groups = llmModelPricing.reduce<Record<string, { label: string; options: Array<{ label: string; value: string }> }>>(
      (current, item) => {
        const groupKey = (item.providerName || item.provider).trim().toLowerCase();
        const group = current[groupKey] || { label: item.providerName || item.provider, options: [] };
        group.options.push({
          label: `${item.displayName} (${item.model})`,
          value: item.id,
        });
        return { ...current, [groupKey]: group };
      },
      {},
    );
    return Object.values(groups);
  }, [llmModelPricing]);
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

  function handleLlmModelChange(pricingId: string) {
    const pricing = findLlmPricingById(llmModelPricing, pricingId);
    if (pricing) {
      applyLlmPricing(pricing);
    }
  }

  function handleImageProviderChange(providerId: string) {
    const provider = imageProviders.find((item) => item.id === providerId);
    if (!provider) {
      return;
    }
    form.setFieldsValue({
      name: provider.name,
      provider: provider.id,
      model: provider.defaultModel,
      baseUrl: provider.defaultBaseUrl,
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
      } else {
        form.setFieldValue('llmPricingId', undefined);
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
          const pricing = llmPricingId ? findLlmPricingById(llmModelPricing, llmPricingId) : undefined;
          if (!pricing) {
            throw new Error('请选择价格目录中的 LLM 模型');
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
          <div className="audio-model-form">
            <div className="audio-form-section">
              <div className="section-heading">
                <div>
                  <h3>{editingRecord.name}</h3>
                  <p>
                    {activeType === 'audio'
                      ? (audioProvider?.description || '服务端内置音频模型')
                      : (videoProvider?.description || '服务端内置视频模型')}
                  </p>
                </div>
              </div>
              <Form.Item
                label={activeType === 'audio'
                  ? (audioProvider?.keyLabel || 'API Key')
                  : (videoProvider?.keyLabel || 'API Key')}
                name="apiKey"
              >
                <Input.Password
                  placeholder={activeType === 'audio'
                    ? (audioProvider?.keyPlaceholder || '请输入 API Key')
                    : (videoProvider?.keyPlaceholder || '请输入 API Key')}
                />
              </Form.Item>
              {activeType === 'audio' ? (
                <Form.Item
                  extra={audioProvider?.baseUrlHelp}
                  label={audioProvider?.baseUrlLabel || 'Base URL'}
                  name="baseUrl"
                >
                  <Input placeholder={audioProvider?.baseUrlPlaceholder || '请输入 Base URL'} />
                </Form.Item>
              ) : (
                <div className="model-subtext">
                  默认 Base URL：{videoProvider?.defaultBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3'}
                </div>
              )}
              <div className="model-subtext">
                这里配置该模型的业务计费参数，所有消耗都会直接按积分口径计算。
              </div>
              <Form.Item
                label="模型消耗倍率"
                name={['settings', 'billing', 'multiplier']}
                rules={[{ required: true, message: '请输入模型消耗倍率' }]}
              >
                <InputNumber controls={false} min={0} precision={2} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
              {activeType === 'audio' ? (
                <>
                  <Form.Item
                    label="声音克隆单价 (Credit / 次)"
                    name={['settings', 'billing', 'voiceCloneCredits']}
                    rules={[{ required: true, message: '请输入声音克隆单价' }]}
                  >
                    <InputNumber min={0} precision={6} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    label="语音合成单价 (Credit / 1K 字符)"
                    name={['settings', 'billing', 'speechCreditsPer1kChars']}
                    rules={[{ required: true, message: '请输入语音合成单价' }]}
                  >
                    <InputNumber min={0} precision={6} style={{ width: '100%' }} />
                  </Form.Item>
                </>
              ) : (
                <Form.Item
                  label="视频生成单价 (Credit / 1M tokens)"
                  name={['settings', 'billing', 'creditsPer1MTokens']}
                  rules={[{ required: true, message: '请输入视频生成单价' }]}
                >
                  <InputNumber min={0} precision={2} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              )}
              <Form.Item
                label="价格来源备注"
                name={['settings', 'billing', 'priceSource']}
              >
                <Input placeholder="例如：official-manual-2026-06-12" />
              </Form.Item>
            </div>
          </div>
        ) : (
          <div className="antd-form-grid">
            <Form.Item
              label="配置名称"
              name="name"
              rules={[{ required: true, message: '请输入配置名称' }]}
            >
              <Input placeholder="例如：OpenAI 主力模型" />
            </Form.Item>
            <Form.Item
              label="服务商"
              name="provider"
              rules={[{ required: true, message: activeType === 'image' ? '请选择服务商' : '请输入服务商' }]}
            >
              {activeType === 'image' ? (
                <Select
                  options={imageProviderOptions}
                  onChange={handleImageProviderChange}
                  placeholder="请选择图片服务商"
                />
              ) : (
                <Input disabled={activeType === 'llm'} placeholder="openai-images / volcengine-seedream / Runway" />
              )}
            </Form.Item>
            <Form.Item
              label="模型名称"
              name={activeType === 'llm' ? 'llmPricingId' : 'model'}
              rules={[{ required: true, message: activeType === 'llm' ? '请选择模型名称' : '请输入模型名称' }]}
            >
              {activeType === 'llm' ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={llmModelOptions}
                  onChange={handleLlmModelChange}
                  placeholder="请选择模型"
                />
              ) : activeType === 'image' ? (
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={imageModelOptions}
                  placeholder="请选择图片模型"
                />
              ) : (
                <Input placeholder="gpt-image-1 / doubao-seedream-5-0-260128 / flux-pro" />
              )}
            </Form.Item>
            {activeType === 'llm' && (
              <Form.Item label="Temperature" name="temperature">
                <InputNumber max={2} min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            )}
            <Form.Item
              className="full-span"
              extra={activeType === 'image' ? '图片模型填写 API 根地址即可，不要填写 /images/edits 或 /images/generations。' : undefined}
              label="Base URL"
              name="baseUrl"
              rules={[{ required: true, message: '请输入 Base URL' }]}
            >
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item className="full-span" label="API Key" name="apiKey">
              <Input.Password placeholder="请输入 API Key" />
            </Form.Item>
            {activeType === 'llm' && (
              <>
                <div className="full-span model-subtext">
                  LLM 计费只允许调整倍率。官方价格固定取自“官方价格管理”，实际扣费按官方价格乘以模型倍率计算。
                </div>
                <Form.Item className="full-span llm-price-form-item" shouldUpdate>
                  {({ getFieldValue }) => {
                    const billing = (getFieldValue(['settings', 'billing']) || {}) as Partial<LlmBillingSettings>;
                    const multiplier = toNumericValue(billing.multiplier, 1);
                    const llmPriceColumns: TableProps<LlmPriceTableRow>['columns'] = [
                      {
                        title: '倍率',
                        dataIndex: 'multiplier',
                        width: 100,
                        render: () => (
                          <Form.Item
                            name={['settings', 'billing', 'multiplier']}
                            rules={[{ required: true, message: '请输入模型消耗倍率' }]}
                            noStyle
                          >
                            <InputNumber controls={false} min={0.01} precision={2} step={0.01} style={{ width: '100%' }} />
                          </Form.Item>
                        ),
                      },
                      {
                        title: '官方价格',
                        dataIndex: 'billing',
                        render: (_, record) => renderLlmPriceLines(record.billing, { official: true }),
                      },
                      {
                        title: '扣费价格',
                        dataIndex: 'actualBilling',
                        render: (_, record) => renderLlmPriceLines(record.billing, { multiplier: record.multiplier }),
                      },
                    ];

                    return (
                      <Table<LlmPriceTableRow>
                        className="llm-price-table"
                        columns={llmPriceColumns}
                        dataSource={[{ key: 'pricing', billing, multiplier }]}
                        pagination={false}
                        rowKey="key"
                      />
                    );
                  }}
                </Form.Item>
                <Form.Item
                  hidden
                  name={['settings', 'billing', 'inputCreditsPer1M']}
                  rules={[{ required: true, message: '请输入输入价格' }]}
                >
                  <InputNumber min={0} precision={6} />
                </Form.Item>
                <Form.Item
                  hidden
                  name={['settings', 'billing', 'outputCreditsPer1M']}
                  rules={[{ required: true, message: '请输入输出价格' }]}
                >
                  <InputNumber min={0} precision={6} />
                </Form.Item>
                <Form.Item
                  hidden
                  name={['settings', 'billing', 'cachedInputCreditsPer1M']}
                  rules={[{ required: true, message: '请输入缓存命中输入价格' }]}
                >
                  <InputNumber min={0} precision={6} />
                </Form.Item>
                <Form.Item
                  label="LLM 请求门槛 (Credit)"
                  extra="设置为 0 表示账户积分大于 0 就可以发起请求；设置为 100 表示账户积分必须大于 100 才能请求。"
                  name={['settings', 'billing', 'maxOutputCreditsForReserve']}
                  rules={[{ required: true, message: '请输入 LLM 请求门槛' }]}
                >
                  <InputNumber
                    min={0}
                    precision={2}
                    step={0.01}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item
                  className="full-span"
                  label="官方价格来源"
                  name={['settings', 'billing', 'priceSource']}
                >
                  <Input disabled placeholder="选择模型后自动从官方价格目录读取" />
                </Form.Item>
                <Form.Item hidden name={['settings', 'billing', 'priceCurrency']}>
                  <Input />
                </Form.Item>
                <Form.Item hidden name={['settings', 'billing', 'priceUpdatedAt']}>
                  <Input />
                </Form.Item>
              </>
            )}
            {activeType === 'video' && (
              <Form.Item className="full-span" name={['settings', 'supportsAudioInput']} valuePropName="checked">
                <Checkbox>支持音频输入</Checkbox>
              </Form.Item>
            )}
            {activeType === 'image' && (
              <>
                <Form.Item
                  className="full-span"
                  name={['settings', 'imageGeneration', 'supportsCustomResolution']}
                  valuePropName="checked"
                >
                  <Checkbox>支持自定义分辨率</Checkbox>
                </Form.Item>
                <Form.Item
                  label="图片生成单价 (Credit / 张)"
                  name={['settings', 'billing', 'creditsPerRequest']}
                  rules={[{ required: true, message: '请输入图片生成单价' }]}
                >
                  <InputNumber<number>
                    formatter={(value) => (value === undefined || value === null
                      ? ''
                      : Number(value).toFixed(2))}
                    min={0}
                    precision={2}
                    step={0.01}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item
                  className="full-span"
                  label="价格来源备注"
                  name={['settings', 'billing', 'priceSource']}
                >
                  <Input placeholder="例如：official-manual-2026-06-12" />
                </Form.Item>
              </>
            )}
          </div>
        )}
      </Form>
    </Modal>
  );
}

type LlmPricingModalProps = {
  llmModelPricing: LlmModelPricing[];
  onCancel: () => void;
  onDelete: (record: LlmModelPricing) => void;
  onEdit: (record: LlmModelPricing) => void;
  onOpenCreate: () => void;
  open: boolean;
};

function LlmPricingModal({
  llmModelPricing,
  onCancel,
  onDelete,
  onEdit,
  onOpenCreate,
  open,
}: LlmPricingModalProps) {
  const llmPricingColumns: TableProps<LlmModelPricing>['columns'] = [
    {
      title: '服务商',
      render: (_, record) => (
        <Space orientation="vertical" size={2}>
          <strong>{record.providerName}</strong>
          <span className="model-subtext">{record.provider}</span>
        </Space>
      ),
    },
    {
      title: '模型',
      render: (_, record) => (
        <Space orientation="vertical" size={2}>
          <span>{record.displayName}</span>
          <span className="model-subtext">{record.model}</span>
        </Space>
      ),
    },
    {
      title: '官方价格',
      width: 320,
      render: (_, record) => renderCompactLlmOfficialPriceLines(record),
    },
    {
      title: '操作',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button onClick={() => onEdit(record)}>编辑</Button>
          <Popconfirm
            okText="删除"
            cancelText="取消"
            onConfirm={() => onDelete(record)}
            title="确认删除该 LLM 官方价格目录？"
          >
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      className="llm-pricing-management-modal"
      footer={null}
      onCancel={onCancel}
      open={open}
      title="LLM 官方价格管理"
      width={1180}
    >
      <div className="llm-pricing-modal-list">
        <div className="model-config-toolbar">
          <div>
            <div className="model-subtext">模型配置和运行时计费都会读取这里的官方价格。</div>
          </div>
          <Button icon={<PlusOutlined />} onClick={onOpenCreate} type="primary">
            新增模型价格
          </Button>
        </div>
        <Table
          columns={llmPricingColumns}
          dataSource={llmModelPricing}
          tableLayout="fixed"
          pagination={false}
          rowKey={(record) => record.id}
          scroll={{ x: 1040, y: 'calc(80vh - 220px)' }}
        />
      </div>
    </Modal>
  );
}

type LlmPricingEditorModalProps = {
  editingRecord: LlmModelPricing | null;
  onCancel: () => void;
  onSaved: () => void;
  open: boolean;
};

function LlmPricingEditorModal({
  editingRecord,
  onCancel,
  onSaved,
  open,
}: LlmPricingEditorModalProps) {
  const [form] = Form.useForm<LlmPricingFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    form.setFieldsValue(editingRecord || {
      id: '',
      provider: '',
      providerName: '',
      model: '',
      displayName: '',
      defaultBaseUrl: '',
      currency: 'USD',
      inputPricePer1M: 0,
      outputPricePer1M: 0,
      cachedInputPricePer1M: 0,
      priceSource: 'official-manual',
      priceUpdatedAt: '',
    });
  }, [editingRecord, form, open]);

  async function handleSubmit(values: LlmPricingFormValues) {
    setSaving(true);
    try {
      if (editingRecord) {
        await updateLlmModelPricing(editingRecord.id, {
          ...editingRecord,
          ...values,
          id: editingRecord.id,
        });
      } else {
        await createLlmModelPricing(values);
      }
      message.success('LLM 官方价格目录已保存');
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'LLM 官方价格目录保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
      open={open}
      title={editingRecord ? '编辑 LLM 官方价格' : '新增 LLM 官方价格'}
      width={760}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
        <div className="antd-form-grid">
          <Form.Item
            label="目录 ID"
            name="id"
            rules={[{ required: true, message: '请输入目录 ID' }]}
          >
            <Input disabled={Boolean(editingRecord)} placeholder="openai:gpt-4.1-mini" />
          </Form.Item>
          <Form.Item
            label="币种"
            name="currency"
            rules={[{ required: true, message: '请选择币种' }]}
          >
            <Select
              options={[
                { label: '美元 USD', value: 'USD' },
                { label: '人民币 CNY', value: 'CNY' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Provider"
            name="provider"
            rules={[{ required: true, message: '请输入 Provider' }]}
          >
            <Input placeholder="openai / deepseek / 火山引擎" />
          </Form.Item>
          <Form.Item
            label="服务商显示名"
            name="providerName"
            rules={[{ required: true, message: '请输入服务商显示名' }]}
          >
            <Input placeholder="OpenAI / DeepSeek / 火山方舟" />
          </Form.Item>
          <Form.Item
            label="模型名称"
            name="model"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="gpt-4.1-mini" />
          </Form.Item>
          <Form.Item
            label="显示名称"
            name="displayName"
            rules={[{ required: true, message: '请输入显示名称' }]}
          >
            <Input placeholder="GPT-4.1 Mini" />
          </Form.Item>
          <Form.Item
            className="full-span"
            label="默认 Base URL"
            name="defaultBaseUrl"
            rules={[{ required: true, message: '请输入默认 Base URL' }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            label="输入价格"
            name="inputPricePer1M"
            rules={[{ required: true, message: '请输入输入价格' }]}
          >
            <InputNumber min={0} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="补全价格"
            name="outputPricePer1M"
            rules={[{ required: true, message: '请输入补全价格' }]}
          >
            <InputNumber min={0} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="缓存价格"
            name="cachedInputPricePer1M"
            rules={[{ required: true, message: '请输入缓存价格' }]}
          >
            <InputNumber min={0} precision={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="价格来源"
            name="priceSource"
            rules={[{ required: true, message: '请输入价格来源' }]}
          >
            <Input placeholder="openai-official" />
          </Form.Item>
          <Form.Item
            label="价格更新时间"
            name="priceUpdatedAt"
            rules={[{ required: true, message: '请输入价格更新时间' }]}
          >
            <Input placeholder="2026-06-15" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

export function ModelSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = modelTypeFromTabParam(searchParams.get('tab'));
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
  const tableRows = activeType === 'audio'
    ? audioConfigRows
    : activeType === 'video'
      ? videoConfigRows
      : configsByType[activeType];

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

  function handleTabChange(key: string) {
    const nextType = modelTypeFromTabParam(key);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextType === 'llm') {
        next.delete('tab');
      } else {
        next.set('tab', nextType);
      }
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (!loadedTypes[activeType]) {
      void loadConfigs(activeType);
    }
  }, [activeType, loadedTypes]);

  useEffect(() => {
    visibleModelTypes
      .filter((item) => item.key !== activeType)
      .forEach((item) => {
        if (!loadedTypes[item.key]) {
          void loadConfigs(item.key);
        }
      });
  }, []);

  function openCreateModal() {
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

  async function handleSetDefault(record: ModelConfig) {
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
      void loadConfigs(activeType);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '默认模型设置失败');
    }
  }

  async function handleDelete(record: ModelConfig) {
    if (!record.id) {
      return;
    }

    try {
      await deleteModelConfig(record.id);
      message.success('模型配置已删除');
      void loadConfigs(activeType);
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

  const operationColumn: ModelColumn = {
    title: '操作',
    width: 260,
    render: (_, record) => (
      <Space>
        <Button
          icon={record.isDefault ? <StarFilled /> : <StarOutlined />}
          onClick={() => handleSetDefault(record)}
          type={record.isDefault ? 'primary' : 'default'}
        >
          默认
        </Button>
        <Button onClick={() => openEditModal(record)}>
          {activeType === 'audio' ? '编辑 Key / Base URL' : activeType === 'video' ? '编辑 API Key' : '编辑'}
        </Button>
        {activeType !== 'audio' && activeType !== 'video' && (
          <Popconfirm
            disabled={record.isDefault}
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
            title="确认删除该模型配置？"
          >
            <Button danger disabled={record.isDefault}>删除</Button>
          </Popconfirm>
        )}
      </Space>
    ),
  };

  const columns: TableProps<ModelConfig>['columns'] = activeType === 'audio'
    ? [
        {
          title: '音频配置',
          dataIndex: 'name',
          render: (value, record) => (
            <Space orientation="vertical" size={2}>
              <Space>
                <strong>{value}</strong>
                {record.isDefault && <Tag color="green">默认</Tag>}
              </Space>
              <span className="model-subtext">{audioProviders.find((item) => item.id === record.provider)?.description || record.model}</span>
            </Space>
          ),
        },
          {
            title: 'Key 状态',
            render: (_, record) => <Tag color={record.apiKey ? 'green' : 'orange'}>{record.apiKey ? '已配置' : '未配置'}</Tag>,
          },
          {
            title: '计费参数',
            width: 280,
            render: (_, record) => {
              const billing = audioBillingSettingsOf(record);
              return (
                <Space orientation="vertical" size={2}>
                  <span>倍率 {billing.multiplier.toFixed(2)}</span>
                  <span>克隆 {billing.voiceCloneCredits.toFixed(6)} Credit / 次</span>
                  <span className="model-subtext">合成 {billing.speechCreditsPer1kChars.toFixed(6)} Credit / 1K 字符</span>
                </Space>
              );
            },
          },
        {
          title: 'Base URL',
          width: 320,
          render: (_, record) => {
            const provider = audioProviders.find((item) => item.id === record.provider);
            return (
              <Space orientation="vertical" size={2}>
                <span className="model-url-text">{record.baseUrl || provider?.defaultBaseUrl || '可留空'}</span>
                {provider?.baseUrlHelp ? <span className="model-subtext">{provider.baseUrlHelp}</span> : null}
              </Space>
            );
          },
        },
        operationColumn,
      ]
    : activeType === 'image'
      ? [
        {
          title: '图片配置',
          dataIndex: 'name',
          render: (value, record) => (
            <Space orientation="vertical" size={2}>
              <Space>
                <strong>{value}</strong>
                {record.isDefault && <Tag color="green">默认</Tag>}
              </Space>
              <span className="model-subtext">{record.provider}</span>
            </Space>
          ),
        },
        {
          title: '模型',
          dataIndex: 'model',
        },
        {
          title: '生成能力',
          width: 180,
          render: (_, record) => <span className="model-subtext">{imageGenerationSummary(record)}</span>,
        },
        {
          title: 'Key 状态',
          render: (_, record) => <Tag color={record.apiKey ? 'green' : 'orange'}>{record.apiKey ? '已配置' : '未配置'}</Tag>,
        },
        {
          title: '计费参数',
          width: 240,
          render: (_, record) => {
            const billing = imageBillingSettingsOf(record);
            return (
              <Space orientation="vertical" size={2}>
                <span>{billing.creditsPerRequest.toFixed(2)} Credit / 张</span>
              </Space>
            );
          },
        },
        {
          title: 'Base URL',
          width: 320,
          render: (_, record) => <span className="model-url-text">{record.baseUrl}</span>,
        },
        operationColumn,
      ]
    : activeType === 'video'
      ? [
          {
            title: '视频配置',
            dataIndex: 'name',
            render: (value, record) => {
              const provider = videoProviders.find((item) => item.id === record.provider);
              return (
                <Space orientation="vertical" size={2}>
                  <Space>
                    <strong>{value}</strong>
                    {record.isDefault && <Tag color="green">默认</Tag>}
                  </Space>
                  {/* <span className="model-subtext">{provider?.description || record.model}</span> */}
                </Space>
              );
            },
          },
          {
            title: '可选模型',
            render: (_, record) => {
              const provider = videoProviders.find((item) => item.id === record.provider);
              const selectedModel = provider?.models.find((item) => item.id === record.model)
                || provider?.models.find((item) => item.id === provider.defaultModel);
              const options = (provider?.models || []).map((item) => ({
                label: item.name,
                value: item.id,
                disabled: Boolean(item.disabled),
              }));
              return (
                <Space orientation="vertical" size={2}>
                  <Select
                    options={options}
                    value={selectedModel?.id}
                    style={{ minWidth: 240 }}
                    loading={savingProviderId === record.provider}
                    disabled={savingProviderId === record.provider || options.length === 0}
                    onChange={(value) => {
                      void handleVideoModelChange(record, value);
                    }}
                  />
                  <span className="model-subtext">
                    {selectedModel?.description || '生成页按模型能力动态展示参考图、参考视频、参考音频'}
                  </span>
                </Space>
              );
            },
          },
          {
            title: 'Key 状态',
            render: (_, record) => <Tag color={record.apiKey ? 'green' : 'orange'}>{record.apiKey ? '已配置' : '未配置'}</Tag>,
          },
          {
            title: '计费参数',
            width: 240,
            render: (_, record) => {
              const billing = videoBillingSettingsOf(record);
              return (
                <Space orientation="vertical" size={2}>
                  <span>倍率 {billing.multiplier.toFixed(2)}</span>
                  <span className="model-subtext">{billing.creditsPer1MTokens.toFixed(6)} Credit / 1M tokens</span>
                </Space>
              );
            },
          },
          {
            title: 'Base URL',
            width: 320,
            render: (_, record) => {
              const provider = videoProviders.find((item) => item.id === record.provider);
              return <span className="model-url-text">{provider?.defaultBaseUrl || record.baseUrl}</span>;
            },
          },
          operationColumn,
        ]
    : activeType === 'llm'
      ? [
          {
            title: '配置名称',
            dataIndex: 'name',
            render: (value, record) => (
              <Space>
                <strong>{value}</strong>
                {record.isDefault && <Tag color="green">默认</Tag>}
              </Space>
            ),
          },
          {
            title: '服务商',
            render: (_, record) => findLlmPricing(llmModelPricing, record.provider, record.model)?.providerName || record.provider,
          },
          { title: '模型', dataIndex: 'model' },
          {
            title: '倍率',
            width: 120,
            render: (_, record) => llmBillingSettingsOf(record).multiplier.toFixed(2),
          },
          {
            title: '计费参数',
            width: 320,
            render: (_, record) => {
              const billing = llmBillingSettingsOf(record);
              return (
                <Space orientation="vertical" size={2}>
                  <span>输入 {(billing.inputCreditsPer1M * billing.multiplier).toFixed(6)} Credit / 1M</span>
                  <span>输出 {(billing.outputCreditsPer1M * billing.multiplier).toFixed(6)} Credit / 1M</span>
                  <span className="model-subtext">缓存 {(billing.cachedInputCreditsPer1M * billing.multiplier).toFixed(6)} Credit / 1M，启动门槛 {billing.maxOutputCreditsForReserve.toFixed(2)} Credit</span>
                </Space>
              );
            },
          },
          operationColumn,
        ]
      : [
        {
          title: '配置名称',
          dataIndex: 'name',
          render: (value, record) => (
            <Space>
              <strong>{value}</strong>
              {record.isDefault && <Tag color="green">默认</Tag>}
            </Space>
          ),
        },
        { title: '服务商', dataIndex: 'provider' },
        { title: '模型', dataIndex: 'model' },
        {
          title: '计费参数',
          width: 280,
          render: (_, record) => {
            const billing = audioBillingSettingsOf(record);
            return (
              <Space orientation="vertical" size={2}>
                <span>倍率 {billing.multiplier.toFixed(2)}</span>
                <span className="model-subtext">声音克隆 {billing.voiceCloneCredits.toFixed(6)} Credit / 次</span>
              </Space>
            );
          },
        },
        { title: 'Base URL', dataIndex: 'baseUrl', ellipsis: true },
        operationColumn,
      ];

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <p>按 LLM、图片、视频、音频分类管理多个模型配置，并为每个类型选择默认模型。</p>
        </section>

        <section className="settings-section">
        <div className="model-config-toolbar">
          <Space>
            {activeType !== 'audio' && activeType !== 'video' && (
              <Button icon={<PlusOutlined />} onClick={openCreateModal} type="primary">
                新增{modelTypeLabelMap[activeType]}
              </Button>
            )}
            {activeType === 'llm' && (
              <Button onClick={openLlmPricingModal}>
                官方价格管理
              </Button>
            )}
          </Space>
        </div>

        <Tabs
          activeKey={activeType}
          items={visibleModelTypes.map((item) => ({ key: item.key, label: item.label }))}
          onChange={handleTabChange}
        />

        <Table
          columns={columns}
          dataSource={tableRows}
          loading={Boolean(loadingByType[activeType])}
          pagination={false}
          rowKey={(record) => record.id || record.provider}
        />
        </section>

      <ModelFormModal
        activeType={activeType}
        audioProviders={audioProviders}
        imageProviders={imageProviders}
        editingRecord={editingRecord}
        llmModelPricing={llmModelPricing}
        onCancel={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          void loadConfigs(activeType);
        }}
        open={modalOpen}
        videoProviders={videoProviders}
      />
      <LlmPricingModal
        llmModelPricing={llmModelPricing}
        onCancel={() => setLlmPricingModalOpen(false)}
        onDelete={(record) => {
          void handleDeleteLlmPricing(record);
        }}
        onEdit={openEditLlmPricingModal}
        onOpenCreate={openCreateLlmPricingModal}
        open={llmPricingModalOpen}
      />
      <LlmPricingEditorModal
        editingRecord={editingLlmPricing}
        onCancel={() => setLlmPricingEditorModalOpen(false)}
        onSaved={() => {
          setLlmPricingEditorModalOpen(false);
          setEditingLlmPricing(null);
          void loadConfigs('llm');
        }}
        open={llmPricingEditorModalOpen}
      />
      </section>
    </ContentStudioLayout>
  );
}
