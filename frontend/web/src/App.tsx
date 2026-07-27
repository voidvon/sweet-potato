import { useCallback, useEffect, useState } from 'react';
import { Spin } from 'antd';
import { getCurrentUser } from '@shared/api/user';
import { getStoredToken, getStoredUser, removeStoredUser, storeSession, storeUser } from '@shared/utils/session';
import { AppRealtimeEventsProvider } from './events/appRealtimeEvents';
import { AppRoutes } from './routes/AppRoutes';
import type { AuthSession, User } from '@shared/types';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser);
  const [sessionHydrated, setSessionHydrated] = useState(() => !getStoredToken());

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setSessionHydrated(true);
      return;
    }

    let cancelled = false;

    async function refreshCurrentUser() {
      try {
        const result = await getCurrentUser();
        if (cancelled || getStoredToken() !== token) {
          return;
        }
        storeUser(result.user);
        setCurrentUser(result.user);
      } catch {
        if (cancelled || getStoredToken() !== token) {
          return;
        }
        removeStoredUser();
        setCurrentUser(null);
      } finally {
        if (!cancelled && getStoredToken() === token) {
          setSessionHydrated(true);
        }
      }
    }

    void refreshCurrentUser();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleAuthed(session: AuthSession) {
    storeSession(session);
    setCurrentUser(session.user);
    setSessionHydrated(true);
  }

  function handleLogout() {
    removeStoredUser();
    setCurrentUser(null);
    setSessionHydrated(true);
  }

  const handleUserUpdated = useCallback((user: User) => {
    storeUser(user);
    setCurrentUser(user);
  }, []);

  const handleCreditBalanceUpdated = useCallback((userId: string, creditBalance: number) => {
    setCurrentUser((user) => {
      if (!user || user.id !== userId || user.creditBalance === creditBalance) {
        return user;
      }
      const nextUser = { ...user, creditBalance };
      storeUser(nextUser);
      return nextUser;
    });
  }, []);

  if (!sessionHydrated) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin description="正在同步账号权限..." size="large" />
      </main>
    );
  }

  return (
    <AppRealtimeEventsProvider
      currentUser={currentUser}
      onCreditBalanceUpdated={handleCreditBalanceUpdated}
      onUserUpdated={handleUserUpdated}
    >
      <AppRoutes
        key={currentUser?.id || 'anonymous'}
        currentUser={currentUser}
        onAuthed={handleAuthed}
        onLogout={handleLogout}
        onUserUpdated={handleUserUpdated}
      />
    </AppRealtimeEventsProvider>
  );
}

export default App;
