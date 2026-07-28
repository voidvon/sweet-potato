import { ClearOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { TemporaryAssetCleanupCandidate } from '../../../api/content-cleanup';
import { useTableBodyHeight } from '../../../hooks/useTableBodyHeight';
import { AssetIdentity } from './AssetIdentity';
import { assetKindLabel, formatDateTime, formatFileSize, formatRemaining } from './cleanupFormatters';

type CleanupCandidatesTableProps = {
  candidates: TemporaryAssetCleanupCandidate[];
  checkingOrphans: boolean;
  cleaning: boolean;
  deleting: boolean;
  loading: boolean;
  page: number;
  pageSize: number;
  selectedAssetIds: string[];
  total: number;
  onCleanup: () => void;
  onDelete: (assetIds: string[]) => void;
  onInspectOrphans: () => void;
  onPageChange: (page: number, pageSize: number) => void;
  onRefresh: () => void;
  onSelectionChange: (assetIds: string[]) => void;
};

export function CleanupCandidatesTable({
  candidates,
  checkingOrphans,
  cleaning,
  deleting,
  loading,
  page,
  pageSize,
  selectedAssetIds,
  total,
  onCleanup,
  onDelete,
  onInspectOrphans,
  onPageChange,
  onRefresh,
  onSelectionChange,
}: CleanupCandidatesTableProps) {
  const table = useTableBodyHeight();
  const columns = useMemo<ColumnsType<TemporaryAssetCleanupCandidate>>(() => [
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
    { title: '大小', dataIndex: 'fileSize', align: 'right', width: 110, render: formatFileSize },
    { title: '上传时间', dataIndex: 'createdAt', width: 190, render: formatDateTime },
    { title: '计划清理时间', dataIndex: 'expiresAt', width: 190, render: formatDateTime },
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
          onConfirm={() => onDelete([record.id])}
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
  ], [cleaning, deleting, onDelete]);

  return (
    <>
      <div className="temporary-cleanup-actions">
        <Space>
          <Popconfirm
            cancelText="取消"
            okButtonProps={{ danger: true }}
            okText="删除"
            onConfirm={() => onDelete(selectedAssetIds)}
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
            <Button
              aria-label="刷新待清理资源"
              disabled={deleting || checkingOrphans}
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={onRefresh}
            />
          </Tooltip>
          <Popconfirm cancelText="取消" okText="清理" onConfirm={onCleanup} title="立即清理所有已过期素材？">
            <Button danger disabled={deleting || checkingOrphans} icon={<ClearOutlined />} loading={cleaning}>
              清理已过期素材
            </Button>
          </Popconfirm>
          <Button
            disabled={deleting || cleaning}
            icon={<SearchOutlined />}
            loading={checkingOrphans}
            onClick={onInspectOrphans}
          >
            检查孤立文件
          </Button>
        </Space>
      </div>
      <div
        className="temporary-cleanup-table-viewport"
        ref={table.viewportRef}
        style={{ '--temporary-table-body-height': `${table.bodyHeight}px` } as CSSProperties}
      >
        <Table
          className="temporary-cleanup-table"
          columns={columns}
          dataSource={candidates}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (value) => `共 ${value} 条`,
            onChange: onPageChange,
          }}
          rowSelection={{
            selectedRowKeys: selectedAssetIds,
            onChange: (selectedRowKeys) => onSelectionChange(selectedRowKeys.map(String)),
            getCheckboxProps: () => ({ disabled: deleting || cleaning }),
          }}
          rowKey="id"
          scroll={{ x: 1260, y: table.bodyHeight }}
        />
      </div>
    </>
  );
}
