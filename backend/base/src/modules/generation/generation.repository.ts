import { randomBytes } from 'node:crypto';
import { db } from '../../db/database.js';
import type { GenerationJob, GenerationJobItem, GenerationJobItemStatus, GenerationJobStatus } from './generation.types.js';

type GenerationJobRow = Omit<GenerationJob, 'payload' | 'result'> & {
  payload: string;
  result: string;
};

type GenerationJobItemRow = Omit<GenerationJobItem, 'input'> & {
  input: string;
};

function parseJsonObject(value: string | null | undefined) {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseJob(row: GenerationJobRow): GenerationJob {
  return {
    ...row,
    payload: parseJsonObject(row.payload),
    result: parseJsonObject(row.result),
  };
}

function parseJobItem(row: GenerationJobItemRow): GenerationJobItem {
  return {
    ...row,
    input: parseJsonObject(row.input),
  };
}

function serializeJob(job: GenerationJob) {
  return {
    ...job,
    conversationId: job.conversationId || null,
    userMessageId: job.userMessageId || null,
    assistantMessageId: job.assistantMessageId || null,
    payload: JSON.stringify(job.payload || {}),
    result: JSON.stringify(job.result || {}),
    error: job.error || null,
  };
}

function serializeJobItem(item: GenerationJobItem) {
  return {
    ...item,
    attachmentId: item.attachmentId || null,
    error: item.error || null,
    input: JSON.stringify(item.input || {}),
    startedAt: item.startedAt || null,
    completedAt: item.completedAt || null,
  };
}

function recountJob(jobId: string, status?: GenerationJobStatus, error?: string | null) {
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
      COUNT(*) as expectedCount
    FROM generation_job_items
    WHERE job_id = ?
  `).get(jobId) as { completedCount?: number; failedCount?: number; expectedCount?: number };
  const completedCount = Number(counts.completedCount || 0);
  const failedCount = Number(counts.failedCount || 0);
  const expectedCount = Number(counts.expectedCount || 0);
  const nextStatus = status || (
    completedCount + failedCount >= expectedCount
      ? failedCount > 0
        ? completedCount > 0 ? 'partial_failed' : 'failed'
        : 'completed'
      : 'running'
  );
  db.prepare(`
    UPDATE generation_jobs
    SET status = @status,
        expected_count = @expectedCount,
        completed_count = @completedCount,
        failed_count = @failedCount,
        error = @error,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: jobId,
    status: nextStatus,
    expectedCount,
    completedCount,
    failedCount,
    error: error || null,
    updatedAt: new Date().toISOString(),
  });
}

export const generationRepository = {
  listIncompleteImageJobs() {
    const rows = db.prepare(`
      SELECT
        id,
        user_id as userId,
        kind,
        source_module as sourceModule,
        conversation_id as conversationId,
        user_message_id as userMessageId,
        assistant_message_id as assistantMessageId,
        status,
        expected_count as expectedCount,
        completed_count as completedCount,
        failed_count as failedCount,
        payload,
        result,
        error,
        created_at as createdAt,
        updated_at as updatedAt
      FROM generation_jobs
      WHERE kind = 'image'
        AND status IN ('queued', 'running')
      ORDER BY created_at ASC
    `).all() as GenerationJobRow[];
    return rows.map(parseJob);
  },

  createJob(input: {
    userId: string;
    kind: GenerationJob['kind'];
    sourceModule: string;
    conversationId?: string | null;
    userMessageId?: string | null;
    assistantMessageId?: string | null;
    expectedCount: number;
    payload?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: randomBytes(12).toString('hex'),
      userId: input.userId,
      kind: input.kind,
      sourceModule: input.sourceModule,
      conversationId: input.conversationId || null,
      userMessageId: input.userMessageId || null,
      assistantMessageId: input.assistantMessageId || null,
      status: 'queued',
      expectedCount: Math.max(1, input.expectedCount),
      completedCount: 0,
      failedCount: 0,
      payload: input.payload || {},
      result: {},
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(`
      INSERT INTO generation_jobs (
        id, user_id, kind, source_module, conversation_id, user_message_id, assistant_message_id,
        status, expected_count, completed_count, failed_count, payload, result, error, created_at, updated_at
      )
      VALUES (
        @id, @userId, @kind, @sourceModule, @conversationId, @userMessageId, @assistantMessageId,
        @status, @expectedCount, @completedCount, @failedCount, @payload, @result, @error, @createdAt, @updatedAt
      )
    `).run(serializeJob(job));
    const itemQuery = db.prepare(`
      INSERT INTO generation_job_items (
        id, job_id, slot_index, status, input, attachment_id, error, started_at, completed_at, updated_at
      )
      VALUES (
        @id, @jobId, @slotIndex, @status, @input, @attachmentId, @error, @startedAt, @completedAt, @updatedAt
      )
    `);
    const transaction = db.transaction(() => {
      Array.from({ length: job.expectedCount }, (_, slotIndex) => {
        itemQuery.run(serializeJobItem({
          id: randomBytes(12).toString('hex'),
          jobId: job.id,
          slotIndex,
          status: 'queued',
          input: {},
          attachmentId: null,
          error: null,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        }));
      });
    });
    transaction();
    return job;
  },

  findJob(id: string) {
    const row = db.prepare(`
      SELECT
        id,
        user_id as userId,
        kind,
        source_module as sourceModule,
        conversation_id as conversationId,
        user_message_id as userMessageId,
        assistant_message_id as assistantMessageId,
        status,
        expected_count as expectedCount,
        completed_count as completedCount,
        failed_count as failedCount,
        payload,
        result,
        error,
        created_at as createdAt,
        updated_at as updatedAt
      FROM generation_jobs
      WHERE id = ?
    `).get(id) as GenerationJobRow | undefined;
    return row ? parseJob(row) : undefined;
  },

  listItems(jobId: string) {
    const rows = db.prepare(`
      SELECT
        id,
        job_id as jobId,
        slot_index as slotIndex,
        status,
        input,
        attachment_id as attachmentId,
        error,
        started_at as startedAt,
        completed_at as completedAt,
        updated_at as updatedAt
      FROM generation_job_items
      WHERE job_id = ?
      ORDER BY slot_index ASC
    `).all(jobId) as GenerationJobItemRow[];
    return rows.map(parseJobItem);
  },

  markJobRunning(jobId: string) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE generation_jobs
      SET status = 'running', updated_at = ?
      WHERE id = ?
    `).run(now, jobId);
    db.prepare(`
      UPDATE generation_job_items
      SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE job_id = ? AND status = 'queued'
    `).run(now, now, jobId);
    return this.findJob(jobId);
  },

  updateItem(input: {
    jobId: string;
    slotIndex: number;
    status: GenerationJobItemStatus;
    attachmentId?: string | null;
    error?: string | null;
  }) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE generation_job_items
      SET status = @status,
          attachment_id = @attachmentId,
          error = @error,
          started_at = COALESCE(started_at, @updatedAt),
          completed_at = CASE WHEN @status IN ('completed', 'failed') THEN @updatedAt ELSE completed_at END,
          updated_at = @updatedAt
      WHERE job_id = @jobId AND slot_index = @slotIndex
    `).run({
      jobId: input.jobId,
      slotIndex: input.slotIndex,
      status: input.status,
      attachmentId: input.attachmentId || null,
      error: input.error || null,
      updatedAt: now,
    });
    recountJob(input.jobId);
    return this.findJob(input.jobId);
  },

  finalizeJob(input: {
    jobId: string;
    status?: GenerationJobStatus;
    result?: Record<string, unknown>;
    error?: string | null;
  }) {
    recountJob(input.jobId, input.status, input.error);
    if (input.result) {
      db.prepare(`
        UPDATE generation_jobs
        SET result = @result, updated_at = @updatedAt
        WHERE id = @id
      `).run({
        id: input.jobId,
        result: JSON.stringify(input.result),
        updatedAt: new Date().toISOString(),
      });
    }
    return this.findJob(input.jobId);
  },
};
