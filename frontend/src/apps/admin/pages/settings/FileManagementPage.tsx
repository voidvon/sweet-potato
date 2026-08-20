import { DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { Button, Form, Popconfirm, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { resolveAssetUrl } from '@shared/api/core/request';
import {
  deleteManagedFile,
  listManagedFiles,
  type ManagedFile,
  type ManagedFileListFilters,
  type ManagedFileSummary,
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
import { t } from '@shared/i18n';

const emptySummary: ManagedFileSummary = {
  totalCount: 0,
  totalBytes: 0,
  localCount: 0,
  localBytes: 0,
};

export function FileManagementPage() {
  const [form] = Form.useForm<FileFilterForm>();
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [recordSummary, setRecordSummary] = useState<ManagedFileSummary>(emptySummary);
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
      const result = await listManagedFiles(nextPage, nextPageSize, nextFilters);
      setFiles(result.items);
      setPage(result.page);
      setPageSize(result.pageSize);
      setTotal(result.total);
      setRecordSummary(result.summary);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("文件列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    void loadFiles(1, 20, {});
  }, []);

  function applyFilters(values: FileFilterForm) {
    const nextFilters: ManagedFileListFilters = {
      search: values.search?.trim() || undefined,
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

  async function handleDelete(file: ManagedFile) {
    setDeletingFileId(file.id);
    try {
      await deleteManagedFile(file);
      if (detailFile?.id === file.id) setDetailFile(null);
      message.success(t("文件已删除"));
      await Promise.all([
        loadFiles(files.length === 1 && page > 1 ? page - 1 : page, pageSize),
      ]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("文件删除失败"));
    } finally {
      setDeletingFileId('');
    }
  }

  const columns: ColumnsType<ManagedFile> = [
    {
      title: t("文件"),
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
            <Typography.Text type="secondary">{file.mimeType || t("未知类型")}</Typography.Text>
          </Space>
        </Space>
      ),
    },
    { title: t("业务来源"), dataIndex: 'resourceType', width: 120, render: (value: string) => resourceTypeLabels[value] || value || '-' },
    {
      title: t("存储位置"),
      dataIndex: 'storageProvider',
      width: 110,
      render: () => <Tag>{t("本地")}</Tag>,
    },
    { title: t("文件大小"), dataIndex: 'fileSize', width: 110, align: 'right', render: formatBytes },
    {
      title: t("状态"),
      dataIndex: 'lifecycleStatus',
      width: 100,
      render: (value: string) => {
        const meta = lifecycleLabels[value] || { color: 'default', label: value || '-' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: t("引用"), dataIndex: 'referenceCount', width: 80, align: 'right', render: (value: number) => value ? t("{{0}} 处", { "0": value }) : '-' },
    { title: t("所属用户"), dataIndex: 'username', width: 130, render: (value: string) => value || '-' },
    { title: t("上传时间"), dataIndex: 'createdAt', width: 180, render: formatDateTime },
    {
      title: t("操作"),
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_, file) => (
        <Space size={0}>
          <Button type="link" href={resolveAssetUrl(file.fileUrl)} target="_blank" icon={<DownloadOutlined />}>{t("下载")}</Button>
          <Button type="link" onClick={() => setDetailFile(file)}>{t("详情")}</Button>
          <Popconfirm
            cancelText={t("取消")}
            description={t("删除后无法恢复，确定要删除这个文件吗？")}
            okButtonProps={{ danger: true, loading: deletingFileId === file.id }}
            okText={t("确认删除")}
            onConfirm={() => void handleDelete(file)}
            title={t("二次确认")}
          >
            <Button danger type="link" icon={<DeleteOutlined />} loading={deletingFileId === file.id}>{t("删除")}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page file-management-page">
        <FileManagementSummaryCards
          summary={recordSummary}
        />
        <FileManagementFilters
          form={form}
          loading={loading}
          onApply={applyFilters}
          onRefresh={() => { void loadFiles(); }}
          onReset={resetFilters}
          summaryText={t("共 {{0}} 个文件 / {{1}}", { "0": recordSummary.totalCount, "1": formatBytes(recordSummary.totalBytes) })}
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
            locale={{ emptyText: t("暂无文件记录") }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (count) => t("共 {{0}} 个文件", { "0": count }),
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
