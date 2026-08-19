import { TeamOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { UIMatch } from 'react-router-dom';
import type { RouteResourceDisplayInfo } from '@shared/hooks/useRouteResourceNames';
import type { WorkspaceMenuItem } from '@shared/layouts/WorkspaceShellLayout';
import type { User } from '@shared/types';
import { getVisibleWorkspacePages } from './routePermissions';
import {
  resolveRouteTitle,
  workspacePageDefinitions,
  type AppRouteHandle,
  type RouteTitle,
  type SidebarGroupKey,
  type SidebarMenuMeta,
  type WorkspacePageDefinition,
} from './workspacePageDefinitions';

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
  users: { icon: <TeamOutlined />, label: '用户管理' },
};

function resolveResourceInfo(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return route.routeResourceKey ? resourceInfoMap?.get(route.routeResourceKey) : undefined;
}

function resolveResourceName(route: WorkspacePageDefinition, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>) {
  return resolveResourceInfo(route, resourceInfoMap)?.name;
}

function compareByResourceSort(
  left: WorkspacePageDefinition,
  right: WorkspacePageDefinition,
  resourceInfoMap?: Map<string, RouteResourceDisplayInfo>,
) {
  const leftSortOrder = resolveResourceInfo(left, resourceInfoMap)?.sortOrder ?? 0;
  const rightSortOrder = resolveResourceInfo(right, resourceInfoMap)?.sortOrder ?? 0;
  return leftSortOrder !== rightSortOrder
    ? leftSortOrder - rightSortOrder
    : workspacePageDefinitions.indexOf(left) - workspacePageDefinitions.indexOf(right);
}

function getGroupSortOrder(
  groupKey: SidebarGroupKey,
  children: SidebarNavigationItem[],
  resourceInfoMap?: Map<string, RouteResourceDisplayInfo>,
) {
  const groupResourceKey = groupKey === 'users' ? 'admin.root.users' : undefined;
  const groupSortOrder = groupResourceKey ? resourceInfoMap?.get(groupResourceKey)?.sortOrder : undefined;
  return groupSortOrder ?? (children.length > 0 ? Math.min(...children.map((item) => item.sortOrder)) : 0);
}

function buildSidebarNavigation(
  currentUser: User,
  resourceInfoMap?: Map<string, RouteResourceDisplayInfo>,
): SidebarNavigationItem[] {
  const sidebarRoutes = getVisibleWorkspacePages(currentUser)
    .filter((route): route is WorkspacePageDefinition & {
      handle: AppRouteHandle & { sidebar: SidebarMenuMeta; title: RouteTitle };
    } => Boolean(route.handle?.sidebar));
  const mapRoute = (route: typeof sidebarRoutes[number]): SidebarNavigationItem => ({
    key: route.fullPath,
    icon: route.handle.sidebar.icon,
    label: resolveResourceName(route, resourceInfoMap)
      || route.handle.sidebar.label
      || resolveRouteTitle(route.handle.title, route.fullPath)
      || '',
    path: route.fullPath,
    sortOrder: resolveResourceInfo(route, resourceInfoMap)?.sortOrder ?? 0,
  });
  const topRoutes = sidebarRoutes
    .filter((route) => route.handle.sidebar.level === 'top')
    .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
    .map(mapRoute);
  const groupedRoutes = Object.entries(sidebarGroupMeta)
    .map<SidebarNavigationItem>(([groupKey, group]) => {
      const typedGroupKey = groupKey as SidebarGroupKey;
      const children = sidebarRoutes
        .filter((route) => route.handle.sidebar.level !== 'top' && route.handle.sidebar.groupKey === typedGroupKey)
        .sort((left, right) => compareByResourceSort(left, right, resourceInfoMap))
        .map(mapRoute);
      return {
        key: typedGroupKey,
        icon: group.icon,
        label: resourceInfoMap?.get('admin.root.users')?.name || group.label,
        sortOrder: getGroupSortOrder(typedGroupKey, children, resourceInfoMap),
        children,
      };
    })
    .filter((group): group is SidebarNavigationItem & { children: SidebarNavigationItem[] } => Boolean(group.children?.length));
  return [...groupedRoutes, ...topRoutes].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function buildSidebarMenuItems(currentUser: User, resourceInfoMap?: Map<string, RouteResourceDisplayInfo>): WorkspaceMenuItem[] {
  return buildSidebarNavigation(currentUser, resourceInfoMap).map((item) => ({
    key: item.path || item.key,
    icon: item.icon,
    label: item.label,
    children: item.children?.map((child) => ({ key: child.path || child.key, icon: child.icon, label: child.label })),
  }));
}

export function getWorkspaceLayoutState(
  currentUser: User,
  pathname: string,
  matches: UIMatch[],
  resourceInfoMap?: Map<string, RouteResourceDisplayInfo>,
): WorkspaceRouteState {
  const navigationItems = buildSidebarNavigation(currentUser, resourceInfoMap);
  const matchedHandle = [...matches].reverse()
    .map((match) => match.handle as AppRouteHandle | undefined)
    .find((handle) => handle);
  const selectedGroup = navigationItems.find((item) => item.children?.some((child) => child.path === pathname))?.key;
  const flattenedItems = navigationItems.flatMap((item) => item.path ? [item] : item.children || []);
  const matchedRoute = workspacePageDefinitions.find((route) => route.fullPath === pathname);
  const currentMenuTitle = (matchedRoute ? resolveResourceName(matchedRoute, resourceInfoMap) : undefined)
    || resolveRouteTitle(matchedHandle?.title, pathname)
    || '管理后台';

  return {
    activeOpenKeys: selectedGroup ? [selectedGroup] : [],
    currentMenuTitle,
    defaultOpenKeys: navigationItems.filter((item) => item.children?.length).map((item) => item.key),
    isChatPage: false,
    isContentStudioPage: matchedHandle?.surface === 'studio',
    isContentStudioVideoCreatePage: false,
    isImmersivePage: matchedHandle?.surface === 'immersive',
    selectedMenuKey: flattenedItems.find((item) => item.path === pathname)?.path || null,
  };
}
