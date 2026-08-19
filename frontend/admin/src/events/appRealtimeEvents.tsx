import { useEffect, type ReactNode } from 'react';
import { getCurrentUser } from '@shared/api/user';
import { API_BASE_URL } from '@shared/api/core/request';
import { withAuthToken } from '@shared/utils/session';
import type { User } from '../types';

export type AppPermissionUpdatedDetail = {
  userId: string;
  changedAt?: string;
  reason?: 'role-assignment-updated' | 'role-grants-updated';
  requireRelogin?: boolean;
};

type AppRealtimeEventsProviderProps = {
  currentUser: User | null;
  children: ReactNode;
  onPermissionUpdated: (detail: AppPermissionUpdatedDetail) => void;
  onUserUpdated: (user: User) => void;
};

export function AppRealtimeEventsProvider({
  currentUser,
  children,
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
      onPermissionUpdated(detail);
    };

    source.addEventListener('open', handleOpen);
    source.addEventListener('permission-updated', handlePermissionUpdated);
    return () => {
      source.removeEventListener('open', handleOpen);
      source.removeEventListener('permission-updated', handlePermissionUpdated);
      source.close();
    };
  }, [currentUserId, onPermissionUpdated, onUserUpdated]);

  return children;
}
