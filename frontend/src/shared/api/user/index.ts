import type { AuthSession, ManagedUser, PasswordPayload, UserProfilePayload } from '../../types';
import { request } from '../core/request';

enum Api {
  users = '/api/users',
  currentUser = '/api/users/me',
  profile = '/api/users/:id/profile',
  password = '/api/users/:id/password',
  credits = '/api/users/:id/credits',
  blacklist = '/api/users/:id/blacklist',
}

export function getCurrentUser() {
  return request<Pick<AuthSession, 'user'>>(Api.currentUser);
}

export function updateUserProfile(id: string, payload: UserProfilePayload) {
  return request<Pick<AuthSession, 'user'>>(Api.profile.replace(':id', id), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateUserPassword(id: string, payload: PasswordPayload) {
  return request<{ ok: boolean }>(Api.password.replace(':id', id), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function listUsers() {
  return request<ManagedUser[]>(Api.users);
}

export function adjustUserCredits(id: string, delta: number) {
  return request<{ user: ManagedUser }>(Api.credits.replace(':id', id), {
    method: 'PATCH',
    body: JSON.stringify({ delta }),
  });
}

export function updateUserBlacklist(id: string, isBlacklisted: boolean) {
  return request<{ user: ManagedUser }>(Api.blacklist.replace(':id', id), {
    method: 'PATCH',
    body: JSON.stringify({ isBlacklisted }),
  });
}
