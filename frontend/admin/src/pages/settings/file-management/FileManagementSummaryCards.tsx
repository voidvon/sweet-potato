import { Card, Col, Row, Statistic, Tooltip, Typography } from 'antd';
import type { ManagedFileSummary, TosStorageSummary } from '../../../api/file-management';
import { formatBytes } from './fileManagementFormatters';

type FileManagementSummaryCardsProps = {
  summary: ManagedFileSummary;
  tosStorageSummary: TosStorageSummary | null;
  tosSummaryError: string;
  tosSummaryLoading: boolean;
  onStorageFilter: (storageProvider?: 'local' | 'tos') => void;
};

export function FileManagementSummaryCards({
  summary,
  tosStorageSummary,
  tosSummaryError,
  tosSummaryLoading,
  onStorageFilter,
}: FileManagementSummaryCardsProps) {
  return (
    <Row className="file-management-statistics" gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card hoverable onClick={() => onStorageFilter()}>
          <Statistic title="全部文件" value={summary.totalCount} suffix={`个 / ${formatBytes(summary.totalBytes)}`} />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card hoverable onClick={() => onStorageFilter('local')}>
          <Statistic title="本地存储" value={summary.localCount} suffix={`个 / ${formatBytes(summary.localBytes)}`} />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card hoverable onClick={() => onStorageFilter('tos')}>
          <Statistic
            loading={tosSummaryLoading}
            title={tosStorageSummary ? `TOS 对象存储（${tosStorageSummary.bucket}）` : 'TOS 对象存储'}
            value={tosSummaryError ? '-' : summary.tosCount}
            suffix={tosSummaryError ? undefined : `个 / ${formatBytes(summary.tosBytes)}`}
          />
          {tosSummaryError ? (
            <Tooltip title={tosSummaryError}><Typography.Text type="danger">容量读取失败，请检查 TOS 配置</Typography.Text></Tooltip>
          ) : null}
        </Card>
      </Col>
    </Row>
  );
}
