import { WorkspaceShellLayout, useWorkspaceHeader } from '@shared/layouts/WorkspaceShellLayout';
import type { WorkspaceBottomNavItem } from '@shared/layouts/WorkspaceShellLayout';
import sidebarLogo from '@shared/assets/sidebar-logo.png';
import {
  FolderFilled,
  FolderOpenOutlined,
  PictureFilled,
  PictureOutlined,
  UserOutlined,
  VideoCameraFilled,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useRouteResourceInfoMap } from '@shared/hooks/useRouteResourceNames';
import { routePaths } from '../routes/paths';
import { buildSidebarMenuItems, getDefaultAppPath, getWorkspaceLayoutState } from '../routes/routeConfig';
import type { User } from '../types';
import { t } from '@shared/i18n';

type ProtectedLayoutProps = {
  currentUser: User | null;
  onLogout: () => void;
};

export { useWorkspaceHeader };

export function ProtectedLayout({ currentUser, onLogout }: ProtectedLayoutProps) {
  const defaultPath = currentUser ? getDefaultAppPath(currentUser) : routePaths.discover;
  const routeResourceInfoMap = useRouteResourceInfoMap('web');
  const resourceBottomNavItems = [
    { key: routePaths.defaultModule, resourceKey: 'web.module.chat', icon: <PictureOutlined />, selectedIcon: <PictureFilled /> },
    { key: routePaths.contentModule('create_video'), resourceKey: 'web.module.content.create_video', icon: <VideoCameraOutlined />, selectedIcon: <VideoCameraFilled /> },
    { key: routePaths.contentRoot, resourceKey: 'web.root.content', icon: <FolderOpenOutlined />, selectedIcon: <FolderFilled /> },
    { key: routePaths.contentModule('finished_assets'), resourceKey: 'web.module.content.finished_assets', icon: <FolderOpenOutlined />, selectedIcon: <FolderFilled /> },
  ];
  const mobileBottomNavItems: WorkspaceBottomNavItem[] = resourceBottomNavItems.flatMap((item) => {
    const name = routeResourceInfoMap.get(item.resourceKey)?.name;
    return name ? [{ ...item, label: name }] : [];
  });
  mobileBottomNavItems.push({ key: routePaths.accountInfo, label: t("我的"), icon: <UserOutlined /> });

  return (
    <WorkspaceShellLayout
      accountInfoPath={routePaths.accountInfo}
      accountLabel={t("通用设置")}
      accountPath={routePaths.account}
      appName={t("地瓜 AI")}
      appSubtitle={t("专业版")}
      brandLogoSrc={sidebarLogo}
      compactSidebar
      currentUser={currentUser}
      defaultPath={defaultPath}
      getWorkspaceLayoutState={(user, pathname, matches) => user
        ? getWorkspaceLayoutState(user, pathname, matches, routeResourceInfoMap)
        : {
          activeOpenKeys: [],
          currentMenuTitle: t("发现"),
          defaultOpenKeys: [],
          hideWorkspaceHeader: false,
          isChatPage: false,
          isContentStudioPage: false,
          isContentStudioVideoCreatePage: false,
          isImmersivePage: false,
          selectedMenuKey: pathname === routePaths.discover ? routePaths.discover : null,
        }}
      loginPath={routePaths.login}
      modelManagementPath={routePaths.models}
      mobileBottomNavItems={currentUser ? mobileBottomNavItems : []}
      onLogout={onLogout}
      showGlobalActions
      sidebarMenuItems={buildSidebarMenuItems(currentUser, routeResourceInfoMap)}
    />
  );
}
