import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('talking video resume stream returns 410 when the backend registry no longer has the task', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'talking-video-routes-missing-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { db },
      { migrateDatabase },
      { createUser, createToken },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/database.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
    ]);

    migrateDatabase();
    const user = createUser(`talking-video-owner-${randomBytes(4).toString('hex')}`, 'password123', 'Talking Video Owner');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id);
    const token = createToken({ ...user, role: 'admin' });

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${port}/api/talking-video/prompt/tasks/missing-after-restart/stream`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assert.equal(response.status, 410);
    assert.match(response.headers.get('content-type') || '', /application\/json/u);
    const payload = await response.json() as { message: string };
    assert.equal(payload.message, '口播任务已失效，请点击继续重新生成');
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('talking video resume stream preserves tasks that still exist in the backend registry', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'talking-video-routes-existing-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { db },
      { migrateDatabase },
      { createUser, createToken },
      { startTalkingVideoTask },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/database.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/talking-video/talking-video-task-runtime.js'),
    ]);

    migrateDatabase();
    const user = createUser(`talking-video-owner-${randomBytes(4).toString('hex')}`, 'password123', 'Talking Video Owner');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', user.id);
    const token = createToken({ ...user, role: 'admin' });
    const taskId = `talking-video-existing-${randomBytes(4).toString('hex')}`;

    startTalkingVideoTask({
      taskId,
      userId: user.id,
      deepThink: true,
      images: [{ filePath: '/tmp/model.png', filename: 'model.png', mimeType: 'image/png', role: 'model' as const }],
      video: { filePath: '/tmp/source.mp4', filename: 'source.mp4', mimeType: 'video/mp4' },
      runAgent: (async () => ({
        analysis: {
          durationSeconds: 14,
          summary: '测试',
          visualStyle: '写实',
          finalPrompt: '分段A',
          presentationLayout: {
            type: 'full_screen_presenter' as const,
            mainVisualRole: '讲解者',
            presenterPlacement: '居中',
            persistence: '全程',
          },
          videoStructure: { isContinuousTake: true, shotBoundaryReason: '固定机位' },
          presenter: { identity: '讲解者', expressionStyle: '自然', performanceStyle: '稳定' },
          shots: [{
            startSecond: 0,
            endSecond: 14,
            shotSize: '近景',
            visual: '讲解者面对镜头口播',
            dialogue: '测试台词',
            performance: '自然讲解',
            shootingNotes: '固定机位',
          }],
          imageReferences: [],
        },
        prompt: '分段A',
        reasoning: '测试审片记录',
        metrics: {
          arkUploadCount: 0,
          arkUploadPollMs: 0,
          understandingModelCalls: 1,
          understandingReplayCalls: 0,
          formatRepairCalls: 0,
          promptRepairCalls: 0,
          reuseCacheHitCount: 0,
        },
      })) as never,
    });
    await new Promise((resolve) => setImmediate(resolve));

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${port}/api/talking-video/prompt/tasks/${taskId}/stream`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/u);
    const text = await response.text();
    assert.match(text, /"type":"snapshot"/u);
    assert.match(text, /"status":"completed"/u);
    assert.match(text, new RegExp(`"taskId":"${taskId}"`, 'u'));
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('talking video history import and query persist the latest tasks per user', async () => {
  const [
    { createApp },
    { db },
    { migrateDatabase },
    { createUser, createToken },
    { contentRepository },
  ] = await Promise.all([
    import('../src/app.js'),
    import('../src/db/database.js'),
    import('../src/db/schema.js'),
    import('../src/modules/users/user.service.js'),
    import('../src/modules/content/content.repository.js'),
  ]);
  migrateDatabase();
  const suffix = randomBytes(4).toString('hex');
  const user = createUser(`talking-history-${suffix}`, 'password123', 'Talking History Owner');
  const otherUser = createUser(`talking-history-other-${suffix}`, 'password123', 'Other Owner');
  db.prepare('UPDATE users SET role = ? WHERE id IN (?, ?)').run('admin', user.id, otherUser.id);
  const token = createToken({ ...user, role: 'admin' });
  const otherToken = createToken({ ...otherUser, role: 'admin' });
  const group = contentRepository.createGroup({
    userId: user.id,
    resourceType: 'other',
    name: `talking-history-${suffix}`,
  });
  assert.ok(group);
  const video = contentRepository.createAsset({
    userId: user.id,
    groupId: group.id,
    resourceType: 'other',
    name: 'source.mp4',
    originalFileName: 'source.mp4',
    storedFileName: `${suffix}-source.mp4`,
    mimeType: 'video/mp4',
    fileSize: 128,
    filePath: `/tmp/${suffix}-source.mp4`,
    fileUrl: `/files/${suffix}-source.mp4`,
  });
  const image = contentRepository.createAsset({
    userId: user.id,
    groupId: group.id,
    resourceType: 'other',
    name: 'model.png',
    originalFileName: 'model.png',
    storedFileName: `${suffix}-model.png`,
    mimeType: 'image/png',
    fileSize: 64,
    filePath: `/tmp/${suffix}-model.png`,
    fileUrl: `/files/${suffix}-model.png`,
  });
  assert.ok(video);
  assert.ok(image);

  const appServer = createApp().listen(0, '127.0.0.1');
  try {
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;
    const taskId = `history-task-${suffix}`;
    const importResponse = await fetch(`http://127.0.0.1:${port}/api/talking-video/prompt/history/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: [{
          id: taskId,
          status: 'completed',
          phase: 'completed',
          reasoning: '视频内容分析：测试',
          prompt: '服务端历史提示词',
          errorMessage: '',
          metrics: { understandingModelCalls: 1 },
          serverTimings: { t_result_ms: 1234 },
          sourceVideo: { assetId: video.id },
          referenceImages: [{ assetId: image.id, talkingVideoRole: 'model' }],
          createdAt: '2026-07-21T01:02:03.000Z',
        }],
      }),
    });
    assert.equal(importResponse.status, 200);

    const historyResponse = await fetch(`http://127.0.0.1:${port}/api/talking-video/prompt/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as { tasks: Array<Record<string, any>> };
    assert.equal(history.tasks[0]?.id, taskId);
    assert.equal(history.tasks[0]?.prompt, '服务端历史提示词');
    assert.equal(history.tasks[0]?.sourceVideo?.assetId, video.id);
    assert.equal(history.tasks[0]?.referenceImages?.[0]?.talkingVideoRole, 'model');

    const otherHistoryResponse = await fetch(`http://127.0.0.1:${port}/api/talking-video/prompt/history`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    const otherHistory = await otherHistoryResponse.json() as { tasks: unknown[] };
    assert.equal(otherHistory.tasks.length, 0);
  } finally {
    appServer.closeAllConnections?.();
    appServer.close();
  }
});
