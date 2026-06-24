import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import type { AuthSession, User } from '@shared/types';
import { createAppRouteObjects } from './routeConfig';

const routerBasename = (import.meta.env.VITE_ROUTER_BASENAME || '').replace(/\/+$/, '');

type AppRoutesProps = {
  currentUser: User | null;
  onAuthed: (session: AuthSession) => void;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

export function AppRoutes({ currentUser, onAuthed, onLogout, onUserUpdated }: AppRoutesProps) {
  const router = useMemo(
    () => createBrowserRouter(
      createAppRouteObjects({
        currentUser,
        onAuthed,
        onLogout,
        onUserUpdated,
      }),
      { basename: routerBasename || undefined },
    ),
    [currentUser, onAuthed, onLogout, onUserUpdated],
  );

  return <RouterProvider router={router} />;
}
