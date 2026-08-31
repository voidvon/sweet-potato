import { request } from '@shared/api/core/request';

export type ManagedPlugin = {
  key: string;
  name: string;
  category: string;
  version: string;
  requiredPermission: string;
  workflowVersion: string;
  renderAdapter: string;
  acceptedAttachments: string[];
  enabled: boolean;
  sortOrder: number;
  timeoutSeconds: number;
  maxConcurrency: number;
  templateVersion: string;
  updatedAt: string;
  runtime: {
    installed: boolean;
    state: 'not_installed' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'unsupported';
    endpoint?: string;
    pid?: number;
    startedAt?: string;
    lastError?: string;
    pluginDir?: string;
    bunVersion?: string;
  };
};

export type PluginSettingsPayload = Pick<ManagedPlugin,
  'enabled' | 'sortOrder' | 'timeoutSeconds' | 'maxConcurrency' | 'templateVersion'
>;

export type PluginConnectionResult = {
  ok: boolean;
  latencyMs: number;
  health: unknown;
};

export async function listPlugins() {
  const result = await request<{ plugins: ManagedPlugin[] }>('/api/admin/plugins', { dedupe: false });
  return result.plugins;
}

export function updatePlugin(key: string, payload: PluginSettingsPayload) {
  return request<ManagedPlugin>(`/api/admin/plugins/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function testPluginConnection(key: string) {
  return request<PluginConnectionResult>(`/api/admin/plugins/${encodeURIComponent(key)}/test`, {
    method: 'POST',
  });
}
