import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import {
  AudioFilled,
  AudioOutlined,
  CompassFilled,
  CompassOutlined,
  FolderFilled,
  FolderOpenFilled,
  FolderOpenOutlined,
  FolderOutlined,
  PictureFilled,
  PictureOutlined,
  PlaySquareFilled,
  PlaySquareOutlined,
  ProductFilled,
  ProductOutlined,
  RobotFilled,
  RobotOutlined,
  TableOutlined,
  VideoCameraFilled,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Navigate,
  type RouteObject,
  type UIMatch,
  useLocation,
} from 'react-router-dom';
import { currentReturnTo, loginPathWithReturnTo, returnToFromLoginSearch } from '@shared/utils/authRedirect';
import { AppRequestLoading } from '../components/AppRequestLoading';
import { getPublicRouteResourceTree } from '@shared/api/route-resource';
import {
  ChatRouteFallback,
  ContentStudioRouteFallback,
  ImmersiveRouteFallback,
  WorkspaceRouteFallback,
} from '../components/RouteLoadingFallback';
import { ProtectedLayout } from '../layouts/ProtectedLayout';
import { AuthPage } from '../pages/auth/AuthPage';
import { NoPermissionPage } from '../pages/NoPermissionPage';
import { routePaths } from './paths';
import type { RouteResourceDisplayInfo } from '@shared/hooks/useRouteResourceNames';
import type { WorkspaceMenuItem } from '@shared/layouts/WorkspaceShellLayout';
import type { AuthSession, CreativeModuleCode, User } from '../types';
import { t } from '@shared/i18n';

const ContentStudioPage = lazy(() => import('../pages/content/ContentStudioPage').then((m) => ({ default: m.ContentStudioPage })));
const ContentWorkbenchPage = lazy(() => import('../pages/content/ContentWorkbenchPage').then((m) => ({ default: m.ContentWorkbenchPage })));
const BatchGenerationPage = lazy(() => import('../pages/content/BatchGenerationPage').then((m) => ({ default: m.BatchGenerationPage })));
const ChatPage = lazy(() => import('../pages/chat/ChatPage').then((m) => ({ default: m.ChatPage })));
const DiscoverPage = lazy(() => import('../pages/discover/DiscoverPage').then((m) => ({ default: m.DiscoverPage })));
const AccountPage = lazy(() => import('../pages/account/AccountPage').then((m) => ({ default: m.AccountPage })));
const UserModelSettingsPage = lazy(() => import('../pages/settings/UserModelSettingsPage').then((m) => ({ default: m.UserModelSettingsPage })));

type WorkspaceRouteHandlers = {
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

type AppRouteBuildParams = WorkspaceRouteHandlers & {
  currentUser: User | null;
  onAuthed: (session: AuthSession) => void;
};

type SidebarGroupKey = 'material' | 'video';
type WorkspaceSurface = 'default' | 'studio' | 'immersive';
type RouteTitle = string | ((pathname: string) => string | null);

type SidebarMenuMeta = {
  groupKey?: SidebarGroupKey;
  icon: ReactNode;
  label?: string;
  selectedIcon?: ReactNode;
  sortOrder?: number;
  tag?: 'BETA' | 'HOT' | 'NEW';
};

const sidebarGroupResourceKeys: Record<SidebarGroupKey, string> = {
  material: 'web.root.content',
  video: 'web.root.video',
};

type RouteResourceType = 'directory' | 'menu';

type WebRouteResourceMeta = {
  permissionCode?: string;
  protected?: boolean;
  resourceKey?: string;
  resourceType?: RouteResourceType;
};

export type AppRouteHandle = {
  hideWorkspaceHeader?: boolean;
  sidebar?: SidebarMenuMeta;
  surface?: WorkspaceSurface;
  title?: RouteTitle;
  contentNavigation?: {
    code: CreativeModuleCode;
  };
};

export type AppRouteObject = RouteObject & {
  id: string;
  handle?: AppRouteHandle;
  children?: AppRouteObject[];
};

type WorkspacePageDefinition = {
  anonymousElement?: () => ReactNode;
  key: string;
  path: string;
  fullPath: string;
  element: (currentUser: User, handlers: WorkspaceRouteHandlers) => ReactNode;
  handle?: AppRouteHandle;
  routeResource?: WebRouteResourceMeta;
  visible?: (currentUser: User) => boolean;
};

export type ContentNavigationRoute = {
  code: CreativeModuleCode;
  name: string;
  path: string;
};

export type WorkspaceRouteState = {
  activeOpenKeys: string[];
  currentMenuTitle: string;
  defaultOpenKeys: string[];
  hideWorkspaceHeader?: boolean;
  isChatPage: boolean;
  isContentStudioPage: boolean;
  isContentStudioVideoCreatePage: boolean;
  isImmersivePage: boolean;
  selectedMenuKey: string | null;
};

type SortableWorkspaceMenuItem = WorkspaceMenuItem & {
  orderIndex: number;
  sortOrder: number;
};

type SidebarNavigationChild = {
  icon: ReactNode;
  label: string;
  orderIndex: number;
  path: string;
  selectedIcon?: ReactNode;
  sortOrder: number;
  tag?: SidebarMenuMeta['tag'];
};

type SidebarNavigationGroup = {
  children: SidebarNavigationChild[];
  icon: ReactNode;
  key: string;
  label: string;
  orderIndex: number;
  selectedIcon?: ReactNode;
  sortOrder: number;
};

type PermissionState = {
  canAccessAccount: boolean;
  defaultAppPath: string;
  hasAnyBusinessAccess: boolean;
};

type UserGrantState = {
  permissionCodes: Set<string>;
  permissions: Set<string>;
  resourceIds: Set<string>;
  resourceKeys: Set<string>;
};

const sidebarGroupMeta: Record<SidebarGroupKey, { icon: ReactNode; label: string; selectedIcon: ReactNode }> = {
  material: {
    icon: <FolderOpenOutlined />,
    label: t("素材库"),
    selectedIcon: <FolderOpenFilled />,
  },
  video: {
    icon: <VideoCameraOutlined />,
    label: t("视频生成"),
    selectedIcon: <VideoCameraFilled />,
  },
};

const chatRouteGrant: WebRouteResourceMeta = {
  permissionCode: 'web.module.chat',
  protected: true,
  resourceKey: 'web.module.chat',
  resourceType: 'menu',
};

function withSuspense(node: ReactNode, fallback: ReactNode = <WorkspaceRouteFallback />) {
  return <Suspense fallback={fallback}>{node}</Suspense>;
}

function withStudioSuspense(node: ReactNode) {
  return withSuspense(node, <ContentStudioRouteFallback />);
}

function withImmersiveSuspense(node: ReactNode) {
  return withSuspense(node, <ImmersiveRouteFallback />);
}

function withChatSuspense(node: ReactNode) {
  return withSuspense(node, <ChatRouteFallback />);
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
    key: 'content-root',
    path: 'content',
    fullPath: routePaths.contentRoot,
    element: (currentUser) => withSuspense(<ContentWorkbenchPage currentUser={currentUser} />),
    routeResource: {
      permissionCode: 'web.directory.content',
      protected: false,
      resourceKey: 'web.root.content',
      resourceType: 'directory',
    },
    handle: {
      title: t("内容创作工作台"),
    },
  },
  {
    key: 'content-virtual-portrait-assets',
    path: 'content/virtual_portrait_assets',
    fullPath: routePaths.contentModule('virtual_portrait_assets'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="virtual_portrait_assets" />),
    routeResource: {
      permissionCode: 'web.module.content.virtual_portrait_assets',
      protected: true,
      resourceKey: 'web.module.content.virtual_portrait_assets',
      resourceType: 'menu',
    },
    handle: {
      title: t("人物素材"),
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <RobotOutlined />,
        selectedIcon: <RobotFilled />,
      },
      contentNavigation: {
        code: 'virtual_portrait_assets',
      },
    },
  },
  {
    key: 'content-ai-voice',
    path: 'content/ai_voice',
    fullPath: routePaths.contentModule('ai_voice'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="ai_voice" />),
    routeResource: {
      permissionCode: 'web.module.content.ai_voice',
      protected: true,
      resourceKey: 'web.module.content.ai_voice',
      resourceType: 'menu',
    },
    handle: {
      title: t("人声素材"),
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <AudioOutlined />,
        selectedIcon: <AudioFilled />,
      },
      contentNavigation: {
        code: 'ai_voice',
      },
    },
  },
  {
    key: 'content-scene-library',
    path: 'content/scene_library',
    fullPath: routePaths.contentModule('scene_library'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="scene_library" />),
    routeResource: {
      permissionCode: 'web.module.content.scene_library',
      protected: true,
      resourceKey: 'web.module.content.scene_library',
      resourceType: 'menu',
    },
    handle: {
      title: t("场景素材"),
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <PlaySquareOutlined />,
        selectedIcon: <PlaySquareFilled />,
      },
      contentNavigation: {
        code: 'scene_library',
      },
    },
  },
  {
    key: 'content-product-assets',
    path: 'content/product_assets',
    fullPath: routePaths.contentModule('product_assets'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="product_assets" />),
    routeResource: {
      permissionCode: 'web.module.content.product_assets',
      protected: true,
      resourceKey: 'web.module.content.product_assets',
      resourceType: 'menu',
    },
    handle: {
      title: t("产品素材"),
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <ProductOutlined />,
        selectedIcon: <ProductFilled />,
      },
      contentNavigation: {
        code: 'product_assets',
      },
    },
  },
  {
    key: 'discover',
    path: 'discover',
    fullPath: routePaths.discover,
    anonymousElement: () => withSuspense(<DiscoverPage />),
    element: () => withSuspense(<DiscoverPage />),
    routeResource: {
      permissionCode: 'web.route.discover.view',
      protected: true,
      resourceKey: 'web.discover',
      resourceType: 'menu',
    },
    handle: {
      title: t("发现"),
      sidebar: { icon: <CompassOutlined />, selectedIcon: <CompassFilled />, sortOrder: -10 },
    },
  },
  {
    key: 'image-creation',
    path: 'image',
    fullPath: routePaths.defaultModule,
    anonymousElement: () => withChatSuspense(<ChatPage />),
    element: () => withChatSuspense(<ChatPage />),
    routeResource: chatRouteGrant,
    handle: {
      title: t("图片创作"),
    },
  },
  {
    key: 'content-batch-generation',
    path: 'content/batch-generation',
    fullPath: routePaths.contentModule('batch-generation'),
    element: () => withStudioSuspense(<BatchGenerationPage />),
    routeResource: {
      permissionCode: 'web.module.content.batch_generation',
      protected: true,
      resourceKey: 'web.module.content.batch_generation',
      resourceType: 'menu',
    },
    handle: {
      hideWorkspaceHeader: true,
      title: t("批量"),
      surface: 'studio',
      sidebar: {
        icon: <TableOutlined />,
        selectedIcon: <TableOutlined />,
        tag: 'BETA',
      },
    },
  },
  {
    key: 'content-finished-assets',
    path: 'content/finished_assets',
    fullPath: routePaths.contentModule('finished_assets'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="finished_assets" />),
    routeResource: {
      permissionCode: 'web.module.content.finished_assets',
      protected: true,
      resourceKey: 'web.module.content.finished_assets',
      resourceType: 'menu',
    },
    handle: {
      hideWorkspaceHeader: true,
      title: t("作品"),
      surface: 'studio',
      sidebar: {
        icon: <FolderOutlined />,
        selectedIcon: <FolderFilled />,
      },
      contentNavigation: {
        code: 'finished_assets',
      },
    },
  },
  {
    key: 'content-create-video',
    path: 'content/create_video',
    fullPath: routePaths.contentModule('create_video'),
    element: (currentUser) => withImmersiveSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="create_video" />),
    routeResource: {
      permissionCode: 'web.module.content.create_video',
      protected: true,
      resourceKey: 'web.module.content.create_video',
      resourceType: 'menu',
    },
    handle: {
      hideWorkspaceHeader: true,
      title: t("视频创作"),
      surface: 'immersive',
      sidebar: {
        groupKey: 'video',
        icon: <VideoCameraOutlined />,
        label: t("视频创作"),
        selectedIcon: <VideoCameraFilled />,
      },
      contentNavigation: {
        code: 'create_video',
      },
    },
  },
  {
    key: 'models',
    path: 'models',
    fullPath: routePaths.models,
    element: () => withStudioSuspense(<UserModelSettingsPage />),
    handle: {
      title: t("模型管理"),
      surface: 'studio',
    },
  },
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
      title: t("账号中心"),
      surface: 'studio',
    },
  },
];

function resolveRouteTitle(title: RouteTitle | undefined, pathname: string) {
  if (!title) {
    return null;
  }
  return typeof title === 'function' ? title(pathname) : title;
}

function isVisibleWorkspacePage(route: WorkspacePageDefinition, currentUser: User) {
  return hasRouteAccess(currentUser, route) && (route.visible ? route.visible(currentUser) : true);
}

function getUserGrantState(currentUser: User): UserGrantState {
  const assignedRoles = currentUser.assignedRoles || [];
  return {
    permissionCodes: new Set([
      ...(currentUser.permissionCodes || []),
      ...assignedRoles.flatMap((role) => role.permissionCodes || []),
    ]),
    permissions: new Set([
      ...(currentUser.permissions || []),
      ...assignedRoles.flatMap((role) => role.permissions || []),
    ]),
    resourceIds: new Set([
      ...(currentUser.resourceIds || []),
      ...assignedRoles.flatMap((role) => role.resourceIds || []),
    ]),
    resourceKeys: new Set([
      ...(currentUser.resourceKeys || []),
      ...assignedRoles.flatMap((role) => role.resourceKeys || []),
    ]),
  };
}

function hasRouteGrant(currentUser: User, routeResource?: WebRouteResourceMeta) {
  if (!routeResource || currentUser.role === 'admin') {
    return true;
  }

  if (routeResource.protected === false) {
    return true;
  }

  const grants = getUserGrantState(currentUser);

  if (routeResource.resourceKey && grants.resourceKeys.has(routeResource.resourceKey)) {
    return true;
  }

  if (routeResource.permissionCode && grants.permissionCodes.has(routeResource.permissionCode)) {
    return true;
  }

  if (routeResource.permissionCode && grants.permissions.has(routeResource.permissionCode)) {
    return true;
  }

  if (routeResource.resourceKey && grants.permissions.has(routeResource.resourceKey)) {
    return true;
  }

  if (routeResource.protected) {
    return false;
  }

  return grants.resourceIds.size > 0 || grants.resourceKeys.size > 0 || grants.permissionCodes.size > 0 || grants.permissions.size > 0;
}

function hasRouteAccess(currentUser: User, route: WorkspacePageDefinition) {
  if (route.key === 'content-root') {
    return workspacePageDefinitions.some((item) => (
      Boolean(item.handle?.contentNavigation) && hasRouteGrant(currentUser, item.routeResource)
    ));
  }

  return hasRouteGrant(currentUser, route.routeResource);
}

function getVisibleWorkspacePages(currentUser: User) {
  return workspacePageDefinitions.filter((route) => isVisibleWorkspacePage(route, currentUser));
}

function isWorkspacePageMenuVisible(
  route: WorkspacePageDefinition,
  currentUser: User | null,
  resourceInfoMap?: Map<string, RouteResourceDisplayInfo>,
) {
  return Boolean(currentUser && isVisibleWorkspacePage(route, currentUser))
    || resolveResourceInfo(route, resourceInfoMap)?.visibilityMode === 'always';
}

function getMenuVisibleWorkspacePages(currentUser: User | null, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return workspacePageDefinitions.filter((route) => isWorkspacePageMenuVisible(route, currentUser, resourceInfoMap));
}

function resolveResourceInfo(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return route.routeResource?.resourceKey ? resourceInfoMap?.get(route.routeResource.resourceKey) : undefined;
}

function resolveResourceName(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return resolveResourceInfo(route, resourceInfoMap)?.name;
}

function findResourceInfoById(resourceInfoMap: Map<string, RouteResourceDisplayInfo>, id: string) {
  return Array.from(resourceInfoMap.values()).find((resource) => resource.id === id);
}

function resolveRouteSidebarGroup(
  route: WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta } },
  resourceInfoMap?: Map<string, RouteResourceDisplayInfo>,
) {
  const routeInfo = resolveResourceInfo(route, resourceInfoMap);
  if (routeInfo) {
    if (!routeInfo.parentId || !resourceInfoMap) {
      return null;
    }

    const parentInfo = findResourceInfoById(resourceInfoMap, routeInfo.parentId);
    if (!parentInfo) {
      return null;
    }

    const staticGroupKey = (Object.entries(sidebarGroupResourceKeys) as Array<[SidebarGroupKey, string]>)
      .find(([, resourceKey]) => resourceKey === parentInfo.resourceKey)?.[0];

    return {
      key: parentInfo.resourceKey,
      icon: staticGroupKey ? sidebarGroupMeta[staticGroupKey].icon : <FolderOpenOutlined />,
      label: parentInfo.name,
      orderIndex: parentInfo.orderIndex,
      selectedIcon: staticGroupKey ? sidebarGroupMeta[staticGroupKey].selectedIcon : <FolderOpenFilled />,
      sortOrder: parentInfo.sortOrder,
    };
  }

  const staticGroupKey = route.handle.sidebar.groupKey;
  if (!staticGroupKey) {
    return null;
  }

  return {
    key: staticGroupKey,
    icon: sidebarGroupMeta[staticGroupKey].icon,
    label: resourceInfoMap?.get(sidebarGroupResourceKeys[staticGroupKey])?.name || sidebarGroupMeta[staticGroupKey].label,
    orderIndex: resourceInfoMap?.get(sidebarGroupResourceKeys[staticGroupKey])?.orderIndex ?? Number.MAX_SAFE_INTEGER,
    selectedIcon: sidebarGroupMeta[staticGroupKey].selectedIcon,
    sortOrder: resourceInfoMap?.get(sidebarGroupResourceKeys[staticGroupKey])?.sortOrder,
  };
}

function getRouteOrderIndex(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return resolveResourceInfo(route, resourceInfoMap)?.orderIndex ?? Number.MAX_SAFE_INTEGER;
}

function getRouteSortOrder(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const resourceSortOrder = resolveResourceInfo(route, resourceInfoMap)?.sortOrder;
  if (resourceSortOrder !== undefined) {
    return resourceSortOrder;
  }

  if (route.handle?.sidebar?.sortOrder !== undefined) {
    return route.handle.sidebar.sortOrder;
  }

  if (route.handle?.sidebar && !route.handle.sidebar.groupKey) {
    return 1000 + workspacePageDefinitions.indexOf(route);
  }

  return 0;
}

function compareByResourceSort(left: WorkspacePageDefinition, right: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const leftSortOrder = getRouteSortOrder(left, resourceInfoMap);
  const rightSortOrder = getRouteSortOrder(right, resourceInfoMap);

  if (leftSortOrder !== rightSortOrder) {
    return leftSortOrder - rightSortOrder;
  }

  const leftOrderIndex = getRouteOrderIndex(left, resourceInfoMap);
  const rightOrderIndex = getRouteOrderIndex(right, resourceInfoMap);
  if (leftOrderIndex !== rightOrderIndex) {
    return leftOrderIndex - rightOrderIndex;
  }

  return workspacePageDefinitions.indexOf(left) - workspacePageDefinitions.indexOf(right);
}

function getFirstPermittedBusinessRoute(currentUser: User) {
  const preferredRoute = workspacePageDefinitions.find((item) => (
    item.fullPath === routePaths.contentDefault
    && isVisibleWorkspacePage(item, currentUser)
  ));
  if (preferredRoute) {
    return preferredRoute.fullPath;
  }

  const route = workspacePageDefinitions.find((item) => (
    item.key !== 'account'
    && item.key !== 'content-root'
    && isVisibleWorkspacePage(item, currentUser)
  ));

  return route?.fullPath || null;
}

function resolveDefaultAppPath(currentUser: User) {
  return getFirstPermittedBusinessRoute(currentUser) || routePaths.noPermission;
}

function getPermissionState(currentUser: User): PermissionState {
  const firstPermittedBusinessPath = getFirstPermittedBusinessRoute(currentUser);

  return {
    canAccessAccount: true,
    defaultAppPath: resolveDefaultAppPath(currentUser),
    hasAnyBusinessAccess: Boolean(firstPermittedBusinessPath),
  };
}

function resolveUnauthorizedRedirectPath(state: PermissionState) {
  if (state.hasAnyBusinessAccess) {
    return state.defaultAppPath;
  }

  return routePaths.noPermission;
}

function hasAlwaysVisibleResource(raw: unknown, resourceKey: string): boolean {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (
        (raw as { items?: unknown[] }).items
        || (raw as { tree?: unknown[] }).tree
        || (raw as { data?: unknown[] }).data
        || []
      )
      : [];

  return source.some((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const resource = item as { children?: unknown[]; resourceKey?: string; visibilityMode?: string };
    return (resource.resourceKey === resourceKey && resource.visibilityMode === 'always')
      || hasAlwaysVisibleResource(resource.children || [], resourceKey);
  });
}

function ConfigurableRouteGate({
  children,
  fallbackPath,
  isAllowed,
  resourceKey,
  preserveReturnTo = false,
}: {
  children: ReactNode;
  fallbackPath: string;
  isAllowed: boolean;
  resourceKey?: string;
  preserveReturnTo?: boolean;
}) {
  const location = useLocation();
  const [configuredAccess, setConfiguredAccess] = useState<'loading' | 'allowed' | 'denied'>(
    isAllowed ? 'allowed' : resourceKey ? 'loading' : 'denied',
  );

  useEffect(() => {
    if (isAllowed) {
      setConfiguredAccess('allowed');
      return;
    }
    if (!resourceKey) {
      setConfiguredAccess('denied');
      return;
    }

    let cancelled = false;
    setConfiguredAccess('loading');
    getPublicRouteResourceTree({ platform: 'web' })
      .then((response) => {
        if (!cancelled) {
          setConfiguredAccess(hasAlwaysVisibleResource(response, resourceKey) ? 'allowed' : 'denied');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfiguredAccess('denied');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAllowed, resourceKey]);

  if (configuredAccess === 'loading') {
    return <WorkspaceRouteFallback />;
  }
  if (configuredAccess === 'denied') {
    const target = preserveReturnTo
      ? loginPathWithReturnTo(fallbackPath, currentReturnTo(location))
      : fallbackPath;
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}

function LoginRedirect() {
  const location = useLocation();
  return <Navigate to={loginPathWithReturnTo(routePaths.login, currentReturnTo(location))} replace />;
}

function PostAuthRedirect() {
  const location = useLocation();
  return <Navigate to={returnToFromLoginSearch(location.search) || '/'} replace />;
}

function createProtectedRouteObjects(currentUser: User, handlers: WorkspaceRouteHandlers): AppRouteObject[] {
  const permissionState = getPermissionState(currentUser);
  const unauthorizedRedirectPath = resolveUnauthorizedRedirectPath(permissionState);

  return workspacePageDefinitions.map((route) => ({
    id: route.key,
    path: route.path,
    element: (
      <ConfigurableRouteGate
        fallbackPath={unauthorizedRedirectPath}
        isAllowed={route.key === 'account' || route.key === 'models' || isVisibleWorkspacePage(route, currentUser)}
        resourceKey={route.routeResource?.resourceKey}
      >
        {route.element(currentUser, handlers)}
      </ConfigurableRouteGate>
    ),
    handle: route.handle,
  }));
}

export function createAppRouteObjects({
  currentUser,
  onAuthed,
  onLogout,
  onUserUpdated,
}: AppRouteBuildParams): AppRouteObject[] {
  const permissionState = currentUser ? getPermissionState(currentUser) : null;
  const defaultAppPath = permissionState?.defaultAppPath || routePaths.defaultLanding;
  const unauthorizedRedirectPath = permissionState ? resolveUnauthorizedRedirectPath(permissionState) : routePaths.login;
  const protectedChildren = currentUser
    ? [
      {
        id: 'app-index',
        index: true,
        element: <Navigate to={defaultAppPath} replace />,
      },
      {
        id: 'no-permission',
        path: 'no-permission',
        element: permissionState?.hasAnyBusinessAccess
          ? <Navigate to={defaultAppPath} replace />
          : <NoPermissionPage canAccessAccount={permissionState?.canAccessAccount ?? true} />,
      },
      ...createProtectedRouteObjects(currentUser, { onLogout, onUserUpdated }),
      {
        id: 'app-fallback',
        path: '*',
        element: <Navigate to={unauthorizedRedirectPath} replace />,
      },
    ]
    : [
      {
        id: 'app-index',
        index: true,
        element: <Navigate to={routePaths.discover} replace />,
      },
      ...workspacePageDefinitions.flatMap((route) => (
        route.anonymousElement && route.routeResource?.resourceKey
          ? [{
            id: route.key,
            path: route.path,
            element: (
              <ConfigurableRouteGate
                fallbackPath={routePaths.login}
                isAllowed={false}
                preserveReturnTo
                resourceKey={route.routeResource.resourceKey}
              >
                {route.anonymousElement()}
              </ConfigurableRouteGate>
            ),
            handle: route.handle,
          }]
          : []
      )),
      {
        id: 'app-fallback',
        path: '*',
        element: <LoginRedirect />,
      },
    ];

  return [
    {
      id: 'root',
      path: '/',
      element: <Navigate to={routePaths.discover} replace />,
    },
    {
      id: 'login',
      path: routePaths.login,
      element: currentUser ? (
        <PostAuthRedirect />
      ) : (
        <AuthRouteFrame>
          <AuthPage onAuthed={onAuthed} />
        </AuthRouteFrame>
      ),
    },
    {
      id: 'app',
      path: routePaths.appRoot,
      element: <ProtectedLayout currentUser={currentUser} onLogout={onLogout} />,
      children: protectedChildren,
    },
    {
      id: 'root-fallback',
      path: '*',
      element: <Navigate to={currentUser ? unauthorizedRedirectPath : routePaths.login} replace />,
    },
  ];
}

const allContentNavigationRoutes: ContentNavigationRoute[] = workspacePageDefinitions
  .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { contentNavigation: { code: CreativeModuleCode } } } => Boolean(route.handle?.contentNavigation))
  .map((route) => ({
    code: route.handle.contentNavigation.code,
    name: resolveRouteTitle(route.handle.title, route.fullPath) || '',
    path: route.fullPath,
  }));

export const contentNavigationRoutes = allContentNavigationRoutes;

export function getContentNavigationRoutes(currentUser: User): ContentNavigationRoute[] {
  return workspacePageDefinitions
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { contentNavigation: { code: CreativeModuleCode } } } => (
      Boolean(route.handle?.contentNavigation) && isVisibleWorkspacePage(route, currentUser)
    ))
    .map((route) => ({
      code: route.handle.contentNavigation.code,
      name: resolveRouteTitle(route.handle.title, route.fullPath) || '',
      path: route.fullPath,
    }));
}

function buildSidebarNavigation(currentUser: User | null, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const sidebarRoutes = getMenuVisibleWorkspacePages(currentUser, resourceInfoMap)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => Boolean(route.handle?.sidebar));
  const groups = new Map<string, SidebarNavigationGroup>();

  sidebarRoutes.forEach((route) => {
    const group = resolveRouteSidebarGroup(route, resourceInfoMap);
    if (!group) {
      return;
    }
    const existingGroup: SidebarNavigationGroup = groups.get(group.key) || {
      ...group,
      children: [],
      orderIndex: group.orderIndex,
      sortOrder: group.sortOrder ?? Number.MAX_SAFE_INTEGER,
    };
    existingGroup.children.push({
      icon: route.handle.sidebar.icon,
      label: resolveResourceName(route, resourceInfoMap) || route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
      orderIndex: getRouteOrderIndex(route, resourceInfoMap),
      path: route.fullPath,
      selectedIcon: route.handle.sidebar.selectedIcon,
      sortOrder: getRouteSortOrder(route, resourceInfoMap),
      tag: route.handle.sidebar.tag,
    });
    groups.set(group.key, existingGroup);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      children: group.children.sort((left, right) => left.sortOrder - right.sortOrder || left.orderIndex - right.orderIndex),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.orderIndex - right.orderIndex);
}

function buildTopLevelSidebarRoutes(currentUser: User | null, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return getMenuVisibleWorkspacePages(currentUser, resourceInfoMap)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => Boolean(route.handle?.sidebar))
    .filter((route) => resolveRouteSidebarGroup(route, resourceInfoMap) === null)
    .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
    .map((route) => ({
      key: route.fullPath,
      icon: route.handle.sidebar.icon,
      label: renderSidebarMenuLabel(
        resolveResourceName(route, resourceInfoMap) || route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
        route.handle.sidebar.tag,
      ),
      orderIndex: getRouteOrderIndex(route, resourceInfoMap),
      selectedIcon: route.handle.sidebar.selectedIcon,
      sortOrder: getRouteSortOrder(route, resourceInfoMap),
    }));
}

function renderSidebarMenuLabel(label: string, tag?: SidebarMenuMeta['tag']) {
  return tag ? (
    <span className="menu-item-label">
      <span>{label}</span>
      <span className={`route-tag route-tag-${tag.toLowerCase()}`}>{tag === 'BETA' ? 'Beta' : tag}</span>
    </span>
  ) : label;
}

export function buildSidebarMenuItems(currentUser: User | null, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): WorkspaceMenuItem[] {
  const groups = buildSidebarNavigation(currentUser, resourceInfoMap);
  const sidebarItems: SortableWorkspaceMenuItem[] = [];

  if (
    (currentUser && hasRouteGrant(currentUser, chatRouteGrant))
    || resourceInfoMap?.get(chatRouteGrant.resourceKey || '')?.visibilityMode === 'always'
  ) {
    sidebarItems.push({
      key: routePaths.defaultModule,
      icon: <PictureOutlined />,
      label: resourceInfoMap?.get('web.module.chat')?.name || t("图片创作"),
      orderIndex: resourceInfoMap?.get('web.module.chat')?.orderIndex ?? Number.MAX_SAFE_INTEGER,
      selectedIcon: <PictureFilled />,
      sortOrder: resourceInfoMap?.get('web.root.chat')?.sortOrder ?? resourceInfoMap?.get('web.module.chat')?.sortOrder ?? 0,
    });
  }

  sidebarItems.push(...buildTopLevelSidebarRoutes(currentUser, resourceInfoMap));

  sidebarItems.push(...groups.map((group) => ({
      key: group.key,
      icon: group.icon,
      label: group.label,
      selectedIcon: group.selectedIcon,
      children: group.children.map((item) => ({
        key: item.path,
        icon: item.icon,
        label: renderSidebarMenuLabel(item.label, item.tag),
        selectedIcon: item.selectedIcon,
      })),
      orderIndex: group.orderIndex,
      sortOrder: group.sortOrder,
    })));

  return sidebarItems
    .sort((left, right) => left.sortOrder - right.sortOrder || left.orderIndex - right.orderIndex)
    .map(({ orderIndex: _orderIndex, sortOrder: _sortOrder, ...item }) => item);
}

export function getWorkspaceLayoutState(currentUser: User, pathname: string, matches: UIMatch[], resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): WorkspaceRouteState {
  const groups = buildSidebarNavigation(currentUser, resourceInfoMap);
  const topLevelRoutes = buildTopLevelSidebarRoutes(currentUser, resourceInfoMap);
  const isChatRouteAccessible = hasRouteGrant(currentUser, chatRouteGrant);
  const chatMenuKey = isChatRouteAccessible ? routePaths.defaultModule : null;
  const matchedHandle = [...matches]
    .reverse()
    .map((match) => match.handle as AppRouteHandle | undefined)
    .find((handle) => handle);
  const selectedGroup = groups.find((group) => group.children.some((item) => item.path === pathname))?.key;
  const matchedRoute = workspacePageDefinitions.find((route) => route.fullPath === pathname);
  const currentMenuTitle = (matchedRoute ? resolveResourceName(matchedRoute, resourceInfoMap) : undefined)
    || matchedHandle?.sidebar?.label
    || resolveRouteTitle(matchedHandle?.title, pathname)
    || t("工作台");
  const selectedMenuKey = pathname === routePaths.defaultModule
    ? chatMenuKey
    : topLevelRoutes.find((item) => item.key === pathname)?.key
      || groups.flatMap((group) => group.children).find((item) => item.path === pathname)?.path
      || null;
  return {
    activeOpenKeys: selectedGroup ? [selectedGroup] : [],
    currentMenuTitle,
    defaultOpenKeys: groups.map((group) => group.key),
    hideWorkspaceHeader: matchedHandle?.hideWorkspaceHeader === true,
    isChatPage: pathname === routePaths.defaultModule && isChatRouteAccessible,
    isContentStudioPage: matchedHandle?.surface === 'studio',
    isContentStudioVideoCreatePage: pathname === routePaths.contentModule('create_video'),
    isImmersivePage: pathname === routePaths.defaultModule || matchedHandle?.surface === 'immersive',
    selectedMenuKey,
  };
}

export function getDefaultAppPath(currentUser: User) {
  return resolveDefaultAppPath(currentUser);
}

export function getContentDefaultPath(currentUser: User) {
  const preferredContentRoute = workspacePageDefinitions.find((route) => (
    route.fullPath === routePaths.contentDefault
    && route.handle?.contentNavigation
    && isVisibleWorkspacePage(route, currentUser)
  ));
  if (preferredContentRoute) {
    return preferredContentRoute.fullPath;
  }

  const firstContentRoute = workspacePageDefinitions.find((route) => (
    route.handle?.contentNavigation && isVisibleWorkspacePage(route, currentUser)
  ));

  return firstContentRoute?.fullPath || getDefaultAppPath(currentUser);
}

export function canAccessRoutePath(currentUser: User, pathname: string) {
  if (pathname === routePaths.account || pathname === routePaths.noPermission) {
    return true;
  }

  const matchedRoute = workspacePageDefinitions.find((route) => route.fullPath === pathname);
  if (matchedRoute) {
    return isVisibleWorkspacePage(matchedRoute, currentUser);
  }

  return false;
}
