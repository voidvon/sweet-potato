import { ArrowDownOutlined, ArrowUpOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Select, Space, Tag } from 'antd';
import type { TableProps } from 'antd';
import type {
  AudioModelProviderOption,
  VideoModelProviderOption,
} from '../../../api/model-config';
import type { LlmModelPricing, ModelConfig, ModelType } from '../../../types';
import { modelTypeLabelMap } from './modelSettingsConstants';
import {
  audioBillingSettingsOf,
  findLlmPricing,
  imageBillingSettingsOf,
  imageGenerationSummary,
  llmBillingSettingsOf,
} from './modelSettingsHelpers';

type GetModelSettingsColumnsOptions = {
  activeType: ModelType;
  audioProviders: AudioModelProviderOption[];
  configsByType: Record<ModelType, ModelConfig[]>;
  llmModelPricing: LlmModelPricing[];
  onDelete: (record: ModelConfig) => void;
  onEdit: (record: ModelConfig) => void;
  onMoveImageModel: (record: ModelConfig, offset: -1 | 1) => void;
  onSetDefault: (record: ModelConfig) => void;
  onVideoModelChange: (record: ModelConfig, model: string) => void;
  savingProviderId: string;
  sortingImageModels: boolean;
  videoProviders: VideoModelProviderOption[];
};

export function getCreateLabel(activeType: ModelType) {
  return `新增${modelTypeLabelMap[activeType]}`;
}

function getEditLabel(activeType: ModelType) {
  return activeType === 'audio'
    ? '编辑 Key / Base URL'
    : activeType === 'video'
      ? '编辑 API Key'
      : '编辑';
}
function renderDefaultNameCell(value: string, isDefault: boolean, subtitle?: string) {
  return (
    <Space direction="vertical" size={2}>
      <Space>
        <strong>{value}</strong>
        {isDefault && <Tag color="green">默认</Tag>}
      </Space>
      {subtitle ? <span className="model-subtext">{subtitle}</span> : null}
    </Space>
  );
}

function renderConfiguredTag(record: ModelConfig) {
  return <Tag color={record.apiKey ? 'green' : 'orange'}>{record.apiKey ? '已配置' : '未配置'}</Tag>;
}

export function getModelSettingsColumns({
  activeType,
  audioProviders,
  configsByType,
  llmModelPricing,
  onDelete,
  onEdit,
  onMoveImageModel,
  onSetDefault,
  onVideoModelChange,
  savingProviderId,
  sortingImageModels,
  videoProviders,
}: GetModelSettingsColumnsOptions): TableProps<ModelConfig>['columns'] {
  const operationColumn = {
    title: '操作',
    width: activeType === 'image' ? 360 : 260,
    render: (_: unknown, record: ModelConfig) => (
      <Space>
        <Button
          icon={record.isDefault ? <StarFilled /> : <StarOutlined />}
          onClick={() => onSetDefault(record)}
          type={record.isDefault ? 'primary' : 'default'}
        >
          默认
        </Button>
        <Button onClick={() => onEdit(record)}>{getEditLabel(activeType)}</Button>
        {activeType !== 'audio' && activeType !== 'video' && (
          <Popconfirm
            disabled={record.isDefault}
            okText="删除"
            cancelText="取消"
            onConfirm={() => onDelete(record)}
            title="确认删除该模型配置？"
          >
            <Button danger disabled={record.isDefault}>删除</Button>
          </Popconfirm>
        )}
        {activeType === 'image' && (() => {
          const index = configsByType.image.findIndex((item) => item.id === record.id);
          return (
            <>
              <Button
                aria-label={`上移 ${record.name}`}
                disabled={sortingImageModels || index <= 0}
                icon={<ArrowUpOutlined />}
                onClick={() => onMoveImageModel(record, -1)}
                title="上移"
              />
              <Button
                aria-label={`下移 ${record.name}`}
                disabled={sortingImageModels || index < 0 || index >= configsByType.image.length - 1}
                icon={<ArrowDownOutlined />}
                onClick={() => onMoveImageModel(record, 1)}
                title="下移"
              />
            </>
          );
        })()}
      </Space>
    ),
  } satisfies NonNullable<TableProps<ModelConfig>['columns']>[number];

  if (activeType === 'audio') {
    return [
      {
        title: '音频配置',
        dataIndex: 'name',
        render: (value, record) => renderDefaultNameCell(
          value,
          record.isDefault,
          audioProviders.find((item) => item.id === record.provider)?.description || record.model,
        ),
      },
      {
        title: 'Key 状态',
        render: (_, record) => renderConfiguredTag(record),
      },
      {
        title: '计费参数',
        width: 280,
        render: (_, record) => {
          const billing = audioBillingSettingsOf(record);
          return (
            <Space direction="vertical" size={2}>
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
            <Space direction="vertical" size={2}>
              <span className="model-url-text">{record.baseUrl || provider?.defaultBaseUrl || '可留空'}</span>
              {provider?.baseUrlHelp ? <span className="model-subtext">{provider.baseUrlHelp}</span> : null}
            </Space>
          );
        },
      },
      operationColumn,
    ];
  }

  if (activeType === 'image') {
    return [
      {
        title: '图片配置',
        dataIndex: 'name',
        render: (value, record) => renderDefaultNameCell(value, record.isDefault, record.provider),
      },
      { title: '模型', dataIndex: 'model' },
      {
        title: '生成能力',
        width: 180,
        render: (_, record) => <span className="model-subtext">{imageGenerationSummary(record)}</span>,
      },
      {
        title: 'Key 状态',
        render: (_, record) => renderConfiguredTag(record),
      },
      {
        title: '计费参数',
        width: 240,
        render: (_, record) => {
          const billing = imageBillingSettingsOf(record);
          return (
            <Space direction="vertical" size={2}>
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
    ];
  }

  if (activeType === 'video') {
    return [
      {
        title: '视频配置',
        dataIndex: 'name',
        render: (value, record) => renderDefaultNameCell(value, record.isDefault),
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
            <Space direction="vertical" size={2}>
              <Select
                options={options}
                value={selectedModel?.id}
                style={{ minWidth: 240 }}
                loading={savingProviderId === record.provider}
                disabled={savingProviderId === record.provider || options.length === 0}
                onChange={(value) => onVideoModelChange(record, value)}
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
        render: (_, record) => renderConfiguredTag(record),
      },
      {
        title: '计费参数',
        width: 240,
        render: () => (
          <Space direction="vertical" size={2}>
            <span>按秒计费</span>
            <span className="model-subtext">模型 · 清晰度 · 时长</span>
          </Space>
        ),
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
    ];
  }

  return [
    {
      title: '配置名称',
      dataIndex: 'name',
      render: (value, record) => renderDefaultNameCell(value, record.isDefault),
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
          <Space direction="vertical" size={2}>
            <span>输入 {(billing.inputCreditsPer1M * billing.multiplier).toFixed(6)} Credit / 1M</span>
            <span>输出 {(billing.outputCreditsPer1M * billing.multiplier).toFixed(6)} Credit / 1M</span>
            <span className="model-subtext">缓存 {(billing.cachedInputCreditsPer1M * billing.multiplier).toFixed(6)} Credit / 1M，启动门槛 {billing.maxOutputCreditsForReserve.toFixed(2)} Credit</span>
          </Space>
        );
      },
    },
    operationColumn,
  ];
}
