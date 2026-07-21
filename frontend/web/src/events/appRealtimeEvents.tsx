import { useEffect, type ReactNode } from 'react';
import { getCurrentUser } from '@shared/api/user';
import { API_BASE_URL } from '../api/request';
import { withAuthToken } from '../utils/session';
import type { ChatMessage, User } from '../types';

export type AppGenerationJobUpdatedDetail = {
  userId?: string;
  job?: {
    id?: string;
    conversationId?: string | null;
    status?: string;
  };
  items?: Array<{
    id: string;
    jobId: string;
    slotIndex: number;
    status: string;
    attachmentId?: string | null;
    error?: string | null;
  }>;
  message?: ChatMessage;
  at?: string;
};

export type AppCreditBalanceUpdatedDetail = {
  userId: string;
  creditBalance: number;
  creditDelta: number;
  at?: string;
};

export const appRealtimeEventNames = {
  creditBalanceUpdated: 'app:credit-balance-updated',
  generationJobUpdated: 'app:generation-job-updated',
} as const;

type AppRealtimeEventsProviderProps = {
  currentUser: User | null;
  children: ReactNode;
  onCreditBalanceUpdated: (creditBalance: number) => void;
};

function dispatchAppEvent<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function AppRealtimeEventsProvider({ currentUser, children, onCreditBalanceUpdated }: AppRealtimeEventsProviderProps) {
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (!currentUserId) {
      return undefined;
    }

    const source = new EventSource(withAuthToken(`${API_BASE_URL}/api/app/events`));
    const handleOpen = () => {
      void getCurrentUser()
        .then(({ user }) => onCreditBalanceUpdated(user.creditBalance || 0))
        .catch(() => undefined);
    };
    const handleGenerationJobUpdated = (event: MessageEvent<string>) => {
      let detail: AppGenerationJobUpdatedDetail;
      try {
        detail = JSON.parse(event.data || '{}') as AppGenerationJobUpdatedDetail;
      } catch {
        return;
      }
      if (detail.userId && detail.userId !== currentUserId) {
        return;
      }
      dispatchAppEvent(appRealtimeEventNames.generationJobUpdated, detail);
    };
    const handleCreditBalanceUpdated = (event: MessageEvent<string>) => {
      let detail: AppCreditBalanceUpdatedDetail;
      try {
        detail = JSON.parse(event.data || '{}') as AppCreditBalanceUpdatedDetail;
      } catch {
        return;
      }
      if (detail.userId !== currentUserId || !Number.isFinite(detail.creditBalance)) {
        return;
      }
      onCreditBalanceUpdated(detail.creditBalance);
      dispatchAppEvent(appRealtimeEventNames.creditBalanceUpdated, detail);
    };

    source.addEventListener('open', handleOpen);
    source.addEventListener('credit-balance-updated', handleCreditBalanceUpdated);
    source.addEventListener('generation-job-updated', handleGenerationJobUpdated);
    return () => {
      source.removeEventListener('open', handleOpen);
      source.removeEventListener('credit-balance-updated', handleCreditBalanceUpdated);
      source.removeEventListener('generation-job-updated', handleGenerationJobUpdated);
      source.close();
    };
  }, [currentUserId, onCreditBalanceUpdated]);

  return children;
}
