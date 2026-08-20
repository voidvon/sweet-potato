import { MessageSquarePlus } from 'lucide-react';
import './SessionEmptyState.scss';
import { t } from '@shared/i18n';

type SessionEmptyStateProps = {
  description: string;
};

export function SessionEmptyState({ description }: SessionEmptyStateProps) {
  return (
    <div className="session-empty-state" role="status">
      <span aria-hidden="true" className="session-empty-state-icon">
        <MessageSquarePlus size={18} strokeWidth={1.8} />
      </span>
      <span className="session-empty-state-copy">
        <strong>{t("暂无会话")}</strong>
        <span>{description}</span>
      </span>
    </div>
  );
}
