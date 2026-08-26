import { useEffect, type ReactNode } from 'react';
import { getCurrentUser } from '@shared/api/user';
import type { User } from '@shared/types';
import type { BatchRunDetail } from '../apps/workspace/api/batch-generation';
import type { ChatMessage } from '../apps/workspace/types';
import { appSocketManager } from './AppSocketManager';

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

export type AppBatchGenerationRunUpdatedDetail = {
  userId: string;
  run: BatchRunDetail;
  at?: string;
};

export const appRealtimeEventNames = {
  batchGenerationRunUpdated: 'app:batch-generation-run-updated',
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

    void appSocketManager.connect().then(() => {
      void getCurrentUser()
        .then(({ user }) => {
          if (user.id === currentUserId) {
            onUserUpdated(user);
          }
        })
        .catch(() => undefined);
    }).catch(() => undefined);
    const unsubscribe = appSocketManager.subscribe((payload) => {
      let detail: AppGenerationJobUpdatedDetail;
      try {
        const params = (payload.params as Record<string, unknown>) || {};
        const method = String(payload.method || '');
        if (method === 'app/connected') return;
        if (method === 'generation-job-updated' || method === 'app/generation-job-updated') {
          detail = params as AppGenerationJobUpdatedDetail;
          if (detail.userId && detail.userId !== currentUserId) return;
          dispatchAppEvent(appRealtimeEventNames.generationJobUpdated, detail);
        } else if (method === 'credit-balance-updated' || method === 'app/credit-balance-updated') {
          const credit = params as unknown as AppCreditBalanceUpdatedDetail;
          if (credit.userId === currentUserId && Number.isFinite(credit.creditBalance)) {
            onCreditBalanceUpdated(credit.userId, credit.creditBalance);
            dispatchAppEvent(appRealtimeEventNames.creditBalanceUpdated, credit);
          }
        } else if (method === 'batch-generation-run-updated' || method === 'app/batch-generation-run-updated') {
          const batch = params as unknown as AppBatchGenerationRunUpdatedDetail;
          if (batch.userId === currentUserId && batch.run) dispatchAppEvent(appRealtimeEventNames.batchGenerationRunUpdated, batch);
        } else if (method === 'permission-updated' || method === 'app/permission-updated') {
          const permission = params as unknown as AppPermissionUpdatedDetail;
          if (permission.userId === currentUserId) {
            dispatchAppEvent(appRealtimeEventNames.permissionUpdated, permission);
            onPermissionUpdated(permission);
          }
        }
      } catch {
        return;
      }
    });
    return unsubscribe;
  }, [currentUserId, onCreditBalanceUpdated, onPermissionUpdated, onUserUpdated]);

  return children;
}
