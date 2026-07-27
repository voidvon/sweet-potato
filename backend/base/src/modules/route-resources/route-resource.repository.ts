import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import type {
  RouteResource,
  RouteResourceInput,
  RouteResourceRoleGrant,
  RouteResourceTreeNode,
  RouteResourceUpdateInput,
} from './route-resource.types.js';

type RouteResourceRow = {
  id: string;
  parent_id: string | null;
  name: string;
  resource_key: string;
  resource_type: RouteResource['resourceType'];
  platform: RouteResource['platform'];
  path: string;
  permission_code: string;
  visibility_mode: RouteResource['visibilityMode'];
  status: number;
  sort_order: number;
  is_system: number;
  created_at: string;
  updated_at: string;
};

type RoleGrantRow = {
  resource_id: string;
  name: string;
  resource_key: string;
  resource_type: RouteResource['resourceType'];
  platform: RouteResource['platform'];
  permission_code: string;
};

function serializeRouteResource(row: RouteResourceRow): RouteResource {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    resourceKey: row.resource_key,
    resourceType: row.resource_type,
    platform: row.platform,
    path: row.path || '',
    permissionCode: row.permission_code,
    visibilityMode: row.visibility_mode || 'permission',
    status: Boolean(row.status),
    sortOrder: Number(row.sort_order || 0),
    isSystem: Boolean(row.is_system),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRoleGrant(row: RoleGrantRow): RouteResourceRoleGrant {
  return {
    resourceId: row.resource_id,
    name: row.name,
    resourceKey: row.resource_key,
    resourceType: row.resource_type,
    platform: row.platform,
    permissionCode: row.permission_code,
  };
}

function listWhere(filters?: {
  includeDisabled?: boolean;
  platform?: RouteResource['platform'];
}) {
  const whereParts: string[] = [];
  const params: Record<string, unknown> = {};
  if (!filters?.includeDisabled) {
    whereParts.push('status = 1');
  }
  if (filters?.platform) {
    whereParts.push('platform = @platform');
    params.platform = filters.platform;
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  return db.prepare(`
    SELECT *
    FROM route_resources
    ${whereClause}
    ORDER BY platform ASC, sort_order ASC, created_at ASC
  `).all(params) as RouteResourceRow[];
}

export const routeResourceRepository = {
  list(filters?: {
    includeDisabled?: boolean;
    platform?: RouteResource['platform'];
  }) {
    return listWhere(filters).map(serializeRouteResource);
  },

  listTree(filters?: {
    includeDisabled?: boolean;
    platform?: RouteResource['platform'];
  }) {
    const items = this.list(filters);
    const nodeMap = new Map<string, RouteResourceTreeNode>(
      items.map((item) => [item.id, { ...item, children: [] }]),
    );
    const roots: RouteResourceTreeNode[] = [];
    nodeMap.forEach((node) => {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)?.children.push(node);
        return;
      }
      roots.push(node);
    });
    const sortTree = (nodes: RouteResourceTreeNode[]) => {
      nodes.sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.createdAt.localeCompare(right.createdAt);
      });
      nodes.forEach((node) => sortTree(node.children));
    };
    sortTree(roots);
    return roots;
  },

  findById(id: string) {
    const row = db.prepare('SELECT * FROM route_resources WHERE id = ?').get(id) as RouteResourceRow | undefined;
    return row ? serializeRouteResource(row) : null;
  },

  findByPermissionCode(permissionCode: string) {
    const row = db.prepare('SELECT * FROM route_resources WHERE permission_code = ?').get(permissionCode) as RouteResourceRow | undefined;
    return row ? serializeRouteResource(row) : null;
  },

  findByResourceKey(resourceKey: string) {
    const row = db.prepare('SELECT * FROM route_resources WHERE resource_key = ?').get(resourceKey) as RouteResourceRow | undefined;
    return row ? serializeRouteResource(row) : null;
  },

  create(input: RouteResourceInput) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO route_resources (
        id, parent_id, name, resource_key, resource_type, platform, path, permission_code,
        visibility_mode, status, sort_order, is_system, created_at, updated_at
      )
      VALUES (
        @id, @parentId, @name, @resourceKey, @resourceType, @platform, @path, @permissionCode,
        @visibilityMode, @status, @sortOrder, @isSystem, @createdAt, @updatedAt
      )
    `).run({
      id,
      parentId: input.parentId || null,
      name: input.name,
      resourceKey: input.resourceKey,
      resourceType: input.resourceType,
      platform: input.platform,
      path: input.path || '',
      permissionCode: input.permissionCode,
      visibilityMode: input.visibilityMode || 'permission',
      status: input.status === false ? 0 : 1,
      sortOrder: Number(input.sortOrder || 0),
      isSystem: input.isSystem ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    return this.findById(id);
  },

  update(id: string, input: RouteResourceUpdateInput) {
    const current = this.findById(id);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      ...input,
      parentId: input.parentId === undefined ? current.parentId : (input.parentId || null),
      path: input.path === undefined ? current.path : input.path,
      visibilityMode: input.visibilityMode === undefined ? current.visibilityMode : input.visibilityMode,
      status: input.status === undefined ? current.status : input.status,
      sortOrder: input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
      isSystem: input.isSystem === undefined ? current.isSystem : input.isSystem,
    };
    db.prepare(`
      UPDATE route_resources
      SET parent_id = @parentId,
          name = @name,
          resource_key = @resourceKey,
          resource_type = @resourceType,
          platform = @platform,
          path = @path,
          permission_code = @permissionCode,
          visibility_mode = @visibilityMode,
          status = @status,
          sort_order = @sortOrder,
          is_system = @isSystem,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      parentId: next.parentId || null,
      name: next.name,
      resourceKey: next.resourceKey,
      resourceType: next.resourceType,
      platform: next.platform,
      path: next.path || '',
      permissionCode: next.permissionCode,
      visibilityMode: next.visibilityMode,
      status: next.status ? 1 : 0,
      sortOrder: Number(next.sortOrder || 0),
      isSystem: next.isSystem ? 1 : 0,
      updatedAt: new Date().toISOString(),
    });
    return this.findById(id);
  },

  delete(id: string) {
    const transaction = db.transaction((resourceId: string) => {
      db.prepare('DELETE FROM role_resource_permissions WHERE resource_id = ?').run(resourceId);
      db.prepare('DELETE FROM route_resources WHERE id = ?').run(resourceId);
    });
    transaction(id);
  },

  countChildren(id: string) {
    const row = db.prepare('SELECT COUNT(*) as count FROM route_resources WHERE parent_id = ?').get(id) as { count: number } | undefined;
    return Number(row?.count || 0);
  },

  countRoleAssignments(id: string) {
    const row = db.prepare('SELECT COUNT(*) as count FROM role_resource_permissions WHERE resource_id = ?').get(id) as { count: number } | undefined;
    return Number(row?.count || 0);
  },

  listRoleGrants(roleId: string) {
    const rows = db.prepare(`
      SELECT
        rr.id as resource_id,
        rr.name,
        rr.resource_key,
        rr.resource_type,
        rr.platform,
        rr.permission_code
      FROM role_resource_permissions rrp
      INNER JOIN route_resources rr
        ON rr.id = rrp.resource_id
      WHERE rrp.role_id = ?
      ORDER BY rr.sort_order ASC, rr.permission_code ASC
    `).all(roleId) as RoleGrantRow[];
    return rows.map(serializeRoleGrant);
  },

  listRoleResourceIds(roleId: string) {
    return this.listRoleGrants(roleId).map((item) => item.resourceId);
  },

  listRolePermissionCodes(roleId: string) {
    return this.listRoleGrants(roleId).map((item) => item.permissionCode);
  },

  listRoleResourceKeys(roleId: string) {
    return this.listRoleGrants(roleId).map((item) => item.resourceKey);
  },

  resolveEnabledResourceId(value: string) {
    const resource = this.findById(value) || this.findByResourceKey(value);
    if (!resource || !resource.status) {
      return null;
    }
    return resource.id;
  },

  replaceRoleGrants(roleId: string, resourceIds: string[]) {
    const now = new Date().toISOString();
    const transaction = db.transaction((nextResourceIds: string[]) => {
      db.prepare('DELETE FROM role_resource_permissions WHERE role_id = ?').run(roleId);
      const insertGrant = db.prepare(`
        INSERT INTO role_resource_permissions (role_id, resource_id, created_at)
        VALUES (@roleId, @resourceId, @createdAt)
      `);
      nextResourceIds.forEach((resourceId) => {
        insertGrant.run({
          roleId,
          resourceId,
          createdAt: now,
        });
      });
    });
    transaction(resourceIds);
  },
};
