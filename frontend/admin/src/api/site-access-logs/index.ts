import { request } from '@shared/api/core/request';

export type SiteAccessLog = {
  id: string;
  ip: string;
  userId: string;
  username: string;
  method: string;
  path: string;
  userAgent: string;
  accessCount: number;
  accessedAt: string;
  statusCode: number;
  durationMs: number;
};

export type SiteAccessLogSettings = {
  retentionDays: number;
};

export type PaginatedSiteAccessLogs = {
  items: SiteAccessLog[];
  page: number;
  pageSize: number;
  total: number;
};

export type SiteAccessLogFilters = {
  ip?: string;
  username?: string;
  method?: string;
};

const apiBase = '/api/access-logs';

export function listSiteAccessLogs(page = 1, pageSize = 20, filters: SiteAccessLogFilters = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.ip) params.set('ip', filters.ip);
  if (filters.username) params.set('username', filters.username);
  if (filters.method) params.set('method', filters.method);
  return request<PaginatedSiteAccessLogs>(`${apiBase}?${params.toString()}`, { dedupe: false });
}

export function getSiteAccessLogSettings() {
  return request<SiteAccessLogSettings>(`${apiBase}/settings`, { dedupe: false });
}

export function updateSiteAccessLogSettings(settings: SiteAccessLogSettings) {
  return request<SiteAccessLogSettings>(`${apiBase}/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}
