import assert from 'node:assert/strict';
import test from 'node:test';
import talkingVideoStreamStateModule from '../../../frontend/web/src/pages/content/VideoTaskClonePage/talkingVideoStreamState.js';
import type { TalkingVideoPromptTask } from '../../../frontend/web/src/pages/content/VideoTaskClonePage/types.js';

const {
  applyTalkingVideoResumeFailure,
  appendTalkingVideoDeltaBuffer,
  flushTalkingVideoDeltaBufferIntoTask,
  normalizeTalkingVideoTaskRuntimeFields,
} = talkingVideoStreamStateModule;

function baseTask(): TalkingVideoPromptTask {
  return {
    id: 'task-1',
    phase: 'understanding_video',
    status: 'thinking',
    reasoning: '已有思考：',
    prompt: '已有提示词：',
    errorMessage: '',
    metrics: {
      arkUploadCount: 0,
      arkUploadPollMs: 0,
      understandingModelCalls: 1,
      understandingReplayCalls: 0,
      formatRepairCalls: 0,
      promptRepairCalls: 0,
      reuseCacheHitCount: 0,
    },
    serverTimings: {},
    clientTimings: {},
    sourceVideo: {
      id: 'video-1',
      name: 'source.mp4',
      type: 'video',
      url: 'https://example.com/source.mp4',
    },
    referenceImages: [],
    createdAt: '2026-07-21T18:00:00.000Z',
  };
}

test('talking video delta buffer appends and flushes reasoning plus prompt exactly once', () => {
  const buffered = appendTalkingVideoDeltaBuffer(
    appendTalkingVideoDeltaBuffer({ prompt: '', reasoning: '' }, 'reasoning', '继续分析。'),
    'prompt',
    '最终补充。',
  );
  const task = flushTalkingVideoDeltaBufferIntoTask(baseTask(), buffered);

  assert.equal(task.reasoning, '已有思考：继续分析。');
  assert.equal(task.prompt, '已有提示词：最终补充。');
});

test('talking video runtime field normalization preserves persisted completed final state', () => {
  const normalized = normalizeTalkingVideoTaskRuntimeFields({
    ...baseTask(),
    phase: 'completed',
    status: 'completed',
    metrics: undefined as unknown as TalkingVideoPromptTask['metrics'],
    serverTimings: undefined as unknown as TalkingVideoPromptTask['serverTimings'],
    clientTimings: undefined as unknown as TalkingVideoPromptTask['clientTimings'],
  });

  assert.equal(normalized.phase, 'completed');
  assert.equal(normalized.status, 'completed');
  assert.equal(normalized.metrics.promptRepairCalls, 0);
  assert.deepEqual(normalized.serverTimings, {});
  assert.deepEqual(normalized.clientTimings, {});
});

test('talking video resume failure marks a missing backend task as stopped and recoverable', () => {
  const next = applyTalkingVideoResumeFailure(baseTask(), '口播任务已失效，请点击继续重新生成');

  assert.equal(next.phase, 'stopped');
  assert.equal(next.status, 'stopped');
  assert.equal(next.errorMessage, '口播任务已失效，请点击继续重新生成');
});
