import type { ManagedRole, RoleCreatePayload, RoleUpdatePayload } from '../../../types';

export type RoleFormValues = {
  name: string;
  description?: string;
  grantedResourceIds?: string[];
  isDefault?: boolean;
};

export type RoleEditorState = {
  mode: 'create' | 'edit';
  role: ManagedRole | null;
};

export function normalizeResourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)));
}

export function normalizeRole(raw: ManagedRole): ManagedRole {
  const grantedResources = Array.isArray(raw.grantedResources) ? raw.grantedResources : [];
  const grantedResourceIds = Array.isArray(raw.grantedResourceIds)
    ? raw.grantedResourceIds
    : grantedResources.map((resource) => resource.resourceKey);
  return { ...raw, grantedResources, grantedResourceIds };
}

export function resolveRoleSelection(role: ManagedRole) {
  if (role.grantedResourceIds?.length) return Array.from(new Set(role.grantedResourceIds));
  if (role.grantedResources?.length) {
    return Array.from(new Set(role.grantedResources.map((resource) => resource.resourceKey)));
  }
  return [];
}

export function buildRolePayload(values: RoleFormValues): RoleCreatePayload | RoleUpdatePayload {
  return {
    name: values.name.trim(),
    description: values.description?.trim() || '',
    resourceIds: normalizeResourceIds(values.grantedResourceIds),
    isDefault: Boolean(values.isDefault),
  };
}
