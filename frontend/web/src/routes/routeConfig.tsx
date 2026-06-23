import { Suspense, lazy, type ReactNode } from 'react';
import { RobotOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import {
  Bot,
  Clapperboard,
  Film,
  FolderOpen,
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
import { modules } from '../modules';
import { AuthPage } from '../pages/auth/AuthPage';
import { routePaths } from './paths';
import type { AuthSession, CreativeModuleCode, User } from '../types';

const ContentStudioPage = lazy(() => import('../pages/content/ContentStudioPage').then((m) => ({ default: m.ContentStudioPage })));
const ContentWorkbenchPage = lazy(() => import('../pages/content/ContentWorkbenchPage').then((m) => ({ default: m.ContentWorkbenchPage })));
const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const XingtuCreatorPage = lazy(() => import('../pages/creator-ops/XingtuCreatorPage').then((m) => ({ default: m.XingtuCreatorPage })));
const WechatAutomationPage = lazy(() => import('../pages/creator-ops/WechatAutomationPage').then((m) => ({ default: m.WechatAutomationPage })));
const AccountPage = lazy(() => import('../pages/account/AccountPage').then((m) => ({ default: m.AccountPage })));
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

type SidebarGroupKey = 'material' | 'video' | 'creatorOps' | 'admin';
type WorkspaceSurface = 'default' | 'studio' | 'immersive';
type RouteTitle = string | ((pathname: string) => string | null);

type SidebarMenuMeta = {
  groupKey: SidebarGroupKey;
  icon: ReactNode;
  label?: string;
  tag?: 'HOT' | 'NEW';
};

export type AppRouteHandle = {
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
  isChatPage: boolean;
  isContentStudioPage: boolean;
  isContentStudioVideoCreatePage: boolean;
  isImmersivePage: boolean;
  selectedMenuKey: string | null;
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
  admin: {
    icon: <SettingOutlined />,
    label: '后台管理',
  },
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
    key: 'module-dashboard',
    path: 'modules/:moduleId',
    fullPath: routePaths.module(),
    element: () => withChatSuspense(<DashboardPage />),
    handle: {
      title: (pathname) => {
        const matchedModule = modules.find((item) => pathname === routePaths.module(item.id));
        return matchedModule?.title || null;
      },
    },
  },
  {
    key: 'content-root',
    path: 'content',
    fullPath: routePaths.contentRoot,
    element: (currentUser) => withSuspense(<ContentWorkbenchPage currentUser={currentUser} />),
    handle: {
      title: '内容创作工作台',
    },
  },
  {
    key: 'content-virtual-portrait-assets',
    path: 'content/virtual_portrait_assets',
    fullPath: routePaths.contentModule('virtual_portrait_assets'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="virtual_portrait_assets" />),
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
    key: 'content-real-person-assets',
    path: 'content/real_person_assets',
    fullPath: routePaths.contentModule('real_person_assets'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="real_person_assets" />),
    handle: {
      title: '真人素材',
      surface: 'studio',
    },
  },
  {
    key: 'content-ai-voice',
    path: 'content/ai_voice',
    fullPath: routePaths.contentModule('ai_voice'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="ai_voice" />),
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
    handle: {
      title: '成片素材',
      surface: 'studio',
      sidebar: {
        groupKey: 'material',
        icon: <Film {...menuIconProps} />,
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
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="create_video" />),
    handle: {
      title: '视频制作',
      surface: 'studio',
    },
  },
  {
    key: 'content-digital-human',
    path: 'content/digital_human',
    fullPath: routePaths.contentModule('digital_human'),
    element: (currentUser) => withStudioSuspense(<ContentStudioPage currentUser={currentUser} moduleCode="digital_human" />),
    handle: {
      title: '数字人素材',
      surface: 'studio',
    },
  },
  {
    key: 'creator-ops-xingtu',
    path: 'creator-ops/xingtu',
    fullPath: routePaths.xingtuCreators,
    element: () => withSuspense(<XingtuCreatorPage />),
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
    key: 'creator-ops-wechat',
    path: 'creator-ops/wechat',
    fullPath: routePaths.wechatOps,
    element: () => withSuspense(<WechatAutomationPage />),
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
  {
    key: 'settings-users',
    path: 'settings/users',
    fullPath: routePaths.userManagement,
    element: () => withStudioSuspense(<UserManagementPage />),
    handle: {
      title: '用户管理',
      surface: 'studio',
      sidebar: {
        groupKey: 'admin',
        icon: <TeamOutlined />,
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-billing',
    path: 'settings/billing',
    fullPath: routePaths.billingSettings,
    element: () => withStudioSuspense(<BillingSettingsPage />),
    handle: {
      title: '积分设置',
      surface: 'studio',
      sidebar: {
        groupKey: 'admin',
        icon: <SettingOutlined />,
      },
    },
    visible: (currentUser) => currentUser.role === 'admin',
  },
  {
    key: 'settings-models',
    path: 'settings/models',
    fullPath: routePaths.modelSettings,
    element: () => withStudioSuspense(<ModelSettingsPage />),
    handle: {
      title: '模型配置',
      surface: 'studio',
      sidebar: {
        groupKey: 'admin',
        icon: <RobotOutlined />,
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
        <ProtectedLayout currentUser={currentUser} onLogout={onLogout} />
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

export const contentNavigationRoutes: ContentNavigationRoute[] = workspacePageDefinitions
  .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { contentNavigation: { code: CreativeModuleCode } } } => Boolean(route.handle?.contentNavigation))
  .map((route) => ({
    code: route.handle.contentNavigation.code,
    name: resolveRouteTitle(route.handle.title, route.fullPath) || '',
    path: route.fullPath,
  }));

function buildSidebarNavigation(currentUser: User) {
  const sidebarRoutes = getVisibleWorkspacePages(currentUser)
    .filter((route): route is WorkspacePageDefinition & { handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle } } => Boolean(route.handle?.sidebar));

  return Object.entries(sidebarGroupMeta)
    .map(([groupKey, group]) => ({
      key: groupKey as SidebarGroupKey,
      icon: group.icon,
      label: group.label,
      children: sidebarRoutes
        .filter((route) => route.handle.sidebar.groupKey === groupKey)
        .map((route) => ({
          key: route.fullPath,
          icon: route.handle.sidebar.icon,
          label: route.handle.sidebar.label || resolveRouteTitle(route.handle.title, route.fullPath) || '',
          path: route.fullPath,
          tag: route.handle.sidebar.tag,
        })),
    }))
    .filter((group) => group.children.length > 0);
}

export function buildSidebarMenuItems(currentUser: User): NonNullable<MenuProps['items']> {
  const groups = buildSidebarNavigation(currentUser);

  return [
    {
      key: routePaths.defaultModule,
      icon: <Bot {...menuIconProps} />,
      label: 'AI 对话',
    },
    ...groups.map((group) => ({
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
    })),
  ];
}

export function getWorkspaceLayoutState(currentUser: User, pathname: string, matches: UIMatch[]): WorkspaceRouteState {
  const groups = buildSidebarNavigation(currentUser);
  const matchedHandle = [...matches]
    .reverse()
    .map((match) => match.handle as AppRouteHandle | undefined)
    .find((handle) => handle);
  const selectedGroup = groups.find((group) => group.children.some((item) => item.path === pathname))?.key;
  const currentMenuTitle = resolveRouteTitle(matchedHandle?.title, pathname) || '工作台';
  const selectedMenuKey = pathname === routePaths.defaultModule
    ? routePaths.defaultModule
    : groups.flatMap((group) => group.children).find((item) => item.path === pathname)?.path || null;

  return {
    activeOpenKeys: selectedGroup ? [selectedGroup] : [],
    currentMenuTitle,
    defaultOpenKeys: groups.map((group) => group.key),
    isChatPage: pathname === routePaths.defaultModule,
    isContentStudioPage: matchedHandle?.surface === 'studio',
    isContentStudioVideoCreatePage: pathname === routePaths.contentModule('create_video'),
    isImmersivePage: pathname === routePaths.defaultModule || matchedHandle?.surface === 'immersive',
    selectedMenuKey,
  };
}
