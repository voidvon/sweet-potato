import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Server } from 'node:http';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { dataDir } from '../src/db/database.js';

test('static files are cached for 30 days', async () => {
  const filesDir = path.join(dataDir, 'files');
  const fileName = 'static-cache-test.txt';
  mkdirSync(filesDir, { recursive: true });
  writeFileSync(path.join(filesDir, fileName), 'cache me');

  const server = await new Promise<Server>((resolve) => {
    const appServer = createApp().listen(0, '127.0.0.1', () => resolve(appServer));
  });

  try {
    const address = server.address();
    assert(address && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/files/${fileName}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=2592000');
    assert.equal(await response.text(), 'cache me');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
