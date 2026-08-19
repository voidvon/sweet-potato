import { Input, Modal, Space } from 'antd';
import type { ManagedUser } from '../../../types';

type UserPasswordModalProps = {
  open: boolean;
  user: ManagedUser | null;
  password: string;
  saving: boolean;
  onCancel: () => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

export function UserPasswordModal({
  open,
  user,
  password,
  saving,
  onCancel,
  onPasswordChange,
  onSubmit,
}: UserPasswordModalProps) {
  return (
    <Modal
      cancelText="取消"
      centered
      confirmLoading={saving}
      okText="确认修改"
      onCancel={onCancel}
      onOk={onSubmit}
      open={open}
      title={user ? `修改 ${user.displayName} 的密码` : '修改账号密码'}
      destroyOnClose
    >
      <Space orientation="vertical" style={{ width: '100%' }} size={12}>
        <div>
          用户账号：<strong>{user?.username}</strong>
        </div>
        <Input.Password
          placeholder="请输入新密码，至少 6 位"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </Space>
    </Modal>
  );
}
