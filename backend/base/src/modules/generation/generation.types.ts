export type GenerationJobKind = 'image' | 'video';
export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled';
export type GenerationJobItemStatus = 'queued' | 'running' | 'completed' | 'failed';

export type GenerationJob = {
  id: string;
  userId: string;
  kind: GenerationJobKind;
  sourceModule: string;
  conversationId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  status: GenerationJobStatus;
  expectedCount: number;
  completedCount: number;
  failedCount: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationJobItem = {
  id: string;
  jobId: string;
  slotIndex: number;
  status: GenerationJobItemStatus;
  input: Record<string, unknown>;
  attachmentId?: string | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
};

