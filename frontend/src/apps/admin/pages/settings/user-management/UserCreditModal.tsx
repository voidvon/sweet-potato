import { Input, Modal, Space } from 'antd';
import type { ManagedUser } from '../../../types';
import { sanitizeCreditAmountInput } from './userManagementFormatters';
import { t } from '@shared/i18n';

type UserCreditModalProps = {
  amountInput: string;
  open: boolean;
  saving: boolean;
  type: 'recharge' | 'deduct' | null;
  user: ManagedUser | null;
  onAmountInputChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function UserCreditModal({
  amountInput,
  open,
  saving,
  type,
  user,
  onAmountInputChange,
  onCancel,
  onSubmit,
}: UserCreditModalProps) {
  return (
    <Modal
      cancelText={t("取消")}
      centered
      confirmLoading={saving}
      okText={type === 'recharge' ? t("确认充值") : t("确认扣除")}
      okButtonProps={type === 'deduct' ? { danger: true } : undefined}
      onCancel={onCancel}
      onOk={onSubmit}
      open={open}
      title={type === 'recharge' ? t("积分充值") : t("积分扣除")}
      destroyOnClose
    >
      <Space orientation="vertical" style={{ width: '100%' }} size={12}>
        <div>
          {t("当前用户：")}<strong>{user?.displayName}</strong>
        </div>
        <div>
          {t("用户账号：")}<strong>{user?.username}</strong>
        </div>
        <Input
          addonBefore={type === 'recharge' ? t("充值积分") : t("扣除积分")}
          inputMode="decimal"
          style={{ width: '100%' }}
          placeholder={type === 'recharge' ? t("请输入充值积分") : t("请输入扣除积分")}
          value={amountInput}
          onChange={(event) => onAmountInputChange(sanitizeCreditAmountInput(event.target.value))}
        />
      </Space>
    </Modal>
  );
}
