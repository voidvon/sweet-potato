import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

function makeTempDataDir(prefix: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  return { tempRoot, dataDir };
}

type OpenSseStream = {
  controller: AbortController;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

function promoteToAdmin(db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }, userId: string) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', userId);
}

function parseSseChunk(chunk: string) {
  let type = 'message';
  const dataLines: string[] = [];

  chunk.split('\n').forEach((line) => {
    if (!line || line.startsWith(':')) {
      return;
    }
    if (line.startsWith('event:')) {
      type = line.slice('event:'.length).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  });

  if (!dataLines.length) {
    return null;
  }

  return {
    type,
    data: JSON.parse(dataLines.join('\n')) as Record<string, unknown>,
  };
}

async function openSseStream(url: string, token: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.ok(response.body);

  return {
    controller,
    reader: response.body.getReader(),
    decoder: new TextDecoder(),
    buffer: '',
  } satisfies OpenSseStream;
}

async function readNextSseEvent(stream: OpenSseStream, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    while (true) {
      const separatorIndex = stream.buffer.indexOf('\n\n');
      if (separatorIndex < 0) {
        break;
      }
      const chunk = stream.buffer.slice(0, separatorIndex);
      stream.buffer = stream.buffer.slice(separatorIndex + 2);
      const parsed = parseSseChunk(chunk);
      if (parsed) {
        return parsed;
      }
    }

    const remainingMs = deadline - Date.now();
    const result = await Promise.race([
      stream.reader.read().then((readResult) => ({ kind: 'read' as const, readResult })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), remainingMs)),
    ]);

    if (result.kind === 'timeout') {
      return null;
    }
    if (result.readResult.done) {
      return null;
    }

    stream.buffer += stream.decoder.decode(result.readResult.value, { stream: true });
  }

  return null;
}

async function closeSseStream(stream: OpenSseStream | null) {
  if (!stream) {
    return;
  }
  stream.controller.abort();
  try {
    await stream.reader.cancel();
  } catch {
    // Ignore cancellation errors from aborted fetch streams.
  }
}

test('rbac migration seeds least-privilege onboarding role for new non-admin users', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('rbac-seed-');

  try {
    process.env.DATA_DIR = dataDir;
    const [{ migrateDatabase }, { createUser }, { roleRepository }, { defaultRoleResourceIds }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/roles/role.repository.js'),
      import('../src/modules/route-resources/route-resource.seed.js'),
    ]);

    migrateDatabase();
    const admin = createUser('rbac-admin', 'password123', 'Admin');
    const user = createUser('rbac-user', 'password123', 'User');
    const fallbackRole = roleRepository.findByKey('default-full-access');
    const onboardingRole = roleRepository.findByKey('default-onboarding');

    assert.equal(admin.role, 'admin');
    assert.deepEqual(admin.roleIds || [], []);
    assert.equal(admin.authVersion, 1);
    assert.ok(fallbackRole);
    assert.ok(onboardingRole);
    assert.equal(roleRepository.findDefaultRole()?.id, onboardingRole?.id);
    assert.equal(user.role, 'user');
    assert.deepEqual(user.roleIds, [onboardingRole!.id]);
    assert.equal(fallbackRole?.grantedResources.length, defaultRoleResourceIds.length);
    assert.equal(onboardingRole?.grantedResources.length ?? 0, 0);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('rbac routes expose current permissions and protect guarded endpoints', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('rbac-routes-');
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { db },
      { migrateDatabase },
      { createUser, createToken },
      { roleRepository },
      { userRepository },
      { routeResourceRepository },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/database.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/roles/role.repository.js'),
      import('../src/modules/users/user.repository.js'),
      import('../src/modules/route-resources/route-resource.repository.js'),
    ]);

    migrateDatabase();
    const admin = createUser('route-admin', 'password123', 'Admin');
    promoteToAdmin(db, admin.id);
    const restricted = createUser('route-user', 'password123', 'Restricted User');
    assert.equal(roleRepository.findDefaultRole()?.key, 'default-onboarding');

    const restrictedRoleId = roleRepository.create({
      key: 'chat-only',
      name: 'Chat Only',
      description: 'Only chat access',
    });
    const chatResource = routeResourceRepository.findByPermissionCode('web.module.chat');
    assert.ok(chatResource);
    roleRepository.replaceResourceGrants(restrictedRoleId, [chatResource.id]);
    userRepository.updateRoleAssignments(restricted.id, [restrictedRoleId]);

    const adminToken = createToken({ ...admin, role: 'admin' });
    const restrictedToken = createToken(restricted);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const meResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(meResponse.status, 200);
    const mePayload = await meResponse.json() as {
      user: {
        roleIds: string[];
        assignedRoles: Array<{ id: string; name: string }>;
        permissions: string[];
      };
    };
    assert.deepEqual(mePayload.user.roleIds, [restrictedRoleId]);
    assert.equal(mePayload.user.assignedRoles[0]?.name, 'Chat Only');
    assert.deepEqual(mePayload.user.permissions, ['web.module.chat']);

    const contentDenied = await fetch(`http://127.0.0.1:${port}/api/content/modules`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(contentDenied.status, 403);

    const deniedOtherGroups = await fetch(`http://127.0.0.1:${port}/api/content/asset-groups?resourceType=other`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(deniedOtherGroups.status, 400);
    const deniedOtherGroupsPayload = await deniedOtherGroups.json() as { message?: string };
    assert.equal(deniedOtherGroupsPayload.message, '当前账号无权访问该功能');

    const chatAllowed = await fetch(`http://127.0.0.1:${port}/api/chat/conversations`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(chatAllowed.status, 200);

    const rolesResponse = await fetch(`http://127.0.0.1:${port}/api/roles`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(rolesResponse.status, 200);
    const roles = await rolesResponse.json() as Array<{ id: string; grantedResources: Array<{ permissionCode: string }> }>;
    assert.ok(roles.some((role) => role.id === restrictedRoleId));

    const rolesForbidden = await fetch(`http://127.0.0.1:${port}/api/roles`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(rolesForbidden.status, 403);
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('rbac role routes persist default-role switching and align CRUD response contract', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('rbac-role-contract-');
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { db },
      { migrateDatabase },
      { createUser, createToken },
      { routeResourceRepository },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/database.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/route-resources/route-resource.repository.js'),
    ]);

    migrateDatabase();
    const admin = createUser('contract-admin', 'password123', 'Admin');
    promoteToAdmin(db, admin.id);
    const adminToken = createToken({ ...admin, role: 'admin' });
    const chatResource = routeResourceRepository.findByPermissionCode('web.module.chat');
    assert.ok(chatResource);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const createResponse = await fetch(`http://127.0.0.1:${port}/api/roles`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Content Ops',
        description: 'Can manage content creation',
        resourceIds: [chatResource.id],
        isDefault: true,
      }),
    });
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json() as {
      role: {
        id: string;
        key: string;
        isDefault: boolean;
        grantedResourceIds: string[];
        grantedResources: Array<{ permissionCode: string }>;
      };
    };
    assert.equal(createPayload.role.key, 'content-ops');
    assert.equal(createPayload.role.isDefault, true);
    assert.deepEqual(createPayload.role.grantedResourceIds, [chatResource.resourceKey]);
    assert.deepEqual(createPayload.role.grantedResources.map((item) => item.permissionCode), ['web.module.chat']);

    const inheritedUser = createUser('default-role-user', 'password123', 'Default Role User');
    assert.deepEqual(inheritedUser.roleIds, [createPayload.role.id]);

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/roles/${createPayload.role.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Content Ops',
        description: 'Chat only fallback',
        resourceIds: [],
        isDefault: false,
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updatePayload = await updateResponse.json() as {
      role: { id: string; isDefault: boolean; grantedResourceIds: string[] };
    };
    assert.equal(updatePayload.role.id, createPayload.role.id);
    assert.equal(updatePayload.role.isDefault, false);
    assert.deepEqual(updatePayload.role.grantedResourceIds, []);

    const postDefaultUser = createUser('no-default-user', 'password123', 'No Default User');
    assert.deepEqual(postDefaultUser.roleIds, ['role-default-onboarding']);

    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/roles/${createPayload.role.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(deleteResponse.status, 400);

    const deletableRoleResponse = await fetch(`http://127.0.0.1:${port}/api/roles`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Chat Temp',
        description: 'Temporary role',
        resourceIds: [chatResource.id],
        isDefault: false,
      }),
    });
    assert.equal(deletableRoleResponse.status, 201);
    const deletableRolePayload = await deletableRoleResponse.json() as {
      role: { id: string };
    };

    const deleteOkResponse = await fetch(`http://127.0.0.1:${port}/api/roles/${deletableRolePayload.role.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    assert.equal(deleteOkResponse.status, 200);
    const deleteOkPayload = await deleteOkResponse.json() as { ok: boolean };
    assert.equal(deleteOkPayload.ok, true);
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('role assignment changes target only the affected user and invalidate stale tokens', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('rbac-permission-events-');
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;
  let targetStream: OpenSseStream | null = null;
  let otherStream: OpenSseStream | null = null;
  let noopStream: OpenSseStream | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { db },
      { migrateDatabase },
      { createUser, createToken },
      { roleRepository },
      { routeResourceRepository },
      { userRepository },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/database.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/roles/role.repository.js'),
      import('../src/modules/route-resources/route-resource.repository.js'),
      import('../src/modules/users/user.repository.js'),
    ]);

    migrateDatabase();
    const admin = createUser('notify-admin', 'password123', 'Admin');
    promoteToAdmin(db, admin.id);
    const target = createUser('notify-target', 'password123', 'Target');
    const other = createUser('notify-other', 'password123', 'Other');
    const chatResource = routeResourceRepository.findByPermissionCode('web.module.chat');
    assert.ok(chatResource);

    const roleId = roleRepository.create({
      key: 'notify-chat-role',
      name: 'Notify Chat Role',
      description: 'Grant chat permission',
    });
    roleRepository.replaceResourceGrants(roleId, [chatResource.id]);

    const adminToken = createToken({ ...admin, role: 'admin' });
    const targetToken = createToken(target);
    const otherToken = createToken(other);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;
    const sseUrl = `http://127.0.0.1:${port}/api/app/events`;

    targetStream = await openSseStream(sseUrl, targetToken);
    otherStream = await openSseStream(sseUrl, otherToken);

    const assignResponse = await fetch(`http://127.0.0.1:${port}/api/users/${target.id}/role-assignment`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roleIds: [roleId] }),
    });
    assert.equal(assignResponse.status, 200);

    const targetEvent = await readNextSseEvent(targetStream, 1_000);
    assert.ok(targetEvent);
    assert.equal(targetEvent.type, 'permission-updated');
    assert.deepEqual(targetEvent.data, {
      type: 'permission-updated',
      userId: target.id,
      changedAt: targetEvent.data.changedAt,
      reason: 'role-assignment-updated',
      requireRelogin: true,
    });
    assert.equal(typeof targetEvent.data.changedAt, 'string');

    const otherEvent = await readNextSseEvent(otherStream, 250);
    assert.equal(otherEvent, null);

    const staleTokenResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.equal(staleTokenResponse.status, 401);

    const refreshedTarget = userRepository.findById(target.id);
    assert.ok(refreshedTarget);
    const refreshedTargetToken = createToken(refreshedTarget);

    const refreshedMeResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${refreshedTargetToken}` },
    });
    assert.equal(refreshedMeResponse.status, 200);

    noopStream = await openSseStream(sseUrl, refreshedTargetToken);
    const noopResponse = await fetch(`http://127.0.0.1:${port}/api/users/${target.id}/role-assignment`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roleIds: [roleId] }),
    });
    assert.equal(noopResponse.status, 200);
    assert.equal(await readNextSseEvent(noopStream, 250), null);

    const postNoopMeResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${refreshedTargetToken}` },
    });
    assert.equal(postNoopMeResponse.status, 200);
  } finally {
    await closeSseStream(targetStream);
    await closeSseStream(otherStream);
    await closeSseStream(noopStream);
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('role metadata edits do not force relogin but grant changes do', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('rbac-role-update-events-');
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;
  let metadataStream: OpenSseStream | null = null;
  let grantsStream: OpenSseStream | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { db },
      { migrateDatabase },
      { createUser, createToken },
      { roleRepository },
      { routeResourceRepository },
      { userRepository },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/database.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/roles/role.repository.js'),
      import('../src/modules/route-resources/route-resource.repository.js'),
      import('../src/modules/users/user.repository.js'),
    ]);

    migrateDatabase();
    const admin = createUser('role-admin', 'password123', 'Admin');
    promoteToAdmin(db, admin.id);
    const target = createUser('role-target', 'password123', 'Target');
    const chatResource = routeResourceRepository.findByPermissionCode('web.module.chat');
    assert.ok(chatResource);

    const roleId = roleRepository.create({
      key: 'role-update-chat',
      name: 'Role Update Chat',
      description: 'Original description',
    });
    roleRepository.replaceResourceGrants(roleId, [chatResource.id]);
    userRepository.updateRoleAssignments(target.id, [roleId]);

    const adminToken = createToken({ ...admin, role: 'admin' });
    const targetToken = createToken(target);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;
    const sseUrl = `http://127.0.0.1:${port}/api/app/events`;

    metadataStream = await openSseStream(sseUrl, targetToken);
    const metadataResponse = await fetch(`http://127.0.0.1:${port}/api/roles/${roleId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Role Update Chat',
        description: 'Metadata only update',
        resourceIds: [chatResource.id],
        isDefault: false,
      }),
    });
    assert.equal(metadataResponse.status, 200);
    assert.equal(await readNextSseEvent(metadataStream, 250), null);

    const metadataMeResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.equal(metadataMeResponse.status, 200);

    grantsStream = await openSseStream(sseUrl, targetToken);
    const grantsResponse = await fetch(`http://127.0.0.1:${port}/api/roles/${roleId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Role Update Chat',
        description: 'Grant update',
        resourceIds: [],
        isDefault: false,
      }),
    });
    assert.equal(grantsResponse.status, 200);

    const grantsEvent = await readNextSseEvent(grantsStream, 1_000);
    assert.ok(grantsEvent);
    assert.equal(grantsEvent.type, 'permission-updated');
    assert.equal(grantsEvent.data.userId, target.id);
    assert.equal(grantsEvent.data.reason, 'role-grants-updated');
    assert.equal(grantsEvent.data.requireRelogin, true);

    const staleTokenResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.equal(staleTokenResponse.status, 401);
  } finally {
    await closeSseStream(metadataStream);
    await closeSseStream(grantsStream);
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
