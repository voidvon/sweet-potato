import { db } from '../../db/database.js';

export const ipBlacklistRepository = {
  list() {
    const rows = db.prepare(`
      SELECT rule FROM ip_blacklist_entries ORDER BY created_at ASC, rule ASC
    `).all() as Array<{ rule: string }>;
    return rows.map((row) => row.rule);
  },

  replace(rules: string[]) {
    const replaceEntries = db.transaction((nextRules: string[]) => {
      db.prepare('DELETE FROM ip_blacklist_entries').run();
      const insert = db.prepare(`
        INSERT INTO ip_blacklist_entries (rule, created_at) VALUES (?, ?)
      `);
      const now = new Date().toISOString();
      for (const rule of nextRules) insert.run(rule, now);
    });
    replaceEntries(rules);
    return rules;
  },
};
