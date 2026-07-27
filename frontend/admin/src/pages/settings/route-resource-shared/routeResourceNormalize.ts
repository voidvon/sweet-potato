import type { ManagedRouteResource, RouteResourceType } from '../../../types';

export type RouteResourceRecord = Omit<ManagedRouteResource, 'children'> & {
  depth: number;
  children?: RouteResourceRecord[];
};

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRouteResource(raw: unknown, depth = 0): RouteResourceRecord | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const id = normalizeText(record.id);
  if (!id) return null;

  const childrenSource = Array.isArray(record.children)
    ? record.children
    : Array.isArray(record.items)
      ? record.items
      : [];
  const children = childrenSource
    .map((child) => normalizeRouteResource(child, depth + 1))
    .filter((child): child is RouteResourceRecord => Boolean(child));

  return {
    depth,
    id,
    parentId: normalizeText(record.parentId ?? record.parent_id) || null,
    name: normalizeText(record.name),
    resourceKey: normalizeText(record.resourceKey ?? record.resource_key),
    resourceType: (normalizeText(record.resourceType ?? record.resource_type) || 'menu') as RouteResourceType,
    platform: normalizeText(record.platform) === 'admin' ? 'admin' : 'web',
    permissionCode: normalizeText(record.permissionCode ?? record.permission_code),
    visibilityMode: normalizeText(record.visibilityMode ?? record.visibility_mode) === 'always' ? 'always' : 'permission',
    path: normalizeText(record.path),
    status: normalizeBoolean(record.status, true),
    sortOrder: typeof record.sortOrder === 'number'
      ? record.sortOrder
      : typeof record.sort_order === 'number'
        ? record.sort_order
        : Number(record.sortOrder ?? record.sort_order ?? 0),
    isSystem: normalizeBoolean(record.isSystem ?? record.is_system),
    createdAt: normalizeText(record.createdAt ?? record.created_at),
    updatedAt: normalizeText(record.updatedAt ?? record.updated_at),
    children,
  };
}

export function normalizeRouteResourceList(raw: unknown): RouteResourceRecord[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? (
        (raw as { items?: unknown[] }).items
        || (raw as { list?: unknown[] }).list
        || (raw as { tree?: unknown[] }).tree
        || (raw as { data?: unknown[] }).data
        || []
      )
      : [];

  return source
    .map((item) => normalizeRouteResource(item))
    .filter((item): item is RouteResourceRecord => Boolean(item));
}

export function flattenRouteResources<T extends ManagedRouteResource>(records: T[]): T[] {
  return records.flatMap((record) => [
    record,
    ...flattenRouteResources((record.children || []) as T[]),
  ]);
}

export function filterRouteResourceTree(records: RouteResourceRecord[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();

  function matchRecord(record: RouteResourceRecord): RouteResourceRecord | null {
    const children = (record.children || [])
      .map((child) => matchRecord(child))
      .filter((child): child is RouteResourceRecord => Boolean(child));
    const haystack = [record.name, record.resourceKey, record.permissionCode, record.path || '']
      .join(' ')
      .toLowerCase();

    return !normalizedKeyword || haystack.includes(normalizedKeyword) || children.length > 0
      ? { ...record, children }
      : null;
  }

  return records
    .map((record) => matchRecord(record))
    .filter((record): record is RouteResourceRecord => Boolean(record));
}
