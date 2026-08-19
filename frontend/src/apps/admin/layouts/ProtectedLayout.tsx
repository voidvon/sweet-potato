import { WorkspaceShellLayout, useWorkspaceHeader } from '@shared/layouts/WorkspaceShellLayout';
import sidebarLogo from '@shared/assets/sidebar-logo.png';
import { useRouteResourceInfoMap } from '@shared/hooks/useRouteResourceNames';
import { routePaths } from '../routes/paths';
import { buildSidebarMenuItems, getDefaultAppPath, getWorkspaceLayoutState } from '../routes/routeConfig';
import type { User } from '../types';

type AdminProtectedLayoutProps = {
  currentUser: User;
  onLogout: () => void;
};

export { useWorkspaceHeader };

export function AdminProtectedLayout({ currentUser, onLogout }: AdminProtectedLayoutProps) {
  const routeResourceInfoMap = useRouteResourceInfoMap('admin');

  return (
    <WorkspaceShellLayout
      accountPath={routePaths.account}
      appName="萌猫 AI"
      appSubtitle="后台管理"
      brandLogoSrc={sidebarLogo}
      currentUser={currentUser}
      defaultPath={getDefaultAppPath(currentUser)}
      getWorkspaceLayoutState={(user, pathname, matches) => getWorkspaceLayoutState(user || currentUser, pathname, matches, routeResourceInfoMap)}
      loginPath={routePaths.login}
      onLogout={onLogout}
      sidebarMenuItems={buildSidebarMenuItems(currentUser, routeResourceInfoMap)}
    />
  );
}
