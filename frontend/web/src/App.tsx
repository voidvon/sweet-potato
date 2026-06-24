import { useEffect, useState } from 'react';
import { Spin } from 'antd';
import { getCurrentUser } from '@shared/api/user';
import { getStoredToken, getStoredUser, removeStoredUser, storeSession, storeUser } from '@shared/utils/session';
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
        if (cancelled) {
          return;
        }
        storeUser(result.user);
        setCurrentUser(result.user);
      } catch {
        if (cancelled) {
          return;
        }
        removeStoredUser();
        setCurrentUser(null);
      } finally {
        if (!cancelled) {
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

  function handleUserUpdated(user: User) {
    storeUser(user);
    setCurrentUser(user);
  }

  if (!sessionHydrated) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" tip="正在同步账号权限..." />
      </main>
    );
  }

  return (
    <AppRoutes
      currentUser={currentUser}
      onAuthed={handleAuthed}
      onLogout={handleLogout}
      onUserUpdated={handleUserUpdated}
    />
  );
}

export default App;
