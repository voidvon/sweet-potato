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

test('editing a user message replaces downstream chat history from that point', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'chat-routes-edit-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });
  let appServer: ReturnType<ReturnType<typeof import('node:http').createServer>['listen']> | null = null;

  try {
    process.env.DATA_DIR = dataDir;

    const [
      { chatRepository },
    ] = await Promise.all([
      import('../src/modules/chat/chat.repository.js'),
    ]);

    const now = new Date().toISOString();
    const conversationId = 'conversation-edit-history';
    chatRepository.createConversation({
      id: conversationId,
      userId: 'user-edit',
      title: 'Edit history',
      agentId: 'quick-answer',
      modelConfigId: null,
      metadata: { previewText: 'old assistant answer' },
      createdAt: now,
      updatedAt: now,
    });
    chatRepository.createMessages([
      {
        id: 'message-user-1',
        conversationId,
        role: 'user',
        content: '第一条消息',
        agentId: 'quick-answer',
        createdAt: '2026-06-23T10:00:00.000Z',
      },
      {
        id: 'message-assistant-1',
        conversationId,
        role: 'assistant',
        content: '第一条回复',
        agentId: 'quick-answer',
        createdAt: '2026-06-23T10:00:01.000Z',
      },
      {
        id: 'message-user-2',
        conversationId,
        role: 'user',
        content: '第二条旧消息',
        agentId: 'quick-answer',
        createdAt: '2026-06-23T10:00:02.000Z',
      },
      {
        id: 'message-assistant-2',
        conversationId,
        role: 'assistant',
        content: '第二条旧回复',
        agentId: 'quick-answer',
        createdAt: '2026-06-23T10:00:03.000Z',
      },
    ]);

    chatRepository.deleteMessagesAfter(conversationId, '2026-06-23T10:00:02.000Z');
    chatRepository.replaceMessageContent({
      id: 'message-user-2',
      content: '第二条新消息',
      attachments: [],
    });
    chatRepository.createMessages([
      {
        id: 'message-assistant-3',
        conversationId,
        role: 'assistant',
        content: '第二条新回复',
        agentId: 'quick-answer',
        createdAt: '2026-06-23T10:00:04.000Z',
      },
    ]);

    const messages = chatRepository.listMessages(conversationId);
    assert.deepEqual(
      messages.map((item) => ({ id: item.id, content: item.content })),
      [
        { id: 'message-user-1', content: '第一条消息' },
        { id: 'message-assistant-1', content: '第一条回复' },
        { id: 'message-user-2', content: '第二条新消息' },
        { id: 'message-assistant-3', content: '第二条新回复' },
      ],
    );
  } finally {
    appServer?.closeAllConnections?.();
    appServer?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
