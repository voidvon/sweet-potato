import type { AuthSession, LoginPayload, RegisterPayload } from '../../types';
import { request } from '../core/request';

enum Api {
  register = '/api/auth/register',
  login = '/api/auth/login',
}

export function registerAccount(payload: RegisterPayload) {
  return request<AuthSession>(Api.register, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function loginAccount(payload: LoginPayload) {
  return request<AuthSession>(Api.login, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
