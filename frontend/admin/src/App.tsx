import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spin } from 'antd';
import { getCurrentUser } from '@shared/api/user';
import { getLoginRoute, getStoredToken, getStoredUser, removeStoredUser, storeSession, storeUser } from '@shared/utils/session';
import { AppRealtimeEventsProvider, type AppPermissionUpdatedDetail } from './events/appRealtimeEvents';
import { AppRoutes } from './routes/AppRoutes';
import type { AuthSession, User } from '@shared/types';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser);
  const [permissionNotice, setPermissionNotice] = useState<AppPermissionUpdatedDetail | null>(null);
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

  const handlePermissionUpdated = useCallback((detail: AppPermissionUpdatedDetail) => {
    setPermissionNotice((current) => {
      if (!current) {
        return detail;
      }
      if (!detail.changedAt || !current.changedAt) {
        return detail;
      }
      return detail.changedAt >= current.changedAt ? detail : current;
    });
  }, []);

  const handleAcknowledgePermissionNotice = useCallback(() => {
    removeStoredUser();
    setPermissionNotice(null);
    setCurrentUser(null);
    setSessionHydrated(true);
    window.location.replace(getLoginRoute());
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
      onPermissionUpdated={handlePermissionUpdated}
      onUserUpdated={handleUserUpdated}
    >
      <Modal
        cancelButtonProps={{ style: { display: 'none' } }}
        closable={false}
        footer={(
          <Button onClick={handleAcknowledgePermissionNotice} type="primary">
            知道了
          </Button>
        )}
        keyboard={false}
        maskClosable={false}
        open={Boolean(permissionNotice)}
        title="账号权限已变更"
      >
        当前账号权限已变更，需要重新登录后继续使用。
      </Modal>
      <AppRoutes
        currentUser={currentUser}
        onAuthed={handleAuthed}
        onLogout={handleLogout}
        onUserUpdated={handleUserUpdated}
      />
    </AppRealtimeEventsProvider>
  );
}

export default App;
