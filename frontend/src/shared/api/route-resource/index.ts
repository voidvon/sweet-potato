import type {
  ManagedRouteResource,
  RouteResourceMutationPayload,
  RouteResourcePlatform,
} from '../../types';
import { request } from '../core/request';

type RouteResourceQuery = {
  includeDisabled?: boolean;
  keyword?: string;
  platform?: RouteResourcePlatform;
  tree?: boolean;
};

type RouteResourceResponse =
  | ManagedRouteResource[]
  | {
    items?: ManagedRouteResource[];
    list?: ManagedRouteResource[];
    tree?: ManagedRouteResource[];
    data?: ManagedRouteResource[];
  };

enum Api {
  routeResources = '/api/route-resources',
  routeResourcePublicTree = '/api/route-resources/public-tree',
  routeResourceTree = '/api/route-resources/tree',
}

function buildQueryString(query: RouteResourceQuery = {}) {
  const search = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    search.set(key, String(value));
  });

  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

export function listRouteResources(query?: RouteResourceQuery) {
  return request<RouteResourceResponse>(`${Api.routeResources}${buildQueryString(query)}`);
}

export function getRouteResourceTree(query?: Omit<RouteResourceQuery, 'tree'>) {
  return request<RouteResourceResponse>(`${Api.routeResourceTree}${buildQueryString(query)}`);
}

export function getPublicRouteResourceTree(query?: Omit<RouteResourceQuery, 'tree'>) {
  return request<RouteResourceResponse>(`${Api.routeResourcePublicTree}${buildQueryString(query)}`);
}

export function createRouteResource(payload: RouteResourceMutationPayload) {
  return request<{ resource?: ManagedRouteResource; routeResource?: ManagedRouteResource }>(Api.routeResources, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateRouteResource(id: string, payload: RouteResourceMutationPayload) {
  return request<{ resource?: ManagedRouteResource; routeResource?: ManagedRouteResource }>(`${Api.routeResources}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteRouteResource(id: string) {
  return request<{ ok: boolean }>(`${Api.routeResources}/${id}`, {
    method: 'DELETE',
  });
}
