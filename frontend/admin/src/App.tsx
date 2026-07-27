import { useEffect, useState } from 'react';
import { getCurrentUser } from '@shared/api/user';
import { getStoredToken, getStoredUser, removeStoredUser, storeSession, storeUser } from '@shared/utils/session';
import { AppRoutes } from './routes/AppRoutes';
import type { AuthSession, User } from '@shared/types';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      return;
    }
    void getCurrentUser()
      .then(({ user }) => {
        if (getStoredToken() === token) {
          storeUser(user);
          setCurrentUser(user);
        }
      })
      .catch(() => undefined);
  }, []);

  function handleAuthed(session: AuthSession) {
    storeSession(session);
    setCurrentUser(session.user);
  }

  function handleLogout() {
    removeStoredUser();
    setCurrentUser(null);
  }

  function handleUserUpdated(user: User) {
    storeUser(user);
    setCurrentUser(user);
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
