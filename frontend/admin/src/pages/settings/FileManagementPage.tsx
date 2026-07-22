import {
  AudioOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveAssetUrl } from '@shared/api/core/request';
import {
  deleteManagedFile,
  getTosStorageSummary,
  listManagedFiles,
  listTosObjects,
  type ManagedFile,
  type ManagedFileListFilters,
  type ManagedFileMediaType,
  type ManagedFileSummary,
  type TosStorageSummary,
} from '../../api/file-management';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';

const { RangePicker } = DatePicker;

type DateValue = {
  startOf: (unit: 'day') => DateValue;
  endOf: (unit: 'day') => DateValue;
  toISOString: () => string;
};

type FilterForm = {
  search?: string;
  storageProvider?: ManagedFileListFilters['storageProvider'];
  mediaType?: ManagedFileListFilters['mediaType'];
  lifecycleStatus?: ManagedFileListFilters['lifecycleStatus'];
  createdAt?: [DateValue, DateValue];
};

const emptySummary: ManagedFileSummary = {
  totalCount: 0,
  totalBytes: 0,
  localCount: 0,
  localBytes: 0,
  tosCount: 0,
  tosBytes: 0,
};

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const resourceTypeLabels: Record<string, string> = {
  digital_human: '数字人',
  virtual_portrait: '形象素材',
  voice: '音色',
  scene: '场景',
  product: '商品',
  finished_video: '成片',
  real_person: '真人素材',
  other: '其他',
};

const lifecycleLabels: Record<string, { color: string; label: string }> = {
  temporary: { color: 'gold', label: '临时' },
  retained: { color: 'blue', label: '已引用' },
  permanent: { color: 'green', label: '永久' },
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function mediaIcon(mediaType: ManagedFileMediaType) {
  if (mediaType === 'image') return <FileImageOutlined />;
  if (mediaType === 'video') return <VideoCameraOutlined />;
  if (mediaType === 'audio') return <AudioOutlined />;
  if (mediaType === 'document') return <FileTextOutlined />;
  return <FileOutlined />;
}

function FilePreview({ file }: { file: ManagedFile }) {
  const fileUrl = resolveAssetUrl(file.fileUrl);
  if (file.mediaType === 'image') {
    return <Image alt={file.name} src={fileUrl} style={{ maxHeight: 560 }} />;
  }
  if (file.mediaType === 'video') {
    return <video controls src={fileUrl} style={{ display: 'block', maxHeight: 560, maxWidth: '100%', margin: '0 auto' }} />;
  }
  if (file.mediaType === 'audio') {
    return <audio controls src={fileUrl} style={{ width: '100%' }} />;
  }
  return (
    <Empty
      description="该文件类型暂不支持在线预览"
      image={<FileOutlined style={{ fontSize: 54 }} />}
    >
      <Button href={fileUrl} icon={<DownloadOutlined />} target="_blank">打开文件</Button>
    </Empty>
  );
}

export function FileManagementPage() {
  const [form] = Form.useForm<FilterForm>();
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
  const [previewFile, setPreviewFile] = useState<ManagedFile | null>(null);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);
  const [deletingFileId, setDeletingFileId] = useState('');

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

  const summary = useMemo<ManagedFileSummary>(() => {
    if (!tosStorageSummary) return recordSummary;
    return {
      totalCount: recordSummary.localCount + tosStorageSummary.objectCount,
      totalBytes: recordSummary.localBytes + tosStorageSummary.totalBytes,
      localCount: recordSummary.localCount,
      localBytes: recordSummary.localBytes,
      tosCount: tosStorageSummary.objectCount,
      tosBytes: tosStorageSummary.totalBytes,
    };
  }, [recordSummary, tosStorageSummary]);

  useEffect(() => {
    void loadFiles(1, 20, {});
    void loadTosSummary();
  }, []);

  function applyFilters(values: FilterForm) {
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
    const currentValues = form.getFieldsValue();
    const nextValues = { ...currentValues, storageProvider };
    form.setFieldsValue(nextValues);
    applyFilters(nextValues);
  }

  async function handleDelete(file: ManagedFile) {
    setDeletingFileId(file.id);
    try {
      await deleteManagedFile(file);
      if (previewFile?.id === file.id) setPreviewFile(null);
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

  const columns = useMemo<ColumnsType<ManagedFile>>(() => [
    {
      title: '文件',
      key: 'file',
      width: 300,
      render: (_, file) => (
        <Space>
          {file.mediaType === 'image' ? (
            <Image
              fallback="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
              height={42}
              preview={false}
              src={resolveAssetUrl(file.fileUrl)}
              style={{ objectFit: 'cover' }}
              width={42}
            />
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
    {
      title: '业务来源',
      dataIndex: 'resourceType',
      width: 120,
      render: (value: string) => resourceTypeLabels[value] || value || '-',
    },
    {
      title: '存储位置',
      dataIndex: 'storageProvider',
      width: 110,
      render: (value: ManagedFile['storageProvider']) => (
        <Tag color={value === 'tos' ? 'blue' : 'default'}>{value === 'tos' ? 'TOS' : '本地'}</Tag>
      ),
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      width: 110,
      align: 'right',
      render: (value: number) => formatBytes(value),
    },
    {
      title: '状态',
      dataIndex: 'lifecycleStatus',
      width: 100,
      render: (value: string) => {
        const meta = lifecycleLabels[value] || { color: 'default', label: value || '-' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '引用',
      dataIndex: 'referenceCount',
      width: 80,
      align: 'right',
      render: (value: number) => value ? `${value} 处` : '-',
    },
    {
      title: '所属用户',
      dataIndex: 'username',
      width: 130,
      render: (value: string) => value || '-',
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => dateTimeFormatter.format(new Date(value)),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 280,
      render: (_, file) => (
        <Space size={0}>
          <Button type="link" icon={<EyeOutlined />} onClick={() => setPreviewFile(file)}>预览</Button>
          <Button type="link" href={resolveAssetUrl(file.fileUrl)} target="_blank" icon={<DownloadOutlined />}>下载</Button>
          <Button type="link" onClick={() => setDetailFile(file)}>详情</Button>
          <Popconfirm
            cancelText="取消"
            description="删除后无法恢复，确定要删除这个文件吗？"
            okButtonProps={{ danger: true, loading: deletingFileId === file.id }}
            okText="确认删除"
            onConfirm={() => handleDelete(file)}
            title="二次确认"
          >
            <Button danger type="link" icon={<DeleteOutlined />} loading={deletingFileId === file.id}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], []);

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card hoverable onClick={() => filterByStorage()}>
              <Statistic title="全部文件" value={summary.totalCount} suffix={`个 / ${formatBytes(summary.totalBytes)}`} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card hoverable onClick={() => filterByStorage('local')}>
              <Statistic title="本地存储" value={summary.localCount} suffix={`个 / ${formatBytes(summary.localBytes)}`} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card hoverable onClick={() => filterByStorage('tos')}>
              <Statistic
                loading={tosSummaryLoading}
                title={tosStorageSummary ? `TOS 对象存储（${tosStorageSummary.bucket}）` : 'TOS 对象存储'}
                value={tosSummaryError ? '-' : summary.tosCount}
                suffix={tosSummaryError ? undefined : `个 / ${formatBytes(summary.tosBytes)}`}
              />
              {tosSummaryError ? <Tooltip title={tosSummaryError}><Typography.Text type="danger">容量读取失败，请检查 TOS 配置</Typography.Text></Tooltip> : null}
            </Card>
          </Col>
        </Row>

        <Card style={{ marginTop: 16 }}>
          <Form form={form} layout="inline" onFinish={applyFilters}>
            <Form.Item name="search">
              <Input allowClear placeholder="搜索文件名或所属用户" prefix={<SearchOutlined />} style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="storageProvider">
              <Select
                allowClear
                options={[{ label: '本地存储', value: 'local' }, { label: 'TOS 对象存储', value: 'tos' }]}
                placeholder="存储位置"
                style={{ width: 150 }}
              />
            </Form.Item>
            <Form.Item name="mediaType">
              <Select
                allowClear
                options={[
                  { label: '图片', value: 'image' },
                  { label: '视频', value: 'video' },
                  { label: '音频', value: 'audio' },
                  { label: '文档', value: 'document' },
                  { label: '其他', value: 'other' },
                ]}
                placeholder="文件类型"
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="lifecycleStatus">
              <Select
                allowClear
                options={[
                  { label: '临时', value: 'temporary' },
                  { label: '已引用', value: 'retained' },
                  { label: '永久', value: 'permanent' },
                ]}
                placeholder="文件状态"
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="createdAt">
              <RangePicker placeholder={['开始日期', '结束日期']} />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button htmlType="submit" icon={<SearchOutlined />} loading={loading} type="primary">查询</Button>
                <Button onClick={resetFilters}>重置</Button>
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading || tosSummaryLoading}
                  onClick={() => {
                    void loadFiles();
                    void loadTosSummary();
                  }}
                >
                  刷新
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <Table<ManagedFile>
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
            scroll={{ x: 1490 }}
          />
        </Card>
      </section>

      <Modal
        footer={previewFile ? <Button href={resolveAssetUrl(previewFile.fileUrl)} icon={<DownloadOutlined />} target="_blank">下载文件</Button> : null}
        onCancel={() => setPreviewFile(null)}
        open={Boolean(previewFile)}
        title={previewFile?.originalFileName || previewFile?.name || '文件预览'}
        width={820}
      >
        {previewFile ? <FilePreview file={previewFile} /> : null}
      </Modal>

      <Drawer onClose={() => setDetailFile(null)} open={Boolean(detailFile)} title="文件详情" width={720}>
        {detailFile ? (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="文件名">{detailFile.originalFileName || detailFile.name}</Descriptions.Item>
            <Descriptions.Item label="文件 ID"><Typography.Text copyable>{detailFile.id}</Typography.Text></Descriptions.Item>
            <Descriptions.Item label="存储位置">{detailFile.storageProvider === 'tos' ? 'TOS 对象存储' : '本地存储'}</Descriptions.Item>
            {detailFile.storageBucket ? <Descriptions.Item label="存储桶">{detailFile.storageBucket}</Descriptions.Item> : null}
            <Descriptions.Item label="存储 Key"><Typography.Text copyable>{detailFile.storageKey || '-'}</Typography.Text></Descriptions.Item>
            <Descriptions.Item label="文件类型">{detailFile.mimeType || '未知'}</Descriptions.Item>
            <Descriptions.Item label="文件大小">{formatBytes(detailFile.fileSize)}</Descriptions.Item>
            <Descriptions.Item label="业务来源">{resourceTypeLabels[detailFile.resourceType] || detailFile.resourceType}</Descriptions.Item>
            <Descriptions.Item label="所属用户">{detailFile.username || '-'}</Descriptions.Item>
            <Descriptions.Item label="引用数量">{detailFile.referenceCount}</Descriptions.Item>
            <Descriptions.Item label="上传时间">{dateTimeFormatter.format(new Date(detailFile.createdAt))}</Descriptions.Item>
            <Descriptions.Item label="文件地址"><Typography.Text copyable ellipsis>{resolveAssetUrl(detailFile.fileUrl)}</Typography.Text></Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </ContentStudioLayout>
  );
}
