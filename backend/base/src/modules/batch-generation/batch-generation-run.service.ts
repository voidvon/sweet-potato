import { randomUUID } from 'node:crypto';
import {
  getCreativeCapabilityExecutor,
  mergeCreativeParams,
} from '../creative-capabilities/creative-capability.registry.js';
import type {
  CreativeCapabilityExecutor,
  CreativeCapabilityPreparedExecution,
} from '../creative-capabilities/creative-capability.types.js';
import { publishBatchGenerationRun } from './batch-generation.events.js';
import { batchGenerationRunRepository } from './batch-generation-run.repository.js';
import { batchGenerationRepository } from './batch-generation.repository.js';
import {
  BatchGenerationConflictError,
  BatchGenerationNotFoundError,
} from './batch-generation.service.js';
import type {
  BatchGenerationAttempt,
  BatchGenerationRow,
  BatchGenerationRun,
} from './batch-generation.types.js';

const MAX_CONCURRENT_ATTEMPTS = 2;
const activeRuns = new Set<string>();
const concurrencyWaiters: Array<() => void> = [];
let activeAttemptCount = 0;

async function acquireAttemptSlot() {
  if (activeAttemptCount >= MAX_CONCURRENT_ATTEMPTS) {
    await new Promise<void>((resolve) => concurrencyWaiters.push(resolve));
  }
  activeAttemptCount += 1;
}

function releaseAttemptSlot() {
  activeAttemptCount = Math.max(0, activeAttemptCount - 1);
  concurrencyWaiters.shift()?.();
}

function requireOwnedSheet(userId: string, sheetId: string) {
  const sheet = batchGenerationRepository.findSheet(sheetId);
  if (!sheet || sheet.userId !== userId) {
    throw new BatchGenerationNotFoundError('表格不存在');
  }
  return sheet;
}

function requireOwnedRun(userId: string, runId: string) {
  const run = batchGenerationRunRepository.findRun(runId);
  if (!run || run.userId !== userId) {
    throw new BatchGenerationNotFoundError('批量任务不存在');
  }
  return run;
}

function executionError(error: unknown) {
  return error instanceof Error ? error.message : String(error || '执行失败');
}

function publishRun(runId: string) {
  const detail = batchGenerationRunRepository.getRunDetail(runId);
  if (detail) publishBatchGenerationRun(detail.userId, detail);
}

async function executeAttempt(
  run: BatchGenerationRun,
  executor: CreativeCapabilityExecutor,
  attempt: BatchGenerationAttempt,
) {
  const runningAttempt = batchGenerationRunRepository.markAttemptRunning(attempt.id);
  if (!runningAttempt || runningAttempt.status !== 'running') return;
  publishRun(run.id);
  try {
    const result = await executor.execute({
      userId: run.userId,
      sourceType: 'batch_generation',
      sourceId: attempt.id,
      generationJobId: attempt.generationJobId,
      onExternalJobCreated: async (generationJobId) => {
        batchGenerationRunRepository.setAttemptGenerationJobId(attempt.id, generationJobId);
        publishRun(run.id);
      },
    }, {
      effectiveParams: attempt.effectiveParams,
      modelConfigSnapshot: attempt.modelConfigSnapshot,
      estimatedCredits: attempt.estimatedCredits,
    });
    const failures = Array.isArray(result.metadata?.failures) ? result.metadata.failures : [];
    batchGenerationRunRepository.completeAttempt({
      attemptId: attempt.id,
      status: failures.length ? 'partial_failed' : 'completed',
      actualCredits: result.creditCost,
      outputAssetIds: result.outputAssetIds,
      mediaKind: batchGenerationRepository.findSheet(run.sheetId)?.mediaKind || 'image',
      metadata: result.metadata,
    });
  } catch (error) {
    batchGenerationRunRepository.failAttempt({
      attemptId: attempt.id,
      errorMessage: executionError(error),
    });
  }
  publishRun(run.id);
}

async function executeRun(runId: string) {
  if (activeRuns.has(runId)) return;
  const run = batchGenerationRunRepository.findRun(runId);
  if (!run || !['queued', 'running'].includes(run.status)) return;
  const sheet = batchGenerationRepository.findSheet(run.sheetId);
  const executor = sheet ? getCreativeCapabilityExecutor(sheet.capabilityKey) : undefined;
  if (!sheet || !executor) {
    batchGenerationRunRepository.listAttempts(runId)
      .filter((attempt) => ['queued', 'running'].includes(attempt.status))
      .forEach((attempt) => batchGenerationRunRepository.failAttempt({
        attemptId: attempt.id,
        errorCode: 'executor_unavailable',
        errorMessage: '当前功能暂未接入批量执行器',
      }));
    publishRun(runId);
    return;
  }

  activeRuns.add(runId);
  batchGenerationRunRepository.markRunRunning(runId);
  publishRun(runId);
  try {
    const attempts = batchGenerationRunRepository.listAttempts(runId)
      .filter((attempt) => attempt.status === 'queued');
    let cursor = 0;
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_ATTEMPTS, attempts.length) }, async () => {
      while (cursor < attempts.length) {
        const attempt = attempts[cursor];
        cursor += 1;
        await acquireAttemptSlot();
        try {
          await executeAttempt(run, executor, attempt);
        } finally {
          releaseAttemptSlot();
        }
      }
    });
    await Promise.all(workers);
  } finally {
    activeRuns.delete(runId);
    publishRun(runId);
  }
}

function enqueueRun(runId: string) {
  queueMicrotask(() => {
    void executeRun(runId);
  });
}

async function prepareAttempt(input: {
  executor: CreativeCapabilityExecutor;
  userId: string;
  effectiveParams: Record<string, unknown>;
}) {
  const attemptId = randomUUID();
  const prepared = await input.executor.prepare({
    userId: input.userId,
    sourceType: 'batch_generation',
    sourceId: attemptId,
  }, input.effectiveParams);
  return { attemptId, prepared };
}

export const batchGenerationRunService = {
  listRuns(userId: string, sheetId: string) {
    const sheet = requireOwnedSheet(userId, sheetId);
    return batchGenerationRunRepository.listRuns(sheet.id);
  },

  getRun(userId: string, runId: string) {
    const run = requireOwnedRun(userId, runId);
    return batchGenerationRunRepository.getRunDetail(run.id);
  },

  async startRun(input: { userId: string; sheetId: string; rowIds?: unknown }) {
    const sheet = requireOwnedSheet(input.userId, input.sheetId);
    const executor = getCreativeCapabilityExecutor(sheet.capabilityKey);
    if (!executor) throw new Error('当前功能暂未接入批量执行器');
    const allRows = batchGenerationRepository.listRows(sheet.id);
    const requestedIds = Array.isArray(input.rowIds)
      ? [...new Set(input.rowIds.map(String).filter(Boolean))]
      : allRows.map((row) => row.id);
    if (!requestedIds.length) throw new Error('至少需要选择一行');
    const rowsById = new Map(allRows.map((row) => [row.id, row]));
    const rows = requestedIds.map((rowId) => {
      const row = rowsById.get(rowId);
      if (!row) throw new BatchGenerationNotFoundError(`表格行不存在：${rowId}`);
      if (['queued', 'running'].includes(row.executionStatus)) {
        throw new BatchGenerationConflictError(`第 ${row.position + 1} 行正在执行`);
      }
      return row;
    });
    const runId = randomUUID();
    const preparedRows: Array<{
      row: BatchGenerationRow;
      attemptId: string;
      prepared: CreativeCapabilityPreparedExecution;
    }> = [];
    const validationErrors: string[] = [];
    for (const row of rows) {
      try {
        const result = await prepareAttempt({
          executor,
          userId: input.userId,
          effectiveParams: mergeCreativeParams(sheet.capabilityKey, sheet.globalParams, row.params),
        });
        preparedRows.push({ row, ...result });
        batchGenerationRepository.setRowValidation({
          id: row.id,
          validationStatus: 'valid',
          validationErrors: [],
        });
      } catch (error) {
        const message = executionError(error);
        validationErrors.push(`第 ${row.position + 1} 行：${message}`);
        batchGenerationRepository.setRowValidation({
          id: row.id,
          validationStatus: 'invalid',
          validationErrors: [message],
        });
      }
    }
    if (validationErrors.length) {
      throw new Error(validationErrors.join('；'));
    }

    const now = new Date().toISOString();
    const attempts: BatchGenerationAttempt[] = preparedRows.map(({ row, attemptId, prepared }) => ({
      id: attemptId,
      runId,
      rowId: row.id,
      attemptNo: batchGenerationRunRepository.nextAttemptNo(row.id),
      status: 'queued',
      effectiveParams: prepared.effectiveParams,
      modelConfigSnapshot: prepared.modelConfigSnapshot,
      generationJobId: null,
      estimatedCredits: prepared.estimatedCredits,
      actualCredits: 0,
      errorCode: null,
      errorMessage: null,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    }));
    const run: BatchGenerationRun = {
      id: runId,
      sheetId: sheet.id,
      userId: input.userId,
      status: 'queued',
      totalCount: attempts.length,
      completedCount: 0,
      failedCount: 0,
      estimatedCredits: attempts.reduce((total, attempt) => total + attempt.estimatedCredits, 0),
      actualCredits: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    };
    batchGenerationRunRepository.createRun(run, attempts);
    enqueueRun(run.id);
    return batchGenerationRunRepository.getRunDetail(run.id);
  },

  async retryRun(userId: string, runId: string) {
    const run = requireOwnedRun(userId, runId);
    const rowIds = batchGenerationRunRepository.listAttempts(run.id)
      .filter((attempt) => ['failed', 'partial_failed'].includes(attempt.status))
      .map((attempt) => attempt.rowId);
    if (!rowIds.length) throw new Error('当前任务没有可重试的失败行');
    return this.startRun({ userId, sheetId: run.sheetId, rowIds });
  },

  resumeInterruptedRuns() {
    const runIds = batchGenerationRunRepository.recoverInterruptedRuns();
    runIds.forEach(enqueueRun);
    return runIds.length;
  },
};
