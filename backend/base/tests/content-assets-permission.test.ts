import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('create_video permission can read the current user\'s finished videos', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'content-assets-permission-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { migrateDatabase },
      { createUser, createToken },
      { contentRepository },
      { roleRepository },
      { routeResourceRepository },
      { userRepository },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/content/content.repository.js'),
      import('../src/modules/roles/role.repository.js'),
      import('../src/modules/route-resources/route-resource.repository.js'),
      import('../src/modules/users/user.repository.js'),
    ]);

    migrateDatabase();
    const { createApp } = await import('../src/app.js');
    const user = createUser('content-reader', 'password123', 'Content Reader');
    const roleId = roleRepository.create({
      key: 'video-creator',
      name: 'Video Creator',
      description: 'Can create videos',
    });
    const createVideoResource = routeResourceRepository.findByPermissionCode('web.module.content.create_video');
    assert.ok(createVideoResource);
    roleRepository.replaceResourceGrants(roleId, [createVideoResource.id]);
    userRepository.updateRoleAssignments(user.id, [roleId]);

    const group = contentRepository.createGroup({
      userId: user.id,
      resourceType: 'finished_video',
      name: 'Finished videos',
    });
    assert.ok(group);
    const asset = contentRepository.createAsset({
      userId: user.id,
      groupId: group.id,
      resourceType: 'finished_video',
      name: 'Finished video',
      originalFileName: 'finished.mp4',
      storedFileName: 'finished.mp4',
      mimeType: 'video/mp4',
      fileSize: 1,
      filePath: '/tmp/finished.mp4',
      fileUrl: '/files/finished.mp4',
      metadata: {},
    });
    assert.ok(asset);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/content/assets?resourceType=finished_video`, {
      headers: { Authorization: `Bearer ${createToken(user)}` },
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as Array<{ id: string }>;
    assert.deepEqual(payload.map((item) => item.id), [asset.id]);
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
