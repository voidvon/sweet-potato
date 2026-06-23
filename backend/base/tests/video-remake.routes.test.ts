import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('video-remake routes expose run/resume/regenerate/cancel/events workflow', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-routes-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  const fixturePath = path.join(tempRoot, 'route-fixture.mp4');
  writeFileSync(fixturePath, Buffer.from('route-fixture'));
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [{ createApp }, { migrateDatabase }] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/schema.js'),
    ]);
    migrateDatabase();

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-route', filename: 'route-fixture.mp4' }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as { id: string };
    assert.ok(created.id);

    const form = new FormData();
    form.set('userId', 'user-route');
    form.set('file', new Blob([Buffer.from('route-fixture')], { type: 'video/mp4' }), 'route-fixture.mp4');
    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(uploadResponse.status, 201);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/run`, {
      method: 'POST',
    });
    assert.equal(runResponse.status, 200);
    const runSession = await runResponse.json() as { messages: Array<Record<string, unknown>> };
    const basicCard = runSession.messages.find((message) => message.type === 'card' && message.cardType === 'basic_info') as { cardId: string; data: unknown } | undefined;
    assert.ok(basicCard);

    const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/cards/${basicCard!.cardId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-route',
        cardType: 'basic_info',
        data: basicCard!.data,
      }),
    });
    assert.equal(confirmResponse.status, 200);

    const chatResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-route', message: '重新生成分镜' }),
    });
    assert.equal(chatResponse.status, 200);

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions`);
    assert.equal(listResponse.status, 200);
    const sessionList = await listResponse.json() as Array<Record<string, unknown>>;
    assert.ok(sessionList.length > 0);
    assert.equal('messages' in sessionList[0], false);
    assert.equal('events' in sessionList[0], false);

    const resumeResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/resume`, {
      method: 'POST',
    });
    assert.equal(resumeResponse.status, 200);

    const regenerateResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/cards/${basicCard!.cardId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-route',
        cardType: 'voice_audio_setting',
        instruction: '声音换成更有情绪的女声',
      }),
    });
    assert.equal(regenerateResponse.status, 200);

    const eventsResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/events?userId=user-route&afterIndex=0`);
    assert.equal(eventsResponse.status, 200);
    const eventsPayload = await eventsResponse.json() as { events: Array<{ event?: { type?: string } }>; nextIndex: number };
    assert.ok(eventsPayload.events.length > 0);
    assert.equal(typeof eventsPayload.nextIndex, 'number');

    const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/video-remake/sessions/${created.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-route' }),
    });
    assert.equal(cancelResponse.status, 200);
    const cancelled = await cancelResponse.json() as { status: string };
    assert.equal(cancelled.status, 'cancelled');
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
