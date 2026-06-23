import type { AuthSession, User } from '../types';

const USER_KEY = 'ai_marketing_user';
const TOKEN_KEY = 'ai_marketing_token';
const routerBasename = (import.meta.env.VITE_ROUTER_BASENAME || '').replace(/\/+$/, '');

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }
  const user = JSON.parse(raw) as User;
  return {
    ...user,
    role: user.role || 'user',
  };
}

export function storeSession(session: AuthSession) {
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  localStorage.setItem(TOKEN_KEY, session.token);
}

export function storeUser(user: User) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function removeStoredUser() {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function withAuthToken(url: string) {
  const token = getStoredToken();
  if (!token) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

export function getLoginRoute() {
  return `${routerBasename}/login` || '/login';
}
