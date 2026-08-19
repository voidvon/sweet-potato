import { request } from '@shared/api/core/request';

export type BatchRequestSettings = {
  maxCount: number;
  maxDurationSeconds: number;
  maxFileSizeMb: number;
};

export type RateLimitRule = {
  id?: string;
  urlPattern: string;
  maxRequests: number;
  intervalSeconds: number;
  targetUser: 'all' | 'authenticated' | 'anonymous';
};

export type IpBlacklistSettings = {
  entries: string[];
  currentIp: string;
};

export type FileStorageSettings = {
  enabled: boolean;
  provider: 'local';
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  secretKeyConfigured: boolean;
  publicBaseUrl: string;
  keyPrefix: string;
};

const batchRequestApiBase = '/api/system-settings/batch-request';
const rateLimitApiBase = '/api/system-settings/rate-limits';
const ipBlacklistApiBase = '/api/system-settings/ip-blacklist';
const fileStorageApiBase = '/api/system-settings/file-storage';

export function getBatchRequestSettings() {
  return request<BatchRequestSettings>(batchRequestApiBase, { dedupe: false });
}

export function updateBatchRequestSettings(payload: BatchRequestSettings) {
  return request<BatchRequestSettings>(batchRequestApiBase, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function getRateLimitSettings() {
  return request<{ rules: RateLimitRule[] }>(rateLimitApiBase, { dedupe: false });
}

export function updateRateLimitSettings(rules: RateLimitRule[]) {
  return request<{ rules: RateLimitRule[] }>(rateLimitApiBase, {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  });
}

export function getIpBlacklistSettings() {
  return request<IpBlacklistSettings>(ipBlacklistApiBase, { dedupe: false });
}

export function updateIpBlacklistSettings(entries: string[]) {
  return request<IpBlacklistSettings>(ipBlacklistApiBase, {
    method: 'PUT',
    body: JSON.stringify({ entries }),
  });
}

export function getFileStorageSettings() {
  return request<FileStorageSettings>(fileStorageApiBase, { dedupe: false });
}

export function updateFileStorageSettings(payload: Omit<FileStorageSettings, 'provider' | 'secretKeyConfigured'>) {
  return request<FileStorageSettings>(fileStorageApiBase, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
