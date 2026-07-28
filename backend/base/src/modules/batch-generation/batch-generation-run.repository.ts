import { randomUUID } from 'node:crypto';
import { db } from '../../db/database.js';
import type {
  BatchGenerationAttempt,
  BatchGenerationAttemptDetail,
  BatchGenerationExecutionStatus,
  BatchGenerationOutput,
  BatchGenerationRun,
  BatchGenerationRunDetail,
} from './batch-generation.types.js';

type RunRecord = BatchGenerationRun;
type AttemptRecord = Omit<BatchGenerationAttempt, 'effectiveParams' | 'modelConfigSnapshot'> & {
  effectiveParams: string;
  modelConfigSnapshot: string;
};
type OutputRecord = Omit<BatchGenerationOutput, 'metadata'> & { metadata: string };

function parseObject(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseRun(row: RunRecord): BatchGenerationRun {
  return {
    ...row,
    totalCount: Number(row.totalCount || 0),
    completedCount: Number(row.completedCount || 0),
    failedCount: Number(row.failedCount || 0),
    estimatedCredits: Number(row.estimatedCredits || 0),
    actualCredits: Number(row.actualCredits || 0),
  };
}

function parseAttempt(row: AttemptRecord): BatchGenerationAttempt {
  return {
    ...row,
    effectiveParams: parseObject(row.effectiveParams),
    modelConfigSnapshot: parseObject(row.modelConfigSnapshot),
    attemptNo: Number(row.attemptNo || 1),
    estimatedCredits: Number(row.estimatedCredits || 0),
    actualCredits: Number(row.actualCredits || 0),
  };
}

function parseOutput(row: OutputRecord): BatchGenerationOutput {
  return { ...row, metadata: parseObject(row.metadata), slotIndex: Number(row.slotIndex || 0) };
}

const runSelect = `
  SELECT
    id,
    sheet_id as sheetId,
    user_id as userId,
    status,
    total_count as totalCount,
    completed_count as completedCount,
    failed_count as failedCount,
    estimated_credits as estimatedCredits,
    actual_credits as actualCredits,
    created_at as createdAt,
    started_at as startedAt,
    completed_at as completedAt,
    updated_at as updatedAt
  FROM batch_generation_runs
`;

const attemptSelect = `
  SELECT
    id,
    run_id as runId,
    row_id as rowId,
    attempt_no as attemptNo,
    status,
    effective_params as effectiveParams,
    model_config_snapshot as modelConfigSnapshot,
    generation_job_id as generationJobId,
    estimated_credits as estimatedCredits,
    actual_credits as actualCredits,
    error_code as errorCode,
    error_message as errorMessage,
    queued_at as queuedAt,
    started_at as startedAt,
    completed_at as completedAt,
    updated_at as updatedAt
  FROM batch_generation_attempts
`;

const outputSelect = `
  SELECT
    id,
    attempt_id as attemptId,
    slot_index as slotIndex,
    asset_id as assetId,
    media_kind as mediaKind,
    metadata,
    created_at as createdAt
  FROM batch_generation_outputs
`;

function recountRun(runId: string, now: string) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as totalCount,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedCount,
      SUM(CASE WHEN status IN ('failed', 'partial_failed') THEN 1 ELSE 0 END) as failedCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as hardFailedCount,
      SUM(CASE WHEN status = 'partial_failed' THEN 1 ELSE 0 END) as partialFailedCount,
      SUM(actual_credits) as actualCredits
    FROM batch_generation_attempts
    WHERE run_id = ?
  `).get(runId) as {
    totalCount: number;
    completedCount: number;
    failedCount: number;
    hardFailedCount: number;
    partialFailedCount: number;
    actualCredits: number;
  };
  const totalCount = Number(counts.totalCount || 0);
  const completedCount = Number(counts.completedCount || 0);
  const failedCount = Number(counts.failedCount || 0);
  const hardFailedCount = Number(counts.hardFailedCount || 0);
  const partialFailedCount = Number(counts.partialFailedCount || 0);
  const finished = completedCount + failedCount >= totalCount;
  const status = !finished
    ? 'running'
    : failedCount === 0
      ? 'completed'
      : partialFailedCount > 0 || (completedCount > 0 && hardFailedCount > 0)
        ? 'partial_failed'
        : 'failed';
  db.prepare(`
    UPDATE batch_generation_runs
    SET status = @status,
        completed_count = @completedCount,
        failed_count = @failedCount,
        actual_credits = @actualCredits,
        completed_at = CASE WHEN @finished = 1 THEN @now ELSE NULL END,
        updated_at = @now
    WHERE id = @runId
  `).run({
    runId,
    status,
    completedCount,
    failedCount,
    actualCredits: Number(counts.actualCredits || 0),
    finished: finished ? 1 : 0,
    now,
  });
}

export const batchGenerationRunRepository = {
  listRuns(sheetId: string) {
    return (db.prepare(`${runSelect} WHERE sheet_id = ? ORDER BY created_at DESC`)
      .all(sheetId) as RunRecord[]).map(parseRun);
  },

  findRun(runId: string) {
    const row = db.prepare(`${runSelect} WHERE id = ?`).get(runId) as RunRecord | undefined;
    return row ? parseRun(row) : undefined;
  },

  listAttempts(runId: string) {
    return (db.prepare(`${attemptSelect} WHERE run_id = ? ORDER BY queued_at ASC`)
      .all(runId) as AttemptRecord[]).map(parseAttempt);
  },

  findAttempt(attemptId: string) {
    const row = db.prepare(`${attemptSelect} WHERE id = ?`).get(attemptId) as AttemptRecord | undefined;
    return row ? parseAttempt(row) : undefined;
  },

  nextAttemptNo(rowId: string) {
    const row = db.prepare(`
      SELECT COALESCE(MAX(attempt_no), 0) + 1 as attemptNo
      FROM batch_generation_attempts
      WHERE row_id = ?
    `).get(rowId) as { attemptNo: number };
    return Number(row.attemptNo || 1);
  },

  listOutputs(attemptId: string) {
    return (db.prepare(`${outputSelect} WHERE attempt_id = ? ORDER BY slot_index ASC`)
      .all(attemptId) as OutputRecord[]).map(parseOutput);
  },

  getRunDetail(runId: string): BatchGenerationRunDetail | undefined {
    const run = this.findRun(runId);
    if (!run) return undefined;
    const attempts: BatchGenerationAttemptDetail[] = this.listAttempts(runId).map((attempt) => ({
      ...attempt,
      outputs: this.listOutputs(attempt.id),
    }));
    return { ...run, attempts };
  },

  createRun(run: BatchGenerationRun, attempts: BatchGenerationAttempt[]) {
    const insertRun = db.prepare(`
      INSERT INTO batch_generation_runs (
        id, sheet_id, user_id, status, total_count, completed_count, failed_count,
        estimated_credits, actual_credits, created_at, started_at, completed_at, updated_at
      ) VALUES (
        @id, @sheetId, @userId, @status, @totalCount, @completedCount, @failedCount,
        @estimatedCredits, @actualCredits, @createdAt, @startedAt, @completedAt, @updatedAt
      )
    `);
    const insertAttempt = db.prepare(`
      INSERT INTO batch_generation_attempts (
        id, run_id, row_id, attempt_no, status, effective_params, model_config_snapshot,
        generation_job_id, estimated_credits, actual_credits, error_code, error_message,
        queued_at, started_at, completed_at, updated_at
      ) VALUES (
        @id, @runId, @rowId, @attemptNo, @status, @effectiveParams, @modelConfigSnapshot,
        @generationJobId, @estimatedCredits, @actualCredits, @errorCode, @errorMessage,
        @queuedAt, @startedAt, @completedAt, @updatedAt
      )
    `);
    const updateRow = db.prepare(`
      UPDATE batch_generation_rows
      SET validation_status = 'valid', validation_errors = '[]', execution_status = 'queued',
          latest_attempt_id = @attemptId, updated_at = @updatedAt
      WHERE id = @rowId AND execution_status NOT IN ('queued', 'running')
    `);
    db.transaction(() => {
      insertRun.run(run);
      attempts.forEach((attempt) => {
        insertAttempt.run({
          ...attempt,
          effectiveParams: JSON.stringify(attempt.effectiveParams),
          modelConfigSnapshot: JSON.stringify(attempt.modelConfigSnapshot),
          generationJobId: attempt.generationJobId || null,
          errorCode: attempt.errorCode || null,
          errorMessage: attempt.errorMessage || null,
          startedAt: attempt.startedAt || null,
          completedAt: attempt.completedAt || null,
        });
        const updated = updateRow.run({ rowId: attempt.rowId, attemptId: attempt.id, updatedAt: run.createdAt });
        if (updated.changes !== 1) {
          throw new Error('表格行已被其他任务占用');
        }
      });
    })();
    return run;
  },

  markRunRunning(runId: string) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE batch_generation_runs
      SET status = 'running', started_at = COALESCE(started_at, @now), updated_at = @now
      WHERE id = @runId AND status IN ('queued', 'running')
    `).run({ runId, now });
    return this.findRun(runId);
  },

  markAttemptRunning(attemptId: string) {
    const now = new Date().toISOString();
    db.transaction(() => {
      const attempt = this.findAttempt(attemptId);
      if (!attempt || attempt.status !== 'queued') return;
      db.prepare(`
        UPDATE batch_generation_attempts
        SET status = 'running', started_at = COALESCE(started_at, @now), updated_at = @now
        WHERE id = @attemptId AND status = 'queued'
      `).run({ attemptId, now });
      db.prepare(`
        UPDATE batch_generation_rows
        SET execution_status = 'running', updated_at = @now
        WHERE id = @rowId AND latest_attempt_id = @attemptId
      `).run({ rowId: attempt.rowId, attemptId, now });
    })();
    return this.findAttempt(attemptId);
  },

  setAttemptGenerationJobId(attemptId: string, generationJobId: string) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE batch_generation_attempts
      SET generation_job_id = @generationJobId, updated_at = @now
      WHERE id = @attemptId AND status = 'running'
    `).run({ attemptId, generationJobId, now });
    return this.findAttempt(attemptId);
  },

  completeAttempt(input: {
    attemptId: string;
    status: Extract<BatchGenerationExecutionStatus, 'completed' | 'partial_failed'>;
    actualCredits: number;
    outputAssetIds: string[];
    mediaKind: BatchGenerationOutput['mediaKind'];
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    db.transaction(() => {
      const attempt = this.findAttempt(input.attemptId);
      if (!attempt || attempt.status !== 'running') return;
      db.prepare(`
        UPDATE batch_generation_attempts
        SET status = @status, actual_credits = @actualCredits, error_code = NULL,
            error_message = NULL, completed_at = @now, updated_at = @now
        WHERE id = @attemptId
      `).run({ ...input, now });
      const insertOutput = db.prepare(`
        INSERT INTO batch_generation_outputs (
          id, attempt_id, slot_index, asset_id, media_kind, metadata, created_at
        ) VALUES (@id, @attemptId, @slotIndex, @assetId, @mediaKind, @metadata, @createdAt)
      `);
      input.outputAssetIds.forEach((assetId, slotIndex) => insertOutput.run({
        id: randomUUID(),
        attemptId: input.attemptId,
        slotIndex,
        assetId,
        mediaKind: input.mediaKind,
        metadata: JSON.stringify(input.metadata || {}),
        createdAt: now,
      }));
      db.prepare(`
        UPDATE batch_generation_rows
        SET execution_status = @status, actual_credits = actual_credits + @actualCredits,
            updated_at = @now
        WHERE id = @rowId AND latest_attempt_id = @attemptId
      `).run({
        rowId: attempt.rowId,
        attemptId: input.attemptId,
        status: input.status,
        actualCredits: input.actualCredits,
        now,
      });
      recountRun(attempt.runId, now);
    })();
    return this.findAttempt(input.attemptId);
  },

  failAttempt(input: { attemptId: string; errorCode?: string; errorMessage: string }) {
    const now = new Date().toISOString();
    db.transaction(() => {
      const attempt = this.findAttempt(input.attemptId);
      if (!attempt || !['queued', 'running'].includes(attempt.status)) return;
      db.prepare(`
        UPDATE batch_generation_attempts
        SET status = 'failed', error_code = @errorCode, error_message = @errorMessage,
            completed_at = @now, updated_at = @now
        WHERE id = @attemptId
      `).run({ ...input, errorCode: input.errorCode || 'execution_failed', now });
      db.prepare(`
        UPDATE batch_generation_rows
        SET execution_status = 'failed', updated_at = @now
        WHERE id = @rowId AND latest_attempt_id = @attemptId
      `).run({ rowId: attempt.rowId, attemptId: input.attemptId, now });
      recountRun(attempt.runId, now);
    })();
    return this.findAttempt(input.attemptId);
  },

  recoverInterruptedRuns() {
    const now = new Date().toISOString();
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT id FROM batch_generation_runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC
      `).all() as Array<{ id: string }>;
      db.prepare(`
        UPDATE batch_generation_attempts
        SET status = 'queued', started_at = NULL, updated_at = @now
        WHERE status = 'running'
          AND run_id IN (SELECT id FROM batch_generation_runs WHERE status IN ('queued', 'running'))
      `).run({ now });
      db.prepare(`
        UPDATE batch_generation_rows
        SET execution_status = 'queued', updated_at = @now
        WHERE latest_attempt_id IN (
          SELECT id FROM batch_generation_attempts WHERE status = 'queued'
        )
      `).run({ now });
      db.prepare(`
        UPDATE batch_generation_runs
        SET status = 'queued', started_at = NULL, updated_at = @now
        WHERE status IN ('queued', 'running')
      `).run({ now });
      return rows.map((row) => row.id);
    })();
  },
};
