import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  TalkingVideoArkReuseResolver,
  runTalkingVideoStructuredUnderstanding,
  type TalkingVideoRunMetrics,
} from '../src/modules/talking-video/talking-video-understanding-runtime.js';
import type { VideoUnderstandingEvent } from '../src/modules/video-understanding/video-understanding.types.js';

function emptyMetrics(): TalkingVideoRunMetrics {
  return {
    arkUploadCount: 0,
    arkUploadPollMs: 0,
    understandingModelCalls: 0,
    understandingReplayCalls: 0,
    formatRepairCalls: 0,
    promptRepairCalls: 0,
    reuseCacheHitCount: 0,
  };
}

async function* emitText(delta: string): AsyncGenerator<VideoUnderstandingEvent> {
  yield { type: 'delta', requestId: 'req', delta };
  yield { type: 'done', requestId: 'req' };
}

test('talking video Ark reuse resolver reuses active cached uploads per user and asset identity', async () => {
  let uploadCount = 0;
  let retrieveCount = 0;
  const resolver = new TalkingVideoArkReuseResolver({
    retrieveFile: async () => {
      retrieveCount += 1;
      return { status: 'active' };
    },
    uploadFile: async () => {
      uploadCount += 1;
      return { fileId: `file-${uploadCount}`, pollMs: 25 };
    },
  });

  const firstMetrics = emptyMetrics();
  await resolver.prepareMedia({
    userId: 'user-a',
    video: {
      assetId: 'asset-video',
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    images: [{
      assetId: 'asset-model',
      filePath: '/tmp/model.png',
      filename: 'model.png',
      mimeType: 'image/png',
      role: 'model',
      updatedAt: '2026-07-21T12:00:00.000Z',
    }],
    metrics: firstMetrics,
  });
  assert.equal(firstMetrics.arkUploadCount, 2);
  assert.equal(firstMetrics.reuseCacheHitCount, 0);

  const secondMetrics = emptyMetrics();
  await resolver.prepareMedia({
    userId: 'user-a',
    video: {
      assetId: 'asset-video',
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    images: [{
      assetId: 'asset-model',
      filePath: '/tmp/model.png',
      filename: 'model.png',
      mimeType: 'image/png',
      role: 'model',
      updatedAt: '2026-07-21T12:00:00.000Z',
    }],
    metrics: secondMetrics,
  });
  assert.equal(uploadCount, 2);
  assert.equal(retrieveCount, 2);
  assert.equal(secondMetrics.arkUploadCount, 0);
  assert.equal(secondMetrics.reuseCacheHitCount, 2);
});

test('talking video Ark reuse resolver evicts an invalid cached file and uploads exactly one fresh replacement', async () => {
  let uploadCount = 0;
  let retrieveCount = 0;
  const resolver = new TalkingVideoArkReuseResolver({
    retrieveFile: async () => {
      retrieveCount += 1;
      return { status: 'failed' };
    },
    uploadFile: async () => {
      uploadCount += 1;
      return { fileId: `file-${uploadCount}`, pollMs: 10 };
    },
  });

  await resolver.prepareMedia({
    userId: 'user-a',
    video: {
      assetId: 'asset-video',
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    images: [],
    metrics: emptyMetrics(),
  });

  const secondMetrics = emptyMetrics();
  await resolver.prepareMedia({
    userId: 'user-a',
    video: {
      assetId: 'asset-video',
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    images: [],
    metrics: secondMetrics,
  });

  assert.equal(retrieveCount, 1);
  assert.equal(uploadCount, 2);
  assert.equal(secondMetrics.arkUploadCount, 1);
  assert.equal(secondMetrics.reuseCacheHitCount, 0);
});

test('talking video structured understanding formats malformed output before replaying full understanding', async () => {
  const schema = z.object({
    durationSeconds: z.number(),
    summary: z.string(),
  });
  const streamKinds: string[] = [];

  const result = await runTalkingVideoStructuredUnderstanding({
    userId: 'user-a',
    video: {
      assetId: 'asset-video',
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    images: [],
    schema,
    instructionText: '请分析这个口播视频',
    thinking: true,
    resolver: new TalkingVideoArkReuseResolver({
      uploadFile: async () => ({ fileId: 'file-video', pollMs: 12 }),
    }),
    stream: async function* ({ messages }) {
      const content = messages[0]?.content;
      const firstText = Array.isArray(content) ? content.find((part) => part.type === 'input_text' || part.type === 'text') : null;
      const text = firstText && 'text' in firstText ? firstText.text : '';
      if (text.includes('严格的 JSON 格式修复器')) {
        streamKinds.push('format');
        yield* emitText('{"durationSeconds":14,"summary":"格式修复后通过"}');
        return;
      }
      streamKinds.push('understanding');
      yield* emitText('{"durationSeconds":14,"summary":123}');
    },
  });

  assert.deepEqual(streamKinds, ['understanding', 'format']);
  assert.equal(result.parsed.summary, '格式修复后通过');
  assert.equal(result.metrics.understandingModelCalls, 1);
  assert.equal(result.metrics.formatRepairCalls, 1);
  assert.equal(result.metrics.understandingReplayCalls, 0);
});

test('talking video structured understanding replays full understanding once after format repair also fails', async () => {
  const schema = z.object({
    durationSeconds: z.number(),
    summary: z.string(),
  });
  const streamKinds: string[] = [];

  const result = await runTalkingVideoStructuredUnderstanding({
    userId: 'user-a',
    video: {
      assetId: 'asset-video',
      filePath: '/tmp/source.mp4',
      filename: 'source.mp4',
      mimeType: 'video/mp4',
      updatedAt: '2026-07-21T12:00:00.000Z',
    },
    images: [],
    schema,
    instructionText: '请分析这个口播视频',
    thinking: true,
    resolver: new TalkingVideoArkReuseResolver({
      uploadFile: async () => ({ fileId: 'file-video', pollMs: 12 }),
    }),
    stream: async function* ({ messages }) {
      const content = messages[0]?.content;
      const firstText = Array.isArray(content) ? content.find((part) => part.type === 'input_text' || part.type === 'text') : null;
      const text = firstText && 'text' in firstText ? firstText.text : '';
      if (text.includes('严格的 JSON 格式修复器')) {
        streamKinds.push('format');
        yield* emitText('{"durationSeconds":14,"summary":456}');
        return;
      }
      if (text.includes('上一次输出未通过 JSON 解析或结构校验')) {
        streamKinds.push('replay');
        yield* emitText('{"durationSeconds":14,"summary":"完整重放后通过"}');
        return;
      }
      streamKinds.push('understanding');
      yield* emitText('{"durationSeconds":14,"summary":123}');
    },
  });

  assert.deepEqual(streamKinds, ['understanding', 'format', 'replay']);
  assert.equal(result.parsed.summary, '完整重放后通过');
  assert.equal(result.metrics.understandingModelCalls, 2);
  assert.equal(result.metrics.formatRepairCalls, 1);
  assert.equal(result.metrics.understandingReplayCalls, 1);
});
