import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Form, InputNumber, Modal, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSiteAccessLogSettings,
  listSiteAccessLogs,
  updateSiteAccessLogSettings,
  type SiteAccessLog,
} from '../../api/site-access-logs';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import './SiteAccessLogPage.scss';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function SiteAccessLogPage() {
  const { setHeaderExtra } = useWorkspaceHeader();
  const [settingsForm] = Form.useForm<{ retentionDays: number }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [retentionDays, setRetentionDays] = useState(7);
  const selectedRetentionDays = Form.useWatch('retentionDays', settingsForm) ?? retentionDays;
  const [logs, setLogs] = useState<SiteAccessLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const loadLogs = useCallback(async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const result = await listSiteAccessLogs(nextPage, nextPageSize);
      setLogs(result.items);
      setPage(result.page);
      setPageSize(result.pageSize);
      setTotal(result.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '访问日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  async function openSettings() {
    setSettingsOpen(true);
    try {
      const settings = await getSiteAccessLogSettings();
      setRetentionDays(settings.retentionDays);
      settingsForm.setFieldsValue(settings);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '日志设置加载失败');
    }
  }

  useEffect(() => {
    setHeaderExtra(
      <Tooltip title="日志设置">
        <Button
          aria-label="日志设置"
          className="site-access-log-header-settings"
          icon={<SettingOutlined />}
          onClick={() => void openSettings()}
          type="text"
        />
      </Tooltip>,
    );
    return () => setHeaderExtra(null);
  }, [setHeaderExtra]);

  useEffect(() => {
    void Promise.all([
      loadLogs(1, 20),
      getSiteAccessLogSettings().then((settings) => setRetentionDays(settings.retentionDays)),
    ]).catch((error) => message.error(error instanceof Error ? error.message : '访问日志初始化失败'));
  }, []);

  const columns = useMemo<ColumnsType<SiteAccessLog>>(() => [
    {
      title: 'IP 地址',
      dataIndex: 'ip',
      width: 180,
      render: (value: string) => <Typography.Text copyable>{value}</Typography.Text>,
    },
    {
      title: '访问记录',
      key: 'request',
      width: 280,
      render: (_, record) => (
        <div className="site-access-log-request">
          <Space size={8}>
            <Tag color="blue">{record.method}</Tag>
            <Typography.Text strong>{record.path}</Typography.Text>
          </Space>
        </div>
      ),
    },
    {
      title: '访问时间',
      dataIndex: 'lastAccessedAt',
      width: 180,
      render: (value: string) => dateTimeFormatter.format(new Date(value)),
    },
    {
      title: 'User Agent',
      dataIndex: 'userAgent',
      ellipsis: { showTitle: false },
      render: (value: string) => <Tooltip title={value}><Typography.Text ellipsis>{value}</Typography.Text></Tooltip>,
    },
    {
      title: '最近状态',
      dataIndex: 'lastStatusCode',
      width: 100,
      render: (value: number) => <Tag color={value >= 400 ? 'red' : value >= 300 ? 'gold' : 'green'}>{value}</Tag>,
    },
    {
      title: '访问次数',
      dataIndex: 'accessCount',
      width: 120,
      align: 'right',
      sorter: (left, right) => left.accessCount - right.accessCount,
    },
  ], []);

  async function saveSettings() {
    try {
      const values = await settingsForm.validateFields();
      setSavingSettings(true);
      const settings = await updateSiteAccessLogSettings(values);
      setRetentionDays(settings.retentionDays);
      setSettingsOpen(false);
      message.success('日志保留时间已保存');
      await loadLogs(1, pageSize);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page site-access-log-page">
        <div className="site-access-log-toolbar">
          <Typography.Text type="secondary">仅展示最近 {retentionDays} 天的访问记录。</Typography.Text>
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadLogs(page, pageSize)}>刷新</Button>
          </Space>
        </div>
        <Table<SiteAccessLog>
          columns={columns}
          dataSource={logs}
          loading={loading}
          locale={{ emptyText: '暂无访问日志' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage, nextPageSize) => void loadLogs(nextPage, nextPageSize),
          }}
          rowKey="id"
          scroll={{ x: 980 }}
        />
      </section>

      <Modal
        cancelText="取消"
        confirmLoading={savingSettings}
        okText="保存"
        onCancel={() => setSettingsOpen(false)}
        onOk={() => void saveSettings()}
        open={settingsOpen}
        title="访问日志设置"
      >
        <Form form={settingsForm} layout="vertical" initialValues={{ retentionDays: 7 }}>
          <Form.Item
            label="日志保留时间"
            name="retentionDays"
            extra={`超过 ${selectedRetentionDays} 天的日志将被自动清理，最长可配置 7 天。`}
            rules={[{ required: true, message: '请输入日志保留天数' }]}
          >
            <InputNumber addonAfter="天" min={1} max={7} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </ContentStudioLayout>
  );
}
