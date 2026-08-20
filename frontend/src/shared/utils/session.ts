import type { AuthSession, User } from '../types';

const USER_KEY = 'sweet_potato_user';
const TOKEN_KEY = 'sweet_potato_token';

function normalizeBasename(value: string | undefined) {
  return (value || '').replace(/\/+$/, '');
}

function readStorageValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Authentication state is refreshed from the HttpOnly session cookie.
  }
}

function removeStorageValue(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
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
  const raw = readStorageValue(USER_KEY);
  if (!raw) {
    return null;
  }
  try {
    return normalizeUser(JSON.parse(raw) as User);
  } catch {
    removeStoredUser();
    return null;
  }
}

export function storeSession(session: AuthSession) {
  writeStorageValue(USER_KEY, JSON.stringify(normalizeUser(session.user)));
  removeStorageValue(TOKEN_KEY);
}

export function storeUser(user: User) {
  writeStorageValue(USER_KEY, JSON.stringify(normalizeUser(user)));
}

export function removeStoredUser() {
  removeStorageValue(USER_KEY);
  removeStorageValue(TOKEN_KEY);
}

export function getStoredToken() {
  return readStorageValue(TOKEN_KEY) || '';
}

export function clearLegacyToken() {
  removeStorageValue(TOKEN_KEY);
}

export function withAuthToken(url: string) {
  return url;
}

export function getLoginRoute() {
  const routerBasename = resolveRouterBasename();
  return routerBasename ? `${routerBasename}/login` : '/login';
}
