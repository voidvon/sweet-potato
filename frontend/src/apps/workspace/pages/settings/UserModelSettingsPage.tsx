import { useEffect, useState } from 'react';
import {
  AutoComplete, Button, Checkbox, Form, Input, InputNumber, Modal, Popconfirm,
  Space, Table, Tabs, Tag, Tooltip, message, type TableProps,
} from 'antd';
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  createUserModelConfig,
  deleteUserModelConfig,
  listUserImageModelProviders,
  listUserModelConfigs,
  setDefaultUserModelConfig,
  updateUserModelConfig,
} from '@shared/api/user-model-config';
import type { ImageModelProviderOption } from '@shared/api/model-config';
import type { ModelConfig } from '../../types';
import { t } from '@shared/i18n';
import './UserModelSettingsPage.scss';

type PersonalModelType = 'llm' | 'image';
type UserModelForm = ModelConfig & {
  supportsCustomResolution?: boolean;
};

function emptyModel(type: PersonalModelType, provider?: ImageModelProviderOption): UserModelForm {
  if (type === 'image') {
    return {
      type, name: '', provider: provider?.id || '', model: provider?.defaultModel || '', apiKey: '',
      baseUrl: provider?.defaultBaseUrl || '', temperature: 0.7, isDefault: false, supportsCustomResolution: false,
    };
  }
  return {
    type, name: '', provider: 'openai', model: '', apiKey: '',
    baseUrl: 'https://api.openai.com/v1', temperature: 0.7, isDefault: false,
  };
}

export function UserModelSettingsPage() {
  const [form] = Form.useForm<UserModelForm>();
  const [activeType, setActiveType] = useState<PersonalModelType>('llm');
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providers, setProviders] = useState<ImageModelProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const selectedProviderId = Form.useWatch('provider', form);
  const selectedProvider = providers.find((item) => item.id === selectedProviderId);
  const tableRows = models.filter((model) => model.type === activeType);

  async function loadData() {
    setLoading(true);
    try {
      const [modelRows, providerRows] = await Promise.all([listUserModelConfigs(), listUserImageModelProviders()]);
      setModels(modelRows);
      setProviders(providerRows);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("个人模型配置加载失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  function openCreateModal() {
    setEditing(null);
    form.setFieldsValue(emptyModel(activeType, providers[0]));
    setModalOpen(true);
  }

  function openEditModal(model: ModelConfig) {
    const generation = model.settings?.imageGeneration as Record<string, unknown> | undefined;
    setEditing(model);
    form.setFieldsValue({ ...model, apiKey: '', supportsCustomResolution: generation?.supportsCustomResolution === true });
    setModalOpen(true);
  }

  function handleProviderChange(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    if (provider) form.setFieldsValue({ model: provider.defaultModel, baseUrl: provider.defaultBaseUrl });
  }

  async function handleSave() {
    const values = await form.validateFields();
    const payload: ModelConfig = {
      ...values,
      id: editing?.id,
      type: activeType,
      settings: activeType === 'image'
        ? { imageGeneration: { supportsCustomResolution: Boolean(values.supportsCustomResolution) } }
        : {},
    };
    setSaving(true);
    try {
      if (editing?.id) await updateUserModelConfig(editing.id, payload);
      else await createUserModelConfig(payload);
      message.success(t("模型配置已保存"));
      setModalOpen(false);
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("模型配置保存失败"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(model: ModelConfig) {
    if (!model.id || model.isDefault) return;
    try {
      await setDefaultUserModelConfig(model.id);
      message.success(t("已设为默认模型"));
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("默认模型设置失败"));
    }
  }

  async function handleDelete(model: ModelConfig) {
    if (!model.id) return;
    try {
      await deleteUserModelConfig(model.id);
      message.success(t("模型配置已删除"));
      await loadData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("模型配置删除失败"));
    }
  }

  const columns: TableProps<ModelConfig>['columns'] = [
    {
      title: t("配置名称"), dataIndex: 'name',
      render: (name: string, record) => (
        <Space size={8}>
          <strong>{name}</strong>
          {record.isDefault ? <Tag color="green">{t("默认")}</Tag> : null}
          <Tag>{t("免费")}</Tag>
        </Space>
      ),
    },
    { title: t("服务商"), dataIndex: 'provider', width: 190 },
    { title: t("模型"), dataIndex: 'model' },
    {
      title: 'API Key', dataIndex: 'isConfigured', width: 120,
      render: (configured: boolean) => configured
        ? <Tag icon={<CheckCircleOutlined />} color="success">{t("已配置")}</Tag>
        : <Tag>{t("未配置")}</Tag>,
    },
    {
      title: t("操作"), key: 'actions', fixed: 'right', width: 132,
      render: (_, record) => (
        <Space size={4}>
          {!record.isDefault ? (
            <Tooltip title={t("设为默认")}>
              <Button aria-label={t("设为默认")} icon={<CheckCircleOutlined />} onClick={() => void handleSetDefault(record)} type="text" />
            </Tooltip>
          ) : null}
          <Tooltip title={t("编辑")}>
            <Button aria-label={t("编辑")} icon={<EditOutlined />} onClick={() => openEditModal(record)} type="text" />
          </Tooltip>
          <Popconfirm cancelText={t("取消")} okButtonProps={{ danger: true }} okText={t("删除")} onConfirm={() => void handleDelete(record)} title={t("确认删除这个模型配置？")}>
            <Tooltip title={t("删除")}><Button aria-label={t("删除")} danger icon={<DeleteOutlined />} type="text" /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const imageModelOptions = (selectedProvider?.models || []).map((model) => ({
    label: `${model.name} (${model.id})`, value: model.id, disabled: model.disabled,
  }));
  const typeLabel = activeType === 'llm' ? t("LLM 模型") : t("图片模型");

  return (
    <ContentStudioLayout>
      <section className="settings-page user-model-settings-page">
        <section className="settings-section">
          <div className="user-model-toolbar">
            <Button disabled={loading || (activeType === 'image' && providers.length === 0)} icon={<PlusOutlined />} onClick={openCreateModal} type="primary">
              {t("新增{{0}}", { "0": typeLabel })}
            </Button>
          </div>
          <Tabs
            activeKey={activeType}
            items={[{ key: 'llm', label: t("LLM 模型") }, { key: 'image', label: t("图片模型") }]}
            onChange={(key) => { setActiveType(key as PersonalModelType); setModalOpen(false); }}
          />
          <Table columns={columns} dataSource={tableRows} loading={loading} locale={{ emptyText: t("暂无个人模型") }} pagination={false} rowKey="id" scroll={{ x: 760 }} />
        </section>
      </section>

      <Modal centered confirmLoading={saving} forceRender onCancel={() => setModalOpen(false)} onOk={() => void handleSave()} open={modalOpen} title={editing ? t("编辑{{0}}", { "0": typeLabel }) : t("新增{{0}}", { "0": typeLabel })} width={640}>
        <Form form={form} layout="vertical" preserve={false}>
          <div className="user-model-form-grid">
            <Form.Item label={t("配置名称")} name="name" rules={[{ required: true, message: t("请输入配置名称") }]}>
              <Input placeholder={activeType === 'llm' ? t("例如：我的 GPT") : t("例如：我的 Seedream")} />
            </Form.Item>
            <Form.Item label={t("服务商")} name="provider" rules={[{ required: true, message: t("请输入服务商") }]}>
              {activeType === 'image' ? (
                <AutoComplete
                  onSelect={handleProviderChange}
                  options={providers.map((provider) => ({ label: `${provider.name} (${provider.id})`, value: provider.id }))}
                  placeholder="openai-images / openai-compatible / custom-provider"
                />
              ) : <Input placeholder="openai / openai-compatible" />}
            </Form.Item>
            <Form.Item label={t("模型名称")} name="model" rules={[{ required: true, message: t("请输入模型名称") }]}>
              {activeType === 'image' ? (
                <AutoComplete options={imageModelOptions} placeholder={t("请输入或选择图片模型")} />
              ) : <Input placeholder="gpt-5.6 / deepseek-chat / custom-model" />}
            </Form.Item>
            <Form.Item label="API Key" name="apiKey" rules={editing ? [] : [{ required: true, message: t("请输入 API Key") }]}>
              <Input.Password placeholder={editing?.isConfigured ? t("留空则保留现有 API Key") : t("请输入 API Key")} />
            </Form.Item>
            <Form.Item className="full-span" label="Base URL" name="baseUrl" rules={[{ required: true, message: t("请输入 Base URL") }]}>
              <Input placeholder="https://api.example.com/v1" />
            </Form.Item>
            {activeType === 'llm' ? (
              <Form.Item label="Temperature" name="temperature" rules={[{ required: true, message: t("请输入 Temperature") }]}>
                <InputNumber max={2} min={0} precision={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            ) : (
              <Form.Item name="supportsCustomResolution" valuePropName="checked"><Checkbox>{t("支持自定义分辨率")}</Checkbox></Form.Item>
            )}
            <Form.Item name="isDefault" valuePropName="checked"><Checkbox>{t("设为我的默认模型")}</Checkbox></Form.Item>
          </div>
        </Form>
      </Modal>
    </ContentStudioLayout>
  );
}
