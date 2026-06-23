import { beginRequestActivity, endRequestActivity } from './requestActivity';
import { getLoginRoute, getStoredToken, removeStoredUser } from '../utils/session';

function resolveApiBaseUrl() {
  // 使用构建时的环境变量
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== '') {
    return configuredBaseUrl;
  }

  // 默认使用相对路径（适用于 Web 模式通过 Nginx 反向代理）
  return '';
}

export const API_BASE_URL = resolveApiBaseUrl();
let redirectingToLogin = false;

export type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | null;
  showPageLoading?: boolean;
};

function redirectToLogin() {
  if (redirectingToLogin || typeof window === 'undefined') {
    return;
  }
  redirectingToLogin = true;
  removeStoredUser();
  window.location.replace(getLoginRoute());
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { showPageLoading, ...requestOptions } = options;
  const headers = new Headers(options.headers || {});
  const token = getStoredToken();

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const requestActivityId = showPageLoading ? beginRequestActivity() : undefined;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestOptions,
      headers,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      if (response.status === 401 && token) {
        redirectToLogin();
      }
      throw new Error(data?.message || '服务请求失败');
    }

    return data;
  } finally {
    if (requestActivityId !== undefined) {
      endRequestActivity(requestActivityId);
    }
  }
}
