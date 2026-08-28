import { request } from '../request';

export type ContentWorkflowModuleKey =
  | 'talking-video'
  | 'marketing-video'
  | 'lightweight-marketing-video';

export type ContentWorkflowStatus =
  | 'draft'
  | 'uploading'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ContentWorkflow<TState extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  userId: string;
  moduleKey: ContentWorkflowModuleKey;
  recordKey: string;
  title: string;
  status: ContentWorkflowStatus;
  currentStep: string;
  state: TState;
  schemaVersion: number;
  revision: number;
  completedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveContentWorkflowInput<TState extends Record<string, unknown>> = {
  id?: string;
  moduleKey: ContentWorkflowModuleKey;
  recordKey: string;
  title?: string;
  status?: ContentWorkflowStatus;
  currentStep?: string;
  state: TState;
  schemaVersion?: number;
};

const basePath = '/api/content/workflows';

export function listContentWorkflows<TState extends Record<string, unknown> = Record<string, unknown>>(
  moduleKey: ContentWorkflowModuleKey,
  limit = 100,
) {
  const query = new URLSearchParams({ moduleKey, limit: String(limit) });
  return request<Array<ContentWorkflow<TState>>>(`${basePath}?${query.toString()}`);
}

export function saveContentWorkflow<TState extends Record<string, unknown>>(
  payload: SaveContentWorkflowInput<TState>,
) {
  return request<ContentWorkflow<TState>>(basePath, {
    body: JSON.stringify(payload),
    method: 'POST',
  });
}

export function getContentWorkflow<TState extends Record<string, unknown> = Record<string, unknown>>(id: string) {
  return request<ContentWorkflow<TState>>(`${basePath}/${id}`);
}

export function deleteContentWorkflow(id: string) {
  return request<void>(`${basePath}/${id}`, { method: 'DELETE' });
}
