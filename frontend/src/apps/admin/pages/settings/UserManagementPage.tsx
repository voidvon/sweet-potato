import {
  type CSSProperties,
  useEffect,
  useState,
} from 'react';
import { Button, Dropdown, Input, Space, Table, Tag, message } from 'antd';
import type { TableProps } from 'antd';
import { DownOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { formatIntegerCreditAmount } from '@shared/utils/credits';
import type {
  ManagedUser,
  UserRoleSummary,
} from '../../types';
import { listBillableUsageRecords, listCreditLedger, listLlmUsageRecords } from '../../api/billing';
import { useTableBodyHeight } from '../../hooks/useTableBodyHeight';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { adjustUserCredits, assignUserRoles, listUsers, updateManagedUserPassword } from '../../api/user';
import { listRoles } from '../../api/role';
import { UserCreditModal } from './user-management/UserCreditModal';
import { UserDetailModal } from './user-management/UserDetailModal';
import { formatDateTime } from './user-management/userManagementFormatters';
import { UserPasswordModal } from './user-management/UserPasswordModal';
import { UserRoleModal } from './user-management/UserRoleModal';
import './UserManagementPage.scss';
import { t } from '@shared/i18n';

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
  ledger: Awaited<ReturnType<typeof listCreditLedger>>;
  usage: Awaited<ReturnType<typeof listLlmUsageRecords>>;
  billableUsage: Awaited<ReturnType<typeof listBillableUsageRecords>>;
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
      message.error(error instanceof Error ? error.message : t("用户列表加载失败"));
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
      message.warning(t("请输入大于 0 的{{0}}积分", { "0": creditAction.type === 'recharge' ? t("充值") : t("扣除") }));
      return;
    }

    const delta = creditAction.type === 'recharge' ? amount : -amount;

    setUpdatingUserId(creditAction.user.id);
    try {
      await adjustUserCredits(creditAction.user.id, delta);
      message.success(creditAction.type === 'recharge' ? t("积分充值成功") : t("积分扣除成功"));
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
      message.error(error instanceof Error ? error.message : t("积分调整失败"));
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
      message.error(error instanceof Error ? error.message : t("积分明细加载失败"));
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
      message.success(roleIds.length ? t("角色分配已更新") : t("角色分配已清空"));
      setRoleEditState(null);
      const nextUsers = await loadUsers();
      if (detailState?.user.id === user.id) {
        await openDetail(user.id, nextUsers?.find((item) => item.id === user.id));
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("角色分配保存失败"));
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
      message.warning(t("新密码至少 6 位"));
      return;
    }
    setUpdatingUserId(passwordEditState.user.id);
    try {
      await updateManagedUserPassword(passwordEditState.user.id, nextPassword);
      message.success(t("账号密码已修改"));
      setPasswordEditState(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("密码修改失败"));
    } finally {
      setUpdatingUserId(null);
    }
  }

  const columns: TableProps<ManagedUser>['columns'] = [
    {
      title: t("用户名称"),
      dataIndex: 'displayName',
      width: 220,
      render: (value: string, record) => (
        <Space orientation="vertical" size={0}>
          <strong>{value}</strong>
          <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
            {record.role === 'admin' ? t("管理员") : t("普通用户")}
          </span>
        </Space>
      ),
    },
    {
      title: t("用户账号"),
      dataIndex: 'username',
      width: 220,
    },
    {
      title: t("已分配角色"),
      width: 260,
      render: (_value, record) => {
        if (record.role === 'admin') {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="gold">{t("管理员全量权限")}</Tag>
              <span style={{ color: 'var(--text-secondary, #6b7280)', fontSize: 12 }}>
                {t("管理员不受可分配角色限制")}
              </span>
            </Space>
          );
        }

        const assignedRoles = record.assignedRoles || [];
        if (assignedRoles.length === 0) {
          return <Tag>{t("未分配")}</Tag>;
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
      title: t("积分余额"),
      dataIndex: 'creditBalance',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'creditBalance' ? sortState.order : null,
      render: (value: number) => <strong>{formatIntegerCreditAmount(value)} Credit</strong>,
    },
    {
      title: t("累积充值"),
      dataIndex: 'totalRechargeCredits',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'totalRechargeCredits' ? sortState.order : null,
      render: (value: number) => `${formatIntegerCreditAmount(value)} Credit`,
    },
    {
      title: t("累积消耗"),
      dataIndex: 'totalUsageCredits',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'totalUsageCredits' ? sortState.order : null,
      render: (value: number) => `${formatIntegerCreditAmount(value)} Credit`,
    },
    {
      title: t("注册时间"),
      dataIndex: 'createdAt',
      width: 220,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: t("上次登录时间"),
      dataIndex: 'lastLoginAt',
      width: 220,
      render: (value?: string) => formatDateTime(value),
    },
    {
      title: t("操作"),
      key: 'actions',
      fixed: 'right',
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
                  label: t("编辑角色"),
                  disabled: record.role === 'admin',
                  onClick: () => setRoleEditState({
                    user: record,
                    roleIds: record.roleIds || [],
                  }),
                },
                record.role === 'admin' ? null : {
                  key: 'password',
                  label: t("修改账号密码"),
                  onClick: () => setPasswordEditState({ user: record, password: '' }),
                },
                {
                  key: 'recharge',
                  label: t("积分充值"),
                  disabled: actionDisabled,
                  onClick: () => {
                    setCreditAction({ type: 'recharge', user: record });
                    setAmountInput('');
                  },
                },
                {
                  key: 'deduct',
                  label: t("积分扣除"),
                  danger: true,
                  disabled: actionDisabled,
                  onClick: () => {
                    setCreditAction({ type: 'deduct', user: record });
                    setAmountInput('');
                  },
                },
                {
                  key: 'detail',
                  label: t("账单明细"),
                  disabled: detailLoadingUserId === record.id,
                  onClick: () => void openDetail(record.id),
                },
              ].filter((item): item is NonNullable<typeof item> => Boolean(item)),
            }}
          >
            <Button>
              {t("操作")} <DownOutlined />
            </Button>
          </Dropdown>
        );
      },
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page user-management-page">
        <section className="settings-header">
          <p>
            {t("管理员可以查看用户名称、用户账号、角色分配、积分余额，并查看充值记录、积分流水、LLM 用量和业务消费明细。")}
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
                placeholder={t("搜索用户账号")}
                value={accountInput}
              />
              <Button icon={<SearchOutlined />} onClick={applyAccountFilter} loading={loading}>
                {t("查询")}
              </Button>
              <Button disabled={!accountInput && !accountFilter} onClick={resetAccountFilter}>
                {t("重置")}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadUsers()} loading={loading}>
                {t("刷新")}
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
                showTotal: (total) => t("共 {{0}} 位用户", { "0": total }),
              }}
            />
          </div>
        </section>

        <UserRoleModal
          open={Boolean(roleEditState)}
          user={roleEditState?.user || null}
          roleIds={roleEditState?.roleIds || []}
          roleOptions={roleOptions}
          saving={assigningRoleUserId === roleEditState?.user.id}
          onCancel={() => setRoleEditState(null)}
          onRoleIdsChange={(roleIds) => {
            if (!roleEditState) {
              return;
            }
            setRoleEditState({ ...roleEditState, roleIds });
          }}
          onSubmit={() => void handleAssignRoles()}
        />
        <UserPasswordModal
          open={Boolean(passwordEditState)}
          user={passwordEditState?.user || null}
          password={passwordEditState?.password || ''}
          saving={updatingUserId === passwordEditState?.user.id}
          onCancel={() => setPasswordEditState(null)}
          onPasswordChange={(password) => {
            if (!passwordEditState) {
              return;
            }
            setPasswordEditState({ ...passwordEditState, password });
          }}
          onSubmit={() => void handleUpdatePassword()}
        />
        <UserCreditModal
          amountInput={amountInput}
          open={Boolean(creditAction)}
          saving={updatingUserId === creditAction?.user.id}
          type={creditAction?.type || null}
          user={creditAction?.user || null}
          onAmountInputChange={setAmountInput}
          onCancel={() => {
            setCreditAction(null);
            setAmountInput('');
          }}
          onSubmit={() => void handleAdjustCredits()}
        />
        <UserDetailModal
          billableUsage={detailState?.billableUsage || []}
          ledger={detailState?.ledger || []}
          open={Boolean(detailState)}
          usage={detailState?.usage || []}
          user={detailState?.user || null}
          onCancel={() => setDetailState(null)}
        />
      </section>
    </ContentStudioLayout>
  );
}
