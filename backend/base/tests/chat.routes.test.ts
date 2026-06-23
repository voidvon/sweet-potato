import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

test('chat conversation detail returns conversation and messages for owner only', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'chat-routes-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { createApp },
      { migrateDatabase },
      { createUser, createToken },
      { chatRepository },
    ] = await Promise.all([
      import('../src/app.js'),
      import('../src/db/schema.js'),
      import('../src/modules/users/user.service.js'),
      import('../src/modules/chat/chat.repository.js'),
    ]);

    migrateDatabase();

    const owner = createUser(`owner-${randomBytes(4).toString('hex')}`, 'password123', 'Owner');
    const stranger = createUser(`stranger-${randomBytes(4).toString('hex')}`, 'password123', 'Stranger');
    const ownerToken = createToken(owner.id, owner.role);
    const strangerToken = createToken(stranger.id, stranger.role);

    const now = new Date().toISOString();
    chatRepository.createConversation({
      id: 'conversation-owner-detail',
      userId: owner.id,
      title: 'Owner Conversation',
      agentId: 'quick-answer',
      modelConfigId: null,
      metadata: { previewText: 'preview' },
      createdAt: now,
      updatedAt: now,
    });
    chatRepository.createMessages([
      {
        id: 'message-owner-detail',
        conversationId: 'conversation-owner-detail',
        role: 'user',
        content: 'hello',
        agentId: 'quick-answer',
        createdAt: now,
      },
    ]);

    appServer = createApp().listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const port = (appServer.address() as AddressInfo).port;

    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/chat/conversations/conversation-owner-detail`, {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
    });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as {
      conversation: { id: string; userId: string };
      messages: Array<{ id: string; conversationId: string }>;
    };
    assert.equal(detail.conversation.id, 'conversation-owner-detail');
    assert.equal(detail.conversation.userId, owner.id);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0]?.conversationId, 'conversation-owner-detail');

    const forbiddenResponse = await fetch(`http://127.0.0.1:${port}/api/chat/conversations/conversation-owner-detail`, {
      headers: {
        Authorization: `Bearer ${strangerToken}`,
      },
    });
    assert.equal(forbiddenResponse.status, 403);
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
