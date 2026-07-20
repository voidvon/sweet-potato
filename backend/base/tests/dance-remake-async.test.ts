import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/db/database.js';
import { contentRepository } from '../src/modules/content/content.repository.js';
import { danceRemakeService } from '../src/modules/video-source/dance-remake.service.js';
import { videoSourceService } from '../src/modules/video-source/video-source.service.js';
import { userRepository } from '../src/modules/users/user.repository.js';

test('dance remake returns a preparing task without waiting for remote video processing', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `dance-remake-async-${suffix}`;
  userRepository.create({
    id: userId,
    username: userId,
    displayName: 'Dance remake async test',
    role: 'user',
    isBlacklisted: false,
    creditBalance: 1000,
    passwordHash: 'test',
    salt: 'test',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  const group = contentRepository.createGroup({
    userId,
    resourceType: 'product',
    name: `dance-remake-async-${suffix}`,
    description: '',
    metadata: { source: 'dance-remake-async-test' },
  });
  assert.ok(group);
  const imageAsset = contentRepository.createAsset({
    userId,
    groupId: group.id,
    resourceType: 'product',
    name: 'Character image',
    description: '',
    originalFileName: 'character.jpg',
    storedFileName: `character-${suffix}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 4,
    filePath: `/tmp/character-${suffix}.jpg`,
    fileUrl: `/files/character-${suffix}.jpg`,
    metadata: { source: 'dance-remake-async-test' },
  });
  assert.ok(imageAsset);

  const originalResolve = videoSourceService.resolve;
  videoSourceService.resolve = async () => new Promise<never>(() => undefined);
  let taskId = '';
  try {
    const task = await danceRemakeService.create({
      characterImageAssetId: imageAsset.id,
      mode: 'standard',
      preserveAudio: true,
      quality: '标清 (720p)',
      ratio: '9:16',
      remoteVideo: { input: 'https://v.douyin.com/async-test/' },
      userId,
      videoModelId: 'doubao-seedance-2-0-260128',
    });
    taskId = task.id;
    assert.equal(task.status, 'generating');
    assert.equal(task.expertContext.mode, 'dance_remake');
    assert.equal(task.expertContext.currentStep, 'dance_remake_preparing');
  } finally {
    videoSourceService.resolve = originalResolve;
    if (taskId) contentRepository.deleteVideoTask(taskId);
    contentRepository.deleteGroup(group.id);
    db.prepare('DELETE FROM user_role_assignments WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
});
