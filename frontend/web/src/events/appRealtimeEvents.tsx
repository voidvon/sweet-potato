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

export type AppPermissionUpdatedDetail = {
  userId: string;
  changedAt?: string;
  reason?: 'role-assignment-updated' | 'role-grants-updated';
  requireRelogin?: boolean;
};

export const appRealtimeEventNames = {
  creditBalanceUpdated: 'app:credit-balance-updated',
  generationJobUpdated: 'app:generation-job-updated',
  permissionUpdated: 'app:permission-updated',
} as const;

type AppRealtimeEventsProviderProps = {
  currentUser: User | null;
  children: ReactNode;
  onCreditBalanceUpdated: (userId: string, creditBalance: number) => void;
  onPermissionUpdated: (detail: AppPermissionUpdatedDetail) => void;
  onUserUpdated: (user: User) => void;
};

function dispatchAppEvent<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function AppRealtimeEventsProvider({
  currentUser,
  children,
  onCreditBalanceUpdated,
  onPermissionUpdated,
  onUserUpdated,
}: AppRealtimeEventsProviderProps) {
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (!currentUserId) {
      return undefined;
    }

    const source = new EventSource(withAuthToken(`${API_BASE_URL}/api/app/events`));
    const handleOpen = () => {
      void getCurrentUser()
        .then(({ user }) => {
          if (user.id === currentUserId) {
            onUserUpdated(user);
          }
        })
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
      onCreditBalanceUpdated(detail.userId, detail.creditBalance);
      dispatchAppEvent(appRealtimeEventNames.creditBalanceUpdated, detail);
    };
    const handlePermissionUpdated = (event: MessageEvent<string>) => {
      let detail: AppPermissionUpdatedDetail;
      try {
        detail = JSON.parse(event.data || '{}') as AppPermissionUpdatedDetail;
      } catch {
        return;
      }
      if (detail.userId !== currentUserId) {
        return;
      }
      dispatchAppEvent(appRealtimeEventNames.permissionUpdated, detail);
      onPermissionUpdated(detail);
    };

    source.addEventListener('open', handleOpen);
    source.addEventListener('credit-balance-updated', handleCreditBalanceUpdated);
    source.addEventListener('generation-job-updated', handleGenerationJobUpdated);
    source.addEventListener('permission-updated', handlePermissionUpdated);
    return () => {
      source.removeEventListener('open', handleOpen);
      source.removeEventListener('credit-balance-updated', handleCreditBalanceUpdated);
      source.removeEventListener('generation-job-updated', handleGenerationJobUpdated);
      source.removeEventListener('permission-updated', handlePermissionUpdated);
      source.close();
    };
  }, [currentUserId, onCreditBalanceUpdated, onPermissionUpdated, onUserUpdated]);

  return children;
}
