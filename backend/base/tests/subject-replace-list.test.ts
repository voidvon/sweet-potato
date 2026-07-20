import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/db/database.js';
import { contentRepository, emptyVideoParseResult } from '../src/modules/content/content.repository.js';
import { contentService } from '../src/modules/content/content.service.js';
import { userRepository } from '../src/modules/users/user.repository.js';

test('subject replacement preparing tasks appear in video productions', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `subject-replace-list-${suffix}`;
  userRepository.create({
    id: userId,
    username: userId,
    displayName: 'Subject replacement list test',
    role: 'user',
    isBlacklisted: false,
    creditBalance: 1000,
    passwordHash: 'test',
    salt: 'test',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  const task = contentRepository.createParsedVideoTask({
    userId,
    sourceUrl: 'https://example.com/reference.mp4',
    title: '主体替换',
    prompt: '主体替换测试',
    parseResult: { ...emptyVideoParseResult },
    aspectRatio: '9:16',
    expertContext: {
      mode: 'subject_replace',
      currentStep: 'subject_replace_preparing',
    },
  });
  assert.ok(task);
  contentRepository.markVideoTaskGenerating(task.id);

  try {
    const result = await contentService.listVideoProductions(userId, { page: 1, pageSize: 20 });
    assert.ok(!Array.isArray(result));
    assert.ok(result.items.some((item) => item.id === task.id));
    assert.equal(result.items.find((item) => item.id === task.id)?.status, 'generating');
  } finally {
    contentRepository.deleteVideoTask(task.id);
    db.prepare('DELETE FROM user_role_assignments WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});
