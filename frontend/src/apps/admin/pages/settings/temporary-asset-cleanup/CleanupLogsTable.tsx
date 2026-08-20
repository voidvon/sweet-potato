import { ReloadOutlined } from '@ant-design/icons';
import { Button, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import type { TemporaryAssetCleanupLog } from '../../../api/content-cleanup';
import { useTableBodyHeight } from '../../../hooks/useTableBodyHeight';
import { AssetIdentity } from './AssetIdentity';
import { assetKindLabel, formatDateTime, formatFileSize } from './cleanupFormatters';
import { t } from '@shared/i18n';

type CleanupLogsTableProps = {
  loading: boolean;
  logs: TemporaryAssetCleanupLog[];
  onRefresh: () => void;
};

export function CleanupLogsTable({ loading, logs, onRefresh }: CleanupLogsTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const table = useTableBodyHeight();
  const columns = useMemo<ColumnsType<TemporaryAssetCleanupLog>>(() => [
    { title: t("清理时间"), dataIndex: 'cleanedAt', width: 190, render: formatDateTime },
    {
      title: t("触发方式"),
      dataIndex: 'triggerType',
      width: 110,
      render: (value: TemporaryAssetCleanupLog['triggerType']) => (
        <Tag color={value === 'manual' ? 'blue' : undefined}>{value === 'manual' ? t("手动") : t("定时")}</Tag>
      ),
    },
    {
      title: t("素材"),
      key: 'asset',
      width: 260,
      render: (_, record) => <AssetIdentity id={record.assetId} name={record.name} />,
    },
    { title: t("类型"), dataIndex: 'assetKind', width: 140, render: (value: string) => <Tag>{assetKindLabel(value)}</Tag> },
    { title: t("用户"), key: 'user', width: 160, render: (_, record) => record.username || record.userId },
    { title: t("大小"), dataIndex: 'fileSize', align: 'right', width: 110, render: formatFileSize },
    { title: t("原计划时间"), dataIndex: 'expiresAt', width: 190, render: formatDateTime },
  ], []);

  return (
    <>
      <div className="temporary-cleanup-actions">
        <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>{t("刷新日志")}</Button>
      </div>
      <div
        className="temporary-cleanup-table-viewport"
        ref={table.viewportRef}
        style={{ '--temporary-table-body-height': `${table.bodyHeight}px` } as CSSProperties}
      >
        <Table
          className="temporary-cleanup-table"
          columns={columns}
          dataSource={logs}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total: logs.length,
            showSizeChanger: true,
            showTotal: (value) => t("共 {{0}} 条", { "0": value }),
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
          rowKey="id"
          scroll={{ x: 1160, y: table.bodyHeight }}
        />
      </div>
    </>
  );
}
