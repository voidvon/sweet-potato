import { db } from '../../db/database.js';
import { invalidateResourcePermissionCache } from '../../shared/resource-permission.js';
import { routeResourceRepository } from './route-resource.repository.js';
import type {
  RouteResource,
  RouteResourceInput,
  RouteResourceTreeNode,
  RouteResourceUpdateInput,
} from './route-resource.types.js';

function normalizeString(value: unknown) {
  return String(value || '').trim();
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  return Boolean(value);
}

function normalizeNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

type NormalizedRouteResourceInput = {
  parentId: string | null;
  name: string;
  resourceKey: string;
  resourceType: RouteResource['resourceType'];
  platform: RouteResource['platform'];
  path: string;
  permissionCode: string;
  status: boolean;
  sortOrder: number;
  isSystem: boolean;
};

function assertRequired(value: string, label: string) {
  if (!value) {
    throw new Error(`${label}不能为空`);
  }
}

function assertParentValid(parentId: string | null | undefined, currentId?: string) {
  if (!parentId) {
    return;
  }
  if (currentId && parentId === currentId) {
    throw new Error('父级资源不能是自己');
  }
  const parent = routeResourceRepository.findById(parentId);
  if (!parent) {
    throw new Error('父级资源不存在');
  }
}

function assertSiblingPlatform(parentId: string | null | undefined, platform: RouteResource['platform']) {
  if (!parentId) {
    return;
  }
  const parent = routeResourceRepository.findById(parentId);
  if (!parent) {
    return;
  }
  if (parent.platform !== platform) {
    throw new Error('父子资源必须属于同一平台');
  }
}

function normalizeInput(input: RouteResourceInput | RouteResourceUpdateInput, current?: RouteResource): NormalizedRouteResourceInput {
  const resourceType = (input.resourceType || current?.resourceType || 'menu') as RouteResource['resourceType'];
  const platform = (input.platform || current?.platform || 'web') as RouteResource['platform'];
  if (resourceType !== 'directory' && resourceType !== 'menu') {
    throw new Error('资源类型仅支持目录或菜单');
  }
  if (platform !== 'web' && platform !== 'admin') {
    throw new Error('所属平台仅支持 Web 或 Admin');
  }
  return {
    parentId: input.parentId === undefined ? current?.parentId || null : (input.parentId || null),
    name: normalizeString(input.name ?? current?.name),
    resourceKey: normalizeString(input.resourceKey ?? current?.resourceKey),
    resourceType,
    platform,
    path: normalizeString(input.path ?? current?.path),
    permissionCode: normalizeString(input.permissionCode ?? current?.permissionCode),
    status: normalizeBoolean(input.status, current?.status ?? true),
    sortOrder: normalizeNumber(input.sortOrder, current?.sortOrder ?? 0),
    isSystem: normalizeBoolean(input.isSystem, current?.isSystem ?? false),
  };
}

function assertUniqueFields(input: RouteResourceInput, currentId?: string) {
  const sameKey = routeResourceRepository.findByResourceKey(input.resourceKey);
  if (sameKey && sameKey.id !== currentId) {
    throw new Error('resourceKey 已存在');
  }
  const sameCode = routeResourceRepository.findByPermissionCode(input.permissionCode);
  if (sameCode && sameCode.id !== currentId) {
    throw new Error('permissionCode 已存在');
  }
}

function assertSystemMutationAllowed(current: RouteResource, next: RouteResourceInput) {
  if (!current.isSystem) {
    return;
  }
  if (current.resourceKey !== next.resourceKey || current.permissionCode !== next.permissionCode || current.platform !== next.platform || current.resourceType !== next.resourceType) {
    throw new Error('系统资源不允许修改关键标识');
  }
}

export function listRouteResources(filters?: {
  includeDisabled?: boolean;
  platform?: RouteResource['platform'];
}) {
  return routeResourceRepository.list(filters);
}

export function listRouteResourceTree(filters?: {
  includeDisabled?: boolean;
  platform?: RouteResource['platform'];
}) {
  return routeResourceRepository.listTree(filters);
}

export function getRouteResource(id: string) {
  return routeResourceRepository.findById(id);
}

export function createRouteResource(input: RouteResourceInput) {
  const normalized = normalizeInput(input);
  assertRequired(normalized.name, '资源名称');
  assertRequired(normalized.resourceKey, 'resourceKey');
  assertRequired(normalized.permissionCode, 'permissionCode');
  assertParentValid(normalized.parentId);
  assertSiblingPlatform(normalized.parentId, normalized.platform);
  assertUniqueFields(normalized);
  const created = routeResourceRepository.create(normalized);
  invalidateResourcePermissionCache();
  return created;
}

export function updateRouteResource(id: string, input: RouteResourceUpdateInput) {
  const current = routeResourceRepository.findById(id);
  if (!current) {
    throw new Error('资源不存在');
  }
  const normalized = normalizeInput(input, current);
  assertRequired(normalized.name, '资源名称');
  assertRequired(normalized.resourceKey, 'resourceKey');
  assertRequired(normalized.permissionCode, 'permissionCode');
  assertParentValid(normalized.parentId, id);
  assertSiblingPlatform(normalized.parentId, normalized.platform);
  assertUniqueFields(normalized, id);
  assertSystemMutationAllowed(current, normalized);
  const updated = routeResourceRepository.update(id, normalized);
  invalidateResourcePermissionCache();
  return updated;
}

export function deleteRouteResource(id: string) {
  const current = routeResourceRepository.findById(id);
  if (!current) {
    throw new Error('资源不存在');
  }
  if (current.isSystem) {
    throw new Error('系统资源不支持删除');
  }
  if (routeResourceRepository.countChildren(id) > 0) {
    throw new Error('请先删除子资源');
  }
  routeResourceRepository.delete(id);
  invalidateResourcePermissionCache();
}

export function listRoleAssignableResourceTree(filters?: {
  includeDisabled?: boolean;
  platform?: RouteResource['platform'];
}) {
  const tree = listRouteResourceTree(filters);
  const filterNodes = (nodes: RouteResourceTreeNode[]): RouteResourceTreeNode[] => nodes
    .map((node) => ({
      ...node,
      children: filterNodes(node.children),
    }))
    .filter((node) => node.status || node.children.length > 0);
  return filterNodes(tree);
}

export function resolveRoleGrantResourceIds(input: {
  resourceIds?: unknown;
}) {
  const resourceIds = Array.isArray(input.resourceIds)
    ? input.resourceIds.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
    : [];
  const resolvedIds = new Set<string>();
  resourceIds.forEach((resourceId) => {
    const resolvedId = routeResourceRepository.resolveEnabledResourceId(resourceId);
    if (resolvedId) {
      resolvedIds.add(resolvedId);
    }
  });
  return Array.from(resolvedIds);
}

export function seedRoleResourceGrants(roleId: string, resourceIds: string[]) {
  db.transaction(() => {
    routeResourceRepository.replaceRoleGrants(roleId, resourceIds);
  })();
  invalidateResourcePermissionCache();
}
