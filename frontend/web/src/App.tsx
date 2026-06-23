import { useState } from 'react';
import { getStoredUser, removeStoredUser, storeSession, storeUser } from './utils/session';
import { AppRoutes } from './routes/AppRoutes';
import type { AuthSession, User } from './types';

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser);

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
