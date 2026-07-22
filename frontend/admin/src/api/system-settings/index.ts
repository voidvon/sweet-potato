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

const batchRequestApiBase = '/api/system-settings/batch-request';
const rateLimitApiBase = '/api/system-settings/rate-limits';
const ipBlacklistApiBase = '/api/system-settings/ip-blacklist';

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
