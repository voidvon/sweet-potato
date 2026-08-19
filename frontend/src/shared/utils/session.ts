import type { AuthSession, User } from '../types';

const USER_KEY = 'ai_marketing_user';
const TOKEN_KEY = 'ai_marketing_token';

function normalizeBasename(value: string | undefined) {
  return (value || '').replace(/\/+$/, '');
}

function resolveRouterBasename() {
  const configuredBasename = normalizeBasename(import.meta.env.VITE_ROUTER_BASENAME);
  if (configuredBasename) {
    return configuredBasename;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const { pathname } = window.location;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return '/admin';
  }

  return '';
}

function normalizePermissions(value: User['permissions']) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)));
}

function normalizeStringList(value: string[] | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)));
}

function normalizeAssignedRoles(value: User['assignedRoles']) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((role) => ({
    ...role,
    permissions: normalizePermissions(role.permissions),
    permissionCodes: normalizeStringList(role.permissionCodes),
    resourceIds: normalizeStringList(role.resourceIds),
    resourceKeys: normalizeStringList(role.resourceKeys),
  }));
}

function normalizeUser(user: User): User {
  const assignedRoles = normalizeAssignedRoles(user.assignedRoles);
  const permissionCodes = normalizeStringList(user.permissionCodes);
  const resourceIds = normalizeStringList(user.resourceIds);
  const resourceKeys = normalizeStringList(user.resourceKeys);
  const rolePermissionCodes = assignedRoles.flatMap((role) => role.permissionCodes || []);
  const roleResourceIds = assignedRoles.flatMap((role) => role.resourceIds || []);
  const roleResourceKeys = assignedRoles.flatMap((role) => role.resourceKeys || []);

  return {
    ...user,
    role: user.role || 'user',
    permissions: normalizePermissions(user.permissions),
    permissionCodes: permissionCodes.length ? permissionCodes : normalizeStringList(rolePermissionCodes),
    resourceIds: resourceIds.length ? resourceIds : normalizeStringList(roleResourceIds),
    resourceKeys: resourceKeys.length ? resourceKeys : normalizeStringList(roleResourceKeys),
    roleIds: normalizeStringList(user.roleIds),
    assignedRoles,
  };
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  const user = JSON.parse(raw) as User;
  return normalizeUser(user);
}

export function storeSession(session: AuthSession) {
  localStorage.setItem(USER_KEY, JSON.stringify(normalizeUser(session.user)));
  localStorage.setItem(TOKEN_KEY, session.token);
}

export function storeUser(user: User) {
  localStorage.setItem(USER_KEY, JSON.stringify(normalizeUser(user)));
}

export function removeStoredUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function withAuthToken(url: string) {
  const token = getStoredToken();
  if (!token) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

export function getLoginRoute() {
  const routerBasename = resolveRouterBasename();
  return routerBasename ? `${routerBasename}/login` : '/login';
}
