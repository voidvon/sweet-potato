import { Suspense, lazy, type ReactNode } from 'react';
import { CreditCardOutlined, RobotOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, type RouteObject, type UIMatch, useLocation } from 'react-router-dom';
import { AppRequestLoading } from '@shared/components/AppRequestLoading';
import { ContentStudioRouteFallback } from '@shared/components/RouteLoadingFallback';
import type { WorkspaceMenuItem } from '@shared/layouts/WorkspaceShellLayout';
import { AccountPage } from '@shared/pages/AccountPage';
import type { AuthSession, User } from '@shared/types';
import { AdminProtectedLayout } from '../layouts/ProtectedLayout';
import { AuthPage } from '../pages/auth/AuthPage';
import { routePaths } from './paths';
const ModelSettingsPage = lazy(() => import('../pages/settings/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })));
const BillingSettingsPage = lazy(() => import('../pages/settings/BillingSettingsPage').then((m) => ({ default: m.BillingSettingsPage })));
const UserManagementPage = lazy(() => import('../pages/settings/UserManagementPage').then((m) => ({ default: m.UserManagementPage })));

type WorkspaceRouteHandlers = {
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

type AppRouteBuildParams = WorkspaceRouteHandlers & {
  currentUser: User | null;
  onAuthed: (session: AuthSession) => void;
};

type SidebarGroupKey = 'users';
type WorkspaceSurface = 'default' | 'studio' | 'immersive';
type RouteTitle = string | ((pathname: string) => string | null);

type SidebarMenuMeta = {
  groupKey?: SidebarGroupKey;
  icon: ReactNode;
  label?: string;
  level?: 'top' | 'child';
};

export type AppRouteHandle = {
  sidebar?: SidebarMenuMeta;
  surface?: WorkspaceSurface;
  title?: RouteTitle;
};

export type AppRouteObject = RouteObject & {
  id: string;
  handle?: AppRouteHandle;
  children?: AppRouteObject[];
};

type WorkspacePageDefinition = {
  key: string;
  path: string;
  fullPath: string;
  element: (currentUser: User, handlers: WorkspaceRouteHandlers) => ReactNode;
  handle?: AppRouteHandle;
  visible?: (currentUser: User) => boolean;
};

export type WorkspaceRouteState = {
  activeOpenKeys: string[];
  currentMenuTitle: string;
  defaultOpenKeys: string[];
  isChatPage: boolean;
  isContentStudioPage: boolean;
  isContentStudioVideoCreatePage: boolean;
  isImmersivePage: boolean;
  selectedMenuKey: string | null;
};

type SidebarNavigationItem = {
  children?: SidebarNavigationItem[];
  icon: ReactNode;
  key: string;
  label: string;
  path?: string;
};

const sidebarGroupMeta: Record<SidebarGroupKey, { icon: ReactNode; label: string }> = {
  users: {
    icon: <TeamOutlined />,
    label: '用户管理',
  },
};

function withStudioSuspense(node: ReactNode) {
  return <Suspense fallback={<ContentStudioRouteFallback />}>{node}</Suspense>;
}

function AuthRouteFrame({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="route-transition-frame auth-route-transition" key={location.pathname}>
      {children}
      <AppRequestLoading />
    </div>
  );
}

const workspacePageDefinitions: WorkspacePageDefinition[] = [
  {
    key: 'account',
    path: 'account',
    fullPath: routePaths.account,
    element: (currentUser, handlers) => withStudioSuspense(
      <AccountPage
        currentUser={currentUser}
        onLogout={handlers.onLogout}
        onUserUpdated={handlers.onUserUpdated}
      />,
    ),
    handle: {
      title: '账号中心',
      surface: 'studio',
    },
  },
  {
    key: 'settings-users',
    path: 'users/accounts',
    fullPath: routePaths.accountManagement,
    element: () => withStudioSuspense(<UserManagementPage />),
    handle: {
      title: '账号管理',
      surface: 'studio',
      sidebar: {
        groupKey: 'users',
        icon: <UserOutlined />,
        level: 'child',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-billing',
    path: 'billing',
    fullPath: routePaths.billingSettings,
    element: () => withStudioSuspense(<BillingSettingsPage />),
    handle: {
      title: '积分设置',
      surface: 'studio',
      sidebar: {
        icon: <CreditCardOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-models',
    path: 'models',
    fullPath: routePaths.modelSettings,
    element: () => withStudioSuspense(<ModelSettingsPage />),
    handle: {
      title: '模型配置',
      surface: 'studio',
      sidebar: {
        icon: <RobotOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
];

function resolveRouteTitle(title: RouteTitle | undefined, pathname: string) {
  if (!title) {
    return null;
  }
  return typeof title === 'function' ? title(pathname) : title;
}

function isVisibleWorkspacePage(route: WorkspacePageDefinition, currentUser: User) {
  return route.visible ? route.visible(currentUser) : true;
}

function getVisibleWorkspacePages(currentUser: User) {
  return workspacePageDefinitions.filter((route) => isVisibleWorkspacePage(route, currentUser));
}

function createProtectedRouteObjects(currentUser: User, handlers: WorkspaceRouteHandlers): AppRouteObject[] {
  return getVisibleWorkspacePages(currentUser).map((route) => ({
    id: route.key,
    path: route.path,
    element: route.element(currentUser, handlers),
    handle: route.handle,
  }));
}

export function createAppRouteObjects({
  currentUser,
  onAuthed,
  onLogout,
  onUserUpdated,
}: AppRouteBuildParams): AppRouteObject[] {
  const protectedChildren = currentUser
    ? [
      {
        id: 'app-index',
        index: true,
        element: <Navigate to={routePaths.defaultLanding} replace />,
      },
      ...createProtectedRouteObjects(currentUser, { onLogout, onUserUpdated }),
      {
        id: 'app-fallback',
        path: '*',
        element: <Navigate to={routePaths.defaultLanding} replace />,
      },
    ]
    : [];

  return [
    {
      id: 'login',
      path: routePaths.login,
      element: currentUser ? (
        <Navigate to={routePaths.defaultLanding} replace />
      ) : (
        <AuthRouteFrame>
          <AuthPage onAuthed={onAuthed} />
        </AuthRouteFrame>
      ),
    },
    {
      id: 'app',
      path: routePaths.appRoot,
      element: currentUser ? (
        <AdminProtectedLayout currentUser={currentUser} onLogout={onLogout} />
      ) : (
        <Navigate to={routePaths.login} replace />
      ),
      children: protectedChildren,
    },
    {
      id: 'root-fallback',
      path: '*',
      element: <Navigate to={currentUser ? routePaths.defaultLanding : routePaths.login} replace />,
    },
  ];
}

function buildSidebarNavigation(currentUser: User): SidebarNavigationItem[] {
  const sidebarRoutes = getVisibleWorkspacePages(currentUser)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => Boolean(route.handle?.sidebar));

  const topRoutes = sidebarRoutes
    .filter((route) => route.handle.sidebar.level === 'top')
    .map((route) => ({
      key: route.fullPath,
      icon: route.handle.sidebar.icon,
      label: route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
      path: route.fullPath,
    }));

  const groupedRoutes = Object.entries(sidebarGroupMeta)
    .map(([groupKey, group]) => ({
      key: groupKey as SidebarGroupKey,
      icon: group.icon,
      label: group.label,
      children: sidebarRoutes
        .filter((route) => route.handle.sidebar.level !== 'top' && route.handle.sidebar.groupKey === groupKey)
        .map((route) => ({
          key: route.fullPath,
          icon: route.handle.sidebar.icon,
          label: route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
          path: route.fullPath,
        })),
    }))
    .filter((group) => group.children.length > 0);

  return [
    ...groupedRoutes,
    ...topRoutes,
  ];
}

export function buildSidebarMenuItems(currentUser: User): WorkspaceMenuItem[] {
  return buildSidebarNavigation(currentUser).map((item) => ({
    key: item.path || item.key,
    icon: item.icon,
    label: item.label,
    children: item.children?.map((child) => ({
      key: child.path || child.key,
      icon: child.icon,
      label: child.label,
    })),
  }));
}

export function getWorkspaceLayoutState(currentUser: User, pathname: string, matches: UIMatch[]): WorkspaceRouteState {
  const navigationItems = buildSidebarNavigation(currentUser);
  const matchedHandle = [...matches]
    .reverse()
    .map((match) => match.handle as AppRouteHandle | undefined)
    .find((handle) => handle);
  const selectedGroup = navigationItems.find((item) => item.children?.some((child) => child.path === pathname))?.key;
  const flattenedItems = navigationItems.flatMap((item) => item.path ? [item] : item.children || []);
  const currentMenuTitle = resolveRouteTitle(matchedHandle?.title, pathname) || '管理后台';
  const selectedMenuKey = flattenedItems.find((item) => item.path === pathname)?.path || null;

  return {
    activeOpenKeys: selectedGroup ? [selectedGroup] : [],
    currentMenuTitle,
    defaultOpenKeys: navigationItems
      .filter((item) => item.children && item.children.length > 0)
      .map((item) => item.key),
    isChatPage: false,
    isContentStudioPage: matchedHandle?.surface === 'studio',
    isContentStudioVideoCreatePage: false,
    isImmersivePage: matchedHandle?.surface === 'immersive',
    selectedMenuKey,
  };
}
