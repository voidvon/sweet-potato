import { ClearOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { TemporaryAssetCleanupCandidate } from '../../../api/content-cleanup';
import { useTableBodyHeight } from '../../../hooks/useTableBodyHeight';
import { AssetIdentity } from './AssetIdentity';
import { assetKindLabel, formatDateTime, formatFileSize, formatRemaining } from './cleanupFormatters';
import { t } from '@shared/i18n';

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
      title: t("素材"),
      key: 'asset',
      width: 260,
      render: (_, record) => <AssetIdentity id={record.id} name={record.name} previewUrl={record.fileUrl} />,
    },
    {
      title: t("类型"),
      dataIndex: 'assetKind',
      width: 140,
      render: (value: string) => <Tag>{assetKindLabel(value)}</Tag>,
    },
    {
      title: t("用户"),
      key: 'user',
      width: 160,
      render: (_, record) => record.username || record.userId,
    },
    { title: t("大小"), dataIndex: 'fileSize', align: 'right', width: 110, render: formatFileSize },
    { title: t("上传时间"), dataIndex: 'createdAt', width: 190, render: formatDateTime },
    { title: t("计划清理时间"), dataIndex: 'expiresAt', width: 190, render: formatDateTime },
    {
      title: t("状态"),
      dataIndex: 'expiresAt',
      width: 130,
      render: (value: string) => {
        const expired = new Date(value).getTime() <= Date.now();
        return <Tag color={expired ? 'error' : 'processing'}>{formatRemaining(value)}</Tag>;
      },
    },
    {
      title: t("操作"),
      key: 'actions',
      align: 'center',
      fixed: 'right',
      width: 80,
      render: (_, record) => (
        <Popconfirm
          cancelText={t("取消")}
          okButtonProps={{ danger: true }}
          okText={t("删除")}
          onConfirm={() => onDelete([record.id])}
          title={t("立即删除此临时素材？删除后不可恢复。")}
        >
          <Button
            aria-label={t("删除 {{0}}", { "0": record.name })}
            danger
            disabled={cleaning}
            icon={<DeleteOutlined />}
            loading={deleting}
            title={t("立即删除")}
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
            cancelText={t("取消")}
            okButtonProps={{ danger: true }}
            okText={t("删除")}
            onConfirm={() => onDelete(selectedAssetIds)}
            title={t("立即删除选中的 {{0}} 条临时素材？删除后不可恢复。", { "0": selectedAssetIds.length })}
          >
            <Button
              danger
              disabled={!selectedAssetIds.length || cleaning || checkingOrphans}
              icon={<DeleteOutlined />}
              loading={deleting}
            >
              {t("删除所选")}{selectedAssetIds.length ? ` (${selectedAssetIds.length})` : ''}
            </Button>
          </Popconfirm>
          <Tooltip title={t("刷新待清理资源")}>
            <Button
              aria-label={t("刷新待清理资源")}
              disabled={deleting || checkingOrphans}
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={onRefresh}
            />
          </Tooltip>
          <Popconfirm cancelText={t("取消")} okText={t("清理")} onConfirm={onCleanup} title={t("立即清理所有已过期素材？")}>
            <Button danger disabled={deleting || checkingOrphans} icon={<ClearOutlined />} loading={cleaning}>
              {t("清理已过期素材")}
            </Button>
          </Popconfirm>
          <Button
            disabled={deleting || cleaning}
            icon={<SearchOutlined />}
            loading={checkingOrphans}
            onClick={onInspectOrphans}
          >
            {t("检查孤立文件")}
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
            showTotal: (value) => t("共 {{0}} 条", { "0": value }),
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
