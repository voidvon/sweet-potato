import { db } from '../../db/database.js';

export type SiteAccessLogRecord = {
  ip: string;
  userId: string;
  username: string;
  method: string;
  path: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  accessedAt: string;
};

type SiteAccessLogRow = {
  id: number;
  ip: string;
  user_id: string;
  username: string;
  method: string;
  path: string;
  user_agent: string;
  access_count: number;
  accessed_at: string;
  status_code: number;
  duration_ms: number;
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
        ip, user_id, username, method, path, user_agent, status_code, duration_ms, accessed_at
      ) VALUES (
        @ip, @userId, @username, @method, @path, @userAgent, @statusCode, @durationMs, @accessedAt
      )
    `).run(record);
  },

  list(input: { page: number; pageSize: number; ip: string; username: string; method: string }) {
    const offset = (input.page - 1) * input.pageSize;
    const params = {
      ip: input.ip,
      username: input.username,
      usernamePattern: `%${input.username.toLowerCase()}%`,
      method: input.method,
      pageSize: input.pageSize,
      offset,
    };
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total
      FROM site_access_logs
      WHERE (@ip = '' OR ip = @ip)
        AND (@username = '' OR LOWER(username) LIKE @usernamePattern)
        AND (@method = '' OR method = @method)
    `).get(params) as { total: number };
    const rows = db.prepare(`
      SELECT * FROM (
        SELECT
          id,
          ip,
          user_id,
          username,
          method,
          path,
          user_agent,
          status_code,
          duration_ms,
          accessed_at,
          COUNT(*) OVER (
            PARTITION BY ip
            ORDER BY accessed_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS access_count
        FROM site_access_logs
      ) detailed_logs
      WHERE (@ip = '' OR ip = @ip)
        AND (@username = '' OR LOWER(username) LIKE @usernamePattern)
        AND (@method = '' OR method = @method)
      ORDER BY accessed_at DESC, id DESC
      LIMIT @pageSize OFFSET @offset
    `).all(params) as SiteAccessLogRow[];

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        ip: row.ip,
        userId: row.user_id,
        username: row.username,
        method: row.method,
        path: row.path,
        userAgent: row.user_agent,
        accessCount: Number(row.access_count),
        accessedAt: row.accessed_at,
        statusCode: Number(row.status_code),
        durationMs: Number(row.duration_ms),
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
