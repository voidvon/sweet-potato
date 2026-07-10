import { Suspense, lazy, type ReactNode } from 'react';
import {
  Bot,
  Clapperboard,
  Folder,
  FolderOpen,
  ImagePlus,
  Mic,
  Package,
  Sparkles,
  Star,
  Video,
} from 'lucide-react';
import {
  Navigate,
  type RouteObject,
  type UIMatch,
  useLocation,
} from 'react-router-dom';
import { AppRequestLoading } from '../components/AppRequestLoading';
import {
  ChatRouteFallback,
  ContentStudioRouteFallback,
  ImmersiveRouteFallback,
  WorkspaceRouteFallback,
} from '../components/RouteLoadingFallback';
import { isElectronEgg } from '../ipc';
import { ProtectedLayout } from '../layouts/ProtectedLayout';
import { AuthPage } from '../pages/auth/AuthPage';
import { NoPermissionPage } from '../pages/NoPermissionPage';
import { routePaths } from './paths';
import type { RouteResourceDisplayInfo } from '@shared/hooks/useRouteResourceNames';
import type { WorkspaceMenuItem } from '@shared/layouts/WorkspaceShellLayout';
import type { AuthSession, CreativeModuleCode, User } from '../types';

const ContentStudioPage = lazy(() => import('../pages/content/ContentStudioPage').then((m) => ({ default: m.ContentStudioPage })));
const ContentWorkbenchPage = lazy(() => import('../pages/content/ContentWorkbenchPage').then((m) => ({ default: m.ContentWorkbenchPage })));
const ChatPage = lazy(() => import('../pages/chat/ChatPage').then((m) => ({ default: m.ChatPage })));
const XingtuCreatorPage = lazy(() => import('../pages/creator-ops/XingtuCreatorPage').then((m) => ({ default: m.XingtuCreatorPage })));
const DouyinCreatorSearchPage = lazy(() => import('../pages/creator-ops/DouyinCreatorSearchPage').then((m) => ({ default: m.DouyinCreatorSearchPage })));
const CreatorFavoritesPage = lazy(() => import('../pages/creator-ops/CreatorFavoritesPage').then((m) => ({ default: m.CreatorFavoritesPage })));
const WechatAutomationPage = lazy(() => import('../pages/creator-ops/WechatAutomationPage').then((m) => ({ default: m.WechatAutomationPage })));
const AccountPage = lazy(() => import('../pages/account/AccountPage').then((m) => ({ default: m.AccountPage })));

type WorkspaceRouteHandlers = {
  onLogout: () => void;
  onUserUpdated: (user: User) => void;
};

type AppRouteBuildParams = WorkspaceRouteHandlers & {
  currentUser: User | null;
  onAuthed: (session: AuthSession) => void;
};

type SidebarGroupKey = 'material' | 'video' | 'creatorOps';
type WorkspaceSurface = 'default' | 'studio' | 'immersive';
type RouteTitle = string | ((pathname: string) => string | null);

type SidebarMenuMeta = {
  groupKey?: SidebarGroupKey;
  icon: ReactNode;
  label?: string;
  tag?: 'HOT' | 'NEW';
};

const sidebarGroupResourceKeys: Record<SidebarGroupKey, string> = {
  material: 'web.root.content',
  video: 'web.root.video',
  creatorOps: 'web.root.creator_ops',
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
  activeOpenKeys: SidebarGroupKey[];
  currentMenuTitle: string;
  defaultOpenKeys: SidebarGroupKey[];
  hideWorkspaceHeader?: boolean;
  isChatPage: boolean;
  isContentStudioPage: boolean;
  isContentStudioVideoCreatePage: boolean;
  isImmersivePage: boolean;
  selectedMenuKey: string | null;
};

type SortableWorkspaceMenuItem = WorkspaceMenuItem & {
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

const menuIconProps = {
  size: 16,
  strokeWidth: 1.8,
} as const;

const sidebarGroupMeta: Record<SidebarGroupKey, { icon: ReactNode; label: string }> = {
  material: {
    icon: <FolderOpen {...menuIconProps} />,
    label: '素材库',
  },
  video: {
    icon: <Video {...menuIconProps} />,
    label: '视频生成',
  },
  creatorOps: {
    icon: <Star {...menuIconProps} />,
    label: '达人运营',
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
    key: 'image-creation',
    path: 'image',
    fullPath: routePaths.defaultModule,
    element: () => withChatSuspense(<ChatPage />),
    routeResource: chatRouteGrant,
    handle: {
      title: '图片创作',
    },
  },
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
      title: '内容创作工作台',
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
      title: '人物素材',
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <Bot {...menuIconProps} />,
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
      title: '人声素材',
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <Mic {...menuIconProps} />,
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
      title: '场景素材',
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <Clapperboard {...menuIconProps} />,
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
      title: '产品素材',
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <Package {...menuIconProps} />,
      },
      contentNavigation: {
        code: 'product_assets',
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
      title: '作品',
      surface: 'studio',
      sidebar: {
        icon: <Folder {...menuIconProps} />,
      },
      contentNavigation: {
        code: 'finished_assets',
      },
    },
  },
  {
    key: 'content-video-remake',
    path: 'content/video_remake',
    fullPath: routePaths.contentModule('video_remake'),
    element: (currentUser) => withImmersiveSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="video_remake" />),
    routeResource: {
      permissionCode: 'web.module.content.video_remake',
      protected: true,
      resourceKey: 'web.module.content.video_remake',
      resourceType: 'menu',
    },
    handle: {
      title: '爆款复刻工作流',
      surface: 'immersive',
      sidebar: {
        groupKey: 'video',
        icon: <Sparkles {...menuIconProps} />,
        label: '爆款复刻',
        tag: 'HOT',
      },
      contentNavigation: {
        code: 'video_remake',
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
      protected: false,
      resourceKey: 'web.module.content.create_video',
      resourceType: 'menu',
    },
    handle: {
      title: '视频创作',
      surface: 'immersive',
      sidebar: {
        groupKey: 'video',
        icon: <Video {...menuIconProps} />,
        label: '视频创作',
      },
      contentNavigation: {
        code: 'create_video',
      },
    },
  },
  {
    key: 'creator-ops-xingtu',
    path: 'creator-ops/xingtu',
    fullPath: routePaths.xingtuCreators,
    element: () => withSuspense(<XingtuCreatorPage />),
    routeResource: {
      permissionCode: 'web.module.creator_ops.xingtu',
      protected: true,
      resourceKey: 'web.module.creator_ops.xingtu',
      resourceType: 'menu',
    },
    handle: {
      title: '星图达人',
      sidebar: {
        groupKey: 'creatorOps',
        icon: <Star {...menuIconProps} />,
      },
    },
    visible: () => isElectronEgg,
  },
  {
    key: 'creator-ops-buyin',
    path: 'creator-ops/buyin',
    fullPath: routePaths.buyinCreators,
    element: () => withSuspense(<XingtuCreatorPage platform="buyin" />),
    routeResource: {
      permissionCode: 'web.module.creator_ops.buyin',
      protected: true,
      resourceKey: 'web.module.creator_ops.buyin',
      resourceType: 'menu',
    },
    handle: {
      title: '精选联盟',
      sidebar: {
        groupKey: 'creatorOps',
        icon: <Star {...menuIconProps} />,
      },
    },
    visible: () => isElectronEgg,
  },
  {
    key: 'creator-ops-douyin',
    path: 'creator-ops/douyin',
    fullPath: routePaths.douyinCreators,
    element: () => withSuspense(<DouyinCreatorSearchPage />),
    routeResource: {
      permissionCode: 'web.module.creator_ops.douyin',
      protected: true,
      resourceKey: 'web.module.creator_ops.douyin',
      resourceType: 'menu',
    },
    handle: {
      title: '抖音达人',
      sidebar: {
        groupKey: 'creatorOps',
        icon: <Star {...menuIconProps} />,
      },
    },
    visible: () => isElectronEgg,
  },
  {
    key: 'creator-ops-favorites',
    path: 'creator-ops/favorites',
    fullPath: routePaths.creatorFavorites,
    element: () => withSuspense(<CreatorFavoritesPage />),
    routeResource: {
      protected: false,
      resourceType: 'menu',
    },
    handle: {
      title: '达人收藏',
      sidebar: {
        groupKey: 'creatorOps',
        icon: <Star {...menuIconProps} />,
      },
    },
    visible: () => isElectronEgg,
  },
  {
    key: 'creator-ops-wechat',
    path: 'creator-ops/wechat',
    fullPath: routePaths.wechatOps,
    element: () => withSuspense(<WechatAutomationPage />),
    routeResource: {
      permissionCode: 'web.module.creator_ops.wechat',
      protected: true,
      resourceKey: 'web.module.creator_ops.wechat',
      resourceType: 'menu',
    },
    handle: {
      title: '微信',
      sidebar: {
        groupKey: 'creatorOps',
        icon: <Star {...menuIconProps} />,
      },
    },
    visible: () => isElectronEgg,
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
      title: '账号中心',
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

function resolveResourceInfo(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return route.routeResource?.resourceKey ? resourceInfoMap?.get(route.routeResource.resourceKey) : undefined;
}

function resolveResourceName(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return resolveResourceInfo(route, resourceInfoMap)?.name;
}

function getRouteSortOrder(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  if (route.handle?.sidebar?.groupKey === 'creatorOps') {
    return workspacePageDefinitions.indexOf(route);
  }

  if (route.handle?.sidebar && !route.handle.sidebar.groupKey) {
    return resolveResourceInfo(route, resourceInfoMap)?.sortOrder ?? 1000 + workspacePageDefinitions.indexOf(route);
  }

  return resolveResourceInfo(route, resourceInfoMap)?.sortOrder ?? 0;
}

function compareByResourceSort(left: WorkspacePageDefinition, right: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const leftSortOrder = getRouteSortOrder(left, resourceInfoMap);
  const rightSortOrder = getRouteSortOrder(right, resourceInfoMap);

  if (leftSortOrder !== rightSortOrder) {
    return leftSortOrder - rightSortOrder;
  }

  return workspacePageDefinitions.indexOf(left) - workspacePageDefinitions.indexOf(right);
}

function getGroupSortOrder(groupKey: SidebarGroupKey, children: Array<{ sortOrder: number }>, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const resourceSortOrder = resourceInfoMap?.get(sidebarGroupResourceKeys[groupKey])?.sortOrder;
  if (resourceSortOrder !== undefined) {
    return resourceSortOrder;
  }
  return children.length > 0 ? Math.min(...children.map((item) => item.sortOrder)) : 0;
}

function getFirstPermittedBusinessRoute(currentUser: User) {
  const route = workspacePageDefinitions.find((item) => (
    item.key !== 'account'
    && item.key !== 'content-root'
    && isVisibleWorkspacePage(item, currentUser)
  ));

  return route?.fullPath || null;
}

function resolveDefaultAppPath(currentUser: User) {
  return getFirstPermittedBusinessRoute(currentUser) || routePaths.account;
}

function getPermissionState(currentUser: User): PermissionState {
  const firstPermittedBusinessPath = getFirstPermittedBusinessRoute(currentUser);

  return {
    canAccessAccount: true,
    defaultAppPath: firstPermittedBusinessPath || routePaths.account,
    hasAnyBusinessAccess: Boolean(firstPermittedBusinessPath),
  };
}

function resolveUnauthorizedRedirectPath(state: PermissionState) {
  if (state.hasAnyBusinessAccess) {
    return state.defaultAppPath;
  }

  return routePaths.noPermission;
}

function ProtectedRouteGate({
  children,
  fallbackPath,
  isAllowed,
}: {
  children: ReactNode;
  fallbackPath: string;
  isAllowed: boolean;
}) {
  if (!isAllowed) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}

function createProtectedRouteObjects(currentUser: User, handlers: WorkspaceRouteHandlers): AppRouteObject[] {
  const permissionState = getPermissionState(currentUser);
  const unauthorizedRedirectPath = resolveUnauthorizedRedirectPath(permissionState);

  return workspacePageDefinitions.map((route) => ({
    id: route.key,
    path: route.path,
    element: (
      <ProtectedRouteGate
        fallbackPath={unauthorizedRedirectPath}
        isAllowed={route.key === 'account' || isVisibleWorkspacePage(route, currentUser)}
      >
        {route.element(currentUser, handlers)}
      </ProtectedRouteGate>
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
    : [];

  return [
    {
      id: 'login',
      path: routePaths.login,
      element: currentUser ? (
        <Navigate to={defaultAppPath} replace />
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
        <ProtectedLayout currentUser={currentUser} onLogout={onLogout} />
      ) : (
        <Navigate to={routePaths.login} replace />
      ),
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

function buildSidebarNavigation(currentUser: User, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  const sidebarRoutes = getVisibleWorkspacePages(currentUser)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => Boolean(route.handle?.sidebar?.groupKey));

  return Object.entries(sidebarGroupMeta)
    .map(([groupKey, group]) => {
      const typedGroupKey = groupKey as SidebarGroupKey;
      const children = sidebarRoutes
        .filter((route) => route.handle.sidebar.groupKey === typedGroupKey)
        .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
        .map((route) => ({
          key: route.fullPath,
          icon: route.handle.sidebar.icon,
          label: resolveResourceName(route, resourceInfoMap) || route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
          path: route.fullPath,
          sortOrder: getRouteSortOrder(route, resourceInfoMap),
          tag: route.handle.sidebar.tag,
        }));

      return {
        key: typedGroupKey,
        icon: group.icon,
        label: resourceInfoMap?.get(sidebarGroupResourceKeys[typedGroupKey])?.name || group.label,
        sortOrder: getGroupSortOrder(typedGroupKey, children, resourceInfoMap),
        children,
      };
    })
    .filter((group) => group.children.length > 0)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function buildTopLevelSidebarRoutes(currentUser: User, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return getVisibleWorkspacePages(currentUser)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => (
      Boolean(route.handle?.sidebar) && !route.handle?.sidebar?.groupKey
    ))
    .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
    .map((route) => ({
      key: route.fullPath,
      icon: route.handle.sidebar.icon,
      label: resolveResourceName(route, resourceInfoMap) || route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
      sortOrder: getRouteSortOrder(route, resourceInfoMap),
    }));
}

export function buildSidebarMenuItems(currentUser: User, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): WorkspaceMenuItem[] {
  const groups = buildSidebarNavigation(currentUser, resourceInfoMap);
  const sidebarItems: SortableWorkspaceMenuItem[] = [];

  if (hasRouteGrant(currentUser, chatRouteGrant)) {
    sidebarItems.push({
      key: routePaths.defaultModule,
      icon: <ImagePlus {...menuIconProps} />,
      label: resourceInfoMap?.get('web.module.chat')?.name || '图片创作',
      sortOrder: resourceInfoMap?.get('web.root.chat')?.sortOrder ?? resourceInfoMap?.get('web.module.chat')?.sortOrder ?? 0,
    });
  }

  sidebarItems.push(...buildTopLevelSidebarRoutes(currentUser, resourceInfoMap));

  sidebarItems.push(...groups.map((group) => ({
      key: group.key,
      icon: group.icon,
      label: group.label,
      children: group.children.map((item) => ({
        key: item.path,
        icon: item.icon,
        label: item.tag ? (
          <span className="menu-item-label">
            <span>{item.label}</span>
            <span className={`route-tag route-tag-${item.tag.toLowerCase()}`}>{item.tag}</span>
          </span>
        ) : item.label,
      })),
      sortOrder: group.sortOrder,
    })));

  return sidebarItems
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(({ sortOrder: _sortOrder, ...item }) => item);
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
  const currentMenuTitle = (matchedRoute ? resolveResourceName(matchedRoute, resourceInfoMap) : undefined) || resolveRouteTitle(matchedHandle?.title, pathname) || '工作台';
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
