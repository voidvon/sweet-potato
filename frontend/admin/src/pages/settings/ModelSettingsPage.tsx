import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
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
} from '../../api/model-config';
import type {
  AudioModelProviderOption,
  ImageModelProviderOption,
  VideoModelProviderOption,
} from '../../api/model-config';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import type { LlmModelPricing, ModelConfig, ModelType } from '../../types';
import { LlmPricingEditorModal } from './model-settings/LlmPricingEditorModal';
import { LlmPricingModal } from './model-settings/LlmPricingModal';
import { ModelFormModal } from './model-settings/ModelFormModal';
import {
  audioBillingSettingsOf,
  audioProviderConfigRow,
  findLlmPricing,
  imageBillingSettingsOf,
  imageGenerationSummary,
  llmBillingSettingsOf,
  saveModelConfig,
  videoProviderConfigRow,
} from './model-settings/modelSettingsHelpers';
import {
  modelTypeFromTabParam,
  modelTypeLabelMap,
  visibleModelTypes,
} from './model-settings/modelSettingsConstants';
import './ModelSettingsPage.scss';

type ModelColumn = NonNullable<TableProps<ModelConfig>['columns']>[number];

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

  const operationColumn: ModelColumn = {
    title: '操作',
    width: activeType === 'image' ? 360 : 260,
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
        {activeType === 'image' && (() => {
          const index = configsByType.image.findIndex((item) => item.id === record.id);
          return (
            <>
              <Button
                aria-label={`上移 ${record.name}`}
                disabled={sortingImageModels || index <= 0}
                icon={<ArrowUpOutlined />}
                onClick={() => void handleMoveImageModel(record, -1)}
                title="上移"
              />
              <Button
                aria-label={`下移 ${record.name}`}
                disabled={sortingImageModels || index < 0 || index >= configsByType.image.length - 1}
                icon={<ArrowDownOutlined />}
                onClick={() => void handleMoveImageModel(record, 1)}
                title="下移"
              />
            </>
          );
        })()}
      </Space>
    ),
  };

  const columns: TableProps<ModelConfig>['columns'] = activeType === 'audio'
    ? [
        {
          title: '音频配置',
          dataIndex: 'name',
          render: (value, record) => (
            <Space direction="vertical" size={2}>
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
      ]
    : activeType === 'image'
      ? [
          {
            title: '图片配置',
            dataIndex: 'name',
            render: (value, record) => (
              <Space direction="vertical" size={2}>
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
        ]
      : activeType === 'video'
        ? [
            {
              title: '视频配置',
              dataIndex: 'name',
              render: (value, record) => {
                const provider = videoProviders.find((item) => item.id === record.provider);
                return (
                  <Space direction="vertical" size={2}>
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
                  <Space direction="vertical" size={2}>
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
                    <Space direction="vertical" size={2}>
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
                    <Space direction="vertical" size={2}>
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
