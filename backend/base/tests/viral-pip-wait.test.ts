import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('storyboard waits for picture-in-picture expert output', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'viral-pip-wait-'));
  const dataDir = path.join(tempRoot, 'data');
  mkdirSync(dataDir, { recursive: true });

  try {
    process.env.DATA_DIR = dataDir;

    const [{ migrateDatabase }, { contentRepository, emptyVideoParseResult }, { processViralConversationQueue }] = await Promise.all([
      import('../src/db/schema.js'),
      import('../src/modules/content/content.repository.js'),
      import('../src/modules/content/internals/content-viral-director.js'),
    ]);
    migrateDatabase();

    const task = contentRepository.createParsedVideoTask({
      userId: 'user-pip-wait-test',
      sourceUrl: '/uploads/source.mp4',
      title: 'pip wait fixture',
      parseResult: {
        ...emptyVideoParseResult,
        analysisProcess: [],
      },
      selectedSkillIds: [],
      expertContext: {
        mode: 'viral_replication_upload_parse',
        viralUnderstanding: {
          status: 'polling',
          agents: [
            { key: 'audio_expert', name: '音频理解专家', mode: 'audio', prompt: 'audio prompt' },
            { key: 'video_expert', name: '视频理解专家', mode: 'multimodal', prompt: 'video prompt' },
            { key: 'picture_in_picture_expert', name: '画中画解析专家', mode: 'multimodal', prompt: 'pip prompt' },
          ],
          executions: [
            { role: 'audio_expert', roleName: '音频理解专家', mode: 'audio', runId: 'run-audio' },
            { role: 'video_expert', roleName: '视频理解专家', mode: 'multimodal', runId: 'run-video' },
            { role: 'picture_in_picture_expert', roleName: '画中画解析专家', mode: 'multimodal', runId: 'run-pip', status: 'running' },
          ],
          outputs: {},
          conversationMessages: [],
          emittedSources: [],
        },
      },
    });
    assert.ok(task);

    await processViralConversationQueue({
      task,
      userId: 'user-pip-wait-test',
      outputs: {
        audio_expert: { roleName: '音频理解专家', content: 'audio done' },
        video_expert: { roleName: '视频理解专家', content: '{"task1":{"content":"basic"},"task2":{"content":"scene"},"task3":{"content":"shot"},"task4":{"content":"audio visual"},"task5":{"content":"product"}}' },
      },
    });

    const latest = contentRepository.findVideoTask(task.id);
    const understanding = latest?.expertContext?.viralUnderstanding as Record<string, unknown> | undefined;
    const emittedSources = Array.isArray(understanding?.emittedSources) ? understanding.emittedSources : [];
    const messages = Array.isArray(understanding?.conversationMessages) ? understanding.conversationMessages : [];

    assert.equal(emittedSources.includes('storyboard_final'), false);
    assert.equal(messages.some((item) => typeof item === 'object' && item && (item as { source?: string }).source === 'storyboard_final'), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
