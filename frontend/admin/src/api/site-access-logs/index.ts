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

const apiBase = '/api/access-logs';

export function listSiteAccessLogs(page = 1, pageSize = 20, ip = '') {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (ip) params.set('ip', ip);
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
