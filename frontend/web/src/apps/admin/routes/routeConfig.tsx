import type { ReactNode } from 'react';
import { Navigate, type RouteObject, useLocation } from 'react-router-dom';
import { AppRequestLoading } from '@shared/components/AppRequestLoading';
import type { AuthSession, User } from '@shared/types';
import { AdminProtectedLayout } from '../layouts/ProtectedLayout';
import { AuthPage } from '../pages/auth/AuthPage';
import { routePaths } from './paths';
import { getDefaultAppPath, getVisibleWorkspacePages } from './routePermissions';
import type { AppRouteHandle, WorkspaceRouteHandlers } from './workspacePageDefinitions';

export { getDefaultAppPath } from './routePermissions';
export { buildSidebarMenuItems, getWorkspaceLayoutState } from './sidebarNavigation';
export type { WorkspaceRouteState } from './sidebarNavigation';
export type { AppRouteHandle } from './workspacePageDefinitions';

type AppRouteBuildParams = WorkspaceRouteHandlers & {
  currentUser: User | null;
  onAuthed: (session: AuthSession) => void;
};

export type AppRouteObject = RouteObject & {
  id: string;
  handle?: AppRouteHandle;
  children?: AppRouteObject[];
};

function AuthRouteFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div className="route-transition-frame auth-route-transition" key={location.pathname}>
      {children}
      <AppRequestLoading />
    </div>
  );
}

function createProtectedRouteObjects(currentUser: User, handlers: WorkspaceRouteHandlers): AppRouteObject[] {
  return getVisibleWorkspacePages(currentUser).map((route) => ({
    id: `admin-${route.key}`,
    path: route.path,
    element: route.element(currentUser, handlers),
    handle: route.handle,
  }));
}

export function createAdminRouteObjects({
  currentUser,
  onAuthed,
  onLogout,
  onUserUpdated,
}: AppRouteBuildParams): AppRouteObject[] {
  const protectedChildren: AppRouteObject[] = currentUser ? [
    {
      id: 'admin-app-index',
      index: true,
      element: <Navigate to={getDefaultAppPath(currentUser)} replace />,
    },
    ...createProtectedRouteObjects(currentUser, { onLogout, onUserUpdated }),
    {
      id: 'admin-app-fallback',
      path: '*',
      element: <Navigate to={getDefaultAppPath(currentUser)} replace />,
    },
  ] : [];

  return [
    {
      id: 'admin-login',
      path: routePaths.login,
      element: currentUser ? (
        <Navigate to={getDefaultAppPath(currentUser)} replace />
      ) : (
        <AuthRouteFrame><AuthPage onAuthed={onAuthed} /></AuthRouteFrame>
      ),
    },
    {
      id: 'admin-app',
      path: routePaths.appRoot,
      element: currentUser ? (
        <AdminProtectedLayout currentUser={currentUser} onLogout={onLogout} />
      ) : (
        <Navigate to={routePaths.login} replace />
      ),
      children: protectedChildren,
    },
    {
      id: 'admin-root-fallback',
      path: '/admin/*',
      element: <Navigate to={currentUser ? getDefaultAppPath(currentUser) : routePaths.login} replace />,
    },
  ];
}
