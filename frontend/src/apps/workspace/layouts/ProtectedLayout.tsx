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
  const mobileBottomNavItems: WorkspaceBottomNavItem[] = [
    { key: routePaths.defaultModule, label: t("生图"), icon: <PictureOutlined />, selectedIcon: <PictureFilled /> },
    { key: routePaths.contentModule('create_video'), label: t("视频"), icon: <VideoCameraOutlined />, selectedIcon: <VideoCameraFilled /> },
    { key: routePaths.contentRoot, label: t("素材"), icon: <FolderOpenOutlined />, selectedIcon: <FolderFilled /> },
    { key: routePaths.contentModule('finished_assets'), label: t("作品"), icon: <FolderOpenOutlined />, selectedIcon: <FolderFilled /> },
    { key: routePaths.accountInfo, label: t("我的"), icon: <UserOutlined /> },
  ];

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
