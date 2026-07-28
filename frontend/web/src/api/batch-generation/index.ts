import { withAuthToken } from '../../utils/session';
import { API_BASE_URL, request } from '../request';
import type { ContentAsset } from '../../types';

export type CreativeMediaKind = 'image' | 'video';
export type BatchValidationStatus = 'draft' | 'valid' | 'invalid';
export type BatchExecutionStatus = 'idle' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';
export type BatchRunStatus = 'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';

export type CreativeCapabilityField = {
  key: string;
  label: string;
  valueType: 'string' | 'number' | 'boolean' | 'asset' | 'asset-list';
  required?: boolean;
  overridable?: boolean;
};

export type CreativeCapability = {
  key: string;
  label: string;
  mediaKind: CreativeMediaKind;
  schemaVersion: number;
  globalFields: CreativeCapabilityField[];
  rowFields: CreativeCapabilityField[];
};

export type BatchGenerationModelOption = {
  id: string;
  type: CreativeMediaKind;
  name: string;
  isDefault: boolean;
};

export type BatchSheet = {
  id: string;
  userId: string;
  name: string;
  capabilityKey: string;
  mediaKind: CreativeMediaKind;
  globalParams: Record<string, unknown>;
  schemaVersion: number;
  sortOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type BatchSheetSummary = BatchSheet & {
  rowCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
};

export type BatchRow = {
  id: string;
  sheetId: string;
  position: number;
  params: Record<string, unknown>;
  validationStatus: BatchValidationStatus;
  validationErrors: string[];
  executionStatus: BatchExecutionStatus;
  latestAttemptId?: string | null;
  actualCredits: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type BatchSheetDetail = {
  sheet: BatchSheet;
  rows: BatchRow[];
  latestAttempts: BatchAttempt[];
  stats: {
    total: number;
    completed: number;
    failed: number;
    queued: number;
    running: number;
    idle: number;
    actualCredits: number;
  };
};

export type BatchOutput = {
  id: string;
  attemptId: string;
  slotIndex: number;
  assetId: string;
  mediaKind: CreativeMediaKind;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BatchAttempt = {
  id: string;
  runId: string;
  rowId: string;
  attemptNo: number;
  status: BatchExecutionStatus;
  effectiveParams: Record<string, unknown>;
  modelConfigSnapshot: Record<string, unknown>;
  generationJobId?: string | null;
  estimatedCredits: number;
  actualCredits: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  queuedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
  outputs: BatchOutput[];
};

export type BatchRunDetail = {
  id: string;
  sheetId: string;
  userId: string;
  status: BatchRunStatus;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  estimatedCredits: number;
  actualCredits: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
  attempts: BatchAttempt[];
};

const basePath = '/api/batch-generation';

export function listBatchCapabilities() {
  return request<CreativeCapability[]>(`${basePath}/capabilities`);
}

export function listBatchGenerationModelOptions() {
  return request<BatchGenerationModelOption[]>(`${basePath}/model-options`);
}

export function listBatchSheets() {
  return request<BatchSheetSummary[]>(`${basePath}/sheets`);
}

export function createBatchSheet(payload: {
  name: string;
  capabilityKey: string;
  globalParams?: Record<string, unknown>;
}) {
  return request<BatchSheet>(`${basePath}/sheets`, { method: 'POST', body: JSON.stringify(payload) });
}

export function getBatchSheet(sheetId: string) {
  return request<BatchSheetDetail>(`${basePath}/sheets/${encodeURIComponent(sheetId)}`);
}

export function updateBatchSheet(sheetId: string, payload: Partial<Pick<BatchSheet, 'name' | 'globalParams' | 'sortOrder' | 'revision'>>) {
  return request<BatchSheet>(`${basePath}/sheets/${encodeURIComponent(sheetId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteBatchSheet(sheetId: string) {
  return request<{ ok: boolean }>(`${basePath}/sheets/${encodeURIComponent(sheetId)}`, { method: 'DELETE' });
}

export function addBatchRows(sheetId: string, rows: Record<string, unknown>[]) {
  return request<BatchRow[]>(`${basePath}/sheets/${encodeURIComponent(sheetId)}/rows`, {
    method: 'POST',
    body: JSON.stringify({ rows }),
  });
}

export function updateBatchRow(sheetId: string, rowId: string, payload: { params: Record<string, unknown>; revision: number }) {
  return request<BatchRow>(`${basePath}/sheets/${encodeURIComponent(sheetId)}/rows/${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteBatchRow(sheetId: string, rowId: string) {
  return request<{ ok: boolean }>(`${basePath}/sheets/${encodeURIComponent(sheetId)}/rows/${encodeURIComponent(rowId)}`, { method: 'DELETE' });
}

export function startBatchRun(sheetId: string, rowIds?: string[]) {
  return request<BatchRunDetail>(`${basePath}/sheets/${encodeURIComponent(sheetId)}/runs`, {
    method: 'POST',
    body: JSON.stringify(rowIds?.length ? { rowIds } : {}),
  });
}

export function listBatchRuns(sheetId: string) {
  return request<Array<Omit<BatchRunDetail, 'attempts'>>>(`${basePath}/sheets/${encodeURIComponent(sheetId)}/runs`);
}

export function getBatchRun(runId: string) {
  return request<BatchRunDetail>(`${basePath}/runs/${encodeURIComponent(runId)}`);
}

export function retryBatchRun(runId: string) {
  return request<BatchRunDetail>(`${basePath}/runs/${encodeURIComponent(runId)}/retry`, { method: 'POST', body: '{}' });
}

export function createBatchGenerationEventSource() {
  return new EventSource(withAuthToken(`${API_BASE_URL}${basePath}/events`));
}

export function uploadBatchGenerationAsset(payload: {
  file: File;
  sheetId: string;
  fieldKey: string;
}) {
  const formData = new FormData();
  formData.set('file', payload.file);
  formData.set('name', payload.file.name);
  formData.set('sheetId', payload.sheetId);
  formData.set('fieldKey', payload.fieldKey);
  return request<ContentAsset>(`${basePath}/assets/upload`, { method: 'POST', body: formData });
}

export function getBatchGenerationAsset(assetId: string) {
  return request<ContentAsset>(`${basePath}/assets/${encodeURIComponent(assetId)}`);
}
