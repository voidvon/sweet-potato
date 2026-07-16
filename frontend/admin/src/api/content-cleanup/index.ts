import { request } from '@shared/api/core/request';

export type TemporaryAssetCleanupCandidate = {
  id: string;
  userId: string;
  username: string;
  assetKind: string;
  name: string;
  mimeType: string;
  fileSize: number;
  fileUrl: string;
  parentAssetId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type TemporaryAssetCleanupLog = {
  id: number;
  assetId: string;
  userId: string;
  username: string;
  assetKind: string;
  name: string;
  fileUrl: string;
  fileSize: number;
  expiresAt: string | null;
  triggerType: 'scheduled' | 'manual';
  cleanedAt: string;
};

export type PaginatedTemporaryAssets = {
  items: TemporaryAssetCleanupCandidate[];
  page: number;
  pageSize: number;
  total: number;
};

const apiBase = '/api/content/temporary-assets';

export function listTemporaryAssetCleanupCandidates(page = 1, pageSize = 20) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return request<PaginatedTemporaryAssets>(`${apiBase}/cleanup-candidates?${params.toString()}`);
}

export function listTemporaryAssetCleanupLogs() {
  return request<TemporaryAssetCleanupLog[]>(`${apiBase}/cleanup-logs`);
}

export function runTemporaryAssetCleanup() {
  return request<{ deleted: number }>(`${apiBase}/cleanup`, { method: 'POST' });
}
