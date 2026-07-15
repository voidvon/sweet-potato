import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('reference audio locks the spoken voice identity instead of acting as rhythm guidance', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'content-video-task-runtime-'));
  const previousDataDir = process.env.DATA_DIR;

  try {
    process.env.DATA_DIR = tempRoot;
    const { composeReferenceAudioVoiceConstraint } = await import('../src/modules/content/internals/content-video-task-runtime.js');
    const prompt = composeReferenceAudioVoiceConstraint([{
      name: '男声克隆试听',
      description: '沉稳男声',
      originalFileName: 'voice-preview.wav',
    }]);

    assert.match(prompt, /声音素材只用于锁定口播人物的声音身份/u);
    assert.match(prompt, /音频 1作为唯一音色参考/u);
    assert.match(prompt, /音色、性别感、声线、语速、能量和距离感/u);
    assert.match(prompt, /不得根据画面人物的外观或性别自行更换声音/u);
    assert.match(prompt, /不直接复用参考音频里的原始台词/u);
    assert.doesNotMatch(prompt, /作为背景音乐或节奏参考/u);
    assert.doesNotMatch(prompt, /主要声音\/节奏参考/u);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('multiple reference audios bind to speakers in order', async () => {
  const { composeReferenceAudioVoiceConstraint } = await import('../src/modules/content/internals/content-video-task-runtime.js');
  const prompt = composeReferenceAudioVoiceConstraint([
    { name: '声音 A', description: '', originalFileName: 'a.wav' },
    { name: '声音 B', description: '', originalFileName: 'b.wav' },
  ]);

  assert.match(prompt, /多个人物按出场顺序依次绑定音频 1、音频 2/u);
  assert.match(prompt, /只有一个口播人物时，以音频 1作为唯一音色参考/u);
  assert.doesNotMatch(prompt, /背景音乐或节奏参考/u);
});

test('empty reference audio list adds no voice constraint', async () => {
  const { composeReferenceAudioVoiceConstraint } = await import('../src/modules/content/internals/content-video-task-runtime.js');
  assert.equal(composeReferenceAudioVoiceConstraint([]), '');
});
