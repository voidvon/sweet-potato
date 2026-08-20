import { Card, Col, Row, Statistic } from 'antd';
import type { ManagedFileSummary } from '../../../api/file-management';
import { formatBytes } from './fileManagementFormatters';
import { t } from '@shared/i18n';

type FileManagementSummaryCardsProps = {
  summary: ManagedFileSummary;
};

export function FileManagementSummaryCards({ summary }: FileManagementSummaryCardsProps) {
  return (
    <Row className="file-management-statistics" gutter={[16, 16]}>
      <Col xs={24} md={12}>
        <Card>
          <Statistic title={t("全部文件")} value={summary.totalCount} suffix={t("个 / {{0}}", { "0": formatBytes(summary.totalBytes) })} />
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card>
          <Statistic title={t("本地存储")} value={summary.localCount} suffix={t("个 / {{0}}", { "0": formatBytes(summary.localBytes) })} />
        </Card>
      </Col>
    </Row>
  );
}
