import { WorkspaceShellLayout, useWorkspaceHeader } from '@shared/layouts/WorkspaceShellLayout';
import sidebarLogo from '@shared/assets/sidebar-logo.png';
import { useRouteResourceInfoMap } from '@shared/hooks/useRouteResourceNames';
import { routePaths } from '../routes/paths';
import { buildSidebarMenuItems, getDefaultAppPath, getWorkspaceLayoutState } from '../routes/routeConfig';
import type { User } from '../types';
import './ProtectedLayout.scss';

type ProtectedLayoutProps = {
  currentUser: User;
  onLogout: () => void;
};

export { useWorkspaceHeader };

export function ProtectedLayout({ currentUser, onLogout }: ProtectedLayoutProps) {
  const defaultPath = getDefaultAppPath(currentUser);
  const routeResourceInfoMap = useRouteResourceInfoMap('web');

  return (
    <WorkspaceShellLayout
      accountPath={routePaths.account}
      appName="萌猫"
      brandLogoSrc={sidebarLogo}
      currentUser={currentUser}
      defaultPath={defaultPath}
      getWorkspaceLayoutState={(user, pathname, matches) => getWorkspaceLayoutState(user, pathname, matches, routeResourceInfoMap)}
      loginPath={routePaths.login}
      onLogout={onLogout}
      sidebarMenuItems={buildSidebarMenuItems(currentUser, routeResourceInfoMap)}
    />
  );
}
