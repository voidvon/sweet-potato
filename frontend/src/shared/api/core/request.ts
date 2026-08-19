import { beginRequestActivity, endRequestActivity } from './requestActivity';
import { getLoginRoute, getStoredToken, getStoredUser, removeStoredUser } from '../../utils/session';

function resolveApiBaseUrl() {
  // 使用构建时的环境变量
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== '') {
    // Keep local development cookies on the same host as the page. `localhost`
    // and `127.0.0.1` are different cookie hosts even when they use the same port.
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(configuredBaseUrl);
        const pageHostname = window.location.hostname;
        const isLoopbackHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
        const isLoopbackPage = pageHostname === 'localhost' || pageHostname === '127.0.0.1' || pageHostname === '::1';
        if (isLoopbackHost && isLoopbackPage) {
          url.hostname = pageHostname;
          return url.toString().replace(/\/$/, '');
        }
      } catch {
        // Fall back to the configured value when it is not an absolute URL.
      }
    }
    return configuredBaseUrl;
  }

  // 默认使用相对路径（适用于 Web 模式通过 Nginx 反向代理）
  return '';
}

export const API_BASE_URL = resolveApiBaseUrl();
let redirectingToLogin = false;
const inFlightGetRequests = new Map<string, Promise<unknown>>();

export function resolveAssetUrl(url?: string | null) {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }
  if (/^(blob:|data:|https?:\/\/)/i.test(raw)) {
    return raw;
  }
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

export type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | null;
  dedupe?: boolean;
  showPageLoading?: boolean;
};

function buildGetRequestKey(path: string, options: RequestOptions, headers: Headers) {
  const method = (options.method || 'GET').toUpperCase();
  if (options.dedupe === false || method !== 'GET' || options.body != null || options.signal) {
    return null;
  }

  return JSON.stringify({
    cache: options.cache || '',
    credentials: options.credentials || '',
    headers: Array.from(headers.entries()).sort(([left], [right]) => left.localeCompare(right)),
    integrity: options.integrity || '',
    keepalive: options.keepalive || false,
    mode: options.mode || '',
    redirect: options.redirect || '',
    referrer: options.referrer || '',
    referrerPolicy: options.referrerPolicy || '',
    showPageLoading: options.showPageLoading || false,
    url: `${API_BASE_URL}${path}`,
  });
}

function redirectToLogin() {
  if (redirectingToLogin || typeof window === 'undefined') {
    return;
  }
  redirectingToLogin = true;
  removeStoredUser();
  window.location.replace(getLoginRoute());
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { dedupe: _dedupe, showPageLoading, ...requestOptions } = options;
  const headers = new Headers(options.headers || {});
  const token = getStoredToken();

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const requestKey = buildGetRequestKey(path, options, headers);
  if (requestKey) {
    const inFlightRequest = inFlightGetRequests.get(requestKey);
    if (inFlightRequest) {
      return inFlightRequest as Promise<T>;
    }
  }

  const pendingRequest = (async () => {
    const requestActivityId = showPageLoading ? beginRequestActivity() : undefined;
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
		credentials: 'include',
        ...requestOptions,
        headers,
      });

      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text.slice(0, 500) };
        }
      }

      if (!response.ok) {
        if (response.status === 401 && path !== '/api/users/me' && (token || getStoredUser())) {
          redirectToLogin();
        }
        const message = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
          ? data.message
          : '服务请求失败';
        throw new Error(message);
      }

      return data as T;
    } finally {
      if (requestActivityId !== undefined) {
        endRequestActivity(requestActivityId);
      }
    }
  })();

  if (requestKey) {
    inFlightGetRequests.set(requestKey, pendingRequest);
    const clearPendingRequest = () => {
      if (inFlightGetRequests.get(requestKey) === pendingRequest) {
        inFlightGetRequests.delete(requestKey);
      }
    };
    void pendingRequest.then(clearPendingRequest, clearPendingRequest);
  }

  return pendingRequest;
}
