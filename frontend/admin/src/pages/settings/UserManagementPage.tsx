import { useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Input, Modal, Space, Table, Tabs, Tag, message } from 'antd';
import type { TableProps, TabsProps } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
  ManagedUser,
} from '../../types';
import { listBillableUsageRecords, listCreditLedger, listLlmUsageRecords } from '../../api/billing';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { adjustUserCredits, listUsers } from '../../api/user';
import { billableUsageSourceLabel, sourceTypeLabel } from '../../utils/billingLabels';

type CreditAction = {
  type: 'recharge' | 'deduct';
  user: ManagedUser;
};

type DetailState = {
  user: ManagedUser;
  ledger: AdminCreditLedgerEntry[];
  usage: AdminLlmUsageRecord[];
  billableUsage: AdminBillableUsageRecord[];
};

function formatCredits(credits: number) {
  return `${credits.toFixed(2)} Credit`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '未登录';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function sanitizeCreditAmountInput(value: string) {
  const normalizedValue = value.replace(/[^\d.]/g, '');
  if (!normalizedValue) {
    return '';
  }

  const firstDotIndex = normalizedValue.indexOf('.');
  if (firstDotIndex === -1) {
    return normalizedValue;
  }

  const integerPart = normalizedValue.slice(0, firstDotIndex) || '0';
  const decimalPart = normalizedValue.slice(firstDotIndex + 1).replace(/\./g, '').slice(0, 2);
  return `${integerPart}.${decimalPart}`;
}

function ledgerTypeLabel(entry: AdminCreditLedgerEntry) {
  if (entry.type === 'admin_adjust' && entry.creditDelta > 0) {
    return { color: 'green', text: '充值' };
  }
  if (entry.type === 'admin_adjust' && entry.creditDelta < 0) {
    return { color: 'red', text: '人工扣减' };
  }
  if (entry.type === 'reserve_debit') {
    return { color: 'gold', text: '预扣' };
  }
  if (entry.type === 'reserve_refund') {
    return { color: 'blue', text: '退回' };
  }
  if (entry.type === 'usage_debit') {
    return { color: 'purple', text: '业务扣费' };
  }
  return { color: 'volcano', text: '补扣' };
}

function usageModelName(record: AdminLlmUsageRecord) {
  return record.modelName?.trim() || record.modelConfigId;
}

function billableCategoryLabel(category: AdminBillableUsageRecord['category']) {
  switch (category) {
    case 'image_generation':
      return { color: 'cyan', text: '图片生成' };
    case 'video_generation':
      return { color: 'geekblue', text: '视频生成' };
    case 'voice_clone':
      return { color: 'orange', text: '声音克隆' };
    case 'speech_synthesis':
      return { color: 'gold', text: '语音合成' };
    case 'vod_upload':
      return { color: 'blue', text: '视频上传' };
    case 'vod_understanding':
      return { color: 'purple', text: '视频理解' };
    default:
      return { color: 'default', text: category };
  }
}

function billableUsageName(record: AdminBillableUsageRecord) {
  if (record.model && record.model.trim()) {
    return record.model;
  }
  if (record.provider && record.provider.trim()) {
    return record.provider;
  }
  return record.category;
}

function pricingModeLabel(mode: AdminBillableUsageRecord['pricingMode']) {
  switch (mode) {
    case 'per_request':
      return '按次';
    case 'per_second':
      return '按秒';
    case 'per_minute':
      return '按分钟';
    case 'per_1k_chars':
      return '按千字';
    case 'per_mb':
      return '按 MB';
    case 'per_1m_tokens':
      return '按百万 token';
    default:
      return mode;
  }
}

export function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [detailLoadingUserId, setDetailLoadingUserId] = useState<string | null>(null);
  const [creditAction, setCreditAction] = useState<CreditAction | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [amountInput, setAmountInput] = useState('');

  async function loadUsers() {
    setLoading(true);
    try {
      const nextUsers = await listUsers();
      setUsers(nextUsers);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '用户列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleAdjustCredits() {
    if (!creditAction) {
      return;
    }

    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount === 0) {
      message.warning(`请输入大于 0 的${creditAction.type === 'recharge' ? '充值' : '扣除'}积分`);
      return;
    }

    const delta = creditAction.type === 'recharge' ? amount : -amount;

    setUpdatingUserId(creditAction.user.id);
    try {
      await adjustUserCredits(creditAction.user.id, delta);
      message.success(creditAction.type === 'recharge' ? '积分充值成功' : '积分扣除成功');
      setCreditAction(null);
      setAmountInput('');
      await loadUsers();
      if (detailState?.user.id === creditAction.user.id) {
        await openDetail(detailState.user.id);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分调整失败');
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function openDetail(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) {
      return;
    }
    setDetailLoadingUserId(userId);
    try {
      const [ledger, usage, billableUsage] = await Promise.all([
        listCreditLedger(userId),
        listLlmUsageRecords(userId),
        listBillableUsageRecords(userId),
      ]);
      setDetailState({ user, ledger, usage, billableUsage });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分明细加载失败');
    } finally {
      setDetailLoadingUserId(null);
    }
  }

  const rechargeRecords = useMemo(
    () => detailState?.ledger.filter((entry) => entry.type === 'admin_adjust' && entry.creditDelta > 0) || [],
    [detailState],
  );
  const totalRechargeCredits = useMemo(
    () => rechargeRecords.reduce((sum, entry) => sum + entry.creditDelta, 0),
    [rechargeRecords],
  );
  const totalUsageCredits = useMemo(
    () => {
      const llmCredits = detailState?.usage
        .filter((entry) => entry.status === 'completed')
        .reduce((sum, entry) => sum + entry.creditCost, 0) || 0;
      const billableCredits = detailState?.billableUsage
        .filter((entry) => entry.status === 'completed')
        .reduce((sum, entry) => sum + entry.creditCost, 0) || 0;
      return llmCredits + billableCredits;
    },
    [detailState],
  );

  const columns: TableProps<ManagedUser>['columns'] = [
    {
      title: '用户名称',
      dataIndex: 'displayName',
      width: 220,
      render: (value: string, record) => (
        <Space orientation="vertical" size={0}>
          <strong>{value}</strong>
          <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
            {record.role === 'admin' ? '管理员' : '普通用户'}
          </span>
        </Space>
      ),
    },
    {
      title: '用户账号',
      dataIndex: 'username',
      width: 220,
    },
    {
      title: '积分余额',
      dataIndex: 'creditBalance',
      width: 160,
      render: (value: number) => <strong>{formatCredits(value)}</strong>,
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      width: 220,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '上次登录时间',
      dataIndex: 'lastLoginAt',
      width: 220,
      render: (value?: string) => formatDateTime(value),
    },
    {
      title: '操作',
      width: 280,
      render: (_value, record) => (
        <Space wrap>
          <Button
            disabled={updatingUserId === record.id}
            onClick={() => {
              setCreditAction({ type: 'recharge', user: record });
              setAmountInput('');
            }}
            type="primary"
          >
            积分充值
          </Button>
          <Button
            danger
            disabled={updatingUserId === record.id}
            onClick={() => {
              setCreditAction({ type: 'deduct', user: record });
              setAmountInput('');
            }}
          >
            积分扣除
          </Button>
          <Button
            loading={detailLoadingUserId === record.id}
            onClick={() => void openDetail(record.id)}
          >
            账单明细
          </Button>
        </Space>
      ),
    },
  ];

  const ledgerColumns: TableProps<AdminCreditLedgerEntry>['columns'] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 200,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '类型',
      width: 120,
      render: (_value, record) => {
        const meta = ledgerTypeLabel(record);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '变动积分',
      dataIndex: 'creditDelta',
      width: 140,
      render: (value: number) => (
        <span style={{ color: value >= 0 ? '#15803d' : '#b91c1c' }}>
          {value >= 0 ? '+' : ''}{formatCredits(value)}
        </span>
      ),
    },
    {
      title: '变动后余额',
      dataIndex: 'creditBalanceAfter',
      width: 160,
      render: (value: number) => formatCredits(value),
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      width: 180,
      render: (value?: string | null) => sourceTypeLabel(value),
    },
  ];

  const usageColumns: TableProps<AdminLlmUsageRecord>['columns'] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 200,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '模型',
      width: 180,
      render: (_value, record) => usageModelName(record),
    },
    {
      title: '输入 Tokens',
      dataIndex: 'promptTokens',
      width: 140,
    },
    {
      title: '输出 Tokens',
      dataIndex: 'completionTokens',
      width: 140,
    },
    {
      title: '缓存命中 Tokens',
      dataIndex: 'cachedPromptTokens',
      width: 160,
    },
    {
      title: '消耗积分',
      dataIndex: 'creditCost',
      width: 140,
      render: (value: number) => formatCredits(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: AdminLlmUsageRecord['status']) => (
        <Tag color={value === 'completed' ? 'green' : 'red'}>
          {value === 'completed' ? '成功' : '失败'}
        </Tag>
      ),
    },
  ];

  const billableUsageColumns: TableProps<AdminBillableUsageRecord>['columns'] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 200,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '类型',
      width: 140,
      render: (_value, record) => {
        const meta = billableCategoryLabel(record.category);
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '模型/服务',
      width: 180,
      render: (_value, record) => billableUsageName(record),
    },
    {
      title: '计费模式',
      dataIndex: 'pricingMode',
      width: 140,
      render: (value: AdminBillableUsageRecord['pricingMode']) => pricingModeLabel(value),
    },
    {
      title: '来源',
      dataIndex: 'sourceType',
      width: 180,
      render: (value: string) => billableUsageSourceLabel({ sourceType: value }),
    },
    {
      title: '消耗积分',
      dataIndex: 'creditCost',
      width: 140,
      render: (value: number) => formatCredits(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: AdminBillableUsageRecord['status']) => (
        <Tag color={value === 'completed' ? 'green' : 'red'}>
          {value === 'completed' ? '成功' : '失败'}
        </Tag>
      ),
    },
  ];

  const detailTabItems: TabsProps['items'] = [
    {
      key: 'recharge',
      label: `充值记录 (${rechargeRecords.length})`,
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
      label: `积分流水 (${detailState?.ledger.length || 0})`,
      children: (
        <Table
          columns={ledgerColumns}
          dataSource={detailState?.ledger || []}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 880 }}
        />
      ),
    },
    {
      key: 'usage',
      label: `LLM 用量 (${detailState?.usage.length || 0})`,
      children: (
        <Table
          columns={usageColumns}
          dataSource={detailState?.usage || []}
          rowKey="id"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1120 }}
        />
      ),
    },
    {
      key: 'billable-usage',
      label: `业务消费 (${detailState?.billableUsage.length || 0})`,
      children: (
        <Table
          columns={billableUsageColumns}
          dataSource={detailState?.billableUsage || []}
          rowKey="id"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 1120 }}
        />
      ),
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <p>
            管理员可以查看用户名称、用户账号、积分余额，并查看充值记录、积分流水、LLM 用量和业务消费明细。
          </p>
        </section>

        <section className="settings-section">
          <div className="settings-section-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void loadUsers()} loading={loading}>
            刷新
          </Button>
          </div>
          <Table
            className="user-management-table"
            columns={columns}
            dataSource={users}
            loading={loading}
            rowKey="id"
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 位用户`,
            }}
          />
        </section>

      <Modal
        cancelText="取消"
        centered
        confirmLoading={updatingUserId === creditAction?.user.id}
        okText={creditAction?.type === 'recharge' ? '确认充值' : '确认扣除'}
        okButtonProps={creditAction?.type === 'deduct' ? { danger: true } : undefined}
        onCancel={() => {
          setCreditAction(null);
          setAmountInput('');
        }}
        onOk={() => void handleAdjustCredits()}
        open={Boolean(creditAction)}
        title={creditAction?.type === 'recharge' ? '积分充值' : '积分扣除'}
        destroyOnClose
      >
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <div>
            当前用户：<strong>{creditAction?.user.displayName}</strong>
          </div>
          <div>
            用户账号：<strong>{creditAction?.user.username}</strong>
          </div>
          <Input
            addonBefore={creditAction?.type === 'recharge' ? '充值积分' : '扣除积分'}
            inputMode="decimal"
            style={{ width: '100%' }}
            placeholder={creditAction?.type === 'recharge' ? '请输入充值积分' : '请输入扣除积分'}
            value={amountInput}
            onChange={(event) => {
              setAmountInput(sanitizeCreditAmountInput(event.target.value));
            }}
          />
        </Space>
      </Modal>

      <Modal
        footer={null}
        onCancel={() => setDetailState(null)}
        open={Boolean(detailState)}
        title={detailState ? `${detailState.user.displayName} 的积分明细` : '积分明细'}
        width={1200}
        destroyOnClose
      >
        {detailState ? (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered column={3} size="small">
              <Descriptions.Item label="当前积分余额">
                {formatCredits(detailState.user.creditBalance)}
              </Descriptions.Item>
              <Descriptions.Item label="累计充值积分">
                {formatCredits(totalRechargeCredits)}
              </Descriptions.Item>
              <Descriptions.Item label="累计消耗积分">
                {formatCredits(totalUsageCredits)}
              </Descriptions.Item>
            </Descriptions>
            <Tabs items={detailTabItems} />
          </Space>
        ) : null}
      </Modal>
      </section>
    </ContentStudioLayout>
  );
}
