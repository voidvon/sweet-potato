import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import type { TableProps, TabsProps, UploadProps } from 'antd';
import {
  EditOutlined,
  LockOutlined,
  LogoutOutlined,
  ReloadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { listMyCreditLedger } from '../../api/billing';
import { ContentStudioLayout } from '../../layouts/ContentStudioLayout';
import { updateUserPassword, updateUserProfile } from '../../api/user';
import { sourceTypeLabel } from '../../utils/billingLabels';
import type {
  MyCreditLedgerEntry,
  PasswordPayload,
  User,
  UserProfilePayload,
} from '../../types';
import './AccountPage.scss';

type AccountPageProps = {
  currentUser: User;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

function formatCredits(credits: number) {
  return `${credits.toFixed(2)} Credit`;
}

function formatCreditsCeilTwoDecimals(credits: number) {
  return `${(Math.ceil(credits * 100) / 100).toFixed(2)} Credit`;
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

function ledgerTypeLabel(entry: MyCreditLedgerEntry) {
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

export function AccountPage({ currentUser, onLogout, onUserUpdated }: AccountPageProps) {
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<User>(currentUser);
  const [ledger, setLedger] = useState<MyCreditLedgerEntry[]>([]);
  const [profileForm] = Form.useForm<UserProfilePayload>();
  const [passwordForm] = Form.useForm<PasswordPayload>();

  async function loadCreditLedger() {
    setLedgerLoading(true);
    try {
      setLedger(await listMyCreditLedger());
    } catch (error) {
      message.error(error instanceof Error ? error.message : '账户积分信息加载失败');
    } finally {
      setLedgerLoading(false);
    }
  }

  useEffect(() => {
    setCurrentProfile(currentUser);
  }, [currentUser]);

  useEffect(() => {
    void loadCreditLedger();
  }, []);

  function openProfileModal() {
    profileForm.setFieldsValue({
      displayName: currentProfile?.displayName,
    });
    setProfileModalOpen(true);
  }

  function openPasswordModal() {
    passwordForm.resetFields();
    setPasswordModalOpen(true);
  }

  function openLogoutConfirm() {
    Modal.confirm({
      title: '确认退出登录？',
      content: '退出后需要重新输入账号和密码才能进入系统。',
      centered: true,
      okText: '退出登录',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: onLogout,
    });
  }

  async function handleProfileSubmit(values: UserProfilePayload) {
    setSavingProfile(true);
    try {
      const result = await updateUserProfile(currentProfile.id, values);
      setCurrentProfile(result.user);
      onUserUpdated(result.user);
      setProfileModalOpen(false);
      message.success('账号信息已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '账号信息更新失败');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSubmit(values: PasswordPayload) {
    setSavingPassword(true);
    try {
      await updateUserPassword(currentProfile.id, values);
      passwordForm.resetFields();
      setPasswordModalOpen(false);
      message.success('密码已修改');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '密码修改失败');
    } finally {
      setSavingPassword(false);
    }
  }

  function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('头像读取失败'));
      reader.readAsDataURL(file);
    });
  }

  async function handleAvatarFile(file: File) {
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      message.error('头像图片不能超过 2MB');
      return;
    }

    try {
      const avatarUrl = await fileToDataUrl(file);
      const result = await updateUserProfile(currentProfile.id, {
        displayName: currentProfile.displayName || currentProfile.username,
        avatarUrl,
      });
      setCurrentProfile(result.user);
      onUserUpdated(result.user);
      message.success('头像已更新');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '头像上传失败');
    }
  }

  const avatarUploadProps: UploadProps = {
    accept: 'image/*',
    beforeUpload: (file) => {
      void handleAvatarFile(file);
      return false;
    },
    maxCount: 1,
    showUploadList: false,
  };

  const roleTag = currentProfile.role === 'admin'
    ? <Tag color="gold">管理员</Tag>
    : <Tag>普通成员</Tag>;

  const rechargeRecords = useMemo(
    () => ledger.filter((entry) => entry.type === 'admin_adjust' && entry.creditDelta > 0),
    [ledger],
  );

  const totalRechargeCredits = useMemo(
    () => rechargeRecords.reduce((sum, entry) => sum + entry.creditDelta, 0),
    [rechargeRecords],
  );

  const totalUsageCredits = useMemo(
    () => ledger
      .filter((entry) => entry.type === 'usage_debit' || entry.type === 'llm_extra_debit')
      .reduce((sum, entry) => sum + Math.abs(entry.creditDelta), 0),
    [ledger],
  );

  const ledgerColumns: TableProps<MyCreditLedgerEntry>['columns'] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 220,
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
      width: 160,
      render: (value: number) => (
        <span style={{ color: value >= 0 ? '#15803d' : '#b91c1c' }}>
          {value >= 0 ? '+' : ''}{formatCreditsCeilTwoDecimals(value)}
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
    {
      title: '模型',
      dataIndex: 'modelName',
      width: 180,
      render: (value?: string) => value?.trim() || '-',
    },
  ];

  const tabItems: TabsProps['items'] = [
    {
      key: 'recharge',
      label: `充值记录 (${rechargeRecords.length})`,
      children: (
        <Table
          columns={ledgerColumns}
          dataSource={rechargeRecords}
          loading={ledgerLoading}
          rowKey="id"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 900 }}
        />
      ),
    },
    {
      key: 'ledger',
      label: `积分流水 (${ledger.length})`,
      children: (
        <Table
          columns={ledgerColumns}
          dataSource={ledger}
          loading={ledgerLoading}
          rowKey="id"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          scroll={{ x: 900 }}
        />
      ),
    },
  ];

  return (
    <ContentStudioLayout>
      <section className="settings-page">
        <section className="settings-header">
          <p>管理头像、用户名、登录密码，以及查看个人积分账单和余额变化。</p>
        </section>

        <Card>
          <div className="account-profile">
            <Upload {...avatarUploadProps}>
              <button className="account-avatar-button" type="button">
                <Avatar size={56} icon={<UserOutlined />} src={currentProfile.avatarUrl} />
              </button>
            </Upload>
            <div>
              <div className="account-profile-name">
                <h2>{currentProfile.displayName || currentProfile.username}</h2>
                {roleTag}
              </div>
              <span>账号：{currentProfile.username}</span>
            </div>
            <Space>
              <Button icon={<EditOutlined />} onClick={openProfileModal}>
                修改用户名
              </Button>
              <Button icon={<LockOutlined />} onClick={openPasswordModal}>
                修改密码
              </Button>
              <Button danger icon={<LogoutOutlined />} onClick={openLogoutConfirm}>
                退出登录
              </Button>
            </Space>
          </div>
        </Card>

        <section className="settings-section">
          <div className="settings-section-actions">
          <Button icon={<ReloadOutlined />} onClick={() => void loadCreditLedger()} loading={ledgerLoading}>
            刷新账单
          </Button>
          </div>
          <Descriptions bordered column={3} size="small">
            <Descriptions.Item label="当前积分余额">
              {formatCredits(currentProfile.creditBalance || 0)}
            </Descriptions.Item>
            <Descriptions.Item label="累计充值积分">
              {formatCredits(totalRechargeCredits)}
            </Descriptions.Item>
            <Descriptions.Item label="累计消耗积分">
              {formatCredits(totalUsageCredits)}
            </Descriptions.Item>
            <Descriptions.Item label="注册时间">
              {formatDateTime(currentProfile.createdAt)}
            </Descriptions.Item>
          </Descriptions>
        </section>

        <section className="settings-section">
          <Tabs items={tabItems} />
        </section>

      <Modal
        confirmLoading={savingProfile}
        okText="保存"
        cancelText="取消"
        onCancel={() => setProfileModalOpen(false)}
        onOk={() => profileForm.submit()}
        open={profileModalOpen}
        title="修改用户名"
      >
        <Form
          form={profileForm}
          layout="vertical"
          onFinish={handleProfileSubmit}
          requiredMark={false}
        >
          <Form.Item label="账号" tooltip="账号用于登录，不支持修改">
            <Input disabled value={currentProfile.username} size="large" />
          </Form.Item>
          <Form.Item
            label="用户名"
            name="displayName"
            rules={[
              { required: true, min: 2, message: '请输入至少 2 位用户名' },
            ]}
          >
            <Input placeholder="请输入用户名" size="large" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        confirmLoading={savingPassword}
        okText="修改"
        cancelText="取消"
        onCancel={() => setPasswordModalOpen(false)}
        onOk={() => passwordForm.submit()}
        open={passwordModalOpen}
        title="修改密码"
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={handlePasswordSubmit}
          requiredMark={false}
        >
          <Form.Item
            label="当前密码"
            name="currentPassword"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password
              autoComplete="current-password"
              placeholder="请输入当前密码"
              size="large"
            />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="nextPassword"
            rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder="至少 6 位"
              size="large"
            />
          </Form.Item>
          <Form.Item
            dependencies={['nextPassword']}
            label="确认新密码"
            name="confirmPassword"
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_: unknown, value: string | undefined) {
                  if (!value || getFieldValue('nextPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder="再次输入新密码"
              size="large"
            />
          </Form.Item>
        </Form>
      </Modal>
      </section>
    </ContentStudioLayout>
  );
}
