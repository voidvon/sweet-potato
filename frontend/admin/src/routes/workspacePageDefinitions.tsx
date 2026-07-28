import {
  ApartmentOutlined,
  AppstoreOutlined,
  ClearOutlined,
  CreditCardOutlined,
  FileOutlined,
  HistoryOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Suspense, lazy, type ReactNode } from 'react';
import { ContentStudioRouteFallback } from '@shared/components/RouteLoadingFallback';
import { AccountPage } from '@shared/pages/AccountPage';
import type { User } from '@shared/types';
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

export type WorkspaceRouteHandlers = {
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

export type SidebarGroupKey = 'users';
export type WorkspaceSurface = 'default' | 'studio' | 'immersive';
export type RouteTitle = string | ((pathname: string) => string | null);

export type SidebarMenuMeta = {
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

export type WorkspacePageDefinition = {
  key: string;
  path: string;
  fullPath: string;
  element: (currentUser: User, handlers: WorkspaceRouteHandlers) => ReactNode;
  handle?: AppRouteHandle;
  routeResourceKey?: string;
  visible?: (currentUser: User) => boolean;
};

function withStudioSuspense(node: ReactNode) {
  return <Suspense fallback={<ContentStudioRouteFallback />}>{node}</Suspense>;
}

export const workspacePageDefinitions: WorkspacePageDefinition[] = [
  {
    key: 'account',
    path: 'account',
    fullPath: routePaths.account,
    element: (currentUser, handlers) => withStudioSuspense(
      <AccountPage currentUser={currentUser} onLogout={handlers.onLogout} onUserUpdated={handlers.onUserUpdated} />,
    ),
    handle: { title: '账号中心', surface: 'studio' },
  },
  {
    key: 'settings-route-resources',
    path: 'system/routes',
    fullPath: routePaths.routeResourceManagement,
    element: () => withStudioSuspense(<RouteResourceManagementPage />),
    routeResourceKey: 'admin.system.route_resources',
    handle: { title: '路由管理', surface: 'studio', sidebar: { icon: <ApartmentOutlined />, level: 'top' } },
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
      sidebar: { groupKey: 'users', icon: <SafetyCertificateOutlined />, level: 'child' },
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
      sidebar: { groupKey: 'users', icon: <UserOutlined />, level: 'child' },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'all-works',
    path: 'works',
    fullPath: routePaths.allWorks,
    element: () => withStudioSuspense(<AllWorksPage />),
    routeResourceKey: 'admin.all_works',
    handle: { title: '全部作品', surface: 'studio', sidebar: { icon: <AppstoreOutlined />, level: 'top' } },
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
    handle: { title: '积分设置', surface: 'studio', sidebar: { icon: <CreditCardOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-models',
    path: 'models',
    fullPath: routePaths.modelSettings,
    element: () => withStudioSuspense(<ModelSettingsPage />),
    routeResourceKey: 'admin.system.models',
    handle: { title: '模型配置', surface: 'studio', sidebar: { icon: <RobotOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-files',
    path: 'system/files',
    fullPath: routePaths.fileManagement,
    element: () => withStudioSuspense(<FileManagementPage />),
    routeResourceKey: 'admin.system.file_management',
    handle: { title: '文件管理', surface: 'studio', sidebar: { icon: <FileOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-temporary-assets',
    path: 'system/temporary-assets',
    fullPath: routePaths.temporaryAssetCleanup,
    element: () => withStudioSuspense(<TemporaryAssetCleanupPage />),
    routeResourceKey: 'admin.system.temporary_assets',
    handle: { title: '临时素材清理', surface: 'studio', sidebar: { icon: <ClearOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-system',
    path: 'system/settings',
    fullPath: routePaths.systemSettings,
    element: () => withStudioSuspense(<SystemSettingsPage />),
    routeResourceKey: 'admin.system.settings',
    handle: { title: '系统设置', surface: 'studio', sidebar: { icon: <SettingOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-access-logs',
    path: 'system/access-logs',
    fullPath: routePaths.siteAccessLogs,
    element: () => withStudioSuspense(<SiteAccessLogPage />),
    routeResourceKey: 'admin.system.access_logs',
    handle: { title: '站点访问日志', surface: 'studio', sidebar: { icon: <HistoryOutlined />, level: 'top' } },
    visible: (currentUser) => currentUser.role === 'admin',
  },
];

export function resolveRouteTitle(title: RouteTitle | undefined, pathname: string) {
  if (!title) return null;
  return typeof title === 'function' ? title(pathname) : title;
}
