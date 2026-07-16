import { ClearOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import {
  listTemporaryAssetCleanupCandidates,
  listTemporaryAssetCleanupLogs,
  runTemporaryAssetCleanup,
  type TemporaryAssetCleanupCandidate,
  type TemporaryAssetCleanupLog,
} from '../../api/content-cleanup';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import './TemporaryAssetCleanupPage.scss';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormatter.format(date);
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function assetKindLabel(kind: string) {
  const labels: Record<string, string> = {
    audio_input: '音频输入',
    image_input: '图片输入',
    video_input: '视频输入',
    video_source: '视频原始文件',
    video_trimmed: '视频裁剪文件',
  };
  return labels[kind] || kind || '临时素材';
}

function formatRemaining(expiresAt: string) {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '已过期';
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(remainingMs / 3_600_000);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
}

function AssetIdentity({ id, name }: { id: string; name: string }) {
  return (
    <div className="cleanup-asset-identity">
      <Typography.Text ellipsis={{ tooltip: name }} strong>{name || '-'}</Typography.Text>
      <Typography.Text copyable={{ text: id }} type="secondary">{id.slice(0, 12)}</Typography.Text>
    </div>
  );
}

export function TemporaryAssetCleanupPage() {
  const [candidates, setCandidates] = useState<TemporaryAssetCleanupCandidate[]>([]);
  const [logs, setLogs] = useState<TemporaryAssetCleanupLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  async function loadData(nextPage = page, nextPageSize = pageSize) {
    setLoading(true);
    try {
      const [candidateResult, cleanupLogs] = await Promise.all([
        listTemporaryAssetCleanupCandidates(nextPage, nextPageSize),
        listTemporaryAssetCleanupLogs(),
      ]);
      setCandidates(candidateResult.items);
      setPage(candidateResult.page);
      setPageSize(candidateResult.pageSize);
      setTotal(candidateResult.total);
      setLogs(cleanupLogs);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '临时素材清理数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(1, 20);
  }, []);

  const expiredTotal = useMemo(
    () => candidates.filter((item) => new Date(item.expiresAt).getTime() <= Date.now()).length,
    [candidates],
  );

  const candidateColumns = useMemo<ColumnsType<TemporaryAssetCleanupCandidate>>(() => [
    {
      title: '素材',
      key: 'asset',
      width: 260,
      render: (_, record) => <AssetIdentity id={record.id} name={record.name} />,
    },
    {
      title: '类型',
      dataIndex: 'assetKind',
      width: 140,
      render: (value: string) => <Tag>{assetKindLabel(value)}</Tag>,
    },
    {
      title: '用户',
      key: 'user',
      width: 160,
      render: (_, record) => record.username || record.userId,
    },
    {
      title: '大小',
      dataIndex: 'fileSize',
      align: 'right',
      width: 110,
      render: formatFileSize,
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '计划清理时间',
      dataIndex: 'expiresAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '状态',
      dataIndex: 'expiresAt',
      width: 130,
      render: (value: string) => {
        const expired = new Date(value).getTime() <= Date.now();
        return <Tag color={expired ? 'error' : 'processing'}>{formatRemaining(value)}</Tag>;
      },
    },
  ], []);

  const logColumns = useMemo<ColumnsType<TemporaryAssetCleanupLog>>(() => [
    {
      title: '清理时间',
      dataIndex: 'cleanedAt',
      width: 190,
      render: formatDateTime,
    },
    {
      title: '触发方式',
      dataIndex: 'triggerType',
      width: 110,
      render: (value: TemporaryAssetCleanupLog['triggerType']) => (
        <Tag color={value === 'manual' ? 'blue' : undefined}>{value === 'manual' ? '手动' : '定时'}</Tag>
      ),
    },
    {
      title: '素材',
      key: 'asset',
      width: 260,
      render: (_, record) => <AssetIdentity id={record.assetId} name={record.name} />,
    },
    {
      title: '类型',
      dataIndex: 'assetKind',
      width: 140,
      render: (value: string) => <Tag>{assetKindLabel(value)}</Tag>,
    },
    {
      title: '用户',
      key: 'user',
      width: 160,
      render: (_, record) => record.username || record.userId,
    },
    {
      title: '大小',
      dataIndex: 'fileSize',
      align: 'right',
      width: 110,
      render: formatFileSize,
    },
    {
      title: '原计划时间',
      dataIndex: 'expiresAt',
      width: 190,
      render: formatDateTime,
    },
  ], []);

  async function handleCleanup() {
    setCleaning(true);
    try {
      const result = await runTemporaryAssetCleanup();
      message.success(result.deleted ? `已清理 ${result.deleted} 条临时素材` : '当前没有已过期素材');
      await loadData(1, pageSize);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '临时素材清理失败');
    } finally {
      setCleaning(false);
    }
  }

  return (
    <ContentStudioLayout>
      <section className="settings-page temporary-cleanup-page">
        <div className="temporary-cleanup-toolbar">
          <div className="temporary-cleanup-summary">
            <span>待清理 <strong>{total}</strong></span>
            <span>当前页已过期 <strong className={expiredTotal ? 'is-danger' : ''}>{expiredTotal}</strong></span>
            <span>日志 <strong>{logs.length}</strong></span>
          </div>
          <Space>
            <Tooltip title="刷新">
              <Button aria-label="刷新" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData()} />
            </Tooltip>
            <Popconfirm
              cancelText="取消"
              okText="清理"
              onConfirm={() => void handleCleanup()}
              title="立即清理所有已过期素材？"
            >
              <Button danger icon={<ClearOutlined />} loading={cleaning}>清理已过期素材</Button>
            </Popconfirm>
          </Space>
        </div>

        <Tabs items={[
          {
            key: 'pending',
            label: `待清理 (${total})`,
            children: (
              <Table
                className="temporary-cleanup-table"
                columns={candidateColumns}
                dataSource={candidates}
                loading={loading}
                pagination={{
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  showTotal: (value) => `共 ${value} 条`,
                  onChange: (nextPage, nextPageSize) => void loadData(nextPage, nextPageSize),
                }}
                rowKey="id"
                scroll={{ x: 1180 }}
              />
            ),
          },
          {
            key: 'logs',
            label: `清理日志 (${logs.length}/100)`,
            children: (
              <Table
                className="temporary-cleanup-table"
                columns={logColumns}
                dataSource={logs}
                loading={loading}
                pagination={false}
                rowKey="id"
                scroll={{ x: 1160, y: 560 }}
              />
            ),
          },
        ]} />
      </section>
    </ContentStudioLayout>
  );
}
