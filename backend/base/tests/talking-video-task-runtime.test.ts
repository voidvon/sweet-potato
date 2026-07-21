import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startTalkingVideoTask,
  subscribeTalkingVideoTask,
  stopTalkingVideoTask,
} from '../src/modules/talking-video/talking-video-task-runtime.js';

test('stopped talking video task restarts in place with cleared output', async () => {
  const taskId = `talking-video-restart-${crypto.randomUUID()}`;
  const userId = 'talking-video-restart-user';
  const runAgent = async ({ signal }: { signal?: AbortSignal }) => {
    await new Promise<never>((_resolve, reject) => {
      const abort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
    });
    throw new Error('unreachable');
  };
  const input = {
    taskId,
    userId,
    deepThink: true,
    images: [{ filePath: '/tmp/model.png', filename: 'model.png', mimeType: 'image/png', role: 'model' as const }],
    video: { filePath: '/tmp/source.mp4', filename: 'source.mp4', mimeType: 'video/mp4' },
    runAgent,
  };

  const task = startTalkingVideoTask(input);
  task.reasoning = '上一次思考内容';
  task.prompt = '上一次结果';
  stopTalkingVideoTask(taskId, userId);
  assert.equal(task.status, 'stopped');

  const restarted = startTalkingVideoTask(input);
  assert.equal(restarted, task);
  assert.equal(restarted.status, 'thinking');
  assert.equal(restarted.reasoning, '');
  assert.equal(restarted.prompt, '');
  assert.equal(restarted.errorMessage, '');

  stopTalkingVideoTask(taskId, userId);
  await new Promise((resolve) => setImmediate(resolve));
});

test('talking video task publishes phase metrics and timing snapshots', async () => {
  const taskId = `talking-video-phase-${crypto.randomUUID()}`;
  const userId = 'talking-video-phase-user';
  const events: Array<{ type: string; phase?: string }> = [];
  const persisted: Array<{ status: string; phase: string; reasoning: string; prompt: string }> = [];

  const runAgent = async ({
    onPhaseChange,
    onReasoningDelta,
  }: {
    onPhaseChange?: (phase: 'uploading_assets' | 'understanding_video' | 'generating_prompt' | 'completed', metrics: {
      arkUploadCount: number;
      arkUploadPollMs: number;
      understandingModelCalls: number;
      understandingReplayCalls: number;
      formatRepairCalls: number;
      promptRepairCalls: number;
      reuseCacheHitCount: number;
    }) => void;
    onReasoningDelta?: (delta: string) => void;
  }) => {
    onPhaseChange?.('uploading_assets', {
      arkUploadCount: 2,
      arkUploadPollMs: 18,
      understandingModelCalls: 0,
      understandingReplayCalls: 0,
      formatRepairCalls: 0,
      promptRepairCalls: 0,
      reuseCacheHitCount: 0,
    });
    onPhaseChange?.('understanding_video', {
      arkUploadCount: 2,
      arkUploadPollMs: 18,
      understandingModelCalls: 1,
      understandingReplayCalls: 0,
      formatRepairCalls: 0,
      promptRepairCalls: 0,
      reuseCacheHitCount: 0,
    });
    onReasoningDelta?.('导演审片记录');
    onPhaseChange?.('generating_prompt', {
      arkUploadCount: 2,
      arkUploadPollMs: 18,
      understandingModelCalls: 1,
      understandingReplayCalls: 0,
      formatRepairCalls: 0,
      promptRepairCalls: 0,
      reuseCacheHitCount: 1,
    });
    return {
      analysis: {
        durationSeconds: 14,
        summary: '测试',
        visualStyle: '写实',
        finalPrompt: '分段A',
        presentationLayout: {
          type: 'full_screen_presenter' as const,
          mainVisualRole: '讲解者',
          presenterPlacement: '居中',
          persistence: '全程',
        },
        videoStructure: { isContinuousTake: true, shotBoundaryReason: '固定机位' },
        presenter: { identity: '讲解者', expressionStyle: '自然', performanceStyle: '稳定' },
        shots: [],
        imageReferences: [],
      },
      prompt: '分段A',
      reasoning: '导演审片记录',
      metrics: {
        arkUploadCount: 2,
        arkUploadPollMs: 18,
        understandingModelCalls: 1,
        understandingReplayCalls: 0,
        formatRepairCalls: 0,
        promptRepairCalls: 0,
        reuseCacheHitCount: 1,
      },
    };
  };

  startTalkingVideoTask({
    taskId,
    userId,
    deepThink: true,
    images: [{ filePath: '/tmp/model.png', filename: 'model.png', mimeType: 'image/png', role: 'model' as const }],
    video: { filePath: '/tmp/source.mp4', filename: 'source.mp4', mimeType: 'video/mp4' },
    runAgent: runAgent as never,
    persistSnapshot: (event) => persisted.push({
      status: event.status,
      phase: event.phase,
      reasoning: event.reasoning,
      prompt: event.prompt,
    }),
  });

  const done = new Promise<void>((resolve) => {
    subscribeTalkingVideoTask({
      taskId,
      userId,
      listener: (event) => {
        events.push({ type: event.type, phase: 'phase' in event ? event.phase : undefined });
        if (event.type === 'done') resolve();
      },
    });
  });

  await done;

  assert.equal(events.some((event) => event.type === 'phase' && event.phase === 'understanding_video'), true);
  const snapshot = subscribeTalkingVideoTask({
    taskId,
    userId,
    listener: () => undefined,
  });
  snapshot();
  const task = startTalkingVideoTask({
    taskId,
    userId,
    deepThink: true,
    images: [{ filePath: '/tmp/model.png', filename: 'model.png', mimeType: 'image/png', role: 'model' as const }],
    video: { filePath: '/tmp/source.mp4', filename: 'source.mp4', mimeType: 'video/mp4' },
    runAgent: runAgent as never,
  });
  assert.equal(task.status, 'completed');
  assert.equal(task.phase, 'completed');
  assert.equal(task.metrics.reuseCacheHitCount, 1);
  assert.equal(typeof task.timings.t_first_phase_ms, 'number');
  assert.equal(typeof task.timings.t_first_reasoning_ms, 'number');
  assert.equal(typeof task.timings.t_analysis_done_ms, 'number');
  assert.equal(typeof task.timings.t_result_ms, 'number');
  assert.equal(persisted[0]?.status, 'thinking');
  assert.equal(persisted.at(-1)?.status, 'completed');
  assert.equal(persisted.at(-1)?.reasoning, '导演审片记录');
  assert.equal(persisted.at(-1)?.prompt, '分段A');
});
