export type RouteResourceType = 'directory' | 'menu';

export type RouteResourcePlatform = 'web' | 'admin';

export type RouteResource = {
  id: string;
  parentId: string | null;
  name: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  path: string;
  permissionCode: string;
  status: boolean;
  sortOrder: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RouteResourceTreeNode = RouteResource & {
  children: RouteResourceTreeNode[];
};

export type RouteResourceRoleGrant = {
  resourceId: string;
  name: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  permissionCode: string;
};

export type RouteResourceInput = {
  parentId?: string | null;
  name: string;
  resourceKey: string;
  resourceType: RouteResourceType;
  platform: RouteResourcePlatform;
  path?: string;
  permissionCode: string;
  status?: boolean;
  sortOrder?: number;
  isSystem?: boolean;
};

export type RouteResourceUpdateInput = Partial<RouteResourceInput>;
