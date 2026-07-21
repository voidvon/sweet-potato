import { WorkspaceShellLayout, useWorkspaceHeader } from '@shared/layouts/WorkspaceShellLayout';
import type { WorkspaceBottomNavItem } from '@shared/layouts/WorkspaceShellLayout';
import sidebarLogo from '@shared/assets/sidebar-logo.png';
import {
  FolderFilled,
  FolderOpenOutlined,
  PictureFilled,
  PictureOutlined,
  ThunderboltFilled,
  ThunderboltOutlined,
  UserOutlined,
  VideoCameraFilled,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useRouteResourceInfoMap } from '@shared/hooks/useRouteResourceNames';
import { routePaths } from '../routes/paths';
import { buildSidebarMenuItems, getDefaultAppPath, getWorkspaceLayoutState } from '../routes/routeConfig';
import type { User } from '../types';

type ProtectedLayoutProps = {
  currentUser: User;
  onLogout: () => void;
};

export { useWorkspaceHeader };

export function ProtectedLayout({ currentUser, onLogout }: ProtectedLayoutProps) {
  const defaultPath = getDefaultAppPath(currentUser);
  const routeResourceInfoMap = useRouteResourceInfoMap('web');
  const mobileBottomNavItems: WorkspaceBottomNavItem[] = [
    { key: routePaths.defaultModule, label: '图片创作', icon: <PictureOutlined />, selectedIcon: <PictureFilled /> },
    { key: routePaths.contentModule('create_video'), label: '视频创作', icon: <VideoCameraOutlined />, selectedIcon: <VideoCameraFilled /> },
    { key: routePaths.contentModule('video_remake'), label: '爆款复刻', icon: <ThunderboltOutlined />, selectedIcon: <ThunderboltFilled /> },
    { key: routePaths.contentRoot, label: '素材', icon: <FolderOpenOutlined />, selectedIcon: <FolderFilled /> },
    { key: routePaths.contentModule('finished_assets'), label: '作品', icon: <FolderOpenOutlined />, selectedIcon: <FolderFilled /> },
    { key: routePaths.account, label: '我的', icon: <UserOutlined /> },
  ];

  return (
    <WorkspaceShellLayout
      accountPath={routePaths.account}
      appName="萌猫 AI"
      appSubtitle="专业版"
      brandLogoSrc={sidebarLogo}
      compactSidebar
      currentUser={currentUser}
      defaultPath={defaultPath}
      getWorkspaceLayoutState={(user, pathname, matches) => getWorkspaceLayoutState(user, pathname, matches, routeResourceInfoMap)}
      loginPath={routePaths.login}
      mobileBottomNavItems={mobileBottomNavItems}
      onLogout={onLogout}
      sidebarMenuItems={buildSidebarMenuItems(currentUser, routeResourceInfoMap)}
    />
  );
}
