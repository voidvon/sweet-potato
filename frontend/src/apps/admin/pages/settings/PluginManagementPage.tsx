import { useEffect, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
  type TableColumnsType,
} from 'antd';
import { ApiOutlined, SettingOutlined } from '@ant-design/icons';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import {
  listPlugins,
  testPluginConnection,
  updatePlugin,
  type ManagedPlugin,
  type PluginSettingsPayload,
} from '../../api/plugin';
import { t } from '@shared/i18n';
import './PluginManagementPage.scss';

type PluginFormValues = PluginSettingsPayload;

export function PluginManagementPage() {
  const [form] = Form.useForm<PluginFormValues>();
  const [plugins, setPlugins] = useState<ManagedPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingKey, setTestingKey] = useState('');
  const [togglingKey, setTogglingKey] = useState('');
  const [editing, setEditing] = useState<ManagedPlugin | null>(null);

  async function loadPlugins() {
    setLoading(true);
    try {
      setPlugins(await listPlugins());
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('插件列表加载失败'));
    } finally {
      setLoading(false);
    }
  }

  const hasEnabledPlugin = plugins.some((plugin) => plugin.enabled);

  useEffect(() => {
    void loadPlugins();
  }, []);

  useEffect(() => {
    if (!hasEnabledPlugin) return;
    const timer = window.setInterval(() => {
      void listPlugins().then(setPlugins).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasEnabledPlugin]);

  function openSettings(plugin: ManagedPlugin) {
    setEditing(plugin);
    form.setFieldsValue({
      enabled: plugin.enabled,
      sortOrder: plugin.sortOrder,
      timeoutSeconds: plugin.timeoutSeconds,
      maxConcurrency: plugin.maxConcurrency,
      templateVersion: plugin.templateVersion,
    });
  }

  async function saveSettings() {
    if (!editing) return;
    let values: PluginFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const updated = await updatePlugin(editing.key, {
        enabled: values.enabled,
        sortOrder: values.sortOrder,
        timeoutSeconds: values.timeoutSeconds,
        maxConcurrency: values.maxConcurrency,
        templateVersion: values.templateVersion,
      });
      setPlugins((current) => current
        .map((plugin) => plugin.key === updated.key ? updated : plugin)
        .sort((left, right) => left.sortOrder - right.sortOrder));
      setEditing(null);
      message.success(t('插件配置已保存'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('插件配置保存失败'));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(plugin: ManagedPlugin) {
    setTestingKey(plugin.key);
    try {
      const result = await testPluginConnection(plugin.key);
      message.success(t('连接成功，响应耗时 {{0}} ms', { '0': result.latencyMs }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('插件连接测试失败'));
    } finally {
      setTestingKey('');
    }
  }

  async function togglePlugin(plugin: ManagedPlugin, enabled: boolean) {
    setTogglingKey(plugin.key);
    try {
      const updated = await updatePlugin(plugin.key, {
        enabled,
        sortOrder: plugin.sortOrder,
        timeoutSeconds: plugin.timeoutSeconds,
        maxConcurrency: plugin.maxConcurrency,
        templateVersion: plugin.templateVersion,
      });
      setPlugins((current) => current.map((item) => item.key === updated.key ? updated : item));
      message.success(enabled ? t('插件已启用') : t('插件已停用'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('插件状态更新失败'));
    } finally {
      setTogglingKey('');
    }
  }

  const columns: TableColumnsType<ManagedPlugin> = [
    {
      title: t('插件'),
      key: 'plugin',
      render: (_, plugin) => (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Typography.Text strong>{plugin.name}</Typography.Text>
            <Tag>{plugin.category}</Tag>
            <Tag>v{plugin.version}</Tag>
          </Space>
          <Typography.Text className="plugin-management-key" copyable>{plugin.key}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('渲染适配器'),
      dataIndex: 'renderAdapter',
      width: 210,
      render: (value, plugin) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{value}</Typography.Text>
          <Typography.Text type="secondary">JSON Schema {plugin.templateVersion}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t('安装与运行'),
      key: 'runtime',
      width: 220,
      render: (_, plugin) => (
        <Space direction="vertical" size={2}>
          <Space>
            <Tag color={plugin.runtime.installed ? 'success' : 'default'}>
              {plugin.runtime.installed ? t('已安装') : t('未安装')}
            </Tag>
            <Tag color={plugin.runtime.state === 'running' ? 'processing' : plugin.runtime.state === 'error' ? 'error' : 'default'}>
              {{
                not_installed: t('不可用'),
                stopped: t('未运行'),
                starting: t('启动中'),
                running: t('运行中'),
                stopping: t('停止中'),
                error: t('异常'),
                unsupported: t('不支持'),
              }[plugin.runtime.state]}
            </Tag>
          </Space>
          {plugin.runtime.pid ? <Typography.Text type="secondary">PID {plugin.runtime.pid}</Typography.Text> : null}
          {plugin.runtime.lastError ? <Typography.Text type="danger">{plugin.runtime.lastError}</Typography.Text> : null}
        </Space>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'enabled',
      width: 100,
      render: (enabled) => <Tag color={enabled ? 'success' : 'default'}>{enabled ? t('已启用') : t('已停用')}</Tag>,
    },
    {
      title: t('操作'),
      key: 'actions',
      width: 300,
      render: (_, plugin) => (
        <Space>
          <Switch
            checked={plugin.enabled}
            checkedChildren={t('启用')}
            loading={togglingKey === plugin.key}
            disabled={!plugin.runtime.installed && !plugin.enabled}
            onChange={(checked) => void togglePlugin(plugin, checked)}
            unCheckedChildren={t('停用')}
          />
          <Button
            icon={<ApiOutlined />}
            disabled={plugin.runtime.state !== 'running'}
            loading={testingKey === plugin.key}
            onClick={() => void testConnection(plugin)}
          >
            {t('测试连接')}
          </Button>
          <Button icon={<SettingOutlined />} onClick={() => openSettings(plugin)}>{t('配置')}</Button>
        </Space>
      ),
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page plugin-management-page">
        <section className="settings-header">
          <p>{t('管理系统内置的受信任业务插件及其内部运行服务，不支持上传或运行第三方代码。')}</p>
        </section>
        <Table
          columns={columns}
          dataSource={plugins}
          loading={loading}
          pagination={false}
          rowKey="key"
        />
      </section>

      <Modal
        destroyOnHidden
        okButtonProps={{ loading: saving }}
        onCancel={() => setEditing(null)}
        onOk={() => void saveSettings()}
        open={Boolean(editing)}
        title={editing ? t('配置插件：{{0}}', { '0': editing.name }) : t('配置插件')}
        width={680}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item label={t('启用插件')} name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {t('Remotion 由主程序作为内部子进程托管，监听地址和端口会在启动时自动分配。')}
          </Typography.Paragraph>
          <Space size="large" wrap align="start">
            <Form.Item label={t('显示顺序')} name="sortOrder" rules={[{ required: true }]}>
              <InputNumber min={0} max={10000} />
            </Form.Item>
            <Form.Item label={t('请求超时')} name="timeoutSeconds" rules={[{ required: true }]}>
              <InputNumber min={5} max={1800} addonAfter={t('秒')} />
            </Form.Item>
            <Form.Item label={t('最大并发')} name="maxConcurrency" rules={[{ required: true }]}>
              <InputNumber min={1} max={32} addonAfter={t('个')} />
            </Form.Item>
            <Form.Item label={t('JSON Schema 版本')} name="templateVersion" rules={[{ required: true }]}>
              <Input className="plugin-management-version-input" placeholder="1.1" />
            </Form.Item>
          </Space>
          <Typography.Paragraph type="secondary">
            {t('当前插件接受附件：{{0}}', { '0': editing?.acceptedAttachments.join('、') || '-' })}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </ContentStudioLayout>
  );
}
