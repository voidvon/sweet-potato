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

export type TemporaryAssetDiskSpace = {
  availableBytes: number;
};

export type OrphanContentFileInspection = {
  scannedFiles: number;
  orphanFiles: number;
  orphanBytes: number;
  items: Array<{
    relativePath: string;
    size: number;
    modifiedAt: string;
  }>;
  truncated: boolean;
};

const apiBase = '/api/content/temporary-assets';

export function listTemporaryAssetCleanupCandidates(page = 1, pageSize = 20) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return request<PaginatedTemporaryAssets>(`${apiBase}/cleanup-candidates?${params.toString()}`);
}

export function listTemporaryAssetCleanupLogs() {
  return request<TemporaryAssetCleanupLog[]>(`${apiBase}/cleanup-logs`);
}

export function getTemporaryAssetDiskSpace() {
  return request<TemporaryAssetDiskSpace>(`${apiBase}/disk-space`);
}

export function deleteTemporaryAssets(assetIds: string[]) {
  return request<{ deleted: number }>(`${apiBase}/cleanup-selected`, {
    method: 'POST',
    body: JSON.stringify({ assetIds }),
  });
}

export function inspectOrphanContentFiles() {
  return request<OrphanContentFileInspection>(`${apiBase}/orphan-files`);
}

export function deleteOrphanContentFiles(relativePaths: string[]) {
  return request<{ deleted: number }>(`${apiBase}/orphan-files/delete`, {
    method: 'POST',
    body: JSON.stringify({ relativePaths }),
  });
}

export function runTemporaryAssetCleanup() {
  return request<{ deleted: number }>(`${apiBase}/cleanup`, { method: 'POST' });
}
