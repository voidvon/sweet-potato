import { db } from '../../db/database.js';

export type TalkingVideoHistoryMaterial = {
  assetId: string;
  id: string;
  type: 'image' | 'video';
  name: string;
  url: string;
  serverFileUrl: string;
  storedFileName?: string;
  talkingVideoRole?: 'model' | 'product' | 'background' | 'detail';
};

export type TalkingVideoHistoryRecord = {
  id: string;
  status: 'thinking' | 'completed' | 'failed' | 'stopped';
  phase: 'uploading_assets' | 'understanding_video' | 'validating_analysis' | 'generating_prompt' | 'validating_prompt' | 'repairing_prompt' | 'completed' | 'failed' | 'stopped';
  reasoning: string;
  prompt: string;
  errorMessage: string;
  metrics: Record<string, number>;
  serverTimings: Record<string, number>;
  sourceVideo: TalkingVideoHistoryMaterial;
  referenceImages: TalkingVideoHistoryMaterial[];
  deepThink: boolean;
  createdAt: string;
  updatedAt: string;
};

type TalkingVideoHistoryRow = {
  id: string;
  user_id: string;
  status: TalkingVideoHistoryRecord['status'];
  phase: TalkingVideoHistoryRecord['phase'];
  reasoning: string;
  prompt: string;
  error_message: string;
  metrics: string;
  server_timings: string;
  source_video: string;
  reference_images: string;
  deep_think: number;
  created_at: string;
  updated_at: string;
};

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS talking_video_prompt_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      metrics TEXT NOT NULL DEFAULT '{}',
      server_timings TEXT NOT NULL DEFAULT '{}',
      source_video TEXT NOT NULL DEFAULT '{}',
      reference_images TEXT NOT NULL DEFAULT '[]',
      deep_think INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_talking_video_prompt_history_user_created
      ON talking_video_prompt_history(user_id, created_at DESC);
  `);
}

ensureSchema();

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serialize(row: TalkingVideoHistoryRow): TalkingVideoHistoryRecord {
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    reasoning: row.reasoning || '',
    prompt: row.prompt || '',
    errorMessage: row.error_message || '',
    metrics: parseJson(row.metrics, {}),
    serverTimings: parseJson(row.server_timings, {}),
    sourceVideo: parseJson(row.source_video, {} as TalkingVideoHistoryMaterial),
    referenceImages: parseJson(row.reference_images, []),
    deepThink: row.deep_think !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function values(userId: string, record: TalkingVideoHistoryRecord) {
  return {
    id: record.id,
    userId,
    status: record.status,
    phase: record.phase,
    reasoning: record.reasoning || '',
    prompt: record.prompt || '',
    errorMessage: record.errorMessage || '',
    metrics: JSON.stringify(record.metrics || {}),
    serverTimings: JSON.stringify(record.serverTimings || {}),
    sourceVideo: JSON.stringify(record.sourceVideo || {}),
    referenceImages: JSON.stringify(record.referenceImages || []),
    deepThink: record.deepThink ? 1 : 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function pruneUser(userId: string, limit = 10) {
  db.prepare(`
    DELETE FROM talking_video_prompt_history
    WHERE user_id = @userId
      AND id NOT IN (
        SELECT id FROM talking_video_prompt_history
        WHERE user_id = @userId
        ORDER BY created_at DESC, updated_at DESC
        LIMIT @limit
      )
  `).run({ userId, limit });
}

export const talkingVideoHistoryRepository = {
  listByUser(userId: string, limit = 10) {
    const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit || 10)));
    const rows = db.prepare(`
      SELECT * FROM talking_video_prompt_history
      WHERE user_id = ?
      ORDER BY created_at DESC, updated_at DESC
      LIMIT ?
    `).all(userId, safeLimit) as TalkingVideoHistoryRow[];
    return rows.map(serialize);
  },

  upsert(userId: string, record: TalkingVideoHistoryRecord) {
    db.prepare(`
      INSERT INTO talking_video_prompt_history (
        id, user_id, status, phase, reasoning, prompt, error_message,
        metrics, server_timings, source_video, reference_images, deep_think,
        created_at, updated_at
      ) VALUES (
        @id, @userId, @status, @phase, @reasoning, @prompt, @errorMessage,
        @metrics, @serverTimings, @sourceVideo, @referenceImages, @deepThink,
        @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        status = excluded.status,
        phase = excluded.phase,
        reasoning = excluded.reasoning,
        prompt = excluded.prompt,
        error_message = excluded.error_message,
        metrics = excluded.metrics,
        server_timings = excluded.server_timings,
        source_video = excluded.source_video,
        reference_images = excluded.reference_images,
        deep_think = excluded.deep_think,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      WHERE talking_video_prompt_history.user_id = excluded.user_id
    `).run(values(userId, record));
    pruneUser(userId);
    return this.findById(userId, record.id);
  },

  insertIfMissing(userId: string, record: TalkingVideoHistoryRecord) {
    db.prepare(`
      INSERT OR IGNORE INTO talking_video_prompt_history (
        id, user_id, status, phase, reasoning, prompt, error_message,
        metrics, server_timings, source_video, reference_images, deep_think,
        created_at, updated_at
      ) VALUES (
        @id, @userId, @status, @phase, @reasoning, @prompt, @errorMessage,
        @metrics, @serverTimings, @sourceVideo, @referenceImages, @deepThink,
        @createdAt, @updatedAt
      )
    `).run(values(userId, record));
    pruneUser(userId);
  },

  findById(userId: string, id: string) {
    const row = db.prepare(`
      SELECT * FROM talking_video_prompt_history
      WHERE id = ? AND user_id = ?
    `).get(id, userId) as TalkingVideoHistoryRow | undefined;
    return row ? serialize(row) : null;
  },

  updateState(userId: string, id: string, patch: Pick<TalkingVideoHistoryRecord,
    'status' | 'phase' | 'reasoning' | 'prompt' | 'errorMessage' | 'metrics' | 'serverTimings'>) {
    db.prepare(`
      UPDATE talking_video_prompt_history
      SET status = @status,
          phase = @phase,
          reasoning = @reasoning,
          prompt = @prompt,
          error_message = @errorMessage,
          metrics = @metrics,
          server_timings = @serverTimings,
          updated_at = @updatedAt
      WHERE id = @id AND user_id = @userId
    `).run({
      id,
      userId,
      status: patch.status,
      phase: patch.phase,
      reasoning: patch.reasoning || '',
      prompt: patch.prompt || '',
      errorMessage: patch.errorMessage || '',
      metrics: JSON.stringify(patch.metrics || {}),
      serverTimings: JSON.stringify(patch.serverTimings || {}),
      updatedAt: new Date().toISOString(),
    });
  },
};
