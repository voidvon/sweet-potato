import type { User } from '@shared/types';
import { routePaths } from './paths';
import { workspacePageDefinitions, type WorkspacePageDefinition } from './workspacePageDefinitions';

const routePermissionCodes: Record<string, string> = {
  'admin.system.route_resources': 'admin.route.system.route_resources.view',
  'admin.users.roles': 'admin.route.users.roles.view',
  'admin.users.accounts': 'admin.route.users.accounts.view',
  'admin.all_works': 'admin.route.all_works.view',
  'admin.discover': 'admin.route.discover.view',
  'admin.system.billing': 'admin.route.system.billing.view',
  'admin.system.models': 'admin.route.system.models.view',
  'admin.system.plugins': 'admin.route.system.plugins.view',
  'admin.system.file_management': 'admin.route.system.file_management.view',
  'admin.system.temporary_assets': 'admin.route.system.temporary_assets.view',
  'admin.system.settings': 'admin.route.system.settings.view',
  'admin.system.access_logs': 'admin.route.system.access_logs.view',
  'admin.system.about': 'admin.route.system.about.view',
};

function hasRouteGrant(currentUser: User, route: WorkspacePageDefinition) {
  if (currentUser.role === 'admin' || !route.routeResourceKey) return true;
  const grants = new Set([
    ...(currentUser.permissions || []),
    ...(currentUser.permissionCodes || []),
    ...(currentUser.resourceKeys || []),
    ...(currentUser.resourceIds || []),
    ...(currentUser.assignedRoles || []).flatMap((role) => [
      ...(role.permissions || []),
      ...(role.permissionCodes || []),
      ...(role.resourceKeys || []),
      ...(role.resourceIds || []),
    ]),
  ]);
  const permissionCode = routePermissionCodes[route.routeResourceKey];
  return grants.has(route.routeResourceKey) || Boolean(permissionCode && grants.has(permissionCode));
}

export function isVisibleWorkspacePage(route: WorkspacePageDefinition, currentUser: User) {
  return hasRouteGrant(currentUser, route)
    && (currentUser.role !== 'admin' || !route.visible || route.visible(currentUser));
}

export function getVisibleWorkspacePages(currentUser: User) {
  return workspacePageDefinitions.filter((route) => isVisibleWorkspacePage(route, currentUser));
}

export function getDefaultAppPath(currentUser: User) {
  return getVisibleWorkspacePages(currentUser).find((route) => route.key !== 'account')?.fullPath || routePaths.account;
}
