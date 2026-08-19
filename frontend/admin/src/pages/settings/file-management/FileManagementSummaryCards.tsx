import { Card, Col, Row, Statistic } from 'antd';
import type { ManagedFileSummary } from '../../../api/file-management';
import { formatBytes } from './fileManagementFormatters';

type FileManagementSummaryCardsProps = {
  summary: ManagedFileSummary;
};

export function FileManagementSummaryCards({ summary }: FileManagementSummaryCardsProps) {
  return (
    <Row className="file-management-statistics" gutter={[16, 16]}>
      <Col xs={24} md={12}>
        <Card>
          <Statistic title="全部文件" value={summary.totalCount} suffix={`个 / ${formatBytes(summary.totalBytes)}`} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card>
          <Statistic title="本地存储" value={summary.localCount} suffix={`个 / ${formatBytes(summary.localBytes)}`} />
        </Card>
      </Col>
    </Row>
  );
}
