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

test('rbac migration seeds least-privilege onboarding role for new non-admin users', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('rbac-seed-');

  try {
    process.env.DATA_DIR = dataDir;
    const [{ migrateDatabase }, { createUser }, { roleRepository }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/roles/role.repository.js'),
    ]);

    migrateDatabase();
    const admin = createUser('rbac-admin', 'password123', 'Admin');
    const user = createUser('rbac-user', 'password123', 'User');
    const fallbackRole = roleRepository.findByKey('default-full-access');
    const onboardingRole = roleRepository.findByKey('default-onboarding');

    assert.equal(admin.role, 'admin');
    assert.equal(admin.roleId ?? null, null);
    assert.ok(fallbackRole);
    assert.ok(onboardingRole);
    assert.equal(roleRepository.findDefaultRole()?.id, onboardingRole?.id);
    assert.equal(user.role, 'user');
    assert.equal(user.roleId ?? null, 'role-default-onboarding');
    assert.equal(fallbackRole?.permissions.length, 13);
    assert.equal(fallbackRole?.resourceIds.length, 13);
    assert.equal(onboardingRole?.permissions.length ?? 0, 0);
    assert.equal(onboardingRole?.resourceIds.length ?? 0, 0);
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
      { migrateDatabase },
      { createUser, createToken },
      { roleRepository },
      { userRepository },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/roles/role.repository.js'),
      import('../src/modules/users/user.repository.js'),
    ]);

    migrateDatabase();
    const admin = createUser('route-admin', 'password123', 'Admin');
    const restricted = createUser('route-user', 'password123', 'Restricted User');
    assert.equal(roleRepository.findDefaultRole()?.key, 'default-onboarding');

    const restrictedRoleId = roleRepository.create({
      key: 'chat-only',
      name: 'Chat Only',
      description: 'Only chat access',
    });
    const chatResourceId = roleRepository.findByKey('default-full-access')?.resourceIds.find(Boolean);
    const allResources = (await import('../src/modules/route-resources/route-resource.repository.js')).routeResourceRepository;
    const chatResource = allResources.findByPermissionCode('web.module.chat');
    assert.ok(chatResourceId || chatResource);
    roleRepository.replaceResourceGrants(restrictedRoleId, chatResource ? [chatResource.id] : []);
    userRepository.updateRoleAssignment(restricted.id, restrictedRoleId);

    const adminToken = createToken(admin.id, admin.role);
    const restrictedToken = createToken(restricted.id, restricted.role);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const meResponse = await fetch(`http://127.0.0.1:${port}/api/users/me`, {
      headers: { Authorization: `Bearer ${restrictedToken}` },
    });
    assert.equal(meResponse.status, 200);
    const mePayload = await meResponse.json() as {
      user: {
        assignedRoleId?: string | null;
        assignedRoleName?: string | null;
        permissions: string[];
      };
    };
    assert.equal(mePayload.user.assignedRoleId, restrictedRoleId);
    assert.equal(mePayload.user.assignedRoleName, 'Chat Only');
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
    const roles = await rolesResponse.json() as Array<{ id: string; key: string; resourceIds: string[]; permissionCodes: string[] }>;
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
      { migrateDatabase },
      { createUser, createToken },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
    ]);

    migrateDatabase();
    const admin = createUser('contract-admin', 'password123', 'Admin');
    const adminToken = createToken(admin.id, admin.role);

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
        key: 'content-ops',
        name: 'Content Ops',
        description: 'Can manage content creation',
        permissionKeys: ['web.module.content.create_video'],
        isDefault: true,
      }),
    });
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json() as {
      role: { id: string; key: string; isDefault: boolean; permissions: string[]; resourceIds: string[] };
    };
    assert.equal(createPayload.role.key, 'content-ops');
    assert.equal(createPayload.role.isDefault, true);
    assert.deepEqual(createPayload.role.permissions, ['web.module.content.create_video']);
    assert.equal(createPayload.role.resourceIds.length, 1);

    const inheritedUser = createUser('default-role-user', 'password123', 'Default Role User');
    assert.equal(inheritedUser.roleId, createPayload.role.id);

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/roles/${createPayload.role.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Content Ops',
        description: 'Chat only fallback',
        permissionKeys: ['web.module.chat'],
        isDefault: false,
      }),
    });
    assert.equal(updateResponse.status, 200);
    const updatePayload = await updateResponse.json() as {
      role: { id: string; isDefault: boolean; permissions: string[] };
    };
    assert.equal(updatePayload.role.id, createPayload.role.id);
    assert.equal(updatePayload.role.isDefault, false);
    assert.deepEqual(updatePayload.role.permissions, ['web.module.chat']);

    const postDefaultUser = createUser('no-default-user', 'password123', 'No Default User');
    assert.equal(postDefaultUser.roleId ?? null, 'role-default-onboarding');

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
        key: 'chat-temp',
        name: 'Chat Temp',
        description: 'Temporary role',
        permissionKeys: ['web.module.chat'],
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
