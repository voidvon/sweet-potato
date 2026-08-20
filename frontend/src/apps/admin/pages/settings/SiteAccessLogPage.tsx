import { ReloadOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  getSiteAccessLogSettings,
  listSiteAccessLogs,
  updateSiteAccessLogSettings,
  type SiteAccessLog,
  type SiteAccessLogFilters,
} from '../../api/site-access-logs';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { useWorkspaceHeader } from '../../layouts/ProtectedLayout';
import './SiteAccessLogPage.scss';
import { t } from '@shared/i18n';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const methodOptions = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
  .map((method) => ({ label: method, value: method }));

function useTableBodyHeight() {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [bodyHeight, setBodyHeight] = useState(1);

  const measure = useCallback(() => {
    const viewport = viewportElementRef.current;
    if (!viewport || viewport.clientHeight <= 0) return;

    const headerHeight = viewport.querySelector<HTMLElement>('.ant-table-header')?.offsetHeight || 0;
    const pagination = viewport.querySelector<HTMLElement>('.ant-table-pagination');
    let paginationHeight = 0;
    if (pagination) {
      const style = window.getComputedStyle(pagination);
      paginationHeight = pagination.offsetHeight
        + Number.parseFloat(style.marginTop || '0')
        + Number.parseFloat(style.marginBottom || '0');
    }

    const nextHeight = Math.max(1, Math.floor(viewport.clientHeight - headerHeight - paginationHeight));
    setBodyHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      measure();
    });
  }, [measure]);

  const viewportRef = useCallback((viewport: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    viewportElementRef.current = viewport;

    if (!viewport) return;
    observerRef.current = new ResizeObserver(scheduleMeasure);
    observerRef.current.observe(viewport);
    scheduleMeasure();
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  });

  useEffect(() => () => {
    observerRef.current?.disconnect();
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  return { bodyHeight, viewportRef };
}

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
  const [ipInput, setIpInput] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [methodInput, setMethodInput] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const logTable = useTableBodyHeight();

  const loadLogs = useCallback(async (
    nextPage = page,
    nextPageSize = pageSize,
    filters: SiteAccessLogFilters = { ip: ipFilter, username: usernameFilter, method: methodFilter },
  ) => {
    setLoading(true);
    try {
      const result = await listSiteAccessLogs(nextPage, nextPageSize, filters);
      setLogs(result.items);
      setPage(result.page);
      setPageSize(result.pageSize);
      setTotal(result.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("访问日志加载失败"));
    } finally {
      setLoading(false);
    }
  }, [ipFilter, methodFilter, page, pageSize, usernameFilter]);

  function applyFilters() {
    const nextIp = ipInput.trim();
    const nextUsername = usernameInput.trim();
    setIpInput(nextIp);
    setIpFilter(nextIp);
    setUsernameInput(nextUsername);
    setUsernameFilter(nextUsername);
    setMethodFilter(methodInput);
    void loadLogs(1, pageSize, { ip: nextIp, username: nextUsername, method: methodInput });
  }

  function resetFilters() {
    setIpInput('');
    setIpFilter('');
    setUsernameInput('');
    setUsernameFilter('');
    setMethodInput('');
    setMethodFilter('');
    void loadLogs(1, pageSize, {});
  }

  async function openSettings() {
    setSettingsOpen(true);
    try {
      const settings = await getSiteAccessLogSettings();
      setRetentionDays(settings.retentionDays);
      settingsForm.setFieldsValue(settings);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("日志设置加载失败"));
    }
  }

  useEffect(() => {
    setHeaderExtra(
      <Space size={8}>
        <Tooltip title={t("日志设置")}>
          <Button
            aria-label={t("日志设置")}
            className="site-access-log-header-settings"
            icon={<SettingOutlined />}
            onClick={() => void openSettings()}
            type="text"
          />
        </Tooltip>
        <Typography.Text type="secondary">{t("仅展示最近")} {retentionDays} {t("天的访问记录。")}</Typography.Text>
      </Space>,
    );
    return () => setHeaderExtra(null);
  }, [retentionDays, setHeaderExtra]);

  useEffect(() => {
    void Promise.all([
      loadLogs(1, 20),
      getSiteAccessLogSettings().then((settings) => setRetentionDays(settings.retentionDays)),
    ]).catch((error) => message.error(error instanceof Error ? error.message : t("访问日志初始化失败")));
  }, []);

  const columns = useMemo<ColumnsType<SiteAccessLog>>(() => [
    {
      title: t("IP 地址"),
      dataIndex: 'ip',
      width: 180,
      render: (value: string) => <Typography.Text copyable>{value}</Typography.Text>,
    },
    {
      title: t("用户账号"),
      dataIndex: 'username',
      width: 140,
      render: (value: string) => value || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: t("访问记录"),
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
      title: t("访问时间"),
      dataIndex: 'accessedAt',
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
      title: t("状态码"),
      dataIndex: 'statusCode',
      width: 90,
      render: (value: number) => <Tag color={value >= 400 ? 'red' : value >= 300 ? 'gold' : 'green'}>{value}</Tag>,
    },
    {
      title: t("耗时"),
      dataIndex: 'durationMs',
      width: 90,
      align: 'right',
      render: (value: number) => `${value} ms`,
    },
    {
      title: t("访问次数"),
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
      message.success(t("日志保留时间已保存"));
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
          <Space wrap>
            <Input
              allowClear
              className="site-access-log-ip-filter"
              onChange={(event) => setIpInput(event.target.value)}
              onPressEnter={applyFilters}
              placeholder={t("输入 IP 地址")}
              value={ipInput}
            />
            <Input
              allowClear
              className="site-access-log-username-filter"
              onChange={(event) => setUsernameInput(event.target.value)}
              onPressEnter={applyFilters}
              placeholder={t("输入用户账号")}
              value={usernameInput}
            />
            <Select
              allowClear
              className="site-access-log-method-filter"
              onChange={(value) => setMethodInput(value || '')}
              options={methodOptions}
              placeholder={t("请求方法")}
              value={methodInput || undefined}
            />
            <Button icon={<SearchOutlined />} loading={loading} onClick={applyFilters}>{t("查询")}</Button>
            <Button
              disabled={!ipInput && !ipFilter && !usernameInput && !usernameFilter && !methodInput && !methodFilter}
              onClick={resetFilters}
            >
              {t("重置")}
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadLogs()}>{t("刷新")}</Button>
          </Space>
        </div>
        <div
          className="site-access-log-table-viewport"
          ref={logTable.viewportRef}
          style={{ '--site-access-log-table-body-height': `${logTable.bodyHeight}px` } as CSSProperties}
        >
          <Table<SiteAccessLog>
            className="site-access-log-table"
            columns={columns}
            dataSource={logs}
            loading={loading}
            locale={{ emptyText: t("暂无访问日志") }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (count) => t("共 {{0}} 条", { "0": count }),
              onChange: (nextPage, nextPageSize) => void loadLogs(nextPage, nextPageSize),
            }}
            rowKey="id"
            scroll={{ x: 1120, y: logTable.bodyHeight }}
          />
        </div>
      </section>

      <Modal
        cancelText={t("取消")}
        confirmLoading={savingSettings}
        okText={t("保存")}
        onCancel={() => setSettingsOpen(false)}
        onOk={() => void saveSettings()}
        open={settingsOpen}
        title={t("访问日志设置")}
      >
        <Form form={settingsForm} layout="vertical" initialValues={{ retentionDays: 7 }}>
          <Form.Item
            label={t("日志保留时间")}
            name="retentionDays"
            extra={t("超过 {{0}} 天的日志将被自动清理，最长可配置 7 天。", { "0": selectedRetentionDays })}
            rules={[{ required: true, message: t("请输入日志保留天数") }]}
          >
            <InputNumber addonAfter={t("天")} min={1} max={7} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </ContentStudioLayout>
  );
}
