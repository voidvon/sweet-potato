import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeTempDataDir(prefix: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  return { tempRoot, dataDir };
}

function createLegacyToken(input: { secret: string; userId: string; role: 'admin' | 'user' }) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: input.userId,
    role: input.role,
    iat,
    exp: iat + 60 * 60,
  })).toString('base64url');
  const signature = createHmac('sha256', input.secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

test('legacy tokens map missing authVersion to version 1 until the user auth version changes', async () => {
  const { tempRoot, dataDir } = makeTempDataDir('auth-legacy-token-');

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { migrateDatabase },
      { createUser },
      { userRepository },
      { authTokenSecret },
      { resolveAuthenticatedUser, verifyAuthToken },
    ] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/users/user.repository.js'),
      import('../src/config/env.js'),
      import('../src/shared/auth.js'),
    ]);

    migrateDatabase();
    const user = createUser('legacy-user', 'password123', 'Legacy User');
    const legacyToken = createLegacyToken({
      secret: authTokenSecret,
      userId: user.id,
      role: user.role,
    });

    const payload = verifyAuthToken(legacyToken);
    assert.ok(payload);
    assert.equal(payload.authVersion, 1);

    const acceptedSession = resolveAuthenticatedUser(legacyToken);
    assert.ok(acceptedSession);
    assert.equal(acceptedSession.user.id, user.id);
    assert.equal(acceptedSession.payload.authVersion, 1);

    userRepository.bumpAuthVersion(user.id);

    const rejectedSession = resolveAuthenticatedUser(legacyToken);
    assert.equal(rejectedSession, null);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
