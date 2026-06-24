import { WorkspaceShellLayout, useWorkspaceHeader } from '@shared/layouts/WorkspaceShellLayout';
import sidebarLogo from '@shared/assets/sidebar-logo.png';
import { routePaths } from '../routes/paths';
import { buildSidebarMenuItems, getWorkspaceLayoutState } from '../routes/routeConfig';
import type { User } from '../types';

type AdminProtectedLayoutProps = {
  currentUser: User;
  onLogout: () => void;
};

export { useWorkspaceHeader };

export function AdminProtectedLayout({ currentUser, onLogout }: AdminProtectedLayoutProps) {
  return (
    <WorkspaceShellLayout
      accountPath={routePaths.account}
      appName="萌猫"
      appSubtitle="后台管理"
      brandLogoSrc={sidebarLogo}
      currentUser={currentUser}
      defaultPath={routePaths.defaultLanding}
      getWorkspaceLayoutState={getWorkspaceLayoutState}
      loginPath={routePaths.login}
      onLogout={onLogout}
      sidebarMenuItems={buildSidebarMenuItems(currentUser)}
    />
  );
}
