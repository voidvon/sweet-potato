import { Descriptions, Table, Tabs, Tag } from 'antd';
import type { TableProps, TabsProps } from 'antd';
import { formatIntegerCreditAmount } from '@shared/utils/credits';
import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
} from '../../../types';
import { billableUsageSourceLabel, sourceTypeLabel } from '../../../utils/billingLabels';
import {
  billableCategoryLabel,
  billableUsageName,
  formatCredits,
  formatDateTime,
  ledgerTypeLabel,
  pricingModeLabel,
  usageModelName,
} from './userManagementFormatters';
import { t } from '@shared/i18n';

type UserDetailTabsProps = {
  billableUsage: AdminBillableUsageRecord[];
  ledger: AdminCreditLedgerEntry[];
  usage: AdminLlmUsageRecord[];
  user: {
    creditBalance: number;
    totalRechargeCredits: number;
    totalUsageCredits: number;
  };
};

export function UserDetailTabs({
  billableUsage,
  ledger,
  usage,
  user,
}: UserDetailTabsProps) {
  const rechargeRecords = ledger.filter((entry) => entry.type === 'admin_adjust' && entry.creditDelta > 0);

  const ledgerColumns: TableProps<AdminCreditLedgerEntry>['columns'] = [
    {
      title: t("时间"),
      dataIndex: 'createdAt',
      width: 200,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("类型"),
      width: 120,
      render: (_value, record) => {
        const meta = ledgerTypeLabel(record);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: t("变动积分"),
      dataIndex: 'creditDelta',
      width: 140,
      render: (value: number) => (
        <span style={{ color: value >= 0 ? '#15803d' : '#b91c1c' }}>
          {value >= 0 ? '+' : ''}{formatCredits(value)}
        </span>
      ),
    },
    {
      title: t("变动后余额"),
      dataIndex: 'creditBalanceAfter',
      width: 160,
      render: (value: number) => formatCredits(value),
    },
    {
      title: t("来源"),
      dataIndex: 'sourceType',
      width: 180,
      render: (value?: string | null) => sourceTypeLabel(value),
    },
  ];

  const usageColumns: TableProps<AdminLlmUsageRecord>['columns'] = [
    {
      title: t("时间"),
      dataIndex: 'createdAt',
      width: 200,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("模型"),
      width: 180,
      render: (_value, record) => usageModelName(record),
    },
    {
      title: t("输入 Tokens"),
      dataIndex: 'promptTokens',
      width: 140,
    },
    {
      title: t("输出 Tokens"),
      dataIndex: 'completionTokens',
      width: 140,
    },
    {
      title: t("缓存命中 Tokens"),
      dataIndex: 'cachedPromptTokens',
      width: 160,
    },
    {
      title: t("消耗积分"),
      dataIndex: 'creditCost',
      width: 140,
      render: (value: number) => formatCredits(value),
    },
    {
      title: t("状态"),
      dataIndex: 'status',
      width: 100,
      render: (value: AdminLlmUsageRecord['status']) => (
        <Tag color={value === 'completed' ? 'green' : 'red'}>
          {value === 'completed' ? t("成功") : t("失败")}
        </Tag>
      ),
    },
  ];

  const billableUsageColumns: TableProps<AdminBillableUsageRecord>['columns'] = [
    {
      title: t("时间"),
      dataIndex: 'createdAt',
      width: 200,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("类型"),
      width: 140,
      render: (_value, record) => {
        const meta = billableCategoryLabel(record.category);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: t("模型/服务"),
      width: 180,
      render: (_value, record) => billableUsageName(record),
    },
    {
      title: t("计费模式"),
      dataIndex: 'pricingMode',
      width: 140,
      render: (value: AdminBillableUsageRecord['pricingMode']) => pricingModeLabel(value),
    },
    {
      title: t("来源"),
      dataIndex: 'sourceType',
      width: 180,
      render: (value: string) => billableUsageSourceLabel({ sourceType: value }),
    },
    {
      title: t("消耗积分"),
      dataIndex: 'creditCost',
      width: 140,
      render: (value: number) => formatCredits(value),
    },
    {
      title: t("状态"),
      dataIndex: 'status',
      width: 100,
      render: (value: AdminBillableUsageRecord['status']) => (
        <Tag color={value === 'completed' ? 'green' : 'red'}>
          {value === 'completed' ? t("成功") : t("失败")}
        </Tag>
      ),
    },
  ];

  const detailTabItems: TabsProps['items'] = [
    {
      key: 'recharge',
      label: t("充值记录 ({{0}})", { "0": rechargeRecords.length }),
      children: (
        <Table
          columns={ledgerColumns}
          dataSource={rechargeRecords}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 880 }}
        />
      ),
    },
    {
      key: 'ledger',
      label: t("积分流水 ({{0}})", { "0": ledger.length }),
      children: (
        <Table
          columns={ledgerColumns}
          dataSource={ledger}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 880 }}
        />
      ),
    },
    {
      key: 'usage',
      label: t("LLM 用量 ({{0}})", { "0": usage.length }),
      children: (
        <Table
          columns={usageColumns}
          dataSource={usage}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1120 }}
        />
      ),
    },
    {
      key: 'billable-usage',
      label: t("业务消费 ({{0}})", { "0": billableUsage.length }),
      children: (
        <Table
          columns={billableUsageColumns}
          dataSource={billableUsage}
          rowKey="id"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1120 }}
        />
      ),
    },
  ];

  return (
    <>
      <Descriptions bordered column={3} size="small">
        <Descriptions.Item label={t("当前积分余额")}>
          {formatIntegerCreditAmount(user.creditBalance)} Credit
        </Descriptions.Item>
        <Descriptions.Item label={t("累计充值积分")}>
          {formatCredits(user.totalRechargeCredits)}
        </Descriptions.Item>
        <Descriptions.Item label={t("累计消耗积分")}>
          {formatCredits(user.totalUsageCredits)}
        </Descriptions.Item>
      </Descriptions>
      <Tabs items={detailTabItems} />
    </>
  );
}
