import { ClearOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Modal, Popconfirm, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveAssetUrl } from '@shared/api/core/request';
import {
  deleteOrphanContentFiles,
  deleteTemporaryAssets,
  getTemporaryAssetDiskSpace,
  inspectOrphanContentFiles,
  listTemporaryAssetCleanupCandidates,
  listTemporaryAssetCleanupLogs,
  runTemporaryAssetCleanup,
  type OrphanContentFileInspection,
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

function formatDiskSpace(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '--';
  return `${(bytes / 1024 ** 3).toFixed(2)} G`;
}

function orphanFilePreviewUrl(relativePath: string) {
  const encodedPath = relativePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return resolveAssetUrl(`/files/${encodedPath}`);
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

function AssetIdentity({ id, name, previewUrl }: { id: string; name: string; previewUrl?: string }) {
  return (
    <div className="cleanup-asset-identity">
      {previewUrl ? (
        <Typography.Link
          ellipsis
          href={resolveAssetUrl(previewUrl)}
          rel="noreferrer"
          strong
          target="_blank"
          title={name}
        >
          {name || '-'}
        </Typography.Link>
      ) : (
        <Typography.Text ellipsis={{ tooltip: name }} strong>{name || '-'}</Typography.Text>
      )}
      <Typography.Text copyable={{ text: id }} type="secondary">{id.slice(0, 12)}</Typography.Text>
    </div>
  );
}

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

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  return { bodyHeight, viewportRef };
}

export function TemporaryAssetCleanupPage() {
  const [candidates, setCandidates] = useState<TemporaryAssetCleanupCandidate[]>([]);
  const [logs, setLogs] = useState<TemporaryAssetCleanupLog[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [availableDiskBytes, setAvailableDiskBytes] = useState<number | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checkingOrphans, setCheckingOrphans] = useState(false);
  const [orphanInspection, setOrphanInspection] = useState<OrphanContentFileInspection | null>(null);
  const [selectedOrphanPaths, setSelectedOrphanPaths] = useState<string[]>([]);
  const [deletingOrphans, setDeletingOrphans] = useState(false);
  const pendingTable = useTableBodyHeight();
  const logTable = useTableBodyHeight();

  async function loadData(nextPage = page, nextPageSize = pageSize) {
    setLoading(true);
    try {
      const [candidateResult, cleanupLogs, diskSpace] = await Promise.all([
        listTemporaryAssetCleanupCandidates(nextPage, nextPageSize),
        listTemporaryAssetCleanupLogs(),
        getTemporaryAssetDiskSpace(),
      ]);
      setCandidates(candidateResult.items);
      setPage(candidateResult.page);
      setPageSize(candidateResult.pageSize);
      setTotal(candidateResult.total);
      setLogs(cleanupLogs);
      setAvailableDiskBytes(diskSpace.availableBytes);
      setSelectedAssetIds([]);
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

  async function handleDeleteAssets(assetIds: string[]) {
    setDeleting(true);
    try {
      const result = await deleteTemporaryAssets(assetIds);
      if (result.deleted) {
        message.success(`已删除 ${result.deleted} 条临时素材`);
      } else {
        message.warning('所选素材已不存在或已被引用');
      }
      const nextPage = assetIds.length >= candidates.length ? Math.max(1, page - 1) : page;
      await loadData(nextPage, pageSize);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '临时素材删除失败');
    } finally {
      setDeleting(false);
    }
  }

  const candidateColumns = useMemo<ColumnsType<TemporaryAssetCleanupCandidate>>(() => [
    {
      title: '素材',
      key: 'asset',
      width: 260,
      render: (_, record) => <AssetIdentity id={record.id} name={record.name} previewUrl={record.fileUrl} />,
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
    {
      title: '操作',
      key: 'actions',
      align: 'center',
      fixed: 'right',
      width: 80,
      render: (_, record) => (
        <Popconfirm
          cancelText="取消"
          okButtonProps={{ danger: true }}
          okText="删除"
          onConfirm={() => void handleDeleteAssets([record.id])}
          title="立即删除此临时素材？删除后不可恢复。"
        >
          <Button
            aria-label={`删除 ${record.name}`}
            danger
            disabled={cleaning}
            icon={<DeleteOutlined />}
            loading={deleting}
            title="立即删除"
            type="text"
          />
        </Popconfirm>
      ),
    },
  ], [candidates.length, cleaning, deleting, page, pageSize]);

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

  async function handleInspectOrphanFiles() {
    setCheckingOrphans(true);
    try {
      const result = await inspectOrphanContentFiles();
      setOrphanInspection(result);
      setSelectedOrphanPaths([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '孤立文件检查失败');
    } finally {
      setCheckingOrphans(false);
    }
  }

  async function handleDeleteOrphanFiles(relativePaths: string[]) {
    setDeletingOrphans(true);
    try {
      const result = await deleteOrphanContentFiles(relativePaths);
      if (result.deleted) {
        message.success(`已删除 ${result.deleted} 个孤立文件`);
      } else {
        message.warning('所选文件已不存在或已被数据库引用');
      }
      const nextInspection = await inspectOrphanContentFiles();
      setOrphanInspection(nextInspection);
      setSelectedOrphanPaths([]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '孤立文件删除失败');
    } finally {
      setDeletingOrphans(false);
    }
  }

  const orphanFileColumns = useMemo<ColumnsType<OrphanContentFileInspection['items'][number]>>(() => [
    {
      title: '文件名称',
      dataIndex: 'relativePath',
      ellipsis: true,
      render: (relativePath: string) => (
        <Typography.Link href={orphanFilePreviewUrl(relativePath)} rel="noreferrer" target="_blank">
          {relativePath}
        </Typography.Link>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      align: 'right',
      width: 110,
      render: formatFileSize,
    },
    {
      title: '修改时间',
      dataIndex: 'modifiedAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      align: 'center',
      width: 72,
      render: (_, record) => (
        <Popconfirm
          cancelText="取消"
          okButtonProps={{ danger: true }}
          okText="删除"
          onConfirm={() => void handleDeleteOrphanFiles([record.relativePath])}
          title="确认删除此孤立文件？删除后不可恢复。"
        >
          <Button
            aria-label={`删除 ${record.relativePath}`}
            danger
            icon={<DeleteOutlined />}
            loading={deletingOrphans}
            title="删除"
            type="text"
          />
        </Popconfirm>
      ),
    },
  ], [deletingOrphans]);

  return (
    <ContentStudioLayout>
      <section className="settings-page temporary-cleanup-page">
        <div className="temporary-cleanup-toolbar">
          <div className="temporary-cleanup-summary">
            <span>磁盘剩余空间 <strong>{formatDiskSpace(availableDiskBytes)}</strong></span>
            <span>待清理 <strong>{total}</strong></span>
            <span>当前页已过期 <strong className={expiredTotal ? 'is-danger' : ''}>{expiredTotal}</strong></span>
            <span>日志 <strong>{logs.length}</strong></span>
          </div>
        </div>

        <Tabs items={[
          {
            key: 'pending',
            label: `待清理 (${total})`,
            children: (
              <>
                <div className="temporary-cleanup-actions">
                  <Space>
                    <Popconfirm
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      okText="删除"
                      onConfirm={() => void handleDeleteAssets(selectedAssetIds)}
                      title={`立即删除选中的 ${selectedAssetIds.length} 条临时素材？删除后不可恢复。`}
                    >
                      <Button
                        danger
                        disabled={!selectedAssetIds.length || cleaning || checkingOrphans}
                        icon={<DeleteOutlined />}
                        loading={deleting}
                      >
                        删除所选{selectedAssetIds.length ? ` (${selectedAssetIds.length})` : ''}
                      </Button>
                    </Popconfirm>
                    <Tooltip title="刷新待清理资源">
                      <Button aria-label="刷新待清理资源" disabled={deleting || checkingOrphans} icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData()} />
                    </Tooltip>
                    <Popconfirm
                      cancelText="取消"
                      okText="清理"
                      onConfirm={() => void handleCleanup()}
                      title="立即清理所有已过期素材？"
                    >
                      <Button danger disabled={deleting || checkingOrphans} icon={<ClearOutlined />} loading={cleaning}>清理已过期素材</Button>
                    </Popconfirm>
                    <Button
                      disabled={deleting || cleaning}
                      icon={<SearchOutlined />}
                      loading={checkingOrphans}
                      onClick={() => void handleInspectOrphanFiles()}
                    >
                      检查孤立文件
                    </Button>
                  </Space>
                </div>
                <div
                  className="temporary-cleanup-table-viewport"
                  ref={pendingTable.viewportRef}
                  style={{ '--temporary-table-body-height': `${pendingTable.bodyHeight}px` } as CSSProperties}
                >
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
                    rowSelection={{
                      selectedRowKeys: selectedAssetIds,
                      onChange: (selectedRowKeys) => setSelectedAssetIds(selectedRowKeys.map(String)),
                      getCheckboxProps: () => ({ disabled: deleting || cleaning }),
                    }}
                    rowKey="id"
                    scroll={{ x: 1260, y: pendingTable.bodyHeight }}
                  />
                </div>
              </>
            ),
          },
          {
            key: 'logs',
            label: `清理日志 (${logs.length}/100)`,
            children: (
              <>
                <div className="temporary-cleanup-actions">
                  <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadData()}>刷新日志</Button>
                </div>
                <div
                  className="temporary-cleanup-table-viewport"
                  ref={logTable.viewportRef}
                  style={{ '--temporary-table-body-height': `${logTable.bodyHeight}px` } as CSSProperties}
                >
                  <Table
                    className="temporary-cleanup-table"
                    columns={logColumns}
                    dataSource={logs}
                    loading={loading}
                    pagination={{
                      current: logPage,
                      pageSize: logPageSize,
                      total: logs.length,
                      showSizeChanger: true,
                      showTotal: (value) => `共 ${value} 条`,
                      onChange: (nextPage, nextPageSize) => {
                        setLogPage(nextPage);
                        setLogPageSize(nextPageSize);
                      },
                    }}
                    rowKey="id"
                    scroll={{ x: 1160, y: logTable.bodyHeight }}
                  />
                </div>
              </>
            ),
          },
        ]} />

        <Modal
          centered
          className="orphan-file-inspection-modal"
          closable={!deletingOrphans}
          footer={<Button disabled={deletingOrphans} onClick={() => setOrphanInspection(null)}>关闭</Button>}
          maskClosable={!deletingOrphans}
          onCancel={() => {
            if (!deletingOrphans) setOrphanInspection(null);
          }}
          open={Boolean(orphanInspection)}
          title="孤立文件检查结果"
          width={900}
        >
          {orphanInspection ? (
            <div>
              <Typography.Paragraph>
                共扫描 <strong>{orphanInspection.scannedFiles}</strong> 个文件，发现疑似孤立文件 <strong>{orphanInspection.orphanFiles}</strong> 个，
                占用空间 <strong>{formatFileSize(orphanInspection.orphanBytes)}</strong>。
              </Typography.Paragraph>
              <div className="orphan-file-actions">
                <Popconfirm
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  okText="删除"
                  onConfirm={() => void handleDeleteOrphanFiles(selectedOrphanPaths)}
                  title={`确认删除选中的 ${selectedOrphanPaths.length} 个孤立文件？删除后不可恢复。`}
                >
                  <Button
                    danger
                    disabled={!selectedOrphanPaths.length}
                    icon={<DeleteOutlined />}
                    loading={deletingOrphans}
                  >
                    删除所选{selectedOrphanPaths.length ? ` (${selectedOrphanPaths.length})` : ''}
                  </Button>
                </Popconfirm>
              </div>
              <Table
                columns={orphanFileColumns}
                dataSource={orphanInspection.items}
                loading={deletingOrphans}
                pagination={false}
                rowKey="relativePath"
                rowSelection={{
                  selectedRowKeys: selectedOrphanPaths,
                  onChange: (selectedRowKeys) => setSelectedOrphanPaths(selectedRowKeys.map(String)),
                  getCheckboxProps: () => ({ disabled: deletingOrphans }),
                }}
                scroll={{ x: 760, y: 400 }}
                size="small"
              />
              {orphanInspection.truncated ? (
                <Typography.Paragraph className="orphan-file-truncated" type="secondary">
                  结果较多，仅展示体积最大的前 500 个文件。
                </Typography.Paragraph>
              ) : null}
            </div>
          ) : null}
        </Modal>
      </section>
    </ContentStudioLayout>
  );
}
