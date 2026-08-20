import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Spin } from 'antd';
import { getCurrentUser } from '@shared/api/user';
import { clearLegacyToken, getLoginRoute, getStoredUser, removeStoredUser, storeSession, storeUser } from '@shared/utils/session';
import { AppRealtimeEventsProvider, type AppPermissionUpdatedDetail } from './AppRealtimeEvents';
import { AppRouter } from './AppRouter';
import type { AuthSession, User } from '@shared/types';
import { t } from '@shared/i18n';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser);
  const [permissionNotice, setPermissionNotice] = useState<AppPermissionUpdatedDetail | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshCurrentUser() {
      try {
        const result = await getCurrentUser();
        if (cancelled) {
          return;
        }
        clearLegacyToken();
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
        <Spin description={t("正在同步账号权限...")} size="large" />
      </main>
    );
  }

  return (
    <AppRealtimeEventsProvider
      currentUser={currentUser}
      onCreditBalanceUpdated={handleCreditBalanceUpdated}
      onPermissionUpdated={handlePermissionUpdated}
      onUserUpdated={handleUserUpdated}
    >
      <Modal
        cancelButtonProps={{ style: { display: 'none' } }}
        closable={false}
        footer={(
          <Button onClick={handleAcknowledgePermissionNotice} type="primary">
            {t("知道了")}
          </Button>
        )}
        keyboard={false}
        maskClosable={false}
        open={Boolean(permissionNotice)}
        title={t("账号权限已变更")}
      >
        {t("当前账号权限已变更，需要重新登录后继续使用。")}
      </Modal>
      <AppRouter
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
