import { db } from '../../db/database.js';

export type RateLimitRuleRecord = {
  id: string;
  urlPattern: string;
  maxRequests: number;
  intervalSeconds: number;
  targetUser: 'all' | 'authenticated' | 'anonymous';
  createdAt: string;
  updatedAt: string;
};

export const rateLimitSettingsRepository = {
  list() {
    return db.prepare(`
      SELECT
        id,
        url_pattern AS urlPattern,
        max_requests AS maxRequests,
        interval_seconds AS intervalSeconds,
        target_user AS targetUser,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM rate_limit_rules
      ORDER BY created_at ASC, id ASC
    `).all() as RateLimitRuleRecord[];
  },

  replace(rules: RateLimitRuleRecord[]) {
    const transaction = db.transaction((nextRules: RateLimitRuleRecord[]) => {
      db.prepare('DELETE FROM rate_limit_rules').run();
      const insert = db.prepare(`
        INSERT INTO rate_limit_rules (
          id, url_pattern, max_requests, interval_seconds, target_user, created_at, updated_at
        ) VALUES (
          @id, @urlPattern, @maxRequests, @intervalSeconds, @targetUser, @createdAt, @updatedAt
        )
      `);
      for (const rule of nextRules) insert.run(rule);
    });
    transaction(rules);
    return rules;
  },
};
