import { request } from '@shared/api/core/request';

export type ManagedFileStorageProvider = 'local' | 'tos';
export type ManagedFileMediaType = 'image' | 'video' | 'audio' | 'document' | 'other';

export type ManagedFile = {
  id: string;
  name: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  fileUrl: string;
  resourceType: string;
  assetKind: string;
  lifecycleStatus: 'temporary' | 'retained' | 'permanent';
  storageProvider: ManagedFileStorageProvider;
  storageKey: string;
  storageBucket: string;
  mediaType: ManagedFileMediaType;
  referenceCount: number;
  userId: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type ManagedFileSummary = {
  totalCount: number;
  totalBytes: number;
  localCount: number;
  localBytes: number;
  tosCount: number;
  tosBytes: number;
};

export type TosStorageSummary = {
  bucket: string;
  keyPrefix: string;
  objectCount: number;
  totalBytes: number;
  prefixObjectCount: number;
  prefixBytes: number;
};

export type ManagedFileListResult = {
  items: ManagedFile[];
  page: number;
  pageSize: number;
  total: number;
  summary: ManagedFileSummary;
};

export type ManagedFileListFilters = {
  search?: string;
  storageProvider?: ManagedFileStorageProvider;
  mediaType?: ManagedFileMediaType;
  lifecycleStatus?: ManagedFile['lifecycleStatus'];
  createdAtFrom?: string;
  createdAtTo?: string;
};

export function listManagedFiles(page = 1, pageSize = 20, filters: ManagedFileListFilters = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return request<ManagedFileListResult>(`/api/file-management?${params.toString()}`, { dedupe: false });
}

export function getTosStorageSummary() {
  return request<TosStorageSummary>('/api/file-management/tos-summary', { dedupe: false });
}

export function listTosObjects(page = 1, pageSize = 20, filters: ManagedFileListFilters = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  Object.entries(filters).forEach(([key, value]) => {
    if (value && key !== 'storageProvider') params.set(key, value);
  });
  return request<ManagedFileListResult>(`/api/file-management/tos-objects?${params.toString()}`, { dedupe: false });
}

export function deleteManagedFile(file: Pick<ManagedFile, 'id' | 'storageKey'>) {
  return request<{ ok: true }>('/api/file-management/delete', {
    method: 'POST',
    body: JSON.stringify(file),
  });
}
