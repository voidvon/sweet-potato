import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import { routeResourceRepository } from '../route-resources/route-resource.repository.js';
import type { AppRole, AssignedRoleSummary } from './role.types.js';

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: number;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function serializeRoleSummary(row: RoleRow): AssignedRoleSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description || undefined,
    isSystem: Boolean(row.is_system),
    isDefault: Boolean(row.is_default),
  };
}

function listGrantsByRoleIds(roleIds: string[]) {
  if (!roleIds.length) {
    return new Map<string, ReturnType<typeof routeResourceRepository.listRoleGrants>>();
  }
  return new Map(roleIds.map((roleId) => [roleId, routeResourceRepository.listRoleGrants(roleId)]));
}

function listAssignedCountsByRoleIds(roleIds: string[]) {
  if (!roleIds.length) {
    return new Map<string, number>();
  }

  const placeholders = roleIds.map((_, index) => `@roleId${index}`).join(', ');
  const params = Object.fromEntries(roleIds.map((roleId, index) => [`roleId${index}`, roleId]));
  const rows = db.prepare(`
    SELECT role_id, COUNT(DISTINCT user_id) as count
    FROM (
      SELECT role_id, id as user_id
      FROM users
      WHERE role_id IN (${placeholders})
      UNION ALL
      SELECT role_id, user_id
      FROM user_role_assignments
      WHERE role_id IN (${placeholders})
    )
    GROUP BY role_id
  `).all(params) as Array<{ role_id: string; count: number }>;

  return new Map(rows.map((row) => [row.role_id, Number(row.count || 0)]));
}

function serializeRole(
  row: RoleRow,
  grants: ReturnType<typeof routeResourceRepository.listRoleGrants>,
  assignedUserCount: number,
): AppRole {
  return {
    ...serializeRoleSummary(row),
    grantedResourceIds: grants.map((grant) => grant.resourceKey),
    grantedResources: grants.map((grant) => ({
      id: grant.resourceKey,
      name: grant.name,
      resourceKey: grant.resourceKey,
      resourceType: grant.resourceType,
      platform: grant.platform,
      permissionCode: grant.permissionCode,
    })),
    assignedUserCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const roleRepository = {
  create(input: {
    key: string;
    name: string;
    description?: string;
    isSystem?: boolean;
    isDefault?: boolean;
  }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO roles (id, key, name, description, is_system, is_default, created_at, updated_at)
      VALUES (@id, @key, @name, @description, @isSystem, @isDefault, @createdAt, @updatedAt)
    `).run({
      id,
      key: input.key,
      name: input.name,
      description: input.description?.trim() || '',
      isSystem: input.isSystem ? 1 : 0,
      isDefault: input.isDefault ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },

  update(input: {
    id: string;
    name: string;
    description?: string;
  }) {
    db.prepare(`
      UPDATE roles
      SET name = @name,
          description = @description,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: input.id,
      name: input.name,
      description: input.description?.trim() || '',
      updatedAt: new Date().toISOString(),
    });
  },

  setDefaultRole(roleId: string | null) {
    const transaction = db.transaction((nextRoleId: string | null) => {
      db.prepare('UPDATE roles SET is_default = 0 WHERE is_default != 0').run();
      if (nextRoleId) {
        db.prepare(`
          UPDATE roles
          SET is_default = 1,
              updated_at = @updatedAt
          WHERE id = @id
        `).run({
          id: nextRoleId,
          updatedAt: new Date().toISOString(),
        });
      }
    });
    transaction(roleId);
  },

  replaceResourceGrants(roleId: string, resourceIds: string[]) {
    routeResourceRepository.replaceRoleGrants(roleId, resourceIds);
  },

  findById(id: string) {
    const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined;
    if (!row) {
      return null;
    }
    const grants = routeResourceRepository.listRoleGrants(id);
    const assignedUserCount = this.countAssignedUsers(id);
    return serializeRole(row, grants, assignedUserCount);
  },

  findByKey(key: string) {
    const row = db.prepare('SELECT * FROM roles WHERE key = ?').get(key) as RoleRow | undefined;
    if (!row) {
      return null;
    }
    const grants = routeResourceRepository.listRoleGrants(row.id);
    const assignedUserCount = this.countAssignedUsers(row.id);
    return serializeRole(row, grants, assignedUserCount);
  },

  list() {
    const rows = db.prepare(`
      SELECT *
      FROM roles
      ORDER BY is_system DESC, created_at ASC
    `).all() as RoleRow[];
    const roleIds = rows.map((row) => row.id);
    const grantsByRoleId = listGrantsByRoleIds(roleIds);
    const assignedCountsByRoleId = listAssignedCountsByRoleIds(roleIds);
    return rows.map((row) => serializeRole(
      row,
      grantsByRoleId.get(row.id) || [],
      assignedCountsByRoleId.get(row.id) || 0,
    ));
  },

  listPermissionCodes(roleId: string) {
    return routeResourceRepository.listRolePermissionCodes(roleId);
  },

  listResourceIds(roleId: string) {
    return routeResourceRepository.listRoleResourceIds(roleId);
  },

  listResourceKeys(roleId: string) {
    return routeResourceRepository.listRoleResourceKeys(roleId);
  },

  listPermissionCodesByRoleIds(roleIds: string[]) {
    const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)));
    return Array.from(new Set(uniqueRoleIds.flatMap((roleId) => this.listPermissionCodes(roleId))));
  },

  countAssignedUsers(roleId: string) {
    const result = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM (
        SELECT id as user_id FROM users WHERE role_id = ?
        UNION ALL
        SELECT user_id FROM user_role_assignments WHERE role_id = ?
      )
    `).get(roleId, roleId) as { count: number } | undefined;
    return Number(result?.count || 0);
  },

  findAssignedRoleSummary(roleId: string | null | undefined) {
    if (!roleId) {
      return null;
    }
    const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as RoleRow | undefined;
    return row ? serializeRoleSummary(row) : null;
  },

  findDefaultRole() {
    const row = db.prepare(`
      SELECT *
      FROM roles
      WHERE is_default = 1
      ORDER BY is_system DESC, created_at ASC
      LIMIT 1
    `).get() as RoleRow | undefined;
    if (!row) {
      return null;
    }
    const grants = routeResourceRepository.listRoleGrants(row.id);
    const assignedUserCount = this.countAssignedUsers(row.id);
    return serializeRole(row, grants, assignedUserCount);
  },

  delete(id: string) {
    const transaction = db.transaction((roleId: string) => {
      db.prepare('DELETE FROM role_resource_permissions WHERE role_id = ?').run(roleId);
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
      db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);
    });
    transaction(id);
  },
};
