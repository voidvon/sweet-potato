import { Suspense, lazy, type ReactNode } from 'react';
import { ApartmentOutlined, AppstoreOutlined, ClearOutlined, CreditCardOutlined, FileOutlined, HistoryOutlined, SafetyCertificateOutlined, RobotOutlined, SettingOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { Navigate, type RouteObject, type UIMatch, useLocation } from 'react-router-dom';
import { AppRequestLoading } from '@shared/components/AppRequestLoading';
import { ContentStudioRouteFallback } from '@shared/components/RouteLoadingFallback';
import type { RouteResourceDisplayInfo } from '@shared/hooks/useRouteResourceNames';
import type { WorkspaceMenuItem } from '@shared/layouts/WorkspaceShellLayout';
import { AccountPage } from '@shared/pages/AccountPage';
import type { AuthSession, User } from '@shared/types';
import { AdminProtectedLayout } from '../layouts/ProtectedLayout';
import { AuthPage } from '../pages/auth/AuthPage';
import { routePaths } from './paths';
const ModelSettingsPage = lazy(() => import('../pages/settings/ModelSettingsPage').then((m) => ({ default: m.ModelSettingsPage })));
const BillingSettingsPage = lazy(() => import('../pages/settings/BillingSettingsPage').then((m) => ({ default: m.BillingSettingsPage })));
const RouteResourceManagementPage = lazy(() => import('../pages/settings/RouteResourceManagementPage').then((m) => ({ default: m.RouteResourceManagementPage })));
const RoleManagementPage = lazy(() => import('../pages/settings/RoleManagementPage').then((m) => ({ default: m.RoleManagementPage })));
const UserManagementPage = lazy(() => import('../pages/settings/UserManagementPage').then((m) => ({ default: m.UserManagementPage })));
const FileManagementPage = lazy(() => import('../pages/settings/FileManagementPage').then((m) => ({ default: m.FileManagementPage })));
const TemporaryAssetCleanupPage = lazy(() => import('../pages/settings/TemporaryAssetCleanupPage').then((m) => ({ default: m.TemporaryAssetCleanupPage })));
const SystemSettingsPage = lazy(() => import('../pages/settings/SystemSettingsPage').then((m) => ({ default: m.SystemSettingsPage })));
const SiteAccessLogPage = lazy(() => import('../pages/settings/SiteAccessLogPage').then((m) => ({ default: m.SiteAccessLogPage })));
const AllWorksPage = lazy(() => import('../pages/works/AllWorksPage').then((m) => ({ default: m.AllWorksPage })));
const DiscoverManagementPage = lazy(() => import('../pages/discover/DiscoverManagementPage').then((m) => ({ default: m.DiscoverManagementPage })));

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
  routeResourceKey?: string;
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
  sortOrder: number;
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
    key: 'settings-route-resources',
    path: 'system/routes',
    fullPath: routePaths.routeResourceManagement,
    element: () => withStudioSuspense(<RouteResourceManagementPage />),
    routeResourceKey: 'admin.system.route_resources',
    handle: {
      title: '路由管理',
      surface: 'studio',
      sidebar: {
        icon: <ApartmentOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-roles',
    path: 'users/roles',
    fullPath: routePaths.roleManagement,
    element: () => withStudioSuspense(<RoleManagementPage />),
    routeResourceKey: 'admin.users.roles',
    handle: {
      title: '角色管理',
      surface: 'studio',
      sidebar: {
        groupKey: 'users',
        icon: <SafetyCertificateOutlined />,
        level: 'child',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-users',
    path: 'users/accounts',
    fullPath: routePaths.accountManagement,
    element: () => withStudioSuspense(<UserManagementPage />),
    routeResourceKey: 'admin.users.accounts',
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
    key: 'all-works',
    path: 'works',
    fullPath: routePaths.allWorks,
    element: () => withStudioSuspense(<AllWorksPage />),
    routeResourceKey: 'admin.all_works',
    handle: {
      title: '全部作品',
      surface: 'studio',
      sidebar: {
        icon: <AppstoreOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'discover',
    path: 'discover',
    fullPath: routePaths.discover,
    element: () => withStudioSuspense(<DiscoverManagementPage />),
    routeResourceKey: 'admin.discover',
    handle: { title: '发现', surface: 'studio', sidebar: { icon: <AppstoreOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-billing',
    path: 'billing',
    fullPath: routePaths.billingSettings,
    element: () => withStudioSuspense(<BillingSettingsPage />),
    routeResourceKey: 'admin.system.billing',
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
    routeResourceKey: 'admin.system.models',
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
  {
    key: 'settings-files',
    path: 'system/files',
    fullPath: routePaths.fileManagement,
    element: () => withStudioSuspense(<FileManagementPage />),
    routeResourceKey: 'admin.system.file_management',
    handle: {
      title: '文件管理',
      surface: 'studio',
      sidebar: {
        icon: <FileOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-temporary-assets',
    path: 'system/temporary-assets',
    fullPath: routePaths.temporaryAssetCleanup,
    element: () => withStudioSuspense(<TemporaryAssetCleanupPage />),
    routeResourceKey: 'admin.system.temporary_assets',
    handle: {
      title: '临时素材清理',
      surface: 'studio',
      sidebar: {
        icon: <ClearOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-system',
    path: 'system/settings',
    fullPath: routePaths.systemSettings,
    element: () => withStudioSuspense(<SystemSettingsPage />),
    routeResourceKey: 'admin.system.settings',
    handle: {
      title: '系统设置',
      surface: 'studio',
      sidebar: {
        icon: <SettingOutlined />,
        level: 'top',
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-access-logs',
    path: 'system/access-logs',
    fullPath: routePaths.siteAccessLogs,
    element: () => withStudioSuspense(<SiteAccessLogPage />),
    routeResourceKey: 'admin.system.access_logs',
    handle: {
      title: '站点访问日志',
      surface: 'studio',
      sidebar: {
        icon: <HistoryOutlined />,
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

function resolveResourceInfo(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return route.routeResourceKey ? resourceInfoMap?.get(route.routeResourceKey) : undefined;
}

function resolveResourceName(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return resolveResourceInfo(route, resourceInfoMap)?.name;
}

function compareByResourceSort(left: WorkspacePageDefinition, right: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const leftSortOrder = resolveResourceInfo(left, resourceInfoMap)?.sortOrder ?? 0;
  const rightSortOrder = resolveResourceInfo(right, resourceInfoMap)?.sortOrder ?? 0;

  if (leftSortOrder !== rightSortOrder) {
    return leftSortOrder - rightSortOrder;
  }

  return workspacePageDefinitions.indexOf(left) - workspacePageDefinitions.indexOf(right);
}

function getGroupSortOrder(groupKey: SidebarGroupKey, children: SidebarNavigationItem[], resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const groupResourceKey = groupKey === 'users' ? 'admin.root.users' : undefined;
  const groupSortOrder = groupResourceKey ? resourceInfoMap?.get(groupResourceKey)?.sortOrder : undefined;
  if (groupSortOrder !== undefined) {
    return groupSortOrder;
  }
  return children.length > 0 ? Math.min(...children.map((item) => item.sortOrder)) : 0;
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

function buildSidebarNavigation(currentUser: User, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): SidebarNavigationItem[] {
  const sidebarRoutes = getVisibleWorkspacePages(currentUser)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => Boolean(route.handle?.sidebar));

  const topRoutes = sidebarRoutes
    .filter((route) => route.handle.sidebar.level === 'top')
    .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
    .map((route) => ({
      key: route.fullPath,
      icon: route.handle.sidebar.icon,
      label: resolveResourceName(route, resourceInfoMap) || route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
      path: route.fullPath,
      sortOrder: resolveResourceInfo(route, resourceInfoMap)?.sortOrder ?? 0,
    }));

  const groupedRoutes = Object.entries(sidebarGroupMeta)
    .map(([groupKey, group]) => {
      const typedGroupKey = groupKey as SidebarGroupKey;
      const children = sidebarRoutes
        .filter((route) => route.handle.sidebar.level !== 'top' && route.handle.sidebar.groupKey === typedGroupKey)
        .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
        .map((route) => ({
          key: route.fullPath,
          icon: route.handle.sidebar.icon,
          label: resolveResourceName(route, resourceInfoMap) || route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
          path: route.fullPath,
          sortOrder: resolveResourceInfo(route, resourceInfoMap)?.sortOrder ?? 0,
        }));

      return {
        key: typedGroupKey,
        icon: group.icon,
        label: resourceInfoMap?.get('admin.root.users')?.name || group.label,
        sortOrder: getGroupSortOrder(typedGroupKey, children, resourceInfoMap),
        children,
      };
    })
    .filter((group) => group.children.length > 0);

  return [...groupedRoutes, ...topRoutes]
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function buildSidebarMenuItems(currentUser: User, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): WorkspaceMenuItem[] {
  return buildSidebarNavigation(currentUser, resourceInfoMap).map((item) => ({
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

export function getWorkspaceLayoutState(currentUser: User, pathname: string, matches: UIMatch[], resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): WorkspaceRouteState {
  const navigationItems = buildSidebarNavigation(currentUser, resourceInfoMap);
  const matchedHandle = [...matches]
    .reverse()
    .map((match) => match.handle as AppRouteHandle | undefined)
    .find((handle) => handle);
  const selectedGroup = navigationItems.find((item) => item.children?.some((child) => child.path === pathname))?.key;
  const flattenedItems = navigationItems.flatMap((item) => item.path ? [item] : item.children || []);
  const matchedRoute = workspacePageDefinitions.find((route) => route.fullPath === pathname);
  const currentMenuTitle = (matchedRoute ? resolveResourceName(matchedRoute, resourceInfoMap) : undefined) || resolveRouteTitle(matchedHandle?.title, pathname) || '管理后台';
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
