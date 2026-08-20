import { Modal, Select, Space } from 'antd';
import type { ManagedUser, UserRoleSummary } from '../../../types';
import { t } from '@shared/i18n';

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
      cancelText={t("取消")}
      centered
      confirmLoading={saving}
      okText={t("保存角色")}
      onCancel={onCancel}
      onOk={onSubmit}
      open={open}
      title={user ? t("编辑 {{0}} 的角色", { "0": user.displayName }) : t("编辑角色")}
      destroyOnClose
    >
      <Space orientation="vertical" style={{ width: '100%' }} size={12}>
        <div>
          {t("用户账号：")}<strong>{user?.username}</strong>
        </div>
        <Select
          mode="multiple"
          allowClear
          style={{ width: '100%' }}
          placeholder={t("请选择一个或多个角色")}
          value={roleIds}
          options={roleOptions.map((role) => ({
            label: role.isDefault ? t("{{0}}（默认）", { "0": role.name }) : role.name,
            value: role.id,
          }))}
          onChange={onRoleIdsChange}
        />
      </Space>
    </Modal>
  );
}
