import { useEffect, type ReactNode } from 'react';
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

export const appRealtimeEventNames = {
  generationJobUpdated: 'app:generation-job-updated',
} as const;

type AppRealtimeEventsProviderProps = {
  currentUser: User | null;
  children: ReactNode;
};

function dispatchAppEvent<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function AppRealtimeEventsProvider({ currentUser, children }: AppRealtimeEventsProviderProps) {
  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }

    const source = new EventSource(withAuthToken(`${API_BASE_URL}/api/generation/events`));
    const handleGenerationJobUpdated = (event: MessageEvent<string>) => {
      let detail: AppGenerationJobUpdatedDetail;
      try {
        detail = JSON.parse(event.data || '{}') as AppGenerationJobUpdatedDetail;
      } catch {
        return;
      }
      if (detail.userId && detail.userId !== currentUser.id) {
        return;
      }
      dispatchAppEvent(appRealtimeEventNames.generationJobUpdated, detail);
    };

    source.addEventListener('generation-job-updated', handleGenerationJobUpdated);
    return () => {
      source.removeEventListener('generation-job-updated', handleGenerationJobUpdated);
      source.close();
    };
  }, [currentUser]);

  return children;
}
