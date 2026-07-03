import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'video-remake-reference-tests-'));
const dataDir = path.join(tempRoot, 'data');
const previousDataDir = process.env.DATA_DIR;
mkdirSync(dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;

const [
  { migrateDatabase },
  { createUser },
  { listBillableUsageRecords },
  { contentRepository },
  { persistSegmentedVideoGenerationState },
  { defaultVideoRemakeNodeAdapters, videoRemakeVideoModelRuntime },
  { callSceneAwareSegmentedSeedanceVideoGeneration, resumeSceneAwareSegmentedSeedanceVideoGeneration },
] = await Promise.all([
  import('../src/db/schema.js'),
  import('../src/modules/users/user.service.js'),
  import('../src/modules/billing/billing.service.js'),
  import('../src/modules/content/content.repository.js'),
  import('../src/modules/content/internals/content-video-generation.js'),
  import('../src/modules/video-remake/video-remake.node-adapters.js'),
  import('../src/modules/video-remake/video-remake.segmented-runtime.js'),
]);

migrateDatabase();

test.after(() => {
  if (previousDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = previousDataDir;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

function buildWorkflow(input?: {
  storyboardScript?: Array<Record<string, unknown>>;
  seedancePrompts?: Array<Record<string, unknown>>;
  videoSegments?: Array<Record<string, unknown>>;
  characterSetting?: Record<string, unknown>;
  sceneSetting?: Record<string, unknown>;
  scriptContent?: string;
}) {
  const seedancePrompts = input?.seedancePrompts || [1, 2, 3, 4].map((index) => ({
    segmentId: `segment_${index}`,
    index,
    startTime: (index - 1) * 4,
    endTime: index * 4,
    duration: 4,
    prompt: {
      mainPrompt: [
        '# 当前分镜',
        `画面：第 ${index} 段`,
        '',
        '# 本段口播',
        `人物1：第 ${index} 段口播。`,
      ].join('\n'),
      systemPrompt: '# 生成规则\n纯画面视频。',
      negativePrompt: '',
    },
  }));
  const videoSegments = input?.videoSegments || seedancePrompts.map((segment) => ({
    segmentId: String(segment.segmentId),
    index: Number(segment.index),
    startSecond: Number(segment.startTime || 0),
    endSecond: Number(segment.endTime || 4),
    durationSecond: Number(segment.duration || 4),
    seedancePrompt: String((segment.prompt as Record<string, unknown>)?.mainPrompt || ''),
    prompt: segment.prompt,
  }));
  return {
    mode: 'video_remake',
    currentNode: 'merge_video',
    source: {
      kind: 'url',
      title: '参考视频策略测试',
      sourceUrl: 'https://example.com/source.mp4',
    },
    artifacts: {
      videoBasicInfo: { aspectRatio: '9:16', resolution: '720p' },
      storyboardScript: input?.storyboardScript || [
        { startSecond: 0, endSecond: 8, visualDescription: '场景 1 中 人物 1 和 人物 2 对话', actionDescription: '人物 1 和 人物 2 同框', narration: '人物1：第一段。人物2：补充。' },
        { startSecond: 8, endSecond: 16, visualDescription: '场景 2 中 人物 1 单独出镜', actionDescription: '人物 1 展示产品', narration: '人物1：第二场景。' },
      ],
      scriptContent: { content: input?.scriptContent || '人物1：第一段。人物2：补充。人物1：第二场景。' },
      characterSetting: input?.characterSetting || {
        items: [
          { label: '人物 1', referenceMode: 'prompt', required: true, characterPrompt: '主讲人，女性' },
          { label: '人物 2', referenceMode: 'prompt', required: true, characterPrompt: '搭档，男性' },
        ],
      },
      sceneSetting: input?.sceneSetting || {
        items: [
          { label: '场景 1', referenceMode: 'prompt', required: true, description: '室内访谈区' },
          { label: '场景 2', referenceMode: 'prompt', required: true, description: '产品展示台' },
        ],
      },
      seedancePrompts,
    },
    invalidArtifacts: [],
    runtime: {
      videoSegments,
    },
    updatedAt: new Date().toISOString(),
  };
}

test('video remake scene-aware primers generate multiple spans and route each segment to its primer', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];
  const segmentedCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-primer-${Date.now()}`, 'password123', 'Reference Primer User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      const idx = configuredCalls.length;
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: `primer-job-${idx}`,
        status: 'completed',
        videoUrl: `https://cdn.example.com/reference-primer-${idx}.mp4`,
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => {
      segmentedCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        status: 'completed',
        videoUrl: '/files/generated.mp4',
        jobId: 'segmented-job-1',
        renderMode: 'segmented_ffmpeg',
        segments: input.segmentInputs.map((segment) => ({
          segmentIndex: segment.segmentIndex,
          seconds: segment.seconds,
          status: 'completed',
          videoUrl: `/files/segment-${segment.segmentIndex}.mp4`,
        })),
      };
    };

    const workflow = buildWorkflow({
      seedancePrompts: [1, 2, 3, 4].map((index) => ({
        segmentId: `segment_${index}`,
        index,
        startTime: (index - 1) * 4,
        endTime: index * 4,
        duration: 4,
        prompt: {
          mainPrompt: [
            '# 当前分镜',
            `画面：第 ${index} 段`,
            '',
            '# 本段口播',
            index <= 2 ? `人物1：场景一第 ${index} 句。人物2：同时出现。` : `人物1：场景二第 ${index} 句。`,
          ].join('\n'),
          systemPrompt: '# 生成规则\n纯画面视频。',
          negativePrompt: '',
        },
      })),
      storyboardScript: [
        { startSecond: 0, endSecond: 8, visualDescription: '场景 1 中 人物 1 和 人物 2 同时出现', actionDescription: '人物 1 和 人物 2 同框交流', narration: '人物1：场景一。人物2：补充。' },
        { startSecond: 8, endSecond: 16, visualDescription: '场景 2 中 只有 人物 1 出镜', actionDescription: '人物 1 展示产品', narration: '人物1：场景二。' },
      ],
    });

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-primer',
      userId: user.id,
      taskId: 'task-reference-primer',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 2);
    assert.match(String(configuredCalls[0]?.prompt || ''), /人物 1/);
    assert.match(String(configuredCalls[0]?.prompt || ''), /人物 2/);
    assert.equal(segmentedCalls.length, 1);
    const segmentInputs = segmentedCalls[0]?.segmentInputs as Array<Record<string, unknown>>;
    assert.equal(segmentInputs.length, 4);
    assert.equal(String(segmentInputs[0]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[1]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[2]?.referencePrimerSpanId || ''), 'primer_span_2');
    assert.equal(String(segmentInputs[3]?.referencePrimerSpanId || ''), 'primer_span_2');
    assert.match(String(segmentInputs[1]?.prompt || ''), /参考视频只提供缺素材项的形象、氛围和镜头质感参考/u);
    assert.match(String(segmentInputs[1]?.prompt || ''), /不得参考或复用参考视频的音轨、口型、原始台词/u);
    assert.match(String(segmentInputs[1]?.prompt || ''), /开头必须清晰朗读本段第一句/u);
    assert.doesNotMatch(String(segmentInputs[1]?.prompt || ''), /口播音色或节奏参考/u);
    assert.equal((result as { referencePrimerPlan?: { spans?: unknown[] } }).referencePrimerPlan?.spans?.length, 2);
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake queued extend skips reference primer generation', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];
  const segmentedCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-primer-queued-${Date.now()}`, 'password123', 'Reference Primer Queued User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: 'unexpected-primer-job',
        status: 'completed',
        videoUrl: 'https://cdn.example.com/unexpected-reference-primer.mp4',
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => {
      segmentedCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        status: 'completed',
        videoUrl: '/files/generated-queued.mp4',
        jobId: 'queued-segmented-job',
        renderMode: 'queued_extend_ffmpeg',
        segments: input.segmentInputs.map((segment) => ({
          segmentIndex: segment.segmentIndex,
          seconds: segment.seconds,
          status: 'completed',
          videoUrl: `/files/queued-segment-${segment.segmentIndex}.mp4`,
        })),
      };
    };

    const workflow = buildWorkflow();
    workflow.artifacts.finalVideo = { generationMode: 'queued_extend' };

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-primer-queued',
      userId: user.id,
      taskId: 'task-reference-primer-queued',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 0);
    assert.equal(segmentedCalls.length, 1);
    assert.equal(String(segmentedCalls[0]?.generationMode || ''), 'queued_extend');
    const segmentInputs = segmentedCalls[0]?.segmentInputs as Array<Record<string, unknown>>;
    assert.equal(segmentInputs.some((segment) => String(segment.referencePrimerSpanId || '').trim().length > 0), false);
    assert.equal((result as { referencePrimerPlan?: unknown }).referencePrimerPlan, undefined);
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake scene-aware primers keep stable multi-segment spans in mixed scene switches', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];
  const segmentedCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-mixed-${Date.now()}`, 'password123', 'Mixed Scene User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      const idx = configuredCalls.length;
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: `primer-job-mixed-${idx}`,
        status: 'completed',
        videoUrl: `https://cdn.example.com/reference-primer-mixed-${idx}.mp4`,
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => {
      segmentedCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        status: 'completed',
        videoUrl: '/files/generated-mixed.mp4',
        jobId: 'segmented-job-mixed',
        renderMode: 'segmented_ffmpeg',
        segments: input.segmentInputs.map((segment) => ({
          segmentIndex: segment.segmentIndex,
          seconds: segment.seconds,
          status: 'completed',
          videoUrl: `/files/segment-mixed-${segment.segmentIndex}.mp4`,
        })),
      };
    };

    const workflow = buildWorkflow({
      sceneSetting: {
        items: [
          { label: '场景 A', referenceMode: 'prompt', required: true, description: '场景 A 室内讲解区' },
          { label: '场景 B', referenceMode: 'prompt', required: true, description: '场景 B 展示台' },
          { label: '场景 C', referenceMode: 'prompt', required: true, description: '场景 C 收尾区' },
        ],
      },
      storyboardScript: [
        { startSecond: 0, endSecond: 8, visualDescription: '场景 A 中 人物 1 出镜', actionDescription: '人物 1 在场景 A 中讲解', narration: '人物1：场景A前半段。' },
        { startSecond: 8, endSecond: 12, visualDescription: '场景 B 中 人物 1 出镜', actionDescription: '人物 1 切换到场景 B', narration: '人物1：场景B。' },
        { startSecond: 12, endSecond: 16, visualDescription: '场景 C 中 人物 1 出镜', actionDescription: '人物 1 切换到场景 C', narration: '人物1：场景C。' },
      ],
      seedancePrompts: [1, 2, 3, 4].map((index) => ({
        segmentId: `segment_${index}`,
        index,
        startTime: (index - 1) * 4,
        endTime: index * 4,
        duration: 4,
        prompt: {
          mainPrompt: [
            '# 当前分镜',
            `画面：第 ${index} 段`,
            '',
            '# 本段口播',
            index <= 2 ? `人物1：场景A第 ${index} 句。` : index === 3 ? '人物1：场景B。' : '人物1：场景C。',
          ].join('\n'),
          systemPrompt: '# 生成规则\n纯画面视频。',
          negativePrompt: '',
        },
      })),
    });

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-mixed',
      userId: user.id,
      taskId: 'task-reference-mixed',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 3);
    assert.equal(segmentedCalls.length, 1);
    const plan = (result as {
      referencePrimerPlan?: {
        mode?: string;
        spans?: Array<{ segmentIndexes?: number[] }>;
      };
    }).referencePrimerPlan;
    assert.equal(plan?.mode, 'scene_spans');
    assert.equal(plan?.spans?.length, 3);
    assert.deepEqual(plan?.spans?.map((span) => span.segmentIndexes), [[1, 2], [3], [4]]);

    const segmentInputs = segmentedCalls[0]?.segmentInputs as Array<Record<string, unknown>>;
    assert.equal(String(segmentInputs[0]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[1]?.referencePrimerSpanId || ''), 'primer_span_1');
    assert.equal(String(segmentInputs[2]?.referencePrimerSpanId || ''), 'primer_span_2');
    assert.equal(String(segmentInputs[3]?.referencePrimerSpanId || ''), 'primer_span_3');
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake scene-aware primers collapse rapid scene switching to a single primer', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const originalSegmented = videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration;
  const configuredCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-rapid-${Date.now()}`, 'password123', 'Rapid Switch User');

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      configuredCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: 'primer-job-rapid',
        status: 'completed',
        videoUrl: 'https://cdn.example.com/reference-primer-rapid.mp4',
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = async (input) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      status: 'completed',
      videoUrl: '/files/generated-rapid.mp4',
      jobId: 'segmented-job-rapid',
      renderMode: 'segmented_ffmpeg',
      segments: input.segmentInputs.map((segment) => ({
        segmentIndex: segment.segmentIndex,
        seconds: segment.seconds,
        status: 'completed',
        videoUrl: `/files/segment-rapid-${segment.segmentIndex}.mp4`,
      })),
    });

    const workflow = buildWorkflow({
      storyboardScript: [
        { startSecond: 0, endSecond: 4, visualDescription: '场景 1', actionDescription: '人物 1', narration: '人物1：第一句。' },
        { startSecond: 4, endSecond: 8, visualDescription: '场景 2', actionDescription: '人物 1', narration: '人物1：第二句。' },
        { startSecond: 8, endSecond: 12, visualDescription: '场景 1', actionDescription: '人物 1', narration: '人物1：第三句。' },
        { startSecond: 12, endSecond: 16, visualDescription: '场景 2', actionDescription: '人物 1', narration: '人物1：第四句。' },
      ],
    });

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-reference-rapid',
      userId: user.id,
      taskId: 'task-reference-rapid',
      workflow,
      emit: () => undefined,
    });

    assert.equal(configuredCalls.length, 1);
    assert.equal((result as { referencePrimerPlan?: { mode?: string; spans?: unknown[] } }).referencePrimerPlan?.mode, 'rapid_switch_fallback');
    assert.equal((result as { referencePrimerPlan?: { spans?: unknown[] } }).referencePrimerPlan?.spans?.length, 1);
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    videoRemakeVideoModelRuntime.callSceneAwareSegmentedSeedanceVideoGeneration = originalSegmented;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake scene-aware segmented generation records billable usage for each segment', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalFetch = globalThis.fetch;

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-reference-usage-${Date.now()}`, 'password123', 'Reference Usage User');

    const runtime = {
      callConfiguredVideoModel: async (input: Parameters<typeof videoRemakeVideoModelRuntime.callConfiguredVideoModel>[0]) => {
      const title = String(input.title || '');
      const segmentMatch = title.match(/片段(\d+)/u);
      const segmentIndex = Number(segmentMatch?.[1] || 0);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: `usage-segment-job-${segmentIndex}`,
        status: 'completed',
        videoUrl: `https://cdn.example.com/usage-segment-${segmentIndex}.mp4`,
        coverUrl: '',
        usage: { completionTokens: 3, totalTokens: 6 },
      };
      },
      waitForVideoModelCompletion: async ({ jobId, initialUsage }: Parameters<typeof videoRemakeVideoModelRuntime.waitForVideoModelCompletion>[0]) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: `https://cdn.example.com/${jobId}.mp4`,
      coverUrl: '',
      usage: initialUsage,
      }),
    };
    globalThis.fetch = async () => new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer, {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });

    await assert.rejects(
      () => callSceneAwareSegmentedSeedanceVideoGeneration({
        taskId: 'task-reference-usage',
        userId: user.id,
        title: '计费测试视频',
        negativePrompts: [],
        ratio: '9:16',
        resolution: '720p',
        totalSeconds: 18,
        context: {},
        materialContext: {},
        providerId: 'volcengine-seedance',
        modelId: 'doubao-seedance-2-0-260128',
        seedanceOptions: {
          generateAudio: true,
          watermark: false,
          resolution: '720p',
        },
        traceId: 'trace-reference-usage',
        segmentInputs: [1, 2, 3].map((index) => ({
          segmentIndex: index,
          seconds: 6,
          prompt: `计费测试第 ${index} 段`,
          context: {},
          materialContext: {},
        })),
      }, runtime),
      /ffmpeg|Invalid data|Error opening input/u,
    );

    const usageRecords = listBillableUsageRecords({ userId: user.id, limit: 20 })
      .filter((record) => record.category === 'video_generation');
    const segmentUsageRecords = usageRecords
      .filter((record) => record.sourceType === 'video_remake_scene_aware_segment_generation')
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    assert.equal(segmentUsageRecords.length, 3);
    assert.deepEqual(segmentUsageRecords.map((record) => record.sourceId), [
      'usage-segment-job-1',
      'usage-segment-job-2',
      'usage-segment-job-3',
    ]);
    segmentUsageRecords.forEach((record) => {
      assert.equal(Number((record.quantitySnapshot as Record<string, unknown>).totalTokens || 0), 6);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake queued extend generation sends previous segment as next reference', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-queued-extend-${Date.now()}`, 'password123', 'Queued Extend User');

    const runtime = {
      callConfiguredVideoModel: async (input: Parameters<typeof videoRemakeVideoModelRuntime.callConfiguredVideoModel>[0]) => {
        calls.push(input as unknown as Record<string, unknown>);
        const title = String(input.title || '');
        const segmentIndex = Number(title.match(/片段(\d+)/u)?.[1] || calls.length);
        return {
          provider: 'volcengine-seedance',
          model: 'doubao-seedance-2-0-260128',
          jobId: `queued-segment-job-${segmentIndex}`,
          status: 'completed',
          videoUrl: `https://cdn.example.com/queued-segment-${segmentIndex}.mp4`,
          coverUrl: '',
          usage: { completionTokens: 3, totalTokens: 6 },
        };
      },
      waitForVideoModelCompletion: async ({ jobId, initialUsage }: Parameters<typeof videoRemakeVideoModelRuntime.waitForVideoModelCompletion>[0]) => ({
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId,
        status: 'completed',
        videoUrl: `https://cdn.example.com/${jobId}.mp4`,
        coverUrl: '',
        usage: initialUsage,
      }),
    };
    globalThis.fetch = async () => new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer, {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });

    await assert.rejects(
      () => callSceneAwareSegmentedSeedanceVideoGeneration({
        taskId: 'task-queued-extend',
        userId: user.id,
        title: '排队延长测试视频',
        negativePrompts: [],
        ratio: '9:16',
        resolution: '720p',
        totalSeconds: 12,
        context: {},
        materialContext: {},
        providerId: 'volcengine-seedance',
        modelId: 'doubao-seedance-2-0-260128',
        seedanceOptions: {
          generateAudio: true,
          watermark: false,
          resolution: '720p',
        },
        traceId: 'trace-queued-extend',
        generationMode: 'queued_extend',
        segmentInputs: [1, 2].map((index) => ({
          segmentIndex: index,
          seconds: 6,
          prompt: `排队延长第 ${index} 段`,
          context: {},
          materialContext: {
            references: {
              videos: [
                {
                  id: 'original-reference-video',
                  url: 'https://cdn.example.com/original-reference.mp4',
                  fileUrl: 'https://cdn.example.com/original-reference.mp4',
                },
              ],
            },
          },
        })),
      }, runtime),
      /ffmpeg|Invalid data|Error opening input/u,
    );

    assert.equal(calls.length, 2);
    assert.match(String(calls[0]?.prompt || ''), /排队生成画质基准/u);
    assert.match(String(calls[0]?.prompt || ''), /第一段必须建立全片高清画质基准/u);
    const firstNegativePrompts = calls[0]?.negativePrompts as string[];
    assert.equal(firstNegativePrompts.includes('画面逐段变糊'), true);
    assert.match(String(calls[1]?.prompt || ''), /视频延长上下文/u);
    assert.match(String(calls[1]?.prompt || ''), /上一段分段 1 已生成/u);
    assert.match(String(calls[1]?.prompt || ''), /排队生成画质基准/u);
    assert.match(String(calls[1]?.prompt || ''), /不作为画质上限/u);
    assert.match(String(calls[1]?.prompt || ''), /人物面部必须清晰稳定/u);
    const secondNegativePrompts = calls[1]?.negativePrompts as string[];
    assert.equal(secondNegativePrompts.includes('人物面部斑驳色块'), true);
    assert.equal(secondNegativePrompts.includes('画面逐段变糊'), true);
    assert.equal(secondNegativePrompts.includes('继承上一段模糊画质'), true);
    const secondContext = calls[1]?.context as Record<string, unknown>;
    const secondMaterialContext = secondContext.materialContext as Record<string, unknown>;
    const references = secondMaterialContext.references as Record<string, unknown>;
    const videos = references.videos as Array<Record<string, unknown>>;
    assert.equal(videos.length, 1);
    assert.equal(String(videos[0]?.url || ''), 'https://cdn.example.com/queued-segment-job-1.mp4');
    assert.notEqual(String(videos[0]?.url || ''), 'https://cdn.example.com/original-reference.mp4');
    assert.equal(String((secondContext.videoGenerationFlow as Record<string, unknown>).source), 'video_remake_queued_extend_segment_generation');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake queued extend resume keeps previous segment reference mode', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-queued-resume-${Date.now()}`, 'password123', 'Queued Resume User');
    const task = contentRepository.createParsedVideoTask({
      userId: user.id,
      sourceUrl: 'https://example.com/source.mp4',
      title: '排队延长恢复测试视频',
      parseResult: {},
    });
    assert.ok(task);
    const segmentPath = path.join(dataDir, 'queued-resume-segment-1.mp4');
    mkdirSync(path.dirname(segmentPath), { recursive: true });
    writeFileSync(segmentPath, new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
      const state = {
      status: 'running' as const,
        request: {
        taskId: task.id,
        userId: user.id,
        title: '排队延长恢复测试视频',
        prompt: '',
        negativePrompts: [],
        ratio: '9:16',
        resolution: '720p',
        totalSeconds: 12,
        maxSegmentSeconds: 6,
        context: {
          videoRemakeSegmentInputs: [1, 2].map((index) => ({
            segmentIndex: index,
            seconds: 6,
            prompt: `恢复排队第 ${index} 段`,
            context: {},
            materialContext: {},
          })),
        },
        materialContext: {
          references: {
            videos: [
              {
                id: 'resume-original-reference-video',
                url: 'https://cdn.example.com/resume-original-reference.mp4',
                fileUrl: 'https://cdn.example.com/resume-original-reference.mp4',
              },
            ],
          },
        },
        providerId: 'volcengine-seedance',
        modelId: 'doubao-seedance-2-0-260128',
        seedanceOptions: {
          generateAudio: true,
          watermark: false,
          resolution: '720p',
        },
        generationMode: 'queued_extend',
        traceId: 'trace-queued-resume',
      },
      segments: [6, 6],
      currentSegmentIndex: 1,
      segmentResults: [
        {
          segmentIndex: 1,
          seconds: 6,
          provider: 'volcengine-seedance',
          model: 'doubao-seedance-2-0-260128',
          jobId: 'queued-resume-segment-job-1',
          remoteVideoUrl: 'https://cdn.example.com/queued-resume-segment-job-1.mp4',
          videoUrl: '/files/queued-resume-segment-1.mp4',
          status: 'completed',
          segmentPath,
        },
      ],
      segmentPaths: [segmentPath],
      updatedAt: new Date().toISOString(),
    };
    persistSegmentedVideoGenerationState(task.id, state);

    const runtime = {
      callConfiguredVideoModel: async (input: Parameters<typeof videoRemakeVideoModelRuntime.callConfiguredVideoModel>[0]) => {
        calls.push(input as unknown as Record<string, unknown>);
        return {
          provider: 'volcengine-seedance',
          model: 'doubao-seedance-2-0-260128',
          jobId: 'queued-resume-segment-job-2',
          status: 'completed',
          videoUrl: 'https://cdn.example.com/queued-resume-segment-2.mp4',
          coverUrl: '',
          usage: { completionTokens: 3, totalTokens: 6 },
        };
      },
      waitForVideoModelCompletion: async ({ jobId, initialUsage }: Parameters<typeof videoRemakeVideoModelRuntime.waitForVideoModelCompletion>[0]) => ({
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId,
        status: 'completed',
        videoUrl: `https://cdn.example.com/${jobId}.mp4`,
        coverUrl: '',
        usage: initialUsage,
      }),
    };
    globalThis.fetch = async () => new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer, {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });

    await assert.rejects(
      () => resumeSceneAwareSegmentedSeedanceVideoGeneration(contentRepository.findVideoTask(task.id), state, runtime),
      /ffmpeg|Invalid data|Error opening input/u,
    );

    assert.equal(calls.length, 1);
    assert.match(String(calls[0]?.prompt || ''), /视频延长上下文/u);
    assert.match(String(calls[0]?.prompt || ''), /排队生成画质基准/u);
    assert.match(String(calls[0]?.prompt || ''), /不得继承上一段的模糊/u);
    const secondContext = calls[0]?.context as Record<string, unknown>;
    const secondMaterialContext = secondContext.materialContext as Record<string, unknown>;
    const references = secondMaterialContext.references as Record<string, unknown>;
    const videos = references.videos as Array<Record<string, unknown>>;
    assert.equal(videos.length, 1);
    assert.equal(String(videos[0]?.url || ''), 'https://cdn.example.com/queued-resume-segment-job-1.mp4');
    assert.notEqual(String(videos[0]?.url || ''), 'https://cdn.example.com/resume-original-reference.mp4');
    assert.equal(String((secondContext.videoGenerationFlow as Record<string, unknown>).source), 'video_remake_queued_extend_segment_generation');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});

test('video remake seedance prompt stays storyboard-driven and request matches editable prompt', async () => {
  const previousVideoApiKey = process.env.VIDEO_MODEL_API_KEY;
  const previousVideoBaseUrl = process.env.VIDEO_MODEL_BASE_URL;
  const previousVideoModelId = process.env.VIDEO_MODEL_ID;
  const originalCallConfigured = videoRemakeVideoModelRuntime.callConfiguredVideoModel;
  const originalWait = videoRemakeVideoModelRuntime.waitForVideoModelCompletion;
  const submittedCalls: Array<Record<string, unknown>> = [];

  try {
    process.env.VIDEO_MODEL_API_KEY = 'test-video-key';
    process.env.VIDEO_MODEL_BASE_URL = 'https://video-model.example.com';
    process.env.VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128';
    const user = createUser(`user-seedance-wysiwyg-${Date.now()}`, 'password123', 'Seedance Prompt User');
    const imageGroup = contentRepository.createGroup({
      userId: user.id,
      resourceType: 'image',
      name: '图像参考组',
      description: '',
      metadata: {},
    });
    const voiceGroup = contentRepository.createGroup({
      userId: user.id,
      resourceType: 'voice',
      name: '声音参考组',
      description: '',
      metadata: {},
    });
    const imagePath = path.join(dataDir, 'host.jpg');
    const audioPath = path.join(dataDir, 'host.wav');
    writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    writeFileSync(audioPath, Buffer.from('RIFF....WAVE', 'utf8'));
    const imageAsset = contentRepository.createAsset({
      userId: user.id,
      groupId: String(imageGroup?.id || ''),
      resourceType: 'image',
      name: '主持人参考图',
      description: '',
      originalFileName: 'host.jpg',
      storedFileName: 'host.jpg',
      mimeType: 'image/jpeg',
      fileSize: 128,
      filePath: imagePath,
      fileUrl: '/files/host.jpg',
      metadata: {},
    });
    const audioAsset = contentRepository.createAsset({
      userId: user.id,
      groupId: String(voiceGroup?.id || ''),
      resourceType: 'voice',
      name: '主持人口播参考',
      description: '',
      originalFileName: 'host.wav',
      storedFileName: 'host.wav',
      mimeType: 'audio/wav',
      fileSize: 128,
      filePath: audioPath,
      fileUrl: '/files/host.wav',
      metadata: {},
    });
    assert.ok(imageAsset);
    assert.ok(audioAsset);

    videoRemakeVideoModelRuntime.callConfiguredVideoModel = async (input) => {
      submittedCalls.push(input as unknown as Record<string, unknown>);
      return {
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        jobId: 'wysiwyg-job-1',
        status: 'completed',
        videoUrl: 'data:video/mp4;base64,AAAA',
        coverUrl: '',
        usage: { completionTokens: 1, totalTokens: 1 },
      };
    };
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = async ({ jobId }) => ({
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      jobId,
      status: 'completed',
      videoUrl: 'data:video/mp4;base64,AAAA',
      coverUrl: '',
      usage: { completionTokens: 1, totalTokens: 1 },
    });

    const workflow = buildWorkflow({
      storyboardScript: [
        {
          startSecond: 0,
          endSecond: 4,
          visualDescription: '场景 1 中人物 1 对镜讲解新品亮点',
          actionDescription: '人物 1 手持产品自然展示',
          narration: '人物1：今天带你看这款新品。',
          soundEffect: '轻微室内环境底噪',
          remakeSuggestion: '中近景稳定推进，保留产品细节特写',
        },
        {
          startSecond: 4,
          endSecond: 8,
          visualDescription: '场景 2 切到产品桌面特写',
          actionDescription: '镜头掠过包装和 Logo 细节',
          narration: '人物1：重点看包装和品牌标识。',
          soundEffect: '安静室内环境',
          remakeSuggestion: '切换到桌面俯拍，强调包装纹理',
        },
      ],
      characterSetting: {
        items: [
          { label: '人物 1', referenceMode: 'asset', required: true, assetId: imageAsset?.id, characterPrompt: '年轻女主持人' },
        ],
      },
      sceneSetting: {
        items: [
          { label: '场景 1', referenceMode: 'prompt', required: true, description: '简洁室内讲解区' },
          { label: '场景 2', referenceMode: 'prompt', required: true, description: '产品展示桌面' },
        ],
      },
    });
    workflow.artifacts.voiceSetting = {
      items: [
        {
          label: '人物 1 声音',
          characterLabel: '人物 1',
          voice: '女声',
          voiceStyle: '自然清晰，中速讲解',
          assetId: audioAsset?.id,
        },
      ],
    };

    const prompts = await defaultVideoRemakeNodeAdapters.generateSeedancePrompts({
      sessionId: 'session-seedance-wysiwyg',
      userId: user.id,
      taskId: 'task-seedance-wysiwyg',
      workflow,
      emit: () => undefined,
    });
    assert.equal(prompts.length, 1);
    const generatedPrompt = (prompts[0]?.prompt || {}) as Record<string, unknown>;
    const mainPrompt = String(generatedPrompt.mainPrompt || '');
    const referenceMentions = (generatedPrompt.referenceMentions || []) as Array<Record<string, unknown>>;

    assert.match(mainPrompt, /# 生成规则/u);
    assert.match(mainPrompt, /# 当前分镜/u);
    assert.doesNotMatch(mainPrompt, /# 本段口播/u);
    assert.match(mainPrompt, /台词\/旁白/u);
    assert.match(mainPrompt, /场景 1/u);
    assert.match(mainPrompt, /场景 2/u);
    assert.match(mainPrompt, /@图片1/u);
    assert.match(mainPrompt, /音频参考：人物 1 只能绑定 参考@音频1/u);
    assert.match(mainPrompt, /@音频1/u);
    assert.ok(mainPrompt.indexOf('# 素材/音频参考') < mainPrompt.indexOf('# 当前分镜'));
    assert.doesNotMatch(mainPrompt, /沿用已确认声音设定/u);
    assert.doesNotMatch(mainPrompt, /使用原声参考/u);
    assert.doesNotMatch(mainPrompt, /# 人物\s*\n/u);
    assert.doesNotMatch(mainPrompt, /# 场景\s*\n/u);
    assert.doesNotMatch(mainPrompt, /# 音频\s*\n/u);
    assert.doesNotMatch(mainPrompt, /# 已确认设定\s*\n/u);
    assert.doesNotMatch(mainPrompt, /# 口播与参考音视频边界\s*\n/u);
    assert.equal(referenceMentions.length, 2);
    assert.equal(String(referenceMentions[0]?.token || ''), '@图片1');
    assert.equal(String(referenceMentions[1]?.token || ''), '@音频1');

    workflow.artifacts.seedancePrompts = prompts;
    const segments = await defaultVideoRemakeNodeAdapters.generateVideoSegments({
      sessionId: 'session-seedance-wysiwyg',
      userId: user.id,
      taskId: 'task-seedance-wysiwyg',
      workflow,
      emit: () => undefined,
    });
    assert.equal(String((segments[0] as Record<string, unknown>)?.seedancePrompt || ''), mainPrompt);

    const result = await defaultVideoRemakeNodeAdapters.mergeVideo({
      sessionId: 'session-seedance-wysiwyg',
      userId: user.id,
      taskId: 'task-seedance-wysiwyg',
      workflow: {
        ...workflow,
        runtime: {
          ...workflow.runtime,
          videoSegments: segments,
        },
      },
      emit: () => undefined,
    });

    assert.equal(submittedCalls.length, 1);
    assert.equal(String(submittedCalls[0]?.prompt || ''), mainPrompt);
    assert.equal(String((result as { renderMode?: string }).renderMode || ''), 'single_seedance');
  } finally {
    videoRemakeVideoModelRuntime.callConfiguredVideoModel = originalCallConfigured;
    videoRemakeVideoModelRuntime.waitForVideoModelCompletion = originalWait;
    if (previousVideoApiKey === undefined) {
      delete process.env.VIDEO_MODEL_API_KEY;
    } else {
      process.env.VIDEO_MODEL_API_KEY = previousVideoApiKey;
    }
    if (previousVideoBaseUrl === undefined) {
      delete process.env.VIDEO_MODEL_BASE_URL;
    } else {
      process.env.VIDEO_MODEL_BASE_URL = previousVideoBaseUrl;
    }
    if (previousVideoModelId === undefined) {
      delete process.env.VIDEO_MODEL_ID;
    } else {
      process.env.VIDEO_MODEL_ID = previousVideoModelId;
    }
  }
});
