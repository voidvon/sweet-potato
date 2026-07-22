import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Descriptions, Dropdown, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import type { TableProps, TabsProps } from 'antd';
import { DownOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { formatIntegerCreditAmount } from '@shared/utils/credits';
import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
  ManagedUser,
  UserRoleSummary,
} from '../../types';
import { listBillableUsageRecords, listCreditLedger, listLlmUsageRecords } from '../../api/billing';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { adjustUserCredits, assignUserRoles, listUsers, updateManagedUserPassword } from '../../api/user';
import { listRoles } from '../../api/role';
import { billableUsageSourceLabel, sourceTypeLabel } from '../../utils/billingLabels';
import './UserManagementPage.scss';

type CreditAction = {
  type: 'recharge' | 'deduct';
  user: ManagedUser;
};

type RoleEditState = {
  user: ManagedUser;
  roleIds: string[];
};

type PasswordEditState = {
  user: ManagedUser;
  password: string;
};

type DetailState = {
  user: ManagedUser;
  ledger: AdminCreditLedgerEntry[];
  usage: AdminLlmUsageRecord[];
  billableUsage: AdminBillableUsageRecord[];
};

type UserSortField = 'creditBalance' | 'totalRechargeCredits' | 'totalUsageCredits';

type UserSortState = {
  field?: UserSortField;
  order?: 'ascend' | 'descend';
};

const userSortFields = new Set<UserSortField>([
  'creditBalance',
  'totalRechargeCredits',
  'totalUsageCredits',
]);

function useTableBodyHeight() {
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [bodyHeight, setBodyHeight] = useState(1);

  const measure = useCallback(() => {
    const viewport = viewportElementRef.current;
    if (!viewport || viewport.clientHeight <= 0) return;

    const headerHeight = viewport.querySelector<HTMLElement>('.ant-table-header')?.offsetHeight || 0;
    const pagination = viewport.querySelector<HTMLElement>('.ant-table-pagination');
    let paginationHeight = 0;
    if (pagination) {
      const style = window.getComputedStyle(pagination);
      paginationHeight = pagination.offsetHeight
        + Number.parseFloat(style.marginTop || '0')
        + Number.parseFloat(style.marginBottom || '0');
    }

    const nextHeight = Math.max(1, Math.floor(viewport.clientHeight - headerHeight - paginationHeight));
    setBodyHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      measure();
    });
  }, [measure]);

  const viewportRef = useCallback((viewport: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    viewportElementRef.current = viewport;

    if (!viewport) return;
    observerRef.current = new ResizeObserver(scheduleMeasure);
    observerRef.current.observe(viewport);
    scheduleMeasure();
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  });

  useEffect(() => () => {
    observerRef.current?.disconnect();
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  return { bodyHeight, viewportRef };
}

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
    case 'content_planning_analysis':
      return { color: 'lime', text: '策划识别' };
    case 'content_planning_generation':
      return { color: 'green', text: '策划生成' };
    case 'image_generation':
      return { color: 'cyan', text: '图片生成' };
    case 'video_generation':
      return { color: 'geekblue', text: '视频生成' };
    case 'video_upscale':
      return { color: 'blue', text: '视频高清放大' };
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
  const [roleOptions, setRoleOptions] = useState<UserRoleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [assigningRoleUserId, setAssigningRoleUserId] = useState<string | null>(null);
  const [detailLoadingUserId, setDetailLoadingUserId] = useState<string | null>(null);
  const [creditAction, setCreditAction] = useState<CreditAction | null>(null);
  const [roleEditState, setRoleEditState] = useState<RoleEditState | null>(null);
  const [passwordEditState, setPasswordEditState] = useState<PasswordEditState | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [accountInput, setAccountInput] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [sortState, setSortState] = useState<UserSortState>({});
  const userTable = useTableBodyHeight();

  async function loadUsers(nextSort = sortState, nextAccountFilter = accountFilter) {
    setLoading(true);
    try {
      const [nextUsers, nextRoles] = await Promise.all([
        listUsers({
          username: nextAccountFilter,
          sortBy: nextSort.field,
          sortOrder: nextSort.order === 'ascend'
            ? 'asc'
            : nextSort.order === 'descend'
              ? 'desc'
              : undefined,
        }),
        listRoles(),
      ]);
      setUsers(nextUsers);
      setRoleOptions(nextRoles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isDefault: role.isDefault,
        isSystem: role.isSystem,
      })));
      return nextUsers;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '用户列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  function applyAccountFilter() {
    const nextAccountFilter = accountInput.trim();
    setAccountInput(nextAccountFilter);
    setAccountFilter(nextAccountFilter);
    void loadUsers(sortState, nextAccountFilter);
  }

  function resetAccountFilter() {
    setAccountInput('');
    setAccountFilter('');
    void loadUsers(sortState, '');
  }

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
      const nextUsers = await loadUsers();
      if (detailState?.user.id === creditAction.user.id) {
        await openDetail(
          detailState.user.id,
          nextUsers?.find((user) => user.id === detailState.user.id),
        );
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '积分调整失败');
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function openDetail(userId: string, refreshedUser?: ManagedUser) {
    const user = refreshedUser || users.find((item) => item.id === userId);
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

  async function handleAssignRoles() {
    if (!roleEditState) {
      return;
    }
    const { user, roleIds } = roleEditState;
    setAssigningRoleUserId(user.id);
    try {
      await assignUserRoles(user.id, roleIds);
      message.success(roleIds.length ? '角色分配已更新' : '角色分配已清空');
      setRoleEditState(null);
      const nextUsers = await loadUsers();
      if (detailState?.user.id === user.id) {
        await openDetail(user.id, nextUsers?.find((item) => item.id === user.id));
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '角色分配保存失败');
    } finally {
      setAssigningRoleUserId(null);
    }
  }

  async function handleUpdatePassword() {
    if (!passwordEditState) {
      return;
    }
    const nextPassword = passwordEditState.password.trim();
    if (nextPassword.length < 6) {
      message.warning('新密码至少 6 位');
      return;
    }
    setUpdatingUserId(passwordEditState.user.id);
    try {
      await updateManagedUserPassword(passwordEditState.user.id, nextPassword);
      message.success('账号密码已修改');
      setPasswordEditState(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '密码修改失败');
    } finally {
      setUpdatingUserId(null);
    }
  }

  const rechargeRecords = useMemo(
    () => detailState?.ledger.filter((entry) => entry.type === 'admin_adjust' && entry.creditDelta > 0) || [],
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
      title: '已分配角色',
      width: 260,
      render: (_value, record) => {
        if (record.role === 'admin') {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="gold">管理员全量权限</Tag>
              <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
                管理员不受可分配角色限制
              </span>
            </Space>
          );
        }

        const assignedRoles = record.assignedRoles || [];
        if (assignedRoles.length === 0) {
          return <Tag>未分配</Tag>;
        }
        return (
          <Space size={[6, 6]} wrap>
            {assignedRoles.map((role) => (
              <Tag key={role.id} color={role.isDefault ? 'blue' : undefined}>
                {role.name}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '积分余额',
      dataIndex: 'creditBalance',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'creditBalance' ? sortState.order : null,
      render: (value: number) => <strong>{formatIntegerCreditAmount(value)} Credit</strong>,
    },
    {
      title: '累积充值',
      dataIndex: 'totalRechargeCredits',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'totalRechargeCredits' ? sortState.order : null,
      render: (value: number) => `${formatIntegerCreditAmount(value)} Credit`,
    },
    {
      title: '累积消耗',
      dataIndex: 'totalUsageCredits',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'totalUsageCredits' ? sortState.order : null,
      render: (value: number) => `${formatIntegerCreditAmount(value)} Credit`,
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
      width: 120,
      render: (_value, record) => {
        const actionDisabled = updatingUserId === record.id;
        return (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'roles',
                  label: '编辑角色',
                  disabled: record.role === 'admin',
                  onClick: () => setRoleEditState({
                    user: record,
                    roleIds: record.roleIds || [],
                  }),
                },
                record.role === 'admin' ? null : {
                  key: 'password',
                  label: '修改账号密码',
                  onClick: () => setPasswordEditState({ user: record, password: '' }),
                },
                {
                  key: 'recharge',
                  label: '积分充值',
                  disabled: actionDisabled,
                  onClick: () => {
                    setCreditAction({ type: 'recharge', user: record });
                    setAmountInput('');
                  },
                },
                {
                  key: 'deduct',
                  label: '积分扣除',
                  danger: true,
                  disabled: actionDisabled,
                  onClick: () => {
                    setCreditAction({ type: 'deduct', user: record });
                    setAmountInput('');
                  },
                },
                {
                  key: 'detail',
                  label: '账单明细',
                  disabled: detailLoadingUserId === record.id,
                  onClick: () => void openDetail(record.id),
                },
              ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
            }}
          >
            <Button>
              操作 <DownOutlined />
            </Button>
          </Dropdown>
        );
      },
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
      <section className="settings-page user-management-page">
        <section className="settings-header">
          <p>
            管理员可以查看用户名称、用户账号、角色分配、积分余额，并查看充值记录、积分流水、LLM 用量和业务消费明细。
          </p>
        </section>

        <section className="settings-section user-management-section">
          <div className="settings-section-actions">
            <Space wrap>
              <Input
                allowClear
                className="user-management-account-filter"
                onChange={(event) => setAccountInput(event.target.value)}
                onPressEnter={applyAccountFilter}
                placeholder="搜索用户账号"
                value={accountInput}
              />
              <Button icon={<SearchOutlined />} onClick={applyAccountFilter} loading={loading}>
                查询
              </Button>
              <Button disabled={!accountInput && !accountFilter} onClick={resetAccountFilter}>
                重置
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadUsers()} loading={loading}>
                刷新
              </Button>
            </Space>
          </div>
          <div
            className="user-management-table-viewport"
            ref={userTable.viewportRef}
            style={{ '--user-management-table-body-height': `${userTable.bodyHeight}px` } as CSSProperties}
          >
            <Table
              className="user-management-table"
              columns={columns}
              dataSource={users}
              loading={loading}
              onChange={(_pagination, _filters, sorter, extra) => {
                if (extra.action !== 'sort') return;
                const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
                const field = typeof activeSorter.field === 'string' && userSortFields.has(activeSorter.field as UserSortField)
                  ? activeSorter.field as UserSortField
                  : undefined;
                const nextSort: UserSortState = activeSorter.order && field
                  ? { field, order: activeSorter.order }
                  : {};
                setSortState(nextSort);
                void loadUsers(nextSort, accountFilter);
              }}
              rowKey="id"
              scroll={{ x: 1580, y: userTable.bodyHeight }}
              pagination={{
                pageSize: 20,
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 位用户`,
              }}
            />
          </div>
        </section>

      <Modal
        cancelText="取消"
        centered
        confirmLoading={assigningRoleUserId === roleEditState?.user.id}
        okText="保存角色"
        onCancel={() => setRoleEditState(null)}
        onOk={() => void handleAssignRoles()}
        open={Boolean(roleEditState)}
        title={roleEditState ? `编辑 ${roleEditState.user.displayName} 的角色` : '编辑角色'}
        destroyOnClose
      >
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <div>
            用户账号：<strong>{roleEditState?.user.username}</strong>
          </div>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="请选择一个或多个角色"
            value={roleEditState?.roleIds || []}
            options={roleOptions.map((role) => ({
              label: role.isDefault ? `${role.name}（默认）` : role.name,
              value: role.id,
            }))}
            onChange={(roleIds) => {
              if (!roleEditState) {
                return;
              }
              setRoleEditState({ ...roleEditState, roleIds });
            }}
          />
        </Space>
      </Modal>

      <Modal
        cancelText="取消"
        centered
        confirmLoading={updatingUserId === passwordEditState?.user.id}
        okText="确认修改"
        onCancel={() => setPasswordEditState(null)}
        onOk={() => void handleUpdatePassword()}
        open={Boolean(passwordEditState)}
        title={passwordEditState ? `修改 ${passwordEditState.user.displayName} 的密码` : '修改账号密码'}
        destroyOnClose
      >
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
          <div>
            用户账号：<strong>{passwordEditState?.user.username}</strong>
          </div>
          <Input.Password
            placeholder="请输入新密码，至少 6 位"
            value={passwordEditState?.password || ''}
            onChange={(event) => {
              if (!passwordEditState) {
                return;
              }
              setPasswordEditState({ ...passwordEditState, password: event.target.value });
            }}
          />
        </Space>
      </Modal>

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
                {formatIntegerCreditAmount(detailState.user.creditBalance)} Credit
              </Descriptions.Item>
              <Descriptions.Item label="累计充值积分">
                {formatCredits(detailState.user.totalRechargeCredits)}
              </Descriptions.Item>
              <Descriptions.Item label="累计消耗积分">
                {formatCredits(detailState.user.totalUsageCredits)}
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
