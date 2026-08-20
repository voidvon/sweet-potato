import { request } from '@shared/api/core/request';

export type SystemUpdateInfo = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  supported: boolean;
  githubUrl: string;
  releaseUrl?: string;
  publishedAt?: string;
  releaseNotes?: string;
  assetName?: string;
  checkError?: string;
};

export type SystemUpdateResult = {
  ok: boolean;
  version: string;
  restarting: boolean;
};

const systemUpdateApi = '/api/system/update';

export function checkSystemUpdate() {
  return request<SystemUpdateInfo>(systemUpdateApi, { dedupe: false });
}

export function installSystemUpdate() {
  return request<SystemUpdateResult>(systemUpdateApi, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
