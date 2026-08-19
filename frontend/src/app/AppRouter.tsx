import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import type { AuthSession, User } from '@shared/types';
import { createAdminRouteObjects } from '../apps/admin/routes/routeConfig';
import { createAppRouteObjects as createWorkspaceRouteObjects } from '../apps/workspace/routes/routeConfig';

const routerBasename = (import.meta.env.VITE_ROUTER_BASENAME || '').replace(/\/+$/, '');

type AppRouterProps = {
  currentUser: User | null;
  onAuthed: (session: AuthSession) => void;
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

export function AppRouter({ currentUser, onAuthed, onLogout, onUserUpdated }: AppRouterProps) {
  const router = useMemo(() => createBrowserRouter([
    ...createAdminRouteObjects({ currentUser, onAuthed, onLogout, onUserUpdated }),
    ...createWorkspaceRouteObjects({ currentUser, onAuthed, onLogout, onUserUpdated }),
  ], { basename: routerBasename || undefined }), [currentUser, onAuthed, onLogout, onUserUpdated]);

  return <RouterProvider router={router} />;
}
