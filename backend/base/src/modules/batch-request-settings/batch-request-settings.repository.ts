import { db } from '../../db/database.js';

export type BatchRequestSettingsRecord = {
  maxCount: number;
  maxDurationSeconds: number;
  maxFileSizeMb: number;
};

function ensureSettings() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO batch_request_settings (
      id, max_count, max_duration_seconds, max_file_size_mb, updated_at
    ) VALUES (
      'default', 20, 300, 100, ?
    )
  `).run(now);
}

export const batchRequestSettingsRepository = {
  get() {
    ensureSettings();
    const row = db.prepare(`
      SELECT max_count, max_duration_seconds, max_file_size_mb
      FROM batch_request_settings
      WHERE id = 'default'
    `).get() as {
      max_count: number;
      max_duration_seconds: number;
      max_file_size_mb: number;
    };
    return {
      maxCount: Number(row.max_count),
      maxDurationSeconds: Number(row.max_duration_seconds),
      maxFileSizeMb: Number(row.max_file_size_mb),
    } satisfies BatchRequestSettingsRecord;
  },

  update(input: BatchRequestSettingsRecord) {
    ensureSettings();
    db.prepare(`
      UPDATE batch_request_settings
      SET
        max_count = @maxCount,
        max_duration_seconds = @maxDurationSeconds,
        max_file_size_mb = @maxFileSizeMb,
        updated_at = @updatedAt
      WHERE id = 'default'
    `).run({
      ...input,
      updatedAt: new Date().toISOString(),
    });
    return input;
  },
};
