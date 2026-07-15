import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('route resource migration repairs legacy defaults once and then preserves admin-managed sorting', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'route-resource-seeding-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;
    const [{ migrateDatabase }, { db }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/db/database.js'),
    ]);

    migrateDatabase();

    const readSortOrder = db.prepare(`
      SELECT sort_order AS sortOrder
      FROM route_resources
      WHERE resource_key = ?
    `);
    assert.equal((readSortOrder.get('web.root.content') as { sortOrder: number }).sortOrder, 10);
    assert.equal((readSortOrder.get('web.module.chat') as { sortOrder: number }).sortOrder, 20);

    db.prepare(`
      DELETE FROM app_migrations
      WHERE id = '20260714-sidebar-material-before-image'
    `).run();
    db.prepare(`
      UPDATE route_resources
      SET sort_order = CASE resource_key
        WHEN 'web.root.content' THEN 20
        WHEN 'web.module.chat' THEN 10
        ELSE sort_order
      END
      WHERE resource_key IN ('web.root.content', 'web.module.chat')
    `).run();

    migrateDatabase();

    assert.equal((readSortOrder.get('web.root.content') as { sortOrder: number }).sortOrder, 10);
    assert.equal((readSortOrder.get('web.module.chat') as { sortOrder: number }).sortOrder, 20);

    db.prepare(`
      UPDATE route_resources
      SET sort_order = CASE resource_key
        WHEN 'web.root.content' THEN 35
        WHEN 'web.module.chat' THEN 15
        ELSE sort_order
      END
      WHERE resource_key IN ('web.root.content', 'web.module.chat')
    `).run();

    migrateDatabase();

    assert.equal((readSortOrder.get('web.root.content') as { sortOrder: number }).sortOrder, 35);
    assert.equal((readSortOrder.get('web.module.chat') as { sortOrder: number }).sortOrder, 15);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
