import { Modal, Space } from 'antd';
import type {
  AdminBillableUsageRecord,
  AdminCreditLedgerEntry,
  AdminLlmUsageRecord,
  ManagedUser,
} from '../../../types';
import { UserDetailTabs } from './UserDetailTabs';
import { t } from '@shared/i18n';

type UserDetailModalProps = {
  billableUsage: AdminBillableUsageRecord[];
  ledger: AdminCreditLedgerEntry[];
  open: boolean;
  usage: AdminLlmUsageRecord[];
  user: ManagedUser | null;
  onCancel: () => void;
};

export function UserDetailModal({
  billableUsage,
  ledger,
  open,
  usage,
  user,
  onCancel,
}: UserDetailModalProps) {
  return (
    <Modal
      footer={null}
      onCancel={onCancel}
      open={open}
      title={user ? t("{{0}} 的积分明细", { "0": user.displayName }) : t("积分明细")}
      width={1200}
      destroyOnClose
    >
      {user ? (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <UserDetailTabs
            billableUsage={billableUsage}
            ledger={ledger}
            usage={usage}
            user={user}
          />
        </Space>
      ) : null}
    </Modal>
  );
}
