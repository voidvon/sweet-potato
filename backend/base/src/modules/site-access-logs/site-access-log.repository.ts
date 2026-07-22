import { db } from '../../db/database.js';

export type SiteAccessLogRecord = {
  ip: string;
  method: string;
  path: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  accessedAt: string;
};

type AggregatedLogRow = {
  id: string;
  ip: string;
  method: string;
  path: string;
  user_agent: string;
  access_count: number;
  last_accessed_at: string;
  last_status_code: number;
  average_duration_ms: number;
};

function ensureSettings() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO site_access_log_settings (id, retention_days, updated_at)
    VALUES ('default', 7, ?)
  `).run(now);
}

export const siteAccessLogRepository = {
  create(record: SiteAccessLogRecord) {
    db.prepare(`
      INSERT INTO site_access_logs (
        ip, method, path, user_agent, status_code, duration_ms, accessed_at
      ) VALUES (
        @ip, @method, @path, @userAgent, @statusCode, @durationMs, @accessedAt
      )
    `).run(record);
  },

  list(input: { page: number; pageSize: number }) {
    const offset = (input.page - 1) * input.pageSize;
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM site_access_logs GROUP BY ip, method, path, user_agent
      )
    `).get() as { total: number };
    const rows = db.prepare(`
      SELECT
        ip || ':' || method || ':' || path || ':' || user_agent AS id,
        ip,
        method,
        path,
        user_agent,
        COUNT(*) AS access_count,
        MAX(accessed_at) AS last_accessed_at,
        CAST(AVG(duration_ms) AS INTEGER) AS average_duration_ms,
        (
          SELECT latest.status_code
          FROM site_access_logs latest
          WHERE latest.ip = site_access_logs.ip
            AND latest.method = site_access_logs.method
            AND latest.path = site_access_logs.path
            AND latest.user_agent = site_access_logs.user_agent
          ORDER BY latest.accessed_at DESC, latest.id DESC
          LIMIT 1
        ) AS last_status_code
      FROM site_access_logs
      GROUP BY ip, method, path, user_agent
      ORDER BY last_accessed_at DESC
      LIMIT @pageSize OFFSET @offset
    `).all({ pageSize: input.pageSize, offset }) as AggregatedLogRow[];

    return {
      items: rows.map((row) => ({
        id: row.id,
        ip: row.ip,
        method: row.method,
        path: row.path,
        userAgent: row.user_agent,
        accessCount: Number(row.access_count),
        lastAccessedAt: row.last_accessed_at,
        lastStatusCode: Number(row.last_status_code),
        averageDurationMs: Number(row.average_duration_ms),
      })),
      page: input.page,
      pageSize: input.pageSize,
      total: Number(totalRow.total),
    };
  },

  getSettings() {
    ensureSettings();
    const row = db.prepare(`
      SELECT retention_days FROM site_access_log_settings WHERE id = 'default'
    `).get() as { retention_days: number };
    return { retentionDays: Number(row.retention_days) };
  },

  updateSettings(retentionDays: number) {
    ensureSettings();
    db.prepare(`
      UPDATE site_access_log_settings
      SET retention_days = ?, updated_at = ?
      WHERE id = 'default'
    `).run(retentionDays, new Date().toISOString());
    return { retentionDays };
  },

  deleteExpired(cutoff: string) {
    return db.prepare('DELETE FROM site_access_logs WHERE accessed_at < ?').run(cutoff).changes;
  },
};
