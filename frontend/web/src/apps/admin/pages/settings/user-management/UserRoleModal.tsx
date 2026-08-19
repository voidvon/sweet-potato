import { Modal, Select, Space } from 'antd';
import type { ManagedUser, UserRoleSummary } from '../../../types';

type UserRoleModalProps = {
  open: boolean;
  user: ManagedUser | null;
  roleIds: string[];
  roleOptions: UserRoleSummary[];
  saving: boolean;
  onCancel: () => void;
  onRoleIdsChange: (roleIds: string[]) => void;
  onSubmit: () => void;
};

export function UserRoleModal({
  open,
  user,
  roleIds,
  roleOptions,
  saving,
  onCancel,
  onRoleIdsChange,
  onSubmit,
}: UserRoleModalProps) {
  return (
    <Modal
      cancelText="取消"
      centered
      confirmLoading={saving}
      okText="保存角色"
      onCancel={onCancel}
      onOk={onSubmit}
      open={open}
      title={user ? `编辑 ${user.displayName} 的角色` : '编辑角色'}
      destroyOnClose
    >
      <Space orientation="vertical" style={{ width: '100%' }} size={12}>
        <div>
          用户账号：<strong>{user?.username}</strong>
        </div>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%' }}
          placeholder="请选择一个或多个角色"
          value={roleIds}
          options={roleOptions.map((role) => ({
            label: role.isDefault ? `${role.name}（默认）` : role.name,
            value: role.id,
          }))}
          onChange={onRoleIdsChange}
        />
      </Space>
    </Modal>
  );
}
