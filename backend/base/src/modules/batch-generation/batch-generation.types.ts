import type { CreativeMediaKind } from '../creative-capabilities/creative-capability.types.js';

export type BatchGenerationValidationStatus = 'draft' | 'valid' | 'invalid';
export type BatchGenerationExecutionStatus = 'idle' | 'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';
export type BatchGenerationRunStatus = 'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';

export type BatchGenerationSheet = {
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

export type BatchGenerationSheetSummary = BatchGenerationSheet & {
  rowCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
};

export type BatchGenerationRow = {
  id: string;
  sheetId: string;
  position: number;
  params: Record<string, unknown>;
  validationStatus: BatchGenerationValidationStatus;
  validationErrors: string[];
  executionStatus: BatchGenerationExecutionStatus;
  latestAttemptId?: string | null;
  actualCredits: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type BatchGenerationRun = {
  id: string;
  sheetId: string;
  userId: string;
  status: BatchGenerationRunStatus;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  estimatedCredits: number;
  actualCredits: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
};

export type BatchGenerationAttempt = {
  id: string;
  runId: string;
  rowId: string;
  attemptNo: number;
  status: BatchGenerationExecutionStatus;
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
};

export type BatchGenerationOutput = {
  id: string;
  attemptId: string;
  slotIndex: number;
  assetId: string;
  mediaKind: CreativeMediaKind;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BatchGenerationSheetDetail = {
  sheet: BatchGenerationSheet;
  rows: BatchGenerationRow[];
  latestAttempts: BatchGenerationAttemptDetail[];
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

export type BatchGenerationAttemptDetail = BatchGenerationAttempt & {
  outputs: BatchGenerationOutput[];
};

export type BatchGenerationRunDetail = BatchGenerationRun & {
  attempts: BatchGenerationAttemptDetail[];
};
