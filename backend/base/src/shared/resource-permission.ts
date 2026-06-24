import type { ContentModuleCode, ContentResourceType } from '../modules/content/content.types.js';
import { routeResourceRepository } from '../modules/route-resources/route-resource.repository.js';
import type { RouteResource } from '../modules/route-resources/route-resource.types.js';
import {
  allowedContentResourceTypes as allowedCatalogContentResourceTypes,
  permissionForContentModule as catalogPermissionForContentModule,
  permissionForContentResourceType as catalogPermissionForContentResourceType,
} from '../modules/roles/permission-catalog.js';

type ResourcePermissionSnapshot = {
  byPermissionCode: Map<string, RouteResource>;
  byResourceKey: Map<string, RouteResource>;
  protectedPermissionCodes: string[];
};

let cachedSnapshot: ResourcePermissionSnapshot | null = null;

function buildSnapshot(): ResourcePermissionSnapshot {
  const resources = routeResourceRepository.list({ includeDisabled: false });
  return {
    byPermissionCode: new Map(resources.map((resource) => [resource.permissionCode, resource])),
    byResourceKey: new Map(resources.map((resource) => [resource.resourceKey, resource])),
    protectedPermissionCodes: resources.map((resource) => resource.permissionCode),
  };
}

function getSnapshot() {
  if (!cachedSnapshot) {
    cachedSnapshot = buildSnapshot();
  }
  return cachedSnapshot;
}

export function invalidateResourcePermissionCache() {
  cachedSnapshot = null;
}

export function listAllProtectedPermissionCodes() {
  return [...getSnapshot().protectedPermissionCodes];
}

export function findResourceByPermissionCode(permissionCode: string) {
  return getSnapshot().byPermissionCode.get(permissionCode) || null;
}

export function findResourceByResourceKey(resourceKey: string) {
  return getSnapshot().byResourceKey.get(resourceKey) || null;
}

export function isKnownPermissionCode(permissionCode: string) {
  return Boolean(findResourceByPermissionCode(permissionCode));
}

export function isKnownResourceKey(resourceKey: string) {
  return Boolean(findResourceByResourceKey(resourceKey));
}

export function permissionForContentModule(moduleCode: ContentModuleCode) {
  return catalogPermissionForContentModule(moduleCode);
}

export function permissionForContentResourceType(resourceType: ContentResourceType) {
  return catalogPermissionForContentResourceType(resourceType);
}

export function allowedContentResourceTypes(permissionCodes: readonly string[]) {
  return allowedCatalogContentResourceTypes(permissionCodes);
}
