import { randomBytes } from 'node:crypto';
import { db } from '../../db/database.js';
import { defaultAppRoleKey, defaultOnboardingRoleKey } from './permission-catalog.js';
import { resolveRoleGrantResourceIds } from '../route-resources/route-resource.service.js';
import { listAllProtectedPermissionCodes } from '../../shared/resource-permission.js';
import { roleRepository } from './role.repository.js';
import type { CreateAppRoleInput, UpdateAppRoleInput } from './role.types.js';
import type { User } from '../users/user.types.js';

function normalizeRoleName(value: unknown) {
  return String(value || '').trim();
}

function normalizeDescription(value: unknown) {
  return String(value || '').trim();
}

function assertRoleName(name: string) {
  if (name.length < 2) {
    throw new Error('角色名称至少 2 位');
  }
}

function slugifyRoleKey(name: string) {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = ascii || `custom-role-${randomBytes(4).toString('hex')}`;
  let candidate = base;
  let suffix = 2;
  while (roleRepository.findByKey(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function resolveUserPermissions(user: Pick<User, 'role' | 'roleIds'>) {
  if (user.role === 'admin') {
    return listAllProtectedPermissionCodes();
  }

  if (!user.roleIds?.length) {
    return [] as string[];
  }

  return roleRepository.listPermissionCodesByRoleIds(user.roleIds);
}

export function ensureRoleAssignable(roleId: string | null) {
  if (roleId === null) {
    return null;
  }

  const role = roleRepository.findById(roleId);
  if (!role) {
    throw new Error('角色不存在');
  }
  return role;
}

export function listAppRoles() {
  return roleRepository.list();
}

export function getDefaultRole() {
  return roleRepository.findDefaultRole();
}

export function getRegistrationRole() {
  const defaultRole = roleRepository.findDefaultRole();
  if (defaultRole) {
    return defaultRole;
  }

  const onboardingRole = roleRepository.findByKey(defaultOnboardingRoleKey);
  if (onboardingRole) {
    return onboardingRole;
  }

  return defaultRole;
}

export function createAppRole(input: CreateAppRoleInput) {
  const name = normalizeRoleName(input.name);
  const description = normalizeDescription(input.description);
  const resourceIds = resolveRoleGrantResourceIds(input);
  const isDefault = Boolean(input.isDefault);

  assertRoleName(name);

  const roleId = db.transaction(() => {
    const nextRoleId = roleRepository.create({
      key: slugifyRoleKey(name),
      name,
      description,
    });
    roleRepository.replaceResourceGrants(nextRoleId, resourceIds);
    if (isDefault) {
      roleRepository.setDefaultRole(nextRoleId);
    }
    return nextRoleId;
  })();
  return roleRepository.findById(roleId);
}

export function updateAppRole(roleId: string, input: UpdateAppRoleInput) {
  const current = roleRepository.findById(roleId);
  if (!current) {
    throw new Error('角色不存在');
  }

  const name = normalizeRoleName(input.name);
  const description = normalizeDescription(input.description);
  const resourceIds = resolveRoleGrantResourceIds(input);
  const isDefault = Boolean(input.isDefault);

  assertRoleName(name);

  db.transaction(() => {
    roleRepository.update({
      id: roleId,
      name,
      description,
    });
    roleRepository.replaceResourceGrants(roleId, resourceIds);
    if (isDefault) {
      roleRepository.setDefaultRole(roleId);
      return;
    }
    if (current.isDefault) {
      roleRepository.setDefaultRole(null);
    }
  })();
  return roleRepository.findById(roleId);
}

export function deleteAppRole(roleId: string) {
  const current = roleRepository.findById(roleId);
  if (!current) {
    throw new Error('角色不存在');
  }
  if (current.isSystem || current.isDefault || current.key === defaultAppRoleKey) {
    throw new Error('系统内置角色不支持删除');
  }
  if (current.assignedUserCount > 0) {
    throw new Error('已有账号使用该角色，无法删除');
  }
  roleRepository.delete(roleId);
}
