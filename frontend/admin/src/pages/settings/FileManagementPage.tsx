import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Form, Popconfirm, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveAssetUrl } from '@shared/api/core/request';
import {
  deleteManagedFile,
  getTosStorageSummary,
  listManagedFiles,
  listTosObjects,
  type ManagedFile,
  type ManagedFileListFilters,
  type ManagedFileSummary,
  type TosStorageSummary,
} from '../../api/file-management';
import { WorkPreviewThumbnail } from '../../components/WorkPreviewThumbnail';
import { useTableBodyHeight } from '../../hooks/useTableBodyHeight';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { FileManagementFilters, type FileFilterForm } from './file-management/FileManagementFilters';
import { FileManagementSummaryCards } from './file-management/FileManagementSummaryCards';
import { ManagedFileDetailDrawer } from './file-management/ManagedFileDetailDrawer';
import {
  formatBytes,
  formatDateTime,
  lifecycleLabels,
  mediaIcon,
  resourceTypeLabels,
} from './file-management/fileManagementFormatters';
import './FileManagementPage.scss';

const emptySummary: ManagedFileSummary = {
  totalCount: 0,
  totalBytes: 0,
  localCount: 0,
  localBytes: 0,
  tosCount: 0,
  tosBytes: 0,
};

export function FileManagementPage() {
  const [form] = Form.useForm<FileFilterForm>();
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [recordSummary, setRecordSummary] = useState<ManagedFileSummary>(emptySummary);
  const [tosStorageSummary, setTosStorageSummary] = useState<TosStorageSummary | null>(null);
  const [tosSummaryError, setTosSummaryError] = useState('');
  const [tosSummaryLoading, setTosSummaryLoading] = useState(false);
  const [filters, setFilters] = useState<ManagedFileListFilters>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);
  const [deletingFileId, setDeletingFileId] = useState('');
  const fileTable = useTableBodyHeight();

  const loadFiles = useCallback(async (
    nextPage = page,
    nextPageSize = pageSize,
    nextFilters = filters,
  ) => {
    setLoading(true);
    try {
      const result = nextFilters.storageProvider === 'tos'
        ? await listTosObjects(nextPage, nextPageSize, nextFilters)
        : await listManagedFiles(nextPage, nextPageSize, nextFilters);
      setFiles(result.items);
      setPage(result.page);
      setPageSize(result.pageSize);
      setTotal(result.total);
      setRecordSummary(result.summary);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '文件列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  const loadTosSummary = useCallback(async () => {
    setTosSummaryLoading(true);
    setTosSummaryError('');
    try {
      setTosStorageSummary(await getTosStorageSummary());
    } catch (error) {
      setTosStorageSummary(null);
      setTosSummaryError(error instanceof Error ? error.message : 'TOS 存储容量读取失败');
    } finally {
      setTosSummaryLoading(false);
    }
  }, []);

  const summary = useMemo<ManagedFileSummary>(() => tosStorageSummary ? {
    totalCount: recordSummary.localCount + tosStorageSummary.objectCount,
    totalBytes: recordSummary.localBytes + tosStorageSummary.totalBytes,
    localCount: recordSummary.localCount,
    localBytes: recordSummary.localBytes,
    tosCount: tosStorageSummary.objectCount,
    tosBytes: tosStorageSummary.totalBytes,
  } : recordSummary, [recordSummary, tosStorageSummary]);

  useEffect(() => {
    void loadFiles(1, 20, {});
    void loadTosSummary();
  }, []);

  function applyFilters(values: FileFilterForm) {
    const nextFilters: ManagedFileListFilters = {
      search: values.search?.trim() || undefined,
      storageProvider: values.storageProvider,
      mediaType: values.mediaType,
      lifecycleStatus: values.lifecycleStatus,
      createdAtFrom: values.createdAt?.[0]?.startOf('day').toISOString(),
      createdAtTo: values.createdAt?.[1]?.endOf('day').toISOString(),
    };
    setFilters(nextFilters);
    void loadFiles(1, pageSize, nextFilters);
  }

  function resetFilters() {
    form.resetFields();
    setFilters({});
    void loadFiles(1, pageSize, {});
  }

  function filterByStorage(storageProvider?: 'local' | 'tos') {
    const nextValues = { ...form.getFieldsValue(), storageProvider };
    form.setFieldsValue(nextValues);
    applyFilters(nextValues);
  }

  async function handleDelete(file: ManagedFile) {
    setDeletingFileId(file.id);
    try {
      await deleteManagedFile(file);
      if (detailFile?.id === file.id) setDetailFile(null);
      message.success('文件已删除');
      await Promise.all([
        loadFiles(files.length === 1 && page > 1 ? page - 1 : page, pageSize),
        loadTosSummary(),
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '文件删除失败');
    } finally {
      setDeletingFileId('');
    }
  }

  const columns: ColumnsType<ManagedFile> = [
    {
      title: '文件',
      key: 'file',
      width: 300,
      render: (_, file) => (
        <Space>
          {file.mediaType === 'image' || file.mediaType === 'video' ? (
            <WorkPreviewThumbnail coverUrl={file.coverUrl} fileUrl={file.fileUrl} mediaType={file.mediaType} title={file.name} />
          ) : mediaIcon(file.mediaType)}
          <Space direction="vertical" size={0}>
            <Tooltip title={file.originalFileName || file.name}>
              <Typography.Text ellipsis style={{ maxWidth: 220 }}>{file.originalFileName || file.name}</Typography.Text>
            </Tooltip>
            <Typography.Text type="secondary">{file.mimeType || '未知类型'}</Typography.Text>
          </Space>
        </Space>
      ),
    },
    { title: '业务来源', dataIndex: 'resourceType', width: 120, render: (value: string) => resourceTypeLabels[value] || value || '-' },
    {
      title: '存储位置',
      dataIndex: 'storageProvider',
      width: 110,
      render: (value: ManagedFile['storageProvider']) => <Tag color={value === 'tos' ? 'blue' : 'default'}>{value === 'tos' ? 'TOS' : '本地'}</Tag>,
    },
    { title: '文件大小', dataIndex: 'fileSize', width: 110, align: 'right', render: formatBytes },
    {
      title: '状态',
      dataIndex: 'lifecycleStatus',
      width: 100,
      render: (value: string) => {
        const meta = lifecycleLabels[value] || { color: 'default', label: value || '-' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: '引用', dataIndex: 'referenceCount', width: 80, align: 'right', render: (value: number) => value ? `${value} 处` : '-' },
    { title: '所属用户', dataIndex: 'username', width: 130, render: (value: string) => value || '-' },
    { title: '上传时间', dataIndex: 'createdAt', width: 180, render: formatDateTime },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_, file) => (
        <Space size={0}>
          <Button type="link" href={resolveAssetUrl(file.fileUrl)} target="_blank" icon={<DownloadOutlined />}>下载</Button>
          <Button type="link" onClick={() => setDetailFile(file)}>详情</Button>
          <Popconfirm
            cancelText="取消"
            description="删除后无法恢复，确定要删除这个文件吗？"
            okButtonProps={{ danger: true, loading: deletingFileId === file.id }}
            okText="确认删除"
            onConfirm={() => void handleDelete(file)}
            title="二次确认"
          >
            <Button danger type="link" icon={<DeleteOutlined />} loading={deletingFileId === file.id}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page file-management-page">
        <FileManagementSummaryCards
          onStorageFilter={filterByStorage}
          summary={summary}
          tosStorageSummary={tosStorageSummary}
          tosSummaryError={tosSummaryError}
          tosSummaryLoading={tosSummaryLoading}
        />
        <FileManagementFilters
          form={form}
          loading={loading}
          onApply={applyFilters}
          onRefresh={() => { void loadFiles(); void loadTosSummary(); }}
          onReset={resetFilters}
          summaryText={`共 ${summary.totalCount} 个文件 / ${formatBytes(summary.totalBytes)}`}
          tosSummaryError={tosSummaryError}
          tosSummaryLoading={tosSummaryLoading}
        />
        <div
          className="file-management-table-viewport"
          ref={fileTable.viewportRef}
          style={{ '--file-management-table-body-height': `${fileTable.bodyHeight}px` } as CSSProperties}
        >
          <Table<ManagedFile>
            className="file-management-table"
            columns={columns}
            dataSource={files}
            loading={loading}
            locale={{ emptyText: '暂无文件记录' }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (count) => `共 ${count} 个文件`,
              onChange: (nextPage, nextPageSize) => void loadFiles(nextPage, nextPageSize),
            }}
            rowKey="id"
            scroll={{ x: 1490, y: fileTable.bodyHeight }}
          />
        </div>
      </section>
      <ManagedFileDetailDrawer file={detailFile} onClose={() => setDetailFile(null)} />
    </ContentStudioLayout>
  );
}
