import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

async function waitFor<T>(read: () => T, accept: (value: T) => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = read();
  }
  return value;
}

test('duplicate uploaded video reuses VOD Vid but creates a fresh task id', async (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'upload-parse-reuse-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  let appServer: ReturnType<ReturnType<typeof createServer>['listen']> | null = null;

  const worker = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '';
    if (req.method === 'POST' && url === '/vod/upload') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        vid: 'vid-reused-001',
        spaceName: 'space-A',
        requestId: 'req-upload-1',
        sourceInfo: {
          fileName: 'same-video.mp4',
          width: 1080,
          height: 1920,
          duration: 12,
        },
      }));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/vod/upload/progress')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ progress: 100, message: 'done' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: `Unhandled ${req.method} ${url}` }));
  });

  worker.listen(0, '127.0.0.1');
  await once(worker, 'listening');
  const workerPort = (worker.address() as AddressInfo).port;

  try {
    process.env.DATA_DIR = dataDir;
    process.env.PYTHON_AI_WORKER_URL = `http://127.0.0.1:${workerPort}`;
    process.env.CONTENT_PUBLIC_BASE_URL = 'http://127.0.0.1:1';

    const [{ createApp }, { contentRepository }] = await Promise.all([
      import('../src/app.js'),
      import('../src/modules/content/content.repository.js'),
    ]);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const appPort = (appServer.address() as AddressInfo).port;
    const filePath = path.join(tempRoot, 'same-video.mp4');
    writeFileSync(filePath, Buffer.from('same-video-binary'));

    const postUpload = async () => {
      const form = new FormData();
      form.set('userId', 'user-dup-test');
      form.set('file', new Blob([Buffer.from('same-video-binary')], { type: 'video/mp4' }), 'same-video.mp4');
      const response = await fetch(`http://127.0.0.1:${appPort}/api/content/video-tasks/upload-parse`, {
        method: 'POST',
        body: form,
      });
      assert.equal(response.status, 201);
      return response.json() as Promise<{
        task: { id: string; expertContext?: Record<string, unknown> };
        vod: { vid: string };
      }>;
    };

    await t.test('first upload creates initial task', async () => {
      const first = await postUpload();
      assert.ok(first.task.id);
      const firstTask = await waitFor(
        () => contentRepository.findVideoTask(first.task.id),
        (task) => Boolean(task?.expertContext?.vod && (task.expertContext.vod as Record<string, unknown>).vid),
      );
      assert.ok(firstTask);
      const uploadedVideo = firstTask?.expertContext?.uploadedVideo as Record<string, unknown> | undefined;
      const vod = firstTask?.expertContext?.vod as Record<string, unknown> | undefined;
      assert.equal(vod?.vid, 'vid-reused-001');
      assert.equal(uploadedVideo?.reusedFromTaskId, '');
      assert.equal(uploadedVideo?.reusedReason, '');
    });

    await t.test('second upload creates a new task while reusing vid metadata', async () => {
      const existing = contentRepository.listVideoTasks('user-dup-test');
      assert.equal(existing.length, 1);
      const firstTaskId = existing[0]?.id || '';

      const second = await postUpload();
      assert.ok(second.task.id);
      assert.notEqual(second.task.id, firstTaskId);
      assert.equal(second.vod.vid, 'vid-reused-001');

      const allTasks = contentRepository.listVideoTasks('user-dup-test');
      assert.equal(allTasks.length, 2);

      const secondTask = contentRepository.findVideoTask(second.task.id);
      assert.ok(secondTask);
      const uploadedVideo = secondTask?.expertContext?.uploadedVideo as Record<string, unknown> | undefined;
      assert.equal(uploadedVideo?.reusedFromTaskId, firstTaskId);
      assert.equal(uploadedVideo?.reusedReason, 'sha256');
    });
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    worker.closeAllConnections?.();
    worker.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
