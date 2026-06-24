import { useEffect, useMemo, useState } from 'react';
import { getPublicRouteResourceTree } from '../api/route-resource';
import type { ManagedRouteResource, RouteResourcePlatform } from '../types';

export type RouteResourceDisplayInfo = {
  name: string;
  parentId: string | null;
  resourceKey: string;
  sortOrder: number;
};

function flattenResources(resources: ManagedRouteResource[]): ManagedRouteResource[] {
  return resources.flatMap((resource) => [resource, ...flattenResources(resource.children || [])]);
}

function normalizeRouteResources(raw: unknown): ManagedRouteResource[] {
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

  return source as ManagedRouteResource[];
}

export function useRouteResourceInfoMap(platform: RouteResourcePlatform) {
  const [resources, setResources] = useState<ManagedRouteResource[]>([]);

  useEffect(() => {
    let cancelled = false;

    getPublicRouteResourceTree({ platform })
      .then((response) => {
        if (!cancelled) {
          setResources(normalizeRouteResources(response));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResources([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [platform]);

  return useMemo(() => {
    return new Map(
      flattenResources(resources)
        .filter((resource) => resource.resourceKey && resource.name)
        .map((resource) => [resource.resourceKey, {
          name: resource.name,
          parentId: resource.parentId || null,
          resourceKey: resource.resourceKey,
          sortOrder: Number(resource.sortOrder || 0),
        }] as const),
    );
  }, [resources]);
}
