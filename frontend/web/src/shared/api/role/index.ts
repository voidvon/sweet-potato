import type {
  ManagedRole,
  RoleCreatePayload,
  RoleUpdatePayload,
} from '../../types';
import { request } from '../core/request';

enum Api {
  roles = '/api/roles',
}

export function listRoles() {
  return request<ManagedRole[]>(Api.roles);
}

export function createRole(payload: RoleCreatePayload) {
  return request<{ role: ManagedRole }>(Api.roles, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateRole(id: string, payload: RoleUpdatePayload) {
  return request<{ role: ManagedRole }>(`${Api.roles}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteRole(id: string) {
  return request<{ ok: boolean }>(`${Api.roles}/${id}`, {
    method: 'DELETE',
  });
}
